package linuxmonitor

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

const CollectionCommand = `
printf '@@CPU\n'; cat /proc/stat 2>/dev/null || true
printf '@@MEM\n'; cat /proc/meminfo 2>/dev/null || true
iface=''
if command -v ip >/dev/null 2>&1; then
  iface=$(ip route show default 2>/dev/null | awk '$1=="default" {for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')
fi
if [ -z "$iface" ] && [ -r /proc/net/route ]; then
  iface=$(awk '$2=="00000000" && ($4=="0003" || $4=="0001") {print $1; exit}' /proc/net/route)
fi
case "$iface" in *[!A-Za-z0-9_.:-]*) iface='';; esac
printf '@@IFACE\n%s\n' "$iface"
printf '@@PROC_NET_DEV\n'; cat /proc/net/dev 2>/dev/null || true
printf '@@RX\n'; if [ -n "$iface" ]; then cat "/sys/class/net/$iface/statistics/rx_bytes" 2>/dev/null || true; fi
printf '@@TX\n'; if [ -n "$iface" ]; then cat "/sys/class/net/$iface/statistics/tx_bytes" 2>/dev/null || true; fi
printf '@@DF\n'
df_output=$(df -P -B1 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$df_output" ]; then
  printf 'block_size=1\n%s\n' "$df_output"
else
  df_output=$(df -P -k 2>/dev/null)
  if [ $? -eq 0 ] && [ -n "$df_output" ]; then
    printf 'block_size=1024\n%s\n' "$df_output"
  fi
fi
printf '@@PROCESSES\n'
process_output=$(ps -eo pid=,pcpu=,pmem=,comm=,args= 2>/dev/null)
if printf '%s\n' "$process_output" | awk '
  NF >= 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+([.][0-9]+)?$/ && $3 ~ /^[0-9]+([.][0-9]+)?$/ { found=1; exit }
  END { exit !found }
'; then
  printf 'mode=ps\n'
  normalized=$(printf '%s\n' "$process_output" | awk '
    NF >= 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+([.][0-9]+)?$/ && $3 ~ /^[0-9]+([.][0-9]+)?$/ {
      pid=$1; cpu=$2; mem=$3; $1=$2=$3=""; sub(/^[ \t]+/, ""); command=$0
      if (command == "") command="[" pid "]"
      print pid, cpu, mem, command
    }')
  { printf '%s\n' "$normalized" | sort -k2,2nr | head -n 128
    printf '%s\n' "$normalized" | sort -k3,3nr | head -n 128
  } | awk '!seen[$1]++'
else
  process_output=$(ps -A -o pid,pcpu,pmem,args 2>/dev/null)
  if printf '%s\n' "$process_output" | awk '
    NF >= 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+([.][0-9]+)?$/ && $3 ~ /^[0-9]+([.][0-9]+)?$/ { found=1; exit }
    END { exit !found }
  '; then
    printf 'mode=ps\n'
    printf '%s\n' "$process_output" | awk '
      NF >= 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+([.][0-9]+)?$/ && $3 ~ /^[0-9]+([.][0-9]+)?$/ {
        pid=$1; cpu=$2; mem=$3; $1=$2=$3=""; sub(/^[ \t]+/, ""); command=$0
        if (command == "") command="[" pid "]"
        print pid, cpu, mem, command
      }' | head -n 256
  elif [ -d /proc ]; then
    printf 'mode=procfs\n'
    process_count=0
    for proc in /proc/[0-9]*; do
      [ "$process_count" -ge 512 ] && break
      stat=$(cat "$proc/stat" 2>/dev/null) || continue
      rest=$(printf '%s\n' "$stat" | sed 's/^[^(]*(.*) //')
      set -- $rest
      [ "$#" -ge 22 ] || continue
      utime=$12
      stime=$13
      case "$utime" in ''|*[!0-9]*) continue;; esac
      case "$stime" in ''|*[!0-9]*) continue;; esac
      rss_kb=$(awk '$1=="VmRSS:" {print $2; exit}' "$proc/status" 2>/dev/null)
      case "$rss_kb" in ''|*[!0-9]*) rss_kb=0;; esac
      command=$(tr '\000' ' ' 2>/dev/null < "$proc/cmdline" | cut -c 1-160)
      if [ -z "$command" ]; then
        name=$(awk '$1=="Name:" {$1=""; sub(/^[ \t]+/, ""); print; exit}' "$proc/status" 2>/dev/null)
        command="[$name]"
      fi
      printf '%s %s %s %s\n' "${proc##*/}" "$((utime + stime))" "$((rss_kb * 1024))" "$command"
      process_count=$((process_count + 1))
    done
  else
    printf 'mode=unsupported\n'
  fi
fi
printf '@@LOAD\n'; cat /proc/loadavg 2>/dev/null || true
printf '@@UPTIME\n'; cat /proc/uptime 2>/dev/null || true
printf '@@OS\n'; cat /etc/os-release 2>/dev/null || true
printf '@@UNAME\n'; uname -sr 2>/dev/null || true
printf '@@ARCH\n'; uname -m 2>/dev/null || true
printf '@@END\n'
`

