package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

func TestDefaultSettingsAndMigrationVersion(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	value, err := store.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(value, domain.DefaultAppSettings()) {
		t.Fatalf("settings = %+v", value)
	}
	version, err := store.MigrationVersion(ctx)
	if err != nil || version != 25 {
		t.Fatalf("migration version=%d err=%v", version, err)
	}
}

func TestOldDatabaseMigrationIsRepeatable(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE connections (
 id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, name TEXT NOT NULL,
 host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL,
 auth_type TEXT NOT NULL, private_key_path TEXT NOT NULL DEFAULT '',
 host_key_fingerprint TEXT NOT NULL DEFAULT '', refresh_interval INTEGER NOT NULL DEFAULT 2,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE credential_refs (
 connection_id INTEGER NOT NULL, kind TEXT NOT NULL, reference TEXT NOT NULL,
 PRIMARY KEY(connection_id, kind)
);`)
	if err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	for iteration := 0; iteration < 2; iteration++ {
		store, err := Open(ctx, path)
		if err != nil {
			t.Fatal(err)
		}
		version, err := store.MigrationVersion(ctx)
		if err != nil || version != 25 {
			t.Fatalf("migration version=%d err=%v", version, err)
		}
		settings, err := store.GetSettings(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if settings.HostKeyPolicy != domain.HostKeyAutoUpdate || settings.ThemeMode != domain.ThemeDark ||
			!settings.TerminalCopyOnSelectEnabled || !settings.TerminalRightClickPasteEnabled ||
			settings.LocalTerminalElevatedEnabled || settings.DefaultTerminalProfileID != domain.DefaultTerminalProfileID ||
			settings.CommandHistoryMaxEntries != domain.DefaultCommandHistoryMaxEntries ||
			settings.BackupImportOptions != domain.DefaultBackupImportOptionPreferences() ||
			!settings.SSHKeepaliveEnabled ||
			settings.SSHKeepaliveIntervalSeconds != domain.DefaultSSHKeepaliveIntervalSeconds ||
			settings.SSHKeepaliveTimeoutSeconds != domain.DefaultSSHKeepaliveTimeoutSeconds ||
			settings.SSHKeepaliveMaxFailures != domain.DefaultSSHKeepaliveMaxFailures ||
			settings.DashboardSortMode != domain.DashboardSortManual ||
			len(settings.DashboardManualServerOrder) != 0 ||
			settings.Alerts != domain.DefaultAlertSettings() ||
			!settings.OnboardingCompleted {
			t.Fatalf("migrated settings = %+v", settings)
		}
		_ = store.Close()
	}
}

func TestReorderServersPersistsOrderWithinGroupAcrossReload(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	group, err := store.SaveGroup(ctx, domain.Group{Name: "prod"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &group.ID, Name: "alpha", Host: "alpha.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &group.ID, Name: "bravo", Host: "bravo.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	third, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &group.ID, Name: "charlie", Host: "charlie.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	ordered, err := store.ReorderServers(ctx, domain.ReorderServersRequest{
		ServerID:       third.ID,
		SourceGroupID:  &group.ID,
		TargetGroupID:  &group.ID,
		BeforeServerID: &first.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if namesOf(ordered) != "charlie,alpha,bravo" {
		t.Fatalf("ordered=%s", namesOf(ordered))
	}
	_ = store.Close()

	reopened, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	connections, err := reopened.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if namesOf(connections) != "charlie,alpha,bravo" {
		t.Fatalf("reloaded order=%s", namesOf(connections))
	}
	if connections[0].SortOrder >= connections[1].SortOrder || connections[1].SortOrder >= connections[2].SortOrder {
		t.Fatalf("sort order not compact ascending: %+v", connections)
	}
}

func namesOf(connections []domain.Connection) string {
	names := make([]string, 0, len(connections))
	for _, connection := range connections {
		names = append(names, connection.Name)
	}
	return strings.Join(names, ",")
}

func idsOf(connections []domain.Connection) string {
	ids := make([]string, 0, len(connections))
	for _, connection := range connections {
		ids = append(ids, fmt.Sprintf("%d", connection.ID))
	}
	return strings.Join(ids, ",")
}

func findConnectionByID(connections []domain.Connection, id int64) domain.Connection {
	for _, connection := range connections {
		if connection.ID == id {
			return connection
		}
	}
	return domain.Connection{}
}

func duplicatedConnectionIDs(connections []domain.Connection) bool {
	seen := map[int64]bool{}
	for _, connection := range connections {
		if seen[connection.ID] {
			return true
		}
		seen[connection.ID] = true
	}
	return false
}

func TestReorderServersMovesAcrossGroupsAndUngroupedWithoutTouchingCredentials(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	prod, err := store.SaveGroup(ctx, domain.Group{Name: "prod"})
	if err != nil {
		t.Fatal(err)
	}
	dev, err := store.SaveGroup(ctx, domain.Group{Name: "dev"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &prod.ID, Name: "alpha", Host: "alpha.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: &dev.ID, Name: "bravo", Host: "bravo.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	third, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: nil, Name: "charlie", Host: "charlie.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, first.ID, "password", "secret-ref"); err != nil {
		t.Fatal(err)
	}

	_, err = store.ReorderServers(ctx, domain.ReorderServersRequest{
		ServerID:       first.ID,
		SourceGroupID:  &prod.ID,
		TargetGroupID:  &dev.ID,
		BeforeServerID: &second.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	connections, err := store.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if namesOf(connections) != "alpha,bravo,charlie" {
		t.Fatalf("after group move order=%s", namesOf(connections))
	}
	moved := findConnectionByID(connections, first.ID)
	if moved.GroupID == nil || *moved.GroupID != dev.ID {
		t.Fatalf("moved group=%v want %d", moved.GroupID, dev.ID)
	}
	refs, err := store.ListCredentialRefs(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0] != "secret-ref" {
		t.Fatalf("credential refs touched: %+v", refs)
	}

	_, err = store.ReorderServers(ctx, domain.ReorderServersRequest{
		ServerID:      second.ID,
		SourceGroupID: &dev.ID,
		TargetGroupID: nil,
		AfterServerID: &third.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	connections, err = store.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ungroupedSecond := findConnectionByID(connections, second.ID)
	if ungroupedSecond.GroupID != nil {
		t.Fatalf("server was not moved to ungrouped: %+v", ungroupedSecond)
	}
	if duplicatedConnectionIDs(connections) {
		t.Fatalf("duplicate connections after reorder: %+v", connections)
	}
}

func TestReorderServersRejectsMissingGroupAndKeepsOrder(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "alpha", Host: "alpha.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "bravo", Host: "bravo.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	missingGroup := int64(9999)
	if _, err := store.ReorderServers(ctx, domain.ReorderServersRequest{
		ServerID:      first.ID,
		TargetGroupID: &missingGroup,
	}); err == nil {
		t.Fatal("expected missing group error")
	}
	connections, err := store.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if idsOf(connections) != fmt.Sprintf("%d,%d", first.ID, second.ID) {
		t.Fatalf("order changed after failed reorder: %s", idsOf(connections))
	}
}

func TestBatchCommandHistoryUsesMainRecordAndTargetRelations(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "batch-a", Host: "batch-a.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "batch-b", Host: "batch-b.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	third, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "batch-c", Host: "batch-c.example.invalid", Port: 22, Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	entry, err := store.InsertBatchCommandHistory(ctx, domain.CommandHistoryEntry{
		ID:          "batch-main-1",
		Command:     "uname -a",
		CommandHash: "hash-uname",
		Source:      "batch",
		ExecutedAt:  now,
	}, []int64{first.ID, second.ID, third.ID, second.ID}, "submission-1")
	if err != nil {
		t.Fatal(err)
	}
	if entry.ID != "batch-main-1" || entry.TargetCount != 3 || len(entry.TargetServerIDs) != 3 {
		t.Fatalf("batch entry=%+v", entry)
	}
	var ordinaryCount, batchCount, targetCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM command_history`).Scan(&ordinaryCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM command_history_batch_entries`).Scan(&batchCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM command_history_batch_targets`).Scan(&targetCount); err != nil {
		t.Fatal(err)
	}
	if ordinaryCount != 0 || batchCount != 1 || targetCount != 3 {
		t.Fatalf("counts ordinary=%d batch=%d targets=%d", ordinaryCount, batchCount, targetCount)
	}
	repeated, err := store.InsertBatchCommandHistory(ctx, domain.CommandHistoryEntry{
		ID:          "batch-main-duplicate",
		Command:     "uname -a",
		CommandHash: "hash-uname",
		Source:      "batch",
		ExecutedAt:  now,
	}, []int64{first.ID}, "submission-1")
	if err != nil {
		t.Fatal(err)
	}
	if repeated.ID != entry.ID || repeated.TargetCount != 3 {
		t.Fatalf("same submission should return existing entry: repeated=%+v entry=%+v", repeated, entry)
	}
	all, err := store.ListCommandHistory(ctx, domain.ListCommandHistoryRequest{Scope: domain.CommandListScopeAll, Query: "uname", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.ListCommandHistory(ctx, domain.ListCommandHistoryRequest{ServerID: second.ID, Scope: domain.CommandListScopeCurrentServer, Query: "uname", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || len(current) != 1 || all[0].ID != entry.ID || current[0].ID != entry.ID {
		t.Fatalf("logical history all=%+v current=%+v", all, current)
	}
}

func TestKeyVaultPersistenceLifecycle(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	validation := domain.PrivateKeyValidationResult{
		Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:test", Encrypted: true, Valid: true,
	}
	entry, err := store.CreateKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name: "deploy", PrivateKeyPath: "/tmp/id_ed25519", Notes: "note",
	}, validation)
	if err != nil {
		t.Fatal(err)
	}
	if entry.ID == 0 || !entry.Encrypted || entry.PassphraseSaved {
		t.Fatalf("created entry = %+v", entry)
	}
	if err := store.SetKeyVaultPassphraseRef(ctx, entry.ID, "HostDeck/keyvault/1/passphrase"); err != nil {
		t.Fatal(err)
	}
	entry, err = store.GetKeyVaultEntry(ctx, entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !entry.PassphraseSaved || entry.PassphraseCredentialRef == "" {
		t.Fatalf("passphrase ref not saved: %+v", entry)
	}
	if err := store.UpdateKeyVaultLastUsed(ctx, entry.ID, timeNowForTest()); err != nil {
		t.Fatal(err)
	}
	entry, err = store.UpdateKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		ID: entry.ID, Name: "renamed", PrivateKeyPath: "/tmp/id_ed25519", Notes: "updated",
	}, domain.PrivateKeyValidationResult{})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Name != "renamed" || entry.Notes != "updated" || !entry.PassphraseSaved {
		t.Fatalf("updated entry = %+v", entry)
	}
	if err := store.DeleteKeyVaultEntry(ctx, entry.ID); err != nil {
		t.Fatal(err)
	}
}

func TestEncryptedKeyVaultEntryHidesSourcePathAndCountsSharedUsage(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	validation := domain.PrivateKeyValidationResult{
		Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:shared", KeyBits: 256,
		Encrypted: false, Valid: true,
	}
	entry, err := store.CreateEncryptedKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name: "shared", PrivateKeyPath: "C:/Users/test/.ssh/id_ed25519", Notes: "note",
	}, validation, []byte("protected-key-material"), "id_ed25519")
	if err != nil {
		t.Fatal(err)
	}
	if entry.StorageMode != string(domain.KeyVaultStorageEncryptedDatabase) ||
		entry.PrivateKeyPath != "" ||
		entry.SourceFileName != "id_ed25519" ||
		string(entry.ProtectedKeyBlob) != "protected-key-material" {
		t.Fatalf("encrypted entry = %+v", entry)
	}
	for _, name := range []string{"server-a", "server-b"} {
		if _, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
			Name: name, Host: "192.0.2.10", Port: 22, Username: "root",
			AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
			KeyVaultID: &entry.ID, RefreshInterval: 2,
		}); err != nil {
			t.Fatal(err)
		}
	}
	entry, err = store.GetKeyVaultEntry(ctx, entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.UsageCount != 2 {
		t.Fatalf("usage count = %d, entry = %+v", entry.UsageCount, entry)
	}
	entries, err := store.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].PrivateKeyPath != "" || entries[0].UsageCount != 2 {
		t.Fatalf("entries = %+v", entries)
	}
}

