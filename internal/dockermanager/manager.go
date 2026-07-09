package dockermanager

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
	"hostdeck/internal/sshclient"
)

const (
	dockerVersionCommand                  = "docker version --format '{{json .}}'"
	dockerListCommand                     = "docker ps -a --format '{{json .}}'"
	dockerStatsFormat                     = "docker stats --no-stream --format '{{json .}}' %s"
	dockerComposePluginVersionCommand     = "docker compose version"
	dockerComposeStandaloneVersionCommand = "docker-compose version"
	maxComposeLogBytes                    = 128 * 1024
	batchStatusSuccess                    = "success"
	batchStatusFailed                     = "failed"
	batchStatusSkipped                    = "skipped"
)

type Transport interface {
	Run(context.Context, string) (string, error)
	StartCommand(context.Context, string) (CommandSession, error)
	Fingerprint() string
	Close() error
}

type CommandSession interface {
	Stdout() io.Reader
	Wait() error
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
	State(domain.DockerStateEvent)
	Containers(domain.DockerContainersEvent)
	Log(domain.DockerLogEvent)
	Stats(domain.DockerStatsEvent)
	Error(domain.DockerErrorEvent)
}

type realTransport struct {
	client *sshclient.Client
}

func (t realTransport) Run(ctx context.Context, command string) (string, error) {
	return t.client.Run(ctx, command)
}

func (t realTransport) StartCommand(ctx context.Context, command string) (CommandSession, error) {
	return t.client.StartCommand(ctx, command)
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

	mu               sync.Mutex
	logStreams       map[string]*logStreamWorker
	statsWatchers    map[string]*statsWatchWorker
	serverGeneration map[int64]int64
}

type logStreamWorker struct {
	serverID    int64
	containerID string
	streamID    string
	generation  int64
	cancel      context.CancelFunc
	session     CommandSession
	transport   Transport
}

type statsWatchWorker struct {
	serverID    int64
	containerID string
	watchID     string
	generation  int64
	cancel      context.CancelFunc
	transport   Transport
	mode        domain.DockerExecutionMode
}

type dockerVersionOutput struct {
	Server struct {
		Version string `json:"Version"`
	} `json:"Server"`
	Client struct {
		Version string `json:"Version"`
	} `json:"Client"`
}

type dockerPSLine struct {
	ID           string `json:"ID"`
	Image        string `json:"Image"`
	Command      string `json:"Command"`
	CreatedAt    string `json:"CreatedAt"`
	RunningFor   string `json:"RunningFor"`
	Ports        string `json:"Ports"`
	Status       string `json:"Status"`
	Size         string `json:"Size"`
	Names        string `json:"Names"`
	Labels       string `json:"Labels"`
	LocalVolumes string `json:"LocalVolumes"`
	Mounts       string `json:"Mounts"`
	Networks     string `json:"Networks"`
	State        string `json:"State"`
}

type dockerStatsLine struct {
	BlockIO   string `json:"BlockIO"`
	CPUPerc   string `json:"CPUPerc"`
	Container string `json:"Container"`
	ID        string `json:"ID"`
	MemPerc   string `json:"MemPerc"`
	MemUsage  string `json:"MemUsage"`
	Name      string `json:"Name"`
	NetIO     string `json:"NetIO"`
	PIDs      string `json:"PIDs"`
}

type dockerComposeProjectLine struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
	WorkingDir  string `json:"WorkingDir"`
}

type dockerComposePSLine struct {
	ID         string                   `json:"ID"`
	Name       string                   `json:"Name"`
	Project    string                   `json:"Project"`
	Service    string                   `json:"Service"`
	Image      string                   `json:"Image"`
	Command    string                   `json:"Command"`
	State      string                   `json:"State"`
	Status     string                   `json:"Status"`
	Health     string                   `json:"Health"`
	ExitCode   int                      `json:"ExitCode"`
	Publishers []dockerComposePublisher `json:"Publishers"`
}

type dockerComposePublisher struct {
	URL           string `json:"URL"`
	TargetPort    int    `json:"TargetPort"`
	PublishedPort int    `json:"PublishedPort"`
	Protocol      string `json:"Protocol"`
}

type dockerInspectContainer struct {
	ID      string `json:"Id"`
	Name    string `json:"Name"`
	Image   string `json:"Image"`
	Created string `json:"Created"`
	State   struct {
		Status   string `json:"Status"`
		Running  bool   `json:"Running"`
		ExitCode int    `json:"ExitCode"`
		Error    string `json:"Error"`
	} `json:"State"`
	Config struct {
		Image string `json:"Image"`
	} `json:"Config"`
	HostConfig struct {
		RestartPolicy struct {
			Name              string `json:"Name"`
			MaximumRetryCount int    `json:"MaximumRetryCount"`
		} `json:"RestartPolicy"`
	} `json:"HostConfig"`
	NetworkSettings struct {
		Ports    map[string][]dockerInspectPortBinding `json:"Ports"`
		Networks map[string]json.RawMessage            `json:"Networks"`
	} `json:"NetworkSettings"`
	Mounts []struct{} `json:"Mounts"`
}

type dockerInspectPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

var (
	safeContainerIDPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	safeComposeProjectPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
	safeComposeServicePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	byteValuePattern           = regexp.MustCompile(`^\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)?\s*$`)
	composeVersionValuePattern = regexp.MustCompile(`(?i)(?:docker[- ]compose\s+version\s*)?(v?[0-9]+(?:\.[0-9]+)+(?:[-+][A-Za-z0-9_.-]+)?)`)
)

func New(ctx context.Context, logger *logging.Logger, emitter Emitter, timeout TimeoutProvider) *Manager {
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
		ctx:              ctx,
		logger:           logger,
		emitter:          emitter,
		timeout:          timeout,
		dial:             dial,
		logStreams:       make(map[string]*logStreamWorker),
		statsWatchers:    make(map[string]*statsWatchWorker),
		serverGeneration: make(map[int64]int64),
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

func (m *Manager) Check(connection domain.Connection, auth domain.AuthRequest) (domain.DockerAvailability, error) {
	return m.CheckWithExecutionMode(connection, auth, domain.DockerExecutionCurrentUser)
}

func (m *Manager) CheckWithExecutionMode(
	connection domain.Connection,
	auth domain.AuthRequest,
	mode domain.DockerExecutionMode,
) (domain.DockerAvailability, error) {
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		message := classifyError(err)
		state := dockerUnavailable(connection.ID, message)
		m.emitState(state)
		return state, errors.New(message)
	}
	defer transport.Close()
	state, err := m.checkWithTransport(ctx, connection.ID, transport, mode)
	m.emitState(state)
	return state, err
}

