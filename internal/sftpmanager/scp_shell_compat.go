package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

const scpShellOutputLimit = 8 * 1024 * 1024

func QuotePOSIXArg(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func resolveSCPShellHome(ctx context.Context, transport Transport) string {
	output, err := runSCPShellScript(ctx, transport, scpShellResolveHomeScript, 4096)
	if err != nil {
		return "/"
	}
	for _, line := range strings.Split(string(output), "\n") {
		home := cleanRemotePath(line)
		if strings.HasPrefix(home, "/") && !strings.ContainsAny(home, "\x00\r\n") {
			return home
		}
	}
	return "/"
}

func (m *Manager) scpShellStat(ctx context.Context, current *session, remotePath string) (domain.SFTPEntry, error) {
	if err := validateSCPRemoteReadablePath(remotePath); err != nil {
		return domain.SFTPEntry{}, err
	}
	output, err := runSCPShellStatScript(ctx, current.transport, scpShellPathArg(remotePath))
	if err != nil {
		if strings.Contains(string(output), "SP_ERROR\tNOT_FOUND") {
			return domain.SFTPEntry{}, os.ErrNotExist
		}
		return domain.SFTPEntry{}, err
	}
	entries, err := parseSCPShellEntries(parentRemotePath(remotePath), output)
	if err != nil {
		return domain.SFTPEntry{}, err
	}
	if len(entries) == 0 {
		return domain.SFTPEntry{}, errors.New("SCP 兼容模式无法读取远程文件属性")
	}
	return entries[0], nil
}

func (m *Manager) scpShellList(ctx context.Context, current *session, remotePath string) (domain.SFTPListResult, error) {
	if err := validateSCPRemoteReadablePath(remotePath); err != nil {
		return domain.SFTPListResult{}, err
	}
	output, err := runSCPShellScript(ctx, current.transport, scpShellListScript, scpShellOutputLimit, scpShellPathArg(remotePath))
	if err != nil {
		return domain.SFTPListResult{}, err
	}
	entries, err := parseSCPShellEntries(remotePath, output)
	if err != nil {
		return domain.SFTPListResult{}, err
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return domain.SFTPListResult{
		ConnectionID: current.connectionID,
		ContextID:    current.contextID,
		Mode:         domain.SFTPModeSCP,
		Path:         remotePath,
		ParentPath:   parentRemotePath(remotePath),
		Entries:      entries,
	}, nil
}

func (m *Manager) scpShellMkdir(ctx context.Context, current *session, remotePath string) error {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return err
	}
	return runSCPShellScriptNoOutput(ctx, current.transport, scpShellMkdirScript, scpShellPathArg(remotePath))
}

func (m *Manager) scpShellChmod(ctx context.Context, current *session, remotePath string, mode uint32) error {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return err
	}
	return runSCPShellScriptNoOutput(ctx, current.transport, scpShellChmodScript, fmt.Sprintf("%04o", mode&0o7777), scpShellPathArg(remotePath))
}

func (m *Manager) scpShellRename(ctx context.Context, current *session, oldPath, newPath string) error {
	if err := validateSCPRemoteTarget(oldPath); err != nil {
		return err
	}
	if err := validateSCPRemoteTarget(newPath); err != nil {
		return err
	}
	if baseRemotePath(newPath) == "" || strings.Contains(baseRemotePath(newPath), "/") {
		return errors.New("SCP 兼容模式只支持同目录安全重命名")
	}
	return runSCPShellScriptNoOutput(ctx, current.transport, scpShellRenameScript, scpShellPathArg(oldPath), scpShellPathArg(newPath))
}