func TestDeleteKeyVaultEntryWithUnbindClearsServerReferences(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	entry, err := store.CreateEncryptedKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name: "deploy", PrivateKeyPath: "/tmp/id_ed25519",
	}, domain.PrivateKeyValidationResult{Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:test", KeyBits: 256, Valid: true}, []byte("protected"), "id_ed25519")
	if err != nil {
		t.Fatal(err)
	}
	for index, name := range []string{"server-a", "server-b", "server-c"} {
		if _, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
			Name: name, Host: fmt.Sprintf("192.0.2.%d", 10+index), Port: 22, Username: "root",
			AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
			KeyVaultID: &entry.ID, RefreshInterval: 2,
		}); err != nil {
			t.Fatal(err)
		}
	}
	preview, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{ID: entry.ID})
	if err != nil {
		t.Fatal(err)
	}
	if preview.Deleted || !preview.RequiresConfirmation || preview.UnboundServerCount != 3 ||
		strings.Join(preview.UnboundServerNames, ",") != "server-a,server-b,server-c" {
		t.Fatalf("preview = %+v", preview)
	}
	stillThere, err := store.GetKeyVaultEntry(ctx, entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stillThere.UsageCount != 3 {
		t.Fatalf("preview should not change usage: %+v", stillThere)
	}
	result, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{ID: entry.ID, ForceUnbind: true})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Deleted || result.RequiresConfirmation || result.UnboundServerCount != 3 {
		t.Fatalf("result = %+v", result)
	}
	if _, err := store.GetKeyVaultEntry(ctx, entry.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("key should be deleted, err=%v", err)
	}
	if _, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{ID: entry.ID, ForceUnbind: true}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("second delete should report not found, err=%v", err)
	}
	connections, err := store.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 3 {
		t.Fatalf("connections were deleted: %+v", connections)
	}
	for _, connection := range connections {
		if connection.AuthType != domain.AuthPrivateKey ||
			connection.PrivateKeySource != domain.PrivateKeySourceKeyVault ||
			connection.KeyVaultID != nil ||
			connection.Username != "root" ||
			connection.Port != 22 {
			t.Fatalf("connection was not preserved with missing key state: %+v", connection)
		}
	}
}