func (m *Manager) List(connection domain.Connection, auth domain.AuthRequest) ([]domain.DockerContainer, error) {
	return m.ListWithExecutionMode(connection, auth, domain.DockerExecutionCurrentUser)
}

func (m *Manager) ListWithExecutionMode(
	connection domain.Connection,
	auth domain.AuthRequest,
	mode domain.DockerExecutionMode,
) ([]domain.DockerContainer, error) {
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		message := classifyError(err)
		m.emitError(connection.ID, "", "", "DOCKER_CONNECT_FAILED", message)
		return nil, errors.New(message)
	}
	defer transport.Close()
	containers, err := m.listWithTransport(ctx, connection.ID, transport, mode)
	if err != nil {
		message := classifyError(err)
		m.emitError(connection.ID, "", "", "DOCKER_LIST_FAILED", message)
		return nil, errors.New(message)
	}
	m.emitContainers(connection.ID, containers)
	m.emitState(domain.DockerAvailability{
		ServerID:      connection.ID,
		Available:     true,
		LastRefreshAt: timestamp(),
		Containers:    containers,
	})
	return containers, nil
}

func (m *Manager) StartContainer(connection domain.Connection, auth domain.AuthRequest, request domain.DockerContainerRequest) error {
	return m.runContainerCommand(connection, auth, request, "start", "容器启动失败。")
}

func (m *Manager) StopContainer(connection domain.Connection, auth domain.AuthRequest, request domain.DockerContainerRequest) error {
	return m.runContainerCommand(connection, auth, request, "stop", "容器停止失败。")
}

func (m *Manager) RestartContainer(connection domain.Connection, auth domain.AuthRequest, request domain.DockerContainerRequest) error {
	return m.runContainerCommand(connection, auth, request, "restart", "容器重启失败。")
}

func (m *Manager) RemoveContainer(connection domain.Connection, auth domain.AuthRequest, request domain.DockerContainerRequest) error {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return errors.New(classifyError(err))
	}
	defer transport.Close()
	mode := requestExecutionMode(request.ExecutionMode)
	summary, err := m.inspectWithTransport(ctx, connection.ID, transport, containerID, mode)
	if err != nil {
		return err
	}
	if summary.State == domain.DockerContainerRunning ||
		summary.State == domain.DockerContainerPaused ||
		summary.State == domain.DockerContainerRestarting {
		return errors.New("该容器正在运行，请先停止后再删除。")
	}
	if _, err := transport.Run(ctx, dockerCommand(mode, "rm "+shellQuote(containerID))); err != nil {
		return errors.New("删除容器失败。")
	}
	m.log("info", "Docker 容器已删除", "docker.remove", connection.ID, containerID, nil)
	return nil
}

func (m *Manager) BatchStartContainers(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	return m.batchContainerCommand(connection, auth, request, "start", "容器启动失败。", canBatchStartContainer, "容器已经在运行，已跳过。")
}

func (m *Manager) BatchStopContainers(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	return m.batchContainerCommand(connection, auth, request, "stop", "容器停止失败。", canBatchStopContainer, "容器已经停止，已跳过。")
}

func (m *Manager) BatchRestartContainers(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	return m.batchContainerCommand(connection, auth, request, "restart", "容器重启失败。", canBatchRestartContainer, "容器不是运行中，已跳过。")
}

func (m *Manager) BatchRemoveContainers(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	response, validIDs := prepareBatchResponse(request)
	if len(validIDs) == 0 {
		return finalizeBatchResponse(response), nil
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return finalizeBatchResponse(markBatchFailed(response, classifyError(err))), nil
	}
	defer transport.Close()
	for _, containerID := range validIDs {
		mode := requestExecutionMode(request.ExecutionMode)
		summary, err := m.inspectWithTransport(ctx, connection.ID, transport, containerID, mode)
		if err != nil {
			setBatchResult(&response, containerID, "remove", "", batchStatusFailed, false, err.Error(), err.Error())
			continue
		}
		name := firstNonEmpty(summary.Name, containerID)
		if summary.State == domain.DockerContainerRunning ||
			summary.State == domain.DockerContainerPaused ||
			summary.State == domain.DockerContainerRestarting {
			setBatchResult(&response, containerID, "remove", name, batchStatusSkipped, false, "", "该容器正在运行，请先停止后再删除。")
			continue
		}
		if _, err := transport.Run(ctx, dockerCommand(mode, "rm "+shellQuote(containerID))); err != nil {
			setBatchResult(&response, containerID, "remove", name, batchStatusFailed, false, "删除容器失败。", "删除容器失败。")
			continue
		}
		setBatchResult(&response, containerID, "remove", name, batchStatusSuccess, true, "", "")
		m.log("info", "Docker 容器已删除", "docker.batch.remove", connection.ID, containerID, nil)
	}
	return finalizeBatchResponse(response), nil
}

func (m *Manager) Logs(connection domain.Connection, auth domain.AuthRequest, request domain.DockerLogsRequest) (string, error) {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return "", errors.New(classifyError(err))
	}
	defer transport.Close()
	output, err := transport.Run(ctx, dockerCommand(requestExecutionMode(request.ExecutionMode), fmt.Sprintf(
		"logs --tail %d %s 2>&1",
		normalizeTailLines(request.TailLines),
		shellQuote(containerID),
	)))
	if err != nil {
		return "", errors.New("读取容器日志失败。")
	}
	return output, nil
}

func (m *Manager) ComposeCheck(connection domain.Connection, auth domain.AuthRequest) (domain.DockerComposeCapability, error) {
	return m.ComposeCheckWithExecutionMode(connection, auth, domain.DockerExecutionCurrentUser)
}

func (m *Manager) ComposeCheckWithExecutionMode(
	connection domain.Connection,
	auth domain.AuthRequest,
	mode domain.DockerExecutionMode,
) (domain.DockerComposeCapability, error) {
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		message := classifyError(err)
		return composeUnavailable(connection.ID, message), errors.New(message)
	}
	defer transport.Close()
	return m.composeCheckWithTransport(ctx, connection.ID, transport, mode)
}

func (m *Manager) ComposeListProjects(
	connection domain.Connection,
	auth domain.AuthRequest,
) ([]domain.DockerComposeProject, error) {
	return m.ComposeListProjectsWithExecutionMode(connection, auth, domain.DockerExecutionCurrentUser)
}

