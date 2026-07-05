//go:build windows

package localterminal

import (
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsDirectConPTYAdapterUsesRequiredAPIs(t *testing.T) {
	source, err := os.ReadFile("process_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	required := []string{
		"CreatePseudoConsole",
		"ResizePseudoConsole",
		"ClosePseudoConsole",
		"StartupInfoEx",
		"PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE",
		"InitializeProcThreadAttributeList",
		"UpdateProcThreadAttribute",
		"DeleteProcThreadAttributeList",
		"CreateProcess",
		"EXTENDED_STARTUPINFO_PRESENT",
		"CREATE_NEW_PROCESS_GROUP",
		"UTF16PtrFromString",
		"os.Pipe",
	}
	for _, token := range required {
		if !strings.Contains(text, token) {
			t.Fatalf("Windows Direct ConPTY adapter must use %s", token)
		}
	}
}

func TestWindowsAdapterDoesNotBroadcastConsoleControlEvent(t *testing.T) {
	source, err := os.ReadFile("process_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if strings.Contains(text, "GenerateConsoleCtrlEvent") {
		t.Fatal("Windows local terminal adapter must not use GenerateConsoleCtrlEvent")
	}
	if strings.Contains(text, "CTRL_C_EVENT") || strings.Contains(text, "CTRL_BREAK_EVENT") {
		t.Fatal("Windows local terminal adapter must not send console control events")
	}
}

func TestEmbeddedPTYCreationFlagsUseIndependentProcessGroup(t *testing.T) {
	if embeddedPTYCreationFlags&windows.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatal("Windows local terminal must use CREATE_NEW_PROCESS_GROUP")
	}
	if embeddedPTYCreationFlags&windows.CREATE_NO_WINDOW != 0 {
		t.Fatal("CREATE_NO_WINDOW breaks ConPTY input/output on this Windows runtime")
	}
}

func TestDirectConPTYCmdEchoSmoke(t *testing.T) {
	cmdPath, err := resolveShellForPlatform("windows", "cmd", func(name string) (string, error) {
		return filepath.Join(os.Getenv("SystemRoot"), "System32", name), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	term, process, err := startPlatformPTY(t.Context(), cmdPath, os.TempDir(), 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer term.Close()

	if err := term.Resize(100, 30); err != nil {
		t.Fatalf("ResizePseudoConsole failed: %v", err)
	}

	const marker = "serverpilot-conpty-unit-smoke"
	if _, err := term.Write([]byte("echo " + marker + "\r\n")); err != nil {
		t.Fatalf("write to ConPTY failed: %v", err)
	}

	output := readUntilMarker(t, term, marker, 5*time.Second)
	if !strings.Contains(output, marker) {
		if current, ok := term.(*conptySession); ok {
			running := false
			if current.process != 0 {
				running, _ = processStillRunning(current.process)
			}
			t.Logf("conpty cmd smoke diagnostics: pid=%d running=%t exitCode=%v", current.PID(), running, current.ExitCode())
		}
		t.Fatalf("ConPTY output did not contain marker; output=%q", output)
	}

	if _, err := term.Write([]byte("exit\r\n")); err != nil {
		t.Fatalf("write exit to ConPTY failed: %v", err)
	}
	if err := waitForProcess(process, 5*time.Second); err != nil && !errors.Is(err, ErrNotFound) {
		t.Fatalf("wait failed: %v", err)
	}
}

func TestDirectConPTYPowershellEchoSmoke(t *testing.T) {
	powershellPath, err := resolveShellForPlatform("windows", "powershell", exec.LookPath)
	if err != nil {
		t.Fatal(err)
	}
	term, process, err := startPlatformPTY(t.Context(), powershellPath, os.TempDir(), 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer term.Close()

	const marker = "serverpilot-conpty-powershell-unit-smoke"
	if _, err := term.Write([]byte("Write-Output " + marker + "\r\n")); err != nil {
		t.Fatalf("write to ConPTY failed: %v", err)
	}

	output := readUntilMarker(t, term, marker, 8*time.Second)
	if !strings.Contains(output, marker) {
		t.Fatalf("ConPTY PowerShell output did not contain marker; output=%q", output)
	}

	if _, err := term.Write([]byte("exit\r\n")); err != nil {
		t.Fatalf("write exit to ConPTY failed: %v", err)
	}
	if err := waitForProcess(process, 8*time.Second); err != nil && !errors.Is(err, ErrNotFound) {
		t.Fatalf("wait failed: %v", err)
	}
}

func waitForProcess(process PTYProcess, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() {
		done <- process.Wait()
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		return errors.New("process wait timed out")
	}
}

func readUntilMarker(t *testing.T, term PTY, marker string, timeout time.Duration) string {
	t.Helper()
	done := make(chan string, 1)
	go func() {
		var builder strings.Builder
		buffer := make([]byte, 4096)
		for {
			n, err := term.Read(buffer)
			if n > 0 {
				builder.Write(buffer[:n])
				if strings.Contains(builder.String(), marker) {
					done <- builder.String()
					return
				}
			}
			if err != nil {
				done <- builder.String()
				return
			}
		}
	}()
	select {
	case output := <-done:
		return output
	case <-time.After(timeout):
		return ""
	}
}

func TestLocalTerminalOutputBase64RoundTrip(t *testing.T) {
	payload := []byte("serverpilot-local-terminal")
	encoded := base64.StdEncoding.EncodeToString(payload)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(payload) {
		t.Fatal("base64 output contract changed")
	}
}
