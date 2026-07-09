package credential

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"database/sql"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"

	"hostdeck/internal/domain"
	"hostdeck/internal/keyvault"
	"hostdeck/internal/persistence"
	"hostdeck/internal/secretstore"
)

type memorySecrets struct {
	values map[string][]byte
}

type fakeKeyProtector struct{}

func (fakeKeyProtector) Protect(plaintext []byte) ([]byte, error) {
	out := append([]byte("protected:"), plaintext...)
	for index := len("protected:"); index < len(out); index++ {
		out[index] ^= 0x33
	}
	return out, nil
}

func (fakeKeyProtector) Unprotect(ciphertext []byte) ([]byte, error) {
	out := append([]byte(nil), ciphertext[len("protected:"):]...)
	for index := range out {
		out[index] ^= 0x33
	}
	return out, nil
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

func setupResolver(t *testing.T) (context.Context, *persistence.Store, *memorySecrets, *Resolver) {
	t.Helper()
	ctx := context.Background()
	store, err := persistence.Open(ctx, filepath.Join(t.TempDir(), "HostDeck.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	secrets := &memorySecrets{values: make(map[string][]byte)}
	return ctx, store, secrets, New(store, secrets)
}

func saveConnection(t *testing.T, ctx context.Context, store *persistence.Store, authType domain.AuthType, keyPath string) domain.Connection {
	t.Helper()
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: "test", Host: "192.0.2.1", Port: 22, Username: "root",
		AuthType: authType, PrivateKeyPath: keyPath, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	connection.HostKeyFingerprint = "SHA256:trusted"
	return connection
}

func writePrivateKey(t *testing.T, encrypted bool, passphrase string) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var block *pem.Block
	if encrypted {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(key, "test", []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(key, "test")
	}
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "id_test")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestEncryptedPrivateKeySavedPassphraseSurvivesResolverRestart(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	const passphrase = "correct-passphrase"
	connection := saveConnection(t, ctx, store, domain.AuthPrivateKey, writePrivateKey(t, true, passphrase))
	auth := domain.AuthRequest{Passphrase: passphrase, RememberSecret: true}
	if _, err := resolver.Resolve(ctx, connection, auth); err != nil {
		t.Fatal(err)
	}
	if err := resolver.CommitSuccessful(ctx, connection, auth); err != nil {
		t.Fatal(err)
	}
	connection, err := store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	restarted := New(store, secrets)
	state := restarted.State(ctx, connection)
	if !state.CanAuthenticate || !state.CredentialUsable || !state.PrivateKeyEncrypted {
		t.Fatalf("unexpected state: %+v", state)
	}
	resolved, err := restarted.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Passphrase != passphrase || !resolved.ResolvedFromStore {
		t.Fatalf("resolved=%+v err=%v", resolved, err)
	}
}

func TestUnencryptedPrivateKeyNeedsNoCredential(t *testing.T) {
	ctx, store, _, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPrivateKey, writePrivateKey(t, false, ""))
	state := resolver.State(ctx, connection)
	if !state.CanAuthenticate || state.PrivateKeyEncrypted || state.CredentialUsable {
		t.Fatalf("unexpected state: %+v", state)
	}
	if _, err := resolver.Resolve(ctx, connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
}

func TestPasswordSavedCredentialSurvivesResolverRestart(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	auth := domain.AuthRequest{Password: "secret", RememberSecret: true}
	if err := resolver.CommitSuccessful(ctx, connection, auth); err != nil {
		t.Fatal(err)
	}
	connection, err := store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := New(store, secrets).Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "secret" || !resolved.ResolvedFromStore {
		t.Fatalf("resolved=%+v err=%v", resolved, err)
	}
}

func TestTemporaryPasswordDoesNotDeleteSavedPassword(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	if err := resolver.CommitSuccessful(ctx, connection, domain.AuthRequest{
		Password: "saved-secret", RememberSecret: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := resolver.CommitSuccessful(ctx, connection, domain.AuthRequest{
		Password: "runtime-only", RememberSecret: false,
	}); err != nil {
		t.Fatal(err)
	}
	connection, err := store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "saved-secret" || !resolved.ResolvedFromStore {
		t.Fatalf("temporary password removed saved password: auth=%+v err=%v", resolved, err)
	}
	if value, err := secrets.Get(ctx, Reference(connection.ID, "password")); err != nil || string(value) != "saved-secret" {
		t.Fatalf("saved secret = %q err=%v", string(value), err)
	}
}

func TestCanonicalPasswordSecretWithoutRefIsRecovered(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	reference := Reference(connection.ID, "password")
	if err := secrets.Set(ctx, reference, []byte("legacy-secret")); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "legacy-secret" || !resolved.ResolvedFromStore {
		t.Fatalf("legacy canonical secret was not recovered: auth=%+v err=%v", resolved, err)
	}
	if storedRef, err := store.GetCredentialRef(ctx, connection.ID, "password"); err != nil || storedRef != reference {
		t.Fatalf("credential ref was not migrated: ref=%q err=%v", storedRef, err)
	}
}

func TestExplicitPasswordCanBeSavedReplacedAndDeleted(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	if err := resolver.SaveExplicit(ctx, connection, domain.AuthRequest{Password: "first"}); err != nil {
		t.Fatal(err)
	}
	if err := resolver.SaveExplicit(ctx, connection, domain.AuthRequest{Password: "second"}); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Password != "second" {
		t.Fatalf("resolved=%+v err=%v", resolved, err)
	}
	if err := resolver.Clear(ctx, connection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(ctx, Reference(connection.ID, "password")); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("secret still exists: %v", err)
	}
}

func TestClearKindOnlyDeletesRequestedCredentialSlot(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	passwordRef := Reference(connection.ID, "password")
	passphraseRef := Reference(connection.ID, "passphrase")
	if err := secrets.Set(ctx, passwordRef, []byte("password-secret")); err != nil {
		t.Fatal(err)
	}
	if err := secrets.Set(ctx, passphraseRef, []byte("passphrase-secret")); err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "password", passwordRef); err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "passphrase", passphraseRef); err != nil {
		t.Fatal(err)
	}

	if err := resolver.ClearKind(ctx, connection.ID, "password"); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(ctx, passwordRef); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("password slot remained: %v", err)
	}
	if value, err := secrets.Get(ctx, passphraseRef); err != nil || string(value) != "passphrase-secret" {
		t.Fatalf("passphrase slot was changed: value=%q err=%v", string(value), err)
	}
	if _, err := store.GetCredentialRef(ctx, connection.ID, "password"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("password ref remained: %v", err)
	}
	if reference, err := store.GetCredentialRef(ctx, connection.ID, "passphrase"); err != nil || reference != passphraseRef {
		t.Fatalf("passphrase ref was changed: reference=%q err=%v", reference, err)
	}
}

func TestInspectPrivateKey(t *testing.T) {
	if encrypted, err := InspectPrivateKey(writePrivateKey(t, false, "")); err != nil || encrypted {
		t.Fatalf("unencrypted key: encrypted=%v err=%v", encrypted, err)
	}
	if encrypted, err := InspectPrivateKey(writePrivateKey(t, true, "secret")); err != nil || !encrypted {
		t.Fatalf("encrypted key: encrypted=%v err=%v", encrypted, err)
	}
	invalid := filepath.Join(t.TempDir(), "invalid")
	if err := os.WriteFile(invalid, []byte("not a private key"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectPrivateKey(invalid); ErrorCode(err) != CodePrivateKeyInvalid {
		t.Fatalf("invalid key error=%v", err)
	}
	if _, err := InspectPrivateKey(filepath.Join(t.TempDir(), "missing")); ErrorCode(err) != CodePrivateKeyUnavailable {
		t.Fatalf("missing key error=%v", err)
	}
}

func TestInvalidSavedPassphraseCanBeReplaced(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	const correct = "correct-passphrase"
	connection := saveConnection(t, ctx, store, domain.AuthPrivateKey, writePrivateKey(t, true, correct))
	reference := Reference(connection.ID, "passphrase")
	if err := secrets.Set(ctx, reference, []byte("wrong")); err != nil {
		t.Fatal(err)
	}
	if err := store.SetCredentialRef(ctx, connection.ID, "passphrase", reference); err != nil {
		t.Fatal(err)
	}
	connection, _ = store.GetConnection(ctx, connection.ID)
	state := resolver.State(ctx, connection)
	if state.CanAuthenticate || state.ReasonCode != CodeCredentialInvalid {
		t.Fatalf("unexpected state: %+v", state)
	}
	if _, err := resolver.Resolve(ctx, connection, domain.AuthRequest{}); ErrorCode(err) != CodeCredentialInvalid {
		t.Fatalf("expected invalid credential, got %v", err)
	}
	replacement := domain.AuthRequest{Passphrase: correct, RememberSecret: true}
	if _, err := resolver.Resolve(ctx, connection, replacement); err != nil {
		t.Fatal(err)
	}
	if err := resolver.CommitSuccessful(ctx, connection, replacement); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil || resolved.Passphrase != correct {
		t.Fatalf("resolved=%+v err=%v", resolved, err)
	}
}

func TestMissingAndUnavailableSavedCredentialsAreDistinct(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")

	if _, err := resolver.Resolve(ctx, connection, domain.AuthRequest{}); ErrorCode(err) != CodeAuthenticationRequired {
		t.Fatalf("missing reference code = %q, err = %v", ErrorCode(err), err)
	}

	reference := Reference(connection.ID, "password")
	if err := store.SetCredentialRef(ctx, connection.ID, "password", reference); err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.Resolve(ctx, connection, domain.AuthRequest{}); ErrorCode(err) != CodeCredentialUnavailable {
		t.Fatalf("missing system secret code = %q, err = %v", ErrorCode(err), err)
	}

	if err := secrets.Set(ctx, reference, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.Resolve(ctx, connection, domain.AuthRequest{}); ErrorCode(err) != CodeCredentialUnavailable {
		t.Fatalf("empty system secret code = %q, err = %v", ErrorCode(err), err)
	}
}

func TestClearDeletesReferenceAndSecret(t *testing.T) {
	ctx, store, secrets, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	if err := resolver.CommitSuccessful(ctx, connection, domain.AuthRequest{
		Password: "secret", RememberSecret: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := resolver.Clear(ctx, connection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(ctx, Reference(connection.ID, "password")); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("secret still exists: %v", err)
	}
	connection, err := store.GetConnection(ctx, connection.ID)
	if err != nil || connection.CredentialSaved {
		t.Fatalf("connection=%+v err=%v", connection, err)
	}
}

func TestMonitorAndTerminalResolveSameSavedAuthentication(t *testing.T) {
	ctx, store, _, resolver := setupResolver(t)
	connection := saveConnection(t, ctx, store, domain.AuthPassword, "")
	if err := resolver.CommitSuccessful(ctx, connection, domain.AuthRequest{
		Password: "shared-secret", RememberSecret: true,
	}); err != nil {
		t.Fatal(err)
	}
	monitorAuth, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	terminalAuth, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if monitorAuth.Password != terminalAuth.Password || monitorAuth.Password != "shared-secret" {
		t.Fatal("resolved authentication differs between workloads")
	}
}

func TestEncryptedDatabaseKeyVaultResolvesAfterSourceFileDeletionForMultipleServers(t *testing.T) {
	ctx, store, secrets, _ := setupResolver(t)
	protector := fakeKeyProtector{}
	resolver := New(store, secrets, protector)

	keyPath := writePrivateKey(t, false, "")
	raw, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	validation := keyvault.ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{PrivateKeyPath: keyPath})
	if !validation.Valid {
		t.Fatalf("validation = %+v", validation)
	}
	protected, err := protector.Protect(raw)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := store.CreateEncryptedKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name:           "shared",
		PrivateKeyPath: keyPath,
	}, validation, protected, filepath.Base(keyPath))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}

	first := saveKeyVaultConnection(t, ctx, store, "server-a", entry.ID)
	second := saveKeyVaultConnection(t, ctx, store, "server-b", entry.ID)
	for _, connection := range []domain.Connection{first, second} {
		state := resolver.State(ctx, connection)
		if !state.CanAuthenticate || state.ReasonCode != "" {
			t.Fatalf("state for %s = %+v", connection.Name, state)
		}
		resolved, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
		if err != nil {
			t.Fatalf("resolve for %s: %v", connection.Name, err)
		}
		if resolved.ResolvedKeyVaultID != entry.ID || resolved.ResolvedPrivateKeyPath != "" {
			t.Fatalf("resolved auth for %s = %+v", connection.Name, resolved)
		}
		if !bytes.Equal(resolved.ResolvedPrivateKeyPEM, raw) {
			t.Fatalf("resolved key material for %s did not come from encrypted vault blob", connection.Name)
		}
	}
}

func TestDeletedKeyVaultReferenceReturnsMissingKeyMessage(t *testing.T) {
	ctx, store, secrets, _ := setupResolver(t)
	protector := fakeKeyProtector{}
	resolver := New(store, secrets, protector)

	keyPath := writePrivateKey(t, false, "")
	raw, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	validation := keyvault.ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{PrivateKeyPath: keyPath})
	if !validation.Valid {
		t.Fatalf("validation = %+v", validation)
	}
	protected, err := protector.Protect(raw)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := store.CreateEncryptedKeyVaultEntry(ctx, domain.SaveKeyVaultEntryRequest{
		Name:           "shared",
		PrivateKeyPath: keyPath,
	}, validation, protected, filepath.Base(keyPath))
	if err != nil {
		t.Fatal(err)
	}
	connection := saveKeyVaultConnection(t, ctx, store, "server-a", entry.ID)
	if _, err := store.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{
		ID: entry.ID, ForceUnbind: true,
	}); err != nil {
		t.Fatal(err)
	}

	unbound, err := store.GetConnection(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unbound.KeyVaultID != nil || unbound.AuthType != domain.AuthPrivateKey ||
		unbound.PrivateKeySource != domain.PrivateKeySourceKeyVault {
		t.Fatalf("server should remain key-vault auth with missing key: %+v", unbound)
	}
	state := resolver.State(ctx, unbound)
	if state.CanAuthenticate || state.ReasonCode != CodePrivateKeyUnavailable || state.Message != missingKeyVaultMessage {
		t.Fatalf("state = %+v", state)
	}
	if _, err := resolver.Resolve(ctx, unbound, domain.AuthRequest{}); ErrorCode(err) != CodePrivateKeyUnavailable || err.Error() != missingKeyVaultMessage {
		t.Fatalf("resolve missing key err=%v", err)
	}
	if _, err := resolver.Resolve(ctx, connection, domain.AuthRequest{}); ErrorCode(err) != CodePrivateKeyUnavailable || err.Error() != missingKeyVaultMessage {
		t.Fatalf("stale connection resolve err=%v", err)
	}
}

func saveKeyVaultConnection(
	t *testing.T,
	ctx context.Context,
	store *persistence.Store,
	name string,
	keyID int64,
) domain.Connection {
	t.Helper()
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		Name: name, Host: "192.0.2.1", Port: 22, Username: "root",
		AuthType: domain.AuthPrivateKey, PrivateKeySource: domain.PrivateKeySourceKeyVault,
		KeyVaultID: &keyID, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	connection.HostKeyFingerprint = "SHA256:trusted"
	return connection
}
