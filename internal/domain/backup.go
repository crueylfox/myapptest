package domain

type BackupMode string

const (
	BackupModeStandard BackupMode = "standard"
	BackupModeFull     BackupMode = "full"
)

type BackupExportRequest struct {
	Path            string `json:"path"`
	Password        string `json:"password"`
	ConfirmPassword string `json:"confirmPassword"`
	Mode            string `json:"mode"`
}

type BackupExportResult struct {
	Path              string `json:"path"`
	CreatedAt         string `json:"createdAt"`
	Mode              string `json:"mode"`
	Groups            int    `json:"groups"`
	Connections       int    `json:"connections"`
	KeyVaultEntries   int    `json:"keyVaultEntries"`
	HostTrustRecords  int    `json:"hostTrustRecords"`
	SecretEntries     int    `json:"secretEntries"`
	EncryptedFileSize int64  `json:"encryptedFileSize"`
}

type BackupInspectRequest struct {
	Path     string `json:"path"`
	Password string `json:"password"`
}

type BackupImportRequest struct {
	Path     string              `json:"path"`
	Password string              `json:"password"`
	Options  BackupImportOptions `json:"options"`
}

type BackupImportOptions struct {
	ImportSettings  bool `json:"importSettings"`
	ImportGroups    bool `json:"importGroups"`
	ImportServers   bool `json:"importServers"`
	ImportKeyVault  bool `json:"importKeyVault"`
	ImportHostTrust bool `json:"importHostTrust"`
}

func DefaultBackupImportOptions() BackupImportOptions {
	return BackupImportOptions{
		ImportSettings:  true,
		ImportGroups:    true,
		ImportServers:   true,
		ImportKeyVault:  true,
		ImportHostTrust: false,
	}
}

func DefaultBackupImportOptionPreferences() BackupImportOptions {
	return BackupImportOptions{
		ImportSettings:  true,
		ImportGroups:    true,
		ImportServers:   true,
		ImportKeyVault:  true,
		ImportHostTrust: true,
	}
}

type BackupPreview struct {
	Format                string           `json:"format"`
	Version               int              `json:"version"`
	CreatedAt             string           `json:"createdAt"`
	ExportedAt            string           `json:"exportedAt"`
	SchemaVersion         int              `json:"schemaVersion"`
	SettingsCount         int              `json:"settingsCount"`
	GroupCount            int              `json:"groupCount"`
	ConnectionCount       int              `json:"connectionCount"`
	KeyVaultCount         int              `json:"keyVaultCount"`
	HostTrustCount        int              `json:"hostTrustCount"`
	MissingPrivateKeyPath int              `json:"missingPrivateKeyPath"`
	ConflictCount         int              `json:"conflictCount"`
	Warnings              []BackupWarning  `json:"warnings"`
	Conflicts             []BackupConflict `json:"conflicts"`
	CredentialsNotice     string           `json:"credentialsNotice"`
}

type BackupImportResult struct {
	GroupsAdded       int             `json:"groupsAdded"`
	ConnectionsAdded  int             `json:"connectionsAdded"`
	KeyVaultAdded     int             `json:"keyVaultAdded"`
	HostTrustImported int             `json:"hostTrustImported"`
	SecretsRestored   int             `json:"secretsRestored"`
	Skipped           int             `json:"skipped"`
	Renamed           int             `json:"renamed"`
	Warnings          []BackupWarning `json:"warnings"`
	CredentialsNotice string          `json:"credentialsNotice"`
}

type BackupImportPayloadResult struct {
	GroupsAdded       int
	ConnectionsAdded  int
	KeyVaultAdded     int
	HostTrustImported int
	Skipped           int
	Renamed           int
	Warnings          []BackupWarning
	SecretRestores    []BackupSecretRestore
}

type BackupConflict struct {
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Message string `json:"message"`
}

type BackupWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type BackupPayload struct {
	SchemaVersion    int                     `json:"schemaVersion"`
	Mode             BackupMode              `json:"mode"`
	ExportedAt       string                  `json:"exportedAt"`
	Settings         *AppSettings            `json:"settings,omitempty"`
	Groups           []BackupGroup           `json:"groups"`
	Connections      []BackupConnection      `json:"connections"`
	TerminalProfiles []BackupTerminalProfile `json:"terminalProfiles,omitempty"`
	TunnelProfiles   []BackupTunnelProfile   `json:"tunnelProfiles,omitempty"`
	KeyVault         []BackupKeyVaultEntry   `json:"keyVault"`
	Secrets          []BackupSecret          `json:"secrets,omitempty"`
}

type BackupGroup struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type BackupConnection struct {
	ID                           int64                       `json:"id"`
	GroupID                      *int64                      `json:"groupId"`
	SortOrder                    int64                       `json:"sortOrder,omitempty"`
	Name                         string                      `json:"name"`
	Host                         string                      `json:"host"`
	Port                         int                         `json:"port"`
	Username                     string                      `json:"username"`
	AuthType                     AuthType                    `json:"authType"`
	PrivateKeySource             PrivateKeySource            `json:"privateKeySource"`
	PrivateKeyPath               string                      `json:"privateKeyPath"`
	KeyVaultID                   *int64                      `json:"keyVaultId"`
	TerminalProfileID            *string                     `json:"terminalProfileId,omitempty"`
	ConnectionMode               ConnectionMode              `json:"connectionMode,omitempty"`
	JumpServerID                 *int64                      `json:"jumpServerId,omitempty"`
	HostKeyFingerprint           string                      `json:"hostKeyFingerprint"`
	RefreshInterval              int                         `json:"refreshInterval"`
	NetworkInterfaceMode         MonitorNetworkInterfaceMode `json:"networkInterfaceMode,omitempty"`
	SelectedNetworkInterface     string                      `json:"selectedNetworkInterface,omitempty"`
	NetworkInterfaceUserSelected bool                        `json:"networkInterfaceUserSelected,omitempty"`
	CreatedAt                    string                      `json:"createdAt"`
	UpdatedAt                    string                      `json:"updatedAt"`
}

type BackupKeyVaultEntry struct {
	ID                         int64  `json:"id"`
	Name                       string `json:"name"`
	PrivateKeyPath             string `json:"privateKeyPath"`
	StorageMode                string `json:"storageMode,omitempty"`
	SourceFileName             string `json:"sourceFileName,omitempty"`
	Algorithm                  string `json:"algorithm"`
	KeyBits                    int    `json:"keyBits,omitempty"`
	PublicKeyFingerprintSHA256 string `json:"publicKeyFingerprintSHA256"`
	Encrypted                  bool   `json:"encrypted"`
	Notes                      string `json:"notes"`
	CreatedAt                  string `json:"createdAt"`
	UpdatedAt                  string `json:"updatedAt"`
	LastUsedAt                 string `json:"lastUsedAt"`
}

type BackupSecret struct {
	Scope   string `json:"scope"`
	OwnerID int64  `json:"ownerId"`
	Kind    string `json:"kind"`
	Value   []byte `json:"value"`
}

const (
	BackupSecretScopeConnection = "connection"
	BackupSecretScopeKeyVault   = "key_vault"

	BackupSecretKindProtectedKeyBlob   = "protected_key_blob"
	BackupSecretKindPrivateKeyMaterial = "private_key_material"
)

type BackupSecretRef struct {
	Scope     string
	OwnerID   int64
	Kind      string
	Reference string
}

type BackupSecretRestore struct {
	Scope     string
	OwnerID   int64
	Kind      string
	Reference string
	Value     []byte
}
