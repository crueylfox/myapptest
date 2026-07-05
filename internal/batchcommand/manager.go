package batchcommand

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/sshclient"
)

const (
	DefaultConcurrency    = 3
	MinimumConcurrency    = 1
	MaximumConcurrency    = 10
	DefaultTimeoutSeconds = 60
	MinimumTimeoutSeconds = 5
	MaximumTimeoutSeconds = 3600
	outputLimitBytes      = 1024 * 1024
	outputLimitLines      = 5000

	ErrInteractiveCommandMessage = "该命令需要交互式终端，请在 SSH 终端中执行。"
	outputTruncatedNotice        = "输出过多，已截断。"
)

type StreamingCommand = sshclient.StreamingCommand

type Transport interface {
	StartStreamingCommand(context.Context, string) (StreamingCommand, error)
	Fingerprint() string
	Close() error
}

type Dialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error)
type ConnectionProvider func(context.Context, int64) (domain.Connection, error)
type AuthProvider func(context.Context, domain.Connection) (domain.AuthRequest, error)
type HostKeySaver func(context.Context, int64, string) error
type CredentialCommitter func(context.Context, domain.Connection, domain.AuthRequest) error
type TimeoutProvider func() time.Duration
type KeepalivePolicyProvider func() sshclient.KeepalivePolicy

type Emitter interface {
	State(domain.BatchCommandStateEvent)
	Output(domain.BatchCommandOutputEvent)
	Completed(domain.BatchCommandCompletedEvent)
	Error(domain.BatchCommandErrorEvent)
}

type keepaliveStarter interface {
	StartKeepalive(context.Context, sshclient.KeepalivePolicy, sshclient.KeepaliveMetadata, sshclient.KeepaliveFailureHandler) *sshclient.KeepaliveHandle
}

type Manager struct {
	ctx         context.Context
	logger      *logging.Logger
	emitter     Emitter
	getConn     ConnectionProvider
	auth        AuthProvider
	saveHostKey HostKeySaver
	commitAuth  CredentialCommitter
	timeout     TimeoutProvider
	keepalive   KeepalivePolicyProvider
	dial        Dialer

	mu    sync.Mutex
	tasks map[string]*taskRuntime
}

type taskRuntime struct {
	task          domain.BatchCommandTask
	cancel        context.CancelFunc
	serverCancels map[int64]context.CancelFunc
	sessions      map[int64]StreamingCommand
	outputs       map[int64]*outputState
	done          chan struct{}
}

type outputState struct {
	bytes     int
	lines     int
	truncated bool
}

type streamChunk struct {
	stream string
	chunk  string
}

func New(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	getConn ConnectionProvider,
	auth AuthProvider,
	saveHostKey HostKeySaver,
	commitAuth CredentialCommitter,
	timeout TimeoutProvider,
) *Manager {
	return NewWithDialer(ctx, logger, emitter, getConn, auth, saveHostKey, commitAuth, timeout, func(
		ctx context.Context,
		connection domain.Connection,
		auth domain.AuthRequest,
		timeout time.Duration,
	) (Transport, time.Duration, error) {
		return sshclient.Dial(ctx, connection, auth, timeout)
	})
}

