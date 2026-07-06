package backup

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"

	"serverpilot/internal/domain"
	"serverpilot/internal/keyvault"
	"serverpilot/internal/secretstore"
)

const (
	formatName    = "serverpilot-backup"
	envelopeVer   = 1
	payloadSchema = 1

	kdfName    = "argon2id"
	cipherName = "xchacha20-poly1305"

	defaultArgonTime        uint32 = 3
	defaultArgonMemoryKiB   uint32 = 64 * 1024
	defaultArgonParallelism uint8  = 2

	maxArgonTime        uint32 = 6
	maxArgonMemoryKiB   uint32 = 256 * 1024
	maxArgonParallelism uint8  = 8
)

var (
	ErrPasswordRequired     = errors.New("BACKUP_PASSWORD_REQUIRED: 请输入备份密码")
	ErrPasswordMismatch     = errors.New("BACKUP_PASSWORD_MISMATCH: 两次输入的备份密码不一致")
	ErrWeakPassword         = errors.New("BACKUP_WEAK_PASSWORD: 备份密码至少需要 6 个字符。")
	ErrInvalidBackupFile    = errors.New("BACKUP_FILE_INVALID: 备份文件格式无效或已损坏")
	ErrUnsupportedVersion   = errors.New("BACKUP_VERSION_UNSUPPORTED: 备份版本不受支持")
	ErrPasswordOrTampered   = errors.New("BACKUP_PASSWORD_INCORRECT: 备份密码错误，或备份文件已被篡改")
	ErrKDFParametersInvalid = errors.New("BACKUP_FILE_INVALID: 备份文件 KDF 参数超出安全限制")
)

var ErrFullBackupUnavailable = errors.New("BACKUP_FULL_UNAVAILABLE: 完整备份无法读取已保存凭据")

type Store interface {
	ExportBackupPayload(context.Context) (domain.BackupPayload, error)
	ExportBackupSecretRefs(context.Context) ([]domain.BackupSecretRef, error)
	InspectBackupPayload(context.Context, domain.BackupPayload) (domain.BackupPreview, error)
	ImportBackupPayload(context.Context, domain.BackupPayload, domain.BackupImportOptions) (domain.BackupImportPayloadResult, error)
	ApplyBackupSecretRefs(context.Context, []domain.BackupSecretRestore) error
}

type inlineSecretExporter interface {
	ExportBackupInlineSecrets(context.Context) ([]domain.BackupSecret, error)
}

type Service struct {
	store     Store
	secrets   secretstore.Store
	protector keyvault.KeyMaterialProtector
}

func New(store Store, secrets ...secretstore.Store) *Service {
	var secretStore secretstore.Store
	if len(secrets) > 0 {
		secretStore = secrets[0]
	}
	return &Service{store: store, secrets: secretStore, protector: keyvault.NewPlatformProtector()}
}

type envelope struct {
	Format    string         `json:"format"`
	Version   int            `json:"version"`
	CreatedAt string         `json:"createdAt"`
	App       string         `json:"app"`
	KDF       kdfEnvelope    `json:"kdf"`
	Cipher    cipherEnvelope `json:"cipher"`
	Payload   string         `json:"payload"`
}

type kdfEnvelope struct {
	Name        string `json:"name"`
	Time        uint32 `json:"time"`
	MemoryKiB   uint32 `json:"memoryKiB"`
	Parallelism uint8  `json:"parallelism"`
	Salt        string `json:"salt"`
}

type cipherEnvelope struct {
	Name  string `json:"name"`
	Nonce string `json:"nonce"`
}

