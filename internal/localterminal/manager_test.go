package localterminal

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"serverpilot/internal/domain"
)

func TestOpenWriteResizeAndCloseLocalTerminal(t *testing.T) {
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	manager := NewWithFactory(context.Background(), nil, emitter, factory)

	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	if opened.SessionID == "" || opened.Shell == "" || opened.Cwd == "" {
		t.Fatalf("opened=%+v", opened)
	}
	if len(manager.List()) != 1 {
		t.Fatalf("expected one session")
	}
	if err := manager.Write(domain.LocalTerminalWriteRequest{
		SessionID:  opened.SessionID,
		DataBase64: "YWJj",
	}); err != nil {
		t.Fatal(err)
	}
	if !eventually(time.Second, func() bool {
		return factory.pty.inputString() == "abc"
	}) {
		t.Fatalf("input=%q", factory.pty.inputString())
	}
	if err := manager.Resize(domain.LocalTerminalResizeRequest{SessionID: opened.SessionID, Cols: 120, Rows: 40}); err != nil {
		t.Fatal(err)
	}
	if factory.pty.cols != 120 || factory.pty.rows != 40 {
		t.Fatalf("resize cols=%d rows=%d", factory.pty.cols, factory.pty.rows)
	}

	manager.Close(opened.SessionID)
	manager.Close(opened.SessionID)
	if err := manager.Write(domain.LocalTerminalWriteRequest{SessionID: opened.SessionID, DataBase64: "ZA=="}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after close, got %v", err)
	}
	if stateEvents := emitter.statesFor(opened.SessionID); len(stateEvents) == 0 {
		t.Fatal("expected state events")
	}
}

func TestCloseAllLocalTerminals(t *testing.T) {
	manager := NewWithFactory(context.Background(), nil, &captureEmitter{}, newFakeFactory())
	first, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	if first.SessionID == second.SessionID {
		t.Fatal("session IDs must be unique")
	}
	manager.CloseAll()
	if states := manager.List(); len(states) != 0 {
		t.Fatalf("expected no sessions, got %+v", states)
	}
}

func TestMissingSessionErrors(t *testing.T) {
	manager := NewWithFactory(context.Background(), nil, &captureEmitter{}, newFakeFactory())
	if err := manager.Write(domain.LocalTerminalWriteRequest{SessionID: "missing", DataBase64: "YQ=="}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("write err=%v", err)
	}
	if err := manager.Resize(domain.LocalTerminalResizeRequest{SessionID: "missing", Cols: 80, Rows: 24}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("resize err=%v", err)
	}
	if _, err := manager.State("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("state err=%v", err)
	}
}

func TestUnsupportedFactoryReturnsChineseError(t *testing.T) {
	manager := NewWithFactory(context.Background(), nil, &captureEmitter{}, unsupportedFactory{})
	_, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("expected unsupported error, got %v", err)
	}
}

func TestCapabilitiesDefaultToEnabledWhenRuntimeAvailable(t *testing.T) {
	skipUnlessWindows(t, "local terminal capabilities are Windows ConPTY-specific")
	t.Setenv(ExperimentalEnv, "")
	capabilities := Capabilities(domain.LocalTerminalShellCmd)
	if !capabilities.Enabled || !capabilities.Supported {
		t.Fatalf("local terminal should be enabled when Windows Direct ConPTY is available: %+v", capabilities)
	}
	if capabilities.CurrentShellPreference != string(domain.LocalTerminalShellCmd) {
		t.Fatalf("capabilities = %+v", capabilities)
	}
	if ids := shellOptionIDs(capabilities.ShellOptions); !sameStrings(ids, []string{"cmd", "powershell"}) {
		t.Fatalf("windows shell options = %v", ids)
	}
	if ids := shellOptionIDs(capabilities.AdminShellOptions); !sameStrings(ids, []string{"cmd-admin", "powershell-admin"}) {
		t.Fatalf("windows admin shell options = %v", ids)
	}
	if !capabilities.ConPTYAvailable || !capabilities.SupportsElevation {
		t.Fatalf("windows ConPTY capability fields were not set: %+v", capabilities)
	}
}

