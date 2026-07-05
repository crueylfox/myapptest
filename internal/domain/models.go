package domain

type ConnectionStatus string

type AppVersionInfo struct {
	Version string `json:"version"`
}

const (
	StatusOffline         ConnectionStatus = "offline"
	StatusConnecting      ConnectionStatus = "connecting"
	StatusOnline          ConnectionStatus = "online"
	StatusReconnecting    ConnectionStatus = "reconnecting"
	StatusDisconnecting   ConnectionStatus = "disconnecting"
	StatusAuthFailed      ConnectionStatus = "auth_failed"
	StatusTimeout         ConnectionStatus = "timeout"
	StatusUnreachable     ConnectionStatus = "unreachable"
	StatusRefused         ConnectionStatus = "refused"
	StatusHostKeyMismatch ConnectionStatus = "hostkey_mismatch"
	StatusKeyError        ConnectionStatus = "key_error"
	StatusDisconnected    ConnectionStatus = "disconnected"
	StatusError           ConnectionStatus = "error"
)

type AuthType string

const (
	AuthPassword   AuthType = "password"
	AuthPrivateKey AuthType = "private_key"
)

type SecretUpdateMode string

const (
	SecretUpdateUnchanged SecretUpdateMode = "unchanged"
	SecretUpdateSet       SecretUpdateMode = "set"
	SecretUpdateDelete    SecretUpdateMode = "delete"
)

type PrivateKeySource string

const (
	PrivateKeySourceLocalFile PrivateKeySource = "local_file"
	PrivateKeySourceKeyVault  PrivateKeySource = "key_vault"
)

type ConnectionMode string

const (
	ConnectionModeDirect ConnectionMode = "direct"
	ConnectionModeJump   ConnectionMode = "jump"
)

type KeyVaultStorageMode string

const (
	KeyVaultStorageEncryptedDatabase KeyVaultStorageMode = "encrypted_database"
	KeyVaultStorageLegacyFilePath    KeyVaultStorageMode = "legacy_file_path"
)

type HostKeyPolicy string

const (
	HostKeyAutoUpdate HostKeyPolicy = "auto_update"
	HostKeyStrict     HostKeyPolicy = "strict"

	// Deprecated legacy values are accepted only for settings migration.
	HostKeyAsk             HostKeyPolicy = "ask"
	HostKeyTrustOnFirstUse HostKeyPolicy = "trust_on_first_use"
	HostKeyTrustedOnly     HostKeyPolicy = "trusted_only"
)

type ThemeMode string

const (
	ThemeDark   ThemeMode = "dark"
	ThemeLight  ThemeMode = "light"
	ThemeSystem ThemeMode = "system"
)

type UIFontSize string

const (
	UIFontSmall    UIFontSize = "small"
	UIFontStandard UIFontSize = "standard"
	UIFontLarge    UIFontSize = "large"
	UIFontXLarge   UIFontSize = "extra_large"
)

type LocalTerminalShellPreference string

const (
	LocalTerminalShellAuto       LocalTerminalShellPreference = "auto"
	LocalTerminalShellPowerShell LocalTerminalShellPreference = "powershell"
	LocalTerminalShellCmd        LocalTerminalShellPreference = "cmd"
	LocalTerminalShellZsh        LocalTerminalShellPreference = "zsh"
	LocalTerminalShellBash       LocalTerminalShellPreference = "bash"
	LocalTerminalShellSh         LocalTerminalShellPreference = "sh"
)

type DashboardSortMode string
type TerminalRightClickAction string
type TerminalContextMenuTrigger string

const (
	DashboardSortManual  DashboardSortMode = "manual"
	DashboardSortGroup   DashboardSortMode = "group"
	DashboardSortRemark  DashboardSortMode = "remark"
	DashboardSortCPU     DashboardSortMode = "cpu"
	DashboardSortMemory  DashboardSortMode = "memory"
	DashboardSortNetwork DashboardSortMode = "network"
)

const (
	TerminalRightClickPaste TerminalRightClickAction = "paste"
	TerminalRightClickMenu  TerminalRightClickAction = "menu"

	TerminalContextMenuShiftRightClick TerminalContextMenuTrigger = "shift_right_click"
	TerminalContextMenuCtrlRightClick  TerminalContextMenuTrigger = "ctrl_right_click"
	TerminalContextMenuDisabled        TerminalContextMenuTrigger = "disabled"
)

const (
	CurrentSettingsVersion             = 15
	DefaultCommandHistoryMaxEntries    = 2000
	MinimumCommandHistoryMaxEntries    = 100
	MaximumCommandHistoryMaxEntries    = 20000
	DefaultWindowWidth                 = 1360
	DefaultWindowHeight                = 1500
	DefaultAlertHistoryLimit           = 500
	MinimumAlertHistoryLimit           = 50
	MaximumAlertHistoryLimit           = 5000
	DefaultSSHKeepaliveIntervalSeconds = 30
	DefaultSSHKeepaliveTimeoutSeconds  = 10
	DefaultSSHKeepaliveMaxFailures     = 3
	MinimumSSHKeepaliveIntervalSeconds = 10
	MaximumSSHKeepaliveIntervalSeconds = 300
	MinimumSSHKeepaliveTimeoutSeconds  = 3
	MaximumSSHKeepaliveTimeoutSeconds  = 60
	MinimumSSHKeepaliveMaxFailures     = 1
	MaximumSSHKeepaliveMaxFailures     = 10
)

type OfflineAlertRuleSettings struct {
	Enabled      bool `json:"enabled"`
	GraceSeconds int  `json:"graceSeconds"`
}

type ThresholdAlertRuleSettings struct {
	Enabled         bool    `json:"enabled"`
	Threshold       float64 `json:"threshold"`
	DurationSeconds int     `json:"durationSeconds"`
}

type AlertSettings struct {
	Enabled             bool                            `json:"enabled"`
	NotifyRecovery      bool                            `json:"notifyRecovery"`
	HistoryLimit        int                             `json:"historyLimit"`
	Offline             OfflineAlertRuleSettings        `json:"offline"`
	CPU                 ThresholdAlertRuleSettings      `json:"cpu"`
	Memory              ThresholdAlertRuleSettings      `json:"memory"`
	RootDisk            ThresholdAlertRuleSettings      `json:"rootDisk"`
	Latency             ThresholdAlertRuleSettings      `json:"latency"`
	NativeNotifications NativeAlertNotificationSettings `json:"nativeNotifications"`
}

