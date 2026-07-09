package servicemanager

import (
	"strings"
	"testing"

	"hostdeck/internal/domain"
)

func TestParseCapability(t *testing.T) {
	capability := parseCapability(7, "systemd 252 (252.38-1~deb12u1)\n---SERVERPILOT-PRIVILEGE---\nsudo\n")
	if !capability.Available ||
		capability.InitSystem != domain.ServiceManagerInitSystemSystemd ||
		capability.SystemdVersion != "252" ||
		!capability.CanManage ||
		!capability.RequiresPrivilege {
		t.Fatalf("capability = %+v", capability)
	}

	unsupported := parseCapability(7, "unsupported\n")
	if unsupported.Available ||
		unsupported.InitSystem != domain.ServiceManagerInitSystemUnsupported ||
		unsupported.Error != serviceManagerUnsupportedMessage {
		t.Fatalf("unsupported capability = %+v", unsupported)
	}

	viewOnly := parseCapability(7, "systemd 252\n---SERVERPILOT-PRIVILEGE---\nnone\n")
	if !viewOnly.Available || viewOnly.CanManage || !viewOnly.RequiresPrivilege || viewOnly.Error != permissionMessage {
		t.Fatalf("view-only capability = %+v", viewOnly)
	}
}

func TestParseSystemdServiceListMergesUnitFilesAndKeepsDescriptions(t *testing.T) {
	output := strings.Join([]string{
		"nginx.service loaded active running A high performance web server",
		"sshd.service loaded inactive dead OpenSSH server daemon",
		"bad malformed",
		unitFileSeparator,
		"nginx.service enabled enabled",
		"sshd.service disabled enabled",
		"orphan.service static -",
	}, "\n")
	services := parseSystemdServiceList(9, output)
	if len(services) != 3 {
		t.Fatalf("services = %+v", services)
	}
	if services[0].UnitName != "nginx.service" ||
		services[0].Description != "A high performance web server" ||
		services[0].ActiveStateLabel != "运行中" ||
		services[0].UnitFileStateLabel != "已启用" ||
		!services[0].IsActive ||
		!services[0].IsEnabled {
		t.Fatalf("nginx service = %+v", services[0])
	}
	if services[1].UnitName != "orphan.service" ||
		services[1].UnitFileStateLabel != "静态" ||
		services[1].ActiveStateLabel != "未知" {
		t.Fatalf("orphan service = %+v", services[1])
	}
	if services[2].UnitName != "sshd.service" ||
		services[2].ActiveStateLabel != "已停止" ||
		!services[2].Critical {
		t.Fatalf("sshd service = %+v", services[2])
	}
}

func TestParseSystemdServiceListEmptyAndMalformedAreSafe(t *testing.T) {
	if services := parseSystemdServiceList(1, "not enough\n\n"+unitFileSeparator+"\nmalformed"); services == nil || len(services) != 0 {
		t.Fatalf("services = %#v", services)
	}
}

func TestStateMappings(t *testing.T) {
	activeTests := map[[2]string]string{
		{"active", "running"}:     "运行中",
		{"active", "exited"}:      "已启动",
		{"inactive", "dead"}:      "已停止",
		{"failed", "failed"}:      "失败",
		{"activating", "start"}:   "启动中",
		{"deactivating", "stop"}:  "停止中",
		{"reloading", "reload"}:   "重载中",
		{"unknown", "surprising"}: "未知",
		{"", ""}:                  "未知",
	}
	for input, want := range activeTests {
		if got := activeStateLabel(input[0], input[1]); got != want {
			t.Fatalf("activeStateLabel(%q,%q)=%q want %q", input[0], input[1], got, want)
		}
	}
	fileTests := map[string]string{
		"enabled":   "已启用",
		"disabled":  "已禁用",
		"static":    "静态",
		"masked":    "已屏蔽",
		"indirect":  "间接启用",
		"generated": "自动生成",
		"transient": "临时",
		"":          "未知",
	}
	for input, want := range fileTests {
		if got := unitFileStateLabel(input); got != want {
			t.Fatalf("unitFileStateLabel(%q)=%q want %q", input, got, want)
		}
	}
}

func TestParseSystemdServiceDetailHandlesMissingOptionalFields(t *testing.T) {
	detail := parseSystemdServiceDetail(7, "nginx.service", strings.Join([]string{
		"Id=nginx.service",
		"Description=A high performance web server",
		"LoadState=loaded",
		"ActiveState=active",
		"SubState=running",
		"UnitFileState=enabled",
		"MainPID=123",
		"FragmentPath=/lib/systemd/system/nginx.service",
		"Result=success",
		"ActiveEnterTimestamp=Sun 2026-06-21 11:59:59 CST",
		"ExecMainStartTimestamp=Sun 2026-06-21 12:00:00 CST",
	}, "\n"))
	if detail.UnitName != "nginx.service" || detail.MainPID != 123 || detail.MemoryCurrentBytes != nil {
		t.Fatalf("detail = %+v", detail)
	}
	if detail.StartedAt != "Sun 2026-06-21 12:00:00 CST" || detail.ActiveStateLabel != "运行中" {
		t.Fatalf("detail time/state = %+v", detail)
	}
	detail = mergeSystemdOptionalDetail(detail, strings.Join([]string{
		"MemoryCurrent=[not set]",
		"CPUUsageNSec=456789",
		"TasksCurrent=12",
		"NRestarts=3",
	}, "\n"))
	if detail.CPUUsageNSec == nil || *detail.CPUUsageNSec != 456789 ||
		detail.TasksCurrent == nil || *detail.TasksCurrent != 12 ||
		detail.RestartCount == nil || *detail.RestartCount != 3 {
		t.Fatalf("detail optional = %+v", detail)
	}
}

