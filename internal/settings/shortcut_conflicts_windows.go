//go:build windows

package settings

import (
	"runtime"
	"sync/atomic"
	"syscall"

	"golang.org/x/sys/windows"

	"hostdeck/internal/domain"
)

const (
	windowsModAlt     = 0x0001
	windowsModControl = 0x0002
	windowsModShift   = 0x0004
)

var (
	shortcutProbeID      atomic.Int32
	user32               = windows.NewLazySystemDLL("user32.dll")
	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
)

func probeShortcutConflict(hotkey shortcutHotkey) domain.ShortcutConflictStatus {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	id := int32(0x5300) + (shortcutProbeID.Add(1) % 0x0fff)
	modifiers := uint32(0)
	if hotkey.Ctrl {
		modifiers |= windowsModControl
	}
	if hotkey.Shift {
		modifiers |= windowsModShift
	}
	if hotkey.Alt {
		modifiers |= windowsModAlt
	}

	err := registerHotKey(id, modifiers, hotkey.VirtualKey)
	if err == nil {
		_ = unregisterHotKey(id)
		return domain.ShortcutConflictAvailable
	}
	if errno, ok := err.(syscall.Errno); ok {
		if errno == windows.ERROR_HOTKEY_ALREADY_REGISTERED {
			return domain.ShortcutConflictOccupied
		}
	}
	return domain.ShortcutConflictUnknown
}

func registerHotKey(id int32, modifiers uint32, virtualKey uint32) error {
	result, _, err := procRegisterHotKey.Call(0, uintptr(id), uintptr(modifiers), uintptr(virtualKey))
	if result != 0 {
		return nil
	}
	if errno, ok := err.(syscall.Errno); ok && errno != 0 {
		return errno
	}
	return syscall.EINVAL
}

func unregisterHotKey(id int32) error {
	result, _, err := procUnregisterHotKey.Call(0, uintptr(id))
	if result != 0 {
		return nil
	}
	if errno, ok := err.(syscall.Errno); ok && errno != 0 {
		return errno
	}
	return syscall.EINVAL
}
