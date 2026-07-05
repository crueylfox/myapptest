import type {
  ServiceJournalLine,
  ServiceJournalPriority,
  ServiceManagerCapability,
  SystemServiceDetail,
  SystemServiceSummary,
} from '../types'

export type RunningFilter = 'all' | 'running' | 'stopped' | 'failed'
export type StartupFilter = 'all' | 'enabled' | 'disabled' | 'static' | 'other'
export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'
export type DetailTab = 'detail' | 'logs'

export const SERVICE_ACTIONS = ['start', 'stop', 'restart', 'enable', 'disable'] as const satisfies readonly ServiceAction[]

export interface ServiceFilterOptions {
  query: string
  runningFilter: RunningFilter
  startupFilter: StartupFilter
}

export interface ServiceActionDisabledOptions {
  service: SystemServiceSummary | null
  capability: ServiceManagerCapability | null
  canManage: boolean
  busyAction: ServiceAction | null
  loading: boolean
}

export interface JournalStatusTextOptions {
  hasSelectedService: boolean
  loading: boolean
  following: boolean
  status: string
  error: string
  overflow: boolean
  visibleCount: number
  totalCount: number
}

export interface JournalCountTextOptions {
  loading: boolean
  status: string
  overflow: boolean
  visibleCount: number
  totalCount: number
}

export function isStoppedService(service: SystemServiceSummary) {
  return !service.isActive && !service.isFailed && (service.activeState === 'inactive' || service.activeStateLabel === '已停止')
}

export function filterServices(services: SystemServiceSummary[], options: ServiceFilterOptions) {
  const term = options.query.trim().toLowerCase()
  return services.filter((service) => {
    if (options.runningFilter === 'running' && !service.isActive) return false
    if (options.runningFilter === 'stopped' && !isStoppedService(service)) return false
    if (options.runningFilter === 'failed' && !service.isFailed) return false
    if (options.startupFilter === 'enabled' && !service.isEnabled) return false
    if (options.startupFilter === 'disabled' && service.unitFileState !== 'disabled') return false
    if (options.startupFilter === 'static' && service.unitFileState !== 'static') return false
    if (options.startupFilter === 'other' && ['enabled', 'enabled-runtime', 'disabled', 'static'].includes(service.unitFileState)) return false
    if (!term) return true
    return service.unitName.toLowerCase().includes(term) ||
      service.serviceID.toLowerCase().includes(term) ||
      service.displayName.toLowerCase().includes(term) ||
      service.description.toLowerCase().includes(term)
  })
}

export function statusClass(service: SystemServiceSummary) {
  if (service.isFailed) return 'failed'
  if (service.activeState === 'activating' || service.activeState === 'deactivating' || service.activeState === 'reloading') return 'pending'
  if (service.isActive) return 'running'
  return 'stopped'
}

export function startupClass(service: SystemServiceSummary) {
  if (service.isEnabled) return 'enabled'
  if (service.unitFileState === 'disabled') return 'disabled'
  return 'other'
}

export function serviceLabel(service: SystemServiceSummary | SystemServiceDetail) {
  return service.displayName || service.serviceID || service.unitName
}

export function criticalWarningText(service: SystemServiceSummary | null) {
  if (!service?.critical) return ''
  if (service.initSystem === 'openwrt-procd') {
    return '关键服务：停止或重启可能影响 SSH、网络、防火墙、DNS 或管理界面。'
  }
  return '关键服务：停止或重启前请确认不会影响当前连接。'
}

export function partialWarningText(detail: SystemServiceDetail | null) {
  const warnings = detail?.warnings ?? []
  return detail?.partial && warnings.length ? warnings[0] : ''
}

export function serviceStatusText(options: {
  onlineCount: number
  selectedServerID: number
  loading: boolean
  rawCount: number
  capability: ServiceManagerCapability | null
  listError: string
}) {
  if (!options.onlineCount) return '请先连接一台服务器。'
  if (!options.selectedServerID) return '请选择服务器。'
  if (options.loading && options.rawCount === 0) return '正在读取系统服务...'
  if (options.capability && !options.capability.available) {
    return options.capability.error || '当前服务器不使用 systemd 或 OpenWrt procd，本阶段暂不支持该服务管理方式。'
  }
  if (options.capability?.available && !options.capability.canManage) {
    return options.capability.error || '当前用户只能查看系统服务，不能执行管理操作。'
  }
  if (options.listError && options.rawCount === 0) return options.listError
  if (options.capability?.available) {
    const display = options.capability.displayName || (options.capability.systemdVersion ? `systemd ${options.capability.systemdVersion}` : 'systemd')
    return options.capability.canManage ? `已检测到 ${display}。` : `已检测到 ${display}，当前用户只能查看。`
  }
  return '尚未检测服务管理能力。'
}