func (m *Manager) scpShellInspectDelete(ctx context.Context, current *session, paths []string) (domain.SFTPInspectDeleteResponse, error) {
	if len(paths) == 0 {
		return domain.SFTPInspectDeleteResponse{}, errors.New("请选择要删除的远程项目")
	}
	args := make([]string, 0, len(paths))
	for _, remotePath := range paths {
		if err := validateSCPRemoteTarget(remotePath); err != nil {
			return domain.SFTPInspectDeleteResponse{}, err
		}
		args = append(args, scpShellPathArg(remotePath))
	}
	output, err := runSCPShellScript(ctx, current.transport, scpShellInspectDeleteScript, scpShellOutputLimit, args...)
	if err != nil {
		return domain.SFTPInspectDeleteResponse{}, err
	}
	response := domain.SFTPInspectDeleteResponse{
		ConnectionID: current.connectionID,
		ContextID:    current.contextID,
		Paths:        paths,
	}
	for _, line := range strings.Split(strings.TrimRight(string(output), "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 3 || parts[0] != "SP_ITEM" {
			continue
		}
		size, _ := strconv.ParseInt(parts[2], 10, 64)
		switch parts[1] {
		case "dir":
			response.DirectoryCount++
			response.RequiresRecursive = true
		case "symlink":
			response.SymlinkCount++
			response.TotalBytes += size
		default:
			response.FileCount++
			response.TotalBytes += size
		}
	}
	return response, nil
}

func (m *Manager) scpShellDelete(ctx context.Context, current *session, paths []string, recursive bool) error {
	if len(paths) == 0 {
		return errors.New("请选择要删除的远程项目")
	}
	args := make([]string, 0, len(paths)+1)
	if recursive {
		args = append(args, "recursive")
	} else {
		args = append(args, "plain")
	}
	for _, remotePath := range paths {
		if err := validateSCPRemoteTarget(remotePath); err != nil {
			return err
		}
		args = append(args, scpShellPathArg(remotePath))
	}
	return runSCPShellScriptNoOutput(ctx, current.transport, scpShellDeleteScript, args...)
}

func (m *Manager) scpShellReadTextFile(ctx context.Context, current *session, remotePath string, limit int64, requestID string) (domain.SFTPReadTextFileResult, error) {
	entry, err := m.scpShellStat(ctx, current, remotePath)
	if err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	if entry.IsDir {
		return domain.SFTPReadTextFileResult{}, errors.New("不能用文本查看器打开远程目录")
	}
	limit = normalizeTextPreviewLimit(limit)
	data, err := runSCPShellScript(ctx, current.transport, scpShellReadTextScript, limit+1, scpShellPathArg(remotePath))
	if err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	preview, err := buildTextPreview(remotePath, data, limit)
	if err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	if entry.Size > limit {
		preview.Truncated = true
		preview.ContentHash = ""
	}
	return domain.SFTPReadTextFileResult{
		ConnectionID:     current.connectionID,
		ContextID:        current.contextID,
		Generation:       current.generation,
		RequestID:        requestID,
		Path:             remotePath,
		Name:             entry.Name,
		Size:             entry.Size,
		Encoding:         preview.Encoding,
		ContentHash:      preview.ContentHash,
		Truncated:        preview.Truncated,
		Content:          preview.Content,
		DetectedLanguage: preview.Language,
		TextKind:         "plaintext",
		Entry:            entry,
	}, nil
}

