package servicemanager

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"serverpilot/internal/domain"
)

type journalWatcher struct {
	serverID  int64
	unitName  string
	watchID   string
	format    string
	cancel    context.CancelFunc
	transport Transport
	session   StreamingCommand
	sequence  int64
	once      sync.Once
}

func (m *Manager) Journal(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceJournalRequest,
) (domain.SystemServiceJournalResponse, error) {
	lineLimit := normalizeJournalLineLimit(request.LineLimit)
	_, priority, err := normalizeJournalPriority(request.Priority)
	if err != nil {
		return domain.SystemServiceJournalResponse{}, err
	}
	if capability, ok := m.cachedCapability(connection.ID); ok {
		serviceID, err := validateServiceIdentifier(capability.InitSystem, domain.SystemServiceActionRequest{
			ServerID:  request.ServerID,
			UnitName:  request.UnitName,
			ServiceID: request.UnitName,
		})
		if err != nil {
			return domain.SystemServiceJournalResponse{}, err
		}
		return m.journalWithCapability(connection, auth, capability, serviceID, lineLimit, priority, request.CurrentBootOnly)
	}
	unitName := request.UnitName
	ctx, op := m.beginOperation(connection.ID, "journal", unitName, false)
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, journalReadTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		return domain.SystemServiceJournalResponse{}, errors.New(userMessageForJournalError(err, "读取系统服务日志失败。"))
	}
	defer transport.Close()
	capability, err := m.ensureCapability(commandCtx, transport, connection.ID)
	if err != nil {
		return domain.SystemServiceJournalResponse{}, err
	}
	serviceID, err := validateServiceIdentifier(capability.InitSystem, domain.SystemServiceActionRequest{
		ServerID:  request.ServerID,
		UnitName:  request.UnitName,
		ServiceID: request.UnitName,
	})
	if err != nil {
		return domain.SystemServiceJournalResponse{}, err
	}
	lines, fallback, err := m.readJournalWithCapability(commandCtx, transport, capability, serviceID, lineLimit, priority, request.CurrentBootOnly)
	if err != nil {
		return domain.SystemServiceJournalResponse{}, err
	}
	return domain.SystemServiceJournalResponse{
		ServerID:  connection.ID,
		UnitName:  serviceID,
		Lines:     lines,
		Fallback:  fallback,
		Timestamp: timestamp(),
	}, nil
}

func (m *Manager) journalWithCapability(
	connection domain.Connection,
	auth domain.AuthRequest,
	capability domain.ServiceManagerCapability,
	serviceID string,
	lineLimit int,
	priority string,
	currentBootOnly bool,
) (domain.SystemServiceJournalResponse, error) {
	ctx, op := m.beginOperation(connection.ID, "journal", serviceID, false)
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, journalReadTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		return domain.SystemServiceJournalResponse{}, errors.New(userMessageForJournalError(err, "读取系统服务日志失败。"))
	}
	defer transport.Close()
	lines, fallback, err := m.readJournalWithCapability(commandCtx, transport, capability, serviceID, lineLimit, priority, currentBootOnly)
	if err != nil {
		return domain.SystemServiceJournalResponse{}, err
	}
	return domain.SystemServiceJournalResponse{
		ServerID:  connection.ID,
		UnitName:  serviceID,
		Lines:     lines,
		Fallback:  fallback,
		Timestamp: timestamp(),
	}, nil
}

func (m *Manager) readJournalWithCapability(
	ctx context.Context,
	transport Transport,
	capability domain.ServiceManagerCapability,
	serviceID string,
	lineLimit int,
	priority string,
	currentBootOnly bool,
) ([]domain.ServiceJournalLine, bool, error) {
	switch capability.InitSystem {
	case domain.ServiceManagerInitSystemSystemd:
		return m.readJournalSnapshot(ctx, transport, serviceID, lineLimit, priority, currentBootOnly)
	case domain.ServiceManagerInitSystemOpenWrtProcd:
		if !capability.SupportsJournal {
			return nil, false, errors.New(logreadUnavailableMessage)
		}
		return readLogreadSnapshot(ctx, transport, serviceID, lineLimit)
	default:
		return nil, false, errors.New(journalUnsupportedMessage)
	}
}