type NativeAlertNotificationSettings struct {
	Enabled bool `json:"enabled"`
}

type ShortcutSettings struct {
	TerminalCopyOnSelectEnabled bool                       `json:"terminalCopyOnSelectEnabled"`
	TerminalRightClickAction    TerminalRightClickAction   `json:"terminalRightClickAction"`
	TerminalContextMenuTrigger  TerminalContextMenuTrigger `json:"terminalContextMenuTrigger"`
	TerminalCopy                string                     `json:"terminalCopy"`
	TerminalPaste               string                     `json:"terminalPaste"`
	TerminalCompletion          string                     `json:"terminalCompletion"`
	OpenCommandHistory          string                     `json:"openCommandHistory"`
	OpenCommandFavorites        string                     `json:"openCommandFavorites"`
}

type ShortcutConflictStatus string

const (
	ShortcutConflictAvailable ShortcutConflictStatus = "available"
	ShortcutConflictOccupied  ShortcutConflictStatus = "occupied"
	ShortcutConflictReserved  ShortcutConflictStatus = "reserved"
	ShortcutConflictUnknown   ShortcutConflictStatus = "unknown"
)

type ShortcutConflictCheckRequest struct {
	Shortcuts []string `json:"shortcuts"`
}

type ShortcutConflictEntry struct {
	Shortcut string                 `json:"shortcut"`
	Status   ShortcutConflictStatus `json:"status"`
	Message  string                 `json:"message"`
}

type ShortcutConflictCheckResponse struct {
	Entries []ShortcutConflictEntry `json:"entries"`
}

type AlertHistoryEvent struct {
	EventID            string   `json:"eventID"`
	ServerID           int64    `json:"serverID"`
	ServerNameSnapshot string   `json:"serverName"`
	RuleType           string   `json:"ruleType"`
	Severity           string   `json:"severity"`
	State              string   `json:"state"`
	Source             string   `json:"source"`
	CurrentValue       *float64 `json:"currentValue,omitempty"`
	ThresholdValue     *float64 `json:"threshold,omitempty"`
	Unit               string   `json:"unit,omitempty"`
	Title              string   `json:"title"`
	Message            string   `json:"message"`
	StartedAt          string   `json:"startedAt"`
	ResolvedAt         string   `json:"resolvedAt,omitempty"`
	Read               bool     `json:"read"`
	ReadAt             string   `json:"readAt,omitempty"`
	Muted              bool     `json:"muted"`
	SessionID          string   `json:"sessionID,omitempty"`
	EndedReason        string   `json:"endedReason,omitempty"`
	CreatedAt          string   `json:"createdAt,omitempty"`
	UpdatedAt          string   `json:"updatedAt,omitempty"`
}

type BeginAlertSessionRequest struct {
	SessionID    string `json:"sessionID"`
	HistoryLimit int    `json:"historyLimit"`
}

type ListAlertHistoryRequest struct {
	Limit int `json:"limit"`
}

type PersistAlertHistoryEventRequest struct {
	Event        AlertHistoryEvent `json:"event"`
	HistoryLimit int               `json:"historyLimit"`
}

type AlertHistoryPersistResult struct {
	Persisted  bool   `json:"persisted"`
	Skipped    bool   `json:"skipped"`
	ReasonCode string `json:"reasonCode"`
}

type MarkAlertHistoryReadRequest struct {
	EventID string `json:"eventID"`
}

type ClearResolvedAlertHistoryRequest struct{}

type MarkAllAlertHistoryReadRequest struct{}

type PruneAlertHistoryRequest struct {
	HistoryLimit int    `json:"historyLimit"`
	SessionID    string `json:"sessionID"`
}

