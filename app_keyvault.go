package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"hostdeck/internal/credential"
	"hostdeck/internal/domain"
	"hostdeck/internal/keyvault"
)

func (a *App) ListKeyVaultEntries() ([]domain.KeyVaultEntry, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	entries, err := store.ListKeyVaultEntries(a.ctx)
	if err != nil {
		return nil, err
	}
	for index := range entries {
		entries[index] = sanitizeKeyVaultEntry(entries[index])
	}
	return entries, nil
}

func (a *App) ValidatePrivateKeyFile(
	request domain.ValidatePrivateKeyFileRequest,
) (domain.PrivateKeyValidationResult, error) {
	return keyvault.ValidatePrivateKeyFile(request), nil
}

func (a *App) CreateKeyVaultEntry(request domain.SaveKeyVaultEntryRequest) (domain.KeyVaultEntry, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	request.Name = strings.TrimSpace(request.Name)
	request.PrivateKeyPath = strings.TrimSpace(request.PrivateKeyPath)
	if request.PrivateKeyPath == "" {
		return domain.KeyVaultEntry{}, errors.New("请选择私钥文件")
	}
	if request.Name == "" {
		request.Name = filepath.Base(request.PrivateKeyPath)
	}
	imported, err := keyvault.ImportPrivateKeyFromFile(request, a.privateKeyProtector())
	if err != nil {
		logger.Write("error", "密钥库条目创建失败", "keyvault.create", 0, err)
		return domain.KeyVaultEntry{}, err
	}
	defer wipeBytes(imported.ProtectedBlob)
	if existing, err := store.GetKeyVaultEntryByFingerprint(a.ctx, imported.Validation.FingerprintSHA256); err == nil && existing.ID > 0 {
		return domain.KeyVaultEntry{}, errors.New("该私钥已存在于密钥库，不会重复保存相同密钥正文")
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.KeyVaultEntry{}, err
	}
	entry, err := store.CreateEncryptedKeyVaultEntry(a.ctx, request, imported.Validation, imported.ProtectedBlob, imported.SourceFileName)
	if err != nil {
		logger.Write("error", "密钥库条目创建失败", "keyvault.create", 0, err)
		return domain.KeyVaultEntry{}, err
	}
	if request.RememberPassphrase && request.Passphrase != "" {
		if err := a.saveKeyVaultPassphrase(entry.ID, request.Passphrase); err != nil {
			_ = store.DeleteKeyVaultEntry(a.ctx, entry.ID)
			return domain.KeyVaultEntry{}, errors.New("密钥条目已回滚：口令未能写入系统凭据库")
		}
		entry, err = store.GetKeyVaultEntry(a.ctx, entry.ID)
	}
	logger.Write(levelFor(err), "密钥库条目已创建", "keyvault.create", entry.ID, err)
	return sanitizeKeyVaultEntry(entry), err
}

func (a *App) UpdateKeyVaultEntry(request domain.SaveKeyVaultEntryRequest) (domain.KeyVaultEntry, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if request.ID <= 0 {
		return domain.KeyVaultEntry{}, errors.New("密钥 ID 无效")
	}
	request.Name = strings.TrimSpace(request.Name)
	request.PrivateKeyPath = strings.TrimSpace(request.PrivateKeyPath)
	if request.Name == "" {
		return domain.KeyVaultEntry{}, errors.New("密钥名称不能为空")
	}
	existing, err := store.GetKeyVaultEntry(a.ctx, request.ID)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if domain.KeyVaultStorageMode(existing.StorageMode) == domain.KeyVaultStorageLegacyFilePath &&
		request.PrivateKeyPath == "" {
		return domain.KeyVaultEntry{}, errors.New("请选择私钥文件")
	}
	validation := domain.PrivateKeyValidationResult{}
	needsValidation := domain.KeyVaultStorageMode(existing.StorageMode) == domain.KeyVaultStorageLegacyFilePath &&
		(request.PrivateKeyPath != existing.PrivateKeyPath || request.UpdatePassphrase)
	if needsValidation {
		validation = keyvault.ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{
			PrivateKeyPath: request.PrivateKeyPath,
			Passphrase:     request.Passphrase,
		})
		if !validation.Valid {
			return domain.KeyVaultEntry{}, errors.New(validation.UserMessage)
		}
	}
	oldReference := ""
	if request.PrivateKeyPath != existing.PrivateKeyPath {
		oldReference = existing.PassphraseCredentialRef
	}
	entry, err := store.UpdateKeyVaultEntry(a.ctx, request, validation)
	if err != nil {
		logger.Write("error", "密钥库条目更新失败", "keyvault.update", request.ID, err)
		return domain.KeyVaultEntry{}, err
	}
	if oldReference != "" && oldReference != entry.PassphraseCredentialRef {
		_ = a.secrets.Delete(a.ctx, oldReference)
	}
	if request.DeletePassphrase {
		if err := a.DeleteKeyVaultPassphrase(request.ID); err != nil {
			return domain.KeyVaultEntry{}, err
		}
		entry, err := store.GetKeyVaultEntry(a.ctx, request.ID)
		return sanitizeKeyVaultEntry(entry), err
	}
	if request.UpdatePassphrase && request.RememberPassphrase && request.Passphrase != "" {
		if domain.KeyVaultStorageMode(existing.StorageMode) == domain.KeyVaultStorageEncryptedDatabase {
			if err := a.validateKeyVaultPassphrase(existing, request.Passphrase); err != nil {
				return domain.KeyVaultEntry{}, err
			}
		}
		if err := a.saveKeyVaultPassphrase(request.ID, request.Passphrase); err != nil {
			return domain.KeyVaultEntry{}, errors.New("口令验证已通过，但未能写入系统凭据库")
		}
		entry, err = store.GetKeyVaultEntry(a.ctx, request.ID)
	}
	logger.Write(levelFor(err), "密钥库条目已更新", "keyvault.update", request.ID, err)
	return sanitizeKeyVaultEntry(entry), err
}

