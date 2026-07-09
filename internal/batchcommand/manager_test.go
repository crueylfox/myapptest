package batchcommand

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
)

type fakeEmitter struct {
	mu        sync.Mutex
	states    []domain.BatchCommandStateEvent
	outputs   []domain.BatchCommandOutputEvent
	completed []domain.BatchCommandCompletedEvent
	errors    []domain.BatchCommandErrorEvent
}

func (e *fakeEmitter) State(event domain.BatchCommandStateEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.states = append(e.states, event)
}

func (e *fakeEmitter) Output(event domain.BatchCommandOutputEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.outputs = append(e.outputs, event)
}

func (e *fakeEmitter) Completed(event domain.BatchCommandCompletedEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.completed = append(e.completed, event)
}

func (e *fakeEmitter) Error(event domain.BatchCommandErrorEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.errors = append(e.errors, event)
}

func (e *fakeEmitter) outputStreams() map[string]string {
	e.mu.Lock()
	defer e.mu.Unlock()
	streams := map[string]string{}
	for _, event := range e.outputs {
		streams[event.Stream] += event.Chunk
	}
	return streams
}

type fakeBehavior struct {
	stdout string
	stderr string
	err    error
	block  bool
	delay  time.Duration
}

type fakeDialer struct {
	mu        sync.Mutex
	behaviors map[int64]fakeBehavior
	active    int
	maxActive int
}

func (d *fakeDialer) dial(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (Transport, time.Duration, error) {
	d.mu.Lock()
	d.active++
	if d.active > d.maxActive {
		d.maxActive = d.active
	}
	behavior := d.behaviors[connection.ID]
	d.mu.Unlock()
	return &fakeTransport{ctx: ctx, dialer: d, behavior: behavior}, time.Millisecond, nil
}

func (d *fakeDialer) closed() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.active--
}

func (d *fakeDialer) max() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.maxActive
}

type fakeTransport struct {
	ctx      context.Context
	dialer   *fakeDialer
	behavior fakeBehavior
	once     sync.Once
}

func (t *fakeTransport) StartStreamingCommand(ctx context.Context, command string) (StreamingCommand, error) {
	return &fakeCommand{ctx: ctx, behavior: t.behavior}, nil
}

func (t *fakeTransport) Fingerprint() string {
	return "SHA256:test"
}

func (t *fakeTransport) Close() error {
	t.once.Do(t.dialer.closed)
	return nil
}

type fakeCommand struct {
	ctx      context.Context
	behavior fakeBehavior
}

func (c *fakeCommand) Stdout() io.Reader {
	return strings.NewReader(c.behavior.stdout)
}

func (c *fakeCommand) Stderr() io.Reader {
	return strings.NewReader(c.behavior.stderr)
}

func (c *fakeCommand) Wait() error {
	if c.behavior.block {
		<-c.ctx.Done()
		return c.ctx.Err()
	}
	if c.behavior.delay > 0 {
		timer := time.NewTimer(c.behavior.delay)
		defer timer.Stop()
		select {
		case <-c.ctx.Done():
			return c.ctx.Err()
		case <-timer.C:
		}
	}
	return c.behavior.err
}

func (c *fakeCommand) Close() error {
	return nil
}

func newTestManager(t *testing.T, behaviors map[int64]fakeBehavior) (*Manager, *fakeEmitter, *fakeDialer, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	emitter := &fakeEmitter{}
	dialer := &fakeDialer{behaviors: behaviors}
	manager := NewWithDialer(
		ctx,
		nil,
		emitter,
		func(ctx context.Context, serverID int64) (domain.Connection, error) {
			return domain.Connection{
				ID: serverID, Name: "server", Host: "192.0.2.1", Port: 22,
				Username: "root", AuthType: domain.AuthPassword, HostKeyFingerprint: "SHA256:test",
			}, nil
		},
		func(ctx context.Context, connection domain.Connection) (domain.AuthRequest, error) {
			return domain.AuthRequest{Password: "resolved"}, nil
		},
		nil,
		nil,
		func() time.Duration { return time.Second },
		dialer.dial,
	)
	return manager, emitter, dialer, cancel
}

func waitForTask(t *testing.T, manager *Manager, taskID string) domain.BatchCommandTask {
	t.Helper()
	return waitForTaskWithin(t, manager, taskID, 3*time.Second)
}

