package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"hostdeck/internal/connectionerror"
	"hostdeck/internal/credential"
	"hostdeck/internal/domain"
	"hostdeck/internal/localterminal"
	"hostdeck/internal/logging"
	"hostdeck/internal/monitor"
	"hostdeck/internal/persistence"
	"hostdeck/internal/secretstore"
	"hostdeck/internal/settings"
	"hostdeck/internal/sshclient"
	terminalservice "hostdeck/internal/terminal"
)

type memorySecretStore struct {
	values    map[string][]byte
	setErr    error
	deleteErr error
	setCalls  int
	delCalls  int
}

func (s *memorySecretStore) Get(_ context.Context, key string) ([]byte, error) {
	value, ok := s.values[key]
	if !ok {
		return nil, secretstore.ErrNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *memorySecretStore) Set(_ context.Context, key string, value []byte) error {
	if s.setErr != nil {
		return s.setErr
	}
	s.setCalls += 1
	s.values[key] = append([]byte(nil), value...)
	return nil
}

func setupConnectionConfigApp(t *testing.T, secrets *memorySecretStore) (*App, *persistence.Store) {
	t.Helper()
	ctx := context.Background()
	store, err := persistence.Open(ctx, filepath.Join(t.TempDir(), "HostDeck.db"))
	if err != nil {
		t.Fatal(err)
	}
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	resolver := credential.New(store, secrets)
	settingsService, err := settings.New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.ctx = ctx
	app.store = store
	app.logger = logger
	app.secrets = secrets
	app.credentials = resolver
	app.settings = settingsService
	app.monitor = monitor.New(ctx, logger, store.UpdateHostKey, resolver.CommitSuccessful, nil, nil)
	t.Cleanup(func() {
		app.monitor.StopAll()
		_ = store.Close()
		_ = logger.Close()
	})
	return app, store
}

func passwordConfig(id int64, username string, password string, remember bool) domain.SaveConnectionConfigRequest {
	return domain.SaveConnectionConfigRequest{
		Connection: domain.SaveConnectionRequest{
			ID: id, Name: "password-server", Host: "192.0.2.20", Port: 22,
			Username: username, AuthType: domain.AuthPassword, RefreshInterval: 2,
		},
		Auth: domain.AuthRequest{Password: password, RememberSecret: remember},
	}
}

func keyVaultID(id int64) *int64 {
	return &id
}

func skipUnlessWindows(t *testing.T, reason string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip(reason)
	}
}

func TestGetAppVersionReturnsCurrentReleaseVersion(t *testing.T) {
	app := NewApp()
	raw, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.TrimSpace(string(raw))
	if want != "0.5.0-beta.67" {
		t.Fatalf("VERSION=%q, want %q", want, "0.5.0-beta.67")
	}

	info := app.GetAppVersion()

	if info.Version != want {
		t.Fatalf("version=%q, want %q", info.Version, want)
	}
}

func TestMainConfiguresMacOSHiddenInsetTitlebar(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if !strings.Contains(text, `"github.com/wailsapp/wails/v2/pkg/options/mac"`) {
		t.Fatal("main.go must import Wails macOS options")
	}
	if !strings.Contains(text, `Mac: &mac.Options{`) || !strings.Contains(text, `TitleBar: mac.TitleBarHiddenInset()`) {
		t.Fatal("main.go must configure the native macOS hidden inset titlebar")
	}
}

func TestMainConfiguresStableWindowsWebviewDataPath(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if !strings.Contains(text, `"github.com/wailsapp/wails/v2/pkg/options/windows"`) {
		t.Fatal("main.go must import Wails Windows options")
	}
	if !strings.Contains(text, `Windows: &windows.Options{`) || !strings.Contains(text, `WebviewUserDataPath: stableWindowsWebviewUserDataPath()`) {
		t.Fatal("main.go must configure a stable Windows WebView2 user data path")
	}
	path := hostDeckWebviewUserDataPath(filepath.Join("C:\\Users\\Administrator\\AppData\\Roaming"))
	if path != filepath.Join("C:\\Users\\Administrator\\AppData\\Roaming", "HostDeck", "WebView2") {
		t.Fatalf("webview data path = %q", path)
	}
	if strings.Contains(path, ".exe") || strings.Contains(path, "beta") {
		t.Fatalf("webview data path must not depend on executable or version name: %q", path)
	}
}

