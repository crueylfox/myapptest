package domain

type TunnelType string

const (
	TunnelTypeLocal   TunnelType = "local"
	TunnelTypeRemote  TunnelType = "remote"
	TunnelTypeDynamic TunnelType = "dynamic"
)

type TunnelStatus string

const (
	TunnelStatusStarting TunnelStatus = "starting"
	TunnelStatusRunning  TunnelStatus = "running"
	TunnelStatusFailed   TunnelStatus = "failed"
	TunnelStatusStopping TunnelStatus = "stopping"
	TunnelStatusStopped  TunnelStatus = "stopped"
)

type RemoteListenCheckStatus string

const (
	RemoteListenUnchecked RemoteListenCheckStatus = "unchecked"
	RemoteListenListening RemoteListenCheckStatus = "listening"
	RemoteListenLoopback  RemoteListenCheckStatus = "loopback_only"
	RemoteListenNotFound  RemoteListenCheckStatus = "not_listening"
	RemoteListenUnknown   RemoteListenCheckStatus = "unknown"
)

type RemoteListenExposure string

const (
	RemoteListenExposurePublic       RemoteListenExposure = "public"
	RemoteListenExposureLoopbackOnly RemoteListenExposure = "loopback_only"
	RemoteListenExposureNotListening RemoteListenExposure = "not_listening"
	RemoteListenExposureUnknown      RemoteListenExposure = "unknown"
)

type TunnelRuntime struct {
	TunnelID                string                  `json:"tunnelID"`
	ServerID                int64                   `json:"serverID"`
	ProfileID               int64                   `json:"profileID"`
	Name                    string                  `json:"name"`
	Type                    TunnelType              `json:"type"`
	Status                  TunnelStatus            `json:"status"`
	BindHost                string                  `json:"bindHost"`
	BindPort                int                     `json:"bindPort"`
	TargetHost              string                  `json:"targetHost"`
	TargetPort              int                     `json:"targetPort"`
	RemoteBindHost          string                  `json:"remoteBindHost"`
	RemoteBindPort          int                     `json:"remoteBindPort"`
	RequestedListen         string                  `json:"requestedListen"`
	ActualListen            string                  `json:"actualListen"`
	EffectiveRemoteBindHost string                  `json:"effectiveRemoteBindHost"`
	EffectiveListenAddrs    []string                `json:"effectiveListenAddrs"`
	RemoteListenExposure    RemoteListenExposure    `json:"remoteListenExposure"`
	RemoteListenCheckStatus RemoteListenCheckStatus `json:"remoteListenCheckStatus"`
	RemoteListenWarning     string                  `json:"remoteListenWarning"`
	TestCommand             string                  `json:"testCommand"`
	ActiveConnections       int                     `json:"activeConnections"`
	BytesIn                 int64                   `json:"bytesIn"`
	BytesOut                int64                   `json:"bytesOut"`
	StartedAt               string                  `json:"startedAt"`
	UpdatedAt               string                  `json:"updatedAt"`
	Error                   string                  `json:"error"`
}

type TunnelProfile struct {
	ID             int64      `json:"id"`
	Name           string     `json:"name"`
	ServerID       int64      `json:"serverID"`
	Type           TunnelType `json:"type"`
	BindHost       string     `json:"bindHost"`
	BindPort       int        `json:"bindPort"`
	TargetHost     string     `json:"targetHost"`
	TargetPort     int        `json:"targetPort"`
	RemoteBindHost string     `json:"remoteBindHost"`
	RemoteBindPort int        `json:"remoteBindPort"`
	AutoStart      bool       `json:"autoStart"`
	CreatedAt      string     `json:"createdAt"`
	UpdatedAt      string     `json:"updatedAt"`
}

type SaveTunnelProfileRequest struct {
	ID             int64      `json:"id"`
	Name           string     `json:"name"`
	ServerID       int64      `json:"serverID"`
	Type           TunnelType `json:"type"`
	BindHost       string     `json:"bindHost"`
	BindPort       int        `json:"bindPort"`
	TargetHost     string     `json:"targetHost"`
	TargetPort     int        `json:"targetPort"`
	RemoteBindHost string     `json:"remoteBindHost"`
	RemoteBindPort int        `json:"remoteBindPort"`
	AutoStart      bool       `json:"autoStart"`
}