func (m *Manager) StartJournalFollow(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceJournalRequest,
) (domain.SystemServiceJournalFollowResponse, error) {
	if capability, ok := m.cachedCapability(connection.ID); ok && capability.InitSystem == domain.ServiceManagerInitSystemOpenWrtProcd {
		if _, err := validateProcdServiceID(request.UnitName); err != nil {
			return domain.SystemServiceJournalFollowResponse{}, err
		}
		return domain.SystemServiceJournalFollowResponse{}, errors.New(logreadFollowUnsupportedMessage)
	}
	unitName, err := validateUnitName(request.UnitName)
	if err != nil {
		return domain.SystemServiceJournalFollowResponse{}, err
	}
	if capability, ok := m.cachedCapability(connection.ID); ok && capability.InitSystem != domain.ServiceManagerInitSystemSystemd {
		return domain.SystemServiceJournalFollowResponse{}, errors.New(journalUnsupportedMessage)
	}
	_, priority, err := normalizeJournalPriority(request.Priority)
	if err != nil {
		return domain.SystemServiceJournalFollowResponse{}, err
	}
	watchID := fmt.Sprintf("service-journal-%d-%d", connection.ID, time.Now().UnixNano())
	ctx, cancel := context.WithCancel(m.ctx)
	m.emitJournalState(domain.ServiceJournalStateEvent{
		WatchID:   watchID,
		ServerID:  connection.ID,
		UnitName:  unitName,
		State:     "connecting",
		Timestamp: timestamp(),
	})
	transport, err := m.dialJournalTransport(ctx, connection, auth)
	if err != nil {
		cancel()
		message := userMessageForJournalError(err, "启动系统服务实时日志失败。")
		m.emitJournalError(watchID, connection.ID, unitName, "SERVICE_JOURNAL_CONNECT_FAILED", message)
		return domain.SystemServiceJournalFollowResponse{}, errors.New(message)
	}
	session, format, err := m.startJournalStreaming(ctx, transport, unitName, priority, request.CurrentBootOnly)
	if err != nil {
		cancel()
		_ = transport.Close()
		message := userMessageForJournalError(err, "启动系统服务实时日志失败。")
		m.emitJournalError(watchID, connection.ID, unitName, "SERVICE_JOURNAL_START_FAILED", message)
		return domain.SystemServiceJournalFollowResponse{}, errors.New(message)
	}
	watcher := &journalWatcher{
		serverID:  connection.ID,
		unitName:  unitName,
		watchID:   watchID,
		format:    format,
		cancel:    cancel,
		transport: transport,
		session:   session,
	}
	m.registerJournalWatcher(watcher)
	go m.runJournalWatcher(ctx, watcher)
	m.emitJournalState(domain.ServiceJournalStateEvent{
		WatchID:   watchID,
		ServerID:  connection.ID,
		UnitName:  unitName,
		State:     "running",
		Timestamp: timestamp(),
	})
	return domain.SystemServiceJournalFollowResponse{
		WatchID:   watchID,
		ServerID:  connection.ID,
		UnitName:  unitName,
		StartedAt: timestamp(),
	}, nil
}

func (m *Manager) StopJournalFollow(request domain.StopSystemServiceJournalFollowRequest) {
	if request.WatchID == "" {
		return
	}
	m.mu.Lock()
	watcher := m.journalWatchers[request.WatchID]
	if watcher != nil && request.ServerID > 0 && watcher.serverID != request.ServerID {
		watcher = nil
	}
	if watcher != nil {
		delete(m.journalWatchers, watcher.watchID)
		delete(m.journalByScope, journalScope(watcher.serverID, watcher.unitName))
	}
	m.mu.Unlock()
	if watcher != nil {
		m.stopJournalWatcher(watcher, "stopped", true)
	}
}

func (m *Manager) readJournalSnapshot(
	ctx context.Context,
	transport Transport,
	unitName string,
	lineLimit int,
	priority string,
	currentBootOnly bool,
) ([]domain.ServiceJournalLine, bool, error) {
	output, format, err := m.runJournalSnapshotCommand(ctx, transport, unitName, lineLimit, priority, currentBootOnly, false, "json")
	if err != nil && isJournalFormatError(err) {
		output, format, err = m.runJournalSnapshotCommand(ctx, transport, unitName, lineLimit, priority, currentBootOnly, false, "short-iso")
	}
	if err != nil && isJournalPermissionError(err) && !m.isRoot(ctx, transport) {
		output, format, err = m.runJournalSnapshotCommand(ctx, transport, unitName, lineLimit, priority, currentBootOnly, true, "json")
		if err != nil && isJournalFormatError(err) {
			output, format, err = m.runJournalSnapshotCommand(ctx, transport, unitName, lineLimit, priority, currentBootOnly, true, "short-iso")
		}
	}
	if err != nil {
		return nil, false, errors.New(userMessageForJournalError(err, "读取系统服务日志失败。"))
	}
	lines, fallback := parseJournalOutput(0, unitName, output, format)
	return lines, fallback || format != "json", nil
}

