//go:build windows

package localmonitor

import (
	"fmt"
	"math"
	"net"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"hostdeck/internal/domain"
)

type OSProvider struct {
	mu            sync.Mutex
	lastCPU       cpuTimes
	hasCPU        bool
	lastNetByName map[string]netCounters
	lastNetAt     time.Time
	hasNet        bool
	startedAt     time.Time
}

var gpuRegistryCache struct {
	once sync.Once
	rows []domain.LocalGpuSnapshot
}

type cpuTimes struct {
	idle   uint64
	kernel uint64
	user   uint64
}

type netCounters struct {
	rx uint64
	tx uint64
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

type processMemoryCountersEx struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
	PrivateUsage               uintptr
}

type windowsProcessEntry struct {
	pid  uint32
	name string
}

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	ntdll                    = syscall.NewLazyDLL("ntdll.dll")
	pdhDLL                   = syscall.NewLazyDLL("pdh.dll")
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetTickCount64       = kernel32.NewProc("GetTickCount64")
	procGetProcessMemoryInfo = kernel32.NewProc("K32GetProcessMemoryInfo")
	procRtlGetVersion        = ntdll.NewProc("RtlGetVersion")
	procPdhOpenQuery         = pdhDLL.NewProc("PdhOpenQueryW")
	procPdhAddEnglishCounter = pdhDLL.NewProc("PdhAddEnglishCounterW")
	procPdhCollectQueryData  = pdhDLL.NewProc("PdhCollectQueryData")
	procPdhGetCounterArray   = pdhDLL.NewProc("PdhGetFormattedCounterArrayW")
	procPdhCloseQuery        = pdhDLL.NewProc("PdhCloseQuery")
)

const (
	pdhFmtDouble = 0x00000200
)

type pdhFormattedCounterValue struct {
	Status uint32
	_      uint32
	Double float64
}

type pdhFormattedCounterValueItem struct {
	Name  *uint16
	Value pdhFormattedCounterValue
}

func NewOSProvider() Provider {
	return &OSProvider{startedAt: time.Now()}
}

func (p *OSProvider) Snapshot() (domain.LocalResourceSnapshot, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	hostname, _ := os.Hostname()
	memory := systemMemory()
	cpuPercent := p.cpuPercent()
	interfaces := networkInterfacesAndCounters()
	interfaces, downloadRate, uploadRate := p.networkRates(now, interfaces)
	osVersion, osBuild := windowsVersionDetails()

	total := memory.TotalPhys
	available := memory.AvailPhys
	usedPercent := 0.0
	if total > 0 && available <= total {
		usedPercent = float64(total-available) / float64(total) * 100
	}
	uptimeSeconds := int64(0)
	if ticks := getTickCount64(); ticks > 0 {
		uptimeSeconds = int64(ticks / 1000)
	} else if !p.startedAt.IsZero() {
		uptimeSeconds = int64(now.Sub(p.startedAt).Seconds())
	}

	return domain.LocalResourceSnapshot{
		Status:                 "online",
		Hostname:               hostname,
		Platform:               runtime.GOOS,
		OSName:                 "Windows",
		OSVersion:              osVersion,
		OSBuild:                osBuild,
		Architecture:           runtime.GOARCH,
		CPULogicalProcessors:   runtime.NumCPU(),
		Timestamp:              now.Format(time.RFC3339),
		UptimeSeconds:          uptimeSeconds,
		CPUPercent:             cpuPercent,
		MemoryTotal:            total,
		MemoryAvailable:        available,
		MemoryUsedPercent:      usedPercent,
		PagefileTotal:          memory.TotalPageFile,
		PagefileFree:           memory.AvailPageFile,
		GPUs:                   windowsGPUs(),
		UploadBytesPerSecond:   uploadRate,
		DownloadBytesPerSecond: downloadRate,
		NetworkInterfaces:      interfaces,
		Disks:                  diskVolumes(),
		Processes:              windowsProcesses(total),
	}, nil
}

