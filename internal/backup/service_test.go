package backup

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"serverpilot/internal/commands"
	"serverpilot/internal/domain"
	"serverpilot/internal/keyvault"
	"serverpilot/internal/persistence"
	"serverpilot/internal/secretstore"
)

type memorySecrets struct {
	values map[string][]byte
}

type failingSecrets struct{}

func newMemorySecrets() *memorySecrets {
	return &memorySecrets{values: map[string][]byte{}}
}

func (s *memorySecrets) Get(_ context.Context, key string) ([]byte, error) {
	value, ok := s.values[key]
	if !ok {
		return nil, secretstore.ErrNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *memorySecrets) Set(_ context.Context, key string, value []byte) error {
	s.values[key] = append([]byte(nil), value...)
	return nil
}

func (s *memorySecrets) Delete(_ context.Context, key string) error {
	delete(s.values, key)
	return nil
}

func (failingSecrets) Get(context.Context, string) ([]byte, error) {
	return nil, secretstore.ErrNotFound
}

func (failingSecrets) Set(context.Context, string, []byte) error {
	return errors.New("system credential store unavailable")
}

func (failingSecrets) Delete(context.Context, string) error {
	return nil
}

func TestExportEncryptsBusinessDataAndInspectRejectsWrongPassword(t *testing.T) {
	ctx := context.Background()
	store := newBackupStore(t)
	seedBackupData(t, ctx, store)
	service := New(store)
	path := filepath.Join(t.TempDir(), "serverpilot.spbackup")

	result, err := service.Export(ctx, domain.BackupExportRequest{
		Path: path, Password: "correct horse battery", ConfirmPassword: "correct horse battery",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Groups != 1 || result.Connections != 2 || result.KeyVaultEntries != 1 || result.HostTrustRecords != 1 {
		t.Fatalf("unexpected export counts: %+v", result)
	}
	contents := string(readFile(t, path))
	for _, forbidden := range []string{
		"prod-server", "192.0.2.55", "deploy", "/tmp/serverpilot-id_ed25519",
		"credential-ref", "passphrase-ref", "test-password", "test-passphrase",
	} {
		if strings.Contains(contents, forbidden) {
			t.Fatalf("backup file contains plaintext %q", forbidden)
		}
	}
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: path, Password: "wrong password"}); !errors.Is(err, ErrPasswordOrTampered) {
		t.Fatalf("wrong password error=%v", err)
	}
}

func TestBackupPayloadDoesNotIncludeProcessRuntimeState(t *testing.T) {
	ctx := context.Background()
	store := newBackupStore(t)
	seedBackupData(t, ctx, store)
	service := New(store)
	path := filepath.Join(t.TempDir(), "serverpilot.spbackup")
	password := "correct horse battery"
	if _, err := service.Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password,
	}); err != nil {
		t.Fatal(err)
	}
	payload, _, err := decryptPayload(readFile(t, path), password)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Settings == nil ||
		payload.Settings.SSHKeepaliveEnabled ||
		payload.Settings.SSHKeepaliveIntervalSeconds != 45 ||
		payload.Settings.SSHKeepaliveTimeoutSeconds != 12 ||
		payload.Settings.SSHKeepaliveMaxFailures != 4 ||
		payload.Settings.DashboardSortMode != domain.DashboardSortNetwork ||
		len(payload.Settings.DashboardManualServerOrder) != 2 ||
		payload.Settings.DashboardManualServerOrder[0] != "2" ||
		payload.Settings.DashboardManualServerOrder[1] != "1" ||
		payload.Settings.Alerts.CPU.Threshold != 82 ||
		payload.Settings.Alerts.CPU.DurationSeconds != 45 ||
		payload.Settings.Alerts.Latency.Threshold != 700 ||
		!payload.Settings.Alerts.Latency.Enabled {
		t.Fatalf("backup payload missing keepalive settings: %+v", payload.Settings)
	}
	contents, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"processes", "processDetail", "cmdline", "watchID", "signalProcess",
		"environmentRedacted", "openFilesCount",
	} {
		if strings.Contains(string(contents), forbidden) {
			t.Fatalf("backup payload contains process runtime field %q", forbidden)
		}
	}
}