func TestEnsureHostDeckDataDirMigratesLegacyDirectoryAndDatabase(t *testing.T) {
	configDir := t.TempDir()
	legacyDir := filepath.Join(configDir, legacyAppDataDirName)
	if err := os.MkdirAll(filepath.Join(legacyDir, "logs"), 0o700); err != nil {
		t.Fatal(err)
	}
	legacyDB := filepath.Join(legacyDir, legacyDatabaseFilename)
	if err := os.WriteFile(legacyDB, []byte("legacy database"), 0o600); err != nil {
		t.Fatal(err)
	}

	dataDir, err := ensureHostDeckDataDir(configDir)
	if err != nil {
		t.Fatal(err)
	}

	if dataDir != filepath.Join(configDir, "HostDeck") {
		t.Fatalf("data dir = %q", dataDir)
	}
	if _, err := os.Stat(filepath.Join(configDir, legacyAppDataDirName)); !os.IsNotExist(err) {
		t.Fatalf("legacy data dir still exists or stat failed: %v", err)
	}
	if _, err := os.Stat(hostDeckDatabasePath(dataDir)); err != nil {
		t.Fatalf("HostDeck database was not migrated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, legacyDatabaseFilename)); !os.IsNotExist(err) {
		t.Fatalf("legacy database file still exists or stat failed: %v", err)
	}
}

func createTestKeyVaultEntry(t *testing.T, app *App, store *persistence.Store, name string) domain.KeyVaultEntry {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("test key metadata only"), 0o600); err != nil {
		t.Fatal(err)
	}
	entry, err := store.CreateKeyVaultEntry(app.ctx, domain.SaveKeyVaultEntryRequest{
		Name: name, PrivateKeyPath: path,
	}, domain.PrivateKeyValidationResult{
		Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:" + name, KeyBits: 256, Valid: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return entry
}

func TestProbeConnectionReachabilityClassifiesNetworkBeforeMissingCredential(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	connection, err := store.SaveConnection(app.ctx, domain.SaveConnectionRequest{
		Name: "refused-server", Host: "127.0.0.1", Port: port,
		Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}

	result, err := app.ProbeConnectionReachability(connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Reachable || result.ConnectionError == nil {
		t.Fatalf("result=%+v, want unreachable connection error", result)
	}
	if result.ConnectionError.Code != connectionerror.CodeRefused {
		t.Fatalf("code=%q, want %q", result.ConnectionError.Code, connectionerror.CodeRefused)
	}
}

func TestSaveConnectionConfigPasswordLifecycle(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)

	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil || !created.Connection.CredentialSaved {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	reference := credential.Reference(created.Connection.ID, "password")
	if string(secrets.values[reference]) != "first-value" {
		t.Fatal("password was not written to the system credential store")
	}

	kept, err := app.SaveConnectionConfig(passwordConfig(created.Connection.ID, "root", "", false))
	if err != nil || !kept.Connection.CredentialSaved || string(secrets.values[reference]) != "first-value" {
		t.Fatalf("blank edit changed credential: result=%+v err=%v", kept, err)
	}

	replaced, err := app.SaveConnectionConfig(passwordConfig(created.Connection.ID, "root", "second-value", true))
	if err != nil || !replaced.Connection.CredentialSaved || string(secrets.values[reference]) != "second-value" {
		t.Fatalf("replacement failed: result=%+v err=%v", replaced, err)
	}

	temporary, err := app.SaveConnectionConfig(passwordConfig(created.Connection.ID, "root", "one-use", false))
	if err != nil || !temporary.Connection.CredentialSaved || string(secrets.values[reference]) != "second-value" {
		t.Fatalf("one-use password changed saved credential: result=%+v err=%v", temporary, err)
	}
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "password"); err != nil {
		t.Fatalf("one-use password removed credential reference: %v", err)
	}
}

func TestSaveConnectionConfigBlankPasswordUnchangedDoesNotTouchSecretStore(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	reference := credential.Reference(created.Connection.ID, "password")
	secrets.setCalls = 0
	secrets.delCalls = 0

	request := passwordConfig(created.Connection.ID, "root", "", true)
	request.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
	kept, err := app.SaveConnectionConfig(request)
	if err != nil {
		t.Fatal(err)
	}
	if !kept.Connection.CredentialSaved || string(secrets.values[reference]) != "first-value" {
		t.Fatalf("blank unchanged edit lost saved password: result=%+v", kept)
	}
	if secrets.setCalls != 0 || secrets.delCalls != 0 {
		t.Fatalf("blank unchanged edit touched SecretStore: set=%d delete=%d", secrets.setCalls, secrets.delCalls)
	}
}

func TestSaveConnectionConfigHostPortChangePreservesSavedPassword(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	reference := credential.Reference(created.Connection.ID, "password")

	request := passwordConfig(created.Connection.ID, "root", "", true)
	request.Connection.Host = "198.51.100.77"
	request.Connection.Port = 2222
	request.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
	changed, err := app.SaveConnectionConfig(request)
	if err != nil {
		t.Fatal(err)
	}
	if !changed.Connection.CredentialSaved || string(secrets.values[reference]) != "first-value" {
		t.Fatalf("host/port edit did not preserve saved password: result=%+v", changed)
	}
	resolved, err := app.credentials.Resolve(app.ctx, changed.Connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "first-value" || !resolved.ResolvedFromStore {
		t.Fatalf("resolver could not use original saved password after host/port edit: auth=%+v err=%v", resolved, err)
	}
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "password"); err != nil {
		t.Fatalf("credential ref was removed after host/port edit: %v", err)
	}
}

func TestSaveConnectionConfigRouteChangePreservesSavedPassword(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	jump, err := store.SaveConnection(app.ctx, domain.SaveConnectionRequest{
		Name: "jump", Host: "192.0.2.30", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	reference := credential.Reference(created.Connection.ID, "password")

	request := passwordConfig(created.Connection.ID, "root", "", false)
	request.Connection.ConnectionMode = domain.ConnectionModeJump
	request.Connection.JumpServerID = &jump.ID
	request.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
	changed, err := app.SaveConnectionConfig(request)
	if err != nil {
		t.Fatal(err)
	}
	if !changed.Connection.CredentialSaved || string(secrets.values[reference]) != "first-value" {
		t.Fatalf("route edit did not preserve saved password: result=%+v", changed)
	}
	resolved, err := app.credentials.Resolve(app.ctx, changed.Connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "first-value" || !resolved.ResolvedFromStore {
		t.Fatalf("resolver could not use original saved password after route edit: auth=%+v err=%v", resolved, err)
	}
}

func TestSaveConnectionConfigDeleteModeClearsSavedPassword(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	secrets.delCalls = 0

	request := passwordConfig(created.Connection.ID, "root", "", true)
	request.Auth.SecretUpdateMode = domain.SecretUpdateDelete
	deleted, err := app.SaveConnectionConfig(request)
	if err != nil {
		t.Fatal(err)
	}
	if deleted.Connection.CredentialSaved || secrets.delCalls == 0 {
		t.Fatalf("delete mode did not clear saved credential: result=%+v deleteCalls=%d", deleted, secrets.delCalls)
	}
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "password"); err == nil {
		t.Fatal("credential reference remained after delete mode")
	}
}

func TestSaveConnectionConfigAuthSwitchPreservesSavedPassword(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	key := createTestKeyVaultEntry(t, app, store, "deploy-auth-switch")
	reference := credential.Reference(created.Connection.ID, "password")

	keyRequest := passwordConfig(created.Connection.ID, "root", "", false)
	keyRequest.Connection.AuthType = domain.AuthPrivateKey
	keyRequest.Connection.PrivateKeySource = domain.PrivateKeySourceKeyVault
	keyRequest.Connection.PrivateKeyPath = ""
	keyRequest.Connection.KeyVaultID = keyVaultID(key.ID)
	keyRequest.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
	keyChanged, err := app.SaveConnectionConfig(keyRequest)
	if err != nil {
		t.Fatal(err)
	}
	if !keyChanged.Connection.PasswordCredentialSaved {
		t.Fatalf("switching to key-vault auth did not expose the preserved password slot: %+v", keyChanged.Connection)
	}
	if string(secrets.values[reference]) != "first-value" {
		t.Fatal("switching to key-vault auth deleted the saved password secret")
	}
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "password"); err != nil {
		t.Fatalf("switching to key-vault auth removed the password ref: %v", err)
	}

	passwordRequest := passwordConfig(created.Connection.ID, "root", "", false)
	passwordRequest.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
	changed, err := app.SaveConnectionConfig(passwordRequest)
	if err != nil {
		t.Fatal(err)
	}
	if !changed.Connection.CredentialSaved {
		t.Fatalf("switching back to password did not report the saved password: %+v", changed.Connection)
	}
	if !changed.Connection.PasswordCredentialSaved {
		t.Fatalf("switching back to password did not expose the password slot: %+v", changed.Connection)
	}
	resolved, err := app.credentials.Resolve(app.ctx, changed.Connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "first-value" || !resolved.ResolvedFromStore {
		t.Fatalf("switching back to password could not resolve saved password: auth=%+v err=%v", resolved, err)
	}
}

func TestSaveConnectionConfigKeyVaultIDChangePreservesSavedPassword(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	firstKey := createTestKeyVaultEntry(t, app, store, "deploy-first")
	secondKey := createTestKeyVaultEntry(t, app, store, "deploy-second")
	reference := credential.Reference(created.Connection.ID, "password")
	for _, keyID := range []int64{firstKey.ID, secondKey.ID} {
		request := passwordConfig(created.Connection.ID, "root", "", false)
		request.Connection.AuthType = domain.AuthPrivateKey
		request.Connection.PrivateKeySource = domain.PrivateKeySourceKeyVault
		request.Connection.PrivateKeyPath = ""
		request.Connection.KeyVaultID = keyVaultID(keyID)
		request.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
		changed, err := app.SaveConnectionConfig(request)
		if err != nil {
			t.Fatal(err)
		}
		if !changed.Connection.PasswordCredentialSaved {
			t.Fatalf("changing key-vault key id did not expose the preserved password slot: %+v", changed.Connection)
		}
	}
	if string(secrets.values[reference]) != "first-value" {
		t.Fatal("changing key-vault key id deleted the saved password secret")
	}
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "password"); err != nil {
		t.Fatalf("changing key-vault key id removed password ref: %v", err)
	}
}

func TestSaveConnectionConfigPrivateKeyPathChangeClearsOnlyPassphraseSlot(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "first-value", true))
	if err != nil {
		t.Fatal(err)
	}
	passwordRef := credential.Reference(created.Connection.ID, "password")
	firstKeyPath := writeTestPrivateKey(t, true, "key-passphrase")
	secondKeyPath := writeTestPrivateKey(t, true, "replacement-passphrase")

	keyRequest := passwordConfig(created.Connection.ID, "root", "", false)
	keyRequest.Connection.AuthType = domain.AuthPrivateKey
	keyRequest.Connection.PrivateKeySource = domain.PrivateKeySourceLocalFile
	keyRequest.Connection.PrivateKeyPath = firstKeyPath
	keyRequest.Auth.SecretUpdateMode = domain.SecretUpdateUnchanged
	keyChanged, err := app.SaveConnectionConfig(keyRequest)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.credentials.CommitSuccessful(app.ctx, keyChanged.Connection, domain.AuthRequest{
		Passphrase: "key-passphrase", RememberSecret: true,
	}); err != nil {
		t.Fatal(err)
	}
	passphraseRef := credential.Reference(created.Connection.ID, "passphrase")
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "passphrase"); err != nil {
		t.Fatalf("passphrase ref was not saved: %v", err)
	}

	keyRequest.Connection.PrivateKeyPath = secondKeyPath
	keyChanged, err = app.SaveConnectionConfig(keyRequest)
	if err != nil {
		t.Fatal(err)
	}
	if !keyChanged.Connection.PasswordCredentialSaved || string(secrets.values[passwordRef]) != "first-value" {
		t.Fatalf("private-key path change damaged password slot: result=%+v", keyChanged.Connection)
	}
	if _, err := secrets.Get(app.ctx, passphraseRef); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("private-key path change retained passphrase secret: %v", err)
	}
	if _, err := store.GetCredentialRef(app.ctx, created.Connection.ID, "passphrase"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("private-key path change retained passphrase ref: %v", err)
	}
}