func (m *Manager) ComposeListProjectsWithExecutionMode(
	connection domain.Connection,
	auth domain.AuthRequest,
	mode domain.DockerExecutionMode,
) ([]domain.DockerComposeProject, error) {
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return nil, errors.New(classifyError(err))
	}
	defer transport.Close()
	_, command, err := m.composeCommandWithTransport(ctx, connection.ID, transport, mode)
	if err != nil {
		return nil, err
	}
	output, err := transport.Run(ctx, command+" ls --format json")
	if err != nil {
		return nil, composeCommandError(err)
	}
	projects, err := parseDockerComposeProjects(connection.ID, output)
	if err != nil {
		return nil, errors.New("Failed to parse Docker Compose projects.")
	}
	return projects, nil
}

func (m *Manager) ComposeServices(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerComposeProjectRequest,
) (domain.DockerComposeServicesResponse, error) {
	projectName, err := validateComposeProjectName(request.ProjectName)
	if err != nil {
		return domain.DockerComposeServicesResponse{}, err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return domain.DockerComposeServicesResponse{}, errors.New(classifyError(err))
	}
	defer transport.Close()
	mode := requestExecutionMode(request.ExecutionMode)
	_, command, err := m.composeCommandWithTransport(ctx, connection.ID, transport, mode)
	if err != nil {
		return domain.DockerComposeServicesResponse{}, err
	}
	output, err := transport.Run(ctx, command+" -p "+shellQuote(projectName)+" ps --format json")
	if err != nil {
		return domain.DockerComposeServicesResponse{}, composeCommandError(err)
	}
	services, err := parseDockerComposeServices(connection.ID, output)
	if err != nil {
		return domain.DockerComposeServicesResponse{}, errors.New("Failed to parse Docker Compose services.")
	}
	return domain.DockerComposeServicesResponse{
		ServerID:    connection.ID,
		ProjectName: projectName,
		Services:    services,
		Timestamp:   timestamp(),
	}, nil
}

func (m *Manager) ComposeLogs(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerComposeLogsRequest,
) (domain.DockerComposeLogsSnapshot, error) {
	projectName, err := validateComposeProjectName(request.ProjectName)
	if err != nil {
		return domain.DockerComposeLogsSnapshot{}, err
	}
	serviceName := strings.TrimSpace(request.ServiceName)
	if serviceName != "" {
		serviceName, err = validateComposeServiceName(serviceName)
		if err != nil {
			return domain.DockerComposeLogsSnapshot{}, err
		}
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return domain.DockerComposeLogsSnapshot{}, errors.New(classifyError(err))
	}
	defer transport.Close()
	mode := requestExecutionMode(request.ExecutionMode)
	_, command, err := m.composeCommandWithTransport(ctx, connection.ID, transport, mode)
	if err != nil {
		return domain.DockerComposeLogsSnapshot{}, err
	}
	logCommand := fmt.Sprintf(
		"%s -p %s logs --no-color --tail %d",
		command,
		shellQuote(projectName),
		normalizeComposeTailLines(request.TailLines),
	)
	if serviceName != "" {
		logCommand += " " + shellQuote(serviceName)
	}
	logCommand += " 2>&1"
	output, err := transport.Run(ctx, logCommand)
	if err != nil {
		return domain.DockerComposeLogsSnapshot{}, composeCommandError(err)
	}
	output, truncated := boundComposeLogOutput(output)
	return domain.DockerComposeLogsSnapshot{
		ServerID:    connection.ID,
		ProjectName: projectName,
		ServiceName: serviceName,
		Output:      output,
		Truncated:   truncated,
		Timestamp:   timestamp(),
	}, nil
}

func (m *Manager) ComposeServiceDetail(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerComposeServiceDetailRequest,
) (domain.DockerComposeService, error) {
	projectName, err := validateComposeProjectName(request.ProjectName)
	if err != nil {
		return domain.DockerComposeService{}, err
	}
	serviceName, err := validateComposeServiceName(request.ServiceName)
	if err != nil {
		return domain.DockerComposeService{}, err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return domain.DockerComposeService{}, errors.New(classifyError(err))
	}
	defer transport.Close()
	mode := requestExecutionMode(request.ExecutionMode)
	_, command, err := m.composeCommandWithTransport(ctx, connection.ID, transport, mode)
	if err != nil {
		return domain.DockerComposeService{}, err
	}
	output, err := transport.Run(ctx, command+" -p "+shellQuote(projectName)+" ps "+shellQuote(serviceName)+" --format json")
	if err != nil {
		return domain.DockerComposeService{}, composeCommandError(err)
	}
	services, err := parseDockerComposeServices(connection.ID, output)
	if err != nil {
		return domain.DockerComposeService{}, errors.New("Failed to parse Docker Compose service detail.")
	}
	if len(services) == 0 {
		return domain.DockerComposeService{}, errors.New("Docker Compose service was not found.")
	}
	return services[0], nil
}

func (m *Manager) StartLogStream(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerLogStreamRequest,
) (string, error) {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return "", err
	}
	streamID := strings.TrimSpace(request.StreamID)
	if streamID == "" {
		streamID = newID("docker-log")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		cancel()
		return "", errors.New(classifyError(err))
	}
	session, err := transport.StartCommand(ctx, dockerCommand(requestExecutionMode(request.ExecutionMode), fmt.Sprintf(
		"logs -f --tail %d %s 2>&1",
		normalizeTailLines(request.TailLines),
		shellQuote(containerID),
	)))
	if err != nil {
		_ = transport.Close()
		cancel()
		return "", errors.New("读取容器日志失败。")
	}
	worker := &logStreamWorker{
		serverID:    connection.ID,
		containerID: containerID,
		streamID:    streamID,
		generation:  m.generation(connection.ID),
		cancel:      cancel,
		session:     session,
		transport:   transport,
	}
	m.mu.Lock()
	if existing := m.logStreams[streamID]; existing != nil {
		m.stopLogStreamLocked(existing)
	}
	m.logStreams[streamID] = worker
	m.mu.Unlock()
	go m.runLogStream(worker)
	return streamID, nil
}

func (m *Manager) StopLogStream(streamID string) {
	m.mu.Lock()
	worker := m.logStreams[streamID]
	if worker != nil {
		delete(m.logStreams, streamID)
		m.stopLogStreamLocked(worker)
	}
	m.mu.Unlock()
}

