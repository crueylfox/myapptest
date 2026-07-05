package servicemanager

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/sshclient"
)

const (
	listCommandTimeout   = 10 * time.Second
	detailCommandTimeout = 5 * time.Second
	actionCommandTimeout = 20 * time.Second
	journalReadTimeout   = 10 * time.Second
)

type StreamingCommand = sshclient.StreamingCommand

type Transport interface {
	Run(context.Context, string) (string, error)
	StartStreamingCommand(context.Context, string) (StreamingCommand, error)
	Fingerprint() string
	Close() error
}

type Dialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error)
type HostKeySaver func(context.Context, int64, string) error
type TimeoutProvider func() time.Duration
type KeepalivePolicyProvider func() sshclient.KeepalivePolicy

type Emitter interface {
	JournalState(domain.ServiceJournalStateEvent)
	JournalLine(domain.ServiceJournalLineEvent)
	JournalError(domain.ServiceJournalErrorEvent)
	JournalCompleted(domain.ServiceJournalCompletedEvent)
}

type keepaliveStarter interface {
	StartKeepalive(context.Context, sshclient.KeepalivePolicy, sshclient.KeepaliveMetadata, sshclient.KeepaliveFailureHandler) *sshclient.KeepaliveHandle
}

type realTransport struct {
	client *sshclient.Client
}

func (t realTransport) Run(ctx context.Context, command string) (string, error) {
	return t.client.Run(ctx, command)
}

func (t realTransport) StartStreamingCommand(ctx context.Context, command string) (StreamingCommand, error) {
	return t.client.StartStreamingCommand(ctx, command)
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
	timeout     TimeoutProvider
	keepalive   KeepalivePolicyProvider
	dial        Dialer
	saveHostKey HostKeySaver
	emitter     Emitter

	mu              sync.Mutex
	sequence        int64
	operations      map[string]*operation
	capabilities    map[int64]domain.ServiceManagerCapability
	journalWatchers map[string]*journalWatcher
	journalByScope  map[string]string
}

type operation struct {
	serverID  int64
	key       string
	kind      string
	unitName  string
	cancel    context.CancelFunc
	transport Transport
}

func New(ctx context.Context, logger *logging.Logger, timeout TimeoutProvider) *Manager {
	return NewWithDialer(ctx, logger, timeout, func(
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

func NewWithDialer(ctx context.Context, logger *logging.Logger, timeout TimeoutProvider, dial Dialer) *Manager {
	if timeout == nil {
		timeout = func() time.Duration { return 15 * time.Second }
	}
	return &Manager{
		ctx:             ctx,
		logger:          logger,
		timeout:         timeout,
		dial:            dial,
		operations:      make(map[string]*operation),
		capabilities:    make(map[int64]domain.ServiceManagerCapability),
		journalWatchers: make(map[string]*journalWatcher),
		journalByScope:  make(map[string]string),
	}
}

func (m *Manager) SetKeepalivePolicyProvider(provider KeepalivePolicyProvider) {
	m.keepalive = provider
}

func (m *Manager) SetHostKeySaver(save HostKeySaver) {
	m.saveHostKey = save
}

func (m *Manager) SetEmitter(emitter Emitter) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emitter = emitter
}

func (m *Manager) Check(
	connection domain.Connection,
	auth domain.AuthRequest,
) (domain.ServiceManagerCapability, error) {
	ctx, op := m.beginOperation(connection.ID, "check", "", false)
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, listCommandTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		return domain.ServiceManagerCapability{}, errors.New(userMessageForError(err, "系统服务检测失败。"))
	}
	defer transport.Close()
	capability, err := m.detectCapability(commandCtx, transport, connection.ID)
	if err != nil {
		return domain.ServiceManagerCapability{}, err
	}
	m.cacheCapability(capability)
	return capability, nil
}

func (m *Manager) List(
	connection domain.Connection,
	auth domain.AuthRequest,
) (domain.SystemServiceListResponse, error) {
	ctx, op := m.beginOperation(connection.ID, "list", "", false)
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, listCommandTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		return domain.SystemServiceListResponse{}, errors.New(userMessageForError(err, "读取系统服务列表失败。"))
	}
	defer transport.Close()
	capability, err := m.ensureCapability(commandCtx, transport, connection.ID)
	if err != nil {
		return domain.SystemServiceListResponse{}, err
	}
	if !capability.Available {
		return domain.SystemServiceListResponse{}, errors.New(capability.Error)
	}
	services, err := m.listWithCapability(commandCtx, transport, connection.ID, capability)
	if err != nil {
		return domain.SystemServiceListResponse{}, err
	}
	return domain.SystemServiceListResponse{
		ServerID:  connection.ID,
		Services:  services,
		Timestamp: timestamp(),
	}, nil
}

