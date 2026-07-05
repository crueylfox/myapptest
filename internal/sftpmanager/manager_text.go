package sftpmanager

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"serverpilot/internal/domain"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func (m *Manager) ReadTextFile(ctx context.Context, request domain.SFTPReadTextFileRequest) (domain.SFTPReadTextFileResult, error) {
	if err := validateRemoteTextPath(request.Path); err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath, err := normalizeSCPRequestPath(base, request.Path, false)
		if err != nil {
			return domain.SFTPReadTextFileResult{}, err
		}
		return m.scpShellReadTextFile(ctx, current, remotePath, request.MaxBytes, request.RequestID)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	if err := ctx.Err(); err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	info, err := current.client.Stat(remotePath)
	if err != nil {
		return domain.SFTPReadTextFileResult{}, m.operationErrorForSession(current, "sftp.read_text.stat", err)
	}
	if info.IsDir() {
		return domain.SFTPReadTextFileResult{}, errors.New("不能用文本查看器打开远程目录")
	}
	limit := normalizeTextPreviewLimit(request.MaxBytes)
	file, err := current.client.Open(remotePath)
	if err != nil {
		return domain.SFTPReadTextFileResult{}, m.operationErrorForSession(current, "sftp.read_text.open", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return domain.SFTPReadTextFileResult{}, m.operationErrorForSession(current, "sftp.read_text.read", err)
	}
	preview, err := buildTextPreview(remotePath, data, limit)
	if err != nil {
		return domain.SFTPReadTextFileResult{}, err
	}
	entry := fileInfoToEntry(parentRemotePath(remotePath), info)
	if info.Size() > limit {
		preview.Truncated = true
		preview.ContentHash = ""
	}
	return domain.SFTPReadTextFileResult{
		ConnectionID:     request.ConnectionID,
		ContextID:        current.contextID,
		Generation:       current.generation,
		RequestID:        request.RequestID,
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

func (m *Manager) WriteTextFile(ctx context.Context, request domain.SFTPWriteTextFileRequest) (domain.SFTPWriteTextFileResult, error) {
	return m.writeTextFileHardened(ctx, request)
}

func normalizeTextSaveMode(mode domain.SFTPTextSaveMode) domain.SFTPTextSaveMode {
	switch mode {
	case domain.SFTPTextCreateNew, domain.SFTPTextSaveAs:
		return mode
	default:
		return domain.SFTPTextSaveExisting
	}
}

func textSaveCreatesNewTarget(mode domain.SFTPTextSaveMode) bool {
	return mode == domain.SFTPTextCreateNew || mode == domain.SFTPTextSaveAs
}

func (m *Manager) writeTextFileHardened(ctx context.Context, request domain.SFTPWriteTextFileRequest) (domain.SFTPWriteTextFileResult, error) {
	if err := validateRemoteTextPath(request.Path); err != nil {
		return domain.SFTPWriteTextFileResult{}, err
	}
	saveMode := normalizeTextSaveMode(request.Mode)
	conflictPolicy := normalizeTextConflictPolicy(request.ConflictPolicy, request.ForceOverwrite, saveMode)
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPWriteTextFileResult{}, err
	}
	if request.Generation > 0 && current.generation > 0 && request.Generation != current.generation {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, request.Path, "validate_generation", "SFTP_SAVE_STALE_CONTEXT", "保存失败：文件连接上下文已过期，请重新加载后再保存。", nil, true)
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath, err := normalizeSCPRequestPath(base, request.Path, false)
		if err != nil {
			return domain.SFTPWriteTextFileResult{}, err
		}
		return m.scpShellWriteTextFile(ctx, current, request, remotePath)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	if err := ctx.Err(); err != nil {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "stat_before_save", "SFTP_SAVE_CONNECTION_CLOSED", "保存失败：连接已断开。", err, true)
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
	info, err := current.client.Stat(remotePath)
	targetExists := err == nil
	if err != nil {
		if !(textSaveCreatesNewTarget(saveMode) && isRemoteNotExistError(err)) {
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "stat_before_save", saveCodeForError(err), saveMessageForStage("stat_before_save", err), err, isRetryableSFTPError(err))
		}
	} else {
		if info.IsDir() {
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_TARGET_IS_DIR", "保存失败：目标路径是远程目录。", nil, false)
		}
		if textSaveCreatesNewTarget(saveMode) && conflictPolicy != domain.SFTPTextOverwrite {
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_CONFLICT", "目标文件已存在，是否覆盖？", nil, false)
		}
		if saveMode == domain.SFTPTextSaveExisting && conflictPolicy != domain.SFTPTextOverwrite && fileChangedSinceRead(info, request.ExpectedSize, request.ExpectedMTime) {
			technical := fmt.Errorf("expected size=%d mtime=%s, actual size=%d mtime=%s", request.ExpectedSize, request.ExpectedMTime, info.Size(), info.ModTime().UTC().Format(time.RFC3339Nano))
			return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "conflict_check", "SFTP_SAVE_CONFLICT", "远程文件似乎已被修改，是否覆盖？", technical, false)
		}
		if saveMode == domain.SFTPTextSaveExisting && conflictPolicy != domain.SFTPTextOverwrite && request.ExpectedHash != "" {
			currentHash, err := currentSFTPTextHash(current.client, remotePath)
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
	file, err := current.client.Create(tmpPath)
	if err != nil {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "create_temp_file", saveCodeForError(err), saveMessageForStage("create_temp_file", err), err, isRetryableSFTPError(err))
	}
	if err := writeAll(file, data); err != nil {
		_ = file.Close()
		m.cleanupTempFile(request.ConnectionID, current.client, tmpPath)
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "write_temp_file", saveCodeForError(err), saveMessageForStage("write_temp_file", err), err, isRetryableSFTPError(err))
	}
	if err := file.Close(); err != nil {
		m.cleanupTempFile(request.ConnectionID, current.client, tmpPath)
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "close_temp_file", saveCodeForError(err), saveMessageForStage("close_temp_file", err), err, isRetryableSFTPError(err))
	}
	mode := fs.FileMode(0o600)
	if targetExists {
		mode = info.Mode().Perm()
	}
	if mode != 0 {
		if err := current.client.Chmod(tmpPath, mode); err != nil && m.logger != nil {
			m.logger.Write("warn", "SFTP 临时文件权限继承失败，继续保存流程。", "sftp.write_text.chmod_temp_file", request.ConnectionID, err)
		}
	}
	if err := m.replaceSavedTextFile(request.ConnectionID, request.ContextID, current.client, tmpPath, remotePath, data); err != nil {
		m.cleanupTempFile(request.ConnectionID, current.client, tmpPath)
		return domain.SFTPWriteTextFileResult{}, err
	}
	nextInfo, err := current.client.Stat(remotePath)
	if err != nil {
		return domain.SFTPWriteTextFileResult{}, m.saveTextError(request.ConnectionID, request.ContextID, remotePath, "stat_after_save", saveCodeForError(err), saveMessageForStage("stat_after_save", err), err, isRetryableSFTPError(err))
	}
	return domain.SFTPWriteTextFileResult{
		ConnectionID: request.ConnectionID,
		ContextID:    current.contextID,
		Generation:   current.generation,
		RequestID:    request.RequestID,
		Path:         remotePath,
		Name:         baseRemotePath(remotePath),
		Size:         nextInfo.Size(),
		Encoding:     encoding,
		ContentHash:  hashTextBytes(data),
		Entry:        fileInfoToEntry(parentRemotePath(remotePath), nextInfo),
	}, nil
}