func (s *Service) Export(ctx context.Context, request domain.BackupExportRequest) (domain.BackupExportResult, error) {
	path := strings.TrimSpace(request.Path)
	if path == "" {
		return domain.BackupExportResult{}, errors.New("BACKUP_WRITE_FAILED: 请选择备份保存位置")
	}
	if err := validateExportPassword(request.Password, request.ConfirmPassword); err != nil {
		return domain.BackupExportResult{}, err
	}
	mode, err := normalizeBackupMode(request.Mode)
	if err != nil {
		return domain.BackupExportResult{}, err
	}
	payload, err := s.store.ExportBackupPayload(ctx)
	if err != nil {
		return domain.BackupExportResult{}, fmt.Errorf("BACKUP_READ_FAILED: 读取备份数据失败: %w", err)
	}
	payload.SchemaVersion = payloadSchema
	payload.Mode = mode
	payload.ExportedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if mode == domain.BackupModeFull {
		payload.Secrets, err = s.exportSecrets(ctx)
		if err != nil {
			return domain.BackupExportResult{}, err
		}
	}
	contents, createdAt, err := encryptPayload(payload, request.Password)
	if err != nil {
		return domain.BackupExportResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return domain.BackupExportResult{}, fmt.Errorf("BACKUP_WRITE_FAILED: 创建备份目录失败: %w", err)
	}
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		return domain.BackupExportResult{}, fmt.Errorf("BACKUP_WRITE_FAILED: 写入备份文件失败: %w", err)
	}
	info, _ := os.Stat(path)
	return domain.BackupExportResult{
		Path:              path,
		CreatedAt:         createdAt,
		Mode:              string(mode),
		Groups:            len(payload.Groups),
		Connections:       len(payload.Connections),
		KeyVaultEntries:   len(payload.KeyVault),
		HostTrustRecords:  countHostTrust(payload.Connections),
		SecretEntries:     len(payload.Secrets),
		EncryptedFileSize: fileSize(info),
	}, nil
}

func (s *Service) Inspect(ctx context.Context, request domain.BackupInspectRequest) (domain.BackupPreview, error) {
	payload, env, err := s.decryptFile(request.Path, request.Password)
	if err != nil {
		return domain.BackupPreview{}, err
	}
	preview, err := s.store.InspectBackupPayload(ctx, payload)
	if err != nil {
		return domain.BackupPreview{}, fmt.Errorf("BACKUP_READ_FAILED: 生成导入预览失败: %w", err)
	}
	preview.Format = env.Format
	preview.Version = env.Version
	preview.CreatedAt = env.CreatedAt
	preview.ExportedAt = payload.ExportedAt
	preview.SchemaVersion = payload.SchemaVersion
	preview.SettingsCount = settingsCount(payload.Settings)
	preview.GroupCount = len(payload.Groups)
	preview.ConnectionCount = len(payload.Connections)
	preview.KeyVaultCount = len(payload.KeyVault)
	preview.HostTrustCount = countHostTrust(payload.Connections)
	preview.CredentialsNotice = credentialsNoticeFor(payload.Mode)
	return preview, nil
}

func (s *Service) Import(ctx context.Context, request domain.BackupImportRequest) (domain.BackupImportResult, error) {
	payload, _, err := s.decryptFile(request.Path, request.Password)
	if err != nil {
		return domain.BackupImportResult{}, err
	}
	defer func() { wipeBackupSecrets(payload.Secrets) }()
	if payload.Mode == domain.BackupModeFull {
		if err := s.preparePortableKeyVaultSecretsForImport(&payload); err != nil {
			return domain.BackupImportResult{}, err
		}
	}
	options := request.Options
	result, err := s.store.ImportBackupPayload(ctx, payload, options)
	if err != nil {
		return domain.BackupImportResult{}, fmt.Errorf("BACKUP_IMPORT_ROLLBACK: 导入失败，已回滚所有更改: %w", err)
	}
	secretsRestored := 0
	warnings := append([]domain.BackupWarning(nil), result.Warnings...)
	if payload.Mode == domain.BackupModeFull && len(result.SecretRestores) > 0 {
		restored, secretWarnings, err := s.restoreSecrets(ctx, result.SecretRestores)
		if err != nil {
			return domain.BackupImportResult{}, err
		}
		secretsRestored = restored
		warnings = append(warnings, secretWarnings...)
	}
	return domain.BackupImportResult{
		GroupsAdded:       result.GroupsAdded,
		ConnectionsAdded:  result.ConnectionsAdded,
		KeyVaultAdded:     result.KeyVaultAdded,
		HostTrustImported: result.HostTrustImported,
		SecretsRestored:   secretsRestored,
		Skipped:           result.Skipped,
		Renamed:           result.Renamed,
		Warnings:          warnings,
		CredentialsNotice: credentialsNoticeFor(payload.Mode),
	}, nil
}

