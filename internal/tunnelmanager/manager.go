package tunnelmanager

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
	"hostdeck/internal/sshclient"
)

var ErrPublicBindRequiresConfirmation = errors.New("PUBLIC_BIND_REQUIRES_CONFIRMATION")

func UserMessage(err error) string {
	return userMessageForError(err)
}

type Transport interface {
	DialTCP(address string) (net.Conn, error)
	ListenTCP(address string) (net.Listener, error)
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
	State(domain.TunnelStateEvent)
	Error(domain.TunnelErrorEvent)
	Traffic(domain.TunnelTrafficEvent)
}

type realTransport struct {
	client *sshclient.Client
}

func (t realTransport) DialTCP(address string) (net.Conn, error) {
	return t.client.DialTCP(address)
}

func (t realTransport) ListenTCP(address string) (net.Listener, error) {
	return t.client.ListenTCP(address)
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
	mu          sync.RWMutex
	workers     map[string]*worker
}

type worker struct {
	mu         sync.Mutex
	state      domain.TunnelRuntime
	request    domain.StartTunnelRequest
	cancel     context.CancelFunc
	done       chan struct{}
	listener   net.Listener
	transport  Transport
	conns      map[net.Conn]struct{}
	pairs      int
	stopping   bool
	serverHost string
	serverUser string
}

type countWriter struct {
	writer io.Writer
	add    func(int64)
}

func (w countWriter) Write(data []byte) (int, error) {
	n, err := w.writer.Write(data)
	if n > 0 {
		w.add(int64(n))
	}
	return n, err
}

func New(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	timeout TimeoutProvider,
) *Manager {
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
		ctx: ctx, logger: logger, emitter: emitter, timeout: timeout,
		dial: dial, workers: make(map[string]*worker),
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

func (m *Manager) Start(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.StartTunnelRequest,
) (domain.TunnelRuntime, error) {
	request.ServerID = connection.ID
	normalized, err := normalizeStartRequest(request)
	if err != nil {
		return domain.TunnelRuntime{}, err
	}
	normalized.Auth = domain.AuthRequest{}
	if requiresPublicBind(normalized) && !normalized.ConfirmPublicBind {
		return domain.TunnelRuntime{}, ErrPublicBindRequiresConfirmation
	}

	ctx, cancel := context.WithCancel(m.ctx)
	current := &worker{
		state: domain.TunnelRuntime{
			TunnelID: newTunnelID(), ServerID: connection.ID, ProfileID: normalized.ProfileID,
			Name: normalized.Name, Type: normalized.Type, Status: domain.TunnelStatusStarting,
			BindHost: normalized.BindHost, BindPort: normalized.BindPort,
			TargetHost: normalized.TargetHost, TargetPort: normalized.TargetPort,
			RemoteBindHost: normalized.RemoteBindHost, RemoteBindPort: normalized.RemoteBindPort,
			RequestedListen:         requestedListen(normalized),
			RemoteListenExposure:    domain.RemoteListenExposureUnknown,
			RemoteListenCheckStatus: domain.RemoteListenUnchecked,
			UpdatedAt:               timestamp(),
		},
		request: normalized, cancel: cancel, done: make(chan struct{}), conns: make(map[net.Conn]struct{}),
		serverHost: connection.Host, serverUser: connection.Username,
	}
	m.emitState(current)

	if err := m.setup(ctx, current, connection, auth); err != nil {
		cancel()
		current.closeResources()
		current.setStatus(domain.TunnelStatusFailed, userMessageForError(err))
		m.emitState(current)
		m.emitError(current, errorCodeForError(err), userMessageForError(err))
		return domain.TunnelRuntime{}, err
	}
	m.startKeepalive(ctx, current)

	if normalized.Type == domain.TunnelTypeRemote {
		if _, err := m.checkRemoteListen(ctx, current); err != nil {
			cancel()
			current.closeResources()
			current.setStatus(domain.TunnelStatusFailed, userMessageForError(err))
			m.emitState(current)
			m.emitError(current, errorCodeForError(err), userMessageForError(err))
			return domain.TunnelRuntime{}, err
		}
	}

	current.setStatus(domain.TunnelStatusRunning, "")
	current.state.StartedAt = timestamp()
	current.state.UpdatedAt = current.state.StartedAt
	m.mu.Lock()
	m.workers[current.state.TunnelID] = current
	m.mu.Unlock()
	m.emitState(current)
	m.log("info", "SSH 隧道已启动", "tunnel.start", connection.ID, nil)

	go m.acceptLoop(ctx, current)
	return current.snapshot(), nil
}

func (m *Manager) startKeepalive(ctx context.Context, current *worker) {
	current.mu.Lock()
	transport := current.transport
	state := current.state
	current.mu.Unlock()
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  state.ServerID,
		Subsystem: "tunnel",
		TunnelID:  state.TunnelID,
	}, func(failure sshclient.KeepaliveFailure) {
		m.handleKeepaliveFailure(current, failure)
	})
}