type saveTextFileError struct {
	Code             string `json:"code"`
	Stage            string `json:"stage"`
	UserMessage      string `json:"userMessage"`
	TechnicalMessage string `json:"technicalMessage"`
	RemotePath       string `json:"remotePath"`
	Operation        string `json:"operation"`
	Retryable        bool   `json:"retryable"`
}

func (e saveTextFileError) Error() string {
	data, err := json.Marshal(e)
	if err != nil {
		return e.UserMessage
	}
	return string(data)
}

func (m *Manager) saveTextError(connectionID int64, contextID string, remotePath, stage, code, userMessage string, err error, retryable bool) error {
	technical := ""
	if err != nil {
		technical = err.Error()
	}
	event := saveTextFileError{
		Code:             code,
		Stage:            stage,
		UserMessage:      userMessage,
		TechnicalMessage: technical,
		RemotePath:       remotePath,
		Operation:        "sftp.write_text",
		Retryable:        retryable,
	}
	m.emitError(connectionID, contextID, event.Operation+"."+stage, event.Code, event.UserMessage, event.TechnicalMessage)
	return event
}

func (m *Manager) replaceSavedTextFile(connectionID int64, contextID string, client Client, tmpPath, remotePath string, data []byte) error {
	if err := client.PosixRename(tmpPath, remotePath); err == nil {
		return nil
	}
	if err := client.Rename(tmpPath, remotePath); err == nil {
		return nil
	}
	file, err := client.OpenFile(remotePath, os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		return m.saveTextError(connectionID, contextID, remotePath, "fallback_direct_write", saveCodeForError(err), saveMessageForStage("fallback_direct_write", err), err, isRetryableSFTPError(err))
	}
	if err := writeAll(file, data); err != nil {
		_ = file.Close()
		return m.saveTextError(connectionID, contextID, remotePath, "fallback_direct_write", saveCodeForError(err), saveMessageForStage("fallback_direct_write", err), err, isRetryableSFTPError(err))
	}
	if err := file.Close(); err != nil {
		return m.saveTextError(connectionID, contextID, remotePath, "fallback_direct_write", saveCodeForError(err), saveMessageForStage("fallback_direct_write", err), err, isRetryableSFTPError(err))
	}
	m.cleanupTempFile(connectionID, client, tmpPath)
	return nil
}