type StartTunnelRequest struct {
	ServerID          int64       `json:"serverID"`
	ProfileID         int64       `json:"profileID"`
	Type              TunnelType  `json:"type"`
	Name              string      `json:"name"`
	BindHost          string      `json:"bindHost"`
	BindPort          int         `json:"bindPort"`
	TargetHost        string      `json:"targetHost"`
	TargetPort        int         `json:"targetPort"`
	RemoteBindHost    string      `json:"remoteBindHost"`
	RemoteBindPort    int         `json:"remoteBindPort"`
	ConfirmPublicBind bool        `json:"confirmPublicBind"`
	Auth              AuthRequest `json:"auth"`
}

type StopTunnelRequest struct {
	ServerID int64  `json:"serverID"`
	TunnelID string `json:"tunnelID"`
}

type RestartTunnelRequest struct {
	ServerID int64       `json:"serverID"`
	TunnelID string      `json:"tunnelID"`
	Auth     AuthRequest `json:"auth"`
}

type ListTunnelsRequest struct {
	ServerID int64 `json:"serverID"`
}

type CheckTunnelRemoteListenRequest struct {
	ServerID int64  `json:"serverID"`
	TunnelID string `json:"tunnelID"`
}

type RemoteForwardAccessRequest struct {
	ServerID       int64  `json:"serverID"`
	TunnelID       string `json:"tunnelID"`
	RemoteBindHost string `json:"remoteBindHost"`
	RemoteBindPort int    `json:"remoteBindPort"`
}

type RemoteForwardAccessInspectResult struct {
	ServerID                    int64    `json:"serverID"`
	SSHDType                    string   `json:"sshdType"`
	ConfigPath                  string   `json:"configPath"`
	GatewayPortsEffective       string   `json:"gatewayPortsEffective"`
	AllowTCPForwardingEffective string   `json:"allowTcpForwardingEffective"`
	CanModify                   bool     `json:"canModify"`
	RequiresSudo                bool     `json:"requiresSudo"`
	Warnings                    []string `json:"warnings"`
}

type RemoteForwardAccessEnableResult struct {
	Success       bool     `json:"success"`
	BackupPath    string   `json:"backupPath"`
	ChangedFiles  []string `json:"changedFiles"`
	ReloadCommand string   `json:"reloadCommand"`
	Message       string   `json:"message"`
	Warnings      []string `json:"warnings"`
}

type RemoteForwardAccessRestartRequest struct {
	ServerID  int64       `json:"serverID"`
	TunnelID  string      `json:"tunnelID"`
	ProfileID int64       `json:"profileID"`
	Auth      AuthRequest `json:"auth"`
}

type RemoteForwardAccessRestartResult struct {
	Access  RemoteForwardAccessEnableResult `json:"access"`
	Runtime TunnelRuntime                   `json:"runtime"`
}

type TunnelStateEvent struct {
	ServerID  int64         `json:"serverID"`
	TunnelID  string        `json:"tunnelID"`
	State     TunnelRuntime `json:"state"`
	Timestamp string        `json:"timestamp"`
}

type TunnelErrorEvent struct {
	ServerID  int64  `json:"serverID"`
	TunnelID  string `json:"tunnelID"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type TunnelTrafficEvent struct {
	ServerID          int64  `json:"serverID"`
	TunnelID          string `json:"tunnelID"`
	ActiveConnections int    `json:"activeConnections"`
	BytesIn           int64  `json:"bytesIn"`
	BytesOut          int64  `json:"bytesOut"`
	Timestamp         string `json:"timestamp"`
}

type BackupTunnelProfile struct {
	ID             int64      `json:"id"`
	Name           string     `json:"name"`
	ServerID       int64      `json:"serverID"`
	Type           TunnelType `json:"type"`
	BindHost       string     `json:"bindHost"`
	BindPort       int        `json:"bindPort"`
	TargetHost     string     `json:"targetHost"`
	TargetPort     int        `json:"targetPort"`
	RemoteBindHost string     `json:"remoteBindHost"`
	RemoteBindPort int        `json:"remoteBindPort"`
	AutoStart      bool       `json:"autoStart"`
	CreatedAt      string     `json:"createdAt"`
	UpdatedAt      string     `json:"updatedAt"`
}
