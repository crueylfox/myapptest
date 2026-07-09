package settings

import (
	"context"
	"testing"

	"hostdeck/internal/domain"
)

type memoryStore struct {
	value domain.AppSettings
}

func (s *memoryStore) GetSettings(context.Context) (domain.AppSettings, error) {
	return s.value, nil
}

func (s *memoryStore) SaveSettings(_ context.Context, value domain.AppSettings) error {
	s.value = value
	return nil
}

func TestValidateSettings(t *testing.T) {
	valid := domain.DefaultAppSettings()
	if err := Validate(valid); err != nil {
		t.Fatal(err)
	}
	invalidPolicy := valid
	invalidPolicy.HostKeyPolicy = "invalid"
	if err := Validate(invalidPolicy); err == nil {
		t.Fatal("invalid host-key policy was accepted")
	}
	invalidTimeout := valid
	invalidTimeout.ConnectionTimeoutSeconds = 12
	if err := Validate(invalidTimeout); err == nil {
		t.Fatal("invalid timeout was accepted")
	}
	invalidTheme := valid
	invalidTheme.ThemeMode = "invalid"
	if err := Validate(invalidTheme); err == nil {
		t.Fatal("invalid theme was accepted")
	}
	invalidFont := valid
	invalidFont.UIFontSize = "invalid"
	if err := Validate(invalidFont); err == nil {
		t.Fatal("invalid UI font size was accepted")
	}
	invalidShell := valid
	invalidShell.LocalTerminalShellPreference = "fish"
	if err := Validate(invalidShell); err == nil {
		t.Fatal("invalid local terminal shell preference was accepted")
	}
	invalidWindow := valid
	invalidWindow.WindowWidth = 320
	if err := Validate(invalidWindow); err == nil {
		t.Fatal("invalid window size was accepted")
	}
	invalidHistoryLimit := valid
	invalidHistoryLimit.CommandHistoryMaxEntries = domain.MinimumCommandHistoryMaxEntries - 1
	if err := Validate(invalidHistoryLimit); err == nil {
		t.Fatal("invalid command history max entries was accepted")
	}
	invalidKeepaliveInterval := valid
	invalidKeepaliveInterval.SSHKeepaliveIntervalSeconds = domain.MinimumSSHKeepaliveIntervalSeconds - 1
	if err := Validate(invalidKeepaliveInterval); err == nil {
		t.Fatal("invalid SSH keepalive interval was accepted")
	}
	invalidKeepaliveTimeout := valid
	invalidKeepaliveTimeout.SSHKeepaliveTimeoutSeconds = domain.MinimumSSHKeepaliveTimeoutSeconds - 1
	if err := Validate(invalidKeepaliveTimeout); err == nil {
		t.Fatal("invalid SSH keepalive timeout was accepted")
	}
	invalidKeepaliveFailures := valid
	invalidKeepaliveFailures.SSHKeepaliveMaxFailures = domain.MinimumSSHKeepaliveMaxFailures - 1
	if err := Validate(invalidKeepaliveFailures); err == nil {
		t.Fatal("invalid SSH keepalive max failures was accepted")
	}
	invalidOfflineGrace := valid
	invalidOfflineGrace.Alerts.Offline.GraceSeconds = 2
	if err := Validate(invalidOfflineGrace); err == nil {
		t.Fatal("invalid offline alert grace was accepted")
	}
	invalidCPUThreshold := valid
	invalidCPUThreshold.Alerts.CPU.Threshold = 49
	if err := Validate(invalidCPUThreshold); err == nil {
		t.Fatal("invalid CPU alert threshold was accepted")
	}
	invalidLatencyThreshold := valid
	invalidLatencyThreshold.Alerts.Latency.Threshold = 5001
	if err := Validate(invalidLatencyThreshold); err == nil {
		t.Fatal("invalid latency alert threshold was accepted")
	}
	invalidAlertDuration := valid
	invalidAlertDuration.Alerts.Memory.DurationSeconds = 10
	if err := Validate(invalidAlertDuration); err == nil {
		t.Fatal("invalid alert duration was accepted")
	}
}

