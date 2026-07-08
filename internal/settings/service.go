package settings

import (
	"context"
	"errors"
	"strings"
	"sync"

	"serverpilot/internal/domain"
)

type Store interface {
	GetSettings(context.Context) (domain.AppSettings, error)
	SaveSettings(context.Context, domain.AppSettings) error
}

type Service struct {
	store Store
	mu    sync.RWMutex
	value domain.AppSettings
}

func New(ctx context.Context, store Store) (*Service, error) {
	value, err := store.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	value = normalize(value)
	if err := Validate(value); err != nil {
		return nil, err
	}
	return &Service{store: store, value: value}, nil
}

func (s *Service) Get() domain.AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.value
}

func (s *Service) Save(ctx context.Context, value domain.AppSettings) (domain.AppSettings, error) {
	value = normalize(value)
	value.SettingsVersion = domain.CurrentSettingsVersion
	if err := Validate(value); err != nil {
		return domain.AppSettings{}, err
	}
	if err := s.store.SaveSettings(ctx, value); err != nil {
		return domain.AppSettings{}, err
	}
	s.mu.Lock()
	s.value = value
	s.mu.Unlock()
	return value, nil
}

func (s *Service) Reload(ctx context.Context) (domain.AppSettings, error) {
	value, err := s.store.GetSettings(ctx)
	if err != nil {
		return domain.AppSettings{}, err
	}
	value = normalize(value)
	if err := Validate(value); err != nil {
		return domain.AppSettings{}, err
	}
	s.mu.Lock()
	s.value = value
	s.mu.Unlock()
	return value, nil
}

func Validate(value domain.AppSettings) error {
	switch value.HostKeyPolicy {
	case domain.HostKeyAutoUpdate, domain.HostKeyStrict:
	default:
		return errors.New("主机指纹策略无效")
	}
	switch value.ThemeMode {
	case domain.ThemeDark, domain.ThemeLight, domain.ThemeSystem:
	default:
		return errors.New("主题模式无效")
	}
	switch value.UIFontSize {
	case domain.UIFontTiny, domain.UIFontSmall, domain.UIFontStandard, domain.UIFontLarge, domain.UIFontXLarge,
		domain.UIFontHuge, domain.UIFontMax:
	default:
		return errors.New("界面字体大小无效")
	}
	switch value.LocalTerminalShellPreference {
	case domain.LocalTerminalShellAuto,
		domain.LocalTerminalShellPowerShell,
		domain.LocalTerminalShellCmd,
		domain.LocalTerminalShellZsh,
		domain.LocalTerminalShellBash,
		domain.LocalTerminalShellSh:
	default:
		return errors.New("本地终端 shell 偏好无效")
	}
	switch value.ConnectionTimeoutSeconds {
	case 5, 10, 15, 30:
	default:
		return errors.New("连接超时只能设置为 5、10、15 或 30 秒")
	}
	if value.CommandHistoryMaxEntries < domain.MinimumCommandHistoryMaxEntries ||
		value.CommandHistoryMaxEntries > domain.MaximumCommandHistoryMaxEntries {
		return errors.New("命令历史最大条数必须在 100 到 20000 之间")
	}
	if value.SSHKeepaliveIntervalSeconds < domain.MinimumSSHKeepaliveIntervalSeconds ||
		value.SSHKeepaliveIntervalSeconds > domain.MaximumSSHKeepaliveIntervalSeconds {
		return errors.New("SSH 保活间隔必须在 10 到 300 秒之间")
	}
	if value.SSHKeepaliveTimeoutSeconds < domain.MinimumSSHKeepaliveTimeoutSeconds ||
		value.SSHKeepaliveTimeoutSeconds > domain.MaximumSSHKeepaliveTimeoutSeconds {
		return errors.New("SSH 保活超时必须在 3 到 60 秒之间")
	}
	if value.SSHKeepaliveMaxFailures < domain.MinimumSSHKeepaliveMaxFailures ||
		value.SSHKeepaliveMaxFailures > domain.MaximumSSHKeepaliveMaxFailures {
		return errors.New("SSH 保活失败次数必须在 1 到 10 之间")
	}
	if value.SettingsVersion < 1 {
		return errors.New("设置版本无效")
	}
	if err := validateShortcuts(value.Shortcuts); err != nil {
		return err
	}
	if err := validateAlerts(value.Alerts); err != nil {
		return err
	}
	switch value.DashboardSortMode {
	case domain.DashboardSortManual, domain.DashboardSortGroup, domain.DashboardSortRemark,
		domain.DashboardSortCPU, domain.DashboardSortMemory, domain.DashboardSortNetwork:
	default:
		return errors.New("服务器总览排序模式无效")
	}
	if value.WindowWidth < 640 || value.WindowWidth > 10000 ||
		value.WindowHeight < 480 || value.WindowHeight > 10000 {
		return errors.New("窗口尺寸无效")
	}
	return nil
}

