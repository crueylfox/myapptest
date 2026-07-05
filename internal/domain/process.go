package domain

type ProcessSortBy string

const (
	ProcessSortCPU     ProcessSortBy = "cpu"
	ProcessSortMemory  ProcessSortBy = "memory"
	ProcessSortPID     ProcessSortBy = "pid"
	ProcessSortUser    ProcessSortBy = "user"
	ProcessSortCommand ProcessSortBy = "command"
)

type ProcessSortDir string

const (
	ProcessSortAsc  ProcessSortDir = "asc"
	ProcessSortDesc ProcessSortDir = "desc"
)

type ProcessSignal string

const (
	ProcessSignalTerm ProcessSignal = "term"
	ProcessSignalKill ProcessSignal = "kill"
)

type ProcessEntry struct {
	ServerID         int64   `json:"serverID"`
	PID              int64   `json:"pid"`
	PPID             int64   `json:"ppid"`
	User             string  `json:"user"`
	State            string  `json:"state"`
	StateLabel       string  `json:"stateLabel"`
	CPUPercent       float64 `json:"cpuPercent"`
	MemoryPercent    float64 `json:"memoryPercent"`
	RSSBytes         uint64  `json:"rssBytes"`
	VSZBytes         uint64  `json:"vszBytes"`
	Command          string  `json:"command"`
	ArgsPreview      string  `json:"argsPreview"`
	StartedOrElapsed string  `json:"startedOrElapsed"`
	IsKernelThread   bool    `json:"isKernelThread"`
	CanSignal        bool    `json:"canSignal"`
}

type ProcessDetail struct {
	ServerID            int64          `json:"serverID"`
	PID                 int64          `json:"pid"`
	PPID                int64          `json:"ppid"`
	User                string         `json:"user"`
	State               string         `json:"state"`
	StateLabel          string         `json:"stateLabel"`
	Command             string         `json:"command"`
	Cmdline             string         `json:"cmdline"`
	Cwd                 string         `json:"cwd,omitempty"`
	Exe                 string         `json:"exe,omitempty"`
	OpenFilesCount      *int           `json:"openFilesCount,omitempty"`
	Threads             *int           `json:"threads,omitempty"`
	RSSBytes            uint64         `json:"rssBytes"`
	VSZBytes            uint64         `json:"vszBytes"`
	MemoryPercent       float64        `json:"memoryPercent"`
	CPUPercent          float64        `json:"cpuPercent"`
	EnvironmentRedacted bool           `json:"environmentRedacted"`
	Children            []ProcessEntry `json:"children"`
	Parent              *ProcessEntry  `json:"parent,omitempty"`
	LastUpdatedAt       string         `json:"lastUpdatedAt"`
	Warnings            []string       `json:"warnings"`
	IsKernelThread      bool           `json:"isKernelThread"`
	CanSignal           bool           `json:"canSignal"`
}

type ListProcessesRequest struct {
	ServerID int64          `json:"serverID"`
	Query    string         `json:"query,omitempty"`
	SortBy   ProcessSortBy  `json:"sortBy"`
	SortDir  ProcessSortDir `json:"sortDir"`
	Limit    int            `json:"limit,omitempty"`
}

type ProcessListResponse struct {
	ServerID       int64          `json:"serverID"`
	Processes      []ProcessEntry `json:"processes"`
	Warnings       []string       `json:"warnings"`
	ParserStrategy string         `json:"parserStrategy,omitempty"`
	Timestamp      string         `json:"timestamp"`
}

type GetProcessDetailRequest struct {
	ServerID int64 `json:"serverID"`
	PID      int64 `json:"pid"`
}

type SignalProcessRequest struct {
	ServerID        int64         `json:"serverID"`
	PID             int64         `json:"pid"`
	Signal          ProcessSignal `json:"signal"`
	ExpectedCommand string        `json:"expectedCommand,omitempty"`
}

type SignalProcessResponse struct {
	ServerID int64  `json:"serverID"`
	PID      int64  `json:"pid"`
	Success  bool   `json:"success"`
	Message  string `json:"message"`
}

type StartProcessWatchRequest struct {
	ServerID   int64          `json:"serverID"`
	WatchID    string         `json:"watchID,omitempty"`
	Query      string         `json:"query,omitempty"`
	SortBy     ProcessSortBy  `json:"sortBy"`
	SortDir    ProcessSortDir `json:"sortDir"`
	Limit      int            `json:"limit,omitempty"`
	IntervalMs int            `json:"intervalMs,omitempty"`
}

type StopProcessWatchRequest struct {
	ServerID int64  `json:"serverID"`
	WatchID  string `json:"watchID"`
}

type ProcessStateEvent struct {
	ServerID  int64  `json:"serverID"`
	WatchID   string `json:"watchID"`
	State     string `json:"state"`
	Timestamp string `json:"timestamp"`
}

type ProcessListEvent struct {
	ServerID       int64          `json:"serverID"`
	WatchID        string         `json:"watchID"`
	Processes      []ProcessEntry `json:"processes"`
	Warnings       []string       `json:"warnings"`
	ParserStrategy string         `json:"parserStrategy,omitempty"`
	Timestamp      string         `json:"timestamp"`
}

type ProcessDetailEvent struct {
	ServerID  int64         `json:"serverID"`
	WatchID   string        `json:"watchID,omitempty"`
	Detail    ProcessDetail `json:"detail"`
	Timestamp string        `json:"timestamp"`
}

type ProcessErrorEvent struct {
	ServerID  int64  `json:"serverID"`
	WatchID   string `json:"watchID,omitempty"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}