func (a *App) MigrateLegacyPrivateKey(request domain.SaveKeyVaultEntryRequest) (domain.KeyVaultEntry, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if request.ID <= 0 {
		return domain.KeyVaultEntry{}, errors.New("密钥 ID 无效")
	}
	existing, err := store.GetKeyVaultEntry(a.ctx, request.ID)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if domain.KeyVaultStorageMode(existing.StorageMode) == domain.KeyVaultStorageEncryptedDatabase {
		return sanitizeKeyVaultEntry(existing), nil
	}
	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" {
		request.Name = existing.Name
	}
	request.Notes = strings.TrimSpace(request.Notes)
	if request.Notes == "" {
		request.Notes = existing.Notes
	}
	request.PrivateKeyPath = strings.TrimSpace(request.PrivateKeyPath)
	if request.PrivateKeyPath == "" {
		request.PrivateKeyPath = existing.PrivateKeyPath
	}
	if request.PrivateKeyPath == "" {
		return domain.KeyVaultEntry{}, errors.New("原私钥文件不存在，请重新选择私钥文件")
	}
	imported, err := keyvault.ImportPrivateKeyFromFile(request, a.privateKeyProtector())
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	defer wipeBytes(imported.ProtectedBlob)
	if duplicate, err := store.GetKeyVaultEntryByFingerprint(a.ctx, imported.Validation.FingerprintSHA256); err == nil && duplicate.ID != existing.ID {
		return domain.KeyVaultEntry{}, errors.New("该私钥已存在于密钥库，不会重复保存相同密钥正文")
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.KeyVaultEntry{}, err
	}
	entry, err := store.UpdateKeyVaultProtectedMaterial(a.ctx, existing.ID, request, imported.Validation, imported.ProtectedBlob, imported.SourceFileName)
	if err != nil {
		logger.Write("error", "密钥库条目迁移失败", "keyvault.migrate", existing.ID, err)
		return domain.KeyVaultEntry{}, err
	}
	if request.RememberPassphrase && request.Passphrase != "" {
		if err := a.saveKeyVaultPassphrase(entry.ID, request.Passphrase); err != nil {
			return domain.KeyVaultEntry{}, errors.New("密钥已迁移，但口令未能写入系统凭据库")
		}
		entry, err = store.GetKeyVaultEntry(a.ctx, entry.ID)
	}
	logger.Write(levelFor(err), "密钥库条目已迁移", "keyvault.migrate", entry.ID, err)
	return sanitizeKeyVaultEntry(entry), err
}

func (a *App) DeleteKeyVaultEntry(request domain.DeleteKeyVaultEntryRequest) (domain.DeleteKeyVaultEntryResponse, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.DeleteKeyVaultEntryResponse{}, err
	}
	entry, err := store.GetKeyVaultEntry(a.ctx, request.ID)
	if err != nil {
		return domain.DeleteKeyVaultEntryResponse{}, err
	}
	response, err := store.DeleteKeyVaultEntryWithUnbind(a.ctx, request)
	if err != nil {
		logger.Write("error", keyLogMessage("密钥库条目删除失败", request.ID), "keyvault.delete", 0, err)
		return domain.DeleteKeyVaultEntryResponse{}, err
	}
	if response.RequiresConfirmation {
		logger.Write("info", keyLogMessage("密钥库条目删除需要确认", request.ID), "keyvault.delete.confirm", 0, nil)
		return response, nil
	}
	if response.Deleted && entry.PassphraseCredentialRef != "" {
		if err := a.secrets.Delete(a.ctx, entry.PassphraseCredentialRef); err != nil {
			response.SecretCleanupWarning = "密钥已删除，但系统凭据中的私钥口令清理失败。"
			logger.Write("error", keyLogMessage("密钥已删除但系统凭据清理失败", request.ID), "keyvault.delete.secret_cleanup", 0, err)
		} else {
			logger.Write("info", keyLogMessage("已清理密钥库系统凭据", request.ID), "keyvault.delete.secret_cleanup", 0, nil)
		}
	}
	logger.Write("info", keyLogMessage("密钥库条目已删除", request.ID), "keyvault.delete", 0, nil)
	return response, nil
}

