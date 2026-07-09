package networkinspect

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"hostdeck/internal/domain"
)

type parseSection string

const (
	sectionNone                    parseSection = ""
	sectionListen                  parseSection = "listen"
	sectionEstablished             parseSection = "established"
	sectionEstablishedFiltered     parseSection = "established-filtered"
	sectionEstablishedAll          parseSection = "established-all"
	sectionEstablishedInfoFiltered parseSection = "established-info-filtered"
	sectionEstablishedInfoAll      parseSection = "established-info-all"
	sectionNetstat                 parseSection = "netstat"
	sectionNetstatListen           parseSection = "netstat-listen"
	sectionNetstatEstablished      parseSection = "netstat-established"
	sectionProc                    parseSection = "proc"
	sectionDockerListen            parseSection = "docker-listen"
	sectionDockerEstablished       parseSection = "docker-established"
	sectionDockerEstablishedInfo   parseSection = "docker-established-info"
	sectionDockerProc              parseSection = "docker-proc"
	sectionInterfaces              parseSection = "interfaces"
)

const (
	sourceHost   = "host"
	sourceDocker = "docker"
)

type SnapshotParseStats struct {
	Strategy                    string
	SSPathKind                  string
	SSDialect                   string
	ListenerCommandStatus       string
	ConnectionCommandStatus     string
	CounterCommandStatus        string
	ProcessCommandStatus        string
	ListenerLineCount           int
	ConnectionLineCount         int
	ParsedListenerCount         int
	ParsedConnectionCount       int
	MatchedConnectionCount      int
	UnmatchedConnectionCount    int
	ByteCounterSocketCount      int
	UploadBytesKnownCount       int
	UploadBytesEstimatedCount   int
	DownloadBytesKnownCount     int
	CounterMissingCount         int
	RowLimit                    int
	RemoteSocketCount           int
	RemoteConntrackCount        int
	DockerSocketCount           int
	DockerContainerCount        int
	DockerScannedContainerCount int
	PermissionLimited           bool
}

type processInfo struct {
	pid  *int64
	name string
}

type listenerRecord struct {
	protocol          string
	family            string
	address           string
	port              int
	pid               *int64
	processName       string
	sourceType        string
	sourceName        string
	containerID       string
	containerName     string
	permissionLimited bool
}

type connectionRecord struct {
	id               string
	protocol         string
	family           string
	localAddr        string
	localPort        int
	remoteAddr       string
	remotePort       int
	pid              *int64
	processName      string
	sourceType       string
	sourceName       string
	containerID      string
	containerName    string
	aggregateCount   *int
	aggregateRemote  *int
	uploaded         *uint64
	uploadedEstimate *uint64
	downloaded       *uint64
}

type interfaceAddress struct {
	name string
	ip   string
}

type procSocketRecord struct {
	protocol   string
	localAddr  string
	localPort  int
	remoteAddr string
	remotePort int
	state      string
	inode      string
}

type procOwner struct {
	pid  int64
	comm string
}

type aggregationStats struct {
	parsedConnections      int
	matchedConnections     int
	unmatchedConnections   int
	byteCounterSockets     int
	uploadKnownSockets     int
	uploadEstimatedSockets int
	downloadKnownSockets   int
	counterMissingSockets  int
}

type socketSummary struct {
	connectionCount *int
	remoteIPCount   *int
	available       bool
}

type dockerSnapshotState struct {
	available             bool
	namespaceAvailable    bool
	permissionLimited     bool
	containerCount        int
	scannedContainerCount int
	aggregated            bool
	truncated             bool
	summary               socketSummary
}

type conntrackSummary struct {
	connectionCount *int
	remoteIPCount   *int
	available       bool
	source          string
}

var usersProcessPattern = regexp.MustCompile(`"([^"]*)",(?:pid=)?([0-9]+)(?:,(?:fd=)?[0-9]+)?`)

func ParseSnapshot(serverID int64, contextID string, output string, interfaceName string, collectedAt string) (domain.NetworkEndpointSnapshot, error) {
	snapshot, _, err := ParseSnapshotWithStats(serverID, contextID, output, interfaceName, collectedAt)
	return snapshot, err
}

