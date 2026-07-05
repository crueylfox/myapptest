package sshclient

import (
	"errors"
	"testing"
)

func TestApplyTerminalUTF8LocaleSetsLCTypeAndLang(t *testing.T) {
	calls := make([][2]string, 0, 2)
	applyTerminalUTF8Locale(func(name, value string) error {
		calls = append(calls, [2]string{name, value})
		return nil
	})

	want := [][2]string{
		{"LC_CTYPE", "C.UTF-8"},
		{"LANG", "C.UTF-8"},
	}
	if len(calls) != len(want) {
		t.Fatalf("calls=%v", calls)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Fatalf("call %d = %v, want %v", index, calls[index], want[index])
		}
	}
}

func TestApplyTerminalUTF8LocaleFallsBackAndDoesNotFailTerminal(t *testing.T) {
	calls := make([][2]string, 0, 4)
	applyTerminalUTF8Locale(func(name, value string) error {
		calls = append(calls, [2]string{name, value})
		if value == "C.UTF-8" {
			return errors.New("server rejected env")
		}
		return nil
	})

	want := [][2]string{
		{"LC_CTYPE", "C.UTF-8"},
		{"LANG", "C.UTF-8"},
		{"LC_CTYPE", "en_US.UTF-8"},
		{"LANG", "en_US.UTF-8"},
	}
	if len(calls) != len(want) {
		t.Fatalf("calls=%v", calls)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Fatalf("call %d = %v, want %v", index, calls[index], want[index])
		}
	}
}

func TestTerminalTypeUsesXterm256Color(t *testing.T) {
	if terminalType != "xterm-256color" {
		t.Fatalf("terminalType=%q", terminalType)
	}
}

func TestApplyTerminalColorEnvIsBestEffort(t *testing.T) {
	calls := make([][2]string, 0, 2)
	applyTerminalColorEnv(func(name, value string) error {
		calls = append(calls, [2]string{name, value})
		return errors.New("server rejected env")
	})

	want := [][2]string{
		{"TERM", "xterm-256color"},
		{"COLORTERM", "truecolor"},
	}
	if len(calls) != len(want) {
		t.Fatalf("calls=%v", calls)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Fatalf("call %d = %v, want %v", index, calls[index], want[index])
		}
	}
}
