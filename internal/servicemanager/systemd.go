package servicemanager

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"serverpilot/internal/domain"
)

const (
	systemdCapabilityCommand = `if command -v systemctl >/dev/null 2>&1 && test -d /run/systemd/system; then
LC_ALL=C systemctl --version | sed -n '1p'
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
fi`

	systemdListCommand = `LC_ALL=C systemctl list-units --type=service --all --no-pager --no-legend --plain
printf '%s\n' '---SERVERPILOT-UNIT-FILES---'
LC_ALL=C systemctl list-unit-files --type=service --no-pager --no-legend`

	idUserCommand = "id -u"

	systemdUnsupportedMessage        = "当前服务器不使用 systemd，本阶段暂不支持该服务管理方式。"
	serviceManagerUnsupportedMessage = "当前服务器不使用 systemd 或 OpenWrt procd，本阶段暂不支持该服务管理方式。"
	permissionMessage                = "当前用户没有管理系统服务的权限，请使用 root 或配置免密 sudo。"
	procdPermissionMessage           = "当前用户没有管理 OpenWrt 服务的权限，请使用 root 或配置免密 sudo。"
	timeoutMessage                   = "系统服务操作超时。"
	partialDetailMessage             = "当前 systemd 版本未提供部分资源字段。"
	procdPartialDetailMessage        = "OpenWrt procd 不提供 systemd 资源字段，具体 PID 与资源占用请使用进程管理。"
	journalUnsupportedMessage        = "当前服务器不支持 systemd journal 日志。"
	journalPermissionMessage         = "当前用户没有读取系统日志的权限，请使用 root、加入 systemd-journal 组或配置免密 sudo。"
	journalTimeoutMessage            = "读取系统服务日志超时。"
)

const (
	fallbackActiveSeparator  = "---SERVERPILOT-IS-ACTIVE---"
	fallbackEnabledSeparator = "---SERVERPILOT-IS-ENABLED---"
	fallbackShowSeparator    = "---SERVERPILOT-SHOW---"
)

