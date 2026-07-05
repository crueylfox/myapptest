package servicemanager

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"serverpilot/internal/domain"
)

type fakeTransport struct {
	mu        sync.Mutex
	responses map[string]string
	errors    map[string]error
	block     map[string]bool
	streams   map[string]*fakeStreamingCommand
	commands  []string
	closed    int
	started   chan string
}

func (t *fakeTransport) Run(ctx context.Context, command string) (string, error) {
	t.mu.Lock()
	t.commands = append(t.commands, command)
	started := t.started
	block := t.block[command]
	err := t.errors[command]
	output := t.responses[command]
	t.mu.Unlock()
	if started != nil {
		select {
		case started <- command:
		default:
		}
	}
	if block {
		<-ctx.Done()
		return "", ctx.Err()
	}
	if err != nil {
		return "", err
	}
	return output, nil
}

func (t *fakeTransport) StartStreamingCommand(ctx context.Context, command string) (StreamingCommand, error) {
	t.mu.Lock()
	t.commands = append(t.commands, command)
	started := t.started
	err := t.errors[command]
	stream := t.streams[command]
	t.mu.Unlock()
	if started != nil {
		select {
		case started <- command:
		default:
		}
	}
	if err != nil {
		return nil, err
	}
	if stream != nil {
		return stream, nil
	}
	return &fakeStreamingCommand{stdout: strings.NewReader(""), stderr: strings.NewReader("")}, nil
}

func (t *fakeTransport) Fingerprint() string { return "" }

func (t *fakeTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed++
	return nil
}

func (t *fakeTransport) saw(command string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, item := range t.commands {
		if item == command {
			return true
		}
	}
	return false
}

func (t *fakeTransport) commandLog() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.Join(t.commands, "\n")
}

type fakeStreamingCommand struct {
	stdout   io.Reader
	stderr   io.Reader
	wait     error
	mu       sync.Mutex
	closed   bool
	closedCh chan struct{}
}

func (s *fakeStreamingCommand) Stdout() io.Reader {
	if s.stdout == nil {
		return strings.NewReader("")
	}
	return s.stdout
}

func (s *fakeStreamingCommand) Stderr() io.Reader {
	if s.stderr == nil {
		return strings.NewReader("")
	}
	return s.stderr
}

func (s *fakeStreamingCommand) Wait() error {
	if s.closedCh != nil {
		<-s.closedCh
	}
	return s.wait
}

func (s *fakeStreamingCommand) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closedCh != nil && !s.closed {
		close(s.closedCh)
	}
	s.closed = true
	return nil
}