func ParseSnapshotWithStats(serverID int64, contextID string, output string, interfaceName string, collectedAt string) (domain.NetworkEndpointSnapshot, SnapshotParseStats, error) {
	strategy := "unknown"
	section := sectionNone
	listeners := make([]listenerRecord, 0)
	connections := make([]connectionRecord, 0)
	ifaces := make([]interfaceAddress, 0)
	procSockets := make([]procSocketRecord, 0)
	procOwners := make(map[string][]procOwner)
	var currentConnection *connectionRecord
	permissionLimited := false
	byteCountersAvailable := false
	warnings := make([]string, 0)
	stats := SnapshotParseStats{}
	rowLimit := 0
	remoteSocketSummary := socketSummary{}
	localSocketSummaries := make(map[string]socketSummary)
	remoteConntrackSummary := conntrackSummary{}
	dockerState := dockerSnapshotState{}
	listenersAvailable := false
	connectionsAvailable := false
	processInfoAvailable := false
	counterCommandAvailable := false
	currentSource := sourceHost
	currentSourceName := "宿主机"
	currentContainerID := ""
	currentContainerName := ""

	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		switch {
		case strings.HasPrefix(trimmed, "__SPNI_ROW_LIMIT__"):
			if value, ok := parseMarkerInt(trimmed, 1); ok {
				rowLimit = value
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_SOCKET_SUMMARY__"):
			remoteSocketSummary = parseSocketSummaryLine(trimmed)
			if remoteSocketSummary.available {
				connectionsAvailable = true
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_SOCKET_LOCAL_SUMMARY__"):
			address, summary, ok := parseSocketLocalSummaryLine(trimmed)
			if ok {
				localSocketSummaries[normalizeAddress(address)] = summary
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_STATUS__"):
			parseDockerStatusLine(trimmed, &dockerState, &warnings)
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_CONTAINER__"):
			id, name, countOK := parseDockerContainerLine(trimmed)
			if countOK {
				dockerState.available = true
				dockerState.scannedContainerCount++
				currentSource = sourceDocker
				currentContainerID = id
				currentContainerName = name
				currentSourceName = dockerSourceName(name)
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_SOCKET_SUMMARY__"):
			summary := parseDockerSocketSummaryLine(trimmed)
			if summary.available {
				dockerState.available = true
				dockerState.namespaceAvailable = true
				dockerState.summary = addSocketSummary(dockerState.summary, summary)
				connectionsAvailable = true
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_ENDPOINT_SUMMARY__"):
			conn, ok := parseDockerEndpointSummaryLine(trimmed)
			if ok {
				dockerState.available = true
				dockerState.namespaceAvailable = true
				connectionsAvailable = true
				connections = append(connections, conn)
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_CONNTRACK_SUMMARY__"):
			// Conntrack is intentionally not part of the current Network Details product scope.
			continue
		case strings.HasPrefix(trimmed, "__SPNI_WARNING__"):
			warning := strings.TrimSpace(strings.TrimPrefix(trimmed, "__SPNI_WARNING__"))
			warning = strings.Trim(warning, "\t ")
			if warning != "" {
				warnings = append(warnings, warning)
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_STRATEGY__"):
			fields := strings.Fields(trimmed)
			if len(fields) >= 2 {
				strategy = fields[1]
			}
			section = sectionNone
			currentConnection = nil
			continue
		case strings.HasPrefix(trimmed, "__SPNI_TOOL__"):
			fields := strings.Fields(trimmed)
			if len(fields) >= 3 && fields[1] == "ss" {
				stats.SSPathKind = fields[2]
			}
			continue
		case strings.HasPrefix(trimmed, "__SPNI_STATUS__"):
			stage, status, ok := parseStatusLine(trimmed)
			if ok {
				switch stage {
				case "listener":
					stats.ListenerCommandStatus = mergeCommandStatus(stats.ListenerCommandStatus, status)
					if commandStatusOK(status) {
						listenersAvailable = true
					}
				case "connection":
					stats.ConnectionCommandStatus = mergeCommandStatus(stats.ConnectionCommandStatus, status)
					if commandStatusOK(status) {
						connectionsAvailable = true
					}
					if strings.Contains(status, "filtered") {
						stats.SSDialect = "state-filter"
					} else if strings.Contains(status, "all") && stats.SSDialect == "" {
						stats.SSDialect = "all"
					}
				case "counter":
					stats.CounterCommandStatus = mergeCommandStatus(stats.CounterCommandStatus, status)
					if commandStatusOK(status) {
						counterCommandAvailable = true
					}
				case "process":
					stats.ProcessCommandStatus = mergeCommandStatus(stats.ProcessCommandStatus, status)
					if commandStatusOK(status) {
						processInfoAvailable = true
					}
				}
			}
			continue
		case trimmed == "__SPNI_LISTEN__":
			section = sectionListen
			currentConnection = nil
			continue
		case trimmed == "__SPNI_LISTEN_PROCESS__":
			section = sectionListen
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED__":
			section = sectionEstablished
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED_FILTERED__":
			section = sectionEstablishedFiltered
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED_ALL__":
			section = sectionEstablishedAll
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED_INFO__":
			section = sectionEstablished
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED_INFO_FILTERED__":
			section = sectionEstablishedInfoFiltered
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED_INFO_ALL__":
			section = sectionEstablishedInfoAll
			currentConnection = nil
			continue
		case trimmed == "__SPNI_ESTABLISHED_PROCESS_FILTERED__":
			section = sectionEstablishedFiltered
			currentConnection = nil
			continue
		case trimmed == "__SPNI_NETSTAT__":
			section = sectionNetstat
			currentConnection = nil
			continue
		case trimmed == "__SPNI_NETSTAT_LISTEN__":
			section = sectionNetstatListen
			currentConnection = nil
			continue
		case trimmed == "__SPNI_NETSTAT_ESTABLISHED__":
			section = sectionNetstatEstablished
			currentConnection = nil
			continue
		case trimmed == "__SPNI_PROC__":
			section = sectionProc
			currentConnection = nil
			continue
		case trimmed == "__SPNI_INTERFACES__":
			section = sectionInterfaces
			currentConnection = nil
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_LISTEN__"):
			currentSource, currentContainerID, currentContainerName, currentSourceName = parseDockerSectionSource(trimmed)
			section = sectionDockerListen
			currentConnection = nil
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_ESTABLISHED_FILTERED__"):
			currentSource, currentContainerID, currentContainerName, currentSourceName = parseDockerSectionSource(trimmed)
			section = sectionDockerEstablished
			currentConnection = nil
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_ESTABLISHED_INFO_FILTERED__"):
			currentSource, currentContainerID, currentContainerName, currentSourceName = parseDockerSectionSource(trimmed)
			section = sectionDockerEstablishedInfo
			currentConnection = nil
			continue
		case strings.HasPrefix(trimmed, "__SPNI_DOCKER_PROC__"):
			currentSource, currentContainerID, currentContainerName, currentSourceName = parseDockerSectionSource(trimmed)
			section = sectionDockerProc
			currentConnection = nil
			continue
		}

		switch section {
		case sectionListen:
			stats.ListenerLineCount++
			parsed := parseSSListenLine(trimmed)
			for _, row := range parsed {
				if row.pid == nil {
					permissionLimited = true
				}
				listeners = append(listeners, withListenerSource(row, sourceHost, "宿主机", "", ""))
			}
		case sectionEstablished, sectionEstablishedFiltered, sectionEstablishedAll, sectionEstablishedInfoFiltered, sectionEstablishedInfoAll:
			if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
				if currentConnection != nil {
					if updateConnectionBytes(currentConnection, trimmed) {
						byteCountersAvailable = true
					}
				}
				continue
			}
			stats.ConnectionLineCount++
			conn, ok := parseSSEstablishedLine(trimmed, sectionUsesStateFilter(section))
			if !ok {
				currentConnection = nil
				continue
			}
			if updateConnectionBytes(&conn, trimmed) {
				byteCountersAvailable = true
			}
			if conn.pid == nil {
				permissionLimited = true
			}
			connections = append(connections, withConnectionSource(conn, sourceHost, "宿主机", "", ""))
			currentConnection = &connections[len(connections)-1]
		case sectionNetstat:
			stats.ListenerLineCount++
			parsed := parseNetstatListenerLine(trimmed)
			for _, row := range parsed {
				if row.pid == nil {
					permissionLimited = true
				}
				listeners = append(listeners, withListenerSource(row, sourceHost, "宿主机", "", ""))
			}
		case sectionNetstatListen:
			stats.ListenerLineCount++
			parsed := parseNetstatListenerLine(trimmed)
			for _, row := range parsed {
				if row.pid == nil {
					permissionLimited = true
				}
				listeners = append(listeners, withListenerSource(row, sourceHost, "宿主机", "", ""))
			}
		case sectionNetstatEstablished:
			stats.ConnectionLineCount++
			conn, ok := parseNetstatEstablishedLine(trimmed)
			if !ok {
				continue
			}
			if conn.pid == nil {
				permissionLimited = true
			}
			connections = append(connections, withConnectionSource(conn, sourceHost, "宿主机", "", ""))
		case sectionDockerListen:
			stats.ListenerLineCount++
			parsed := parseSSListenLine(trimmed)
			for _, row := range parsed {
				row = withListenerSource(row, currentSource, currentSourceName, currentContainerID, currentContainerName)
				if row.processName == "" {
					row.processName = dockerProcessFallback(currentContainerName)
				}
				listeners = append(listeners, row)
			}
		case sectionDockerEstablished, sectionDockerEstablishedInfo:
			if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
				if currentConnection != nil {
					if updateConnectionBytes(currentConnection, trimmed) {
						byteCountersAvailable = true
					}
				}
				continue
			}
			stats.ConnectionLineCount++
			conn, ok := parseSSEstablishedLine(trimmed, true)
			if !ok {
				currentConnection = nil
				continue
			}
			if updateConnectionBytes(&conn, trimmed) {
				byteCountersAvailable = true
			}
			conn = withConnectionSource(conn, currentSource, currentSourceName, currentContainerID, currentContainerName)
			if conn.processName == "" {
				conn.processName = dockerProcessFallback(currentContainerName)
			}
			connections = append(connections, conn)
			currentConnection = &connections[len(connections)-1]
		case sectionDockerProc:
			if socket, ok := parseDockerProcSocketLine(trimmed); ok {
				protocol := protocolFor(socket.protocol, socket.localAddr)
				family := familyFor(socket.localAddr, socket.protocol)
				if socket.state == "0A" || strings.HasPrefix(socket.protocol, "udp") {
					listeners = append(listeners, listenerRecord{
						protocol:          protocol,
						family:            family,
						address:           socket.localAddr,
						port:              socket.localPort,
						processName:       dockerProcessFallback(currentContainerName),
						sourceType:        sourceDocker,
						sourceName:        currentSourceName,
						containerID:       currentContainerID,
						containerName:     currentContainerName,
						permissionLimited: true,
					})
				} else if socket.state == "01" {
					connections = append(connections, connectionRecord{
						id:            sourceSocketID(sourceDocker, currentContainerID, protocol, socket.localAddr, socket.localPort, socket.remoteAddr, socket.remotePort, nil),
						protocol:      protocol,
						family:        family,
						localAddr:     socket.localAddr,
						localPort:     socket.localPort,
						remoteAddr:    socket.remoteAddr,
						remotePort:    socket.remotePort,
						processName:   dockerProcessFallback(currentContainerName),
						sourceType:    sourceDocker,
						sourceName:    currentSourceName,
						containerID:   currentContainerID,
						containerName: currentContainerName,
					})
				}
			}
		case sectionProc:
			if strings.HasPrefix(trimmed, "PROC_SOCKET\t") {
				if socket, ok := parseProcSocketLine(trimmed); ok {
					procSockets = append(procSockets, socket)
				}
			} else if strings.HasPrefix(trimmed, "PROC_OWNER\t") {
				inode, owner, ok := parseProcOwnerLine(trimmed)
				if ok {
					procOwners[inode] = append(procOwners[inode], owner)
				}
			}
		case sectionInterfaces:
			if iface, ok := parseInterfaceLine(trimmed); ok {
				ifaces = append(ifaces, iface)
			}
		}
	}

	if strategy == "proc" {
		listeners, connections, permissionLimited = buildFromProc(procSockets, procOwners)
		byteCountersAvailable = false
		stats.ListenerLineCount = len(procSockets)
		stats.ConnectionLineCount = len(connections)
		if len(listeners) > 0 || listenersAvailable {
			listenersAvailable = true
		}
		if len(connections) > 0 {
			connectionsAvailable = true
		}
	}

	filteredListeners := listeners
	filteredConnections := connections
	interfaceWarnings := []string(nil)
	if len(filteredListeners) > 0 {
		listenersAvailable = true
	}
	if len(filteredConnections) > 0 {
		connectionsAvailable = true
	}
	if byteCountersAvailable && stats.CounterCommandStatus == "" {
		counterCommandAvailable = true
	}
	if !processInfoAvailable && hasProcessInfo(filteredListeners, filteredConnections) {
		processInfoAvailable = true
	}
	byteCountersAvailable = byteCountersAvailable && counterCommandAvailable
	if !listenersAvailable && !connectionsAvailable {
		return domain.NetworkEndpointSnapshot{}, stats, errors.New("读取网络连接信息失败")
	}
	if listenersAvailable && !connectionsAvailable && stats.ConnectionCommandStatus != "" && !strings.Contains(stats.ConnectionCommandStatus, "skipped") {
		warnings = appendWarning(warnings, "已读取监听端口，但活动连接读取失败。")
	}
	if connectionsAvailable && len(filteredConnections) > 0 && !byteCountersAvailable {
		warnings = appendWarning(warnings, "当前 CentOS/iproute2 未提供可靠的单连接字节统计。")
	}
	effectiveSocketSummary := remoteSocketSummary
	snapshot, aggregateStats := aggregateSnapshot(
		serverID,
		contextID,
		strategy,
		filteredListeners,
		filteredConnections,
		listenersAvailable,
		connectionsAvailable,
		processInfoAvailable,
		byteCountersAvailable,
		effectiveSocketSummary,
		dockerState,
		remoteConntrackSummary,
		interfaceName,
		rowLimit,
		collectedAt,
	)
	snapshot.PermissionLimited = permissionLimited || dockerState.permissionLimited || snapshot.PermissionLimited
	snapshot.ByteCountersAvailable = byteCountersAvailable
	if snapshot.Warnings == nil {
		snapshot.Warnings = []string{}
	}
	snapshot.Warnings = append(interfaceWarnings, snapshot.Warnings...)
	snapshot.Warnings = append(warnings, snapshot.Warnings...)
	stats.Strategy = strategy
	stats.ParsedListenerCount = len(filteredListeners)
	stats.ParsedConnectionCount = aggregateStats.parsedConnections
	stats.MatchedConnectionCount = aggregateStats.matchedConnections
	stats.UnmatchedConnectionCount = aggregateStats.unmatchedConnections
	stats.ByteCounterSocketCount = aggregateStats.byteCounterSockets
	stats.UploadBytesKnownCount = aggregateStats.uploadKnownSockets
	stats.UploadBytesEstimatedCount = aggregateStats.uploadEstimatedSockets
	stats.DownloadBytesKnownCount = aggregateStats.downloadKnownSockets
	stats.CounterMissingCount = aggregateStats.counterMissingSockets
	stats.RowLimit = rowLimit
	if snapshot.SocketConnectionCount != nil {
		stats.RemoteSocketCount = *snapshot.SocketConnectionCount
	}
	if snapshot.DockerSocketConnectionCount != nil {
		stats.DockerSocketCount = *snapshot.DockerSocketConnectionCount
	}
	stats.DockerContainerCount = snapshot.DockerContainerCount
	stats.DockerScannedContainerCount = snapshot.DockerScannedContainerCount
	stats.PermissionLimited = snapshot.PermissionLimited
	return snapshot, stats, nil
}

func parseSSListenLine(line string) []listenerRecord {
	if isSSHeader(line) {
		return nil
	}
	fields := strings.Fields(line)
	if len(fields) < 5 {
		return nil
	}
	protoToken := strings.ToLower(fields[0])
	localIndex := 4
	if !strings.HasPrefix(protoToken, "tcp") && !strings.HasPrefix(protoToken, "udp") {
		state := strings.ToLower(fields[0])
		switch state {
		case "listen":
			protoToken = "tcp"
			localIndex = 3
		case "unconn":
			protoToken = "udp"
			localIndex = 3
		default:
			return nil
		}
	}
	if len(fields) <= localIndex {
		return nil
	}
	host, port, ok := parseEndpoint(fields[localIndex])
	if !ok || port <= 0 {
		return nil
	}
	processes := parseUsers(line)
	if len(processes) == 0 {
		processes = []processInfo{{}}
	}
	rows := make([]listenerRecord, 0, len(processes))
	for _, proc := range processes {
		rows = append(rows, listenerRecord{
			protocol:          protocolFor(protoToken, host),
			family:            familyFor(host, protoToken),
			address:           normalizeAddress(host),
			port:              port,
			pid:               proc.pid,
			processName:       proc.name,
			permissionLimited: proc.pid == nil,
		})
	}
	return rows
}

func parseSSEstablishedLine(line string, defaultEstablished bool) (connectionRecord, bool) {
	if isSSHeader(line) {
		return connectionRecord{}, false
	}
	fields := strings.Fields(line)
	if len(fields) < 4 {
		return connectionRecord{}, false
	}
	protoToken := "tcp"
	localIndex := -1
	peerIndex := -1
	state := ""
	first := strings.ToLower(fields[0])
	if strings.HasPrefix(first, "tcp") || strings.HasPrefix(first, "udp") {
		protoToken = first
		if len(fields) >= 6 && isEstablishedState(fields[1]) {
			state = strings.ToLower(fields[1])
			localIndex = 4
			peerIndex = 5
		} else if len(fields) >= 5 && (defaultEstablished || looksLikeQueuePair(fields[1], fields[2])) {
			state = "established"
			localIndex = 3
			peerIndex = 4
		} else {
			return connectionRecord{}, false
		}
	} else if isEstablishedState(fields[0]) {
		if len(fields) < 5 {
			return connectionRecord{}, false
		}
		state = strings.ToLower(fields[0])
		localIndex = 3
		peerIndex = 4
	} else if len(fields) >= 4 && (defaultEstablished || looksLikeQueuePair(fields[0], fields[1])) {
		state = "established"
		localIndex = 2
		peerIndex = 3
	} else {
		return connectionRecord{}, false
	}
	if localIndex < 0 || peerIndex < 0 || len(fields) <= peerIndex {
		return connectionRecord{}, false
	}
	if !isEstablishedState(state) && state != "connected" {
		return connectionRecord{}, false
	}
	localAddr, localPort, ok := parseEndpoint(fields[localIndex])
	if !ok || localPort <= 0 {
		return connectionRecord{}, false
	}
	remoteAddr, remotePort, ok := parseEndpoint(fields[peerIndex])
	if !ok {
		remoteAddr = ""
		remotePort = 0
	}
	processes := parseUsers(line)
	proc := processInfo{}
	if len(processes) > 0 {
		proc = processes[0]
	}
	protocol := protocolFor(protoToken, localAddr)
	return connectionRecord{
		id:          socketID(protocol, localAddr, localPort, remoteAddr, remotePort, proc.pid),
		protocol:    protocol,
		family:      familyFor(localAddr, protoToken),
		localAddr:   normalizeAddress(localAddr),
		localPort:   localPort,
		remoteAddr:  normalizeAddress(remoteAddr),
		remotePort:  remotePort,
		pid:         proc.pid,
		processName: proc.name,
	}, true
}

func parseNetstatListenerLine(line string) []listenerRecord {
	if line == "" || strings.HasPrefix(strings.ToLower(line), "proto") || strings.Contains(line, "Active Internet") {
		return nil
	}
	fields := strings.Fields(line)
	if len(fields) < 4 {
		return nil
	}
	protoToken := strings.ToLower(fields[0])
	if !strings.HasPrefix(protoToken, "tcp") && !strings.HasPrefix(protoToken, "udp") {
		return nil
	}
	localIndex := 3
	if len(fields) <= localIndex {
		return nil
	}
	if strings.HasPrefix(protoToken, "tcp") && !containsTokenFold(fields, "LISTEN") {
		return nil
	}
	host, port, ok := parseEndpoint(fields[localIndex])
	if !ok || port <= 0 {
		return nil
	}
	proc := parseNetstatProcess(fields)
	return []listenerRecord{{
		protocol:          protocolFor(protoToken, host),
		family:            familyFor(host, protoToken),
		address:           normalizeAddress(host),
		port:              port,
		pid:               proc.pid,
		processName:       proc.name,
		permissionLimited: proc.pid == nil,
	}}
}

func parseNetstatEstablishedLine(line string) (connectionRecord, bool) {
	if line == "" || strings.HasPrefix(strings.ToLower(line), "proto") || strings.Contains(line, "Active Internet") {
		return connectionRecord{}, false
	}
	fields := strings.Fields(line)
	if len(fields) < 6 {
		return connectionRecord{}, false
	}
	protoToken := strings.ToLower(fields[0])
	if !strings.HasPrefix(protoToken, "tcp") {
		return connectionRecord{}, false
	}
	state := strings.ToUpper(fields[5])
	if state != "ESTABLISHED" && state != "ESTAB" {
		return connectionRecord{}, false
	}
	localAddr, localPort, ok := parseEndpoint(fields[3])
	if !ok || localPort <= 0 {
		return connectionRecord{}, false
	}
	remoteAddr, remotePort, ok := parseEndpoint(fields[4])
	if !ok {
		remoteAddr = ""
		remotePort = 0
	}
	proc := parseNetstatProcess(fields)
	protocol := protocolFor(protoToken, localAddr)
	return connectionRecord{
		id:          socketID(protocol, localAddr, localPort, remoteAddr, remotePort, proc.pid),
		protocol:    protocol,
		family:      familyFor(localAddr, protoToken),
		localAddr:   normalizeAddress(localAddr),
		localPort:   localPort,
		remoteAddr:  normalizeAddress(remoteAddr),
		remotePort:  remotePort,
		pid:         proc.pid,
		processName: proc.name,
	}, true
}

func parseInterfaceLine(line string) (interfaceAddress, bool) {
	parts := strings.Split(line, "\t")
	if len(parts) != 3 || parts[0] != "IFACE" {
		return interfaceAddress{}, false
	}
	name := strings.TrimSpace(parts[1])
	ip := normalizeAddress(parts[2])
	if name == "" || ip == "" {
		return interfaceAddress{}, false
	}
	return interfaceAddress{name: name, ip: ip}, true
}

func parseProcSocketLine(line string) (procSocketRecord, bool) {
	parts := strings.Split(line, "\t")
	if len(parts) != 6 {
		return procSocketRecord{}, false
	}
	localAddr, localPort, ok := parseProcEndpoint(parts[2], parts[1])
	if !ok {
		return procSocketRecord{}, false
	}
	remoteAddr, remotePort, _ := parseProcEndpoint(parts[3], parts[1])
	return procSocketRecord{
		protocol:   strings.ToLower(parts[1]),
		localAddr:  localAddr,
		localPort:  localPort,
		remoteAddr: remoteAddr,
		remotePort: remotePort,
		state:      strings.ToUpper(parts[4]),
		inode:      strings.TrimSpace(parts[5]),
	}, true
}

func parseDockerProcSocketLine(line string) (procSocketRecord, bool) {
	parts := strings.Split(line, "\t")
	if len(parts) != 6 || parts[0] != "DOCKER_PROC_SOCKET" {
		return procSocketRecord{}, false
	}
	localAddr, localPort, ok := parseProcEndpoint(parts[2], parts[1])
	if !ok {
		return procSocketRecord{}, false
	}
	remoteAddr, remotePort, _ := parseProcEndpoint(parts[3], parts[1])
	return procSocketRecord{
		protocol:   strings.ToLower(parts[1]),
		localAddr:  localAddr,
		localPort:  localPort,
		remoteAddr: remoteAddr,
		remotePort: remotePort,
		state:      strings.ToUpper(parts[4]),
		inode:      strings.TrimSpace(parts[5]),
	}, true
}

func parseDockerContainerLine(line string) (string, string, bool) {
	fields := markerFields(line)
	if len(fields) < 3 || fields[0] != "__SPNI_DOCKER_CONTAINER__" {
		return "", "", false
	}
	id := sanitizeDockerField(fields[1])
	name := sanitizeDockerField(fields[2])
	if id == "" && name == "" {
		return "", "", false
	}
	return id, name, true
}

func parseDockerSectionSource(line string) (string, string, string, string) {
	fields := markerFields(line)
	containerID := ""
	containerName := ""
	if len(fields) >= 2 {
		containerID = sanitizeDockerField(fields[1])
	}
	if len(fields) >= 3 {
		containerName = sanitizeDockerField(fields[2])
	}
	return sourceDocker, containerID, containerName, dockerSourceName(containerName)
}

func parseDockerSocketSummaryLine(line string) socketSummary {
	fields := markerFields(line)
	if len(fields) < 4 || fields[0] != "__SPNI_DOCKER_SOCKET_SUMMARY__" || fields[len(fields)-1] != "ok" {
		return socketSummary{}
	}
	countIndex := 1
	if len(fields) >= 5 {
		countIndex = len(fields) - 3
	}
	count, countOK := parseNonNegativeInt(fields[countIndex])
	remoteCount, remoteOK := parseNonNegativeInt(fields[countIndex+1])
	if !countOK || !remoteOK {
		return socketSummary{}
	}
	return socketSummary{
		connectionCount: optionalInt(count, true),
		remoteIPCount:   optionalInt(remoteCount, true),
		available:       true,
	}
}

func parseDockerEndpointSummaryLine(line string) (connectionRecord, bool) {
	fields := markerFields(line)
	if len(fields) < 7 || fields[0] != "__SPNI_DOCKER_ENDPOINT_SUMMARY__" {
		return connectionRecord{}, false
	}
	containerID := sanitizeDockerField(fields[1])
	containerName := sanitizeDockerField(fields[2])
	protocol := strings.ToLower(strings.TrimSpace(fields[3]))
	if protocol == "" {
		protocol = "tcp"
	}
	processName := sanitizeDockerField(fields[4])
	if processName == "" {
		processName = dockerProcessFallback(containerName)
	}
	count, countOK := parseNonNegativeInt(fields[5])
	remoteCount, remoteOK := parseNonNegativeInt(fields[6])
	if !countOK || !remoteOK || count == 0 {
		return connectionRecord{}, false
	}
	row := connectionRecord{
		id:              fmt.Sprintf("%s|%s|aggregate|%s|%s", sourceDocker, containerID, protocol, processName),
		protocol:        protocolFor(protocol, ""),
		family:          "ipv4",
		processName:     processName,
		sourceType:      sourceDocker,
		sourceName:      dockerSourceName(containerName),
		containerID:     containerID,
		containerName:   containerName,
		aggregateCount:  optionalInt(count, true),
		aggregateRemote: optionalInt(remoteCount, true),
	}
	return row, true
}

func parseDockerStatusLine(line string, state *dockerSnapshotState, warnings *[]string) {
	fields := markerFields(line)
	if len(fields) < 2 || fields[0] != "__SPNI_DOCKER_STATUS__" {
		return
	}
	switch fields[1] {
	case "missing":
		state.available = false
	case "available":
		state.available = true
	case "permission-limited":
		state.available = true
		state.permissionLimited = true
		*warnings = appendWarning(*warnings, "当前用户没有读取 Docker 容器网络命名空间的权限，请使用 root 或配置免密 sudo。")
	case "nsenter-missing":
		state.available = true
		*warnings = appendWarning(*warnings, "未找到 nsenter，已尝试使用 /proc 容器网络信息降级统计。")
	case "truncated":
		state.truncated = true
		state.aggregated = true
	case "containers":
		state.available = true
	}
	if len(fields) >= 3 {
		if value, ok := parseNonNegativeInt(fields[2]); ok && fields[1] == "containers" {
			state.containerCount = value
		}
	}
}

func addSocketSummary(left socketSummary, right socketSummary) socketSummary {
	if !right.available {
		return left
	}
	if !left.available {
		return right
	}
	return socketSummary{
		connectionCount: optionalInt(intValueOrZero(left.connectionCount)+intValueOrZero(right.connectionCount), true),
		remoteIPCount:   optionalInt(intValueOrZero(left.remoteIPCount)+intValueOrZero(right.remoteIPCount), true),
		available:       true,
	}
}

func sanitizeDockerField(value string) string {
	text := strings.TrimSpace(value)
	text = strings.Trim(text, "/")
	text = strings.Map(func(r rune) rune {
		switch r {
		case '\t', '\r', '\n', 0:
			return -1
		default:
			return r
		}
	}, text)
	if len(text) > 80 {
		return text[:80]
	}
	return text
}

func dockerSourceName(containerName string) string {
	name := sanitizeDockerField(containerName)
	if name == "" {
		return "Docker"
	}
	return name
}

func dockerProcessFallback(containerName string) string {
	name := sanitizeDockerField(containerName)
	if name == "" {
		return "容器进程"
	}
	return name
}

func withListenerSource(row listenerRecord, sourceType string, sourceName string, containerID string, containerName string) listenerRecord {
	if sourceType == "" {
		sourceType = sourceHost
	}
	if sourceName == "" {
		sourceName = "宿主机"
	}
	row.sourceType = sourceType
	row.sourceName = sourceName
	row.containerID = containerID
	row.containerName = containerName
	return row
}

func withConnectionSource(row connectionRecord, sourceType string, sourceName string, containerID string, containerName string) connectionRecord {
	if sourceType == "" {
		sourceType = sourceHost
	}
	if sourceName == "" {
		sourceName = "宿主机"
	}
	row.sourceType = sourceType
	row.sourceName = sourceName
	row.containerID = containerID
	row.containerName = containerName
	row.id = sourceSocketID(sourceType, containerID, row.protocol, row.localAddr, row.localPort, row.remoteAddr, row.remotePort, row.pid)
	return row
}

func parseProcOwnerLine(line string) (string, procOwner, bool) {
	parts := strings.SplitN(line, "\t", 4)
	if len(parts) < 3 || parts[0] != "PROC_OWNER" {
		return "", procOwner{}, false
	}
	pid, err := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
	if err != nil || pid <= 0 {
		return "", procOwner{}, false
	}
	comm := ""
	if len(parts) == 4 {
		comm = strings.TrimSpace(parts[3])
	}
	return strings.TrimSpace(parts[1]), procOwner{pid: pid, comm: comm}, true
}

func buildFromProc(sockets []procSocketRecord, owners map[string][]procOwner) ([]listenerRecord, []connectionRecord, bool) {
	listeners := make([]listenerRecord, 0)
	connections := make([]connectionRecord, 0)
	permissionLimited := false
	for _, socket := range sockets {
		protocol := protocolFor(socket.protocol, socket.localAddr)
		family := familyFor(socket.localAddr, socket.protocol)
		socketOwners := owners[socket.inode]
		if len(socketOwners) == 0 {
			permissionLimited = true
			if socket.state == "0A" || strings.HasPrefix(socket.protocol, "udp") {
				listeners = append(listeners, listenerRecord{
					protocol:          protocol,
					family:            family,
					address:           socket.localAddr,
					port:              socket.localPort,
					sourceType:        sourceHost,
					sourceName:        "宿主机",
					permissionLimited: true,
				})
			} else if socket.state == "01" {
				connections = append(connections, connectionRecord{
					id:         sourceSocketID(sourceHost, "", protocol, socket.localAddr, socket.localPort, socket.remoteAddr, socket.remotePort, nil),
					protocol:   protocol,
					family:     family,
					localAddr:  socket.localAddr,
					localPort:  socket.localPort,
					remoteAddr: socket.remoteAddr,
					remotePort: socket.remotePort,
					sourceType: sourceHost,
					sourceName: "宿主机",
				})
			}
			continue
		}
		for _, owner := range socketOwners {
			pid := owner.pid
			if socket.state == "0A" || strings.HasPrefix(socket.protocol, "udp") {
				listeners = append(listeners, listenerRecord{
					protocol:    protocol,
					family:      family,
					address:     socket.localAddr,
					port:        socket.localPort,
					pid:         &pid,
					processName: owner.comm,
					sourceType:  sourceHost,
					sourceName:  "宿主机",
				})
			} else if socket.state == "01" {
				connections = append(connections, connectionRecord{
					id:          sourceSocketID(sourceHost, "", protocol, socket.localAddr, socket.localPort, socket.remoteAddr, socket.remotePort, &pid),
					protocol:    protocol,
					family:      family,
					localAddr:   socket.localAddr,
					localPort:   socket.localPort,
					remoteAddr:  socket.remoteAddr,
					remotePort:  socket.remotePort,
					pid:         &pid,
					processName: owner.comm,
					sourceType:  sourceHost,
					sourceName:  "宿主机",
				})
			}
		}
	}
	return listeners, connections, permissionLimited
}

func filterByInterface(
	listeners []listenerRecord,
	connections []connectionRecord,
	ifaces []interfaceAddress,
	interfaceName string,
) ([]listenerRecord, []connectionRecord, []string) {
	name := strings.TrimSpace(interfaceName)
	if name == "" || strings.EqualFold(name, "all") ||
		strings.EqualFold(name, "physical") || strings.EqualFold(name, "docker") {
		return listeners, connections, nil
	}
	ips := make(map[string]struct{})
	for _, iface := range ifaces {
		if iface.name == name {
			ips[iface.ip] = struct{}{}
		}
	}
	if len(ips) == 0 {
		return listeners, connections, []string{"无法确认所选接口地址，已显示全部接口的连接数据。"}
	}
	filteredListeners := make([]listenerRecord, 0, len(listeners))
	for _, row := range listeners {
		if row.sourceType == sourceDocker {
			filteredListeners = append(filteredListeners, row)
			continue
		}
		if isWildcardAddress(row.address) {
			filteredListeners = append(filteredListeners, row)
			continue
		}
		if _, ok := ips[row.address]; ok {
			filteredListeners = append(filteredListeners, row)
		}
	}
	filteredConnections := make([]connectionRecord, 0, len(connections))
	for _, row := range connections {
		if row.sourceType == sourceDocker {
			filteredConnections = append(filteredConnections, row)
			continue
		}
		if _, ok := ips[row.localAddr]; ok {
			filteredConnections = append(filteredConnections, row)
		}
	}
	return filteredListeners, filteredConnections, nil
}

func aggregateSnapshot(
	serverID int64,
	contextID string,
	strategy string,
	listeners []listenerRecord,
	connections []connectionRecord,
	listenersAvailable bool,
	connectionsAvailable bool,
	processInfoAvailable bool,
	byteCountersCommandAvailable bool,
	remoteSocketSummary socketSummary,
	dockerState dockerSnapshotState,
	remoteConntrackSummary conntrackSummary,
	interfaceScope string,
	rowLimit int,
	collectedAt string,
) (domain.NetworkEndpointSnapshot, aggregationStats) {
	stats := aggregationStats{}
	rows := dedupeListeners(listeners)
	dedupedConnections := dedupeConnections(connections)
	if !connectionsAvailable {
		dedupedConnections = nil
	}
	stats.parsedConnections = len(dedupedConnections)
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].sourceType != rows[j].sourceType {
			return rows[i].sourceType < rows[j].sourceType
		}
		if rows[i].sourceName != rows[j].sourceName {
			return rows[i].sourceName < rows[j].sourceName
		}
		if rows[i].port != rows[j].port {
			return rows[i].port < rows[j].port
		}
		if rows[i].protocol != rows[j].protocol {
			return rows[i].protocol < rows[j].protocol
		}
		if rows[i].address != rows[j].address {
			return rows[i].address < rows[j].address
		}
		return pidValue(rows[i].pid) < pidValue(rows[j].pid)
	})

	listenerSummaries := make([]domain.NetworkEndpointSummary, 0, len(rows))
	globalRemoteIPs := make(map[string]struct{})
	hostRemoteIPs := make(map[string]struct{})
	dockerRemoteIPs := make(map[string]struct{})
	seenConnectionIDs := make(map[string]struct{})
	hostConnectionIDs := make(map[string]struct{})
	dockerConnectionIDs := make(map[string]struct{})
	byteCountersAvailable := false
	byteCountersPartial := false
	permissionLimited := false
	for _, conn := range dedupedConnections {
		if conn.remoteAddr != "" && !isWildcardAddress(conn.remoteAddr) {
			globalRemoteIPs[conn.remoteAddr] = struct{}{}
			if conn.sourceType == sourceDocker {
				dockerRemoteIPs[conn.remoteAddr] = struct{}{}
			} else {
				hostRemoteIPs[conn.remoteAddr] = struct{}{}
			}
		}
		if conn.id != "" {
			seenConnectionIDs[conn.id] = struct{}{}
			if conn.sourceType == sourceDocker {
				dockerConnectionIDs[conn.id] = struct{}{}
			} else {
				hostConnectionIDs[conn.id] = struct{}{}
			}
		}
		hasAnyCounter := conn.uploaded != nil || conn.uploadedEstimate != nil || conn.downloaded != nil
		if hasAnyCounter {
			byteCountersAvailable = true
			stats.byteCounterSockets++
		}
		if conn.uploaded != nil {
			stats.uploadKnownSockets++
		}
		if conn.uploaded == nil && conn.uploadedEstimate != nil {
			stats.uploadEstimatedSockets++
		}
		if conn.downloaded != nil {
			stats.downloadKnownSockets++
		}
		if !hasAnyCounter {
			stats.counterMissingSockets++
		}
		if conn.pid == nil {
			permissionLimited = true
		}
	}

	assignments := make(map[string][]connectionRecord)
	approximateAssignments := make(map[string]bool)
	matchedConnectionIDs := make(map[string]struct{})
	for _, conn := range dedupedConnections {
		index, approximate, ok := bestListenerIndex(conn, rows)
		if !ok {
			continue
		}
		key := listenerRowID(rows[index])
		assignments[key] = append(assignments[key], conn)
		matchedConnectionIDs[conn.id] = struct{}{}
		if approximate {
			approximateAssignments[key] = true
		}
	}
	stats.matchedConnections = len(matchedConnectionIDs)
	stats.unmatchedConnections = len(dedupedConnections) - stats.matchedConnections
	if len(seenConnectionIDs) > 0 && stats.byteCounterSockets > 0 && stats.byteCounterSockets < len(seenConnectionIDs) {
		byteCountersPartial = true
	}

	for _, listener := range rows {
		if listener.permissionLimited || listener.pid == nil {
			permissionLimited = true
		}
		rowID := listenerRowID(listener)
		matches := assignments[rowID]
		aggregate := summarizeConnections(matches)
		rowByteCounters := byteCountersCommandAvailable && (aggregate.uploaded != nil || aggregate.uploadedEstimate != nil || aggregate.downloaded != nil)
		rowKind := "listener"
		if aggregate.connectionCount > 0 {
			rowKind = "listener-and-connection"
		}
		uniqueRemoteIPCount := optionalInt(aggregate.remoteIPCount, connectionsAvailable)
		connectionCount := optionalInt(aggregate.connectionCount, connectionsAvailable)
		listenerSummaries = append(listenerSummaries, domain.NetworkEndpointSummary{
			RowID:                   rowID,
			ServerID:                serverID,
			Protocol:                listener.protocol,
			Family:                  listener.family,
			ListenAddress:           listener.address,
			ListenPort:              listener.port,
			PID:                     listener.pid,
			PIDLabel:                pidLabelFor(listener.pid, ""),
			ProcessName:             listener.processName,
			SourceType:              normalizedSourceType(listener.sourceType),
			SourceName:              normalizedSourceName(listener.sourceType, listener.sourceName),
			ContainerID:             listener.containerID,
			ContainerName:           listener.containerName,
			UniqueRemoteIPCount:     uniqueRemoteIPCount,
			ConnectionCount:         connectionCount,
			UploadedBytes:           optionalUint64(aggregate.uploaded, rowByteCounters),
			UploadedBytesEstimate:   optionalUint64(aggregate.uploadedEstimate, rowByteCounters),
			UploadedBytesEstimated:  aggregate.uploaded == nil && aggregate.uploadedEstimate != nil,
			DownloadedBytes:         optionalUint64(aggregate.downloaded, rowByteCounters),
			AggregatedProcessCount:  optionalInt(aggregate.processCount, aggregate.processCount > 1),
			ConnectionDataAvailable: connectionsAvailable,
			ByteCountersAvailable:   rowByteCounters,
			ByteCountersPartial:     aggregate.byteCountersPartial,
			PermissionLimited:       listener.permissionLimited || listener.pid == nil,
			AggregationApproximate:  approximateAssignments[rowID],
			HasListener:             true,
			HasActiveConnections:    connectionsAvailable && aggregate.connectionCount > 0,
			RowKind:                 rowKind,
			State:                   stateFor(listener, aggregate.connectionCount),
			LastUpdatedAt:           collectedAt,
		})
	}

	for _, row := range outboundConnectionRows(serverID, dedupedConnections, matchedConnectionIDs, byteCountersCommandAvailable, collectedAt) {
		listenerSummaries = append(listenerSummaries, row)
	}
	hostSocketConnectionCount := optionalInt(len(hostConnectionIDs), connectionsAvailable)
	hostSocketRemoteIPCount := optionalInt(len(hostRemoteIPs), connectionsAvailable)
	if remoteSocketSummary.available {
		if remoteSocketSummary.connectionCount != nil {
			hostSocketConnectionCount = copyIntPtr(remoteSocketSummary.connectionCount)
		}
		if remoteSocketSummary.remoteIPCount != nil {
			hostSocketRemoteIPCount = copyIntPtr(remoteSocketSummary.remoteIPCount)
		}
	}
	dockerSocketConnectionCount := optionalInt(len(dockerConnectionIDs), connectionsAvailable && len(dockerConnectionIDs) > 0)
	dockerSocketRemoteIPCount := optionalInt(len(dockerRemoteIPs), connectionsAvailable && len(dockerConnectionIDs) > 0)
	if dockerState.summary.available {
		if dockerState.summary.connectionCount != nil {
			dockerSocketConnectionCount = copyIntPtr(dockerState.summary.connectionCount)
		}
		if dockerState.summary.remoteIPCount != nil {
			dockerSocketRemoteIPCount = copyIntPtr(dockerState.summary.remoteIPCount)
		}
	}
	totalSocketConnectionCount := sumOptionalInts(hostSocketConnectionCount, dockerSocketConnectionCount)
	totalSocketRemoteIPCount := optionalInt(len(globalRemoteIPs), connectionsAvailable)
	if remoteSocketSummary.available || dockerState.summary.available {
		totalSocketRemoteIPCount = sumOptionalInts(hostSocketRemoteIPCount, dockerSocketRemoteIPCount)
	}
	aggregated := false
	if totalSocketConnectionCount != nil && *totalSocketConnectionCount > len(seenConnectionIDs) {
		aggregated = true
	}
	if dockerSocketConnectionCount != nil && *dockerSocketConnectionCount > len(dockerConnectionIDs) {
		dockerState.aggregated = true
	}
	warnings := []string{}
	if aggregated && rowLimit > 0 {
		warnings = appendWarning(warnings, fmt.Sprintf("连接数量较大，表格显示聚合后的前 %d 项。", rowLimit))
	}
	if dockerState.aggregated && rowLimit > 0 {
		warnings = appendWarning(warnings, fmt.Sprintf("Docker 连接数量较大，已显示聚合后的前 %d 项。", rowLimit))
	}
	if stats.uploadEstimatedSockets > 0 {
		warnings = appendWarning(warnings, "部分累计上传使用 bytes_acked 近似值。")
	}
	return domain.NetworkEndpointSnapshot{
		ServerID:                        serverID,
		ContextID:                       contextID,
		Strategy:                        strategy,
		ListenersAvailable:              listenersAvailable,
		ConnectionsAvailable:            connectionsAvailable,
		ProcessInfoAvailable:            processInfoAvailable,
		PermissionLimited:               permissionLimited,
		ByteCountersAvailable:           byteCountersCommandAvailable && byteCountersAvailable,
		ByteCountersPartial:             byteCountersPartial,
		Listeners:                       listenerSummaries,
		TotalListeners:                  len(rows),
		TotalConnections:                totalSocketConnectionCount,
		UniqueRemoteIPs:                 totalSocketRemoteIPCount,
		SocketConnectionCount:           totalSocketConnectionCount,
		SocketRemoteIPCount:             totalSocketRemoteIPCount,
		HostSocketConnectionCount:       hostSocketConnectionCount,
		HostRemoteIPCount:               hostSocketRemoteIPCount,
		DockerSocketConnectionCount:     dockerSocketConnectionCount,
		DockerRemoteIPCount:             dockerSocketRemoteIPCount,
		TotalSocketConnectionCount:      totalSocketConnectionCount,
		TotalRemoteIPCount:              totalSocketRemoteIPCount,
		ConntrackConnectionCount:        nil,
		ConntrackRemoteIPCount:          nil,
		ConntrackAvailable:              false,
		ConntrackSource:                 "",
		ListenerCount:                   len(rows),
		DockerAvailable:                 dockerState.available,
		DockerNamespaceAvailable:        dockerState.namespaceAvailable,
		DockerPermissionLimited:         dockerState.permissionLimited,
		DockerContainerCount:            dockerState.containerCount,
		DockerScannedContainerCount:     dockerState.scannedContainerCount,
		DockerAggregated:                dockerState.aggregated,
		DockerTruncated:                 dockerState.truncated,
		InterfaceScope:                  strings.TrimSpace(interfaceScope),
		Aggregated:                      aggregated,
		RawConnectionCountBeforeLimit:   totalSocketConnectionCount,
		ReturnedRowCount:                len(listenerSummaries),
		RowLimit:                        rowLimit,
		SocketUploadBytesKnownCount:     stats.uploadKnownSockets,
		SocketUploadBytesEstimatedCount: stats.uploadEstimatedSockets,
		SocketDownloadBytesKnownCount:   stats.downloadKnownSockets,
		SocketCounterMissingCount:       stats.counterMissingSockets,
		CollectedAt:                     collectedAt,
		Warnings:                        warnings,
	}, stats
}

func dedupeListeners(rows []listenerRecord) []listenerRecord {
	type listenerGroup struct {
		key        string
		rows       map[int64]listenerRecord
		noPID      *listenerRecord
		hasPIDRows bool
	}
	groups := make(map[string]*listenerGroup)
	order := make([]string, 0)
	for _, row := range rows {
		row = withListenerSource(row, normalizedSourceType(row.sourceType), normalizedSourceName(row.sourceType, row.sourceName), row.containerID, row.containerName)
		key := fmt.Sprintf("%s|%s|%s|%s|%d", row.sourceType, row.containerID, row.protocol, row.address, row.port)
		group := groups[key]
		if group == nil {
			group = &listenerGroup{key: key, rows: make(map[int64]listenerRecord)}
			groups[key] = group
			order = append(order, key)
		}
		if row.pid == nil {
			if group.noPID == nil {
				copyRow := row
				group.noPID = &copyRow
			} else {
				current := *group.noPID
				current.permissionLimited = current.permissionLimited && row.permissionLimited
				if current.processName == "" && row.processName != "" {
					current.processName = row.processName
				}
				group.noPID = &current
			}
			continue
		}
		group.hasPIDRows = true
		pid := *row.pid
		current, ok := group.rows[pid]
		if !ok {
			group.rows[pid] = row
			continue
		}
		if current.processName == "" && row.processName != "" {
			current.processName = row.processName
		}
		current.permissionLimited = current.permissionLimited && row.permissionLimited
		group.rows[pid] = current
	}
	out := make([]listenerRecord, 0, len(order))
	for _, key := range order {
		group := groups[key]
		if group.hasPIDRows {
			pids := make([]int64, 0, len(group.rows))
			for pid := range group.rows {
				pids = append(pids, pid)
			}
			sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })
			for _, pid := range pids {
				out = append(out, group.rows[pid])
			}
			continue
		}
		if group.noPID != nil {
			out = append(out, *group.noPID)
		}
	}
	return out
}