func (p *OSProvider) cpuPercent() float64 {
	current, ok := readCPUTimes()
	if !ok {
		return 0
	}
	if !p.hasCPU {
		p.lastCPU = current
		p.hasCPU = true
		return 0
	}
	prev := p.lastCPU
	p.lastCPU = current
	idle := current.idle - prev.idle
	kernel := current.kernel - prev.kernel
	user := current.user - prev.user
	total := kernel + user
	if total == 0 || idle > total {
		return 0
	}
	return float64(total-idle) / float64(total) * 100
}

func (p *OSProvider) networkRates(now time.Time, interfaces []domain.LocalNetworkInterface) ([]domain.LocalNetworkInterface, float64, float64) {
	current := make(map[string]netCounters, len(interfaces))
	for _, item := range interfaces {
		current[item.Name] = netCounters{rx: item.RXBytes, tx: item.TXBytes}
	}
	if !p.hasNet {
		p.lastNetByName = current
		p.lastNetAt = now
		p.hasNet = true
		return interfaces, 0, 0
	}
	elapsed := now.Sub(p.lastNetAt).Seconds()
	prevByName := p.lastNetByName
	p.lastNetByName = current
	p.lastNetAt = now
	if elapsed <= 0 {
		return interfaces, 0, 0
	}
	totalDownload := 0.0
	totalUpload := 0.0
	for index := range interfaces {
		prev, ok := prevByName[interfaces[index].Name]
		if !ok {
			continue
		}
		rxDelta := uint64(0)
		txDelta := uint64(0)
		if interfaces[index].RXBytes >= prev.rx {
			rxDelta = interfaces[index].RXBytes - prev.rx
		}
		if interfaces[index].TXBytes >= prev.tx {
			txDelta = interfaces[index].TXBytes - prev.tx
		}
		interfaces[index].DownloadBytesPerSecond = float64(rxDelta) / elapsed
		interfaces[index].UploadBytesPerSecond = float64(txDelta) / elapsed
		totalDownload += interfaces[index].DownloadBytesPerSecond
		totalUpload += interfaces[index].UploadBytesPerSecond
	}
	return interfaces, totalDownload, totalUpload
}

func systemMemory() memoryStatusEx {
	status := memoryStatusEx{Length: uint32(unsafe.Sizeof(memoryStatusEx{}))}
	ret, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&status)))
	if ret == 0 {
		return memoryStatusEx{}
	}
	return status
}

func getTickCount64() uint64 {
	ret, _, _ := procGetTickCount64.Call()
	return uint64(ret)
}

func readCPUTimes() (cpuTimes, bool) {
	var idle, kernelTime, user windows.Filetime
	ret, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&user)),
	)
	if ret == 0 {
		return cpuTimes{}, false
	}
	return cpuTimes{
		idle:   filetimeTicks(idle),
		kernel: filetimeTicks(kernelTime),
		user:   filetimeTicks(user),
	}, true
}

func filetimeTicks(value windows.Filetime) uint64 {
	return uint64(value.HighDateTime)<<32 | uint64(value.LowDateTime)
}

