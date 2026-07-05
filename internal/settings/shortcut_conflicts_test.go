package settings

import (
	"strings"
	"testing"

	"serverpilot/internal/domain"
)

func TestCheckShortcutConflictsWithProbe(t *testing.T) {
	response := checkShortcutConflictsWithProbe(
		domain.ShortcutConflictCheckRequest{
			Shortcuts: []string{"ctrl+space", "ctrl+shift+v", "disabled", "", "ctrl+shift+v"},
		},
		func(hotkey shortcutHotkey) domain.ShortcutConflictStatus {
			if hotkey.Normalized == "ctrl+space" {
				return domain.ShortcutConflictOccupied
			}
			return domain.ShortcutConflictAvailable
		},
	)

	if len(response.Entries) != 2 {
		t.Fatalf("expected disabled/empty/duplicates to be filtered, got %+v", response.Entries)
	}
	if response.Entries[0].Shortcut != "ctrl+space" ||
		response.Entries[0].Status != domain.ShortcutConflictOccupied ||
		!strings.Contains(response.Entries[0].Message, "Ctrl+Space") ||
		!strings.Contains(response.Entries[0].Message, "输入法") {
		t.Fatalf("ctrl+space occupied warning was not specific enough: %+v", response.Entries[0])
	}
	if response.Entries[1].Shortcut != "ctrl+shift+v" ||
		response.Entries[1].Status != domain.ShortcutConflictAvailable ||
		response.Entries[1].Message == "" {
		t.Fatalf("available shortcut entry was not returned: %+v", response.Entries[1])
	}
}

func TestCheckShortcutConflictsReportsUnsupportedBindingsAsUnknown(t *testing.T) {
	response := checkShortcutConflictsWithProbe(
		domain.ShortcutConflictCheckRequest{Shortcuts: []string{"ctrl+x"}},
		func(shortcutHotkey) domain.ShortcutConflictStatus {
			t.Fatal("probe must not be called for unsupported shortcut bindings")
			return domain.ShortcutConflictAvailable
		},
	)

	if len(response.Entries) != 1 {
		t.Fatalf("expected one unknown entry, got %+v", response.Entries)
	}
	entry := response.Entries[0]
	if entry.Shortcut != "ctrl+x" ||
		entry.Status != domain.ShortcutConflictUnknown ||
		!strings.Contains(entry.Message, "暂不支持检测") {
		t.Fatalf("unsupported shortcut was not reported as unknown: %+v", entry)
	}
}

func TestCheckShortcutConflictsKeepsExternalWarningsNonBlocking(t *testing.T) {
	response := checkShortcutConflictsWithProbe(
		domain.ShortcutConflictCheckRequest{Shortcuts: []string{"ctrl+alt+v", "ctrl+shift+h"}},
		func(hotkey shortcutHotkey) domain.ShortcutConflictStatus {
			if hotkey.Normalized == "ctrl+alt+v" {
				return domain.ShortcutConflictReserved
			}
			return domain.ShortcutConflictUnknown
		},
	)

	if len(response.Entries) != 2 {
		t.Fatalf("expected two entries, got %+v", response.Entries)
	}
	for _, entry := range response.Entries {
		if !strings.Contains(entry.Message, "仍可保存") {
			t.Fatalf("external conflict warning should be non-blocking: %+v", entry)
		}
	}
}