func (m *Manager) InspectSummary(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerContainerRequest,
) (domain.DockerInspectSummary, error) {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return domain.DockerInspectSummary{}, err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return domain.DockerInspectSummary{}, errors.New(classifyError(err))
	}
	defer transport.Close()
	return m.inspectWithTransport(ctx, connection.ID, transport, containerID, requestExecutionMode(request.ExecutionMode))
}

func (m *Manager) Stats(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerContainerRequest,
) (domain.DockerContainerStats, error) {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return domain.DockerContainerStats{}, err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return domain.DockerContainerStats{}, errors.New(classifyError(err))
	}
	defer transport.Close()
	return m.statsWithTransport(ctx, connection.ID, transport, containerID, requestExecutionMode(request.ExecutionMode))
}

func (m *Manager) StartStatsWatch(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerStatsWatchRequest,
) (string, error) {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return "", err
	}
	watchID := strings.TrimSpace(request.WatchID)
	if watchID == "" {
		watchID = newID("docker-stats")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		cancel()
		return "", errors.New(classifyError(err))
	}
	worker := &statsWatchWorker{
		serverID:    connection.ID,
		containerID: containerID,
		watchID:     watchID,
		generation:  m.generation(connection.ID),
		cancel:      cancel,
		transport:   transport,
	}
	worker.mode = requestExecutionMode(request.ExecutionMode)
	m.mu.Lock()
	if existing := m.statsWatchers[watchID]; existing != nil {
		m.stopStatsWatcherLocked(existing)
	}
	m.statsWatchers[watchID] = worker
	m.mu.Unlock()
	interval := time.Duration(request.IntervalMs) * time.Millisecond
	if interval < time.Second {
		interval = time.Second
	}
	if interval > 2*time.Second {
		interval = 2 * time.Second
	}
	go m.runStatsWatch(ctx, worker, interval)
	return watchID, nil
}

func (m *Manager) StopStatsWatch(watchID string) {
	m.mu.Lock()
	worker := m.statsWatchers[watchID]
	if worker != nil {
		delete(m.statsWatchers, watchID)
		m.stopStatsWatcherLocked(worker)
	}
	m.mu.Unlock()
}

func (m *Manager) StopServer(serverID int64) {
	m.mu.Lock()
	m.serverGeneration[serverID]++
	for id, worker := range m.logStreams {
		if worker.serverID == serverID {
			delete(m.logStreams, id)
			m.stopLogStreamLocked(worker)
		}
	}
	for id, worker := range m.statsWatchers {
		if worker.serverID == serverID {
			delete(m.statsWatchers, id)
			m.stopStatsWatcherLocked(worker)
		}
	}
	m.mu.Unlock()
	m.emitState(domain.DockerAvailability{
		ServerID:      serverID,
		Available:     false,
		LastRefreshAt: timestamp(),
		Containers:    nil,
	})
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	for id, worker := range m.logStreams {
		delete(m.logStreams, id)
		m.stopLogStreamLocked(worker)
	}
	for id, worker := range m.statsWatchers {
		delete(m.statsWatchers, id)
		m.stopStatsWatcherLocked(worker)
	}
	m.mu.Unlock()
}

func (m *Manager) checkWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	mode domain.DockerExecutionMode,
) (domain.DockerAvailability, error) {
	output, err := transport.Run(ctx, commandWithSudo(mode, dockerVersionCommand))
	if err != nil {
		message := classifyError(err)
		return dockerUnavailable(serverID, message), errors.New(message)
	}
	version := parseDockerVersion(output)
	return domain.DockerAvailability{
		ServerID:      serverID,
		Available:     true,
		Version:       version,
		LastRefreshAt: timestamp(),
		Containers:    []domain.DockerContainer{},
	}, nil
}

func (m *Manager) listWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	mode domain.DockerExecutionMode,
) ([]domain.DockerContainer, error) {
	output, err := transport.Run(ctx, commandWithSudo(mode, dockerListCommand))
	if err != nil {
		return nil, err
	}
	containers, err := parseDockerContainers(serverID, output)
	if err != nil {
		return nil, errors.New("解析 Docker 容器列表失败。")
	}
	return containers, nil
}

func (m *Manager) inspectWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	containerID string,
	mode domain.DockerExecutionMode,
) (domain.DockerInspectSummary, error) {
	output, err := transport.Run(ctx, dockerCommand(mode, "inspect "+shellQuote(containerID)))
	if err != nil {
		return domain.DockerInspectSummary{}, errors.New(classifyError(err))
	}
	summary, err := parseInspectSummary(serverID, output)
	if err != nil {
		return domain.DockerInspectSummary{}, errors.New("解析容器信息失败。")
	}
	if summary.ID == "" {
		return domain.DockerInspectSummary{}, errors.New("容器不存在或已被删除。")
	}
	return summary, nil
}

func (m *Manager) statsWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	containerID string,
	mode domain.DockerExecutionMode,
) (domain.DockerContainerStats, error) {
	output, err := transport.Run(ctx, commandWithSudo(mode, fmt.Sprintf(dockerStatsFormat, shellQuote(containerID))))
	if err != nil {
		return domain.DockerContainerStats{}, errors.New(classifyError(err))
	}
	stats, err := parseStats(serverID, containerID, output)
	if err != nil {
		return domain.DockerContainerStats{}, errors.New("读取容器资源占用失败。")
	}
	return stats, nil
}

func (m *Manager) composeCommandWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	mode domain.DockerExecutionMode,
) (domain.DockerComposeCapability, string, error) {
	capability, err := m.composeCheckWithTransport(ctx, serverID, transport, mode)
	if err != nil {
		return capability, "", err
	}
	return capability, commandWithSudo(mode, capability.Command), nil
}

func (m *Manager) composeCheckWithTransport(
	ctx context.Context,
	serverID int64,
	transport Transport,
	mode domain.DockerExecutionMode,
) (domain.DockerComposeCapability, error) {
	output, pluginErr := transport.Run(ctx, commandWithSudo(mode, dockerComposePluginVersionCommand))
	if pluginErr == nil {
		return domain.DockerComposeCapability{
			ServerID:      serverID,
			Available:     true,
			Command:       "docker compose",
			Version:       parseDockerComposeVersion(output),
			LastRefreshAt: timestamp(),
		}, nil
	}
	output, standaloneErr := transport.Run(ctx, commandWithSudo(mode, dockerComposeStandaloneVersionCommand))
	if standaloneErr == nil {
		return domain.DockerComposeCapability{
			ServerID:      serverID,
			Available:     true,
			Command:       "docker-compose",
			Version:       parseDockerComposeVersion(output),
			LastRefreshAt: timestamp(),
		}, nil
	}
	message := classifyComposeUnavailable(pluginErr, standaloneErr)
	return composeUnavailable(serverID, message), errors.New(message)
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
		m.logger.WriteConnection("error", "服务器已连接，但主机指纹记录更新失败", "docker.hostkey", connection, nil)
	}
}

