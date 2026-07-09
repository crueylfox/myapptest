package dockermanager

import (
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

type fakeTransport struct {
	mu        sync.Mutex
	commands  []string
	responses map[string]string
	errors    map[string]error
	session   *fakeSession
	closed    int
}

func (t *fakeTransport) Run(_ context.Context, command string) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.commands = append(t.commands, command)
	if err := t.errors[command]; err != nil {
		return "", err
	}
	return t.responses[command], nil
}

func (t *fakeTransport) StartCommand(_ context.Context, command string) (CommandSession, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.commands = append(t.commands, command)
	if err := t.errors[command]; err != nil {
		return nil, err
	}
	if t.session == nil {
		t.session = &fakeSession{stdout: strings.NewReader("")}
	}
	return t.session, nil
}

func (t *fakeTransport) Fingerprint() string {
	return ""
}

func (t *fakeTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed++
	return nil
}

func (t *fakeTransport) hasCommand(command string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, item := range t.commands {
		if item == command {
			return true
		}
	}
	return false
}

type fakeSession struct {
	stdout io.Reader
	wait   error
	closed bool
}

func (s *fakeSession) Stdout() io.Reader {
	return s.stdout
}

func (s *fakeSession) Wait() error {
	return s.wait
}

func (s *fakeSession) Close() error {
	s.closed = true
	return nil
}

type fakeEmitter struct {
	mu         sync.Mutex
	states     []domain.DockerStateEvent
	containers []domain.DockerContainersEvent
	logs       []domain.DockerLogEvent
	stats      []domain.DockerStatsEvent
	errors     []domain.DockerErrorEvent
}

func (e *fakeEmitter) State(event domain.DockerStateEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.states = append(e.states, event)
}

func (e *fakeEmitter) Containers(event domain.DockerContainersEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.containers = append(e.containers, event)
}

func (e *fakeEmitter) Log(event domain.DockerLogEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.logs = append(e.logs, event)
}

func (e *fakeEmitter) Stats(event domain.DockerStatsEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stats = append(e.stats, event)
}

func (e *fakeEmitter) Error(event domain.DockerErrorEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.errors = append(e.errors, event)
}

func TestCheckClassifiesDockerUnavailableAndPermission(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "not installed", err: errors.New("docker: command not found"), want: "服务器未检测到 Docker。"},
		{name: "permission", err: errors.New("permission denied while trying to connect to the Docker daemon socket"), want: "Docker Manager 使用独立 SSH 执行，不会继承终端中 su/root 状态。当前用户无权限访问 Docker，可使用 sudo 重试；若服务器需要 sudo 密码，请配置免密 sudo、加入 docker 组，或使用 root 凭据连接。"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			transport := &fakeTransport{
				responses: map[string]string{},
				errors:    map[string]error{dockerVersionCommand: tt.err},
			}
			manager := testManager(transport, nil)
			state, err := manager.Check(testConnection(), domain.AuthRequest{})
			if err == nil || err.Error() != tt.want {
				t.Fatalf("error = %v, want %q", err, tt.want)
			}
			if state.Available || state.Error != tt.want {
				t.Fatalf("state = %+v", state)
			}
		})
	}
}

func TestCheckPermissionExplainsIndependentSSHExecAndSudoRetry(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{},
		errors:    map[string]error{dockerVersionCommand: errors.New("permission denied while trying to connect to the Docker daemon socket")},
	}
	state, err := testManager(transport, nil).Check(testConnection(), domain.AuthRequest{})
	if err == nil {
		t.Fatal("expected permission error")
	}
	for _, text := range []string{
		"Docker Manager 使用独立 SSH 执行，不会继承终端中 su/root 状态。",
		"sudo 重试",
	} {
		if !strings.Contains(err.Error(), text) || !strings.Contains(state.Error, text) {
			t.Fatalf("permission message missing %q: error=%q state=%q", text, err.Error(), state.Error)
		}
	}
}