func (m *Manager) Detail(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
) (domain.SystemServiceDetail, error) {
	ctx, op := m.beginOperation(connection.ID, "detail", "", false)
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, detailCommandTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		return domain.SystemServiceDetail{}, errors.New(userMessageForError(err, "读取服务详情失败。"))
	}
	defer transport.Close()
	capability, err := m.ensureCapability(commandCtx, transport, connection.ID)
	if err != nil {
		return domain.SystemServiceDetail{}, err
	}
	if !capability.Available {
		return domain.SystemServiceDetail{}, errors.New(capability.Error)
	}
	serviceID, err := validateServiceIdentifier(capability.InitSystem, request)
	if err != nil {
		return domain.SystemServiceDetail{}, err
	}
	if capability.InitSystem == domain.ServiceManagerInitSystemOpenWrtProcd {
		return m.procdDetail(commandCtx, transport, connection.ID, serviceID, capability)
	}
	unitName := serviceID
	output, err := transport.Run(commandCtx, systemdBaseDetailCommand(unitName))
	if err != nil {
		detail, fallbackErr := m.fallbackDetail(commandCtx, transport, connection.ID, unitName)
		if fallbackErr != nil {
			return domain.SystemServiceDetail{}, errors.New(userMessageForError(fallbackErr, userMessageForError(err, "读取服务详情失败。")))
		}
		return detail, nil
	}
	detail := parseSystemdServiceDetail(connection.ID, unitName, output)
	if detail.UnitName == "" || detail.LoadState == "not-found" {
		return domain.SystemServiceDetail{}, errors.New("服务不存在或已被移除。")
	}
	if optionalOutput, optionalErr := transport.Run(commandCtx, systemdOptionalDetailCommand(unitName)); optionalErr == nil {
		detail = mergeSystemdOptionalDetail(detail, optionalOutput)
	} else {
		detail = markPartialDetail(detail)
	}
	return detail, nil
}

func (m *Manager) fallbackDetail(
	ctx context.Context,
	transport Transport,
	serverID int64,
	unitName string,
) (domain.SystemServiceDetail, error) {
	output, err := transport.Run(ctx, systemdFallbackDetailCommand(unitName))
	if err != nil {
		return domain.SystemServiceDetail{}, err
	}
	detail := parseSystemdFallbackDetail(serverID, unitName, output)
	if detail.UnitName == "" || detail.LoadState == "not-found" {
		return domain.SystemServiceDetail{}, errors.New("服务不存在或已被移除。")
	}
	return detail, nil
}

func (m *Manager) Start(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
) (domain.SystemServiceActionResponse, error) {
	return m.runAction(connection, auth, request, "start", "服务启动失败。")
}

func (m *Manager) Stop(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
) (domain.SystemServiceActionResponse, error) {
	return m.runAction(connection, auth, request, "stop", "服务停止失败。")
}

func (m *Manager) Restart(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
) (domain.SystemServiceActionResponse, error) {
	return m.runAction(connection, auth, request, "restart", "服务重启失败。")
}

func (m *Manager) Enable(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
) (domain.SystemServiceActionResponse, error) {
	return m.runAction(connection, auth, request, "enable", "启用开机启动失败。")
}

func (m *Manager) Disable(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
) (domain.SystemServiceActionResponse, error) {
	return m.runAction(connection, auth, request, "disable", "禁用开机启动失败。")
}

