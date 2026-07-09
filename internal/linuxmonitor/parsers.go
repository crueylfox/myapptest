package linuxmonitor

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

const kibibyte = uint64(1024)

type CPUCounters struct {
	User    uint64
	Nice    uint64
	System  uint64
	Idle    uint64
	IOWait  uint64
	IRQ     uint64
	SoftIRQ uint64
	Steal   uint64
	Cores   uint64
}

func (c CPUCounters) total() uint64 {
	return c.User + c.Nice + c.System + c.Idle + c.IOWait + c.IRQ + c.SoftIRQ + c.Steal
}

func (c CPUCounters) idleTotal() uint64 {
	return c.Idle + c.IOWait
}

func ParseCPUStat(input string) (CPUCounters, error) {
	var aggregate CPUCounters
	found := false
	var cores uint64
	for line := range strings.Lines(input) {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if strings.HasPrefix(fields[0], "cpu") && fields[0] != "cpu" {
			if _, err := strconv.ParseUint(strings.TrimPrefix(fields[0], "cpu"), 10, 64); err == nil {
				cores++
			}
			continue
		}
		if fields[0] != "cpu" {
			continue
		}
		if len(fields) < 5 {
			return CPUCounters{}, errors.New("cpu line has too few fields")
		}
		values := make([]uint64, 8)
		for i := range values {
			field := i + 1
			if field >= len(fields) {
				break
			}
			value, err := strconv.ParseUint(fields[field], 10, 64)
			if err != nil {
				return CPUCounters{}, fmt.Errorf("parse cpu field %d: %w", field, err)
			}
			values[i] = value
		}
		aggregate = CPUCounters{
			User: values[0], Nice: values[1], System: values[2], Idle: values[3],
			IOWait: values[4], IRQ: values[5], SoftIRQ: values[6], Steal: values[7],
		}
		found = true
	}
	if !found {
		return CPUCounters{}, errors.New("aggregate cpu line not found")
	}
	if cores == 0 {
		cores = 1
	}
	aggregate.Cores = cores
	return aggregate, nil
}

func CPUUsage(previous, current CPUCounters) (float64, bool) {
	previousTotal, currentTotal := previous.total(), current.total()
	previousIdle, currentIdle := previous.idleTotal(), current.idleTotal()
	if currentTotal <= previousTotal || currentIdle < previousIdle {
		return 0, false
	}
	totalDelta := currentTotal - previousTotal
	idleDelta := currentIdle - previousIdle
	if idleDelta > totalDelta {
		return 0, false
	}
	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100, true
}

type MemoryInfo struct {
	Total     uint64
	Available uint64
	SwapTotal uint64
	SwapFree  uint64
}

func ParseMemInfo(input string) (MemoryInfo, error) {
	values := make(map[string]uint64)
	for line := range strings.Lines(input) {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[key] = value * kibibyte
	}
	total, ok := values["MemTotal"]
	if !ok || total == 0 {
		return MemoryInfo{}, errors.New("MemTotal not found")
	}
	available, ok := values["MemAvailable"]
	if !ok {
		available = values["MemFree"] + values["Buffers"] + values["Cached"]
	}
	return MemoryInfo{
		Total: total, Available: available,
		SwapTotal: values["SwapTotal"], SwapFree: values["SwapFree"],
	}, nil
}

func ParseDefaultInterfaceIPRoute(input string) (string, error) {
	for line := range strings.Lines(input) {
		fields := strings.Fields(line)
		if len(fields) == 0 || fields[0] != "default" {
			continue
		}
		for i := 1; i+1 < len(fields); i++ {
			if fields[i] == "dev" && fields[i+1] != "" {
				return fields[i+1], nil
			}
		}
	}
	return "", errors.New("default interface not found in ip route")
}

func ParseDefaultInterfaceProcRoute(input string) (string, error) {
	scanner := bufio.NewScanner(strings.NewReader(input))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 || fields[0] == "Iface" || fields[1] != "00000000" {
			continue
		}
		flags, err := strconv.ParseUint(fields[3], 16, 64)
		if err == nil && flags&0x2 != 0 {
			return fields[0], nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("scan proc route: %w", err)
	}
	return "", errors.New("default interface not found in proc route")
}