export function serviceStatusShortText(capability: ServiceManagerCapability | null, statusText: string) {
  if (!capability?.available) return statusText
  return capability.displayName || (capability.systemdVersion ? `systemd ${capability.systemdVersion}` : 'systemd')
}

export function journalSupported(capability: ServiceManagerCapability | null) {
  if (capability?.available !== true) return false
  if (capability.initSystem === 'systemd') return capability.supportsJournal !== false
  return capability.initSystem === 'openwrt-procd'
}

export function journalRefreshSupported(capability: ServiceManagerCapability | null) {
  return capability?.available === true &&
    capability.supportsJournal !== false &&
    (capability.initSystem === 'systemd' || capability.initSystem === 'openwrt-procd')
}

export function journalFollowSupported(capability: ServiceManagerCapability | null) {
  return journalRefreshSupported(capability) &&
    capability?.initSystem === 'systemd' &&
    capability.supportsLiveLogs !== false
}

export function journalSourceText(capability: ServiceManagerCapability | null) {
  if (capability?.initSystem === 'openwrt-procd') return 'OpenWrt logread'
  if (capability?.initSystem === 'systemd') return 'systemd journal'
  return 'unsupported'
}

export function journalFollowDisabledReason(capability: ServiceManagerCapability | null) {
  if (capability?.available !== true) return 'Service logs are not available.'
  if (!journalRefreshSupported(capability)) {
    if (capability.initSystem === 'openwrt-procd') return 'OpenWrt logread is not available on this server.'
    return 'Service logs are not available.'
  }
  if (capability.initSystem === 'openwrt-procd') {
    return 'OpenWrt logread supports refresh snapshots only; realtime follow is not supported.'
  }
  if (capability.supportsLiveLogs === false) return 'Realtime log follow is not supported.'
  return ''
}

export function resourceMetricsSupported(capability: ServiceManagerCapability | null) {
  return capability?.supportsResourceMetrics !== false
}

export function actionDialogTitle(action: ServiceAction) {
  return {
    start: '启动服务',
    stop: '停止服务',
    restart: '重启服务',
    enable: '启用开机启动',
    disable: '禁用开机启动',
  }[action]
}

export function actionConfirmText(action: ServiceAction) {
  return {
    start: '启动',
    stop: '停止',
    restart: '重启',
    enable: '启用',
    disable: '禁用',
  }[action]
}

export function actionDoneLabel(action: ServiceAction) {
  return {
    start: '启动',
    stop: '停止',
    restart: '重启',
    enable: '启用开机启动',
    disable: '禁用开机启动',
  }[action]
}

export function actionPendingLabel(action: ServiceAction, busyAction: ServiceAction | null) {
  if (busyAction !== action) return actionConfirmText(action)
  return {
    start: '启动中',
    stop: '停止中',
    restart: '重启中',
    enable: '更新中',
    disable: '更新中',
  }[action]
}

export function actionConfirmMessage(action: ServiceAction, service: SystemServiceSummary) {
  const unitName = serviceLabel(service)
  if (service.initSystem === 'openwrt-procd') {
    const base = {
      start: `确定启动服务「${unitName}」吗？`,
      stop: `停止服务可能影响远程连接或业务，确定停止「${unitName}」吗？`,
      restart: `重启服务会造成短暂中断，确定重启「${unitName}」吗？`,
      enable: `确定将服务「${unitName}」设置为开机启动吗？该操作不会立即启动服务。`,
      disable: `确定取消服务「${unitName}」的开机启动吗？当前正在运行的服务不会自动停止。`,
    }[action]
    if (service.critical && (action === 'stop' || action === 'restart')) {
      return `${base}\n\n该服务可能影响当前 SSH 连接、网络、防火墙、DNS 或管理界面。继续操作可能导致 ServerPilot 断开连接。`
    }
    if (service.critical && action === 'disable') {
      return `${base}\n\n禁用该服务的开机启动可能导致服务器重启后无法远程访问或网络异常。`
    }
    return base
  }
  const base = {
    start: `确定启动服务「${unitName}」吗？`,
    stop: `停止服务可能影响远程连接或业务，确定停止「${unitName}」吗？`,
    restart: `重启服务会造成短暂中断，确定重启「${unitName}」吗？`,
    enable: `确定将「${unitName}」设置为开机启动吗？`,
    disable: `确定取消「${unitName}」的开机启动吗？当前正在运行的服务不会自动停止。`,
  }[action]
  if (!service.critical || (action !== 'stop' && action !== 'restart')) return base
  return `${base}\n\n该服务可能影响当前 SSH 连接、网络或正在运行的容器。继续操作可能导致 ServerPilot 断开连接。`
}