func TestManagerCheckSystemdAndUnsupported(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{systemdCapabilityCommand: "systemd 252\n" + privilegeSeparator + "\nroot\n"},
		errors:    map[string]error{},
	}
	capability, err := testManager(context.Background(), transport).Check(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if !capability.Available || !capability.CanManage || capability.RequiresPrivilege {
		t.Fatalf("capability = %+v", capability)
	}

	transport = &fakeTransport{
		responses: map[string]string{systemdCapabilityCommand: "unsupported\n"},
		errors:    map[string]error{},
	}
	capability, err = testManager(context.Background(), transport).Check(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if capability.Available || capability.InitSystem != domain.ServiceManagerInitSystemUnsupported {
		t.Fatalf("unsupported capability = %+v", capability)
	}

	transport = &fakeTransport{
		responses: map[string]string{},
		errors:    map[string]error{systemdCapabilityCommand: errors.New("remote command failed: systemctl: not found")},
	}
	capability, err = testManager(context.Background(), transport).Check(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if capability.Available || capability.Error != serviceManagerUnsupportedMessage {
		t.Fatalf("command-failed capability = %+v", capability)
	}
}

func TestManagerListAndDetail(t *testing.T) {
	listOutput := "nginx.service loaded active running A high performance web server\n" +
		unitFileSeparator + "\nnginx.service enabled enabled\n"
	detailOutput := strings.Join([]string{
		"Id=nginx.service",
		"Description=A high performance web server",
		"LoadState=loaded",
		"ActiveState=active",
		"SubState=running",
		"UnitFileState=enabled",
		"MainPID=123",
	}, "\n")
	transport := &fakeTransport{
		responses: map[string]string{
			systemdListCommand:                        listOutput,
			systemdBaseDetailCommand("nginx.service"): detailOutput,
			systemdOptionalDetailCommand("nginx.service"): strings.Join([]string{
				"MemoryCurrent=2048",
				"CPUUsageNSec=456789",
				"TasksCurrent=5",
				"NRestarts=1",
			}, "\n"),
		},
		errors: map[string]error{},
	}
	manager := testManager(context.Background(), transport)
	list, err := manager.List(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Services) != 1 || list.Services[0].UnitName != "nginx.service" {
		t.Fatalf("list = %+v", list)
	}
	detail, err := manager.Detail(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"})
	if err != nil {
		t.Fatal(err)
	}
	if detail.MainPID != 123 || detail.Description == "" {
		t.Fatalf("detail = %+v", detail)
	}
	if detail.MemoryCurrentBytes == nil || *detail.MemoryCurrentBytes != 2048 || detail.TasksCurrent == nil || *detail.TasksCurrent != 5 {
		t.Fatalf("optional detail = %+v", detail)
	}
}

func TestManagerDetailKeepsBaseDetailWhenOptionalPropertiesFail(t *testing.T) {
	for _, unitName := range []string{"docker.service", "ssh.service", "sshd.service"} {
		t.Run(unitName, func(t *testing.T) {
			baseOutput := strings.Join([]string{
				"Id=" + unitName,
				"Description=Legacy systemd service",
				"LoadState=loaded",
				"ActiveState=active",
				"SubState=running",
				"UnitFileState=enabled",
				"MainPID=1234",
				"FragmentPath=/usr/lib/systemd/system/" + unitName,
				"Result=success",
				"ActiveEnterTimestamp=Sun 2026-06-21 12:00:00 CST",
			}, "\n")
			transport := &fakeTransport{
				responses: map[string]string{
					systemdBaseDetailCommand(unitName): baseOutput,
				},
				errors: map[string]error{
					systemdOptionalDetailCommand(unitName): errors.New("remote command failed: Unknown property 'CPUUsageNSec'"),
				},
			}
			detail, err := testManager(context.Background(), transport).Detail(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: unitName})
			if err != nil {
				t.Fatal(err)
			}
			if detail.UnitName != unitName || detail.MainPID != 1234 || detail.MemoryCurrentBytes != nil || detail.CPUUsageNSec != nil || !detail.Partial {
				t.Fatalf("legacy detail = %+v", detail)
			}
			if len(detail.Warnings) != 1 || detail.Warnings[0] != partialDetailMessage {
				t.Fatalf("warnings = %+v", detail.Warnings)
			}
		})
	}
}

func TestManagerDetailFallbackWhenBaseShowFails(t *testing.T) {
	unitName := "docker.service"
	fallbackOutput := strings.Join([]string{
		fallbackActiveSeparator,
		"active",
		fallbackEnabledSeparator,
		"enabled",
		fallbackShowSeparator,
		"Id=docker.service",
		"LoadState=loaded",
		"MainPID=4321",
		"FragmentPath=/usr/lib/systemd/system/docker.service",
		"Result=success",
	}, "\n")
	transport := &fakeTransport{
		responses: map[string]string{
			systemdFallbackDetailCommand(unitName): fallbackOutput,
		},
		errors: map[string]error{
			systemdBaseDetailCommand(unitName): errors.New("remote command failed: Unknown property 'ActiveEnterTimestamp'"),
		},
	}
	detail, err := testManager(context.Background(), transport).Detail(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: unitName})
	if err != nil {
		t.Fatal(err)
	}
	if detail.UnitName != unitName || detail.MainPID != 4321 || detail.ActiveStateLabel != "运行中" || detail.UnitFileStateLabel != "已启用" || !detail.Partial {
		t.Fatalf("fallback detail = %+v", detail)
	}
}

func TestManagerDetailFallbackErrorsAreLocalized(t *testing.T) {
	unitName := "missing.service"
	transport := &fakeTransport{
		responses: map[string]string{},
		errors: map[string]error{
			systemdBaseDetailCommand(unitName):     errors.New("remote command failed: Unknown property 'CPUUsageNSec'"),
			systemdFallbackDetailCommand(unitName): errors.New("remote command failed: Unit missing.service could not be found."),
		},
	}
	_, err := testManager(context.Background(), transport).Detail(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: unitName})
	if err == nil || err.Error() != "服务不存在或已被移除。" {
		t.Fatalf("missing err = %v", err)
	}

	unitName = "nginx.service"
	transport = &fakeTransport{
		responses: map[string]string{},
		errors: map[string]error{
			systemdBaseDetailCommand(unitName):     errors.New("remote command failed: access denied"),
			systemdFallbackDetailCommand(unitName): errors.New("remote command failed: access denied"),
		},
	}
	_, err = testManager(context.Background(), transport).Detail(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: unitName})
	if err == nil || err.Error() != permissionMessage {
		t.Fatalf("permission err = %v", err)
	}
}

