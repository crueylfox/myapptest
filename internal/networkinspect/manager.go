package networkinspect

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

const (
	snapshotTimeout = 10 * time.Second
	maxOutputBytes  = 1024 * 1024
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
	timeout     TimeoutProvider
	keepalive   KeepalivePolicyProvider
	dial        Dialer
	saveHostKey HostKeySaver

	mu       sync.Mutex
	contexts map[string]*inspectionContext
}

type inspectionContext struct {
	serverID  int64
	contextID string
	ctx       context.Context
	cancel    context.CancelFunc
	openedAt  string
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
		ctx:      ctx,
		logger:   logger,
		timeout:  timeout,
		dial:     dial,
		contexts: make(map[string]*inspectionContext),
	}
}

func (m *Manager) SetKeepalivePolicyProvider(provider KeepalivePolicyProvider) {
	m.keepalive = provider
}

func (m *Manager) SetHostKeySaver(save HostKeySaver) {
	m.saveHostKey = save
}

func (m *Manager) Open(serverID int64) (domain.OpenNetworkInspectionContextResponse, error) {
	if serverID <= 0 {
		return domain.OpenNetworkInspectionContextResponse{}, errors.New("请选择服务器")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	contextID := newID("network-inspect")
	openedAt := timestamp()
	m.mu.Lock()
	m.contexts[contextID] = &inspectionContext{
		serverID:  serverID,
		contextID: contextID,
		ctx:       ctx,
		cancel:    cancel,
		openedAt:  openedAt,
	}
	m.mu.Unlock()
	return domain.OpenNetworkInspectionContextResponse{
		ServerID: serverID, ContextID: contextID, OpenedAt: openedAt,
	}, nil
}

func (m *Manager) Snapshot(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.NetworkEndpointSnapshotRequest,
) (domain.NetworkEndpointSnapshot, error) {
	inspectCtx := m.contextFor(request.ServerID, request.ContextID)
	if inspectCtx == nil {
		return domain.NetworkEndpointSnapshot{}, errors.New("网络详情上下文已关闭，请重新打开")
	}
	ctx, cancel := context.WithTimeout(inspectCtx.ctx, snapshotTimeout)
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return domain.NetworkEndpointSnapshot{}, errors.New(userMessageForError(err, "读取网络连接信息失败"))
	}
	defer transport.Close()
	started := time.Now()
	output, err := transport.Run(ctx, snapshotCommandForScope(request.Scope))
	if err != nil {
		m.log("warn", "网络详情读取失败", "network.inspect.snapshot", request.ServerID, "", 0, 0, time.Since(started), err)
		return domain.NetworkEndpointSnapshot{}, errors.New(userMessageForError(err, "读取网络连接信息失败"))
	}
	warnings := []string{}
	if len(output) > maxOutputBytes {
		output = output[:maxOutputBytes]
		warnings = append(warnings, "远程输出过大，已截断。")
	}
	snapshot, stats, err := ParseSnapshotWithStats(request.ServerID, request.ContextID, output, request.InterfaceName, timestamp())
	if err != nil {
		m.log("warn", "网络详情解析失败", "network.inspect.snapshot", request.ServerID, "", 0, 0, time.Since(started), err)
		return domain.NetworkEndpointSnapshot{}, errors.New("读取网络连接信息失败")
	}
	snapshot.Warnings = append(warnings, snapshot.Warnings...)
	m.logSnapshot("info", "网络详情读取完成", "network.inspect.snapshot", request.ServerID, stats, time.Since(started), nil)
	return snapshot, nil
}

func (m *Manager) Close(request domain.CloseNetworkInspectionContextRequest) {
	m.mu.Lock()
	current := m.contexts[request.ContextID]
	if current != nil && current.serverID == request.ServerID {
		delete(m.contexts, request.ContextID)
		current.cancel()
	}
	m.mu.Unlock()
}

