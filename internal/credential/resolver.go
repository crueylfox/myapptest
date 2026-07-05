package credential

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"

	"serverpilot/internal/domain"
	"serverpilot/internal/keyvault"
	"serverpilot/internal/secretstore"
)

const (
	CodeAuthenticationRequired = "authentication_required"
	CodeCredentialUnavailable  = "credential_unavailable"
	CodeCredentialInvalid      = "credential_invalid"
	CodePrivateKeyUnavailable  = "private_key_unavailable"
	CodePrivateKeyInvalid      = "private_key_invalid"
)

const missingKeyVaultMessage = "该服务器使用的密钥已被删除，请重新选择密钥。"

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

func ErrorCode(err error) string {
	var credentialErr *Error
	if errors.As(err, &credentialErr) {
		return credentialErr.Code
	}
	return ""
}

type ReferenceStore interface {
	GetCredentialRef(context.Context, int64, string) (string, error)
	ListCredentialRefs(context.Context, int64) ([]string, error)
	SetCredentialRef(context.Context, int64, string, string) error
	DeleteCredentialRef(context.Context, int64, string) (string, error)
	DeleteCredentialRefs(context.Context, int64) ([]string, error)
}

type KeyVaultStore interface {
	GetKeyVaultEntry(context.Context, int64) (domain.KeyVaultEntry, error)
	SetKeyVaultPassphraseRef(context.Context, int64, string) error
	UpdateKeyVaultLastUsed(context.Context, int64, time.Time) error
}

type Resolver struct {
	references ReferenceStore
	keyVault   KeyVaultStore
	secrets    secretstore.Store
	protector  keyvault.KeyMaterialProtector
}

func New(references ReferenceStore, secrets secretstore.Store, protectors ...keyvault.KeyMaterialProtector) *Resolver {
	var keyVault KeyVaultStore
	if store, ok := references.(KeyVaultStore); ok {
		keyVault = store
	}
	protector := keyvault.NewPlatformProtector()
	if len(protectors) > 0 && protectors[0] != nil {
		protector = protectors[0]
	}
	return &Resolver{references: references, keyVault: keyVault, secrets: secrets, protector: protector}
}

func (r *Resolver) State(ctx context.Context, connection domain.Connection) domain.AuthenticationState {
	state := domain.AuthenticationState{
		ConnectionID:    connection.ID,
		CredentialSaved: connection.CredentialSaved,
		HostTrusted:     connection.HostKeyFingerprint != "",
	}
	switch connection.AuthType {
	case domain.AuthPassword:
		_, err := r.savedSecret(ctx, connection)
		if err == nil {
			state.CanAuthenticate = true
			state.CredentialUsable = true
			return state
		}
		state.ReasonCode = ErrorCode(err)
		state.Message = err.Error()
		return state
	case domain.AuthPrivateKey:
		keyBytes, entry, err := r.effectivePrivateKeyBytes(ctx, connection)
		if err != nil {
			state.ReasonCode = ErrorCode(err)
			state.Message = err.Error()
			return state
		}
		defer wipe(keyBytes)
		if entry.ID != 0 {
			state.CredentialSaved = entry.PassphraseSaved
		}
		if _, err := ssh.ParsePrivateKey(keyBytes); err == nil {
			state.CanAuthenticate = true
			return state
		} else {
			var missing *ssh.PassphraseMissingError
			if !errors.As(err, &missing) {
				state.ReasonCode = CodePrivateKeyInvalid
				state.Message = "SSH private key is invalid"
				return state
			}
			state.PrivateKeyEncrypted = true
		}
		passphrase, err := r.savedSecret(ctx, connection)
		if err != nil {
			state.ReasonCode = ErrorCode(err)
			state.Message = err.Error()
			return state
		}
		defer wipe(passphrase)
		if _, err := ssh.ParsePrivateKeyWithPassphrase(keyBytes, passphrase); err != nil {
			state.ReasonCode = CodeCredentialInvalid
			state.Message = "Saved private-key passphrase is invalid"
			return state
		}
		state.CanAuthenticate = true
		state.CredentialUsable = true
		return state
	default:
		state.ReasonCode = CodeAuthenticationRequired
		state.Message = "Unsupported authentication type"
		return state
	}
}