func TestManagerActionsUseRootDirectAndNonRootSudo(t *testing.T) {
	rootTransport := &fakeTransport{
		responses: map[string]string{
			idUserCommand: "0\n",
			systemctlActionCommand("start", "nginx.service", true): "",
		},
		errors: map[string]error{},
	}
	if _, err := testManager(context.Background(), rootTransport).Start(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"}); err != nil {
		t.Fatal(err)
	}
	if !rootTransport.saw(systemctlActionCommand("start", "nginx.service", true)) {
		t.Fatalf("root command not used: %s", rootTransport.commandLog())
	}

	sudoTransport := &fakeTransport{
		responses: map[string]string{
			idUserCommand: "1000\n",
			systemctlActionCommand("restart", "nginx.service", false): "",
		},
		errors: map[string]error{},
	}
	if _, err := testManager(context.Background(), sudoTransport).Restart(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"}); err != nil {
		t.Fatal(err)
	}
	if !sudoTransport.saw(systemctlActionCommand("restart", "nginx.service", false)) {
		t.Fatalf("sudo command not used: %s", sudoTransport.commandLog())
	}
}

func TestManagerActionsCoverEnableDisableStopCommands(t *testing.T) {
	for _, action := range []struct {
		name string
		run  func(*Manager, domain.Connection, domain.AuthRequest, domain.SystemServiceActionRequest) (domain.SystemServiceActionResponse, error)
	}{
		{name: "stop", run: (*Manager).Stop},
		{name: "enable", run: (*Manager).Enable},
		{name: "disable", run: (*Manager).Disable},
	} {
		t.Run(action.name, func(t *testing.T) {
			expected := systemctlActionCommand(action.name, "nginx.service", true)
			transport := &fakeTransport{
				responses: map[string]string{idUserCommand: "0\n", expected: ""},
				errors:    map[string]error{},
			}
			response, err := action.run(testManager(context.Background(), transport), testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"})
			if err != nil {
				t.Fatal(err)
			}
			if !response.Success || response.Action != action.name || !transport.saw(expected) {
				t.Fatalf("response=%+v commands=%s", response, transport.commandLog())
			}
		})
	}
}

func TestManagerActionPermissionErrorAndProtectedUnit(t *testing.T) {
	expected := systemctlActionCommand("stop", "nginx.service", false)
	transport := &fakeTransport{
		responses: map[string]string{idUserCommand: "1000\n"},
		errors:    map[string]error{expected: errors.New("remote command failed: sudo: a password is required")},
	}
	response, err := testManager(context.Background(), transport).Stop(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"})
	if err == nil || err.Error() != permissionMessage || response.Success {
		t.Fatalf("permission response=%+v err=%v", response, err)
	}

	response, err = testManager(context.Background(), transport).Stop(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "systemd.service"})
	if err == nil || response.Success {
		t.Fatalf("protected response=%+v err=%v", response, err)
	}
}

func TestManagerActionTimeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	expected := systemctlActionCommand("restart", "nginx.service", true)
	transport := &fakeTransport{
		responses: map[string]string{idUserCommand: "0\n"},
		errors:    map[string]error{},
		block:     map[string]bool{expected: true},
	}
	response, err := testManager(ctx, transport).Restart(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"})
	if err == nil || err.Error() != timeoutMessage || response.Success {
		t.Fatalf("timeout response=%+v err=%v", response, err)
	}
}

func TestStopServerCancelsOnlyTargetOperations(t *testing.T) {
	started := make(chan string, 4)
	targetTransport := &fakeTransport{
		responses: map[string]string{systemdCapabilityCommand: "systemd 252\n" + privilegeSeparator + "\nroot\n"},
		errors:    map[string]error{},
		block:     map[string]bool{systemdListCommand: true},
		started:   started,
	}
	otherTransport := &fakeTransport{
		responses: map[string]string{systemdCapabilityCommand: "systemd 252\n" + privilegeSeparator + "\nroot\n"},
		errors:    map[string]error{},
		block:     map[string]bool{systemdListCommand: true},
		started:   started,
	}
	manager := NewWithDialer(context.Background(), nil, func() time.Duration { return time.Second }, func(_ context.Context, connection domain.Connection, _ domain.AuthRequest, _ time.Duration) (Transport, time.Duration, error) {
		if connection.ID == 7 {
			return targetTransport, 0, nil
		}
		return otherTransport, 0, nil
	})
	done := make(chan error, 2)
	go func() {
		_, err := manager.List(testConnection(), domain.AuthRequest{})
		done <- err
	}()
	go func() {
		other := testConnection()
		other.ID = 8
		_, err := manager.List(other, domain.AuthRequest{})
		done <- err
	}()
	waitForStarted(t, started, 2)
	waitForOperationCount(t, manager, 7, 1)
	waitForOperationCount(t, manager, 8, 1)
	manager.StopServer(7)
	err := <-done
	if err == nil {
		t.Fatalf("target err = %v", err)
	}
	if manager.OperationCount(8) == 0 {
		t.Fatal("other server operation was canceled")
	}
	manager.StopServer(8)
	<-done
}

func TestCancelQueriesDoesNotCancelRunningAction(t *testing.T) {
	started := make(chan string, 4)
	expected := systemctlActionCommand("restart", "nginx.service", true)
	transport := &fakeTransport{
		responses: map[string]string{idUserCommand: "0\n"},
		errors:    map[string]error{},
		block:     map[string]bool{expected: true},
		started:   started,
	}
	manager := testManager(context.Background(), transport)
	done := make(chan error, 1)
	go func() {
		_, err := manager.Restart(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, UnitName: "nginx.service"})
		done <- err
	}()
	waitForStarted(t, started, 2)
	manager.CancelQueries(7)
	if manager.OperationCount(7) != 1 {
		t.Fatalf("action operation was canceled by query cancel")
	}
	manager.StopServer(7)
	<-done
}

