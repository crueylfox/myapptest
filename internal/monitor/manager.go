package monitor

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
	"time"

	"hostdeck/internal/connectionerror"
	"hostdeck/internal/domain"
	"hostdeck/internal/linuxmonitor"
	"hostdeck/internal/logging"
	"hostdeck/internal/networkdiag"
	"hostdeck/internal/sshclient"
)

type HostKeySaver func(context.Context, int64, string) error
type CredentialCommitter func(context.Context, domain.Connection, domain.AuthRequest) error
type Emitter func(domain.MonitorSnapshot)
type NetworkDiagnosticStateEmitter func(domain.NetworkDiagnosticStateEvent)
type NetworkDiagnosticOutputEmitter func(domain.NetworkDiagnosticOutputEvent)
type NetworkDiagnosticErrorEmitter func(domain.NetworkDiagnosticErrorEvent)
type TimeoutProvider func() time.Duration
type StreamingCommand = sshclient.StreamingCommand
type Transport interface {
	Run(context.Context, string) (string, error)
	StartStreamingCommand(context.Context, string) (StreamingCommand, error)
	Fingerprint() string
	Close() error
}
type Dialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error)
type KeepalivePolicyProvider func() sshclient.KeepalivePolicy

type keepaliveStarter interface {
	StartKeepalive(context.Context, sshclient.KeepalivePolicy, sshclient.KeepaliveMetadata, sshclient.KeepaliveFailureHandler) *sshclient.KeepaliveHandle
}

var ErrAlreadyRunning = errors.New("monitor connection is already running")

type Manager struct {
	ctx                  context.Context
	logger               *logging.Logger
	saveHostKey          HostKeySaver
	commitAuth           CredentialCommitter
	emit                 Emitter
	dial                 Dialer
	timeout              TimeoutProvider
	keepalive            KeepalivePolicyProvider
	mu                   sync.RWMutex
	workers              map[int64]*worker
	latest               map[int64]domain.MonitorSnapshot
	networkPreferences   map[int64]domain.MonitorNetworkInterfacePreference
	diagnostics          map[string]*diagnosticTask
	emitDiagnosticState  NetworkDiagnosticStateEmitter
	emitDiagnosticOutput NetworkDiagnosticOutputEmitter
	emitDiagnosticError  NetworkDiagnosticErrorEmitter
}

type worker struct {
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.RWMutex
	client Transport
}

type diagnosticTask struct {
	mu      sync.Mutex
	task    domain.NetworkDiagnosticTask
	cancel  context.CancelFunc
	session StreamingCommand
	done    chan struct{}
}

func (w *worker) setTransport(client Transport) {
	w.mu.Lock()
	w.client = client
	w.mu.Unlock()
}

func (w *worker) transport() Transport {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.client
}

func (t *diagnosticTask) setSession(session StreamingCommand) {
	t.mu.Lock()
	t.session = session
	t.mu.Unlock()
}

func (t *diagnosticTask) cancelAndCloseSession() {
	t.mu.Lock()
	t.cancel()
	session := t.session
	t.session = nil
	t.mu.Unlock()
	if session != nil {
		_ = session.Close()
	}
}

func (t *diagnosticTask) closeSession() {
	t.mu.Lock()
	session := t.session
	t.session = nil
	t.mu.Unlock()
	if session != nil {
		_ = session.Close()
	}
}

func (t *diagnosticTask) snapshot() domain.NetworkDiagnosticTask {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.task
}

func New(
	ctx context.Context,
	logger *logging.Logger,
	saveHostKey HostKeySaver,
	commitAuth CredentialCommitter,
	emit Emitter,
	timeout TimeoutProvider,
) *Manager {
	return NewWithDialer(
		ctx,
		logger,
		saveHostKey,
		commitAuth,
		emit,
		timeout,
		func(
			ctx context.Context,
			connection domain.Connection,
			auth domain.AuthRequest,
			timeout time.Duration,
		) (Transport, time.Duration, error) {
			return sshclient.Dial(ctx, connection, auth, timeout)
		},
	)
}

