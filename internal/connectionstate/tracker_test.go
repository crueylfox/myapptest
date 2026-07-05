package connectionstate

import (
	"testing"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
)

func TestTrackerConnectionLifecycle(t *testing.T) {
	tracker := New(nil)
	connectionID := int64(11)

	tracker.UpdateMonitor(domain.MonitorSnapshot{
		ConnectionID:  connectionID,
		Status:        domain.StatusConnecting,
		MonitorActive: true,
	})
	state := tracker.Get(connectionID)
	if !state.Connecting || !state.HasActiveSession || state.Status != domain.StatusConnecting {
		t.Fatalf("connecting state = %+v", state)
	}

	tracker.UpdateMonitor(domain.MonitorSnapshot{
		ConnectionID:  connectionID,
		Status:        domain.StatusOnline,
		MonitorActive: true,
	})
	state = tracker.Get(connectionID)
	if state.Status != domain.StatusOnline || !state.MonitorActive {
		t.Fatalf("online state = %+v", state)
	}

	tracker.UpdateTerminal("terminal-1", connectionID, "connecting", nil)
	if !tracker.HasTerminalConnecting(connectionID) {
		t.Fatal("terminal connecting state not tracked")
	}
	tracker.UpdateTerminal("terminal-1", connectionID, "online", nil)
	state = tracker.Get(connectionID)
	if !state.TerminalActive || state.TerminalConnecting {
		t.Fatalf("terminal state = %+v", state)
	}

	tracker.BeginDisconnect(connectionID)
	if tracker.Get(connectionID).Status != domain.StatusDisconnecting {
		t.Fatal("disconnecting state not published")
	}
	tracker.CompleteDisconnect(connectionID)
	state = tracker.Get(connectionID)
	if state.Status != domain.StatusDisconnected || state.HasActiveSession {
		t.Fatalf("disconnected state = %+v", state)
	}
}

func TestTrackerFailureCanRetry(t *testing.T) {
	tracker := New(nil)
	connectionID := int64(12)
	authError := domain.ConnectionError{
		Code:        connectionerror.CodeAuthFailed,
		UserMessage: "SSH 身份验证失败",
	}
	tracker.UpdateTerminal("terminal-1", connectionID, "connecting", nil)
	tracker.UpdateTerminal("terminal-1", connectionID, "error", &authError)

	state := tracker.Get(connectionID)
	if state.Status != domain.StatusAuthFailed || state.HasActiveSession || state.TerminalConnecting {
		t.Fatalf("failed state retained an active session: %+v", state)
	}

	tracker.UpdateTerminal("terminal-2", connectionID, "connecting", nil)
	state = tracker.Get(connectionID)
	if state.Status != domain.StatusConnecting || !state.Connecting || !state.HasActiveSession {
		t.Fatalf("retry state = %+v", state)
	}
	tracker.UpdateTerminal("terminal-2", connectionID, "online", nil)
	state = tracker.Get(connectionID)
	if state.Status != domain.StatusOnline || state.LastError != nil {
		t.Fatalf("successful retry state = %+v", state)
	}
}

func TestTrackerBeginConnectClearsPreviousFailure(t *testing.T) {
	tracker := New(nil)
	connectionID := int64(15)
	tracker.RecordFailure(connectionID, domain.ConnectionError{
		Code:        connectionerror.CodeAuthFailed,
		UserMessage: "SSH 身份验证失败",
	})
	if tracker.Get(connectionID).LastError == nil {
		t.Fatal("failure was not retained before retry")
	}

	tracker.BeginConnect(connectionID)
	state := tracker.Get(connectionID)
	if state.LastError != nil || state.Status != domain.StatusOffline {
		t.Fatalf("begin connect retained stale failure: %+v", state)
	}
}

func TestTrackerRetryableMonitorFailureRemainsStoppable(t *testing.T) {
	tracker := New(nil)
	connectionID := int64(13)
	timeoutError := domain.ConnectionError{
		Code:        connectionerror.CodeTimeout,
		UserMessage: "SSH 连接超时",
		Retryable:   true,
	}
	tracker.UpdateMonitor(domain.MonitorSnapshot{
		ConnectionID:    connectionID,
		Status:          domain.StatusReconnecting,
		MonitorActive:   true,
		ConnectionError: &timeoutError,
	})
	state := tracker.Get(connectionID)
	if state.Status != domain.StatusTimeout || !state.HasActiveSession || !state.Connecting {
		t.Fatalf("retryable state = %+v", state)
	}
}

func TestTrackerIgnoresLateEventsAfterExplicitDisconnect(t *testing.T) {
	tracker := New(nil)
	connectionID := int64(14)
	tracker.BeginConnect(connectionID)
	tracker.UpdateMonitor(domain.MonitorSnapshot{
		ConnectionID: connectionID, Status: domain.StatusOnline, MonitorActive: true,
	})
	tracker.CompleteDisconnect(connectionID)

	tracker.UpdateMonitor(domain.MonitorSnapshot{
		ConnectionID: connectionID, Status: domain.StatusOnline, MonitorActive: true,
	})
	tracker.UpdateTerminal("late-terminal", connectionID, "online", nil)
	state := tracker.Get(connectionID)
	if state.Status != domain.StatusDisconnected || state.HasActiveSession {
		t.Fatalf("late event revived disconnected server: %+v", state)
	}

	tracker.BeginConnect(connectionID)
	tracker.UpdateTerminal("new-terminal", connectionID, "online", nil)
	state = tracker.Get(connectionID)
	if state.Status != domain.StatusOnline || !state.TerminalActive {
		t.Fatalf("explicit reconnect did not reopen lifecycle: %+v", state)
	}
}

func TestTrackerTracksSFTPAndSuppressesLateSFTPAfterDisconnect(t *testing.T) {
	tracker := New(nil)
	connectionID := int64(16)
	tracker.BeginConnect(connectionID)
	tracker.UpdateSFTP(domain.SFTPState{
		ConnectionID: connectionID,
		Status:       domain.SFTPStatusOnline,
		Active:       true,
	})
	state := tracker.Get(connectionID)
	if state.Status != domain.StatusOnline || !state.SFTPActive || !state.HasActiveSession {
		t.Fatalf("sftp state = %+v", state)
	}

	tracker.CompleteDisconnect(connectionID)
	tracker.UpdateSFTP(domain.SFTPState{
		ConnectionID: connectionID,
		Status:       domain.SFTPStatusOnline,
		Active:       true,
	})
	state = tracker.Get(connectionID)
	if state.Status != domain.StatusDisconnected || state.SFTPActive || state.HasActiveSession {
		t.Fatalf("late sftp event revived disconnected server: %+v", state)
	}
}