func TestBackupPayloadSchemaExcludesRuntimeContentAndLogs(t *testing.T) {
	payloadType := reflect.TypeOf(domain.BackupPayload{})
	forbidden := []string{
		"terminal output",
		"remote file content",
		"local file content",
		"docker log",
		"docker logs",
		"container log",
		"container logs",
	}
	for index := 0; index < payloadType.NumField(); index++ {
		field := payloadType.Field(index)
		candidate := strings.ToLower(field.Name + " " + field.Tag.Get("json"))
		for _, marker := range forbidden {
			if strings.Contains(candidate, marker) || strings.Contains(strings.ReplaceAll(candidate, " ", ""), strings.ReplaceAll(marker, " ", "")) {
				t.Fatalf("backup payload schema includes runtime content field %q with json tag %q", field.Name, field.Tag.Get("json"))
			}
		}
	}
}

func TestStandardBackupExportsOnlyKeyVaultMetadataAndRebindsByFingerprint(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	sourceKey := createEncryptedBackupKey(t, ctx, source, "source-key", "SHA256:shared", "BEGIN OPENSSH PRIVATE KEY source")
	if err := source.SetKeyVaultPassphraseRef(ctx, sourceKey.ID, "source-key-passphrase-ref"); err != nil {
		t.Fatal(err)
	}
	sourceKeyID := sourceKey.ID
	if _, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "shared-key-server", Host: "203.0.113.10", Port: 22, Username: "deploy",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &sourceKeyID, RefreshInterval: 2,
	}); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "serverpilot-keyvault.spbackup")
	password := "correct horse battery"
	if _, err := New(source, newMemorySecrets()).Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password,
	}); err != nil {
		t.Fatal(err)
	}
	payload, _, err := decryptPayload(readFile(t, path), password)
	if err != nil {
		t.Fatal(err)
	}
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"BEGIN OPENSSH PRIVATE KEY", "source-key-passphrase-ref"} {
		if strings.Contains(string(encodedPayload), forbidden) {
			t.Fatalf("backup payload contains key vault secret material %q", forbidden)
		}
	}
	if len(payload.KeyVault) != 1 ||
		payload.KeyVault[0].PrivateKeyPath != "" ||
		payload.KeyVault[0].StorageMode != string(domain.KeyVaultStorageEncryptedDatabase) ||
		payload.KeyVault[0].SourceFileName != "id_ed25519" {
		t.Fatalf("key vault metadata = %+v", payload.KeyVault)
	}
	if len(payload.Secrets) != 0 {
		t.Fatalf("key vault passphrase should not be exported as a portable secret: %+v", payload.Secrets)
	}

	target := newBackupStore(t)
	_ = createEncryptedBackupKey(t, ctx, target, "other-key", "SHA256:other", "BEGIN OPENSSH PRIVATE KEY other")
	localKey := createEncryptedBackupKey(t, ctx, target, "local-shared", "SHA256:shared", "BEGIN OPENSSH PRIVATE KEY local")
	importResult, err := New(target).Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{ImportSettings: false, ImportGroups: false, ImportServers: true, ImportKeyVault: true, ImportHostTrust: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if importResult.KeyVaultAdded != 0 || len(importResult.Warnings) == 0 {
		t.Fatalf("import result = %+v", importResult)
	}
	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 1 || connections[0].KeyVaultID == nil || *connections[0].KeyVaultID != localKey.ID {
		t.Fatalf("connection was not rebound to local key: %+v, local=%+v", connections, localKey)
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 {
		t.Fatalf("import should not create path-only key vault records: %+v", keys)
	}
}

func TestStandardBackupImportsKeyVaultMetadataWhenNoLocalFingerprintExists(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	sourceKey := createEncryptedBackupKey(t, ctx, source, "source-key", "SHA256:metadata-only", "BEGIN OPENSSH PRIVATE KEY source")
	sourceKeyID := sourceKey.ID
	if _, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "metadata-key-server", Host: "203.0.113.14", Port: 22, Username: "deploy",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &sourceKeyID, RefreshInterval: 2,
	}); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "serverpilot-keyvault-metadata.spbackup")
	password := "correct horse battery"
	if _, err := New(source, newMemorySecrets()).Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password,
	}); err != nil {
		t.Fatal(err)
	}

	target := newBackupStore(t)
	importResult, err := New(target).Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{ImportSettings: false, ImportGroups: false, ImportServers: true, ImportKeyVault: true, ImportHostTrust: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if importResult.KeyVaultAdded != 1 {
		t.Fatalf("metadata key vault entry was not imported: %+v", importResult)
	}
	if !hasBackupWarning(importResult.Warnings, "KEY_VAULT_RESELECT_REQUIRED") {
		t.Fatalf("missing key vault reselect warning: %+v", importResult.Warnings)
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 ||
		keys[0].Name != "source-key" ||
		keys[0].StorageMode != string(domain.KeyVaultStorageEncryptedDatabase) ||
		keys[0].PublicKeyFingerprintSHA256 != "SHA256:metadata-only" ||
		len(keys[0].ProtectedKeyBlob) != 0 ||
		keys[0].PassphraseSaved {
		t.Fatalf("metadata key vault entry not imported safely: %+v", keys)
	}
	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 1 || connections[0].KeyVaultID == nil || *connections[0].KeyVaultID != keys[0].ID {
		t.Fatalf("connection was not rebound to imported key vault metadata: connections=%+v keys=%+v", connections, keys)
	}
}

func TestBackupTamperingAndKDFLimitsAreRejected(t *testing.T) {
	ctx := context.Background()
	store := newBackupStore(t)
	seedBackupData(t, ctx, store)
	service := New(store)
	path := filepath.Join(t.TempDir(), "serverpilot.spbackup")
	password := "correct horse battery"
	if _, err := service.Export(ctx, domain.BackupExportRequest{Path: path, Password: password, ConfirmPassword: password}); err != nil {
		t.Fatal(err)
	}
	var env envelope
	if err := json.Unmarshal(readFile(t, path), &env); err != nil {
		t.Fatal(err)
	}

	tamperedPayload := env
	ciphertext, err := base64.StdEncoding.DecodeString(tamperedPayload.Payload)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 0x7f
	tamperedPayload.Payload = base64.StdEncoding.EncodeToString(ciphertext)
	tamperedPath := writeEnvelope(t, tamperedPayload)
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: tamperedPath, Password: password}); !errors.Is(err, ErrPasswordOrTampered) {
		t.Fatalf("tampered payload error=%v", err)
	}

	tamperedNonce := env
	nonce, err := base64.StdEncoding.DecodeString(tamperedNonce.Cipher.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	nonce[0] ^= 0x01
	tamperedNonce.Cipher.Nonce = base64.StdEncoding.EncodeToString(nonce)
	noncePath := writeEnvelope(t, tamperedNonce)
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: noncePath, Password: password}); !errors.Is(err, ErrPasswordOrTampered) {
		t.Fatalf("tampered nonce error=%v", err)
	}

	tamperedSalt := env
	salt, err := base64.StdEncoding.DecodeString(tamperedSalt.KDF.Salt)
	if err != nil {
		t.Fatal(err)
	}
	salt[0] ^= 0x01
	tamperedSalt.KDF.Salt = base64.StdEncoding.EncodeToString(salt)
	saltPath := writeEnvelope(t, tamperedSalt)
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: saltPath, Password: password}); !errors.Is(err, ErrPasswordOrTampered) {
		t.Fatalf("tampered salt error=%v", err)
	}

	tooLarge := env
	tooLarge.KDF.MemoryKiB = maxArgonMemoryKiB + 1
	largePath := writeEnvelope(t, tooLarge)
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: largePath, Password: password}); !errors.Is(err, ErrKDFParametersInvalid) {
		t.Fatalf("large kdf error=%v", err)
	}
}