func NewWithDialer(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	getConn ConnectionProvider,
	auth AuthProvider,
	saveHostKey HostKeySaver,
	commitAuth CredentialCommitter,
	timeout TimeoutProvider,
	dial Dialer,
) *Manager {
	if timeout == nil {
		timeout = func() time.Duration { return 15 * time.Second }
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return &Manager{
		ctx:         ctx,
		logger:      logger,
		emitter:     emitter,
		getConn:     getConn,
		auth:        auth,
		saveHostKey: saveHostKey,
		commitAuth:  commitAuth,
		timeout:     timeout,
		dial:        dial,
		tasks:       make(map[string]*taskRuntime),
	}
}

func (m *Manager) SetKeepalivePolicyProvider(provider KeepalivePolicyProvider) {
	m.mu.Lock()
	m.keepalive = provider
	m.mu.Unlock()
}

func (m *Manager) Start(request domain.StartBatchCommandRequest) (domain.BatchCommandTask, error) {
	request = normalizeStartRequest(request)
	if request.Command == "" {
		return domain.BatchCommandTask{}, errors.New("批量命令不能为空")
	}
	if IsInteractiveCommand(request.Command) {
		return domain.BatchCommandTask{}, errors.New(ErrInteractiveCommandMessage)
	}
	if len(request.ServerIDs) == 0 {
		return domain.BatchCommandTask{}, errors.New("请选择至少一台服务器")
	}
	if m.getConn == nil || m.auth == nil || m.dial == nil {
		return domain.BatchCommandTask{}, errors.New("batch command manager is not initialized")
	}

	taskID := newID("batchcmd")
	now := timestamp()
	taskCtx, cancel := context.WithCancel(m.ctx)
	task := domain.BatchCommandTask{
		TaskID:         taskID,
		Command:        request.Command,
		ServerIDs:      append([]int64(nil), request.ServerIDs...),
		Status:         domain.BatchCommandQueued,
		CreatedAt:      now,
		Concurrency:    request.Concurrency,
		TimeoutSeconds: request.TimeoutSeconds,
		Results:        make([]domain.BatchCommandServerResult, 0, len(request.ServerIDs)),
	}
	for _, serverID := range request.ServerIDs {
		task.Results = append(task.Results, domain.BatchCommandServerResult{
			TaskID:   taskID,
			ServerID: serverID,
			Status:   domain.BatchCommandQueued,
			ExitCode: -1,
		})
	}
	current := &taskRuntime{
		task:          task,
		cancel:        cancel,
		serverCancels: make(map[int64]context.CancelFunc),
		sessions:      make(map[int64]StreamingCommand),
		outputs:       make(map[int64]*outputState),
		done:          make(chan struct{}),
	}
	m.mu.Lock()
	m.tasks[taskID] = current
	snapshot := cloneTask(current.task)
	m.mu.Unlock()
	m.log("info", fmt.Sprintf("batch command started taskID=%s servers=%d concurrency=%d timeoutSeconds=%d", taskID, len(request.ServerIDs), request.Concurrency, request.TimeoutSeconds), "batchcommand.start", 0, nil)
	go m.runTask(taskCtx, current)
	return snapshot, nil
}

func (m *Manager) CancelServer(request domain.CancelBatchCommandServerRequest) error {
	if request.TaskID == "" || request.ServerID <= 0 {
		return errors.New("batch command taskID and serverID are required")
	}
	current, result, ok := m.lookupResult(request.TaskID, request.ServerID)
	if !ok {
		return fmt.Errorf("batch command server task not found")
	}
	if !isActiveStatus(result.Status) {
		return nil
	}
	m.cancelServer(current, request.ServerID)
	return nil
}

func (m *Manager) CancelTask(request domain.CancelBatchCommandTaskRequest) error {
	if request.TaskID == "" {
		return errors.New("batch command taskID is required")
	}
	m.mu.Lock()
	current := m.tasks[request.TaskID]
	m.mu.Unlock()
	if current == nil {
		return fmt.Errorf("batch command task not found")
	}
	m.cancelTask(current)
	return nil
}

func (m *Manager) Get(taskID string) (domain.BatchCommandTask, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.tasks[strings.TrimSpace(taskID)]
	if current == nil {
		return domain.BatchCommandTask{}, fmt.Errorf("batch command task not found")
	}
	return cloneTask(current.task), nil
}

func (m *Manager) List() []domain.BatchCommandTask {
	m.mu.Lock()
	defer m.mu.Unlock()
	tasks := make([]domain.BatchCommandTask, 0, len(m.tasks))
	for _, current := range m.tasks {
		tasks = append(tasks, cloneTask(current.task))
	}
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].CreatedAt > tasks[j].CreatedAt
	})
	return tasks
}

