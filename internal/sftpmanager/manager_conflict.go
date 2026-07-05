package sftpmanager

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"serverpilot/internal/domain"
	"strings"
)

func normalizeTextConflictPolicy(policy domain.SFTPTextConflictPolicy, forceOverwrite bool, mode domain.SFTPTextSaveMode) domain.SFTPTextConflictPolicy {
	if forceOverwrite {
		return domain.SFTPTextOverwrite
	}
	switch policy {
	case domain.SFTPTextOverwrite, domain.SFTPTextFailIfExists, domain.SFTPTextFailIfChanged:
		return policy
	default:
		if mode == domain.SFTPTextSaveExisting {
			return domain.SFTPTextFailIfChanged
		}
		return domain.SFTPTextFailIfExists
	}
}

func isRemoteNotExistError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrNotExist) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such file") ||
		strings.Contains(message, "not exist") ||
		strings.Contains(message, "not_found")
}

func (m *Manager) resolveRemoteConflict(
	client Client,
	remotePath string,
	policy domain.SFTPConflictPolicy,
) (string, bool, error) {
	if policy == "" {
		policy = domain.SFTPConflictAsk
	}
	if _, err := client.Stat(remotePath); err != nil {
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
			if _, err := client.Stat(candidate); err != nil {
				return candidate, false, nil
			}
		}
		return "", false, errors.New("无法生成可用的远程重命名文件名")
	default:
		return "", false, errors.New("远程文件已存在")
	}
}

func resolveLocalConflict(localPath string, policy domain.SFTPConflictPolicy) (string, bool, error) {
	if policy == "" {
		policy = domain.SFTPConflictAsk
	}
	if _, err := os.Stat(localPath); err != nil {
		if os.IsNotExist(err) {
			return localPath, false, nil
		}
		return "", false, fmt.Errorf("检查本地文件失败: %w", err)
	}
	switch policy {
	case domain.SFTPConflictOverwrite:
		return localPath, false, nil
	case domain.SFTPConflictSkip:
		return localPath, true, nil
	case domain.SFTPConflictRename:
		for index := 1; index < 1000; index++ {
			candidate := localRenameCandidate(localPath, index)
			if _, err := os.Stat(candidate); os.IsNotExist(err) {
				return candidate, false, nil
			}
		}
		return "", false, errors.New("无法生成可用的本地重命名文件名")
	default:
		return "", false, errors.New("本地文件已存在")
	}
}

func localRenameCandidate(original string, index int) string {
	dir := filepath.Dir(original)
	base := filepath.Base(original)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	if stem == "" {
		stem = base
		ext = ""
	}
	return filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, index, ext))
}
