package processmanager

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/sshclient"
)

type Transport interface {
	Run(context.Context, string) (string, error)
	Fingerprint() string
	Close() error
}

type Dialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error)
type HostKeySaver func(context.Context, int64, string) error
type TimeoutProvider func() time.Duration
type KeepalivePolicyProvider func() sshclient.KeepalivePolicy

type keepaliveStarter interface {
	StartKeepalive(context.Context, sshclient.KeepalivePolicy, sshclient.KeepaliveMetadata, sshclient.KeepaliveFailureHandler) *sshclient.KeepaliveHandle
}

type Emitter interface {
	State(domain.ProcessStateEvent)
	List(domain.ProcessListEvent)
	Detail(domain.ProcessDetailEvent)
	Error(domain.ProcessErrorEvent)
}

const (
	listCommandTimeout   = 5 * time.Second
	detailCommandTimeout = 2 * time.Second
)

type realTransport struct {
	client *sshclient.Client
}

func (t realTransport) Run(ctx context.Context, command string) (string, error) {
	return t.client.Run(ctx, command)
}

func (t realTransport) Fingerprint() string {
	return t.client.Fingerprint()
}

func (t realTransport) Close() error {
	return t.client.Close()
}

func (t realTransport) StartKeepalive(
	ctx context.Context,
	policy sshclient.KeepalivePolicy,
	metadata sshclient.KeepaliveMetadata,
	onFailure sshclient.KeepaliveFailureHandler,
) *sshclient.KeepaliveHandle {
	return t.client.StartKeepalive(ctx, policy, metadata, onFailure)
}

type Manager struct {
	ctx         context.Context
	logger      *logging.Logger
	emitter     Emitter
	timeout     TimeoutProvider
	keepalive   KeepalivePolicyProvider
	dial        Dialer
	saveHostKey HostKeySaver

	mu               sync.Mutex
	watchers         map[string]*watchWorker
	serverGeneration map[int64]int64
}

type watchWorker struct {
	serverID   int64
	watchID    string
	generation int64
	request    domain.ListProcessesRequest
	cancel     context.CancelFunc
	transport  Transport
}

func New(ctx context.Context, logger *logging.Logger, emitter Emitter, timeout TimeoutProvider) *Manager {
	return NewWithDialer(ctx, logger, emitter, timeout, func(
		ctx context.Context,
		connection domain.Connection,
		auth domain.AuthRequest,
		timeout time.Duration,
	) (Transport, time.Duration, error) {
		client, latency, err := sshclient.Dial(ctx, connection, auth, timeout)
		if err != nil {
			return nil, 0, err
		}
		return realTransport{client: client}, latency, nil
	})
}

func NewWithDialer(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	timeout TimeoutProvider,
	dial Dialer,
) *Manager {
	if timeout == nil {
		timeout = func() time.Duration { return 15 * time.Second }
	}
	return &Manager{
		ctx:              ctx,
		logger:           logger,
		emitter:          emitter,
		timeout:          timeout,
		dial:             dial,
		watchers:         make(map[string]*watchWorker),
		serverGeneration: make(map[int64]int64),
	}
}

func (m *Manager) SetKeepalivePolicyProvider(provider KeepalivePolicyProvider) {
	m.keepalive = provider
}

func (m *Manager) SetHostKeySaver(save HostKeySaver) {
	m.saveHostKey = save
}

func (m *Manager) keepalivePolicy() sshclient.KeepalivePolicy {
	if m.keepalive == nil {
		return sshclient.KeepalivePolicy{}
	}
	return m.keepalive()
}

func (m *Manager) List(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.ListProcessesRequest,
) (domain.ProcessListResponse, error) {
	request.ServerID = connection.ID
	request = normalizeListRequest(request)
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		message := userMessageForError(err)
		m.emitError(connection.ID, "", "PROCESS_CONNECT_FAILED", message)
		return domain.ProcessListResponse{}, errors.New(message)
	}
	defer transport.Close()
	commandCtx, commandCancel := context.WithTimeout(ctx, listCommandTimeout)
	defer commandCancel()
	response, err := m.listWithTransport(commandCtx, connection.ID, transport, request)
	if err != nil {
		message := "读取进程列表失败"
		if isTimeoutError(err) {
			message = "读取进程列表超时"
		} else if userMessageForError(err) != "进程管理操作失败" {
			message = userMessageForError(err)
		}
		m.emitError(connection.ID, "", "PROCESS_LIST_FAILED", message)
		return domain.ProcessListResponse{}, errors.New(message)
	}
	m.emitList("", response)
	return response, nil
}