func TestRuntimeAvailabilityUsesConPTYAndShellResolver(t *testing.T) {
	t.Setenv(ExperimentalEnv, "1")
	lookPath := func(existing map[string]string) lookPathFunc {
		return func(name string) (string, error) {
			if path, ok := existing[name]; ok {
				return path, nil
			}
			return "", os.ErrNotExist
		}
	}

	if !runtimeAvailableForPlatform("windows", lookPath(map[string]string{"cmd.exe": `C:\Windows\System32\cmd.exe`}), true) {
		t.Fatal("Windows with ConPTY and cmd should be available")
	}
	if runtimeAvailableForPlatform("windows", lookPath(map[string]string{"cmd.exe": `C:\Windows\System32\cmd.exe`}), false) {
		t.Fatal("Windows without ConPTY must be unavailable")
	}
	if runtimeAvailableForPlatform("windows", lookPath(nil), true) {
		t.Fatal("Windows without cmd or PowerShell must be unavailable")
	}
	t.Setenv("SHELL", "")
	if !runtimeAvailableForPlatform("darwin", lookPath(map[string]string{"/bin/zsh": "/bin/zsh"}), true) {
		t.Fatal("macOS with PTY support and zsh should be available")
	}
	if runtimeAvailableForPlatform("darwin", lookPath(nil), true) {
		t.Fatal("macOS without zsh or bash must be unavailable")
	}
}

func TestOutputEventCarriesSessionID(t *testing.T) {
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	manager := NewWithFactory(context.Background(), nil, emitter, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	factory.pty.emit("hello")
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if outputs := emitter.outputsFor(opened.SessionID); len(outputs) > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("expected output event with matching session ID")
}

func TestShellExitOnlyUpdatesLocalTerminalState(t *testing.T) {
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	manager := NewWithFactory(context.Background(), nil, emitter, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	factory.procs[0].finish(0)
	if !eventually(time.Second, func() bool {
		return hasLocalTerminalStatus(emitter.statesFor(opened.SessionID), domain.LocalTerminalExited)
	}) {
		t.Fatalf("states=%+v", emitter.statesFor(opened.SessionID))
	}
}

func TestCloseLocalTerminalDoesNotCancelManagerRootContext(t *testing.T) {
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()
	factory := newFakeFactory()
	manager := NewWithFactory(rootCtx, nil, &captureEmitter{}, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}

	manager.Close(opened.SessionID)

	if rootCtx.Err() != nil {
		t.Fatalf("manager root context was canceled by closing one local terminal: %v", rootCtx.Err())
	}
	if _, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80}); err != nil {
		t.Fatalf("manager should remain usable after closing one local terminal: %v", err)
	}
	manager.CloseAll()
}

func TestShellExitDoesNotCancelManagerRootContext(t *testing.T) {
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	manager := NewWithFactory(rootCtx, nil, emitter, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}

	factory.procs[0].finish(0)

	if !eventually(time.Second, func() bool {
		return hasLocalTerminalStatus(emitter.statesFor(opened.SessionID), domain.LocalTerminalExited)
	}) {
		t.Fatalf("states=%+v", emitter.statesFor(opened.SessionID))
	}
	if rootCtx.Err() != nil {
		t.Fatalf("manager root context was canceled by shell exit: %v", rootCtx.Err())
	}
	if _, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80}); err != nil {
		t.Fatalf("manager should remain usable after shell exit: %v", err)
	}
	manager.CloseAll()
}

