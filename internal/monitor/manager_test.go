package monitor

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"hostdeck/internal/connectionerror"
	"hostdeck/internal/domain"
	"hostdeck/internal/linuxmonitor"
	"hostdeck/internal/logging"
	"hostdeck/internal/networkdiag"
)

const monitorCollectionFixture = `@@CPU
cpu 100 0 50 850 0 0 0 0
@@MEM
MemTotal: 1000 kB
MemAvailable: 400 kB
SwapTotal: 100 kB
SwapFree: 50 kB
@@IFACE
eth0
@@RX
1000
@@TX
2000
@@DF
block_size=1
Filesystem 1-blocks Used Available Capacity Mounted on
/dev/vda1 10000 4000 6000 40% /
@@LOAD
0.10 0.20 0.30 1/10 20
@@UPTIME
123.5 1.0
@@OS
PRETTY_NAME="Rocky Linux 9.5"
@@UNAME
Linux 5.14.0
@@ARCH
x86_64
@@END
`

type scriptedTransport struct {
	mu      sync.Mutex
	delays  []time.Duration
	outputs []string
	errors  []error
	calls   int
}

func (t *scriptedTransport) Run(ctx context.Context, _ string) (string, error) {
	t.mu.Lock()
	index := t.calls
	t.calls++
	var delay time.Duration
	if index < len(t.delays) {
		delay = t.delays[index]
	}
	var output string
	if index < len(t.outputs) {
		output = t.outputs[index]
	}
	var err error
	if index < len(t.errors) {
		err = t.errors[index]
	}
	t.mu.Unlock()
	if delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-timer.C:
		}
	}
	return output, err
}

func (t *scriptedTransport) Fingerprint() string { return "SHA256:test" }
func (t *scriptedTransport) Close() error        { return nil }
func (t *scriptedTransport) StartStreamingCommand(context.Context, string) (StreamingCommand, error) {
	return &staticStreamingSession{
		stdout: strings.NewReader(networkdiag.ExitMarker() + "0\n"),
		stderr: strings.NewReader(""),
	}, nil
}

type diagnosticAwareTransport struct {
	started    chan struct{}
	once       sync.Once
	closeCount atomic.Int32
}

func (t *diagnosticAwareTransport) Run(ctx context.Context, command string) (string, error) {
	return monitorCollectionFixture, nil
}

func (t *diagnosticAwareTransport) Fingerprint() string { return "SHA256:test" }
func (t *diagnosticAwareTransport) Close() error        { return nil }
func (t *diagnosticAwareTransport) StartStreamingCommand(context.Context, string) (StreamingCommand, error) {
	t.once.Do(func() { close(t.started) })
	return &blockingStreamingSession{closeCount: &t.closeCount, closed: make(chan struct{})}, nil
}

type streamingOutputTransport struct {
	session *pipeStreamingSession
	started chan struct{}
	once    sync.Once
}

func (t *streamingOutputTransport) Run(context.Context, string) (string, error) {
	return monitorCollectionFixture, nil
}

func (t *streamingOutputTransport) Fingerprint() string { return "SHA256:test" }
func (t *streamingOutputTransport) Close() error        { return nil }
func (t *streamingOutputTransport) StartStreamingCommand(context.Context, string) (StreamingCommand, error) {
	t.once.Do(func() { close(t.started) })
	return t.session, nil
}

type staticStreamingSession struct {
	stdout io.Reader
	stderr io.Reader
}

func (s *staticStreamingSession) Stdout() io.Reader { return s.stdout }
func (s *staticStreamingSession) Stderr() io.Reader { return s.stderr }
func (s *staticStreamingSession) Wait() error       { return nil }
func (s *staticStreamingSession) Close() error      { return nil }

type blockingStreamingSession struct {
	closeCount *atomic.Int32
	closed     chan struct{}
	once       sync.Once
}

func (s *blockingStreamingSession) Stdout() io.Reader { return strings.NewReader("") }
func (s *blockingStreamingSession) Stderr() io.Reader { return strings.NewReader("") }
func (s *blockingStreamingSession) Wait() error {
	<-s.closed
	return context.Canceled
}
func (s *blockingStreamingSession) Close() error {
	s.once.Do(func() {
		if s.closeCount != nil {
			s.closeCount.Add(1)
		}
		close(s.closed)
	})
	return nil
}

type pipeStreamingSession struct {
	stdoutReader *io.PipeReader
	stdoutWriter *io.PipeWriter
	stderrReader *io.PipeReader
	stderrWriter *io.PipeWriter
	waitRelease  chan struct{}
	closed       chan struct{}
	once         sync.Once
}

