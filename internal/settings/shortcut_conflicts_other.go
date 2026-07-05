//go:build !windows

package settings

import "serverpilot/internal/domain"

func probeShortcutConflict(shortcutHotkey) domain.ShortcutConflictStatus {
	return domain.ShortcutConflictUnknown
}
