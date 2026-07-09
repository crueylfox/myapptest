package sftpmanager

import (
	"context"
	"hostdeck/internal/connectionerror"
	"hostdeck/internal/domain"
	"hostdeck/internal/sshclient"
)

func (m *Manager) openSCPFallback(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
	contextID string,
	terminalSessionID string,
	generation int64,
	transport Transport,
	openErr error,
) (domain.SFTPState, error) {
	if m.commitAuth != nil {
		if err := m.commitAuth(ctx, connection, auth); err != nil {
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
	home := resolveSCPShellHome(ctx, transport)
	childCtx, childCancel := context.WithCancel(m.ctx)
	current := &session{
		connectionID:      connection.ID,
		contextID:         contextID,
		terminalSessionID: terminalSessionID,
		generation:        generation,
		mode:              domain.SFTPModeSCP,
		ctx:               childCtx,
		cancel:            childCancel,
		transport:         transport,
		slot:              make(chan struct{}, 1),
		currentPath:       home,
		homePath:          home,
	}
	m.mu.Lock()
	key := sftpSessionKey(connection.ID, contextID)
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
	state := domain.SFTPState{
		ConnectionID:      connection.ID,
		ContextID:         contextID,
		TerminalSessionID: terminalSessionID,
		Generation:        generation,
		Status:            domain.SFTPStatusOnline,
		Active:            true,
		Mode:              domain.SFTPModeSCP,
		Capabilities:      sftpModeCapabilities(domain.SFTPModeSCP),
		CurrentPath:       home,
		Message:           "当前服务器不支持 SFTP，已使用 SCP 兼容模式，部分文件管理能力受限。",
		UpdatedAt:         now(),
	}
	m.setStateLocked(state)
	m.mu.Unlock()
	m.startKeepalive(childCtx, current)
	classified := classifySFTPOpenError(openErr, connection)
	m.emitError(connection.ID, contextID, "sftp.open.fallback", classified.Code, state.Message, classified.TechnicalMessage)
	m.log(connection, "warn", state.Message, "sftp.open.fallback", &classified)
	return state, nil
}
