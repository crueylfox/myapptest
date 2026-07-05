package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"serverpilot/internal/domain"
	"strings"
	"time"
)

func (m *Manager) Upload(request domain.SFTPTransferRequest) (domain.SFTPTransferState, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	info, err := os.Stat(request.LocalPath)
	if err != nil {
		return domain.SFTPTransferState{}, fmt.Errorf("本地文件不可读取: %w", err)
	}
	if info.IsDir() {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath := resolveRemotePath(base, request.RemotePath)
		return m.uploadDirectory(current, domain.SFTPUploadDirectoryRequest{
			ConnectionID:      request.ConnectionID,
			ContextID:         request.ContextID,
			TerminalSessionID: request.TerminalSessionID,
			LocalPath:         request.LocalPath,
			RemoteDirectory:   parentRemotePath(remotePath),
			ConflictPolicy:    request.ConflictPolicy,
		})
	}
	if current.mode == domain.SFTPModeSCP {
		return m.scpUploadFile(current, request, info)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.RemotePath)
	resolvedPath, skipped, err := m.resolveRemoteConflict(current.client, remotePath, request.ConflictPolicy)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	if skipped {
		return m.skippedTransfer(request, domain.SFTPTransferUpload, current.mode, remotePath, info.Size()), nil
	}
	request.RemotePath = resolvedPath
	return m.startTransfer(current, domain.SFTPTransferUpload, request, info.Size(), baseRemotePath(resolvedPath), sftpSourceTypeFile, false), nil
}

func (m *Manager) Download(request domain.SFTPTransferRequest) (domain.SFTPTransferState, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		return m.scpDownloadFile(current, request)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.RemotePath)
	info, err := current.client.Stat(remotePath)
	if err != nil {
		return domain.SFTPTransferState{}, m.operationErrorForSession(current, "sftp.download.stat", err)
	}
	if info.IsDir() {
		return domain.SFTPTransferState{}, errors.New("暂不支持下载远程文件夹")
	}
	localPath := request.LocalPath
	if localPath == "" {
		return domain.SFTPTransferState{}, errors.New("请选择本地保存目录")
	}
	if localInfo, err := os.Stat(localPath); err == nil && localInfo.IsDir() {
		localPath = filepath.Join(localPath, baseRemotePath(remotePath))
	}
	resolvedPath, skipped, err := resolveLocalConflict(localPath, request.ConflictPolicy)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	if skipped {
		request.LocalPath = localPath
		return m.skippedTransfer(request, domain.SFTPTransferDownload, current.mode, remotePath, info.Size()), nil
	}
	request.LocalPath = resolvedPath
	request.RemotePath = remotePath
	return m.startTransfer(current, domain.SFTPTransferDownload, request, info.Size(), baseRemotePath(remotePath), sftpSourceTypeFile, false), nil
}

func (m *Manager) UploadDirectory(request domain.SFTPUploadDirectoryRequest) (domain.SFTPTransferState, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	return m.uploadDirectory(current, request)
}