func (m *Manager) scpShellWriteTextFile(ctx context.Context, current *session, request domain.SFTPWriteTextFileRequest, remotePath string) (domain.SFTPWriteTextFileResult, error) {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return domain.SFTPWriteTextFileResult{}, err
	}
	saveMode := normalizeTextSaveMode(request.Mode)
	conflictPolicy := normalizeTextConflictPolicy(request.ConflictPolicy, request.ForceOverwrite, saveMode)
	if request.Generation > 0 && current.generation > 0 && request.Generation != current.generation {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "validate_generation", "SFTP_SAVE_STALE_CONTEXT", "保存失败：文件连接上下文已过期，请重新加载后再保存。", nil, true)
	}
	data, encoding, err := encodeTextContent(request.Content, request.Encoding)
	if err != nil {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "validate_content", "SFTP_SAVE_UNSUPPORTED_ENCODING", err.Error(), nil, false)
	}
	if int64(len(data)) > defaultTextEditorLimit {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "validate_content", "SFTP_SAVE_TOO_LARGE", fmt.Sprintf("保存失败：文件过大，当前文本编辑器最多保存 %s。", formatByteLimit(defaultTextEditorLimit)), nil, false)
	}
	if strings.ContainsRune(request.Content, '\x00') {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "validate_content", "SFTP_SAVE_BINARY_CONTENT", "保存失败：疑似二进制内容，已拒绝保存。", nil, false)
	}
	entry, err := m.scpShellStat(ctx, current, remotePath)
	targetExists := err == nil
	if err != nil {
		if !(textSaveCreatesNewTarget(saveMode) && isRemoteNotExistError(err)) {
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "stat_before_save", saveCodeForError(err), saveMessageForStage("stat_before_save", err), err, isRetryableSFTPError(err))
		}
	} else {
		if entry.IsDir {
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_TARGET_IS_DIR", "保存失败：目标路径是远程目录。", nil, false)
		}
		if textSaveCreatesNewTarget(saveMode) && conflictPolicy != domain.SFTPTextOverwrite {
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_CONFLICT", "目标文件已存在，是否覆盖？", nil, false)
		}
		if saveMode == domain.SFTPTextSaveExisting && conflictPolicy != domain.SFTPTextOverwrite && scpEntryChangedSinceRead(entry, request.ExpectedSize, request.ExpectedMTime) {
			technical := fmt.Errorf("expected size=%d mtime=%s, actual size=%d mtime=%s", request.ExpectedSize, request.ExpectedMTime, entry.Size, entry.ModTime)
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_CONFLICT", "远程文件似乎已被修改，是否覆盖？", technical, false)
		}
		if saveMode == domain.SFTPTextSaveExisting && conflictPolicy != domain.SFTPTextOverwrite && request.ExpectedHash != "" {
			currentHash, err := currentSCPTextHash(ctx, current.transport, remotePath)
			if err != nil {
				return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", saveCodeForError(err), saveMessageForStage("conflict_check", err), err, isRetryableSFTPError(err))
			}
			if currentHash != request.ExpectedHash {
				technical := fmt.Errorf("expected hash=%s, actual hash=%s", request.ExpectedHash, currentHash)
				return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_CONFLICT", "远程文件似乎已被修改，是否覆盖？", technical, false)
			}
		}
	}
	tmpPath := tempSavePath(remotePath)
	mode := "0600"
	if targetExists && entry.Permissions != "" {
		mode = entry.Permissions
	}
	command := fmt.Sprintf(
		"cat > %s && { chmod %s %s 2>/dev/null || true; } && mv -f %s %s",
		QuotePOSIXArg(scpShellPathArg(tmpPath)),
		QuotePOSIXArg(mode),
		QuotePOSIXArg(scpShellPathArg(tmpPath)),
		QuotePOSIXArg(scpShellPathArg(tmpPath)),
		QuotePOSIXArg(scpShellPathArg(remotePath)),
	)
	if err := runSCPCommandInput(ctx, current.transport, command, data); err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		_ = runSCPShellScriptNoOutput(cleanupCtx, current.transport, "rm -f \"$1\" 2>/dev/null || true\n", scpShellPathArg(tmpPath))
		cancel()
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "write_temp_file", saveCodeForError(err), saveMessageForStage("write_temp_file", err), err, isRetryableSFTPError(err))
	}
	nextEntry, err := m.scpShellStat(ctx, current, remotePath)
	if err != nil {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "stat_after_save", saveCodeForError(err), saveMessageForStage("stat_after_save", err), err, isRetryableSFTPError(err))
	}
	return domain.SFTPWriteTextFileResult{
		ConnectionID: current.connectionID,
		ContextID:    current.contextID,
		Generation:   current.generation,
		RequestID:    request.RequestID,
		Path:         remotePath,
		Name:         nextEntry.Name,
		Size:         nextEntry.Size,
		Encoding:     encoding,
		ContentHash:  hashTextBytes(data),
		Entry:        nextEntry,
	}, nil
}

func currentSCPTextHash(ctx context.Context, transport Transport, remotePath string) (string, error) {
	data, err := runSCPShellScript(ctx, transport, scpShellReadTextScript, defaultTextEditorLimit+1, scpShellPathArg(remotePath))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > defaultTextEditorLimit {
		return "", errors.New("远程文件已超过当前文本编辑器保存上限")
	}
	return hashTextBytes(data), nil
}

