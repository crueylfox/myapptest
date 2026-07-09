package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"hostdeck/internal/connectionerror"
	"hostdeck/internal/domain"
	"hostdeck/internal/sshclient"
	"strings"
)

func (m *Manager) SetKeepalivePolicyProvider(provider KeepalivePolicyProvider) {
	m.keepalive = provider
}

func (m *Manager) keepalivePolicy() sshclient.KeepalivePolicy {
	if m.keepalive == nil {
		return sshclient.KeepalivePolicy{}
	}
	return m.keepalive()
}

func (m *Manager) generationLocked(connectionID int64, contextID string) int64 {
	key := sftpSessionKey(connectionID, contextID)
	if generation := m.generations[key]; generation > 0 {
		return generation
	}
	m.generations[key] = 1
	return 1
}

func (m *Manager) nextGenerationLocked(connectionID int64, contextID string) int64 {
	key := sftpSessionKey(connectionID, contextID)
	next := m.generations[key] + 1
	if next <= 0 {
		next = 1
	}
	m.generations[key] = next
	return next
}

func (m *Manager) currentGeneration(connectionID int64, contextID string) int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.generations[sftpSessionKey(connectionID, contextID)]
}

func (m *Manager) isCurrentSessionLocked(current *session) bool {
	if current == nil {
		return false
	}
	key := sftpSessionKey(current.connectionID, current.contextID)
	return m.sessions[key] == current && m.generations[key] == current.generation
}

func (m *Manager) isCurrentSession(current *session) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	current.mu.RLock()
	defer current.mu.RUnlock()
	return m.isCurrentSessionLocked(current)
}

func (m *Manager) Open(connection domain.Connection, auth domain.AuthRequest, contextParts ...string) (domain.SFTPState, error) {
	return m.open(connection, auth, false, contextParts...)
}

func (m *Manager) Reconnect(connection domain.Connection, auth domain.AuthRequest, contextParts ...string) (domain.SFTPState, error) {
	contextID := ""
	if len(contextParts) > 0 {
		contextID = contextParts[0]
	}
	contextID = normalizeContextID(connection.ID, contextID)
	m.StopContext(connection.ID, contextID)
	return m.open(connection, auth, true, contextParts...)
}

func (m *Manager) open(connection domain.Connection, auth domain.AuthRequest, force bool, contextParts ...string) (domain.SFTPState, error) {
	contextID := ""
	terminalSessionID := ""
	if len(contextParts) > 0 {
		contextID = contextParts[0]
	}
	if len(contextParts) > 1 {
		terminalSessionID = contextParts[1]
	}
	contextID = normalizeContextID(connection.ID, contextID)
	key := sftpSessionKey(connection.ID, contextID)
	timeout := m.timeout()
	ctx, cancel := context.WithTimeout(m.ctx, timeout)
	defer cancel()

	m.mu.Lock()
	state := m.stateLocked(connection.ID, contextID)
	currentGeneration := m.generationLocked(connection.ID, contextID)
	currentSession := m.sessions[key]
	if !force && state.Status == domain.SFTPStatusOnline && currentSession != nil && state.Generation == currentGeneration {
		m.mu.Unlock()
		return state, nil
	}
	if !force && state.Status == domain.SFTPStatusConnecting && state.Generation == currentGeneration {
		m.mu.Unlock()
		return state, nil
	}
	if !force && currentSession != nil {
		m.mu.Unlock()
		return state, nil
	}
	generation := m.nextGenerationLocked(connection.ID, contextID)
	m.setStateLocked(domain.SFTPState{
		ConnectionID:      connection.ID,
		ContextID:         contextID,
		TerminalSessionID: terminalSessionID,
		Generation:        generation,
		Status:            domain.SFTPStatusConnecting,
		Active:            true,
		Mode:              domain.SFTPModeSFTP,
		Capabilities:      sftpModeCapabilities(domain.SFTPModeSFTP),
		Message:           "正在连接 SFTP",
		UpdatedAt:         now(),
	})
	m.mu.Unlock()

	transport, _, err := m.dial(ctx, connection, auth, timeout)
	if err != nil {
		return m.failOpen(connection, contextID, terminalSessionID, generation, err)
	}
	client, err := transport.OpenSFTP()
	if err != nil {
		if isSCPFallbackError(err) {
			return m.openSCPFallback(ctx, connection, auth, contextID, terminalSessionID, generation, transport, err)
		}
		_ = transport.Close()
		return m.failOpen(connection, contextID, terminalSessionID, generation, err)
	}
	if m.commitAuth != nil {
		if err := m.commitAuth(ctx, connection, auth); err != nil {
			_ = client.Close()
			_ = transport.Close()
			return m.failOpen(connection, contextID, terminalSessionID, generation, err)
		}
	}
	if sshclient.ShouldPersistObservedHostKey(connection, auth, transport.Fingerprint()) && m.saveHostKey != nil {
		if err := m.saveHostKey(ctx, connection.ID, transport.Fingerprint()); err != nil && m.logger != nil {
			classified := connectionerror.Classify(err, connection, "sftp.hostkey")
			classified.UserMessage = "服务器已连接，但主机指纹记录更新失败"
			m.logger.WriteConnection("error", classified.UserMessage, "sftp.hostkey", connection, &classified)
		}
	}
	home, err := client.Getwd()
	if err != nil || strings.TrimSpace(home) == "" {
		home = "."
	}
	childCtx, childCancel := context.WithCancel(m.ctx)
	current := &session{
		connectionID:      connection.ID,
		contextID:         contextID,
		terminalSessionID: terminalSessionID,
		generation:        generation,
		mode:              domain.SFTPModeSFTP,
		ctx:               childCtx,
		cancel:            childCancel,
		transport:         transport,
		client:            client,
		slot:              make(chan struct{}, 1),
		currentPath:       cleanRemotePath(home),
		homePath:          cleanRemotePath(home),
	}
	m.mu.Lock()
	if m.generations[key] != generation {
		m.mu.Unlock()
		m.closeSession(current)
		return m.State(connection.ID, contextID), context.Canceled
	}
	if previous := m.sessions[key]; previous != nil {
		previous.mu.Lock()
		m.closeSessionLocked(previous)
		previous.mu.Unlock()
	}
	m.sessions[key] = current
	onlineState := domain.SFTPState{
		ConnectionID:      connection.ID,
		ContextID:         contextID,
		TerminalSessionID: terminalSessionID,
		Generation:        generation,
		Status:            domain.SFTPStatusOnline,
		Active:            true,
		Mode:              domain.SFTPModeSFTP,
		Capabilities:      sftpModeCapabilities(domain.SFTPModeSFTP),
		CurrentPath:       current.currentPath,
		Message:           "SFTP 已连接",
		UpdatedAt:         now(),
	}
	m.setStateLocked(onlineState)
	m.mu.Unlock()
	m.startKeepalive(childCtx, current)
	m.log(connection, "info", "SFTP 已连接", "sftp.open", nil)
	return onlineState, nil
}

