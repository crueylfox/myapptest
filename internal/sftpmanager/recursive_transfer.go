package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

func (m *Manager) runDirectoryUpload(ctx context.Context, client Client, item *transfer) error {
	item.mu.RLock()
	state := item.state
	policy := item.conflictPolicy
	item.mu.RUnlock()
	plan, err := PlanRecursiveUpload(ctx, state.LocalPath, parentRemotePath(state.RemotePath))
	if err != nil {
		return err
	}
	m.applyRecursivePlan(item, plan)
	for _, directory := range plan.Directories {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := ensureRemoteDirectory(client, directory.RemotePath); err != nil {
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
		remotePath, skipped, err := m.resolveRemoteConflict(client, file.RemotePath, policy)
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
		written, err := uploadPlannedFile(ctx, client, file.LocalPath, remotePath, file.Size, func(done int64) {
			m.updateRecursiveBytes(item, bytesDone+done, started)
			m.updateTransfer(item, func(state *domain.SFTPTransferState) {
				state.CurrentFileBytesDone = done
				state.ResumeOffset = done
			})
		}, func(done int64, source *os.File, target RemoteFile, sourceInfo fs.FileInfo) error {
			return m.waitIfPaused(ctx, item, done, func() error {
				if err := validateLocalResumeSource(file.LocalPath, sourceInfo); err != nil {
					return err
				}
				return seekBoth(source, target, done)
			})
		})
		bytesDone += written
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return context.Canceled
			}
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		m.finishTransferFile(item, file.RelativePath, bytesDone, started)
	}
	m.setTransferCurrentFile(item, "")
	return nil
}

func (m *Manager) runDirectoryDownload(ctx context.Context, client Client, item *transfer) error {
	item.mu.RLock()
	state := item.state
	policy := item.conflictPolicy
	item.mu.RUnlock()
	plan, err := PlanRecursiveDownload(ctx, client, state.RemotePath, filepath.Dir(state.LocalPath))
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
		written, err := downloadPlannedFile(ctx, client, file.RemotePath, localPath, file.Size, func(done int64) {
			m.updateRecursiveBytes(item, bytesDone+done, started)
			m.updateTransfer(item, func(state *domain.SFTPTransferState) {
				state.CurrentFileBytesDone = done
				state.ResumeOffset = done
			})
		}, func(done int64, source RemoteFile, target *os.File, remoteInfo fs.FileInfo) error {
			return m.waitIfPaused(ctx, item, done, func() error {
				if err := validateRemoteResumeSource(client, file.RemotePath, remoteInfo); err != nil {
					return err
				}
				if err := validateLocalResumeTarget(localPath, done); err != nil {
					return err
				}
				return seekBoth(source, target, done)
			})
		})
		bytesDone += written
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return context.Canceled
			}
			m.incrementTransferFailure(item, file.RelativePath, err, true)
			continue
		}
		m.finishTransferFile(item, file.RelativePath, bytesDone, started)
	}
	m.setTransferCurrentFile(item, "")
	return nil
}

func uploadPlannedFile(
	ctx context.Context,
	client Client,
	localPath, remotePath string,
	size int64,
	update func(int64),
	pause func(int64, *os.File, RemoteFile, fs.FileInfo) error,
) (int64, error) {
	source, err := os.Open(localPath)
	if err != nil {
		return 0, fmt.Errorf("open local file: %w", err)
	}
	defer source.Close()
	sourceInfo, err := source.Stat()
	if err != nil {
		return 0, fmt.Errorf("stat local file: %w", err)
	}
	target, err := client.Create(remotePath)
	if err != nil {
		return 0, fmt.Errorf("create remote file: %w", err)
	}
	written, copyErr := copyWithProgressCountPause(ctx, target, source, size, update, func(done int64) error {
		if pause == nil {
			return nil
		}
		return pause(done, source, target, sourceInfo)
	})
	closeErr := target.Close()
	if copyErr != nil {
		return written, copyErr
	}
	if closeErr != nil {
		return written, closeErr
	}
	return written, nil
}

