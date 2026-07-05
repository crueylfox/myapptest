package domain

type ServiceManagerInitSystem string

const (
	ServiceManagerInitSystemSystemd      ServiceManagerInitSystem = "systemd"
	ServiceManagerInitSystemOpenWrtProcd ServiceManagerInitSystem = "openwrt-procd"
	ServiceManagerInitSystemUnsupported  ServiceManagerInitSystem = "unsupported"
)

type ServiceManagerServerRequest struct {
	ServerID int64 `json:"serverID"`
}

type SystemServiceActionRequest struct {
	ServerID  int64  `json:"serverID"`
	UnitName  string `json:"unitName"`
	ServiceID string `json:"serviceID,omitempty"`
}

type ServiceManagerCapability struct {
	ServerID                int64                    `json:"serverID"`
	Available               bool                     `json:"available"`
	InitSystem              ServiceManagerInitSystem `json:"initSystem"`
	DisplayName             string                   `json:"displayName,omitempty"`
	SystemdVersion          string                   `json:"systemdVersion,omitempty"`
	DistributionName        string                   `json:"distributionName,omitempty"`
	DistributionVersion     string                   `json:"distributionVersion,omitempty"`
	SupportsJournal         bool                     `json:"supportsJournal"`
	SupportsLiveLogs        bool                     `json:"supportsLiveLogs"`
	SupportsResourceMetrics bool                     `json:"supportsResourceMetrics"`
	SupportsStart           bool                     `json:"supportsStart"`
	SupportsStop            bool                     `json:"supportsStop"`
	SupportsRestart         bool                     `json:"supportsRestart"`
	SupportsEnable          bool                     `json:"supportsEnable"`
	SupportsDisable         bool                     `json:"supportsDisable"`
	CanManage               bool                     `json:"canManage"`
	RequiresPrivilege       bool                     `json:"requiresPrivilege"`
	Error                   string                   `json:"error,omitempty"`
}

type SystemServiceSummary struct {
	ServerID           int64                    `json:"serverID"`
	InitSystem         ServiceManagerInitSystem `json:"initSystem"`
	ServiceID          string                   `json:"serviceID"`
	UnitName           string                   `json:"unitName"`
	DisplayName        string                   `json:"displayName"`
	Description        string                   `json:"description"`
	StartupState       string                   `json:"startupState,omitempty"`
	LoadState          string                   `json:"loadState"`
	ActiveState        string                   `json:"activeState"`
	SubState           string                   `json:"subState"`
	UnitFileState      string                   `json:"unitFileState"`
	ActiveStateLabel   string                   `json:"activeStateLabel"`
	UnitFileStateLabel string                   `json:"unitFileStateLabel"`
	IsActive           bool                     `json:"isActive"`
	IsFailed           bool                     `json:"isFailed"`
	IsEnabled          bool                     `json:"isEnabled"`
	CanStart           bool                     `json:"canStart"`
	CanStop            bool                     `json:"canStop"`
	CanRestart         bool                     `json:"canRestart"`
	CanEnable          bool                     `json:"canEnable"`
	CanDisable         bool                     `json:"canDisable"`
	Critical           bool                     `json:"critical"`
	Protected          bool                     `json:"protected"`
}

type SystemServiceListResponse struct {
	ServerID  int64                  `json:"serverID"`
	Services  []SystemServiceSummary `json:"services"`
	Timestamp string                 `json:"timestamp"`
}