func NewWithDialer(
	ctx context.Context,
	logger *logging.Logger,
	saveHostKey HostKeySaver,
	commitAuth CredentialCommitter,
	emit Emitter,
	timeout TimeoutProvider,
	dial Dialer,
) *Manager {
	if timeout == nil {
		timeout = func() time.Duration { return 15 * time.Second }
	}
	return &Manager{
		ctx: ctx, logger: logger, saveHostKey: saveHostKey, commitAuth: commitAuth, emit: emit,
		dial: dial, timeout: timeout,
		workers: make(map[int64]*worker), latest: make(map[int64]domain.MonitorSnapshot),
		networkPreferences: make(map[int64]domain.MonitorNetworkInterfacePreference),
		diagnostics:        make(map[string]*diagnosticTask),
	}
}

func (m *Manager) SetKeepalivePolicyProvider(provider KeepalivePolicyProvider) {
	m.keepalive = provider
}

func (m *Manager) keepalivePolicy() sshclient.KeepalivePolicy {
	if m.keepalive == nil {
		return sshclient.KeepalivePolicy{}
	}
	return m.keepalive()
}

func (m *Manager) SetNetworkDiagnosticEmitters(
	state NetworkDiagnosticStateEmitter,
	output NetworkDiagnosticOutputEmitter,
	errorEmitter NetworkDiagnosticErrorEmitter,
) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emitDiagnosticState = state
	m.emitDiagnosticOutput = output
	m.emitDiagnosticError = errorEmitter
}

func (m *Manager) Start(connection domain.Connection, auth domain.AuthRequest) error {
	interval, err := linuxmonitor.ParseRefreshInterval(connection.RefreshInterval)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(m.ctx)
	current := &worker{cancel: cancel, done: make(chan struct{})}
	m.mu.Lock()
	if _, exists := m.workers[connection.ID]; exists {
		m.mu.Unlock()
		cancel()
		return ErrAlreadyRunning
	}
	m.workers[connection.ID] = current
	mode := connection.NetworkInterfaceMode
	selected := connection.SelectedNetworkInterface
	if !validNetworkInterfaceMode(mode) {
		mode = domain.MonitorNetworkInterfaceAll
		selected = ""
	} else if mode != domain.MonitorNetworkInterfaceSpecific {
		selected = ""
	}
	m.networkPreferences[connection.ID] = domain.MonitorNetworkInterfacePreference{
		ServerID: connection.ID, Mode: mode, SelectedNetworkInterface: selected,
		UserSelected: connection.NetworkInterfaceUserSelected,
	}
	m.mu.Unlock()
	go m.run(ctx, current, connection, auth, interval)
	return nil
}

