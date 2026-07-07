package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"serverpilot/internal/domain"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;"); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);`); err != nil {
		return err
	}
	migrations := []struct {
		version int
		sql     string
	}{
		{version: 1, sql: `
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    private_key_path TEXT NOT NULL DEFAULT '',
    host_key_fingerprint TEXT NOT NULL DEFAULT '',
    refresh_interval INTEGER NOT NULL DEFAULT 2,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credential_refs (
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    reference TEXT NOT NULL,
    PRIMARY KEY(connection_id, kind)
);`},
		{version: 2, sql: `
CREATE TABLE IF NOT EXISTS app_settings (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    default_remember_password INTEGER NOT NULL,
    default_remember_passphrase INTEGER NOT NULL,
    host_key_policy TEXT NOT NULL,
    connection_timeout_seconds INTEGER NOT NULL,
    settings_version INTEGER NOT NULL,
    onboarding_completed INTEGER NOT NULL,
    trust_on_first_use_acknowledged INTEGER NOT NULL
);
INSERT OR IGNORE INTO app_settings(
    singleton, default_remember_password, default_remember_passphrase,
    host_key_policy, connection_timeout_seconds, settings_version, onboarding_completed,
    trust_on_first_use_acknowledged
) VALUES(1, 0, 0, 'auto_update', 15, 1, 1, 0);`},
		{version: 3, sql: `
ALTER TABLE app_settings ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'dark';
UPDATE app_settings SET settings_version=2 WHERE singleton=1;`},
		{version: 4, sql: `
ALTER TABLE app_settings ADD COLUMN ui_font_size TEXT NOT NULL DEFAULT 'large';
ALTER TABLE app_settings ADD COLUMN window_width INTEGER NOT NULL DEFAULT 1360;
ALTER TABLE app_settings ADD COLUMN window_height INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE app_settings ADD COLUMN window_maximized INTEGER NOT NULL DEFAULT 0;
UPDATE app_settings SET settings_version=3 WHERE singleton=1;`},
		{version: 5, sql: `
CREATE TABLE IF NOT EXISTS key_vault_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    private_key_path TEXT NOT NULL UNIQUE,
    algorithm TEXT NOT NULL,
    public_key_fingerprint_sha256 TEXT NOT NULL,
    encrypted INTEGER NOT NULL,
    passphrase_credential_ref TEXT NOT NULL DEFAULT '',
    passphrase_saved INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT ''
);
ALTER TABLE connections ADD COLUMN private_key_source TEXT NOT NULL DEFAULT 'local_file';
ALTER TABLE connections ADD COLUMN key_vault_id INTEGER REFERENCES key_vault_entries(id) ON DELETE RESTRICT;`},
		{version: 6, sql: `
CREATE TABLE IF NOT EXISTS command_history (
    id TEXT PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'terminal',
    executed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_history_server_executed
    ON command_history(server_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_history_hash
    ON command_history(command_hash);
CREATE TABLE IF NOT EXISTS command_favorites (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    command TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL,
    server_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    tags TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_command_favorites_scope
    ON command_favorites(scope);
CREATE INDEX IF NOT EXISTS idx_command_favorites_server
    ON command_favorites(server_id);
CREATE INDEX IF NOT EXISTS idx_command_favorites_group
    ON command_favorites(group_id);
CREATE INDEX IF NOT EXISTS idx_command_favorites_updated
    ON command_favorites(updated_at DESC);`},
		{version: 7, sql: `
ALTER TABLE app_settings ADD COLUMN local_terminal_shell_preference TEXT NOT NULL DEFAULT 'auto';
UPDATE app_settings SET settings_version=4 WHERE singleton=1;`},
		{version: 8, sql: `
ALTER TABLE app_settings ADD COLUMN terminal_copy_on_select_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN terminal_right_click_paste_enabled INTEGER NOT NULL DEFAULT 1;
UPDATE app_settings SET settings_version=5 WHERE singleton=1;`},
		{version: 9, sql: `
CREATE TABLE IF NOT EXISTS tunnel_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    server_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    bind_host TEXT NOT NULL,
    bind_port INTEGER NOT NULL,
    target_host TEXT NOT NULL DEFAULT '',
    target_port INTEGER NOT NULL DEFAULT 0,
    remote_bind_host TEXT NOT NULL DEFAULT '',
    remote_bind_port INTEGER NOT NULL DEFAULT 0,
    auto_start INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tunnel_profiles_server
    ON tunnel_profiles(server_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tunnel_profiles_server_name
    ON tunnel_profiles(server_id, lower(name));`},
		{version: 10, sql: `
ALTER TABLE app_settings ADD COLUMN local_terminal_elevated_enabled INTEGER NOT NULL DEFAULT 0;
UPDATE app_settings SET settings_version=6 WHERE singleton=1;`},
		{version: 11, sql: `
CREATE TABLE IF NOT EXISTS terminal_profiles (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_profiles_name_lower
    ON terminal_profiles(lower(name));
INSERT OR IGNORE INTO terminal_profiles(
    id, name, font_family, font_size, line_height, letter_spacing,
    cursor_style, cursor_blink, scrollback, theme_name,
    foreground, background, selection_background, cursor_color, created_at, updated_at
) VALUES(
    'default', '默认', 'Consolas, Cascadia Mono, monospace', 15, 1.2, 0,
    'block', 1, 10000, 'serverpilot-dark',
    '#dbeafe', '#07111f', '#2563eb66', '#ffffff',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
ALTER TABLE app_settings ADD COLUMN default_terminal_profile_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE connections ADD COLUMN terminal_profile_id TEXT REFERENCES terminal_profiles(id) ON DELETE RESTRICT;
UPDATE terminal_profiles SET name='默认' WHERE id='default';
UPDATE app_settings SET default_terminal_profile_id='default', settings_version=7 WHERE singleton=1;`},
		{version: 12, sql: `
ALTER TABLE app_settings ADD COLUMN command_history_max_entries INTEGER NOT NULL DEFAULT 2000;
UPDATE app_settings SET command_history_max_entries=2000, settings_version=8 WHERE singleton=1;`},
		{version: 13, sql: `
ALTER TABLE connections ADD COLUMN network_interface_mode TEXT NOT NULL DEFAULT 'all';
ALTER TABLE connections ADD COLUMN selected_network_interface TEXT NOT NULL DEFAULT '';`},
		{version: 14, sql: `
ALTER TABLE connections ADD COLUMN network_interface_user_selected INTEGER NOT NULL DEFAULT 0;
UPDATE connections
SET network_interface_user_selected=1
WHERE network_interface_mode='interface' AND selected_network_interface<>'';`},
		{version: 15, sql: `
ALTER TABLE app_settings ADD COLUMN ssh_keepalive_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN ssh_keepalive_interval_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE app_settings ADD COLUMN ssh_keepalive_timeout_seconds INTEGER NOT NULL DEFAULT 10;
ALTER TABLE app_settings ADD COLUMN ssh_keepalive_max_failures INTEGER NOT NULL DEFAULT 3;
UPDATE app_settings SET settings_version=9 WHERE singleton=1;`},
		{version: 16, sql: `
ALTER TABLE app_settings ADD COLUMN dashboard_sort_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE app_settings ADD COLUMN dashboard_manual_server_order TEXT NOT NULL DEFAULT '[]';
UPDATE app_settings SET settings_version=10 WHERE singleton=1;`},
		{version: 17, sql: `
CREATE TABLE IF NOT EXISTS command_history_batch_entries (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'batch',
    submission_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS command_history_batch_targets (
    history_id TEXT NOT NULL REFERENCES command_history_batch_entries(id) ON DELETE CASCADE,
    server_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    PRIMARY KEY(history_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_command_history_batch_entries_created
    ON command_history_batch_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_history_batch_targets_server
    ON command_history_batch_targets(server_id);
CREATE INDEX IF NOT EXISTS idx_command_history_batch_targets_history
    ON command_history_batch_targets(history_id);`},
		{version: 18, sql: `
ALTER TABLE app_settings ADD COLUMN alert_settings TEXT NOT NULL DEFAULT '';
UPDATE app_settings SET settings_version=11 WHERE singleton=1;`},
		{version: 19, sql: `
CREATE TABLE IF NOT EXISTS alert_history (
    event_id TEXT PRIMARY KEY,
    server_id INTEGER NOT NULL,
    server_name_snapshot TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    state TEXT NOT NULL,
    source TEXT NOT NULL,
    current_value REAL,
    threshold_value REAL,
    unit TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    started_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT '',
    read_at TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    ended_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_history_state_started
    ON alert_history(state, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_server_started
    ON alert_history(server_id, started_at DESC);
CREATE TABLE IF NOT EXISTS window_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    monitor_id TEXT NOT NULL DEFAULT '',
    is_maximized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
UPDATE app_settings SET settings_version=12 WHERE singleton=1;`},
		{version: 20, sql: `
ALTER TABLE key_vault_entries ADD COLUMN protected_key_blob BLOB NOT NULL DEFAULT X'';
ALTER TABLE key_vault_entries ADD COLUMN protection_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE key_vault_entries ADD COLUMN source_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE key_vault_entries ADD COLUMN requires_passphrase INTEGER NOT NULL DEFAULT 0;
ALTER TABLE key_vault_entries ADD COLUMN legacy_file_path TEXT NOT NULL DEFAULT '';
ALTER TABLE key_vault_entries ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'legacy_file_path';
ALTER TABLE key_vault_entries ADD COLUMN key_bits INTEGER NOT NULL DEFAULT 0;
UPDATE key_vault_entries
SET legacy_file_path=private_key_path,
    requires_passphrase=encrypted,
    storage_mode='legacy_file_path'
WHERE storage_mode='' OR storage_mode='legacy_file_path';
CREATE INDEX IF NOT EXISTS idx_key_vault_fingerprint
    ON key_vault_entries(public_key_fingerprint_sha256);`},
		{version: 21, sql: `
ALTER TABLE connections ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE connections ADD COLUMN jump_server_id INTEGER REFERENCES connections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_connections_jump_server
    ON connections(jump_server_id);`},
		{version: 22, sql: `
ALTER TABLE app_settings ADD COLUMN shortcut_settings TEXT NOT NULL DEFAULT '';
UPDATE app_settings SET settings_version=13 WHERE singleton=1;`},
		{version: 23, sql: `
ALTER TABLE connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE connections SET sort_order=id * 1000 WHERE sort_order=0;
CREATE INDEX IF NOT EXISTS idx_connections_group_sort
    ON connections(group_id, sort_order, id);`},
		{version: 24, sql: `
ALTER TABLE app_settings ADD COLUMN backup_import_options TEXT NOT NULL DEFAULT '{"importSettings":true,"importGroups":true,"importServers":true,"importKeyVault":true,"importHostTrust":true}';
UPDATE app_settings
SET backup_import_options='{"importSettings":true,"importGroups":true,"importServers":true,"importKeyVault":true,"importHostTrust":true}',
    settings_version=15
WHERE singleton=1;`},
		{version: 25, sql: `
UPDATE terminal_profiles
SET font_size=13,
    foreground='#d7dde5',
    background='#15171a',
    selection_background='#5b8cff47',
    cursor_color='#dce6f2',
    updated_at=CURRENT_TIMESTAMP
WHERE id='default'
  AND font_family='Consolas, Cascadia Mono, monospace'
  AND font_size=15
  AND line_height=1.2
  AND letter_spacing=0
  AND cursor_style='block'
  AND cursor_blink=1
  AND scrollback=10000
  AND theme_name='serverpilot-dark'
  AND foreground='#dbeafe'
  AND background='#07111f'
  AND selection_background='#2563eb66'
  AND cursor_color='#ffffff';`},
	}
	for _, migration := range migrations {
		var exists int
		err := s.db.QueryRowContext(
			ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?)",
			migration.version,
		).Scan(&exists)
		if err != nil {
			return err
		}
		if exists != 0 {
			continue
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, migration.sql); err == nil {
			_, err = tx.ExecContext(
				ctx,
				"INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
				migration.version,
				time.Now().UTC().Format(time.RFC3339Nano),
			)
		}
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply database migration %d: %w", migration.version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit database migration %d: %w", migration.version, err)
		}
	}
	return nil
}

