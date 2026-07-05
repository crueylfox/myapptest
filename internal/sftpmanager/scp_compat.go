package sftpmanager

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

func (m *Manager) scpUploadFile(current *session, request domain.SFTPTransferRequest, info fs.FileInfo) (domain.SFTPTransferState, error) {
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.RemotePath)
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return domain.SFTPTransferState{}, err
	}
	resolvedPath, skipped, err := m.resolveSCPRemoteConflict(current.ctx, current, remotePath, request.ConflictPolicy)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	if skipped {
		return m.skippedTransfer(request, domain.SFTPTransferUpload, domain.SFTPModeSCP, remotePath, info.Size()), nil
	}
	request.RemotePath = resolvedPath
	return m.startTransfer(current, domain.SFTPTransferUpload, request, info.Size(), baseRemotePath(resolvedPath), sftpSourceTypeFile, false), nil
}

func (m *Manager) scpDownloadFile(current *session, request domain.SFTPTransferRequest) (domain.SFTPTransferState, error) {
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.RemotePath)
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return domain.SFTPTransferState{}, err
	}
	localPath := strings.TrimSpace(request.LocalPath)
	if localPath == "" {
		return domain.SFTPTransferState{}, errors.New("请选择本地保存目录")
	}
	if localInfo, err := os.Stat(localPath); err == nil && localInfo.IsDir() {
		localPath = filepath.Join(localPath, safeDownloadRootName(remotePath))
	}
	resolvedPath, skipped, err := resolveLocalConflict(localPath, request.ConflictPolicy)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	if skipped {
		request.LocalPath = localPath
		return m.skippedTransfer(request, domain.SFTPTransferDownload, domain.SFTPModeSCP, remotePath, 0), nil
	}
	request.LocalPath = resolvedPath
	request.RemotePath = remotePath
	return m.startTransfer(current, domain.SFTPTransferDownload, request, 0, baseRemotePath(remotePath), sftpSourceTypeFile, false), nil
}

func (m *Manager) scpUploadDirectory(current *session, request domain.SFTPUploadDirectoryRequest, remoteRoot string) (domain.SFTPTransferState, error) {
	if err := validateSCPRemoteTarget(remoteRoot); err != nil {
		return domain.SFTPTransferState{}, err
	}
	resolvedRoot, skipped, err := m.resolveSCPDirectoryRoot(current.ctx, current, remoteRoot, request.ConflictPolicy)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	transferRequest := domain.SFTPTransferRequest{
		ConnectionID:      request.ConnectionID,
		ContextID:         request.ContextID,
		TerminalSessionID: request.TerminalSessionID,
		LocalPath:         request.LocalPath,
		RemotePath:        resolvedRoot,
		ConflictPolicy:    request.ConflictPolicy,
	}
	if skipped {
		state := m.skippedTransfer(transferRequest, domain.SFTPTransferUpload, domain.SFTPModeSCP, remoteRoot, 0)
		state.SourceType = sftpSourceTypeDirectory
		state.Recursive = true
		return state, nil
	}
	return m.startTransfer(current, domain.SFTPTransferUpload, transferRequest, 0, baseRemotePath(resolvedRoot), sftpSourceTypeDirectory, true), nil
}