func (s *Service) decryptFile(path, password string) (domain.BackupPayload, envelope, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return domain.BackupPayload{}, envelope{}, errors.New("BACKUP_READ_FAILED: 请选择备份文件")
	}
	if password == "" {
		return domain.BackupPayload{}, envelope{}, ErrPasswordRequired
	}
	if len([]rune(password)) < 6 {
		return domain.BackupPayload{}, envelope{}, ErrWeakPassword
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return domain.BackupPayload{}, envelope{}, fmt.Errorf("BACKUP_READ_FAILED: 读取备份文件失败: %w", err)
	}
	payload, env, err := decryptPayload(contents, password)
	if err != nil {
		return domain.BackupPayload{}, envelope{}, err
	}
	return payload, env, nil
}

func (s *Service) exportSecrets(ctx context.Context) ([]domain.BackupSecret, error) {
	if s.secrets == nil {
		return nil, ErrFullBackupUnavailable
	}
	refs, err := s.store.ExportBackupSecretRefs(ctx)
	if err != nil {
		return nil, fmt.Errorf("BACKUP_READ_FAILED: 读取凭据引用失败: %w", err)
	}
	out := make([]domain.BackupSecret, 0, len(refs))
	if exporter, ok := s.store.(inlineSecretExporter); ok {
		inline, err := exporter.ExportBackupInlineSecrets(ctx)
		if err != nil {
			return nil, fmt.Errorf("BACKUP_READ_FAILED: read key vault encrypted material failed: %w", err)
		}
		portable, err := s.exportPortableKeyVaultMaterial(inline)
		if err != nil {
			return nil, err
		}
		out = append(out, portable...)
	}
	for _, ref := range refs {
		value, err := s.secrets.Get(ctx, ref.Reference)
		if err != nil {
			return nil, fmt.Errorf("%w: %s/%d/%s", ErrFullBackupUnavailable, ref.Scope, ref.OwnerID, ref.Kind)
		}
		out = append(out, domain.BackupSecret{
			Scope:   ref.Scope,
			OwnerID: ref.OwnerID,
			Kind:    ref.Kind,
			Value:   append([]byte(nil), value...),
		})
		wipeBytes(value)
	}
	return out, nil
}

func (s *Service) exportPortableKeyVaultMaterial(secrets []domain.BackupSecret) ([]domain.BackupSecret, error) {
	out := make([]domain.BackupSecret, 0, len(secrets))
	for _, secret := range secrets {
		if secret.Scope != domain.BackupSecretScopeKeyVault || secret.Kind != domain.BackupSecretKindProtectedKeyBlob {
			out = append(out, cloneBackupSecret(secret))
			continue
		}
		if s.protector == nil {
			return nil, fmt.Errorf("%w: key_vault/%d/private_key_material", ErrFullBackupUnavailable, secret.OwnerID)
		}
		plaintext, err := s.protector.Unprotect(secret.Value)
		if err != nil {
			return nil, fmt.Errorf("%w: key_vault/%d/private_key_material", ErrFullBackupUnavailable, secret.OwnerID)
		}
		out = append(out, domain.BackupSecret{
			Scope:   domain.BackupSecretScopeKeyVault,
			OwnerID: secret.OwnerID,
			Kind:    domain.BackupSecretKindPrivateKeyMaterial,
			Value:   append([]byte(nil), plaintext...),
		})
		wipeBytes(plaintext)
		wipeBytes(secret.Value)
	}
	return out, nil
}

