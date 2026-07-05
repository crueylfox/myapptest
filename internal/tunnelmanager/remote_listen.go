package tunnelmanager

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

const remoteListenProbeCommand = "if command -v ss >/dev/null 2>&1; then echo __SERVERPILOT_LISTEN_TOOL:ss; ss -ltn; elif command -v netstat >/dev/null 2>&1; then echo __SERVERPILOT_LISTEN_TOOL:netstat; netstat -ltn; else echo __SERVERPILOT_LISTEN_TOOL:missing; fi"

var errRemoteListenNotFound = errors.New("remote listen verification: not listening")

type remoteListenResult struct {
	Status         domain.RemoteListenCheckStatus
	Exposure       domain.RemoteListenExposure
	EffectiveHost  string
	EffectiveAddrs []string
	ActualListen   string
	Warning        string
}

func (m *Manager) checkRemoteListen(ctx context.Context, current *worker) (remoteListenResult, error) {
	if current.transport == nil {
		result := unknownRemoteListenResult()
		current.updateRemoteListen(result, current.testCommand(result))
		return result, nil
	}

	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := current.transport.Run(probeCtx, remoteListenProbeCommand)
	if err != nil {
		result := unknownRemoteListenResult()
		current.updateRemoteListen(result, current.testCommand(result))
		return result, nil
	}

	result := parseRemoteListenOutput(output, current.request.RemoteBindHost, current.request.RemoteBindPort)
	current.updateRemoteListen(result, current.testCommand(result))
	if result.Status == domain.RemoteListenNotFound {
		return result, errRemoteListenNotFound
	}
	return result, nil
}

func parseRemoteListenOutput(output, requestedHost string, port int) remoteListenResult {
	if strings.Contains(output, "__SERVERPILOT_LISTEN_TOOL:missing") {
		return unknownRemoteListenResult()
	}

	hosts := listenHostsForPort(output, port)
	if len(hosts) == 0 {
		return remoteListenResult{
			Status:        domain.RemoteListenNotFound,
			Exposure:      domain.RemoteListenExposureNotListening,
			EffectiveHost: "unknown",
			ActualListen:  "",
			Warning:       "未在服务器上检测到远程监听端口，隧道不会显示为普通运行中。",
		}
	}

	effective := chooseEffectiveHost(hosts)
	status := domain.RemoteListenListening
	exposure := classifyRemoteListenExposure(hosts)
	warning := publicListenWarning()
	if exposure == domain.RemoteListenExposureLoopbackOnly {
		status = domain.RemoteListenLoopback
		if publicBindHost(requestedHost) {
			warning = loopbackOnlyWarning()
		} else {
			warning = "远程端口仅监听服务器本机地址，外部主机不能直接访问。"
		}
	}

	addrs := formatListenAddresses(hosts, port)
	return remoteListenResult{
		Status:         status,
		Exposure:       exposure,
		EffectiveHost:  effective,
		EffectiveAddrs: addrs,
		ActualListen:   strings.Join(addrs, "\n"),
		Warning:        warning,
	}
}

func listenHostsForPort(output string, port int) []string {
	seen := map[string]struct{}{}
	var hosts []string
	want := strconv.Itoa(port)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "__SERVERPILOT_LISTEN_TOOL:") {
			continue
		}
		if !strings.Contains(strings.ToLower(line), "listen") {
			continue
		}
		for _, field := range strings.Fields(line) {
			host, ok := listenHostFromField(field, want)
			if !ok {
				continue
			}
			if _, exists := seen[host]; exists {
				continue
			}
			seen[host] = struct{}{}
			hosts = append(hosts, host)
		}
	}
	return hosts
}

func listenHostFromField(field, port string) (string, bool) {
	field = strings.TrimSpace(field)
	field = strings.Trim(field, ",;")
	if !strings.HasSuffix(field, ":"+port) {
		return "", false
	}
	if strings.HasPrefix(field, "[") {
		end := strings.LastIndex(field, "]")
		if end <= 0 || !strings.HasSuffix(field[end+1:], ":"+port) {
			return "", false
		}
		return normalizeListenHost(field[1:end]), true
	}
	host := strings.TrimSuffix(field, ":"+port)
	if host == "" {
		return "", false
	}
	if strings.HasSuffix(host, ":") && strings.Trim(host, ":") == "" {
		return "::", true
	}
	return normalizeListenHost(host), true
}

func chooseEffectiveHost(hosts []string) string {
	for _, host := range hosts {
		if publicBindHost(host) {
			return host
		}
	}
	for _, host := range hosts {
		if !loopbackHost(host) {
			return host
		}
	}
	return hosts[0]
}