func TestServiceReadsAndUpdatesTypedSettings(t *testing.T) {
	ctx := context.Background()
	store := &memoryStore{value: domain.DefaultAppSettings()}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	value := service.Get()
	value.DefaultRememberPassword = true
	value.HostKeyPolicy = domain.HostKeyStrict
	value.LocalTerminalShellPreference = domain.LocalTerminalShellCmd
	value.LocalTerminalElevatedEnabled = true
	value.SSHKeepaliveEnabled = false
	value.SSHKeepaliveIntervalSeconds = 60
	value.SSHKeepaliveTimeoutSeconds = 15
	value.SSHKeepaliveMaxFailures = 5
	value.DashboardSortMode = domain.DashboardSortCPU
	value.DashboardManualServerOrder = []string{"2", "1"}
	value.Alerts.CPU.Threshold = 80
	value.Alerts.CPU.DurationSeconds = 30
	value.Alerts.Latency.Enabled = true
	value.Alerts.Latency.Threshold = 600
	value.OnboardingCompleted = true
	saved, err := service.Save(ctx, value)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.DefaultRememberPassword ||
		store.value.HostKeyPolicy != domain.HostKeyStrict ||
		store.value.LocalTerminalShellPreference != domain.LocalTerminalShellCmd ||
		!store.value.LocalTerminalElevatedEnabled ||
		store.value.SSHKeepaliveEnabled ||
		store.value.SSHKeepaliveIntervalSeconds != 60 ||
		store.value.SSHKeepaliveTimeoutSeconds != 15 ||
		store.value.SSHKeepaliveMaxFailures != 5 ||
		store.value.DashboardSortMode != domain.DashboardSortCPU ||
		len(store.value.DashboardManualServerOrder) != 2 ||
		store.value.DashboardManualServerOrder[0] != "2" ||
		store.value.DashboardManualServerOrder[1] != "1" ||
		store.value.Alerts.CPU.Threshold != 80 ||
		store.value.Alerts.CPU.DurationSeconds != 30 ||
		!store.value.Alerts.Latency.Enabled ||
		store.value.Alerts.Latency.Threshold != 600 {
		t.Fatalf("settings were not saved: %+v", saved)
	}
}

func TestServiceNormalizesLegacyAlertSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 10
	value.Alerts = domain.AlertSettings{}
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().Alerts != domain.DefaultAlertSettings() {
		t.Fatalf("legacy alert settings were not defaulted: %+v", service.Get().Alerts)
	}
	if service.Get().Alerts.NativeNotifications.Enabled {
		t.Fatalf("native notifications must default to disabled: %+v", service.Get().Alerts.NativeNotifications)
	}
}

func TestServicePersistsNativeAlertNotificationPreference(t *testing.T) {
	ctx := context.Background()
	store := &memoryStore{value: domain.DefaultAppSettings()}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	value := service.Get()
	if value.Alerts.NativeNotifications.Enabled {
		t.Fatalf("native notifications must default to disabled: %+v", value.Alerts.NativeNotifications)
	}

	value.Alerts.NativeNotifications.Enabled = true
	saved, err := service.Save(ctx, value)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.Alerts.NativeNotifications.Enabled || !store.value.Alerts.NativeNotifications.Enabled {
		t.Fatalf("native notification preference was not saved: saved=%+v stored=%+v", saved.Alerts.NativeNotifications, store.value.Alerts.NativeNotifications)
	}
}

func TestServiceNormalizesLegacyBackupImportOptions(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 14
	value.BackupImportOptions = domain.BackupImportOptions{}
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().BackupImportOptions != domain.DefaultBackupImportOptionPreferences() {
		t.Fatalf("legacy backup import options were not defaulted on: %+v", service.Get().BackupImportOptions)
	}
}

func TestServicePreservesSavedBackupImportOptions(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.BackupImportOptions = domain.BackupImportOptions{
		ImportSettings:  false,
		ImportGroups:    false,
		ImportServers:   true,
		ImportKeyVault:  false,
		ImportHostTrust: true,
	}
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	actual := service.Get().BackupImportOptions
	if actual != value.BackupImportOptions {
		t.Fatalf("saved backup import options were overwritten: %+v", actual)
	}
}

func TestServiceDefaultsMissingHostKeyPolicyToAutoUpdate(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.HostKeyPolicy = ""
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().HostKeyPolicy != domain.HostKeyAutoUpdate {
		t.Fatalf("missing host key policy did not default to auto_update: %+v", service.Get())
	}
}

func TestServicePreservesStrictHostKeyPolicy(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.HostKeyPolicy = domain.HostKeyStrict
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().HostKeyPolicy != domain.HostKeyStrict {
		t.Fatalf("strict host key policy was not preserved: %+v", service.Get())
	}
}

func TestServiceMigratesLegacyHostKeyPoliciesToAutoUpdate(t *testing.T) {
	ctx := context.Background()
	for _, legacy := range []domain.HostKeyPolicy{
		domain.HostKeyAsk,
		domain.HostKeyTrustOnFirstUse,
		domain.HostKeyTrustedOnly,
	} {
		value := domain.DefaultAppSettings()
		value.HostKeyPolicy = legacy
		store := &memoryStore{value: value}
		service, err := New(ctx, store)
		if err != nil {
			t.Fatal(err)
		}
		if service.Get().HostKeyPolicy != domain.HostKeyAutoUpdate {
			t.Fatalf("legacy host key policy %q did not migrate to auto_update: %+v", legacy, service.Get())
		}
	}
}

func TestServiceNormalizesMissingLocalTerminalShellPreference(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.LocalTerminalShellPreference = ""
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().LocalTerminalShellPreference != domain.LocalTerminalShellAuto {
		t.Fatalf("preference was not normalized: %+v", service.Get())
	}
}