func ParseNetworkCounters(rxInput, txInput string) (uint64, uint64, error) {
	rx, err := strconv.ParseUint(strings.TrimSpace(rxInput), 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse rx bytes: %w", err)
	}
	tx, err := strconv.ParseUint(strings.TrimSpace(txInput), 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse tx bytes: %w", err)
	}
	return rx, tx, nil
}

type NetworkInterfaceCounters struct {
	Name      string
	RXBytes   uint64
	TXBytes   uint64
	RXPackets uint64
	TXPackets uint64
}

func ParseProcNetDev(input string) ([]NetworkInterfaceCounters, error) {
	var counters []NetworkInterfaceCounters
	for line := range strings.Lines(input) {
		namePart, valuePart, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name := strings.TrimSpace(namePart)
		if name == "" {
			continue
		}
		fields := strings.Fields(valuePart)
		if len(fields) < 10 {
			continue
		}
		rxBytes, errRXBytes := strconv.ParseUint(fields[0], 10, 64)
		rxPackets, errRXPackets := strconv.ParseUint(fields[1], 10, 64)
		txBytes, errTXBytes := strconv.ParseUint(fields[8], 10, 64)
		txPackets, errTXPackets := strconv.ParseUint(fields[9], 10, 64)
		if errRXBytes != nil || errRXPackets != nil || errTXBytes != nil || errTXPackets != nil {
			continue
		}
		counters = append(counters, NetworkInterfaceCounters{
			Name: name, RXBytes: rxBytes, TXBytes: txBytes,
			RXPackets: rxPackets, TXPackets: txPackets,
		})
	}
	if len(counters) == 0 {
		return nil, errors.New("proc net dev data row not found")
	}
	return counters, nil
}

type interfaceAccumulator struct {
	item  domain.NetworkInterface
	flags map[string]bool
}

func ParseNetworkInterfacesOutput(serverID int64, input, updatedAt string) []domain.NetworkInterface {
	sections := splitSections(input)
	return parseNetworkInterfacesSections(serverID, sections, updatedAt)
}

func ParseNetworkInterfacesResponse(serverID int64, input, updatedAt string) domain.ListNetworkInterfacesResponse {
	sections := splitSections(input)
	interfaces := parseNetworkInterfacesSections(serverID, sections, updatedAt)
	recommended, reason := RecommendNetworkInterface(
		interfaces,
		sections["SSH_CONNECTION"],
		sections["ROUTE_TO_CLIENT"],
		sections["DEFAULT_ROUTE"],
	)
	return domain.ListNetworkInterfacesResponse{
		ServerID:                   serverID,
		Interfaces:                 interfaces,
		UpdatedAt:                  updatedAt,
		RecommendedInterface:       recommended,
		RecommendedInterfaceReason: reason,
	}
}

func parseNetworkInterfacesSections(
	serverID int64,
	sections map[string]string,
	updatedAt string,
) []domain.NetworkInterface {
	counters, _ := ParseProcNetDev(sections["PROC_NET_DEV"])
	byName := make(map[string]*interfaceAccumulator)
	ensure := func(name string) *interfaceAccumulator {
		name = strings.TrimSpace(strings.TrimSuffix(strings.Split(name, "@")[0], ":"))
		if name == "" {
			return nil
		}
		current := byName[name]
		if current == nil {
			current = &interfaceAccumulator{
				item: domain.NetworkInterface{
					ServerID: serverID, Name: name, DisplayName: name,
					IPv4: []string{}, IPv6: []string{}, LastUpdatedAt: updatedAt,
				},
				flags: make(map[string]bool),
			}
			byName[name] = current
		}
		return current
	}
	for _, counter := range counters {
		current := ensure(counter.Name)
		if current == nil {
			continue
		}
		current.item.RXBytes = counter.RXBytes
		current.item.TXBytes = counter.TXBytes
		current.item.RXPackets = counter.RXPackets
		current.item.TXPackets = counter.TXPackets
	}
	parseIPJSONInterfaces(sections["IP_J_ADDR"], ensure)
	parseIPJSONInterfaces(sections["IP_J_LINK"], ensure)
	parseIPAddrInterfaces(sections["IP_ADDR"], ensure)
	parseIfconfigInterfaces(sections["IFCONFIG"], ensure)
	parseSysClassNet(sections["SYS_CLASS_NET"], ensure)
	result := make([]domain.NetworkInterface, 0, len(byName))
	for name, current := range byName {
		current.item.IsLoopback = current.item.IsLoopback || isLoopbackName(name) || current.flags["LOOPBACK"]
		current.item.IsUp = current.item.IsUp || current.flags["UP"] || current.flags["LOWER_UP"]
		if current.item.DisplayName == "" {
			current.item.DisplayName = current.item.Name
		}
		result = append(result, current.item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsLoopback != result[j].IsLoopback {
			return !result[i].IsLoopback
		}
		return result[i].Name < result[j].Name
	})
	if result == nil {
		return []domain.NetworkInterface{}
	}
	return result
}