func (m *Manager) startKeepalive(ctx context.Context, current *session) {
	starter, ok := current.transport.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  current.connectionID,
		Subsystem: "sftp",
		ContextID: current.contextID,
		SessionID: current.terminalSessionID,
	}, func(failure sshclient.KeepaliveFailure) {
		m.handleKeepaliveFailure(current, failure)
	})
}

func (m *Manager) handleKeepaliveFailure(current *session, failure sshclient.KeepaliveFailure) {
	key := sftpSessionKey(current.connectionID, current.contextID)
	m.mu.Lock()
	if !m.isCurrentSessionLocked(current) {
		m.mu.Unlock()
		return
	}
	delete(m.sessions, key)
	generation := m.nextGenerationLocked(current.connectionID, current.contextID)
	state := domain.SFTPState{
		ConnectionID:      current.connectionID,
		ContextID:         current.contextID,
		TerminalSessionID: current.terminalSessionID,
		Generation:        generation,
		Status:            domain.SFTPStatusError,
		Active:            false,
		Mode:              current.mode,
		Capabilities:      sftpModeCapabilities(current.mode),
		CurrentPath:       current.currentPath,
		Message:           "SSH 保活失败，SFTP 连接已断开",
		UpdatedAt:         now(),
	}
	m.setStateLocked(state)
	for _, item := range m.transfers {
		item.mu.RLock()
		match := item.state.ConnectionID == current.connectionID &&
			item.state.ContextID == current.contextID &&
			isTransferCancelable(item.state.Status)
		item.mu.RUnlock()
		if match {
			item.cancel()
		}
	}
	m.mu.Unlock()
	m.closeSession(current)
	m.emitError(current.connectionID, current.contextID, "sftp.keepalive", "SSH_KEEPALIVE_FAILED", state.Message, sshclient.ErrKeepaliveFailed.Error())
	if m.logger != nil {
		m.logger.Write(
			"warn",
			fmt.Sprintf("SSH keepalive failed subsystem=sftp failures=%d", failure.FailureCount),
			"ssh.keepalive",
			current.connectionID,
			sshclient.ErrKeepaliveFailed,
		)
	}
}