func dedupeConnections(rows []connectionRecord) []connectionRecord {
	seen := make(map[string]connectionRecord)
	order := make([]string, 0, len(rows))
	for _, row := range rows {
		row = withConnectionSource(row, normalizedSourceType(row.sourceType), normalizedSourceName(row.sourceType, row.sourceName), row.containerID, row.containerName)
		key := row.id
		if key == "" {
			key = sourceSocketID(row.sourceType, row.containerID, row.protocol, row.localAddr, row.localPort, row.remoteAddr, row.remotePort, row.pid)
			row.id = key
		}
		current, ok := seen[key]
		if !ok {
			order = append(order, key)
			seen[key] = row
			continue
		}
		if current.pid == nil && row.pid != nil {
			current.pid = row.pid
		}
		if current.processName == "" && row.processName != "" {
			current.processName = row.processName
		}
		if current.uploaded == nil && row.uploaded != nil {
			current.uploaded = row.uploaded
		}
		if current.uploadedEstimate == nil && row.uploadedEstimate != nil {
			current.uploadedEstimate = row.uploadedEstimate
		}
		if current.downloaded == nil && row.downloaded != nil {
			current.downloaded = row.downloaded
		}
		if current.aggregateCount == nil && row.aggregateCount != nil {
			current.aggregateCount = row.aggregateCount
		}
		if current.aggregateRemote == nil && row.aggregateRemote != nil {
			current.aggregateRemote = row.aggregateRemote
		}
		seen[key] = current
	}
	out := make([]connectionRecord, 0, len(order))
	for _, key := range order {
		out = append(out, seen[key])
	}
	return out
}