func (m *Manager) run(ctx context.Context, owner *worker, connection domain.Connection, auth domain.AuthRequest, interval time.Duration) {
	defer func() {
		auth.Password = ""
		auth.Passphrase = ""
		m.mu.Lock()
		if m.workers[connection.ID] == owner {
			delete(m.workers, connection.ID)
		}
		m.mu.Unlock()
		if ctx.Err() != nil {
			m.publish(domain.MonitorSnapshot{
				ConnectionID:  connection.ID,
				Status:        domain.StatusDisconnected,
				Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
				Message:       "已断开连接",
				MonitorActive: false,
			})
		}
		close(owner.done)
	}()

	attempt := 0
	for {
		if ctx.Err() != nil {
			return
		}
		status := domain.StatusConnecting
		if attempt > 0 {
			status = domain.StatusReconnecting
		}
		m.publish(domain.MonitorSnapshot{
			ConnectionID: connection.ID, Status: status,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Message: "正在连接",
			MonitorActive: true,
		})
		timeout := m.timeout()
		dialCtx, cancel := context.WithTimeout(ctx, timeout)
		client, _, err := m.dial(dialCtx, connection, auth, timeout)
		cancel()
		if err != nil {
			attempt++
			classified := connectionerror.Classify(err, connection, "monitor.connect")
			m.logger.WriteConnection("error", classified.UserMessage, "monitor.connect", connection, &classified)
			m.publish(domain.MonitorSnapshot{
				ConnectionID:    connection.ID,
				Status:          connectionerror.StatusForCode(classified.Code),
				Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
				ErrorCode:       classified.Code,
				Message:         classified.UserMessage,
				MonitorActive:   classified.Retryable,
				ConnectionError: &classified,
			})
			if !classified.Retryable {
				return
			}
			if !waitContext(ctx, retryDelay(attempt)) {
				continue
			}
			return
		}
		if m.commitAuth != nil {
			if err := m.commitAuth(ctx, connection, auth); err != nil {
				_ = client.Close()
				classified := connectionerror.Classify(err, connection, "monitor.credential")
				classified.Code = "CREDENTIAL_SAVE_FAILED"
				classified.UserMessage = "无法将 SSH 凭据保存到系统凭据库"
				classified.Retryable = false
				m.logger.WriteConnection("error", classified.UserMessage, "monitor.credential", connection, &classified)
				m.publish(domain.MonitorSnapshot{
					ConnectionID: connection.ID, Status: domain.StatusError,
					Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
					ErrorCode: "CREDENTIAL_SAVE_FAILED", Message: classified.UserMessage,
					MonitorActive: false, ConnectionError: &classified,
				})
				return
			}
		}
		if m.saveHostKey != nil && sshclient.ShouldPersistObservedHostKey(connection, auth, client.Fingerprint()) {
			if err := m.saveHostKey(ctx, connection.ID, client.Fingerprint()); err != nil {
				classified := connectionerror.Classify(err, connection, "monitor.hostkey")
				classified.UserMessage = "服务器已连接，但主机指纹记录更新失败"
				m.logger.WriteConnection("error", classified.UserMessage, "monitor.hostkey", connection, &classified)
			} else {
				connection.HostKeyFingerprint = client.Fingerprint()
			}
		}
		attempt = 0
		calculator := linuxmonitor.Calculator{}
		owner.setTransport(client)
		m.startKeepalive(ctx, client, connection)
		err = m.sampleLoop(ctx, client, connection, interval, &calculator)
		owner.setTransport(nil)
		_ = client.Close()
		if ctx.Err() != nil {
			continue
		}
		attempt++
		classified := connectionerror.Classify(err, connection, "monitor.sample")
		classified.Retryable = true
		m.logger.WriteConnection("error", "监控连接中断，准备重新连接", "monitor.sample", connection, &classified)
		m.publish(domain.MonitorSnapshot{
			ConnectionID:    connection.ID,
			Status:          domain.StatusReconnecting,
			Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
			Message:         classified.UserMessage,
			ErrorCode:       classified.Code,
			MonitorActive:   true,
			ConnectionError: &classified,
		})
		if waitContext(ctx, retryDelay(attempt)) {
			return
		}
	}
}

func (m *Manager) startKeepalive(ctx context.Context, client Transport, connection domain.Connection) {
	starter, ok := client.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  connection.ID,
		Subsystem: "monitor",
	}, func(failure sshclient.KeepaliveFailure) {
		if m.logger != nil {
			m.logger.Write(
				"warn",
				fmt.Sprintf("SSH keepalive failed subsystem=monitor failures=%d", failure.FailureCount),
				"ssh.keepalive",
				connection.ID,
				sshclient.ErrKeepaliveFailed,
			)
		}
	})
}

func (m *Manager) sampleLoop(
	ctx context.Context,
	client Transport,
	connection domain.Connection,
	interval time.Duration,
	calculator *linuxmonitor.Calculator,
) error {
	lastProcessError := ""
	for {
		started := time.Now()
		commandCtx, cancel := context.WithTimeout(ctx, min(10*time.Second, interval+8*time.Second))
		output, err := client.Run(commandCtx, linuxmonitor.CollectionCommand)
		cancel()
		if err != nil {
			return err
		}
		sampledAt := time.Now()
		latency := time.Since(started)
		raw := linuxmonitor.ParseCollectionOutput(output)
		processError := metricError(raw.Errors, "processes")
		if processError != "" && processError != lastProcessError {
			m.logger.WriteConnection("warn", "TOP 进程采集失败", "monitor.processes", connection, &domain.ConnectionError{
				Code:             "PROCESS_COLLECTION_FAILED",
				UserMessage:      "TOP 进程采集失败",
				TechnicalMessage: processError,
				ServerID:         connection.ID,
				Operation:        "monitor.processes",
				Timestamp:        sampledAt.UTC().Format(time.RFC3339Nano),
			})
		}
		lastProcessError = processError
		preference := m.networkPreference(connection.ID)
		linuxmonitor.ApplyNetworkPreference(&raw, preference.Mode, preference.SelectedNetworkInterface)
		snapshot := calculator.Snapshot(connection.ID, raw, sampledAt, latency)
		snapshot.MonitorActive = true
		m.publish(snapshot)
		delay := interval - time.Since(started)
		if delay < 0 {
			delay = 0
		}
		if waitContext(ctx, delay) {
			return ctx.Err()
		}
	}
}