func waitForTaskWithin(t *testing.T, manager *Manager, taskID string, timeout time.Duration) domain.BatchCommandTask {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		task, err := manager.Get(taskID)
		if err != nil {
			t.Fatal(err)
		}
		if !isActiveStatus(task.Status) {
			return task
		}
		time.Sleep(10 * time.Millisecond)
	}
	task, _ := manager.Get(taskID)
	t.Fatalf("task did not finish: %+v", task)
	return domain.BatchCommandTask{}
}

func waitForResultStatus(t *testing.T, manager *Manager, taskID string, serverID int64, status domain.BatchCommandStatus) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		task, err := manager.Get(taskID)
		if err != nil {
			t.Fatal(err)
		}
		for _, result := range task.Results {
			if result.ServerID == serverID && result.Status == status {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	task, _ := manager.Get(taskID)
	t.Fatalf("server %d did not reach %s: %+v", serverID, status, task.Results)
}

func resultFor(t *testing.T, task domain.BatchCommandTask, serverID int64) domain.BatchCommandServerResult {
	t.Helper()
	for _, result := range task.Results {
		if result.ServerID == serverID {
			return result
		}
	}
	t.Fatalf("result for server %d not found", serverID)
	return domain.BatchCommandServerResult{}
}

func TestStartSingleServerStreamsStdoutAndStderr(t *testing.T) {
	manager, emitter, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {stdout: "hello\n", stderr: "warn\n"},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "uname -a", ServerIDs: []int64{1}, TimeoutSeconds: 60, Concurrency: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	task = waitForTask(t, manager, task.TaskID)
	result := resultFor(t, task, 1)
	if task.Status != domain.BatchCommandCompleted || result.Status != domain.BatchCommandCompleted {
		t.Fatalf("unexpected status task=%s result=%s", task.Status, result.Status)
	}
	if result.Stdout != "hello\n" || result.Stderr != "warn\n" {
		t.Fatalf("unexpected output stdout=%q stderr=%q", result.Stdout, result.Stderr)
	}
	streams := emitter.outputStreams()
	if streams["stdout"] != "hello\n" || streams["stderr"] != "warn\n" {
		t.Fatalf("stream events not separated: %#v", streams)
	}
}

func TestSingleServerFailureDoesNotStopOtherServers(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {stdout: "ok\n"},
		2: {stderr: "bad\n", err: errors.New("remote command failed")},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "uptime", ServerIDs: []int64{1, 2}, TimeoutSeconds: 60, Concurrency: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	task = waitForTask(t, manager, task.TaskID)
	if task.Status != domain.BatchCommandFailed {
		t.Fatalf("task status = %s", task.Status)
	}
	if resultFor(t, task, 1).Status != domain.BatchCommandCompleted {
		t.Fatalf("server 1 should complete: %+v", task.Results)
	}
	if resultFor(t, task, 2).Status != domain.BatchCommandFailed {
		t.Fatalf("server 2 should fail: %+v", task.Results)
	}
}

func TestConcurrencyLimitIsEnforced(t *testing.T) {
	behaviors := map[int64]fakeBehavior{}
	for i := int64(1); i <= 5; i++ {
		behaviors[i] = fakeBehavior{stdout: "ok\n", delay: 50 * time.Millisecond}
	}
	manager, _, dialer, cancel := newTestManager(t, behaviors)
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "df -h", ServerIDs: []int64{1, 2, 3, 4, 5}, TimeoutSeconds: 60, Concurrency: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = waitForTask(t, manager, task.TaskID)
	if dialer.max() > 2 {
		t.Fatalf("max active transports = %d, want <= 2", dialer.max())
	}
}

func TestCancelSingleServerLeavesOtherServersRunning(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {block: true},
		2: {stdout: "ok\n", delay: 30 * time.Millisecond},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "sleep 120", ServerIDs: []int64{1, 2}, TimeoutSeconds: 60, Concurrency: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForResultStatus(t, manager, task.TaskID, 1, domain.BatchCommandRunning)
	if err := manager.CancelServer(domain.CancelBatchCommandServerRequest{TaskID: task.TaskID, ServerID: 1}); err != nil {
		t.Fatal(err)
	}
	task = waitForTask(t, manager, task.TaskID)
	if resultFor(t, task, 1).Status != domain.BatchCommandCanceled {
		t.Fatalf("server 1 should be canceled: %+v", task.Results)
	}
	if resultFor(t, task, 2).Status != domain.BatchCommandCompleted {
		t.Fatalf("server 2 should complete: %+v", task.Results)
	}
}

func TestCancelTaskCancelsAllServers(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {block: true},
		2: {block: true},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "sleep 120", ServerIDs: []int64{1, 2}, TimeoutSeconds: 60, Concurrency: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForResultStatus(t, manager, task.TaskID, 1, domain.BatchCommandRunning)
	if err := manager.CancelTask(domain.CancelBatchCommandTaskRequest{TaskID: task.TaskID}); err != nil {
		t.Fatal(err)
	}
	task = waitForTask(t, manager, task.TaskID)
	if task.Status != domain.BatchCommandCanceled {
		t.Fatalf("task status = %s", task.Status)
	}
	for _, result := range task.Results {
		if result.Status != domain.BatchCommandCanceled {
			t.Fatalf("result should be canceled: %+v", task.Results)
		}
	}
}

func TestStopServerCancelsOnlyThatServer(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {block: true},
		2: {block: true},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "sleep 120", ServerIDs: []int64{1, 2}, TimeoutSeconds: 60, Concurrency: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForResultStatus(t, manager, task.TaskID, 1, domain.BatchCommandRunning)
	waitForResultStatus(t, manager, task.TaskID, 2, domain.BatchCommandRunning)
	manager.StopServer(1)
	waitForResultStatus(t, manager, task.TaskID, 1, domain.BatchCommandCanceled)

	running, err := manager.Get(task.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if resultFor(t, running, 2).Status != domain.BatchCommandRunning {
		t.Fatalf("server 2 should still be running: %+v", running.Results)
	}
	if err := manager.CancelTask(domain.CancelBatchCommandTaskRequest{TaskID: task.TaskID}); err != nil {
		t.Fatal(err)
	}
	_ = waitForTask(t, manager, task.TaskID)
}

func TestOutputLimitTruncatesServerOutput(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {stdout: strings.Repeat("x", outputLimitBytes+1)},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "cat large.log", ServerIDs: []int64{1}, TimeoutSeconds: 60, Concurrency: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	task = waitForTask(t, manager, task.TaskID)
	result := resultFor(t, task, 1)
	if !result.OutputTruncated || !strings.Contains(result.Stdout, outputTruncatedNotice) {
		t.Fatalf("output was not truncated: truncated=%t len=%d", result.OutputTruncated, len(result.Stdout))
	}
}

func TestTimeoutMarksOnlyThatServerTimedOut(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {block: true},
	})
	defer cancel()

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "sleep 120", ServerIDs: []int64{1}, TimeoutSeconds: MinimumTimeoutSeconds, Concurrency: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	task = waitForTaskWithin(t, manager, task.TaskID, 7*time.Second)
	if task.Status != domain.BatchCommandTimeout {
		t.Fatalf("task status = %s", task.Status)
	}
	if resultFor(t, task, 1).Status != domain.BatchCommandTimeout {
		t.Fatalf("server should time out: %+v", task.Results)
	}
}

func TestInteractiveCommandIsRejected(t *testing.T) {
	manager, _, _, cancel := newTestManager(t, nil)
	defer cancel()

	_, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "vim /etc/hosts", ServerIDs: []int64{1}, TimeoutSeconds: 60, Concurrency: 1,
	})
	if err == nil || err.Error() != ErrInteractiveCommandMessage {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCommandAndOutputAreNotWrittenToLogs(t *testing.T) {
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	manager, _, _, cancel := newTestManager(t, map[int64]fakeBehavior{
		1: {stdout: "secret stdout\n", stderr: "secret stderr\n"},
	})
	defer cancel()
	manager.logger = logger

	task, err := manager.Start(domain.StartBatchCommandRequest{
		Command: "echo secret-command", ServerIDs: []int64{1}, TimeoutSeconds: 60, Concurrency: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = waitForTask(t, manager, task.TaskID)
	for _, entry := range logger.List(20) {
		combined := entry.Message + entry.Summary + entry.TechnicalMessage + entry.Error
		for _, forbidden := range []string{"secret-command", "secret stdout", "secret stderr"} {
			if strings.Contains(combined, forbidden) {
				t.Fatalf("log contains forbidden content %q: %+v", forbidden, entry)
			}
		}
	}
}