func (s *Service) preparePortableKeyVaultSecretsForImport(payload *domain.BackupPayload) error {
	if payload == nil || len(payload.Secrets) == 0 {
		return nil
	}
	converted := make([]domain.BackupSecret, 0, len(payload.Secrets))
	for _, secret := range payload.Secrets {
		if secret.Scope != domain.BackupSecretScopeKeyVault || secret.Kind != domain.BackupSecretKindPrivateKeyMaterial {
			converted = append(converted, cloneBackupSecret(secret))
			continue
		}
		if s.protector == nil {
			return errors.New("BACKUP_KEY_VAULT_REPROTECT_FAILED: key vault protector is unavailable")
		}
		protected, err := s.protector.Protect(secret.Value)
		if err != nil {
			return fmt.Errorf("BACKUP_KEY_VAULT_REPROTECT_FAILED: save portable key vault material: %w", err)
		}
		converted = append(converted, domain.BackupSecret{
			Scope:   domain.BackupSecretScopeKeyVault,
			OwnerID: secret.OwnerID,
			Kind:    domain.BackupSecretKindProtectedKeyBlob,
			Value:   append([]byte(nil), protected...),
		})
		wipeBytes(protected)
		wipeBytes(secret.Value)
	}
	payload.Secrets = converted
	return nil
}

func cloneBackupSecret(secret domain.BackupSecret) domain.BackupSecret {
	secret.Value = append([]byte(nil), secret.Value...)
	return secret
}

func wipeBackupSecrets(secrets []domain.BackupSecret) {
	for _, secret := range secrets {
		wipeBytes(secret.Value)
	}
}

func (s *Service) restoreSecrets(ctx context.Context, restores []domain.BackupSecretRestore) (int, []domain.BackupWarning, error) {
	if s.secrets == nil {
		return 0, []domain.BackupWarning{{
			Code:    "BACKUP_SECRET_REENTER_REQUIRED",
			Message: "系统凭据库不可用，导入后需要重新输入密码/私钥口令。",
		}}, nil
	}
	written := make([]string, 0, len(restores))
	writtenRestores := make([]domain.BackupSecretRestore, 0, len(restores))
	warnings := []domain.BackupWarning{}
	for _, restore := range restores {
		value := append([]byte(nil), restore.Value...)
		if err := s.secrets.Set(ctx, restore.Reference, value); err != nil {
			wipeBytes(value)
			warnings = append(warnings, domain.BackupWarning{
				Code:    "BACKUP_SECRET_REENTER_REQUIRED",
				Message: "部分凭据未能写入系统凭据库，导入后需要重新输入密码/私钥口令。",
			})
			continue
		}
		wipeBytes(value)
		written = append(written, restore.Reference)
		writtenRestores = append(writtenRestores, restore)
	}
	if len(writtenRestores) == 0 {
		return 0, warnings, nil
	}
	if err := s.store.ApplyBackupSecretRefs(ctx, writtenRestores); err != nil {
		for _, ref := range written {
			_ = s.secrets.Delete(ctx, ref)
		}
		return 0, warnings, fmt.Errorf("BACKUP_SECRET_RESTORE_FAILED: 保存凭据引用失败: %w", err)
	}
	return len(writtenRestores), warnings, nil
}

func encryptPayload(payload domain.BackupPayload, password string) ([]byte, string, error) {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}
	defer wipeBytes(plaintext)
	salt, err := randomBytes(32)
	if err != nil {
		return nil, "", fmt.Errorf("BACKUP_WRITE_FAILED: 生成备份随机 salt 失败: %w", err)
	}
	nonce, err := randomBytes(chacha20poly1305.NonceSizeX)
	if err != nil {
		return nil, "", fmt.Errorf("BACKUP_WRITE_FAILED: 生成备份随机 nonce 失败: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, defaultArgonTime, defaultArgonMemoryKiB, defaultArgonParallelism, chacha20poly1305.KeySize)
	defer wipeBytes(key)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, "", err
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, nil)
	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	env := envelope{
		Format:    formatName,
		Version:   envelopeVer,
		CreatedAt: createdAt,
		App:       "ServerPilot",
		KDF: kdfEnvelope{
			Name:        kdfName,
			Time:        defaultArgonTime,
			MemoryKiB:   defaultArgonMemoryKiB,
			Parallelism: defaultArgonParallelism,
			Salt:        base64.StdEncoding.EncodeToString(salt),
		},
		Cipher: cipherEnvelope{
			Name:  cipherName,
			Nonce: base64.StdEncoding.EncodeToString(nonce),
		},
		Payload: base64.StdEncoding.EncodeToString(ciphertext),
	}
	encoded, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return nil, "", err
	}
	return encoded, createdAt, nil
}