func (m *Manager) startKeepalive(ctx context.Context, transport Transport, serverID int64) {
	starter, ok := transport.(keepaliveStarter)
	if !ok {
		return
	}
	starter.StartKeepalive(ctx, m.keepalivePolicy(), sshclient.KeepaliveMetadata{
		ServerID:  serverID,
		Subsystem: "docker",
	}, func(failure sshclient.KeepaliveFailure) {
		if m.logger != nil {
			m.logger.Write(
				"warn",
				fmt.Sprintf("SSH keepalive failed subsystem=docker failures=%d", failure.FailureCount),
				"ssh.keepalive",
				serverID,
				sshclient.ErrKeepaliveFailed,
			)
		}
	})
}

func (m *Manager) runContainerCommand(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerContainerRequest,
	command string,
	fallback string,
) error {
	containerID, err := validateContainerID(request.ContainerID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return errors.New(classifyError(err))
	}
	defer transport.Close()
	if _, err := transport.Run(ctx, dockerCommand(requestExecutionMode(request.ExecutionMode), command+" "+shellQuote(containerID))); err != nil {
		return errors.New(fallback)
	}
	m.log("info", "Docker 容器操作完成", "docker."+command, connection.ID, containerID, nil)
	return nil
}

func (m *Manager) batchContainerCommand(
	connection domain.Connection,
	auth domain.AuthRequest,
	request domain.DockerBatchContainerRequest,
	command string,
	fallback string,
	eligible func(domain.DockerContainerState) bool,
	skipReason string,
) (domain.DockerBatchContainerResponse, error) {
	response, validIDs := prepareBatchResponse(request)
	if len(validIDs) == 0 {
		return finalizeBatchResponse(response), nil
	}
	ctx, cancel := context.WithTimeout(m.ctx, m.timeout())
	defer cancel()
	transport, err := m.open(ctx, connection, auth)
	if err != nil {
		return finalizeBatchResponse(markBatchFailed(response, classifyError(err))), nil
	}
	defer transport.Close()
	mode := requestExecutionMode(request.ExecutionMode)
	for _, containerID := range validIDs {
		summary, err := m.inspectWithTransport(ctx, connection.ID, transport, containerID, mode)
		if err != nil {
			setBatchResult(&response, containerID, command, "", batchStatusFailed, false, err.Error(), err.Error())
			continue
		}
		name := firstNonEmpty(summary.Name, containerID)
		if !eligible(summary.State) {
			setBatchResult(&response, containerID, command, name, batchStatusSkipped, false, "", skipReason)
			continue
		}
		if _, err := transport.Run(ctx, dockerCommand(mode, command+" "+shellQuote(containerID))); err != nil {
			setBatchResult(&response, containerID, command, name, batchStatusFailed, false, fallback, fallback)
			continue
		}
		setBatchResult(&response, containerID, command, name, batchStatusSuccess, true, "", "")
		m.log("info", "Docker 容器操作完成", "docker.batch."+command, connection.ID, containerID, nil)
	}
	return finalizeBatchResponse(response), nil
}

func prepareBatchResponse(request domain.DockerBatchContainerRequest) (domain.DockerBatchContainerResponse, []string) {
	response := domain.DockerBatchContainerResponse{
		ServerID: request.ServerID,
		Results:  make([]domain.DockerBatchContainerResult, 0, len(request.ContainerIDs)),
	}
	validIDs := make([]string, 0, len(request.ContainerIDs))
	seen := make(map[string]struct{}, len(request.ContainerIDs))
	for _, rawID := range request.ContainerIDs {
		containerID, err := validateContainerID(rawID)
		if err != nil {
			response.Results = append(response.Results, domain.DockerBatchContainerResult{
				ContainerID: strings.TrimSpace(rawID),
				Status:      batchStatusFailed,
				Success:     false,
				Error:       err.Error(),
				Reason:      err.Error(),
			})
			continue
		}
		if _, exists := seen[containerID]; exists {
			continue
		}
		seen[containerID] = struct{}{}
		validIDs = append(validIDs, containerID)
		response.Results = append(response.Results, domain.DockerBatchContainerResult{ContainerID: containerID})
	}
	return response, validIDs
}

func markBatchFailed(
	response domain.DockerBatchContainerResponse,
	message string,
) domain.DockerBatchContainerResponse {
	for index := range response.Results {
		if response.Results[index].Success || response.Results[index].Error != "" {
			continue
		}
		response.Results[index].Status = batchStatusFailed
		response.Results[index].Error = message
		response.Results[index].Reason = message
	}
	return response
}

func setBatchResult(
	response *domain.DockerBatchContainerResponse,
	containerID string,
	action string,
	name string,
	status string,
	success bool,
	errMessage string,
	reason string,
) {
	for index := range response.Results {
		if response.Results[index].ContainerID != containerID {
			continue
		}
		response.Results[index].Action = action
		response.Results[index].Name = name
		response.Results[index].Status = status
		response.Results[index].Success = success
		response.Results[index].Error = errMessage
		response.Results[index].Reason = reason
		return
	}
}

func finalizeBatchResponse(response domain.DockerBatchContainerResponse) domain.DockerBatchContainerResponse {
	response.SuccessCount = 0
	response.FailedCount = 0
	response.SkippedCount = 0
	for _, result := range response.Results {
		switch {
		case result.Status == batchStatusSkipped:
			response.SkippedCount++
		case result.Success || result.Status == batchStatusSuccess:
			response.SuccessCount++
		default:
			response.FailedCount++
		}
	}
	return response
}

func canBatchStartContainer(state domain.DockerContainerState) bool {
	return state == domain.DockerContainerExited || state == domain.DockerContainerDead
}

func canBatchStopContainer(state domain.DockerContainerState) bool {
	return state == domain.DockerContainerRunning || state == domain.DockerContainerRestarting
}