func (m *Manager) handleKeepaliveFailure(current *worker, failure sshclient.KeepaliveFailure) {
	state := current.snapshot()
	transport := current.closeRuntimeResources(true)
	if transport != nil {
		_ = transport.Close()
	}
	current.setStatus(domain.TunnelStatusFailed, "SSH 保活失败，端口转发已停止")
	m.mu.Lock()
	if m.workers[state.TunnelID] == current {
		delete(m.workers, state.TunnelID)
	}
	m.mu.Unlock()
	m.emitState(current)
	m.emitError(current, "SSH_KEEPALIVE_FAILED", "SSH 保活失败，端口转发已停止")
	if m.logger != nil {
		m.logger.Write(
			"warn",
			fmt.Sprintf("SSH keepalive failed subsystem=tunnel failures=%d", failure.FailureCount),
			"ssh.keepalive",
			state.ServerID,
			sshclient.ErrKeepaliveFailed,
		)
	}
}

func (m *Manager) setup(
	ctx context.Context,
	current *worker,
	connection domain.Connection,
	auth domain.AuthRequest,
) error {
	request := current.request
	if request.Type == domain.TunnelTypeLocal || request.Type == domain.TunnelTypeDynamic {
		listener, err := (&net.ListenConfig{}).Listen(
			ctx,
			"tcp",
			net.JoinHostPort(request.BindHost, strconv.Itoa(request.BindPort)),
		)
		if err != nil {
			return fmt.Errorf("listen local tunnel: %w", err)
		}
		current.listener = listener
		if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok {
			current.state.BindPort = tcpAddr.Port
		}
	}

	dialCtx, cancel := context.WithTimeout(ctx, m.timeout())
	defer cancel()
	transport, _, err := m.dial(dialCtx, connection, auth, m.timeout())
	if err != nil {
		return fmt.Errorf("dial tunnel SSH client: %w", err)
	}
	m.persistHostKey(ctx, connection, auth, transport)
	current.transport = transport

	if request.Type == domain.TunnelTypeRemote {
		listener, err := transport.ListenTCP(
			net.JoinHostPort(request.RemoteBindHost, strconv.Itoa(request.RemoteBindPort)),
		)
		if err != nil {
			return fmt.Errorf("remote forward listen: %w", err)
		}
		current.listener = listener
	}
	return nil
}

func (m *Manager) persistHostKey(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, transport Transport) {
	if m.saveHostKey == nil || transport == nil || !sshclient.ShouldPersistObservedHostKey(connection, auth, transport.Fingerprint()) {
		return
	}
	if err := m.saveHostKey(ctx, connection.ID, transport.Fingerprint()); err != nil && m.logger != nil {
		m.logger.WriteConnection("error", "服务器已连接，但主机指纹记录更新失败", "tunnel.hostkey", connection, nil)
	}
}

func (m *Manager) CheckRemoteListen(request domain.CheckTunnelRemoteListenRequest) (domain.TunnelRuntime, error) {
	current, ok := m.worker(request.TunnelID)
	if !ok {
		return domain.TunnelRuntime{}, errors.New("隧道不存在")
	}
	state := current.snapshot()
	if request.ServerID > 0 && state.ServerID != request.ServerID {
		return domain.TunnelRuntime{}, errors.New("隧道不属于当前服务器")
	}
	if state.Type != domain.TunnelTypeRemote {
		return state, nil
	}
	result, err := m.checkRemoteListen(m.ctx, current)
	if result.Status == domain.RemoteListenNotFound {
		current.setStatus(domain.TunnelStatusFailed, "远程端口未监听，隧道启动失败")
		current.closeResources()
		m.emitState(current)
		m.emitError(current, "TUNNEL_REMOTE_LISTEN_NOT_FOUND", "远程端口未监听，隧道启动失败")
		return current.snapshot(), nil
	}
	m.emitState(current)
	return current.snapshot(), err
}