func (m *Manager) runAction(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.SystemServiceActionRequest,
	action string,
	fallback string,
) (domain.SystemServiceActionResponse, error) {
	capability, err := m.capabilityForAction(connection, auth)
	if err != nil {
		return actionResponse(connection.ID, requestServiceIdentifier(request), request.UnitName, action, false, err.Error()), err
	}
	if !capability.Available {
		err := errors.New(capability.Error)
		return actionResponse(connection.ID, requestServiceIdentifier(request), request.UnitName, action, false, err.Error()), err
	}
	serviceID, err := validateServiceIdentifier(capability.InitSystem, request)
	if err != nil {
		return actionResponse(connection.ID, requestServiceIdentifier(request), request.UnitName, action, false, err.Error()), err
	}
	unitName := serviceID
	if isProtectedService(capability.InitSystem, serviceID) {
		err := errors.New("该服务不允许执行此操作。")
		return actionResponse(connection.ID, serviceID, unitName, action, false, err.Error()), err
	}
	ctx, op, err := m.beginExclusiveAction(connection.ID, serviceID)
	if err != nil {
		return actionResponse(connection.ID, serviceID, unitName, action, false, err.Error()), err
	}
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, actionCommandTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		message := userMessageForError(err, fallback)
		return actionResponse(connection.ID, serviceID, unitName, action, false, message), errors.New(message)
	}
	defer transport.Close()
	root := m.isRoot(commandCtx, transport)
	command, err := actionCommandForCapability(capability.InitSystem, action, serviceID, root)
	if err != nil {
		return actionResponse(connection.ID, serviceID, unitName, action, false, err.Error()), err
	}
	if _, err := transport.Run(commandCtx, command); err != nil {
		message := userMessageForServiceError(capability.InitSystem, err, fallback)
		return actionResponse(connection.ID, serviceID, unitName, action, false, message), errors.New(message)
	}
	m.log("info", "系统服务操作完成", "servicemanager."+action, connection.ID, nil)
	return actionResponse(connection.ID, serviceID, unitName, action, true, "操作完成。"), nil
}

func (m *Manager) detectCapability(ctx context.Context, transport Transport, serverID int64) (domain.ServiceManagerCapability, error) {
	output, err := transport.Run(ctx, systemdCapabilityCommand)
	if err == nil {
		capability := parseCapability(serverID, output)
		if capability.Available {
			return capability, nil
		}
	} else if isTimeoutError(err) {
		return domain.ServiceManagerCapability{}, errors.New(timeoutMessage)
	}
	output, err = transport.Run(ctx, procdCapabilityCommand)
	if err == nil {
		capability := parseProcdCapability(serverID, output)
		if capability.Available {
			return capability, nil
		}
		return unsupportedCapability(serverID), nil
	}
	if isTimeoutError(err) {
		return domain.ServiceManagerCapability{}, errors.New(timeoutMessage)
	}
	return unsupportedCapability(serverID), nil
}

func (m *Manager) ensureCapability(ctx context.Context, transport Transport, serverID int64) (domain.ServiceManagerCapability, error) {
	if capability, ok := m.cachedCapability(serverID); ok {
		return capability, nil
	}
	capability, err := m.detectCapability(ctx, transport, serverID)
	if err != nil {
		return domain.ServiceManagerCapability{}, err
	}
	m.cacheCapability(capability)
	return capability, nil
}

func (m *Manager) cachedCapability(serverID int64) (domain.ServiceManagerCapability, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	capability, ok := m.capabilities[serverID]
	return capability, ok
}

func (m *Manager) cacheCapability(capability domain.ServiceManagerCapability) {
	if capability.ServerID == 0 {
		return
	}
	m.mu.Lock()
	m.capabilities[capability.ServerID] = capability
	m.mu.Unlock()
}

func (m *Manager) capabilityForAction(
	connection domain.Connection,
	auth domain.AuthRequest,
) (domain.ServiceManagerCapability, error) {
	if capability, ok := m.cachedCapability(connection.ID); ok {
		return capability, nil
	}
	ctx, op := m.beginOperation(connection.ID, "check", "", false)
	defer m.finishOperation(op)
	commandCtx, cancel := context.WithTimeout(ctx, listCommandTimeout)
	defer cancel()
	transport, err := m.open(commandCtx, connection, auth, op)
	if err != nil {
		return domain.ServiceManagerCapability{}, errors.New(userMessageForError(err, "系统服务检测失败。"))
	}
	defer transport.Close()
	return m.ensureCapability(commandCtx, transport, connection.ID)
}

func (m *Manager) listWithCapability(
	ctx context.Context,
	transport Transport,
	serverID int64,
	capability domain.ServiceManagerCapability,
) ([]domain.SystemServiceSummary, error) {
	switch capability.InitSystem {
	case domain.ServiceManagerInitSystemSystemd:
		output, err := transport.Run(ctx, systemdListCommand)
		if err != nil {
			return nil, errors.New(userMessageForError(err, "读取系统服务列表失败。"))
		}
		return parseSystemdServiceList(serverID, output), nil
	case domain.ServiceManagerInitSystemOpenWrtProcd:
		output, err := transport.Run(ctx, procdListCommand)
		if err != nil {
			return nil, errors.New(userMessageForServiceError(capability.InitSystem, err, "读取系统服务列表失败。"))
		}
		return parseProcdServiceList(serverID, output), nil
	default:
		return nil, errors.New(serviceManagerUnsupportedMessage)
	}
}