func canBatchRestartContainer(state domain.DockerContainerState) bool {
	return state == domain.DockerContainerRunning
}

func (m *Manager) runLogStream(worker *logStreamWorker) {
	defer func() {
		if recover() != nil {
			m.emitError(worker.serverID, worker.containerID, worker.streamID, "DOCKER_LOG_STREAM_FAILED", "读取容器日志失败。")
		}
		_ = worker.transport.Close()
		worker.cancel()
	}()
	scanner := bufio.NewScanner(worker.session.Stdout())
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		if !m.workerCurrent(worker.serverID, worker.generation, worker.streamID, true) {
			continue
		}
		m.emitLog(worker.serverID, worker.containerID, worker.streamID, scanner.Text())
	}
	if err := scanner.Err(); err != nil && m.workerCurrent(worker.serverID, worker.generation, worker.streamID, true) {
		m.emitError(worker.serverID, worker.containerID, worker.streamID, "DOCKER_LOG_STREAM_FAILED", "读取容器日志失败。")
	}
	if err := worker.session.Wait(); err != nil && m.workerCurrent(worker.serverID, worker.generation, worker.streamID, true) {
		m.emitError(worker.serverID, worker.containerID, worker.streamID, "DOCKER_LOG_STREAM_FAILED", "读取容器日志失败。")
	}
	m.mu.Lock()
	if m.logStreams[worker.streamID] == worker {
		delete(m.logStreams, worker.streamID)
	}
	m.mu.Unlock()
}

func (m *Manager) runStatsWatch(ctx context.Context, worker *statsWatchWorker, interval time.Duration) {
	defer func() {
		if recover() != nil {
			m.emitError(worker.serverID, worker.containerID, worker.watchID, "DOCKER_STATS_FAILED", "读取容器资源占用失败。")
		}
		_ = worker.transport.Close()
		worker.cancel()
		m.mu.Lock()
		if m.statsWatchers[worker.watchID] == worker {
			delete(m.statsWatchers, worker.watchID)
		}
		m.mu.Unlock()
	}()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		stats, err := m.statsWithTransport(ctx, worker.serverID, worker.transport, worker.containerID, worker.mode)
		if err != nil {
			if m.workerCurrent(worker.serverID, worker.generation, worker.watchID, false) {
				m.emitError(worker.serverID, worker.containerID, worker.watchID, "DOCKER_STATS_FAILED", "读取容器资源占用失败。")
			}
			return
		}
		if m.workerCurrent(worker.serverID, worker.generation, worker.watchID, false) {
			m.emitStats(worker.serverID, worker.containerID, worker.watchID, stats)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (m *Manager) workerCurrent(serverID, generation int64, id string, log bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.serverGeneration[serverID] != generation {
		return false
	}
	if log {
		return m.logStreams[id] != nil
	}
	return m.statsWatchers[id] != nil
}

func (m *Manager) stopLogStreamLocked(worker *logStreamWorker) {
	if worker == nil {
		return
	}
	worker.cancel()
	if worker.session != nil {
		_ = worker.session.Close()
	}
	if worker.transport != nil {
		_ = worker.transport.Close()
	}
}

func (m *Manager) stopStatsWatcherLocked(worker *statsWatchWorker) {
	if worker == nil {
		return
	}
	worker.cancel()
	if worker.transport != nil {
		_ = worker.transport.Close()
	}
}

func (m *Manager) generation(serverID int64) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.serverGeneration[serverID]
}

func parseDockerVersion(output string) string {
	var parsed dockerVersionOutput
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &parsed); err != nil {
		return ""
	}
	if parsed.Server.Version != "" {
		return parsed.Server.Version
	}
	return parsed.Client.Version
}

func parseDockerContainers(serverID int64, output string) ([]domain.DockerContainer, error) {
	var containers []domain.DockerContainer
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row dockerPSLine
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, err
		}
		id := strings.TrimSpace(row.ID)
		containers = append(containers, domain.DockerContainer{
			ID:        id,
			ShortID:   shortContainerID(id),
			Name:      strings.TrimPrefix(strings.TrimSpace(row.Names), "/"),
			Image:     row.Image,
			Command:   row.Command,
			CreatedAt: firstNonEmpty(row.CreatedAt, row.RunningFor),
			Status:    row.Status,
			State:     normalizeContainerState(row.State, row.Status),
			Ports:     row.Ports,
			Labels:    row.Labels,
			Size:      row.Size,
			ServerID:  serverID,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return containers, nil
}

func parseInspectSummary(serverID int64, output string) (domain.DockerInspectSummary, error) {
	var values []dockerInspectContainer
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &values); err != nil {
		return domain.DockerInspectSummary{}, err
	}
	if len(values) == 0 {
		return domain.DockerInspectSummary{}, nil
	}
	item := values[0]
	image := item.Config.Image
	if image == "" {
		image = item.Image
	}
	return domain.DockerInspectSummary{
		ServerID:      serverID,
		ID:            item.ID,
		Name:          strings.TrimPrefix(item.Name, "/"),
		Image:         image,
		Created:       item.Created,
		State:         normalizeContainerState(item.State.Status, item.State.Status),
		Status:        inspectStatus(item),
		Ports:         inspectPorts(item.NetworkSettings.Ports),
		MountCount:    len(item.Mounts),
		NetworkNames:  inspectNetworkNames(item.NetworkSettings.Networks),
		RestartPolicy: inspectRestartPolicy(item.HostConfig.RestartPolicy.Name, item.HostConfig.RestartPolicy.MaximumRetryCount),
	}, nil
}

func parseStats(serverID int64, containerID string, output string) (domain.DockerContainerStats, error) {
	line := firstNonEmptyLine(output)
	if line == "" {
		return domain.DockerContainerStats{}, errors.New("empty docker stats output")
	}
	var row dockerStatsLine
	if err := json.Unmarshal([]byte(line), &row); err != nil {
		return domain.DockerContainerStats{}, err
	}
	memUsage, memLimit := parseBytePair(row.MemUsage)
	netInput, netOutput := parseBytePair(row.NetIO)
	blockInput, blockOutput := parseBytePair(row.BlockIO)
	pids, _ := strconv.Atoi(strings.TrimSpace(row.PIDs))
	id := firstNonEmpty(row.ID, row.Container, containerID)
	return domain.DockerContainerStats{
		ServerID:      serverID,
		ContainerID:   id,
		CPUPercent:    parseFloatPercent(row.CPUPerc),
		MemoryUsage:   memUsage,
		MemoryLimit:   memLimit,
		MemoryPercent: parseFloatPercent(row.MemPerc),
		NetInput:      netInput,
		NetOutput:     netOutput,
		BlockInput:    blockInput,
		BlockOutput:   blockOutput,
		PIDs:          pids,
		Timestamp:     timestamp(),
	}, nil
}

