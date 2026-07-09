package linuxmonitor

import (
	"strings"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

const collectionFixture = `@@CPU
cpu 100 0 50 850 0 0 0 0
@@MEM
MemTotal: 1000 kB
MemAvailable: 400 kB
SwapTotal: 100 kB
SwapFree: 50 kB
@@IFACE
eth0
@@RX
1000
@@TX
2000
@@DF
Filesystem 1-blocks Used Available Capacity Mounted on
/dev/vda1 10000 4000 6000 40% /
/dev/vdb1 20000 5000 15000 25% /data
@@PROCESSES
101 12.5 3.2 java
202 4.0 1.1 nginx
@@LOAD
0.10 0.20 0.30 1/10 20
@@UPTIME
123.5 1.0
@@OS
PRETTY_NAME="Rocky Linux 9.5"
@@UNAME
Linux 5.14.0
@@ARCH
x86_64
@@END
`

const collectionNetworkFixture = `@@CPU
cpu 100 0 50 850 0 0 0 0
@@MEM
MemTotal: 1000 kB
MemAvailable: 400 kB
@@IFACE
eth0
@@PROC_NET_DEV
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
  ens3: 3000 30 0 0 0 0 0 0 5000 50 0 0 0 0 0 0
@@DF
Filesystem 1-blocks Used Available Capacity Mounted on
/dev/vda1 10000 4000 6000 40% /
@@PROCESSES
mode=unsupported
@@LOAD
0.10 0.20 0.30 1/10 20
@@UPTIME
123.5 1.0
@@OS
PRETTY_NAME="Rocky Linux 9.5"
@@UNAME
Linux 5.14.0
@@ARCH
x86_64
@@END
`

func TestApplyNetworkPreferenceAggregatesNonLoopbackInterfaces(t *testing.T) {
	raw := ParseCollectionOutput(collectionNetworkFixture)
	if raw.Interface != string(domain.MonitorNetworkInterfaceAll) || raw.RX != 4000 || raw.TX != 7000 {
		t.Fatalf("default all selection raw=%+v", raw)
	}
	var calculator Calculator
	first := calculator.Snapshot(1, raw, time.Unix(100, 0), 0)
	if first.EffectiveNetworkInterface != "all" || first.DefaultInterface != "eth0" ||
		first.NetworkInterfaceMode != domain.MonitorNetworkInterfaceAll {
		t.Fatalf("snapshot=%+v", first)
	}
	raw.NetworkInterfaces[1].RXBytes += 1000
	raw.NetworkInterfaces[1].TXBytes += 500
	raw.NetworkInterfaces[2].RXBytes += 3000
	raw.NetworkInterfaces[2].TXBytes += 1500
	ApplyNetworkPreference(&raw, domain.MonitorNetworkInterfaceAll, "")
	second := calculator.Snapshot(1, raw, time.Unix(102, 0), 0)
	if second.DownloadBytesPerSecond == nil || *second.DownloadBytesPerSecond != 2000 {
		t.Fatalf("download=%v snapshot=%+v", second.DownloadBytesPerSecond, second)
	}
}

func TestApplyNetworkPreferenceUsesSelectedInterface(t *testing.T) {
	raw := ParseCollectionOutput(collectionNetworkFixture)
	ApplyNetworkPreference(&raw, domain.MonitorNetworkInterfaceSpecific, "ens3")
	if raw.Interface != "ens3" || raw.RX != 3000 || raw.TX != 5000 || raw.NetworkInterfaceFallback {
		t.Fatalf("raw=%+v", raw)
	}
}

func TestApplyNetworkPreferenceFallsBackWhenSelectedInterfaceIsMissing(t *testing.T) {
	raw := ParseCollectionOutput(collectionNetworkFixture)
	ApplyNetworkPreference(&raw, domain.MonitorNetworkInterfaceSpecific, "wlan0")
	if raw.Interface != "all" || raw.RX != 4000 || raw.TX != 7000 ||
		!raw.NetworkInterfaceFallback || raw.NetworkInterfaceMode != domain.MonitorNetworkInterfaceAll {
		t.Fatalf("raw=%+v", raw)
	}
}

func TestApplyNetworkPreferenceAggregatesDockerAndPhysicalScopes(t *testing.T) {
	raw := RawSample{
		DefaultInterface: "ens18",
		Interface:        "ens18",
		NetworkAvailable: true,
		NetworkInterfaces: []NetworkInterfaceCounters{
			{Name: "lo", RXBytes: 10, TXBytes: 10},
			{Name: "ens18", RXBytes: 1000, TXBytes: 2000},
			{Name: "docker0", RXBytes: 3000, TXBytes: 4000},
			{Name: "br-abcd", RXBytes: 5000, TXBytes: 6000},
			{Name: "veth123", RXBytes: 7000, TXBytes: 8000},
			{Name: "wg0", RXBytes: 9000, TXBytes: 10000},
		},
	}

	ApplyNetworkPreference(&raw, domain.MonitorNetworkInterfaceDocker, "")
	if raw.Interface != "docker" || raw.RX != 15000 || raw.TX != 18000 ||
		raw.NetworkInterfaceMode != domain.MonitorNetworkInterfaceDocker {
		t.Fatalf("docker scope raw=%+v", raw)
	}

	ApplyNetworkPreference(&raw, domain.MonitorNetworkInterfacePhysical, "")
	if raw.Interface != "physical" || raw.RX != 1000 || raw.TX != 2000 ||
		raw.NetworkInterfaceMode != domain.MonitorNetworkInterfacePhysical {
		t.Fatalf("physical scope raw=%+v", raw)
	}

	ApplyNetworkPreference(&raw, domain.MonitorNetworkInterfaceAll, "")
	if raw.Interface != "all" || raw.RX != 25000 || raw.TX != 30000 {
		t.Fatalf("all scope raw=%+v", raw)
	}
}

func TestCollectionCommandIncludesProcNetDev(t *testing.T) {
	if !strings.Contains(CollectionCommand, "@@PROC_NET_DEV") ||
		!strings.Contains(CollectionCommand, "cat /proc/net/dev") {
		t.Fatal("collection command must include /proc/net/dev counters")
	}
}

func TestNetworkInterfacesCommandKeepsFallbackSources(t *testing.T) {
	for _, expected := range []string{
		"@@SSH_CONNECTION",
		"@@ROUTE_TO_CLIENT",
		"@@DEFAULT_ROUTE",
		"ip -j addr",
		"ip -j link",
		"ip addr",
		"ifconfig -a",
		"/proc/net/dev",
		"/sys/class/net",
	} {
		if !strings.Contains(NetworkInterfacesCommand, expected) {
			t.Fatalf("network interfaces command missing %q", expected)
		}
	}
}

func TestParseCollectionOutput(t *testing.T) {
	sample := ParseCollectionOutput(collectionFixture)
	if len(sample.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", sample.Errors)
	}
	if !sample.CPUAvailable || !sample.MemoryAvailable || !sample.NetworkAvailable ||
		!sample.DiskAvailable || !sample.LoadAvailable || !sample.UptimeAvailable {
		t.Fatalf("availability flags not set: %+v", sample)
	}
	if sample.Interface != "eth0" || sample.OSName != "Rocky Linux 9.5" || sample.Architecture != "x86_64" {
		t.Fatalf("unexpected sample: %+v", sample)
	}
	if len(sample.Mounts) != 2 || sample.Mounts[1].MountPath != "/data" {
		t.Fatalf("mounts=%+v", sample.Mounts)
	}
	if len(sample.Processes) != 2 || sample.Processes[0].Command != "java" {
		t.Fatalf("processes=%+v", sample.Processes)
	}
	if sample.ProcessStatus != "available" {
		t.Fatalf("process status=%q", sample.ProcessStatus)
	}
}

func TestCalculatorEstablishesBaselines(t *testing.T) {
	raw := ParseCollectionOutput(collectionFixture)
	var calculator Calculator
	first := calculator.Snapshot(1, raw, time.Unix(100, 0), 10*time.Millisecond)
	if first.CPUPercent != nil || first.DownloadBytesPerSecond != nil || first.UploadBytesPerSecond != nil {
		t.Fatal("first sample must not expose derived counter values")
	}
	raw.CPU.User += 50
	raw.CPU.Idle += 50
	raw.RX += 2048
	raw.TX += 1024
	second := calculator.Snapshot(1, raw, time.Unix(102, 0), 10*time.Millisecond)
	if second.CPUPercent == nil || *second.CPUPercent != 50 {
		t.Fatalf("CPU value = %v", second.CPUPercent)
	}
	if second.DownloadBytesPerSecond == nil || *second.DownloadBytesPerSecond != 1024 {
		t.Fatalf("download value = %v", second.DownloadBytesPerSecond)
	}
}

func TestUnavailableMetricsRemainNil(t *testing.T) {
	raw := ParseCollectionOutput("@@CPU\n@@MEM\n@@IFACE\n@@DF\n@@PROCESSES\n@@LOAD\n@@UPTIME\n@@OS\n@@END\n")
	snapshot := (&Calculator{}).Snapshot(1, raw, time.Now(), 0)
	if snapshot.CPUPercent != nil || snapshot.MemoryUsedPercent != nil || snapshot.LoadOne != nil ||
		snapshot.UptimeSeconds != nil || snapshot.DownloadBytesPerSecond != nil {
		t.Fatalf("unsupported metrics must be nil: %+v", snapshot)
	}
}

func TestProcessFailureDoesNotInvalidateOtherMetrics(t *testing.T) {
	raw := ParseCollectionOutput(strings.Replace(collectionFixture,
		"@@PROCESSES\n101 12.5 3.2 java\n202 4.0 1.1 nginx\n",
		"@@PROCESSES\nprocess exited\n", 1))
	if !raw.CPUAvailable || !raw.MemoryAvailable {
		t.Fatalf("unrelated metrics became unavailable: %+v", raw)
	}
	found := false
	for _, metricErr := range raw.Errors {
		if metricErr.Metric == "processes" {
			found = true
		}
	}
	if !found {
		t.Fatalf("process error not reported: %+v", raw.Errors)
	}
}

func TestCollectionCommandValidatesProcessColumnsBeforeUsingGNUForm(t *testing.T) {
	if !strings.Contains(CollectionCommand, "NF >= 4") {
		t.Fatal("collection command must validate process columns before accepting a ps variant")
	}
	if !strings.Contains(CollectionCommand, "ps -A -o pid,pcpu,pmem,args") {
		t.Fatal("collection command must retain an all-process compatibility fallback")
	}
	if !strings.Contains(CollectionCommand, "mode=procfs") ||
		!strings.Contains(CollectionCommand, `/proc/[0-9]*`) ||
		!strings.Contains(CollectionCommand, `cut -c 1-160`) {
		t.Fatal("collection command must include a bounded procfs fallback")
	}
}

func TestProcfsProcessesUseConsecutiveSamples(t *testing.T) {
	raw := ParseCollectionOutput(strings.Replace(collectionFixture,
		"@@PROCESSES\n101 12.5 3.2 java\n202 4.0 1.1 nginx\n",
		"@@PROCESSES\nmode=procfs\n101 100 102400 java\n202 50 204800 [kworker]\n", 1))
	raw.CPU.Cores = 2
	var calculator Calculator
	first := calculator.Snapshot(1, raw, time.Unix(100, 0), 0)
	if first.ProcessStatus != "loading" || len(first.Processes) != 0 {
		t.Fatalf("first process sample=%+v", first)
	}

	raw.CPU.User += 20
	raw.CPU.Idle += 80
	raw.ProcProcesses = []ProcProcessSample{
		{PID: 101, CPUTicks: 125, RSSBytes: 102400, Command: "java --server"},
	}
	second := calculator.Snapshot(1, raw, time.Unix(102, 0), 0)
	if second.ProcessStatus != "available" || len(second.Processes) != 1 {
		t.Fatalf("second process sample=%+v", second)
	}
	if second.Processes[0].CPUPercent != 50 {
		t.Fatalf("process CPU=%v", second.Processes[0].CPUPercent)
	}
	if second.Processes[0].Command != "java --server" {
		t.Fatalf("process command=%q", second.Processes[0].Command)
	}
}

func TestProcfsCounterResetReestablishesBaseline(t *testing.T) {
	raw := ParseCollectionOutput(strings.Replace(collectionFixture,
		"@@PROCESSES\n101 12.5 3.2 java\n202 4.0 1.1 nginx\n",
		"@@PROCESSES\nmode=procfs\n101 100 102400 java\n", 1))
	var calculator Calculator
	_ = calculator.Snapshot(1, raw, time.Unix(100, 0), 0)
	raw.CPU = CPUCounters{User: 1, Idle: 2, Cores: 1}
	raw.ProcProcesses[0].CPUTicks = 1
	snapshot := calculator.Snapshot(1, raw, time.Unix(101, 0), 0)
	if snapshot.ProcessStatus != "loading" || len(snapshot.Processes) != 0 {
		t.Fatalf("reset sample=%+v", snapshot)
	}
}
