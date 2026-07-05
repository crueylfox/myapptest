//go:build windows

package localmonitor

import (
	"testing"
	"unicode/utf16"

	"serverpilot/internal/domain"
)

func TestClassifyLocalNetworkInterfacesMarksDefaultRouteAndHidesPseudoAdapters(t *testing.T) {
	rows := []domain.LocalNetworkInterface{
		{Name: "Packet Driver Miniport", DisplayName: "Packet Driver Miniport", Description: "NDIS Packet Driver", IsUp: true},
		{Name: "Teredo Tunneling Pseudo-Interface", DisplayName: "Teredo", Description: "Teredo Tunneling Pseudo-Interface", IsUp: true},
		{Name: "VMware Network Adapter VMnet1", DisplayName: "VMware Network Adapter VMnet1", Description: "VMware Host-Only", IsUp: true},
		{Name: "Ethernet", DisplayName: "Ethernet", Description: "Intel Ethernet", IsUp: true, HasGateway: true, RXBytes: 100, TXBytes: 50},
		{Name: "Wi-Fi", DisplayName: "Wi-Fi", Description: "Intel Wi-Fi", IsUp: true, HasGateway: true, RXBytes: 200, TXBytes: 100},
	}

	classified := classifyLocalNetworkInterfaces(rows, map[string]bool{"Wi-Fi": true})

	byName := map[string]domain.LocalNetworkInterface{}
	for _, row := range classified {
		byName[row.Name] = row
	}
	if !byName["Wi-Fi"].IsDefaultRoute || byName["Wi-Fi"].IsHiddenByDefault {
		t.Fatalf("default Wi-Fi should remain visible and default: %#v", byName["Wi-Fi"])
	}
	for _, name := range []string{"Packet Driver Miniport", "Teredo Tunneling Pseudo-Interface", "VMware Network Adapter VMnet1"} {
		if !byName[name].IsHiddenByDefault {
			t.Fatalf("%s should be hidden by default: %#v", name, byName[name])
		}
	}
	if byName["Ethernet"].IsHiddenByDefault {
		t.Fatalf("real Ethernet should remain visible: %#v", byName["Ethernet"])
	}
}

func TestClassifyLocalNetworkInterfacesKeepsDefaultVirtualHiddenWhenPhysicalExists(t *testing.T) {
	rows := []domain.LocalNetworkInterface{
		{Name: "Ethernet", DisplayName: "Ethernet", Description: "Intel Ethernet", IsUp: true, HasGateway: true},
		{Name: "Meta Virtual Adapter", DisplayName: "Meta Virtual Adapter", Description: "Wintun Userspace Tunnel", IsUp: true, HasGateway: true},
	}

	classified := classifyLocalNetworkInterfaces(rows, map[string]bool{"Meta Virtual Adapter": true})

	byName := map[string]domain.LocalNetworkInterface{}
	for _, row := range classified {
		byName[row.Name] = row
	}
	if byName["Ethernet"].IsHiddenByDefault {
		t.Fatalf("physical Ethernet should remain visible: %#v", byName["Ethernet"])
	}
	if !byName["Meta Virtual Adapter"].IsDefaultRoute || !byName["Meta Virtual Adapter"].IsHiddenByDefault {
		t.Fatalf("default virtual adapter should stay hidden when a physical adapter exists: %#v", byName["Meta Virtual Adapter"])
	}
}

func TestClassifyLocalNetworkInterfacesAllowsDefaultVirtualWhenNoPhysicalExists(t *testing.T) {
	rows := []domain.LocalNetworkInterface{
		{Name: "Meta Virtual Adapter", DisplayName: "Meta Virtual Adapter", Description: "Wintun Userspace Tunnel", IsUp: true, HasGateway: true},
	}

	classified := classifyLocalNetworkInterfaces(rows, map[string]bool{"Meta Virtual Adapter": true})

	if len(classified) != 1 || !classified[0].IsDefaultRoute || classified[0].IsHiddenByDefault {
		t.Fatalf("default virtual adapter should remain visible only as fallback: %#v", classified)
	}
}

func TestUTF16BytesToStringParsesRegistryGpuName(t *testing.T) {
	encoded := utf16.Encode([]rune("Fixture GPU"))
	data := make([]byte, 0, len(encoded)*2+2)
	for _, word := range encoded {
		data = append(data, byte(word), byte(word>>8))
	}
	data = append(data, 0, 0, 'x', 0)

	if got := utf16BytesToString(data); got != "Fixture GPU" {
		t.Fatalf("utf16BytesToString()=%q, want %q", got, "Fixture GPU")
	}
}