type WindowState struct {
	X           int    `json:"x"`
	Y           int    `json:"y"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	MonitorID   string `json:"monitorID"`
	IsMaximized bool   `json:"isMaximized"`
	UpdatedAt   string `json:"updatedAt"`
}

type AppSettings struct {
	DefaultRememberPassword        bool                         `json:"defaultRememberPassword"`
	DefaultRememberPassphrase      bool                         `json:"defaultRememberPassphrase"`
	TerminalCopyOnSelectEnabled    bool                         `json:"terminalCopyOnSelectEnabled"`
	TerminalRightClickPasteEnabled bool                         `json:"terminalRightClickPasteEnabled"`
	Shortcuts                      ShortcutSettings             `json:"shortcutSettings"`
	HostKeyPolicy                  HostKeyPolicy                `json:"hostKeyPolicy"`
	ThemeMode                      ThemeMode                    `json:"themeMode"`
	UIFontSize                     UIFontSize                   `json:"uiFontSize"`
	LocalTerminalShellPreference   LocalTerminalShellPreference `json:"localTerminalShellPreference"`
	LocalTerminalElevatedEnabled   bool                         `json:"localTerminalElevatedEnabled"`
	DefaultTerminalProfileID       string                       `json:"defaultTerminalProfileId"`
	CommandHistoryMaxEntries       int                          `json:"commandHistoryMaxEntries"`
	SSHKeepaliveEnabled            bool                         `json:"sshKeepaliveEnabled"`
	SSHKeepaliveIntervalSeconds    int                          `json:"sshKeepaliveIntervalSeconds"`
	SSHKeepaliveTimeoutSeconds     int                          `json:"sshKeepaliveTimeoutSeconds"`
	SSHKeepaliveMaxFailures        int                          `json:"sshKeepaliveMaxFailures"`
	ConnectionTimeoutSeconds       int                          `json:"connectionTimeoutSeconds"`
	DashboardSortMode              DashboardSortMode            `json:"dashboardSortMode"`
	DashboardManualServerOrder     []string                     `json:"dashboardManualServerOrder"`
	Alerts                         AlertSettings                `json:"alerts"`
	BackupImportOptions            BackupImportOptions          `json:"backupImportOptions"`
	WindowWidth                    int                          `json:"windowWidth"`
	WindowHeight                   int                          `json:"windowHeight"`
	WindowMaximized                bool                         `json:"windowMaximized"`
	SettingsVersion                int                          `json:"settingsVersion"`
	OnboardingCompleted            bool                         `json:"onboardingCompleted"`
	TrustOnFirstUseAcknowledged    bool                         `json:"trustOnFirstUseAcknowledged"`
}

func DefaultAppSettings() AppSettings {
	return AppSettings{
		HostKeyPolicy:                  HostKeyAutoUpdate,
		ThemeMode:                      ThemeDark,
		UIFontSize:                     UIFontLarge,
		LocalTerminalShellPreference:   LocalTerminalShellAuto,
		DefaultTerminalProfileID:       DefaultTerminalProfileID,
		CommandHistoryMaxEntries:       DefaultCommandHistoryMaxEntries,
		SSHKeepaliveEnabled:            true,
		SSHKeepaliveIntervalSeconds:    DefaultSSHKeepaliveIntervalSeconds,
		SSHKeepaliveTimeoutSeconds:     DefaultSSHKeepaliveTimeoutSeconds,
		SSHKeepaliveMaxFailures:        DefaultSSHKeepaliveMaxFailures,
		TerminalCopyOnSelectEnabled:    true,
		TerminalRightClickPasteEnabled: true,
		Shortcuts:                      DefaultShortcutSettings(),
		ConnectionTimeoutSeconds:       15,
		DashboardSortMode:              DashboardSortManual,
		DashboardManualServerOrder:     []string{},
		Alerts:                         DefaultAlertSettings(),
		BackupImportOptions:            DefaultBackupImportOptionPreferences(),
		WindowWidth:                    DefaultWindowWidth,
		WindowHeight:                   DefaultWindowHeight,
		SettingsVersion:                CurrentSettingsVersion,
		OnboardingCompleted:            true,
	}
}

func DefaultShortcutSettings() ShortcutSettings {
	return ShortcutSettings{
		TerminalCopyOnSelectEnabled: true,
		TerminalRightClickAction:    TerminalRightClickPaste,
		TerminalContextMenuTrigger:  TerminalContextMenuShiftRightClick,
		TerminalCopy:                "ctrl+shift+c",
		TerminalPaste:               "ctrl+shift+v",
		TerminalCompletion:          "ctrl+shift+a",
		OpenCommandHistory:          "ctrl+shift+h",
		OpenCommandFavorites:        "ctrl+shift+p",
	}
}

func DefaultAlertSettings() AlertSettings {
	return AlertSettings{
		Enabled:        true,
		NotifyRecovery: true,
		HistoryLimit:   DefaultAlertHistoryLimit,
		Offline: OfflineAlertRuleSettings{
			Enabled:      true,
			GraceSeconds: 20,
		},
		CPU: ThresholdAlertRuleSettings{
			Enabled:         true,
			Threshold:       90,
			DurationSeconds: 60,
		},
		Memory: ThresholdAlertRuleSettings{
			Enabled:         true,
			Threshold:       90,
			DurationSeconds: 60,
		},
		RootDisk: ThresholdAlertRuleSettings{
			Enabled:         true,
			Threshold:       90,
			DurationSeconds: 60,
		},
		Latency: ThresholdAlertRuleSettings{
			Enabled:         false,
			Threshold:       500,
			DurationSeconds: 60,
		},
		NativeNotifications: NativeAlertNotificationSettings{
			Enabled: false,
		},
	}
}

type Group struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Connection struct {
	ID                           int64                       `json:"id"`
	GroupID                      *int64                      `json:"groupId"`
	SortOrder                    int64                       `json:"sortOrder"`
	Name                         string                      `json:"name"`
	Host                         string                      `json:"host"`
	Port                         int                         `json:"port"`
	Username                     string                      `json:"username"`
	AuthType                     AuthType                    `json:"authType"`
	PrivateKeySource             PrivateKeySource            `json:"privateKeySource"`
	PrivateKeyPath               string                      `json:"privateKeyPath"`
	KeyVaultID                   *int64                      `json:"keyVaultId"`
	TerminalProfileID            *string                     `json:"terminalProfileId"`
	ConnectionMode               ConnectionMode              `json:"connectionMode"`
	JumpServerID                 *int64                      `json:"jumpServerId"`
	HostKeyFingerprint           string                      `json:"hostKeyFingerprint"`
	CredentialSaved              bool                        `json:"credentialSaved"`
	PasswordCredentialSaved      bool                        `json:"passwordCredentialSaved"`
	RefreshInterval              int                         `json:"refreshInterval"`
	NetworkInterfaceMode         MonitorNetworkInterfaceMode `json:"networkInterfaceMode"`
	SelectedNetworkInterface     string                      `json:"selectedNetworkInterface"`
	NetworkInterfaceUserSelected bool                        `json:"networkInterfaceUserSelected"`
	CreatedAt                    string                      `json:"createdAt"`
	UpdatedAt                    string                      `json:"updatedAt"`
}

type SaveConnectionRequest struct {
	ID                int64            `json:"id"`
	GroupID           *int64           `json:"groupId"`
	Name              string           `json:"name"`
	Host              string           `json:"host"`
	Port              int              `json:"port"`
	Username          string           `json:"username"`
	AuthType          AuthType         `json:"authType"`
	PrivateKeySource  PrivateKeySource `json:"privateKeySource"`
	PrivateKeyPath    string           `json:"privateKeyPath"`
	KeyVaultID        *int64           `json:"keyVaultId"`
	TerminalProfileID *string          `json:"terminalProfileId"`
	ConnectionMode    ConnectionMode   `json:"connectionMode"`
	JumpServerID      *int64           `json:"jumpServerId"`
	RefreshInterval   int              `json:"refreshInterval"`
}

type ReorderServersRequest struct {
	ServerID       int64  `json:"serverID"`
	SourceGroupID  *int64 `json:"sourceGroupID"`
	TargetGroupID  *int64 `json:"targetGroupID"`
	BeforeServerID *int64 `json:"beforeServerID"`
	AfterServerID  *int64 `json:"afterServerID"`
}

type SaveConnectionConfigRequest struct {
	Connection       SaveConnectionRequest `json:"connection"`
	Auth             AuthRequest           `json:"auth"`
	ConnectAfterSave bool                  `json:"connectAfterSave"`
}

type SaveConnectionConfigResult struct {
	Connection       Connection `json:"connection"`
	ConnectAfterSave bool       `json:"connectAfterSave"`
}

type HostKeyProbeResult struct {
	Fingerprint string `json:"fingerprint"`
}

type ConnectionReachabilityResult struct {
	Reachable       bool             `json:"reachable"`
	ConnectionError *ConnectionError `json:"connectionError,omitempty"`
}

type TrustHostKeyRequest struct {
	ConnectionID        int64  `json:"connectionId"`
	ExpectedFingerprint string `json:"expectedFingerprint"`
}

type AuthRequest struct {
	Password               string           `json:"password"`
	Passphrase             string           `json:"passphrase"`
	TrustUnknownHost       bool             `json:"trustUnknownHost"`
	RememberSecret         bool             `json:"rememberSecret"`
	SecretUpdateMode       SecretUpdateMode `json:"secretUpdateMode,omitempty"`
	TrustChangedHost       bool             `json:"-"`
	PersistHostKey         bool             `json:"-"`
	ResolvedFromStore      bool             `json:"-"`
	ResolvedPrivateKeyPath string           `json:"-"`
	ResolvedPrivateKeyPEM  []byte           `json:"-"`
	ResolvedKeyVaultID     int64            `json:"-"`
}

type KeyVaultEntry struct {
	ID                         int64  `json:"id"`
	Name                       string `json:"name"`
	PrivateKeyPath             string `json:"privateKeyPath"`
	StorageMode                string `json:"storageMode"`
	SourceFileName             string `json:"sourceFileName"`
	Algorithm                  string `json:"algorithm"`
	KeyBits                    int    `json:"keyBits"`
	PublicKeyFingerprintSHA256 string `json:"publicKeyFingerprintSHA256"`
	Encrypted                  bool   `json:"encrypted"`
	RequiresPassphrase         bool   `json:"requiresPassphrase"`
	ProtectionVersion          int    `json:"protectionVersion"`
	ProtectedKeyBlob           []byte `json:"-"`
	PassphraseCredentialRef    string `json:"-"`
	PassphraseSaved            bool   `json:"passphraseSaved"`
	UsageCount                 int    `json:"usageCount"`
	Notes                      string `json:"notes"`
	CreatedAt                  string `json:"createdAt"`
	UpdatedAt                  string `json:"updatedAt"`
	LastUsedAt                 string `json:"lastUsedAt"`
}

type SaveKeyVaultEntryRequest struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	PrivateKeyPath     string `json:"privateKeyPath"`
	Passphrase         string `json:"passphrase"`
	RememberPassphrase bool   `json:"rememberPassphrase"`
	UpdatePassphrase   bool   `json:"updatePassphrase"`
	DeletePassphrase   bool   `json:"deletePassphrase"`
	Notes              string `json:"notes"`
}

type ValidatePrivateKeyFileRequest struct {
	PrivateKeyPath string `json:"privateKeyPath"`
	Passphrase     string `json:"passphrase"`
}

type PrivateKeyValidationResult struct {
	Algorithm         string `json:"algorithm"`
	FingerprintSHA256 string `json:"fingerprintSHA256"`
	KeyBits           int    `json:"keyBits"`
	Encrypted         bool   `json:"encrypted"`
	Valid             bool   `json:"valid"`
	ErrorCode         string `json:"errorCode"`
	UserMessage       string `json:"userMessage"`
	TechnicalMessage  string `json:"technicalMessage"`
}

type KeyVaultUsage struct {
	ConnectionID   int64  `json:"connectionId"`
	ConnectionName string `json:"connectionName"`
}

type DeleteKeyVaultEntryRequest struct {
	ID          int64 `json:"id"`
	ForceUnbind bool  `json:"forceUnbind"`
}

type DeleteKeyVaultEntryResponse struct {
	Deleted              bool     `json:"deleted"`
	RequiresConfirmation bool     `json:"requiresConfirmation"`
	UnboundServerCount   int      `json:"unboundServerCount"`
	UnboundServerNames   []string `json:"unboundServerNames"`
	SecretCleanupWarning string   `json:"secretCleanupWarning"`
}

type AuthenticationState struct {
	ConnectionID        int64  `json:"connectionId"`
	CanAuthenticate     bool   `json:"canAuthenticate"`
	CredentialSaved     bool   `json:"credentialSaved"`
	CredentialUsable    bool   `json:"credentialUsable"`
	PrivateKeyEncrypted bool   `json:"privateKeyEncrypted"`
	HostTrusted         bool   `json:"hostTrusted"`
	ReasonCode          string `json:"reasonCode"`
	Message             string `json:"message"`
}

type ConnectRequest struct {
	ConnectionID      int64       `json:"connectionId"`
	ContextID         string      `json:"contextId"`
	TerminalSessionID string      `json:"terminalSessionId"`
	Auth              AuthRequest `json:"auth"`
}

type OpenTerminalRequest struct {
	ConnectionID int64       `json:"connectionId"`
	Auth         AuthRequest `json:"auth"`
	Columns      int         `json:"columns"`
	Rows         int         `json:"rows"`
}

type ReconnectTerminalRequest struct {
	SessionID    string      `json:"sessionId"`
	ConnectionID int64       `json:"connectionId"`
	Auth         AuthRequest `json:"auth"`
	Columns      int         `json:"columns"`
	Rows         int         `json:"rows"`
}

type TerminalWriteRequest struct {
	SessionID  string `json:"sessionId"`
	DataBase64 string `json:"dataBase64"`
}

type TerminalResizeRequest struct {
	SessionID string `json:"sessionId"`
	Columns   int    `json:"columns"`
	Rows      int    `json:"rows"`
}

type SFTPStatus string

const (
	SFTPStatusOffline    SFTPStatus = "offline"
	SFTPStatusConnecting SFTPStatus = "connecting"
	SFTPStatusOnline     SFTPStatus = "online"
	SFTPStatusError      SFTPStatus = "error"
)

type SFTPMode string

const (
	SFTPModeSFTP SFTPMode = "sftp"
	SFTPModeSCP  SFTPMode = "scp"
)

type SFTPBrowseCapability string

const (
	SFTPBrowseFull SFTPBrowseCapability = "full"
	SFTPBrowseNone SFTPBrowseCapability = "none"
)

type SFTPCapabilities struct {
	Browse            SFTPBrowseCapability `json:"browse"`
	UploadFile        bool                 `json:"uploadFile"`
	DownloadFile      bool                 `json:"downloadFile"`
	UploadDirectory   bool                 `json:"uploadDirectory"`
	DownloadDirectory bool                 `json:"downloadDirectory"`
	Mkdir             bool                 `json:"mkdir"`
	Rename            bool                 `json:"rename"`
	Delete            bool                 `json:"delete"`
	EditText          bool                 `json:"editText"`
}

type SFTPTransferDirection string

const (
	SFTPTransferUpload   SFTPTransferDirection = "upload"
	SFTPTransferDownload SFTPTransferDirection = "download"
)

type SFTPTransferStatus string

const (
	SFTPTransferQueued        SFTPTransferStatus = "queued"
	SFTPTransferPlanning      SFTPTransferStatus = "planning"
	SFTPTransferRunning       SFTPTransferStatus = "running"
	SFTPTransferPausing       SFTPTransferStatus = "pausing"
	SFTPTransferPaused        SFTPTransferStatus = "paused"
	SFTPTransferResuming      SFTPTransferStatus = "resuming"
	SFTPTransferCompleted     SFTPTransferStatus = "completed"
	SFTPTransferPartialFailed SFTPTransferStatus = "partial_failed"
	SFTPTransferFailed        SFTPTransferStatus = "failed"
	SFTPTransferCanceled      SFTPTransferStatus = "canceled"
	SFTPTransferSkipped       SFTPTransferStatus = "skipped"
)

type SFTPConflictPolicy string

const (
	SFTPConflictAsk       SFTPConflictPolicy = "ask"
	SFTPConflictOverwrite SFTPConflictPolicy = "overwrite"
	SFTPConflictSkip      SFTPConflictPolicy = "skip"
	SFTPConflictRename    SFTPConflictPolicy = "rename"
)

type SFTPState struct {
	ConnectionID      int64            `json:"connectionId"`
	ContextID         string           `json:"contextId"`
	TerminalSessionID string           `json:"terminalSessionId"`
	Generation        int64            `json:"generation"`
	Status            SFTPStatus       `json:"status"`
	Active            bool             `json:"active"`
	Mode              SFTPMode         `json:"mode"`
	Capabilities      SFTPCapabilities `json:"capabilities"`
	CurrentPath       string           `json:"currentPath"`
	Message           string           `json:"message"`
	UpdatedAt         string           `json:"updatedAt"`
}

type SFTPEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	ParentPath  string `json:"parentPath"`
	Size        int64  `json:"size"`
	IsDir       bool   `json:"isDir"`
	IsSymlink   bool   `json:"isSymlink"`
	Permissions string `json:"permissions"`
	Owner       string `json:"owner"`
	Group       string `json:"group"`
	ModTime     string `json:"modTime"`
}

type SFTPStatRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	Path              string `json:"path"`
}

type SFTPItemPropertiesRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	Generation        int64  `json:"generation"`
	RequestID         string `json:"requestId"`
	Path              string `json:"path"`
}

type SFTPUpdateItemPermissionsRequest struct {
	ConnectionID        int64  `json:"connectionId"`
	ContextID           string `json:"contextId"`
	TerminalSessionID   string `json:"terminalSessionId"`
	Generation          int64  `json:"generation"`
	RequestID           string `json:"requestId"`
	Path                string `json:"path"`
	Mode                uint32 `json:"mode"`
	PreserveSpecialBits bool   `json:"preserveSpecialBits"`
}

type SFTPItemProperties struct {
	ConnectionID      int64     `json:"connectionId"`
	ContextID         string    `json:"contextId"`
	TerminalSessionID string    `json:"terminalSessionId"`
	Generation        int64     `json:"generation"`
	RequestID         string    `json:"requestId"`
	Path              string    `json:"path"`
	Name              string    `json:"name"`
	Type              string    `json:"type"`
	Size              int64     `json:"size"`
	ModTime           string    `json:"modTime"`
	Permissions       string    `json:"permissions"`
	Mode              uint32    `json:"mode"`
	Owner             string    `json:"owner"`
	Group             string    `json:"group"`
	IsDir             bool      `json:"isDir"`
	IsSymlink         bool      `json:"isSymlink"`
	SymlinkTarget     string    `json:"symlinkTarget"`
	Entry             SFTPEntry `json:"entry"`
}

type SFTPReadTextFileRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	Path              string `json:"path"`
	MaxBytes          int64  `json:"maxBytes"`
	RequestID         string `json:"requestId"`
}

type SFTPReadTextFileResult struct {
	ConnectionID     int64     `json:"connectionId"`
	ContextID        string    `json:"contextId"`
	Generation       int64     `json:"generation"`
	RequestID        string    `json:"requestId"`
	Path             string    `json:"path"`
	Name             string    `json:"name"`
	Size             int64     `json:"size"`
	Encoding         string    `json:"encoding"`
	ContentHash      string    `json:"contentHash"`
	Truncated        bool      `json:"truncated"`
	Content          string    `json:"content"`
	DetectedLanguage string    `json:"detectedLanguage"`
	TextKind         string    `json:"textKind"`
	Entry            SFTPEntry `json:"entry"`
}

type SFTPTextSaveMode string
type SFTPTextConflictPolicy string

const (
	SFTPTextSaveExisting SFTPTextSaveMode = "save_existing"
	SFTPTextCreateNew    SFTPTextSaveMode = "create_new"
	SFTPTextSaveAs       SFTPTextSaveMode = "save_as"

	SFTPTextFailIfChanged SFTPTextConflictPolicy = "fail_if_changed"
	SFTPTextFailIfExists  SFTPTextConflictPolicy = "fail_if_exists"
	SFTPTextOverwrite     SFTPTextConflictPolicy = "overwrite"
)

type SFTPWriteTextFileRequest struct {
	ConnectionID      int64                  `json:"connectionId"`
	ContextID         string                 `json:"contextId"`
	TerminalSessionID string                 `json:"terminalSessionId"`
	Path              string                 `json:"path"`
	Content           string                 `json:"content"`
	ExpectedSize      int64                  `json:"expectedSize"`
	ExpectedMTime     string                 `json:"expectedMTime"`
	ExpectedHash      string                 `json:"expectedHash"`
	Encoding          string                 `json:"encoding"`
	Generation        int64                  `json:"generation"`
	RequestID         string                 `json:"requestId"`
	Mode              SFTPTextSaveMode       `json:"mode"`
	ConflictPolicy    SFTPTextConflictPolicy `json:"conflictPolicy"`
	ForceOverwrite    bool                   `json:"forceOverwrite"`
}

type SFTPWriteTextFileResult struct {
	ConnectionID int64     `json:"connectionId"`
	ContextID    string    `json:"contextId"`
	Generation   int64     `json:"generation"`
	RequestID    string    `json:"requestId"`
	Path         string    `json:"path"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	Encoding     string    `json:"encoding"`
	ContentHash  string    `json:"contentHash"`
	Entry        SFTPEntry `json:"entry"`
}

type SFTPContextRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	RequestID         string `json:"requestId"`
}

type SFTPListRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	Path              string `json:"path"`
	RequestID         string `json:"requestId"`
}

type SFTPListResult struct {
	ConnectionID int64       `json:"connectionId"`
	ContextID    string      `json:"contextId"`
	Generation   int64       `json:"generation"`
	RequestID    string      `json:"requestId"`
	Mode         SFTPMode    `json:"mode"`
	Path         string      `json:"path"`
	ParentPath   string      `json:"parentPath"`
	Entries      []SFTPEntry `json:"entries"`
}

type SFTPPathRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	Path              string `json:"path"`
}

type SFTPMkdirRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	Path              string `json:"path"`
}

type SFTPRenameRequest struct {
	ConnectionID      int64  `json:"connectionId"`
	ContextID         string `json:"contextId"`
	TerminalSessionID string `json:"terminalSessionId"`
	OldPath           string `json:"oldPath"`
	NewPath           string `json:"newPath"`
}

type SFTPDeleteRequest struct {
	ConnectionID      int64    `json:"connectionId"`
	ContextID         string   `json:"contextId"`
	TerminalSessionID string   `json:"terminalSessionId"`
	Path              string   `json:"path"`
	Paths             []string `json:"paths"`
	IsDir             bool     `json:"isDir"`
	Recursive         bool     `json:"recursive"`
	ConfirmToken      string   `json:"confirmToken"`
	ExpectedFileDir   string   `json:"expectedFileDir"`
}