func (m *Manager) StopServer(serverID int64) {
	m.mu.Lock()
	for id, current := range m.contexts {
		if current.serverID == serverID {
			delete(m.contexts, id)
			current.cancel()
		}
	}
	m.mu.Unlock()
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	for id, current := range m.contexts {
		delete(m.contexts, id)
		current.cancel()
	}
	m.mu.Unlock()
}

func (m *Manager) ContextCount(serverID int64) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, current := range m.contexts {
		if serverID == 0 || current.serverID == serverID {
			count++
		}
	}
	return count
}

func (m *Manager) contextFor(serverID int64, contextID string) *inspectionContext {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.contexts[contextID]
	if current == nil || current.serverID != serverID {
		return nil
	}
	return current
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
		m.logger.WriteConnection("error", "服务器已连接，但主机指纹记录更新失败", "networkinspect.hostkey", connection, nil)
	}
}

func (m *Manager) startKeepalive(ctx context.Context, transport Transport, serverID int64) {
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  serverID,
		Subsystem: "network-inspection",
	}, func(failure sshclient.KeepaliveFailure) {
		if m.logger != nil {
			m.logger.Write(
				"warn",
				fmt.Sprintf("SSH keepalive failed subsystem=network-inspection failures=%d", failure.FailureCount),
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

func (m *Manager) log(level, message, operation string, serverID int64, strategy string, listeners int, connections int, duration time.Duration, err error) {
	if m.logger == nil {
		return
	}
	summary := fmt.Sprintf("%s strategy=%s listenerCount=%d connectionCount=%d durationMs=%d", message, strategy, listeners, connections, duration.Milliseconds())
	m.logger.Write(level, summary, operation, serverID, sanitizeLogError(err))
}

func (m *Manager) logSnapshot(level, message, operation string, serverID int64, stats SnapshotParseStats, duration time.Duration, err error) {
	if m.logger == nil {
		return
	}
	summary := fmt.Sprintf(
		"%s strategy=%s ssPathKind=%s ssDialect=%s listenerCommandStatus=%s connectionCommandStatus=%s counterCommandStatus=%s processCommandStatus=%s listenerLineCount=%d connectionLineCount=%d parsedListenerCount=%d parsedConnectionCount=%d matchedConnectionCount=%d unmatchedConnectionCount=%d byteCounterSocketCount=%d uploadKnownCount=%d downloadKnownCount=%d counterMissingCount=%d rowLimit=%d remoteSocketCount=%d dockerSocketCount=%d dockerContainerCount=%d dockerScannedContainerCount=%d permissionLimited=%t durationMs=%d",
		message,
		stats.Strategy,
		stats.SSPathKind,
		stats.SSDialect,
		stats.ListenerCommandStatus,
		stats.ConnectionCommandStatus,
		stats.CounterCommandStatus,
		stats.ProcessCommandStatus,
		stats.ListenerLineCount,
		stats.ConnectionLineCount,
		stats.ParsedListenerCount,
		stats.ParsedConnectionCount,
		stats.MatchedConnectionCount,
		stats.UnmatchedConnectionCount,
		stats.ByteCounterSocketCount,
		stats.UploadBytesKnownCount,
		stats.DownloadBytesKnownCount,
		stats.CounterMissingCount,
		stats.RowLimit,
		stats.RemoteSocketCount,
		stats.DockerSocketCount,
		stats.DockerContainerCount,
		stats.DockerScannedContainerCount,
		stats.PermissionLimited,
		duration.Milliseconds(),
	)
	m.logger.Write(level, summary, operation, serverID, sanitizeLogError(err))
}

func userMessageForError(err error, fallback string) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(message, "context deadline exceeded"), strings.Contains(message, "i/o timeout"):
		return "网络详情读取超时"
	case strings.Contains(strings.ToLower(message), "permission"), strings.Contains(strings.ToLower(message), "denied"):
		return "部分进程信息因权限限制不可见"
	default:
		return fallback
	}
}

func sanitizeLogError(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(userMessageForError(err, "网络详情读取失败"))
}

func newID(prefix string) string {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(raw[:])
}

func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