func (m *Manager) Stop(request domain.StopTunnelRequest) error {
	current, ok := m.worker(request.TunnelID)
	if !ok {
		return nil
	}
	if request.ServerID > 0 && current.snapshot().ServerID != request.ServerID {
		return errors.New("隧道不属于当前服务器")
	}
	return m.stopWorker(current, true)
}

func (m *Manager) StopProfile(profileID int64) error {
	if profileID <= 0 {
		return nil
	}
	for _, current := range m.workersForProfile(profileID) {
		if err := m.stopWorker(current, true); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) StopServer(serverID int64) {
	for _, current := range m.workersForServer(serverID) {
		_ = m.stopWorker(current, false)
	}
}

func (m *Manager) StopAll() {
	m.mu.RLock()
	workers := make([]*worker, 0, len(m.workers))
	for _, current := range m.workers {
		workers = append(workers, current)
	}
	m.mu.RUnlock()
	for _, current := range workers {
		_ = m.stopWorker(current, false)
	}
}

func (m *Manager) State(tunnelID string) (domain.TunnelRuntime, error) {
	current, ok := m.worker(tunnelID)
	if !ok {
		return domain.TunnelRuntime{}, errors.New("隧道不存在")
	}
	return current.snapshot(), nil
}

func (m *Manager) List(serverID int64) []domain.TunnelRuntime {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]domain.TunnelRuntime, 0, len(m.workers))
	for _, current := range m.workers {
		state := current.snapshot()
		if serverID > 0 && state.ServerID != serverID {
			continue
		}
		result = append(result, state)
	}
	return result
}

func (m *Manager) StartRequest(tunnelID string) (domain.StartTunnelRequest, bool) {
	current, ok := m.worker(tunnelID)
	if !ok {
		return domain.StartTunnelRequest{}, false
	}
	current.mu.Lock()
	defer current.mu.Unlock()
	return current.request, true
}

func (m *Manager) EnableRemoteForwardAccessAndStop(
	request domain.RemoteForwardAccessRequest,
) (domain.RemoteForwardAccessEnableResult, domain.StartTunnelRequest, error) {
	current, err := m.remoteAccessWorker(request)
	if err != nil {
		return domain.RemoteForwardAccessEnableResult{}, domain.StartTunnelRequest{}, err
	}
	startRequest, ok := current.startRequest()
	if !ok {
		return domain.RemoteForwardAccessEnableResult{}, domain.StartTunnelRequest{}, errors.New("端口转发不存在或已停止")
	}
	state := current.snapshot()
	current.setStatus(domain.TunnelStatusStopping, "")
	m.emitState(current)
	transport := current.closeRuntimeResources(false)
	if transport == nil {
		current.setStatus(domain.TunnelStatusFailed, "端口转发正在停止，无法启用远程访问")
		m.emitState(current)
		return domain.RemoteForwardAccessEnableResult{}, startRequest, errors.New("端口转发正在停止，无法启用远程访问")
	}
	defer func() {
		_ = transport.Close()
	}()
	select {
	case <-current.done:
	case <-time.After(2 * time.Second):
	}
	if err := verifyTunnelPortReleased(state, transport); err != nil {
		current.setStatus(domain.TunnelStatusFailed, err.Error())
		m.emitState(current)
		m.emitError(current, "TUNNEL_PORT_RELEASE_FAILED", err.Error())
		return domain.RemoteForwardAccessEnableResult{}, startRequest, err
	}
	result, err := m.enableRemoteForwardAccessOnTransport(transport)
	current.setStatus(domain.TunnelStatusStopped, "")
	m.mu.Lock()
	delete(m.workers, state.TunnelID)
	m.mu.Unlock()
	m.emitState(current)
	m.log("info", "SSH 隧道已停止并准备重启", "tunnel.remote_access.restart", state.ServerID, nil)
	if err != nil {
		return result, startRequest, err
	}
	return result, startRequest, nil
}

func (m *Manager) worker(tunnelID string) (*worker, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	current, ok := m.workers[tunnelID]
	return current, ok
}

func (m *Manager) workersForServer(serverID int64) []*worker {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := []*worker{}
	for _, current := range m.workers {
		if current.snapshot().ServerID == serverID {
			result = append(result, current)
		}
	}
	return result
}