func (m *Manager) Clear(taskID string) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return errors.New("batch command taskID is required")
	}
	m.mu.Lock()
	current := m.tasks[taskID]
	if current == nil {
		m.mu.Unlock()
		return nil
	}
	if isActiveStatus(current.task.Status) {
		m.mu.Unlock()
		return errors.New("批量命令仍在执行，不能清空")
	}
	delete(m.tasks, taskID)
	m.mu.Unlock()
	return nil
}

func (m *Manager) StopServer(serverID int64) {
	if serverID <= 0 {
		return
	}
	m.mu.Lock()
	targets := make([]*taskRuntime, 0)
	for _, current := range m.tasks {
		if result, ok := resultByServer(current.task, serverID); ok && isActiveStatus(result.Status) {
			targets = append(targets, current)
		}
	}
	m.mu.Unlock()
	for _, current := range targets {
		m.cancelServer(current, serverID)
	}
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	tasks := make([]*taskRuntime, 0, len(m.tasks))
	for _, current := range m.tasks {
		if isActiveStatus(current.task.Status) {
			tasks = append(tasks, current)
		}
	}
	m.mu.Unlock()
	for _, current := range tasks {
		m.cancelTask(current)
	}
	for _, current := range tasks {
		select {
		case <-current.done:
		case <-time.After(5 * time.Second):
		}
	}
}

func (m *Manager) runTask(ctx context.Context, current *taskRuntime) {
	sem := make(chan struct{}, current.task.Concurrency)
	var wg sync.WaitGroup
	for _, serverID := range current.task.ServerIDs {
		wg.Add(1)
		go func(serverID int64) {
			defer wg.Done()
			m.runServer(ctx, current, serverID, sem)
		}(serverID)
	}
	wg.Wait()
	m.finishTask(current)
}

func (m *Manager) runServer(taskCtx context.Context, current *taskRuntime, serverID int64, sem chan struct{}) {
	serverCtx, serverCancel := context.WithCancel(taskCtx)
	m.setServerCancel(current, serverID, serverCancel)
	defer func() {
		serverCancel()
		m.clearServerRuntime(current, serverID)
	}()

	select {
	case sem <- struct{}{}:
		defer func() { <-sem }()
	case <-serverCtx.Done():
		m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
		return
	}
	if !m.transitionServer(current, serverID, domain.BatchCommandConnecting, time.Now()) {
		return
	}

	timeout := time.Duration(current.task.TimeoutSeconds) * time.Second
	commandCtx, timeoutCancel := context.WithTimeout(serverCtx, timeout)
	defer timeoutCancel()

	connection, err := m.getConn(commandCtx, serverID)
	if err != nil {
		if serverCtx.Err() != nil {
			m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
			return
		}
		m.finishServer(current, serverID, domain.BatchCommandFailed, -1, "读取服务器配置失败", time.Time{})
		m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_CONNECTION_NOT_FOUND", "读取服务器配置失败")
		return
	}
	m.setServerIdentity(current, serverID, connection)

	auth, err := m.auth(commandCtx, connection)
	if err != nil {
		if serverCtx.Err() != nil {
			m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
			return
		}
		classified := connectionerror.Classify(err, connection, "batchcommand.credential")
		m.finishServer(current, serverID, domain.BatchCommandFailed, -1, classified.UserMessage, time.Time{})
		m.emitError(current.task.TaskID, serverID, classified.Code, classified.UserMessage)
		return
	}
	defer wipeAuth(&auth)

	client, _, err := m.dial(commandCtx, connection, auth, m.connectionTimeout())
	if err != nil {
		if serverCtx.Err() != nil {
			m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
			return
		}
		if commandCtx.Err() == context.DeadlineExceeded {
			m.finishServer(current, serverID, domain.BatchCommandTimeout, -1, "批量命令执行超时", time.Time{})
			m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_TIMEOUT", "批量命令执行超时")
			return
		}
		classified := connectionerror.Classify(err, connection, "batchcommand.connect")
		m.finishServer(current, serverID, domain.BatchCommandFailed, -1, classified.UserMessage, time.Time{})
		m.emitError(current.task.TaskID, serverID, classified.Code, classified.UserMessage)
		return
	}
	defer client.Close()
	m.startKeepalive(commandCtx, client, serverID)
	if m.saveHostKey != nil && sshclient.ShouldPersistObservedHostKey(connection, auth, client.Fingerprint()) {
		if err := m.saveHostKey(commandCtx, connection.ID, client.Fingerprint()); err == nil {
			connection.HostKeyFingerprint = client.Fingerprint()
		}
	}
	if m.commitAuth != nil {
		if err := m.commitAuth(commandCtx, connection, auth); err != nil {
			m.finishServer(current, serverID, domain.BatchCommandFailed, -1, "无法保存 SSH 凭据", time.Time{})
			m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_CREDENTIAL_SAVE_FAILED", "无法保存 SSH 凭据")
			return
		}
	}
	if !m.transitionServer(current, serverID, domain.BatchCommandRunning, time.Time{}) {
		return
	}

	session, err := client.StartStreamingCommand(commandCtx, current.task.Command)
	if err != nil {
		if serverCtx.Err() != nil {
			m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
			return
		}
		if commandCtx.Err() == context.DeadlineExceeded {
			m.finishServer(current, serverID, domain.BatchCommandTimeout, -1, "批量命令执行超时", time.Time{})
			m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_TIMEOUT", "批量命令执行超时")
			return
		}
		m.finishServer(current, serverID, domain.BatchCommandFailed, -1, "批量命令启动失败", time.Time{})
		m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_START_FAILED", "批量命令启动失败")
		return
	}
	m.setSession(current, serverID, session)
	m.collectCommand(commandCtx, serverCtx, current, serverID, session)
}

