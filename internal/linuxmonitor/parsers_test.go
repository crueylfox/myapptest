package linuxmonitor

import (
	"math"
	"testing"
	"time"
)

func TestParseCPUStatAndUsage(t *testing.T) {
	previous, err := ParseCPUStat("cpu  100 5 30 800 20 2 3 0\ncpu0 1 2 3 4")
	if err != nil {
		t.Fatal(err)
	}
	current, err := ParseCPUStat("cpu  140 5 50 860 20 2 3 0")
	if err != nil {
		t.Fatal(err)
	}
	usage, ok := CPUUsage(previous, current)
	if !ok {
		t.Fatal("expected CPU usage to be available")
	}
	if math.Abs(usage-50) > 0.0001 {
		t.Fatalf("usage = %v, want 50", usage)
	}
}

func TestCPUUsageRejectsCounterReset(t *testing.T) {
	if _, ok := CPUUsage(CPUCounters{User: 10, Idle: 100}, CPUCounters{User: 1, Idle: 2}); ok {
		t.Fatal("counter reset must not produce a CPU value")
	}
}

func TestParseMemInfo(t *testing.T) {
	info, err := ParseMemInfo("MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 50 kB\n")
	if err != nil {
		t.Fatal(err)
	}
	if info.Total != 1000*1024 || info.Available != 400*1024 || info.SwapFree != 50*1024 {
		t.Fatalf("unexpected memory info: %+v", info)
	}
}

func TestParseMemInfoFallback(t *testing.T) {
	info, err := ParseMemInfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 20 kB\nCached: 200 kB\n")
	if err != nil {
		t.Fatal(err)
	}
	if info.Available != 320*1024 {
		t.Fatalf("available = %d", info.Available)
	}
}

func TestParseDefaultInterfaces(t *testing.T) {
	iface, err := ParseDefaultInterfaceIPRoute("default via 192.0.2.1 dev ens18 proto dhcp src 192.0.2.2\n")
	if err != nil || iface != "ens18" {
		t.Fatalf("ip route: iface=%q err=%v", iface, err)
	}
	proc := "Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 00000000 0102A8C0 0003 0 0 100 00000000\n"
	iface, err = ParseDefaultInterfaceProcRoute(proc)
	if err != nil || iface != "eth0" {
		t.Fatalf("proc route: iface=%q err=%v", iface, err)
	}
}

func TestParseNetworkCounters(t *testing.T) {
	rx, tx, err := ParseNetworkCounters(" 12345\n", "67890\n")
	if err != nil || rx != 12345 || tx != 67890 {
		t.Fatalf("rx=%d tx=%d err=%v", rx, tx, err)
	}
}

