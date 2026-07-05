package terminal

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
)

type testEmitter struct {
	output chan OutputEvent
	status chan StatusEvent
}

func (e testEmitter) Output(event OutputEvent) {
	e.output <- event
}

func (e testEmitter) Status(event StatusEvent) {
	e.status <- event
}

type fakeShell struct {
	reader    *io.PipeReader
	writer    *io.PipeWriter
	wait      chan error
	closed    chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
	input     bytes.Buffer
	columns   int
	rows      int
	resizes   []terminalSize
}

func newFakeShell() *fakeShell {
	reader, writer := io.Pipe()
	return &fakeShell{
		reader: reader, writer: writer, wait: make(chan error, 1), closed: make(chan struct{}),
	}
}

func (s *fakeShell) Read(buffer []byte) (int, error) {
	return s.reader.Read(buffer)
}

func (s *fakeShell) Write(data []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.input.Write(data)
}

func (s *fakeShell) Resize(columns, rows int) error {
	s.mu.Lock()
	s.columns, s.rows = columns, rows
	s.resizes = append(s.resizes, terminalSize{columns: columns, rows: rows})
	s.mu.Unlock()
	return nil
}

func (s *fakeShell) Wait() error {
	return <-s.wait
}

func (s *fakeShell) Close() error {
	s.closeOnce.Do(func() {
		close(s.closed)
		_ = s.writer.Close()
		_ = s.reader.Close()
		s.wait <- io.EOF
	})
	return nil
}

type fakeTransport struct {
	shell *fakeShell
}

func (t fakeTransport) OpenTerminal(int, int) (Shell, error) { return t.shell, nil }
func (t fakeTransport) Fingerprint() string                  { return "SHA256:test" }
func (t fakeTransport) Close() error                         { return nil }

func newTestManager(t *testing.T, dialer Dialer) (*Manager, testEmitter, func()) {
	t.Helper()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	emitter := testEmitter{output: make(chan OutputEvent, 32), status: make(chan StatusEvent, 32)}
	manager := NewWithDialer(context.Background(), logger, emitter, nil, dialer)
	return manager, emitter, func() {
		manager.StopAll()
		_ = logger.Close()
	}
}

func waitStatus(t *testing.T, events <-chan StatusEvent, status Status) StatusEvent {
	t.Helper()
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case event := <-events:
			if event.Status == status {
				return event
			}
		case <-timeout.C:
			t.Fatalf("timed out waiting for status %s", status)
		}
	}
}

func TestTerminalLifecycleInputOutputResizeAndClose(t *testing.T) {
	shell := newFakeShell()
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		return fakeTransport{shell: shell}, 0, nil
	})
	defer cleanup()
	info, err := manager.Open(domain.Connection{ID: 1, Name: "test"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)
	input := []byte("echo test\n")
	if err := manager.Write(info.SessionID, base64.StdEncoding.EncodeToString(input)); err != nil {
		t.Fatal(err)
	}
	if err := manager.Resize(info.SessionID, 120, 40); err != nil {
		t.Fatal(err)
	}
	if _, err := shell.writer.Write([]byte("terminal output")); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-emitter.output:
		output, err := base64.StdEncoding.DecodeString(event.DataBase64)
		if err != nil || string(output) != "terminal output" {
			t.Fatalf("output=%q err=%v", output, err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for terminal output")
	}
	deadline := time.Now().Add(time.Second)
	for {
		shell.mu.Lock()
		gotInput := shell.input.String()
		columns, rows := shell.columns, shell.rows
		shell.mu.Unlock()
		if gotInput == string(input) && columns == 120 && rows == 40 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("input=%q size=%dx%d", gotInput, columns, rows)
		}
		time.Sleep(time.Millisecond)
	}
	manager.Close(info.SessionID)
	if manager.ActiveCount() != 0 {
		t.Fatalf("active terminals=%d", manager.ActiveCount())
	}
}

