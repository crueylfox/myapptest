//go:build !windows

package settings

import "hostdeck/internal/domain"

func probeShortcutConflict(shortcutHotkey) domain.ShortcutConflictStatus {
	return domain.ShortcutConflictUnknown
}