func runSCPShellScriptNoOutput(ctx context.Context, transport Transport, script string, args ...string) error {
	_, err := runSCPShellScript(ctx, transport, script, scpShellOutputLimit, args...)
	return err
}

func runSCPShellStatScript(ctx context.Context, transport Transport, pathArg string) ([]byte, error) {
	commandText := "sh -s -- " + QuotePOSIXArg(pathArg)
	command, err := transport.StartCommand(ctx, commandText)
	if err != nil {
		return nil, err
	}
	defer command.Close()
	stdin := command.Stdin()
	if _, err := io.WriteString(stdin, scpShellStatScript); err != nil {
		return nil, err
	}
	if err := stdin.Close(); err != nil {
		return nil, err
	}
	output, readErr := io.ReadAll(io.LimitReader(command.Stdout(), scpShellOutputLimit+1))
	waitErr := command.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if int64(len(output)) > scpShellOutputLimit {
		return nil, errors.New("SCP 兼容模式返回数据过大")
	}
	if waitErr != nil {
		return output, fmt.Errorf("SCP 兼容模式远程命令失败: %w", waitErr)
	}
	return output, nil
}

func runSCPShellScript(ctx context.Context, transport Transport, script string, maxBytes int64, args ...string) ([]byte, error) {
	commandText := "sh -s --"
	for _, arg := range args {
		commandText += " " + QuotePOSIXArg(arg)
	}
	command, err := transport.StartCommand(ctx, commandText)
	if err != nil {
		return nil, err
	}
	defer command.Close()
	stdin := command.Stdin()
	if _, err := io.WriteString(stdin, script); err != nil {
		return nil, err
	}
	if err := stdin.Close(); err != nil {
		return nil, err
	}
	reader := command.Stdout()
	if maxBytes > 0 {
		reader = io.LimitReader(reader, maxBytes+1)
	}
	output, readErr := io.ReadAll(reader)
	waitErr := command.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if maxBytes > 0 && int64(len(output)) > maxBytes {
		return nil, errors.New("SCP 兼容模式返回数据过大")
	}
	if waitErr != nil {
		return nil, fmt.Errorf("SCP 兼容模式远程命令失败: %w", waitErr)
	}
	return output, nil
}

func runSCPCommandInput(ctx context.Context, transport Transport, commandText string, data []byte) error {
	command, err := transport.StartCommand(ctx, commandText)
	if err != nil {
		return err
	}
	defer command.Close()
	stdin := command.Stdin()
	if _, err := stdin.Write(data); err != nil {
		return err
	}
	if err := stdin.Close(); err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, command.Stdout())
	if err := command.Wait(); err != nil {
		return fmt.Errorf("SCP 兼容模式远程写入失败: %w", err)
	}
	return nil
}

func parseSCPShellEntries(parentPath string, output []byte) ([]domain.SFTPEntry, error) {
	entries := make([]domain.SFTPEntry, 0)
	lines := strings.Split(strings.TrimRight(string(output), "\n"), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "SP_PATH\t") {
			continue
		}
		if strings.HasPrefix(line, "SP_ERROR\t") {
			return nil, errors.New("SCP 兼容模式无法读取远程目录")
		}
		parts := strings.SplitN(line, "\t", 8)
		if len(parts) != 8 || parts[0] != "SP_ENTRY" {
			continue
		}
		size, _ := strconv.ParseInt(parts[2], 10, 64)
		mtime, _ := strconv.ParseInt(parts[3], 10, 64)
		name := parts[7]
		if unsafeSCPEntryName(name) {
			continue
		}
		entryType := parts[1]
		modTime := ""
		if mtime > 0 {
			modTime = time.Unix(mtime, 0).UTC().Format(time.RFC3339Nano)
		}
		entries = append(entries, domain.SFTPEntry{
			Name:        name,
			Path:        joinRemotePath(parentPath, name),
			ParentPath:  parentPath,
			Size:        size,
			IsDir:       entryType == "dir",
			IsSymlink:   entryType == "symlink",
			Permissions: parts[4],
			Owner:       emptyAsUnknown(parts[5]),
			Group:       emptyAsUnknown(parts[6]),
			ModTime:     modTime,
		})
	}
	return entries, nil
}