func TestDeleteLegacyKeyVaultEntryDoesNotDeleteSourceFile(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	keyPath := filepath.Join(t.TempDir(), "id_rsa")
	if err := os.WriteFile(keyPath, []byte("legacy private key placeholder"), 0o600); err != nil {
		t.Fatal(err)
	}
	entry, err := store.CreateKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name: "legacy", PrivateKeyPath: keyPath,
	}, domain.PrivateKeyValidationResult{Algorithm: "ssh-rsa", FingerprintSHA256: "SHA256:legacy", Valid: true})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "legacy-user", Host: "192.0.2.20", Port: 22, Username: "root",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &entry.ID, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{ID: entry.ID, ForceUnbind: true})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Deleted || result.UnboundServerCount != 1 {
		t.Fatalf("result = %+v", result)
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("legacy source file should remain: %v", err)
	}
	unbound, err := store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unbound.KeyVaultID != nil || unbound.AuthType != domain.AuthPrivateKey ||
		unbound.PrivateKeySource != domain.PrivateKeySourceKeyVault {
		t.Fatalf("legacy key user should remain a key-vault server needing key reselect: %+v", unbound)
	}
}

func TestDeleteKeyVaultEntryWithUnbindRollsBackOnDatabaseFailure(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	entry, err := store.CreateEncryptedKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name: "deploy", PrivateKeyPath: "/tmp/id_ed25519",
	}, domain.PrivateKeyValidationResult{Algorithm: "ssh-ed25519", FingerprintSHA256: "SHA256:rollback", KeyBits: 256, Valid: true}, []byte("protected"), "id_ed25519")
	if err != nil {
		t.Fatal(err)
	}
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-a", Host: "192.0.2.30", Port: 22, Username: "root",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &entry.ID, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `
CREATE TRIGGER fail_key_vault_unbind
BEFORE UPDATE OF key_vault_id ON connections
WHEN OLD.key_vault_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'forced rollback');
END;`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{
		ID: entry.ID, ForceUnbind: true,
	}); err == nil {
		t.Fatal("expected forced rollback error")
	}
	stillThere, err := store.GetKeyVaultEntry(ctx, entry.ID)
	if err != nil {
		t.Fatalf("key should remain after rollback: %v", err)
	}
	if stillThere.UsageCount != 1 {
		t.Fatalf("usage count should remain after rollback: %+v", stillThere)
	}
	bound, err := store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bound.KeyVaultID == nil || *bound.KeyVaultID != entry.ID {
		t.Fatalf("server reference should remain after rollback: %+v", bound)
	}
	if _, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{
		ID: entry.ID, ForceUnbind: true,
	}); err == nil {
		t.Fatal("trigger should still block repeated delete attempts")
	}
}

func timeNowForTest() time.Time {
	return time.Unix(1_700_000_000, 0)
}

func TestSettingsReadAndUpdate(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	value := domain.DefaultAppSettings()
	value.DefaultRememberPassword = true
	value.DefaultRememberPassphrase = true
	value.HostKeyPolicy = domain.HostKeyStrict
	value.ThemeMode = domain.ThemeSystem
	value.UIFontSize = domain.UIFontXLarge
	value.LocalTerminalElevatedEnabled = true
	value.DefaultTerminalProfileID = domain.DefaultTerminalProfileID
	value.CommandHistoryMaxEntries = 500
	value.SSHKeepaliveEnabled = false
	value.SSHKeepaliveIntervalSeconds = 60
	value.SSHKeepaliveTimeoutSeconds = 15
	value.SSHKeepaliveMaxFailures = 5
	value.TerminalCopyOnSelectEnabled = false
	value.TerminalRightClickPasteEnabled = false
	value.Shortcuts.TerminalCopyOnSelectEnabled = false
	value.Shortcuts.TerminalRightClickAction = domain.TerminalRightClickMenu
	value.ConnectionTimeoutSeconds = 30
	value.DashboardSortMode = domain.DashboardSortNetwork
	value.DashboardManualServerOrder = []string{"3", "1", "2"}
	value.Alerts.CPU.Threshold = 82
	value.Alerts.CPU.DurationSeconds = 45
	value.Alerts.Latency.Enabled = true
	value.Alerts.Latency.Threshold = 750
	value.BackupImportOptions = domain.BackupImportOptions{
		ImportSettings:  true,
		ImportGroups:    false,
		ImportServers:   true,
		ImportKeyVault:  false,
		ImportHostTrust: true,
	}
	value.WindowWidth = 1440
	value.WindowHeight = 900
	value.WindowMaximized = true
	value.OnboardingCompleted = true
	if err := store.SaveSettings(ctx, value); err != nil {
		t.Fatal(err)
	}
	actual, err := store.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, value) {
		t.Fatalf("actual=%+v want=%+v", actual, value)
	}
}

func TestDashboardManualOrderSettingsBackupImportRemapsServers(t *testing.T) {
	ctx := context.Background()
	source, err := Open(ctx, filepath.Join(t.TempDir(), "source.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	first, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-a", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-b", Host: "192.0.2.11", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	settings := domain.DefaultAppSettings()
	settings.DashboardSortMode = domain.DashboardSortManual
	settings.DashboardManualServerOrder = []string{
		fmt.Sprint(second.ID),
		"999999",
		fmt.Sprint(first.ID),
	}
	if err := source.SaveSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	payload, err := source.ExportBackupPayload(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Settings == nil || !reflect.DeepEqual(payload.Settings.DashboardManualServerOrder, settings.DashboardManualServerOrder) {
		t.Fatalf("backup settings = %+v", payload.Settings)
	}

	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if _, err := target.ImportBackupPayload(ctx, payload, domain.DefaultBackupImportOptions()); err != nil {
		t.Fatal(err)
	}
	importedConnections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	idByHost := map[string]string{}
	for _, connection := range importedConnections {
		idByHost[connection.Host] = fmt.Sprint(connection.ID)
	}
	importedSettings, err := target.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	expectedOrder := []string{idByHost["192.0.2.11"], idByHost["192.0.2.10"]}
	if importedSettings.DashboardSortMode != domain.DashboardSortManual ||
		!reflect.DeepEqual(importedSettings.DashboardManualServerOrder, expectedOrder) {
		t.Fatalf("imported dashboard settings = %+v want order %v", importedSettings, expectedOrder)
	}
}

func TestTerminalProfileCRUDAndResolution(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	profiles, err := store.ListTerminalProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || profiles[0].ID != domain.DefaultTerminalProfileID || profiles[0].Name != "默认" {
		t.Fatalf("default profiles = %+v", profiles)
	}
	if _, err := store.CreateTerminalProfile(ctx, terminalProfileRequest("默认")); !errors.Is(err, ErrTerminalProfileNameExists) {
		t.Fatalf("duplicate profile err=%v", err)
	}
	assertGraphiteDefaultTerminalProfile(t, profiles[0])
	custom, err := store.CreateTerminalProfile(ctx, terminalProfileRequest("Work"))
	if err != nil {
		t.Fatal(err)
	}
	custom.FontSize = 18
	custom.Foreground = "#ffffff"
	updated, err := store.UpdateTerminalProfile(ctx, domain.TerminalProfileToSaveRequest(custom))
	if err != nil {
		t.Fatal(err)
	}
	if updated.FontSize != 18 || updated.Foreground != "#ffffff" {
		t.Fatalf("updated profile = %+v", updated)
	}
	duplicate, err := store.DuplicateTerminalProfile(ctx, custom.ID)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate.ID == custom.ID || !strings.Contains(duplicate.Name, "副本") {
		t.Fatalf("duplicate profile = %+v", duplicate)
	}
	settings, err := store.SetDefaultTerminalProfile(ctx, custom.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settings.DefaultTerminalProfileID != custom.ID {
		t.Fatalf("default terminal profile id = %q", settings.DefaultTerminalProfileID)
	}
	resolved, err := store.GetResolvedTerminalProfile(ctx, domain.ResolveTerminalProfileRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ID != custom.ID {
		t.Fatalf("resolved default = %+v", resolved)
	}
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-a", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2, TerminalProfileID: &duplicate.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolved, err = store.GetResolvedTerminalProfile(ctx, domain.ResolveTerminalProfileRequest{ServerID: connection.ID})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ID != duplicate.ID {
		t.Fatalf("resolved server override = %+v", resolved)
	}
	if _, err := store.DeleteTerminalProfile(ctx, domain.DeleteTerminalProfileRequest{ID: custom.ID}); !errors.Is(err, ErrDefaultTerminalProfile) {
		t.Fatalf("delete default err=%v", err)
	}
	if _, err := store.DeleteTerminalProfile(ctx, domain.DeleteTerminalProfileRequest{ID: duplicate.ID}); !errors.Is(err, ErrTerminalProfileInUse) {
		t.Fatalf("delete in-use err=%v", err)
	}
	result, err := store.DeleteTerminalProfile(ctx, domain.DeleteTerminalProfileRequest{
		ID:                 duplicate.ID,
		ForceDetachServers: true,
	})
	if err != nil {
		t.Fatalf("force delete in-use profile: %v", err)
	}
	if result.DetachedServers != 1 {
		t.Fatalf("detached servers = %d", result.DetachedServers)
	}
	connection, err = store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.TerminalProfileID != nil {
		t.Fatalf("connection terminal profile id after force delete = %v", *connection.TerminalProfileID)
	}
	resolved, err = store.GetResolvedTerminalProfile(ctx, domain.ResolveTerminalProfileRequest{ServerID: connection.ID})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ID != custom.ID {
		t.Fatalf("resolved after force delete should inherit default = %+v", resolved)
	}
}

func TestLegacyDefaultTerminalProfileMigratesToGraphiteTheme(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-terminal-profile.db")
	createTerminalProfileMigrationFixture(t, path, terminalProfileMigrationFixture{
		fontSize:            15,
		foreground:          "#dbeafe",
		background:          "#07111f",
		selectionBackground: "#2563eb66",
		cursorColor:         "#ffffff",
	})
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	profile, err := store.GetTerminalProfile(ctx, domain.DefaultTerminalProfileID)
	if err != nil {
		t.Fatal(err)
	}
	assertGraphiteDefaultTerminalProfile(t, profile)
}

func TestCustomizedDefaultTerminalProfileIsNotOverwrittenByGraphiteMigration(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "custom-terminal-profile.db")
	createTerminalProfileMigrationFixture(t, path, terminalProfileMigrationFixture{
		fontSize:            15,
		foreground:          "#ffffff",
		background:          "#07111f",
		selectionBackground: "#2563eb66",
		cursorColor:         "#ffffff",
	})
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	profile, err := store.GetTerminalProfile(ctx, domain.DefaultTerminalProfileID)
	if err != nil {
		t.Fatal(err)
	}
	if profile.Foreground != "#ffffff" ||
		profile.Background != "#07111f" ||
		profile.SelectionBackground != "#2563eb66" ||
		profile.CursorColor != "#ffffff" ||
		profile.FontSize != 15 {
		t.Fatalf("customized profile was overwritten: %+v", profile)
	}
}

type terminalProfileMigrationFixture struct {
	fontSize            int
	foreground          string
	background          string
	selectionBackground string
	cursorColor         string
}

func createTerminalProfileMigrationFixture(t *testing.T, path string, fixture terminalProfileMigrationFixture) {
	t.Helper()
	ctx := context.Background()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE terminal_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    font_family TEXT NOT NULL,
    font_size INTEGER NOT NULL,
    line_height REAL NOT NULL,
    letter_spacing REAL NOT NULL,
    cursor_style TEXT NOT NULL,
    cursor_blink INTEGER NOT NULL,
    scrollback INTEGER NOT NULL,
    theme_name TEXT NOT NULL,
    foreground TEXT NOT NULL,
    background TEXT NOT NULL,
    selection_background TEXT NOT NULL,
    cursor_color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);`)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	for version := 1; version <= 24; version++ {
		if _, err := db.ExecContext(ctx,
			"INSERT INTO schema_migrations(version, applied_at) VALUES(?, CURRENT_TIMESTAMP)",
			version,
		); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
	}
	_, err = db.ExecContext(ctx, `INSERT INTO terminal_profiles(
    id, name, font_family, font_size, line_height, letter_spacing,
    cursor_style, cursor_blink, scrollback, theme_name,
    foreground, background, selection_background, cursor_color, created_at, updated_at
) VALUES(
    'default', 'Default', 'Consolas, Cascadia Mono, monospace', ?, 1.2, 0,
    'block', 1, 10000, 'hostdeck-dark',
    ?, ?, ?, ?,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)`, fixture.fontSize, fixture.foreground, fixture.background, fixture.selectionBackground, fixture.cursorColor)
	if closeErr := db.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		t.Fatal(err)
	}
}

