package sftpmanager

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"serverpilot/internal/domain"
)

func TestQuotePOSIXArgEscapesUnsafeNames(t *testing.T) {
	cases := map[string]string{
		"simple":                 "'simple'",
		"with space":             "'with space'",
		"\u4e2d\u6587 file":      "'\u4e2d\u6587 file'",
		"has'quote":              "'has'\\''quote'",
		"; rm -rf /":             "'; rm -rf /'",
		"$(touch /tmp/pwned)":    "'$(touch /tmp/pwned)'",
		"`touch /tmp/pwned`":     "'`touch /tmp/pwned`'",
		"semi;$(echo bad)`tick`": "'semi;$(echo bad)`tick`'",
	}
	for input, want := range cases {
		if got := QuotePOSIXArg(input); got != want {
			t.Fatalf("QuotePOSIXArg(%q)=%q want %q", input, got, want)
		}
	}
}

func TestSCPShellPathValidation(t *testing.T) {
	if err := validateSCPRemoteReadablePath("/"); err != nil {
		t.Fatalf("root should be readable for listing: %v", err)
	}
	for _, path := range []string{"", "/", ".", "..", "../etc/passwd", "/tmp/../etc/passwd", "safe/../bad"} {
		if err := validateSCPRemoteTarget(path); err == nil {
			t.Fatalf("unsafe target %q was accepted", path)
		}
	}
	if _, err := normalizeSCPRequestPath("/home/admin", "../etc/passwd", true); err == nil {
		t.Fatal("relative traversal was accepted")
	}
	if got, err := normalizeSCPRequestPath("/home/admin", "logs/app.log", false); err != nil || got != "/home/admin/logs/app.log" {
		t.Fatalf("normalized path=%q err=%v", got, err)
	}
	if got, err := normalizeSCPRequestPath("/home/admin", ".", true); err != nil || got != "/home/admin" {
		t.Fatalf("dot path=%q err=%v", got, err)
	}
	if got, err := normalizeSCPRequestPath("/home/admin", "./logs/app.log", false); err != nil || got != "/home/admin/logs/app.log" {
		t.Fatalf("relative dot path=%q err=%v", got, err)
	}
	if got, err := normalizeSCPRequestPath(".", ".", true); err != nil || got != "/" {
		t.Fatalf("legacy dot base path=%q err=%v", got, err)
	}
}

func TestParseSCPShellEntries(t *testing.T) {
	output := strings.Join([]string{
		"SP_PATH\t/tmp",
		"SP_ENTRY\tfile\t12\t1710000000\t644\t1000\t1000\tplain.txt",
		"SP_ENTRY\tdir\t0\t1710000001\t755\troot\troot\tnested dir",
		"SP_ENTRY\tsymlink\t5\t1710000002\t777\t-\t-\tlink",
		"SP_ENTRY\tfile\t1\t1710000003\t644\troot\troot\t..",
		"SP_ENTRY\tfile\t1\t1710000004\t644\troot\troot\tbad/name",
	}, "\n")
	entries, err := parseSCPShellEntries("/tmp", []byte(output))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("entries=%d want 3: %#v", len(entries), entries)
	}
	if entries[0].Name != "plain.txt" || entries[0].Path != "/tmp/plain.txt" || entries[0].IsDir {
		t.Fatalf("bad file entry: %#v", entries[0])
	}
	if !entries[1].IsDir || entries[1].Name != "nested dir" {
		t.Fatalf("bad dir entry: %#v", entries[1])
	}
	if !entries[2].IsSymlink || entries[2].Owner != "-" {
		t.Fatalf("bad symlink entry: %#v", entries[2])
	}
}

func TestSCPModeHomeUsesResolvedAbsolutePath(t *testing.T) {
	emitter := newFakeEmitter()
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand([]byte("/home/admin\n"), nil),
			newFakeCommand([]byte("SP_PATH\t/home/admin\nSP_ENTRY\tfile\t4\t1710000000\t644\t1000\t1000\ta.txt\n"), nil),
		},
	}
	manager := NewWithDialer(
		context.Background(),
		nil,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			return transport, 0, nil
		},
	)
	defer manager.StopAll()
	state, err := manager.Open(domain.Connection{ID: 52, Name: "openwrt"}, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if state.CurrentPath != "/home/admin" {
		t.Fatalf("current path=%q want /home/admin", state.CurrentPath)
	}

	list, err := manager.Home(context.Background(), domain.SFTPContextRequest{ConnectionID: 52})
	if err != nil {
		t.Fatal(err)
	}
	if list.Path != "/home/admin" || list.ParentPath != "/home" {
		t.Fatalf("home list=%+v", list)
	}
	started := strings.Join(transport.started, "\n")
	if strings.Contains(started, "sh -s -- '.'") {
		t.Fatalf("home used dot path: %q", started)
	}
	if !strings.Contains(started, "sh -s -- '/home/admin'") {
		t.Fatalf("home did not list resolved path: %q", started)
	}
}