func TestCheckWithSudoUsesNonInteractiveDockerCommand(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{
			"sudo -n " + dockerVersionCommand: `{"Server":{"Version":"27.3.1"},"Client":{"Version":"27.3.1"}}`,
		},
		errors: map[string]error{},
	}
	state, err := testManager(transport, nil).CheckWithExecutionMode(testConnection(), domain.AuthRequest{}, domain.DockerExecutionSudo)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Available || state.Version != "27.3.1" {
		t.Fatalf("state = %+v", state)
	}
	if !transport.hasCommand("sudo -n " + dockerVersionCommand) {
		t.Fatalf("sudo command was not used: %v", transport.commands)
	}
}

func TestSudoPasswordRequiredShowsActionableDockerPermissionError(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{},
		errors:    map[string]error{"sudo -n " + dockerVersionCommand: errors.New("sudo: a password is required")},
	}
	_, err := testManager(transport, nil).CheckWithExecutionMode(testConnection(), domain.AuthRequest{}, domain.DockerExecutionSudo)
	if err == nil {
		t.Fatal("expected sudo password error")
	}
	for _, text := range []string{"sudo -n", "免密 sudo", "docker 组", "root 凭据"} {
		if !strings.Contains(err.Error(), text) {
			t.Fatalf("sudo password message missing %q: %q", text, err.Error())
		}
	}
}

func TestCheckSuccessParsesDockerVersion(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{dockerVersionCommand: `{"Server":{"Version":"27.3.1"},"Client":{"Version":"27.3.1"}}`},
		errors:    map[string]error{},
	}
	state, err := testManager(transport, nil).Check(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if !state.Available || state.Version != "27.3.1" {
		t.Fatalf("state = %+v", state)
	}
}