func (m *Manager) runJournalSnapshotCommand(
	ctx context.Context,
	transport Transport,
	unitName string,
	lineLimit int,
	priority string,
	currentBootOnly bool,
	sudo bool,
	format string,
) (string, string, error) {
	output, err := transport.Run(ctx, journalSnapshotCommand(unitName, lineLimit, priority, currentBootOnly, sudo, format))
	if err != nil {
		return "", format, err
	}
	return output, format, nil
}

func (m *Manager) dialJournalTransport(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
) (Transport, error) {
	transport, _, err := m.dial(ctx, connection, auth, m.timeout())
	if err != nil {
		return nil, err
	}
	m.persistHostKey(ctx, connection, auth, transport)
	m.startKeepalive(ctx, transport, connection.ID)
	return transport, nil
}

func (m *Manager) startJournalStreaming(
	ctx context.Context,
	transport Transport,
	unitName string,
	priority string,
	currentBootOnly bool,
) (StreamingCommand, string, error) {
	command := journalFollowCommand(unitName, priority, currentBootOnly, false, "json")
	session, err := transport.StartStreamingCommand(ctx, command)
	if err == nil {
		return session, "json", nil
	}
	if isJournalFormatError(err) {
		session, err = transport.StartStreamingCommand(ctx, journalFollowCommand(unitName, priority, currentBootOnly, false, "short-iso"))
		if err == nil {
			return session, "short-iso", nil
		}
	}
	if isJournalPermissionError(err) {
		session, err = transport.StartStreamingCommand(ctx, journalFollowCommand(unitName, priority, currentBootOnly, true, "json"))
		if err == nil {
			return session, "json", nil
		}
		if isJournalFormatError(err) {
			session, err = transport.StartStreamingCommand(ctx, journalFollowCommand(unitName, priority, currentBootOnly, true, "short-iso"))
			if err == nil {
				return session, "short-iso", nil
			}
		}
	}
	return nil, "", err
}

func (m *Manager) registerJournalWatcher(watcher *journalWatcher) {
	scope := journalScope(watcher.serverID, watcher.unitName)
	var previous *journalWatcher
	m.mu.Lock()
	if previousID := m.journalByScope[scope]; previousID != "" {
		previous = m.journalWatchers[previousID]
		delete(m.journalWatchers, previousID)
	}
	m.journalByScope[scope] = watcher.watchID
	m.journalWatchers[watcher.watchID] = watcher
	m.mu.Unlock()
	if previous != nil {
		m.stopJournalWatcher(previous, "replaced", true)
	}
}

func (m *Manager) runJournalWatcher(ctx context.Context, watcher *journalWatcher) {
	stderrDone := make(chan string, 1)
	go drainJournalStderr(watcher.session.Stderr(), stderrDone)
	lineDone := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(watcher.session.Stdout())
		scanner.Buffer(make([]byte, 0, 64*1024), maxJournalMessageBytes*2)
		for scanner.Scan() {
			if !m.isCurrentJournalWatcher(watcher) {
				break
			}
			watcher.sequence++
			line, _ := parseJournalLine(watcher.sequence, strings.TrimRight(scanner.Text(), "\r"), watcher.format)
			m.emitJournalLine(domain.ServiceJournalLineEvent{
				WatchID:   watcher.watchID,
				ServerID:  watcher.serverID,
				UnitName:  watcher.unitName,
				Sequence:  watcher.sequence,
				Line:      line,
				Timestamp: timestamp(),
			})
		}
		lineDone <- scanner.Err()
	}()
	waitDone := make(chan error, 1)
	go func() {
		waitDone <- watcher.session.Wait()
	}()

	var scanErr error
	var waitErr error
	lineOpen := true
	waitOpen := true
	ctxDone := ctx.Done()
	for lineOpen || waitOpen {
		select {
		case <-ctxDone:
			watcher.close()
			ctxDone = nil
		case err := <-lineDone:
			scanErr = err
			lineOpen = false
			lineDone = nil
		case err := <-waitDone:
			waitErr = err
			waitOpen = false
			waitDone = nil
		}
	}
	stderrText := <-stderrDone
	if !m.removeJournalWatcher(watcher) {
		return
	}
	watcher.close()
	if scanErr != nil && ctx.Err() == nil {
		m.emitJournalError(watcher.watchID, watcher.serverID, watcher.unitName, "SERVICE_JOURNAL_READ_FAILED", "读取系统服务日志失败。")
	}
	if waitErr != nil && ctx.Err() == nil {
		m.emitJournalError(watcher.watchID, watcher.serverID, watcher.unitName, "SERVICE_JOURNAL_STREAM_FAILED", userMessageForJournalError(errors.New(stderrText), "系统服务实时日志已停止。"))
		m.emitJournalCompleted(watcher.watchID, watcher.serverID, watcher.unitName, "error")
		return
	}
	reason := "completed"
	if ctx.Err() != nil {
		reason = "stopped"
	}
	m.emitJournalCompleted(watcher.watchID, watcher.serverID, watcher.unitName, reason)
}

