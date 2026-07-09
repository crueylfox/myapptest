package networkdiag

import (
	"strings"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

func TestBuildCommandRejectsInjectedTarget(t *testing.T) {
	_, err := BuildCommand(domain.StartNetworkDiagnosticRequest{
		ServerID: 1,
		Type:     domain.NetworkDiagnosticPing,
		Target:   "example.com;cat /etc/passwd",
	})
	if err == nil {
		t.Fatal("injected target was accepted")
	}
}

func TestBuildTCPCommandValidatesPort(t *testing.T) {
	_, err := BuildCommand(domain.StartNetworkDiagnosticRequest{
		ServerID: 1,
		Type:     domain.NetworkDiagnosticTCP,
		Target:   "example.com",
		Port:     70000,
	})
	if err == nil {
		t.Fatal("invalid TCP port was accepted")
	}
}

func TestBuildCommandsContainFallbacksAndQuotedTarget(t *testing.T) {
	tests := []struct {
		name     string
		request  domain.StartNetworkDiagnosticRequest
		contains []string
	}{
		{
			name: "ping",
			request: domain.StartNetworkDiagnosticRequest{
				ServerID: 1, Type: domain.NetworkDiagnosticPing, Target: "example.com",
			},
			contains: []string{"ping -c 4 -W 3", "ping -c 4", "target='example.com'"},
		},
		{
			name: "traceroute",
			request: domain.StartNetworkDiagnosticRequest{
				ServerID: 1, Type: domain.NetworkDiagnosticTraceroute, Target: "example.com",
			},
			contains: []string{"traceroute", "tracepath", "改用 ping"},
		},
		{
			name: "dns",
			request: domain.StartNetworkDiagnosticRequest{
				ServerID: 1, Type: domain.NetworkDiagnosticDNS, Target: "example.com",
			},
			contains: []string{"getent hosts", "nslookup", "dig"},
		},
		{
			name: "tcp",
			request: domain.StartNetworkDiagnosticRequest{
				ServerID: 1, Type: domain.NetworkDiagnosticTCP, Target: "example.com", Port: 443,
			},
			contains: []string{"nc -vz -w 3", "nc -z -w 3", "/dev/tcp"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command, err := BuildCommand(test.request)
			if err != nil {
				t.Fatal(err)
			}
			for _, expected := range test.contains {
				if !strings.Contains(command, expected) {
					t.Fatalf("command missing %q:\n%s", expected, command)
				}
			}
			if !strings.Contains(command, ExitMarker()) {
				t.Fatalf("command missing exit marker:\n%s", command)
			}
		})
	}
}

func TestCommandTimeoutsAreBounded(t *testing.T) {
	got := CommandTimeout(domain.StartNetworkDiagnosticRequest{
		Type:           domain.NetworkDiagnosticPing,
		Count:          100,
		TimeoutSeconds: 100,
	})
	if got != 310*time.Second {
		t.Fatalf("timeout=%s", got)
	}
}

func TestStripExitMarker(t *testing.T) {
	lines, code := StripExitMarker("one\n__SERVERPILOT_DIAG_EXIT__=7\n")
	if code != 7 || len(lines) != 1 || lines[0] != "one" {
		t.Fatalf("lines=%+v code=%d", lines, code)
	}
}