func (m *Manager) Detail(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.GetProcessDetailRequest,
) (domain.ProcessDetail, error) {
	if request.PID <= 0 {
		return domain.ProcessDetail{}, errors.New("进程 PID 无效")
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		message := userMessageForError(err)
		m.emitError(connection.ID, "", "PROCESS_CONNECT_FAILED", message)
		return domain.ProcessDetail{}, errors.New(message)
	}
	defer transport.Close()
	commandCtx, commandCancel := context.WithTimeout(ctx, detailCommandTimeout)
	defer commandCancel()
	detail, err := m.detailWithTransport(commandCtx, connection.ID, transport, request.PID)
	if err != nil {
		message := "进程详情读取失败或进程已退出"
		if isTimeoutError(err) {
			message = "读取进程详情超时"
		} else if userMessageForError(err) == "权限不足，无法读取或操作进程" {
			message = userMessageForError(err)
		}
		m.emitError(connection.ID, "", "PROCESS_DETAIL_FAILED", message)
		return domain.ProcessDetail{}, errors.New(message)
	}
	m.emitDetail("", detail)
	return detail, nil
}

func (m *Manager) Signal(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SignalProcessRequest,
) (domain.SignalProcessResponse, error) {
	if request.PID <= 0 {
		return domain.SignalProcessResponse{}, errors.New("进程 PID 无效")
	}
	if request.Signal != domain.ProcessSignalTerm && request.Signal != domain.ProcessSignalKill {
		return domain.SignalProcessResponse{}, errors.New("进程信号无效")
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		message := userMessageForError(err)
		m.emitError(connection.ID, "", "PROCESS_CONNECT_FAILED", message)
		return domain.SignalProcessResponse{}, errors.New(message)
	}
	defer transport.Close()
	commandCtx, commandCancel := context.WithTimeout(ctx, detailCommandTimeout)
	defer commandCancel()
	detail, err := m.detailWithTransport(commandCtx, connection.ID, transport, request.PID)
	if err != nil {
		message := userMessageForError(err)
		m.emitError(connection.ID, "", "PROCESS_DETAIL_FAILED", message)
		return domain.SignalProcessResponse{}, errors.New(message)
	}
	if err := validateSignalTarget(detail, request.ExpectedCommand); err != nil {
		return domain.SignalProcessResponse{}, err
	}
	output, err := transport.Run(ctx, signalCommand(request.PID, request.Signal))
	if err != nil {
		return domain.SignalProcessResponse{}, errors.New("发送进程信号失败")
	}
	result := strings.TrimSpace(output)
	switch result {
	case "ok":
		message := "已发送 SIGTERM"
		if request.Signal == domain.ProcessSignalKill {
			message = "已发送 SIGKILL"
		}
		m.log("info", "进程信号已发送", "process.signal", connection.ID, request.PID, string(request.Signal), nil)
		return domain.SignalProcessResponse{ServerID: connection.ID, PID: request.PID, Success: true, Message: message}, nil
	case "not_found":
		return domain.SignalProcessResponse{}, errors.New("进程已退出")
	case "denied":
		return domain.SignalProcessResponse{}, errors.New("权限不足，无法操作该进程")
	default:
		return domain.SignalProcessResponse{}, errors.New("发送进程信号失败")
	}
}

