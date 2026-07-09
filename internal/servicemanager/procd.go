package servicemanager

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"hostdeck/internal/domain"
)

const (
	procdCapabilityCommand = `if [ -x /sbin/procd ] && [ -d /etc/init.d ]; then
marker=0
[ -r /etc/openwrt_release ] && marker=1
if command -v ubus >/dev/null 2>&1; then marker=1; fi
if [ -r /etc/os-release ] && dd if=/etc/os-release bs=16384 count=1 2>/dev/null | grep -Eiq 'openwrt|immortalwrt'; then marker=1; fi
if [ "$marker" = "1" ]; then
  printf '%s\n' 'openwrt-procd'
  printf '%s\n' '---SERVERPILOT-OPENWRT-RELEASE---'
  if [ -r /etc/openwrt_release ]; then dd if=/etc/openwrt_release bs=16384 count=1 2>/dev/null; fi
  printf '%s\n' '---SERVERPILOT-OS-RELEASE---'
  if [ -r /etc/os-release ]; then dd if=/etc/os-release bs=16384 count=1 2>/dev/null; fi
  printf '%s\n' '---SERVERPILOT-LOGREAD---'
  if command -v logread >/dev/null 2>&1; then
    printf '%s\n' 'available'
  else
    printf '%s\n' 'missing'
  fi
  printf '%s\n' '---SERVERPILOT-PRIVILEGE---'
  if [ "$(id -u)" = "0" ]; then
    printf '%s\n' 'root'
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    printf '%s\n' 'sudo'
  else
    printf '%s\n' 'none'
  fi
else
  printf '%s\n' 'unsupported'
fi
else
printf '%s\n' 'unsupported'
fi`

	procdListCommand = `for script in /etc/init.d/*; do
  [ -f "$script" ] || continue
  [ -L "$script" ] && continue
  [ -x "$script" ] || continue
  name=${script##*/}
  case "$name" in
    .*|*..*|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.@+-]*) continue ;;
  esac
  "$script" running >/dev/null 2>&1
  running_code=$?
  "$script" enabled >/dev/null 2>&1
  enabled_code=$?
  printf '%s\t%s\t%s\n' "$name" "$running_code" "$enabled_code"
done`

	procdInitSystemLabel    = "OpenWrt procd"
	procdDescription        = "OpenWrt init.d 服务"
	procdMissingServiceText = "服务脚本不存在或已被移除。"
)

const (
	procdReleaseSeparator = "---SERVERPILOT-OPENWRT-RELEASE---"
	procdOSSeparator      = "---SERVERPILOT-OS-RELEASE---"
	procdLogreadSeparator = "---SERVERPILOT-LOGREAD---"
)