func networkInterfacesAndCounters() []domain.LocalNetworkInterface {
	names := make(map[string]struct{})
	for _, iface := range mustInterfaces() {
		names[iface.Name] = struct{}{}
	}
	adapterByIndex := adapterMetadataByIndex()
	defaultRouteByIndex := defaultRouteInterfaceIndices()
	var table *windows.MibIfTable2
	if err := windows.GetIfTable2Ex(windows.MibIfTableNormal, &table); err != nil || table == nil {
		return interfaceNamesOnly(names)
	}
	defer windows.FreeMibTable(unsafe.Pointer(table))
	if table.NumEntries == 0 {
		return nil
	}

	rows := unsafe.Slice(&table.Table[0], int(table.NumEntries))
	interfaces := make([]domain.LocalNetworkInterface, 0, len(rows))
	defaultByName := make(map[string]bool)
	for _, row := range rows {
		name := windows.UTF16ToString(row.Alias[:])
		if name == "" {
			name = windows.UTF16ToString(row.Description[:])
		}
		if name == "" {
			continue
		}
		meta := adapterByIndex[row.InterfaceIndex]
		displayName := name
		if meta.friendlyName != "" {
			displayName = meta.friendlyName
		}
		description := windows.UTF16ToString(row.Description[:])
		if meta.description != "" {
			description = meta.description
		}
		speed := row.TransmitLinkSpeed
		if row.ReceiveLinkSpeed > speed {
			speed = row.ReceiveLinkSpeed
		}
		isDefaultRoute := defaultRouteByIndex[row.InterfaceIndex]
		if isDefaultRoute {
			defaultByName[name] = true
			defaultByName[displayName] = true
		}
		interfaces = append(interfaces, domain.LocalNetworkInterface{
			Name:           name,
			DisplayName:    displayName,
			Description:    description,
			IsUp:           row.OperStatus == windows.IfOperStatusUp || meta.isUp,
			HasGateway:     meta.hasGateway,
			IsDefaultRoute: isDefaultRoute,
			IsPhysicalLike: physicalLikeInterface(row.Type, row.TunnelType),
			IsVirtual:      virtualInterface(row.Type, row.TunnelType, name, description),
			IsLoopback:     row.Type == windows.IF_TYPE_SOFTWARE_LOOPBACK,
			SpeedBps:       speed,
			RXBytes:        row.InOctets,
			TXBytes:        row.OutOctets,
		})
	}
	interfaces = classifyLocalNetworkInterfaces(interfaces, defaultByName)
	sort.SliceStable(interfaces, func(i, j int) bool {
		if interfaces[i].IsDefaultRoute != interfaces[j].IsDefaultRoute {
			return interfaces[i].IsDefaultRoute
		}
		if interfaces[i].IsHiddenByDefault != interfaces[j].IsHiddenByDefault {
			return !interfaces[i].IsHiddenByDefault
		}
		return interfaces[i].Name < interfaces[j].Name
	})
	return interfaces
}

func mustInterfaces() []net.Interface {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	return interfaces
}

func interfaceNamesOnly(names map[string]struct{}) []domain.LocalNetworkInterface {
	result := make([]domain.LocalNetworkInterface, 0, len(names))
	for name := range names {
		result = append(result, domain.LocalNetworkInterface{Name: name, DisplayName: name, IsUp: true})
	}
	result = classifyLocalNetworkInterfaces(result, nil)
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result
}

type adapterMetadata struct {
	friendlyName string
	description  string
	isUp         bool
	hasGateway   bool
}

func adapterMetadataByIndex() map[uint32]adapterMetadata {
	const maxAttempts = 3
	size := uint32(15 * 1024)
	for attempt := 0; attempt < maxAttempts; attempt++ {
		buffer := make([]byte, size)
		first := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buffer[0]))
		err := windows.GetAdaptersAddresses(
			windows.AF_UNSPEC,
			windows.GAA_FLAG_INCLUDE_GATEWAYS|windows.GAA_FLAG_INCLUDE_ALL_INTERFACES,
			0,
			first,
			&size,
		)
		if err == windows.ERROR_BUFFER_OVERFLOW {
			continue
		}
		if err != nil {
			return nil
		}
		result := map[uint32]adapterMetadata{}
		for adapter := first; adapter != nil; adapter = adapter.Next {
			meta := adapterMetadata{
				friendlyName: windows.UTF16PtrToString(adapter.FriendlyName),
				description:  windows.UTF16PtrToString(adapter.Description),
				isUp:         adapter.OperStatus == windows.IfOperStatusUp,
				hasGateway:   adapter.FirstGatewayAddress != nil,
			}
			if adapter.IfIndex != 0 {
				result[adapter.IfIndex] = meta
			}
			if adapter.Ipv6IfIndex != 0 {
				result[adapter.Ipv6IfIndex] = meta
			}
		}
		return result
	}
	return nil
}

func defaultRouteInterfaceIndices() map[uint32]bool {
	bestMetric := uint32(^uint32(0))
	best := map[uint32]bool{}
	for _, family := range []uint16{windows.AF_INET, windows.AF_INET6} {
		var table *windows.MibIpForwardTable2
		if err := windows.GetIpForwardTable2(family, &table); err != nil || table == nil {
			continue
		}
		if table.NumEntries == 0 {
			windows.FreeMibTable(unsafe.Pointer(table))
			continue
		}
		rows := unsafe.Slice(&table.Table[0], int(table.NumEntries))
		for _, row := range rows {
			if row.InterfaceIndex == 0 || row.DestinationPrefix.PrefixLength != 0 || row.Loopback != 0 {
				continue
			}
			if row.Metric < bestMetric {
				bestMetric = row.Metric
				best = map[uint32]bool{row.InterfaceIndex: true}
			} else if row.Metric == bestMetric {
				best[row.InterfaceIndex] = true
			}
		}
		windows.FreeMibTable(unsafe.Pointer(table))
	}
	return best
}