func (m *Manager) uploadDirectory(current *session, request domain.SFTPUploadDirectoryRequest) (domain.SFTPTransferState, error) {
	info, err := os.Lstat(request.LocalPath)
	if err != nil {
		return domain.SFTPTransferState{}, fmt.Errorf("本地文件夹不可读取: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return domain.SFTPTransferState{}, errors.New("暂不支持上传符号链接文件夹")
	}
	if !info.IsDir() {
		return domain.SFTPTransferState{}, errors.New("请选择本地文件夹")
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remoteDirectory := resolveRemotePath(base, request.RemoteDirectory)
	if hasParentTraversal(request.RemoteDirectory) {
		return domain.SFTPTransferState{}, errors.New("远程目标路径不能包含 ..")
	}
	remoteRoot := joinRemotePath(remoteDirectory, filepath.Base(filepath.Clean(request.LocalPath)))
	if current.mode == domain.SFTPModeSCP {
		return m.scpUploadDirectory(current, request, remoteRoot)
	}
	transferRequest := domain.SFTPTransferRequest{
		ConnectionID:      request.ConnectionID,
		ContextID:         request.ContextID,
		TerminalSessionID: request.TerminalSessionID,
		LocalPath:         request.LocalPath,
		RemotePath:        remoteRoot,
		ConflictPolicy:    request.ConflictPolicy,
	}
	return m.startTransfer(current, domain.SFTPTransferUpload, transferRequest, 0, filepath.Base(filepath.Clean(request.LocalPath)), sftpSourceTypeDirectory, true), nil
}

func (m *Manager) DownloadDirectory(request domain.SFTPDownloadDirectoryRequest) (domain.SFTPTransferState, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPTransferState{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		return m.scpDownloadDirectory(current, request)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.RemotePath)
	if hasParentTraversal(request.RemotePath) {
		return domain.SFTPTransferState{}, errors.New("远程源路径不能包含 ..")
	}
	info, err := current.client.Lstat(remotePath)
	if err != nil {
		return domain.SFTPTransferState{}, m.operationErrorForSession(current, "sftp.download_dir.stat", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return domain.SFTPTransferState{}, errors.New("暂不支持下载符号链接目录")
	}
	if !info.IsDir() {
		return domain.SFTPTransferState{}, errors.New("请选择远程目录")
	}
	if strings.TrimSpace(request.LocalDirectory) == "" {
		return domain.SFTPTransferState{}, errors.New("请选择本地保存目录")
	}
	localRoot := filepath.Join(filepath.Clean(request.LocalDirectory), safeDownloadRootName(remotePath))
	if err := ensureLocalDescendant(request.LocalDirectory, localRoot); err != nil {
		return domain.SFTPTransferState{}, err
	}
	transferRequest := domain.SFTPTransferRequest{
		ConnectionID:      request.ConnectionID,
		ContextID:         request.ContextID,
		TerminalSessionID: request.TerminalSessionID,
		LocalPath:         localRoot,
		RemotePath:        remotePath,
		ConflictPolicy:    request.ConflictPolicy,
	}
	return m.startTransfer(current, domain.SFTPTransferDownload, transferRequest, 0, baseRemotePath(remotePath), sftpSourceTypeDirectory, true), nil
}

func (m *Manager) CancelTransfer(transferID string) error {
	m.mu.RLock()
	current := m.transfers[transferID]
	m.mu.RUnlock()
	if current == nil {
		return errors.New("传输任务不存在")
	}
	current.cancel()
	return nil
}

func (m *Manager) PauseTransfer(request domain.SFTPTransferControlRequest) (domain.SFTPTransferControlResponse, error) {
	item, err := m.transferForControl(request)
	if err != nil {
		return domain.SFTPTransferControlResponse{}, err
	}
	item.mu.Lock()
	switch item.state.Status {
	case domain.SFTPTransferPaused, domain.SFTPTransferPausing:
		applyTransferControls(&item.state)
		state := item.state
		item.mu.Unlock()
		m.emitTransfer(state)
		return domain.SFTPTransferControlResponse{TransferID: state.ID, Status: state.Status}, nil
	case domain.SFTPTransferQueued, domain.SFTPTransferPlanning, domain.SFTPTransferRunning, domain.SFTPTransferResuming:
		item.state.PauseRequested = true
		item.state.Status = domain.SFTPTransferPausing
		if item.state.Mode == domain.SFTPModeSCP {
			item.state.ErrorMessage = "SCP 模式将在当前文件完成后暂停"
		}
		applyTransferControls(&item.state)
		state := item.state
		item.mu.Unlock()
		m.emitTransfer(state)
		return domain.SFTPTransferControlResponse{TransferID: state.ID, Status: state.Status}, nil
	case domain.SFTPTransferCompleted, domain.SFTPTransferPartialFailed, domain.SFTPTransferFailed, domain.SFTPTransferCanceled, domain.SFTPTransferSkipped:
		status := item.state.Status
		item.mu.Unlock()
		return domain.SFTPTransferControlResponse{}, fmt.Errorf("传输已结束，无法暂停（当前状态：%s）", status)
	default:
		status := item.state.Status
		item.mu.Unlock()
		return domain.SFTPTransferControlResponse{}, fmt.Errorf("当前状态无法暂停：%s", status)
	}
}

func (m *Manager) ResumeTransfer(request domain.SFTPTransferControlRequest) (domain.SFTPTransferControlResponse, error) {
	item, err := m.transferForControl(request)
	if err != nil {
		return domain.SFTPTransferControlResponse{}, err
	}
	var resumeCh chan struct{}
	item.mu.Lock()
	switch item.state.Status {
	case domain.SFTPTransferPaused:
		resumeCh = item.resumeCh
		item.resumeCh = nil
		item.state.PauseRequested = false
		item.state.Status = domain.SFTPTransferResuming
		item.state.ErrorMessage = ""
	case domain.SFTPTransferPausing:
		if item.resumeCh != nil {
			resumeCh = item.resumeCh
			item.resumeCh = nil
			item.state.Status = domain.SFTPTransferResuming
		} else {
			item.state.Status = domain.SFTPTransferRunning
		}
		item.state.PauseRequested = false
		item.state.ErrorMessage = ""
	case domain.SFTPTransferRunning, domain.SFTPTransferPlanning, domain.SFTPTransferQueued, domain.SFTPTransferResuming:
		item.state.PauseRequested = false
	default:
		status := item.state.Status
		item.mu.Unlock()
		return domain.SFTPTransferControlResponse{}, fmt.Errorf("当前状态无法继续：%s", status)
	}
	applyTransferControls(&item.state)
	state := item.state
	item.mu.Unlock()
	m.emitTransfer(state)
	if resumeCh != nil {
		close(resumeCh)
	}
	return domain.SFTPTransferControlResponse{TransferID: state.ID, Status: state.Status}, nil
}

func (m *Manager) transferForControl(request domain.SFTPTransferControlRequest) (*transfer, error) {
	transferID := strings.TrimSpace(request.TransferID)
	if transferID == "" {
		return nil, errors.New("传输任务不存在")
	}
	m.mu.RLock()
	item := m.transfers[transferID]
	m.mu.RUnlock()
	if item == nil {
		return nil, errors.New("传输任务不存在")
	}
	item.mu.RLock()
	state := item.state
	item.mu.RUnlock()
	if state.ConnectionID != request.ConnectionID {
		return nil, errors.New("传输任务不属于当前服务器")
	}
	contextID := normalizeContextID(request.ConnectionID, request.ContextID)
	if state.ContextID != contextID {
		return nil, errors.New("传输任务不属于当前 SFTP 上下文")
	}
	return item, nil
}

func (m *Manager) startTransfer(
	current *session,
	direction domain.SFTPTransferDirection,
	request domain.SFTPTransferRequest,
	total int64,
	fileName string,
	sourceType string,
	recursive bool,
) domain.SFTPTransferState {
	ctx, cancel := context.WithCancel(current.ctx)
	state := domain.SFTPTransferState{
		ID:                    newTransferID(),
		ConnectionID:          request.ConnectionID,
		ContextID:             current.contextID,
		TerminalSessionID:     current.terminalSessionID,
		Generation:            current.generation,
		Mode:                  current.mode,
		Direction:             direction,
		Recursive:             recursive,
		SourceType:            sourceType,
		LocalPath:             request.LocalPath,
		RemotePath:            request.RemotePath,
		FileName:              fileName,
		CurrentFile:           "",
		TotalBytes:            total,
		CurrentFileBytesTotal: total,
		Status:                domain.SFTPTransferQueued,
		Cancelable:            true,
		StartedAt:             now(),
		TransferredBytes:      0,
	}
	if !recursive {
		state.FilesTotal = 1
	}
	applyTransferControls(&state)
	item := &transfer{cancel: cancel, conflictPolicy: request.ConflictPolicy, state: state}
	m.mu.Lock()
	m.transfers[state.ID] = item
	m.mu.Unlock()
	m.emitTransfer(state)
	go m.runTransfer(ctx, current, item)
	return state
}

func (m *Manager) runTransfer(ctx context.Context, current *session, item *transfer) {
	select {
	case current.slot <- struct{}{}:
		defer func() { <-current.slot }()
	case <-ctx.Done():
		m.finishTransfer(item, domain.SFTPTransferCanceled, "传输已取消")
		return
	}
	if ctx.Err() != nil {
		m.finishTransfer(item, domain.SFTPTransferCanceled, "传输已取消")
		return
	}
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		if state.Recursive {
			state.Status = domain.SFTPTransferPlanning
			state.CurrentFile = "扫描中"
		} else {
			state.Status = domain.SFTPTransferRunning
		}
		state.StartedAt = now()
	})
	if err := m.waitIfPaused(ctx, item, -1, func() error { return nil }); err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			m.finishTransfer(item, domain.SFTPTransferCanceled, "传输已取消")
		} else {
			m.finishTransfer(item, domain.SFTPTransferFailed, classifySFTPError(err).message)
		}
		return
	}
	item.mu.RLock()
	state := item.state
	item.mu.RUnlock()
	var err error
	if current.mode == domain.SFTPModeSCP && state.Recursive && state.Direction == domain.SFTPTransferUpload {
		err = m.runSCPDirectoryUpload(ctx, current, item)
	} else if current.mode == domain.SFTPModeSCP && state.Recursive && state.Direction == domain.SFTPTransferDownload {
		err = m.runSCPDirectoryDownload(ctx, current, item)
	} else if current.mode == domain.SFTPModeSCP && state.Direction == domain.SFTPTransferUpload {
		err = m.runSCPUpload(ctx, current, item)
	} else if current.mode == domain.SFTPModeSCP {
		err = m.runSCPDownload(ctx, current, item)
	} else if state.Recursive && state.Direction == domain.SFTPTransferUpload {
		err = m.runDirectoryUpload(ctx, current.client, item)
	} else if state.Recursive && state.Direction == domain.SFTPTransferDownload {
		err = m.runDirectoryDownload(ctx, current.client, item)
	} else if state.Direction == domain.SFTPTransferUpload {
		err = m.runUpload(ctx, current.client, item)
	} else {
		err = m.runDownload(ctx, current.client, item)
	}
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			m.finishTransfer(item, domain.SFTPTransferCanceled, "传输已取消")
		} else {
			m.finishTransfer(item, domain.SFTPTransferFailed, classifySFTPError(err).message)
		}
		return
	}
	item.mu.RLock()
	failed := item.state.FailedCount
	item.mu.RUnlock()
	if failed > 0 {
		m.finishTransfer(item, domain.SFTPTransferPartialFailed, "部分文件传输失败")
		return
	}
	m.finishTransfer(item, domain.SFTPTransferCompleted, "")
}