func (m *Manager) workersForProfile(profileID int64) []*worker {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := []*worker{}
	for _, current := range m.workers {
		if current.snapshot().ProfileID == profileID {
			result = append(result, current)
		}
	}
	return result
}

func (m *Manager) stopWorker(current *worker, verifyRelease bool) error {
	state := current.snapshot()
	current.setStatus(domain.TunnelStatusStopping, "")
	m.emitState(current)
	transport := current.closeRuntimeResources(false)
	defer func() {
		if transport != nil {
			_ = transport.Close()
		}
	}()
	select {
	case <-current.done:
	case <-time.After(2 * time.Second):
	}
	if verifyRelease {
		if err := verifyTunnelPortReleased(state, transport); err != nil {
			current.setStatus(domain.TunnelStatusFailed, err.Error())
			m.emitState(current)
			m.emitError(current, "TUNNEL_PORT_RELEASE_FAILED", err.Error())
			return err
		}
	}
	current.setStatus(domain.TunnelStatusStopped, "")
	m.mu.Lock()
	delete(m.workers, state.TunnelID)
	m.mu.Unlock()
	m.emitState(current)
	m.log("info", "SSH 隧道已停止", "tunnel.stop", state.ServerID, nil)
	return nil
}

func (m *Manager) acceptLoop(ctx context.Context, current *worker) {
	defer close(current.done)
	for {
		conn, err := current.listener.Accept()
		if err != nil {
			if ctx.Err() != nil || current.isStopping() {
				return
			}
			current.setStatus(domain.TunnelStatusFailed, userMessageForError(err))
			m.emitState(current)
			m.emitError(current, errorCodeForError(err), userMessageForError(err))
			return
		}
		switch current.request.Type {
		case domain.TunnelTypeLocal:
			go m.handleLocalConn(current, conn)
		case domain.TunnelTypeDynamic:
			go m.handleSocksConn(current, conn)
		case domain.TunnelTypeRemote:
			go m.handleRemoteConn(current, conn)
		}
	}
}

func (m *Manager) handleLocalConn(current *worker, local net.Conn) {
	remote, err := current.transport.DialTCP(
		net.JoinHostPort(current.request.TargetHost, strconv.Itoa(current.request.TargetPort)),
	)
	if err != nil {
		_ = local.Close()
		m.emitError(current, errorCodeForError(err), "隧道连接远程目标失败")
		return
	}
	m.proxyPair(current, local, remote)
}

func (m *Manager) handleRemoteConn(current *worker, remote net.Conn) {
	local, err := (&net.Dialer{Timeout: 10 * time.Second}).Dial(
		"tcp",
		net.JoinHostPort(current.request.TargetHost, strconv.Itoa(current.request.TargetPort)),
	)
	if err != nil {
		_ = remote.Close()
		m.emitError(current, errorCodeForError(err), "远程转发连接本地目标失败")
		return
	}
	m.proxyPair(current, remote, local)
}

func (m *Manager) handleSocksConn(current *worker, local net.Conn) {
	target, ok := readSocksConnect(local)
	if !ok {
		_ = local.Close()
		return
	}
	remote, err := current.transport.DialTCP(target)
	if err != nil {
		_ = writeSocksReply(local, 0x05)
		_ = local.Close()
		m.emitError(current, errorCodeForError(err), "SOCKS5 连接目标失败")
		return
	}
	_ = writeSocksReply(local, 0x00)
	m.proxyPair(current, local, remote)
}

func (m *Manager) proxyPair(current *worker, left, right net.Conn) {
	current.addPair(left, right)
	m.emitTraffic(current)
	defer func() {
		_ = left.Close()
		_ = right.Close()
		current.removePair(left, right)
		m.emitTraffic(current)
	}()
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(countWriter{writer: right, add: current.addBytesIn}, left)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(countWriter{writer: left, add: current.addBytesOut}, right)
		done <- struct{}{}
	}()
	<-done
	_ = left.Close()
	_ = right.Close()
	<-done
	m.emitTraffic(current)
}

func (m *Manager) emitState(current *worker) {
	if m.emitter == nil {
		return
	}
	state := current.snapshot()
	m.emitter.State(domain.TunnelStateEvent{
		ServerID: state.ServerID, TunnelID: state.TunnelID, State: state, Timestamp: timestamp(),
	})
}

func (m *Manager) emitError(current *worker, code, message string) {
	if m.emitter == nil {
		return
	}
	state := current.snapshot()
	m.emitter.Error(domain.TunnelErrorEvent{
		ServerID: state.ServerID, TunnelID: state.TunnelID, Code: code, Message: message, Timestamp: timestamp(),
	})
}