func classifyLocalNetworkInterfaces(rows []domain.LocalNetworkInterface, defaultByName map[string]bool) []domain.LocalNetworkInterface {
	result := make([]domain.LocalNetworkInterface, len(rows))
	for index, row := range rows {
		if defaultByName != nil && (defaultByName[row.Name] || defaultByName[row.DisplayName]) {
			row.IsDefaultRoute = true
		}
		joined := strings.ToLower(strings.Join([]string{row.Name, row.DisplayName, row.Description}, " "))
		if strings.Contains(joined, "loopback") {
			row.IsLoopback = true
		}
		if hasAny(joined, []string{"vmware", "virtualbox", "hyper-v", "wintun", "wireguard", " singbox", "singbox_", " tap", " tun", " vpn"}) {
			row.IsVirtual = true
		}
		if !row.IsPhysicalLike && !row.IsVirtual && !row.IsLoopback {
			row.IsPhysicalLike = hasAny(joined, []string{"ethernet", "wi-fi", "wifi", "wlan", "802.11"})
		}
		row.IsHiddenByDefault = shouldHideLocalInterface(row, joined)
		if row.IsDefaultRoute && row.IsUp && !row.IsVirtual && !row.IsLoopback {
			row.IsHiddenByDefault = false
		}
		result[index] = row
	}
	if !hasVisiblePhysicalLocalInterface(result) {
		for index, row := range result {
			if row.IsDefaultRoute && row.IsUp && row.IsVirtual && !row.IsLoopback {
				result[index].IsHiddenByDefault = false
			}
		}
	}
	return result
}

func shouldHideLocalInterface(row domain.LocalNetworkInterface, joined string) bool {
	if row.IsLoopback || !row.IsUp {
		return true
	}
	if hasAny(joined, []string{
		"packet driver",
		"ndis filter",
		"wfp",
		"qos packet scheduler",
		"ip-https",
		"teredo",
		"pseudo-interface",
		"isatap",
		"lightweight filter",
	}) {
		return true
	}
	if strings.Contains(joined, "filter") && !row.IsDefaultRoute {
		return true
	}
	if row.IsVirtual {
		return true
	}
	return false
}

func hasVisiblePhysicalLocalInterface(rows []domain.LocalNetworkInterface) bool {
	for _, row := range rows {
		if row.IsUp && row.IsPhysicalLike && !row.IsVirtual && !row.IsLoopback && !row.IsHiddenByDefault {
			return true
		}
	}
	return false
}