type SystemServiceDetail struct {
	ServerID            int64                    `json:"serverID"`
	InitSystem          ServiceManagerInitSystem `json:"initSystem"`
	ServiceID           string                   `json:"serviceID"`
	UnitName            string                   `json:"unitName"`
	DisplayName         string                   `json:"displayName,omitempty"`
	Description         string                   `json:"description"`
	StartupState        string                   `json:"startupState,omitempty"`
	LoadState           string                   `json:"loadState"`
	ActiveState         string                   `json:"activeState"`
	SubState            string                   `json:"subState"`
	UnitFileState       string                   `json:"unitFileState"`
	ActiveStateLabel    string                   `json:"activeStateLabel"`
	UnitFileStateLabel  string                   `json:"unitFileStateLabel"`
	MainPID             int64                    `json:"mainPID"`
	MemoryCurrentBytes  *int64                   `json:"memoryCurrentBytes,omitempty"`
	CPUUsageNSec        *int64                   `json:"cpuUsageNSec,omitempty"`
	TasksCurrent        *int64                   `json:"tasksCurrent,omitempty"`
	RestartCount        *int64                   `json:"restartCount,omitempty"`
	FragmentPath        string                   `json:"fragmentPath,omitempty"`
	ScriptPath          string                   `json:"scriptPath,omitempty"`
	DistributionName    string                   `json:"distributionName,omitempty"`
	DistributionVersion string                   `json:"distributionVersion,omitempty"`
	LastUpdatedAt       string                   `json:"lastUpdatedAt,omitempty"`
	Result              string                   `json:"result,omitempty"`
	StartedAt           string                   `json:"startedAt,omitempty"`
	ExitedAt            string                   `json:"exitedAt,omitempty"`
	Partial             bool                     `json:"partial"`
	Warnings            []string                 `json:"warnings,omitempty"`
	Critical            bool                     `json:"critical"`
	Protected           bool                     `json:"protected"`
}

type SystemServiceActionResponse struct {
	ServerID  int64  `json:"serverID"`
	ServiceID string `json:"serviceID,omitempty"`
	UnitName  string `json:"unitName"`
	Action    string `json:"action"`
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type SystemServiceJournalRequest struct {
	ServerID        int64  `json:"serverID"`
	UnitName        string `json:"unitName"`
	LineLimit       int    `json:"lineLimit"`
	Priority        string `json:"priority"`
	CurrentBootOnly bool   `json:"currentBootOnly"`
}

type ServiceJournalLine struct {
	Sequence      int64  `json:"sequence"`
	Timestamp     string `json:"timestamp,omitempty"`
	TimestampText string `json:"timestampText,omitempty"`
	Priority      int    `json:"priority"`
	PriorityLabel string `json:"priorityLabel"`
	Identifier    string `json:"identifier,omitempty"`
	PID           string `json:"pid,omitempty"`
	Message       string `json:"message"`
	Truncated     bool   `json:"truncated"`
}

type SystemServiceJournalResponse struct {
	ServerID  int64                `json:"serverID"`
	UnitName  string               `json:"unitName"`
	Lines     []ServiceJournalLine `json:"lines"`
	Fallback  bool                 `json:"fallback"`
	Timestamp string               `json:"timestamp"`
}

type SystemServiceJournalFollowResponse struct {
	WatchID   string `json:"watchID"`
	ServerID  int64  `json:"serverID"`
	UnitName  string `json:"unitName"`
	StartedAt string `json:"startedAt"`
}

type StopSystemServiceJournalFollowRequest struct {
	ServerID int64  `json:"serverID"`
	WatchID  string `json:"watchID"`
}

type ServiceJournalStateEvent struct {
	WatchID   string `json:"watchID"`
	ServerID  int64  `json:"serverID"`
	UnitName  string `json:"unitName"`
	State     string `json:"state"`
	Timestamp string `json:"timestamp"`
}

type ServiceJournalLineEvent struct {
	WatchID   string             `json:"watchID"`
	ServerID  int64              `json:"serverID"`
	UnitName  string             `json:"unitName"`
	Sequence  int64              `json:"sequence"`
	Line      ServiceJournalLine `json:"line"`
	Timestamp string             `json:"timestamp"`
}

type ServiceJournalErrorEvent struct {
	WatchID   string `json:"watchID"`
	ServerID  int64  `json:"serverID"`
	UnitName  string `json:"unitName"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type ServiceJournalCompletedEvent struct {
	WatchID   string `json:"watchID"`
	ServerID  int64  `json:"serverID"`
	UnitName  string `json:"unitName"`
	Reason    string `json:"reason,omitempty"`
	Timestamp string `json:"timestamp"`
}
