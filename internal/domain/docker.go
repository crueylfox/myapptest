package domain

type DockerContainerState string
type DockerExecutionMode string

const (
	DockerContainerRunning    DockerContainerState = "running"
	DockerContainerExited     DockerContainerState = "exited"
	DockerContainerPaused     DockerContainerState = "paused"
	DockerContainerRestarting DockerContainerState = "restarting"
	DockerContainerDead       DockerContainerState = "dead"
	DockerContainerUnknown    DockerContainerState = "unknown"

	DockerExecutionCurrentUser DockerExecutionMode = "current_user"
	DockerExecutionSudo        DockerExecutionMode = "sudo"
)

type DockerAvailability struct {
	ServerID      int64             `json:"serverID"`
	Available     bool              `json:"available"`
	Version       string            `json:"version"`
	Error         string            `json:"error"`
	LastRefreshAt string            `json:"lastRefreshAt"`
	Containers    []DockerContainer `json:"containers"`
}

type DockerContainer struct {
	ID        string               `json:"id"`
	ShortID   string               `json:"shortID"`
	Name      string               `json:"name"`
	Image     string               `json:"image"`
	Command   string               `json:"command"`
	CreatedAt string               `json:"createdAt"`
	Status    string               `json:"status"`
	State     DockerContainerState `json:"state"`
	Ports     string               `json:"ports"`
	Labels    string               `json:"labels"`
	Size      string               `json:"size"`
	ServerID  int64                `json:"serverID"`
}