func (m *Manager) collectCommand(
	commandCtx context.Context,
	serverCtx context.Context,
	current *taskRuntime,
	serverID int64,
	session StreamingCommand,
) {
	outputs := make(chan streamChunk, 64)
	var readers sync.WaitGroup
	readStream(commandCtx, &readers, session.Stdout(), "stdout", outputs)
	readStream(commandCtx, &readers, session.Stderr(), "stderr", outputs)
	go func() {
		readers.Wait()
		close(outputs)
	}()

	waitErr := make(chan error, 1)
	go func() {
		waitErr <- session.Wait()
	}()

	var err error
	outputOpen := true
	waiting := true
	for outputOpen || waiting {
		select {
		case <-commandCtx.Done():
			m.closeSession(current, serverID)
			_ = waitForDone(waitErr, 3*time.Second)
			if commandCtx.Err() == context.DeadlineExceeded && serverCtx.Err() == nil {
				m.finishServer(current, serverID, domain.BatchCommandTimeout, -1, "批量命令执行超时", time.Time{})
				m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_TIMEOUT", "批量命令执行超时")
				return
			}
			m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
			return
		case chunk, ok := <-outputs:
			if !ok {
				outputOpen = false
				continue
			}
			m.appendOutput(current, serverID, chunk.stream, chunk.chunk)
		case err = <-waitErr:
			waiting = false
			waitErr = nil
		}
	}
	if serverCtx.Err() != nil {
		m.finishServer(current, serverID, domain.BatchCommandCanceled, -1, "", time.Time{})
		return
	}
	if commandCtx.Err() == context.DeadlineExceeded {
		m.finishServer(current, serverID, domain.BatchCommandTimeout, -1, "批量命令执行超时", time.Time{})
		m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_TIMEOUT", "批量命令执行超时")
		return
	}
	if err != nil {
		exitCode := exitCodeFromError(err)
		m.finishServer(current, serverID, domain.BatchCommandFailed, exitCode, "批量命令执行失败", time.Time{})
		m.emitError(current.task.TaskID, serverID, "BATCH_COMMAND_FAILED", "批量命令执行失败")
		return
	}
	m.finishServer(current, serverID, domain.BatchCommandCompleted, 0, "", time.Time{})
}