func RecommendNetworkInterface(
	interfaces []domain.NetworkInterface,
	sshConnection string,
	routeToClient string,
	defaultRoute string,
) (string, string) {
	if len(interfaces) == 0 {
		return "all", "fallback_all"
	}
	names := make(map[string]domain.NetworkInterface, len(interfaces))
	hasNonLoopback := false
	for _, item := range interfaces {
		names[item.Name] = item
		if !item.IsLoopback {
			hasNonLoopback = true
		}
	}
	accept := func(name string) string {
		name = strings.TrimSpace(name)
		item, ok := names[name]
		if !ok {
			return ""
		}
		if item.IsLoopback && hasNonLoopback {
			return ""
		}
		return item.Name
	}
	if clientIP, serverIP := parseSSHConnectionIPs(sshConnection); serverIP != "" {
		for _, item := range interfaces {
			if interfaceHasIP(item, serverIP) {
				if name := accept(item.Name); name != "" {
					return name, "ssh_connection_local_ip"
				}
			}
		}
		if clientIP != "" {
			if name := accept(parseRouteDev(routeToClient)); name != "" {
				return name, "route_to_client"
			}
		}
	} else if name := accept(parseRouteDev(routeToClient)); name != "" {
		return name, "route_to_client"
	}
	if name := accept(parseRouteDev(defaultRoute)); name != "" {
		return name, "default_route"
	}
	for _, item := range interfaces {
		if item.IsUp && !item.IsLoopback {
			return item.Name, "first_active_non_loopback"
		}
	}
	return "all", "fallback_all"
}

func parseSSHConnectionIPs(input string) (string, string) {
	fields := strings.Fields(strings.TrimSpace(input))
	if len(fields) < 4 {
		return "", ""
	}
	return normalizeIP(fields[0]), normalizeIP(fields[2])
}

func parseRouteDev(input string) string {
	fields := strings.Fields(input)
	for index, field := range fields {
		if field == "dev" && index+1 < len(fields) {
			return strings.TrimSpace(fields[index+1])
		}
	}
	return ""
}

func interfaceHasIP(item domain.NetworkInterface, ip string) bool {
	ip = normalizeIP(ip)
	if ip == "" {
		return false
	}
	for _, address := range append(item.IPv4, item.IPv6...) {
		if normalizeIP(address) == ip {
			return true
		}
	}
	return false
}

func normalizeIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, ok := strings.Cut(value, "/"); ok {
		value = host
	}
	if host, _, ok := strings.Cut(value, "%"); ok {
		value = host
	}
	return strings.ToLower(value)
}

type ipJSONInterface struct {
	IfName    string   `json:"ifname"`
	Flags     []string `json:"flags"`
	MTU       int64    `json:"mtu"`
	Address   string   `json:"address"`
	OperState string   `json:"operstate"`
	AddrInfo  []struct {
		Family    string `json:"family"`
		Local     string `json:"local"`
		PrefixLen int    `json:"prefixlen"`
	} `json:"addr_info"`
}