func (m *Manager) scpDownloadDirectory(current *session, request domain.SFTPDownloadDirectoryRequest) (domain.SFTPTransferState, error) {
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.RemotePath)
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return domain.SFTPTransferState{}, err
	}
	if strings.TrimSpace(request.LocalDirectory) == "" {
		return domain.SFTPTransferState{}, errors.New("请选择本地保存目录")
	}
	localRoot := filepath.Join(filepath.Clean(request.LocalDirectory), safeDownloadRootName(remotePath))
	if err := ensureLocalDescendant(request.LocalDirectory, localRoot); err != nil {
		return domain.SFTPTransferState{}, err
	}
	resolvedRoot, skipped, err := resolveLocalConflictNoSymlink(localRoot, request.ConflictPolicy)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	transferRequest := domain.SFTPTransferRequest{
		ConnectionID:      request.ConnectionID,
		ContextID:         request.ContextID,
		TerminalSessionID: request.TerminalSessionID,
		LocalPath:         resolvedRoot,
		RemotePath:        remotePath,
		ConflictPolicy:    request.ConflictPolicy,
	}
	if skipped {
		state := m.skippedTransfer(transferRequest, domain.SFTPTransferDownload, domain.SFTPModeSCP, remotePath, 0)
		state.SourceType = sftpSourceTypeDirectory
		state.Recursive = true
		return state, nil
	}
	return m.startTransfer(current, domain.SFTPTransferDownload, transferRequest, 0, baseRemotePath(remotePath), sftpSourceTypeDirectory, true), nil
}

func (m *Manager) runSCPUpload(ctx context.Context, current *session, item *transfer) error {
	item.mu.RLock()
	state := item.state
	item.mu.RUnlock()
	return runSCPUploadFile(ctx, current.transport, state.LocalPath, state.RemotePath, baseRemotePath(state.RemotePath), state.TotalBytes, func(done int64, speed float64) {
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.TransferredBytes = done
			state.SpeedBytesPerSecond = speed
			if state.TotalBytes > 0 {
				state.Percent = float64(done) * 100 / float64(state.TotalBytes)
			}
		})
	})
}

func (m *Manager) runSCPDownload(ctx context.Context, current *session, item *transfer) error {
	item.mu.RLock()
	state := item.state
	policy := item.conflictPolicy
	item.mu.RUnlock()
	return runSCPDownloadFile(ctx, current.transport, state.RemotePath, state.LocalPath, policy, func(total int64) {
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.TotalBytes = total
		})
	}, func(done int64, speed float64) {
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.TransferredBytes = done
			state.SpeedBytesPerSecond = speed
			if state.TotalBytes > 0 {
				state.Percent = float64(done) * 100 / float64(state.TotalBytes)
			}
		})
	})
}

func (m *Manager) runSCPDirectoryUpload(ctx context.Context, current *session, item *transfer) error {
	item.mu.RLock()
	state := item.state
	policy := item.conflictPolicy
	item.mu.RUnlock()
	plan, err := PlanRecursiveUpload(ctx, state.LocalPath, parentRemotePath(state.RemotePath))
	if err != nil {
		return err
	}
	plan, err = rebaseRecursivePlanRemoteRoot(plan, state.RemotePath)
	if err != nil {
		return err
	}
	m.applyRecursivePlan(item, plan)
	for _, directory := range plan.Directories {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := m.ensureSCPRemoteDirectory(ctx, current, directory.RemotePath); err != nil {
			m.incrementTransferFailure(item, directory.RelativePath, err, false)
		}
	}
	started := time.Now()
	var bytesDone int64
	for _, file := range plan.Files {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := m.waitIfPaused(ctx, item, -1, func() error { return nil }); err != nil {
			return err
		}
		m.setTransferCurrentFile(item, file.RelativePath)
		remotePath, skipped, err := m.resolveSCPRemoteConflict(ctx, current, file.RemotePath, policy)
		if err != nil {
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		if skipped {
			m.incrementTransferSkipped(item, file.RelativePath, true)
			continue
		}
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.CurrentFileBytesTotal = file.Size
			state.CurrentFileBytesDone = 0
			state.ResumeOffset = 0
		})
		err = runSCPUploadFile(ctx, current.transport, file.LocalPath, remotePath, baseRemotePath(remotePath), file.Size, func(done int64, _ float64) {
			m.updateRecursiveBytes(item, bytesDone+done, started)
			m.updateTransfer(item, func(state *domain.SFTPTransferState) {
				state.CurrentFileBytesDone = done
				state.ResumeOffset = done
			})
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return context.Canceled
			}
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		written := file.Size
		bytesDone += written
		m.finishTransferFile(item, file.RelativePath, bytesDone, started)
	}
	m.setTransferCurrentFile(item, "")
	return nil
}

