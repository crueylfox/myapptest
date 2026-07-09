package servicemanager

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

func TestParseProcdCapability(t *testing.T) {
	output := strings.Join([]string{
		"openwrt-procd",
		procdReleaseSeparator,
		"DISTRIB_ID='ImmortalWrt'",
		"DISTRIB_RELEASE='24.10'",
		"DISTRIB_DESCRIPTION='ImmortalWrt 24.10 r1'",
		procdOSSeparator,
		`NAME="ImmortalWrt"`,
		procdLogreadSeparator,
		"available",
		privilegeSeparator,
		"root",
	}, "\n")
	capability := parseProcdCapability(7, output)
	if !capability.Available ||
		capability.InitSystem != domain.ServiceManagerInitSystemOpenWrtProcd ||
		capability.DisplayName != "ImmortalWrt procd 24.10" ||
		!capability.CanManage ||
		!capability.SupportsJournal ||
		capability.SupportsLiveLogs ||
		capability.SupportsResourceMetrics {
		t.Fatalf("capability = %+v", capability)
	}

	viewOnly := parseProcdCapability(7, strings.Join([]string{
		"openwrt-procd",
		procdReleaseSeparator,
		"DISTRIB_ID='OpenWrt'",
		"DISTRIB_RELEASE='23.05'",
		procdLogreadSeparator,
		"missing",
		privilegeSeparator,
		"none",
	}, "\n"))
	if !viewOnly.Available || viewOnly.CanManage || viewOnly.SupportsJournal || viewOnly.Error != procdPermissionMessage {
		t.Fatalf("view-only capability = %+v", viewOnly)
	}
}

func TestManagerCheckDetectsProcdAfterSystemdFails(t *testing.T) {
	transport := &fakeTransport{
		responses: map[string]string{
			procdCapabilityCommand: strings.Join([]string{
				"openwrt-procd",
				procdReleaseSeparator,
				"DISTRIB_ID='OpenWrt'",
				"DISTRIB_RELEASE='23.05'",
				procdLogreadSeparator,
				"available",
				privilegeSeparator,
				"root",
			}, "\n"),
		},
		errors: map[string]error{
			systemdCapabilityCommand: errors.New("remote command failed: systemctl: not found"),
		},
	}
	capability, err := NewWithDialer(context.Background(), nil, nil, func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
		return transport, 0, nil
	}).Check(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if capability.InitSystem != domain.ServiceManagerInitSystemOpenWrtProcd || capability.DisplayName != "OpenWrt procd 23.05" {
		t.Fatalf("capability = %+v", capability)
	}
}

func TestParseProcdServiceList(t *testing.T) {
	output := strings.Join([]string{
		"dropbear\t0\t0",
		"network\t1\t0",
		"custom.service\t2\t2",
		".hidden\t0\t0",
		"bad/name\t0\t0",
		"bad malformed",
	}, "\n")
	services := parseProcdServiceList(9, output)
	if len(services) != 3 {
		t.Fatalf("services = %+v", services)
	}
	if services[0].ServiceID != "custom.service" ||
		services[0].ActiveStateLabel != "未知" ||
		services[0].UnitFileStateLabel != "未知" {
		t.Fatalf("custom service = %+v", services[0])
	}
	if services[1].ServiceID != "dropbear" ||
		services[1].DisplayName != "dropbear" ||
		!services[1].IsActive ||
		!services[1].IsEnabled ||
		!services[1].Critical {
		t.Fatalf("dropbear = %+v", services[1])
	}
	if services[2].ServiceID != "network" ||
		services[2].ActiveStateLabel != "已停止" ||
		!services[2].IsEnabled {
		t.Fatalf("network = %+v", services[2])
	}
}

func TestValidateProcdServiceIDRejectsInjectionAndTraversal(t *testing.T) {
	valid := []string{"dropbear", "uhttpd", "foo_bar", "svc@1.2+3-4"}
	for _, value := range valid {
		if got, err := validateProcdServiceID(value); err != nil || got != value {
			t.Fatalf("valid service %q -> %q %v", value, got, err)
		}
	}
	invalid := []string{
		"",
		"../network",
		"bad/name",
		`bad\name`,
		"bad name",
		"dropbear;reboot",
		"dropbear|cat",
		"dropbear$USER",
		"dropbear\nwhoami",
		"dropbear*",
		"dropbear[0]",
	}
	for _, value := range invalid {
		if _, err := validateProcdServiceID(value); err == nil {
			t.Fatalf("invalid service %q was accepted", value)
		}
	}
}

func TestProcdDetailAndActionCommandsDoNotReadScriptContent(t *testing.T) {
	detailCommand := procdDetailCommand("dropbear")
	for _, forbidden := range []string{"cat /etc/init.d", "grep", "procd_set_param", "ps "} {
		if strings.Contains(detailCommand, forbidden) {
			t.Fatalf("detail command reads forbidden content %q: %s", forbidden, detailCommand)
		}
	}
	rootCommand, err := procdActionCommand("restart", "dropbear", true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rootCommand, `exec "$script" restart`) || strings.Contains(rootCommand, "sudo -S") {
		t.Fatalf("root action command = %s", rootCommand)
	}
	sudoCommand, err := procdActionCommand("disable", "dropbear", false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sudoCommand, `sudo -n "$script" disable`) || strings.Contains(sudoCommand, "sudo -S") {
		t.Fatalf("sudo action command = %s", sudoCommand)
	}
	if _, err := procdActionCommand("reload;reboot", "dropbear", true); err == nil {
		t.Fatal("invalid action was accepted")
	}
}