type connectionSummary struct {
	remoteIPCount       int
	connectionCount     int
	uploaded            *uint64
	uploadedEstimate    *uint64
	downloaded          *uint64
	processCount        int
	byteCountersPartial bool
	permissionLimited   bool
}

func summarizeConnections(connections []connectionRecord) connectionSummary {
	remoteIPs := make(map[string]struct{})
	seen := make(map[string]struct{})
	processes := make(map[string]struct{})
	var uploaded *uint64
	var uploadedEstimate *uint64
	var downloaded *uint64
	byteCounterSockets := 0
	permissionLimited := false
	aggregateConnectionCount := 0
	aggregateRemoteCount := 0
	hasAggregate := false
	for _, conn := range connections {
		if conn.aggregateCount != nil {
			hasAggregate = true
			aggregateConnectionCount += *conn.aggregateCount
			if conn.aggregateRemote != nil {
				aggregateRemoteCount += *conn.aggregateRemote
			}
		}
		if conn.id != "" {
			if _, exists := seen[conn.id]; exists {
				continue
			}
			seen[conn.id] = struct{}{}
		}
		if conn.remoteAddr != "" && !isWildcardAddress(conn.remoteAddr) {
			remoteIPs[conn.remoteAddr] = struct{}{}
		}
		if conn.pid != nil {
			processes[fmt.Sprintf("pid:%d", *conn.pid)] = struct{}{}
		} else if conn.processName != "" {
			processes["name:"+conn.processName] = struct{}{}
		}
		if conn.uploaded != nil || conn.uploadedEstimate != nil || conn.downloaded != nil {
			byteCounterSockets++
		}
		if conn.pid == nil {
			permissionLimited = true
		}
		uploaded = addOptionalUint64(uploaded, conn.uploaded)
		if conn.uploaded == nil {
			uploadedEstimate = addOptionalUint64(uploadedEstimate, conn.uploadedEstimate)
		}
		downloaded = addOptionalUint64(downloaded, conn.downloaded)
	}
	connectionCount := len(seen)
	remoteIPCount := len(remoteIPs)
	if hasAggregate {
		connectionCount = aggregateConnectionCount
		remoteIPCount = aggregateRemoteCount
	}
	return connectionSummary{
		remoteIPCount:       remoteIPCount,
		connectionCount:     connectionCount,
		uploaded:            uploaded,
		uploadedEstimate:    uploadedEstimate,
		downloaded:          downloaded,
		processCount:        len(processes),
		byteCountersPartial: byteCounterSockets > 0 && byteCounterSockets < len(seen),
		permissionLimited:   permissionLimited,
	}
}

