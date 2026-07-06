//go:build darwin

package localmonitor

import (
	"context"
	"net"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"serverpilot/internal/domain"
)

type darwinCommandRunner func(context.Context, string, ...string) (string, error)

type OSProvider struct {
	mu            sync.Mutex
	run           darwinCommandRunner
	lastNetByName map[string]darwinNetCounters
	lastNetAt     time.Time
	hasNet        bool
	startedAt     time.Time
}

type darwinNetCounters struct {
	rx uint64
	tx uint64
}

func NewOSProvider() Provider {
	return &OSProvider{run: runDarwinCommand, startedAt: time.Now()}
}

func newDarwinProviderWithRunner(run darwinCommandRunner) *OSProvider {
	return &OSProvider{run: run, startedAt: time.Now()}
}

func (p *OSProvider) Snapshot() (domain.LocalResourceSnapshot, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	hostname, _ := os.Hostname()
	osVersion, osBuild := p.swVers()
	totalMemory := p.sysctlUint64("hw.memsize")
	availableMemory := p.availableMemory()
	usedPercent := 0.0
	if totalMemory > 0 && availableMemory <= totalMemory {
		usedPercent = float64(totalMemory-availableMemory) / float64(totalMemory) * 100
	}
	interfaces := p.networkInterfaces()
	interfaces, downloadRate, uploadRate := p.networkRates(now, interfaces)

	return domain.LocalResourceSnapshot{
		Status:               "online",
		Hostname:             hostname,
		Platform:             runtime.GOOS,
		OSName:               "macOS",
		OSVersion:            osVersion,
		OSBuild:              osBuild,
		Architecture:         runtime.GOARCH,
		CPUModel:             strings.TrimSpace(p.command("sysctl", "-n", "machdep.cpu.brand_string")),
		CPUCores:             int(p.sysctlUint64("hw.physicalcpu")),
		CPULogicalProcessors: int(p.sysctlUint64("hw.logicalcpu")),
		Timestamp:            now.Format(time.RFC3339),
		UptimeSeconds:        p.uptimeSeconds(now),
		CPUPercent:           p.cpuPercent(),
		MemoryTotal:          totalMemory,
		MemoryAvailable:      availableMemory,
		MemoryUsedPercent:    usedPercent,
		GPUs: []domain.LocalGpuSnapshot{{
			Available:         false,
			UsagePercent:      -1,
			UnavailableReason: "unavailable",
		}},
		UploadBytesPerSecond:   uploadRate,
		DownloadBytesPerSecond: downloadRate,
		NetworkInterfaces:      interfaces,
		Disks:                  p.diskVolumes(),
		Processes:              p.processes(totalMemory),
	}, nil
}

func (p *OSProvider) swVers() (string, string) {
	out := p.command("sw_vers")
	version := ""
	build := ""
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "ProductVersion":
			version = strings.TrimSpace(value)
		case "BuildVersion":
			build = strings.TrimSpace(value)
		}
	}
	return version, build
}

func (p *OSProvider) sysctlUint64(name string) uint64 {
	value := strings.TrimSpace(p.command("sysctl", "-n", name))
	parsed, _ := strconv.ParseUint(value, 10, 64)
	return parsed
}

func (p *OSProvider) uptimeSeconds(now time.Time) int64 {
	out := p.command("sysctl", "-n", "kern.boottime")
	secIndex := strings.Index(out, "sec =")
	if secIndex >= 0 {
		rest := strings.TrimSpace(out[secIndex+len("sec ="):])
		end := strings.IndexAny(rest, ",}")
		if end >= 0 {
			rest = rest[:end]
		}
		if boot, err := strconv.ParseInt(strings.TrimSpace(rest), 10, 64); err == nil && boot > 0 {
			return int64(now.Sub(time.Unix(boot, 0)).Seconds())
		}
	}
	if !p.startedAt.IsZero() {
		return int64(now.Sub(p.startedAt).Seconds())
	}
	return 0
}