func hasAny(value string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func physicalLikeInterface(ifType, tunnelType uint32) bool {
	if tunnelType != 0 || ifType == windows.IF_TYPE_TUNNEL || ifType == windows.IF_TYPE_SOFTWARE_LOOPBACK {
		return false
	}
	return ifType == windows.IF_TYPE_ETHERNET_CSMACD || ifType == windows.IF_TYPE_IEEE80211 || ifType == windows.IF_TYPE_PPP
}

func virtualInterface(ifType, tunnelType uint32, name, description string) bool {
	if tunnelType != 0 || ifType == windows.IF_TYPE_TUNNEL {
		return true
	}
	joined := strings.ToLower(name + " " + description)
	return hasAny(joined, []string{"vmware", "virtualbox", "hyper-v", "wintun", "wireguard", "singbox", "meta virtual", "meta adapter", " vpn", " tap", " tun"})
}

func windowsGPUs() []domain.LocalGpuSnapshot {
	gpuRegistryCache.once.Do(func() {
		gpuRegistryCache.rows = readWindowsGPUsFromRegistry()
	})
	usagePercent, usageAvailable := readWindowsGPUEngineUsagePercent()
	if !usageAvailable {
		usagePercent = -1
	}
	memoryUsed, memoryAvailable := readWindowsGPUDedicatedMemoryUsedBytes()
	if !memoryAvailable {
		memoryUsed = 0
	}
	return selectWindowsGPUs(gpuRegistryCache.rows, usagePercent, memoryUsed)
}

func selectWindowsGPUs(rows []domain.LocalGpuSnapshot, usagePercent float64, memoryUsedBytes uint64) []domain.LocalGpuSnapshot {
	selected := make([]domain.LocalGpuSnapshot, 0, len(rows))
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		if name == "" || virtualDisplayGPUName(name) {
			continue
		}
		row.Name = name
		row.UsagePercent = -1
		selected = append(selected, row)
	}
	if len(selected) == 0 {
		return []domain.LocalGpuSnapshot{{
			Available:         false,
			UsagePercent:      -1,
			UnavailableReason: "unavailable",
		}}
	}
	sort.SliceStable(selected, func(i, j int) bool {
		leftRank := physicalGPUNameRank(selected[i].Name)
		rightRank := physicalGPUNameRank(selected[j].Name)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if selected[i].Available != selected[j].Available {
			return selected[i].Available
		}
		return selected[i].Name < selected[j].Name
	})
	usagePercent = normalizeGPUUsagePercent(usagePercent)
	if usagePercent >= 0 {
		selected[0].UsagePercent = usagePercent
	}
	if memoryUsedBytes > 0 && selected[0].MemoryUsedBytes == 0 {
		selected[0].MemoryUsedBytes = memoryUsedBytes
	}
	return selected
}

func normalizeGPUUsagePercent(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return -1
	}
	if value > 100 {
		return 100
	}
	return value
}

func virtualDisplayGPUName(name string) bool {
	return hasAny(strings.ToLower(name), []string{
		"oray",
		"idd",
		"indirect display",
		"virtual display",
		"remote display",
		"microsoft basic display",
		"rdp",
		"vmware",
		"virtualbox",
	})
}

func physicalGPUNameRank(name string) int {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "nvidia"):
		return 0
	case strings.Contains(lower, "amd"), strings.Contains(lower, "radeon"):
		return 1
	case strings.Contains(lower, "intel") && (strings.Contains(lower, "uhd") || strings.Contains(lower, "iris") || strings.Contains(lower, "arc")):
		return 2
	default:
		return 3
	}
}