func TestImportPreviewAndTransactionalImportSanitizeCredentials(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	seedBackupData(t, ctx, source)
	service := New(source)
	path := filepath.Join(t.TempDir(), "serverpilot.spbackup")
	password := "correct horse battery"
	if _, err := service.Export(ctx, domain.BackupExportRequest{Path: path, Password: password, ConfirmPassword: password}); err != nil {
		t.Fatal(err)
	}

	target := newBackupStore(t)
	targetService := New(target)
	preview, err := targetService.Inspect(ctx, domain.BackupInspectRequest{Path: path, Password: password})
	if err != nil {
		t.Fatal(err)
	}
	if preview.GroupCount != 1 || preview.ConnectionCount != 2 || preview.KeyVaultCount != 1 || preview.HostTrustCount != 1 {
		t.Fatalf("preview=%+v", preview)
	}
	result, err := targetService.Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{
			ImportSettings: true, ImportGroups: true, ImportServers: true,
			ImportKeyVault: true, ImportHostTrust: false,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.GroupsAdded != 1 || result.ConnectionsAdded != 2 || result.KeyVaultAdded != 1 || result.HostTrustImported != 0 {
		t.Fatalf("import result=%+v", result)
	}
	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 2 {
		t.Fatalf("connections=%+v", connections)
	}
	for _, connection := range connections {
		if connection.CredentialSaved || connection.HostKeyFingerprint != "" {
			t.Fatalf("imported connection not sanitized/remapped: %+v", connection)
		}
		if connection.PrivateKeySource == domain.PrivateKeySourceKeyVault && connection.KeyVaultID == nil {
			t.Fatalf("key vault connection was not rebound to imported metadata: %+v", connection)
		}
		refs, err := target.ListCredentialRefs(ctx, connection.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(refs) != 0 {
			t.Fatalf("credential refs imported: %v", refs)
		}
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || len(keys[0].ProtectedKeyBlob) != 0 || keys[0].PassphraseSaved {
		t.Fatalf("imported key vault metadata not sanitized: %+v", keys)
	}
	importedSettings, err := target.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if importedSettings.SSHKeepaliveEnabled ||
		importedSettings.SSHKeepaliveIntervalSeconds != 45 ||
		importedSettings.SSHKeepaliveTimeoutSeconds != 12 ||
		importedSettings.SSHKeepaliveMaxFailures != 4 ||
		importedSettings.DashboardSortMode != domain.DashboardSortNetwork ||
		len(importedSettings.DashboardManualServerOrder) != 2 ||
		importedSettings.Alerts.CPU.Threshold != 82 ||
		importedSettings.Alerts.CPU.DurationSeconds != 45 ||
		importedSettings.Alerts.Latency.Threshold != 700 ||
		!importedSettings.Alerts.Latency.Enabled {
		t.Fatalf("settings were not imported: %+v", importedSettings)
	}
}

func TestFullBackupRestoresSavedSecrets(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	seedBackupData(t, ctx, source)
	localKeyConnection, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "local-key-server", Host: "198.51.100.7", Port: 22, Username: "deploy",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceLocalFile,
		PrivateKeyPath: "/tmp/local-id_ed25519", RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := source.SetCredentialRef(ctx, localKeyConnection.ID, "passphrase", "local-passphrase-ref"); err != nil {
		t.Fatal(err)
	}
	sourceSecrets := newMemorySecrets()
	if err := sourceSecrets.Set(ctx, "credential-ref", []byte("test-password")); err != nil {
		t.Fatal(err)
	}
	if err := sourceSecrets.Set(ctx, "passphrase-ref", []byte("test-keyvault-passphrase")); err != nil {
		t.Fatal(err)
	}
	if err := sourceSecrets.Set(ctx, "local-passphrase-ref", []byte("test-local-passphrase")); err != nil {
		t.Fatal(err)
	}

	service := New(source, sourceSecrets)
	path := filepath.Join(t.TempDir(), "serverpilot-full.spbackup")
	password := "correct horse battery"
	result, err := service.Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password, Mode: string(domain.BackupModeFull),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Mode != string(domain.BackupModeFull) || result.SecretEntries != 2 {
		t.Fatalf("full export result=%+v", result)
	}
	contents := string(readFile(t, path))
	for _, forbidden := range []string{"test-password", "test-keyvault-passphrase", "test-local-passphrase", "credential-ref", "passphrase-ref", "local-passphrase-ref"} {
		if strings.Contains(contents, forbidden) {
			t.Fatalf("full backup envelope contains plaintext secret material %q", forbidden)
		}
	}

	target := newBackupStore(t)
	targetSecrets := newMemorySecrets()
	targetService := New(target, targetSecrets)
	importResult, err := targetService.Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{ImportSettings: true, ImportGroups: true, ImportServers: true, ImportKeyVault: true, ImportHostTrust: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if importResult.SecretsRestored != 2 {
		t.Fatalf("import result=%+v", importResult)
	}

	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, connection := range connections {
		switch connection.Host {
		case "192.0.2.55":
			assertRestoredSecret(t, ctx, target, targetSecrets, connection.ID, "password", "test-password")
		case "198.51.100.7":
			assertRestoredSecret(t, ctx, target, targetSecrets, connection.ID, "passphrase", "test-local-passphrase")
		}
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || len(keys[0].ProtectedKeyBlob) != 0 || keys[0].PassphraseSaved {
		t.Fatalf("key vault metadata should be restored without protected material: %+v", keys)
	}
}

func TestFullBackupImportsUnrestorableWindowsKeyVaultMetadataWithWarning(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	protectedBlob := []byte("windows-dpapi-blob")
	sourceKey := createEncryptedBackupKey(t, ctx, source, "windows-key", "SHA256:windows-only", string(protectedBlob))
	sourceKeyID := sourceKey.ID
	if _, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "windows-key-server", Host: "203.0.113.88", Port: 22, Username: "deploy",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &sourceKeyID, RefreshInterval: 2,
	}); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "serverpilot-windows-keyvault.spbackup")
	password := "correct horse battery"
	if _, err := New(source, newMemorySecrets()).Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password, Mode: string(domain.BackupModeFull),
	}); err != nil {
		t.Fatal(err)
	}

	target := newBackupStore(t)
	importResult, err := New(target).Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{ImportSettings: false, ImportGroups: false, ImportServers: true, ImportKeyVault: true, ImportHostTrust: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "darwin" {
		if importResult.KeyVaultAdded != 1 || !hasBackupWarning(importResult.Warnings, "WINDOWS_PROTECTED_CREDENTIAL_REENTER_REQUIRED") {
			t.Fatalf("darwin import result=%+v", importResult)
		}
		if len(keys) != 1 || len(keys[0].ProtectedKeyBlob) != 0 || keys[0].PassphraseSaved {
			t.Fatalf("darwin should import metadata without DPAPI material: %+v", keys)
		}
	} else {
		if importResult.KeyVaultAdded != 1 || len(keys) != 1 || string(keys[0].ProtectedKeyBlob) != string(protectedBlob) {
			t.Fatalf("non-darwin should retain protected material: result=%+v keys=%+v", importResult, keys)
		}
	}
}

func hasBackupWarning(warnings []domain.BackupWarning, code string) bool {
	for _, warning := range warnings {
		if warning.Code == code {
			return true
		}
	}
	return false
}

func TestFullBackupRestoresEncryptedKeyVaultMaterialAndPassphrase(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	protectedBlob := keyvault.LocalProtectorBlobPrefix + "protected-portable-key"
	sourceKey := createEncryptedBackupKey(t, ctx, source, "portable-key", "SHA256:portable", protectedBlob)
	if err := source.SetKeyVaultPassphraseRef(ctx, sourceKey.ID, "portable-passphrase-ref"); err != nil {
		t.Fatal(err)
	}
	sourceKeyID := sourceKey.ID
	if _, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "portable-server", Host: "203.0.113.77", Port: 22, Username: "deploy",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &sourceKeyID, RefreshInterval: 2,
	}); err != nil {
		t.Fatal(err)
	}
	sourceSecrets := newMemorySecrets()
	if err := sourceSecrets.Set(ctx, "portable-passphrase-ref", []byte("portable-passphrase")); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "serverpilot-full-keyvault.spbackup")
	password := "correct horse battery"
	result, err := New(source, sourceSecrets).Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password, Mode: string(domain.BackupModeFull),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.KeyVaultEntries != 1 || result.SecretEntries != 2 {
		t.Fatalf("full key vault export result=%+v", result)
	}
	contents := string(readFile(t, path))
	for _, forbidden := range []string{"protected-portable-key", "portable-passphrase", "portable-passphrase-ref"} {
		if strings.Contains(contents, forbidden) {
			t.Fatalf("full backup envelope contains plaintext key vault material %q", forbidden)
		}
	}

	target := newBackupStore(t)
	targetSecrets := newMemorySecrets()
	importResult, err := New(target, targetSecrets).Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{ImportSettings: false, ImportGroups: false, ImportServers: true, ImportKeyVault: true, ImportHostTrust: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if importResult.KeyVaultAdded != 1 || importResult.SecretsRestored != 1 {
		t.Fatalf("full key vault import result=%+v", importResult)
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 ||
		keys[0].Name != "portable-key" ||
		keys[0].StorageMode != string(domain.KeyVaultStorageEncryptedDatabase) ||
		string(keys[0].ProtectedKeyBlob) != protectedBlob ||
		!keys[0].PassphraseSaved {
		t.Fatalf("restored key vault entries=%+v", keys)
	}
	restoredPassphrase, err := targetSecrets.Get(ctx, keys[0].PassphraseCredentialRef)
	if err != nil {
		t.Fatal(err)
	}
	if string(restoredPassphrase) != "portable-passphrase" {
		t.Fatalf("restored key vault passphrase mismatch")
	}
	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 1 || connections[0].KeyVaultID == nil || *connections[0].KeyVaultID != keys[0].ID {
		t.Fatalf("connection was not rebound to restored key vault entry: connections=%+v keys=%+v", connections, keys)
	}
}

func TestFullBackupKeepsConfigWhenSecretStoreCannotSave(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	seedBackupData(t, ctx, source)
	sourceSecrets := newMemorySecrets()
	if err := sourceSecrets.Set(ctx, "credential-ref", []byte("saved-password")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "serverpilot-full-secret-failure.spbackup")
	password := "correct horse battery"
	if _, err := New(source, sourceSecrets).Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password, Mode: string(domain.BackupModeFull),
	}); err != nil {
		t.Fatal(err)
	}

	target := newBackupStore(t)
	result, err := New(target, failingSecrets{}).Import(ctx, domain.BackupImportRequest{
		Path: path, Password: password,
		Options: domain.BackupImportOptions{ImportSettings: true, ImportGroups: true, ImportServers: true, ImportKeyVault: true, ImportHostTrust: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ConnectionsAdded == 0 || result.SecretsRestored != 0 || len(result.Warnings) == 0 {
		t.Fatalf("import result=%+v", result)
	}
	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 2 {
		t.Fatalf("non-sensitive connections were not imported: %+v", connections)
	}
	for _, connection := range connections {
		refs, err := target.ListCredentialRefs(ctx, connection.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(refs) != 0 {
			t.Fatalf("failed secret store should not leave credential refs: %v", refs)
		}
	}
}

func TestBackupExcludesCommandHistoryAndFavorites(t *testing.T) {
	ctx := context.Background()
	store := newBackupStore(t)
	seedBackupData(t, ctx, store)
	connections, err := store.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	commandService := commands.New(store)
	if _, err := commandService.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  connections[0].ID,
		SessionID: "session",
		Command:   "echo backup-history-marker",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := commandService.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  connections[0].ID,
		SessionID: "session",
		Command:   "echo backup-multiline-history-marker\nuname -a",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := commandService.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command:             "echo backup-batch-history-marker",
		SuccessfulServerIDs: []int64{connections[0].ID},
		SubmissionID:        "backup-batch-marker",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := commandService.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title:   "Backup marker",
		Command: "echo backup-favorite-marker",
		Scope:   domain.CommandScopeGlobal,
	}); err != nil {
		t.Fatal(err)
	}

	secrets := newMemorySecrets()
	if err := secrets.Set(ctx, "credential-ref", []byte("saved-password")); err != nil {
		t.Fatal(err)
	}
	if err := secrets.Set(ctx, "passphrase-ref", []byte("saved-passphrase")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "serverpilot.spbackup")
	password := "correct horse battery"
	if _, err := New(store, secrets).Export(ctx, domain.BackupExportRequest{
		Path: path, Password: password, ConfirmPassword: password, Mode: string(domain.BackupModeFull),
	}); err != nil {
		t.Fatal(err)
	}
	contents := readFile(t, path)
	for _, forbidden := range []string{"backup-history-marker", "backup-multiline-history-marker", "backup-batch-history-marker", "backup-favorite-marker"} {
		if strings.Contains(string(contents), forbidden) {
			t.Fatalf("backup envelope contains command data %q", forbidden)
		}
	}
	payload, _, err := decryptPayload(contents, password)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"backup-history-marker", "backup-multiline-history-marker", "backup-batch-history-marker", "backup-favorite-marker"} {
		if strings.Contains(string(decoded), forbidden) {
			t.Fatalf("backup payload contains command data %q", forbidden)
		}
	}
}