func assertGraphiteDefaultTerminalProfile(t *testing.T, profile domain.TerminalProfile) {
	t.Helper()
	if profile.FontSize != 13 ||
		profile.Foreground != "#d7dde5" ||
		profile.Background != "#15171a" ||
		profile.SelectionBackground != "#5b8cff47" ||
		profile.CursorColor != "#dce6f2" ||
		profile.ThemeName != domain.TerminalThemeHostDeckDark {
		t.Fatalf("default terminal profile = %+v", profile)
	}
}

func TestTerminalProfileValidation(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.CreateTerminalProfile(ctx, terminalProfileRequestWith("bad-size", func(request *domain.SaveTerminalProfileRequest) {
		request.FontSize = 9
	})); err == nil || !strings.Contains(err.Error(), "字体大小必须在 10 到 28 之间") {
		t.Fatalf("font size validation err=%v", err)
	}
	if _, err := store.CreateTerminalProfile(ctx, terminalProfileRequestWith("bad-line-height", func(request *domain.SaveTerminalProfileRequest) {
		request.LineHeight = 2.5
	})); err == nil || !strings.Contains(err.Error(), "行高必须在 1.0 到 2.0 之间") {
		t.Fatalf("line height validation err=%v", err)
	}
	if _, err := store.CreateTerminalProfile(ctx, terminalProfileRequestWith("bad-scrollback", func(request *domain.SaveTerminalProfileRequest) {
		request.Scrollback = 999
	})); err == nil || !strings.Contains(err.Error(), "滚动缓冲行数必须在 1000 到 50000 之间") {
		t.Fatalf("scrollback validation err=%v", err)
	}
	if _, err := store.CreateTerminalProfile(ctx, terminalProfileRequestWith("bad-color", func(request *domain.SaveTerminalProfileRequest) {
		request.Foreground = "url(javascript:alert(1))"
	})); err == nil || !strings.Contains(err.Error(), "颜色格式无效") {
		t.Fatalf("color validation err=%v", err)
	}
	if _, err := store.CreateTerminalProfile(ctx, terminalProfileRequestWith("bad-font-family", func(request *domain.SaveTerminalProfileRequest) {
		request.FontFamily = "Consolas; background:red"
	})); err == nil || !strings.Contains(err.Error(), "字体名称包含不允许的字符") {
		t.Fatalf("font family validation err=%v", err)
	}
}