func parseIPJSONInterfaces(input string, ensure func(string) *interfaceAccumulator) {
	input = strings.TrimSpace(input)
	if input == "" || input[0] != '[' {
		return
	}
	var rows []ipJSONInterface
	if err := json.Unmarshal([]byte(input), &rows); err != nil {
		return
	}
	for _, row := range rows {
		current := ensure(row.IfName)
		if current == nil {
			continue
		}
		for _, flag := range row.Flags {
			current.flags[strings.ToUpper(flag)] = true
		}
		if row.MTU > 0 {
			current.item.MTU = &row.MTU
		}
		if row.Address != "" && row.Address != "00:00:00:00:00:00" {
			current.item.MAC = row.Address
		}
		if strings.EqualFold(row.OperState, "up") {
			current.item.IsUp = true
		}
		for _, address := range row.AddrInfo {
			value := address.Local
			if value == "" {
				continue
			}
			if address.PrefixLen > 0 {
				value = fmt.Sprintf("%s/%d", value, address.PrefixLen)
			}
			switch address.Family {
			case "inet":
				current.item.IPv4 = appendUnique(current.item.IPv4, value)
			case "inet6":
				current.item.IPv6 = appendUnique(current.item.IPv6, value)
			}
		}
	}
}

func parseIPAddrInterfaces(input string, ensure func(string) *interfaceAccumulator) {
	var current *interfaceAccumulator
	for line := range strings.Lines(input) {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if fields := strings.Fields(trimmed); len(fields) >= 2 && strings.HasSuffix(fields[0], ":") {
			name := strings.TrimSuffix(fields[1], ":")
			current = ensure(name)
			if current == nil {
				continue
			}
			if start := strings.Index(trimmed, "<"); start >= 0 {
				if end := strings.Index(trimmed[start:], ">"); end > 0 {
					for _, flag := range strings.Split(trimmed[start+1:start+end], ",") {
						current.flags[strings.ToUpper(strings.TrimSpace(flag))] = true
					}
				}
			}
			for i, field := range fields {
				if field == "mtu" && i+1 < len(fields) {
					if mtu, err := strconv.ParseInt(fields[i+1], 10, 64); err == nil && mtu > 0 {
						current.item.MTU = &mtu
					}
				}
			}
			continue
		}
		if current == nil {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "inet":
			current.item.IPv4 = appendUnique(current.item.IPv4, fields[1])
		case "inet6":
			current.item.IPv6 = appendUnique(current.item.IPv6, fields[1])
		case "link/ether":
			if fields[1] != "00:00:00:00:00:00" {
				current.item.MAC = fields[1]
			}
		}
	}
}

func parseIfconfigInterfaces(input string, ensure func(string) *interfaceAccumulator) {
	var current *interfaceAccumulator
	for line := range strings.Lines(input) {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(line) > 0 && line[0] != ' ' && line[0] != '\t' {
			fields := strings.Fields(line)
			if len(fields) == 0 {
				continue
			}
			current = ensure(strings.TrimSuffix(fields[0], ":"))
			if current == nil {
				continue
			}
			if strings.Contains(line, "UP") {
				current.flags["UP"] = true
			}
			if strings.Contains(strings.ToLower(line), "loopback") {
				current.flags["LOOPBACK"] = true
			}
			if index := strings.Index(line, "HWaddr "); index >= 0 {
				mac := strings.Fields(line[index+len("HWaddr "):])
				if len(mac) > 0 {
					current.item.MAC = mac[0]
				}
			}
			continue
		}
		if current == nil {
			continue
		}
		trimmed := strings.TrimSpace(line)
		fields := strings.Fields(trimmed)
		for i, field := range fields {
			if field == "inet" && i+1 < len(fields) {
				current.item.IPv4 = appendUnique(current.item.IPv4, fields[i+1])
			}
			if strings.HasPrefix(field, "addr:") {
				value := strings.TrimPrefix(field, "addr:")
				if strings.Contains(value, ":") {
					current.item.IPv6 = appendUnique(current.item.IPv6, value)
				} else {
					current.item.IPv4 = appendUnique(current.item.IPv4, value)
				}
			}
			if field == "inet6" && i+1 < len(fields) {
				current.item.IPv6 = appendUnique(current.item.IPv6, strings.TrimPrefix(fields[i+1], "addr:"))
			}
			if field == "ether" && i+1 < len(fields) {
				current.item.MAC = fields[i+1]
			}
			if field == "mtu" && i+1 < len(fields) {
				if mtu, err := strconv.ParseInt(fields[i+1], 10, 64); err == nil && mtu > 0 {
					current.item.MTU = &mtu
				}
			}
		}
	}
}