func (m *Manager) emitTraffic(current *worker) {
	if m.emitter == nil {
		return
	}
	state := current.snapshot()
	m.emitter.Traffic(domain.TunnelTrafficEvent{
		ServerID: state.ServerID, TunnelID: state.TunnelID,
		ActiveConnections: state.ActiveConnections, BytesIn: state.BytesIn, BytesOut: state.BytesOut,
		Timestamp: timestamp(),
	})
}

func (m *Manager) log(level, message, operation string, serverID int64, err error) {
	if m.logger != nil {
		m.logger.Write(level, message, operation, serverID, err)
	}
}

func (w *worker) snapshot() domain.TunnelRuntime {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.state
}

func (w *worker) startRequest() (domain.StartTunnelRequest, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stopping {
		return domain.StartTunnelRequest{}, false
	}
	return w.request, true
}

func (w *worker) setStatus(status domain.TunnelStatus, message string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.state.Status = status
	w.state.Error = message
	w.state.UpdatedAt = timestamp()
}

func (w *worker) closeResources() {
	transport := w.closeRuntimeResources(true)
	if transport != nil {
		_ = transport.Close()
	}
}

func (w *worker) closeRuntimeResources(closeTransport bool) Transport {
	w.mu.Lock()
	if w.stopping {
		w.mu.Unlock()
		return nil
	}
	w.stopping = true
	cancel := w.cancel
	listener := w.listener
	transport := w.transport
	conns := make([]net.Conn, 0, len(w.conns))
	for conn := range w.conns {
		conns = append(conns, conn)
	}
	w.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if listener != nil {
		_ = listener.Close()
	}
	for _, conn := range conns {
		_ = conn.Close()
	}
	if closeTransport && transport != nil {
		_ = transport.Close()
		return nil
	}
	return transport
}

func (w *worker) isStopping() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stopping
}

func (w *worker) addPair(left, right net.Conn) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.conns[left] = struct{}{}
	w.conns[right] = struct{}{}
	w.pairs++
	w.state.ActiveConnections = w.pairs
	w.state.UpdatedAt = timestamp()
}

func (w *worker) removePair(left, right net.Conn) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.conns, left)
	delete(w.conns, right)
	if w.pairs > 0 {
		w.pairs--
	}
	w.state.ActiveConnections = w.pairs
	w.state.UpdatedAt = timestamp()
}

func (w *worker) addBytesIn(value int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.state.BytesIn += value
	w.state.UpdatedAt = timestamp()
}

func (w *worker) addBytesOut(value int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.state.BytesOut += value
	w.state.UpdatedAt = timestamp()
}

func normalizeStartRequest(request domain.StartTunnelRequest) (domain.StartTunnelRequest, error) {
	request.Name = strings.TrimSpace(request.Name)
	request.BindHost = defaultHost(strings.TrimSpace(request.BindHost))
	request.TargetHost = strings.TrimSpace(request.TargetHost)
	request.RemoteBindHost = defaultHost(strings.TrimSpace(request.RemoteBindHost))
	if request.Name == "" {
		request.Name = defaultTunnelName(request)
	}
	switch request.Type {
	case domain.TunnelTypeLocal:
		if !validPort(request.BindPort) {
			return request, errors.New("本地监听端口必须在 1-65535 之间")
		}
		if request.TargetHost == "" || !validPort(request.TargetPort) {
			return request, errors.New("本地转发需要远程目标地址和端口")
		}
	case domain.TunnelTypeRemote:
		if !validPort(request.RemoteBindPort) {
			return request, errors.New("远程监听端口必须在 1-65535 之间")
		}
		if request.TargetHost == "" || !validPort(request.TargetPort) {
			return request, errors.New("远程转发需要本地目标地址和端口")
		}
	case domain.TunnelTypeDynamic:
		if !validPort(request.BindPort) {
			return request, errors.New("SOCKS5 本地监听端口必须在 1-65535 之间")
		}
		request.TargetHost = ""
		request.TargetPort = 0
	default:
		return request, errors.New("隧道类型无效")
	}
	return request, nil
}

func defaultHost(value string) string {
	if value == "" {
		return "127.0.0.1"
	}
	return value
}