func TestParseSystemd219BaseDetailAndFallback(t *testing.T) {
	detail := parseSystemdServiceDetail(7, "docker.service", strings.Join([]string{
		"Id=docker.service",
		"Description=Docker Application Container Engine",
		"LoadState=loaded",
		"ActiveState=active",
		"SubState=running",
		"UnitFileState=enabled",
		"MainPID=1234",
		"FragmentPath=/usr/lib/systemd/system/docker.service",
		"Result=success",
		"ActiveEnterTimestamp=Sun 2026-06-21 12:00:00 CST",
	}, "\n"))
	if detail.UnitName != "docker.service" ||
		detail.Description != "Docker Application Container Engine" ||
		detail.MainPID != 1234 ||
		detail.StartedAt != "Sun 2026-06-21 12:00:00 CST" {
		t.Fatalf("systemd 219 detail = %+v", detail)
	}
	detail = mergeSystemdOptionalDetail(detail, "MemoryCurrent=[not set]\nCPUUsageNSec=\n")
	if !detail.Partial || len(detail.Warnings) != 1 || detail.MemoryCurrentBytes != nil || detail.CPUUsageNSec != nil {
		t.Fatalf("systemd 219 optional partial = %+v", detail)
	}

	fallback := parseSystemdFallbackDetail(7, "ssh.service", strings.Join([]string{
		fallbackActiveSeparator,
		"active",
		fallbackEnabledSeparator,
		"static",
		fallbackShowSeparator,
		"Id=ssh.service",
		"LoadState=loaded",
		"MainPID=0",
		"FragmentPath=/lib/systemd/system/ssh.service",
		"Result=success",
	}, "\n"))
	if fallback.UnitName != "ssh.service" ||
		fallback.ActiveStateLabel != "运行中" ||
		fallback.UnitFileStateLabel != "静态" ||
		fallback.MainPID != 0 ||
		!fallback.Partial {
		t.Fatalf("fallback = %+v", fallback)
	}
}

func TestValidateUnitNameRejectsInjectionAndPaths(t *testing.T) {
	valid := []string{"nginx.service", "foo@bar:baz.service", `foo\bar.service`}
	for _, value := range valid {
		if got, err := validateUnitName(value); err != nil || got != value {
			t.Fatalf("valid unit %q -> %q %v", value, got, err)
		}
	}
	invalid := []string{
		"",
		"nginx",
		"nginx.timer",
		"bad unit.service",
		"../nginx.service",
		"/etc/systemd/system/nginx.service",
		"nginx.service;reboot",
		"nginx.service|cat",
		"nginx.service\nwhoami",
		"nginx.service$USER",
	}
	for _, value := range invalid {
		if _, err := validateUnitName(value); err == nil {
			t.Fatalf("invalid unit %q was accepted", value)
		}
	}
}

func TestSystemdCommandsUseQuotedUnitAndDoNotReadSensitiveProperties(t *testing.T) {
	rootCommand := systemctlActionCommand("restart", "nginx.service", true)
	if rootCommand != "LC_ALL=C systemctl restart -- 'nginx.service'" {
		t.Fatalf("root command = %q", rootCommand)
	}
	sudoCommand := systemctlActionCommand("restart", "nginx.service", false)
	if sudoCommand != "LC_ALL=C sudo -n systemctl restart -- 'nginx.service'" {
		t.Fatalf("sudo command = %q", sudoCommand)
	}
	detailCommand := systemdBaseDetailCommand("nginx.service")
	for _, forbidden := range []string{"Environment", "EnvironmentFiles", "ExecStart"} {
		if strings.Contains(detailCommand, forbidden) {
			t.Fatalf("detail command reads forbidden property %q: %s", forbidden, detailCommand)
		}
	}
	for _, optional := range []string{"MemoryCurrent", "CPUUsageNSec", "TasksCurrent", "NRestarts"} {
		if strings.Contains(detailCommand, optional) {
			t.Fatalf("base detail command includes optional property %q: %s", optional, detailCommand)
		}
	}
	if !strings.Contains(detailCommand, "-p Id") || !strings.Contains(detailCommand, "-p ActiveEnterTimestamp") {
		t.Fatalf("base detail command does not use legacy-compatible -p properties: %s", detailCommand)
	}
	if !strings.Contains(detailCommand, "-- 'nginx.service'") {
		t.Fatalf("detail command does not separate unit with --: %s", detailCommand)
	}
	optionalCommand := systemdOptionalDetailCommand("nginx.service")
	if !strings.Contains(optionalCommand, "-p CPUUsageNSec") || !strings.Contains(optionalCommand, "-- 'nginx.service'") {
		t.Fatalf("optional detail command = %s", optionalCommand)
	}
}