func TestTerminalProfilesBackupImportRemapsServerOverrides(t *testing.T) {
	ctx := context.Background()
	source, err := Open(ctx, filepath.Join(t.TempDir(), "source.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	profile, err := source.CreateTerminalProfile(ctx, terminalProfileRequest("Ops"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.SetDefaultTerminalProfile(ctx, profile.ID); err != nil {
		t.Fatal(err)
	}
	_, err = source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-a", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2, TerminalProfileID: &profile.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := source.ExportBackupPayload(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.TerminalProfiles) != 2 {
		t.Fatalf("backup terminal profiles = %+v", payload.TerminalProfiles)
	}
	if payload.Settings == nil || payload.Settings.DefaultTerminalProfileID != profile.ID {
		t.Fatalf("backup settings = %+v", payload.Settings)
	}
	if len(payload.Connections) != 1 || payload.Connections[0].TerminalProfileID == nil ||
		*payload.Connections[0].TerminalProfileID != profile.ID {
		t.Fatalf("backup connection profile = %+v", payload.Connections)
	}
	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	result, err := target.ImportBackupPayload(ctx, payload, domain.DefaultBackupImportOptions())
	if err != nil {
		t.Fatal(err)
	}
	if result.ConnectionsAdded != 1 {
		t.Fatalf("import result = %+v", result)
	}
	importedConnections, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(importedConnections) != 1 || importedConnections[0].TerminalProfileID == nil {
		t.Fatalf("imported connections = %+v", importedConnections)
	}
	importedSettings, err := target.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if importedSettings.DefaultTerminalProfileID == profile.ID || importedSettings.DefaultTerminalProfileID == domain.DefaultTerminalProfileID {
		t.Fatalf("default profile was not remapped: %+v", importedSettings)
	}
	resolved, err := target.GetResolvedTerminalProfile(ctx, domain.ResolveTerminalProfileRequest{ServerID: importedConnections[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Name != "Ops" {
		t.Fatalf("resolved imported profile = %+v", resolved)
	}
}

func terminalProfileRequest(name string) domain.SaveTerminalProfileRequest {
	return terminalProfileRequestWith(name, nil)
}

func terminalProfileRequestWith(
	name string,
	mutate func(*domain.SaveTerminalProfileRequest),
) domain.SaveTerminalProfileRequest {
	request := domain.TerminalProfileToSaveRequest(domain.DefaultTerminalProfile())
	request.ID = ""
	request.Name = name
	request.ThemeName = domain.TerminalThemeCustom
	request.Foreground = "#dbeafe"
	request.Background = "#07111f"
	request.SelectionBackground = "#2563eb66"
	request.CursorColor = "#ffffff"
	if mutate != nil {
		mutate(&request)
	}
	return request
}

func TestTunnelProfileCRUDAndBackupPayload(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-a", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	profile, err := store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		Name: "web", ServerID: connection.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18080,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID == 0 || profile.ServerID != connection.ID {
		t.Fatalf("profile=%+v", profile)
	}
	profile.BindPort = 18081
	updated, err := store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		ID: profile.ID, Name: profile.Name, ServerID: profile.ServerID, Type: profile.Type,
		BindHost: profile.BindHost, BindPort: profile.BindPort,
		TargetHost: profile.TargetHost, TargetPort: profile.TargetPort,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.BindPort != 18081 {
		t.Fatalf("updated bind port = %d", updated.BindPort)
	}
	payload, err := store.ExportBackupPayload(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.TunnelProfiles) != 1 {
		t.Fatalf("backup tunnel profiles = %+v", payload.TunnelProfiles)
	}
	if payload.TunnelProfiles[0].Name != "web" || payload.TunnelProfiles[0].BindPort != 18081 {
		t.Fatalf("backup profile = %+v", payload.TunnelProfiles[0])
	}
	if err := store.DeleteTunnelProfile(ctx, profile.ID); err != nil {
		t.Fatal(err)
	}
	profiles, err := store.ListTunnelProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 0 {
		t.Fatalf("profiles after delete = %+v", profiles)
	}
}

func TestTunnelProfileDuplicateNameReturnsChineseTypedError(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	firstServer, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-a", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	secondServer, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "server-b", Host: "192.0.2.11", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		Name: "web", ServerID: firstServer.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18080,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		Name: "web", ServerID: firstServer.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18081,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if !errors.Is(err, ErrTunnelProfileNameExists) {
		t.Fatalf("duplicate err=%v", err)
	}
	if text := err.Error(); !strings.Contains(text, "该服务器下已存在同名端口转发配置") ||
		strings.Contains(text, "idx_tunnel_profiles_server_name") ||
		strings.Contains(text, "(2067)") {
		t.Fatalf("duplicate error leaked raw sqlite detail: %q", text)
	}
	if _, err := store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		Name: "web", ServerID: secondServer.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18080,
		TargetHost: "127.0.0.1", TargetPort: 80,
	}); err != nil {
		t.Fatalf("same profile name on another server should succeed: %v", err)
	}
	if _, err := store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		ID: first.ID, Name: "web", ServerID: firstServer.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18082,
		TargetHost: "127.0.0.1", TargetPort: 80,
	}); err != nil {
		t.Fatalf("same profile unchanged name should update: %v", err)
	}
	second, err := store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		Name: "api", ServerID: firstServer.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18083,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SaveTunnelProfile(ctx, domain.SaveTunnelProfileRequest{
		ID: second.ID, Name: "web", ServerID: firstServer.ID, Type: domain.TunnelTypeLocal,
		BindHost: "127.0.0.1", BindPort: 18084,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if !errors.Is(err, ErrTunnelProfileNameExists) {
		t.Fatalf("rename duplicate err=%v", err)
	}
}

func TestConnectionPersistenceAndHostKeyReset(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	request := domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	}
	connection, err := store.SaveConnection(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateHostKey(ctx, connection.ID, "SHA256:test"); err != nil {
		t.Fatal(err)
	}
	request.ID = connection.ID
	request.Host = "192.0.2.11"
	connection, err = store.SaveConnection(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if connection.HostKeyFingerprint != "" {
		t.Fatalf("host key was not reset: %q", connection.HostKeyFingerprint)
	}
}

func TestConnectionRoutePersistence(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	jump, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "jump", Host: "198.51.100.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if jump.ConnectionMode != domain.ConnectionModeDirect || jump.JumpServerID != nil {
		t.Fatalf("default route=%s jump=%v", jump.ConnectionMode, jump.JumpServerID)
	}

	target, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "target", Host: "10.0.0.8", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &jump.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if target.ConnectionMode != domain.ConnectionModeJump || target.JumpServerID == nil || *target.JumpServerID != jump.ID {
		t.Fatalf("target route=%s jump=%v", target.ConnectionMode, target.JumpServerID)
	}

	target.ConnectionMode = domain.ConnectionModeDirect
	target, err = store.SaveConnection(ctx, domain.SaveConnectionRequest{
		ID: target.ID, Name: target.Name, Host: target.Host, Port: target.Port, Username: target.Username,
		AuthType: target.AuthType, RefreshInterval: target.RefreshInterval,
		ConnectionMode: domain.ConnectionModeDirect, JumpServerID: &jump.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if target.ConnectionMode != domain.ConnectionModeDirect || target.JumpServerID != nil {
		t.Fatalf("direct route kept jump reference: %+v", target)
	}
}

func TestConnectionRouteValidationRejectsInvalidJump(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	first, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "first", Host: "198.51.100.11", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		ID: first.ID, Name: first.Name, Host: first.Host, Port: first.Port, Username: first.Username,
		AuthType: first.AuthType, RefreshInterval: first.RefreshInterval,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &first.ID,
	}); err == nil || !strings.Contains(err.Error(), "不能选择自己") {
		t.Fatalf("expected self jump rejection, got %v", err)
	}

	second, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "second", Host: "198.51.100.12", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &first.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "third", Host: "198.51.100.13", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &second.ID,
	}); err == nil || !strings.Contains(err.Error(), "一层跳板机") {
		t.Fatalf("expected nested jump rejection, got %v", err)
	}
}