func bestListenerIndex(conn connectionRecord, listeners []listenerRecord) (int, bool, bool) {
	bestIndex := -1
	bestScore := -1
	bestApproximate := false
	for index, listener := range listeners {
		score, approximate, ok := listenerMatchScore(listener, conn)
		if !ok {
			continue
		}
		if score > bestScore {
			bestIndex = index
			bestScore = score
			bestApproximate = approximate
		}
	}
	if bestIndex < 0 {
		return -1, false, false
	}
	return bestIndex, bestApproximate, true
}

func listenerMatchScore(listener listenerRecord, conn connectionRecord) (int, bool, bool) {
	if normalizedSourceType(listener.sourceType) != normalizedSourceType(conn.sourceType) {
		return 0, false, false
	}
	if listener.containerID != conn.containerID {
		return 0, false, false
	}
	if baseProtocol(listener.protocol) != baseProtocol(conn.protocol) {
		return 0, false, false
	}
	if listener.port != conn.localPort {
		return 0, false, false
	}
	if !listenerMatchesAddress(listener.address, conn.localAddr) {
		return 0, false, false
	}
	if listener.family != "" && conn.family != "" && listener.family != conn.family {
		return 0, false, false
	}
	score := 10
	approximate := true
	if !isWildcardAddress(listener.address) {
		score += 100
	} else {
		score += 20
	}
	if listener.pid != nil && conn.pid != nil {
		if *listener.pid == *conn.pid {
			score += 80
			approximate = false
		}
	} else if listener.pid == nil && conn.pid == nil {
		score += 8
	}
	if listener.processName != "" && conn.processName != "" && listener.processName == conn.processName {
		score += 35
	}
	return score, approximate, true
}