const NetworkInterfacesCommand = `
printf '@@SSH_CONNECTION\n'
printf '%s\n' "${SSH_CONNECTION:-}"
client_ip=$(printf '%s\n' "${SSH_CONNECTION:-}" | awk '{print $1}')
printf '@@ROUTE_TO_CLIENT\n'
if command -v ip >/dev/null 2>&1 && [ -n "$client_ip" ]; then
  case "$client_ip" in
    *:*) ip -6 route get "$client_ip" 2>/dev/null || true ;;
    *) ip route get "$client_ip" 2>/dev/null || true ;;
  esac
fi
printf '@@DEFAULT_ROUTE\n'
if command -v ip >/dev/null 2>&1; then ip route show default 2>/dev/null || true; fi
printf '@@IP_J_ADDR\n'
if command -v ip >/dev/null 2>&1; then ip -j addr 2>/dev/null || true; fi
printf '@@IP_J_LINK\n'
if command -v ip >/dev/null 2>&1; then ip -j link 2>/dev/null || true; fi
printf '@@IP_ADDR\n'
if command -v ip >/dev/null 2>&1; then ip addr 2>/dev/null || true; fi
printf '@@IFCONFIG\n'
if command -v ifconfig >/dev/null 2>&1; then ifconfig -a 2>/dev/null || true; fi
printf '@@PROC_NET_DEV\n'
cat /proc/net/dev 2>/dev/null || true
printf '@@SYS_CLASS_NET\n'
if [ -d /sys/class/net ]; then
  for iface_path in /sys/class/net/*; do
    [ -e "$iface_path" ] || continue
    name=${iface_path##*/}
    case "$name" in *[!A-Za-z0-9_.:-]*) continue;; esac
    state=$(cat "$iface_path/operstate" 2>/dev/null || true)
    mtu=$(cat "$iface_path/mtu" 2>/dev/null || true)
    mac=$(cat "$iface_path/address" 2>/dev/null || true)
    speed=$(cat "$iface_path/speed" 2>/dev/null || true)
    printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$state" "$mtu" "$mac" "$speed"
  done
fi
printf '@@END\n'
`

type RawSample struct {
	CPU                       CPUCounters
	CPUAvailable              bool
	Memory                    MemoryInfo
	MemoryAvailable           bool
	DefaultInterface          string
	Interface                 string
	RX                        uint64
	TX                        uint64
	NetworkInterfaces         []NetworkInterfaceCounters
	NetworkAvailable          bool
	NetworkInterfaceMode      domain.MonitorNetworkInterfaceMode
	SelectedNetworkInterface  string
	EffectiveNetworkInterface string
	NetworkInterfaceFallback  bool
	NetworkInterfaceMessage   string
	Disk                      DiskUsage
	DiskAvailable             bool
	Mounts                    []domain.DiskMount
	Processes                 []domain.ProcessInfo
	ProcessMode               string
	ProcessStatus             domain.ProcessStatus
	ProcessMessage            string
	ProcProcesses             []ProcProcessSample
	Load                      LoadAverage
	LoadAvailable             bool
	Uptime                    time.Duration
	UptimeAvailable           bool
	OSName                    string
	Kernel                    string
	Architecture              string
	Errors                    []domain.MetricError
}

