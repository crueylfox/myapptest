package servicemanager

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

type journalCaptureEmitter struct {
	lines     chan domain.ServiceJournalLineEvent
	errors    chan domain.ServiceJournalErrorEvent
	completed chan domain.ServiceJournalCompletedEvent
	states    chan domain.ServiceJournalStateEvent
}

func newJournalCaptureEmitter() *journalCaptureEmitter {
	return &journalCaptureEmitter{
		lines:     make(chan domain.ServiceJournalLineEvent, 8),
		errors:    make(chan domain.ServiceJournalErrorEvent, 8),
		completed: make(chan domain.ServiceJournalCompletedEvent, 8),
		states:    make(chan domain.ServiceJournalStateEvent, 8),
	}
}

func (e *journalCaptureEmitter) JournalState(event domain.ServiceJournalStateEvent) {
	e.states <- event
}

func (e *journalCaptureEmitter) JournalLine(event domain.ServiceJournalLineEvent) {
	e.lines <- event
}

func (e *journalCaptureEmitter) JournalError(event domain.ServiceJournalErrorEvent) {
	e.errors <- event
}

func (e *journalCaptureEmitter) JournalCompleted(event domain.ServiceJournalCompletedEvent) {
	e.completed <- event
}

func TestParseJournalJSONLines(t *testing.T) {
	output := strings.Join([]string{
		`{"__REALTIME_TIMESTAMP":"1710000000123456","PRIORITY":"3","SYSLOG_IDENTIFIER":"nginx","_PID":"123","MESSAGE":"failed to bind"}`,
		`{"PRIORITY":"6","_COMM":"app","MESSAGE":[104,101,108,108,111]}`,
	}, "\n")
	lines, fallback := parseJournalOutput(7, "nginx.service", output, "json")
	if fallback || len(lines) != 2 {
		t.Fatalf("lines=%+v fallback=%v", lines, fallback)
	}
	if lines[0].PriorityLabel != "错误" || lines[0].Identifier != "nginx" || lines[0].PID != "123" || lines[0].Timestamp == "" {
		t.Fatalf("first line = %+v", lines[0])
	}
	if lines[1].Message != "hello" || lines[1].PriorityLabel != "信息" {
		t.Fatalf("byte-array line = %+v", lines[1])
	}
}

func TestParseJournalFallbackAndTruncation(t *testing.T) {
	lines, fallback := parseJournalOutput(7, "nginx.service", "not-json", "json")
	if !fallback || len(lines) != 1 || lines[0].PriorityLabel != "未知" || lines[0].Message != "not-json" {
		t.Fatalf("fallback lines=%+v fallback=%v", lines, fallback)
	}
	longMessage := strings.Repeat("界", maxJournalMessageBytes)
	line, _ := parseJournalLine(1, `{"MESSAGE":"`+longMessage+`","PRIORITY":"6"}`, "json")
	if !line.Truncated || !strings.Contains(line.Message, "已截断") {
		t.Fatalf("long line = truncated:%v len:%d", line.Truncated, len(line.Message))
	}
}

func TestJournalCommandsNormalizeFilters(t *testing.T) {
	if normalizeJournalLineLimit(999) != 200 || normalizeJournalLineLimit(500) != 500 {
		t.Fatal("line limit normalization failed")
	}
	_, priority, err := normalizeJournalPriority("warning")
	if err != nil || priority != "warning" {
		t.Fatalf("priority=%q err=%v", priority, err)
	}
	if _, _, err := normalizeJournalPriority("panic"); err == nil {
		t.Fatal("invalid priority accepted")
	}
	command := journalSnapshotCommand("nginx.service", 500, "err", true, false, "json")
	for _, token := range []string{"journalctl", "-u 'nginx.service'", "-n 500", "-o json", "-b 0", "-p err"} {
		if !strings.Contains(command, token) {
			t.Fatalf("command missing %q: %s", token, command)
		}
	}
	follow := journalFollowCommand("nginx.service", "", false, true, "short-iso")
	if !strings.Contains(follow, "sudo -n journalctl") || !strings.Contains(follow, "-n 0 -f") || strings.Contains(follow, "-b 0") {
		t.Fatalf("follow command = %s", follow)
	}
}

func TestManagerJournalSnapshotUsesSudoAfterPermission(t *testing.T) {
	direct := journalSnapshotCommand("nginx.service", 200, "", true, false, "json")
	sudo := journalSnapshotCommand("nginx.service", 200, "", true, true, "json")
	transport := &fakeTransport{
		responses: map[string]string{
			idUserCommand: "1000\n",
			sudo:          `{"MESSAGE":"ok","PRIORITY":"6"}` + "\n",
		},
		errors: map[string]error{
			direct: errors.New("remote command failed: permission denied"),
		},
	}
	response, err := testManager(context.Background(), transport).Journal(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID:        7,
		UnitName:        "nginx.service",
		LineLimit:       200,
		Priority:        "all",
		CurrentBootOnly: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Lines) != 1 || response.Lines[0].Message != "ok" || !transport.saw(sudo) {
		t.Fatalf("response=%+v commands=%s", response, transport.commandLog())
	}
}