func metricError(current []domain.MetricError, metric string) string {
	for _, item := range current {
		if item.Metric == metric {
			return item.Message
		}
	}
	return ""
}

func (m *Manager) publish(snapshot domain.MonitorSnapshot) {
	m.mu.Lock()
	m.latest[snapshot.ConnectionID] = snapshot
	m.mu.Unlock()
	if m.emit != nil {
		m.emit(snapshot)
	}
}

func (m *Manager) Latest(connectionID int64) (domain.MonitorSnapshot, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	snapshot, ok := m.latest[connectionID]
	return snapshot, ok
}

func (m *Manager) UpdateNetworkInterfacePreference(preference domain.MonitorNetworkInterfacePreference) {
	if !validNetworkInterfaceMode(preference.Mode) {
		preference.Mode = domain.MonitorNetworkInterfaceAll
		preference.SelectedNetworkInterface = ""
	} else if preference.Mode != domain.MonitorNetworkInterfaceSpecific {
		preference.SelectedNetworkInterface = ""
	}
	m.mu.Lock()
	m.networkPreferences[preference.ServerID] = preference
	m.mu.Unlock()
}

func validNetworkInterfaceMode(mode domain.MonitorNetworkInterfaceMode) bool {
	switch mode {
	case domain.MonitorNetworkInterfaceAll,
		domain.MonitorNetworkInterfaceSpecific,
		domain.MonitorNetworkInterfacePhysical,
		domain.MonitorNetworkInterfaceDocker:
		return true
	default:
		return false
	}
}

func (m *Manager) networkPreference(connectionID int64) domain.MonitorNetworkInterfacePreference {
	m.mu.RLock()
	preference, ok := m.networkPreferences[connectionID]
	m.mu.RUnlock()
	if !ok || preference.Mode == "" {
		return domain.MonitorNetworkInterfacePreference{
			ServerID: connectionID,
			Mode:     domain.MonitorNetworkInterfaceAll,
		}
	}
	return preference
}

func (m *Manager) ListNetworkInterfaces(
	ctx context.Context,
	request domain.ListNetworkInterfacesRequest,
) (domain.ListNetworkInterfacesResponse, error) {
	if request.ServerID <= 0 {
		return domain.ListNetworkInterfacesResponse{Interfaces: []domain.NetworkInterface{}}, errors.New("serverID is required")
	}
	client := m.transportForServer(request.ServerID)
	if client == nil {
		return domain.ListNetworkInterfacesResponse{ServerID: request.ServerID, Interfaces: []domain.NetworkInterface{}},
			errors.New("请先连接服务器并启动监控")
	}
	started := time.Now().UTC()
	commandCtx, cancel := context.WithTimeout(ctx, min(8*time.Second, m.timeout()+3*time.Second))
	output, err := client.Run(commandCtx, linuxmonitor.NetworkInterfacesCommand)
	cancel()
	if err != nil {
		return domain.ListNetworkInterfacesResponse{ServerID: request.ServerID, Interfaces: []domain.NetworkInterface{}}, err
	}
	updatedAt := started.Format(time.RFC3339Nano)
	return linuxmonitor.ParseNetworkInterfacesResponse(request.ServerID, output, updatedAt), nil
}