func (p *OSProvider) cpuPercent() float64 {
	out := p.command("top", "-l", "1", "-n", "0")
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, "CPU usage:") {
			continue
		}
		return parseDarwinCPUUsage(line)
	}
	return 0
}

func parseDarwinCPUUsage(line string) float64 {
	line = strings.ReplaceAll(line, ",", "")
	fields := strings.Fields(line)
	total := 0.0
	for index, field := range fields {
		if index+1 >= len(fields) {
			continue
		}
		if fields[index+1] != "user" && fields[index+1] != "sys" {
			continue
		}
		value, err := strconv.ParseFloat(strings.TrimSuffix(field, "%"), 64)
		if err == nil {
			total += value
		}
	}
	if total < 0 {
		return 0
	}
	if total > 100 {
		return 100
	}
	return total
}

func (p *OSProvider) availableMemory() uint64 {
	out := p.command("vm_stat")
	pageSize := uint64(4096)
	availablePages := uint64(0)
	for _, line := range strings.Split(out, "\n") {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "page size of") {
			for _, field := range strings.Fields(line) {
				if value, err := strconv.ParseUint(field, 10, 64); err == nil && value > 0 {
					pageSize = value
					break
				}
			}
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key != "Pages free" && key != "Pages inactive" && key != "Pages speculative" {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), ".")
		pages, err := strconv.ParseUint(value, 10, 64)
		if err == nil {
			availablePages += pages
		}
	}
	return availablePages * pageSize
}

func (p *OSProvider) networkInterfaces() []domain.LocalNetworkInterface {
	system, _ := net.Interfaces()
	counters := p.networkCounters()
	rows := make([]domain.LocalNetworkInterface, 0, len(system))
	for _, item := range system {
		counter := counters[item.Name]
		row := domain.LocalNetworkInterface{
			Name:              item.Name,
			DisplayName:       item.Name,
			IsUp:              item.Flags&net.FlagUp != 0,
			IsLoopback:        item.Flags&net.FlagLoopback != 0,
			IsPhysicalLike:    isDarwinPhysicalInterface(item.Name),
			IsVirtual:         isDarwinVirtualInterface(item.Name),
			IsHiddenByDefault: item.Flags&net.FlagLoopback != 0 || isDarwinVirtualInterface(item.Name),
			RXBytes:           counter.rx,
			TXBytes:           counter.tx,
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].IsHiddenByDefault != rows[j].IsHiddenByDefault {
			return !rows[i].IsHiddenByDefault
		}
		return rows[i].Name < rows[j].Name
	})
	return rows
}

func (p *OSProvider) networkCounters() map[string]darwinNetCounters {
	out := p.command("netstat", "-ibn")
	lines := strings.Split(out, "\n")
	if len(lines) == 0 {
		return nil
	}
	result := map[string]darwinNetCounters{}
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 10 || fields[0] == "Name" {
			continue
		}
		name := strings.TrimSuffix(fields[0], "*")
		ibytes, iok := findDarwinNetstatBytes(fields, "Ibytes")
		obytes, ook := findDarwinNetstatBytes(fields, "Obytes")
		if !iok || !ook {
			// Common macOS layout: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
			ibytes, iok = parseUintField(fields, 6)
			obytes, ook = parseUintField(fields, 9)
		}
		if !iok && !ook {
			continue
		}
		current := result[name]
		current.rx += ibytes
		current.tx += obytes
		result[name] = current
	}
	return result
}

func findDarwinNetstatBytes(fields []string, _ string) (uint64, bool) {
	return 0, false
}

func parseUintField(fields []string, index int) (uint64, bool) {
	if index >= len(fields) {
		return 0, false
	}
	value, err := strconv.ParseUint(fields[index], 10, 64)
	return value, err == nil
}

