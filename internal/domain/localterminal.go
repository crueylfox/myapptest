package domain

type LocalTerminalStatus string

const (
	LocalTerminalStarting LocalTerminalStatus = "starting"
	LocalTerminalRunning  LocalTerminalStatus = "running"
	LocalTerminalExited   LocalTerminalStatus = "exited"
	LocalTerminalFailed   LocalTerminalStatus = "failed"
	LocalTerminalClosed   LocalTerminalStatus = "closed"
)

type LocalTerminalShellKind string

const (
	LocalTerminalShellKindCmd        LocalTerminalShellKind = "cmd"
	LocalTerminalShellKindPowerShell LocalTerminalShellKind = "powershell"
	LocalTerminalShellKindLocal      LocalTerminalShellKind = "local"
)

type LocalTerminalOpenRequest struct {
	ShellKind string `json:"shellKind"`
	Elevated  bool   `json:"elevated"`
	Shell     string `json:"shell"`
	Cwd       string `json:"cwd"`
	Rows      int    `json:"rows"`
	Cols      int    `json:"cols"`
}

type LocalTerminalElevatedRelaunchRequest struct {
	ShellKind string `json:"shellKind"`
}

type LocalTerminalStartupRequest struct {
	ShellKind string `json:"shellKind"`
}

type LocalTerminalOpenResponse struct {
	SessionID string `json:"sessionId"`
	ShellKind string `json:"shellKind"`
	Shell     string `json:"shell"`
	ShellName string `json:"shellName"`
	Elevated  bool   `json:"elevated"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Cwd       string `json:"cwd"`
	StartedAt string `json:"startedAt"`
}

type LocalTerminalShellOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type LocalTerminalCapabilities struct {
	Platform               string                     `json:"platform"`
	Enabled                bool                       `json:"enabled"`
	Supported              bool                       `json:"supported"`
	ConPTYAvailable        bool                       `json:"conptyAvailable"`
	IsProcessElevated      bool                       `json:"isProcessElevated"`
	SupportsElevation      bool                       `json:"supportsElevation"`
	ShellOptions           []LocalTerminalShellOption `json:"shellOptions"`
	AdminShellOptions      []LocalTerminalShellOption `json:"adminShellOptions"`
	DefaultShellPreference string                     `json:"defaultShellPreference"`
	CurrentShellPreference string                     `json:"currentShellPreference"`
	UnsupportedMessage     string                     `json:"unsupportedMessage"`
}

type LocalTerminalWriteRequest struct {
	SessionID  string `json:"sessionId"`
	DataBase64 string `json:"dataBase64"`
}

type LocalTerminalResizeRequest struct {
	SessionID string `json:"sessionId"`
	Rows      int    `json:"rows"`
	Cols      int    `json:"cols"`
}

type LocalTerminalState struct {
	SessionID string              `json:"sessionId"`
	ShellKind string              `json:"shellKind"`
	Shell     string              `json:"shell"`
	ShellName string              `json:"shellName"`
	Elevated  bool                `json:"elevated"`
	Title     string              `json:"title"`
	Cwd       string              `json:"cwd"`
	Status    LocalTerminalStatus `json:"status"`
	ExitCode  *int                `json:"exitCode"`
	Error     string              `json:"error"`
	StartedAt string              `json:"startedAt"`
	EndedAt   string              `json:"endedAt"`
}

type LocalTerminalOutputEvent struct {
	SessionID  string `json:"sessionId"`
	DataBase64 string `json:"dataBase64"`
	Timestamp  string `json:"timestamp"`
}

type LocalTerminalStateEvent struct {
	State     LocalTerminalState `json:"state"`
	Timestamp string             `json:"timestamp"`
}

type LocalTerminalErrorEvent struct {
	SessionID string `json:"sessionId"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}