func decryptPayload(contents []byte, password string) (domain.BackupPayload, envelope, error) {
	var env envelope
	if err := json.Unmarshal(contents, &env); err != nil {
		return domain.BackupPayload{}, envelope{}, ErrInvalidBackupFile
	}
	if err := validateEnvelope(env); err != nil {
		return domain.BackupPayload{}, envelope{}, err
	}
	salt, err := base64.StdEncoding.DecodeString(env.KDF.Salt)
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return domain.BackupPayload{}, envelope{}, ErrInvalidBackupFile
	}
	nonce, err := base64.StdEncoding.DecodeString(env.Cipher.Nonce)
	if err != nil || len(nonce) != chacha20poly1305.NonceSizeX {
		return domain.BackupPayload{}, envelope{}, ErrInvalidBackupFile
	}
	ciphertext, err := base64.StdEncoding.DecodeString(env.Payload)
	if err != nil || len(ciphertext) == 0 {
		return domain.BackupPayload{}, envelope{}, ErrInvalidBackupFile
	}
	key := argon2.IDKey([]byte(password), salt, env.KDF.Time, env.KDF.MemoryKiB, env.KDF.Parallelism, chacha20poly1305.KeySize)
	defer wipeBytes(key)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return domain.BackupPayload{}, envelope{}, ErrInvalidBackupFile
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return domain.BackupPayload{}, envelope{}, ErrPasswordOrTampered
	}
	defer wipeBytes(plaintext)
	var payload domain.BackupPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		return domain.BackupPayload{}, envelope{}, ErrInvalidBackupFile
	}
	if payload.Mode == "" {
		payload.Mode = domain.BackupModeStandard
	}
	if payload.SchemaVersion != payloadSchema {
		return domain.BackupPayload{}, envelope{}, ErrUnsupportedVersion
	}
	if err := validatePayload(payload); err != nil {
		return domain.BackupPayload{}, envelope{}, err
	}
	return payload, env, nil
}

func validateEnvelope(env envelope) error {
	if env.Format != formatName || env.KDF.Name != kdfName || env.Cipher.Name != cipherName {
		return ErrInvalidBackupFile
	}
	if env.Version != envelopeVer {
		return ErrUnsupportedVersion
	}
	if env.KDF.Time == 0 || env.KDF.Time > maxArgonTime ||
		env.KDF.MemoryKiB < 8*1024 || env.KDF.MemoryKiB > maxArgonMemoryKiB ||
		env.KDF.Parallelism == 0 || env.KDF.Parallelism > maxArgonParallelism {
		return ErrKDFParametersInvalid
	}
	return nil
}

func validatePayload(payload domain.BackupPayload) error {
	if _, err := normalizeBackupMode(string(payload.Mode)); err != nil {
		return err
	}
	if payload.Settings != nil {
		if err := validateSettings(*payload.Settings); err != nil {
			return err
		}
	}
	for _, group := range payload.Groups {
		if strings.TrimSpace(group.Name) == "" {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效分组")
		}
	}
	for _, connection := range payload.Connections {
		request := domain.SaveConnectionRequest{
			Name:             connection.Name,
			GroupID:          connection.GroupID,
			Host:             connection.Host,
			Port:             connection.Port,
			Username:         connection.Username,
			AuthType:         connection.AuthType,
			PrivateKeySource: backupConnectionPrivateKeySource(connection),
			PrivateKeyPath:   connection.PrivateKeyPath,
			KeyVaultID:       connection.KeyVaultID,
			RefreshInterval:  connection.RefreshInterval,
		}
		if err := domain.ValidateConnection(request); err != nil {
			return fmt.Errorf("BACKUP_FILE_INVALID: 备份包含无效服务器配置: %w", err)
		}
	}
	for _, key := range payload.KeyVault {
		if strings.TrimSpace(key.Name) == "" || strings.TrimSpace(key.PublicKeyFingerprintSHA256) == "" {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效 Key Vault 元数据")
		}
	}
	if payload.Mode != domain.BackupModeFull && len(payload.Secrets) > 0 {
		return errors.New("BACKUP_FILE_INVALID: 标准备份不能包含凭据快照")
	}
	for _, secret := range payload.Secrets {
		if !validSecretScope(secret.Scope) || strings.TrimSpace(secret.Kind) == "" || secret.OwnerID <= 0 || len(secret.Value) == 0 {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效凭据快照")
		}
	}
	return nil
}