type SFTPInspectDeleteRequest struct {
	ConnectionID      int64    `json:"connectionId"`
	ContextID         string   `json:"contextId"`
	TerminalSessionID string   `json:"terminalSessionId"`
	Paths             []string `json:"paths"`
	Recursive         bool     `json:"recursive"`
}

type SFTPInspectDeleteResponse struct {
	ConnectionID      int64    `json:"connectionId"`
	ContextID         string   `json:"contextId"`
	Paths             []string `json:"paths"`
	FileCount         int      `json:"fileCount"`
	DirectoryCount    int      `json:"directoryCount"`
	SymlinkCount      int      `json:"symlinkCount"`
	TotalBytes        int64    `json:"totalBytes"`
	Warnings          []string `json:"warnings"`
	RequiresRecursive bool     `json:"requiresRecursive"`
}

type SFTPTransferRequest struct {
	ConnectionID      int64              `json:"connectionId"`
	ContextID         string             `json:"contextId"`
	TerminalSessionID string             `json:"terminalSessionId"`
	LocalPath         string             `json:"localPath"`
	RemotePath        string             `json:"remotePath"`
	ConflictPolicy    SFTPConflictPolicy `json:"conflictPolicy"`
	ExpectedFileDir   string             `json:"expectedFileDir"`
}