func TestTerminalWritePreservesUTF8Bytes(t *testing.T) {
	shell := newFakeShell()
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		return fakeTransport{shell: shell}, 0, nil
	})
	defer cleanup()
	info, err := manager.Open(domain.Connection{ID: 21, Name: "unicode"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)

	input := []byte("啊")
	if err := manager.Write(info.SessionID, base64.StdEncoding.EncodeToString(input)); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(time.Second)
	for {
		shell.mu.Lock()
		got := append([]byte(nil), shell.input.Bytes()...)
		shell.mu.Unlock()
		if bytes.Equal(got, []byte{0xe5, 0x95, 0x8a}) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("input bytes=% x", got)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestTerminalResizeCoalescesChangesAndSkipsDuplicates(t *testing.T) {
	shell := newFakeShell()
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		return fakeTransport{shell: shell}, 0, nil
	})
	defer cleanup()
	info, err := manager.Open(domain.Connection{ID: 11, Name: "resize"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)

	for _, size := range []terminalSize{
		{columns: 100, rows: 30},
		{columns: 110, rows: 32},
		{columns: 120, rows: 36},
		{columns: 120, rows: 36},
	} {
		if err := manager.Resize(info.SessionID, size.columns, size.rows); err != nil {
			t.Fatal(err)
		}
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		shell.mu.Lock()
		resizes := append([]terminalSize(nil), shell.resizes...)
		shell.mu.Unlock()
		if len(resizes) == 1 {
			if resizes[0] != (terminalSize{columns: 120, rows: 36}) {
				t.Fatalf("resize=%+v", resizes[0])
			}
			break
		}
		time.Sleep(time.Millisecond)
	}
	shell.mu.Lock()
	resizeCount := len(shell.resizes)
	shell.mu.Unlock()
	if resizeCount != 1 {
		t.Fatalf("resize calls=%d", resizeCount)
	}

	if err := manager.Resize(info.SessionID, 120, 36); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * resizeDebounce)
	shell.mu.Lock()
	resizeCount = len(shell.resizes)
	shell.mu.Unlock()
	if resizeCount != 1 {
		t.Fatalf("duplicate resize calls=%d", resizeCount)
	}
}

func TestTerminalDoesNotResizeAfterClose(t *testing.T) {
	shell := newFakeShell()
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		return fakeTransport{shell: shell}, 0, nil
	})
	defer cleanup()
	info, err := manager.Open(domain.Connection{ID: 12, Name: "closed"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)
	manager.Close(info.SessionID)
	if err := manager.Resize(info.SessionID, 140, 44); err == nil {
		t.Fatal("resize after close succeeded")
	}
	time.Sleep(2 * resizeDebounce)
	shell.mu.Lock()
	resizeCount := len(shell.resizes)
	shell.mu.Unlock()
	if resizeCount != 0 {
		t.Fatalf("resize calls after close=%d", resizeCount)
	}
}

func TestTerminalCloseImmediatelyCancelsDial(t *testing.T) {
	manager, emitter, cleanup := newTestManager(t, func(
		ctx context.Context, _ domain.Connection, _ domain.AuthRequest, _ time.Duration,
	) (Transport, time.Duration, error) {
		<-ctx.Done()
		return nil, 0, ctx.Err()
	})
	defer cleanup()
	info, err := manager.Open(domain.Connection{ID: 1, Name: "test"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	manager.Close(info.SessionID)
	event := waitStatus(t, emitter.status, StatusOffline)
	if event.ConnectionError != nil || event.Active {
		t.Fatalf("intentional close emitted an error: %+v", event)
	}
	if manager.ActiveCount() != 0 {
		t.Fatalf("active terminals=%d", manager.ActiveCount())
	}
}

func TestTerminalUsesConfiguredConnectionTimeout(t *testing.T) {
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	emitter := testEmitter{output: make(chan OutputEvent, 4), status: make(chan StatusEvent, 4)}
	received := make(chan time.Duration, 1)
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return 30 * time.Second },
		func(
			_ context.Context, _ domain.Connection, _ domain.AuthRequest, timeout time.Duration,
		) (Transport, time.Duration, error) {
			received <- timeout
			return nil, 0, errors.New("stop")
		},
	)
	defer manager.StopAll()
	if _, err := manager.Open(domain.Connection{ID: 41, Name: "timeout"}, domain.AuthRequest{}, 80, 24); err != nil {
		t.Fatal(err)
	}
	select {
	case timeout := <-received:
		if timeout != 30*time.Second {
			t.Fatalf("timeout=%s", timeout)
		}
	case <-time.After(time.Second):
		t.Fatal("dialer did not receive configured timeout")
	}
}

