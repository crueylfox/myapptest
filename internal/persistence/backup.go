package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
	"serverpilot/internal/keyvault"
)

func (s *Store) ExportBackupPayload(ctx context.Context) (domain.BackupPayload, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return domain.BackupPayload{}, err
	}
	groups, err := s.exportBackupGroups(ctx)
	if err != nil {
		return domain.BackupPayload{}, err
	}
	connections, err := s.exportBackupConnections(ctx)
	if err != nil {
		return domain.BackupPayload{}, err
	}
	tunnelProfiles, err := s.exportBackupTunnelProfiles(ctx)
	if err != nil {
		return domain.BackupPayload{}, err
	}
	terminalProfiles, err := s.exportBackupTerminalProfiles(ctx)
	if err != nil {
		return domain.BackupPayload{}, err
	}
	keys, err := s.exportBackupKeyVault(ctx)
	if err != nil {
		return domain.BackupPayload{}, err
	}
	settings.WindowWidth = domain.DefaultAppSettings().WindowWidth
	settings.WindowHeight = domain.DefaultAppSettings().WindowHeight
	settings.WindowMaximized = false
	return domain.BackupPayload{
		Settings:         &settings,
		Groups:           groups,
		Connections:      connections,
		TerminalProfiles: terminalProfiles,
		TunnelProfiles:   tunnelProfiles,
		KeyVault:         keys,
	}, nil
}

func (s *Store) ExportBackupSecretRefs(ctx context.Context) ([]domain.BackupSecretRef, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT connection_id, kind, reference FROM credential_refs ORDER BY connection_id, kind`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var refs []domain.BackupSecretRef
	for rows.Next() {
		var ref domain.BackupSecretRef
		ref.Scope = "connection"
		if err := rows.Scan(&ref.OwnerID, &ref.Kind, &ref.Reference); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	keyRows, err := s.db.QueryContext(ctx, `
SELECT id, passphrase_credential_ref
FROM key_vault_entries
WHERE storage_mode=? AND length(protected_key_blob) > 0 AND passphrase_credential_ref <> ''
ORDER BY id`, string(domain.KeyVaultStorageEncryptedDatabase))
	if err != nil {
		return nil, err
	}
	defer keyRows.Close()
	for keyRows.Next() {
		var ref domain.BackupSecretRef
		ref.Scope = "key_vault"
		ref.Kind = "passphrase"
		if err := keyRows.Scan(&ref.OwnerID, &ref.Reference); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	if err := keyRows.Err(); err != nil {
		return nil, err
	}
	return refs, nil
}

func (s *Store) ExportBackupInlineSecrets(ctx context.Context) ([]domain.BackupSecret, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, protected_key_blob
FROM key_vault_entries
WHERE storage_mode=? AND length(protected_key_blob) > 0
ORDER BY id`, string(domain.KeyVaultStorageEncryptedDatabase))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	secrets := []domain.BackupSecret{}
	for rows.Next() {
		var secret domain.BackupSecret
		secret.Scope = "key_vault"
		secret.Kind = "protected_key_blob"
		if err := rows.Scan(&secret.OwnerID, &secret.Value); err != nil {
			return nil, err
		}
		secret.Value = append([]byte(nil), secret.Value...)
		secrets = append(secrets, secret)
	}
	return secrets, rows.Err()
}

func (s *Store) ApplyBackupSecretRefs(ctx context.Context, restores []domain.BackupSecretRestore) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, restore := range restores {
		switch restore.Scope {
		case "connection":
			if _, err := tx.ExecContext(ctx, `
INSERT INTO credential_refs(connection_id, kind, reference) VALUES(?, ?, ?)
ON CONFLICT(connection_id, kind) DO UPDATE SET reference=excluded.reference`,
				restore.OwnerID, restore.Kind, restore.Reference,
			); err != nil {
				_ = tx.Rollback()
				return err
			}
		case "key_vault":
			if restore.Kind != "passphrase" {
				_ = tx.Rollback()
				return fmt.Errorf("unsupported key vault secret kind %q", restore.Kind)
			}
			if _, err := tx.ExecContext(ctx, `
UPDATE key_vault_entries SET passphrase_credential_ref=?, passphrase_saved=1, updated_at=? WHERE id=?`,
				restore.Reference, time.Now().UTC().Format(time.RFC3339Nano), restore.OwnerID,
			); err != nil {
				_ = tx.Rollback()
				return err
			}
		default:
			_ = tx.Rollback()
			return fmt.Errorf("unsupported backup secret scope %q", restore.Scope)
		}
	}
	return tx.Commit()
}

func (s *Store) InspectBackupPayload(ctx context.Context, payload domain.BackupPayload) (domain.BackupPreview, error) {
	var preview domain.BackupPreview
	existingGroups, err := s.groupNameSet(ctx)
	if err != nil {
		return preview, err
	}
	existingKeys, err := s.keyVaultFingerprintSet(ctx)
	if err != nil {
		return preview, err
	}
	for _, group := range payload.Groups {
		if existingGroups[strings.ToLower(group.Name)] {
			preview.ConflictCount++
			preview.Conflicts = append(preview.Conflicts, domain.BackupConflict{
				Kind: "group", Name: group.Name, Message: "分组名称已存在，导入时会复用现有分组。",
			})
		}
	}
	for _, key := range payload.KeyVault {
		if key.PublicKeyFingerprintSHA256 != "" && existingKeys[key.PublicKeyFingerprintSHA256] {
			preview.ConflictCount++
			preview.Conflicts = append(preview.Conflicts, domain.BackupConflict{
				Kind: "key_vault", Name: key.Name, Message: "相同指纹的密钥库条目已存在，导入服务器时会复用本机密钥。",
			})
		}
	}
	return preview, nil
}