func downloadPlannedFile(
	ctx context.Context,
	client Client,
	remotePath, localPath string,
	size int64,
	update func(int64),
	pause func(int64, RemoteFile, *os.File, fs.FileInfo) error,
) (int64, error) {
	remoteInfo, err := client.Stat(remotePath)
	if err != nil {
		return 0, fmt.Errorf("stat remote file: %w", err)
	}
	source, err := client.Open(remotePath)
	if err != nil {
		return 0, fmt.Errorf("open remote file: %w", err)
	}
	defer source.Close()
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return 0, fmt.Errorf("create local directory: %w", err)
	}
	target, err := os.Create(localPath)
	if err != nil {
		return 0, fmt.Errorf("create local file: %w", err)
	}
	written, copyErr := copyWithProgressCountPause(ctx, target, source, size, update, func(done int64) error {
		if pause == nil {
			return nil
		}
		return pause(done, source, target, remoteInfo)
	})
	closeErr := target.Close()
	if copyErr != nil {
		return written, copyErr
	}
	if closeErr != nil {
		return written, closeErr
	}
	return written, nil
}

func (m *Manager) applyRecursivePlan(item *transfer, plan RecursiveTransferPlan) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		if len(plan.Directories) > 0 {
			state.RemotePath = plan.Directories[0].RemotePath
			state.LocalPath = plan.Directories[0].LocalPath
			state.FileName = baseTransferName(state)
		}
		state.Status = domain.SFTPTransferRunning
		state.TotalBytes = plan.TotalBytes
		state.FilesTotal = len(plan.Files)
		state.FilesDone = 0
		state.SkippedCount += plan.SkippedCount
		state.CurrentFile = ""
		state.Percent = 0
		if len(plan.Files) == 0 {
			state.Percent = 100
		}
	})
}

func (m *Manager) setTransferCurrentFile(item *transfer, name string) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.CurrentFile = name
	})
}

func (m *Manager) updateRecursiveBytes(item *transfer, bytesDone int64, started time.Time) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.TransferredBytes = bytesDone
		if state.TotalBytes > 0 {
			state.Percent = float64(bytesDone) * 100 / float64(state.TotalBytes)
			if state.Percent > 100 {
				state.Percent = 100
			}
		} else if state.FilesTotal > 0 {
			state.Percent = float64(state.FilesDone) * 100 / float64(state.FilesTotal)
		}
		elapsed := time.Since(started).Seconds()
		if elapsed > 0 {
			state.SpeedBytesPerSecond = float64(bytesDone) / elapsed
		}
	})
}

func (m *Manager) finishTransferFile(item *transfer, name string, bytesDone int64, started time.Time) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.CurrentFile = name
		state.FilesDone++
		state.TransferredBytes = bytesDone
		if state.TotalBytes > 0 {
			state.Percent = float64(bytesDone) * 100 / float64(state.TotalBytes)
			if state.Percent > 100 {
				state.Percent = 100
			}
		} else if state.FilesTotal > 0 {
			state.Percent = float64(state.FilesDone) * 100 / float64(state.FilesTotal)
		}
		elapsed := time.Since(started).Seconds()
		if elapsed > 0 {
			state.SpeedBytesPerSecond = float64(bytesDone) / elapsed
		}
	})
}

func (m *Manager) incrementTransferSkipped(item *transfer, name string, countsAsFile bool) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.CurrentFile = name
		state.SkippedCount++
		if countsAsFile {
			state.FilesDone++
		}
		if state.TotalBytes == 0 && state.FilesTotal > 0 {
			state.Percent = float64(state.FilesDone) * 100 / float64(state.FilesTotal)
		}
	})
}

func (m *Manager) incrementTransferFailure(item *transfer, name string, err error, countsAsFile bool) {
	m.updateTransfer(item, func(state *domain.SFTPTransferState) {
		state.CurrentFile = name
		state.FailedCount++
		if countsAsFile {
			state.FilesDone++
		}
		state.ErrorMessage = classifySFTPError(err).message
		if state.TotalBytes == 0 && state.FilesTotal > 0 {
			state.Percent = float64(state.FilesDone) * 100 / float64(state.FilesTotal)
		}
	})
}