func TestTerminalConnectionFailureIsIsolated(t *testing.T) {
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		return nil, 0, errors.New("dial failed")
	})
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 2, Name: "failed"}, domain.AuthRequest{}, 80, 24); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusError)
	deadline := time.Now().Add(time.Second)
	for manager.ActiveCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if manager.ActiveCount() != 0 {
		t.Fatalf("active terminals=%d", manager.ActiveCount())
	}
}

func TestTerminalAuthenticationFailureIsStructuredAndRetryableByUser(t *testing.T) {
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		return nil, 0, errors.New("ssh: unable to authenticate, no supported methods remain")
	})
	defer cleanup()
	connection := domain.Connection{ID: 3, Name: "auth-failed", AuthType: domain.AuthPassword}
	if _, err := manager.Open(connection, domain.AuthRequest{ResolvedFromStore: true}, 80, 24); err != nil {
		t.Fatal(err)
	}
	event := waitStatus(t, emitter.status, StatusError)
	if event.Active || event.ConnectionError == nil || event.ConnectionError.Code != "AUTH_FAILED" {
		t.Fatalf("event = %+v", event)
	}
	if !event.ConnectionError.CredentialFromStore {
		t.Fatalf("saved credential auth failure did not mark credential source: %+v", event.ConnectionError)
	}
	deadline := time.Now().Add(time.Second)
	for manager.ActiveCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if _, err := manager.Open(connection, domain.AuthRequest{}, 80, 24); err != nil {
		t.Fatalf("retry was blocked: %v", err)
	}
}

func TestTerminalRejectsRapidDuplicateOpen(t *testing.T) {
	manager, _, cleanup := newTestManager(t, func(
		ctx context.Context, _ domain.Connection, _ domain.AuthRequest, _ time.Duration,
	) (Transport, time.Duration, error) {
		<-ctx.Done()
		return nil, 0, ctx.Err()
	})
	defer cleanup()
	connection := domain.Connection{ID: 4, Name: "duplicate"}
	if _, err := manager.Open(connection, domain.AuthRequest{}, 80, 24); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Open(connection, domain.AuthRequest{}, 80, 24); !errors.Is(err, ErrConnectionActive) {
		t.Fatalf("duplicate open error = %v", err)
	}
}

func TestStopConnectionClosesAllTargetSessionsOnly(t *testing.T) {
	var mu sync.Mutex
	shells := make([]*fakeShell, 0, 3)
	manager, emitter, cleanup := newTestManager(t, func(
		context.Context, domain.Connection, domain.AuthRequest, time.Duration,
	) (Transport, time.Duration, error) {
		shell := newFakeShell()
		mu.Lock()
		shells = append(shells, shell)
		mu.Unlock()
		return fakeTransport{shell: shell}, 0, nil
	})
	defer cleanup()

	first, err := manager.Open(domain.Connection{ID: 61, Name: "one"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)
	second, err := manager.Open(domain.Connection{ID: 61, Name: "one"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)
	other, err := manager.Open(domain.Connection{ID: 62, Name: "two"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, emitter.status, StatusOnline)

	manager.StopConnection(61)

	if manager.ActiveCountFor(61) != 0 {
		t.Fatalf("target active terminals=%d", manager.ActiveCountFor(61))
	}
	if manager.ActiveCountFor(62) != 1 {
		t.Fatalf("other server active terminals=%d", manager.ActiveCountFor(62))
	}
	if _, err := manager.worker(first.SessionID); err == nil {
		t.Fatal("first target session remains")
	}
	if _, err := manager.worker(second.SessionID); err == nil {
		t.Fatal("second target session remains")
	}
	if _, err := manager.worker(other.SessionID); err != nil {
		t.Fatalf("other server session was closed: %v", err)
	}
}

func TestReadShellStopsWhenOutputQueueIsFull(t *testing.T) {
	shell := newFakeShell()
	ctx, cancel := context.WithCancel(context.Background())
	chunks := make(chan []byte, 1)
	chunks <- []byte("queue is full")
	readDone := make(chan error, 1)
	readerExited := make(chan struct{})
	go func() {
		readShell(ctx, shell, chunks, readDone)
		close(readerExited)
	}()
	go func() {
		_, _ = shell.writer.Write([]byte("blocked output"))
	}()
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-readerExited:
	case <-time.After(2 * time.Second):
		t.Fatal("terminal reader did not stop after cancellation")
	}
	select {
	case err := <-readDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("read error=%v", err)
		}
	default:
		t.Fatal("terminal reader did not report cancellation")
	}
	_ = shell.Close()
}