func TestDeleteJumpServerClearsTargetsButKeepsJumpMode(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	jump, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "jump", Host: "198.51.100.20", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	target, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "target", Host: "10.0.0.20", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &jump.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteConnection(ctx, jump.ID); err != nil {
		t.Fatal(err)
	}
	target, err = store.GetConnection(ctx, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	if target.ConnectionMode != domain.ConnectionModeJump || target.JumpServerID != nil {
		t.Fatalf("target route after jump delete=%+v", target)
	}
}

func TestBackupImportRestoresJumpRoutes(t *testing.T) {
	ctx := context.Background()
	source, err := Open(ctx, filepath.Join(t.TempDir(), "source.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	jump, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "jump", Host: "198.51.100.30", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "target", Host: "10.0.0.30", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
		ConnectionMode: domain.ConnectionModeJump, JumpServerID: &jump.ID,
	}); err != nil {
		t.Fatal(err)
	}
	payload, err := source.ExportBackupPayload(ctx)
	if err != nil {
		t.Fatal(err)
	}
	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if _, err := target.ImportBackupPayload(ctx, payload, domain.DefaultBackupImportOptions()); err != nil {
		t.Fatal(err)
	}
	imported, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]domain.Connection{}
	for _, connection := range imported {
		byName[connection.Name] = connection
	}
	importedTarget := byName["target"]
	importedJump := byName["jump"]
	if importedTarget.ConnectionMode != domain.ConnectionModeJump ||
		importedTarget.JumpServerID == nil ||
		*importedTarget.JumpServerID != importedJump.ID {
		t.Fatalf("imported target=%+v imported jump=%+v", importedTarget, importedJump)
	}
}