func TestRepeatedImportUpsertsConnectionsAndPreservesCredentialRefs(t *testing.T) {
	ctx := context.Background()
	source := newBackupStore(t)
	seedBackupData(t, ctx, source)
	service := New(source)
	path := filepath.Join(t.TempDir(), "serverpilot.spbackup")
	password := "correct horse battery"
	if _, err := service.Export(ctx, domain.BackupExportRequest{Path: path, Password: password, ConfirmPassword: password}); err != nil {
		t.Fatal(err)
	}

	target := newBackupStore(t)
	targetService := New(target)
	options := domain.BackupImportOptions{ImportSettings: true, ImportGroups: true, ImportServers: true, ImportKeyVault: true, ImportHostTrust: true}
	if _, err := targetService.Import(ctx, domain.BackupImportRequest{Path: path, Password: password, Options: options}); err != nil {
		t.Fatal(err)
	}
	connections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var prodID int64
	for _, connection := range connections {
		if connection.Host == "192.0.2.55" && connection.Port == 22 && connection.Username == "deploy" {
			prodID = connection.ID
			break
		}
	}
	if prodID == 0 {
		t.Fatalf("imported prod connection not found: %+v", connections)
	}
	if err := target.SetCredentialRef(ctx, prodID, "password", "existing-credential-ref"); err != nil {
		t.Fatal(err)
	}
	result, err := targetService.Import(ctx, domain.BackupImportRequest{Path: path, Password: password, Options: options})
	if err != nil {
		t.Fatal(err)
	}
	if result.Renamed != 0 || result.ConnectionsAdded != 0 || result.Skipped != 0 {
		t.Fatalf("expected upsert without renamed duplicate connections: %+v", result)
	}
	connections, err = target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 2 {
		t.Fatalf("expected repeated import to keep two connections, connections=%+v", connections)
	}
	foundTrust := false
	for _, connection := range connections {
		if connection.ID == prodID && !connection.CredentialSaved {
			t.Fatalf("existing credential ref was not preserved: %+v", connection)
		}
		if connection.HostKeyFingerprint == "SHA256:trusted-host" {
			foundTrust = true
		}
	}
	refs, err := target.ListCredentialRefs(ctx, prodID)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0] != "existing-credential-ref" {
		t.Fatalf("credential refs changed during upsert: %v", refs)
	}
	if !foundTrust {
		t.Fatalf("host trust was not imported during upsert: connections=%+v", connections)
	}
}

