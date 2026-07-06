//go:build darwin

package localmonitor

import (
	"context"
	"strings"
	"testing"
)

func TestDarwinProviderParsesSystemSnapshotFromCommands(t *testing.T) {
	provider := newDarwinProviderWithRunner(func(_ context.Context, name string, args ...string) (string, error) {
		command := name + " " + strings.Join(args, " ")
		switch command {
		case "sw_vers ":
			return "ProductName:\t\tmacOS\nProductVersion:\t14.5\nBuildVersion:\t23F79\n", nil
		case "sysctl -n hw.memsize":
			return "17179869184\n", nil
		case "sysctl -n machdep.cpu.brand_string":
			return "Apple M3\n", nil
		case "sysctl -n hw.physicalcpu":
			return "8\n", nil
		case "sysctl -n hw.logicalcpu":
			return "8\n", nil
		case "sysctl -n kern.boottime":
			return "{ sec = 1700000000, usec = 0 } Tue Nov 14 22:13:20 2023\n", nil
		case "top -l 1 -n 0":
			return "CPU usage: 12.5% user, 7.5% sys, 80.0% idle\n", nil
		case "vm_stat ":
			return "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1000.\nPages inactive: 2000.\nPages speculative: 500.\n", nil
		case "netstat -ibn":
			return "Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 link#1 aa 10 0 1000 20 0 2000 0\n", nil
		case "df -kP":
			return "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000 250 750 25% /\n", nil
		case "ps -axo pid=,pcpu=,rss=,comm= -r":
			return "123 42.5 1024 /Applications/App.app\n456 1.5 2048 /usr/sbin/daemon\n", nil
		default:
			return "", nil
		}
	})

	snapshot, err := provider.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.OSName != "macOS" || snapshot.OSVersion != "14.5" || snapshot.OSBuild != "23F79" {
		t.Fatalf("system version not parsed: %+v", snapshot)
	}
	if snapshot.CPUModel != "Apple M3" || snapshot.CPUPercent != 20 {
		t.Fatalf("cpu not parsed: %+v", snapshot)
	}
	if snapshot.MemoryTotal != 17179869184 || snapshot.MemoryAvailable != 14336000 {
		t.Fatalf("memory not parsed: %+v", snapshot)
	}
	if len(snapshot.Disks) != 1 || snapshot.Disks[0].MountPath != "/" {
		t.Fatalf("disk not parsed: %+v", snapshot.Disks)
	}
	if len(snapshot.Processes) == 0 || snapshot.Processes[0].PID != 123 {
		t.Fatalf("processes not parsed: %+v", snapshot.Processes)
	}
	if len(snapshot.GPUs) != 1 || snapshot.GPUs[0].Available {
		t.Fatalf("GPU should be explicitly unavailable: %+v", snapshot.GPUs)
	}
}