func TestManagerJournalSnapshotFallsBackToShortISO(t *testing.T) {
	jsonCommand := journalSnapshotCommand("nginx.service", 100, "", false, false, "json")
	shortCommand := journalSnapshotCommand("nginx.service", 100, "", false, false, "short-iso")
	transport := &fakeTransport{
		responses: map[string]string{
			shortCommand: "2026-06-21 10:00:00 host nginx[123]: legacy line\n",
		},
		errors: map[string]error{
			jsonCommand: errors.New("remote command failed: unsupported output format"),
		},
	}
	response, err := testManager(context.Background(), transport).Journal(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID:  7,
		UnitName:  "nginx.service",
		LineLimit: 100,
		Priority:  "all",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !response.Fallback || len(response.Lines) != 1 || !strings.Contains(response.Lines[0].Message, "legacy line") {
		t.Fatalf("response=%+v", response)
	}
}

func TestManagerJournalFollowEmitsLines(t *testing.T) {
	command := journalFollowCommand("nginx.service", "", true, false, "json")
	transport := &fakeTransport{
		streams: map[string]*fakeStreamingCommand{
			command: {
				stdout: strings.NewReader(`{"MESSAGE":"ready","PRIORITY":"6","SYSLOG_IDENTIFIER":"nginx"}` + "\n"),
				stderr: strings.NewReader(""),
			},
		},
	}
	manager := testManager(context.Background(), transport)
	emitter := newJournalCaptureEmitter()
	manager.SetEmitter(emitter)
	response, err := manager.StartJournalFollow(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID:        7,
		UnitName:        "nginx.service",
		Priority:        "all",
		CurrentBootOnly: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	line := waitJournalLine(t, emitter.lines)
	if line.WatchID != response.WatchID || line.Line.Message != "ready" || line.Line.Identifier != "nginx" {
		t.Fatalf("line = %+v response=%+v", line, response)
	}
}

func TestManagerJournalFollowStopIsIdempotent(t *testing.T) {
	command := journalFollowCommand("nginx.service", "", true, false, "json")
	closed := make(chan struct{})
	stream := &fakeStreamingCommand{
		stdout:   strings.NewReader(""),
		stderr:   strings.NewReader(""),
		closedCh: closed,
	}
	transport := &fakeTransport{streams: map[string]*fakeStreamingCommand{command: stream}}
	manager := testManager(context.Background(), transport)
	emitter := newJournalCaptureEmitter()
	manager.SetEmitter(emitter)
	response, err := manager.StartJournalFollow(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID:        7,
		UnitName:        "nginx.service",
		Priority:        "all",
		CurrentBootOnly: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if manager.JournalWatcherCount(7) != 1 {
		t.Fatalf("watchers = %d", manager.JournalWatcherCount(7))
	}
	manager.StopJournalFollow(domain.StopSystemServiceJournalFollowRequest{ServerID: 7, WatchID: response.WatchID})
	manager.StopJournalFollow(domain.StopSystemServiceJournalFollowRequest{ServerID: 7, WatchID: response.WatchID})
	if manager.JournalWatcherCount(7) != 0 {
		t.Fatalf("watchers = %d", manager.JournalWatcherCount(7))
	}
	waitJournalCompleted(t, emitter.completed)
}

func TestManagerStopServerStopsOnlyTargetJournalWatchers(t *testing.T) {
	makeTransport := func() *fakeTransport {
		command := journalFollowCommand("nginx.service", "", true, false, "json")
		return &fakeTransport{streams: map[string]*fakeStreamingCommand{command: {
			stdout:   strings.NewReader(""),
			stderr:   strings.NewReader(""),
			closedCh: make(chan struct{}),
		}}}
	}
	transports := map[int64]*fakeTransport{7: makeTransport(), 8: makeTransport()}
	manager := NewWithDialer(context.Background(), nil, func() time.Duration { return time.Second }, func(_ context.Context, connection domain.Connection, _ domain.AuthRequest, _ time.Duration) (Transport, time.Duration, error) {
		return transports[connection.ID], 0, nil
	})
	emitter := newJournalCaptureEmitter()
	manager.SetEmitter(emitter)
	if _, err := manager.StartJournalFollow(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{ServerID: 7, UnitName: "nginx.service", Priority: "all", CurrentBootOnly: true}); err != nil {
		t.Fatal(err)
	}
	other := testConnection()
	other.ID = 8
	if _, err := manager.StartJournalFollow(other, domain.AuthRequest{}, domain.SystemServiceJournalRequest{ServerID: 8, UnitName: "nginx.service", Priority: "all", CurrentBootOnly: true}); err != nil {
		t.Fatal(err)
	}
	manager.StopServer(7)
	if manager.JournalWatcherCount(7) != 0 || manager.JournalWatcherCount(8) != 1 {
		t.Fatalf("watcher counts target=%d other=%d", manager.JournalWatcherCount(7), manager.JournalWatcherCount(8))
	}
	manager.StopServer(8)
}

func waitJournalLine(t *testing.T, ch <-chan domain.ServiceJournalLineEvent) domain.ServiceJournalLineEvent {
	t.Helper()
	select {
	case event := <-ch:
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for journal line")
		return domain.ServiceJournalLineEvent{}
	}
}

func waitJournalCompleted(t *testing.T, ch <-chan domain.ServiceJournalCompletedEvent) domain.ServiceJournalCompletedEvent {
	t.Helper()
	select {
	case event := <-ch:
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for journal completion")
		return domain.ServiceJournalCompletedEvent{}
	}
}
