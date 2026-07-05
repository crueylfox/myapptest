package settings

import (
	"fmt"
	"strings"

	"serverpilot/internal/domain"
)

type shortcutHotkey struct {
	Normalized string
	Display    string
	Ctrl       bool
	Shift      bool
	Alt        bool
	Key        string
	VirtualKey uint32
}

type shortcutConflictProbe func(shortcutHotkey) domain.ShortcutConflictStatus

func CheckShortcutConflicts(request domain.ShortcutConflictCheckRequest) domain.ShortcutConflictCheckResponse {
	return checkShortcutConflictsWithProbe(request, probeShortcutConflict)
}

func checkShortcutConflictsWithProbe(
	request domain.ShortcutConflictCheckRequest,
	probe shortcutConflictProbe,
) domain.ShortcutConflictCheckResponse {
	seen := make(map[string]bool, len(request.Shortcuts))
	entries := make([]domain.ShortcutConflictEntry, 0, len(request.Shortcuts))
	for _, binding := range request.Shortcuts {
		normalized := normalizeShortcutBinding(binding)
		if normalized == "" || normalized == "disabled" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		hotkey, ok := parseShortcutHotkey(normalized)
		if !ok {
			entries = append(entries, domain.ShortcutConflictEntry{
				Shortcut: normalized,
				Status:   domain.ShortcutConflictUnknown,
				Message:  fmt.Sprintf("快捷键 %s 暂不支持检测，仍可保存。", normalized),
			})
			continue
		}
		status := probe(hotkey)
		entries = append(entries, domain.ShortcutConflictEntry{
			Shortcut: hotkey.Normalized,
			Status:   status,
			Message:  shortcutConflictMessage(hotkey, status),
		})
	}
	if entries == nil {
		entries = []domain.ShortcutConflictEntry{}
	}
	return domain.ShortcutConflictCheckResponse{Entries: entries}
}

func normalizeShortcutBinding(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	parts := strings.Split(value, "+")
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	return strings.Join(parts, "+")
}

func parseShortcutHotkey(value string) (shortcutHotkey, bool) {
	parts := strings.Split(value, "+")
	if len(parts) < 2 {
		return shortcutHotkey{}, false
	}
	hotkey := shortcutHotkey{Normalized: value}
	for _, part := range parts[:len(parts)-1] {
		switch part {
		case "ctrl":
			hotkey.Ctrl = true
		case "shift":
			hotkey.Shift = true
		case "alt":
			hotkey.Alt = true
		default:
			return shortcutHotkey{}, false
		}
	}
	key := parts[len(parts)-1]
	switch key {
	case "space":
		hotkey.Key = "space"
		hotkey.Display = shortcutDisplayLabel(hotkey, "Space")
		hotkey.VirtualKey = 0x20
	case "a", "c", "v", "h", "p":
		hotkey.Key = key
		hotkey.Display = shortcutDisplayLabel(hotkey, strings.ToUpper(key))
		hotkey.VirtualKey = uint32(key[0] - 'a' + 'A')
	default:
		return shortcutHotkey{}, false
	}
	if !hotkey.Ctrl && !hotkey.Shift && !hotkey.Alt {
		return shortcutHotkey{}, false
	}
	return hotkey, true
}

func shortcutDisplayLabel(hotkey shortcutHotkey, key string) string {
	parts := make([]string, 0, 4)
	if hotkey.Ctrl {
		parts = append(parts, "Ctrl")
	}
	if hotkey.Shift {
		parts = append(parts, "Shift")
	}
	if hotkey.Alt {
		parts = append(parts, "Alt")
	}
	parts = append(parts, key)
	return strings.Join(parts, "+")
}

func shortcutConflictMessage(hotkey shortcutHotkey, status domain.ShortcutConflictStatus) string {
	switch status {
	case domain.ShortcutConflictAvailable:
		return fmt.Sprintf("%s 暂未检测到 Windows 全局占用。此检测为 best-effort，仍可能被输入法或应用内快捷键拦截。", hotkey.Display)
	case domain.ShortcutConflictOccupied:
		if hotkey.Normalized == "ctrl+space" {
			return fmt.Sprintf("%s 可能已被 Windows、输入法或其他应用注册，ServerPilot 可能无法收到该按键。仍可保存。", hotkey.Display)
		}
		return fmt.Sprintf("%s 可能已被 Windows 或其他应用注册为全局快捷键，ServerPilot 可能无法收到该按键。仍可保存。", hotkey.Display)
	case domain.ShortcutConflictReserved:
		return fmt.Sprintf("%s 可能是 Windows、输入法或桌面环境保留快捷键，ServerPilot 可能无法稳定收到该按键。仍可保存。", hotkey.Display)
	case domain.ShortcutConflictUnknown:
		return fmt.Sprintf("无法确认 %s 是否被外部快捷键占用；此检测为 best-effort，不能发现所有应用内快捷键。仍可保存。", hotkey.Display)
	default:
		return fmt.Sprintf("无法确认 %s 是否被外部快捷键占用；此检测为 best-effort，仍可保存。", hotkey.Display)
	}
}