func backupConnectionPrivateKeySource(connection domain.BackupConnection) domain.PrivateKeySource {
	if connection.AuthType == domain.AuthPrivateKey &&
		connection.KeyVaultID != nil &&
		*connection.KeyVaultID > 0 &&
		(connection.PrivateKeySource == "" ||
			connection.PrivateKeySource == domain.PrivateKeySourceKeyVault ||
			strings.TrimSpace(connection.PrivateKeyPath) == "") {
		return domain.PrivateKeySourceKeyVault
	}
	if connection.PrivateKeySource != "" {
		return connection.PrivateKeySource
	}
	return domain.PrivateKeySourceLocalFile
}

func normalizeBackupMode(value string) (domain.BackupMode, error) {
	switch domain.BackupMode(strings.TrimSpace(value)) {
	case "", domain.BackupModeStandard:
		return domain.BackupModeStandard, nil
	case domain.BackupModeFull:
		return domain.BackupModeFull, nil
	default:
		return "", errors.New("BACKUP_FILE_INVALID: 备份模式无效")
	}
}

func validSecretScope(scope string) bool {
	switch scope {
	case "connection", "key_vault":
		return true
	default:
		return false
	}
}

func validateSettings(value domain.AppSettings) error {
	switch value.HostKeyPolicy {
	case domain.HostKeyAutoUpdate, domain.HostKeyStrict,
		domain.HostKeyAsk, domain.HostKeyTrustOnFirstUse, domain.HostKeyTrustedOnly:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效主机指纹策略")
	}
	switch value.ThemeMode {
	case domain.ThemeDark, domain.ThemeLight, domain.ThemeSystem:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效主题设置")
	}
	switch value.UIFontSize {
	case domain.UIFontSmall, domain.UIFontStandard, domain.UIFontLarge, domain.UIFontXLarge:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效界面字体设置")
	}
	switch value.LocalTerminalShellPreference {
	case "", domain.LocalTerminalShellAuto, domain.LocalTerminalShellPowerShell, domain.LocalTerminalShellCmd,
		domain.LocalTerminalShellZsh, domain.LocalTerminalShellBash, domain.LocalTerminalShellSh:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效本地终端 shell 设置")
	}
	if value.SettingsVersion >= 13 {
		if err := validateShortcutSettings(value.Shortcuts); err != nil {
			return err
		}
	}
	switch value.ConnectionTimeoutSeconds {
	case 5, 10, 15, 30:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效连接超时设置")
	}
	if value.SettingsVersion >= 9 ||
		value.SSHKeepaliveIntervalSeconds != 0 ||
		value.SSHKeepaliveTimeoutSeconds != 0 ||
		value.SSHKeepaliveMaxFailures != 0 {
		if value.SSHKeepaliveIntervalSeconds < domain.MinimumSSHKeepaliveIntervalSeconds ||
			value.SSHKeepaliveIntervalSeconds > domain.MaximumSSHKeepaliveIntervalSeconds {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效 SSH 保活间隔设置")
		}
		if value.SSHKeepaliveTimeoutSeconds < domain.MinimumSSHKeepaliveTimeoutSeconds ||
			value.SSHKeepaliveTimeoutSeconds > domain.MaximumSSHKeepaliveTimeoutSeconds {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效 SSH 保活超时设置")
		}
		if value.SSHKeepaliveMaxFailures < domain.MinimumSSHKeepaliveMaxFailures ||
			value.SSHKeepaliveMaxFailures > domain.MaximumSSHKeepaliveMaxFailures {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效 SSH 保活失败次数设置")
		}
	}
	if value.SettingsVersion >= 11 {
		if value.Alerts.Offline.GraceSeconds < 5 || value.Alerts.Offline.GraceSeconds > 300 {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效离线告警设置")
		}
		if thresholdAlertInvalid(value.Alerts.CPU, 50, 100) ||
			thresholdAlertInvalid(value.Alerts.Memory, 50, 100) ||
			thresholdAlertInvalid(value.Alerts.RootDisk, 50, 100) ||
			thresholdAlertInvalid(value.Alerts.Latency, 50, 5000) {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效阈值告警设置")
		}
	}
	return nil
}