func (s *Store) ImportBackupPayload(
	ctx context.Context,
	payload domain.BackupPayload,
	options domain.BackupImportOptions,
) (domain.BackupImportPayloadResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.BackupImportPayloadResult{}, err
	}
	result, err := s.importBackupPayloadTx(ctx, tx, payload, options)
	if err != nil {
		_ = tx.Rollback()
		return domain.BackupImportPayloadResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.BackupImportPayloadResult{}, err
	}
	return result, nil
}

func (s *Store) importBackupPayloadTx(
	ctx context.Context,
	tx *sql.Tx,
	payload domain.BackupPayload,
	options domain.BackupImportOptions,
) (domain.BackupImportPayloadResult, error) {
	var result domain.BackupImportPayloadResult
	terminalProfileMap := map[string]string{}
	if options.ImportSettings || options.ImportServers {
		mapped, err := importBackupTerminalProfilesTx(ctx, tx, payload.TerminalProfiles)
		if err != nil {
			return result, err
		}
		terminalProfileMap = mapped
	}
	groupMap := map[int64]int64{}
	if options.ImportGroups {
		groups, err := groupNameIDMapTx(ctx, tx)
		if err != nil {
			return result, err
		}
		for _, group := range payload.Groups {
			name := backupName(group.Name)
			if existingID, ok := groups[strings.ToLower(name)]; ok {
				groupMap[group.ID] = existingID
				continue
			}
			insertedID, err := insertGroupTx(ctx, tx, name)
			if err != nil {
				return result, err
			}
			groupMap[group.ID] = insertedID
			result.GroupsAdded++
			groups[strings.ToLower(name)] = insertedID
		}
	}
	keyMap := map[int64]int64{}
	restoredKeyVaultIDs := map[int64]bool{}
	protectedKeyBlobs := backupKeyVaultProtectedBlobs(payload.Secrets)
	if options.ImportKeyVault {
		fingerprints, err := keyVaultFingerprintIDMapTx(ctx, tx)
		if err != nil {
			return result, err
		}
		for _, key := range payload.KeyVault {
			fingerprint := strings.TrimSpace(key.PublicKeyFingerprintSHA256)
			if fingerprint == "" {
				insertedID, err := insertKeyVaultTx(ctx, tx, key, backupName(key.Name), nil)
				if err != nil {
					return result, err
				}
				keyMap[key.ID] = insertedID
				result.KeyVaultAdded++
				result.Warnings = append(result.Warnings, domain.BackupWarning{
					Code:    "KEY_VAULT_RESELECT_REQUIRED",
					Message: fmt.Sprintf("密钥库“%s”缺少可匹配指纹，已导入元数据，相关服务器导入后需要重新输入密码/私钥口令。", key.Name),
				})
				continue
			}
			if existingID, ok := fingerprints[fingerprint]; ok {
				keyMap[key.ID] = existingID
				result.Warnings = append(result.Warnings, domain.BackupWarning{
					Code:    "KEY_VAULT_REBOUND_BY_FINGERPRINT",
					Message: fmt.Sprintf("已将密钥库“%s”按指纹绑定到本机已有密钥。", key.Name),
				})
				continue
			}
			if payload.Mode == domain.BackupModeFull &&
				domain.KeyVaultStorageMode(key.StorageMode) == domain.KeyVaultStorageEncryptedDatabase &&
				len(protectedKeyBlobs[key.ID]) > 0 {
				if !protectedKeyBlobRestorableForPlatform(runtime.GOOS, protectedKeyBlobs[key.ID]) {
					insertedID, err := insertKeyVaultTx(ctx, tx, key, backupName(key.Name), nil)
					if err != nil {
						return result, err
					}
					keyMap[key.ID] = insertedID
					fingerprints[fingerprint] = insertedID
					result.KeyVaultAdded++
					result.Warnings = append(result.Warnings, domain.BackupWarning{
						Code:    "WINDOWS_PROTECTED_CREDENTIAL_REENTER_REQUIRED",
						Message: keyvault.WindowsProtectedCredentialHint,
					})
					continue
				}
				insertedID, err := insertKeyVaultTx(ctx, tx, key, backupName(key.Name), protectedKeyBlobs[key.ID])
				if err != nil {
					return result, err
				}
				keyMap[key.ID] = insertedID
				restoredKeyVaultIDs[key.ID] = true
				fingerprints[fingerprint] = insertedID
				result.KeyVaultAdded++
				continue
			}
			insertedID, err := insertKeyVaultTx(ctx, tx, key, backupName(key.Name), nil)
			if err != nil {
				return result, err
			}
			keyMap[key.ID] = insertedID
			fingerprints[fingerprint] = insertedID
			result.KeyVaultAdded++
			result.Warnings = append(result.Warnings, domain.BackupWarning{
				Code:    "KEY_VAULT_RESELECT_REQUIRED",
				Message: fmt.Sprintf("本机密钥库缺少“%s”的指纹，相关服务器导入后需要重新选择密钥。", key.Name),
			})
		}
	}
	connectionMap := map[int64]int64{}
	if options.ImportServers {
		for index, connection := range payload.Connections {
			if connection.SortOrder <= 0 {
				connection.SortOrder = int64(index+1) * 1000
			}
			var mappedGroup *int64
			if connection.GroupID != nil {
				if options.ImportGroups {
					if id, ok := groupMap[*connection.GroupID]; ok {
						mappedGroup = &id
					}
				}
			}
			var mappedKey *int64
			if connection.AuthType == domain.AuthPrivateKey &&
				connection.PrivateKeySource == domain.PrivateKeySourceKeyVault &&
				connection.KeyVaultID != nil {
				if id, ok := keyMap[*connection.KeyVaultID]; ok {
					mappedKey = &id
				} else {
					result.Warnings = append(result.Warnings, domain.BackupWarning{
						Code:    "CONNECTION_KEY_VAULT_RESELECT_REQUIRED",
						Message: fmt.Sprintf("服务器“%s”引用的密钥不在本机密钥库中，导入后需要重新选择密钥。", connection.Name),
					})
				}
			}
			fingerprint := ""
			if options.ImportHostTrust {
				fingerprint = connection.HostKeyFingerprint
			}
			var mappedTerminalProfile *string
			if connection.TerminalProfileID != nil {
				if id, ok := terminalProfileMap[*connection.TerminalProfileID]; ok {
					mappedTerminalProfile = &id
				}
			}
			id, inserted, hostTrustImported, err := upsertConnectionTx(ctx, tx, connection, mappedGroup, mappedKey, mappedTerminalProfile, fingerprint)
			if err != nil {
				return result, err
			}
			connectionMap[connection.ID] = id
			if inserted {
				result.ConnectionsAdded++
			}
			if hostTrustImported {
				result.HostTrustImported++
			}
		}
		if err := restoreBackupJumpRoutesTx(ctx, tx, payload.Connections, connectionMap, &result); err != nil {
			return result, err
		}
		for _, profile := range payload.TunnelProfiles {
			serverID, ok := connectionMap[profile.ServerID]
			if !ok {
				result.Skipped++
				result.Warnings = append(result.Warnings, domain.BackupWarning{
					Code:    "TUNNEL_PROFILE_SKIPPED_MISSING_SERVER",
					Message: fmt.Sprintf("已跳过端口转发配置“%s”：引用的服务器未导入或不存在。", profile.Name),
				})
				continue
			}
			if err := upsertTunnelProfileTx(ctx, tx, profile, serverID); err != nil {
				return result, err
			}
		}
	}
	if options.ImportSettings && payload.Settings != nil {
		settings := *payload.Settings
		settings.SettingsVersion = domain.CurrentSettingsVersion
		if settings.LocalTerminalShellPreference == "" {
			settings.LocalTerminalShellPreference = domain.LocalTerminalShellAuto
		}
		if settings.DefaultTerminalProfileID == "" {
			settings.DefaultTerminalProfileID = domain.DefaultTerminalProfileID
		} else if mapped, ok := terminalProfileMap[settings.DefaultTerminalProfileID]; ok {
			settings.DefaultTerminalProfileID = mapped
		}
		if payload.Settings.SettingsVersion < 5 {
			settings.TerminalCopyOnSelectEnabled = true
			settings.TerminalRightClickPasteEnabled = true
		}
		if settings.CommandHistoryMaxEntries < domain.MinimumCommandHistoryMaxEntries ||
			settings.CommandHistoryMaxEntries > domain.MaximumCommandHistoryMaxEntries ||
			payload.Settings.SettingsVersion < 8 {
			settings.CommandHistoryMaxEntries = domain.DefaultCommandHistoryMaxEntries
		}
		if payload.Settings.SettingsVersion < 9 {
			settings.SSHKeepaliveEnabled = true
			settings.SSHKeepaliveIntervalSeconds = domain.DefaultSSHKeepaliveIntervalSeconds
			settings.SSHKeepaliveTimeoutSeconds = domain.DefaultSSHKeepaliveTimeoutSeconds
			settings.SSHKeepaliveMaxFailures = domain.DefaultSSHKeepaliveMaxFailures
		}
		if settings.SSHKeepaliveIntervalSeconds == 0 {
			settings.SSHKeepaliveIntervalSeconds = domain.DefaultSSHKeepaliveIntervalSeconds
		}
		if settings.SSHKeepaliveTimeoutSeconds == 0 {
			settings.SSHKeepaliveTimeoutSeconds = domain.DefaultSSHKeepaliveTimeoutSeconds
		}
		if settings.SSHKeepaliveMaxFailures == 0 {
			settings.SSHKeepaliveMaxFailures = domain.DefaultSSHKeepaliveMaxFailures
		}
		settings.DashboardSortMode = normalizeDashboardSortMode(settings.DashboardSortMode)
		if payload.Settings.SettingsVersion < 11 {
			settings.Alerts = domain.DefaultAlertSettings()
		} else if settings.Alerts.HistoryLimit < domain.MinimumAlertHistoryLimit ||
			settings.Alerts.HistoryLimit > domain.MaximumAlertHistoryLimit {
			settings.Alerts.HistoryLimit = domain.DefaultAlertHistoryLimit
		}
		var err error
		settings.DashboardManualServerOrder, err = remapDashboardManualServerOrderTx(
			ctx,
			tx,
			settings.DashboardManualServerOrder,
			connectionMap,
			options.ImportServers,
		)
		if err != nil {
			return result, err
		}
		settings.WindowWidth = domain.DefaultAppSettings().WindowWidth
		settings.WindowHeight = domain.DefaultAppSettings().WindowHeight
		settings.WindowMaximized = false
		settings.Shortcuts = normalizeShortcutSettings(settings.Shortcuts, settings.TerminalCopyOnSelectEnabled, settings.TerminalRightClickPasteEnabled, payload.Settings.SettingsVersion)
		settings.TerminalCopyOnSelectEnabled = settings.Shortcuts.TerminalCopyOnSelectEnabled
		settings.TerminalRightClickPasteEnabled = settings.Shortcuts.TerminalRightClickAction == domain.TerminalRightClickPaste
		if payload.Settings.SettingsVersion < 15 {
			settings.BackupImportOptions = domain.DefaultBackupImportOptionPreferences()
		}
		dashboardManualServerOrder, err := dashboardManualServerOrderJSON(settings.DashboardManualServerOrder)
		if err != nil {
			return result, err
		}
		alertSettings, err := alertSettingsJSON(settings.Alerts)
		if err != nil {
			return result, err
		}
		shortcutSettings, err := shortcutSettingsJSON(settings.Shortcuts)
		if err != nil {
			return result, err
		}
		backupImportOptions, err := backupImportOptionsJSON(settings.BackupImportOptions)
		if err != nil {
			return result, err
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE app_settings SET
default_remember_password=?,
default_remember_passphrase=?,
host_key_policy=?,
theme_mode=?,
ui_font_size=?,
local_terminal_shell_preference=?,
local_terminal_elevated_enabled=?,
default_terminal_profile_id=?,
command_history_max_entries=?,
connection_timeout_seconds=?,
terminal_copy_on_select_enabled=?,
terminal_right_click_paste_enabled=?,
ssh_keepalive_enabled=?,
ssh_keepalive_interval_seconds=?,
ssh_keepalive_timeout_seconds=?,
ssh_keepalive_max_failures=?,
dashboard_sort_mode=?,
dashboard_manual_server_order=?,
alert_settings=?,
shortcut_settings=?,
backup_import_options=?,
window_width=?,
window_height=?,
window_maximized=?,
settings_version=?,
onboarding_completed=?,
trust_on_first_use_acknowledged=?
WHERE singleton=1`,
			settings.DefaultRememberPassword,
			settings.DefaultRememberPassphrase,
			settings.HostKeyPolicy,
			settings.ThemeMode,
			settings.UIFontSize,
			settings.LocalTerminalShellPreference,
			settings.LocalTerminalElevatedEnabled,
			settings.DefaultTerminalProfileID,
			settings.CommandHistoryMaxEntries,
			settings.ConnectionTimeoutSeconds,
			settings.TerminalCopyOnSelectEnabled,
			settings.TerminalRightClickPasteEnabled,
			settings.SSHKeepaliveEnabled,
			settings.SSHKeepaliveIntervalSeconds,
			settings.SSHKeepaliveTimeoutSeconds,
			settings.SSHKeepaliveMaxFailures,
			settings.DashboardSortMode,
			dashboardManualServerOrder,
			alertSettings,
			shortcutSettings,
			backupImportOptions,
			settings.WindowWidth,
			settings.WindowHeight,
			settings.WindowMaximized,
			settings.SettingsVersion,
			settings.OnboardingCompleted,
			settings.TrustOnFirstUseAcknowledged,
		); err != nil {
			return result, err
		}
	}
	result.SecretRestores = backupSecretRestores(payload.Secrets, connectionMap, keyMap, restoredKeyVaultIDs)
	return result, nil
}

func protectedKeyBlobRestorableForPlatform(platform string, blob []byte) bool {
	if platform == "darwin" {
		return keyvault.IsLocalProtectorBlob(blob)
	}
	return true
}

func normalizeDashboardSortMode(value domain.DashboardSortMode) domain.DashboardSortMode {
	switch value {
	case domain.DashboardSortManual, domain.DashboardSortGroup, domain.DashboardSortRemark,
		domain.DashboardSortCPU, domain.DashboardSortMemory, domain.DashboardSortNetwork:
		return value
	default:
		return domain.DashboardSortManual
	}
}

func normalizeShortcutSettings(value domain.ShortcutSettings, legacyCopyOnSelect bool, legacyRightClickPaste bool, settingsVersion int) domain.ShortcutSettings {
	defaults := domain.DefaultShortcutSettings()
	if value.TerminalRightClickAction == "" &&
		value.TerminalContextMenuTrigger == "" &&
		value.TerminalCopy == "" &&
		value.TerminalPaste == "" &&
		value.TerminalCompletion == "" &&
		value.OpenCommandHistory == "" &&
		value.OpenCommandFavorites == "" {
		defaults.TerminalCopyOnSelectEnabled = legacyCopyOnSelect
		if legacyRightClickPaste {
			defaults.TerminalRightClickAction = domain.TerminalRightClickPaste
		} else {
			defaults.TerminalRightClickAction = domain.TerminalRightClickMenu
		}
		return defaults
	}
	if value.TerminalRightClickAction == "" {
		value.TerminalRightClickAction = defaults.TerminalRightClickAction
	}
	if value.TerminalContextMenuTrigger == "" {
		value.TerminalContextMenuTrigger = defaults.TerminalContextMenuTrigger
	}
	if value.TerminalCopy == "" {
		value.TerminalCopy = defaults.TerminalCopy
	}
	if value.TerminalPaste == "" {
		value.TerminalPaste = defaults.TerminalPaste
	}
	if value.TerminalCompletion == "" {
		value.TerminalCompletion = defaults.TerminalCompletion
	}
	if value.OpenCommandHistory == "" {
		value.OpenCommandHistory = defaults.OpenCommandHistory
	}
	if value.OpenCommandFavorites == "" {
		value.OpenCommandFavorites = defaults.OpenCommandFavorites
	}
	if settingsVersion < 14 && strings.EqualFold(strings.TrimSpace(value.TerminalCompletion), "ctrl+space") {
		value.TerminalCompletion = defaults.TerminalCompletion
	}
	return value
}

func remapDashboardManualServerOrderTx(
	ctx context.Context,
	tx *sql.Tx,
	order []string,
	connectionMap map[int64]int64,
	importServers bool,
) ([]string, error) {
	if len(order) == 0 {
		return []string{}, nil
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(order))
	if importServers {
		for _, value := range order {
			sourceID, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			if err != nil {
				continue
			}
			targetID, ok := connectionMap[sourceID]
			if !ok {
				continue
			}
			next := strconv.FormatInt(targetID, 10)
			if !seen[next] {
				seen[next] = true
				result = append(result, next)
			}
		}
		return result, nil
	}
	valid, err := existingConnectionIDStringsTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	for _, value := range order {
		value = strings.TrimSpace(value)
		if value == "" || !valid[value] || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result, nil
}

func existingConnectionIDStringsTx(ctx context.Context, tx *sql.Tx) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM connections")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[strconv.FormatInt(id, 10)] = true
	}
	return ids, rows.Err()
}

func backupName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "导入项目"
	}
	return name
}

func backupSecretRestores(
	secrets []domain.BackupSecret,
	connectionMap map[int64]int64,
	keyMap map[int64]int64,
	restoredKeyVaultIDs map[int64]bool,
) []domain.BackupSecretRestore {
	restores := make([]domain.BackupSecretRestore, 0, len(secrets))
	for _, secret := range secrets {
		switch secret.Scope {
		case "connection":
			id, ok := connectionMap[secret.OwnerID]
			if !ok {
				continue
			}
			restores = append(restores, domain.BackupSecretRestore{
				Scope:     secret.Scope,
				OwnerID:   id,
				Kind:      secret.Kind,
				Reference: connectionSecretReference(id, secret.Kind),
				Value:     append([]byte(nil), secret.Value...),
			})
		case "key_vault":
			if secret.Kind != "passphrase" || !restoredKeyVaultIDs[secret.OwnerID] {
				continue
			}
			id, ok := keyMap[secret.OwnerID]
			if !ok {
				continue
			}
			restores = append(restores, domain.BackupSecretRestore{
				Scope:     secret.Scope,
				OwnerID:   id,
				Kind:      secret.Kind,
				Reference: keyVaultPassphraseReference(id),
				Value:     append([]byte(nil), secret.Value...),
			})
		}
	}
	return restores
}

func backupKeyVaultProtectedBlobs(secrets []domain.BackupSecret) map[int64][]byte {
	values := map[int64][]byte{}
	for _, secret := range secrets {
		if secret.Scope != "key_vault" || secret.Kind != "protected_key_blob" || len(secret.Value) == 0 {
			continue
		}
		values[secret.OwnerID] = append([]byte(nil), secret.Value...)
	}
	return values
}

func connectionSecretReference(connectionID int64, kind string) string {
	return fmt.Sprintf("ServerPilot/connection/%d/%s", connectionID, kind)
}

func keyVaultPassphraseReference(keyID int64) string {
	return fmt.Sprintf("ServerPilot/keyvault/%d/passphrase", keyID)
}

func (s *Store) exportBackupGroups(ctx context.Context) ([]domain.BackupGroup, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, name FROM groups ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []domain.BackupGroup
	for rows.Next() {
		var group domain.BackupGroup
		if err := rows.Scan(&group.ID, &group.Name); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func (s *Store) exportBackupConnections(ctx context.Context) ([]domain.BackupConnection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, group_id, sort_order, name, host, port, username,
auth_type, private_key_source, private_key_path, key_vault_id, host_key_fingerprint,
terminal_profile_id, refresh_interval, network_interface_mode, selected_network_interface,
network_interface_user_selected, connection_mode, jump_server_id, created_at, updated_at FROM connections ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var connections []domain.BackupConnection
	for rows.Next() {
		var item domain.BackupConnection
		var groupID, keyVaultID, jumpServerID sql.NullInt64
		var terminalProfileID sql.NullString
		if err := rows.Scan(
			&item.ID, &groupID, &item.SortOrder, &item.Name, &item.Host, &item.Port, &item.Username,
			&item.AuthType, &item.PrivateKeySource, &item.PrivateKeyPath, &keyVaultID,
			&item.HostKeyFingerprint, &terminalProfileID, &item.RefreshInterval,
			&item.NetworkInterfaceMode, &item.SelectedNetworkInterface,
			&item.NetworkInterfaceUserSelected, &item.ConnectionMode, &jumpServerID,
			&item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if groupID.Valid {
			item.GroupID = &groupID.Int64
		}
		if keyVaultID.Valid {
			item.KeyVaultID = &keyVaultID.Int64
		}
		if terminalProfileID.Valid && terminalProfileID.String != "" {
			item.TerminalProfileID = &terminalProfileID.String
		}
		if item.ConnectionMode != domain.ConnectionModeJump {
			item.ConnectionMode = domain.ConnectionModeDirect
		}
		if jumpServerID.Valid && jumpServerID.Int64 > 0 {
			item.JumpServerID = &jumpServerID.Int64
		}
		item.NetworkInterfaceMode, item.SelectedNetworkInterface = normalizeNetworkInterfacePreference(
			item.NetworkInterfaceMode,
			item.SelectedNetworkInterface,
		)
		connections = append(connections, item)
	}
	return connections, rows.Err()
}

func (s *Store) exportBackupTerminalProfiles(ctx context.Context) ([]domain.BackupTerminalProfile, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, font_family, font_size, line_height,
letter_spacing, cursor_style, cursor_blink, scrollback, theme_name,
foreground, background, selection_background, cursor_color, created_at, updated_at
FROM terminal_profiles ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var profiles []domain.BackupTerminalProfile
	for rows.Next() {
		var item domain.BackupTerminalProfile
		if err := rows.Scan(
			&item.ID, &item.Name, &item.FontFamily, &item.FontSize, &item.LineHeight,
			&item.LetterSpacing, &item.CursorStyle, &item.CursorBlink, &item.Scrollback,
			&item.ThemeName, &item.Foreground, &item.Background, &item.SelectionBackground,
			&item.CursorColor, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		profiles = append(profiles, item)
	}
	return profiles, rows.Err()
}

func (s *Store) exportBackupKeyVault(ctx context.Context) ([]domain.BackupKeyVaultEntry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, storage_mode, source_file_name, algorithm,
key_bits, public_key_fingerprint_sha256, encrypted, notes, created_at, updated_at, last_used_at
FROM key_vault_entries ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []domain.BackupKeyVaultEntry
	for rows.Next() {
		var item domain.BackupKeyVaultEntry
		var lastUsed sql.NullString
		if err := rows.Scan(
			&item.ID, &item.Name, &item.StorageMode, &item.SourceFileName, &item.Algorithm,
			&item.KeyBits, &item.PublicKeyFingerprintSHA256, &item.Encrypted, &item.Notes,
			&item.CreatedAt, &item.UpdatedAt, &lastUsed,
		); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			item.LastUsedAt = lastUsed.String
		}
		keys = append(keys, item)
	}
	return keys, rows.Err()
}

func (s *Store) exportBackupTunnelProfiles(ctx context.Context) ([]domain.BackupTunnelProfile, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, server_id, type, bind_host, bind_port,
target_host, target_port, remote_bind_host, remote_bind_port, auto_start, created_at, updated_at
FROM tunnel_profiles ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var profiles []domain.BackupTunnelProfile
	for rows.Next() {
		var item domain.BackupTunnelProfile
		if err := rows.Scan(
			&item.ID, &item.Name, &item.ServerID, &item.Type,
			&item.BindHost, &item.BindPort, &item.TargetHost, &item.TargetPort,
			&item.RemoteBindHost, &item.RemoteBindPort, &item.AutoStart,
			&item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		profiles = append(profiles, item)
	}
	return profiles, rows.Err()
}

func (s *Store) groupNameSet(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT name FROM groups")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNameSet(rows, true)
}

func (s *Store) keyVaultFingerprintSet(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT public_key_fingerprint_sha256 FROM key_vault_entries")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNameSet(rows, false)
}

func groupNameIDMapTx(ctx context.Context, tx *sql.Tx) (map[string]int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id, name FROM groups")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := map[string]int64{}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		values[strings.ToLower(name)] = id
	}
	return values, rows.Err()
}

func keyVaultFingerprintIDMapTx(ctx context.Context, tx *sql.Tx) (map[string]int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id, public_key_fingerprint_sha256 FROM key_vault_entries WHERE public_key_fingerprint_sha256 <> ''")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := map[string]int64{}
	for rows.Next() {
		var id int64
		var fingerprint string
		if err := rows.Scan(&id, &fingerprint); err != nil {
			return nil, err
		}
		values[fingerprint] = id
	}
	return values, rows.Err()
}

func importBackupTerminalProfilesTx(
	ctx context.Context,
	tx *sql.Tx,
	profiles []domain.BackupTerminalProfile,
) (map[string]string, error) {
	values := map[string]string{
		domain.DefaultTerminalProfileID: domain.DefaultTerminalProfileID,
	}
	if len(profiles) == 0 {
		return values, nil
	}
	names, err := terminalProfileNameSetTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	for _, profile := range profiles {
		if strings.TrimSpace(profile.ID) == "" {
			continue
		}
		if profile.ID == domain.DefaultTerminalProfileID {
			values[profile.ID] = domain.DefaultTerminalProfileID
			continue
		}
		name := backupName(profile.Name)
		if names[strings.ToLower(name)] {
			name = nextImportedTerminalProfileNameUTF8(name, names)
		}
		request := domain.SaveTerminalProfileRequest{
			Name:                name,
			FontFamily:          profile.FontFamily,
			FontSize:            profile.FontSize,
			LineHeight:          profile.LineHeight,
			LetterSpacing:       profile.LetterSpacing,
			CursorStyle:         profile.CursorStyle,
			CursorBlink:         profile.CursorBlink,
			Scrollback:          profile.Scrollback,
			ThemeName:           profile.ThemeName,
			Foreground:          profile.Foreground,
			Background:          profile.Background,
			SelectionBackground: profile.SelectionBackground,
			CursorColor:         profile.CursorColor,
		}
		request = domain.NormalizeTerminalProfileRequest(request)
		if err := domain.ValidateTerminalProfile(request); err != nil {
			return nil, err
		}
		id, err := generateTerminalProfileID()
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO terminal_profiles(
id, name, font_family, font_size, line_height, letter_spacing,
cursor_style, cursor_blink, scrollback, theme_name,
foreground, background, selection_background, cursor_color, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, request.Name, request.FontFamily, request.FontSize, request.LineHeight,
			request.LetterSpacing, request.CursorStyle, request.CursorBlink, request.Scrollback,
			request.ThemeName, request.Foreground, request.Background, request.SelectionBackground,
			request.CursorColor, backupTimestamp(profile.CreatedAt), backupTimestamp(profile.UpdatedAt),
		)
		if err != nil {
			return nil, err
		}
		values[profile.ID] = id
		names[strings.ToLower(request.Name)] = true
	}
	return values, nil
}

func terminalProfileNameSetTx(ctx context.Context, tx *sql.Tx) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, "SELECT name FROM terminal_profiles")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNameSet(rows, true)
}

func nextImportedTerminalProfileName(base string, names map[string]bool) string {
	for index := 1; index < 1000; index++ {
		name := fmt.Sprintf("%s (导入 %d)", base, index)
		if !names[strings.ToLower(name)] {
			return name
		}
	}
	return fmt.Sprintf("%s (导入)", base)
}

func nextImportedTerminalProfileNameUTF8(base string, names map[string]bool) string {
	for index := 1; index < 1000; index++ {
		name := fmt.Sprintf("%s (导入 %d)", base, index)
		if !names[strings.ToLower(name)] {
			return name
		}
	}
	return fmt.Sprintf("%s (导入)", base)
}

func scanNameSet(rows *sql.Rows, fold bool) (map[string]bool, error) {
	values := map[string]bool{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		if fold {
			value = strings.ToLower(value)
		}
		values[value] = true
	}
	return values, rows.Err()
}

func insertGroupTx(ctx context.Context, tx *sql.Tx, name string) (int64, error) {
	result, err := tx.ExecContext(ctx, "INSERT INTO groups(name) VALUES(?)", name)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func insertKeyVaultTx(
	ctx context.Context,
	tx *sql.Tx,
	key domain.BackupKeyVaultEntry,
	name string,
	protectedBlob []byte,
) (int64, error) {
	if protectedBlob == nil {
		protectedBlob = []byte{}
	}
	now := backupTimestamp(key.UpdatedAt)
	result, err := tx.ExecContext(ctx, `INSERT INTO key_vault_entries(
name, private_key_path, storage_mode, source_file_name, algorithm, key_bits,
public_key_fingerprint_sha256, encrypted, requires_passphrase, protected_key_blob,
protection_version, passphrase_credential_ref, passphrase_saved, notes, created_at, updated_at, last_used_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', 0, ?, ?, ?, ?)`,
		name, backupKeyVaultInternalPath(key), string(domain.KeyVaultStorageEncryptedDatabase),
		key.SourceFileName, key.Algorithm, key.KeyBits, key.PublicKeyFingerprintSHA256,
		key.Encrypted, key.Encrypted, protectedBlob, key.Notes, backupTimestamp(key.CreatedAt), now, key.LastUsedAt,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func backupKeyVaultInternalPath(key domain.BackupKeyVaultEntry) string {
	fingerprint := strings.TrimSpace(key.PublicKeyFingerprintSHA256)
	if fingerprint != "" {
		return keyVaultInternalPath(fingerprint)
	}
	return fmt.Sprintf("vault:backup:%d", key.ID)
}

func upsertConnectionTx(
	ctx context.Context,
	tx *sql.Tx,
	connection domain.BackupConnection,
	groupID *int64,
	keyVaultID *int64,
	terminalProfileID *string,
	hostKeyFingerprint string,
) (int64, bool, bool, error) {
	privateKeySource := connection.PrivateKeySource
	if privateKeySource == "" {
		privateKeySource = domain.PrivateKeySourceLocalFile
	}
	privateKeyPath := connection.PrivateKeyPath
	if connection.AuthType != domain.AuthPrivateKey || privateKeySource == domain.PrivateKeySourceKeyVault {
		privateKeyPath = ""
	}
	var keyValue any
	if connection.AuthType == domain.AuthPrivateKey && privateKeySource == domain.PrivateKeySourceKeyVault {
		if keyVaultID != nil {
			keyValue = *keyVaultID
		}
	}
	networkMode, selectedNetworkInterface := normalizeNetworkInterfacePreference(
		connection.NetworkInterfaceMode,
		connection.SelectedNetworkInterface,
	)
	if selectedNetworkInterface != "" && !safeInterfaceName(selectedNetworkInterface) {
		selectedNetworkInterface = ""
		networkMode = domain.MonitorNetworkInterfaceAll
	}
	connectionMode := backupConnectionMode(connection.ConnectionMode)
	displayName, err := domain.NormalizeServerDisplayName(connection.Name, connection.Host, connection.Port)
	if err != nil {
		return 0, false, false, err
	}

	now := backupTimestamp(connection.UpdatedAt)
	var existingID int64
	var existingFingerprint string
	err = tx.QueryRowContext(ctx, `
SELECT id, host_key_fingerprint FROM connections
WHERE lower(host)=lower(?) AND port=? AND username=?
ORDER BY id LIMIT 1`,
		connection.Host, connection.Port, connection.Username,
	).Scan(&existingID, &existingFingerprint)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, false, false, err
	}
	if err == nil {
		fingerprint := existingFingerprint
		hostTrustImported := false
		if hostKeyFingerprint != "" {
			fingerprint = hostKeyFingerprint
			hostTrustImported = true
		}
		result, err := tx.ExecContext(ctx, `UPDATE connections SET
group_id=?, name=?, host=?, port=?, username=?, auth_type=?, private_key_source=?,
private_key_path=?, key_vault_id=?, terminal_profile_id=?, host_key_fingerprint=?, refresh_interval=?,
network_interface_mode=?, selected_network_interface=?, network_interface_user_selected=?,
sort_order=?,
connection_mode=?, jump_server_id=NULL, updated_at=?
WHERE id=?`,
			groupID, displayName, connection.Host, connection.Port, connection.Username,
			connection.AuthType, privateKeySource, privateKeyPath, keyValue, terminalProfileID, fingerprint,
			connection.RefreshInterval, networkMode, selectedNetworkInterface,
			connection.NetworkInterfaceUserSelected, connection.SortOrder, connectionMode, now, existingID,
		)
		if err != nil {
			return 0, false, false, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return 0, false, false, err
		}
		if affected == 0 {
			return 0, false, false, fmt.Errorf("connection %d not found during backup import", existingID)
		}
		return existingID, false, hostTrustImported, nil
	}

	result, err := tx.ExecContext(ctx, `INSERT INTO connections(
group_id, name, host, port, username, auth_type, private_key_source, private_key_path,
key_vault_id, terminal_profile_id, host_key_fingerprint, refresh_interval,
network_interface_mode, selected_network_interface, network_interface_user_selected,
sort_order, connection_mode, jump_server_id, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
		groupID, displayName, connection.Host, connection.Port, connection.Username,
		connection.AuthType, privateKeySource, privateKeyPath, keyValue, terminalProfileID, hostKeyFingerprint,
		connection.RefreshInterval, networkMode, selectedNetworkInterface,
		connection.NetworkInterfaceUserSelected, connection.SortOrder, connectionMode, backupTimestamp(connection.CreatedAt), now,
	)
	if err != nil {
		return 0, false, false, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, false, false, err
	}
	return id, true, hostKeyFingerprint != "", nil
}

func restoreBackupJumpRoutesTx(
	ctx context.Context,
	tx *sql.Tx,
	connections []domain.BackupConnection,
	connectionMap map[int64]int64,
	result *domain.BackupImportPayloadResult,
) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, connection := range connections {
		if backupConnectionMode(connection.ConnectionMode) != domain.ConnectionModeJump {
			continue
		}
		targetID, ok := connectionMap[connection.ID]
		if !ok {
			continue
		}
		var mappedJump any
		if connection.JumpServerID != nil {
			if id, ok := connectionMap[*connection.JumpServerID]; ok && id != targetID {
				mappedJump = id
			}
		}
		if mappedJump == nil {
			result.Warnings = append(result.Warnings, domain.BackupWarning{
				Code:    "CONNECTION_JUMP_SERVER_RESELECT_REQUIRED",
				Message: fmt.Sprintf("服务器“%s”配置的跳板机未在本次导入中找到，导入后需要重新选择跳板机。", connection.Name),
			})
		}
		res, err := tx.ExecContext(ctx, `
UPDATE connections
SET connection_mode='jump', jump_server_id=?, updated_at=?
WHERE id=?`, mappedJump, now, targetID)
		if err != nil {
			return err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return fmt.Errorf("connection %d not found while restoring jump route", targetID)
		}
	}
	return nil
}

func backupConnectionMode(value domain.ConnectionMode) domain.ConnectionMode {
	if value == domain.ConnectionModeJump {
		return domain.ConnectionModeJump
	}
	return domain.ConnectionModeDirect
}

func upsertTunnelProfileTx(
	ctx context.Context,
	tx *sql.Tx,
	profile domain.BackupTunnelProfile,
	serverID int64,
) error {
	name := backupName(profile.Name)
	now := backupTimestamp(profile.UpdatedAt)
	var existingID int64
	err := tx.QueryRowContext(ctx, `
SELECT id FROM tunnel_profiles
WHERE server_id=? AND lower(name)=lower(?)
ORDER BY id LIMIT 1`, serverID, name).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE tunnel_profiles SET
type=?, bind_host=?, bind_port=?, target_host=?, target_port=?,
remote_bind_host=?, remote_bind_port=?, auto_start=?, updated_at=?
WHERE id=?`,
			profile.Type, profile.BindHost, profile.BindPort, profile.TargetHost, profile.TargetPort,
			profile.RemoteBindHost, profile.RemoteBindPort, profile.AutoStart, now, existingID,
		)
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO tunnel_profiles(
name, server_id, type, bind_host, bind_port, target_host, target_port,
remote_bind_host, remote_bind_port, auto_start, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		name, serverID, profile.Type, profile.BindHost, profile.BindPort,
		profile.TargetHost, profile.TargetPort, profile.RemoteBindHost, profile.RemoteBindPort,
		profile.AutoStart, backupTimestamp(profile.CreatedAt), now,
	)
	return err
}

func backupTimestamp(value string) string {
	if value != "" {
		return value
	}
	return time.Now().UTC().Format(time.RFC3339Nano)
}
