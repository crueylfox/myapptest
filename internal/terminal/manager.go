package terminal

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/sshclient"
)

const (
	maxInputBytes  = 64 * 1024
	maxBatchBytes  = 32 * 1024
	resizeDebounce = 35 * time.Millisecond
)

var ErrConnectionActive = errors.New("terminal connection is already active")

type Status string

const (
	StatusConnecting Status = "connecting"
	StatusOnline     Status = "online"
	StatusOffline    Status = "offline"
	StatusError      Status = "error"
)

type SessionInfo struct {
	SessionID       string                  `json:"sessionId"`
	ConnectionID    int64                   `json:"connectionId"`
	Title           string                  `json:"title"`
	Status          Status                  `json:"status"`
	Code            string                  `json:"code"`
	Message         string                  `json:"message"`
	ConnectionError *domain.ConnectionError `json:"connectionError,omitempty"`
}

type OutputEvent struct {
	SessionID  string `json:"sessionId"`
	DataBase64 string `json:"dataBase64"`
}

type StatusEvent struct {
	SessionID       string                  `json:"sessionId"`
	ConnectionID    int64                   `json:"connectionId"`
	Status          Status                  `json:"status"`
	Code            string                  `json:"code"`
	Message         string                  `json:"message"`
	Active          bool                    `json:"active"`
	ConnectionError *domain.ConnectionError `json:"connectionError,omitempty"`
}

type Emitter interface {
	Output(OutputEvent)
	Status(StatusEvent)
}

type Shell interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Resize(columns, rows int) error
	Wait() error
	Close() error
}

type Transport interface {
	OpenTerminal(columns, rows int) (Shell, error)
	Fingerprint() string
	Close() error
}

type Dialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error)
type HostKeySaver func(context.Context, int64, string) error
type CredentialCommitter func(context.Context, domain.Connection, domain.AuthRequest) error
type TimeoutProvider func() time.Duration
type KeepalivePolicyProvider func() sshclient.KeepalivePolicy

type keepaliveStarter interface {
	StartKeepalive(context.Context, sshclient.KeepalivePolicy, sshclient.KeepaliveMetadata, sshclient.KeepaliveFailureHandler) *sshclient.KeepaliveHandle
}

type Manager struct {
	ctx         context.Context
	logger      *logging.Logger
	emitter     Emitter
	dial        Dialer
	saveHostKey HostKeySaver
	commitAuth  CredentialCommitter
	timeout     TimeoutProvider
	keepalive   KeepalivePolicyProvider
	mu          sync.RWMutex
	workers     map[string]*worker
}

type worker struct {
	info            SessionInfo
	cancel          context.CancelFunc
	done            chan struct{}
	input           chan []byte
	resize          chan struct{}
	mu              sync.RWMutex
	shell           Shell
	desiredSize     terminalSize
	appliedSize     terminalSize
	closing         bool
	keepaliveFailed bool
}

type terminalSize struct {
	columns int
	rows    int
}

type realTransport struct {
	client *sshclient.Client
}