func scpEntryChangedSinceRead(entry domain.SFTPEntry, expectedSize int64, expectedMTime string) bool {
	if expectedSize >= 0 && entry.Size != expectedSize {
		return true
	}
	if expectedMTime == "" || entry.ModTime == "" {
		return false
	}
	expected, err := time.Parse(time.RFC3339Nano, expectedMTime)
	if err != nil {
		return true
	}
	actual, err := time.Parse(time.RFC3339Nano, entry.ModTime)
	if err != nil {
		return true
	}
	return expected.UTC().Unix() != actual.UTC().Unix()
}

func validateSCPRemoteReadablePath(remotePath string) error {
	if hasParentTraversal(remotePath) {
		return errors.New("SCP 远程路径不能包含 ..")
	}
	if strings.ContainsAny(remotePath, "\x00\r\n") {
		return errors.New("SCP 远程路径包含非法控制字符")
	}
	remotePath = cleanRemotePath(remotePath)
	if remotePath == "" || remotePath == "." || remotePath == ".." {
		return errors.New("SCP 远程路径无效")
	}
	return nil
}

func normalizeSCPRequestPath(base, rawPath string, allowRoot bool) (string, error) {
	if hasParentTraversal(rawPath) {
		return "", errors.New("SCP 远程路径不能包含 ..")
	}
	rawPath = normalizeSCPRelativePath(rawPath)
	remotePath := resolveRemotePath(base, rawPath)
	if remotePath == "." {
		remotePath = cleanRemotePath(base)
		if !strings.HasPrefix(remotePath, "/") {
			remotePath = "/"
		}
	}
	if strings.ContainsAny(remotePath, "\x00\r\n") {
		return "", errors.New("SCP 远程路径包含非法控制字符")
	}
	if !allowRoot {
		if err := validateSCPRemoteTarget(remotePath); err != nil {
			return "", err
		}
	}
	return remotePath, nil
}

func normalizeSCPRelativePath(rawPath string) string {
	rawPath = strings.TrimSpace(strings.ReplaceAll(rawPath, "\\", "/"))
	for rawPath == "." || strings.HasPrefix(rawPath, "./") {
		if rawPath == "." || rawPath == "./" {
			return ""
		}
		rawPath = strings.TrimPrefix(rawPath, "./")
	}
	return rawPath
}

func scpShellPathArg(remotePath string) string {
	remotePath = cleanRemotePath(remotePath)
	if !strings.HasPrefix(remotePath, "/") && !strings.Contains(remotePath, "/") && strings.HasPrefix(remotePath, "-") {
		return "./" + remotePath
	}
	return remotePath
}

func emptyAsUnknown(value string) string {
	if strings.TrimSpace(value) == "" {
		return "-"
	}
	return value
}

func fileModeFromNumeric(value string, isDir, isSymlink bool) fs.FileMode {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 8, 32)
	if err != nil {
		if isDir {
			return fs.ModeDir | 0o755
		}
		if isSymlink {
			return fs.ModeSymlink | 0o777
		}
		return 0o644
	}
	mode := fs.FileMode(parsed).Perm()
	if isDir {
		mode |= fs.ModeDir
	}
	if isSymlink {
		mode |= fs.ModeSymlink
	}
	return mode
}

type scpShellInfo struct {
	entry domain.SFTPEntry
}

func (i scpShellInfo) Name() string { return i.entry.Name }
func (i scpShellInfo) Size() int64  { return i.entry.Size }
func (i scpShellInfo) Mode() fs.FileMode {
	return fileModeFromNumeric(i.entry.Permissions, i.entry.IsDir, i.entry.IsSymlink)
}
func (i scpShellInfo) ModTime() time.Time {
	if i.entry.ModTime == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, i.entry.ModTime)
	if err != nil {
		return time.Time{}
	}
	return parsed
}
func (i scpShellInfo) IsDir() bool      { return i.entry.IsDir }
func (i scpShellInfo) Sys() interface{} { return nil }