func ParseCollectionOutput(input string) RawSample {
	sections := splitSections(input)
	var sample RawSample
	var err error
	if sample.CPU, err = ParseCPUStat(sections["CPU"]); err != nil {
		sample.Errors = appendMetricError(sample.Errors, "cpu", err)
	} else {
		sample.CPUAvailable = true
	}
	if sample.Memory, err = ParseMemInfo(sections["MEM"]); err != nil {
		sample.Errors = appendMetricError(sample.Errors, "memory", err)
	} else {
		sample.MemoryAvailable = true
	}
	sample.DefaultInterface = strings.TrimSpace(sections["IFACE"])
	sample.Interface = sample.DefaultInterface
	if sample.NetworkInterfaces, err = ParseProcNetDev(sections["PROC_NET_DEV"]); err != nil && sections["PROC_NET_DEV"] != "" {
		sample.Errors = appendMetricError(sample.Errors, "network", err)
	}
	if len(sample.NetworkInterfaces) > 0 {
		for _, item := range sample.NetworkInterfaces {
			if item.Name == sample.Interface {
				sample.RX = item.RXBytes
				sample.TX = item.TXBytes
				sample.NetworkAvailable = true
				break
			}
		}
	}
	if len(sample.NetworkInterfaces) > 0 && sample.Interface == "" {
		sample.NetworkAvailable = true
	} else if sample.Interface == "" {
		sample.Errors = appendMetricError(sample.Errors, "network", errors.New("default interface unavailable"))
	} else if !sample.NetworkAvailable {
		if sample.RX, sample.TX, err = ParseNetworkCounters(sections["RX"], sections["TX"]); err != nil {
			sample.Errors = appendMetricError(sample.Errors, "network", err)
		} else {
			sample.NetworkAvailable = true
		}
	}
	if sample.NetworkAvailable {
		ApplyNetworkPreference(&sample, domain.MonitorNetworkInterfaceAll, "")
	}
	if sample.Mounts, err = ParseDFMounts(sections["DF"]); err != nil {
		sample.Errors = appendMetricError(sample.Errors, "disk", err)
	} else {
		for _, mount := range sample.Mounts {
			if mount.MountPath == "/" {
				sample.Disk = DiskUsage{
					Total: mount.Total,
					Used:  mount.Used,
					Free:  mount.Available,
				}
				sample.DiskAvailable = true
				break
			}
		}
		if !sample.DiskAvailable {
			sample.Errors = appendMetricError(sample.Errors, "disk", errors.New("root mount not found"))
		}
	}
	if err = parseProcessSection(sections["PROCESSES"], &sample); err != nil {
		sample.ProcessStatus = domain.ProcessFailed
		sample.ProcessMessage = "进程数据采集失败"
		sample.Errors = appendMetricError(sample.Errors, "processes", err)
	}
	if sample.Load, err = ParseLoadAverage(sections["LOAD"]); err != nil {
		sample.Errors = appendMetricError(sample.Errors, "load", err)
	} else {
		sample.LoadAvailable = true
	}
	if sample.Uptime, err = ParseUptime(sections["UPTIME"]); err != nil {
		sample.Errors = appendMetricError(sample.Errors, "uptime", err)
	} else {
		sample.UptimeAvailable = true
	}
	sample.OSName = parseOSName(sections["OS"])
	if sample.OSName == "" {
		sample.Errors = appendMetricError(sample.Errors, "os", errors.New("OS information unavailable"))
	}
	sample.Kernel = strings.TrimSpace(sections["UNAME"])
	sample.Architecture = strings.TrimSpace(sections["ARCH"])
	return sample
}