type SFTPUploadDirectoryRequest struct {
	ConnectionID      int64              `json:"connectionId"`
	ContextID         string             `json:"contextId"`
	TerminalSessionID string             `json:"terminalSessionId"`
	LocalPath         string             `json:"localPath"`
	RemoteDirectory   string             `json:"remoteDirectory"`
	ConflictPolicy    SFTPConflictPolicy `json:"conflictPolicy"`
	ExpectedFileDir   string             `json:"expectedFileDir"`
}

type SFTPDownloadDirectoryRequest struct {
	ConnectionID      int64              `json:"connectionId"`
	ContextID         string             `json:"contextId"`
	TerminalSessionID string             `json:"terminalSessionId"`
	RemotePath        string             `json:"remotePath"`
	LocalDirectory    string             `json:"localDirectory"`
	ConflictPolicy    SFTPConflictPolicy `json:"conflictPolicy"`
	ExpectedFileDir   string             `json:"expectedFileDir"`
}

type SFTPTransferResult struct {
	ConnectionID int64  `json:"connectionId"`
	TransferID   string `json:"transferId"`
	LocalPath    string `json:"localPath"`
	RemotePath   string `json:"remotePath"`
	Bytes        int64  `json:"bytes"`
}

type SFTPTransferState struct {
	ID                    string                `json:"id"`
	ConnectionID          int64                 `json:"connectionId"`
	ContextID             string                `json:"contextId"`
	TerminalSessionID     string                `json:"terminalSessionId"`
	Generation            int64                 `json:"generation"`
	Mode                  SFTPMode              `json:"mode"`
	Direction             SFTPTransferDirection `json:"direction"`
	Recursive             bool                  `json:"recursive"`
	SourceType            string                `json:"sourceType"`
	LocalPath             string                `json:"localPath"`
	RemotePath            string                `json:"remotePath"`
	FileName              string                `json:"fileName"`
	CurrentFile           string                `json:"currentFile"`
	TotalBytes            int64                 `json:"totalBytes"`
	TransferredBytes      int64                 `json:"transferredBytes"`
	CurrentFileBytesDone  int64                 `json:"currentFileBytesDone"`
	CurrentFileBytesTotal int64                 `json:"currentFileBytesTotal"`
	ResumeOffset          int64                 `json:"resumeOffset"`
	FilesTotal            int                   `json:"filesTotal"`
	FilesDone             int                   `json:"filesDone"`
	FailedCount           int                   `json:"failedCount"`
	SkippedCount          int                   `json:"skippedCount"`
	Percent               float64               `json:"percent"`
	SpeedBytesPerSecond   float64               `json:"speedBytesPerSecond"`
	Status                SFTPTransferStatus    `json:"status"`
	ErrorMessage          string                `json:"errorMessage"`
	PauseRequested        bool                  `json:"pauseRequested"`
	CancelRequested       bool                  `json:"cancelRequested"`
	CanPause              bool                  `json:"canPause"`
	CanResume             bool                  `json:"canResume"`
	CanCancel             bool                  `json:"canCancel"`
	Cancelable            bool                  `json:"cancelable"`
	StartedAt             string                `json:"startedAt"`
	FinishedAt            string                `json:"finishedAt"`
}