func (m *Manager) transitionServer(
	current *taskRuntime,
	serverID int64,
	status domain.BatchCommandStatus,
	startedAt time.Time,
) bool {
	var event domain.BatchCommandStateEvent
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		return false
	}
	index := resultIndex(current.task, serverID)
	if index < 0 || !isActiveStatus(current.task.Results[index].Status) {
		m.mu.Unlock()
		return false
	}
	now := timestamp()
	if current.task.Status == domain.BatchCommandQueued {
		current.task.Status = domain.BatchCommandRunning
		current.task.StartedAt = now
	}
	current.task.Results[index].Status = status
	if !startedAt.IsZero() {
		current.task.Results[index].StartedAt = startedAt.UTC().Format(time.RFC3339Nano)
	}
	event = domain.BatchCommandStateEvent{
		TaskID: current.task.TaskID, ServerID: serverID, Timestamp: now,
		Status: status, Result: current.task.Results[index],
	}
	m.mu.Unlock()
	m.emitState(event)
	return true
}

func (m *Manager) finishServer(
	current *taskRuntime,
	serverID int64,
	status domain.BatchCommandStatus,
	exitCode int,
	message string,
	finishedAt time.Time,
) {
	var event domain.BatchCommandStateEvent
	var duration time.Duration
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		return
	}
	index := resultIndex(current.task, serverID)
	if index < 0 {
		m.mu.Unlock()
		return
	}
	result := current.task.Results[index]
	if !isActiveStatus(result.Status) {
		m.mu.Unlock()
		return
	}
	if finishedAt.IsZero() {
		finishedAt = time.Now()
	}
	completedAt := finishedAt.UTC().Format(time.RFC3339Nano)
	if result.StartedAt != "" {
		if started, err := time.Parse(time.RFC3339Nano, result.StartedAt); err == nil {
			duration = finishedAt.Sub(started)
		}
	}
	result.Status = status
	result.ExitCode = exitCode
	result.CompletedAt = completedAt
	result.DurationMs = maxInt64(duration.Milliseconds(), 0)
	result.Error = message
	current.task.Results[index] = result
	event = domain.BatchCommandStateEvent{
		TaskID: current.task.TaskID, ServerID: serverID, Timestamp: completedAt,
		Status: status, Result: result,
	}
	m.mu.Unlock()
	m.emitState(event)
	m.log("info", fmt.Sprintf("batch command server completed taskID=%s serverID=%d status=%s exitCode=%d durationMs=%d", current.task.TaskID, serverID, status, exitCode, result.DurationMs), "batchcommand.server.complete", serverID, nil)
}

func (m *Manager) finishTask(current *taskRuntime) {
	var event domain.BatchCommandCompletedEvent
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		close(current.done)
		return
	}
	current.task.CompletedAt = timestamp()
	current.task.Status = aggregateStatus(current.task.Results)
	task := cloneTask(current.task)
	event = domain.BatchCommandCompletedEvent{
		TaskID:    current.task.TaskID,
		ServerID:  0,
		Timestamp: current.task.CompletedAt,
		Status:    current.task.Status,
		Task:      task,
	}
	m.mu.Unlock()
	m.emitCompleted(event)
	m.log("info", fmt.Sprintf("batch command completed taskID=%s status=%s", task.TaskID, task.Status), "batchcommand.complete", 0, nil)
	close(current.done)
}

func (m *Manager) setServerIdentity(current *taskRuntime, serverID int64, connection domain.Connection) {
	var event domain.BatchCommandStateEvent
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		return
	}
	index := resultIndex(current.task, serverID)
	if index < 0 {
		m.mu.Unlock()
		return
	}
	current.task.Results[index].ServerName = connection.Name
	current.task.Results[index].Host = fmt.Sprintf("%s:%d", connection.Host, connection.Port)
	event = domain.BatchCommandStateEvent{
		TaskID:    current.task.TaskID,
		ServerID:  serverID,
		Timestamp: timestamp(),
		Status:    current.task.Results[index].Status,
		Result:    current.task.Results[index],
	}
	m.mu.Unlock()
	m.emitState(event)
}