func ApplyNetworkPreference(
	sample *RawSample,
	mode domain.MonitorNetworkInterfaceMode,
	selected string,
) {
	if !validNetworkInterfaceMode(mode) {
		mode = domain.MonitorNetworkInterfaceAll
	}
	selected = strings.TrimSpace(selected)
	sample.NetworkInterfaceMode = mode
	sample.SelectedNetworkInterface = selected
	sample.NetworkInterfaceFallback = false
	sample.NetworkInterfaceMessage = ""
	if sample.DefaultInterface == "" {
		sample.DefaultInterface = sample.Interface
	}
	if len(sample.NetworkInterfaces) == 0 {
		sample.EffectiveNetworkInterface = sample.Interface
		if sample.EffectiveNetworkInterface == "" && sample.NetworkAvailable {
			sample.EffectiveNetworkInterface = string(domain.MonitorNetworkInterfaceAll)
		}
		if mode == domain.MonitorNetworkInterfaceSpecific &&
			selected != "" && selected != sample.Interface {
			sample.NetworkInterfaceMode = domain.MonitorNetworkInterfaceAll
			sample.SelectedNetworkInterface = ""
			sample.NetworkInterfaceFallback = true
			sample.NetworkInterfaceMessage = "所选网络接口不存在，已切换为全部接口"
		}
		return
	}
	if mode == domain.MonitorNetworkInterfaceSpecific && selected != "" {
		for _, item := range sample.NetworkInterfaces {
			if item.Name == selected {
				sample.Interface = item.Name
				sample.RX = item.RXBytes
				sample.TX = item.TXBytes
				sample.NetworkAvailable = true
				sample.EffectiveNetworkInterface = item.Name
				return
			}
		}
		sample.NetworkInterfaceMode = domain.MonitorNetworkInterfaceAll
		sample.SelectedNetworkInterface = ""
		sample.NetworkInterfaceFallback = true
		sample.NetworkInterfaceMessage = "所选网络接口不存在，已切换为全部接口"
	}
	rx, tx, included := aggregateNetworkInterfaces(sample.NetworkInterfaces, mode)
	if included == 0 && mode == domain.MonitorNetworkInterfaceDocker {
		sample.NetworkInterfaceMode = domain.MonitorNetworkInterfaceAll
		sample.SelectedNetworkInterface = ""
		sample.NetworkInterfaceFallback = true
		sample.NetworkInterfaceMessage = "未发现 Docker 网络接口，已切换为全部接口"
		rx, tx, included = aggregateNetworkInterfaces(sample.NetworkInterfaces, domain.MonitorNetworkInterfaceAll)
	} else if included == 0 && mode == domain.MonitorNetworkInterfacePhysical {
		sample.NetworkInterfaceMode = domain.MonitorNetworkInterfaceAll
		sample.SelectedNetworkInterface = ""
		sample.NetworkInterfaceFallback = true
		sample.NetworkInterfaceMessage = "未发现可用物理网络接口，已切换为全部接口"
		rx, tx, included = aggregateNetworkInterfaces(sample.NetworkInterfaces, domain.MonitorNetworkInterfaceAll)
	}
	if included > 0 {
		sample.Interface = string(sample.NetworkInterfaceMode)
		sample.RX = rx
		sample.TX = tx
		sample.NetworkAvailable = true
		sample.EffectiveNetworkInterface = string(sample.NetworkInterfaceMode)
	}
}

func validNetworkInterfaceMode(mode domain.MonitorNetworkInterfaceMode) bool {
	switch mode {
	case domain.MonitorNetworkInterfaceAll,
		domain.MonitorNetworkInterfaceSpecific,
		domain.MonitorNetworkInterfacePhysical,
		domain.MonitorNetworkInterfaceDocker:
		return true
	default:
		return false
	}
}

