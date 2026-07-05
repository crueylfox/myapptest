package domain

type BatchCommandStatus string

const (
	BatchCommandQueued     BatchCommandStatus = "queued"
	BatchCommandConnecting BatchCommandStatus = "connecting"
	BatchCommandRunning    BatchCommandStatus = "running"
	BatchCommandCompleted  BatchCommandStatus = "completed"
	BatchCommandFailed     BatchCommandStatus = "failed"
	BatchCommandCanceled   BatchCommandStatus = "canceled"
	BatchCommandTimeout    BatchCommandStatus = "timeout"
)

type StartBatchCommandRequest struct {
	Command        string  `json:"command"`
	ServerIDs      []int64 `json:"serverIDs"`
	TimeoutSeconds int     `json:"timeoutSeconds"`
	Concurrency    int     `json:"concurrency"`
}

type CancelBatchCommandServerRequest struct {
	TaskID   string `json:"taskID"`
	ServerID int64  `json:"serverID"`
}

type CancelBatchCommandTaskRequest struct {
	TaskID string `json:"taskID"`
}

type BatchCommandTask struct {
	TaskID         string                     `json:"taskID"`
	Command        string                     `json:"command"`
	ServerIDs      []int64                    `json:"serverIDs"`
	Status         BatchCommandStatus         `json:"status"`
	CreatedAt      string                     `json:"createdAt"`
	StartedAt      string                     `json:"startedAt,omitempty"`
	CompletedAt    string                     `json:"completedAt,omitempty"`
	Concurrency    int                        `json:"concurrency"`
	TimeoutSeconds int                        `json:"timeoutSeconds"`
	Results        []BatchCommandServerResult `json:"results"`
}

type BatchCommandServerResult struct {
	TaskID          string             `json:"taskID"`
	ServerID        int64              `json:"serverID"`
	ServerName      string             `json:"serverName"`
	Host            string             `json:"host"`
	Status          BatchCommandStatus `json:"status"`
	ExitCode        int                `json:"exitCode"`
	Stdout          string             `json:"stdout"`
	Stderr          string             `json:"stderr"`
	StartedAt       string             `json:"startedAt,omitempty"`
	CompletedAt     string             `json:"completedAt,omitempty"`
	DurationMs      int64              `json:"durationMs"`
	Error           string             `json:"error"`
	OutputTruncated bool               `json:"outputTruncated"`
}

type BatchCommandStateEvent struct {
	TaskID    string                   `json:"taskID"`
	ServerID  int64                    `json:"serverID"`
	Timestamp string                   `json:"timestamp"`
	Status    BatchCommandStatus       `json:"status"`
	Result    BatchCommandServerResult `json:"result"`
}

type BatchCommandOutputEvent struct {
	TaskID    string `json:"taskID"`
	ServerID  int64  `json:"serverID"`
	Timestamp string `json:"timestamp"`
	Stream    string `json:"stream"`
	Chunk     string `json:"chunk"`
}

type BatchCommandCompletedEvent struct {
	TaskID    string             `json:"taskID"`
	ServerID  int64              `json:"serverID"`
	Timestamp string             `json:"timestamp"`
	Status    BatchCommandStatus `json:"status"`
	Task      BatchCommandTask   `json:"task"`
}

type BatchCommandErrorEvent struct {
	TaskID    string `json:"taskID"`
	ServerID  int64  `json:"serverID"`
	Timestamp string `json:"timestamp"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}