func TestSCPModeShellListAndManagementRoutes(t *testing.T) {
	emitter := newFakeEmitter()
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand([]byte("SP_PATH\t/tmp\nSP_ENTRY\tfile\t4\t1710000000\t644\t1000\t1000\ta.txt\n"), nil),
			newFakeCommand(nil, nil),
			newFakeCommand(nil, nil),
			newFakeCommand([]byte("SP_ITEM\tfile\t4\nSP_ITEM\tdir\t0\n"), nil),
			newFakeCommand(nil, nil),
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()

	list, err := manager.List(context.Background(), domain.SFTPListRequest{ConnectionID: 52, Path: "/tmp"})
	if err != nil {
		t.Fatal(err)
	}
	if list.Mode != domain.SFTPModeSCP || len(list.Entries) != 1 || list.Entries[0].Name != "a.txt" {
		t.Fatalf("unexpected list result: %#v", list)
	}
	if err := manager.Mkdir(context.Background(), domain.SFTPMkdirRequest{ConnectionID: 52, Path: "/tmp/new dir"}); err != nil {
		t.Fatalf("mkdir route failed: %v", err)
	}
	if err := manager.Rename(context.Background(), domain.SFTPRenameRequest{ConnectionID: 52, OldPath: "/tmp/a.txt", NewPath: "/tmp/b.txt"}); err != nil {
		t.Fatalf("rename route failed: %v", err)
	}
	inspect, err := manager.InspectDelete(context.Background(), domain.SFTPInspectDeleteRequest{ConnectionID: 52, Paths: []string{"/tmp/b.txt", "/tmp/dir"}})
	if err != nil {
		t.Fatalf("inspect delete route failed: %v", err)
	}
	if inspect.FileCount != 1 || inspect.DirectoryCount != 1 || !inspect.RequiresRecursive {
		t.Fatalf("unexpected inspect result: %#v", inspect)
	}
	if err := manager.Delete(context.Background(), domain.SFTPDeleteRequest{ConnectionID: 52, Paths: []string{"/tmp/b.txt"}, Recursive: false}); err != nil {
		t.Fatalf("delete route failed: %v", err)
	}
	started := strings.Join(transport.started, "\n")
	for _, want := range []string{"sh -s -- '/tmp'", "sh -s -- '/tmp/new dir'", "sh -s -- '/tmp/a.txt' '/tmp/b.txt'"} {
		if !strings.Contains(started, want) {
			t.Fatalf("missing command %q in %q", want, started)
		}
	}
}

func TestSCPModeShellItemPropertiesAndChmodRoutes(t *testing.T) {
	statBefore := []byte("SP_ENTRY\tfile\t5\t1710000000\t755\t1000\t1001\tspace name.sh\n")
	statAfter := []byte("SP_ENTRY\tfile\t5\t1710000001\t640\t1000\t1001\tspace name.sh\n")
	chmodCommand := newFakeCommand(nil, nil)
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand(statBefore, nil),
			newFakeCommand(statBefore, nil),
			chmodCommand,
			newFakeCommand(statAfter, nil),
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, newFakeEmitter())
	defer cleanup()

	props, err := manager.GetItemProperties(context.Background(), domain.SFTPItemPropertiesRequest{
		ConnectionID: 52,
		Path:         "/tmp/space name.sh",
		RequestID:    "scp-props",
	})
	if err != nil {
		t.Fatalf("properties route failed: %v", err)
	}
	if props.Mode != 0o755 || props.Permissions != "-rwxr-xr-x" || props.Type != "file" || props.RequestID != "scp-props" {
		t.Fatalf("unexpected properties: %+v", props)
	}

	updated, err := manager.UpdateItemPermissions(context.Background(), domain.SFTPUpdateItemPermissionsRequest{
		ConnectionID:        52,
		Path:                "/tmp/space name.sh",
		Mode:                0o640,
		PreserveSpecialBits: true,
		RequestID:           "scp-chmod",
	})
	if err != nil {
		t.Fatalf("chmod route failed: %v", err)
	}
	if updated.Mode != 0o640 || updated.Permissions != "-rw-r-----" || updated.RequestID != "scp-chmod" {
		t.Fatalf("unexpected chmod properties: %+v", updated)
	}
	started := strings.Join(transport.started, "\n")
	if !strings.Contains(started, "sh -s -- '0640' '/tmp/space name.sh'") {
		t.Fatalf("chmod command did not quote mode/path safely: %q", started)
	}
	if !strings.Contains(chmodCommand.stdin.String(), "chmod \"$mode\" \"$target\"") {
		t.Fatalf("chmod script did not use fixed allowlisted chmod body: %q", chmodCommand.stdin.String())
	}
}

