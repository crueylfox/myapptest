package tunnelmanager

import (
	"context"
	"errors"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

const inspectRemoteForwardAccessCommand = `sh <<'SERVERPILOT_INSPECT_GATEWAYPORTS'
set -u
sshd_type=unknown
if command -v sshd >/dev/null 2>&1; then
  sshd_type=openssh
elif command -v dropbear >/dev/null 2>&1; then
  sshd_type=dropbear
fi
config_path=
if [ -f /etc/ssh/sshd_config ]; then
  config_path=/etc/ssh/sshd_config
elif [ -f /etc/sshd_config ]; then
  config_path=/etc/sshd_config
fi
gateway=unknown
allow=unknown
if [ "$sshd_type" = "openssh" ] && command -v sshd >/dev/null 2>&1; then
  gateway=$(sshd -T 2>/dev/null | awk 'tolower($1)=="gatewayports"{print $2; exit}')
  allow=$(sshd -T 2>/dev/null | awk 'tolower($1)=="allowtcpforwarding"{print $2; exit}')
fi
[ -n "${gateway:-}" ] || gateway=unknown
[ -n "${allow:-}" ] || allow=unknown
can_modify=no
requires_sudo=no
if [ "$sshd_type" = "openssh" ] && [ -n "$config_path" ]; then
  if [ "$(id -u)" = "0" ]; then
    can_modify=yes
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    can_modify=yes
    requires_sudo=yes
  fi
fi
echo "__SP_SSHD_TYPE=$sshd_type"
echo "__SP_CONFIG_PATH=$config_path"
echo "__SP_GATEWAYPORTS=$gateway"
echo "__SP_ALLOWTCPFORWARDING=$allow"
echo "__SP_CAN_MODIFY=$can_modify"
echo "__SP_REQUIRES_SUDO=$requires_sudo"
SERVERPILOT_INSPECT_GATEWAYPORTS`

const enableRemoteForwardAccessCommand = `sh <<'SERVERPILOT_ENABLE_GATEWAYPORTS'
set -u
fail() {
  echo "__SP_RESULT=$1"
  [ -n "${2:-}" ] && echo "__SP_MESSAGE=$2"
  [ -n "${3:-}" ] && echo "__SP_BACKUP=$3"
  exit 0
}
if command -v dropbear >/dev/null 2>&1 && ! command -v sshd >/dev/null 2>&1; then
  fail unsupported "当前服务器可能使用 Dropbear，本轮暂不自动修改 GatewayPorts。"
fi
if ! command -v sshd >/dev/null 2>&1; then
  fail unsupported "未检测到 OpenSSH sshd，无法自动修改 GatewayPorts。"
fi
CONFIG=
if [ -f /etc/ssh/sshd_config ]; then
  CONFIG=/etc/ssh/sshd_config
elif [ -f /etc/sshd_config ]; then
  CONFIG=/etc/sshd_config
else
  fail missing_config "未找到 sshd_config。"
fi
SUDO=
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    SUDO="sudo -n"
  else
    fail permission_denied "当前用户无权限修改 sshd 配置，请使用 root 或手动修改 GatewayPorts yes。"
  fi
fi
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP="${CONFIG}.hostdeck.bak.${STAMP}"
$SUDO cp -p "$CONFIG" "$BACKUP" || fail backup_failed "备份 sshd_config 失败。"
TMP=$(mktemp /tmp/hostdeck-sshd-config.XXXXXX) || fail temp_failed "创建临时配置失败。" "$BACKUP"
awk '
BEGIN { done=0; inmatch=0 }
tolower($1)=="match" && !done { print "GatewayPorts yes"; done=1; inmatch=1; print; next }
tolower($1)=="match" { inmatch=1; print; next }
!inmatch && $0 !~ /^[[:space:]]*#/ && tolower($1)=="gatewayports" && !done { print "GatewayPorts yes"; done=1; next }
{ print }
END { if (!done) print "GatewayPorts yes" }
' "$CONFIG" > "$TMP" || fail edit_failed "生成 sshd_config 修改内容失败。" "$BACKUP"
$SUDO cp "$TMP" "$CONFIG" || fail write_failed "写入 sshd_config 失败。" "$BACKUP"
rm -f "$TMP"
if ! $SUDO sshd -t >/dev/null 2>&1; then
  $SUDO cp -p "$BACKUP" "$CONFIG" >/dev/null 2>&1
  fail validation_failed "sshd -t 验证失败，已回滚 sshd_config。" "$BACKUP"
fi
RELOAD=
for cmd in "systemctl reload sshd" "systemctl reload ssh" "service ssh reload" "service sshd reload" "/etc/init.d/sshd reload"; do
  if $SUDO sh -c "$cmd" >/dev/null 2>&1; then
    RELOAD="$cmd"
    break
  fi
done
echo "__SP_RESULT=success"
echo "__SP_BACKUP=$BACKUP"
echo "__SP_CHANGED=$CONFIG"
echo "__SP_RELOAD=$RELOAD"
if [ -z "$RELOAD" ]; then
  echo "__SP_WARNING=GatewayPorts yes 已写入并通过 sshd -t，但自动 reload 失败，请手动重启或重新加载 sshd。"
fi
SERVERPILOT_ENABLE_GATEWAYPORTS`

func (m *Manager) InspectRemoteForwardAccess(request domain.RemoteForwardAccessRequest) (domain.RemoteForwardAccessInspectResult, error) {
	current, err := m.remoteAccessWorker(request)
	if err != nil {
		return domain.RemoteForwardAccessInspectResult{}, err
	}
	ctx, cancel := context.WithTimeout(m.ctx, 8*time.Second)
	defer cancel()
	output, err := current.transport.Run(ctx, inspectRemoteForwardAccessCommand)
	if err != nil {
		return domain.RemoteForwardAccessInspectResult{}, errors.New("检测服务器 SSH 配置失败")
	}
	fields := parseMarkerOutput(output)
	result := domain.RemoteForwardAccessInspectResult{
		ServerID:                    current.snapshot().ServerID,
		SSHDType:                    valueOr(fields["SSHD_TYPE"], "unknown"),
		ConfigPath:                  fields["CONFIG_PATH"],
		GatewayPortsEffective:       valueOr(fields["GATEWAYPORTS"], "unknown"),
		AllowTCPForwardingEffective: valueOr(fields["ALLOWTCPFORWARDING"], "unknown"),
		CanModify:                   fields["CAN_MODIFY"] == "yes",
		RequiresSudo:                fields["REQUIRES_SUDO"] == "yes",
	}
	if result.SSHDType == "dropbear" {
		result.Warnings = append(result.Warnings, "当前服务器可能使用 Dropbear，本轮暂不自动修改 GatewayPorts。")
	}
	if result.SSHDType == "openssh" && !result.CanModify {
		result.Warnings = append(result.Warnings, "当前用户无权限修改 sshd 配置，请使用 root 或手动修改 GatewayPorts yes。")
	}
	return result, nil
}

func (m *Manager) EnableRemoteForwardAccess(request domain.RemoteForwardAccessRequest) (domain.RemoteForwardAccessEnableResult, error) {
	current, err := m.remoteAccessWorker(request)
	if err != nil {
		return domain.RemoteForwardAccessEnableResult{}, err
	}
	return m.enableRemoteForwardAccessOnTransport(current.transport)
}

func (m *Manager) enableRemoteForwardAccessOnTransport(transport Transport) (domain.RemoteForwardAccessEnableResult, error) {
	if transport == nil {
		return domain.RemoteForwardAccessEnableResult{}, errors.New("隧道 SSH 连接不可用")
	}
	ctx, cancel := context.WithTimeout(m.ctx, 20*time.Second)
	defer cancel()
	output, err := transport.Run(ctx, enableRemoteForwardAccessCommand)
	if err != nil {
		return domain.RemoteForwardAccessEnableResult{}, errors.New("启用 GatewayPorts 失败")
	}
	fields := parseMarkerOutput(output)
	result := domain.RemoteForwardAccessEnableResult{
		Success:       fields["RESULT"] == "success",
		BackupPath:    fields["BACKUP"],
		ReloadCommand: fields["RELOAD"],
		Message:       fields["MESSAGE"],
	}
	if changed := strings.TrimSpace(fields["CHANGED"]); changed != "" {
		result.ChangedFiles = []string{changed}
	}
	if warning := strings.TrimSpace(fields["WARNING"]); warning != "" {
		result.Warnings = append(result.Warnings, warning)
	}
	if result.Success {
		if result.Message == "" {
			result.Message = "GatewayPorts yes 已启用。"
		}
		return result, nil
	}
	if result.Message == "" {
		result.Message = "启用 GatewayPorts 失败。"
	}
	return result, errors.New(result.Message)
}

func (m *Manager) remoteAccessWorker(request domain.RemoteForwardAccessRequest) (*worker, error) {
	if request.TunnelID == "" {
		return nil, errors.New("请选择正在运行的远程端口转发")
	}
	current, ok := m.worker(request.TunnelID)
	if !ok {
		return nil, errors.New("隧道不存在")
	}
	state := current.snapshot()
	if request.ServerID > 0 && state.ServerID != request.ServerID {
		return nil, errors.New("隧道不属于当前服务器")
	}
	if state.Type != domain.TunnelTypeRemote {
		return nil, errors.New("只有远程端口转发需要启用 GatewayPorts")
	}
	if current.transport == nil {
		return nil, errors.New("隧道 SSH 连接不可用")
	}
	return current, nil
}

func parseMarkerOutput(output string) map[string]string {
	result := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "__SP_") {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimPrefix(line, "__SP_"), "=")
		if !ok {
			continue
		}
		result[key] = value
	}
	return result
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