func (t realTransport) OpenTerminal(columns, rows int) (Shell, error) {
	return t.client.OpenTerminal(columns, rows)
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

func New(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	saveHostKey HostKeySaver,
	commitAuth CredentialCommitter,
	timeout TimeoutProvider,
) *Manager {
	manager := NewWithDialer(ctx, logger, emitter, timeout, func(
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
	manager.saveHostKey = saveHostKey
	manager.commitAuth = commitAuth
	return manager
}

func NewWithDialer(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	timeout TimeoutProvider,
	dialer Dialer,
) *Manager {
	if timeout == nil {
		timeout = func() time.Duration { return 15 * time.Second }
	}
	return &Manager{
		ctx: ctx, logger: logger, emitter: emitter, dial: dialer,
		timeout: timeout, workers: make(map[string]*worker),
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

func (m *Manager) Open(connection domain.Connection, auth domain.AuthRequest, columns, rows int) (SessionInfo, error) {
	return m.openWithID(newSessionID(), connection, auth, columns, rows)
}

func (m *Manager) openWithID(
	sessionID string,
	connection domain.Connection,
	auth domain.AuthRequest,
	columns, rows int,
) (SessionInfo, error) {
	if columns < 1 || rows < 1 {
		return SessionInfo{}, errors.New("terminal dimensions must be positive")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	current := &worker{
		info: SessionInfo{
			SessionID: sessionID, ConnectionID: connection.ID,
			Title: connection.Name, Status: StatusConnecting,
		},
		cancel: cancel, done: make(chan struct{}), input: make(chan []byte, 128),
		resize:      make(chan struct{}, 1),
		desiredSize: terminalSize{columns: columns, rows: rows},
		appliedSize: terminalSize{columns: columns, rows: rows},
	}
	m.mu.Lock()
	if _, exists := m.workers[sessionID]; exists {
		m.mu.Unlock()
		cancel()
		return SessionInfo{}, errors.New("terminal session already exists")
	}
	for _, existing := range m.workers {
		if existing.info.ConnectionID == connection.ID && existing.info.Status == StatusConnecting {
			m.mu.Unlock()
			cancel()
			return SessionInfo{}, ErrConnectionActive
		}
	}
	m.workers[sessionID] = current
	m.mu.Unlock()
	info := current.info
	m.emitStatus(info, "")
	go m.run(ctx, current, connection, auth, columns, rows)
	return info, nil
}

func (m *Manager) run(
	ctx context.Context,
	current *worker,
	connection domain.Connection,
	auth domain.AuthRequest,
	columns, rows int,
) {
	defer func() {
		auth.Password = ""
		auth.Passphrase = ""
		current.mu.Lock()
		current.closing = true
		current.mu.Unlock()
		m.mu.Lock()
		if m.workers[current.info.SessionID] == current {
			delete(m.workers, current.info.SessionID)
		}
		m.mu.Unlock()
		close(current.done)
	}()

	timeout := m.timeout()
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	transport, _, err := m.dial(dialCtx, connection, auth, timeout)
	cancel()
	if err != nil {
		if ctx.Err() != nil {
			auth.Password = ""
			auth.Passphrase = ""
			m.emitStatus(current.info, "终端已关闭")
			return
		}
		classified := connectionerror.Classify(err, connection, "terminal.connect")
		classified.CredentialFromStore = auth.ResolvedFromStore
		auth.Password = ""
		auth.Passphrase = ""
		m.fail(current, connection, classified)
		return
	}
	defer transport.Close()
	m.startKeepalive(ctx, current, transport, connection)
	if m.commitAuth != nil {
		if err := m.commitAuth(ctx, connection, auth); err != nil {
			auth.Password = ""
			auth.Passphrase = ""
			classified := connectionerror.Classify(err, connection, "terminal.credential")
			classified.Code = "CREDENTIAL_SAVE_FAILED"
			classified.UserMessage = "无法将 SSH 凭据保存到系统凭据库"
			classified.Retryable = false
			m.fail(current, connection, classified)
			return
		}
	}
	auth.Password = ""
	auth.Passphrase = ""
	if sshclient.ShouldPersistObservedHostKey(connection, auth, transport.Fingerprint()) && m.saveHostKey != nil {
		if err := m.saveHostKey(ctx, connection.ID, transport.Fingerprint()); err != nil {
			classified := connectionerror.Classify(err, connection, "terminal.hostkey")
			classified.UserMessage = "服务器已连接，但主机指纹记录更新失败"
			m.logger.WriteConnection("error", classified.UserMessage, "terminal.hostkey", connection, &classified)
		}
	}
	shell, err := transport.OpenTerminal(columns, rows)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "terminal.shell")
		classified.Code = "TERMINAL_START_FAILED"
		classified.UserMessage = "无法启动远程终端"
		classified.Retryable = true
		m.fail(current, connection, classified)
		return
	}
	current.mu.Lock()
	current.shell = shell
	needsResize := current.desiredSize != current.appliedSize
	current.mu.Unlock()
	if needsResize {
		signalResize(current)
	}
	defer shell.Close()

	m.mu.Lock()
	current.info.Status = StatusOnline
	info := current.info
	m.mu.Unlock()
	m.emitStatus(info, "")

	chunks := make(chan []byte, 64)
	readDone := make(chan error, 1)
	writeDone := make(chan error, 1)
	resizeFailed := make(chan error, 1)
	ioCtx, stopIO := context.WithCancel(ctx)
	var ioWorkers sync.WaitGroup
	ioWorkers.Add(4)
	go func() {
		defer ioWorkers.Done()
		readShell(ioCtx, shell, chunks, readDone)
	}()
	go func() {
		defer ioWorkers.Done()
		writeShell(ioCtx, shell, current.input, writeDone)
	}()
	go func() {
		defer ioWorkers.Done()
		resizeShell(ioCtx, current, shell, resizeFailed)
	}()
	emitDone := make(chan struct{})
	go func() {
		m.emitBatches(ioCtx, current.info.SessionID, chunks)
		close(emitDone)
	}()

	waitDone := make(chan error, 1)
	go func() {
		defer ioWorkers.Done()
		waitDone <- shell.Wait()
	}()

	var terminalErr error
	select {
	case <-ctx.Done():
		terminalErr = ctx.Err()
	case terminalErr = <-readDone:
	case terminalErr = <-writeDone:
	case terminalErr = <-waitDone:
	case terminalErr = <-resizeFailed:
	}
	stopIO()
	_ = shell.Close()
	ioWorkers.Wait()
	<-emitDone
	if ctx.Err() != nil {
		m.emitStatus(current.info, "终端已关闭")
		return
	}
	if terminalErr != nil && !errors.Is(terminalErr, io.EOF) {
		classified := connectionerror.Classify(terminalErr, connection, "terminal.session")
		classified.Code = connectionerror.CodeConnectionClosed
		classified.UserMessage = "终端连接已中断"
		classified.Retryable = true
		current.mu.RLock()
		keepaliveFailed := current.keepaliveFailed
		current.mu.RUnlock()
		if keepaliveFailed {
			classified.Code = connectionerror.CodeKeepaliveFailed
			classified.UserMessage = "SSH 连接保活失败，终端连接已断开。"
			classified.TechnicalMessage = sshclient.ErrKeepaliveFailed.Error()
		}
		m.fail(current, connection, classified)
		return
	}
	m.emitStatus(current.info, "远程 Shell 已退出")
}

func (m *Manager) startKeepalive(
	ctx context.Context,
	current *worker,
	transport Transport,
	connection domain.Connection,
) {
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	policy := m.keepalivePolicy()
	starter.StartKeepalive(ctx, policy, sshclient.KeepaliveMetadata{
		ServerID:  connection.ID,
		Subsystem: "terminal",
		SessionID: current.info.SessionID,
	}, func(failure sshclient.KeepaliveFailure) {
		current.mu.Lock()
		current.keepaliveFailed = true
		current.mu.Unlock()
		if m.logger != nil {
			m.logger.Write(
				"warn",
				fmt.Sprintf("SSH keepalive failed subsystem=terminal failures=%d", failure.FailureCount),
				"ssh.keepalive",
				connection.ID,
				sshclient.ErrKeepaliveFailed,
			)
		}
	})
}

func readShell(ctx context.Context, shell Shell, chunks chan<- []byte, done chan<- error) {
	defer close(chunks)
	buffer := make([]byte, 16*1024)
	for {
		count, err := shell.Read(buffer)
		if count > 0 {
			chunk := append([]byte(nil), buffer[:count]...)
			select {
			case chunks <- chunk:
			case <-ctx.Done():
				done <- ctx.Err()
				return
			}
		}
		if err != nil {
			done <- err
			return
		}
	}
}

func writeShell(ctx context.Context, shell Shell, input <-chan []byte, done chan<- error) {
	for {
		select {
		case <-ctx.Done():
			done <- ctx.Err()
			return
		case data := <-input:
			if _, err := shell.Write(data); err != nil {
				done <- err
				return
			}
		}
	}
}

func signalResize(current *worker) {
	select {
	case current.resize <- struct{}{}:
	default:
	}
}

func resizeShell(ctx context.Context, current *worker, shell Shell, failed chan<- error) {
	var timer *time.Timer
	var timerC <-chan time.Time
	stopTimer := func() {
		if timer == nil {
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}
	defer stopTimer()

	for {
		select {
		case <-ctx.Done():
			return
		case <-current.resize:
			if timer == nil {
				timer = time.NewTimer(resizeDebounce)
			} else {
				stopTimer()
				timer.Reset(resizeDebounce)
			}
			timerC = timer.C
		case <-timerC:
			timerC = nil
			current.mu.RLock()
			size := current.desiredSize
			applied := current.appliedSize
			closing := current.closing
			current.mu.RUnlock()
			if closing {
				return
			}
			if size == applied {
				continue
			}
			if err := shell.Resize(size.columns, size.rows); err != nil {
				select {
				case failed <- err:
				case <-ctx.Done():
				}
				return
			}
			current.mu.Lock()
			current.appliedSize = size
			current.mu.Unlock()
		}
	}
}

func (m *Manager) emitBatches(ctx context.Context, sessionID string, chunks <-chan []byte) {
	ticker := time.NewTicker(16 * time.Millisecond)
	defer ticker.Stop()
	batch := make([]byte, 0, maxBatchBytes)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		m.emitter.Output(OutputEvent{
			SessionID: sessionID, DataBase64: base64.StdEncoding.EncodeToString(batch),
		})
		batch = batch[:0]
	}
	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case chunk, ok := <-chunks:
			if !ok {
				flush()
				return
			}
			if len(batch)+len(chunk) > maxBatchBytes {
				flush()
			}
			batch = append(batch, chunk...)
			if len(batch) >= maxBatchBytes {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (m *Manager) Write(sessionID, dataBase64 string) error {
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return errors.New("invalid terminal input")
	}
	if len(data) == 0 || len(data) > maxInputBytes {
		return errors.New("terminal input size is invalid")
	}
	current, err := m.worker(sessionID)
	if err != nil {
		return err
	}
	select {
	case current.input <- data:
		return nil
	default:
		return errors.New("terminal input queue is full")
	}
}

func (m *Manager) Resize(sessionID string, columns, rows int) error {
	if columns < 1 || rows < 1 {
		return errors.New("terminal dimensions must be positive")
	}
	current, err := m.worker(sessionID)
	if err != nil {
		return err
	}
	size := terminalSize{columns: columns, rows: rows}
	current.mu.Lock()
	if current.closing {
		current.mu.Unlock()
		return errors.New("terminal session is closing")
	}
	if current.desiredSize == size {
		current.mu.Unlock()
		return nil
	}
	current.desiredSize = size
	current.mu.Unlock()
	signalResize(current)
	return nil
}

func (m *Manager) Close(sessionID string) {
	current, err := m.worker(sessionID)
	if err != nil {
		return
	}
	current.mu.Lock()
	current.closing = true
	current.mu.Unlock()
	current.cancel()
	current.mu.RLock()
	shell := current.shell
	current.mu.RUnlock()
	if shell != nil {
		_ = shell.Close()
	}
	<-current.done
}

func (m *Manager) Reconnect(
	sessionID string,
	connection domain.Connection,
	auth domain.AuthRequest,
	columns, rows int,
) (SessionInfo, error) {
	m.Close(sessionID)
	return m.openWithID(sessionID, connection, auth, columns, rows)
}

func (m *Manager) StopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.workers))
	for id := range m.workers {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		m.Close(id)
	}
}

func (m *Manager) StopConnection(connectionID int64) {
	m.mu.RLock()
	ids := make([]string, 0)
	for id, current := range m.workers {
		if current.info.ConnectionID == connectionID {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()
	for _, id := range ids {
		m.Close(id)
	}
}

func (m *Manager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.workers)
}

func (m *Manager) ActiveCountFor(connectionID int64) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, current := range m.workers {
		if current.info.ConnectionID == connectionID {
			count++
		}
	}
	return count
}

func (m *Manager) HasConnecting(connectionID int64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, current := range m.workers {
		if current.info.ConnectionID == connectionID && current.info.Status == StatusConnecting {
			return true
		}
	}
	return false
}

func (m *Manager) worker(sessionID string) (*worker, error) {
	m.mu.RLock()
	current := m.workers[sessionID]
	m.mu.RUnlock()
	if current == nil {
		return nil, errors.New("terminal session not found")
	}
	return current, nil
}

func (m *Manager) fail(
	current *worker,
	connection domain.Connection,
	connectionErr domain.ConnectionError,
) {
	m.mu.Lock()
	current.info.Status = StatusError
	current.info.Code = connectionErr.Code
	current.info.Message = connectionErr.UserMessage
	current.info.ConnectionError = &connectionErr
	info := current.info
	m.mu.Unlock()
	m.emitStatusWithError(info, &connectionErr)
	m.logger.WriteConnection(
		"error",
		connectionErr.UserMessage,
		connectionErr.Operation,
		connection,
		&connectionErr,
	)
}

func (m *Manager) emitStatus(info SessionInfo, message string) {
	info.Message = message
	m.emitStatusWithError(info, nil)
}

func (m *Manager) emitStatusWithError(info SessionInfo, connectionErr *domain.ConnectionError) {
	status := info.Status
	if info.Message == "终端已关闭" || info.Message == "远程 Shell 已退出" {
		status = StatusOffline
	}
	active := status == StatusConnecting || status == StatusOnline
	m.emitter.Status(StatusEvent{
		SessionID: info.SessionID, ConnectionID: info.ConnectionID,
		Status: status, Code: info.Code, Message: info.Message,
		Active: active, ConnectionError: connectionErr,
	})
}

func newSessionID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("terminal-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(value)
}