func (m *Manager) appendOutput(current *taskRuntime, serverID int64, stream string, chunk string) {
	if chunk == "" {
		return
	}
	var event *domain.BatchCommandOutputEvent
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		return
	}
	index := resultIndex(current.task, serverID)
	if index < 0 || current.task.Results[index].Status != domain.BatchCommandRunning {
		m.mu.Unlock()
		return
	}
	state := current.outputs[serverID]
	if state == nil {
		state = &outputState{}
		current.outputs[serverID] = state
	}
	if state.truncated {
		m.mu.Unlock()
		return
	}
	nextBytes := state.bytes + len([]byte(chunk))
	nextLines := state.lines + strings.Count(chunk, "\n")
	if chunk != "" && !strings.HasSuffix(chunk, "\n") {
		nextLines++
	}
	if nextBytes > outputLimitBytes || nextLines > outputLimitLines {
		state.truncated = true
		current.task.Results[index].OutputTruncated = true
		appendResultOutput(&current.task.Results[index], stream, outputTruncatedNotice+"\n")
		eventValue := domain.BatchCommandOutputEvent{
			TaskID: current.task.TaskID, ServerID: serverID,
			Timestamp: timestamp(), Stream: stream, Chunk: outputTruncatedNotice + "\n",
		}
		event = &eventValue
		m.mu.Unlock()
		m.emitOutput(*event)
		return
	}
	state.bytes = nextBytes
	state.lines = nextLines
	appendResultOutput(&current.task.Results[index], stream, chunk)
	eventValue := domain.BatchCommandOutputEvent{
		TaskID: current.task.TaskID, ServerID: serverID,
		Timestamp: timestamp(), Stream: stream, Chunk: chunk,
	}
	event = &eventValue
	m.mu.Unlock()
	m.emitOutput(*event)
}

func appendResultOutput(result *domain.BatchCommandServerResult, stream string, chunk string) {
	if stream == "stderr" {
		result.Stderr += chunk
		return
	}
	result.Stdout += chunk
}

func (m *Manager) setServerCancel(current *taskRuntime, serverID int64, cancel context.CancelFunc) {
	m.mu.Lock()
	if m.tasks[current.task.TaskID] == current {
		current.serverCancels[serverID] = cancel
	}
	m.mu.Unlock()
}

func (m *Manager) setSession(current *taskRuntime, serverID int64, session StreamingCommand) {
	m.mu.Lock()
	if m.tasks[current.task.TaskID] == current {
		current.sessions[serverID] = session
	}
	m.mu.Unlock()
}

func (m *Manager) closeSession(current *taskRuntime, serverID int64) {
	m.mu.Lock()
	session := current.sessions[serverID]
	delete(current.sessions, serverID)
	m.mu.Unlock()
	if session != nil {
		_ = session.Close()
	}
}

func (m *Manager) clearServerRuntime(current *taskRuntime, serverID int64) {
	m.mu.Lock()
	delete(current.serverCancels, serverID)
	session := current.sessions[serverID]
	delete(current.sessions, serverID)
	m.mu.Unlock()
	if session != nil {
		_ = session.Close()
	}
}

func (m *Manager) cancelServer(current *taskRuntime, serverID int64) {
	var event *domain.BatchCommandStateEvent
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		return
	}
	index := resultIndex(current.task, serverID)
	if index >= 0 && isActiveStatus(current.task.Results[index].Status) {
		now := timestamp()
		current.task.Results[index].Status = domain.BatchCommandCanceled
		current.task.Results[index].CompletedAt = now
		eventValue := domain.BatchCommandStateEvent{
			TaskID: current.task.TaskID, ServerID: serverID, Timestamp: now,
			Status: domain.BatchCommandCanceled, Result: current.task.Results[index],
		}
		event = &eventValue
	}
	cancel := current.serverCancels[serverID]
	session := current.sessions[serverID]
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if session != nil {
		_ = session.Close()
	}
	if event != nil {
		m.emitState(*event)
	}
}