func TestParseProcNetDev(t *testing.T) {
	input := `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0
  eth0: 2048 20 0 0 0 0 0 0 4096 40 0 0 0 0 0 0
`
	counters, err := ParseProcNetDev(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(counters) != 2 || counters[1].Name != "eth0" ||
		counters[1].RXBytes != 2048 || counters[1].TXPackets != 40 {
		t.Fatalf("counters=%+v", counters)
	}
}

func TestParseNetworkInterfacesOutputFallsBackToIPAddrAndProcNetDev(t *testing.T) {
	input := `@@IP_ADDR
2: eth0@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 02:42:ac:11:00:02 brd ff:ff:ff:ff:ff:ff
    inet 172.17.0.2/16 brd 172.17.255.255 scope global eth0
    inet6 fe80::42:acff:fe11:2/64 scope link
@@PROC_NET_DEV
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: 2048 20 0 0 0 0 0 0 4096 40 0 0 0 0 0 0
@@END
`
	interfaces := ParseNetworkInterfacesOutput(7, input, "2026-06-20T00:00:00Z")
	if len(interfaces) != 1 {
		t.Fatalf("interfaces=%+v", interfaces)
	}
	item := interfaces[0]
	if item.ServerID != 7 || item.Name != "eth0" || !item.IsUp ||
		item.RXBytes != 2048 || item.TXBytes != 4096 ||
		len(item.IPv4) != 1 || len(item.IPv6) != 1 || item.MAC != "02:42:ac:11:00:02" {
		t.Fatalf("interface=%+v", item)
	}
}

func TestParseNetworkInterfacesResponseRecommendsSSHConnectionInterface(t *testing.T) {
	input := `@@SSH_CONNECTION
198.51.100.8 54122 192.0.2.10 22
@@IP_ADDR
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 192.0.2.10/24 brd 192.0.2.255 scope global eth0
3: ens18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 10.10.10.5/24 brd 10.10.10.255 scope global ens18
@@END
`
	response := ParseNetworkInterfacesResponse(7, input, "2026-06-20T00:00:00Z")
	if response.RecommendedInterface != "eth0" ||
		response.RecommendedInterfaceReason != "ssh_connection_local_ip" {
		t.Fatalf("response=%+v", response)
	}
}

func TestParseNetworkInterfacesResponseFallsBackToRouteToClient(t *testing.T) {
	input := `@@SSH_CONNECTION
198.51.100.8 54122 203.0.113.50 22
@@ROUTE_TO_CLIENT
198.51.100.8 via 192.0.2.1 dev ens18 src 192.0.2.10 uid 1000
@@DEFAULT_ROUTE
default via 10.0.0.1 dev eth0
@@IP_ADDR
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 10.0.0.10/24 brd 10.0.0.255 scope global eth0
3: ens18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 192.0.2.10/24 brd 192.0.2.255 scope global ens18
@@END
`
	response := ParseNetworkInterfacesResponse(7, input, "2026-06-20T00:00:00Z")
	if response.RecommendedInterface != "ens18" ||
		response.RecommendedInterfaceReason != "route_to_client" {
		t.Fatalf("response=%+v", response)
	}
}

func TestParseNetworkInterfacesResponseFallsBackToDefaultRoute(t *testing.T) {
	input := `@@DEFAULT_ROUTE
default via 192.0.2.1 dev wlan0 proto dhcp src 192.0.2.10
@@IP_ADDR
2: eth0: <BROADCAST,MULTICAST> mtu 1500 qdisc mq state DOWN group default qlen 1000
3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 192.0.2.10/24 brd 192.0.2.255 scope global wlan0
@@END
`
	response := ParseNetworkInterfacesResponse(7, input, "2026-06-20T00:00:00Z")
	if response.RecommendedInterface != "wlan0" ||
		response.RecommendedInterfaceReason != "default_route" {
		t.Fatalf("response=%+v", response)
	}
}

func TestParseNetworkInterfacesResponseFallsBackToFirstActiveNonLoopback(t *testing.T) {
	input := `@@IP_ADDR
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    inet 127.0.0.1/8 scope host lo
2: ens18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 192.0.2.10/24 brd 192.0.2.255 scope global ens18
@@END
`
	response := ParseNetworkInterfacesResponse(7, input, "2026-06-20T00:00:00Z")
	if response.RecommendedInterface != "ens18" ||
		response.RecommendedInterfaceReason != "first_active_non_loopback" {
		t.Fatalf("response=%+v", response)
	}
}

func TestParseNetworkInterfacesResponseDoesNotRecommendLoopbackWhenNonLoopbackExists(t *testing.T) {
	input := `@@SSH_CONNECTION
127.0.0.1 54122 127.0.0.1 22
@@ROUTE_TO_CLIENT
local 127.0.0.1 dev lo src 127.0.0.1 uid 1000
@@DEFAULT_ROUTE
default dev lo
@@IP_ADDR
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    inet 127.0.0.1/8 scope host lo
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    inet 192.0.2.10/24 brd 192.0.2.255 scope global eth0
@@END
`
	response := ParseNetworkInterfacesResponse(7, input, "2026-06-20T00:00:00Z")
	if response.RecommendedInterface != "eth0" ||
		response.RecommendedInterfaceReason != "first_active_non_loopback" {
		t.Fatalf("response=%+v", response)
	}
}

func TestParseNetworkInterfacesResponseFallsBackToAllWhenOnlyLoopbackHasNoRecommendation(t *testing.T) {
	input := `@@IP_ADDR
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    inet 127.0.0.1/8 scope host lo
@@END
`
	response := ParseNetworkInterfacesResponse(7, input, "2026-06-20T00:00:00Z")
	if response.RecommendedInterface != "all" ||
		response.RecommendedInterfaceReason != "fallback_all" {
		t.Fatalf("response=%+v", response)
	}
}

func TestNetworkCalculator(t *testing.T) {
	start := time.Unix(100, 0)
	tests := []struct {
		name      string
		iface     string
		rx        uint64
		tx        uint64
		at        time.Time
		available bool
		down      float64
		up        float64
	}{
		{"first sample", "eth0", 1000, 2000, start, false, 0, 0},
		{"non integer seconds", "eth0", 3500, 3000, start.Add(2500 * time.Millisecond), true, 1000, 400},
		{"zero traffic", "eth0", 3500, 3000, start.Add(3500 * time.Millisecond), true, 0, 0},
		{"counter reset", "eth0", 10, 20, start.Add(4500 * time.Millisecond), false, 0, 0},
		{"after reset baseline", "eth0", 1010, 520, start.Add(5500 * time.Millisecond), true, 1000, 500},
		{"interface change", "ens3", 9000, 8000, start.Add(6500 * time.Millisecond), false, 0, 0},
	}
	var calculator NetworkCalculator
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := calculator.Sample(test.iface, test.rx, test.tx, test.at)
			if got.Available != test.available || math.Abs(got.DownloadBytesPerSecond-test.down) > 0.0001 ||
				math.Abs(got.UploadBytesPerSecond-test.up) > 0.0001 {
				t.Fatalf("got %+v", got)
			}
		})
	}
	calculator.Reset()
	if got := calculator.Sample("ens3", 10000, 9000, start.Add(8*time.Second)); got.Available {
		t.Fatal("reconnect reset must establish a new baseline")
	}
}