func (r *Resolver) Resolve(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
) (domain.AuthRequest, error) {
	switch connection.AuthType {
	case domain.AuthPassword:
		if auth.Password != "" {
			return auth, nil
		}
		value, err := r.savedSecret(ctx, connection)
		if err != nil {
			return auth, err
		}
		auth.Password = string(value)
		auth.ResolvedFromStore = true
		wipe(value)
		return auth, nil
	case domain.AuthPrivateKey:
		keyBytes, entry, err := r.effectivePrivateKeyBytes(ctx, connection)
		if err != nil {
			return auth, err
		}
		if entry.ID != 0 {
			auth.ResolvedKeyVaultID = entry.ID
		}
		if _, err := ssh.ParsePrivateKey(keyBytes); err == nil {
			auth.Passphrase = ""
			auth.ResolvedPrivateKeyPEM = keyBytes
			return auth, nil
		} else {
			var missing *ssh.PassphraseMissingError
			if !errors.As(err, &missing) {
				wipe(keyBytes)
				return auth, &Error{Code: CodePrivateKeyInvalid, Message: "SSH private key is invalid"}
			}
		}
		if auth.Passphrase == "" {
			value, err := r.savedSecret(ctx, connection)
			if err != nil {
				wipe(keyBytes)
				return auth, err
			}
			auth.Passphrase = string(value)
			auth.ResolvedFromStore = true
			wipe(value)
		}
		if _, err := ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(auth.Passphrase)); err != nil {
			wipe(keyBytes)
			return auth, &Error{Code: CodeCredentialInvalid, Message: "Private-key passphrase is invalid"}
		}
		auth.ResolvedPrivateKeyPEM = keyBytes
		return auth, nil
	default:
		return auth, &Error{Code: CodeAuthenticationRequired, Message: "Unsupported authentication type"}
	}
}

func (r *Resolver) CommitSuccessful(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
) error {
	if connection.AuthType == domain.AuthPrivateKey && auth.ResolvedKeyVaultID > 0 {
		if auth.Passphrase != "" && auth.RememberSecret && !auth.ResolvedFromStore {
			reference := KeyVaultPassphraseReference(auth.ResolvedKeyVaultID)
			secretBytes := []byte(auth.Passphrase)
			defer wipe(secretBytes)
			if err := r.secrets.Set(ctx, reference, secretBytes); err != nil {
				return fmt.Errorf("save key-vault passphrase to system store: %w", err)
			}
			if r.keyVault == nil {
				_ = r.secrets.Delete(ctx, reference)
				return errors.New("key vault store is not available")
			}
			if err := r.keyVault.SetKeyVaultPassphraseRef(ctx, auth.ResolvedKeyVaultID, reference); err != nil {
				_ = r.secrets.Delete(ctx, reference)
				return fmt.Errorf("save key-vault credential reference: %w", err)
			}
		}
		if r.keyVault != nil {
			return r.keyVault.UpdateKeyVaultLastUsed(ctx, auth.ResolvedKeyVaultID, time.Now().UTC())
		}
		return nil
	}
	if auth.ResolvedFromStore {
		return nil
	}
	value := secretValue(connection, auth)
	if value == "" {
		return nil
	}
	if !auth.RememberSecret {
		return nil
	}
	kind := Kind(connection)
	reference := Reference(connection.ID, kind)
	secretBytes := []byte(value)
	defer wipe(secretBytes)
	if err := r.secrets.Set(ctx, reference, secretBytes); err != nil {
		return fmt.Errorf("save credential to system store: %w", err)
	}
	if err := r.references.SetCredentialRef(ctx, connection.ID, kind, reference); err != nil {
		_ = r.secrets.Delete(ctx, reference)
		return fmt.Errorf("save credential reference: %w", err)
	}
	return nil
}

func (r *Resolver) SaveExplicit(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
) error {
	if connection.AuthType == domain.AuthPrivateKey && keySource(connection) == domain.PrivateKeySourceKeyVault {
		return nil
	}
	value := secretValue(connection, auth)
	if value == "" {
		return nil
	}
	kind := Kind(connection)
	reference := Reference(connection.ID, kind)
	_, existingErr := r.references.GetCredentialRef(ctx, connection.ID, kind)
	hadReference := existingErr == nil
	if existingErr != nil && !errors.Is(existingErr, sql.ErrNoRows) {
		return existingErr
	}
	secretBytes := []byte(value)
	defer wipe(secretBytes)
	if err := r.secrets.Set(ctx, reference, secretBytes); err != nil {
		return fmt.Errorf("save credential to system store: %w", err)
	}
	if hadReference {
		return nil
	}
	if err := r.references.SetCredentialRef(ctx, connection.ID, kind, reference); err != nil {
		_ = r.secrets.Delete(ctx, reference)
		return fmt.Errorf("save credential reference: %w", err)
	}
	return nil
}

