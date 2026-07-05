package sftpmanager

import (
	"context"
	"errors"
	"serverpilot/internal/domain"
	"sort"
	"strings"
)

func (m *Manager) List(ctx context.Context, request domain.SFTPListRequest) (domain.SFTPListResult, error) {
	requestID := sftpRequestID(request.RequestID)
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPListResult{}, err
	}
	generation := current.generation
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		scpPathValue, err := normalizeSCPRequestPath(base, request.Path, true)
		if err != nil {
			return domain.SFTPListResult{}, err
		}
		scpResult, err := m.scpShellList(ctx, current, scpPathValue)
		if err != nil {
			return domain.SFTPListResult{}, m.operationErrorForSession(current, "sftp.scp.list", err)
		}
		scpResult.Generation = generation
		scpResult.RequestID = requestID
		if !m.isCurrentSession(current) {
			return scpResult, nil
		}
		current.mu.Lock()
		if !current.closed {
			current.currentPath = scpResult.Path
		}
		current.mu.Unlock()
		m.mu.Lock()
		scpState := m.stateLocked(request.ConnectionID, request.ContextID)
		scpState.CurrentPath = scpResult.Path
		scpState.Status = domain.SFTPStatusOnline
		scpState.Active = true
		scpState.Mode = domain.SFTPModeSCP
		scpState.Capabilities = sftpModeCapabilities(domain.SFTPModeSCP)
		scpState.Message = "SCP 兼容模式：已使用 SCP + Shell 兼容文件管理。"
		scpState.UpdatedAt = now()
		m.setStateLocked(scpState)
		m.mu.Unlock()
		m.emitEntries(scpResult)
		if scpResult.Mode == domain.SFTPModeSCP {
			return scpResult, nil
		}
		current.mu.RLock()
		pathValue := current.currentPath
		current.mu.RUnlock()
		if strings.TrimSpace(request.Path) != "" {
			pathValue = cleanRemotePath(request.Path)
		}
		result := domain.SFTPListResult{
			ConnectionID: request.ConnectionID,
			ContextID:    current.contextID,
			Generation:   generation,
			RequestID:    requestID,
			Mode:         domain.SFTPModeSCP,
			Path:         pathValue,
			ParentPath:   parentRemotePath(pathValue),
			Entries:      []domain.SFTPEntry{},
		}
		if !m.isCurrentSession(current) {
			return result, nil
		}
		current.mu.Lock()
		if !current.closed {
			current.currentPath = pathValue
		}
		current.mu.Unlock()
		m.mu.Lock()
		state := m.stateLocked(request.ConnectionID, request.ContextID)
		state.CurrentPath = pathValue
		state.Status = domain.SFTPStatusOnline
		state.Active = true
		state.Mode = domain.SFTPModeSCP
		state.Capabilities = sftpModeCapabilities(domain.SFTPModeSCP)
		state.Message = "SCP 兼容模式：当前服务器不支持 SFTP，文件列表不可用。"
		state.UpdatedAt = now()
		m.setStateLocked(state)
		m.mu.Unlock()
		m.emitEntries(result)
		return result, nil
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	entries, err := current.client.ReadDir(ctx, remotePath)
	if err != nil {
		return domain.SFTPListResult{}, m.operationErrorForSession(current, "sftp.list", err)
	}
	result := domain.SFTPListResult{
		ConnectionID: request.ConnectionID,
		ContextID:    current.contextID,
		Generation:   generation,
		RequestID:    requestID,
		Mode:         domain.SFTPModeSFTP,
		Path:         remotePath,
		ParentPath:   parentRemotePath(remotePath),
		Entries:      make([]domain.SFTPEntry, 0, len(entries)),
	}
	for _, entry := range entries {
		result.Entries = append(result.Entries, fileInfoToEntry(remotePath, entry))
	}
	sort.SliceStable(result.Entries, func(i, j int) bool {
		if result.Entries[i].IsDir != result.Entries[j].IsDir {
			return result.Entries[i].IsDir
		}
		return strings.ToLower(result.Entries[i].Name) < strings.ToLower(result.Entries[j].Name)
	})
	if !m.isCurrentSession(current) {
		return result, nil
	}
	current.mu.Lock()
	if !current.closed {
		current.currentPath = remotePath
	}
	current.mu.Unlock()
	m.mu.Lock()
	state := m.stateLocked(request.ConnectionID, request.ContextID)
	state.CurrentPath = remotePath
	state.Status = domain.SFTPStatusOnline
	state.Active = true
	state.Mode = domain.SFTPModeSFTP
	state.Capabilities = sftpModeCapabilities(domain.SFTPModeSFTP)
	state.Message = "SFTP 已连接"
	state.UpdatedAt = now()
	m.setStateLocked(state)
	m.mu.Unlock()
	m.emitEntries(result)
	return result, nil
}

func (m *Manager) Home(ctx context.Context, request domain.SFTPContextRequest) (domain.SFTPListResult, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPListResult{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		home := current.homePath
		current.mu.RUnlock()
		if !strings.HasPrefix(cleanRemotePath(home), "/") {
			home = "/"
		}
		return m.List(ctx, domain.SFTPListRequest{ConnectionID: request.ConnectionID, ContextID: request.ContextID, Path: home, RequestID: request.RequestID})
	}
	home, err := current.client.Getwd()
	if err != nil || strings.TrimSpace(home) == "" {
		home = "."
	}
	return m.List(ctx, domain.SFTPListRequest{ConnectionID: request.ConnectionID, ContextID: request.ContextID, Path: home, RequestID: request.RequestID})
}

func (m *Manager) Parent(ctx context.Context, request domain.SFTPContextRequest) (domain.SFTPListResult, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPListResult{}, err
	}
	current.mu.RLock()
	parent := parentRemotePath(current.currentPath)
	current.mu.RUnlock()
	return m.List(ctx, domain.SFTPListRequest{ConnectionID: request.ConnectionID, ContextID: request.ContextID, Path: parent, RequestID: request.RequestID})
}

func (m *Manager) Mkdir(ctx context.Context, request domain.SFTPMkdirRequest) error {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath, err := normalizeSCPRequestPath(base, request.Path, false)
		if err != nil {
			return err
		}
		return m.scpShellMkdir(ctx, current, remotePath)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := current.client.Mkdir(remotePath); err != nil {
		return m.operationErrorForSession(current, "sftp.mkdir", err)
	}
	return nil
}

func (m *Manager) Rename(ctx context.Context, request domain.SFTPRenameRequest) error {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		oldPath, err := normalizeSCPRequestPath(base, request.OldPath, false)
		if err != nil {
			return err
		}
		newPath, err := normalizeSCPRequestPath(base, request.NewPath, false)
		if err != nil {
			return err
		}
		if parentRemotePath(oldPath) != parentRemotePath(newPath) {
			return errors.New("SCP 兼容模式只支持同目录重命名")
		}
		return m.scpShellRename(ctx, current, oldPath, newPath)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	oldPath := resolveRemotePath(base, request.OldPath)
	newPath := resolveRemotePath(base, request.NewPath)
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := current.client.Rename(oldPath, newPath); err != nil {
		return m.operationErrorForSession(current, "sftp.rename", err)
	}
	return nil
}