export function actionDisabled(action: ServiceAction, options: ServiceActionDisabledOptions) {
  const service = options.service
  if (!service || !options.canManage || options.busyAction || options.loading) return true
  if (service.protected) return true
  if (action === 'start' && options.capability?.supportsStart === false) return true
  if (action === 'stop' && options.capability?.supportsStop === false) return true
  if (action === 'restart' && options.capability?.supportsRestart === false) return true
  if (action === 'enable' && options.capability?.supportsEnable === false) return true
  if (action === 'disable' && options.capability?.supportsDisable === false) return true
  if (action === 'start') return !service.canStart
  if (action === 'stop') return !service.canStop
  if (action === 'restart') return !service.canRestart
  if (action === 'enable') return !service.canEnable
  return !service.canDisable
}

export function detailPathText(detail: SystemServiceDetail | null) {
  return detail?.scriptPath || detail?.fragmentPath || '—'
}

export function detailPathTitle(detail: SystemServiceDetail | null) {
  return detail?.scriptPath || detail?.fragmentPath || ''
}

export function resourceTitle(supported: boolean) {
  return supported ? '当前 systemd 未提供该资源统计' : 'OpenWrt procd 不提供 systemd 资源字段'
}

export function formatBytes(value: number | undefined) {
  if (value === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

export function formatCPU(value: number | undefined) {
  if (value === undefined) return '—'
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} ms`
  return `${(value / 1_000_000_000).toFixed(1)} s`
}

export function pidText(value: number | undefined) {
  return value && value > 0 ? String(value) : '—'
}

export function countText(value: number | undefined) {
  return value === undefined ? '—' : String(value)
}

export function filterJournalLines(lines: ServiceJournalLine[], query: string) {
  const term = query.trim().toLowerCase()
  if (!term) return lines
  return lines.filter((line) =>
    line.message.toLowerCase().includes(term) ||
    (line.identifier ?? '').toLowerCase().includes(term) ||
    line.priorityLabel.toLowerCase().includes(term))
}

export function journalStatusText(options: JournalStatusTextOptions) {
  if (!options.hasSelectedService) return '请选择一个服务。'
  if (options.loading) return '正在读取日志...'
  if (options.following) return '实时日志已开启。'
  if (options.status === 'connecting') return '正在启动实时日志...'
  if (options.status === 'error') return options.error || '读取系统服务日志失败。'
  if (options.overflow) return '日志显示已达到内存上限，较早内容已丢弃。'
  return `当前显示 ${options.visibleCount} / ${options.totalCount} 行。`
}

export function journalCountText(options: JournalCountTextOptions) {
  if (options.loading) return '读取中'
  if (options.status === 'connecting') return '启动中'
  if (options.status === 'error') return '日志错误'
  if (options.overflow) return `${options.visibleCount}/${options.totalCount} 行`
  return `${options.visibleCount}/${options.totalCount} 行`
}

export function journalLineClass(line: ServiceJournalLine) {
  if (line.priority <= 3 && line.priority >= 0) return 'error'
  if (line.priority === 4) return 'warning'
  if (line.priority === 7) return 'debug'
  if (line.priority === 5) return 'notice'
  return 'info'
}

export function journalTimeText(line: ServiceJournalLine) {
  if (line.timestampText) return line.timestampText
  if (!line.timestamp) return '—'
  const date = new Date(line.timestamp)
  if (Number.isNaN(date.getTime())) return line.timestamp
  return date.toLocaleString()
}

export function journalMeta(line: ServiceJournalLine) {
  const parts = [line.priorityLabel]
  if (line.identifier) parts.push(line.identifier)
  if (line.pid) parts.push(`PID ${line.pid}`)
  if (line.truncated) parts.push('已截断')
  return parts.join(' · ')
}

export function formatJournalCopyLine(line: ServiceJournalLine) {
  return `[${journalTimeText(line)}] ${journalMeta(line)} ${line.message}`
}

export function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

export type { ServiceJournalPriority }