func TestCloseOneLocalTerminalDoesNotAffectAnother(t *testing.T) {
	factory := newFakeFactory()
	manager := NewWithFactory(context.Background(), nil, &captureEmitter{}, factory)
	first, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}

	manager.Close(first.SessionID)

	if !eventually(time.Second, func() bool {
		states := manager.List()
		return len(states) == 1 && states[0].SessionID == second.SessionID
	}) {
		t.Fatalf("closing first session affected remaining sessions: %+v", manager.List())
	}
	if len(factory.ptys) < 2 {
		t.Fatalf("expected two PTYs, got %d", len(factory.ptys))
	}
	if factory.ptys[1].closed {
		t.Fatal("closing one local terminal closed another PTY")
	}
	if err := manager.Write(domain.LocalTerminalWriteRequest{SessionID: second.SessionID, DataBase64: "Yg=="}); err != nil {
		t.Fatalf("remaining local terminal should still accept input: %v", err)
	}
	if !eventually(time.Second, func() bool {
		return factory.ptys[1].inputString() == "b"
	}) {
		t.Fatalf("remaining input=%q", factory.ptys[1].inputString())
	}
	manager.CloseAll()
}

func TestPTYReadPanicIsRecoveredAndDoesNotEscapeGoroutine(t *testing.T) {
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	factory.panicOnRead = true
	manager := NewWithFactory(context.Background(), nil, emitter, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	if !eventually(time.Second, func() bool {
		return len(emitter.errorsFor(opened.SessionID)) > 0
	}) {
		t.Fatalf("expected sanitized error event, got states=%+v", emitter.statesFor(opened.SessionID))
	}
	if !eventually(time.Second, func() bool {
		return len(manager.List()) == 0
	}) {
		t.Fatalf("sessions=%+v", manager.List())
	}
}

func TestPTYWritePanicIsRecoveredAndDoesNotEscapeGoroutine(t *testing.T) {
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	factory.panicOnWrite = true
	manager := NewWithFactory(context.Background(), nil, emitter, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Write(domain.LocalTerminalWriteRequest{SessionID: opened.SessionID, DataBase64: "YQ=="}); err != nil {
		t.Fatal(err)
	}
	if !eventually(time.Second, func() bool {
		return len(emitter.errorsFor(opened.SessionID)) > 0
	}) {
		t.Fatalf("expected sanitized error event, got states=%+v", emitter.statesFor(opened.SessionID))
	}
}

func TestPTYWaitPanicIsRecoveredAndDoesNotEscapeGoroutine(t *testing.T) {
	emitter := &captureEmitter{}
	factory := newFakeFactory()
	factory.panicOnWait = true
	manager := NewWithFactory(context.Background(), nil, emitter, factory)
	opened, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	if !eventually(time.Second, func() bool {
		return hasLocalTerminalStatus(emitter.statesFor(opened.SessionID), domain.LocalTerminalFailed)
	}) {
		t.Fatalf("expected failed state, got states=%+v errors=%+v", emitter.statesFor(opened.SessionID), emitter.errorsFor(opened.SessionID))
	}
}

func TestEmitterPanicDoesNotEscapeLocalTerminalLifecycle(t *testing.T) {
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()
	factory := newFakeFactory()
	manager := NewWithFactory(rootCtx, nil, panicEmitter{}, factory)
	_, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}

	factory.pty.emit("hello")
	factory.procs[0].finish(0)

	if !eventually(time.Second, func() bool {
		return len(manager.List()) == 0
	}) {
		t.Fatalf("session did not finish after emitter panic: %+v", manager.List())
	}
	if rootCtx.Err() != nil {
		t.Fatalf("emitter panic canceled manager root context: %v", rootCtx.Err())
	}
	if _, err := manager.Open(domain.LocalTerminalOpenRequest{Shell: os.Args[0], Rows: 24, Cols: 80}); err != nil {
		t.Fatalf("manager should remain usable after emitter panic: %v", err)
	}
	manager.CloseAll()
}

func TestCapabilitiesExposePlatformShellOptions(t *testing.T) {
	windows := CapabilitiesForPlatform("windows", domain.LocalTerminalShellCmd, true, false, true)
	if windows.Platform != "windows" || !windows.Enabled || !windows.Supported || windows.CurrentShellPreference != "cmd" {
		t.Fatalf("windows capabilities = %+v", windows)
	}
	if ids := shellOptionIDs(windows.ShellOptions); !sameStrings(ids, []string{"cmd", "powershell"}) {
		t.Fatalf("windows shell options = %v", ids)
	}
	if ids := shellOptionIDs(windows.AdminShellOptions); !sameStrings(ids, []string{"cmd-admin", "powershell-admin"}) {
		t.Fatalf("windows admin shell options = %v", ids)
	}
	if windows.IsProcessElevated {
		t.Fatalf("test fixture explicitly passed non-elevated process: %+v", windows)
	}

	darwin := CapabilitiesForPlatform("darwin", domain.LocalTerminalShellPowerShell, true, false, true)
	if darwin.Platform != "darwin" || !darwin.Enabled || !darwin.Supported || darwin.CurrentShellPreference != "auto" {
		t.Fatalf("darwin capabilities = %+v", darwin)
	}
	if ids := shellOptionIDs(darwin.ShellOptions); !sameStrings(ids, []string{"local"}) {
		t.Fatalf("darwin shell options = %v", ids)
	}
	if len(darwin.AdminShellOptions) != 0 || darwin.SupportsElevation {
		t.Fatalf("darwin should not expose admin shell options: %+v", darwin)
	}
}

func TestCapabilitiesDoNotDependOnScreenshotSmoke(t *testing.T) {
	windows := CapabilitiesForPlatform("windows", domain.LocalTerminalShellAuto, true, false, true)
	if !windows.Enabled || !windows.Supported {
		t.Fatalf("Windows with Direct ConPTY and shell resolver must be supported without GUI smoke flag: %+v", windows)
	}
	if windows.UnsupportedMessage != "" {
		t.Fatalf("supported capability should not carry unsupported message: %+v", windows)
	}

	noConPTY := CapabilitiesForPlatform("windows", domain.LocalTerminalShellAuto, false, false, true)
	if noConPTY.Enabled || noConPTY.Supported || !strings.Contains(noConPTY.UnsupportedMessage, "Direct ConPTY") {
		t.Fatalf("Windows without ConPTY must be unsupported: %+v", noConPTY)
	}
}

func TestResolveShellKindForProductizedMenuEntries(t *testing.T) {
	lookPath := func(existing map[string]string) lookPathFunc {
		return func(name string) (string, error) {
			if path, ok := existing[name]; ok {
				return path, nil
			}
			return "", os.ErrNotExist
		}
	}

	cmd, err := resolveShellKindForPlatform("windows", "cmd", lookPath(map[string]string{
		"cmd.exe": `C:\Windows\System32\cmd.exe`,
	}))
	if err != nil || !windowsPathBaseEqual(cmd, "cmd.exe") {
		t.Fatalf("cmd shell=%q err=%v", cmd, err)
	}

	powerShell, err := resolveShellKindForPlatform("windows", "powershell", lookPath(map[string]string{
		"powershell.exe": `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
	}))
	if err != nil || !windowsPathBaseEqual(powerShell, "powershell.exe") {
		t.Fatalf("powershell shell=%q err=%v", powerShell, err)
	}

	if _, err := resolveShellKindForPlatform("windows", "invalid", lookPath(nil)); err == nil {
		t.Fatal("invalid shell kind was accepted")
	}
}

func TestResolveDarwinLocalShellPrefersUserShellThenZshThenBash(t *testing.T) {
	lookPath := func(existing map[string]string) lookPathFunc {
		return func(name string) (string, error) {
			if path, ok := existing[name]; ok {
				return path, nil
			}
			return "", os.ErrNotExist
		}
	}

	t.Setenv("SHELL", "/opt/homebrew/bin/fish")
	shell, err := resolveShellKindForPlatform("darwin", "local", lookPath(map[string]string{
		"/opt/homebrew/bin/fish": "/opt/homebrew/bin/fish",
		"/bin/zsh":               "/bin/zsh",
	}))
	if err != nil || shell != "/opt/homebrew/bin/fish" {
		t.Fatalf("darwin user shell=%q err=%v", shell, err)
	}

	t.Setenv("SHELL", "")
	shell, err = resolveShellKindForPlatform("darwin", "local", lookPath(map[string]string{
		"/bin/zsh": "/bin/zsh",
	}))
	if err != nil || shell != "/bin/zsh" {
		t.Fatalf("darwin zsh fallback=%q err=%v", shell, err)
	}

	shell, err = resolveShellKindForPlatform("darwin", "local", lookPath(map[string]string{
		"/bin/bash": "/bin/bash",
	}))
	if err != nil || shell != "/bin/bash" {
		t.Fatalf("darwin bash fallback=%q err=%v", shell, err)
	}
}

func TestResolveShellPreferences(t *testing.T) {
	lookPath := func(existing map[string]string) lookPathFunc {
		return func(name string) (string, error) {
			if path, ok := existing[name]; ok {
				return path, nil
			}
			return "", os.ErrNotExist
		}
	}

	shell, err := resolveShellForPlatform("windows", "powershell", lookPath(map[string]string{
		"powershell.exe": `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
	}))
	if err != nil || !windowsPathBaseEqual(shell, "powershell.exe") {
		t.Fatalf("powershell fallback shell=%q err=%v", shell, err)
	}

	shell, err = resolveShellForPlatform("windows", "cmd", lookPath(map[string]string{
		"pwsh.exe":       `C:\Program Files\PowerShell\7\pwsh.exe`,
		"powershell.exe": `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
		"cmd.exe":        `C:\Windows\System32\cmd.exe`,
	}))
	if err != nil || !windowsPathBaseEqual(shell, "cmd.exe") {
		t.Fatalf("cmd shell=%q err=%v", shell, err)
	}

	shell, err = resolveShellForPlatform("windows", "auto", lookPath(map[string]string{
		"pwsh.exe":       `C:\Program Files\PowerShell\7\pwsh.exe`,
		"powershell.exe": `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
		"cmd.exe":        `C:\Windows\System32\cmd.exe`,
	}))
	if err != nil || !windowsPathBaseEqual(shell, "pwsh.exe") {
		t.Fatalf("auto shell=%q err=%v", shell, err)
	}

	if _, err = resolveShellForPlatform("windows", "invalid", lookPath(nil)); err == nil {
		t.Fatal("invalid shell preference was accepted")
	}
}

func shellOptionIDs(options []domain.LocalTerminalShellOption) []string {
	ids := make([]string, 0, len(options))
	for _, option := range options {
		ids = append(ids, option.ID)
	}
	return ids
}

func skipUnlessWindows(t *testing.T, reason string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip(reason)
	}
}