func (m *Manager) runSCPDirectoryDownload(ctx context.Context, current *session, item *transfer) error {
	item.mu.RLock()
	state := item.state
	policy := item.conflictPolicy
	item.mu.RUnlock()
	plan, err := m.planSCPRecursiveDownload(ctx, current, state.RemotePath, state.LocalPath)
	if err != nil {
		return err
	}
	m.applyRecursivePlan(item, plan)
	for _, directory := range plan.Directories {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := ensureNoSymlinkInPath(state.LocalPath, directory.LocalPath); err != nil {
			m.incrementTransferFailure(item, directory.RelativePath, err, false)
			continue
		}
		if err := os.MkdirAll(directory.LocalPath, 0o755); err != nil {
			m.incrementTransferFailure(item, directory.RelativePath, err, false)
		}
	}
	started := time.Now()
	var bytesDone int64
	for _, file := range plan.Files {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := m.waitIfPaused(ctx, item, -1, func() error { return nil }); err != nil {
			return err
		}
		m.setTransferCurrentFile(item, file.RelativePath)
		if err := ensureNoSymlinkInPath(state.LocalPath, filepath.Dir(file.LocalPath)); err != nil {
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		localPath, skipped, err := resolveLocalConflictNoSymlink(file.LocalPath, policy)
		if err != nil {
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		if skipped {
			m.incrementTransferSkipped(item, file.RelativePath, true)
			continue
		}
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.CurrentFileBytesTotal = file.Size
			state.CurrentFileBytesDone = 0
			state.ResumeOffset = 0
		})
		err = runSCPDownloadFile(ctx, current.transport, file.RemotePath, localPath, domain.SFTPConflictOverwrite, func(int64) {}, func(done int64, _ float64) {
			m.updateRecursiveBytes(item, bytesDone+done, started)
			m.updateTransfer(item, func(state *domain.SFTPTransferState) {
				state.CurrentFileBytesDone = done
				state.ResumeOffset = done
			})
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return context.Canceled
			}
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		written := file.Size
		bytesDone += written
		m.finishTransferFile(item, file.RelativePath, bytesDone, started)
	}
	m.setTransferCurrentFile(item, "")
	return nil
}

func runSCPUploadFile(
	ctx context.Context,
	transport Transport,
	localPath string,
	remotePath string,
	recordName string,
	total int64,
	update func(int64, float64),
) error {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return err
	}
	recordName, err := safeSCPRecordName(recordName)
	if err != nil {
		return err
	}
	command, err := transport.StartCommand(ctx, "scp -t "+shellQuote(remotePath))
	if err != nil {
		return err
	}
	defer command.Close()
	stdin := command.Stdin()
	reader := bufio.NewReader(command.Stdout())
	if err := readSCPAck(reader); err != nil {
		return err
	}
	written, err := sendSCPFile(ctx, stdin, reader, localPath, recordName, total, updateBytesSpeed(total, update))
	if err != nil {
		_ = stdin.Close()
		return err
	}
	_ = written
	if err := stdin.Close(); err != nil {
		return err
	}
	if err := command.Wait(); err != nil {
		return scpUserError(err)
	}
	return nil
}

func sendSCPFile(
	ctx context.Context,
	stdin io.Writer,
	reader *bufio.Reader,
	localPath string,
	recordName string,
	size int64,
	update func(int64),
) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	source, err := os.Open(localPath)
	if err != nil {
		return 0, fmt.Errorf("打开本地文件失败: %w", err)
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return 0, fmt.Errorf("读取本地文件状态失败: %w", err)
	}
	if size < 0 {
		size = info.Size()
	}
	if err := writeSCPControl(stdin, fmt.Sprintf("C%04o %d %s\n", modePerm(info.Mode(), 0o644), size, recordName)); err != nil {
		return 0, err
	}
	if err := readSCPAck(reader); err != nil {
		return 0, err
	}
	written, err := copyWithProgressCount(ctx, stdin, source, size, update)
	if err != nil {
		return written, err
	}
	if _, err := stdin.Write([]byte{0}); err != nil {
		return written, err
	}
	if err := readSCPAck(reader); err != nil {
		return written, err
	}
	return written, nil
}