const scpShellEntryFunction = `
emit_entry() {
  p=$1
  name=${p##*/}
  if [ "$p" = "/" ]; then name="/"; fi
  type=file
  if [ -L "$p" ]; then
    type=symlink
  elif [ -d "$p" ]; then
    type=dir
  fi
  meta=$(stat -c '%s	%Y	%a	%u	%g' "$p" 2>/dev/null || stat -f '%z	%m	%Lp	%u	%g' "$p" 2>/dev/null || printf '0	0	000	-	-')
  printf 'SP_ENTRY\t%s\t%s\t%s\n' "$type" "$meta" "$name"
}
`

const scpShellListScript = scpShellEntryFunction + `
target=$1
if [ ! -d "$target" ]; then
  printf 'SP_ERROR\tNOT_DIR\n'
  exit 3
fi
printf 'SP_PATH\t%s\n' "$target"
find "$target" -mindepth 1 -maxdepth 1 2>/dev/null | while IFS= read -r p; do
  emit_entry "$p"
done
`

const scpShellResolveHomeScript = `
home=
if home=$(cd ~ 2>/dev/null && pwd -P 2>/dev/null); then
  case "$home" in
    /*) printf '%s\n' "$home"; exit 0 ;;
  esac
fi
if [ -d /root ] && cd /root 2>/dev/null; then
  printf '/root\n'
  exit 0
fi
printf '/\n'
`

const scpShellStatScript = scpShellEntryFunction + `
target=$1
if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  printf 'SP_ERROR\tNOT_FOUND\n'
  exit 3
fi
emit_entry "$target"
`

const scpShellMkdirScript = `
target=$1
if [ -e "$target" ] || [ -L "$target" ]; then
  echo "already exists"
  exit 3
fi
mkdir "$target"
`

const scpShellChmodScript = `
mode=$1
target=$2
case "$mode" in
  [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) ;;
  *)
    printf 'SP_ERROR\tBAD_MODE\n'
    exit 3
    ;;
esac
if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  printf 'SP_ERROR\tNOT_FOUND\n'
  exit 4
fi
if [ -L "$target" ]; then
  printf 'SP_ERROR\tSYMLINK\n'
  exit 5
fi
chmod "$mode" "$target"
`

const scpShellRenameScript = `
old=$1
new=$2
if [ ! -e "$old" ] && [ ! -L "$old" ]; then
  echo "source missing"
  exit 3
fi
if [ -e "$new" ] || [ -L "$new" ]; then
  echo "target exists"
  exit 4
fi
mv "$old" "$new"
`

const scpShellReadTextScript = `
target=$1
if [ -d "$target" ] && [ ! -L "$target" ]; then
  echo "target is directory"
  exit 3
fi
cat "$target"
`

const scpShellInspectDeleteScript = scpShellEntryFunction + `
for target in "$@"; do
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    continue
  fi
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    find "$target" -mindepth 0 2>/dev/null | while IFS= read -r p; do
      entry=$(emit_entry "$p")
      type=$(printf '%s' "$entry" | awk -F '	' '{print $2}')
      size=$(printf '%s' "$entry" | awk -F '	' '{print $3}')
      printf 'SP_ITEM\t%s\t%s\n' "$type" "$size"
    done
  else
    entry=$(emit_entry "$target")
    type=$(printf '%s' "$entry" | awk -F '	' '{print $2}')
    size=$(printf '%s' "$entry" | awk -F '	' '{print $3}')
    printf 'SP_ITEM\t%s\t%s\n' "$type" "$size"
  fi
done
`

const scpShellDeleteScript = `
mode=$1
shift
for target in "$@"; do
  if [ "$mode" = "recursive" ]; then
    rm -rf "$target"
  else
    if [ -d "$target" ] && [ ! -L "$target" ]; then
      rmdir "$target"
    else
      rm -f "$target"
    fi
  fi
done
`