func normalize(value domain.AppSettings) domain.AppSettings {
	value.HostKeyPolicy = normalizeHostKeyPolicy(value.HostKeyPolicy)
	if value.LocalTerminalShellPreference == "" {
		value.LocalTerminalShellPreference = domain.LocalTerminalShellAuto
	}
	if value.DefaultTerminalProfileID == "" {
		value.DefaultTerminalProfileID = domain.DefaultTerminalProfileID
	}
	if value.CommandHistoryMaxEntries == 0 || value.SettingsVersion < 8 {
		value.CommandHistoryMaxEntries = domain.DefaultCommandHistoryMaxEntries
	}
	if value.SettingsVersion < 9 {
		value.SSHKeepaliveEnabled = true
		value.SSHKeepaliveIntervalSeconds = domain.DefaultSSHKeepaliveIntervalSeconds
		value.SSHKeepaliveTimeoutSeconds = domain.DefaultSSHKeepaliveTimeoutSeconds
		value.SSHKeepaliveMaxFailures = domain.DefaultSSHKeepaliveMaxFailures
	}
	if value.SSHKeepaliveIntervalSeconds == 0 {
		value.SSHKeepaliveIntervalSeconds = domain.DefaultSSHKeepaliveIntervalSeconds
	}
	if value.SSHKeepaliveTimeoutSeconds == 0 {
		value.SSHKeepaliveTimeoutSeconds = domain.DefaultSSHKeepaliveTimeoutSeconds
	}
	if value.SSHKeepaliveMaxFailures == 0 {
		value.SSHKeepaliveMaxFailures = domain.DefaultSSHKeepaliveMaxFailures
	}
	value.DashboardSortMode = normalizeDashboardSortMode(value.DashboardSortMode)
	value.DashboardManualServerOrder = normalizeDashboardManualServerOrder(value.DashboardManualServerOrder)
	value.Shortcuts = normalizeShortcutSettings(value.Shortcuts, value.TerminalCopyOnSelectEnabled, value.TerminalRightClickPasteEnabled)
	if value.SettingsVersion < 14 && strings.EqualFold(strings.TrimSpace(value.Shortcuts.TerminalCompletion), "ctrl+space") {
		value.Shortcuts.TerminalCompletion = domain.DefaultShortcutSettings().TerminalCompletion
	}
	value.TerminalCopyOnSelectEnabled = value.Shortcuts.TerminalCopyOnSelectEnabled
	value.TerminalRightClickPasteEnabled = value.Shortcuts.TerminalRightClickAction == domain.TerminalRightClickPaste
	value.Alerts = normalizeAlertSettings(value.Alerts, value.SettingsVersion)
	value.BackupImportOptions = normalizeBackupImportOptions(value.BackupImportOptions, value.SettingsVersion)
	if value.SettingsVersion < 5 {
		value.TerminalCopyOnSelectEnabled = true
		value.TerminalRightClickPasteEnabled = true
		value.Shortcuts = domain.DefaultShortcutSettings()
	}
	return value
}

func normalizeBackupImportOptions(value domain.BackupImportOptions, settingsVersion int) domain.BackupImportOptions {
	if settingsVersion < 15 {
		return domain.DefaultBackupImportOptionPreferences()
	}
	return value
}

func validateShortcuts(value domain.ShortcutSettings) error {
	switch value.TerminalRightClickAction {
	case domain.TerminalRightClickPaste, domain.TerminalRightClickMenu:
	default:
		return errors.New("终端右键行为设置无效")
	}
	switch value.TerminalContextMenuTrigger {
	case domain.TerminalContextMenuShiftRightClick,
		domain.TerminalContextMenuCtrlRightClick,
		domain.TerminalContextMenuDisabled:
	default:
		return errors.New("终端右键菜单快捷方式无效")
	}
	for _, binding := range []string{
		value.TerminalCopy,
		value.TerminalPaste,
		value.TerminalCompletion,
		value.OpenCommandHistory,
		value.OpenCommandFavorites,
	} {
		if !isAllowedShortcutBinding(binding) {
			return errors.New("快捷键绑定无效")
		}
	}
	return nil
}

func normalizeShortcutSettings(value domain.ShortcutSettings, legacyCopyOnSelect bool, legacyRightClickPaste bool) domain.ShortcutSettings {
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
	return value
}