func newPipeStreamingSession() *pipeStreamingSession {
	stdoutReader, stdoutWriter := io.Pipe()
	stderrReader, stderrWriter := io.Pipe()
	return &pipeStreamingSession{
		stdoutReader: stdoutReader,
		stdoutWriter: stdoutWriter,
		stderrReader: stderrReader,
		stderrWriter: stderrWriter,
		waitRelease:  make(chan struct{}),
		closed:       make(chan struct{}),
	}
}

func (s *pipeStreamingSession) Stdout() io.Reader { return s.stdoutReader }
func (s *pipeStreamingSession) Stderr() io.Reader { return s.stderrReader }
func (s *pipeStreamingSession) Wait() error {
	select {
	case <-s.waitRelease:
		return nil
	case <-s.closed:
		return context.Canceled
	}
}
func (s *pipeStreamingSession) Close() error {
	s.once.Do(func() {
		_ = s.stdoutWriter.Close()
		_ = s.stderrWriter.Close()
		_ = s.stdoutReader.Close()
		_ = s.stderrReader.Close()
		close(s.closed)
	})
	return nil
}

func newTestManager(t *testing.T, dial Dialer, emit Emitter) (*Manager, func()) {
	t.Helper()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manager := NewWithDialer(context.Background(), logger, nil, nil, emit, nil, dial)
	return manager, func() {
		manager.StopAll()
		_ = logger.Close()
	}
}

func waitSnapshot(t *testing.T, snapshots <-chan domain.MonitorSnapshot, predicate func(domain.MonitorSnapshot) bool) domain.MonitorSnapshot {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case snapshot := <-snapshots:
			if predicate(snapshot) {
				return snapshot
			}
		case <-timer.C:
			t.Fatal("timed out waiting for monitor snapshot")
		}
	}
}

func TestAuthenticationFailureStopsWorkerAndAllowsRetry(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 16)
	var calls atomic.Int32
	manager, cleanup := newTestManager(t, func(
		ctx context.Context,
		_ domain.Connection,
		_ domain.AuthRequest,
		_ time.Duration,
	) (Transport, time.Duration, error) {
		if calls.Add(1) == 1 {
			return nil, 0, errors.New("ssh: unable to authenticate, no supported methods remain")
		}
		<-ctx.Done()
		return nil, 0, ctx.Err()
	}, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()

	connection := domain.Connection{
		ID: 21, Name: "auth-test", AuthType: domain.AuthPassword, RefreshInterval: 1,
	}
	if err := manager.Start(connection, domain.AuthRequest{ResolvedFromStore: true}); err != nil {
		t.Fatal(err)
	}
	failed := waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.ErrorCode == connectionerror.CodeAuthFailed
	})
	if failed.MonitorActive || failed.ConnectionError == nil || failed.ConnectionError.Retryable {
		t.Fatalf("authentication failure retained worker state: %+v", failed)
	}
	deadline := time.Now().Add(time.Second)
	for manager.IsActive(connection.ID) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if manager.IsActive(connection.ID) {
		t.Fatal("authentication failure left monitor worker active")
	}

	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatalf("retry start failed: %v", err)
	}
	waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.Status == domain.StatusConnecting && snapshot.MonitorActive
	})
	manager.Stop(connection.ID)
}

func TestRetryableTimeoutRemainsActiveUntilCancelled(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 16)
	manager, cleanup := newTestManager(t, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return nil, 0, context.DeadlineExceeded
	}, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()

	connection := domain.Connection{ID: 22, Name: "timeout-test", RefreshInterval: 1}
	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	timeout := waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.ErrorCode == connectionerror.CodeTimeout
	})
	if !timeout.MonitorActive || timeout.ConnectionError == nil || !timeout.ConnectionError.Retryable {
		t.Fatalf("timeout state is not retryable: %+v", timeout)
	}
	manager.Stop(connection.ID)
	if manager.IsActive(connection.ID) {
		t.Fatal("cancelled timeout worker is still active")
	}
}