func TestInvalidVersionAndPasswordValidation(t *testing.T) {
	if err := validateExportPassword("", ""); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("empty password error=%v", err)
	}
	if err := validateExportPassword("abcdefghijkl", "different"); !errors.Is(err, ErrPasswordMismatch) {
		t.Fatalf("mismatch error=%v", err)
	}
	if err := validateExportPassword("short", "short"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("weak error=%v", err)
	}
	for _, password := range []string{"123456", "abcdef", "密码密码密码", "!!!!!!", " 1234 "} {
		if err := validateExportPassword(password, password); err != nil {
			t.Fatalf("valid password %q error=%v", password, err)
		}
	}

	env := envelope{Format: formatName, Version: envelopeVer + 1, KDF: kdfEnvelope{Name: kdfName}, Cipher: cipherEnvelope{Name: cipherName}}
	path := writeEnvelope(t, env)
	if _, _, err := decryptPayload(readFile(t, path), "password"); !errors.Is(err, ErrUnsupportedVersion) {
		t.Fatalf("version error=%v", err)
	}

	invalidSettings := domain.DefaultAppSettings()
	invalidSettings.SSHKeepaliveIntervalSeconds = 1
	if err := validateSettings(invalidSettings); err == nil {
		t.Fatal("invalid SSH keepalive interval was accepted")
	}
	invalidSettings = domain.DefaultAppSettings()
	invalidSettings.Alerts.RootDisk.Threshold = 101
	if err := validateSettings(invalidSettings); err == nil {
		t.Fatal("invalid alert settings were accepted")
	}
}