func TestParseLoadAverage(t *testing.T) {
	load, err := ParseLoadAverage("0.12 1.25 2.50 1/100 123")
	if err != nil || load.One != 0.12 || load.Five != 1.25 || load.Fifteen != 2.5 {
		t.Fatalf("load=%+v err=%v", load, err)
	}
}

func TestParseUptime(t *testing.T) {
	got, err := ParseUptime("123.50 10.00")
	if err != nil || got != 123500*time.Millisecond {
		t.Fatalf("uptime=%v err=%v", got, err)
	}
}

func TestParseDF(t *testing.T) {
	input := "block_size=1\nFilesystem 1-blocks Used Available Capacity Mounted on\n/dev/vda1 100000000 40000000 60000000 40% /\n"
	disk, err := ParseDF(input)
	if err != nil || disk.Total != 100000000 || disk.Used != 40000000 || disk.Free != 60000000 {
		t.Fatalf("disk=%+v err=%v", disk, err)
	}
}

func TestParseDFBusyBoxKilobytes(t *testing.T) {
	input := "block_size=1024\nFilesystem           1024-blocks    Used Available Capacity Mounted on\n/dev/root                256000     10000    246000   4% /\n"
	disk, err := ParseDF(input)
	if err != nil {
		t.Fatal(err)
	}
	if disk.Total != 256000*1024 || disk.Used != 10000*1024 || disk.Free != 246000*1024 {
		t.Fatalf("disk=%+v", disk)
	}
}

func TestParseDFUsesLastValidDataRow(t *testing.T) {
	input := "block_size=1024\nheader text\ninvalid row\n/dev/root   100  25  75  25%   /\n"
	disk, err := ParseDF(input)
	if err != nil || disk.Total != 100*1024 {
		t.Fatalf("disk=%+v err=%v", disk, err)
	}
}

func TestParseDFMountsSkipsInvalidAndDuplicateRows(t *testing.T) {
	input := `block_size=1
Filesystem 1-blocks Used Available Capacity Mounted on
/dev/root 1000 400 600 40% /
broken row
overlay 500 250 250 50% /var/lib/docker/overlay2/a/merged
/dev/data 2000 1000 1000 50% /data
/dev/duplicate 3000 1000 2000 33% /data
`
	mounts, err := ParseDFMounts(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(mounts) != 3 {
		t.Fatalf("mounts=%+v", mounts)
	}
	if mounts[0].MountPath != "/" || mounts[1].Filesystem != "overlay" || mounts[2].MountPath != "/data" {
		t.Fatalf("mounts=%+v", mounts)
	}
}

func TestParseProcessesSkipsExitedOrMalformedRows(t *testing.T) {
	input := `101 12.5 3.2 java
process disappeared
202 4.0 1.1 nginx worker
303 invalid 2.0 bad
`
	processes, err := ParseProcesses(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 2 {
		t.Fatalf("processes=%+v", processes)
	}
	if processes[1].PID != 202 || processes[1].Command != "nginx worker" {
		t.Fatalf("processes=%+v", processes)
	}
}

func TestParseProcessesFailsOnlyWhenNoValidRowsRemain(t *testing.T) {
	if _, err := ParseProcesses("PID CPU MEM COMMAND\nexited\n"); err == nil {
		t.Fatal("expected process parse error")
	}
}

func TestParseProcessesSupportsHeadersChineseCommandsAndRejectsInvalidUsage(t *testing.T) {
	input := `PID %CPU %MEM COMMAND
101 12.5 3.2 /usr/bin/java 服务
102 NaN 1.0 invalid
103 -1 1.0 negative
`
	processes, err := ParseProcesses(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 1 || processes[0].Command != "/usr/bin/java 服务" {
		t.Fatalf("processes=%+v", processes)
	}
}

func TestParseProcProcessesSkipsExitedAndPermissionDeniedRows(t *testing.T) {
	input := `101 120 4096 /usr/bin/app --serve
permission denied
202 0 0
`
	processes, err := ParseProcProcesses(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 2 {
		t.Fatalf("processes=%+v", processes)
	}
	if processes[1].Command != "[202]" {
		t.Fatalf("kernel process fallback=%q", processes[1].Command)
	}
}

func TestParseProcProcessesAllowsZeroProcesses(t *testing.T) {
	processes, err := ParseProcProcesses("")
	if err != nil || len(processes) != 0 {
		t.Fatalf("processes=%+v err=%v", processes, err)
	}
}

func TestFormatBytesPerSecond(t *testing.T) {
	tests := map[float64]string{
		0:                  "0 B/s",
		1023:               "1023 B/s",
		1024:               "1.00 KB/s",
		1536:               "1.50 KB/s",
		1024 * 1024:        "1.00 MB/s",
		1024 * 1024 * 1024: "1.00 GB/s",
	}
	for input, want := range tests {
		if got := FormatBytesPerSecond(input); got != want {
			t.Errorf("FormatBytesPerSecond(%v) = %q, want %q", input, got, want)
		}
	}
}