func isAllowedShortcutBinding(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "disabled",
		"ctrl+shift+a",
		"ctrl+shift+c",
		"ctrl+shift+v",
		"ctrl+shift+h",
		"ctrl+shift+p",
		"ctrl+alt+c",
		"ctrl+alt+v",
		"ctrl+alt+h",
		"ctrl+alt+p",
		"meta+c",
		"meta+v",
		"meta+k",
		"shift+meta+h",
		"shift+meta+p":
		return true
	default:
		return false
	}
}

func normalizeHostKeyPolicy(value domain.HostKeyPolicy) domain.HostKeyPolicy {
	switch value {
	case domain.HostKeyStrict:
		return domain.HostKeyStrict
	case domain.HostKeyAutoUpdate,
		"",
		domain.HostKeyAsk,
		domain.HostKeyTrustOnFirstUse,
		domain.HostKeyTrustedOnly:
		return domain.HostKeyAutoUpdate
	default:
		return value
	}
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

func normalizeDashboardManualServerOrder(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	if result == nil {
		return []string{}
	}
	return result
}

func validateAlerts(value domain.AlertSettings) error {
	if value.HistoryLimit < domain.MinimumAlertHistoryLimit ||
		value.HistoryLimit > domain.MaximumAlertHistoryLimit {
		return errors.New("告警历史保留条数必须在 50 到 5000 之间")
	}
	if value.Offline.GraceSeconds < 5 || value.Offline.GraceSeconds > 300 {
		return errors.New("离线告警宽限时间必须在 5 到 300 秒之间")
	}
	for _, rule := range []struct {
		name     string
		value    domain.ThresholdAlertRuleSettings
		min, max float64
	}{
		{name: "CPU 告警阈值", value: value.CPU, min: 50, max: 100},
		{name: "内存告警阈值", value: value.Memory, min: 50, max: 100},
		{name: "根分区告警阈值", value: value.RootDisk, min: 50, max: 100},
		{name: "延迟告警阈值", value: value.Latency, min: 50, max: 5000},
	} {
		if rule.value.Threshold < rule.min || rule.value.Threshold > rule.max {
			return errors.New(rule.name + "无效")
		}
		if rule.value.DurationSeconds < 15 || rule.value.DurationSeconds > 600 {
			return errors.New(rule.name + "持续时间必须在 15 到 600 秒之间")
		}
	}
	return nil
}

func normalizeAlertSettings(value domain.AlertSettings, settingsVersion int) domain.AlertSettings {
	defaults := domain.DefaultAlertSettings()
	if settingsVersion < 11 || isZeroAlertSettings(value) {
		return defaults
	}
	value.HistoryLimit = clampIntDefault(
		value.HistoryLimit,
		domain.MinimumAlertHistoryLimit,
		domain.MaximumAlertHistoryLimit,
		defaults.HistoryLimit,
	)
	value.Offline.GraceSeconds = clampIntDefault(value.Offline.GraceSeconds, 5, 300, defaults.Offline.GraceSeconds)
	value.CPU = normalizeThresholdRule(value.CPU, defaults.CPU, 50, 100)
	value.Memory = normalizeThresholdRule(value.Memory, defaults.Memory, 50, 100)
	value.RootDisk = normalizeThresholdRule(value.RootDisk, defaults.RootDisk, 50, 100)
	value.Latency = normalizeThresholdRule(value.Latency, defaults.Latency, 50, 5000)
	return value
}

func normalizeThresholdRule(value, defaults domain.ThresholdAlertRuleSettings, min, max float64) domain.ThresholdAlertRuleSettings {
	if value.Threshold < min || value.Threshold > max {
		value.Threshold = defaults.Threshold
	}
	value.DurationSeconds = clampIntDefault(value.DurationSeconds, 15, 600, defaults.DurationSeconds)
	return value
}

func clampIntDefault(value, min, max, fallback int) int {
	if value < min || value > max {
		return fallback
	}
	return value
}

func isZeroAlertSettings(value domain.AlertSettings) bool {
	return !value.Enabled &&
		!value.NotifyRecovery &&
		value.HistoryLimit == 0 &&
		!value.Offline.Enabled &&
		value.Offline.GraceSeconds == 0 &&
		!value.CPU.Enabled &&
		value.CPU.Threshold == 0 &&
		value.CPU.DurationSeconds == 0 &&
		!value.Memory.Enabled &&
		value.Memory.Threshold == 0 &&
		value.Memory.DurationSeconds == 0 &&
		!value.RootDisk.Enabled &&
		value.RootDisk.Threshold == 0 &&
		value.RootDisk.DurationSeconds == 0 &&
		!value.Latency.Enabled &&
		value.Latency.Threshold == 0 &&
		value.Latency.DurationSeconds == 0 &&
		!value.NativeNotifications.Enabled
}
