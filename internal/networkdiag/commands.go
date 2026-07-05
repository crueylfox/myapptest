package networkdiag

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

const exitMarker = "__SERVERPILOT_DIAG_EXIT__="

func ExitMarker() string {
	return exitMarker
}

func BuildCommand(request domain.StartNetworkDiagnosticRequest) (string, error) {
	target, err := ValidateTarget(request.Target)
	if err != nil {
		return "", err
	}
	count := request.Count
	if count <= 0 {
		count = 4
	}
	if count > 10 {
		count = 10
	}
	timeoutSeconds := request.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 3
	}
	if timeoutSeconds > 30 {
		timeoutSeconds = 30
	}
	var body string
	switch request.Type {
	case domain.NetworkDiagnosticPing:
		body = pingBody(count, timeoutSeconds)
	case domain.NetworkDiagnosticTraceroute:
		body = tracerouteBody(count)
	case domain.NetworkDiagnosticDNS:
		body = dnsBody()
	case domain.NetworkDiagnosticTCP:
		if request.Port < 1 || request.Port > 65535 {
			return "", errors.New("TCP 端口必须在 1-65535 之间")
		}
		body = tcpBody(timeoutSeconds, request.Port)
	default:
		return "", errors.New("不支持的网络诊断类型")
	}
	return strings.Join([]string{
		"target=" + ShellQuote(target),
		body,
		`printf '\n` + exitMarker + `%s\n' "$status"`,
		"exit 0",
	}, "\n"), nil
}

func CommandTimeout(request domain.StartNetworkDiagnosticRequest) time.Duration {
	timeoutSeconds := request.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 3
	}
	if timeoutSeconds > 30 {
		timeoutSeconds = 30
	}
	switch request.Type {
	case domain.NetworkDiagnosticTraceroute:
		return time.Duration(timeoutSeconds*20) * time.Second
	case domain.NetworkDiagnosticTCP:
		return time.Duration(timeoutSeconds+5) * time.Second
	default:
		count := request.Count
		if count <= 0 {
			count = 4
		}
		if count > 10 {
			count = 10
		}
		return time.Duration(timeoutSeconds*count+10) * time.Second
	}
}

func ValidateTarget(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("目标不能为空")
	}
	if len(value) > 253 {
		return "", errors.New("目标过长")
	}
	if strings.ContainsAny(value, "/\\?&#;$`|<>(){}[]\"' \t\r\n") {
		return "", errors.New("目标只允许 hostname / IPv4 / IPv6")
	}
	if ip := net.ParseIP(strings.Trim(value, "[]")); ip != nil {
		return value, nil
	}
	labels := strings.Split(value, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", errors.New("目标只允许 hostname / IPv4 / IPv6")
		}
		for _, r := range label {
			if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' {
				continue
			}
			return "", errors.New("目标只允许 hostname / IPv4 / IPv6")
		}
	}
	return value, nil
}

func ShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func StripExitMarker(output string) ([]string, int) {
	exitCode := 0
	lines := make([]string, 0, 16)
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, "\r")
		if parsed, ok := ParseExitMarkerLine(line); ok {
			exitCode = parsed
			continue
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		lines = append(lines, line)
	}
	return lines, exitCode
}

func ParseExitMarkerLine(line string) (int, bool) {
	line = strings.TrimSpace(strings.TrimRight(line, "\r"))
	if !strings.HasPrefix(line, exitMarker) {
		return 0, false
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, exitMarker)))
	if err != nil {
		return 0, true
	}
	return parsed, true
}

func pingBody(count, timeoutSeconds int) string {
	return fmt.Sprintf(`if command -v ping >/dev/null 2>&1; then
  ping -c %d -W %d "$target"
  status=$?
  if [ "$status" -ne 0 ]; then
    ping -c %d "$target"
    status=$?
  fi
else
  echo '服务器缺少 ping 工具。'
  status=127
fi`, count, timeoutSeconds, count)
}

func tracerouteBody(count int) string {
	return fmt.Sprintf(`if command -v traceroute >/dev/null 2>&1; then
  traceroute "$target"
  status=$?
elif command -v tracepath >/dev/null 2>&1; then
  tracepath "$target"
  status=$?
elif command -v ping >/dev/null 2>&1; then
  echo '服务器未安装 traceroute / tracepath，改用 ping。'
  ping -c %d "$target"
  status=$?
else
  echo '服务器未安装 traceroute / tracepath。'
  status=127
fi`, count)
}

func dnsBody() string {
	return `if command -v getent >/dev/null 2>&1; then
  getent hosts "$target"
  status=$?
elif command -v nslookup >/dev/null 2>&1; then
  nslookup "$target"
  status=$?
elif command -v dig >/dev/null 2>&1; then
  dig "$target"
  status=$?
else
  echo '服务器缺少 DNS 查询工具。'
  status=127
fi`
}

func tcpBody(timeoutSeconds, port int) string {
	portText := strconv.Itoa(port)
	return fmt.Sprintf(`port=%s
if command -v nc >/dev/null 2>&1; then
  nc -vz -w %d "$target" "$port"
  status=$?
  if [ "$status" -ne 0 ]; then
    nc -z -w %d "$target" "$port"
    status=$?
  fi
elif command -v timeout >/dev/null 2>&1; then
  timeout %d sh -c 'cat < /dev/null > /dev/tcp/"$1"/"$2"' sh "$target" "$port"
  status=$?
else
  sh -c 'cat < /dev/null > /dev/tcp/"$1"/"$2"' sh "$target" "$port"
  status=$?
fi`, portText, timeoutSeconds, timeoutSeconds, timeoutSeconds)
}