func aggregateNetworkInterfaces(rows []NetworkInterfaceCounters, mode domain.MonitorNetworkInterfaceMode) (uint64, uint64, int) {
	var rx, tx uint64
	var included int
	for _, item := range rows {
		if includeNetworkInterface(item.Name, mode) {
			rx += item.RXBytes
			tx += item.TXBytes
			included++
		}
	}
	if included == 0 && mode == domain.MonitorNetworkInterfaceAll {
		for _, item := range rows {
			rx += item.RXBytes
			tx += item.TXBytes
			included++
		}
	}
	return rx, tx, included
}

func includeNetworkInterface(name string, mode domain.MonitorNetworkInterfaceMode) bool {
	if isLoopbackName(name) {
		return false
	}
	switch mode {
	case domain.MonitorNetworkInterfaceDocker:
		return isDockerNetworkInterface(name)
	case domain.MonitorNetworkInterfacePhysical:
		return !isVirtualNetworkInterface(name)
	default:
		return true
	}
}

func isDockerNetworkInterface(name string) bool {
	lower := strings.ToLower(name)
	return lower == "docker0" ||
		strings.HasPrefix(lower, "br-") ||
		strings.HasPrefix(lower, "veth") ||
		strings.HasPrefix(lower, "vxlan") ||
		strings.HasPrefix(lower, "flannel") ||
		strings.HasPrefix(lower, "cni")
}

func isVirtualNetworkInterface(name string) bool {
	lower := strings.ToLower(name)
	if isDockerNetworkInterface(lower) {
		return true
	}
	virtualPrefixes := []string{"virbr", "tun", "tap", "wg", "tailscale", "zt", "kube-"}
	for _, prefix := range virtualPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func parseProcessSection(input string, sample *RawSample) error {
	lines := strings.Split(strings.TrimSpace(input), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		return errors.New("process collection mode missing")
	}
	mode := "ps"
	body := input
	if value, ok := strings.CutPrefix(strings.TrimSpace(lines[0]), "mode="); ok {
		mode = strings.TrimSpace(value)
		body = strings.Join(lines[1:], "\n")
	}
	sample.ProcessMode = mode
	switch mode {
	case "ps":
		processes, err := ParseProcesses(body)
		if err != nil {
			return err
		}
		sample.Processes = processes
		if len(processes) == 0 {
			sample.ProcessStatus = domain.ProcessEmpty
			sample.ProcessMessage = "暂无进程数据"
		} else {
			sample.ProcessStatus = domain.ProcessAvailable
		}
	case "procfs":
		processes, err := ParseProcProcesses(body)
		if err != nil {
			return err
		}
		sample.ProcProcesses = processes
		if len(processes) == 0 {
			sample.ProcessStatus = domain.ProcessEmpty
			sample.ProcessMessage = "暂无可读取的进程数据"
		} else {
			sample.ProcessStatus = domain.ProcessLoading
			sample.ProcessMessage = "正在建立进程采样基线"
		}
	case "unsupported":
		sample.ProcessStatus = domain.ProcessUnsupported
		sample.ProcessMessage = "当前系统不支持进程采集"
	default:
		return fmt.Errorf("unknown process collection mode %q", mode)
	}
	return nil
}

func splitSections(input string) map[string]string {
	result := make(map[string]string)
	var name string
	var builder strings.Builder
	flush := func() {
		if name != "" {
			result[name] = strings.TrimSpace(builder.String())
		}
		builder.Reset()
	}
	for line := range strings.Lines(input) {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "@@") {
			flush()
			name = strings.TrimPrefix(trimmed, "@@")
			if name == "END" {
				name = ""
			}
			continue
		}
		if name != "" {
			builder.WriteString(line)
		}
	}
	flush()
	return result
}

func parseOSName(input string) string {
	values := make(map[string]string)
	for line := range strings.Lines(input) {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), `"`)
		values[key] = value
	}
	if values["PRETTY_NAME"] != "" {
		return values["PRETTY_NAME"]
	}
	return strings.TrimSpace(values["NAME"] + " " + values["VERSION"])
}

