package persistence

import (
	"context"
	"path/filepath"
	"testing"

	"hostdeck/internal/domain"
	"hostdeck/internal/keyvault"
)

func TestProtectedKeyBlobRestorableForPlatform(t *testing.T) {
	if protectedKeyBlobRestorableForPlatform("darwin", []byte("windows-dpapi-blob")) {
		t.Fatal("darwin must not treat unversioned Windows DPAPI blobs as restorable")
	}
	if !protectedKeyBlobRestorableForPlatform("darwin", []byte(keyvault.LocalProtectorBlobPrefix+"ciphertext")) {
		t.Fatal("darwin should accept local protector blobs")
	}
	if !protectedKeyBlobRestorableForPlatform("windows", []byte("windows-dpapi-blob")) {
		t.Fatal("windows import behavior must continue to accept existing DPAPI blobs")
	}
}

func TestDarwinBackupImportKeepsUnrestorableKeyVaultBlobForExplicitWarning(t *testing.T) {
	previousPlatform := backupImportPlatform
	backupImportPlatform = "darwin"
	t.Cleanup(func() { backupImportPlatform = previousPlatform })

	ctx := context.Background()
	target, err := Open(ctx, filepath.Join(t.TempDir(), "target.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()

	sourceKeyID := int64(44)
	windowsBlob := []byte("windows-dpapi-key-vault-blob")
	payload := domain.BackupPayload{
		Mode: domain.BackupModeFull,
		KeyVault: []domain.BackupKeyVaultEntry{{
			ID:                         sourceKeyID,
			Name:                       "windows-imported-key",
			StorageMode:                string(domain.KeyVaultStorageEncryptedDatabase),
			SourceFileName:             "id_ed25519",
			Algorithm:                  "ssh-ed25519",
			KeyBits:                    256,
			PublicKeyFingerprintSHA256: "SHA256:windows-imported-key",
			Encrypted:                  false,
		}},
		Secrets: []domain.BackupSecret{{
			Scope:   "key_vault",
			OwnerID: sourceKeyID,
			Kind:    "protected_key_blob",
			Value:   windowsBlob,
		}},
	}

	result, err := target.ImportBackupPayload(ctx, payload, domain.BackupImportOptions{ImportKeyVault: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.KeyVaultAdded != 1 || len(result.Warnings) != 1 || result.Warnings[0].Code != "WINDOWS_PROTECTED_CREDENTIAL_REENTER_REQUIRED" {
		t.Fatalf("import result=%+v", result)
	}
	keys, err := target.ListKeyVaultEntries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || string(keys[0].ProtectedKeyBlob) != string(windowsBlob) || keys[0].PassphraseSaved {
		t.Fatalf("darwin import must keep foreign protected material for explicit resolver warnings: %+v", keys)
	}
}