func (m *Manager) runUpload(ctx context.Context, client Client, item *transfer) error {
	item.mu.RLock()
	state := item.state
	item.mu.RUnlock()
	source, err := os.Open(state.LocalPath)
	if err != nil {
		return fmt.Errorf("open local file: %w", err)
	}
	defer source.Close()
	sourceInfo, err := source.Stat()
	if err != nil {
		return fmt.Errorf("stat local file: %w", err)
	}
	target, err := client.Create(state.RemotePath)
	if err != nil {
		return fmt.Errorf("create remote file: %w", err)
	}
	defer target.Close()
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.CurrentFileBytesTotal = sourceInfo.Size()
	})
	return copyWithProgress(ctx, target, source, state.TotalBytes, func(done int64, speed float64) {
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.TransferredBytes = done
			state.CurrentFileBytesDone = done
			state.ResumeOffset = done
			state.SpeedBytesPerSecond = speed
			if state.TotalBytes > 0 {
				state.Percent = float64(done) * 100 / float64(state.TotalBytes)
			}
		})
	}, func(done int64) error {
		return m.waitIfPaused(ctx, item, done, func() error {
			if err := validateLocalResumeSource(state.LocalPath, sourceInfo); err != nil {
				return err
			}
			if err := seekBoth(source, target, done); err != nil {
				return err
			}
			return nil
		})
	})
}