func appendMetricError(current []domain.MetricError, metric string, err error) []domain.MetricError {
	return append(current, domain.MetricError{Metric: metric, Message: err.Error()})
}

type Calculator struct {
	hasCPU       bool
	cpu          CPUCounters
	network      NetworkCalculator
	hasProcesses bool
	processCPU   CPUCounters
	processTicks map[int64]uint64
}

func (c *Calculator) Reset() {
	*c = Calculator{}
}

func (c *Calculator) Snapshot(connectionID int64, raw RawSample, at time.Time, latency time.Duration) domain.MonitorSnapshot {
	snapshot := domain.MonitorSnapshot{
		ConnectionID: connectionID, Status: domain.StatusOnline, Timestamp: at.UTC().Format(time.RFC3339Nano),
		LatencyMillis: latency.Milliseconds(), LatencyAvailable: true, MemoryTotal: raw.Memory.Total,
		MemoryAvailable: raw.Memory.Available, SwapTotal: raw.Memory.SwapTotal,
		SwapFree: raw.Memory.SwapFree, DiskTotal: raw.Disk.Total, DiskUsed: raw.Disk.Used,
		Mounts:           append([]domain.DiskMount{}, raw.Mounts...),
		Processes:        append([]domain.ProcessInfo{}, raw.Processes...),
		ProcessStatus:    raw.ProcessStatus,
		ProcessMessage:   raw.ProcessMessage,
		DefaultInterface: raw.DefaultInterface, OSName: raw.OSName, Kernel: raw.Kernel,
		NetworkInterfaceMode:      raw.NetworkInterfaceMode,
		SelectedNetworkInterface:  raw.SelectedNetworkInterface,
		EffectiveNetworkInterface: raw.EffectiveNetworkInterface,
		NetworkInterfaceFallback:  raw.NetworkInterfaceFallback,
		NetworkInterfaceMessage:   raw.NetworkInterfaceMessage,
		Architecture:              raw.Architecture, Errors: append([]domain.MetricError{}, raw.Errors...),
	}
	if raw.CPUAvailable && c.hasCPU {
		if usage, ok := CPUUsage(c.cpu, raw.CPU); ok {
			snapshot.CPUPercent = pointer(usage)
		}
	}
	if raw.CPUAvailable {
		c.cpu, c.hasCPU = raw.CPU, true
	} else {
		c.hasCPU = false
	}
	if raw.ProcessMode == "procfs" {
		snapshot.Processes, snapshot.ProcessStatus, snapshot.ProcessMessage =
			c.procProcesses(raw)
	} else {
		c.hasProcesses = false
		c.processTicks = nil
	}
	if raw.MemoryAvailable && raw.Memory.Total > 0 && raw.Memory.Available <= raw.Memory.Total {
		snapshot.MemoryUsedPercent = pointer(float64(raw.Memory.Total-raw.Memory.Available) / float64(raw.Memory.Total) * 100)
	}
	if raw.DiskAvailable && raw.Disk.Total > 0 {
		snapshot.DiskUsedPercent = pointer(float64(raw.Disk.Used) / float64(raw.Disk.Total) * 100)
	}
	if raw.LoadAvailable {
		snapshot.LoadOne = pointer(raw.Load.One)
		snapshot.LoadFive = pointer(raw.Load.Five)
		snapshot.LoadFifteen = pointer(raw.Load.Fifteen)
	}
	if raw.UptimeAvailable {
		snapshot.UptimeSeconds = pointer(raw.Uptime.Seconds())
	}
	if raw.NetworkAvailable {
		rates := c.network.Sample(raw.Interface, raw.RX, raw.TX, at)
		if rates.Available {
			snapshot.DownloadBytesPerSecond = pointer(rates.DownloadBytesPerSecond)
			snapshot.UploadBytesPerSecond = pointer(rates.UploadBytesPerSecond)
		}
	} else {
		c.network.Reset()
	}
	return snapshot
}