func parseSysClassNet(input string, ensure func(string) *interfaceAccumulator) {
	for line := range strings.Lines(input) {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 5 {
			continue
		}
		current := ensure(fields[0])
		if current == nil {
			continue
		}
		if strings.EqualFold(fields[1], "up") || strings.EqualFold(fields[1], "unknown") {
			current.item.IsUp = true
		}
		if mtu, err := strconv.ParseInt(fields[2], 10, 64); err == nil && mtu > 0 {
			current.item.MTU = &mtu
		}
		if fields[3] != "" && fields[3] != "00:00:00:00:00:00" {
			current.item.MAC = fields[3]
		}
		if speed, err := strconv.ParseInt(fields[4], 10, 64); err == nil && speed > 0 {
			current.item.SpeedMbps = &speed
		}
	}
}

func appendUnique(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func isLoopbackName(name string) bool {
	return name == "lo" || strings.HasPrefix(name, "lo:")
}

type NetworkRates struct {
	DownloadBytesPerSecond float64
	UploadBytesPerSecond   float64
	Available              bool
}

type NetworkCalculator struct {
	baseline bool
	iface    string
	rx       uint64
	tx       uint64
	at       time.Time
}

func (c *NetworkCalculator) Reset() {
	*c = NetworkCalculator{}
}

func (c *NetworkCalculator) Sample(iface string, rx, tx uint64, at time.Time) NetworkRates {
	if !c.baseline || iface == "" || iface != c.iface || !at.After(c.at) || rx < c.rx || tx < c.tx {
		c.baseline, c.iface, c.rx, c.tx, c.at = true, iface, rx, tx, at
		return NetworkRates{}
	}
	elapsed := at.Sub(c.at).Seconds()
	result := NetworkRates{
		DownloadBytesPerSecond: float64(rx-c.rx) / elapsed,
		UploadBytesPerSecond:   float64(tx-c.tx) / elapsed,
		Available:              true,
	}
	c.iface, c.rx, c.tx, c.at = iface, rx, tx, at
	return result
}

type LoadAverage struct {
	One     float64
	Five    float64
	Fifteen float64
}

func ParseLoadAverage(input string) (LoadAverage, error) {
	fields := strings.Fields(input)
	if len(fields) < 3 {
		return LoadAverage{}, errors.New("loadavg has too few fields")
	}
	values := make([]float64, 3)
	for i := range values {
		value, err := strconv.ParseFloat(fields[i], 64)
		if err != nil {
			return LoadAverage{}, fmt.Errorf("parse load average: %w", err)
		}
		values[i] = value
	}
	return LoadAverage{One: values[0], Five: values[1], Fifteen: values[2]}, nil
}

func ParseUptime(input string) (time.Duration, error) {
	fields := strings.Fields(input)
	if len(fields) == 0 {
		return 0, errors.New("uptime is empty")
	}
	seconds, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || seconds < 0 {
		return 0, errors.New("invalid uptime")
	}
	return time.Duration(seconds * float64(time.Second)), nil
}

type DiskUsage struct {
	Total uint64
	Used  uint64
	Free  uint64
}

func ParseDF(input string) (DiskUsage, error) {
	mounts, err := ParseDFMounts(input)
	if err != nil {
		return DiskUsage{}, err
	}
	for _, mount := range mounts {
		if mount.MountPath == "/" {
			return DiskUsage{
				Total: mount.Total,
				Used:  mount.Used,
				Free:  mount.Available,
			}, nil
		}
	}
	return DiskUsage{}, errors.New("df root data row not found")
}

func ParseDFMounts(input string) ([]domain.DiskMount, error) {
	lines := strings.Split(strings.TrimSpace(input), "\n")
	blockSize := uint64(1)
	for _, line := range lines {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "block_size="); ok {
			parsed, err := strconv.ParseUint(value, 10, 64)
			if err == nil && parsed > 0 {
				blockSize = parsed
			}
		}
	}
	mounts := make([]domain.DiskMount, 0, len(lines))
	seen := make(map[string]bool)
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		total, errTotal := strconv.ParseUint(fields[len(fields)-5], 10, 64)
		used, errUsed := strconv.ParseUint(fields[len(fields)-4], 10, 64)
		free, errFree := strconv.ParseUint(fields[len(fields)-3], 10, 64)
		if errTotal == nil && errUsed == nil && errFree == nil {
			if total > math.MaxUint64/blockSize || used > math.MaxUint64/blockSize || free > math.MaxUint64/blockSize {
				continue
			}
			mountPath := fields[len(fields)-1]
			if seen[mountPath] {
				continue
			}
			seen[mountPath] = true
			totalBytes := total * blockSize
			usedBytes := used * blockSize
			usedPercent := float64(0)
			if totalBytes > 0 {
				usedPercent = float64(usedBytes) / float64(totalBytes) * 100
			}
			mounts = append(mounts, domain.DiskMount{
				Filesystem:  fields[0],
				MountPath:   mountPath,
				Total:       totalBytes,
				Used:        usedBytes,
				Available:   free * blockSize,
				UsedPercent: usedPercent,
			})
		}
	}
	if len(mounts) == 0 {
		return nil, errors.New("df data row not found")
	}
	return mounts, nil
}