var (
	unitNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.@:\\-]+\.service$`)
	dangerousChars  = regexp.MustCompile("[;|&$><\n\r\x00]")
	journalPriority = map[string]string{
		"all":     "",
		"error":   "err",
		"warning": "warning",
		"info":    "info",
		"debug":   "debug",
	}
	criticalUnits = map[string]struct{}{
		"sshd.service":             {},
		"ssh.service":              {},
		"systemd-networkd.service": {},
		"NetworkManager.service":   {},
		"networking.service":       {},
		"systemd-resolved.service": {},
		"docker.service":           {},
		"containerd.service":       {},
	}
	protectedUnits = map[string]struct{}{
		"systemd.service": {},
		"init.scope":      {},
	}
)

func validateUnitName(value string) (string, error) {
	unitName := strings.TrimSpace(value)
	if unitName == "" {
		return "", errors.New("服务名称无效。")
	}
	if strings.Contains(unitName, " ") ||
		strings.Contains(unitName, "/") ||
		strings.Contains(unitName, "..") ||
		dangerousChars.MatchString(unitName) ||
		!unitNamePattern.MatchString(unitName) {
		return "", errors.New("服务名称无效。")
	}
	return unitName, nil
}

func normalizeJournalLineLimit(value int) int {
	switch value {
	case 100, 200, 500, 1000:
		return value
	default:
		return 200
	}
}

func normalizeJournalPriority(value string) (string, string, error) {
	key := strings.ToLower(strings.TrimSpace(value))
	if key == "" {
		key = "all"
	}
	priority, ok := journalPriority[key]
	if !ok {
		return "", "", errors.New("日志级别无效。")
	}
	return key, priority, nil
}

func systemctlActionCommand(action string, unitName string, root bool) string {
	prefix := "LC_ALL=C systemctl"
	if !root {
		prefix = "LC_ALL=C sudo -n systemctl"
	}
	return fmt.Sprintf("%s %s -- %s", prefix, action, shellQuote(unitName))
}

func journalSnapshotCommand(unitName string, lineLimit int, priority string, currentBootOnly bool, sudo bool, format string) string {
	return journalCommand(unitName, lineLimit, priority, currentBootOnly, sudo, format, false)
}

func journalFollowCommand(unitName string, priority string, currentBootOnly bool, sudo bool, format string) string {
	return journalCommand(unitName, 0, priority, currentBootOnly, sudo, format, true)
}

func journalCommand(unitName string, lineLimit int, priority string, currentBootOnly bool, sudo bool, format string, follow bool) string {
	parts := []string{"LC_ALL=C"}
	if sudo {
		parts = append(parts, "sudo", "-n")
	}
	parts = append(parts, "journalctl", "--no-pager", "-u", shellQuote(unitName))
	if follow {
		parts = append(parts, "-n", "0", "-f")
	} else {
		parts = append(parts, "-n", fmt.Sprintf("%d", normalizeJournalLineLimit(lineLimit)))
	}
	parts = append(parts, "-o", format)
	if currentBootOnly {
		parts = append(parts, "-b", "0")
	}
	if priority != "" {
		parts = append(parts, "-p", priority)
	}
	return strings.Join(parts, " ")
}

func systemdBaseDetailCommand(unitName string) string {
	return strings.Join([]string{
		"LC_ALL=C systemctl show --no-pager",
		"-p Id",
		"-p Description",
		"-p LoadState",
		"-p ActiveState",
		"-p SubState",
		"-p UnitFileState",
		"-p MainPID",
		"-p FragmentPath",
		"-p Result",
		"-p ActiveEnterTimestamp",
		"-p ActiveExitTimestamp",
		"-p ExecMainStartTimestamp",
		"-p ExecMainExitTimestamp",
		"--",
		shellQuote(unitName),
	}, " ")
}

func systemdOptionalDetailCommand(unitName string) string {
	return strings.Join([]string{
		"LC_ALL=C systemctl show --no-pager",
		"-p MemoryCurrent",
		"-p CPUUsageNSec",
		"-p TasksCurrent",
		"-p NRestarts",
		"--",
		shellQuote(unitName),
	}, " ")
}

func systemdFallbackDetailCommand(unitName string) string {
	quoted := shellQuote(unitName)
	return strings.Join([]string{
		fmt.Sprintf("printf '%%s\\n' %s", shellQuote(fallbackActiveSeparator)),
		fmt.Sprintf("LC_ALL=C systemctl is-active -- %s 2>/dev/null || true", quoted),
		fmt.Sprintf("printf '%%s\\n' %s", shellQuote(fallbackEnabledSeparator)),
		fmt.Sprintf("LC_ALL=C systemctl is-enabled -- %s 2>/dev/null || true", quoted),
		fmt.Sprintf("printf '%%s\\n' %s", shellQuote(fallbackShowSeparator)),
		"LC_ALL=C systemctl show --no-pager -p Id -p LoadState -p MainPID -p FragmentPath -p Result -- " + quoted,
	}, "\n")
}

func activeStateLabel(activeState, subState string) string {
	active := strings.ToLower(strings.TrimSpace(activeState))
	sub := strings.ToLower(strings.TrimSpace(subState))
	switch {
	case active == "active" && sub == "running":
		return "运行中"
	case active == "active" && sub == "exited":
		return "已启动"
	case active == "inactive" && sub == "dead":
		return "已停止"
	case active == "failed":
		return "失败"
	case active == "activating":
		return "启动中"
	case active == "deactivating":
		return "停止中"
	case active == "reloading":
		return "重载中"
	default:
		return "未知"
	}
}

func unitFileStateLabel(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "enabled", "enabled-runtime":
		return "已启用"
	case "disabled":
		return "已禁用"
	case "static":
		return "静态"
	case "masked", "masked-runtime":
		return "已屏蔽"
	case "indirect":
		return "间接启用"
	case "generated":
		return "自动生成"
	case "transient":
		return "临时"
	default:
		return "未知"
	}
}

func decorateSummary(service domain.SystemServiceSummary) domain.SystemServiceSummary {
	service.UnitName = strings.TrimSpace(service.UnitName)
	if service.InitSystem == "" {
		service.InitSystem = domain.ServiceManagerInitSystemSystemd
	}
	if service.ServiceID == "" {
		service.ServiceID = service.UnitName
	}
	if service.DisplayName == "" {
		service.DisplayName = service.UnitName
	}
	if service.LoadState == "" {
		service.LoadState = "unknown"
	}
	if service.ActiveState == "" {
		service.ActiveState = "unknown"
	}
	if service.SubState == "" {
		service.SubState = "unknown"
	}
	if service.UnitFileState == "" {
		service.UnitFileState = "unknown"
	}
	if service.StartupState == "" {
		service.StartupState = service.UnitFileState
	}
	service.ActiveStateLabel = activeStateLabel(service.ActiveState, service.SubState)
	service.UnitFileStateLabel = unitFileStateLabel(service.UnitFileState)
	service.IsActive = strings.EqualFold(service.ActiveState, "active")
	service.IsFailed = strings.EqualFold(service.ActiveState, "failed") || strings.EqualFold(service.SubState, "failed")
	service.IsEnabled = strings.EqualFold(service.UnitFileState, "enabled") || strings.EqualFold(service.UnitFileState, "enabled-runtime")
	service.Critical = isCriticalUnit(service.UnitName)
	service.Protected = isProtectedUnit(service.UnitName)
	masked := strings.Contains(strings.ToLower(service.UnitFileState), "masked")
	service.CanStart = !service.Protected && !masked && !service.IsActive
	service.CanStop = !service.Protected && (service.IsActive || strings.EqualFold(service.ActiveState, "activating"))
	service.CanRestart = !service.Protected && (service.IsActive || strings.EqualFold(service.ActiveState, "failed"))
	service.CanEnable = !service.Protected && !masked && (strings.EqualFold(service.UnitFileState, "disabled") || strings.EqualFold(service.UnitFileState, "indirect"))
	service.CanDisable = !service.Protected && service.IsEnabled
	return service
}

func decorateDetail(detail domain.SystemServiceDetail) domain.SystemServiceDetail {
	if detail.InitSystem == "" {
		detail.InitSystem = domain.ServiceManagerInitSystemSystemd
	}
	if detail.ServiceID == "" {
		detail.ServiceID = detail.UnitName
	}
	if detail.DisplayName == "" {
		detail.DisplayName = detail.UnitName
	}
	if detail.StartupState == "" {
		detail.StartupState = detail.UnitFileState
	}
	detail.ActiveStateLabel = activeStateLabel(detail.ActiveState, detail.SubState)
	detail.UnitFileStateLabel = unitFileStateLabel(detail.UnitFileState)
	detail.Critical = isCriticalUnit(detail.UnitName)
	detail.Protected = isProtectedUnit(detail.UnitName)
	return detail
}

func isCriticalUnit(unitName string) bool {
	_, ok := criticalUnits[unitName]
	return ok
}

func isProtectedUnit(unitName string) bool {
	_, ok := protectedUnits[unitName]
	return ok
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