func parseDockerComposeVersion(output string) string {
	line := firstNonEmptyLine(output)
	if line == "" {
		return ""
	}
	matches := composeVersionValuePattern.FindStringSubmatch(line)
	if len(matches) > 1 {
		return matches[1]
	}
	return strings.TrimSpace(line)
}

func parseDockerComposeProjects(serverID int64, output string) ([]domain.DockerComposeProject, error) {
	rows, err := parseDockerJSONRows[dockerComposeProjectLine](output)
	if err != nil {
		return nil, err
	}
	projects := make([]domain.DockerComposeProject, 0, len(rows))
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		if name == "" {
			continue
		}
		projects = append(projects, domain.DockerComposeProject{
			ServerID:    serverID,
			Name:        name,
			Status:      strings.TrimSpace(row.Status),
			ConfigFiles: strings.TrimSpace(row.ConfigFiles),
			WorkingDir:  strings.TrimSpace(row.WorkingDir),
		})
	}
	return projects, nil
}

func parseDockerComposeServices(serverID int64, output string) ([]domain.DockerComposeService, error) {
	rows, err := parseDockerJSONRows[dockerComposePSLine](output)
	if err != nil {
		return nil, err
	}
	services := make([]domain.DockerComposeService, 0, len(rows))
	for _, row := range rows {
		id := strings.TrimSpace(row.ID)
		name := strings.TrimSpace(row.Name)
		if id == "" && name == "" && strings.TrimSpace(row.Service) == "" {
			continue
		}
		services = append(services, domain.DockerComposeService{
			ServerID: serverID,
			ID:       id,
			Name:     name,
			Project:  strings.TrimSpace(row.Project),
			Service:  strings.TrimSpace(row.Service),
			Image:    strings.TrimSpace(row.Image),
			Command:  strings.TrimSpace(row.Command),
			State:    strings.TrimSpace(row.State),
			Status:   strings.TrimSpace(row.Status),
			Health:   strings.TrimSpace(row.Health),
			Ports:    composePublisherPorts(row.Publishers),
			ExitCode: row.ExitCode,
		})
	}
	return services, nil
}

func parseDockerJSONRows[T any](output string) ([]T, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return []T{}, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var rows []T
		if err := json.Unmarshal([]byte(trimmed), &rows); err != nil {
			return nil, err
		}
		return rows, nil
	}
	var rows []T
	scanner := bufio.NewScanner(strings.NewReader(trimmed))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row T
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return rows, nil
}

func composePublisherPorts(publishers []dockerComposePublisher) string {
	if len(publishers) == 0 {
		return ""
	}
	rows := make([]string, 0, len(publishers))
	for _, publisher := range publishers {
		protocol := strings.TrimSpace(publisher.Protocol)
		if protocol == "" {
			protocol = "tcp"
		}
		target := strconv.Itoa(publisher.TargetPort)
		if publisher.TargetPort <= 0 {
			target = "0"
		}
		if publisher.PublishedPort <= 0 {
			rows = append(rows, target+"/"+protocol)
			continue
		}
		host := strings.TrimSpace(publisher.URL)
		if host == "" {
			host = "0.0.0.0"
		}
		rows = append(rows, fmt.Sprintf("%s:%d->%s/%s", host, publisher.PublishedPort, target, protocol))
	}
	return strings.Join(rows, ", ")
}

func inspectStatus(item dockerInspectContainer) string {
	status := strings.TrimSpace(item.State.Status)
	if item.State.Error != "" {
		return status + ": " + item.State.Error
	}
	if status == "exited" {
		return fmt.Sprintf("exited (%d)", item.State.ExitCode)
	}
	return status
}

func inspectPorts(ports map[string][]dockerInspectPortBinding) string {
	if len(ports) == 0 {
		return ""
	}
	rows := make([]string, 0, len(ports))
	for containerPort, bindings := range ports {
		if len(bindings) == 0 {
			rows = append(rows, containerPort)
			continue
		}
		for _, binding := range bindings {
			host := binding.HostIP
			if host == "" {
				host = "0.0.0.0"
			}
			rows = append(rows, fmt.Sprintf("%s:%s->%s", host, binding.HostPort, containerPort))
		}
	}
	return strings.Join(rows, ", ")
}

func inspectNetworkNames(networks map[string]json.RawMessage) []string {
	names := make([]string, 0, len(networks))
	for name := range networks {
		names = append(names, name)
	}
	return names
}

func inspectRestartPolicy(name string, maximumRetryCount int) string {
	if name == "" || name == "no" {
		return "no"
	}
	if maximumRetryCount > 0 {
		return fmt.Sprintf("%s:%d", name, maximumRetryCount)
	}
	return name
}

func normalizeContainerState(state string, status string) domain.DockerContainerState {
	value := strings.ToLower(strings.TrimSpace(state))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(status))
	}
	switch {
	case strings.Contains(value, "running"), strings.HasPrefix(strings.ToLower(status), "up"):
		return domain.DockerContainerRunning
	case strings.Contains(value, "exited"), strings.Contains(strings.ToLower(status), "exited"):
		return domain.DockerContainerExited
	case strings.Contains(value, "paused"):
		return domain.DockerContainerPaused
	case strings.Contains(value, "restarting"):
		return domain.DockerContainerRestarting
	case strings.Contains(value, "dead"):
		return domain.DockerContainerDead
	default:
		return domain.DockerContainerUnknown
	}
}

func validateContainerID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !safeContainerIDPattern.MatchString(value) {
		return "", errors.New("容器 ID 无效。")
	}
	return value, nil
}

func validateComposeProjectName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !safeComposeProjectPattern.MatchString(value) {
		return "", errors.New("Docker Compose project name is invalid.")
	}
	return value, nil
}

func validateComposeServiceName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !safeComposeServicePattern.MatchString(value) {
		return "", errors.New("Docker Compose service name is invalid.")
	}
	return value, nil
}

func normalizeTailLines(value int) int {
	if value <= 0 {
		return 200
	}
	if value > 5000 {
		return 5000
	}
	return value
}

func normalizeComposeTailLines(value int) int {
	if value <= 0 {
		return 200
	}
	if value > 1000 {
		return 1000
	}
	return value
}