func (m *Manager) procdDetail(
	ctx context.Context,
	transport Transport,
	serverID int64,
	serviceID string,
	capability domain.ServiceManagerCapability,
) (domain.SystemServiceDetail, error) {
	output, err := transport.Run(ctx, procdDetailCommand(serviceID))
	if err != nil {
		return domain.SystemServiceDetail{}, errors.New(userMessageForServiceError(capability.InitSystem, err, "读取服务详情失败。"))
	}
	detail := parseProcdServiceDetail(serverID, serviceID, output, capability)
	if detail.LoadState == "not-found" {
		return domain.SystemServiceDetail{}, errors.New(procdMissingServiceText)
	}
	return detail, nil
}

func (m *Manager) CancelQueries(serverID int64) {
	m.mu.Lock()
	operations := make([]*operation, 0)
	for key, op := range m.operations {
		if op.serverID == serverID && op.kind != "action" {
			delete(m.operations, key)
			operations = append(operations, op)
		}
	}
	m.mu.Unlock()
	for _, op := range operations {
		op.cancel()
		if op.transport != nil {
			_ = op.transport.Close()
		}
	}
}

func (m *Manager) StopServer(serverID int64) {
	m.mu.Lock()
	operations := make([]*operation, 0)
	for key, op := range m.operations {
		if op.serverID == serverID {
			delete(m.operations, key)
			operations = append(operations, op)
		}
	}
	delete(m.capabilities, serverID)
	watchers := make([]*journalWatcher, 0)
	for watchID, watcher := range m.journalWatchers {
		if watcher.serverID == serverID {
			delete(m.journalWatchers, watchID)
			delete(m.journalByScope, journalScope(watcher.serverID, watcher.unitName))
			watchers = append(watchers, watcher)
		}
	}
	m.mu.Unlock()
	for _, op := range operations {
		op.cancel()
		if op.transport != nil {
			_ = op.transport.Close()
		}
	}
	for _, watcher := range watchers {
		m.stopJournalWatcher(watcher, "server_stopped", true)
	}
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	operations := make([]*operation, 0, len(m.operations))
	for key, op := range m.operations {
		delete(m.operations, key)
		operations = append(operations, op)
	}
	m.capabilities = make(map[int64]domain.ServiceManagerCapability)
	watchers := make([]*journalWatcher, 0, len(m.journalWatchers))
	for watchID, watcher := range m.journalWatchers {
		delete(m.journalWatchers, watchID)
		delete(m.journalByScope, journalScope(watcher.serverID, watcher.unitName))
		watchers = append(watchers, watcher)
	}
	m.mu.Unlock()
	for _, op := range operations {
		op.cancel()
		if op.transport != nil {
			_ = op.transport.Close()
		}
	}
	for _, watcher := range watchers {
		m.stopJournalWatcher(watcher, "app_stopped", true)
	}
}

func (m *Manager) OperationCount(serverID int64) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, op := range m.operations {
		if serverID == 0 || op.serverID == serverID {
			count++
		}
	}
	return count
}

func (m *Manager) JournalWatcherCount(serverID int64) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, watcher := range m.journalWatchers {
		if serverID == 0 || watcher.serverID == serverID {
			count++
		}
	}
	return count
}

func (m *Manager) open(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
	op *operation,
) (Transport, error) {
	transport, _, err := m.dial(ctx, connection, auth, m.timeout())
	if err != nil {
		return nil, err
	}
	m.persistHostKey(ctx, connection, auth, transport)
	m.attachTransport(op, transport)
	m.startKeepalive(ctx, transport, connection.ID)
	return transport, nil
}

func (m *Manager) persistHostKey(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, transport Transport) {
	if m.saveHostKey == nil || transport == nil || !sshclient.ShouldPersistObservedHostKey(connection, auth, transport.Fingerprint()) {
		return
	}
	if err := m.saveHostKey(ctx, connection.ID, transport.Fingerprint()); err != nil && m.logger != nil {
		m.logger.WriteConnection("error", "服务器已连接，但主机指纹记录更新失败", "servicemanager.hostkey", connection, nil)
	}
}

func (m *Manager) startKeepalive(ctx context.Context, transport Transport, serverID int64) {
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  serverID,
		Subsystem: "servicemanager",
	}, func(failure sshclient.KeepaliveFailure) {
		if m.logger != nil {
			m.logger.Write(
				"warn",
				fmt.Sprintf("SSH keepalive failed subsystem=servicemanager failures=%d", failure.FailureCount),
				"ssh.keepalive",
				serverID,
				sshclient.ErrKeepaliveFailed,
			)
		}
	})
}