func (s *Store) GetSettings(ctx context.Context) (domain.AppSettings, error) {
	var value domain.AppSettings
	var dashboardManualServerOrder string
	var alertSettings string
	var shortcutSettings string
	var backupImportOptions string
	err := s.db.QueryRowContext(ctx, `
SELECT default_remember_password, default_remember_passphrase, host_key_policy,
theme_mode, ui_font_size, local_terminal_shell_preference, local_terminal_elevated_enabled, default_terminal_profile_id, command_history_max_entries, connection_timeout_seconds,
terminal_copy_on_select_enabled, terminal_right_click_paste_enabled,
ssh_keepalive_enabled, ssh_keepalive_interval_seconds, ssh_keepalive_timeout_seconds, ssh_keepalive_max_failures,
dashboard_sort_mode, dashboard_manual_server_order, alert_settings, shortcut_settings, backup_import_options,
window_width, window_height, window_maximized,
settings_version, onboarding_completed, trust_on_first_use_acknowledged
FROM app_settings WHERE singleton=1`,
	).Scan(
		&value.DefaultRememberPassword,
		&value.DefaultRememberPassphrase,
		&value.HostKeyPolicy,
		&value.ThemeMode,
		&value.UIFontSize,
		&value.LocalTerminalShellPreference,
		&value.LocalTerminalElevatedEnabled,
		&value.DefaultTerminalProfileID,
		&value.CommandHistoryMaxEntries,
		&value.ConnectionTimeoutSeconds,
		&value.TerminalCopyOnSelectEnabled,
		&value.TerminalRightClickPasteEnabled,
		&value.SSHKeepaliveEnabled,
		&value.SSHKeepaliveIntervalSeconds,
		&value.SSHKeepaliveTimeoutSeconds,
		&value.SSHKeepaliveMaxFailures,
		&value.DashboardSortMode,
		&dashboardManualServerOrder,
		&alertSettings,
		&shortcutSettings,
		&backupImportOptions,
		&value.WindowWidth,
		&value.WindowHeight,
		&value.WindowMaximized,
		&value.SettingsVersion,
		&value.OnboardingCompleted,
		&value.TrustOnFirstUseAcknowledged,
	)
	if err != nil {
		return value, err
	}
	sourceSettingsVersion := value.SettingsVersion
	value.Shortcuts, err = parseShortcutSettings(shortcutSettings)
	if err != nil {
		return value, err
	}
	value.Shortcuts = normalizeShortcutSettings(value.Shortcuts, value.TerminalCopyOnSelectEnabled, value.TerminalRightClickPasteEnabled, sourceSettingsVersion)
	value.TerminalCopyOnSelectEnabled = value.Shortcuts.TerminalCopyOnSelectEnabled
	value.TerminalRightClickPasteEnabled = value.Shortcuts.TerminalRightClickAction == domain.TerminalRightClickPaste
	value.SettingsVersion = domain.CurrentSettingsVersion
	value.DashboardManualServerOrder, err = parseDashboardManualServerOrder(dashboardManualServerOrder)
	if err != nil {
		return value, err
	}
	value.Alerts, err = parseAlertSettings(alertSettings)
	if err != nil {
		return value, err
	}
	value.BackupImportOptions, err = parseBackupImportOptions(backupImportOptions, sourceSettingsVersion)
	return value, err
}

