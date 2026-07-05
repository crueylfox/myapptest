import type {
  ConnectionStatus,
  DiskMount,
  MetricError,
  MonitorSnapshot,
  ProcessInfo,
} from '../types'

const statuses = new Set<ConnectionStatus>([
  'offline', 'connecting', 'online', 'reconnecting', 'disconnecting', 'auth_failed',
  'timeout', 'unreachable', 'refused', 'hostkey_mismatch', 'key_error', 'disconnected', 'error',
])
const processStatuses = new Set<MonitorSnapshot['processStatus']>([
  'loading', 'available', 'empty', 'unsupported', 'failed',
])
const networkInterfaceModes = new Set(['all', 'interface', 'physical', 'docker'])

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown): number {
  return Math.max(0, finite(value))
}

function metric(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null
  return value
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function errors(value: unknown): MetricError[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const candidate = record(item)
    if (!candidate) return []
    const metricName = text(candidate.metric)
    const message = text(candidate.message)
    return metricName && message ? [{ metric: metricName, message }] : []
  })
}

function mounts(value: unknown): DiskMount[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const candidate = record(item)
    if (!candidate) return []
    const mountPath = text(candidate.mountPath)
    if (!mountPath) return []
    return [{
      filesystem: text(candidate.filesystem),
      mountPath,
      total: nonNegative(candidate.total),
      used: nonNegative(candidate.used),
      available: nonNegative(candidate.available),
      usedPercent: finite(candidate.usedPercent),
    }]
  })
}

function processes(value: unknown): ProcessInfo[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const candidate = record(item)
    if (!candidate) return []
    const pid = finite(candidate.pid)
    const command = text(candidate.command)
    if (!Number.isInteger(pid) || pid <= 0 || !command) return []
    return [{
      pid,
      cpuPercent: nonNegative(candidate.cpuPercent),
      memoryPercent: nonNegative(candidate.memoryPercent),
      command,
    }]
  })
}

export function normalizeMonitorSnapshot(value: unknown): MonitorSnapshot | null {
  const candidate = record(value)
  if (!candidate) return null
  const connectionId = finite(candidate.connectionId, -1)
  if (!Number.isInteger(connectionId) || connectionId <= 0) return null
  const statusValue = text(candidate.status) as ConnectionStatus
  const timestampValue = text(candidate.timestamp)
  const timestamp = Number.isFinite(Date.parse(timestampValue)) ? timestampValue : new Date().toISOString()
  const normalizedProcesses = processes(candidate.processes)
  const processStatusValue = text(candidate.processStatus) as MonitorSnapshot['processStatus']
  const processStatus = processStatuses.has(processStatusValue)
    ? processStatusValue
    : normalizedProcesses.length
      ? 'available'
      : candidate.monitorActive === true
        ? 'loading'
        : 'empty'

  return {
    connectionId,
    status: statuses.has(statusValue) ? statusValue : 'error',
    timestamp,
    latencyMillis: nonNegative(candidate.latencyMillis),
    latencyAvailable: candidate.latencyAvailable === true,
    cpuPercent: metric(candidate.cpuPercent, 0, 100),
    memoryTotal: nonNegative(candidate.memoryTotal),
    memoryAvailable: nonNegative(candidate.memoryAvailable),
    memoryUsedPercent: metric(candidate.memoryUsedPercent, 0, 100),
    swapTotal: nonNegative(candidate.swapTotal),
    swapFree: nonNegative(candidate.swapFree),
    diskTotal: nonNegative(candidate.diskTotal),
    diskUsed: nonNegative(candidate.diskUsed),
    diskUsedPercent: metric(candidate.diskUsedPercent, 0, 100),
    mounts: mounts(candidate.mounts),
    processes: normalizedProcesses,
    processStatus,
    processMessage: text(candidate.processMessage),
    loadOne: metric(candidate.loadOne),
    loadFive: metric(candidate.loadFive),
    loadFifteen: metric(candidate.loadFifteen),
    uptimeSeconds: metric(candidate.uptimeSeconds),
    defaultInterface: text(candidate.defaultInterface),
    networkInterfaceMode: networkInterfaceModes.has(text(candidate.networkInterfaceMode))
      ? text(candidate.networkInterfaceMode) as MonitorSnapshot['networkInterfaceMode']
      : 'all',
    selectedNetworkInterface: text(candidate.selectedNetworkInterface),
    effectiveNetworkInterface: text(candidate.effectiveNetworkInterface),
    networkInterfaceFallback: candidate.networkInterfaceFallback === true,
    networkInterfaceMessage: text(candidate.networkInterfaceMessage),
    downloadBytesPerSecond: metric(candidate.downloadBytesPerSecond),
    uploadBytesPerSecond: metric(candidate.uploadBytesPerSecond),
    osName: text(candidate.osName),
    kernel: text(candidate.kernel),
    architecture: text(candidate.architecture),
    errors: errors(candidate.errors),
    errorCode: text(candidate.errorCode),
    message: text(candidate.message),
    monitorActive: candidate.monitorActive === true,
    connectionError: typeof candidate.connectionError === 'object'
      ? candidate.connectionError as MonitorSnapshot['connectionError']
      : undefined,
  }
}