func (m *Manager) runDownload(ctx context.Context, client Client, item *transfer) error {
	item.mu.RLock()
	state := item.state
	item.mu.RUnlock()
	remoteInfo, err := client.Stat(state.RemotePath)
	if err != nil {
		return fmt.Errorf("stat remote file: %w", err)
	}
	source, err := client.Open(state.RemotePath)
	if err != nil {
		return fmt.Errorf("open remote file: %w", err)
	}
	defer source.Close()
	if err := os.MkdirAll(filepath.Dir(state.LocalPath), 0o755); err != nil {
		return fmt.Errorf("create local directory: %w", err)
	}
	target, err := os.Create(state.LocalPath)
	if err != nil {
		return fmt.Errorf("create local file: %w", err)
	}
	defer target.Close()
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.CurrentFileBytesTotal = remoteInfo.Size()
	})
	return copyWithProgress(ctx, target, source, state.TotalBytes, func(done int64, speed float64) {
		m.updateTransfer(item, func(state *domain.SFTPTransferState) {
			state.TransferredBytes = done
			state.CurrentFileBytesDone = done
			state.ResumeOffset = done
			state.SpeedBytesPerSecond = speed
			if state.TotalBytes > 0 {
				state.Percent = float64(done) * 100 / float64(state.TotalBytes)
			}
		})
	}, func(done int64) error {
		return m.waitIfPaused(ctx, item, done, func() error {
			if err := validateRemoteResumeSource(client, state.RemotePath, remoteInfo); err != nil {
				return err
			}
			if err := validateLocalResumeTarget(state.LocalPath, done); err != nil {
				return err
			}
			if err := seekBoth(source, target, done); err != nil {
				return err
			}
			return nil
		})
	})
}