func runSCPDownloadFile(
	ctx context.Context,
	transport Transport,
	remotePath string,
	localPath string,
	policy domain.SFTPConflictPolicy,
	setTotal func(int64),
	update func(int64, float64),
) error {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return fmt.Errorf("创建本地目录失败: %w", err)
	}
	command, err := transport.StartCommand(ctx, "scp -f "+shellQuote(remotePath))
	if err != nil {
		return err
	}
	defer command.Close()
	stdin := command.Stdin()
	reader := bufio.NewReader(command.Stdout())
	if _, err := stdin.Write([]byte{0}); err != nil {
		return err
	}
	started := time.Now()
	for {
		record, err := readSCPRecord(reader)
		if err != nil {
			return err
		}
		if record.kind == 'T' {
			if _, err := stdin.Write([]byte{0}); err != nil {
				return err
			}
			continue
		}
		if record.kind != 'C' {
			return fmt.Errorf("SCP 返回了非文件记录")
		}
		if _, err := safeSCPRecordName(record.name); err != nil {
			return err
		}
		setTotal(record.size)
		if _, err := stdin.Write([]byte{0}); err != nil {
			return err
		}
		if err := receiveSCPFileData(ctx, reader, stdin, localPath, record.size, policy, updateBytesSpeed(record.size, update, started)); err != nil {
			return err
		}
		break
	}
	if err := command.Wait(); err != nil {
		return scpUserError(err)
	}
	return nil
}

func receiveSCPFileData(
	ctx context.Context,
	reader *bufio.Reader,
	stdin io.Writer,
	localPath string,
	size int64,
	policy domain.SFTPConflictPolicy,
	update func(int64),
) error {
	targetPath, skipped, err := resolveLocalConflictNoSymlink(localPath, policy)
	if err != nil {
		return err
	}
	var target io.Writer
	var file *os.File
	if skipped {
		target = io.Discard
	} else {
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return fmt.Errorf("创建本地目录失败: %w", err)
		}
		file, err = os.Create(targetPath)
		if err != nil {
			return fmt.Errorf("创建本地文件失败: %w", err)
		}
		target = file
	}
	written, copyErr := copyNWithProgress(ctx, target, reader, size, update)
	if file != nil {
		closeErr := file.Close()
		if copyErr == nil {
			copyErr = closeErr
		}
	}
	if copyErr != nil {
		return copyErr
	}
	if written != size {
		return io.ErrUnexpectedEOF
	}
	if err := readSCPAck(reader); err != nil {
		return err
	}
	_, err = stdin.Write([]byte{0})
	return err
}

type scpRecord struct {
	kind byte
	mode int64
	size int64
	name string
}