func ensureRemoteDirectory(client Client, remotePath string) error {
	info, err := client.Stat(remotePath)
	if err == nil {
		if info.IsDir() {
			return nil
		}
		return errors.New("远程目标路径已存在且不是目录")
	}
	if err := client.Mkdir(remotePath); err != nil {
		if info, statErr := client.Stat(remotePath); statErr == nil && info.IsDir() {
			return nil
		}
		return err
	}
	return nil
}

func resolveLocalConflictNoSymlink(localPath string, policy domain.SFTPConflictPolicy) (string, bool, error) {
	if policy == "" {
		policy = domain.SFTPConflictAsk
	}
	info, err := os.Lstat(localPath)
	if err != nil {
		if os.IsNotExist(err) {
			return localPath, false, nil
		}
		return "", false, fmt.Errorf("检查本地文件失败: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return "", true, nil
	}
	switch policy {
	case domain.SFTPConflictOverwrite:
		return localPath, false, nil
	case domain.SFTPConflictSkip:
		return localPath, true, nil
	case domain.SFTPConflictRename:
		for index := 1; index < 1000; index++ {
			candidate := localRenameCandidate(localPath, index)
			if info, err := os.Lstat(candidate); os.IsNotExist(err) {
				return candidate, false, nil
			} else if err == nil && info.Mode()&fs.ModeSymlink != 0 {
				continue
			}
		}
		return "", false, errors.New("无法生成可用的本地重命名文件名")
	default:
		return "", false, errors.New("本地文件已存在")
	}
}

func ensureNoSymlinkInPath(root, target string) error {
	rootAbs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return fmt.Errorf("本地根目录无效: %w", err)
	}
	targetAbs, err := filepath.Abs(filepath.Clean(target))
	if err != nil {
		return fmt.Errorf("本地目标路径无效: %w", err)
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return fmt.Errorf("本地路径关系无效: %w", err)
	}
	if rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errors.New("本地目标路径越界")
	}
	if info, err := os.Lstat(rootAbs); err == nil && info.Mode()&fs.ModeSymlink != 0 {
		return errors.New("本地目标路径包含符号链接")
	}
	current := rootAbs
	if rel == "." {
		return nil
	}
	for _, part := range splitLocalRelative(rel) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			return errors.New("本地目标路径包含符号链接")
		}
	}
	return nil
}

func splitLocalRelative(value string) []string {
	var parts []string
	for _, part := range strings.Split(filepath.ToSlash(value), "/") {
		if part != "" && part != "." {
			parts = append(parts, part)
		}
	}
	return parts
}

func copyWithProgressCount(ctx context.Context, dst io.Writer, src io.Reader, total int64, update func(int64)) (int64, error) {
	return copyWithProgressCountPause(ctx, dst, src, total, update, nil)
}

func copyWithProgressCountPause(ctx context.Context, dst io.Writer, src io.Reader, total int64, update func(int64), pause func(int64) error) (int64, error) {
	buffer := make([]byte, transferBufferSize)
	var written int64
	lastEmit := time.Now()
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			if err := ctx.Err(); err != nil {
				return written, err
			}
			if _, writeErr := dst.Write(buffer[:n]); writeErr != nil {
				return written, writeErr
			}
			written += int64(n)
			if pause != nil {
				if err := pause(written); err != nil {
					return written, err
				}
			}
			if time.Since(lastEmit) >= 200*time.Millisecond || written == total {
				update(written)
				lastEmit = time.Now()
			}
		}
		if errors.Is(readErr, io.EOF) {
			update(written)
			return written, nil
		}
		if readErr != nil {
			return written, readErr
		}
	}
}

func baseTransferName(state *domain.SFTPTransferState) string {
	if state.Direction == domain.SFTPTransferUpload {
		return filepath.Base(filepath.Clean(state.LocalPath))
	}
	return baseRemotePath(state.RemotePath)
}