func (m *Manager) skippedTransfer(
	request domain.SFTPTransferRequest,
	direction domain.SFTPTransferDirection,
	mode domain.SFTPMode,
	remotePath string,
	total int64,
) domain.SFTPTransferState {
	state := domain.SFTPTransferState{
		ID:                newTransferID(),
		ConnectionID:      request.ConnectionID,
		ContextID:         normalizeContextID(request.ConnectionID, request.ContextID),
		TerminalSessionID: request.TerminalSessionID,
		Generation:        m.currentGeneration(request.ConnectionID, request.ContextID),
		Mode:              mode,
		Direction:         direction,
		LocalPath:         request.LocalPath,
		RemotePath:        remotePath,
		FileName:          baseRemotePath(remotePath),
		CurrentFile:       baseRemotePath(remotePath),
		SourceType:        sftpSourceTypeFile,
		TotalBytes:        total,
		Status:            domain.SFTPTransferSkipped,
		StartedAt:         now(),
		FinishedAt:        now(),
		ErrorMessage:      "已跳过同名文件",
		TransferredBytes:  0,
		FilesTotal:        1,
		FilesDone:         1,
		SkippedCount:      1,
		Cancelable:        false,
	}
	m.mu.Lock()
	m.transfers[state.ID] = &transfer{cancel: func() {}, state: state}
	m.mu.Unlock()
	m.emitTransfer(state)
	return state
}

func (m *Manager) finishTransfer(item *transfer, status domain.SFTPTransferStatus, message string) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.Status = status
		state.FinishedAt = now()
		state.ErrorMessage = message
		state.Cancelable = false
		if status == domain.SFTPTransferCompleted || status == domain.SFTPTransferPartialFailed {
			if !state.Recursive || state.TransferredBytes >= state.TotalBytes {
				state.TransferredBytes = state.TotalBytes
			}
			if state.FilesTotal > 0 && state.FilesDone < state.FilesTotal {
				state.FilesDone = state.FilesTotal
			}
			state.Percent = 100
			state.SpeedBytesPerSecond = 0
		}
	})
}

func (m *Manager) updateTransfer(item *transfer, mutate func(*domain.SFTPTransferState)) {
	item.mu.Lock()
	mutate(&item.state)
	applyTransferControls(&item.state)
	state := item.state
	item.mu.Unlock()
	m.emitTransfer(state)
}