func (m *Manager) cancelTask(current *taskRuntime) {
	m.mu.Lock()
	if m.tasks[current.task.TaskID] != current {
		m.mu.Unlock()
		return
	}
	current.cancel()
	cancels := make([]context.CancelFunc, 0, len(current.serverCancels))
	for _, cancel := range current.serverCancels {
		cancels = append(cancels, cancel)
	}
	sessions := make([]StreamingCommand, 0, len(current.sessions))
	for _, session := range current.sessions {
		sessions = append(sessions, session)
	}
	serverIDs := append([]int64(nil), current.task.ServerIDs...)
	m.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	for _, session := range sessions {
		_ = session.Close()
	}
	for _, serverID := range serverIDs {
		m.cancelServer(current, serverID)
	}
}

func (m *Manager) lookupResult(taskID string, serverID int64) (*taskRuntime, domain.BatchCommandServerResult, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.tasks[taskID]
	if current == nil {
		return nil, domain.BatchCommandServerResult{}, false
	}
	result, ok := resultByServer(current.task, serverID)
	return current, result, ok
}

func (m *Manager) startKeepalive(ctx context.Context, transport Transport, serverID int64) {
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	m.mu.Lock()
	provider := m.keepalive
	m.mu.Unlock()
	var policy sshclient.KeepalivePolicy
	if provider != nil {
		policy = provider()
	}
	starter.StartKeepalive(ctx, policy, sshclient.KeepaliveMetadata{
		ServerID: serverID, Subsystem: "batchcommand",
	}, func(failure sshclient.KeepaliveFailure) {
		m.log("warn", fmt.Sprintf("SSH keepalive failed subsystem=batchcommand failures=%d", failure.FailureCount), "ssh.keepalive", serverID, sshclient.ErrKeepaliveFailed)
	})
}

func (m *Manager) connectionTimeout() time.Duration {
	if m.timeout == nil {
		return 15 * time.Second
	}
	return m.timeout()
}

func (m *Manager) emitState(event domain.BatchCommandStateEvent) {
	if m.emitter != nil {
		m.emitter.State(event)
	}
}

func (m *Manager) emitOutput(event domain.BatchCommandOutputEvent) {
	if m.emitter != nil {
		m.emitter.Output(event)
	}
}

func (m *Manager) emitCompleted(event domain.BatchCommandCompletedEvent) {
	if m.emitter != nil {
		m.emitter.Completed(event)
	}
}

func (m *Manager) emitError(taskID string, serverID int64, code string, message string) {
	if m.emitter != nil {
		m.emitter.Error(domain.BatchCommandErrorEvent{
			TaskID: taskID, ServerID: serverID, Timestamp: timestamp(), Code: code, Message: message,
		})
	}
}

func (m *Manager) log(level string, message string, operation string, serverID int64, err error) {
	if m.logger == nil {
		return
	}
	m.logger.Write(level, message, operation, serverID, sanitizedError(err))
}

func normalizeStartRequest(request domain.StartBatchCommandRequest) domain.StartBatchCommandRequest {
	request.Command = strings.TrimSpace(request.Command)
	request.ServerIDs = uniquePositiveServerIDs(request.ServerIDs)
	if request.Concurrency <= 0 {
		request.Concurrency = DefaultConcurrency
	}
	if request.Concurrency < MinimumConcurrency {
		request.Concurrency = MinimumConcurrency
	}
	if request.Concurrency > MaximumConcurrency {
		request.Concurrency = MaximumConcurrency
	}
	if request.TimeoutSeconds <= 0 {
		request.TimeoutSeconds = DefaultTimeoutSeconds
	}
	if request.TimeoutSeconds < MinimumTimeoutSeconds {
		request.TimeoutSeconds = MinimumTimeoutSeconds
	}
	if request.TimeoutSeconds > MaximumTimeoutSeconds {
		request.TimeoutSeconds = MaximumTimeoutSeconds
	}
	return request
}