func TestSCPModeShellChmodRejectsSymlinkBeforeRunningChmod(t *testing.T) {
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand([]byte("SP_ENTRY\tsymlink\t6\t1710000000\t777\t-\t-\tlink\n"), nil),
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, newFakeEmitter())
	defer cleanup()

	_, err := manager.UpdateItemPermissions(context.Background(), domain.SFTPUpdateItemPermissionsRequest{
		ConnectionID:        52,
		Path:                "/tmp/link",
		Mode:                0o644,
		PreserveSpecialBits: true,
	})
	if err == nil || !strings.Contains(err.Error(), "符号链接") {
		t.Fatalf("symlink chmod error=%v", err)
	}
	if len(transport.commands) != 0 {
		t.Fatalf("chmod should stop after symlink stat, remaining commands=%d", len(transport.commands))
	}
}

func TestSCPModeShellTextReadAndWriteRoutes(t *testing.T) {
	statBefore := []byte("SP_ENTRY\tfile\t5\t1710000000\t644\t1000\t1000\tnote.txt\n")
	statAfter := []byte("SP_ENTRY\tfile\t7\t1710000001\t644\t1000\t1000\tnote.txt\n")
	writeCommand := newFakeCommand(nil, nil)
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand(statBefore, nil),
			newFakeCommand([]byte("hello"), nil),
			newFakeCommand(statBefore, nil),
			writeCommand,
			newFakeCommand(statAfter, nil),
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, newFakeEmitter())
	defer cleanup()

	read, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 52,
		Path:         "/tmp/note.txt",
		MaxBytes:     1024,
	})
	if err != nil {
		t.Fatalf("read route failed: %v", err)
	}
	if read.Content != "hello" || read.Entry.Name != "note.txt" {
		t.Fatalf("unexpected read result: %#v", read)
	}
	write, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   52,
		Path:           "/tmp/note.txt",
		Content:        "updated",
		ExpectedSize:   5,
		ExpectedMTime:  read.Entry.ModTime,
		ForceOverwrite: false,
	})
	if err != nil {
		t.Fatalf("write route failed: %v", err)
	}
	if write.Entry.Size != 7 || writeCommand.stdin.String() != "updated" {
		t.Fatalf("unexpected write result entry=%#v stdin=%q", write.Entry, writeCommand.stdin.String())
	}
}

func TestSCPModeShellWriteTextFileCreatesMissingTarget(t *testing.T) {
	statMissing := []byte("SP_ERROR\tNOT_FOUND\n")
	statAfter := []byte("SP_ENTRY\tfile\t7\t1710000001\t600\t1000\t1000\tnew.txt\n")
	writeCommand := newFakeCommand(nil, nil)
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand(statMissing, errors.New("exit 3")),
			writeCommand,
			newFakeCommand(statAfter, nil),
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, newFakeEmitter())
	defer cleanup()

	write, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   52,
		Path:           "/tmp/new.txt",
		Content:        "created",
		Encoding:       "utf-8",
		Mode:           domain.SFTPTextCreateNew,
		ConflictPolicy: domain.SFTPTextFailIfExists,
		ExpectedSize:   -1,
	})
	if err != nil {
		t.Fatalf("create-new route failed: %v", err)
	}
	if write.Path != "/tmp/new.txt" || write.Entry.Size != 7 || writeCommand.stdin.String() != "created" {
		t.Fatalf("unexpected create-new result entry=%#v stdin=%q", write.Entry, writeCommand.stdin.String())
	}
}

func TestSCPModeShellWriteTextFileSaveAsRequiresOverwriteConfirmation(t *testing.T) {
	statBefore := []byte("SP_ENTRY\tfile\t3\t1710000000\t644\t1000\t1000\tcopy.txt\n")
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand(statBefore, nil),
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, newFakeEmitter())
	defer cleanup()

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   52,
		Path:           "/tmp/copy.txt",
		Content:        "copy",
		Encoding:       "utf-8",
		Mode:           domain.SFTPTextSaveAs,
		ConflictPolicy: domain.SFTPTextFailIfExists,
		ExpectedSize:   -1,
	})
	detail := decodeSaveError(t, err)
	if detail.Code != "SFTP_SAVE_CONFLICT" || detail.Stage != "conflict_check" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	if len(transport.commands) != 0 {
		t.Fatalf("save-as conflict should stop before write, remaining commands=%d", len(transport.commands))
	}
}
