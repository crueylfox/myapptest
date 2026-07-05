package sftpmanager

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestRemotePathHelpersUsePOSIXSemantics(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"root parent", parentRemotePath("/"), "/"},
		{"absolute clean", cleanRemotePath("/home/root/../demo//"), "/home/demo"},
		{"relative clean", cleanRemotePath("测试 dir/../file.txt"), "file.txt"},
		{"join root", joinRemotePath("/", "测试 file.txt"), "/测试 file.txt"},
		{"join relative", joinRemotePath("/opt/data", "child"), "/opt/data/child"},
		{"resolve relative", resolveRemotePath("/home/admin", "logs/app.log"), "/home/admin/logs/app.log"},
		{"resolve absolute", resolveRemotePath("/home/admin", "/var/log"), "/var/log"},
		{"root base", baseRemotePath("/"), "/"},
		{"file base", baseRemotePath("/tmp/file.txt"), "file.txt"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Fatalf("got %q want %q", tc.got, tc.want)
			}
		})
	}
}

func TestRemoteRenameCandidate(t *testing.T) {
	if got, want := remoteRenameCandidate("/tmp/file.txt", 2), "/tmp/file (2).txt"; got != want {
		t.Fatalf("candidate=%q want %q", got, want)
	}
	if got, want := remoteRenameCandidate("/tmp/archive", 1), "/tmp/archive (1)"; got != want {
		t.Fatalf("candidate=%q want %q", got, want)
	}
}

func TestValidateRemoteNameRejectsPathSeparators(t *testing.T) {
	for _, name := range []string{"", ".", "..", "a/b", `a\b`} {
		if err := validateRemoteName(name); err == nil {
			t.Fatalf("name %q was accepted", name)
		}
	}
	if err := validateRemoteName("中文 name"); err != nil {
		t.Fatalf("valid name rejected: %v", err)
	}
}

func TestUploadRemotePathConvertsWindowsRelativePathToPOSIX(t *testing.T) {
	got, err := uploadRemotePath("/srv/upload/root", filepath.Join("nested dir", "中文 file.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if got != "/srv/upload/root/nested dir/中文 file.txt" {
		t.Fatalf("remote path=%q", got)
	}
	if strings.Contains(got, `\`) {
		t.Fatalf("remote path contains Windows separator: %q", got)
	}
}

func TestRecursivePathTraversalIsRejected(t *testing.T) {
	if !hasParentTraversal("../etc") || !hasParentTraversal("safe/../etc") {
		t.Fatal("parent traversal was not detected")
	}
	if _, err := uploadRemotePath("/srv/upload", "../secret.txt"); err == nil {
		t.Fatal("unsafe upload relative path was accepted")
	}
	root := t.TempDir()
	if err := ensureLocalDescendant(root, filepath.Join(root, "safe", "file.txt")); err != nil {
		t.Fatalf("safe local descendant rejected: %v", err)
	}
	if err := ensureLocalDescendant(root, filepath.Dir(root)); err == nil {
		t.Fatal("local target escape was accepted")
	}
}