func classifyRemoteListenExposure(hosts []string) domain.RemoteListenExposure {
	if len(hosts) == 0 {
		return domain.RemoteListenExposureNotListening
	}
	for _, host := range hosts {
		if publicBindHost(host) {
			return domain.RemoteListenExposurePublic
		}
	}
	for _, host := range hosts {
		if !loopbackHost(host) {
			return domain.RemoteListenExposurePublic
		}
	}
	return domain.RemoteListenExposureLoopbackOnly
}

func normalizeListenHost(host string) string {
	host = strings.TrimSpace(host)
	host = strings.Trim(host, "[]")
	if host == "*" {
		return "0.0.0.0"
	}
	if host == "" {
		return "unknown"
	}
	if host == ":::" {
		return "::"
	}
	return host
}

func publicBindHost(host string) bool {
	host = normalizeListenHost(host)
	return host == "0.0.0.0" || host == "::"
}

func loopbackHost(host string) bool {
	host = normalizeListenHost(host)
	if host == "localhost" || host == "::1" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func formatListenAddress(host string, port int) string {
	host = normalizeListenHost(host)
	if host == "" || host == "unknown" || port <= 0 {
		return ""
	}
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return fmt.Sprintf("[%s]:%d", host, port)
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func formatListenAddresses(hosts []string, port int) []string {
	result := make([]string, 0, len(hosts))
	seen := map[string]struct{}{}
	for _, host := range hosts {
		address := formatListenAddress(host, port)
		if address == "" {
			continue
		}
		if _, exists := seen[address]; exists {
			continue
		}
		seen[address] = struct{}{}
		result = append(result, address)
	}
	return result
}

func loopbackOnlyWarning() string {
	return "服务器实际只监听 127.0.0.1，局域网无法访问。请检查 sshd 的 GatewayPorts 配置和防火墙。"
}

func publicListenWarning() string {
	return "远程端口已监听在可被局域网访问的地址上。如果仍无法访问，请检查服务器防火墙是否放行该端口。"
}

func unknownRemoteListenResult() remoteListenResult {
	return remoteListenResult{
		Status:        domain.RemoteListenUnknown,
		Exposure:      domain.RemoteListenExposureUnknown,
		EffectiveHost: "unknown",
		ActualListen:  "",
		Warning:       "隧道已启动，但无法确认服务器实际监听状态。",
	}
}

func requestedListen(request domain.StartTunnelRequest) string {
	if request.Type != domain.TunnelTypeRemote || request.RemoteBindPort <= 0 {
		return ""
	}
	return formatListenAddress(request.RemoteBindHost, request.RemoteBindPort)
}

func (w *worker) updateRemoteListen(result remoteListenResult, command string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.state.RequestedListen = requestedListen(w.request)
	w.state.ActualListen = result.ActualListen
	w.state.EffectiveRemoteBindHost = result.EffectiveHost
	w.state.EffectiveListenAddrs = append([]string(nil), result.EffectiveAddrs...)
	w.state.RemoteListenExposure = result.Exposure
	w.state.RemoteListenCheckStatus = result.Status
	w.state.RemoteListenWarning = result.Warning
	w.state.TestCommand = command
	w.state.UpdatedAt = timestamp()
}

func (w *worker) testCommand(result remoteListenResult) string {
	if w.request.Type != domain.TunnelTypeRemote || w.request.RemoteBindPort <= 0 {
		return ""
	}
	host := testCommandHost(w.serverHost, result.EffectiveHost)
	port := w.request.RemoteBindPort
	if w.request.TargetPort == 22 {
		user := strings.TrimSpace(w.serverUser)
		if user == "" {
			user = "root"
		}
		return fmt.Sprintf("ssh -p %d %s@%s", port, user, host)
	}
	if w.request.TargetPort == 80 || w.request.TargetPort == 3000 || w.request.TargetPort == 8080 {
		return fmt.Sprintf("curl http://%s", formatHostPortForURL(host, port))
	}
	return fmt.Sprintf("nc -vz %s %d", host, port)
}

func testCommandHost(serverHost, effectiveHost string) string {
	effectiveHost = normalizeListenHost(effectiveHost)
	if loopbackHost(effectiveHost) {
		return "127.0.0.1"
	}
	if effectiveHost != "" && effectiveHost != "unknown" && !publicBindHost(effectiveHost) {
		return effectiveHost
	}
	serverHost = strings.TrimSpace(serverHost)
	if serverHost != "" {
		return serverHost
	}
	return "127.0.0.1"
}

func formatHostPortForURL(host string, port int) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return fmt.Sprintf("[%s]:%d", host, port)
	}
	return fmt.Sprintf("%s:%d", host, port)
}