func readSCPRecord(reader *bufio.Reader) (scpRecord, error) {
	first, err := reader.ReadByte()
	if err != nil {
		return scpRecord{}, err
	}
	if first == 1 || first == 2 {
		message, _ := reader.ReadString('\n')
		return scpRecord{}, fmt.Errorf("SCP 远端错误: %s", sanitizeError(errors.New(strings.TrimSpace(message))))
	}
	if first == 0 {
		return scpRecord{}, errors.New("SCP 协议返回了意外确认字节")
	}
	rest, err := reader.ReadString('\n')
	if err != nil {
		return scpRecord{}, err
	}
	line := strings.TrimRight(string(append([]byte{first}, []byte(rest)...)), "\r\n")
	if line == "E" {
		return scpRecord{kind: 'E'}, nil
	}
	if strings.HasPrefix(line, "T") {
		return scpRecord{kind: 'T'}, nil
	}
	if len(line) < 2 || (line[0] != 'C' && line[0] != 'D') {
		return scpRecord{}, fmt.Errorf("未知 SCP 记录")
	}
	parts := strings.SplitN(line[1:], " ", 3)
	if len(parts) != 3 {
		return scpRecord{}, fmt.Errorf("SCP 记录格式无效")
	}
	mode, err := strconv.ParseInt(parts[0], 8, 64)
	if err != nil {
		return scpRecord{}, fmt.Errorf("SCP 权限格式无效")
	}
	size, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || size < 0 {
		return scpRecord{}, fmt.Errorf("SCP 文件大小无效")
	}
	name, err := safeSCPRecordName(parts[2])
	if err != nil {
		return scpRecord{}, err
	}
	return scpRecord{kind: line[0], mode: mode, size: size, name: name}, nil
}

func readSCPAck(reader *bufio.Reader) error {
	value, err := reader.ReadByte()
	if err != nil {
		return err
	}
	if value == 0 {
		return nil
	}
	message, _ := reader.ReadString('\n')
	message = strings.TrimSpace(message)
	if message == "" {
		message = "远端 SCP 返回错误"
	}
	return fmt.Errorf("SCP 远端错误: %s", sanitizeError(errors.New(message)))
}

func writeSCPControl(writer io.Writer, line string) error {
	if _, err := io.WriteString(writer, line); err != nil {
		return err
	}
	return nil
}

func copyNWithProgress(ctx context.Context, dst io.Writer, src io.Reader, size int64, update func(int64)) (int64, error) {
	buffer := make([]byte, transferBufferSize)
	var written int64
	lastEmit := time.Now()
	for written < size {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		remaining := size - written
		chunk := buffer
		if remaining < int64(len(chunk)) {
			chunk = chunk[:remaining]
		}
		n, readErr := src.Read(chunk)
		if n > 0 {
			if _, writeErr := dst.Write(chunk[:n]); writeErr != nil {
				return written, writeErr
			}
			written += int64(n)
			if time.Since(lastEmit) >= 200*time.Millisecond || written == size {
				update(written)
				lastEmit = time.Now()
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) && written == size {
				break
			}
			return written, readErr
		}
	}
	update(written)
	return written, nil
}

func updateBytesSpeed(total int64, update func(int64, float64), started ...time.Time) func(int64) {
	base := time.Now()
	if len(started) > 0 {
		base = started[0]
	}
	return func(done int64) {
		elapsed := time.Since(base).Seconds()
		speed := 0.0
		if elapsed > 0 {
			speed = float64(done) / elapsed
		}
		_ = total
		update(done, speed)
	}
}

func modePerm(mode fs.FileMode, fallback fs.FileMode) fs.FileMode {
	perm := mode.Perm()
	if perm == 0 {
		return fallback
	}
	return perm
}

func safeSCPRecordName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "", errors.New("SCP 文件名不安全")
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.ContainsAny(name, "\r\n\x00") {
		return "", errors.New("SCP 文件名不安全")
	}
	return name, nil
}

func validateSCPRemoteTarget(remotePath string) error {
	if hasParentTraversal(remotePath) {
		return errors.New("SCP 远程路径不能包含 ..")
	}
	remotePath = cleanRemotePath(remotePath)
	if remotePath == "" || remotePath == "." || remotePath == "/" || remotePath == ".." {
		return errors.New("SCP 远程路径不能为根目录或保留路径")
	}
	return nil
}

func shellQuote(value string) string {
	return QuotePOSIXArg(value)
}