func (m *Manager) StartWatch(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.StartProcessWatchRequest,
) (string, error) {
	listRequest := normalizeListRequest(domain.ListProcessesRequest{
		ServerID: connection.ID,
		Query:    request.Query,
		SortBy:   request.SortBy,
		SortDir:  request.SortDir,
		Limit:    request.Limit,
	})
	watchID := strings.TrimSpace(request.WatchID)
	if watchID == "" {
		watchID = newID("process-watch")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		cancel()
		message := userMessageForError(err)
		m.emitError(connection.ID, watchID, "PROCESS_CONNECT_FAILED", message)
		return "", errors.New(message)
	}
	worker := &watchWorker{
		serverID:   connection.ID,
		watchID:    watchID,
		generation: m.generation(connection.ID),
		request:    listRequest,
		cancel:     cancel,
		transport:  transport,
	}
	m.mu.Lock()
	if existing := m.watchers[watchID]; existing != nil {
		m.stopWatcherLocked(existing)
	}
	m.watchers[watchID] = worker
	m.mu.Unlock()
	m.emitState(connection.ID, watchID, "running")
	interval := time.Duration(request.IntervalMs) * time.Millisecond
	if interval < time.Second {
		interval = 2 * time.Second
	}
	if interval > 10*time.Second {
		interval = 10 * time.Second
	}
	go m.runWatch(ctx, worker, interval)
	return watchID, nil
}

func (m *Manager) StopWatch(watchID string) {
	m.mu.Lock()
	worker := m.watchers[watchID]
	if worker != nil {
		delete(m.watchers, watchID)
		m.stopWatcherLocked(worker)
	}
	m.mu.Unlock()
}

func (m *Manager) StopServer(serverID int64) {
	m.mu.Lock()
	m.serverGeneration[serverID]++
	for id, worker := range m.watchers {
		if worker.serverID == serverID {
			delete(m.watchers, id)
			m.stopWatcherLocked(worker)
		}
	}
	m.mu.Unlock()
	m.emitState(serverID, "", "stopped")
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	for id, worker := range m.watchers {
		delete(m.watchers, id)
		m.stopWatcherLocked(worker)
	}
	m.mu.Unlock()
}

func (m *Manager) WatcherCount(serverID int64) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, worker := range m.watchers {
		if serverID == 0 || worker.serverID == serverID {
			count++
		}
	}
	return count
}

func (m *Manager) open(ctx context.Context, connection domain.Connection, auth domain.AuthRequest) (Transport, error) {
	transport, _, err := m.dial(ctx, connection, auth, m.timeout())
	if err != nil {
		return nil, err
	}
	m.persistHostKey(ctx, connection, auth, transport)
	m.startKeepalive(ctx, transport, connection.ID)
	return transport, nil
}

func (m *Manager) persistHostKey(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, transport Transport) {
	if m.saveHostKey == nil || transport == nil || !sshclient.ShouldPersistObservedHostKey(connection, auth, transport.Fingerprint()) {
		return
	}
	if err := m.saveHostKey(ctx, connection.ID, transport.Fingerprint()); err != nil && m.logger != nil {
		m.logger.WriteConnection("error", "服务器已连接，但主机指纹记录更新失败", "process.hostkey", connection, nil)
	}
}

func (m *Manager) startKeepalive(ctx context.Context, transport Transport, serverID int64) {
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  serverID,
		Subsystem: "process",
	}, func(failure sshclient.KeepaliveFailure) {
		if m.logger != nil {
			m.logger.Write(
				"warn",
				fmt.Sprintf("SSH keepalive failed subsystem=process failures=%d", failure.FailureCount),
				"ssh.keepalive",
				serverID,
				sshclient.ErrKeepaliveFailed,
			)
		}
	})
}

func (m *Manager) listWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	request domain.ListProcessesRequest,
) (domain.ProcessListResponse, error) {
	startedAt := time.Now()
	var lastErr error
	var failed []string
	for _, strategy := range listProcessCommands {
		if err := ctx.Err(); err != nil {
			m.logList("warn", serverID, strategy.name, 0, 0, time.Since(startedAt), request.Query == "", err)
			return domain.ProcessListResponse{}, err
		}
		output, err := transport.Run(ctx, strategy.command)
		rawLines := countNonEmptyLines(output)
		if err != nil {
			lastErr = err
			failed = append(failed, strategy.name)
			m.logList("warn", serverID, strategy.name, rawLines, 0, time.Since(startedAt), request.Query == "", err)
			continue
		}
		response, err := parseSingleProcessList(serverID, strategy.name, "mode="+strategy.mode+"\n"+output)
		if err != nil {
			lastErr = err
			failed = append(failed, strategy.name)
			m.logList("warn", serverID, strategy.name, rawLines, 0, time.Since(startedAt), request.Query == "", err)
			continue
		}
		if response.Processes == nil {
			response.Processes = []domain.ProcessEntry{}
		}
		if response.Warnings == nil {
			response.Warnings = []string{}
		}
		response.Processes = filterSortLimitProcesses(response.Processes, request.Query, request.SortBy, request.SortDir, request.Limit)
		m.logList("info", serverID, response.ParserStrategy, rawLines, len(response.Processes), time.Since(startedAt), request.Query == "", nil)
		return response, nil
	}
	if lastErr == nil {
		lastErr = errors.New("未读取到进程数据")
	}
	err := fmt.Errorf("读取进程列表失败(%s): %w", strings.Join(failed, ","), lastErr)
	m.logList("warn", serverID, "", 0, 0, time.Since(startedAt), request.Query == "", err)
	return domain.ProcessListResponse{}, err
}