func TestSelectWindowsGPUsPrefersPhysicalGPUOverVirtualDisplayDrivers(t *testing.T) {
	rows := selectWindowsGPUs([]domain.LocalGpuSnapshot{
		{Name: "OrayIddDriver Device", Available: true},
		{Name: "NVIDIA GeForce RTX Fixture", Available: true, MemoryTotalBytes: 8 << 30},
		{Name: "Intel(R) Iris(R) Xe Graphics", Available: true, MemoryTotalBytes: 2 << 30},
	}, 12.3, 1<<30)

	if len(rows) != 2 {
		t.Fatalf("selected GPUs=%#v, want two physical GPUs", rows)
	}
	if rows[0].Name != "NVIDIA GeForce RTX Fixture" {
		t.Fatalf("first GPU=%q, want physical NVIDIA before virtual display", rows[0].Name)
	}
	if rows[0].UsagePercent != 12.3 {
		t.Fatalf("usage=%v, want PDH usage on primary physical GPU", rows[0].UsagePercent)
	}
	if rows[0].MemoryUsedBytes != 1<<30 {
		t.Fatalf("memory used=%v, want PDH dedicated memory usage", rows[0].MemoryUsedBytes)
	}
	for _, row := range rows {
		if row.Name == "OrayIddDriver Device" {
			t.Fatalf("virtual display driver must be filtered: %#v", rows)
		}
	}
}

func TestSelectWindowsGPUsReturnsUnavailableWhenOnlyVirtualDisplaysExist(t *testing.T) {
	rows := selectWindowsGPUs([]domain.LocalGpuSnapshot{
		{Name: "OrayIddDriver Device", Available: true},
		{Name: "Microsoft Basic Display Adapter", Available: true},
		{Name: "VirtualBox Graphics Adapter", Available: true},
	}, -1, 0)

	if len(rows) != 1 || rows[0].Available || rows[0].Name != "" {
		t.Fatalf("selected GPUs=%#v, want unavailable placeholder without virtual GPU name", rows)
	}
}

func TestSelectWindowsGPUsKeepsPhysicalGPUWhenUsageUnavailable(t *testing.T) {
	rows := selectWindowsGPUs([]domain.LocalGpuSnapshot{
		{Name: "AMD Radeon Fixture", Available: true, MemoryTotalBytes: 4 << 30},
	}, -1, 0)

	if len(rows) != 1 || !rows[0].Available || rows[0].Name != "AMD Radeon Fixture" {
		t.Fatalf("selected GPUs=%#v, want available physical GPU", rows)
	}
	if rows[0].UsagePercent != -1 {
		t.Fatalf("usage=%v, want unavailable usage sentinel", rows[0].UsagePercent)
	}
	if rows[0].MemoryTotalBytes != 4<<30 {
		t.Fatalf("memory total=%v, want registry memory preserved", rows[0].MemoryTotalBytes)
	}
}

func TestSelectWindowsTopProcessesSortsByMemoryAndLimits(t *testing.T) {
	entries := []windowsProcessEntry{
		{pid: 1, name: "one.exe"},
		{pid: 2, name: "two.exe"},
		{pid: 3, name: "three.exe"},
		{pid: 4, name: "four.exe"},
		{pid: 5, name: "five.exe"},
		{pid: 6, name: "six.exe"},
	}
	memoryByPID := map[uint32]uint64{
		1: 10,
		2: 60,
		3: 30,
		4: 50,
		5: 20,
		6: 40,
	}

	rows := selectWindowsTopProcesses(entries, 100, func(pid uint32) (uint64, bool) {
		value, ok := memoryByPID[pid]
		return value, ok
	})

	if len(rows) != 5 {
		t.Fatalf("processes=%#v, want top 5", rows)
	}
	wantPIDs := []int{2, 4, 6, 3, 5}
	for index, want := range wantPIDs {
		if rows[index].PID != want {
			t.Fatalf("process[%d].PID=%d, want %d in rows %#v", index, rows[index].PID, want, rows)
		}
		if rows[index].CPUPercent != -1 {
			t.Fatalf("process[%d].CPUPercent=%v, want unavailable sentinel", index, rows[index].CPUPercent)
		}
	}
	if rows[0].MemoryPercent != 60 {
		t.Fatalf("memory percent=%v, want 60", rows[0].MemoryPercent)
	}
}

func TestSelectWindowsTopProcessesSkipsAccessDeniedProcesses(t *testing.T) {
	entries := []windowsProcessEntry{
		{pid: 10, name: "denied.exe"},
		{pid: 20, name: "visible.exe"},
	}

	rows := selectWindowsTopProcesses(entries, 100, func(pid uint32) (uint64, bool) {
		if pid == 10 {
			return 0, false
		}
		return 42, true
	})

	if len(rows) != 1 || rows[0].PID != 20 || rows[0].Name != "visible.exe" {
		t.Fatalf("processes=%#v, want only accessible process", rows)
	}
}

func TestSelectWindowsTopProcessesReturnsNilWhenAllProcessesUnavailable(t *testing.T) {
	rows := selectWindowsTopProcesses([]windowsProcessEntry{
		{pid: 10, name: "denied.exe"},
		{pid: 20, name: "also-denied.exe"},
	}, 100, func(uint32) (uint64, bool) {
		return 0, false
	})

	if rows != nil {
		t.Fatalf("processes=%#v, want nil when all process memory reads fail", rows)
	}
}