var (
	procdServiceIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.@+\-]+$`)
	procdActions          = map[string]struct{}{
		"start":   {},
		"stop":    {},
		"restart": {},
		"enable":  {},
		"disable": {},
	}
	procdCriticalServices = map[string]struct{}{
		"dropbear": {},
		"network":  {},
		"firewall": {},
		"dnsmasq":  {},
		"odhcpd":   {},
		"rpcd":     {},
		"uhttpd":   {},
		"system":   {},
		"procd":    {},
	}
	procdProtectedServices = map[string]struct{}{
		"procd":  {},
		"system": {},
	}
)

type procdReleaseInfo struct {
	Name        string
	Version     string
	Description string
}

func parseProcdCapability(serverID int64, output string) domain.ServiceManagerCapability {
	lines := nonEmptyLines(output)
	if len(lines) == 0 || !strings.EqualFold(lines[0], "openwrt-procd") {
		return unsupportedCapability(serverID)
	}
	sections := parseNamedSections(output, procdReleaseSeparator, procdOSSeparator, procdLogreadSeparator, privilegeSeparator)
	release := parseProcdReleaseInfo(sections[procdReleaseSeparator], sections[procdOSSeparator])
	logreadAvailable := strings.EqualFold(firstFallbackLine(sections[procdLogreadSeparator]), "available")
	privilege := firstFallbackLine(sections[privilegeSeparator])
	if privilege == "" {
		privilege = "none"
	}
	capability := domain.ServiceManagerCapability{
		ServerID:                serverID,
		Available:               true,
		InitSystem:              domain.ServiceManagerInitSystemOpenWrtProcd,
		DisplayName:             procdDisplayName(release),
		DistributionName:        release.Name,
		DistributionVersion:     release.Version,
		SupportsJournal:         logreadAvailable,
		SupportsLiveLogs:        false,
		SupportsResourceMetrics: false,
		SupportsStart:           true,
		SupportsStop:            true,
		SupportsRestart:         true,
		SupportsEnable:          true,
		SupportsDisable:         true,
	}
	switch privilege {
	case "root":
		capability.CanManage = true
		capability.RequiresPrivilege = false
	case "sudo":
		capability.CanManage = true
		capability.RequiresPrivilege = true
	default:
		capability.CanManage = false
		capability.RequiresPrivilege = true
		capability.Error = procdPermissionMessage
	}
	return capability
}

func parseProcdReleaseInfo(openwrtRelease string, osRelease string) procdReleaseInfo {
	openwrtValues := parseShellStyleValues(openwrtRelease)
	osValues := parseShellStyleValues(osRelease)
	name := firstNonEmpty(openwrtValues["DISTRIB_ID"], osValues["NAME"], "OpenWrt")
	version := firstNonEmpty(openwrtValues["DISTRIB_RELEASE"], osValues["VERSION_ID"])
	description := firstNonEmpty(openwrtValues["DISTRIB_DESCRIPTION"], osValues["PRETTY_NAME"])
	return procdReleaseInfo{Name: name, Version: version, Description: description}
}

func parseShellStyleValues(output string) map[string]string {
	values := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		values[key] = trimShellValue(value)
	}
	return values
}

func trimShellValue(value string) string {
	text := strings.TrimSpace(value)
	if len(text) >= 2 {
		if (text[0] == '\'' && text[len(text)-1] == '\'') || (text[0] == '"' && text[len(text)-1] == '"') {
			return strings.TrimSpace(text[1 : len(text)-1])
		}
	}
	return text
}

func procdDisplayName(release procdReleaseInfo) string {
	name := firstNonEmpty(release.Name, "OpenWrt")
	if release.Version != "" {
		return fmt.Sprintf("%s procd %s", name, release.Version)
	}
	return fmt.Sprintf("%s procd", name)
}

func validateProcdServiceID(value string) (string, error) {
	serviceID := strings.TrimSpace(value)
	if serviceID == "" ||
		strings.HasPrefix(serviceID, ".") ||
		strings.Contains(serviceID, "/") ||
		strings.Contains(serviceID, "\\") ||
		strings.Contains(serviceID, "..") ||
		strings.ContainsAny(serviceID, " \t\r\n\x00;|&$><`() *?[]") ||
		!procdServiceIDPattern.MatchString(serviceID) {
		return "", errors.New("服务名称无效。")
	}
	return serviceID, nil
}

func parseProcdServiceList(serverID int64, output string) []domain.SystemServiceSummary {
	rows := make([]domain.SystemServiceSummary, 0)
	seen := map[string]struct{}{}
	for _, line := range strings.Split(output, "\n") {
		if len(rows) >= 512 {
			break
		}
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 3 {
			continue
		}
		serviceID, err := validateProcdServiceID(fields[0])
		if err != nil {
			continue
		}
		if _, exists := seen[serviceID]; exists {
			continue
		}
		seen[serviceID] = struct{}{}
		activeState, subState := procdRunningState(parseExitCode(fields[1]))
		unitFileState := procdEnabledState(parseExitCode(fields[2]))
		rows = append(rows, decorateProcdSummary(domain.SystemServiceSummary{
			ServerID:      serverID,
			InitSystem:    domain.ServiceManagerInitSystemOpenWrtProcd,
			ServiceID:     serviceID,
			UnitName:      serviceID,
			DisplayName:   serviceID,
			Description:   procdDescription,
			LoadState:     "loaded",
			ActiveState:   activeState,
			SubState:      subState,
			UnitFileState: unitFileState,
			StartupState:  unitFileState,
		}))
	}
	sort.Slice(rows, func(i, j int) bool {
		return strings.ToLower(rows[i].ServiceID) < strings.ToLower(rows[j].ServiceID)
	})
	return rows
}

func parseExitCode(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return -1
	}
	return parsed
}

func procdRunningState(code int) (string, string) {
	switch code {
	case 0:
		return "active", "running"
	case 1:
		return "inactive", "dead"
	default:
		return "unknown", "unknown"
	}
}

func procdEnabledState(code int) string {
	switch code {
	case 0:
		return "enabled"
	case 1:
		return "disabled"
	default:
		return "unknown"
	}
}

func decorateProcdSummary(service domain.SystemServiceSummary) domain.SystemServiceSummary {
	service = decorateSummary(service)
	service.Critical = isCriticalProcdService(service.ServiceID)
	service.Protected = isProtectedProcdService(service.ServiceID)
	service.CanStart = !service.Protected && !service.IsActive
	service.CanStop = !service.Protected && service.IsActive
	service.CanRestart = !service.Protected
	service.CanEnable = !service.Protected && !service.IsEnabled
	service.CanDisable = !service.Protected && service.IsEnabled
	return service
}