func (c *Calculator) procProcesses(raw RawSample) ([]domain.ProcessInfo, domain.ProcessStatus, string) {
	current := make(map[int64]uint64, len(raw.ProcProcesses))
	for _, process := range raw.ProcProcesses {
		current[process.PID] = process.CPUTicks
	}
	if !raw.CPUAvailable || !c.hasProcesses {
		c.processCPU = raw.CPU
		c.processTicks = current
		c.hasProcesses = raw.CPUAvailable
		if len(raw.ProcProcesses) == 0 {
			return nil, domain.ProcessEmpty, "暂无可读取的进程数据"
		}
		return nil, domain.ProcessLoading, "正在建立进程采样基线"
	}
	currentTotal := raw.CPU.total()
	previousTotal := c.processCPU.total()
	if currentTotal < previousTotal || currentTotal == previousTotal {
		c.processCPU = raw.CPU
		c.processTicks = current
		return nil, domain.ProcessLoading, "正在重新建立进程采样基线"
	}
	totalDelta := currentTotal - previousTotal
	cores := raw.CPU.Cores
	if cores == 0 {
		cores = 1
	}
	processes := make([]domain.ProcessInfo, 0, len(raw.ProcProcesses))
	for _, process := range raw.ProcProcesses {
		previous, existed := c.processTicks[process.PID]
		cpuPercent := 0.0
		if existed && process.CPUTicks >= previous {
			cpuPercent = float64(process.CPUTicks-previous) / float64(totalDelta) * float64(cores) * 100
		}
		memoryPercent := 0.0
		if raw.MemoryAvailable && raw.Memory.Total > 0 {
			memoryPercent = float64(process.RSSBytes) / float64(raw.Memory.Total) * 100
		}
		if math.IsNaN(cpuPercent) || math.IsInf(cpuPercent, 0) ||
			math.IsNaN(memoryPercent) || math.IsInf(memoryPercent, 0) {
			continue
		}
		processes = append(processes, domain.ProcessInfo{
			PID: process.PID, CPUPercent: max(cpuPercent, 0),
			MemoryPercent: max(memoryPercent, 0), Command: process.Command,
		})
	}
	c.processCPU = raw.CPU
	c.processTicks = current
	if len(processes) == 0 {
		return nil, domain.ProcessEmpty, "暂无进程数据"
	}
	return limitProcesses(processes), domain.ProcessAvailable, ""
}

func limitProcesses(processes []domain.ProcessInfo) []domain.ProcessInfo {
	selected := make(map[int64]domain.ProcessInfo, 32)
	byCPU := append([]domain.ProcessInfo(nil), processes...)
	sort.SliceStable(byCPU, func(i, j int) bool {
		if byCPU[i].CPUPercent == byCPU[j].CPUPercent {
			return byCPU[i].PID < byCPU[j].PID
		}
		return byCPU[i].CPUPercent > byCPU[j].CPUPercent
	})
	byMemory := append([]domain.ProcessInfo(nil), processes...)
	sort.SliceStable(byMemory, func(i, j int) bool {
		if byMemory[i].MemoryPercent == byMemory[j].MemoryPercent {
			return byMemory[i].PID < byMemory[j].PID
		}
		return byMemory[i].MemoryPercent > byMemory[j].MemoryPercent
	})
	for _, list := range [][]domain.ProcessInfo{byCPU, byMemory} {
		for index, process := range list {
			if index >= 16 {
				break
			}
			selected[process.PID] = process
		}
	}
	result := make([]domain.ProcessInfo, 0, len(selected))
	for _, process := range selected {
		result = append(result, process)
	}
	return result
}

func pointer(value float64) *float64 {
	return &value
}

func ParseRefreshInterval(value int) (time.Duration, error) {
	if value != 1 && value != 2 && value != 5 {
		return 0, fmt.Errorf("unsupported refresh interval %s", strconv.Itoa(value))
	}
	return time.Duration(value) * time.Second, nil
}
