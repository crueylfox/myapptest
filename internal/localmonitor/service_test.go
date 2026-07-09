package localmonitor

import (
	"testing"

	"hostdeck/internal/domain"
)

type fakeProvider struct {
	snapshot domain.LocalResourceSnapshot
}

func (p fakeProvider) Snapshot() (domain.LocalResourceSnapshot, error) {
	return p.snapshot, nil
}

func TestServicePreservesWindowsLocalMonitorDetails(t *testing.T) {
	service := New(fakeProvider{snapshot: domain.LocalResourceSnapshot{
		Hostname:             "fixture-host",
		Platform:             "windows",
		OSName:               "Windows",
		OSVersion:            "Windows 11",
		OSBuild:              "22631",
		Architecture:         "amd64",
		CPULogicalProcessors: 16,
		MemoryTotal:          16 * 1024 * 1024 * 1024,
		GPUs: []domain.LocalGpuSnapshot{
			{Name: "Fixture GPU", Available: true, UsagePercent: 33.5, MemoryUsedBytes: 2 * 1024 * 1024 * 1024, MemoryTotalBytes: 8 * 1024 * 1024 * 1024},
		},
		UploadBytesPerSecond:   1200,
		DownloadBytesPerSecond: 3400,
		NetworkInterfaces: []domain.LocalNetworkInterface{
			{Name: "Ethernet", DisplayName: "Ethernet", IsDefaultRoute: true, UploadBytesPerSecond: 1200, DownloadBytesPerSecond: 3400},
			{Name: "Wi-Fi", DisplayName: "Wi-Fi", UploadBytesPerSecond: 200, DownloadBytesPerSecond: 800},
		},
		Disks: []domain.LocalDiskVolume{
			{Name: "C:", MountPath: "C:\\", Total: 1000, Used: 400, Available: 600, UsedPercent: 40},
		},
		Processes: []domain.LocalProcessInfo{
			{PID: 100, Name: "fixture.exe", CPUPercent: 2.5, MemoryBytes: 64 * 1024 * 1024},
		},
	}})

	snapshot, err := service.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot returned error: %v", err)
	}

	if snapshot.OSVersion != "Windows 11" || snapshot.OSBuild != "22631" || snapshot.Architecture != "amd64" {
		t.Fatalf("system details not preserved: %#v", snapshot)
	}
	if len(snapshot.GPUs) != 1 || snapshot.GPUs[0].Name != "Fixture GPU" || !snapshot.GPUs[0].Available {
		t.Fatalf("gpu fields not preserved: %#v", snapshot.GPUs)
	}
	if len(snapshot.NetworkInterfaces) != 2 || !snapshot.NetworkInterfaces[0].IsDefaultRoute || snapshot.NetworkInterfaces[1].DownloadBytesPerSecond != 800 {
		t.Fatalf("network interfaces = %#v", snapshot.NetworkInterfaces)
	}
	if len(snapshot.Disks) != 1 || snapshot.Disks[0].Name != "C:" || len(snapshot.Processes) != 1 {
		t.Fatalf("disks/processes not preserved: disks=%#v processes=%#v", snapshot.Disks, snapshot.Processes)
	}
}