func testManager(ctx context.Context, transport *fakeTransport) *Manager {
	if transport.responses == nil {
		transport.responses = map[string]string{}
	}
	if transport.errors == nil {
		transport.errors = map[string]error{}
	}
	if transport.block == nil {
		transport.block = map[string]bool{}
	}
	if _, hasResponse := transport.responses[systemdCapabilityCommand]; !hasResponse {
		if _, hasError := transport.errors[systemdCapabilityCommand]; !hasError {
			transport.responses[systemdCapabilityCommand] = "systemd 252\n" + privilegeSeparator + "\nroot\n"
		}
	}
	return NewWithDialer(ctx, nil, func() time.Duration { return time.Second }, func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
}

func testConnection() domain.Connection {
	return domain.Connection{
		ID:              7,
		Name:            "server",
		Host:            "192.0.2.7",
		Port:            22,
		Username:        "root",
		AuthType:        domain.AuthPassword,
		RefreshInterval: 2,
	}
}

func waitForStarted(t *testing.T, started <-chan string, count int) {
	t.Helper()
	for index := 0; index < count; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for command %d", index+1)
		}
	}
}

func waitForOperationCount(t *testing.T, manager *Manager, serverID int64, count int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if manager.OperationCount(serverID) == count {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for server %d operation count %d, got %d", serverID, count, manager.OperationCount(serverID))
}