func InspectPrivateKey(path string) (encrypted bool, err error) {
	keyBytes, err := os.ReadFile(path)
	if err != nil {
		return false, &Error{Code: CodePrivateKeyUnavailable, Message: "SSH private key is unavailable"}
	}
	defer wipe(keyBytes)
	if _, err := ssh.ParsePrivateKey(keyBytes); err == nil {
		return false, nil
	} else {
		var missing *ssh.PassphraseMissingError
		if errors.As(err, &missing) {
			return true, nil
		}
		return false, &Error{Code: CodePrivateKeyInvalid, Message: "SSH private key is invalid"}
	}
}

func (r *Resolver) Clear(ctx context.Context, connectionID int64) error {
	references, err := r.references.ListCredentialRefs(ctx, connectionID)
	if err != nil {
		return err
	}
	for _, reference := range references {
		if err := r.secrets.Delete(ctx, reference); err != nil {
			return err
		}
	}
	if _, err := r.references.DeleteCredentialRefs(ctx, connectionID); err != nil {
		return err
	}
	return nil
}

func (r *Resolver) ClearKind(ctx context.Context, connectionID int64, kind string) error {
	reference, err := r.references.DeleteCredentialRef(ctx, connectionID, kind)
	if err != nil {
		return err
	}
	canonical := Reference(connectionID, kind)
	if reference != "" {
		if err := r.secrets.Delete(ctx, reference); err != nil {
			return err
		}
	}
	if reference != canonical {
		if err := r.secrets.Delete(ctx, canonical); err != nil {
			return err
		}
	}
	return nil
}

func (r *Resolver) savedSecret(ctx context.Context, connection domain.Connection) ([]byte, error) {
	if connection.AuthType == domain.AuthPrivateKey && keySource(connection) == domain.PrivateKeySourceKeyVault {
		if connection.KeyVaultID == nil || *connection.KeyVaultID <= 0 {
			return nil, &Error{Code: CodePrivateKeyUnavailable, Message: missingKeyVaultMessage}
		}
		if r.keyVault == nil {
			return nil, &Error{Code: CodeCredentialUnavailable, Message: "Key vault is unavailable"}
		}
		entry, err := r.keyVault.GetKeyVaultEntry(ctx, *connection.KeyVaultID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, &Error{Code: CodePrivateKeyUnavailable, Message: missingKeyVaultMessage}
			}
			return nil, err
		}
		if entry.PassphraseCredentialRef == "" {
			return nil, &Error{Code: CodeAuthenticationRequired, Message: "Private-key passphrase is required"}
		}
		return r.secretByReference(ctx, entry.PassphraseCredentialRef)
	}
	kind := Kind(connection)
	reference, err := r.references.GetCredentialRef(ctx, connection.ID, kind)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return r.recoverCanonicalSecret(ctx, connection, kind)
		}
		return nil, err
	}
	return r.secretByReference(ctx, reference)
}

func (r *Resolver) recoverCanonicalSecret(
	ctx context.Context,
	connection domain.Connection,
	kind string,
) ([]byte, error) {
	reference := Reference(connection.ID, kind)
	value, err := r.secretByReference(ctx, reference)
	if err != nil {
		var credentialErr *Error
		if errors.As(err, &credentialErr) && credentialErr.Code == CodeCredentialUnavailable {
			return nil, &Error{Code: CodeAuthenticationRequired, Message: requiredMessage(connection)}
		}
		return nil, err
	}
	if err := r.references.SetCredentialRef(ctx, connection.ID, kind, reference); err != nil {
		wipe(value)
		return nil, err
	}
	return value, nil
}

func (r *Resolver) secretByReference(ctx context.Context, reference string) ([]byte, error) {
	value, err := r.secrets.Get(ctx, reference)
	if err != nil {
		if errors.Is(err, secretstore.ErrNotFound) {
			return nil, &Error{Code: CodeCredentialUnavailable, Message: "Saved credential is unavailable"}
		}
		return nil, err
	}
	if len(value) == 0 {
		return nil, &Error{Code: CodeCredentialUnavailable, Message: "Saved credential is empty"}
	}
	return value, nil
}