type DockerContainerStats struct {
	ServerID      int64   `json:"serverID"`
	ContainerID   string  `json:"containerID"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryUsage   int64   `json:"memoryUsage"`
	MemoryLimit   int64   `json:"memoryLimit"`
	MemoryPercent float64 `json:"memoryPercent"`
	NetInput      int64   `json:"netInput"`
	NetOutput     int64   `json:"netOutput"`
	BlockInput    int64   `json:"blockInput"`
	BlockOutput   int64   `json:"blockOutput"`
	PIDs          int     `json:"pids"`
	Timestamp     string  `json:"timestamp"`
}

type DockerInspectSummary struct {
	ServerID      int64                `json:"serverID"`
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	Image         string               `json:"image"`
	Created       string               `json:"created"`
	State         DockerContainerState `json:"state"`
	Status        string               `json:"status"`
	Ports         string               `json:"ports"`
	MountCount    int                  `json:"mountCount"`
	NetworkNames  []string             `json:"networkNames"`
	RestartPolicy string               `json:"restartPolicy"`
}

type DockerListContainersRequest struct {
	ServerID      int64               `json:"serverID"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerServerRequest struct {
	ServerID      int64               `json:"serverID"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerContainerRequest struct {
	ServerID      int64               `json:"serverID"`
	ContainerID   string              `json:"containerID"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerBatchContainerRequest struct {
	ServerID      int64               `json:"serverID"`
	ContainerIDs  []string            `json:"containerIDs"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerBatchContainerResult struct {
	ContainerID string `json:"containerID"`
	Name        string `json:"name"`
	Action      string `json:"action"`
	Status      string `json:"status"`
	Success     bool   `json:"success"`
	Error       string `json:"error"`
	Reason      string `json:"reason"`
}

type DockerBatchContainerResponse struct {
	ServerID     int64                        `json:"serverID"`
	Results      []DockerBatchContainerResult `json:"results"`
	SuccessCount int                          `json:"successCount"`
	FailedCount  int                          `json:"failedCount"`
	SkippedCount int                          `json:"skippedCount"`
}

type DockerLogsRequest struct {
	ServerID      int64               `json:"serverID"`
	ContainerID   string              `json:"containerID"`
	TailLines     int                 `json:"tailLines"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerLogStreamRequest struct {
	ServerID      int64               `json:"serverID"`
	ContainerID   string              `json:"containerID"`
	TailLines     int                 `json:"tailLines"`
	StreamID      string              `json:"streamID"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerStopLogStreamRequest struct {
	ServerID int64  `json:"serverID"`
	StreamID string `json:"streamID"`
}

type DockerStatsWatchRequest struct {
	ServerID      int64               `json:"serverID"`
	ContainerID   string              `json:"containerID"`
	WatchID       string              `json:"watchID"`
	IntervalMs    int                 `json:"intervalMs"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerStopStatsWatchRequest struct {
	ServerID int64  `json:"serverID"`
	WatchID  string `json:"watchID"`
}

type DockerComposeCapability struct {
	ServerID      int64  `json:"serverID"`
	Available     bool   `json:"available"`
	Command       string `json:"command"`
	Version       string `json:"version"`
	Error         string `json:"error"`
	LastRefreshAt string `json:"lastRefreshAt"`
}

type DockerComposeProject struct {
	ServerID    int64  `json:"serverID"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	ConfigFiles string `json:"configFiles"`
	WorkingDir  string `json:"workingDir"`
}

type DockerComposeProjectsRequest struct {
	ServerID      int64               `json:"serverID"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerComposeProjectRequest struct {
	ServerID      int64               `json:"serverID"`
	ProjectName   string              `json:"projectName"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerComposeServiceDetailRequest struct {
	ServerID      int64               `json:"serverID"`
	ProjectName   string              `json:"projectName"`
	ServiceName   string              `json:"serviceName"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerComposeService struct {
	ServerID int64  `json:"serverID"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Project  string `json:"project"`
	Service  string `json:"service"`
	Image    string `json:"image"`
	Command  string `json:"command"`
	State    string `json:"state"`
	Status   string `json:"status"`
	Health   string `json:"health"`
	Ports    string `json:"ports"`
	ExitCode int    `json:"exitCode"`
}

type DockerComposeServicesResponse struct {
	ServerID    int64                  `json:"serverID"`
	ProjectName string                 `json:"projectName"`
	Services    []DockerComposeService `json:"services"`
	Timestamp   string                 `json:"timestamp"`
}

type DockerComposeLogsRequest struct {
	ServerID      int64               `json:"serverID"`
	ProjectName   string              `json:"projectName"`
	ServiceName   string              `json:"serviceName"`
	TailLines     int                 `json:"tailLines"`
	ExecutionMode DockerExecutionMode `json:"executionMode,omitempty"`
}

type DockerComposeLogsSnapshot struct {
	ServerID    int64  `json:"serverID"`
	ProjectName string `json:"projectName"`
	ServiceName string `json:"serviceName"`
	Output      string `json:"output"`
	Truncated   bool   `json:"truncated"`
	Timestamp   string `json:"timestamp"`
}

type DockerStateEvent struct {
	ServerID  int64              `json:"serverID"`
	State     DockerAvailability `json:"state"`
	Timestamp string             `json:"timestamp"`
}

type DockerContainersEvent struct {
	ServerID   int64             `json:"serverID"`
	Containers []DockerContainer `json:"containers"`
	Timestamp  string            `json:"timestamp"`
}

type DockerLogEvent struct {
	ServerID    int64  `json:"serverID"`
	ContainerID string `json:"containerID"`
	StreamID    string `json:"streamID"`
	Line        string `json:"line"`
	Timestamp   string `json:"timestamp"`
}

type DockerStatsEvent struct {
	ServerID    int64                `json:"serverID"`
	ContainerID string               `json:"containerID"`
	WatchID     string               `json:"watchID"`
	Stats       DockerContainerStats `json:"stats"`
	Timestamp   string               `json:"timestamp"`
}

type DockerErrorEvent struct {
	ServerID    int64  `json:"serverID"`
	ContainerID string `json:"containerID"`
	StreamID    string `json:"streamID"`
	Code        string `json:"code"`
	Message     string `json:"message"`
	Timestamp   string `json:"timestamp"`
}