func TestListNetworkInterfacesReturnsRecommendedInterface(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 16)
	networkOutput := `@@SSH_CONNECTION
198.51.100.8 54122 192.0.2.10 22
@@IP_ADDR
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 192.0.2.10/24 brd 192.0.2.255 scope global eth0
@@END
`
	transport := &scriptedTransport{outputs: []string{monitorCollectionFixture, networkOutput}}
	manager, cleanup := newTestManager(t, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	}, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()

	connection := domain.Connection{ID: 23, Name: "interfaces", RefreshInterval: 1}
	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.Status == domain.StatusOnline
	})
	response, err := manager.ListNetworkInterfaces(context.Background(), domain.ListNetworkInterfacesRequest{
		ServerID: connection.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.RecommendedInterface != "eth0" ||
		response.RecommendedInterfaceReason != "ssh_connection_local_ip" ||
		len(response.Interfaces) != 1 {
		t.Fatalf("response=%+v", response)
	}
}

func TestCancelNetworkDiagnosticMarksTaskCanceled(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 16)
	transport := &diagnosticAwareTransport{started: make(chan struct{})}
	manager, cleanup := newTestManager(t, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	}, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()

	connection := domain.Connection{ID: 23, Name: "diag", RefreshInterval: 1}
	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.Status == domain.StatusOnline
	})
	task, err := manager.StartNetworkDiagnostic(domain.StartNetworkDiagnosticRequest{
		ServerID: connection.ID, Type: domain.NetworkDiagnosticPing, Target: "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	<-transport.started
	if err := manager.CancelNetworkDiagnostic(domain.CancelNetworkDiagnosticRequest{
		ServerID: connection.ID, TaskID: task.TaskID,
	}); err != nil {
		t.Fatal(err)
	}
	waitDiagnosticStatus(t, manager, connection.ID, task.TaskID, domain.NetworkDiagnosticCanceled)
	if got := transport.closeCount.Load(); got < 1 {
		t.Fatal("cancel did not close the diagnostic SSH session")
	}
	if err := manager.CancelNetworkDiagnostic(domain.CancelNetworkDiagnosticRequest{
		ServerID: connection.ID, TaskID: task.TaskID,
	}); err != nil {
		t.Fatalf("second cancel should be idempotent: %v", err)
	}
}

func TestStopCancelsNetworkDiagnosticsForServer(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 16)
	transport := &diagnosticAwareTransport{started: make(chan struct{})}
	manager, cleanup := newTestManager(t, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	}, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()

	connection := domain.Connection{ID: 24, Name: "diag-stop", RefreshInterval: 1}
	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.Status == domain.StatusOnline
	})
	task, err := manager.StartNetworkDiagnostic(domain.StartNetworkDiagnosticRequest{
		ServerID: connection.ID, Type: domain.NetworkDiagnosticPing, Target: "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	<-transport.started
	manager.Stop(connection.ID)
	waitDiagnosticStatus(t, manager, connection.ID, task.TaskID, domain.NetworkDiagnosticCanceled)
	if got := transport.closeCount.Load(); got < 1 {
		t.Fatal("stop did not close the diagnostic SSH session")
	}
}

func TestNetworkDiagnosticStreamsStdoutAndStderrBeforeWaitCompletes(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 16)
	outputs := make(chan domain.NetworkDiagnosticOutputEvent, 8)
	session := newPipeStreamingSession()
	transport := &streamingOutputTransport{session: session, started: make(chan struct{})}
	manager, cleanup := newTestManager(t, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	}, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()
	manager.SetNetworkDiagnosticEmitters(nil, func(event domain.NetworkDiagnosticOutputEvent) {
		outputs <- event
	}, nil)

	connection := domain.Connection{ID: 25, Name: "diag-stream", RefreshInterval: 1}
	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.Status == domain.StatusOnline
	})
	task, err := manager.StartNetworkDiagnostic(domain.StartNetworkDiagnosticRequest{
		ServerID: connection.ID, Type: domain.NetworkDiagnosticPing, Target: "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	<-transport.started
	if _, err := session.stdoutWriter.Write([]byte("stdout line\n")); err != nil {
		t.Fatal(err)
	}
	stdout := waitDiagnosticOutput(t, outputs, task.TaskID)
	if stdout.Line != "stdout line" || stdout.Stream != "stdout" {
		t.Fatalf("stdout event = %+v", stdout)
	}
	if _, err := session.stderrWriter.Write([]byte("stderr line\n")); err != nil {
		t.Fatal(err)
	}
	stderr := waitDiagnosticOutput(t, outputs, task.TaskID)
	if stderr.Line != "stderr line" || stderr.Stream != "stderr" {
		t.Fatalf("stderr event = %+v", stderr)
	}
	if _, err := session.stdoutWriter.Write([]byte(networkdiag.ExitMarker() + "0\n")); err != nil {
		t.Fatal(err)
	}
	_ = session.stdoutWriter.Close()
	_ = session.stderrWriter.Close()
	close(session.waitRelease)
	waitDiagnosticStatus(t, manager, connection.ID, task.TaskID, domain.NetworkDiagnosticCompleted)
}

func waitDiagnosticStatus(
	t *testing.T,
	manager *Manager,
	serverID int64,
	taskID string,
	status domain.NetworkDiagnosticStatus,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		for _, task := range manager.ListNetworkDiagnosticTasks(serverID) {
			if task.TaskID == taskID && task.Status == status {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("diagnostic %s did not reach %s: %+v", taskID, status, manager.ListNetworkDiagnosticTasks(serverID))
}

func waitDiagnosticOutput(
	t *testing.T,
	outputs <-chan domain.NetworkDiagnosticOutputEvent,
	taskID string,
) domain.NetworkDiagnosticOutputEvent {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-outputs:
			if event.TaskID == taskID {
				return event
			}
		case <-timer.C:
			t.Fatalf("timed out waiting for diagnostic output for %s", taskID)
		}
	}
}

func TestDuplicateMonitorStartIsRejected(t *testing.T) {
	started := make(chan struct{}, 1)
	manager, cleanup := newTestManager(t, func(
		ctx context.Context,
		_ domain.Connection,
		_ domain.AuthRequest,
		_ time.Duration,
	) (Transport, time.Duration, error) {
		started <- struct{}{}
		<-ctx.Done()
		return nil, 0, ctx.Err()
	}, nil)
	defer cleanup()

	connection := domain.Connection{ID: 23, Name: "duplicate-test", RefreshInterval: 1}
	if err := manager.Start(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	<-started
	if err := manager.Start(connection, domain.AuthRequest{}); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("duplicate start error = %v", err)
	}
}

func TestMonitorUsesConfiguredConnectionTimeout(t *testing.T) {
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	received := make(chan time.Duration, 1)
	manager := NewWithDialer(
		context.Background(),
		logger,
		nil,
		nil,
		nil,
		func() time.Duration { return 5 * time.Second },
		func(
			_ context.Context, _ domain.Connection, _ domain.AuthRequest, timeout time.Duration,
		) (Transport, time.Duration, error) {
			received <- timeout
			return nil, 0, errors.New("ssh: unable to authenticate")
		},
	)
	defer manager.StopAll()
	if err := manager.Start(
		domain.Connection{ID: 42, Name: "timeout", RefreshInterval: 1},
		domain.AuthRequest{},
	); err != nil {
		t.Fatal(err)
	}
	select {
	case timeout := <-received:
		if timeout != 5*time.Second {
			t.Fatalf("timeout=%s", timeout)
		}
	case <-time.After(time.Second):
		t.Fatal("dialer did not receive configured timeout")
	}
}

func TestSampleLatencyRefreshesAndFailureClearsAvailability(t *testing.T) {
	snapshots := make(chan domain.MonitorSnapshot, 4)
	manager, cleanup := newTestManager(t, nil, func(snapshot domain.MonitorSnapshot) {
		snapshots <- snapshot
	})
	defer cleanup()
	transport := &scriptedTransport{
		delays:  []time.Duration{15 * time.Millisecond, 35 * time.Millisecond},
		outputs: []string{monitorCollectionFixture, monitorCollectionFixture},
		errors:  []error{nil, nil, errors.New("network failure")},
	}
	err := manager.sampleLoop(
		context.Background(),
		transport,
		domain.Connection{ID: 51, Name: "latency"},
		time.Millisecond,
		&linuxmonitor.Calculator{},
	)
	if err == nil {
		t.Fatal("sample loop did not return the transport failure")
	}
	first := <-snapshots
	second := <-snapshots
	if !first.LatencyAvailable || !second.LatencyAvailable {
		t.Fatalf("successful samples did not expose latency: first=%+v second=%+v", first, second)
	}
	if second.LatencyMillis <= first.LatencyMillis {
		t.Fatalf("latency did not refresh: first=%d second=%d", first.LatencyMillis, second.LatencyMillis)
	}

	failure := domain.MonitorSnapshot{
		ConnectionID: 51, Status: domain.StatusReconnecting, MonitorActive: true,
	}
	manager.publish(failure)
	if latest, ok := manager.Latest(51); !ok || latest.LatencyAvailable {
		t.Fatalf("failure retained stale latency: %+v", latest)
	}

	recoveryCtx, cancel := context.WithCancel(context.Background())
	recovered := &scriptedTransport{
		delays:  []time.Duration{10 * time.Millisecond},
		outputs: []string{monitorCollectionFixture},
		errors:  []error{nil, context.Canceled},
	}
	go func() {
		_ = manager.sampleLoop(
			recoveryCtx,
			recovered,
			domain.Connection{ID: 51, Name: "latency"},
			time.Millisecond,
			&linuxmonitor.Calculator{},
		)
	}()
	recoveredSnapshot := waitSnapshot(t, snapshots, func(snapshot domain.MonitorSnapshot) bool {
		return snapshot.ConnectionID == 51 && snapshot.LatencyAvailable
	})
	cancel()
	if recoveredSnapshot.LatencyMillis < 1 {
		t.Fatalf("recovered latency = %d", recoveredSnapshot.LatencyMillis)
	}
}