func outboundConnectionRows(serverID int64, connections []connectionRecord, matched map[string]struct{}, byteCountersCommandAvailable bool, collectedAt string) []domain.NetworkEndpointSummary {
	type group struct {
		key           string
		protocol      string
		family        string
		pid           *int64
		pids          map[int64]struct{}
		processName   string
		sourceType    string
		sourceName    string
		containerID   string
		containerName string
		connections   []connectionRecord
	}
	groups := make(map[string]*group)
	order := make([]string, 0)
	for _, conn := range connections {
		if _, ok := matched[conn.id]; ok {
			continue
		}
		key := ""
		sourceType := normalizedSourceType(conn.sourceType)
		sourceName := normalizedSourceName(conn.sourceType, conn.sourceName)
		if conn.processName != "" {
			key = fmt.Sprintf("%s|%s|%s|process|%s", sourceType, conn.containerID, conn.protocol, conn.processName)
		} else if conn.pid != nil {
			key = fmt.Sprintf("%s|%s|%s|pid|%d", sourceType, conn.containerID, conn.protocol, *conn.pid)
		} else {
			key = fmt.Sprintf("%s|%s|%s|permission-limited", sourceType, conn.containerID, conn.protocol)
		}
		current := groups[key]
		if current == nil {
			current = &group{
				key:           key,
				protocol:      conn.protocol,
				family:        conn.family,
				pid:           conn.pid,
				pids:          make(map[int64]struct{}),
				processName:   conn.processName,
				sourceType:    sourceType,
				sourceName:    sourceName,
				containerID:   conn.containerID,
				containerName: conn.containerName,
			}
			groups[key] = current
			order = append(order, key)
		}
		if current.processName == "" && conn.processName != "" {
			current.processName = conn.processName
		}
		if current.pid == nil && conn.pid != nil {
			current.pid = conn.pid
		}
		if conn.pid != nil {
			current.pids[*conn.pid] = struct{}{}
		}
		current.connections = append(current.connections, conn)
	}
	rows := make([]domain.NetworkEndpointSummary, 0, len(order))
	for _, key := range order {
		current := groups[key]
		aggregate := summarizeConnections(current.connections)
		rowID := outboundRowID(current.key)
		rowByteCounters := byteCountersCommandAvailable && (aggregate.uploaded != nil || aggregate.uploadedEstimate != nil || aggregate.downloaded != nil)
		pid := current.pid
		pidLabel := pidLabelFor(current.pid, "")
		if len(current.pids) > 1 {
			pid = nil
			pidLabel = "多个"
		}
		rows = append(rows, domain.NetworkEndpointSummary{
			RowID:                   rowID,
			ServerID:                serverID,
			Protocol:                current.protocol,
			Family:                  current.family,
			ListenAddress:           "—",
			ListenPort:              0,
			PID:                     pid,
			PIDLabel:                pidLabel,
			ProcessName:             current.processName,
			SourceType:              current.sourceType,
			SourceName:              current.sourceName,
			ContainerID:             current.containerID,
			ContainerName:           current.containerName,
			UniqueRemoteIPCount:     optionalInt(aggregate.remoteIPCount, true),
			ConnectionCount:         optionalInt(aggregate.connectionCount, true),
			UploadedBytes:           optionalUint64(aggregate.uploaded, rowByteCounters),
			UploadedBytesEstimate:   optionalUint64(aggregate.uploadedEstimate, rowByteCounters),
			UploadedBytesEstimated:  aggregate.uploaded == nil && aggregate.uploadedEstimate != nil,
			DownloadedBytes:         optionalUint64(aggregate.downloaded, rowByteCounters),
			AggregatedProcessCount:  optionalInt(len(current.pids), len(current.pids) > 1),
			ConnectionDataAvailable: true,
			ByteCountersAvailable:   rowByteCounters,
			ByteCountersPartial:     aggregate.byteCountersPartial,
			PermissionLimited:       aggregate.permissionLimited || len(current.pids) == 0,
			AggregationApproximate:  true,
			HasListener:             false,
			HasActiveConnections:    true,
			RowKind:                 "connection",
			State:                   "connected",
			LastUpdatedAt:           collectedAt,
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].SourceType != rows[j].SourceType {
			return rows[i].SourceType < rows[j].SourceType
		}
		if rows[i].SourceName != rows[j].SourceName {
			return rows[i].SourceName < rows[j].SourceName
		}
		if rows[i].ProcessName != rows[j].ProcessName {
			return rows[i].ProcessName < rows[j].ProcessName
		}
		return rows[i].PIDLabel < rows[j].PIDLabel
	})
	return rows
}