func (m *Manager) cleanupTempFile(connectionID int64, client Client, tmpPath string) {
	if err := client.Remove(tmpPath); err != nil && m.logger != nil && !errors.Is(err, os.ErrNotExist) {
		m.logger.Write("warn", "清理 SFTP 临时文件失败。", "sftp.write_text.cleanup_temp_file", connectionID, err)
	}
}

func fileChangedSinceRead(info fs.FileInfo, expectedSize int64, expectedMTime string) bool {
	if expectedSize >= 0 && info.Size() != expectedSize {
		return true
	}
	if expectedMTime == "" {
		return false
	}
	expected, err := time.Parse(time.RFC3339Nano, expectedMTime)
	if err != nil {
		return true
	}
	return info.ModTime().UTC().Unix() != expected.UTC().Unix()
}

func tempSavePath(remotePath string) string {
	name := baseRemotePath(remotePath)
	if name == "" || name == "." || name == "/" {
		name = "file"
	}
	return joinRemotePath(parentRemotePath(remotePath), fmt.Sprintf(".serverpilot-save-%s-%s.tmp", name, randomID()))
}

func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := writer.Write(data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func bytesContainNUL(data []byte) bool {
	for _, b := range data {
		if b == 0 {
			return true
		}
	}
	return false
}

type textPreview struct {
	Content     string
	Encoding    string
	ContentHash string
	Language    string
	Truncated   bool
}

func normalizeTextPreviewLimit(limit int64) int64 {
	if limit <= 0 || limit > defaultTextPreviewLimit {
		return defaultTextPreviewLimit
	}
	return limit
}

func validateRemoteTextPath(remotePath string) error {
	if strings.TrimSpace(remotePath) == "" {
		return errors.New("远程路径不能为空")
	}
	if strings.ContainsAny(remotePath, "\x00\r\n") {
		return errors.New("远程路径包含非法控制字符")
	}
	return nil
}

func buildTextPreview(remotePath string, data []byte, limit int64) (textPreview, error) {
	preview := textPreview{Encoding: "utf-8", Language: "generic"}
	fullData := data
	if int64(len(data)) > limit {
		preview.Truncated = true
		data = data[:limit]
	}
	content, encoding, err := decodeTextBytes(data)
	if err != nil {
		return textPreview{}, err
	}
	preview.Content = content
	preview.Encoding = encoding
	if !preview.Truncated {
		preview.ContentHash = hashTextBytes(fullData)
	}
	preview.Language = detectTextLanguage(remotePath, content)
	return preview, nil
}

func decodeTextBytes(data []byte) (string, string, error) {
	if len(data) == 0 {
		return "", "utf-8", nil
	}
	if hasUTF8BOM(data) {
		data = data[3:]
		if !utf8.Valid(data) {
			return "", "", errors.New("文件不是有效 UTF-8 文本")
		}
		return string(trimInvalidUTF8Tail(data)), "utf-8-bom", nil
	}
	if hasUTF16LEBOM(data) {
		return decodeUTF16(data[2:], true), "utf-16le", nil
	}
	if hasUTF16BEBOM(data) {
		return decodeUTF16(data[2:], false), "utf-16be", nil
	}
	if bytesContainNUL(data) || binaryControlRatio(data) > 0.10 {
		return "", "", errors.New("该文件不是明文或包含二进制内容")
	}
	if utf8.Valid(data) {
		return string(trimInvalidUTF8Tail(data)), "utf-8", nil
	}
	decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(data)
	if err == nil && utf8.Valid(decoded) && !strings.ContainsRune(string(decoded), utf8.RuneError) {
		return string(decoded), "gb18030", nil
	}
	return "", "", errors.New("文件不是支持的文本编码")
}

func normalizeTextEncoding(encoding string) string {
	value := strings.ToLower(strings.TrimSpace(encoding))
	switch value {
	case "", "utf8":
		return "utf-8"
	case "utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gb18030":
		return value
	default:
		return value
	}
}

func encodeTextContent(content string, encoding string) ([]byte, string, error) {
	normalized := normalizeTextEncoding(encoding)
	switch normalized {
	case "utf-8":
		return []byte(content), normalized, nil
	case "utf-8-bom":
		data := append([]byte{0xef, 0xbb, 0xbf}, []byte(content)...)
		return data, normalized, nil
	case "utf-16le":
		return encodeUTF16WithBOM(content, true), normalized, nil
	case "utf-16be":
		return encodeUTF16WithBOM(content, false), normalized, nil
	case "gb18030":
		data, err := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(content))
		if err != nil {
			return nil, normalized, errors.New("保存失败：该编码暂不支持编辑保存。")
		}
		return data, normalized, nil
	default:
		return nil, normalized, errors.New("保存失败：该编码暂不支持编辑保存。")
	}
}