func readWindowsGPUsFromRegistry() []domain.LocalGpuSnapshot {
	root, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Video`, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer root.Close()
	guidKeys, err := root.ReadSubKeyNames(-1)
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	rows := make([]domain.LocalGpuSnapshot, 0, len(guidKeys))
	for _, guid := range guidKeys {
		key, err := registry.OpenKey(root, guid+`\0000`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		name := registryStringValue(key, "HardwareInformation.AdapterString", "DriverDesc")
		memoryTotal := registryUint64Value(key, "HardwareInformation.qwMemorySize", "HardwareInformation.MemorySize")
		key.Close()
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		seen[strings.ToLower(name)] = true
		rows = append(rows, domain.LocalGpuSnapshot{
			Name:             name,
			Available:        true,
			UsagePercent:     -1,
			MemoryTotalBytes: memoryTotal,
		})
	}
	return rows
}

func readWindowsGPUEngineUsagePercent() (float64, bool) {
	values, ok := readWindowsPDHCounterValues(`\GPU Engine(*)\Utilization Percentage`, true)
	if !ok || len(values) == 0 {
		return -1, false
	}
	total := 0.0
	for _, value := range values {
		if value > 0 {
			total += value
		}
	}
	return normalizeGPUUsagePercent(total), true
}

func readWindowsGPUDedicatedMemoryUsedBytes() (uint64, bool) {
	values, ok := readWindowsPDHCounterValues(`\GPU Adapter Memory(*)\Dedicated Usage`, false)
	if !ok || len(values) == 0 {
		return 0, false
	}
	total := 0.0
	for _, value := range values {
		if value > 0 {
			total += value
		}
	}
	if total <= 0 || math.IsNaN(total) || math.IsInf(total, 0) {
		return 0, false
	}
	return uint64(total), true
}

func readWindowsPDHCounterValues(counterPath string, collectTwice bool) ([]float64, bool) {
	var query windows.Handle
	ret, _, _ := procPdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&query)))
	if ret != 0 || query == 0 {
		return nil, false
	}
	defer procPdhCloseQuery.Call(uintptr(query))

	path, err := windows.UTF16PtrFromString(counterPath)
	if err != nil {
		return nil, false
	}
	var counter windows.Handle
	ret, _, _ = procPdhAddEnglishCounter.Call(
		uintptr(query),
		uintptr(unsafe.Pointer(path)),
		0,
		uintptr(unsafe.Pointer(&counter)),
	)
	if ret != 0 || counter == 0 {
		return nil, false
	}
	if ret, _, _ = procPdhCollectQueryData.Call(uintptr(query)); ret != 0 {
		return nil, false
	}
	if collectTwice {
		time.Sleep(120 * time.Millisecond)
		if ret, _, _ = procPdhCollectQueryData.Call(uintptr(query)); ret != 0 {
			return nil, false
		}
	}

	var bufferSize uint32
	var itemCount uint32
	procPdhGetCounterArray.Call(
		uintptr(counter),
		pdhFmtDouble,
		uintptr(unsafe.Pointer(&bufferSize)),
		uintptr(unsafe.Pointer(&itemCount)),
		0,
	)
	if bufferSize == 0 || itemCount == 0 {
		return nil, false
	}
	buffer := make([]byte, bufferSize)
	ret, _, _ = procPdhGetCounterArray.Call(
		uintptr(counter),
		pdhFmtDouble,
		uintptr(unsafe.Pointer(&bufferSize)),
		uintptr(unsafe.Pointer(&itemCount)),
		uintptr(unsafe.Pointer(&buffer[0])),
	)
	if ret != 0 || itemCount == 0 {
		return nil, false
	}
	items := unsafe.Slice((*pdhFormattedCounterValueItem)(unsafe.Pointer(&buffer[0])), int(itemCount))
	values := make([]float64, 0, len(items))
	for _, item := range items {
		value := item.Value.Double
		if item.Value.Status == 0 && !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 {
			values = append(values, value)
		}
	}
	return values, len(values) > 0
}

func registryStringValue(key registry.Key, names ...string) string {
	for _, name := range names {
		if value, _, err := key.GetStringValue(name); err == nil && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
		if data, _, err := key.GetBinaryValue(name); err == nil {
			if value := utf16BytesToString(data); value != "" {
				return value
			}
		}
	}
	return ""
}

func registryUint64Value(key registry.Key, names ...string) uint64 {
	for _, name := range names {
		if value, _, err := key.GetIntegerValue(name); err == nil {
			return value
		}
		if data, _, err := key.GetBinaryValue(name); err == nil {
			switch {
			case len(data) >= 8:
				return uint64(data[0]) |
					uint64(data[1])<<8 |
					uint64(data[2])<<16 |
					uint64(data[3])<<24 |
					uint64(data[4])<<32 |
					uint64(data[5])<<40 |
					uint64(data[6])<<48 |
					uint64(data[7])<<56
			case len(data) >= 4:
				return uint64(data[0]) |
					uint64(data[1])<<8 |
					uint64(data[2])<<16 |
					uint64(data[3])<<24
			}
		}
	}
	return 0
}

func utf16BytesToString(data []byte) string {
	if len(data) < 2 {
		return ""
	}
	words := make([]uint16, 0, len(data)/2)
	for index := 0; index+1 < len(data); index += 2 {
		word := uint16(data[index]) | uint16(data[index+1])<<8
		if word == 0 {
			break
		}
		words = append(words, word)
	}
	return strings.TrimSpace(string(utf16.Decode(words)))
}

type rtlOsVersionInfoEx struct {
	OSVersionInfoSize uint32
	MajorVersion      uint32
	MinorVersion      uint32
	BuildNumber       uint32
	PlatformID        uint32
	CSDVersion        [128]uint16
}

func windowsVersionDetails() (string, string) {
	info := rtlOsVersionInfoEx{OSVersionInfoSize: uint32(unsafe.Sizeof(rtlOsVersionInfoEx{}))}
	ret, _, _ := procRtlGetVersion.Call(uintptr(unsafe.Pointer(&info)))
	if ret != 0 {
		return "", ""
	}
	name := "Windows"
	if info.MajorVersion == 10 && info.BuildNumber >= 22000 {
		name = "Windows 11"
	} else if info.MajorVersion == 10 {
		name = "Windows 10"
	}
	return fmt.Sprintf("%s %d.%d", name, info.MajorVersion, info.MinorVersion), strconv.FormatUint(uint64(info.BuildNumber), 10)
}

func diskVolumes() []domain.LocalDiskVolume {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil
	}
	result := make([]domain.LocalDiskVolume, 0, 4)
	for index := uint(0); index < 26; index++ {
		if mask&(1<<index) == 0 {
			continue
		}
		letter := rune('A' + index)
		root := fmt.Sprintf("%c:\\", letter)
		rootPtr, err := windows.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		var freeAvailable, total, totalFree uint64
		if err := windows.GetDiskFreeSpaceEx(rootPtr, &freeAvailable, &total, &totalFree); err != nil || total == 0 {
			continue
		}
		used := total - totalFree
		result = append(result, domain.LocalDiskVolume{
			Name:        fmt.Sprintf("%c:", letter),
			MountPath:   root,
			Total:       total,
			Used:        used,
			Available:   freeAvailable,
			UsedPercent: float64(used) / float64(total) * 100,
		})
	}
	return result
}

func windowsProcesses(totalMemory uint64) []domain.LocalProcessInfo {
	entries := enumerateWindowsProcessEntries()
	if len(entries) == 0 {
		return nil
	}
	return selectWindowsTopProcesses(entries, totalMemory, readWindowsProcessWorkingSetBytes)
}

func enumerateWindowsProcessEntries() []windowsProcessEntry {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil || snapshot == windows.InvalidHandle {
		return nil
	}
	defer windows.CloseHandle(snapshot)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return nil
	}
	result := make([]windowsProcessEntry, 0, 64)
	for {
		name := strings.TrimSpace(windows.UTF16ToString(entry.ExeFile[:]))
		if entry.ProcessID != 0 && name != "" {
			result = append(result, windowsProcessEntry{pid: entry.ProcessID, name: name})
		}
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			break
		}
	}
	return result
}

func selectWindowsTopProcesses(
	entries []windowsProcessEntry,
	totalMemory uint64,
	readMemory func(pid uint32) (uint64, bool),
) []domain.LocalProcessInfo {
	rows := make([]domain.LocalProcessInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.pid == 0 || strings.TrimSpace(entry.name) == "" {
			continue
		}
		memoryBytes, ok := readMemory(entry.pid)
		if !ok {
			continue
		}
		memoryPercent := 0.0
		if totalMemory > 0 {
			memoryPercent = float64(memoryBytes) / float64(totalMemory) * 100
		}
		rows = append(rows, domain.LocalProcessInfo{
			PID:           int(entry.pid),
			Name:          strings.TrimSpace(entry.name),
			CPUPercent:    -1,
			MemoryBytes:   memoryBytes,
			MemoryPercent: memoryPercent,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].MemoryBytes != rows[j].MemoryBytes {
			return rows[i].MemoryBytes > rows[j].MemoryBytes
		}
		return rows[i].PID < rows[j].PID
	})
	if len(rows) > 5 {
		rows = rows[:5]
	}
	return rows
}

func readWindowsProcessWorkingSetBytes(pid uint32) (uint64, bool) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil || handle == 0 {
		return 0, false
	}
	defer windows.CloseHandle(handle)

	counters := processMemoryCountersEx{CB: uint32(unsafe.Sizeof(processMemoryCountersEx{}))}
	ret, _, _ := procGetProcessMemoryInfo.Call(
		uintptr(handle),
		uintptr(unsafe.Pointer(&counters)),
		uintptr(counters.CB),
	)
	if ret == 0 || counters.WorkingSetSize == 0 {
		return 0, false
	}
	return uint64(counters.WorkingSetSize), true
}