func TestBackupPasswordPreservesLeadingAndTrailingSpaces(t *testing.T) {
	ctx := context.Background()
	store := newBackupStore(t)
	seedBackupData(t, ctx, store)
	service := New(store)
	path := filepath.Join(t.TempDir(), "spaces.spbackup")
	password := " 1234 "
	if _, err := service.Export(ctx, domain.BackupExportRequest{Path: path, Password: password, ConfirmPassword: password}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: path, Password: password}); err != nil {
		t.Fatalf("exact password with spaces should inspect: %v", err)
	}
	if _, err := service.Inspect(ctx, domain.BackupInspectRequest{Path: path, Password: "1234"}); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("trimmed password error=%v", err)
	}
}

func newBackupStore(t *testing.T) *persistence.Store {
	t.Helper()
	store, err := persistence.Open(context.Background(), filepath.Join(t.TempDir(), "serverpilot.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func createEncryptedBackupKey(
	t *testing.T,
	ctx context.Context,
	store *persistence.Store,
	name string,
	fingerprint string,
	protected string,
) domain.KeyVaultEntry {
	t.Helper()
	entry, err := store.CreateEncryptedKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name:           name,
		PrivateKeyPath: "C:/Users/test/.ssh/id_ed25519",
	}, domain.PrivateKeyValidationResult{
		Algorithm: "ssh-ed25519", FingerprintSHA256: fingerprint, KeyBits: 256, Valid: true,
	}, []byte(protected), "id_ed25519")
	if err != nil {
		t.Fatal(err)
	}
	return entry
}

