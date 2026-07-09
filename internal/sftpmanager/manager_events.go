package sftpmanager

import "hostdeck/internal/domain"

func (m *Manager) emitState(state domain.SFTPState) {
	if m.emitter != nil {
		m.emitter.State(state)
	}
}

func (m *Manager) emitEntries(result domain.SFTPListResult) {
	if m.emitter != nil {
		m.emitter.Entries(result)
	}
}

func (m *Manager) emitTransfer(state domain.SFTPTransferState) {
	if m.emitter != nil {
		m.emitter.Transfer(state)
	}
}

func (m *Manager) emitError(connectionID int64, contextID string, operation, code, message, technical string) {
	if m.emitter != nil {
		contextID = normalizeContextID(connectionID, contextID)
		m.emitter.Error(domain.SFTPErrorEvent{
			ConnectionID: connectionID,
			ContextID:    contextID,
			Generation:   m.currentGeneration(connectionID, contextID),
			Operation:    operation,
			Code:         code,
			Message:      message,
			Technical:    technical,
			UpdatedAt:    now(),
		})
	}
}

func (m *Manager) log(
	connection domain.Connection,
	level string,
	message string,
	operation string,
	classified *domain.ConnectionError,
) {
	if m.logger != nil {
		m.logger.WriteConnection(level, message, operation, connection, classified)
	}
}