func ParseProcesses(input string) ([]domain.ProcessInfo, error) {
	processes := make([]domain.ProcessInfo, 0, 8)
	for line := range strings.Lines(input) {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		pid, errPID := strconv.ParseInt(fields[0], 10, 64)
		cpu, errCPU := strconv.ParseFloat(strings.TrimSuffix(fields[1], "%"), 64)
		memory, errMemory := strconv.ParseFloat(strings.TrimSuffix(fields[2], "%"), 64)
		if errPID != nil || errCPU != nil || errMemory != nil || pid <= 0 ||
			math.IsNaN(cpu) || math.IsInf(cpu, 0) || cpu < 0 ||
			math.IsNaN(memory) || math.IsInf(memory, 0) || memory < 0 {
			continue
		}
		command := strings.TrimSpace(strings.Join(fields[3:], " "))
		if command == "" {
			command = fmt.Sprintf("[%d]", pid)
		}
		processes = append(processes, domain.ProcessInfo{
			PID:           pid,
			CPUPercent:    cpu,
			MemoryPercent: memory,
			Command:       command,
		})
	}
	if len(processes) == 0 {
		return nil, errors.New("process data row not found")
	}
	return processes, nil
}

type ProcProcessSample struct {
	PID      int64
	CPUTicks uint64
	RSSBytes uint64
	Command  string
}

func ParseProcProcesses(input string) ([]ProcProcessSample, error) {
	processes := make([]ProcProcessSample, 0, 64)
	rows := 0
	for line := range strings.Lines(input) {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		rows++
		if len(fields) < 3 {
			continue
		}
		pid, errPID := strconv.ParseInt(fields[0], 10, 64)
		ticks, errTicks := strconv.ParseUint(fields[1], 10, 64)
		rss, errRSS := strconv.ParseUint(fields[2], 10, 64)
		if errPID != nil || errTicks != nil || errRSS != nil || pid <= 0 {
			continue
		}
		command := strings.TrimSpace(strings.Join(fields[3:], " "))
		if command == "" {
			command = fmt.Sprintf("[%d]", pid)
		}
		processes = append(processes, ProcProcessSample{
			PID: pid, CPUTicks: ticks, RSSBytes: rss, Command: command,
		})
	}
	if rows > 0 && len(processes) == 0 {
		return nil, errors.New("procfs process data row not found")
	}
	return processes, nil
}

func FormatBytesPerSecond(value float64) string {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		value = 0
	}
	units := []string{"B/s", "KB/s", "MB/s", "GB/s", "TB/s"}
	unit := 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%.0f %s", value, units[unit])
	}
	return fmt.Sprintf("%.2f %s", value, units[unit])
}