func seedBackupData(t *testing.T, ctx context.Context, store *persistence.Store) {
	t.Helper()
	settings := domain.DefaultAppSettings()
	settings.ThemeMode = domain.ThemeLight
	settings.DefaultRememberPassword = true
	settings.SSHKeepaliveEnabled = false
	settings.SSHKeepaliveIntervalSeconds = 45
	settings.SSHKeepaliveTimeoutSeconds = 12
	settings.SSHKeepaliveMaxFailures = 4
	settings.DashboardSortMode = domain.DashboardSortNetwork
	settings.DashboardManualServerOrder = []string{"2", "1"}
	settings.Alerts.CPU.Threshold = 82
	settings.Alerts.CPU.DurationSeconds = 45
	settings.Alerts.Latency.Enabled = true
	settings.Alerts.Latency.Threshold = 700
	if err := store.SaveSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	group, err := store.SaveGroup(ctx, domain.Group{Name: "Production"})
	if err != nil {
		t.Fatal(err)
	}
	key, err := store.CreateKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name: "deploy", PrivateKeyPath: "/tmp/serverpilot-id_ed25519", Notes: "metadata only",
	}, domain.PrivateKeyValidationResult{Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:key", Encrypted: true, Valid: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetKeyVaultPassphraseRef(ctx, key.ID, "passphrase-ref"); err != nil {
		t.Fatal(err)
	}
	keyID := key.ID
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &group.ID, Name: "prod-server", Host: "192.0.2.55", Port: 22, Username: "deploy",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "password", "credential-ref"); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateHostKey(ctx, connection.ID, "SHA256:trusted-host"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &group.ID, Name: "key-server", Host: "example.invalid", Port: 22, Username: "deploy",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &keyID, RefreshInterval: 5,
	}); err != nil {
		t.Fatal(err)
	}
}

func assertRestoredSecret(
	t *testing.T,
	ctx context.Context,
	store *persistence.Store,
	secrets *memorySecrets,
	connectionID int64,
	kind string,
	want string,
) {
	t.Helper()
	reference, err := store.GetCredentialRef(ctx, connectionID, kind)
	if err != nil {
		t.Fatal(err)
	}
	value, err := secrets.Get(ctx, reference)
	if err != nil {
		t.Fatal(err)
	}
	if string(value) != want {
		t.Fatalf("secret %s=%q, want %q", kind, value, want)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return contents
}

func writeEnvelope(t *testing.T, env envelope) string {
	t.Helper()
	contents, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "tampered.spbackup")
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