func (r *Resolver) effectivePrivateKey(ctx context.Context, connection domain.Connection) (string, domain.KeyVaultEntry, error) {
	if keySource(connection) != domain.PrivateKeySourceKeyVault {
		return connection.PrivateKeyPath, domain.KeyVaultEntry{}, nil
	}
	if connection.KeyVaultID == nil || *connection.KeyVaultID <= 0 {
		return "", domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: missingKeyVaultMessage}
	}
	if r.keyVault == nil {
		return "", domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: "Key vault is unavailable"}
	}
	entry, err := r.keyVault.GetKeyVaultEntry(ctx, *connection.KeyVaultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: missingKeyVaultMessage}
		}
		return "", domain.KeyVaultEntry{}, err
	}
	if entry.PrivateKeyPath == "" {
		return "", domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: "Key vault private key path is empty"}
	}
	return entry.PrivateKeyPath, entry, nil
}

func (r *Resolver) effectivePrivateKeyBytes(
	ctx context.Context,
	connection domain.Connection,
) ([]byte, domain.KeyVaultEntry, error) {
	if keySource(connection) != domain.PrivateKeySourceKeyVault {
		path := strings.TrimSpace(connection.PrivateKeyPath)
		if path == "" {
			return nil, domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: "SSH private key is unavailable"}
		}
		keyBytes, err := os.ReadFile(path)
		if err != nil {
			return nil, domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: "SSH private key is unavailable"}
		}
		return keyBytes, domain.KeyVaultEntry{}, nil
	}
	if connection.KeyVaultID == nil || *connection.KeyVaultID <= 0 {
		return nil, domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: missingKeyVaultMessage}
	}
	if r.keyVault == nil {
		return nil, domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: "Key vault is unavailable"}
	}
	entry, err := r.keyVault.GetKeyVaultEntry(ctx, *connection.KeyVaultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.KeyVaultEntry{}, &Error{Code: CodePrivateKeyUnavailable, Message: missingKeyVaultMessage}
		}
		return nil, domain.KeyVaultEntry{}, err
	}
	switch domain.KeyVaultStorageMode(entry.StorageMode) {
	case domain.KeyVaultStorageEncryptedDatabase:
		if len(entry.ProtectedKeyBlob) == 0 {
			return nil, entry, &Error{Code: CodePrivateKeyUnavailable, Message: "Key vault private key material is missing"}
		}
		if r.protector == nil {
			return nil, entry, &Error{Code: CodePrivateKeyUnavailable, Message: "Key vault protector is unavailable"}
		}
		keyBytes, err := r.protector.Unprotect(entry.ProtectedKeyBlob)
		if err != nil {
			return nil, entry, &Error{Code: CodePrivateKeyUnavailable, Message: err.Error()}
		}
		return keyBytes, entry, nil
	default:
		if strings.TrimSpace(entry.PrivateKeyPath) == "" {
			return nil, entry, &Error{Code: CodePrivateKeyUnavailable, Message: "Key vault private key path is empty"}
		}
		keyBytes, err := os.ReadFile(entry.PrivateKeyPath)
		if err != nil {
			return nil, entry, &Error{Code: CodePrivateKeyUnavailable, Message: "SSH private key is unavailable"}
		}
		return keyBytes, entry, nil
	}
}

func Kind(connection domain.Connection) string {
	if connection.AuthType == domain.AuthPassword {
		return "password"
	}
	return "passphrase"
}

func Reference(connectionID int64, kind string) string {
	return fmt.Sprintf("ServerPilot/connection/%d/%s", connectionID, kind)
}

func KeyVaultPassphraseReference(keyID int64) string {
	return fmt.Sprintf("ServerPilot/keyvault/%d/passphrase", keyID)
}

func secretValue(connection domain.Connection, auth domain.AuthRequest) string {
	if connection.AuthType == domain.AuthPassword {
		return auth.Password
	}
	return auth.Passphrase
}

func requiredMessage(connection domain.Connection) string {
	if connection.AuthType == domain.AuthPassword {
		return "SSH password is required"
	}
	return "Private-key passphrase is required"
}

func keySource(connection domain.Connection) domain.PrivateKeySource {
	if connection.PrivateKeySource == "" {
		return domain.PrivateKeySourceLocalFile
	}
	return connection.PrivateKeySource
}

func wipe(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