func TestServiceNormalizesLegacyTerminalClipboardSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 4
	value.TerminalCopyOnSelectEnabled = false
	value.TerminalRightClickPasteEnabled = false
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	actual := service.Get()
	if !actual.TerminalCopyOnSelectEnabled || !actual.TerminalRightClickPasteEnabled {
		t.Fatalf("legacy terminal clipboard settings were not defaulted on: %+v", actual)
	}
}

func TestServiceDerivesShortcutSettingsFromLegacyTerminalSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.Shortcuts = domain.ShortcutSettings{}
	value.TerminalCopyOnSelectEnabled = false
	value.TerminalRightClickPasteEnabled = false
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	actual := service.Get()
	if actual.Shortcuts.TerminalCopyOnSelectEnabled ||
		actual.Shortcuts.TerminalRightClickAction != domain.TerminalRightClickMenu ||
		actual.TerminalCopyOnSelectEnabled ||
		actual.TerminalRightClickPasteEnabled {
		t.Fatalf("shortcut settings were not derived from legacy fields: %+v", actual)
	}
}

func TestServiceMigratesLegacyDefaultCompletionShortcut(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 13
	value.Shortcuts.TerminalCompletion = "ctrl+space"
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().Shortcuts.TerminalCompletion != "ctrl+shift+a" {
		t.Fatalf("legacy default completion shortcut was not migrated: %+v", service.Get().Shortcuts)
	}
}

func TestServicePreservesCustomCompletionShortcutDuringMigration(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 13
	value.Shortcuts.TerminalCompletion = "ctrl+alt+h"
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().Shortcuts.TerminalCompletion != "ctrl+alt+h" {
		t.Fatalf("custom completion shortcut was overwritten: %+v", service.Get().Shortcuts)
	}
}

func TestServiceRejectsInvalidShortcutSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.Shortcuts.TerminalPaste = "ctrl+x"
	store := &memoryStore{value: value}
	if _, err := New(ctx, store); err == nil {
		t.Fatal("invalid shortcut binding was accepted")
	}
}

func TestServiceAcceptsMacOSShortcutSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.Shortcuts.TerminalCopy = "meta+c"
	value.Shortcuts.TerminalPaste = "meta+v"
	value.Shortcuts.TerminalCompletion = "meta+k"
	value.Shortcuts.OpenCommandHistory = "shift+meta+h"
	value.Shortcuts.OpenCommandFavorites = "shift+meta+p"
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().Shortcuts.TerminalCopy != "meta+c" ||
		service.Get().Shortcuts.TerminalPaste != "meta+v" ||
		service.Get().Shortcuts.TerminalCompletion != "meta+k" ||
		service.Get().Shortcuts.OpenCommandHistory != "shift+meta+h" ||
		service.Get().Shortcuts.OpenCommandFavorites != "shift+meta+p" {
		t.Fatalf("macOS shortcut settings were not preserved: %+v", service.Get().Shortcuts)
	}
}

func TestServiceNormalizesLegacyCommandHistoryMaxEntries(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 7
	value.CommandHistoryMaxEntries = 0
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	if service.Get().CommandHistoryMaxEntries != domain.DefaultCommandHistoryMaxEntries {
		t.Fatalf("legacy command history max entries were not defaulted: %+v", service.Get())
	}
}

func TestServiceNormalizesLegacySSHKeepaliveSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.SettingsVersion = 8
	value.SSHKeepaliveEnabled = false
	value.SSHKeepaliveIntervalSeconds = 0
	value.SSHKeepaliveTimeoutSeconds = 0
	value.SSHKeepaliveMaxFailures = 0
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	actual := service.Get()
	if !actual.SSHKeepaliveEnabled ||
		actual.SSHKeepaliveIntervalSeconds != domain.DefaultSSHKeepaliveIntervalSeconds ||
		actual.SSHKeepaliveTimeoutSeconds != domain.DefaultSSHKeepaliveTimeoutSeconds ||
		actual.SSHKeepaliveMaxFailures != domain.DefaultSSHKeepaliveMaxFailures {
		t.Fatalf("legacy SSH keepalive settings were not defaulted: %+v", actual)
	}
}

func TestServiceNormalizesDashboardSettings(t *testing.T) {
	ctx := context.Background()
	value := domain.DefaultAppSettings()
	value.DashboardSortMode = "bogus"
	value.DashboardManualServerOrder = []string{" 2 ", "", "1", "2"}
	store := &memoryStore{value: value}
	service, err := New(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	actual := service.Get()
	if actual.DashboardSortMode != domain.DashboardSortManual ||
		len(actual.DashboardManualServerOrder) != 2 ||
		actual.DashboardManualServerOrder[0] != "2" ||
		actual.DashboardManualServerOrder[1] != "1" {
		t.Fatalf("dashboard settings were not normalized: %+v", actual)
	}
}