func procdDetailCommand(serviceID string) string {
	return strings.Join([]string{
		fmt.Sprintf("name=%s", shellQuote(serviceID)),
		`script="/etc/init.d/$name"`,
		`if [ ! -e "$script" ]; then printf 'State=missing\nServiceID=%s\n' "$name"; exit 0; fi`,
		`if [ ! -f "$script" ] || [ -L "$script" ] || [ ! -x "$script" ]; then printf 'State=invalid\nServiceID=%s\n' "$name"; exit 0; fi`,
		`"$script" running >/dev/null 2>&1`,
		`running_code=$?`,
		`"$script" enabled >/dev/null 2>&1`,
		`enabled_code=$?`,
		`printf 'State=ok\nServiceID=%s\nScriptPath=/etc/init.d/%s\nRunningCode=%s\nEnabledCode=%s\n' "$name" "$name" "$running_code" "$enabled_code"`,
	}, "\n")
}

func parseProcdServiceDetail(serverID int64, serviceID string, output string, capability domain.ServiceManagerCapability) domain.SystemServiceDetail {
	values := parseKeyValues(output)
	state := strings.ToLower(firstNonEmpty(values["State"], "ok"))
	activeState, subState := procdRunningState(parseExitCode(values["RunningCode"]))
	unitFileState := procdEnabledState(parseExitCode(values["EnabledCode"]))
	loadState := "loaded"
	if state == "missing" || state == "invalid" {
		loadState = "not-found"
		activeState = "unknown"
		subState = "unknown"
		unitFileState = "unknown"
	}
	detail := domain.SystemServiceDetail{
		ServerID:            serverID,
		InitSystem:          domain.ServiceManagerInitSystemOpenWrtProcd,
		ServiceID:           firstNonEmpty(values["ServiceID"], serviceID),
		UnitName:            firstNonEmpty(values["ServiceID"], serviceID),
		DisplayName:         firstNonEmpty(values["ServiceID"], serviceID),
		Description:         procdDescription,
		LoadState:           loadState,
		ActiveState:         activeState,
		SubState:            subState,
		UnitFileState:       unitFileState,
		StartupState:        unitFileState,
		ScriptPath:          firstNonEmpty(values["ScriptPath"], "/etc/init.d/"+serviceID),
		DistributionName:    capability.DistributionName,
		DistributionVersion: capability.DistributionVersion,
		LastUpdatedAt:       timestamp(),
		Partial:             true,
		Warnings:            []string{procdPartialDetailMessage},
	}
	return decorateProcdDetail(detail)
}

func decorateProcdDetail(detail domain.SystemServiceDetail) domain.SystemServiceDetail {
	detail = decorateDetail(detail)
	detail.Critical = isCriticalProcdService(detail.ServiceID)
	detail.Protected = isProtectedProcdService(detail.ServiceID)
	return detail
}

func procdActionCommand(action string, serviceID string, root bool) (string, error) {
	if _, ok := procdActions[action]; !ok {
		return "", errors.New("服务操作无效。")
	}
	prefix := fmt.Sprintf("name=%s\nscript=\"/etc/init.d/$name\"\nif [ ! -f \"$script\" ] || [ -L \"$script\" ] || [ ! -x \"$script\" ]; then printf 'service missing\\n' >&2; exit 127; fi\n", shellQuote(serviceID))
	if root {
		return prefix + fmt.Sprintf("exec \"$script\" %s", action), nil
	}
	return prefix + fmt.Sprintf("if command -v sudo >/dev/null 2>&1; then exec sudo -n \"$script\" %s; fi\nprintf 'sudo: a password is required\\n' >&2\nexit 126", action), nil
}

func isCriticalProcdService(serviceID string) bool {
	_, ok := procdCriticalServices[serviceID]
	return ok
}

func isProtectedProcdService(serviceID string) bool {
	_, ok := procdProtectedServices[serviceID]
	return ok
}

func parseNamedSections(output string, names ...string) map[string]string {
	allowed := map[string]struct{}{}
	for _, name := range names {
		allowed[name] = struct{}{}
	}
	sections := map[string]string{}
	current := ""
	var builder strings.Builder
	flush := func() {
		if current != "" {
			sections[current] = strings.TrimSpace(builder.String())
		}
		builder.Reset()
	}
	for _, line := range strings.Split(output, "\n") {
		text := strings.TrimSpace(line)
		if _, ok := allowed[text]; ok {
			flush()
			current = text
			continue
		}
		if current != "" {
			builder.WriteString(line)
			builder.WriteByte('\n')
		}
	}
	flush()
	return sections
}