func (p *OSProvider) networkRates(now time.Time, interfaces []domain.LocalNetworkInterface) ([]domain.LocalNetworkInterface, float64, float64) {
	current := make(map[string]darwinNetCounters, len(interfaces))
	for _, item := range interfaces {
		current[item.Name] = darwinNetCounters{rx: item.RXBytes, tx: item.TXBytes}
	}
	if !p.hasNet {
		p.lastNetByName = current
		p.lastNetAt = now
		p.hasNet = true
		return interfaces, 0, 0
	}
	elapsed := now.Sub(p.lastNetAt).Seconds()
	prev := p.lastNetByName
	p.lastNetByName = current
	p.lastNetAt = now
	if elapsed <= 0 {
		return interfaces, 0, 0
	}
	totalDownload := 0.0
	totalUpload := 0.0
	for index := range interfaces {
		before, ok := prev[interfaces[index].Name]
		if !ok {
			continue
		}
		if interfaces[index].RXBytes >= before.rx {
			interfaces[index].DownloadBytesPerSecond = float64(interfaces[index].RXBytes-before.rx) / elapsed
		}
		if interfaces[index].TXBytes >= before.tx {
			interfaces[index].UploadBytesPerSecond = float64(interfaces[index].TXBytes-before.tx) / elapsed
		}
		totalDownload += interfaces[index].DownloadBytesPerSecond
		totalUpload += interfaces[index].UploadBytesPerSecond
	}
	return interfaces, totalDownload, totalUpload
}

func (p *OSProvider) diskVolumes() []domain.LocalDiskVolume {
	out := p.command("df", "-kP")
	rows := []domain.LocalDiskVolume{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[0] == "Filesystem" {
			continue
		}
		total, okTotal := parseUintField(fields, 1)
		used, okUsed := parseUintField(fields, 2)
		available, okAvailable := parseUintField(fields, 3)
		if !okTotal || !okUsed || !okAvailable || total == 0 {
			continue
		}
		total *= 1024
		used *= 1024
		available *= 1024
		rows = append(rows, domain.LocalDiskVolume{
			Name:        fields[5],
			MountPath:   fields[5],
			Total:       total,
			Used:        used,
			Available:   available,
			UsedPercent: float64(used) / float64(total) * 100,
		})
	}
	return rows
}

func (p *OSProvider) processes(totalMemory uint64) []domain.LocalProcessInfo {
	out := p.command("ps", "-axo", "pid=,pcpu=,rss=,comm=", "-r")
	rows := []domain.LocalProcessInfo{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil || pid <= 0 {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[1], 64)
		rssKiB, _ := strconv.ParseUint(fields[2], 10, 64)
		memoryBytes := rssKiB * 1024
		memoryPercent := 0.0
		if totalMemory > 0 {
			memoryPercent = float64(memoryBytes) / float64(totalMemory) * 100
		}
		rows = append(rows, domain.LocalProcessInfo{
			PID:           pid,
			Name:          fields[3],
			CPUPercent:    cpu,
			MemoryBytes:   memoryBytes,
			MemoryPercent: memoryPercent,
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].CPUPercent != rows[j].CPUPercent {
			return rows[i].CPUPercent > rows[j].CPUPercent
		}
		return rows[i].MemoryBytes > rows[j].MemoryBytes
	})
	if len(rows) > 5 {
		rows = rows[:5]
	}
	return rows
}

func (p *OSProvider) command(name string, args ...string) string {
	run := p.run
	if run == nil {
		run = runDarwinCommand
	}
	out, err := run(context.Background(), name, args...)
	if err != nil {
		return ""
	}
	return out
}

func runDarwinCommand(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).Output()
	return string(out), err
}

func isDarwinPhysicalInterface(name string) bool {
	return strings.HasPrefix(name, "en")
}

func isDarwinVirtualInterface(name string) bool {
	return strings.HasPrefix(name, "lo") ||
		strings.HasPrefix(name, "utun") ||
		strings.HasPrefix(name, "awdl") ||
		strings.HasPrefix(name, "llw") ||
		strings.HasPrefix(name, "bridge") ||
		strings.HasPrefix(name, "gif") ||
		strings.HasPrefix(name, "stf")
}