func (m *Manager) StartNetworkDiagnostic(
	request domain.StartNetworkDiagnosticRequest,
) (domain.NetworkDiagnosticTask, error) {
	if request.ServerID <= 0 {
		return domain.NetworkDiagnosticTask{}, errors.New("serverID is required")
	}
	command, err := networkdiag.BuildCommand(request)
	if err != nil {
		return domain.NetworkDiagnosticTask{}, err
	}
	client := m.transportForServer(request.ServerID)
	if client == nil {
		return domain.NetworkDiagnosticTask{}, errors.New("请先连接服务器并启动监控")
	}
	taskID := fmt.Sprintf("networkdiag-%d-%d-%d", request.ServerID, time.Now().UnixNano(), rand.Int64N(1_000_000))
	ctx, cancel := context.WithCancel(m.ctx)
	task := domain.NetworkDiagnosticTask{
		TaskID: taskID, ServerID: request.ServerID, Type: request.Type,
		Target: request.Target, Port: request.Port,
		Status:    domain.NetworkDiagnosticRunning,
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	current := &diagnosticTask{task: task, cancel: cancel, done: make(chan struct{})}
	m.mu.Lock()
	m.diagnostics[taskID] = current
	m.pruneDiagnosticsLocked(request.ServerID, 20)
	m.mu.Unlock()
	m.emitDiagnosticStateEvent(task)
	go m.runNetworkDiagnostic(ctx, current, client, request, command)
	return task, nil
}

func (m *Manager) CancelNetworkDiagnostic(request domain.CancelNetworkDiagnosticRequest) error {
	m.mu.RLock()
	current := m.diagnostics[request.TaskID]
	var serverID int64
	if current != nil {
		serverID = current.snapshot().ServerID
	}
	m.mu.RUnlock()
	if current == nil || serverID != request.ServerID {
		return fmt.Errorf("network diagnostic task %s not found", request.TaskID)
	}
	if current.snapshot().Status != domain.NetworkDiagnosticRunning {
		return nil
	}
	m.cancelDiagnosticTask(current, 3*time.Second)
	return nil
}

func (m *Manager) ListNetworkDiagnosticTasks(serverID int64) []domain.NetworkDiagnosticTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tasks := make([]domain.NetworkDiagnosticTask, 0, len(m.diagnostics))
	for _, current := range m.diagnostics {
		task := current.snapshot()
		if serverID == 0 || task.ServerID == serverID {
			tasks = append(tasks, task)
		}
	}
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].StartedAt > tasks[j].StartedAt
	})
	return tasks
}

func (m *Manager) StopDiagnostics(connectionID int64) {
	m.mu.RLock()
	tasks := make([]*diagnosticTask, 0)
	for _, current := range m.diagnostics {
		task := current.snapshot()
		if task.ServerID == connectionID && task.Status == domain.NetworkDiagnosticRunning {
			tasks = append(tasks, current)
		}
	}
	m.mu.RUnlock()
	for _, current := range tasks {
		m.cancelDiagnosticTask(current, 3*time.Second)
	}
}

func (m *Manager) Stop(connectionID int64) {
	m.StopDiagnostics(connectionID)
	m.mu.RLock()
	current := m.workers[connectionID]
	m.mu.RUnlock()
	if current == nil {
		return
	}
	current.cancel()
	<-current.done
}

func (m *Manager) StopAll() {
	m.mu.RLock()
	workers := make([]*worker, 0, len(m.workers))
	for _, current := range m.workers {
		workers = append(workers, current)
	}
	diagnostics := make([]*diagnosticTask, 0, len(m.diagnostics))
	for _, current := range m.diagnostics {
		if current.snapshot().Status == domain.NetworkDiagnosticRunning {
			diagnostics = append(diagnostics, current)
		}
	}
	m.mu.RUnlock()
	for _, current := range diagnostics {
		m.cancelDiagnosticTask(current, 3*time.Second)
	}
	for _, current := range workers {
		current.cancel()
	}
	for _, current := range workers {
		<-current.done
	}
}

func (m *Manager) IsActive(connectionID int64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.workers[connectionID] != nil
}

func (m *Manager) transportForServer(connectionID int64) Transport {
	m.mu.RLock()
	current := m.workers[connectionID]
	m.mu.RUnlock()
	if current == nil {
		return nil
	}
	return current.transport()
}