func windowsPathBaseEqual(path string, base string) bool {
	normalized := strings.ReplaceAll(path, "/", `\`)
	index := strings.LastIndex(normalized, `\`)
	if index >= 0 {
		normalized = normalized[index+1:]
	}
	return strings.EqualFold(normalized, base)
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

type captureEmitter struct {
	mu      sync.Mutex
	outputs []domain.LocalTerminalOutputEvent
	states  []domain.LocalTerminalStateEvent
	errors  []domain.LocalTerminalErrorEvent
}

type panicEmitter struct{}

func (panicEmitter) Output(domain.LocalTerminalOutputEvent) {
	panic("simulated output emitter panic")
}

func (panicEmitter) State(domain.LocalTerminalStateEvent) {
	panic("simulated state emitter panic")
}

func (panicEmitter) Error(domain.LocalTerminalErrorEvent) {
	panic("simulated error emitter panic")
}

func (e *captureEmitter) Output(event domain.LocalTerminalOutputEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.outputs = append(e.outputs, event)
}

func (e *captureEmitter) State(event domain.LocalTerminalStateEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.states = append(e.states, event)
}

func (e *captureEmitter) Error(event domain.LocalTerminalErrorEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.errors = append(e.errors, event)
}

func (e *captureEmitter) outputsFor(sessionID string) []domain.LocalTerminalOutputEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []domain.LocalTerminalOutputEvent
	for _, event := range e.outputs {
		if event.SessionID == sessionID {
			out = append(out, event)
		}
	}
	return out
}

func (e *captureEmitter) statesFor(sessionID string) []domain.LocalTerminalStateEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []domain.LocalTerminalStateEvent
	for _, event := range e.states {
		if event.State.SessionID == sessionID {
			out = append(out, event)
		}
	}
	return out
}

func (e *captureEmitter) errorsFor(sessionID string) []domain.LocalTerminalErrorEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []domain.LocalTerminalErrorEvent
	for _, event := range e.errors {
		if event.SessionID == sessionID {
			out = append(out, event)
		}
	}
	return out
}

func hasLocalTerminalStatus(events []domain.LocalTerminalStateEvent, status domain.LocalTerminalStatus) bool {
	for _, event := range events {
		if event.State.Status == status {
			return true
		}
	}
	return false
}

type fakeFactory struct {
	mu           sync.Mutex
	ptys         []*fakePTY
	pty          *fakePTY
	procs        []*fakeProcess
	panicOnRead  bool
	panicOnWrite bool
	panicOnWait  bool
}

func newFakeFactory() *fakeFactory {
	return &fakeFactory{}
}

func (f *fakeFactory) Start(context.Context, string, string, int, int) (PTY, PTYProcess, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	proc := &fakeProcess{done: make(chan struct{}), panicOnWait: f.panicOnWait}
	term := &fakePTY{
		proc: proc, cols: 80, rows: 24,
		panicOnRead:  f.panicOnRead,
		panicOnWrite: f.panicOnWrite,
	}
	term.outR, term.outW = io.Pipe()
	f.pty = term
	f.ptys = append(f.ptys, term)
	f.procs = append(f.procs, proc)
	return term, proc, nil
}

type fakePTY struct {
	mu           sync.Mutex
	input        bytes.Buffer
	outR         *io.PipeReader
	outW         *io.PipeWriter
	proc         *fakeProcess
	cols         int
	rows         int
	closed       bool
	panicOnRead  bool
	panicOnWrite bool
}

func (p *fakePTY) Read(data []byte) (int, error) {
	if p.panicOnRead {
		panic("simulated pty read panic")
	}
	return p.outR.Read(data)
}

func (p *fakePTY) Write(data []byte) (int, error) {
	if p.panicOnWrite {
		panic("simulated pty write panic")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return 0, io.ErrClosedPipe
	}
	return p.input.Write(data)
}

func (p *fakePTY) inputString() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.input.String()
}

func (p *fakePTY) Resize(cols, rows int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cols = cols
	p.rows = rows
	return nil
}

func (p *fakePTY) Close() error {
	p.mu.Lock()
	alreadyClosed := p.closed
	p.closed = true
	p.mu.Unlock()
	if alreadyClosed {
		return nil
	}
	_ = p.outR.Close()
	_ = p.outW.Close()
	p.proc.finish(0)
	return nil
}

func (p *fakePTY) emit(value string) {
	_, _ = p.outW.Write([]byte(value))
}

type fakeProcess struct {
	once        sync.Once
	done        chan struct{}
	code        int
	panicOnWait bool
}

func (p *fakeProcess) Start() error {
	return nil
}

func (p *fakeProcess) Wait() error {
	if p.panicOnWait {
		panic("simulated process wait panic")
	}
	<-p.done
	return nil
}

func (p *fakeProcess) ExitCode() *int {
	return &p.code
}

func (p *fakeProcess) finish(code int) {
	p.once.Do(func() {
		p.code = code
		close(p.done)
	})
}

func eventually(timeout time.Duration, fn func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return fn()
}