func (m *Manager) detailWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	pid int64,
) (domain.ProcessDetail, error) {
	if pid <= 0 {
		return domain.ProcessDetail{}, errors.New("进程 PID 无效")
	}
	output, detailErr := transport.Run(ctx, detailCommand(pid))
	values := parseDetailKV(output)
	if detailErr != nil {
		return domain.ProcessDetail{}, detailErr
	}
	if values["error"] == "not_found" {
		return domain.ProcessDetail{}, errors.New("进程已退出")
	}
	entry := entryFromDetailValues(serverID, values)
	if entry.PID <= 0 {
		return domain.ProcessDetail{}, errors.New("进程已退出")
	}
	return detailFromEntry(entry, values, nil)
}

func (m *Manager) runWatch(ctx context.Context, worker *watchWorker, interval time.Duration) {
	defer func() {
		_ = worker.transport.Close()
		m.mu.Lock()
		if current := m.watchers[worker.watchID]; current == worker {
			delete(m.watchers, worker.watchID)
		}
		m.mu.Unlock()
		m.emitState(worker.serverID, worker.watchID, "stopped")
	}()
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if !m.isCurrent(worker) {
			return
		}
		commandCtx, cancel := context.WithTimeout(ctx, listCommandTimeout)
		response, err := m.listWithTransport(commandCtx, worker.serverID, worker.transport, worker.request)
		cancel()
		if err != nil {
			message := "读取进程列表失败"
			if isTimeoutError(err) {
				message = "读取进程列表超时"
			}
			m.emitError(worker.serverID, worker.watchID, "PROCESS_WATCH_FAILED", message)
		} else if m.isCurrent(worker) {
			m.emitList(worker.watchID, response)
		}
		timer.Reset(interval)
	}
}

func (m *Manager) isCurrent(worker *watchWorker) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.watchers[worker.watchID] == worker && m.serverGeneration[worker.serverID] == worker.generation
}

func (m *Manager) generation(serverID int64) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.serverGeneration[serverID]
}

func (m *Manager) stopWatcherLocked(worker *watchWorker) {
	worker.cancel()
	if worker.transport != nil {
		_ = worker.transport.Close()
	}
}

func (m *Manager) emitState(serverID int64, watchID string, state string) {
	if m.emitter != nil {
		m.emitter.State(domain.ProcessStateEvent{
			ServerID: serverID, WatchID: watchID, State: state, Timestamp: timestamp(),
		})
	}
}

func (m *Manager) emitList(watchID string, response domain.ProcessListResponse) {
	if m.emitter != nil {
		m.emitter.List(domain.ProcessListEvent{
			ServerID: response.ServerID, WatchID: watchID, Processes: response.Processes,
			Warnings: response.Warnings, ParserStrategy: response.ParserStrategy, Timestamp: timestamp(),
		})
	}
}

func (m *Manager) emitDetail(watchID string, detail domain.ProcessDetail) {
	if m.emitter != nil {
		m.emitter.Detail(domain.ProcessDetailEvent{
			ServerID: detail.ServerID, WatchID: watchID, Detail: detail, Timestamp: timestamp(),
		})
	}
}

