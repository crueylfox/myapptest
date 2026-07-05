package connectionstate

import (
	"sync"
	"time"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
)

type Emitter func(domain.ConnectionRuntimeState)

type Tracker struct {
	mu      sync.RWMutex
	records map[int64]*record
	blocked map[int64]bool
	emit    Emitter
}

type record struct {
	monitorStatus domain.ConnectionStatus
	monitorActive bool
	terminals     map[string]string
	sftpStatus    domain.SFTPStatus
	sftpActive    bool
	disconnecting bool
	lastError     *domain.ConnectionError
}

func New(emit Emitter) *Tracker {
	return &Tracker{
		records: make(map[int64]*record),
		blocked: make(map[int64]bool),
		emit:    emit,
	}
}

func (t *Tracker) UpdateMonitor(snapshot domain.MonitorSnapshot) {
	t.mu.Lock()
	if t.blocked[snapshot.ConnectionID] {
		t.mu.Unlock()
		return
	}
	current := t.record(snapshot.ConnectionID)
	current.monitorStatus = snapshot.Status
	current.monitorActive = snapshot.MonitorActive
	if snapshot.ConnectionError != nil {
		current.lastError = cloneError(snapshot.ConnectionError)
	} else if snapshot.Status == domain.StatusConnecting || snapshot.Status == domain.StatusOnline {
		current.lastError = nil
	}
	state := buildState(snapshot.ConnectionID, current)
	t.mu.Unlock()
	t.publish(state)
}

func (t *Tracker) UpdateTerminal(
	sessionID string,
	connectionID int64,
	status string,
	connectionErr *domain.ConnectionError,
) {
	t.mu.Lock()
	if t.blocked[connectionID] {
		t.mu.Unlock()
		return
	}
	current := t.record(connectionID)
	switch status {
	case "connecting", "online":
		current.terminals[sessionID] = status
	default:
		delete(current.terminals, sessionID)
	}
	if connectionErr != nil {
		current.lastError = cloneError(connectionErr)
	} else if status == "connecting" || status == "online" {
		current.lastError = nil
	}
	state := buildState(connectionID, current)
	t.mu.Unlock()
	t.publish(state)
}

func (t *Tracker) UpdateSFTP(state domain.SFTPState) {
	t.mu.Lock()
	if t.blocked[state.ConnectionID] {
		t.mu.Unlock()
		return
	}
	current := t.record(state.ConnectionID)
	current.sftpStatus = state.Status
	current.sftpActive = state.Active &&
		(state.Status == domain.SFTPStatusConnecting || state.Status == domain.SFTPStatusOnline)
	runtimeState := buildState(state.ConnectionID, current)
	t.mu.Unlock()
	t.publish(runtimeState)
}

func (t *Tracker) RecordFailure(connectionID int64, connectionErr domain.ConnectionError) {
	t.mu.Lock()
	if t.blocked[connectionID] {
		t.mu.Unlock()
		return
	}
	current := t.record(connectionID)
	current.lastError = cloneError(&connectionErr)
	state := buildState(connectionID, current)
	t.mu.Unlock()
	t.publish(state)
}

func (t *Tracker) BeginConnect(connectionID int64) {
	t.mu.Lock()
	delete(t.blocked, connectionID)
	current := t.record(connectionID)
	current.disconnecting = false
	current.lastError = nil
	t.mu.Unlock()
}

func (t *Tracker) BeginDisconnect(connectionID int64) {
	t.mu.Lock()
	current := t.record(connectionID)
	current.disconnecting = true
	state := buildState(connectionID, current)
	t.mu.Unlock()
	t.publish(state)
}

func (t *Tracker) CompleteDisconnect(connectionID int64) {
	t.mu.Lock()
	current := t.record(connectionID)
	current.disconnecting = false
	current.monitorActive = false
	current.monitorStatus = domain.StatusDisconnected
	current.terminals = make(map[string]string)
	current.sftpStatus = domain.SFTPStatusOffline
	current.sftpActive = false
	current.lastError = nil
	t.blocked[connectionID] = true
	state := buildState(connectionID, current)
	t.mu.Unlock()
	t.publish(state)
}

func (t *Tracker) Remove(connectionID int64) {
	t.mu.Lock()
	delete(t.records, connectionID)
	t.blocked[connectionID] = true
	t.mu.Unlock()
	t.publish(domain.ConnectionRuntimeState{
		ConnectionID: connectionID,
		Status:       domain.StatusOffline,
		UpdatedAt:    now(),
	})
}

func (t *Tracker) Get(connectionID int64) domain.ConnectionRuntimeState {
	t.mu.RLock()
	current := t.records[connectionID]
	if current == nil {
		t.mu.RUnlock()
		return domain.ConnectionRuntimeState{
			ConnectionID: connectionID,
			Status:       domain.StatusOffline,
			UpdatedAt:    now(),
		}
	}
	state := buildState(connectionID, current)
	t.mu.RUnlock()
	return state
}

func (t *Tracker) HasTerminalConnecting(connectionID int64) bool {
	state := t.Get(connectionID)
	return state.TerminalConnecting
}

func (t *Tracker) record(connectionID int64) *record {
	current := t.records[connectionID]
	if current == nil {
		current = &record{monitorStatus: domain.StatusOffline, terminals: make(map[string]string)}
		t.records[connectionID] = current
	}
	return current
}

func (t *Tracker) publish(state domain.ConnectionRuntimeState) {
	if t.emit != nil {
		t.emit(state)
	}
}

func buildState(connectionID int64, current *record) domain.ConnectionRuntimeState {
	state := domain.ConnectionRuntimeState{
		ConnectionID:  connectionID,
		MonitorActive: current.monitorActive,
		SFTPActive:    current.sftpActive,
		LastError:     cloneError(current.lastError),
		UpdatedAt:     now(),
	}
	for _, status := range current.terminals {
		if status == "online" {
			state.TerminalActive = true
		}
		if status == "connecting" {
			state.TerminalConnecting = true
		}
	}
	state.Connecting = state.TerminalConnecting ||
		(current.sftpActive && current.sftpStatus == domain.SFTPStatusConnecting) ||
		(current.monitorActive &&
			(current.monitorStatus == domain.StatusConnecting || current.monitorStatus == domain.StatusReconnecting))
	state.HasActiveSession = state.MonitorActive || state.TerminalActive || state.TerminalConnecting || state.SFTPActive

	switch {
	case current.disconnecting:
		state.Status = domain.StatusDisconnecting
	case state.TerminalActive || state.SFTPActive || current.monitorStatus == domain.StatusOnline:
		state.Status = domain.StatusOnline
	case state.LastError != nil:
		state.Status = connectionerror.StatusForCode(state.LastError.Code)
	case state.Connecting:
		state.Status = domain.StatusConnecting
	case current.monitorStatus == domain.StatusDisconnected:
		state.Status = domain.StatusDisconnected
	default:
		state.Status = domain.StatusOffline
	}
	return state
}

func cloneError(source *domain.ConnectionError) *domain.ConnectionError {
	if source == nil {
		return nil
	}
	result := *source
	return &result
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