func encodeUTF16WithBOM(content string, littleEndian bool) []byte {
	units := utf16.Encode([]rune(content))
	data := make([]byte, 0, 2+len(units)*2)
	if littleEndian {
		data = append(data, 0xff, 0xfe)
		for _, unit := range units {
			data = append(data, byte(unit), byte(unit>>8))
		}
		return data
	}
	data = append(data, 0xfe, 0xff)
	for _, unit := range units {
		data = append(data, byte(unit>>8), byte(unit))
	}
	return data
}

func hashTextBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func currentSFTPTextHash(client Client, remotePath string) (string, error) {
	file, err := client.Open(remotePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, defaultTextEditorLimit+1))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > defaultTextEditorLimit {
		return "", errors.New("远程文件已超过当前文本编辑器保存上限")
	}
	return hashTextBytes(data), nil
}

func hasUTF8BOM(data []byte) bool {
	return len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf
}

func hasUTF16LEBOM(data []byte) bool {
	return len(data) >= 2 && data[0] == 0xff && data[1] == 0xfe
}

func hasUTF16BEBOM(data []byte) bool {
	return len(data) >= 2 && data[0] == 0xfe && data[1] == 0xff
}

func decodeUTF16(data []byte, littleEndian bool) string {
	if len(data)%2 == 1 {
		data = data[:len(data)-1]
	}
	units := make([]uint16, 0, len(data)/2)
	for index := 0; index+1 < len(data); index += 2 {
		if littleEndian {
			units = append(units, uint16(data[index])|uint16(data[index+1])<<8)
		} else {
			units = append(units, uint16(data[index])<<8|uint16(data[index+1]))
		}
	}
	return string(utf16.Decode(units))
}