func (m *Manager) resolveSCPDirectoryRoot(
	ctx context.Context,
	current *session,
	remoteRoot string,
	policy domain.SFTPConflictPolicy,
) (string, bool, error) {
	if policy == "" {
		policy = domain.SFTPConflictAsk
	}
	exists, err := scpRemoteExists(ctx, current.transport, remoteRoot)
	if err != nil {
		return "", false, err
	}
	if !exists {
		return remoteRoot, false, nil
	}
	entry, err := m.scpShellStat(ctx, current, remoteRoot)
	if err != nil {
		return "", false, err
	}
	if entry.IsDir && !entry.IsSymlink {
		return remoteRoot, false, nil
	}
	switch policy {
	case domain.SFTPConflictSkip:
		return remoteRoot, true, nil
	case domain.SFTPConflictRename:
		for index := 1; index < 1000; index++ {
			candidate := remoteRenameCandidate(remoteRoot, index)
			exists, err := scpRemoteExists(ctx, current.transport, candidate)
			if err != nil {
				return "", false, err
			}
			if !exists {
				return candidate, false, nil
			}
		}
		return "", false, errors.New("无法生成可用的远程目录名")
	default:
		return "", false, errors.New("远程目标路径已存在且不是目录")
	}
}

func (m *Manager) ensureSCPRemoteDirectory(ctx context.Context, current *session, remotePath string) error {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return err
	}
	exists, err := scpRemoteExists(ctx, current.transport, remotePath)
	if err != nil {
		return err
	}
	if !exists {
		return m.scpShellMkdir(ctx, current, remotePath)
	}
	entry, err := m.scpShellStat(ctx, current, remotePath)
	if err != nil {
		return err
	}
	if entry.IsDir && !entry.IsSymlink {
		return nil
	}
	return errors.New("远程目标路径已存在且不是目录")
}

func (m *Manager) planSCPRecursiveDownload(
	ctx context.Context,
	current *session,
	remoteRoot string,
	localRoot string,
) (RecursiveTransferPlan, error) {
	if err := validateSCPRemoteTarget(remoteRoot); err != nil {
		return RecursiveTransferPlan{}, err
	}
	localRoot = filepath.Clean(strings.TrimSpace(localRoot))
	if localRoot == "" || localRoot == "." {
		return RecursiveTransferPlan{}, errors.New("请选择本地保存目录")
	}
	if abs, err := filepath.Abs(localRoot); err == nil {
		localRoot = abs
	}
	rootInfo, err := m.scpShellStat(ctx, current, remoteRoot)
	if err != nil {
		return RecursiveTransferPlan{}, fmt.Errorf("扫描远程目录失败: %w", err)
	}
	if rootInfo.IsSymlink {
		return RecursiveTransferPlan{}, errors.New("暂不支持下载符号链接目录")
	}
	if !rootInfo.IsDir {
		return RecursiveTransferPlan{}, errors.New("请选择远程目录")
	}
	localDirectory := filepath.Dir(localRoot)
	if err := ensureLocalDescendant(localDirectory, localRoot); err != nil {
		return RecursiveTransferPlan{}, err
	}
	plan := RecursiveTransferPlan{
		Directories: []RecursivePlanEntry{{
			RelativePath: ".",
			LocalPath:    localRoot,
			RemotePath:   remoteRoot,
		}},
	}
	if err := m.planSCPRemoteDirectory(ctx, current, remoteRoot, localRoot, ".", &plan); err != nil {
		return RecursiveTransferPlan{}, err
	}
	return plan, nil
}

func rebaseRecursivePlanRemoteRoot(plan RecursiveTransferPlan, remoteRoot string) (RecursiveTransferPlan, error) {
	if err := validateSCPRemoteTarget(remoteRoot); err != nil {
		return RecursiveTransferPlan{}, err
	}
	for index := range plan.Directories {
		remotePath, err := uploadRemotePath(remoteRoot, plan.Directories[index].RelativePath)
		if err != nil {
			return RecursiveTransferPlan{}, err
		}
		plan.Directories[index].RemotePath = remotePath
	}
	for index := range plan.Files {
		remotePath, err := uploadRemotePath(remoteRoot, plan.Files[index].RelativePath)
		if err != nil {
			return RecursiveTransferPlan{}, err
		}
		plan.Files[index].RemotePath = remotePath
	}
	return plan, nil
}