func TestListParsesDockerPSJSONLines(t *testing.T) {
	output := strings.Join([]string{
		`{"ID":"abc123456789","Image":"nginx:latest","Command":"\"nginx\"","CreatedAt":"2026-06-18 10:00:00 +0800 CST","Ports":"0.0.0.0:80->80/tcp","Status":"Up 2 hours","Names":"web","State":"running","Size":"0B"}`,
		`{"ID":"def987654321","Image":"redis:7","Status":"Exited (0) 1 hour ago","Names":"cache","State":"exited"}`,
	}, "\n")
	transport := &fakeTransport{responses: map[string]string{dockerListCommand: output}, errors: map[string]error{}}
	containers, err := testManager(transport, nil).List(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(containers) != 2 {
		t.Fatalf("containers len = %d", len(containers))
	}
	if containers[0].Name != "web" || containers[0].State != domain.DockerContainerRunning {
		t.Fatalf("first container = %+v", containers[0])
	}
	if containers[1].Name != "cache" || containers[1].State != domain.DockerContainerExited {
		t.Fatalf("second container = %+v", containers[1])
	}
}

func TestContainerOperationsUseValidatedQuotedCommands(t *testing.T) {
	for _, command := range []string{"start", "stop", "restart"} {
		t.Run(command, func(t *testing.T) {
			expected := "docker " + command + " 'abc123'"
			transport := &fakeTransport{responses: map[string]string{expected: "abc123\n"}, errors: map[string]error{}}
			manager := testManager(transport, nil)
			request := domain.DockerContainerRequest{ServerID: 7, ContainerID: "abc123"}
			var err error
			switch command {
			case "start":
				err = manager.StartContainer(testConnection(), domain.AuthRequest{}, request)
			case "stop":
				err = manager.StopContainer(testConnection(), domain.AuthRequest{}, request)
			case "restart":
				err = manager.RestartContainer(testConnection(), domain.AuthRequest{}, request)
			}
			if err != nil {
				t.Fatal(err)
			}
			if !transport.hasCommand(expected) {
				t.Fatalf("command %q was not run; commands = %v", expected, transport.commands)
			}
		})
	}
}

func TestRemoveContainerOnlyAllowsStoppedContainers(t *testing.T) {
	inspectRunning := `[{"Id":"abc123","Name":"/web","Config":{"Image":"nginx"},"State":{"Status":"running","Running":true}}]`
	transport := &fakeTransport{
		responses: map[string]string{"docker inspect 'abc123'": inspectRunning},
		errors:    map[string]error{},
	}
	err := testManager(transport, nil).RemoveContainer(testConnection(), domain.AuthRequest{}, domain.DockerContainerRequest{ServerID: 7, ContainerID: "abc123"})
	if err == nil || err.Error() != "该容器正在运行，请先停止后再删除。" {
		t.Fatalf("running remove error = %v", err)
	}
	if transport.hasCommand("docker rm 'abc123'") {
		t.Fatal("running container was removed")
	}

	inspectStopped := `[{"Id":"abc123","Name":"/web","Config":{"Image":"nginx"},"State":{"Status":"exited","ExitCode":0}}]`
	transport = &fakeTransport{
		responses: map[string]string{"docker inspect 'abc123'": inspectStopped, "docker rm 'abc123'": "abc123\n"},
		errors:    map[string]error{},
	}
	err = testManager(transport, nil).RemoveContainer(testConnection(), domain.AuthRequest{}, domain.DockerContainerRequest{ServerID: 7, ContainerID: "abc123"})
	if err != nil {
		t.Fatal(err)
	}
	if !transport.hasCommand("docker rm 'abc123'") {
		t.Fatal("stopped container was not removed")
	}
}

func TestBatchStartSkipsRunningAndStartsExited(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{
			"docker inspect 'abc123'": inspectContainer("abc123", "web", "running"),
			"docker inspect 'def456'": inspectContainer("def456", "cache", "exited"),
			"docker start 'def456'":   "def456\n",
		},
		errors: map[string]error{},
	}
	response, err := testManager(transport, nil).BatchStartContainers(testConnection(), domain.AuthRequest{}, domain.DockerBatchContainerRequest{
		ServerID:     7,
		ContainerIDs: []string{"abc123", "bad;id", "def456"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.SuccessCount != 1 || response.FailedCount != 1 || response.SkippedCount != 1 {
		t.Fatalf("response = %+v", response)
	}
	if response.Results[0].Status != batchStatusSkipped || response.Results[0].Reason == "" {
		t.Fatalf("running result = %+v", response.Results[0])
	}
	if response.Results[1].Error != "容器 ID 无效。" {
		t.Fatalf("invalid result = %+v", response.Results[1])
	}
	if !response.Results[2].Success || response.Results[2].Status != batchStatusSuccess {
		t.Fatalf("started result = %+v", response.Results[2])
	}
	if transport.hasCommand("docker start 'abc123'") {
		t.Fatal("running container was started")
	}
	if !transport.hasCommand("docker start 'def456'") {
		t.Fatal("exited container was not started")
	}
	for _, command := range transport.commands {
		if strings.Contains(command, "bad;id") {
			t.Fatalf("invalid container id was executed: %v", transport.commands)
		}
	}
}

func TestBatchStopSkipsStoppedAndContinuesAfterFailure(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{
			"docker inspect 'abc123'": inspectContainer("abc123", "web", "running"),
			"docker inspect 'def456'": inspectContainer("def456", "cache", "exited"),
			"docker inspect 'ghi789'": inspectContainer("ghi789", "worker", "restarting"),
			"docker stop 'abc123'":    "abc123\n",
		},
		errors: map[string]error{
			"docker stop 'ghi789'": errors.New("docker failed"),
		},
	}
	response, err := testManager(transport, nil).BatchStopContainers(testConnection(), domain.AuthRequest{}, domain.DockerBatchContainerRequest{
		ServerID:     7,
		ContainerIDs: []string{"abc123", "def456", "ghi789"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.SuccessCount != 1 || response.FailedCount != 1 || response.SkippedCount != 1 {
		t.Fatalf("response = %+v", response)
	}
	if response.Results[1].Status != batchStatusSkipped || response.Results[1].Reason == "" {
		t.Fatalf("stopped result = %+v", response.Results[1])
	}
	if response.Results[2].Error != "容器停止失败。" {
		t.Fatalf("failed result = %+v", response.Results[2])
	}
	if !transport.hasCommand("docker stop 'abc123'") || !transport.hasCommand("docker stop 'ghi789'") {
		t.Fatalf("commands = %v", transport.commands)
	}
	if transport.hasCommand("docker stop 'def456'") {
		t.Fatal("stopped container was stopped")
	}
}

func TestBatchRestartSkipsStoppedContainers(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{
			"docker inspect 'abc123'": inspectContainer("abc123", "web", "running"),
			"docker inspect 'def456'": inspectContainer("def456", "cache", "exited"),
			"docker restart 'abc123'": "abc123\n",
		},
		errors: map[string]error{},
	}
	response, err := testManager(transport, nil).BatchRestartContainers(testConnection(), domain.AuthRequest{}, domain.DockerBatchContainerRequest{
		ServerID:     7,
		ContainerIDs: []string{"abc123", "def456"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.SuccessCount != 1 || response.FailedCount != 0 || response.SkippedCount != 1 {
		t.Fatalf("response = %+v", response)
	}
	if !response.Results[0].Success || response.Results[1].Status != batchStatusSkipped {
		t.Fatalf("results = %+v", response.Results)
	}
	if transport.hasCommand("docker restart 'def456'") {
		t.Fatal("stopped container was restarted")
	}
}

func TestBatchRemoveOnlyRemovesStoppedContainers(t *testing.T) {
	inspectRunning := `[{"Id":"abc123","Name":"/web","Config":{"Image":"nginx"},"State":{"Status":"running","Running":true}}]`
	inspectStopped := `[{"Id":"def456","Name":"/cache","Config":{"Image":"redis"},"State":{"Status":"exited","ExitCode":0}}]`
	transport := &fakeTransport{
		responses: map[string]string{
			"docker inspect 'abc123'": inspectRunning,
			"docker inspect 'def456'": inspectStopped,
			"docker rm 'def456'":      "def456\n",
		},
		errors: map[string]error{},
	}
	response, err := testManager(transport, nil).BatchRemoveContainers(testConnection(), domain.AuthRequest{}, domain.DockerBatchContainerRequest{
		ServerID:     7,
		ContainerIDs: []string{"abc123", "bad;id", "def456"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.SuccessCount != 1 || response.FailedCount != 1 || response.SkippedCount != 1 {
		t.Fatalf("response = %+v", response)
	}
	if response.Results[0].Status != batchStatusSkipped || response.Results[0].Reason != "该容器正在运行，请先停止后再删除。" || response.Results[1].Error != "容器 ID 无效。" || !response.Results[2].Success {
		t.Fatalf("results = %+v", response.Results)
	}
	if transport.hasCommand("docker rm 'abc123'") {
		t.Fatal("running container was removed")
	}
	if transport.hasCommand("docker rm -f 'abc123'") || transport.hasCommand("docker rm -f 'def456'") {
		t.Fatal("force remove was used")
	}
	if !transport.hasCommand("docker rm 'def456'") {
		t.Fatal("stopped container was not removed")
	}
}

func TestLogsReturnContentWithoutLoggingIt(t *testing.T) {
	command := "docker logs --tail 200 'abc123' 2>&1"
	transport := &fakeTransport{responses: map[string]string{command: "secret log line\n"}, errors: map[string]error{}}
	output, err := testManager(transport, nil).Logs(testConnection(), domain.AuthRequest{}, domain.DockerLogsRequest{ServerID: 7, ContainerID: "abc123"})
	if err != nil {
		t.Fatal(err)
	}
	if output != "secret log line\n" {
		t.Fatalf("output = %q", output)
	}
}

func TestLogStreamEmitsLinesAndCanBeStopped(t *testing.T) {
	emitter := &fakeEmitter{}
	session := &fakeSession{stdout: strings.NewReader("one\ntwo\n")}
	transport := &fakeTransport{responses: map[string]string{}, errors: map[string]error{}, session: session}
	manager := testManager(transport, emitter)
	streamID, err := manager.StartLogStream(testConnection(), domain.AuthRequest{}, domain.DockerLogStreamRequest{
		ServerID: 7, ContainerID: "abc123", StreamID: "stream-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if streamID != "stream-1" {
		t.Fatalf("streamID = %q", streamID)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		emitter.mu.Lock()
		count := len(emitter.logs)
		emitter.mu.Unlock()
		if count == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	emitter.mu.Lock()
	defer emitter.mu.Unlock()
	if len(emitter.logs) != 2 || emitter.logs[0].Line != "one" || emitter.logs[1].Line != "two" {
		t.Fatalf("logs = %+v", emitter.logs)
	}
	manager.StopLogStream("stream-1")
}

func TestStatsParseDockerJSON(t *testing.T) {
	command := "docker stats --no-stream --format '{{json .}}' 'abc123'"
	transport := &fakeTransport{
		responses: map[string]string{command: `{"BlockIO":"1.5MB / 2MiB","CPUPerc":"12.34%","ID":"abc123","MemPerc":"5.50%","MemUsage":"10MiB / 1GiB","NetIO":"1.2kB / 3.4MB","PIDs":"8"}`},
		errors:    map[string]error{},
	}
	stats, err := testManager(transport, nil).Stats(testConnection(), domain.AuthRequest{}, domain.DockerContainerRequest{ServerID: 7, ContainerID: "abc123"})
	if err != nil {
		t.Fatal(err)
	}
	if stats.CPUPercent != 12.34 || stats.MemoryUsage != 10*1024*1024 || stats.MemoryLimit != 1024*1024*1024 {
		t.Fatalf("stats = %+v", stats)
	}
	if stats.NetInput != 1200 || stats.NetOutput != 3400000 || stats.BlockInput != 1500000 || stats.BlockOutput != 2*1024*1024 || stats.PIDs != 8 {
		t.Fatalf("stats io = %+v", stats)
	}
}

func TestComposeCheckPrefersPluginAndFallsBackToStandalone(t *testing.T) {
	t.Run("plugin", func(t *testing.T) {
		transport := &fakeTransport{
			responses: map[string]string{dockerComposePluginVersionCommand: "Docker Compose version v2.27.1\n"},
			errors:    map[string]error{},
		}
		capability, err := testManager(transport, nil).ComposeCheck(testConnection(), domain.AuthRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if !capability.Available || capability.Command != "docker compose" || capability.Version != "v2.27.1" {
			t.Fatalf("capability = %+v", capability)
		}
		if !transport.hasCommand(dockerComposePluginVersionCommand) || transport.hasCommand(dockerComposeStandaloneVersionCommand) {
			t.Fatalf("commands = %v", transport.commands)
		}
	})

	t.Run("standalone fallback", func(t *testing.T) {
		transport := &fakeTransport{
			responses: map[string]string{dockerComposeStandaloneVersionCommand: "docker-compose version 1.29.2, build 5becea4c\n"},
			errors: map[string]error{
				dockerComposePluginVersionCommand: errors.New("docker: 'compose' is not a docker command"),
			},
		}
		capability, err := testManager(transport, nil).ComposeCheck(testConnection(), domain.AuthRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if !capability.Available || capability.Command != "docker-compose" || capability.Version != "1.29.2" {
			t.Fatalf("capability = %+v", capability)
		}
		if !transport.hasCommand(dockerComposePluginVersionCommand) || !transport.hasCommand(dockerComposeStandaloneVersionCommand) {
			t.Fatalf("commands = %v", transport.commands)
		}
	})
}

func TestComposeCheckUnavailableWhenBothCommandsFail(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{},
		errors: map[string]error{
			dockerComposePluginVersionCommand:     errors.New("docker: 'compose' is not a docker command"),
			dockerComposeStandaloneVersionCommand: errors.New("docker-compose: command not found"),
		},
	}
	capability, err := testManager(transport, nil).ComposeCheck(testConnection(), domain.AuthRequest{})
	if err == nil {
		t.Fatal("expected unavailable error")
	}
	if capability.Available || capability.Command != "" || capability.Error == "" {
		t.Fatalf("capability = %+v", capability)
	}
}

func TestComposeListProjectsParsesJSON(t *testing.T) {
	output := `[{"Name":"edge","Status":"running(2)","ConfigFiles":"/srv/edge/compose.yml","WorkingDir":"/srv/edge"},{"Name":"ops","Status":"exited(1)","ConfigFiles":"/srv/ops/docker-compose.yml"}]`
	transport := &fakeTransport{
		responses: map[string]string{
			dockerComposePluginVersionCommand: "Docker Compose version v2.27.1\n",
			"docker compose ls --format json": output,
		},
		errors: map[string]error{},
	}
	projects, err := testManager(transport, nil).ComposeListProjects(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 || projects[0].Name != "edge" || projects[0].Status != "running(2)" || projects[0].WorkingDir != "/srv/edge" {
		t.Fatalf("projects = %+v", projects)
	}
}

func TestComposeServicesParsesPSJSON(t *testing.T) {
	output := `[{"ID":"abc123","Name":"edge-web-1","Project":"edge","Service":"web","Image":"nginx:alpine","State":"running","Status":"Up 2 minutes","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":8080,"Protocol":"tcp"}]},{"ID":"def456","Name":"edge-db-1","Project":"edge","Service":"db","Image":"postgres:16","State":"exited","Status":"Exit 0"}]`
	transport := &fakeTransport{
		responses: map[string]string{
			dockerComposePluginVersionCommand:           "Docker Compose version v2.27.1\n",
			"docker compose -p 'edge' ps --format json": output,
		},
		errors: map[string]error{},
	}
	response, err := testManager(transport, nil).ComposeServices(testConnection(), domain.AuthRequest{}, domain.DockerComposeProjectRequest{
		ServerID:    7,
		ProjectName: "edge",
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.ProjectName != "edge" || len(response.Services) != 2 {
		t.Fatalf("response = %+v", response)
	}
	if response.Services[0].Service != "web" || response.Services[0].Ports != "0.0.0.0:8080->80/tcp" {
		t.Fatalf("first service = %+v", response.Services[0])
	}
	if response.Services[1].State != "exited" {
		t.Fatalf("second service = %+v", response.Services[1])
	}
}

func TestComposeLogsSnapshotIsBounded(t *testing.T) {
	longOutput := strings.Repeat("compose synthetic log line\n", 9000)
	transport := &fakeTransport{
		responses: map[string]string{
			dockerComposePluginVersionCommand:                           "Docker Compose version v2.27.1\n",
			"docker compose -p 'edge' logs --no-color --tail 1000 2>&1": longOutput,
		},
		errors: map[string]error{},
	}
	snapshot, err := testManager(transport, nil).ComposeLogs(testConnection(), domain.AuthRequest{}, domain.DockerComposeLogsRequest{
		ServerID:    7,
		ProjectName: "edge",
		TailLines:   100000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Truncated || len(snapshot.Output) > maxComposeLogBytes {
		t.Fatalf("snapshot len=%d truncated=%v", len(snapshot.Output), snapshot.Truncated)
	}
	if !strings.Contains(snapshot.Output, "compose synthetic log line") {
		t.Fatalf("snapshot output lost log content")
	}
}

func TestComposeServiceDetailParsesSelectedService(t *testing.T) {
	output := `[{"ID":"abc123","Name":"edge-web-1","Project":"edge","Service":"web","Image":"nginx:alpine","State":"running","Status":"Up 2 minutes","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":8080,"Protocol":"tcp"}]}]`
	transport := &fakeTransport{
		responses: map[string]string{
			dockerComposePluginVersionCommand:                 "Docker Compose version v2.27.1\n",
			"docker compose -p 'edge' ps 'web' --format json": output,
		},
		errors: map[string]error{},
	}
	service, err := testManager(transport, nil).ComposeServiceDetail(testConnection(), domain.AuthRequest{}, domain.DockerComposeServiceDetailRequest{
		ServerID:    7,
		ProjectName: "edge",
		ServiceName: "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	if service.Service != "web" || service.Image != "nginx:alpine" || service.Ports != "0.0.0.0:8080->80/tcp" {
		t.Fatalf("service = %+v", service)
	}
}

func TestComposeLogsSnapshotSupportsServiceAndClampsTail(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{
			dockerComposePluginVersionCommand:                                 "Docker Compose version v2.27.1\n",
			"docker compose -p 'edge' logs --no-color --tail 1000 'web' 2>&1": "web synthetic compose log\n",
		},
		errors: map[string]error{},
	}
	snapshot, err := testManager(transport, nil).ComposeLogs(testConnection(), domain.AuthRequest{}, domain.DockerComposeLogsRequest{
		ServerID:    7,
		ProjectName: "edge",
		ServiceName: "web",
		TailLines:   5000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ServiceName != "web" || !strings.Contains(snapshot.Output, "synthetic compose log") {
		t.Fatalf("snapshot = %+v", snapshot)
	}
}

func TestComposeRejectsServiceNameInjection(t *testing.T) {
	transport := &fakeTransport{responses: map[string]string{}, errors: map[string]error{}}
	_, err := testManager(transport, nil).ComposeServiceDetail(testConnection(), domain.AuthRequest{}, domain.DockerComposeServiceDetailRequest{
		ServerID:    7,
		ProjectName: "edge",
		ServiceName: "web; docker compose down",
	})
	if err == nil || err.Error() != "Docker Compose service name is invalid." {
		t.Fatalf("error = %v", err)
	}
	if len(transport.commands) != 0 {
		t.Fatalf("commands were run: %v", transport.commands)
	}
}

func TestComposeReadOnlyCommandsDoNotContainDestructiveActions(t *testing.T) {
	output := `[{"ID":"abc123","Name":"edge-web-1","Project":"edge","Service":"web","Image":"nginx:alpine","State":"running","Status":"Up 2 minutes"}]`
	transport := &fakeTransport{
		responses: map[string]string{
			dockerComposePluginVersionCommand:                          "Docker Compose version v2.27.1\n",
			"docker compose ls --format json":                          `[{"Name":"edge","Status":"running(1)"}]`,
			"docker compose -p 'edge' ps --format json":                output,
			"docker compose -p 'edge' ps 'web' --format json":          output,
			"docker compose -p 'edge' logs --no-color --tail 200 2>&1": "project log\n",
		},
		errors: map[string]error{},
	}
	manager := testManager(transport, nil)
	_, _ = manager.ComposeListProjects(testConnection(), domain.AuthRequest{})
	_, _ = manager.ComposeServices(testConnection(), domain.AuthRequest{}, domain.DockerComposeProjectRequest{ServerID: 7, ProjectName: "edge"})
	_, _ = manager.ComposeServiceDetail(testConnection(), domain.AuthRequest{}, domain.DockerComposeServiceDetailRequest{ServerID: 7, ProjectName: "edge", ServiceName: "web"})
	_, _ = manager.ComposeLogs(testConnection(), domain.AuthRequest{}, domain.DockerComposeLogsRequest{ServerID: 7, ProjectName: "edge", TailLines: 200})

	for _, command := range transport.commands {
		for _, forbidden := range []string{" up", " down", " restart", " stop", " start", " rm", " remove", " build", " pull", " exec"} {
			if strings.Contains(command, " compose ") && strings.Contains(command, forbidden) {
				t.Fatalf("destructive compose command %q contains %q", command, forbidden)
			}
		}
	}
}

func TestComposeCommandErrorAndTimeoutAreClassified(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "timeout", err: context.DeadlineExceeded, want: "Docker Compose request timed out."},
		{name: "command error", err: errors.New("permission denied"), want: "permission denied"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			transport := &fakeTransport{
				responses: map[string]string{dockerComposePluginVersionCommand: "Docker Compose version v2.27.1\n"},
				errors:    map[string]error{"docker compose ls --format json": tt.err},
			}
			_, err := testManager(transport, nil).ComposeListProjects(testConnection(), domain.AuthRequest{})
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want contains %q", err, tt.want)
			}
		})
	}
}

func TestComposeRejectsProjectNameInjection(t *testing.T) {
	transport := &fakeTransport{responses: map[string]string{}, errors: map[string]error{}}
	_, err := testManager(transport, nil).ComposeServices(testConnection(), domain.AuthRequest{}, domain.DockerComposeProjectRequest{
		ServerID:    7,
		ProjectName: "edge; rm -rf /",
	})
	if err == nil || err.Error() != "Docker Compose project name is invalid." {
		t.Fatalf("error = %v", err)
	}
	if len(transport.commands) != 0 {
		t.Fatalf("commands were run: %v", transport.commands)
	}
}

func TestInspectSummaryDoesNotExposeEnvOrMountDetails(t *testing.T) {
	output := `[{
		"Id":"abc123",
		"Name":"/web",
		"Created":"2026-06-18T01:02:03Z",
		"Config":{"Image":"nginx:latest","Env":["SECRET=value"]},
		"State":{"Status":"running","Running":true},
		"HostConfig":{"RestartPolicy":{"Name":"unless-stopped","MaximumRetryCount":0}},
		"NetworkSettings":{"Ports":{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}]},"Networks":{"bridge":{}}},
		"Mounts":[{"Source":"/secret","Destination":"/data"}]
	}]`
	summary, err := parseInspectSummary(7, output)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Name != "web" || summary.Image != "nginx:latest" || summary.MountCount != 1 || summary.RestartPolicy != "unless-stopped" {
		t.Fatalf("summary = %+v", summary)
	}
	if strings.Contains(summary.Ports, "SECRET") || strings.Contains(summary.Ports, "/secret") {
		t.Fatalf("summary leaked sensitive detail: %+v", summary)
	}
}

func TestStatsWatcherAndStopServerClearOnlyTargetServer(t *testing.T) {
	manager := testManager(&fakeTransport{}, nil)
	manager.mu.Lock()
	manager.logStreams["log-a"] = &logStreamWorker{serverID: 1, streamID: "log-a", cancel: func() {}}
	manager.logStreams["log-b"] = &logStreamWorker{serverID: 2, streamID: "log-b", cancel: func() {}}
	manager.statsWatchers["stats-a"] = &statsWatchWorker{serverID: 1, watchID: "stats-a", cancel: func() {}}
	manager.statsWatchers["stats-b"] = &statsWatchWorker{serverID: 2, watchID: "stats-b", cancel: func() {}}
	manager.mu.Unlock()

	manager.StopServer(2)

	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.logStreams["log-b"] != nil || manager.statsWatchers["stats-b"] != nil {
		t.Fatal("target server watchers remain")
	}
	if manager.logStreams["log-a"] == nil || manager.statsWatchers["stats-a"] == nil {
		t.Fatal("other server watchers were removed")
	}
}

func TestRejectsContainerIDInjection(t *testing.T) {
	transport := &fakeTransport{responses: map[string]string{}, errors: map[string]error{}}
	err := testManager(transport, nil).StartContainer(testConnection(), domain.AuthRequest{}, domain.DockerContainerRequest{
		ServerID:    7,
		ContainerID: "abc123;rm -rf /",
	})
	if err == nil || err.Error() != "容器 ID 无效。" {
		t.Fatalf("error = %v", err)
	}
	if len(transport.commands) != 0 {
		t.Fatalf("commands were run: %v", transport.commands)
	}
}

func TestBackupPayloadHasNoDockerRuntimeData(t *testing.T) {
	payloadType := reflect.TypeOf(domain.BackupPayload{})
	for index := 0; index < payloadType.NumField(); index++ {
		name := strings.ToLower(payloadType.Field(index).Name)
		if strings.Contains(name, "docker") || strings.Contains(name, "container") {
			t.Fatalf("backup payload unexpectedly references docker runtime data: %s", payloadType.Field(index).Name)
		}
	}
}

func testManager(transport *fakeTransport, emitter Emitter) *Manager {
	return NewWithDialer(context.Background(), nil, emitter, func() time.Duration {
		return time.Second
	}, func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
}

func testConnection() domain.Connection {
	return domain.Connection{ID: 7, Host: "192.0.2.10", Port: 22, Username: "root"}
}

func inspectContainer(id, name, state string) string {
	return `[{"Id":"` + id + `","Name":"/` + name + `","Config":{"Image":"test"},"State":{"Status":"` + state + `"}}]`
}