func TestManagerProcdListDetailAndAction(t *testing.T) {
	procdCapability := strings.Join([]string{
		"openwrt-procd",
		procdReleaseSeparator,
		"DISTRIB_ID='OpenWrt'",
		"DISTRIB_RELEASE='23.05'",
		procdLogreadSeparator,
		"available",
		privilegeSeparator,
		"root",
	}, "\n")
	detailOutput := strings.Join([]string{
		"State=ok",
		"ServiceID=dropbear",
		"ScriptPath=/etc/init.d/dropbear",
		"RunningCode=0",
		"EnabledCode=0",
	}, "\n")
	actionCommand, err := procdActionCommand("restart", "dropbear", true)
	if err != nil {
		t.Fatal(err)
	}
	transport := &fakeTransport{
		responses: map[string]string{
			procdCapabilityCommand:         procdCapability,
			procdListCommand:               "dropbear\t0\t0\nsystem\t0\t0\n",
			procdDetailCommand("dropbear"): detailOutput,
			idUserCommand:                  "0\n",
			actionCommand:                  "",
		},
		errors: map[string]error{
			systemdCapabilityCommand: errors.New("remote command failed: systemctl: not found"),
		},
	}
	manager := NewWithDialer(context.Background(), nil, nil, func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
	capability, err := manager.Check(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if capability.InitSystem != domain.ServiceManagerInitSystemOpenWrtProcd {
		t.Fatalf("capability = %+v", capability)
	}
	list, err := manager.List(testConnection(), domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Services) != 2 || !list.Services[1].Protected {
		t.Fatalf("list = %+v", list.Services)
	}
	detail, err := manager.Detail(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, ServiceID: "dropbear"})
	if err != nil {
		t.Fatal(err)
	}
	if detail.ScriptPath != "/etc/init.d/dropbear" || !detail.Partial || detail.MemoryCurrentBytes != nil {
		t.Fatalf("detail = %+v", detail)
	}
	response, err := manager.Restart(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, ServiceID: "dropbear"})
	if err != nil || !response.Success || response.ServiceID != "dropbear" {
		t.Fatalf("response=%+v err=%v", response, err)
	}
	if _, err := manager.Stop(testConnection(), domain.AuthRequest{}, domain.SystemServiceActionRequest{ServerID: 7, ServiceID: "system"}); err == nil {
		t.Fatal("protected procd service action was accepted")
	}
}

func TestProcdCapabilityUsesLogreadWhenCached(t *testing.T) {
	command := logreadSnapshotCommand(200)
	transport := &fakeTransport{
		responses: map[string]string{
			command: strings.Join([]string{
				"Fri Jul  3 10:00:00 2026 daemon.info dropbear[1234]: synthetic accepted connection",
				"Fri Jul  3 10:01:00 2026 daemon.info dnsmasq[44]: synthetic dns event",
			}, "\n"),
		},
		errors: map[string]error{},
	}
	manager := testManager(context.Background(), transport)
	manager.cacheCapability(domain.ServiceManagerCapability{
		ServerID:         7,
		Available:        true,
		InitSystem:       domain.ServiceManagerInitSystemOpenWrtProcd,
		SupportsJournal:  true,
		SupportsLiveLogs: false,
	})
	response, err := manager.Journal(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID:  7,
		UnitName:  "dropbear",
		Priority:  "all",
		LineLimit: 200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Lines) != 1 || response.Lines[0].Identifier != "dropbear" || !strings.Contains(response.Lines[0].Message, "accepted") {
		t.Fatalf("response = %+v", response)
	}
	if strings.Contains(transport.commandLog(), "journalctl") {
		t.Fatalf("journalctl was called: %s", transport.commandLog())
	}
	if !transport.saw(command) {
		t.Fatalf("logread command was not called: %s", transport.commandLog())
	}
}

func TestProcdJournalRejectsInjectionBeforeCommand(t *testing.T) {
	transport := &fakeTransport{responses: map[string]string{}, errors: map[string]error{}}
	manager := testManager(context.Background(), transport)
	manager.cacheCapability(domain.ServiceManagerCapability{
		ServerID:        7,
		Available:       true,
		InitSystem:      domain.ServiceManagerInitSystemOpenWrtProcd,
		SupportsJournal: true,
	})
	_, err := manager.Journal(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID: 7,
		UnitName: "dropbear;reboot",
	})
	if err == nil {
		t.Fatal("expected invalid service name")
	}
	if transport.commandLog() != "" {
		t.Fatalf("unexpected command after invalid service name: %s", transport.commandLog())
	}
}

func TestProcdStartJournalFollowReturnsLogreadUnsupportedWithoutCommand(t *testing.T) {
	transport := &fakeTransport{responses: map[string]string{}, errors: map[string]error{}}
	manager := testManager(context.Background(), transport)
	manager.cacheCapability(domain.ServiceManagerCapability{
		ServerID:          7,
		Available:         true,
		InitSystem:        domain.ServiceManagerInitSystemOpenWrtProcd,
		SupportsJournal:   true,
		SupportsLiveLogs:  false,
		SupportsStart:     true,
		SupportsStop:      true,
		SupportsRestart:   true,
		SupportsEnable:    true,
		SupportsDisable:   true,
		CanManage:         true,
		RequiresPrivilege: false,
	})

	_, err := manager.StartJournalFollow(testConnection(), domain.AuthRequest{}, domain.SystemServiceJournalRequest{
		ServerID:        7,
		UnitName:        "dropbear",
		Priority:        "all",
		LineLimit:       200,
		CurrentBootOnly: true,
	})
	if err == nil || err.Error() != logreadFollowUnsupportedMessage {
		t.Fatalf("follow err = %v", err)
	}
	if transport.commandLog() != "" {
		t.Fatalf("unexpected command for unsupported follow: %s", transport.commandLog())
	}
}