func validateShortcutSettings(value domain.ShortcutSettings) error {
	switch value.TerminalRightClickAction {
	case domain.TerminalRightClickPaste, domain.TerminalRightClickMenu:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效终端右键行为设置")
	}
	switch value.TerminalContextMenuTrigger {
	case domain.TerminalContextMenuShiftRightClick,
		domain.TerminalContextMenuCtrlRightClick,
		domain.TerminalContextMenuDisabled:
	default:
		return errors.New("BACKUP_FILE_INVALID: 备份包含无效终端菜单快捷方式")
	}
	for _, binding := range []string{
		value.TerminalCopy,
		value.TerminalPaste,
		value.TerminalCompletion,
		value.OpenCommandHistory,
		value.OpenCommandFavorites,
	} {
		if !validShortcutBinding(binding) {
			return errors.New("BACKUP_FILE_INVALID: 备份包含无效快捷键绑定")
		}
	}
	return nil
}

func validShortcutBinding(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "disabled",
		"ctrl+space",
		"ctrl+shift+a",
		"ctrl+shift+c",
		"ctrl+shift+v",
		"ctrl+shift+h",
		"ctrl+shift+p",
		"ctrl+alt+c",
		"ctrl+alt+v",
		"ctrl+alt+h",
		"ctrl+alt+p":
		return true
	default:
		return false
	}
}

func thresholdAlertInvalid(value domain.ThresholdAlertRuleSettings, min, max float64) bool {
	return value.Threshold < min ||
		value.Threshold > max ||
		value.DurationSeconds < 15 ||
		value.DurationSeconds > 600
}

func validateExportPassword(password, confirm string) error {
	if password == "" {
		return ErrPasswordRequired
	}
	if password != confirm {
		return ErrPasswordMismatch
	}
	if len([]rune(password)) < 6 {
		return ErrWeakPassword
	}
	return nil
}

func randomBytes(size int) ([]byte, error) {
	out := make([]byte, size)
	if _, err := rand.Read(out); err != nil {
		return nil, err
	}
	return out, nil
}

func wipeBytes(value []byte) {
	for i := range value {
		value[i] = 0
	}
}

func countHostTrust(connections []domain.BackupConnection) int {
	count := 0
	for _, connection := range connections {
		if connection.HostKeyFingerprint != "" {
			count++
		}
	}
	return count
}

func credentialsNotice() string {
	return "备份不会包含已保存密码、私钥口令、私钥文件正文或系统凭据引用；导入后需要重新输入凭据。"
}

func credentialsNoticeFor(mode domain.BackupMode) string {
	if mode == domain.BackupModeFull {
		return "完整备份包含已保存服务器密码和本地文件私钥口令；不会包含 Key Vault 私钥密文、私钥正文或 Key Vault 口令。"
	}
	return credentialsNotice()
}

func settingsCount(settings *domain.AppSettings) int {
	if settings == nil {
		return 0
	}
	return 1
}

func fileSize(info os.FileInfo) int64 {
	if info == nil {
		return 0
	}
	return info.Size()
}