func boundComposeLogOutput(output string) (string, bool) {
	if len(output) <= maxComposeLogBytes {
		return output, false
	}
	return output[len(output)-maxComposeLogBytes:], true
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func requestExecutionMode(value domain.DockerExecutionMode) domain.DockerExecutionMode {
	if value == domain.DockerExecutionSudo {
		return domain.DockerExecutionSudo
	}
	return domain.DockerExecutionCurrentUser
}

func commandWithSudo(mode domain.DockerExecutionMode, command string) string {
	if requestExecutionMode(mode) == domain.DockerExecutionSudo {
		return "sudo -n " + command
	}
	return command
}

func dockerCommand(mode domain.DockerExecutionMode, arguments string) string {
	return commandWithSudo(mode, "docker "+arguments)
}

func dockerUnavailable(serverID int64, message string) domain.DockerAvailability {
	return domain.DockerAvailability{
		ServerID:      serverID,
		Available:     false,
		Error:         message,
		LastRefreshAt: timestamp(),
	}
}

func composeUnavailable(serverID int64, message string) domain.DockerComposeCapability {
	return domain.DockerComposeCapability{
		ServerID:      serverID,
		Available:     false,
		Error:         message,
		LastRefreshAt: timestamp(),
	}
}

func classifyComposeUnavailable(pluginErr error, standaloneErr error) string {
	for _, err := range []error{pluginErr, standaloneErr} {
		if errors.Is(err, context.DeadlineExceeded) {
			return "Docker Compose request timed out."
		}
	}
	return "Docker Compose is not available on this server."
}

func composeCommandError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("Docker Compose request timed out.")
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		message = "Docker Compose command failed."
	}
	return errors.New(message)
}

func classifyError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "sudo") &&
		(strings.Contains(message, "password is required") ||
			strings.Contains(message, "a terminal is required") ||
			strings.Contains(message, "no tty present") ||
			strings.Contains(message, "a password is required")):
		return "Docker Manager 使用独立 SSH 执行，不会继承终端中 su/root 状态。sudo -n docker 需要免密 sudo；请配置免密 sudo、将用户加入 docker 组，或使用 root 凭据连接。"
	case strings.Contains(message, "executable file not found"),
		strings.Contains(message, "docker: not found"),
		strings.Contains(message, "docker: command not found"),
		strings.Contains(message, "docker command not found"),
		strings.Contains(message, "not found"):
		return "服务器未检测到 Docker。"
	case strings.Contains(message, "permission denied"),
		strings.Contains(message, "got permission denied"),
		strings.Contains(message, "permission"):
		return "Docker Manager 使用独立 SSH 执行，不会继承终端中 su/root 状态。当前用户无权限访问 Docker，可使用 sudo 重试；若服务器需要 sudo 密码，请配置免密 sudo、加入 docker 组，或使用 root 凭据连接。"
	case strings.Contains(message, "cannot connect to the docker daemon"),
		strings.Contains(message, "is the docker daemon running"),
		strings.Contains(message, "daemon"):
		return "Docker 服务未运行。"
	case strings.Contains(message, "no such container"):
		return "容器不存在或已被删除。"
	default:
		return "Docker 操作失败。"
	}
}

func newID(prefix string) string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(bytes[:])
}

func shortContainerID(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:12]
}

func parseFloatPercent(value string) float64 {
	value = strings.TrimSpace(strings.TrimSuffix(value, "%"))
	parsed, _ := strconv.ParseFloat(value, 64)
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}

func parseBytePair(value string) (int64, int64) {
	left, right, ok := strings.Cut(value, "/")
	if !ok {
		return parseBytes(value), 0
	}
	return parseBytes(left), parseBytes(right)
}

func parseBytes(value string) int64 {
	parts := byteValuePattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(parts) == 0 {
		return 0
	}
	number, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0
	}
	unit := strings.ToLower(parts[2])
	multiplier := float64(1)
	switch unit {
	case "", "b":
		multiplier = 1
	case "kb":
		multiplier = 1000
	case "kib":
		multiplier = 1024
	case "mb":
		multiplier = 1000 * 1000
	case "mib":
		multiplier = 1024 * 1024
	case "gb":
		multiplier = 1000 * 1000 * 1000
	case "gib":
		multiplier = 1024 * 1024 * 1024
	case "tb":
		multiplier = 1000 * 1000 * 1000 * 1000
	case "tib":
		multiplier = 1024 * 1024 * 1024 * 1024
	default:
		return 0
	}
	return int64(number * multiplier)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonEmptyLine(output string) string {
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			return line
		}
	}
	return ""
}

func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func (m *Manager) emitState(state domain.DockerAvailability) {
	if m.emitter == nil {
		return
	}
	m.emitter.State(domain.DockerStateEvent{ServerID: state.ServerID, State: state, Timestamp: timestamp()})
}

func (m *Manager) emitContainers(serverID int64, containers []domain.DockerContainer) {
	if m.emitter == nil {
		return
	}
	m.emitter.Containers(domain.DockerContainersEvent{ServerID: serverID, Containers: containers, Timestamp: timestamp()})
}

func (m *Manager) emitLog(serverID int64, containerID, streamID, line string) {
	if m.emitter == nil {
		return
	}
	m.emitter.Log(domain.DockerLogEvent{
		ServerID:    serverID,
		ContainerID: containerID,
		StreamID:    streamID,
		Line:        line,
		Timestamp:   timestamp(),
	})
}

func (m *Manager) emitStats(serverID int64, containerID, watchID string, stats domain.DockerContainerStats) {
	if m.emitter == nil {
		return
	}
	m.emitter.Stats(domain.DockerStatsEvent{
		ServerID:    serverID,
		ContainerID: containerID,
		WatchID:     watchID,
		Stats:       stats,
		Timestamp:   timestamp(),
	})
}

func (m *Manager) emitError(serverID int64, containerID, streamID, code, message string) {
	if m.emitter == nil {
		return
	}
	m.emitter.Error(domain.DockerErrorEvent{
		ServerID:    serverID,
		ContainerID: containerID,
		StreamID:    streamID,
		Code:        code,
		Message:     message,
		Timestamp:   timestamp(),
	})
}

func (m *Manager) log(level, message, operation string, serverID int64, containerID string, err error) {
	if m.logger == nil {
		return
	}
	_ = containerID
	m.logger.Write(level, message, operation, serverID, err)
}