func (m *Manager) emitError(serverID int64, watchID string, code string, message string) {
	if m.emitter != nil {
		m.emitter.Error(domain.ProcessErrorEvent{
			ServerID: serverID, WatchID: watchID, Code: code, Message: message, Timestamp: timestamp(),
		})
	}
}

func (m *Manager) log(level string, message string, operation string, serverID int64, pid int64, signal string, err error) {
	if m.logger == nil {
		return
	}
	m.logger.Write(level, message, operation, serverID, sanitizeLogError(err, pid, signal))
}

func (m *Manager) logList(level string, serverID int64, strategy string, rawLines int, count int, duration time.Duration, queryEmpty bool, err error) {
	if m.logger == nil {
		return
	}
	message := fmt.Sprintf("进程列表读取完成 strategy=%s rawLines=%d count=%d durationMs=%d queryEmpty=%t", strategy, rawLines, count, duration.Milliseconds(), queryEmpty)
	if err != nil {
		message = fmt.Sprintf("进程列表读取失败 strategy=%s rawLines=%d durationMs=%d queryEmpty=%t", strategy, rawLines, duration.Milliseconds(), queryEmpty)
	}
	m.logger.Write(level, message, "process.list", serverID, sanitizeLogError(err, 0, ""))
}

func countNonEmptyLines(output string) int {
	count := 0
	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

func normalizeListRequest(request domain.ListProcessesRequest) domain.ListProcessesRequest {
	if request.SortBy == "" {
		request.SortBy = domain.ProcessSortCPU
	}
	if request.SortDir == "" {
		request.SortDir = domain.ProcessSortDesc
	}
	if request.Limit <= 0 {
		request.Limit = defaultProcessLimit
	}
	if request.Limit > maxProcessLimit {
		request.Limit = maxProcessLimit
	}
	return request
}

func validateSignalTarget(detail domain.ProcessDetail, expectedCommand string) error {
	if detail.PID == 1 {
		return errors.New("PID 1 是系统 init 进程，禁止操作")
	}
	if detail.IsKernelThread || !detail.CanSignal {
		return errors.New("内核线程或受保护进程不能发送信号")
	}
	expectedCommand = strings.TrimSpace(expectedCommand)
	if expectedCommand != "" && expectedCommand != detail.Command {
		return errors.New("进程命令已变化，已停止操作")
	}
	return nil
}

func entryFromDetailValues(serverID int64, values map[string]string) domain.ProcessEntry {
	pid, _ := strconvParseInt(values["pid"])
	ppid, _ := strconvParseInt(values["ppid"])
	rssKB := parseUint(values["rssKB"])
	vszKB := parseUint(values["vszKB"])
	entry := domain.ProcessEntry{
		ServerID:    serverID,
		PID:         pid,
		PPID:        ppid,
		User:        values["user"],
		State:       values["state"],
		StateLabel:  stateLabel(values["state"]),
		Command:     sanitizeProcessText(values["command"], 120),
		ArgsPreview: sanitizeProcessText(values["cmdline"], 240),
		RSSBytes:    rssKB * 1024,
		VSZBytes:    vszKB * 1024,
	}
	if entry.Command == "" {
		entry.Command = commandName(entry.ArgsPreview)
	}
	entry.IsKernelThread = values["kernel"] == "1" || isKernelLike(entry.Command, entry.ArgsPreview)
	entry.CanSignal = canSignal(entry)
	return entry
}

func userMessageForError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(message, "permission"), strings.Contains(message, "denied"):
		return "权限不足，无法读取或操作进程"
	case strings.Contains(message, "not found"), strings.Contains(message, "No such process"), strings.Contains(message, "进程已退出"):
		return "进程已退出"
	case strings.Contains(message, "context deadline exceeded"), strings.Contains(message, "i/o timeout"):
		return "读取进程信息超时"
	case strings.Contains(message, "读取进程列表失败"):
		return "读取进程列表失败"
	default:
		return "进程管理操作失败"
	}
}

func isTimeoutError(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "context deadline exceeded") ||
		strings.Contains(err.Error(), "i/o timeout")
}

func sanitizeLogError(err error, pid int64, signal string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("pid=%d signal=%s error=%s", pid, signal, userMessageForError(err))
}

func newID(prefix string) string {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(raw[:])
}