type SFTPTransferCancelRequest struct {
	TransferID string `json:"transferId"`
	ContextID  string `json:"contextId"`
}

type SFTPTransferControlRequest struct {
	ConnectionID int64  `json:"serverID"`
	ContextID    string `json:"contextID"`
	TransferID   string `json:"transferID"`
}

type SFTPTransferControlResponse struct {
	TransferID string             `json:"transferID"`
	Status     SFTPTransferStatus `json:"status"`
}

type SFTPErrorEvent struct {
	ConnectionID int64  `json:"connectionId"`
	ContextID    string `json:"contextId"`
	Generation   int64  `json:"generation"`
	RequestID    string `json:"requestId"`
	Operation    string `json:"operation"`
	Code         string `json:"code"`
	Message      string `json:"message"`
	Technical    string `json:"technical"`
	UpdatedAt    string `json:"updatedAt"`
}

type TestConnectionResult struct {
	Success            bool             `json:"success"`
	LatencyMillis      int64            `json:"latencyMillis"`
	HostKeyFingerprint string           `json:"hostKeyFingerprint"`
	ErrorCode          string           `json:"errorCode"`
	Message            string           `json:"message"`
	ConnectionError    *ConnectionError `json:"connectionError,omitempty"`
}

type ConnectionError struct {
	Code                 string `json:"code"`
	UserMessage          string `json:"userMessage"`
	TechnicalMessage     string `json:"technicalMessage"`
	Retryable            bool   `json:"retryable"`
	ServerID             int64  `json:"serverId"`
	Operation            string `json:"operation"`
	Timestamp            string `json:"timestamp"`
	Stage                string `json:"stage,omitempty"`
	CredentialServerID   int64  `json:"credentialServerId,omitempty"`
	CredentialServerName string `json:"credentialServerName,omitempty"`
	CredentialFromStore  bool   `json:"credentialFromStore,omitempty"`
	ExpectedFingerprint  string `json:"expectedFingerprint,omitempty"`
	ObservedFingerprint  string `json:"observedFingerprint,omitempty"`
}

type ConnectionRuntimeState struct {
	ConnectionID       int64            `json:"connectionId"`
	Status             ConnectionStatus `json:"status"`
	MonitorActive      bool             `json:"monitorActive"`
	TerminalActive     bool             `json:"terminalActive"`
	TerminalConnecting bool             `json:"terminalConnecting"`
	SFTPActive         bool             `json:"sftpActive"`
	Connecting         bool             `json:"connecting"`
	HasActiveSession   bool             `json:"hasActiveSession"`
	LastError          *ConnectionError `json:"lastError,omitempty"`
	UpdatedAt          string           `json:"updatedAt"`
}

type MetricError struct {
	Metric  string `json:"metric"`
	Message string `json:"message"`
}

type DiskMount struct {
	Filesystem  string  `json:"filesystem"`
	MountPath   string  `json:"mountPath"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	UsedPercent float64 `json:"usedPercent"`
}

type ProcessInfo struct {
	PID           int64   `json:"pid"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	Command       string  `json:"command"`
}

type ProcessStatus string

const (
	ProcessLoading     ProcessStatus = "loading"
	ProcessAvailable   ProcessStatus = "available"
	ProcessEmpty       ProcessStatus = "empty"
	ProcessUnsupported ProcessStatus = "unsupported"
	ProcessFailed      ProcessStatus = "failed"
)

type MonitorNetworkInterfaceMode string

const (
	MonitorNetworkInterfaceAll      MonitorNetworkInterfaceMode = "all"
	MonitorNetworkInterfaceSpecific MonitorNetworkInterfaceMode = "interface"
	MonitorNetworkInterfacePhysical MonitorNetworkInterfaceMode = "physical"
	MonitorNetworkInterfaceDocker   MonitorNetworkInterfaceMode = "docker"
)

type NetworkInterface struct {
	ServerID      int64    `json:"serverID"`
	Name          string   `json:"name"`
	DisplayName   string   `json:"displayName"`
	IsUp          bool     `json:"isUp"`
	IsLoopback    bool     `json:"isLoopback"`
	IPv4          []string `json:"ipv4"`
	IPv6          []string `json:"ipv6"`
	MAC           string   `json:"mac,omitempty"`
	RXBytes       uint64   `json:"rxBytes"`
	TXBytes       uint64   `json:"txBytes"`
	RXPackets     uint64   `json:"rxPackets,omitempty"`
	TXPackets     uint64   `json:"txPackets,omitempty"`
	SpeedMbps     *int64   `json:"speedMbps,omitempty"`
	MTU           *int64   `json:"mtu,omitempty"`
	LastUpdatedAt string   `json:"lastUpdatedAt"`
}

type ListNetworkInterfacesRequest struct {
	ServerID int64 `json:"serverID"`
}

type ListNetworkInterfacesResponse struct {
	ServerID                   int64              `json:"serverID"`
	Interfaces                 []NetworkInterface `json:"interfaces"`
	UpdatedAt                  string             `json:"updatedAt"`
	RecommendedInterface       string             `json:"recommendedInterface"`
	RecommendedInterfaceReason string             `json:"recommendedInterfaceReason"`
}