func drainJournalStderr(reader io.Reader, done chan<- string) {
	defer close(done)
	var builder strings.Builder
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 1024), 32*1024)
	for scanner.Scan() {
		if builder.Len() < 4096 {
			builder.WriteString(scanner.Text())
			builder.WriteByte('\n')
		}
	}
	done <- builder.String()
}

func (m *Manager) removeJournalWatcher(watcher *journalWatcher) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.journalWatchers[watcher.watchID] != watcher {
		return false
	}
	delete(m.journalWatchers, watcher.watchID)
	delete(m.journalByScope, journalScope(watcher.serverID, watcher.unitName))
	return true
}

func (m *Manager) isCurrentJournalWatcher(watcher *journalWatcher) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.journalWatchers[watcher.watchID] == watcher
}

func (m *Manager) stopJournalWatcher(watcher *journalWatcher, reason string, emit bool) {
	watcher.close()
	if emit {
		m.emitJournalCompleted(watcher.watchID, watcher.serverID, watcher.unitName, reason)
	}
}

func (w *journalWatcher) close() {
	w.once.Do(func() {
		w.cancel()
		if w.session != nil {
			_ = w.session.Close()
		}
		if w.transport != nil {
			_ = w.transport.Close()
		}
	})
}

func journalScope(serverID int64, unitName string) string {
	return fmt.Sprintf("%d:%s", serverID, unitName)
}

func userMessageForJournalError(err error, fallback string) string {
	if err == nil {
		return ""
	}
	if isTimeoutError(err) {
		return journalTimeoutMessage
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "journalctl") &&
		(strings.Contains(message, "not found") || strings.Contains(message, "no such file")):
		return journalUnsupportedMessage
	case isJournalPermissionError(err):
		return journalPermissionMessage
	default:
		return fallback
	}
}

func isJournalPermissionError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "permission denied") ||
		strings.Contains(message, "access denied") ||
		strings.Contains(message, "not permitted") ||
		strings.Contains(message, "authentication is required") ||
		strings.Contains(message, "a password is required") ||
		strings.Contains(message, "not in the sudoers")
}

func isJournalFormatError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unsupported output") ||
		strings.Contains(message, "unknown output") ||
		strings.Contains(message, "invalid output") ||
		strings.Contains(message, "invalid argument")
}

func (m *Manager) emitJournalState(event domain.ServiceJournalStateEvent) {
	m.mu.Lock()
	emitter := m.emitter
	m.mu.Unlock()
	if emitter != nil {
		emitter.JournalState(event)
	}
}

func (m *Manager) emitJournalLine(event domain.ServiceJournalLineEvent) {
	m.mu.Lock()
	emitter := m.emitter
	m.mu.Unlock()
	if emitter != nil {
		emitter.JournalLine(event)
	}
}

func (m *Manager) emitJournalError(watchID string, serverID int64, unitName string, code string, message string) {
	m.mu.Lock()
	emitter := m.emitter
	m.mu.Unlock()
	if emitter != nil {
		emitter.JournalError(domain.ServiceJournalErrorEvent{
			WatchID:   watchID,
			ServerID:  serverID,
			UnitName:  unitName,
			Code:      code,
			Message:   message,
			Timestamp: timestamp(),
		})
	}
}

func (m *Manager) emitJournalCompleted(watchID string, serverID int64, unitName string, reason string) {
	m.mu.Lock()
	emitter := m.emitter
	m.mu.Unlock()
	if emitter != nil {
		emitter.JournalCompleted(domain.ServiceJournalCompletedEvent{
			WatchID:   watchID,
			ServerID:  serverID,
			UnitName:  unitName,
			Reason:    reason,
			Timestamp: timestamp(),
		})
	}
}