func matchingConnections(listener listenerRecord, connections []connectionRecord) ([]connectionRecord, bool) {
	out := make([]connectionRecord, 0)
	approximate := false
	for _, conn := range connections {
		if normalizedSourceType(listener.sourceType) != normalizedSourceType(conn.sourceType) ||
			listener.containerID != conn.containerID {
			continue
		}
		if baseProtocol(listener.protocol) != baseProtocol(conn.protocol) {
			continue
		}
		if listener.port != conn.localPort {
			continue
		}
		if !listenerMatchesAddress(listener.address, conn.localAddr) {
			continue
		}
		if listener.pid != nil && conn.pid != nil && *listener.pid != *conn.pid {
			continue
		}
		if listener.pid == nil || conn.pid == nil {
			approximate = true
		}
		out = append(out, conn)
	}
	return out, approximate
}

func listenerMatchesAddress(listenerAddr string, localAddr string) bool {
	if isWildcardAddress(listenerAddr) {
		return true
	}
	return normalizeAddress(listenerAddr) == normalizeAddress(localAddr)
}

func parseUsers(line string) []processInfo {
	matches := usersProcessPattern.FindAllStringSubmatch(line, -1)
	if len(matches) == 0 {
		return nil
	}
	rows := make([]processInfo, 0, len(matches))
	for _, match := range matches {
		pid, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil || pid <= 0 {
			continue
		}
		currentPID := pid
		rows = append(rows, processInfo{pid: &currentPID, name: strings.TrimSpace(match[1])})
	}
	return rows
}

func parseNetstatProcess(fields []string) processInfo {
	for i := len(fields) - 1; i >= 0; i-- {
		field := fields[i]
		if field == "-" || !strings.Contains(field, "/") {
			continue
		}
		pidText, name, ok := strings.Cut(field, "/")
		if !ok {
			continue
		}
		pid, err := strconv.ParseInt(pidText, 10, 64)
		if err != nil || pid <= 0 {
			continue
		}
		currentPID := pid
		return processInfo{pid: &currentPID, name: strings.TrimSpace(name)}
	}
	return processInfo{}
}

func parseEndpoint(endpoint string) (string, int, bool) {
	value := strings.TrimSpace(endpoint)
	value = strings.Trim(value, "\"")
	if value == "" || value == "*" {
		return normalizeAddress(value), 0, false
	}
	if strings.HasPrefix(value, "[") {
		host, portText, err := net.SplitHostPort(value)
		if err == nil {
			port, ok := parsePort(portText)
			return host, port, ok
		}
	}
	lastColon := strings.LastIndex(value, ":")
	if lastColon < 0 {
		return "", 0, false
	}
	host := value[:lastColon]
	portText := value[lastColon+1:]
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	if percent := strings.LastIndex(host, "%"); percent >= 0 {
		host = host[:percent]
	}
	port, ok := parsePort(portText)
	if !ok {
		return "", 0, false
	}
	return normalizeAddress(host), port, true
}

func parsePort(text string) (int, bool) {
	if text == "*" || text == "" {
		return 0, true
	}
	port, err := strconv.Atoi(text)
	if err != nil || port < 0 || port > 65535 {
		return 0, false
	}
	return port, true
}

func parseProcEndpoint(value string, proto string) (string, int, bool) {
	addrHex, portHex, ok := strings.Cut(value, ":")
	if !ok {
		return "", 0, false
	}
	port64, err := strconv.ParseUint(portHex, 16, 16)
	if err != nil {
		return "", 0, false
	}
	addr, ok := parseProcAddress(addrHex, proto)
	if !ok {
		return "", 0, false
	}
	return addr, int(port64), true
}

func parseProcAddress(value string, proto string) (string, bool) {
	text := strings.TrimSpace(value)
	switch len(text) {
	case 8:
		raw, err := hex.DecodeString(text)
		if err != nil || len(raw) != 4 {
			return "", false
		}
		ip := net.IPv4(raw[3], raw[2], raw[1], raw[0])
		return ip.String(), true
	case 32:
		raw, err := hex.DecodeString(text)
		if err != nil || len(raw) != 16 {
			return "", false
		}
		// /proc/net/tcp6 stores each 32-bit word in little-endian order.
		for i := 0; i < 16; i += 4 {
			raw[i], raw[i+3] = raw[i+3], raw[i]
			raw[i+1], raw[i+2] = raw[i+2], raw[i+1]
		}
		return net.IP(raw).String(), true
	default:
		return "", false
	}
}

func updateConnectionBytes(conn *connectionRecord, line string) bool {
	updated := false
	if value, ok := parseUintMetric(line, "bytes_sent:"); ok {
		conn.uploaded = &value
		updated = true
	} else if value, ok := parseUintMetric(line, "bytes_acked:"); ok {
		conn.uploadedEstimate = &value
		updated = true
	}
	if value, ok := parseUintMetric(line, "bytes_received:"); ok {
		conn.downloaded = &value
		updated = true
	}
	return updated
}

func parseUintMetric(line string, name string) (uint64, bool) {
	index := strings.Index(line, name)
	if index < 0 {
		return 0, false
	}
	rest := line[index+len(name):]
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	value, err := strconv.ParseUint(rest[:end], 10, 64)
	if err != nil {
		return 0, false
	}
	return value, true
}

func protocolFor(proto string, address string) string {
	base := baseProtocol(proto)
	if base == "udp" {
		if familyFor(address, proto) == "ipv6" {
			return "udp6"
		}
		return "udp"
	}
	if familyFor(address, proto) == "ipv6" {
		return "tcp6"
	}
	return "tcp"
}