func defaultTunnelName(request domain.StartTunnelRequest) string {
	switch request.Type {
	case domain.TunnelTypeRemote:
		return "远程转发"
	case domain.TunnelTypeDynamic:
		return "动态 SOCKS5"
	default:
		return "本地转发"
	}
}

func validPort(port int) bool {
	return port >= 1 && port <= 65535
}

func requiresPublicBind(request domain.StartTunnelRequest) bool {
	if request.Type == domain.TunnelTypeRemote {
		return request.RemoteBindHost == "0.0.0.0" || request.RemoteBindHost == "::"
	}
	return request.BindHost == "0.0.0.0" || request.BindHost == "::"
}

func readSocksConnect(conn net.Conn) (string, bool) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(conn, header); err != nil || header[0] != 0x05 {
		return "", false
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(conn, methods); err != nil {
		return "", false
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return "", false
	}
	request := make([]byte, 4)
	if _, err := io.ReadFull(conn, request); err != nil || request[0] != 0x05 {
		return "", false
	}
	if request[1] != 0x01 {
		_ = writeSocksReply(conn, 0x07)
		return "", false
	}
	var host string
	switch request[3] {
	case 0x01:
		addr := make([]byte, 4)
		if _, err := io.ReadFull(conn, addr); err != nil {
			return "", false
		}
		host = net.IP(addr).String()
	case 0x03:
		length := make([]byte, 1)
		if _, err := io.ReadFull(conn, length); err != nil {
			return "", false
		}
		addr := make([]byte, int(length[0]))
		if _, err := io.ReadFull(conn, addr); err != nil {
			return "", false
		}
		host = string(addr)
	case 0x04:
		addr := make([]byte, 16)
		if _, err := io.ReadFull(conn, addr); err != nil {
			return "", false
		}
		host = net.IP(addr).String()
	default:
		_ = writeSocksReply(conn, 0x08)
		return "", false
	}
	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(conn, portBytes); err != nil {
		return "", false
	}
	port := int(portBytes[0])<<8 | int(portBytes[1])
	return net.JoinHostPort(host, strconv.Itoa(port)), true
}

func writeSocksReply(conn net.Conn, code byte) error {
	_, err := conn.Write([]byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	return err
}

func userMessageForError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case errors.Is(err, ErrPublicBindRequiresConfirmation):
		return "监听 0.0.0.0 会让局域网或外部设备访问此端口，请确认是否继续。"
	case strings.Contains(message, "bind") && strings.Contains(message, "permission"):
		return "端口绑定失败：低端口可能需要管理员权限。"
	case strings.Contains(message, "address already in use") ||
		strings.Contains(message, "only one usage of each socket address"):
		return "端口已被占用，请更换监听端口。"
	case strings.Contains(message, "administratively prohibited") ||
		strings.Contains(message, "remote forward listen"):
		return "远程端口转发被服务器拒绝，请检查 sshd AllowTcpForwarding/GatewayPorts 配置。"
	case errors.Is(err, errRemoteListenNotFound) ||
		strings.Contains(message, "remote listen verification"):
		return "远程端口未监听，隧道启动失败。"
	case strings.Contains(message, "listen local tunnel"):
		return "本地监听端口启动失败，请检查地址、端口和权限。"
	case strings.Contains(message, "dial tunnel ssh client"):
		return "隧道 SSH 连接失败，请检查服务器连接和凭据。"
	default:
		return "端口转发失败，请查看应用日志。"
	}
}

func errorCodeForError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case errors.Is(err, ErrPublicBindRequiresConfirmation):
		return "PUBLIC_BIND_REQUIRES_CONFIRMATION"
	case strings.Contains(message, "address already in use") ||
		strings.Contains(message, "only one usage of each socket address"):
		return "TUNNEL_PORT_IN_USE"
	case strings.Contains(message, "permission") || errors.Is(err, syscall.EACCES):
		return "TUNNEL_BIND_PERMISSION"
	case strings.Contains(message, "administratively prohibited") ||
		strings.Contains(message, "remote forward listen"):
		return "TUNNEL_REMOTE_FORWARD_REJECTED"
	case errors.Is(err, errRemoteListenNotFound) ||
		strings.Contains(message, "remote listen verification"):
		return "TUNNEL_REMOTE_LISTEN_NOT_FOUND"
	default:
		return "TUNNEL_ERROR"
	}
}

func newTunnelID() string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("tun-%d", time.Now().UnixNano())
	}
	return "tun-" + hex.EncodeToString(bytes[:])
}

func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