func (m *Manager) runNetworkDiagnostic(
	ctx context.Context,
	current *diagnosticTask,
	client Transport,
	request domain.StartNetworkDiagnosticRequest,
	command string,
) {
	defer func() {
		current.closeSession()
		close(current.done)
	}()
	timeout := networkdiag.CommandTimeout(request)
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	session, err := client.StartStreamingCommand(commandCtx, command)
	if err != nil {
		if ctx.Err() != nil {
			m.finishDiagnostic(current, domain.NetworkDiagnosticCanceled, "")
			return
		}
		m.emitDiagnosticErrorEvent(current.snapshot().ServerID, current.snapshot().TaskID, "网络诊断启动失败", "NETWORK_DIAGNOSTIC_START_FAILED")
		m.finishDiagnostic(current, domain.NetworkDiagnosticFailed, "网络诊断启动失败")
		return
	}
	current.setSession(session)

	lines := make(chan diagnosticOutputLine, 64)
	var readers sync.WaitGroup
	readDiagnosticStream(commandCtx, &readers, session.Stdout(), "stdout", lines)
	readDiagnosticStream(commandCtx, &readers, session.Stderr(), "stderr", lines)
	go func() {
		readers.Wait()
		close(lines)
	}()

	waitErr := make(chan error, 1)
	go func() {
		waitErr <- session.Wait()
	}()

	exitCode := 0
	emitted := 0
	truncated := false
	linesOpen := true
	waiting := true
	for linesOpen || waiting {
		select {
		case <-commandCtx.Done():
			current.closeSession()
			if ctx.Err() != nil {
				waitForDiagnosticDone(waitErr, 3*time.Second)
				m.finishDiagnostic(current, domain.NetworkDiagnosticCanceled, "")
				return
			}
			waitForDiagnosticDone(waitErr, 3*time.Second)
			m.emitDiagnosticErrorEvent(current.snapshot().ServerID, current.snapshot().TaskID, "网络诊断超时", "NETWORK_DIAGNOSTIC_TIMEOUT")
			m.finishDiagnostic(current, domain.NetworkDiagnosticFailed, "网络诊断超时")
			return
		case item, ok := <-lines:
			if !ok {
				linesOpen = false
				continue
			}
			if commandCtx.Err() != nil {
				continue
			}
			line := strings.TrimRight(item.line, "\r")
			if parsed, marker := networkdiag.ParseExitMarkerLine(line); marker {
				exitCode = parsed
				continue
			}
			if strings.TrimSpace(line) == "" {
				continue
			}
			if emitted >= 1000 {
				if !truncated {
					m.emitDiagnosticOutputEvent(current.snapshot().ServerID, current.snapshot().TaskID, "输出超过 1000 行，后续内容已截断。", "stdout")
					truncated = true
				}
				continue
			}
			m.emitDiagnosticOutputEvent(current.snapshot().ServerID, current.snapshot().TaskID, line, item.stream)
			emitted++
		case err := <-waitErr:
			waiting = false
			waitErr = nil
			if commandCtx.Err() != nil {
				continue
			}
			if err != nil {
				m.emitDiagnosticErrorEvent(current.snapshot().ServerID, current.snapshot().TaskID, "网络诊断执行失败", "NETWORK_DIAGNOSTIC_FAILED")
				m.finishDiagnostic(current, domain.NetworkDiagnosticFailed, "网络诊断执行失败")
				return
			}
		}
	}
	if ctx.Err() != nil {
		m.finishDiagnostic(current, domain.NetworkDiagnosticCanceled, "")
		return
	}
	if commandCtx.Err() != nil {
		m.emitDiagnosticErrorEvent(current.snapshot().ServerID, current.snapshot().TaskID, "网络诊断超时", "NETWORK_DIAGNOSTIC_TIMEOUT")
		m.finishDiagnostic(current, domain.NetworkDiagnosticFailed, "网络诊断超时")
		return
	}
	if exitCode != 0 {
		message := fmt.Sprintf("网络诊断命令退出码 %d", exitCode)
		m.emitDiagnosticErrorEvent(current.snapshot().ServerID, current.snapshot().TaskID, message, "NETWORK_DIAGNOSTIC_EXIT")
		m.finishDiagnostic(current, domain.NetworkDiagnosticFailed, message)
		return
	}
	m.finishDiagnostic(current, domain.NetworkDiagnosticCompleted, "")
}