func (a *App) DeleteKeyVaultPassphrase(id int64) error {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	entry, err := store.GetKeyVaultEntry(a.ctx, id)
	if err != nil {
		return err
	}
	if entry.PassphraseCredentialRef != "" {
		if err := a.secrets.Delete(a.ctx, entry.PassphraseCredentialRef); err != nil {
			return errors.New("删除系统凭据库中的密钥口令失败")
		}
	}
	err = store.SetKeyVaultPassphraseRef(a.ctx, id, "")
	logger.Write(levelFor(err), "密钥库口令已删除", "keyvault.passphrase.delete", id, err)
	return err
}

func (a *App) UpdateKeyVaultPassphrase(id int64, passphrase string) (domain.KeyVaultEntry, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	entry, err := store.GetKeyVaultEntry(a.ctx, id)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if err := a.validateKeyVaultPassphrase(entry, passphrase); err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if err := a.saveKeyVaultPassphrase(id, passphrase); err != nil {
		return domain.KeyVaultEntry{}, errors.New("口令验证已通过，但未能写入系统凭据库")
	}
	entry, err = store.GetKeyVaultEntry(a.ctx, id)
	return sanitizeKeyVaultEntry(entry), err
}

func (a *App) validateKeyVaultPassphrase(entry domain.KeyVaultEntry, passphrase string) error {
	if domain.KeyVaultStorageMode(entry.StorageMode) == domain.KeyVaultStorageEncryptedDatabase {
		keyBytes, err := a.privateKeyProtector().Unprotect(entry.ProtectedKeyBlob)
		if err != nil {
			return errors.New(err.Error())
		}
		defer wipeBytes(keyBytes)
		validation := keyvault.ValidatePrivateKeyBytes(keyBytes, passphrase)
		if !validation.Valid {
			return errors.New(validation.UserMessage)
		}
		return nil
	}
	validation := keyvault.ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{
		PrivateKeyPath: entry.PrivateKeyPath,
		Passphrase:     passphrase,
	})
	if !validation.Valid {
		return errors.New(validation.UserMessage)
	}
	return nil
}

func (a *App) saveKeyVaultPassphrase(id int64, passphrase string) error {
	reference := credential.KeyVaultPassphraseReference(id)
	secretBytes := []byte(passphrase)
	defer wipeBytes(secretBytes)
	if err := a.secrets.Set(a.ctx, reference, secretBytes); err != nil {
		return err
	}
	if err := a.store.SetKeyVaultPassphraseRef(a.ctx, id, reference); err != nil {
		_ = a.secrets.Delete(a.ctx, reference)
		return err
	}
	return nil
}

func (a *App) SelectPrivateKeyFile() (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("application is not initialized")
	}
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择 SSH 私钥",
		Filters: []runtime.FileFilter{
			{DisplayName: "SSH 私钥 (*.pem;*.key;id_rsa;id_ed25519)", Pattern: "*.pem;*.key;id_rsa;id_ed25519"},
			{DisplayName: "所有文件", Pattern: "*"},
		},
	})
}

func keyVaultIDValue(id *int64) int64 {
	if id == nil {
		return 0
	}
	return *id
}

func sanitizeKeyVaultEntry(entry domain.KeyVaultEntry) domain.KeyVaultEntry {
	entry.PassphraseCredentialRef = ""
	entry.ProtectedKeyBlob = nil
	if domain.KeyVaultStorageMode(entry.StorageMode) == domain.KeyVaultStorageEncryptedDatabase {
		entry.PrivateKeyPath = ""
	}
	return entry
}

func keyIDHash(id int64) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("keyvault:%d", id)))
	return hex.EncodeToString(sum[:])[:12]
}

func keyLogMessage(message string, id int64) string {
	return fmt.Sprintf("%s（keyIDHash=%s）", message, keyIDHash(id))
}

func (a *App) privateKeyProtector() keyvault.KeyMaterialProtector {
	a.mu.RLock()
	protector := a.keyProtector
	a.mu.RUnlock()
	if protector != nil {
		return protector
	}
	return keyvault.NewPlatformProtector()
}

func wipeBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
