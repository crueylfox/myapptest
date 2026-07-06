//go:build darwin

package localfiles

import (
	"reflect"
	"testing"
)

func TestDarwinShellExecutorUsesOpenAndFinderReveal(t *testing.T) {
	var commands [][]string
	executor := newDarwinShellExecutor(func(name string, args ...string) error {
		commands = append(commands, append([]string{name}, args...))
		return nil
	})
	if err := executor.Open("/Users/test/file.txt"); err != nil {
		t.Fatal(err)
	}
	if err := executor.Reveal("/Users/test/file.txt"); err != nil {
		t.Fatal(err)
	}
	if err := executor.Properties("/Users/test/file.txt"); err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{"open", "/Users/test/file.txt"},
		{"open", "-R", "/Users/test/file.txt"},
		{"open", "-R", "/Users/test/file.txt"},
	}
	if !reflect.DeepEqual(commands, want) {
		t.Fatalf("commands = %#v, want %#v", commands, want)
	}
}