func baseProtocol(proto string) string {
	lower := strings.ToLower(proto)
	if strings.HasPrefix(lower, "udp") {
		return "udp"
	}
	return "tcp"
}

func familyFor(address string, proto string) string {
	lowerProto := strings.ToLower(proto)
	if strings.Contains(lowerProto, "6") {
		return "ipv6"
	}
	host := normalizeAddress(address)
	if strings.Contains(host, ":") {
		return "ipv6"
	}
	return "ipv4"
}

func normalizeAddress(value string) string {
	host := strings.TrimSpace(value)
	host = strings.Trim(host, "[]")
	if percent := strings.LastIndex(host, "%"); percent >= 0 {
		host = host[:percent]
	}
	switch host {
	case "", "*":
		return "*"
	case "0":
		return "0.0.0.0"
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
}

func isWildcardAddress(address string) bool {
	switch normalizeAddress(address) {
	case "*", "0.0.0.0", "::":
		return true
	default:
		return false
	}
}

func isSSHeader(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	return strings.HasPrefix(lower, "netid ") ||
		strings.HasPrefix(lower, "state ") ||
		strings.HasPrefix(lower, "proto ") ||
		strings.HasPrefix(lower, "recv-q ")
}

func sectionUsesStateFilter(section parseSection) bool {
	switch section {
	case sectionEstablishedFiltered, sectionEstablishedInfoFiltered:
		return true
	default:
		return false
	}
}

func isEstablishedState(value string) bool {
	state := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(state, "estab") || state == "connected"
}

func looksLikeQueuePair(first string, second string) bool {
	return looksLikeQueueValue(first) && looksLikeQueueValue(second)
}

func looksLikeQueueValue(value string) bool {
	_, err := strconv.Atoi(strings.TrimSpace(value))
	return err == nil
}

func parseStatusLine(line string) (string, string, bool) {
	parts := strings.Split(line, "\t")
	if len(parts) >= 3 && parts[0] == "__SPNI_STATUS__" {
		return strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2]), true
	}
	fields := strings.Fields(line)
	if len(fields) >= 3 && fields[0] == "__SPNI_STATUS__" {
		return strings.TrimSpace(fields[1]), strings.TrimSpace(fields[2]), true
	}
	return "", "", false
}

func markerFields(line string) []string {
	if strings.Contains(line, "\t") {
		parts := strings.Split(line, "\t")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		return parts
	}
	return strings.Fields(line)
}

func parseMarkerInt(line string, index int) (int, bool) {
	fields := markerFields(line)
	if len(fields) <= index {
		return 0, false
	}
	value, err := strconv.Atoi(strings.TrimSpace(fields[index]))
	if err != nil || value < 0 {
		return 0, false
	}
	return value, true
}

func parseSocketSummaryLine(line string) socketSummary {
	fields := markerFields(line)
	if len(fields) < 4 || fields[0] != "__SPNI_SOCKET_SUMMARY__" || fields[3] != "ok" {
		return socketSummary{}
	}
	count, countOK := parseNonNegativeInt(fields[1])
	remoteCount, remoteOK := parseNonNegativeInt(fields[2])
	if !countOK || !remoteOK {
		return socketSummary{}
	}
	return socketSummary{
		connectionCount: optionalInt(count, true),
		remoteIPCount:   optionalInt(remoteCount, true),
		available:       true,
	}
}

func parseSocketLocalSummaryLine(line string) (string, socketSummary, bool) {
	fields := markerFields(line)
	if len(fields) < 4 || fields[0] != "__SPNI_SOCKET_LOCAL_SUMMARY__" {
		return "", socketSummary{}, false
	}
	count, countOK := parseNonNegativeInt(fields[2])
	remoteCount, remoteOK := parseNonNegativeInt(fields[3])
	if fields[1] == "" || !countOK || !remoteOK {
		return "", socketSummary{}, false
	}
	return fields[1], socketSummary{
		connectionCount: optionalInt(count, true),
		remoteIPCount:   optionalInt(remoteCount, true),
		available:       true,
	}, true
}

func parseConntrackSummaryLine(line string) conntrackSummary {
	fields := markerFields(line)
	if len(fields) < 5 || fields[0] != "__SPNI_CONNTRACK_SUMMARY__" {
		return conntrackSummary{}
	}
	source := strings.TrimSpace(fields[1])
	if fields[4] != "ok" {
		return conntrackSummary{source: source}
	}
	count, countOK := parseNonNegativeInt(fields[2])
	remoteCount, remoteOK := parseNonNegativeInt(fields[3])
	if !countOK || !remoteOK {
		return conntrackSummary{source: source}
	}
	return conntrackSummary{
		connectionCount: optionalInt(count, true),
		remoteIPCount:   optionalInt(remoteCount, true),
		available:       true,
		source:          source,
	}
}

func parseNonNegativeInt(value string) (int, bool) {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

func selectSocketSummary(interfaceName string, ifaces []interfaceAddress, localSummaries map[string]socketSummary, global socketSummary) socketSummary {
	name := strings.TrimSpace(interfaceName)
	if name == "" || strings.EqualFold(name, "all") ||
		strings.EqualFold(name, "physical") || strings.EqualFold(name, "docker") {
		return global
	}
	selectedIPs := make([]string, 0)
	for _, iface := range ifaces {
		if iface.name == name {
			selectedIPs = append(selectedIPs, normalizeAddress(iface.ip))
		}
	}
	if len(selectedIPs) == 0 {
		return socketSummary{}
	}
	totalConnections := 0
	totalRemoteIPs := 0
	found := false
	for _, ip := range selectedIPs {
		summary, ok := localSummaries[ip]
		if !ok || !summary.available {
			continue
		}
		found = true
		if summary.connectionCount != nil {
			totalConnections += *summary.connectionCount
		}
		if summary.remoteIPCount != nil {
			totalRemoteIPs += *summary.remoteIPCount
		}
	}
	if !found {
		return socketSummary{}
	}
	return socketSummary{
		connectionCount: optionalInt(totalConnections, true),
		remoteIPCount:   optionalInt(totalRemoteIPs, true),
		available:       true,
	}
}

func commandStatusOK(status string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(status)), "ok")
}

func mergeCommandStatus(current string, next string) string {
	if current == "" {
		return next
	}
	if commandStatusOK(current) {
		return current
	}
	if commandStatusOK(next) {
		return next
	}
	return next
}

func appendWarning(warnings []string, warning string) []string {
	if strings.TrimSpace(warning) == "" {
		return warnings
	}
	for _, existing := range warnings {
		if existing == warning {
			return warnings
		}
	}
	return append(warnings, warning)
}

func hasProcessInfo(listeners []listenerRecord, connections []connectionRecord) bool {
	for _, listener := range listeners {
		if listener.pid != nil || listener.processName != "" {
			return true
		}
	}
	for _, conn := range connections {
		if conn.pid != nil || conn.processName != "" {
			return true
		}
	}
	return false
}

func containsTokenFold(fields []string, token string) bool {
	for _, field := range fields {
		if strings.EqualFold(field, token) {
			return true
		}
	}
	return false
}

func socketID(protocol string, localAddr string, localPort int, remoteAddr string, remotePort int, _ *int64) string {
	return fmt.Sprintf("%s|%s|%d|%s|%d", protocol, normalizeAddress(localAddr), localPort, normalizeAddress(remoteAddr), remotePort)
}

func sourceSocketID(sourceType string, containerID string, protocol string, localAddr string, localPort int, remoteAddr string, remotePort int, pid *int64) string {
	return fmt.Sprintf("%s|%s|%s",
		normalizedSourceType(sourceType),
		containerID,
		socketID(protocol, localAddr, localPort, remoteAddr, remotePort, pid),
	)
}

func listenerRowID(listener listenerRecord) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%s|%s|%s|%d|%d",
		normalizedSourceType(listener.sourceType),
		listener.containerID,
		listener.protocol,
		listener.address,
		listener.port,
		pidValue(listener.pid),
	)))
	return "net-" + hex.EncodeToString(sum[:8])
}

func normalizedSourceType(value string) string {
	if value == sourceDocker {
		return sourceDocker
	}
	return sourceHost
}

func normalizedSourceName(sourceType string, value string) string {
	text := strings.TrimSpace(value)
	if text != "" {
		return text
	}
	if normalizedSourceType(sourceType) == sourceDocker {
		return "Docker"
	}
	return "宿主机"
}

func outboundRowID(key string) string {
	sum := sha1.Sum([]byte("outbound|" + key))
	return "net-out-" + hex.EncodeToString(sum[:8])
}

func pidValue(pid *int64) int64 {
	if pid == nil {
		return 0
	}
	return *pid
}

func pidLabelFor(pid *int64, fallback string) string {
	if pid != nil {
		return strconv.FormatInt(*pid, 10)
	}
	return fallback
}

func addOptionalUint64(current *uint64, value *uint64) *uint64 {
	if value == nil {
		return current
	}
	if current == nil {
		next := *value
		return &next
	}
	next := *current + *value
	return &next
}

func optionalInt(value int, available bool) *int {
	if !available {
		return nil
	}
	next := value
	return &next
}

func intValueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func sumOptionalInts(left *int, right *int) *int {
	if left == nil && right == nil {
		return nil
	}
	return optionalInt(intValueOrZero(left)+intValueOrZero(right), true)
}

func copyIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	next := *value
	return &next
}

func optionalUint64(value *uint64, available bool) *uint64 {
	if !available || value == nil {
		return nil
	}
	next := *value
	return &next
}

func stateFor(listener listenerRecord, connections int) string {
	if baseProtocol(listener.protocol) == "udp" {
		return "listening"
	}
	if connections > 0 {
		return "connected"
	}
	return "listening"
}