type diagnosticOutputLine struct {
	line   string
	stream string
}

func readDiagnosticStream(
	ctx context.Context,
	readers *sync.WaitGroup,
	reader io.Reader,
	stream string,
	lines chan<- diagnosticOutputLine,
) {
	readers.Add(1)
	go func() {
		defer readers.Done()
		buffered := bufio.NewReader(reader)
		for {
			line, err := buffered.ReadString('\n')
			if line != "" {
				line = strings.TrimRight(line, "\n")
				select {
				case lines <- diagnosticOutputLine{line: line, stream: stream}:
				case <-ctx.Done():
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()
}

func waitForDiagnosticDone(done <-chan error, timeout time.Duration) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		return context.DeadlineExceeded
	}
}

func (m *Manager) cancelDiagnosticTask(current *diagnosticTask, timeout time.Duration) {
	if current.snapshot().Status != domain.NetworkDiagnosticRunning {
		return
	}
	current.cancelAndCloseSession()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-current.done:
	case <-timer.C:
		m.finishDiagnostic(current, domain.NetworkDiagnosticCanceled, "")
	}
}

func (m *Manager) finishDiagnostic(
	current *diagnosticTask,
	status domain.NetworkDiagnosticStatus,
	message string,
) {
	task := current.snapshot()
	m.mu.RLock()
	stored := m.diagnostics[task.TaskID]
	m.mu.RUnlock()
	if stored != current {
		return
	}
	current.mu.Lock()
	if current.task.Status != domain.NetworkDiagnosticRunning {
		current.mu.Unlock()
		return
	}
	task = current.task
	task.Status = status
	task.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
	task.Error = message
	current.task = task
	current.mu.Unlock()
	m.emitDiagnosticStateEvent(task)
}

func (m *Manager) pruneDiagnosticsLocked(serverID int64, keep int) {
	if keep <= 0 {
		return
	}
	tasks := make([]*diagnosticTask, 0)
	for _, current := range m.diagnostics {
		task := current.snapshot()
		if task.ServerID == serverID && task.Status != domain.NetworkDiagnosticRunning {
			tasks = append(tasks, current)
		}
	}
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].snapshot().StartedAt > tasks[j].snapshot().StartedAt
	})
	for _, current := range tasks {
		if keep > 0 {
			keep--
			continue
		}
		delete(m.diagnostics, current.snapshot().TaskID)
	}
}

func (m *Manager) emitDiagnosticStateEvent(task domain.NetworkDiagnosticTask) {
	m.mu.RLock()
	emit := m.emitDiagnosticState
	m.mu.RUnlock()
	if emit != nil {
		emit(domain.NetworkDiagnosticStateEvent{
			ServerID: task.ServerID, TaskID: task.TaskID,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Task: task,
		})
	}
}

func (m *Manager) emitDiagnosticOutputEvent(serverID int64, taskID, line, stream string) {
	m.mu.RLock()
	emit := m.emitDiagnosticOutput
	m.mu.RUnlock()
	if emit != nil {
		emit(domain.NetworkDiagnosticOutputEvent{
			ServerID: serverID, TaskID: taskID,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Line: line, Stream: stream,
		})
	}
}

func (m *Manager) emitDiagnosticErrorEvent(serverID int64, taskID, message, code string) {
	m.mu.RLock()
	emit := m.emitDiagnosticError
	m.mu.RUnlock()
	if emit != nil {
		emit(domain.NetworkDiagnosticErrorEvent{
			ServerID: serverID, TaskID: taskID,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Message: message, Code: code,
		})
	}
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Second << min(attempt-1, 5)
	if delay > 30*time.Second {
		delay = 30 * time.Second
	}
	jitter := time.Duration(rand.Int64N(int64(delay/4 + 1)))
	return delay + jitter
}

// waitContext returns true when cancellation wins.
func waitContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return true
	case <-timer.C:
		return false
	}
}