func (m *Manager) keepalivePolicy() sshclient.KeepalivePolicy {
	if m.keepalive == nil {
		return sshclient.KeepalivePolicy{}
	}
	return m.keepalive()
}

func (m *Manager) isRoot(ctx context.Context, transport Transport) bool {
	output, err := transport.Run(ctx, idUserCommand)
	return err == nil && strings.TrimSpace(output) == "0"
}

func (m *Manager) beginOperation(serverID int64, kind string, unitName string, exclusive bool) (context.Context, *operation) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sequence++
	key := fmt.Sprintf("%s:%d:%d", kind, serverID, m.sequence)
	if exclusive {
		key = actionOperationKey(serverID, unitName)
	}
	ctx, cancel := context.WithCancel(m.ctx)
	op := &operation{serverID: serverID, key: key, kind: kind, unitName: unitName, cancel: cancel}
	m.operations[key] = op
	return ctx, op
}

func (m *Manager) beginExclusiveAction(serverID int64, unitName string) (context.Context, *operation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := actionOperationKey(serverID, unitName)
	if _, exists := m.operations[key]; exists {
		return nil, nil, errors.New("该服务正在执行操作，请稍后再试。")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	op := &operation{serverID: serverID, key: key, kind: "action", unitName: unitName, cancel: cancel}
	m.operations[key] = op
	return ctx, op, nil
}

func (m *Manager) attachTransport(op *operation, transport Transport) {
	if op == nil {
		return
	}
	m.mu.Lock()
	if m.operations[op.key] == op {
		op.transport = transport
	}
	m.mu.Unlock()
}

func (m *Manager) finishOperation(op *operation) {
	if op == nil {
		return
	}
	m.mu.Lock()
	if m.operations[op.key] == op {
		delete(m.operations, op.key)
	}
	m.mu.Unlock()
	op.cancel()
}

func actionOperationKey(serverID int64, unitName string) string {
	return fmt.Sprintf("action:%d:%s", serverID, unitName)
}

func unsupportedCapability(serverID int64) domain.ServiceManagerCapability {
	return domain.ServiceManagerCapability{
		ServerID:                serverID,
		Available:               false,
		InitSystem:              domain.ServiceManagerInitSystemUnsupported,
		DisplayName:             "不支持",
		SupportsJournal:         false,
		SupportsLiveLogs:        false,
		SupportsResourceMetrics: false,
		SupportsStart:           false,
		SupportsStop:            false,
		SupportsRestart:         false,
		SupportsEnable:          false,
		SupportsDisable:         false,
		Error:                   serviceManagerUnsupportedMessage,
	}
}

func actionResponse(serverID int64, serviceID string, unitName string, action string, success bool, message string) domain.SystemServiceActionResponse {
	if unitName == "" {
		unitName = serviceID
	}
	if serviceID == "" {
		serviceID = unitName
	}
	return domain.SystemServiceActionResponse{
		ServerID:  serverID,
		ServiceID: serviceID,
		UnitName:  unitName,
		Action:    action,
		Success:   success,
		Message:   message,
		Timestamp: timestamp(),
	}
}

func requestServiceIdentifier(request domain.SystemServiceActionRequest) string {
	return firstNonEmpty(request.ServiceID, request.UnitName)
}

func validateServiceIdentifier(initSystem domain.ServiceManagerInitSystem, request domain.SystemServiceActionRequest) (string, error) {
	value := requestServiceIdentifier(request)
	switch initSystem {
	case domain.ServiceManagerInitSystemSystemd:
		return validateUnitName(value)
	case domain.ServiceManagerInitSystemOpenWrtProcd:
		return validateProcdServiceID(value)
	default:
		return "", errors.New(serviceManagerUnsupportedMessage)
	}
}

func isProtectedService(initSystem domain.ServiceManagerInitSystem, serviceID string) bool {
	if initSystem == domain.ServiceManagerInitSystemOpenWrtProcd {
		return isProtectedProcdService(serviceID)
	}
	return isProtectedUnit(serviceID)
}

func actionCommandForCapability(initSystem domain.ServiceManagerInitSystem, action string, serviceID string, root bool) (string, error) {
	if initSystem == domain.ServiceManagerInitSystemOpenWrtProcd {
		return procdActionCommand(action, serviceID, root)
	}
	return systemctlActionCommand(action, serviceID, root), nil
}

func (m *Manager) log(level string, message string, operation string, serverID int64, err error) {
	if m.logger == nil {
		return
	}
	m.logger.Write(level, message, operation, serverID, err)
}