func (s *Store) SaveSettings(ctx context.Context, value domain.AppSettings) error {
	dashboardManualServerOrder, err := dashboardManualServerOrderJSON(value.DashboardManualServerOrder)
	if err != nil {
		return err
	}
	alertSettings, err := alertSettingsJSON(value.Alerts)
	if err != nil {
		return err
	}
	shortcutSettings, err := shortcutSettingsJSON(value.Shortcuts)
	if err != nil {
		return err
	}
	backupImportOptions, err := backupImportOptionsJSON(value.BackupImportOptions)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `
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
		value.DefaultRememberPassword,
		value.DefaultRememberPassphrase,
		value.HostKeyPolicy,
		value.ThemeMode,
		value.UIFontSize,
		value.LocalTerminalShellPreference,
		value.LocalTerminalElevatedEnabled,
		value.DefaultTerminalProfileID,
		value.CommandHistoryMaxEntries,
		value.ConnectionTimeoutSeconds,
		value.TerminalCopyOnSelectEnabled,
		value.TerminalRightClickPasteEnabled,
		value.SSHKeepaliveEnabled,
		value.SSHKeepaliveIntervalSeconds,
		value.SSHKeepaliveTimeoutSeconds,
		value.SSHKeepaliveMaxFailures,
		value.DashboardSortMode,
		dashboardManualServerOrder,
		alertSettings,
		shortcutSettings,
		backupImportOptions,
		value.WindowWidth,
		value.WindowHeight,
		value.WindowMaximized,
		value.SettingsVersion,
		value.OnboardingCompleted,
		value.TrustOnFirstUseAcknowledged,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return errors.New("application settings row is missing")
	}
	return nil
}

func parseAlertSettings(value string) (domain.AlertSettings, error) {
	if strings.TrimSpace(value) == "" {
		return domain.DefaultAlertSettings(), nil
	}
	var settings domain.AlertSettings
	if err := json.Unmarshal([]byte(value), &settings); err != nil {
		return domain.AlertSettings{}, err
	}
	return settings, nil
}

func alertSettingsJSON(settings domain.AlertSettings) (string, error) {
	data, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func parseShortcutSettings(value string) (domain.ShortcutSettings, error) {
	if strings.TrimSpace(value) == "" {
		return domain.ShortcutSettings{}, nil
	}
	var settings domain.ShortcutSettings
	if err := json.Unmarshal([]byte(value), &settings); err != nil {
		return domain.ShortcutSettings{}, err
	}
	return settings, nil
}

func shortcutSettingsJSON(settings domain.ShortcutSettings) (string, error) {
	data, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func parseBackupImportOptions(value string, settingsVersion int) (domain.BackupImportOptions, error) {
	settings := domain.DefaultBackupImportOptionPreferences()
	if settingsVersion < 15 || strings.TrimSpace(value) == "" {
		return settings, nil
	}
	if err := json.Unmarshal([]byte(value), &settings); err != nil {
		return domain.BackupImportOptions{}, err
	}
	return settings, nil
}

func backupImportOptionsJSON(settings domain.BackupImportOptions) (string, error) {
	data, err := json.Marshal(settings)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func parseDashboardManualServerOrder(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return []string{}, nil
	}
	var order []string
	if err := json.Unmarshal([]byte(value), &order); err != nil {
		return nil, err
	}
	if order == nil {
		return []string{}, nil
	}
	return order, nil
}

func dashboardManualServerOrderJSON(order []string) (string, error) {
	if order == nil {
		order = []string{}
	}
	encoded, err := json.Marshal(order)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func (s *Store) MigrationVersion(ctx context.Context) (int, error) {
	var version int
	err := s.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version)
	return version, err
}

func (s *Store) ListGroups(ctx context.Context) ([]domain.Group, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, name FROM groups ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []domain.Group
	for rows.Next() {
		var group domain.Group
		if err := rows.Scan(&group.ID, &group.Name); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func (s *Store) SaveGroup(ctx context.Context, group domain.Group) (domain.Group, error) {
	if group.Name == "" {
		return domain.Group{}, errors.New("group name is required")
	}
	if group.ID == 0 {
		result, err := s.db.ExecContext(ctx, "INSERT INTO groups(name) VALUES(?)", group.Name)
		if err != nil {
			return domain.Group{}, err
		}
		group.ID, err = result.LastInsertId()
		return group, err
	}
	_, err := s.db.ExecContext(ctx, "UPDATE groups SET name=? WHERE id=?", group.Name, group.ID)
	return group, err
}

func (s *Store) DeleteGroup(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM groups WHERE id=?", id)
	return err
}

func (s *Store) ListConnections(ctx context.Context) ([]domain.Connection, error) {
	const query = `SELECT c.id, c.group_id, c.sort_order, c.name, c.host, c.port, c.username, c.auth_type,
c.private_key_source, c.private_key_path, c.key_vault_id, c.terminal_profile_id, c.connection_mode, c.jump_server_id, c.host_key_fingerprint,
CASE
WHEN c.auth_type='private_key' AND c.private_key_source='key_vault'
THEN COALESCE((SELECT k.passphrase_saved FROM key_vault_entries k WHERE k.id=c.key_vault_id), 0)
ELSE EXISTS(SELECT 1 FROM credential_refs r WHERE r.connection_id=c.id AND r.kind=
CASE WHEN c.auth_type='password' THEN 'password' ELSE 'passphrase' END)
END,
EXISTS(SELECT 1 FROM credential_refs r WHERE r.connection_id=c.id AND r.kind='password'),
c.refresh_interval, c.network_interface_mode, c.selected_network_interface, c.network_interface_user_selected, c.created_at, c.updated_at
FROM connections c
ORDER BY CASE WHEN c.group_id IS NULL THEN 1 ELSE 0 END,
COALESCE(c.group_id, 0), c.sort_order, c.name COLLATE NOCASE, c.id`
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var connections []domain.Connection
	for rows.Next() {
		connection, err := scanConnection(rows)
		if err != nil {
			return nil, err
		}
		connections = append(connections, connection)
	}
	return connections, rows.Err()
}

func (s *Store) GetConnection(ctx context.Context, id int64) (domain.Connection, error) {
	const query = `SELECT c.id, c.group_id, c.sort_order, c.name, c.host, c.port, c.username, c.auth_type,
c.private_key_source, c.private_key_path, c.key_vault_id, c.terminal_profile_id, c.connection_mode, c.jump_server_id, c.host_key_fingerprint,
CASE
WHEN c.auth_type='private_key' AND c.private_key_source='key_vault'
THEN COALESCE((SELECT k.passphrase_saved FROM key_vault_entries k WHERE k.id=c.key_vault_id), 0)
ELSE EXISTS(SELECT 1 FROM credential_refs r WHERE r.connection_id=c.id AND r.kind=
CASE WHEN c.auth_type='password' THEN 'password' ELSE 'passphrase' END)
END,
EXISTS(SELECT 1 FROM credential_refs r WHERE r.connection_id=c.id AND r.kind='password'),
c.refresh_interval, c.network_interface_mode, c.selected_network_interface, c.network_interface_user_selected, c.created_at, c.updated_at
FROM connections c WHERE c.id=?`
	return scanConnection(s.db.QueryRowContext(ctx, query, id))
}

type scanner interface {
	Scan(dest ...any) error
}

func scanConnection(row scanner) (domain.Connection, error) {
	var connection domain.Connection
	var groupID sql.NullInt64
	var keyVaultID sql.NullInt64
	var terminalProfileID sql.NullString
	var jumpServerID sql.NullInt64
	var created, updated string
	err := row.Scan(
		&connection.ID, &groupID, &connection.SortOrder, &connection.Name, &connection.Host, &connection.Port,
		&connection.Username, &connection.AuthType, &connection.PrivateKeySource,
		&connection.PrivateKeyPath, &keyVaultID, &terminalProfileID, &connection.ConnectionMode, &jumpServerID,
		&connection.HostKeyFingerprint, &connection.CredentialSaved, &connection.PasswordCredentialSaved,
		&connection.RefreshInterval, &connection.NetworkInterfaceMode, &connection.SelectedNetworkInterface,
		&connection.NetworkInterfaceUserSelected, &created, &updated,
	)
	if err != nil {
		return domain.Connection{}, err
	}
	if groupID.Valid {
		connection.GroupID = &groupID.Int64
	}
	if connection.PrivateKeySource == "" {
		connection.PrivateKeySource = domain.PrivateKeySourceLocalFile
	}
	if keyVaultID.Valid {
		connection.KeyVaultID = &keyVaultID.Int64
	}
	if terminalProfileID.Valid && terminalProfileID.String != "" {
		connection.TerminalProfileID = &terminalProfileID.String
	}
	if connection.ConnectionMode != domain.ConnectionModeJump {
		connection.ConnectionMode = domain.ConnectionModeDirect
	}
	if jumpServerID.Valid && jumpServerID.Int64 > 0 {
		connection.JumpServerID = &jumpServerID.Int64
	}
	connection.NetworkInterfaceMode, connection.SelectedNetworkInterface = normalizeNetworkInterfacePreference(
		connection.NetworkInterfaceMode,
		connection.SelectedNetworkInterface,
	)
	connection.CreatedAt = created
	connection.UpdatedAt = updated
	return connection, nil
}

func normalizeNetworkInterfacePreference(
	mode domain.MonitorNetworkInterfaceMode,
	selected string,
) (domain.MonitorNetworkInterfaceMode, string) {
	selected = strings.TrimSpace(selected)
	switch mode {
	case domain.MonitorNetworkInterfaceSpecific:
		if selected == "" {
			return domain.MonitorNetworkInterfaceAll, ""
		}
		return domain.MonitorNetworkInterfaceSpecific, selected
	case domain.MonitorNetworkInterfacePhysical, domain.MonitorNetworkInterfaceDocker, domain.MonitorNetworkInterfaceAll:
		return mode, ""
	default:
		return domain.MonitorNetworkInterfaceAll, ""
	}
}

func safeInterfaceName(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			continue
		}
		switch r {
		case '_', '.', ':', '-':
			continue
		default:
			return false
		}
	}
	return true
}

func groupKey(groupID *int64) int64 {
	if groupID == nil || *groupID <= 0 {
		return 0
	}
	return *groupID
}

func sameGroupID(a *int64, b *int64) bool {
	return groupKey(a) == groupKey(b)
}

func (s *Store) nextConnectionSortOrder(ctx context.Context, groupID *int64) (int64, error) {
	var current sql.NullInt64
	err := s.db.QueryRowContext(
		ctx,
		"SELECT MAX(sort_order) FROM connections WHERE COALESCE(group_id, 0)=?",
		groupKey(groupID),
	).Scan(&current)
	if err != nil {
		return 0, err
	}
	if !current.Valid {
		return 1000, nil
	}
	return current.Int64 + 1000, nil
}

func validateTargetGroupTx(ctx context.Context, tx *sql.Tx, groupID *int64) error {
	if groupID == nil || *groupID <= 0 {
		return nil
	}
	var exists int
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM groups WHERE id=?)", *groupID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return fmt.Errorf("group %d not found", *groupID)
	}
	return nil
}

func connectionIDsForGroupTx(ctx context.Context, tx *sql.Tx, groupID *int64, excluding int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT id FROM connections
WHERE COALESCE(group_id, 0)=? AND id<>?
ORDER BY sort_order, name COLLATE NOCASE, id`, groupKey(groupID), excluding)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func insertConnectionID(ids []int64, moving int64, before *int64, after *int64) ([]int64, error) {
	index := len(ids)
	if before != nil && *before > 0 {
		found := false
		for candidateIndex, id := range ids {
			if id == *before {
				index = candidateIndex
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("target server %d not found in target group", *before)
		}
	} else if after != nil && *after > 0 {
		found := false
		for candidateIndex, id := range ids {
			if id == *after {
				index = candidateIndex + 1
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("target server %d not found in target group", *after)
		}
	}
	next := append([]int64{}, ids[:index]...)
	next = append(next, moving)
	next = append(next, ids[index:]...)
	return next, nil
}

func compactConnectionGroupTx(ctx context.Context, tx *sql.Tx, groupID *int64, orderedIDs []int64, now string) error {
	groupValue := any(nil)
	if groupID != nil && *groupID > 0 {
		groupValue = *groupID
	}
	for index, id := range orderedIDs {
		if _, err := tx.ExecContext(
			ctx,
			"UPDATE connections SET group_id=?, sort_order=?, updated_at=? WHERE id=?",
			groupValue,
			int64(index+1)*1000,
			now,
			id,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ReorderServers(ctx context.Context, request domain.ReorderServersRequest) ([]domain.Connection, error) {
	if request.ServerID <= 0 {
		return nil, errors.New("serverID is required")
	}
	if request.BeforeServerID != nil && *request.BeforeServerID == request.ServerID {
		request.BeforeServerID = nil
	}
	if request.AfterServerID != nil && *request.AfterServerID == request.ServerID {
		request.AfterServerID = nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var currentGroup sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT group_id FROM connections WHERE id=?", request.ServerID).Scan(&currentGroup); err != nil {
		return nil, err
	}
	var sourceGroupID *int64
	if currentGroup.Valid {
		sourceGroupID = &currentGroup.Int64
	}
	if request.SourceGroupID != nil && !sameGroupID(request.SourceGroupID, sourceGroupID) {
		return nil, fmt.Errorf("server %d is no longer in source group", request.ServerID)
	}
	if err := validateTargetGroupTx(ctx, tx, request.TargetGroupID); err != nil {
		return nil, err
	}

	targetIDs, err := connectionIDsForGroupTx(ctx, tx, request.TargetGroupID, request.ServerID)
	if err != nil {
		return nil, err
	}
	targetIDs, err = insertConnectionID(targetIDs, request.ServerID, request.BeforeServerID, request.AfterServerID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := compactConnectionGroupTx(ctx, tx, request.TargetGroupID, targetIDs, now); err != nil {
		return nil, err
	}
	if !sameGroupID(sourceGroupID, request.TargetGroupID) {
		sourceIDs, err := connectionIDsForGroupTx(ctx, tx, sourceGroupID, request.ServerID)
		if err != nil {
			return nil, err
		}
		if err := compactConnectionGroupTx(ctx, tx, sourceGroupID, sourceIDs, now); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.ListConnections(ctx)
}

func (s *Store) normalizeConnectionRoute(
	ctx context.Context,
	targetID int64,
	mode domain.ConnectionMode,
	jumpServerID *int64,
) (domain.ConnectionMode, any, error) {
	if mode == "" {
		mode = domain.ConnectionModeDirect
	}
	if mode == domain.ConnectionModeDirect {
		return domain.ConnectionModeDirect, nil, nil
	}
	if mode != domain.ConnectionModeJump {
		return "", nil, errors.New("连接路径无效")
	}
	if jumpServerID == nil || *jumpServerID <= 0 {
		return "", nil, errors.New("请选择跳板机")
	}
	if targetID > 0 && *jumpServerID == targetID {
		return "", nil, errors.New("目标服务器不能选择自己作为跳板机")
	}
	jump, err := s.GetConnection(ctx, *jumpServerID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil, errors.New("跳板机不存在")
		}
		return "", nil, err
	}
	if jump.ConnectionMode == domain.ConnectionModeJump {
		return "", nil, errors.New("本轮只支持一层跳板机，跳板机必须是直接连接服务器")
	}
	return domain.ConnectionModeJump, *jumpServerID, nil
}

func (s *Store) SaveConnection(ctx context.Context, request domain.SaveConnectionRequest) (domain.Connection, error) {
	if err := domain.ValidateConnection(request); err != nil {
		return domain.Connection{}, err
	}
	displayName, err := domain.NormalizeServerDisplayName(request.Name, request.Host, request.Port)
	if err != nil {
		return domain.Connection{}, err
	}
	request.Name = displayName
	now := time.Now().UTC().Format(time.RFC3339Nano)
	source := request.PrivateKeySource
	if source == "" {
		source = domain.PrivateKeySourceLocalFile
	}
	var keyVaultID any
	if request.AuthType == domain.AuthPrivateKey && source == domain.PrivateKeySourceKeyVault {
		keyVaultID = request.KeyVaultID
	} else {
		keyVaultID = nil
	}
	privateKeyPath := request.PrivateKeyPath
	if request.AuthType != domain.AuthPrivateKey || source == domain.PrivateKeySourceKeyVault {
		privateKeyPath = ""
	}
	terminalProfileID := normalizeTerminalProfileID(request.TerminalProfileID)
	if id, ok := terminalProfileID.(string); ok {
		if _, err := s.GetTerminalProfile(ctx, id); err != nil {
			return domain.Connection{}, err
		}
	}
	connectionMode, jumpServerID, err := s.normalizeConnectionRoute(ctx, request.ID, request.ConnectionMode, request.JumpServerID)
	if err != nil {
		return domain.Connection{}, err
	}
	if request.ID == 0 {
		sortOrder, err := s.nextConnectionSortOrder(ctx, request.GroupID)
		if err != nil {
			return domain.Connection{}, err
		}
		const query = `INSERT INTO connections(
group_id, name, host, port, username, auth_type, private_key_source, private_key_path, key_vault_id,
terminal_profile_id, connection_mode, jump_server_id, refresh_interval, sort_order, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		result, err := s.db.ExecContext(ctx, query, request.GroupID, request.Name, request.Host, request.Port,
			request.Username, request.AuthType, source, privateKeyPath, keyVaultID, terminalProfileID,
			connectionMode, jumpServerID, request.RefreshInterval, sortOrder, now, now)
		if err != nil {
			return domain.Connection{}, err
		}
		request.ID, err = result.LastInsertId()
		if err != nil {
			return domain.Connection{}, err
		}
	} else {
		existing, err := s.GetConnection(ctx, request.ID)
		if err != nil {
			return domain.Connection{}, err
		}
		hostKeyFingerprint := existing.HostKeyFingerprint
		if existing.Host != request.Host || existing.Port != request.Port {
			hostKeyFingerprint = ""
		}
		const query = `UPDATE connections SET group_id=?, name=?, host=?, port=?, username=?,
auth_type=?, private_key_source=?, private_key_path=?, key_vault_id=?, terminal_profile_id=?,
connection_mode=?, jump_server_id=?, host_key_fingerprint=?, refresh_interval=?, updated_at=? WHERE id=?`
		result, err := s.db.ExecContext(ctx, query, request.GroupID, request.Name, request.Host, request.Port,
			request.Username, request.AuthType, source, privateKeyPath, keyVaultID, terminalProfileID,
			connectionMode, jumpServerID, hostKeyFingerprint, request.RefreshInterval, now, request.ID)
		if err != nil {
			return domain.Connection{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return domain.Connection{}, err
		}
		if affected == 0 {
			return domain.Connection{}, fmt.Errorf("connection %d not found", request.ID)
		}
	}
	return s.GetConnection(ctx, request.ID)
}

func (s *Store) UpdateHostKey(ctx context.Context, id int64, fingerprint string) error {
	_, err := s.db.ExecContext(ctx,
		"UPDATE connections SET host_key_fingerprint=?, updated_at=? WHERE id=?",
		fingerprint, time.Now().UTC().Format(time.RFC3339Nano), id,
	)
	return err
}

func (s *Store) ClearHostKey(ctx context.Context, id int64) error {
	return s.UpdateHostKey(ctx, id, "")
}

func (s *Store) GetMonitorNetworkInterface(
	ctx context.Context,
	serverID int64,
) (domain.MonitorNetworkInterfacePreference, error) {
	var preference domain.MonitorNetworkInterfacePreference
	var mode domain.MonitorNetworkInterfaceMode
	var selected, updated string
	var userSelected bool
	err := s.db.QueryRowContext(
		ctx,
		"SELECT network_interface_mode, selected_network_interface, network_interface_user_selected, updated_at FROM connections WHERE id=?",
		serverID,
	).Scan(&mode, &selected, &userSelected, &updated)
	if err != nil {
		return preference, err
	}
	mode, selected = normalizeNetworkInterfacePreference(mode, selected)
	return domain.MonitorNetworkInterfacePreference{
		ServerID: serverID, Mode: mode, SelectedNetworkInterface: selected,
		UserSelected: userSelected, UpdatedAt: updated,
	}, nil
}

func (s *Store) SetMonitorNetworkInterface(
	ctx context.Context,
	request domain.SetMonitorNetworkInterfaceRequest,
) (domain.MonitorNetworkInterfacePreference, error) {
	mode, selected := normalizeNetworkInterfacePreference(request.Mode, request.SelectedNetworkInterface)
	if mode == domain.MonitorNetworkInterfaceSpecific && selected == "" {
		return domain.MonitorNetworkInterfacePreference{}, errors.New("selected network interface is required")
	}
	if selected != "" && !safeInterfaceName(selected) {
		return domain.MonitorNetworkInterfacePreference{}, errors.New("invalid network interface name")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE connections SET network_interface_mode=?, selected_network_interface=?, network_interface_user_selected=?, updated_at=? WHERE id=?`,
		mode,
		selected,
		request.UserSelected,
		now,
		request.ServerID,
	)
	if err != nil {
		return domain.MonitorNetworkInterfacePreference{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.MonitorNetworkInterfacePreference{}, err
	}
	if affected == 0 {
		return domain.MonitorNetworkInterfacePreference{}, fmt.Errorf("connection %d not found", request.ServerID)
	}
	return domain.MonitorNetworkInterfacePreference{
		ServerID: request.ServerID, Mode: mode, SelectedNetworkInterface: selected,
		UserSelected: request.UserSelected, UpdatedAt: now,
	}, nil
}

func (s *Store) SetCredentialRef(ctx context.Context, connectionID int64, kind, reference string) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO credential_refs(connection_id, kind, reference) VALUES(?, ?, ?)
ON CONFLICT(connection_id, kind) DO UPDATE SET reference=excluded.reference`,
		connectionID, kind, reference,
	)
	return err
}

func (s *Store) GetCredentialRef(ctx context.Context, connectionID int64, kind string) (string, error) {
	var reference string
	err := s.db.QueryRowContext(ctx,
		"SELECT reference FROM credential_refs WHERE connection_id=? AND kind=?",
		connectionID, kind,
	).Scan(&reference)
	return reference, err
}

func (s *Store) ListCredentialRefs(ctx context.Context, connectionID int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT reference FROM credential_refs WHERE connection_id=?", connectionID)
	if err != nil {
		return nil, err
	}
	var references []string
	for rows.Next() {
		var reference string
		if err := rows.Scan(&reference); err != nil {
			rows.Close()
			return nil, err
		}
		references = append(references, reference)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return references, nil
}

func (s *Store) DeleteCredentialRef(ctx context.Context, connectionID int64, kind string) (string, error) {
	reference, err := s.GetCredentialRef(ctx, connectionID, kind)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	if _, err := s.db.ExecContext(
		ctx,
		"DELETE FROM credential_refs WHERE connection_id=? AND kind=?",
		connectionID,
		kind,
	); err != nil {
		return "", err
	}
	return reference, nil
}

func (s *Store) DeleteCredentialRefs(ctx context.Context, connectionID int64) ([]string, error) {
	references, err := s.ListCredentialRefs(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx, "DELETE FROM credential_refs WHERE connection_id=?", connectionID); err != nil {
		return nil, err
	}
	return references, nil
}

func (s *Store) DeleteConnection(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `
UPDATE connections
SET jump_server_id=NULL, updated_at=?
WHERE connection_mode='jump' AND jump_server_id=?`, now, id); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM connections WHERE id=?", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) ListKeyVaultEntries(ctx context.Context) ([]domain.KeyVaultEntry, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT k.id, k.name, k.private_key_path, k.storage_mode, k.source_file_name, k.algorithm,
k.key_bits, k.public_key_fingerprint_sha256, k.encrypted, k.requires_passphrase,
k.protection_version, k.protected_key_blob, k.passphrase_credential_ref, k.passphrase_saved,
k.notes, k.created_at, k.updated_at, k.last_used_at,
(SELECT COUNT(*) FROM connections c
 WHERE c.auth_type='private_key' AND c.private_key_source='key_vault' AND c.key_vault_id=k.id)
FROM key_vault_entries k ORDER BY k.name COLLATE NOCASE, k.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]domain.KeyVaultEntry, 0)
	for rows.Next() {
		entry, err := scanKeyVaultEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) GetKeyVaultEntry(ctx context.Context, id int64) (domain.KeyVaultEntry, error) {
	return scanKeyVaultEntry(s.db.QueryRowContext(ctx, `
SELECT k.id, k.name, k.private_key_path, k.storage_mode, k.source_file_name, k.algorithm,
k.key_bits, k.public_key_fingerprint_sha256, k.encrypted, k.requires_passphrase,
k.protection_version, k.protected_key_blob, k.passphrase_credential_ref, k.passphrase_saved,
k.notes, k.created_at, k.updated_at, k.last_used_at,
(SELECT COUNT(*) FROM connections c
 WHERE c.auth_type='private_key' AND c.private_key_source='key_vault' AND c.key_vault_id=k.id)
FROM key_vault_entries k WHERE k.id=?`, id))
}

func (s *Store) GetKeyVaultEntryByFingerprint(
	ctx context.Context,
	fingerprint string,
) (domain.KeyVaultEntry, error) {
	return scanKeyVaultEntry(s.db.QueryRowContext(ctx, `
SELECT k.id, k.name, k.private_key_path, k.storage_mode, k.source_file_name, k.algorithm,
k.key_bits, k.public_key_fingerprint_sha256, k.encrypted, k.requires_passphrase,
k.protection_version, k.protected_key_blob, k.passphrase_credential_ref, k.passphrase_saved,
k.notes, k.created_at, k.updated_at, k.last_used_at,
(SELECT COUNT(*) FROM connections c
 WHERE c.auth_type='private_key' AND c.private_key_source='key_vault' AND c.key_vault_id=k.id)
FROM key_vault_entries k WHERE k.public_key_fingerprint_sha256=?
ORDER BY CASE WHEN k.storage_mode='encrypted_database' THEN 0 ELSE 1 END, k.id LIMIT 1`, fingerprint))
}

func (s *Store) CreateKeyVaultEntry(
	ctx context.Context,
	request domain.SaveKeyVaultEntryRequest,
	validation domain.PrivateKeyValidationResult,
) (domain.KeyVaultEntry, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `
INSERT INTO key_vault_entries(
name, private_key_path, algorithm, public_key_fingerprint_sha256, encrypted,
requires_passphrase, storage_mode, legacy_file_path, source_file_name, key_bits,
notes, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, 'legacy_file_path', ?, ?, ?, ?, ?, ?)`,
		request.Name, request.PrivateKeyPath, validation.Algorithm, validation.FingerprintSHA256,
		validation.Encrypted, validation.Encrypted, request.PrivateKeyPath,
		filepath.Base(request.PrivateKeyPath), validation.KeyBits, request.Notes, now, now,
	)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	return s.GetKeyVaultEntry(ctx, id)
}

func (s *Store) CreateEncryptedKeyVaultEntry(
	ctx context.Context,
	request domain.SaveKeyVaultEntryRequest,
	validation domain.PrivateKeyValidationResult,
	protectedBlob []byte,
	sourceFileName string,
) (domain.KeyVaultEntry, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `
INSERT INTO key_vault_entries(
name, private_key_path, storage_mode, source_file_name, algorithm, key_bits,
public_key_fingerprint_sha256, encrypted, requires_passphrase, protected_key_blob,
protection_version, passphrase_credential_ref, passphrase_saved, notes, created_at, updated_at
) VALUES(?, ?, 'encrypted_database', ?, ?, ?, ?, ?, ?, ?, 1, '', 0, ?, ?, ?)`,
		request.Name, keyVaultInternalPath(validation.FingerprintSHA256), sourceFileName,
		validation.Algorithm, validation.KeyBits, validation.FingerprintSHA256,
		validation.Encrypted, validation.Encrypted, protectedBlob, request.Notes, now, now,
	)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	return s.GetKeyVaultEntry(ctx, id)
}

func (s *Store) UpdateKeyVaultEntry(
	ctx context.Context,
	request domain.SaveKeyVaultEntryRequest,
	validation domain.PrivateKeyValidationResult,
) (domain.KeyVaultEntry, error) {
	existing, err := s.GetKeyVaultEntry(ctx, request.ID)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	algorithm := existing.Algorithm
	fingerprint := existing.PublicKeyFingerprintSHA256
	encrypted := existing.Encrypted
	keyBits := existing.KeyBits
	passphraseRef := existing.PassphraseCredentialRef
	passphraseSaved := existing.PassphraseSaved
	privateKeyPath := existing.PrivateKeyPath
	legacyFilePath := existing.PrivateKeyPath
	sourceFileName := existing.SourceFileName
	storageMode := existing.StorageMode
	requiresPassphrase := existing.RequiresPassphrase
	if validation.Valid {
		algorithm = validation.Algorithm
		fingerprint = validation.FingerprintSHA256
		encrypted = validation.Encrypted
		keyBits = validation.KeyBits
		requiresPassphrase = validation.Encrypted
		if request.PrivateKeyPath != existing.PrivateKeyPath && !request.UpdatePassphrase {
			passphraseRef = ""
			passphraseSaved = false
		}
		if normalizeKeyVaultStorageMode(existing.StorageMode) == domain.KeyVaultStorageLegacyFilePath {
			privateKeyPath = request.PrivateKeyPath
			legacyFilePath = request.PrivateKeyPath
			sourceFileName = filepath.Base(request.PrivateKeyPath)
			storageMode = string(domain.KeyVaultStorageLegacyFilePath)
		}
	}
	_, err = s.db.ExecContext(ctx, `
UPDATE key_vault_entries SET
name=?, private_key_path=?, storage_mode=?, source_file_name=?, legacy_file_path=?,
algorithm=?, key_bits=?, public_key_fingerprint_sha256=?, encrypted=?, requires_passphrase=?,
passphrase_credential_ref=?, passphrase_saved=?, notes=?, updated_at=?
WHERE id=?`,
		request.Name, privateKeyPath, storageMode, sourceFileName, legacyFilePath,
		algorithm, keyBits, fingerprint, encrypted, requiresPassphrase,
		passphraseRef, passphraseSaved, request.Notes, time.Now().UTC().Format(time.RFC3339Nano), request.ID,
	)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	return s.GetKeyVaultEntry(ctx, request.ID)
}

func (s *Store) UpdateKeyVaultProtectedMaterial(
	ctx context.Context,
	id int64,
	request domain.SaveKeyVaultEntryRequest,
	validation domain.PrivateKeyValidationResult,
	protectedBlob []byte,
	sourceFileName string,
) (domain.KeyVaultEntry, error) {
	existing, err := s.GetKeyVaultEntry(ctx, id)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE key_vault_entries SET
name=?, private_key_path=?, storage_mode='encrypted_database', source_file_name=?,
algorithm=?, key_bits=?, public_key_fingerprint_sha256=?, encrypted=?, requires_passphrase=?,
protected_key_blob=?, protection_version=1, notes=?, updated_at=?
WHERE id=?`,
		request.Name, keyVaultInternalPath(validation.FingerprintSHA256), sourceFileName,
		validation.Algorithm, validation.KeyBits, validation.FingerprintSHA256,
		validation.Encrypted, validation.Encrypted, protectedBlob, request.Notes,
		time.Now().UTC().Format(time.RFC3339Nano), existing.ID,
	)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	if affected == 0 {
		return domain.KeyVaultEntry{}, sql.ErrNoRows
	}
	return s.GetKeyVaultEntry(ctx, id)
}

func (s *Store) SetKeyVaultPassphraseRef(ctx context.Context, id int64, reference string) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE key_vault_entries SET passphrase_credential_ref=?, passphrase_saved=?, updated_at=? WHERE id=?`,
		reference, reference != "", time.Now().UTC().Format(time.RFC3339Nano), id,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpdateKeyVaultLastUsed(ctx context.Context, id int64, usedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, "UPDATE key_vault_entries SET last_used_at=? WHERE id=?",
		usedAt.UTC().Format(time.RFC3339Nano), id)
	return err
}

func (s *Store) ListKeyVaultUsage(ctx context.Context, id int64) ([]domain.KeyVaultUsage, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, name FROM connections
WHERE auth_type='private_key' AND private_key_source='key_vault' AND key_vault_id=?
ORDER BY name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usages := make([]domain.KeyVaultUsage, 0)
	for rows.Next() {
		var usage domain.KeyVaultUsage
		if err := rows.Scan(&usage.ConnectionID, &usage.ConnectionName); err != nil {
			return nil, err
		}
		usages = append(usages, usage)
	}
	return usages, rows.Err()
}

func (s *Store) DeleteKeyVaultEntry(ctx context.Context, id int64) error {
	result, err := s.DeleteKeyVaultEntryWithUnbind(ctx, domain.DeleteKeyVaultEntryRequest{ID: id})
	if err != nil {
		return err
	}
	if result.RequiresConfirmation {
		return errors.New("key vault entry is in use")
	}
	return nil
}

func (s *Store) DeleteKeyVaultEntryWithUnbind(
	ctx context.Context,
	request domain.DeleteKeyVaultEntryRequest,
) (domain.DeleteKeyVaultEntryResponse, error) {
	var response domain.DeleteKeyVaultEntryResponse
	if request.ID <= 0 {
		return response, sql.ErrNoRows
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return response, err
	}
	defer tx.Rollback()

	var existingID int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM key_vault_entries WHERE id=?", request.ID).Scan(&existingID); err != nil {
		return response, err
	}
	usages, err := listKeyVaultUsageTx(ctx, tx, request.ID)
	if err != nil {
		return response, err
	}
	response.UnboundServerCount = len(usages)
	response.UnboundServerNames = keyVaultUsageNames(usages)
	if len(usages) > 0 && !request.ForceUnbind {
		response.RequiresConfirmation = true
		return response, tx.Commit()
	}

	if len(usages) > 0 {
		result, err := tx.ExecContext(ctx, `
UPDATE connections
SET key_vault_id=NULL, updated_at=?
WHERE auth_type='private_key' AND private_key_source='key_vault' AND key_vault_id=?`,
			time.Now().UTC().Format(time.RFC3339Nano), request.ID)
		if err != nil {
			return response, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return response, err
		}
		if int(affected) != len(usages) {
			return response, errors.New("key vault usage changed during delete")
		}
	}

	result, err := tx.ExecContext(ctx, "DELETE FROM key_vault_entries WHERE id=?", request.ID)
	if err != nil {
		return response, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return response, err
	}
	if affected == 0 {
		return response, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return response, err
	}
	response.Deleted = true
	return response, nil
}

func scanKeyVaultEntry(row scanner) (domain.KeyVaultEntry, error) {
	var entry domain.KeyVaultEntry
	var lastUsed sql.NullString
	var protectedBlob []byte
	err := row.Scan(
		&entry.ID, &entry.Name, &entry.PrivateKeyPath, &entry.StorageMode, &entry.SourceFileName,
		&entry.Algorithm, &entry.KeyBits, &entry.PublicKeyFingerprintSHA256, &entry.Encrypted,
		&entry.RequiresPassphrase, &entry.ProtectionVersion, &protectedBlob, &entry.PassphraseCredentialRef,
		&entry.PassphraseSaved, &entry.Notes, &entry.CreatedAt, &entry.UpdatedAt, &lastUsed,
		&entry.UsageCount,
	)
	if err != nil {
		return domain.KeyVaultEntry{}, err
	}
	mode := normalizeKeyVaultStorageMode(entry.StorageMode)
	entry.StorageMode = string(mode)
	if mode == domain.KeyVaultStorageEncryptedDatabase {
		entry.ProtectedKeyBlob = append([]byte(nil), protectedBlob...)
		entry.PrivateKeyPath = ""
	}
	if lastUsed.Valid {
		entry.LastUsedAt = lastUsed.String
	}
	return entry, nil
}

func listKeyVaultUsageTx(ctx context.Context, tx *sql.Tx, id int64) ([]domain.KeyVaultUsage, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT id, name FROM connections
WHERE auth_type='private_key' AND private_key_source='key_vault' AND key_vault_id=?
ORDER BY name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usages := make([]domain.KeyVaultUsage, 0)
	for rows.Next() {
		var usage domain.KeyVaultUsage
		if err := rows.Scan(&usage.ConnectionID, &usage.ConnectionName); err != nil {
			return nil, err
		}
		usages = append(usages, usage)
	}
	return usages, rows.Err()
}

func keyVaultUsageNames(usages []domain.KeyVaultUsage) []string {
	names := make([]string, 0, len(usages))
	for _, usage := range usages {
		names = append(names, usage.ConnectionName)
	}
	return names
}

func normalizeKeyVaultStorageMode(value string) domain.KeyVaultStorageMode {
	switch domain.KeyVaultStorageMode(strings.TrimSpace(value)) {
	case domain.KeyVaultStorageEncryptedDatabase:
		return domain.KeyVaultStorageEncryptedDatabase
	default:
		return domain.KeyVaultStorageLegacyFilePath
	}
}

func keyVaultInternalPath(fingerprint string) string {
	return "vault:" + strings.ReplaceAll(strings.TrimSpace(fingerprint), "/", "_")
}

func (s *Store) Close() error {
	return s.db.Close()
}