type SetMonitorNetworkInterfaceRequest struct {
	ServerID                 int64                       `json:"serverID"`
	Mode                     MonitorNetworkInterfaceMode `json:"mode"`
	SelectedNetworkInterface string                      `json:"selectedNetworkInterface"`
	UserSelected             bool                        `json:"userSelected"`
}

type MonitorNetworkInterfacePreference struct {
	ServerID                 int64                       `json:"serverID"`
	Mode                     MonitorNetworkInterfaceMode `json:"mode"`
	SelectedNetworkInterface string                      `json:"selectedNetworkInterface"`
	UserSelected             bool                        `json:"userSelected"`
	UpdatedAt                string                      `json:"updatedAt"`
}

type NetworkDiagnosticType string

const (
	NetworkDiagnosticPing       NetworkDiagnosticType = "ping"
	NetworkDiagnosticTraceroute NetworkDiagnosticType = "traceroute"
	NetworkDiagnosticDNS        NetworkDiagnosticType = "dns"
	NetworkDiagnosticTCP        NetworkDiagnosticType = "tcp"
)

type NetworkDiagnosticStatus string

const (
	NetworkDiagnosticRunning   NetworkDiagnosticStatus = "running"
	NetworkDiagnosticCompleted NetworkDiagnosticStatus = "completed"
	NetworkDiagnosticFailed    NetworkDiagnosticStatus = "failed"
	NetworkDiagnosticCanceled  NetworkDiagnosticStatus = "canceled"
)

type StartNetworkDiagnosticRequest struct {
	ServerID       int64                 `json:"serverID"`
	Type           NetworkDiagnosticType `json:"type"`
	Target         string                `json:"target"`
	Port           int                   `json:"port,omitempty"`
	Count          int                   `json:"count,omitempty"`
	TimeoutSeconds int                   `json:"timeoutSeconds,omitempty"`
}

type CancelNetworkDiagnosticRequest struct {
	ServerID int64  `json:"serverID"`
	TaskID   string `json:"taskID"`
}

type NetworkDiagnosticTask struct {
	TaskID    string                  `json:"taskID"`
	ServerID  int64                   `json:"serverID"`
	Type      NetworkDiagnosticType   `json:"type"`
	Target    string                  `json:"target"`
	Port      int                     `json:"port,omitempty"`
	Status    NetworkDiagnosticStatus `json:"status"`
	StartedAt string                  `json:"startedAt"`
	EndedAt   string                  `json:"endedAt,omitempty"`
	Error     string                  `json:"error,omitempty"`
}

type NetworkDiagnosticStateEvent struct {
	ServerID  int64                 `json:"serverID"`
	TaskID    string                `json:"taskID"`
	Timestamp string                `json:"timestamp"`
	Task      NetworkDiagnosticTask `json:"task"`
}

type NetworkDiagnosticOutputEvent struct {
	ServerID  int64  `json:"serverID"`
	TaskID    string `json:"taskID"`
	Timestamp string `json:"timestamp"`
	Line      string `json:"line"`
	Stream    string `json:"stream"`
}

type NetworkDiagnosticErrorEvent struct {
	ServerID  int64  `json:"serverID"`
	TaskID    string `json:"taskID"`
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
	Code      string `json:"code"`
}

type MonitorSnapshot struct {
	ConnectionID              int64                       `json:"connectionId"`
	Status                    ConnectionStatus            `json:"status"`
	Timestamp                 string                      `json:"timestamp"`
	LatencyMillis             int64                       `json:"latencyMillis"`
	LatencyAvailable          bool                        `json:"latencyAvailable"`
	CPUPercent                *float64                    `json:"cpuPercent"`
	MemoryTotal               uint64                      `json:"memoryTotal"`
	MemoryAvailable           uint64                      `json:"memoryAvailable"`
	MemoryUsedPercent         *float64                    `json:"memoryUsedPercent"`
	SwapTotal                 uint64                      `json:"swapTotal"`
	SwapFree                  uint64                      `json:"swapFree"`
	DiskTotal                 uint64                      `json:"diskTotal"`
	DiskUsed                  uint64                      `json:"diskUsed"`
	DiskUsedPercent           *float64                    `json:"diskUsedPercent"`
	Mounts                    []DiskMount                 `json:"mounts"`
	Processes                 []ProcessInfo               `json:"processes"`
	ProcessStatus             ProcessStatus               `json:"processStatus"`
	ProcessMessage            string                      `json:"processMessage"`
	LoadOne                   *float64                    `json:"loadOne"`
	LoadFive                  *float64                    `json:"loadFive"`
	LoadFifteen               *float64                    `json:"loadFifteen"`
	UptimeSeconds             *float64                    `json:"uptimeSeconds"`
	DefaultInterface          string                      `json:"defaultInterface"`
	NetworkInterfaceMode      MonitorNetworkInterfaceMode `json:"networkInterfaceMode"`
	SelectedNetworkInterface  string                      `json:"selectedNetworkInterface"`
	EffectiveNetworkInterface string                      `json:"effectiveNetworkInterface"`
	NetworkInterfaceFallback  bool                        `json:"networkInterfaceFallback"`
	NetworkInterfaceMessage   string                      `json:"networkInterfaceMessage"`
	DownloadBytesPerSecond    *float64                    `json:"downloadBytesPerSecond"`
	UploadBytesPerSecond      *float64                    `json:"uploadBytesPerSecond"`
	OSName                    string                      `json:"osName"`
	Kernel                    string                      `json:"kernel"`
	Architecture              string                      `json:"architecture"`
	Errors                    []MetricError               `json:"errors"`
	ErrorCode                 string                      `json:"errorCode"`
	Message                   string                      `json:"message"`
	MonitorActive             bool                        `json:"monitorActive"`
	ConnectionError           *ConnectionError            `json:"connectionError,omitempty"`
}

type LogEntry struct {
	Time             string `json:"time"`
	Level            string `json:"level"`
	Message          string `json:"message"`
	Summary          string `json:"summary"`
	ServerName       string `json:"serverName,omitempty"`
	ConnectionID     int64  `json:"connectionId,omitempty"`
	Operation        string `json:"operation,omitempty"`
	Error            string `json:"error,omitempty"`
	TechnicalMessage string `json:"technicalMessage,omitempty"`
	ErrorCode        string `json:"errorCode,omitempty"`
}