func (m *Manager) failOpen(connection domain.Connection, contextID, terminalSessionID string, generation int64, err error) (domain.SFTPState, error) {
	classified := classifySFTPOpenError(err, connection)
	state := domain.SFTPState{
		ConnectionID:      connection.ID,
		ContextID:         normalizeContextID(connection.ID, contextID),
		TerminalSessionID: terminalSessionID,
		Generation:        generation,
		Status:            domain.SFTPStatusError,
		Active:            false,
		Mode:              domain.SFTPModeSFTP,
		Capabilities:      sftpModeCapabilities(domain.SFTPModeSFTP),
		Message:           classified.UserMessage,
		UpdatedAt:         now(),
	}
	m.mu.Lock()
	key := sftpSessionKey(connection.ID, state.ContextID)
	if m.generations[key] == generation {
		m.states[key] = state
		delete(m.sessions, key)
	}
	m.mu.Unlock()
	m.emitState(state)
	m.emitErrorWithGeneration(connection.ID, state.ContextID, generation, "", "sftp.open", classified.Code, classified.UserMessage, classified.TechnicalMessage)
	m.log(connection, "error", classified.UserMessage, "sftp.open", &classified)
	return state, errors.New(classified.UserMessage)
}

func (m *Manager) State(connectionID int64, contextParts ...string) domain.SFTPState {
	contextID := ""
	if len(contextParts) > 0 {
		contextID = contextParts[0]
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.stateLocked(connectionID, contextID)
}

func (m *Manager) Stop(connectionID int64) {
	m.mu.Lock()
	sessions := make([]*session, 0)
	contexts := make(map[string]string)
	for key, current := range m.sessions {
		if current.connectionID == connectionID {
			sessions = append(sessions, current)
			contexts[current.contextID] = current.terminalSessionID
			delete(m.sessions, key)
		}
	}
	for _, state := range m.states {
		if state.ConnectionID == connectionID {
			contexts[normalizeContextID(connectionID, state.ContextID)] = state.TerminalSessionID
		}
	}
	if len(contexts) == 0 {
		generation := m.nextGenerationLocked(connectionID, "")
		m.setStateLocked(domain.SFTPState{
			ConnectionID: connectionID,
			Generation:   generation,
			Status:       domain.SFTPStatusOffline,
			Active:       false,
			Message:      "SFTP closed",
			UpdatedAt:    now(),
		})
	}
	for contextID, terminalSessionID := range contexts {
		generation := m.nextGenerationLocked(connectionID, contextID)
		m.setStateLocked(domain.SFTPState{
			ConnectionID:      connectionID,
			ContextID:         contextID,
			TerminalSessionID: terminalSessionID,
			Generation:        generation,
			Status:            domain.SFTPStatusOffline,
			Active:            false,
			Message:           "SFTP closed",
			UpdatedAt:         now(),
		})
	}
	for _, item := range m.transfers {
		item.mu.RLock()
		match := item.state.ConnectionID == connectionID && isTransferCancelable(item.state.Status)
		item.mu.RUnlock()
		if match {
			item.cancel()
		}
	}
	m.mu.Unlock()
	for _, current := range sessions {
		m.closeSession(current)
	}
}

func (m *Manager) StopContext(connectionID int64, contextID string) {
	contextID = normalizeContextID(connectionID, contextID)
	key := sftpSessionKey(connectionID, contextID)
	m.mu.Lock()
	current := m.sessions[key]
	delete(m.sessions, key)
	generation := m.nextGenerationLocked(connectionID, contextID)
	state := domain.SFTPState{
		ConnectionID: connectionID,
		ContextID:    contextID,
		Generation:   generation,
		Status:       domain.SFTPStatusOffline,
		Active:       false,
		Message:      "SFTP closed",
		UpdatedAt:    now(),
	}
	if current != nil {
		state.TerminalSessionID = current.terminalSessionID
	}
	m.setStateLocked(state)
	for _, item := range m.transfers {
		item.mu.RLock()
		match := item.state.ConnectionID == connectionID &&
			item.state.ContextID == contextID &&
			isTransferCancelable(item.state.Status)
		item.mu.RUnlock()
		if match {
			item.cancel()
		}
	}
	m.mu.Unlock()
	if current != nil {
		m.closeSession(current)
	}
}

func (m *Manager) StopAll() {
	m.mu.RLock()
	ids := make([]int64, 0, len(m.sessions))
	seen := map[int64]struct{}{}
	for _, current := range m.sessions {
		if _, ok := seen[current.connectionID]; ok {
			continue
		}
		seen[current.connectionID] = struct{}{}
		ids = append(ids, current.connectionID)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		m.Stop(id)
	}
}

func (m *Manager) IsActive(connectionID int64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, current := range m.sessions {
		if current.connectionID == connectionID {
			return true
		}
	}
	return false
}

func (m *Manager) activeSession(connectionID int64, contextID string) (*session, error) {
	m.mu.RLock()
	current := m.sessions[sftpSessionKey(connectionID, contextID)]
	m.mu.RUnlock()
	if current == nil {
		return nil, errors.New("SFTP 尚未连接")
	}
	current.mu.RLock()
	closed := current.closed
	current.mu.RUnlock()
	if closed {
		return nil, errors.New("SFTP 会话已关闭")
	}
	return current, nil
}

func (m *Manager) invalidateSession(current *session, message string) {
	if current == nil {
		return
	}
	key := sftpSessionKey(current.connectionID, current.contextID)
	var closeTarget *session
	m.mu.Lock()
	if m.sessions[key] != current || m.generations[key] != current.generation {
		m.mu.Unlock()
		return
	}
	delete(m.sessions, key)
	generation := m.nextGenerationLocked(current.connectionID, current.contextID)
	m.setStateLocked(domain.SFTPState{
		ConnectionID:      current.connectionID,
		ContextID:         current.contextID,
		TerminalSessionID: current.terminalSessionID,
		Generation:        generation,
		Status:            domain.SFTPStatusError,
		Active:            false,
		Mode:              current.mode,
		Capabilities:      sftpModeCapabilities(current.mode),
		CurrentPath:       current.currentPath,
		Message:           message,
		UpdatedAt:         now(),
	})
	for _, item := range m.transfers {
		item.mu.RLock()
		match := item.state.ConnectionID == current.connectionID &&
			item.state.ContextID == current.contextID &&
			item.state.Generation == current.generation &&
			isTransferCancelable(item.state.Status)
		item.mu.RUnlock()
		if match {
			item.cancel()
		}
	}
	closeTarget = current
	m.mu.Unlock()
	m.closeSession(closeTarget)
}

func (m *Manager) closeSession(current *session) {
	current.mu.Lock()
	m.closeSessionLocked(current)
	current.mu.Unlock()
}

func (m *Manager) closeSessionLocked(current *session) {
	if current.closed {
		return
	}
	current.closed = true
	current.cancel()
	if current.client != nil {
		_ = current.client.Close()
	}
	if current.transport != nil {
		_ = current.transport.Close()
	}
}

func (m *Manager) stateLocked(connectionID int64, contextID string) domain.SFTPState {
	contextID = normalizeContextID(connectionID, contextID)
	key := sftpSessionKey(connectionID, contextID)
	if state, ok := m.states[key]; ok {
		if state.Generation == 0 {
			state.Generation = m.generations[key]
		}
		if state.Mode == "" {
			state.Mode = domain.SFTPModeSFTP
		}
		if state.ContextID == "" {
			state.ContextID = contextID
		}
		if state.Capabilities.Browse == "" {
			state.Capabilities = sftpModeCapabilities(state.Mode)
		}
		return state
	}
	return domain.SFTPState{
		ConnectionID: connectionID,
		ContextID:    contextID,
		Generation:   m.generations[key],
		Status:       domain.SFTPStatusOffline,
		Active:       false,
		Mode:         domain.SFTPModeSFTP,
		Capabilities: sftpModeCapabilities(domain.SFTPModeSFTP),
		Message:      "SFTP 未连接",
		UpdatedAt:    now(),
	}
}

func (m *Manager) setStateLocked(state domain.SFTPState) {
	if state.Mode == "" {
		state.Mode = domain.SFTPModeSFTP
	}
	state.ContextID = normalizeContextID(state.ConnectionID, state.ContextID)
	if state.Generation == 0 {
		state.Generation = m.generationLocked(state.ConnectionID, state.ContextID)
	}
	if state.Capabilities.Browse == "" {
		state.Capabilities = sftpModeCapabilities(state.Mode)
	}
	m.states[sftpSessionKey(state.ConnectionID, state.ContextID)] = state
	m.emitState(state)
}

func sftpModeCapabilities(mode domain.SFTPMode) domain.SFTPCapabilities {
	if mode == domain.SFTPModeSCP {
		return domain.SFTPCapabilities{
			Browse:            domain.SFTPBrowseFull,
			UploadFile:        true,
			DownloadFile:      true,
			UploadDirectory:   true,
			DownloadDirectory: true,
			Mkdir:             true,
			Rename:            true,
			Delete:            true,
			EditText:          true,
		}
	}
	return domain.SFTPCapabilities{
		Browse:            domain.SFTPBrowseFull,
		UploadFile:        true,
		DownloadFile:      true,
		UploadDirectory:   true,
		DownloadDirectory: true,
		Mkdir:             true,
		Rename:            true,
		Delete:            true,
		EditText:          true,
	}
}