func uniquePositiveServerIDs(input []int64) []int64 {
	seen := make(map[int64]bool, len(input))
	out := make([]int64, 0, len(input))
	for _, id := range input {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

var interactiveCommandPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(^|[;&|]\s*)(vi|vim|nano|emacs)\b`),
	regexp.MustCompile(`(?i)(^|[;&|]\s*)(top|htop|less|more|watch)\b`),
	regexp.MustCompile(`(?i)(^|[;&|]\s*)tail\s+-f\b`),
	regexp.MustCompile(`(?i)(^|[;&|]\s*)passwd\b`),
	regexp.MustCompile(`(?i)(^|[;&|]\s*)crontab\s+-e\b`),
	regexp.MustCompile(`(?i)^\s*(bash|sh|zsh|fish|csh|tcsh)\s*$`),
}

func IsInteractiveCommand(command string) bool {
	normalized := strings.TrimSpace(command)
	if normalized == "" {
		return false
	}
	for _, pattern := range interactiveCommandPatterns {
		if pattern.MatchString(normalized) {
			return true
		}
	}
	lower := strings.ToLower(normalized)
	return regexp.MustCompile(`(^|[;&|]\s*)sudo\b`).MatchString(lower) &&
		!strings.Contains(lower, "sudo -n") &&
		!strings.Contains(lower, "sudo --non-interactive")
}

func readStream(ctx context.Context, readers *sync.WaitGroup, reader io.Reader, stream string, output chan<- streamChunk) {
	readers.Add(1)
	go func() {
		defer readers.Done()
		buffer := make([]byte, 16*1024)
		for {
			n, err := reader.Read(buffer)
			if n > 0 {
				chunk := string(buffer[:n])
				select {
				case output <- streamChunk{stream: stream, chunk: chunk}:
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

func waitForDone(done <-chan error, timeout time.Duration) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		return context.DeadlineExceeded
	}
}

func exitCodeFromError(err error) int {
	var exitError *ssh.ExitError
	if errors.As(err, &exitError) {
		return exitError.ExitStatus()
	}
	return -1
}

func aggregateStatus(results []domain.BatchCommandServerResult) domain.BatchCommandStatus {
	if len(results) == 0 {
		return domain.BatchCommandCompleted
	}
	counts := map[domain.BatchCommandStatus]int{}
	for _, result := range results {
		counts[result.Status]++
		if isActiveStatus(result.Status) {
			return domain.BatchCommandRunning
		}
	}
	if counts[domain.BatchCommandCompleted] == len(results) {
		return domain.BatchCommandCompleted
	}
	if counts[domain.BatchCommandCanceled] == len(results) {
		return domain.BatchCommandCanceled
	}
	if counts[domain.BatchCommandTimeout] > 0 {
		return domain.BatchCommandTimeout
	}
	if counts[domain.BatchCommandFailed] > 0 {
		return domain.BatchCommandFailed
	}
	return domain.BatchCommandCanceled
}

func isActiveStatus(status domain.BatchCommandStatus) bool {
	return status == domain.BatchCommandQueued ||
		status == domain.BatchCommandConnecting ||
		status == domain.BatchCommandRunning
}

func resultByServer(task domain.BatchCommandTask, serverID int64) (domain.BatchCommandServerResult, bool) {
	index := resultIndex(task, serverID)
	if index < 0 {
		return domain.BatchCommandServerResult{}, false
	}
	return task.Results[index], true
}

func resultIndex(task domain.BatchCommandTask, serverID int64) int {
	for index, result := range task.Results {
		if result.ServerID == serverID {
			return index
		}
	}
	return -1
}

func cloneTask(task domain.BatchCommandTask) domain.BatchCommandTask {
	task.ServerIDs = append([]int64(nil), task.ServerIDs...)
	task.Results = append([]domain.BatchCommandServerResult(nil), task.Results...)
	return task
}

func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func newID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(raw[:])
}

func wipeAuth(auth *domain.AuthRequest) {
	if auth == nil {
		return
	}
	auth.Password = ""
	auth.Passphrase = ""
}

func sanitizedError(err error) error {
	if err == nil {
		return nil
	}
	return errors.New("batch command operation failed")
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