func TestSaveConnectionConfigCredentialWriteFailureStaysUnsaved(t *testing.T) {
	secrets := &memorySecretStore{
		values: make(map[string][]byte),
		setErr: errors.New("simulated credential store failure"),
	}
	app, store := setupConnectionConfigApp(t, secrets)
	_, err := app.SaveConnectionConfig(passwordConfig(0, "root", "one-use-value", true))
	if err == nil {
		t.Fatal("expected credential write failure")
	}
	connections, listErr := store.ListConnections(app.ctx)
	if listErr != nil || len(connections) != 1 {
		t.Fatalf("connections=%v err=%v", connections, listErr)
	}
	if connections[0].CredentialSaved || len(secrets.values) != 0 {
		t.Fatalf("failed write reported saved credential: %+v", connections[0])
	}
}

func TestFailedExplicitReplacementPreservesSavedCredential(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "known-value", true))
	if err != nil {
		t.Fatal(err)
	}
	secrets.setErr = errors.New("simulated replacement failure")
	if _, err := app.SaveConnectionConfig(
		passwordConfig(created.Connection.ID, "root", "replacement-value", true),
	); err == nil {
		t.Fatal("expected replacement failure")
	}
	connection, err := store.GetConnection(app.ctx, created.Connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !connection.CredentialSaved {
		t.Fatal("failed explicit replacement removed the existing saved credential")
	}
	resolved, err := app.credentials.Resolve(app.ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "known-value" || !resolved.ResolvedFromStore {
		t.Fatalf("failed explicit replacement damaged saved credential: auth=%+v err=%v", resolved, err)
	}
}

func TestSaveAndConnectDefersCredentialReplacementUntilSuccessfulAuthentication(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	created, err := app.SaveConnectionConfig(passwordConfig(0, "root", "known-value", true))
	if err != nil {
		t.Fatal(err)
	}
	reference := credential.Reference(created.Connection.ID, "password")
	request := passwordConfig(created.Connection.ID, "root", "unverified-value", true)
	request.ConnectAfterSave = true
	result, err := app.SaveConnectionConfig(request)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Connection.CredentialSaved || string(secrets.values[reference]) != "known-value" {
		t.Fatal("save-and-connect replaced the old credential before SSH authentication succeeded")
	}
}

func (s *memorySecretStore) Delete(_ context.Context, key string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	s.delCalls += 1
	delete(s.values, key)
	return nil
}

func TestCredentialLifecycleDoesNotPersistSecretInSQLite(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "HostDeck.db")
	store, err := persistence.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.ctx = ctx
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app.secrets = secrets
	app.credentials = credential.New(store, secrets)
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.1", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	const password = "unique-password-that-must-not-enter-sqlite"
	auth := domain.AuthRequest{Password: password, RememberSecret: true}
	if err := app.credentials.CommitSuccessful(ctx, connection, auth); err != nil {
		t.Fatal(err)
	}
	connection, err = store.GetConnection(ctx, connection.ID)
	if err != nil || !connection.CredentialSaved {
		t.Fatalf("connection=%+v err=%v", connection, err)
	}
	resolved, err := app.credentials.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Password != password {
		t.Fatalf("resolved credential failed: err=%v", err)
	}
	if err := app.credentials.Clear(ctx, connection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(ctx, credential.Reference(connection.ID, "password")); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("expected deleted credential, got %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	databaseBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if containsBytes(databaseBytes, []byte(password)) {
		t.Fatal("plaintext password found in SQLite database")
	}
}

func containsBytes(haystack, needle []byte) bool {
	if len(needle) == 0 || len(haystack) < len(needle) {
		return false
	}
	for index := 0; index <= len(haystack)-len(needle); index++ {
		match := true
		for offset := range needle {
			if haystack[index+offset] != needle[offset] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func TestSSHRouteDialerMissingJumpDoesNotDialDirect(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	target := domain.Connection{
		ID: 2, Name: "target", Host: "10.0.0.2", Port: 22, Username: "root",
		AuthType:       domain.AuthPassword,
		ConnectionMode: domain.ConnectionModeJump,
	}
	route := newSSHRouteDialer(app.store, app.credentials, app.settings, app.logger)
	_, _, err := route(app.ctx, target, domain.AuthRequest{}, time.Second, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (*sshclient.Client, time.Duration, error) {
		t.Fatal("missing jump server must not attempt direct target connection")
		return nil, 0, nil
	})
	var routeErr *connectionerror.RouteError
	if !errors.As(err, &routeErr) || routeErr.Kind != connectionerror.RouteErrorJumpServerMissing {
		t.Fatalf("err=%v routeErr=%+v", err, routeErr)
	}
}

func TestSSHRouteDialerReportsJumpCredentialStage(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	jump, err := store.SaveConnection(app.ctx, domain.SaveConnectionRequest{
		Name: "jump", Host: "198.51.100.40", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	target, err := store.SaveConnection(app.ctx, domain.SaveConnectionRequest{
		Name: "target", Host: "10.0.0.40", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &jump.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	route := newSSHRouteDialer(app.store, app.credentials, app.settings, app.logger)
	_, _, err = route(app.ctx, target, domain.AuthRequest{}, time.Second, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (*sshclient.Client, time.Duration, error) {
		t.Fatal("missing jump credential must fail before dialing jump")
		return nil, 0, nil
	})
	var routeErr *connectionerror.RouteError
	if !errors.As(err, &routeErr) ||
		routeErr.Kind != connectionerror.RouteErrorJumpAuthFailed ||
		routeErr.Stage != "jump" ||
		routeErr.CredentialServerID != jump.ID ||
		routeErr.CredentialServerName != jump.Name {
		t.Fatalf("err=%v routeErr=%+v", err, routeErr)
	}
}

func TestChangingPrivateKeyPathAndDeletingConnectionRemoveSystemCredential(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.Open(ctx, filepath.Join(t.TempDir(), "HostDeck.db"))
	if err != nil {
		t.Fatal(err)
	}
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	resolver := credential.New(store, secrets)
	app := NewApp()
	app.ctx = ctx
	app.store = store
	app.logger = logger
	app.secrets = secrets
	app.credentials = resolver
	app.monitor = monitor.New(ctx, logger, store.UpdateHostKey, resolver.CommitSuccessful, nil, nil)
	t.Cleanup(func() {
		app.monitor.StopAll()
		_ = store.Close()
		_ = logger.Close()
	})

	request := domain.SaveConnectionRequest{
		Name: "key-server", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPrivateKey, PrivateKeyPath: "first-key", RefreshInterval: 2,
	}
	connection, err := app.SaveConnection(request)
	if err != nil {
		t.Fatal(err)
	}
	if err := resolver.CommitSuccessful(ctx, connection, domain.AuthRequest{
		Passphrase: "temporary-passphrase", RememberSecret: true,
	}); err != nil {
		t.Fatal(err)
	}
	reference := credential.Reference(connection.ID, "passphrase")
	request.ID = connection.ID
	request.PrivateKeyPath = "second-key"
	connection, err = app.SaveConnection(request)
	if err != nil {
		t.Fatal(err)
	}
	if connection.CredentialSaved {
		t.Fatal("changing private-key path retained the old credential reference")
	}
	if _, err := secrets.Get(ctx, reference); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("changing private-key path retained the system credential: %v", err)
	}

	if err := resolver.CommitSuccessful(ctx, connection, domain.AuthRequest{
		Passphrase: "replacement-passphrase", RememberSecret: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteConnection(connection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(ctx, reference); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("deleting connection retained the system credential: %v", err)
	}
}

func TestKeyVaultCreateResolveAndDeleteProtection(t *testing.T) {
	skipUnlessWindows(t, "key-vault private key protection uses Windows DPAPI in this build")
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	testValue := "test-value-" + t.Name()
	keyPath := writeTestPrivateKey(t, true, testValue)

	entry, err := app.CreateKeyVaultEntry(domain.SaveKeyVaultEntryRequest{
		Name: "deploy-key", PrivateKeyPath: keyPath,
		Passphrase: testValue, RememberPassphrase: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !entry.Encrypted || !entry.PassphraseSaved || entry.PassphraseCredentialRef != "" {
		t.Fatalf("entry exposed wrong state: %+v", entry)
	}
	reference := credential.KeyVaultPassphraseReference(entry.ID)
	if string(secrets.values[reference]) != testValue {
		t.Fatal("passphrase was not stored under the key-vault reference")
	}
	connection, err := store.SaveConnection(app.ctx, domain.SaveConnectionRequest{
		Name: "server", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &entry.ID, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	resolved, err := app.credentials.Resolve(app.ctx, connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.ResolvedFromStore ||
		resolved.ResolvedPrivateKeyPath != "" ||
		len(resolved.ResolvedPrivateKeyPEM) == 0 ||
		resolved.ResolvedKeyVaultID != entry.ID {
		t.Fatalf("resolved auth = %+v", resolved)
	}
	preview, err := app.DeleteKeyVaultEntry(domain.DeleteKeyVaultEntryRequest{ID: entry.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.RequiresConfirmation || preview.Deleted || preview.UnboundServerCount != 1 ||
		len(preview.UnboundServerNames) != 1 || preview.UnboundServerNames[0] != "server" {
		t.Fatalf("preview delete response = %+v", preview)
	}
	afterPreview, err := store.GetConnection(app.ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterPreview.KeyVaultID == nil || *afterPreview.KeyVaultID != entry.ID {
		t.Fatalf("preview should not unbind server: %+v", afterPreview)
	}
	deleted, err := app.DeleteKeyVaultEntry(domain.DeleteKeyVaultEntryRequest{ID: entry.ID, ForceUnbind: true})
	if err != nil {
		t.Fatal(err)
	}
	if !deleted.Deleted || deleted.RequiresConfirmation || deleted.UnboundServerCount != 1 {
		t.Fatalf("forced delete response = %+v", deleted)
	}
	if _, ok := secrets.values[reference]; ok {
		t.Fatal("key vault passphrase was not deleted from SecretStore")
	}
	if _, err := store.GetKeyVaultEntry(app.ctx, entry.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("key should be deleted, err=%v", err)
	}
	unbound, err := store.GetConnection(app.ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unbound.AuthType != domain.AuthPrivateKey ||
		unbound.PrivateKeySource != domain.PrivateKeySourceKeyVault ||
		unbound.KeyVaultID != nil {
		t.Fatalf("server should remain key-vault auth but need key reselect: %+v", unbound)
	}
}

func TestDeleteKeyVaultEntryReturnsWarningWhenSecretCleanupFails(t *testing.T) {
	skipUnlessWindows(t, "key-vault private key protection uses Windows DPAPI in this build")
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, store := setupConnectionConfigApp(t, secrets)
	testValue := "test-value-" + t.Name()
	keyPath := writeTestPrivateKey(t, true, testValue)

	entry, err := app.CreateKeyVaultEntry(domain.SaveKeyVaultEntryRequest{
		Name: "cleanup-warning", PrivateKeyPath: keyPath,
		Passphrase: testValue, RememberPassphrase: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	reference := credential.KeyVaultPassphraseReference(entry.ID)
	secrets.deleteErr = errors.New("system store unavailable")
	result, err := app.DeleteKeyVaultEntry(domain.DeleteKeyVaultEntryRequest{ID: entry.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Deleted || result.SecretCleanupWarning != "密钥已删除，但系统凭据中的私钥口令清理失败。" {
		t.Fatalf("result = %+v", result)
	}
	if _, err := store.GetKeyVaultEntry(app.ctx, entry.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("key should be deleted despite secret cleanup warning, err=%v", err)
	}
	if _, ok := secrets.values[reference]; !ok {
		t.Fatal("test secret store should still contain the value when deletion fails")
	}
}

func TestKeyVaultWrongPassphraseDoesNotSaveSecret(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	testValue := "test-value-" + t.Name()
	keyPath := writeTestPrivateKey(t, true, testValue)
	if _, err := app.CreateKeyVaultEntry(domain.SaveKeyVaultEntryRequest{
		Name: "bad-key", PrivateKeyPath: keyPath,
		Passphrase: testValue + "-wrong", RememberPassphrase: true,
	}); err == nil {
		t.Fatal("expected wrong passphrase to fail")
	}
	if len(secrets.values) != 0 {
		t.Fatalf("wrong passphrase wrote secret values: %v", secrets.values)
	}
}

func TestGetLocalTerminalCapabilitiesUsesSavedPreference(t *testing.T) {
	skipUnlessWindows(t, "local terminal capabilities are Windows ConPTY-specific")
	t.Setenv(localterminal.ExperimentalEnv, "")
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	settingsValue := app.settings.Get()
	settingsValue.LocalTerminalShellPreference = domain.LocalTerminalShellCmd
	if _, err := app.settings.Save(app.ctx, settingsValue); err != nil {
		t.Fatal(err)
	}

	capabilities, err := app.GetLocalTerminalCapabilities()
	if err != nil {
		t.Fatal(err)
	}
	if !capabilities.Enabled || !capabilities.Supported {
		t.Fatalf("local terminal should be enabled when Windows ConPTY is available: %+v", capabilities)
	}
	if capabilities.CurrentShellPreference != string(domain.LocalTerminalShellCmd) {
		t.Fatalf("capabilities = %+v", capabilities)
	}
}

func TestStartupLocalTerminalRequestIsConsumedOnce(t *testing.T) {
	app := newAppWithArgs([]string{"--ignored", startupLocalTerminalArgPrefix + string(domain.LocalTerminalShellKindCmd)})
	first := app.GetStartupLocalTerminalRequest()
	if first.ShellKind != string(domain.LocalTerminalShellKindCmd) {
		t.Fatalf("startup shell=%q", first.ShellKind)
	}
	second := app.GetStartupLocalTerminalRequest()
	if second.ShellKind != "" {
		t.Fatalf("startup shell should be consumed once, got %q", second.ShellKind)
	}
}

func TestStartupLocalTerminalRequestRejectsInvalidShell(t *testing.T) {
	app := newAppWithArgs([]string{startupLocalTerminalArgPrefix + "cmd-admin"})
	if request := app.GetStartupLocalTerminalRequest(); request.ShellKind != "" {
		t.Fatalf("invalid startup shell was accepted: %+v", request)
	}
}

func TestOpenLocalTerminalRuntimeFailureDoesNotLeaveSession(t *testing.T) {
	skipUnlessWindows(t, "local terminal session startup is Windows ConPTY-specific")
	t.Setenv(localterminal.ExperimentalEnv, "")
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	app.localTerm = localterminal.NewWithFactory(app.ctx, app.logger, nil, failingLocalTerminalFactory{})

	_, err := app.OpenLocalTerminal(domain.LocalTerminalOpenRequest{
		ShellKind: string(domain.LocalTerminalShellKindCmd),
		Rows:      24,
		Cols:      80,
	})
	if err == nil || !strings.Contains(err.Error(), "创建本地终端失败") {
		t.Fatalf("expected local terminal startup error, got %v", err)
	}
	if err := app.WriteLocalTerminal(domain.LocalTerminalWriteRequest{SessionID: "stale-local-session", DataBase64: "YQ=="}); !errors.Is(err, localterminal.ErrNotFound) {
		t.Fatalf("stale write must not create a fake session, got %v", err)
	}
	if err := app.ResizeLocalTerminal(domain.LocalTerminalResizeRequest{SessionID: "stale-local-session", Rows: 24, Cols: 80}); !errors.Is(err, localterminal.ErrNotFound) {
		t.Fatalf("stale resize must not create a fake session, got %v", err)
	}
	if _, err := app.GetLocalTerminalState("stale-local-session"); !errors.Is(err, localterminal.ErrNotFound) {
		t.Fatalf("stale state lookup must not create a fake session, got %v", err)
	}
	if err := app.CloseLocalTerminal("stale-local-session"); err != nil {
		t.Fatalf("stale close must be safe, got %v", err)
	}
	states, err := app.ListLocalTerminals()
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 0 {
		t.Fatalf("failed local terminal should not expose sessions: %+v", states)
	}
}

func TestOpenLocalTerminalCreatesAndClosesIndependentSession(t *testing.T) {
	skipUnlessWindows(t, "local terminal session startup is Windows ConPTY-specific")
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	factory := newAppLocalTerminalFactory()
	app.localTerm = localterminal.NewWithFactory(app.ctx, app.logger, nil, factory)

	opened, err := app.OpenLocalTerminal(domain.LocalTerminalOpenRequest{
		ShellKind: string(domain.LocalTerminalShellKindCmd),
		Rows:      24,
		Cols:      80,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(opened.SessionID, "local-") || opened.Title != "CMD" || opened.ShellKind != "cmd" {
		t.Fatalf("opened=%+v", opened)
	}
	states, err := app.ListLocalTerminals()
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].SessionID != opened.SessionID {
		t.Fatalf("states=%+v", states)
	}

	if err := app.CloseLocalTerminal(opened.SessionID); err != nil {
		t.Fatal(err)
	}
	if factory.closedCount() != 1 {
		t.Fatalf("expected one local PTY close, got %d", factory.closedCount())
	}
}

type failingLocalTerminalFactory struct{}

func (failingLocalTerminalFactory) Start(context.Context, string, string, int, int) (localterminal.PTY, localterminal.PTYProcess, error) {
	return nil, nil, errors.New("创建本地终端失败")
}

type appLocalTerminalFactory struct {
	mu   sync.Mutex
	ptys []*appLocalTerminalPTY
}

func newAppLocalTerminalFactory() *appLocalTerminalFactory {
	return &appLocalTerminalFactory{}
}

func (f *appLocalTerminalFactory) Start(context.Context, string, string, int, int) (localterminal.PTY, localterminal.PTYProcess, error) {
	done := make(chan struct{})
	pty := &appLocalTerminalPTY{done: done}
	proc := &appLocalTerminalProcess{done: done}
	f.mu.Lock()
	f.ptys = append(f.ptys, pty)
	f.mu.Unlock()
	return pty, proc, nil
}

func (f *appLocalTerminalFactory) closedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, pty := range f.ptys {
		if pty.closed {
			count++
		}
	}
	return count
}

type appLocalTerminalPTY struct {
	mu     sync.Mutex
	done   chan struct{}
	closed bool
	once   sync.Once
}

func (p *appLocalTerminalPTY) Read([]byte) (int, error) {
	<-p.done
	return 0, io.EOF
}

func (p *appLocalTerminalPTY) Write(data []byte) (int, error) {
	return len(data), nil
}

func (p *appLocalTerminalPTY) Close() error {
	p.once.Do(func() {
		p.mu.Lock()
		p.closed = true
		p.mu.Unlock()
		close(p.done)
	})
	return nil
}

func (p *appLocalTerminalPTY) Resize(int, int) error {
	return nil
}

type appLocalTerminalProcess struct {
	done chan struct{}
}

func (p *appLocalTerminalProcess) Start() error {
	return nil
}

func (p *appLocalTerminalProcess) Wait() error {
	<-p.done
	return nil
}

func (p *appLocalTerminalProcess) ExitCode() *int {
	code := 0
	return &code
}

func TestAppWriteTerminalPreservesUTF8Bytes(t *testing.T) {
	secrets := &memorySecretStore{values: make(map[string][]byte)}
	app, _ := setupConnectionConfigApp(t, secrets)
	shell := newAppTerminalShell()
	app.terminal = terminalservice.NewWithDialer(
		app.ctx,
		app.logger,
		appTerminalEmitter{},
		nil,
		func(
			context.Context,
			domain.Connection,
			domain.AuthRequest,
			time.Duration,
		) (terminalservice.Transport, time.Duration, error) {
			return appTerminalTransport{shell: shell}, 0, nil
		},
	)
	t.Cleanup(app.terminal.StopAll)

	info, err := app.terminal.Open(domain.Connection{ID: 71, Name: "unicode"}, domain.AuthRequest{}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	payload := base64.StdEncoding.EncodeToString([]byte("啊"))
	if err := app.WriteTerminal(domain.TerminalWriteRequest{SessionID: info.SessionID, DataBase64: payload}); err != nil {
		t.Fatal(err)
	}

	if !eventuallyAppTest(time.Second, func() bool {
		return bytes.Equal(shell.inputBytes(), []byte{0xe5, 0x95, 0x8a})
	}) {
		t.Fatalf("terminal input bytes=% x", shell.inputBytes())
	}
}

type appTerminalEmitter struct{}

func (appTerminalEmitter) Output(terminalservice.OutputEvent) {}
func (appTerminalEmitter) Status(terminalservice.StatusEvent) {}

type appTerminalTransport struct {
	shell *appTerminalShell
}

func (t appTerminalTransport) OpenTerminal(int, int) (terminalservice.Shell, error) {
	return t.shell, nil
}

func (t appTerminalTransport) Fingerprint() string {
	return "SHA256:test"
}

func (t appTerminalTransport) Close() error {
	return nil
}

type appTerminalShell struct {
	reader    *io.PipeReader
	writer    *io.PipeWriter
	wait      chan error
	closeOnce sync.Once
	mu        sync.Mutex
	input     bytes.Buffer
}

func newAppTerminalShell() *appTerminalShell {
	reader, writer := io.Pipe()
	return &appTerminalShell{reader: reader, writer: writer, wait: make(chan error, 1)}
}

func (s *appTerminalShell) Read(buffer []byte) (int, error) {
	return s.reader.Read(buffer)
}

func (s *appTerminalShell) Write(data []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.input.Write(data)
}

func (s *appTerminalShell) Resize(int, int) error {
	return nil
}

func (s *appTerminalShell) Wait() error {
	return <-s.wait
}

func (s *appTerminalShell) Close() error {
	s.closeOnce.Do(func() {
		_ = s.writer.Close()
		_ = s.reader.Close()
		s.wait <- io.EOF
	})
	return nil
}

func (s *appTerminalShell) inputBytes() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.input.Bytes()...)
}

func eventuallyAppTest(timeout time.Duration, fn func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return fn()
}

func writeTestPrivateKey(t *testing.T, encrypted bool, passphrase string) string {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var block *pem.Block
	if encrypted {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(privateKey, "", []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(privateKey, "")
	}
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