func TestBackupImportKeepsJumpModeWhenJumpServerMissing(t *testing.T) {
	ctx := context.Background()
	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	missingJumpID := int64(99)
	payload := domain.BackupPayload{
		Connections: []domain.BackupConnection{{
			ID: 1, Name: "target", Host: "10.0.0.31", Port: 22, Username: "root",
			AuthType: domain.AuthPassword, RefreshInterval: 2,
			ConnectionMode: domain.ConnectionModeJump, JumpServerID: &missingJumpID,
		}},
	}
	result, err := target.ImportBackupPayload(ctx, payload, domain.DefaultBackupImportOptions())
	if err != nil {
		t.Fatal(err)
	}
	imported, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(imported) != 1 ||
		imported[0].ConnectionMode != domain.ConnectionModeJump ||
		imported[0].JumpServerID != nil {
		t.Fatalf("imported connections=%+v", imported)
	}
	if len(result.Warnings) != 1 || result.Warnings[0].Code != "CONNECTION_JUMP_SERVER_RESELECT_REQUIRED" {
		t.Fatalf("warnings=%+v", result.Warnings)
	}
}

func TestConnectionBlankNameUsesHostPortDisplayName(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "", Host: "192.168.0.88", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.Name != "192.168.0.88:22" {
		t.Fatalf("generated IPv4 name=%q", connection.Name)
	}

	connection, err = store.SaveConnection(ctx, domain.SaveConnectionRequest{
		ID: connection.ID, Name: "", Host: "2001:db8::1", Port: 2222, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.Name != "[2001:db8::1]:2222" {
		t.Fatalf("generated IPv6 name=%q", connection.Name)
	}
}

func TestBackupImportBlankConnectionNameUsesHostPortDisplayName(t *testing.T) {
	ctx := context.Background()
	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()

	payload := domain.BackupPayload{
		Connections: []domain.BackupConnection{{
			Name: "", Host: "example.com", Port: 2200, Username: "root",
			AuthType: domain.AuthPassword, RefreshInterval: 2,
		}},
	}
	if _, err := target.ImportBackupPayload(ctx, payload, domain.DefaultBackupImportOptions()); err != nil {
		t.Fatal(err)
	}
	imported, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(imported) != 1 || imported[0].Name != "example.com:2200" {
		t.Fatalf("imported connections=%+v", imported)
	}
}

func TestMonitorNetworkInterfacePreferencePersistenceAndBackup(t *testing.T) {
	ctx := context.Background()
	source, err := Open(ctx, filepath.Join(t.TempDir(), "source.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	connection, err := source.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.NetworkInterfaceMode != domain.MonitorNetworkInterfaceAll ||
		connection.SelectedNetworkInterface != "" ||
		connection.NetworkInterfaceUserSelected {
		t.Fatalf("default network preference=%+v", connection)
	}
	preference, err := source.SetMonitorNetworkInterface(ctx, domain.SetMonitorNetworkInterfaceRequest{
		ServerID: connection.ID, Mode: domain.MonitorNetworkInterfaceSpecific,
		SelectedNetworkInterface: "ens18", UserSelected: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if preference.Mode != domain.MonitorNetworkInterfaceSpecific ||
		preference.SelectedNetworkInterface != "ens18" ||
		!preference.UserSelected {
		t.Fatalf("preference=%+v", preference)
	}
	if _, err := source.SetMonitorNetworkInterface(ctx, domain.SetMonitorNetworkInterfaceRequest{
		ServerID: connection.ID, Mode: domain.MonitorNetworkInterfaceSpecific,
		SelectedNetworkInterface: "eth0;rm",
	}); err == nil {
		t.Fatal("unsafe interface name was accepted")
	}
	dockerPreference, err := source.SetMonitorNetworkInterface(ctx, domain.SetMonitorNetworkInterfaceRequest{
		ServerID: connection.ID, Mode: domain.MonitorNetworkInterfaceDocker,
		SelectedNetworkInterface: "ignored", UserSelected: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if dockerPreference.Mode != domain.MonitorNetworkInterfaceDocker ||
		dockerPreference.SelectedNetworkInterface != "" ||
		!dockerPreference.UserSelected {
		t.Fatalf("docker preference=%+v", dockerPreference)
	}
	if _, err := source.SetMonitorNetworkInterface(ctx, domain.SetMonitorNetworkInterfaceRequest{
		ServerID: connection.ID, Mode: domain.MonitorNetworkInterfaceSpecific,
		SelectedNetworkInterface: "ens18", UserSelected: true,
	}); err != nil {
		t.Fatal(err)
	}
	payload, err := source.ExportBackupPayload(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.Connections) != 1 ||
		payload.Connections[0].NetworkInterfaceMode != domain.MonitorNetworkInterfaceSpecific ||
		payload.Connections[0].SelectedNetworkInterface != "ens18" ||
		!payload.Connections[0].NetworkInterfaceUserSelected {
		t.Fatalf("backup connection=%+v", payload.Connections)
	}
	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if _, err := target.ImportBackupPayload(ctx, payload, domain.DefaultBackupImportOptions()); err != nil {
		t.Fatal(err)
	}
	imported, err := target.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(imported) != 1 ||
		imported[0].NetworkInterfaceMode != domain.MonitorNetworkInterfaceSpecific ||
		imported[0].SelectedNetworkInterface != "ens18" ||
		!imported[0].NetworkInterfaceUserSelected {
		t.Fatalf("imported connections=%+v", imported)
	}
}

func TestCredentialReferencesExposeOnlySavedState(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.CredentialSaved {
		t.Fatal("new connection must not report a saved credential")
	}
	if connection.PasswordCredentialSaved {
		t.Fatal("new connection must not report a saved password slot")
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "password", "HostDeck/reference-only"); err != nil {
		t.Fatal(err)
	}
	connection, err = store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !connection.CredentialSaved {
		t.Fatal("credential reference was not reflected in connection state")
	}
	if !connection.PasswordCredentialSaved {
		t.Fatal("password credential reference was not reflected in connection state")
	}
	references, err := store.DeleteCredentialRefs(ctx, connection.ID)
	if err != nil || len(references) != 1 || references[0] != "HostDeck/reference-only" {
		t.Fatalf("references=%v err=%v", references, err)
	}
}

func TestDeleteCredentialRefOnlyDeletesRequestedKind(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "password", "HostDeck/password"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "passphrase", "HostDeck/passphrase"); err != nil {
		t.Fatal(err)
	}
	reference, err := store.DeleteCredentialRef(ctx, connection.ID, "password")
	if err != nil || reference != "HostDeck/password" {
		t.Fatalf("reference=%q err=%v", reference, err)
	}
	if _, err := store.GetCredentialRef(ctx, connection.ID, "password"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("password ref remained: %v", err)
	}
	if reference, err := store.GetCredentialRef(ctx, connection.ID, "passphrase"); err != nil || reference != "HostDeck/passphrase" {
		t.Fatalf("passphrase ref was changed: reference=%q err=%v", reference, err)
	}
}

func TestChangingPrivateKeyPathKeepsHostTrustButAllowsCredentialCleanup(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	request := domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.10", Port: 22, Username: "root",
		AuthType: domain.AuthPrivateKey, PrivateKeyPath: "first-key", RefreshInterval: 2,
	}
	connection, err := store.SaveConnection(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateHostKey(ctx, connection.ID, "SHA256:trusted"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "passphrase", "old-reference"); err != nil {
		t.Fatal(err)
	}
	request.ID = connection.ID
	request.PrivateKeyPath = "second-key"
	connection, err = store.SaveConnection(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if connection.HostKeyFingerprint != "SHA256:trusted" {
		t.Fatalf("host trust changed with key path: %q", connection.HostKeyFingerprint)
	}
}
