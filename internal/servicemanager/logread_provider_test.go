package servicemanager

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestLogreadSnapshotCommandIsBoundedAndHasNoServiceInput(t *testing.T) {
	command := logreadSnapshotCommand(999)
	for _, token := range []string{"command -v logread", "logread", "tail -n 800", "dd bs=1"} {
		if !strings.Contains(command, token) {
			t.Fatalf("command missing %q: %s", token, command)
		}
	}
	for _, forbidden := range []string{"dropbear", "grep", "awk", "sed"} {
		if strings.Contains(command, forbidden) {
			t.Fatalf("command must not include service/filter logic %q: %s", forbidden, command)
		}
	}
}

func TestParseLogreadOutputFiltersByServiceAndKeepsTail(t *testing.T) {
	output := strings.Join([]string{
		"Fri Jul  3 10:00:00 2026 daemon.info dropbear[100]: synthetic old line",
		"Fri Jul  3 10:01:00 2026 daemon.info dnsmasq[44]: synthetic dns line",
		"Fri Jul  3 10:02:00 2026 daemon.err dropbear[101]: synthetic failure line",
		"Fri Jul  3 10:03:00 2026 daemon.debug dropbear[102]: synthetic debug line",
	}, "\n")
	lines, fallback, err := parseLogreadOutput("dropbear", output, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !fallback || len(lines) != 2 {
		t.Fatalf("lines=%+v fallback=%v", lines, fallback)
	}
	if lines[0].Message != "synthetic failure line" || lines[0].Priority != 3 || lines[0].Identifier != "dropbear" || lines[0].PID != "101" {
		t.Fatalf("error line = %+v", lines[0])
	}
	if lines[1].Message != "synthetic debug line" || lines[1].Priority != 7 {
		t.Fatalf("debug line = %+v", lines[1])
	}
}

func TestParseLogreadOutputHandlesUnavailablePermissionAndEmpty(t *testing.T) {
	if _, _, err := parseLogreadOutput("dropbear", "/bin/sh: logread: not found", 100); err == nil || !strings.Contains(strings.ToLower(err.Error()), "logread") {
		t.Fatalf("missing logread err = %v", err)
	}
	if _, _, err := parseLogreadOutput("dropbear", "logread: permission denied", 100); err == nil || !strings.Contains(strings.ToLower(err.Error()), "permission") {
		t.Fatalf("permission err = %v", err)
	}
	lines, fallback, err := parseLogreadOutput("dropbear", "Fri Jul  3 10:01:00 2026 daemon.info dnsmasq[44]: synthetic dns line", 100)
	if err != nil || !fallback || len(lines) != 0 {
		t.Fatalf("empty filtered output lines=%+v fallback=%v err=%v", lines, fallback, err)
	}
}

func TestReadLogreadSnapshotMapsTimeoutAndRemoteErrors(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{},
		errors: map[string]error{
			logreadSnapshotCommand(100): context.DeadlineExceeded,
		},
	}
	_, _, err := readLogreadSnapshot(context.Background(), transport, "dropbear", 100)
	if err == nil || err.Error() != logreadTimeoutMessage {
		t.Fatalf("timeout err = %v", err)
	}

	transport = &fakeTransport{
		responses: map[string]string{},
		errors: map[string]error{
			logreadSnapshotCommand(100): errors.New("remote command failed: hostdeck-logread-missing"),
		},
	}
	_, _, err = readLogreadSnapshot(context.Background(), transport, "dropbear", 100)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "logread") {
		t.Fatalf("missing err = %v", err)
	}
}

func TestParseLogreadOutputEnforcesMaxBytesAndMessageTruncation(t *testing.T) {
	huge := strings.Repeat("x", maxLogreadOutputBytes+1024)
	output := "Fri Jul  3 10:00:00 2026 daemon.info dropbear[100]: " + huge
	lines, _, err := parseLogreadOutput("dropbear", output, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 1 || !lines[0].Truncated || len(lines[0].Message) > maxJournalMessageBytes+128 {
		t.Fatalf("line was not bounded: count=%d line=%+v", len(lines), lines)
	}
}