func (m *Manager) waitIfPaused(ctx context.Context, item *transfer, offset int64, beforeResume func() error) error {
	item.mu.Lock()
	if !item.state.PauseRequested {
		item.mu.Unlock()
		return ctx.Err()
	}
	if item.resumeCh == nil {
		item.resumeCh = make(chan struct{})
	}
	resumeCh := item.resumeCh
	item.state.Status = domain.SFTPTransferPaused
	if offset >= 0 {
		item.state.ResumeOffset = offset
		item.state.CurrentFileBytesDone = offset
	}
	applyTransferControls(&item.state)
	state := item.state
	item.mu.Unlock()
	m.emitTransfer(state)

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-resumeCh:
	}
	if beforeResume != nil {
		if err := beforeResume(); err != nil {
			return err
		}
	}
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		if state.Status == domain.SFTPTransferPaused || state.Status == domain.SFTPTransferResuming {
			state.Status = domain.SFTPTransferRunning
		}
		state.PauseRequested = false
		state.ErrorMessage = ""
	})
	return ctx.Err()
}

func isTransferCancelable(status domain.SFTPTransferStatus) bool {
	return status == domain.SFTPTransferQueued ||
		status == domain.SFTPTransferPlanning ||
		status == domain.SFTPTransferRunning ||
		status == domain.SFTPTransferPausing ||
		status == domain.SFTPTransferPaused ||
		status == domain.SFTPTransferResuming
}

func applyTransferControls(state *domain.SFTPTransferState) {
	state.CanPause = state.Status == domain.SFTPTransferQueued ||
		state.Status == domain.SFTPTransferPlanning ||
		state.Status == domain.SFTPTransferRunning ||
		state.Status == domain.SFTPTransferResuming
	state.CanResume = state.Status == domain.SFTPTransferPaused
	state.CanCancel = isTransferCancelable(state.Status)
	state.Cancelable = state.CanCancel
}

func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, total int64, update func(int64, float64), pause func(int64) error) error {
	buffer := make([]byte, transferBufferSize)
	started := time.Now()
	lastEmit := time.Now()
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			if err := ctx.Err(); err != nil {
				return err
			}
			if _, writeErr := dst.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
			written += int64(n)
			if pause != nil {
				if err := pause(written); err != nil {
					return err
				}
			}
			if time.Since(lastEmit) >= 200*time.Millisecond || written == total {
				elapsed := time.Since(started).Seconds()
				speed := 0.0
				if elapsed > 0 {
					speed = float64(written) / elapsed
				}
				update(written, speed)
				lastEmit = time.Now()
			}
		}
		if errors.Is(readErr, io.EOF) {
			update(written, 0)
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func seekBoth(src io.Seeker, dst io.Seeker, offset int64) error {
	if _, err := src.Seek(offset, io.SeekStart); err != nil {
		return fmt.Errorf("seek source: %w", err)
	}
	if _, err := dst.Seek(offset, io.SeekStart); err != nil {
		return fmt.Errorf("seek target: %w", err)
	}
	return nil
}

func validateLocalResumeSource(path string, expected fs.FileInfo) error {
	current, err := os.Stat(path)
	if err != nil {
		return errors.New("文件已变化，无法继续传输")
	}
	if current.Size() != expected.Size() || !current.ModTime().Equal(expected.ModTime()) {
		return errors.New("文件已变化，无法继续传输")
	}
	return nil
}

func validateRemoteResumeSource(client Client, path string, expected fs.FileInfo) error {
	current, err := client.Stat(path)
	if err != nil {
		return errors.New("文件已变化，无法继续传输")
	}
	if current.Size() != expected.Size() || !current.ModTime().Equal(expected.ModTime()) {
		return errors.New("文件已变化，无法继续传输")
	}
	return nil
}

func validateLocalResumeTarget(path string, offset int64) error {
	current, err := os.Stat(path)
	if err != nil {
		return errors.New("文件已变化，无法继续传输")
	}
	if current.Size() < offset {
		return errors.New("文件已变化，无法继续传输")
	}
	return nil
}