func (m *Manager) planSCPRemoteDirectory(
	ctx context.Context,
	current *session,
	remotePath string,
	localPath string,
	relativePath string,
	plan *RecursiveTransferPlan,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	result, err := m.scpShellList(ctx, current, remotePath)
	if err != nil {
		return fmt.Errorf("扫描远程目录失败: %w", err)
	}
	for _, entry := range result.Entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		name := entry.Name
		if unsafeSCPEntryName(name) {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不安全远程名称", name, nil))
			plan.SkippedCount++
			continue
		}
		childRemote := joinRemotePath(remotePath, name)
		childRelative := joinRelativePath(relativePath, name)
		childLocal, err := safeLocalJoin(localPath, name)
		if err != nil {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不安全本地目标", name, err))
			plan.SkippedCount++
			continue
		}
		if entry.IsSymlink {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过远程符号链接", childRemote, nil))
			plan.SkippedCount++
			continue
		}
		if entry.IsDir {
			plan.Directories = append(plan.Directories, RecursivePlanEntry{
				RelativePath: childRelative,
				LocalPath:    childLocal,
				RemotePath:   childRemote,
			})
			if err := m.planSCPRemoteDirectory(ctx, current, childRemote, childLocal, childRelative, plan); err != nil {
				plan.Warnings = append(plan.Warnings, safePathWarning("跳过不可读取远程目录", childRemote, err))
				plan.SkippedCount++
			}
			continue
		}
		plan.Files = append(plan.Files, RecursivePlanEntry{
			RelativePath: childRelative,
			LocalPath:    childLocal,
			RemotePath:   childRemote,
			Size:         entry.Size,
		})
		plan.TotalBytes += entry.Size
	}
	return nil
}

func unsafeSCPEntryName(name string) bool {
	name = strings.TrimSpace(name)
	return name == "" ||
		name == "." ||
		name == ".." ||
		strings.Contains(name, "/") ||
		strings.Contains(name, "\\") ||
		strings.ContainsAny(name, "\x00\r\n")
}

func (m *Manager) resolveSCPRemoteConflict(
	ctx context.Context,
	current *session,
	remotePath string,
	policy domain.SFTPConflictPolicy,
) (string, bool, error) {
	if policy == "" {
		policy = domain.SFTPConflictAsk
	}
	exists, err := scpRemoteExists(ctx, current.transport, remotePath)
	if err != nil {
		return "", false, err
	}
	if !exists {
		return remotePath, false, nil
	}
	switch policy {
	case domain.SFTPConflictOverwrite:
		return remotePath, false, nil
	case domain.SFTPConflictSkip:
		return remotePath, true, nil
	case domain.SFTPConflictRename:
		for index := 1; index < 1000; index++ {
			candidate := remoteRenameCandidate(remotePath, index)
			exists, err := scpRemoteExists(ctx, current.transport, candidate)
			if err != nil {
				return "", false, err
			}
			if !exists {
				return candidate, false, nil
			}
		}
		return "", false, errors.New("无法生成可用的远程重命名文件名")
	default:
		return "", false, errors.New("远程文件已存在")
	}
}

func scpRemoteExists(ctx context.Context, transport Transport, remotePath string) (bool, error) {
	if err := validateSCPRemoteTarget(remotePath); err != nil {
		return false, err
	}
	command, err := transport.StartCommand(ctx, "test -e "+shellQuote(remotePath))
	if err != nil {
		return false, err
	}
	defer command.Close()
	err = command.Wait()
	if err != nil {
		return false, nil
	}
	return true, nil
}

func scpUserError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("SCP 传输失败: %w", err)
}