func trimInvalidUTF8Tail(data []byte) []byte {
	for len(data) > 0 && !utf8.Valid(data) {
		data = data[:len(data)-1]
	}
	return data
}

func binaryControlRatio(data []byte) float64 {
	if len(data) == 0 {
		return 0
	}
	controls := 0
	for _, b := range data {
		if b < 0x20 && b != '\t' && b != '\n' && b != '\r' {
			controls++
		}
		if b == 0x7f {
			controls++
		}
	}
	if controls < 8 {
		return 0
	}
	return float64(controls) / float64(len(data))
}

func detectTextLanguage(remotePath string, content string) string {
	lowerName := strings.ToLower(baseRemotePath(remotePath))
	lowerPath := strings.ToLower(remotePath)
	trimmed := strings.TrimSpace(content)
	switch {
	case lowerName == "dockerfile" || strings.HasSuffix(lowerName, ".dockerfile"):
		return "dockerfile"
	case strings.HasSuffix(lowerName, ".sh") || strings.HasSuffix(lowerName, ".bash") || strings.HasSuffix(lowerName, ".zsh") || strings.HasSuffix(lowerName, ".fish") || strings.HasPrefix(trimmed, "#!/bin/sh") || strings.HasPrefix(trimmed, "#!/usr/bin/env bash"):
		return "shell"
	case strings.HasSuffix(lowerName, ".json") || strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") || strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]"):
		return "json"
	case strings.HasSuffix(lowerName, ".yaml") || strings.HasSuffix(lowerName, ".yml"):
		return "yaml"
	case strings.HasSuffix(lowerName, ".toml"):
		return "toml"
	case strings.HasSuffix(lowerName, ".ini") || strings.HasSuffix(lowerName, ".env") || strings.HasSuffix(lowerName, ".properties"):
		return "ini"
	case strings.HasSuffix(lowerName, ".service") || strings.Contains(lowerPath, "/systemd/"):
		return "systemd"
	case strings.HasSuffix(lowerName, ".conf") && strings.Contains(lowerPath, "nginx"):
		return "nginx"
	case strings.HasSuffix(lowerName, ".conf") || strings.HasSuffix(lowerName, ".config"):
		return "conf"
	case strings.HasSuffix(lowerName, ".log") || strings.Contains(trimmed, "ERROR") || strings.Contains(trimmed, "WARN"):
		return "log"
	case strings.HasSuffix(lowerName, ".md") || strings.HasSuffix(lowerName, ".markdown"):
		return "markdown"
	case strings.HasSuffix(lowerName, ".xml"):
		return "xml"
	case strings.HasSuffix(lowerName, ".html") || strings.HasSuffix(lowerName, ".htm"):
		return "html"
	case strings.HasSuffix(lowerName, ".css"):
		return "css"
	case strings.HasSuffix(lowerName, ".js") || strings.HasSuffix(lowerName, ".mjs") || strings.HasSuffix(lowerName, ".cjs"):
		return "javascript"
	case strings.HasSuffix(lowerName, ".ts"):
		return "typescript"
	case strings.HasSuffix(lowerName, ".go"):
		return "go"
	case strings.HasSuffix(lowerName, ".py"):
		return "python"
	case strings.HasSuffix(lowerName, ".sql"):
		return "sql"
	default:
		return "generic"
	}
}

func formatByteLimit(limit int64) string {
	if limit >= 1024*1024 {
		return fmt.Sprintf("%d MB", limit/(1024*1024))
	}
	if limit >= 1024 {
		return fmt.Sprintf("%d KB", limit/1024)
	}
	return fmt.Sprintf("%d 字节", limit)
}
