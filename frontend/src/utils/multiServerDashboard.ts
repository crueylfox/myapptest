import type {
  Connection,
  ConnectionRuntimeState,
  DockerAvailability,
  DockerContainer,
  Group,
  MonitorSnapshot,
  SFTPState,
  SFTPTransferState,
  TerminalSessionInfo,
  TunnelRuntime,
} from '../types'

export type DashboardServerStatus = 'online' | 'offline' | 'connecting' | 'error'

export interface DashboardServerSummary {
  serverID: number
  name: string
  groupName: string
  host: string
  port: number
  status: DashboardServerStatus
  latencyMs?: number
  cpuPercent?: number
  memoryPercent?: number
  networkRxRate?: number
  networkTxRate?: number
  diskUsagePercent?: number
  terminalCount: number
  sftpConnectedCount: number
  transferActiveCount: number
  transferQueuedCount: number
  transferRunningCount: number
  transferFailedCount: number
  transferCompletedCount: number
  transferPreview: DashboardTransferSummary[]
  tunnelRunningCount: number
  tunnelStoppedOrFailedCount: number
  tunnelPreview: DashboardTunnelSummary[]
  dockerAvailable: boolean | null
  dockerRunningContainers: number | null
  dockerStoppedContainers: number | null
  dockerTotalContainers: number | null
  dockerStatusLabel: string
  lastError?: string
  active: boolean
}

export interface DashboardTransferSummary {
  id: string
  name: string
  directionLabel: string
  statusLabel: string
  percent?: number
}

export interface DashboardTunnelSummary {
  id: string
  name: string
  endpoint: string
  statusLabel: string
}

export interface BuildDashboardSummariesInput {
  connections: Connection[]
  groups: Group[]
  connectionState: (serverID: number) => ConnectionRuntimeState
  snapshots: Record<number, MonitorSnapshot>
  terminalSessionsByServerId: Record<number, TerminalSessionInfo[]>
  sftpStatesByServerId: Record<number, SFTPState>
  sftpStatesByContextId: Record<string, SFTPState>
  sftpTransfersByServerId: Record<number, SFTPTransferState[]>
  tunnelRuntimes: TunnelRuntime[]
  dockerAvailabilityByServerId: Record<number, DockerAvailability>
  dockerContainersByServerId: Record<number, DockerContainer[]>
  activeWorkspaceServerId: number | null
}

export function buildDashboardSummaries(input: BuildDashboardSummariesInput): DashboardServerSummary[] {
  const groupNames = new Map(input.groups.map((group) => [group.id, group.name]))
  return input.connections.map((connection) => {
    const state = input.connectionState(connection.id)
    const status = dashboardStatus(state)
    const snapshot = status === 'online' && input.snapshots[connection.id]?.status === 'online'
      ? input.snapshots[connection.id]
      : null
    const transfers = input.sftpTransfersByServerId[connection.id] ?? []
    const transferCounts = countTransfers(transfers)
    const tunnels = input.tunnelRuntimes.filter((runtime) => runtime.serverID === connection.id)
    const tunnelCounts = countTunnels(tunnels)
    const dockerSummary = dockerSummaryFor(connection.id, input)

    return {
      serverID: connection.id,
      name: connection.name,
      groupName: connection.groupId === null ? '未分组' : groupNames.get(connection.groupId) ?? '未分组',
      host: connection.host,
      port: connection.port,
      status,
      latencyMs: snapshot?.latencyAvailable ? safeNumber(snapshot.latencyMillis) : undefined,
      cpuPercent: safePercent(snapshot?.cpuPercent),
      memoryPercent: safePercent(snapshot?.memoryUsedPercent),
      networkRxRate: safeRate(snapshot?.downloadBytesPerSecond),
      networkTxRate: safeRate(snapshot?.uploadBytesPerSecond),
      diskUsagePercent: safePercent(snapshot?.diskUsedPercent ?? diskFromMounts(snapshot)),
      terminalCount: input.terminalSessionsByServerId[connection.id]?.length ?? 0,
      sftpConnectedCount: countConnectedSftp(connection.id, input.sftpStatesByServerId, input.sftpStatesByContextId),
      ...transferCounts,
      ...tunnelCounts,
      ...dockerSummary,
      lastError: sanitizedLastError(state),
      active: input.activeWorkspaceServerId === connection.id,
    }
  })
}

export function dashboardStatus(state: ConnectionRuntimeState): DashboardServerStatus {
  if (state.status === 'connecting' || state.status === 'reconnecting' || state.status === 'disconnecting' ||
    state.connecting || state.terminalConnecting) {
    return 'connecting'
  }
  if (state.status === 'online') {
    return 'online'
  }
  if (state.lastError || [
    'auth_failed',
    'timeout',
    'unreachable',
    'refused',
    'hostkey_mismatch',
    'key_error',
    'error',
  ].includes(state.status)) {
    return 'error'
  }
  if (state.status === 'offline' || state.status === 'disconnected') {
    return 'offline'
  }
  if (state.monitorActive || state.terminalActive || state.sftpActive || state.hasActiveSession) {
    return 'online'
  }
  return 'offline'
}

function safeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safePercent(value: number | null | undefined) {
  const number = safeNumber(value)
  return number === undefined || number < 0 ? undefined : number
}

function safeRate(value: number | null | undefined) {
  const number = safeNumber(value)
  return number === undefined || number < 0 ? undefined : number
}

function diskFromMounts(snapshot: MonitorSnapshot | null) {
  if (!snapshot) return undefined
  if (!Array.isArray(snapshot.mounts)) return undefined
  const root = snapshot.mounts.find((mount) => mount.mountPath === '/')
  return root?.usedPercent
}

function sanitizedLastError(state: ConnectionRuntimeState) {
  const value = state.lastError?.userMessage || state.lastError?.technicalMessage || ''
  return value.trim() || undefined
}

function countConnectedSftp(
  serverID: number,
  stateByServerId: Record<number, SFTPState>,
  stateByContextId: Record<string, SFTPState>,
) {
  const connectedContexts = new Set<string>()
  for (const [contextId, state] of Object.entries(stateByContextId)) {
    if (state.connectionId === serverID && state.status === 'online') {
      connectedContexts.add(contextId)
    }
  }
  const serverState = stateByServerId[serverID]
  if (serverState?.status === 'online') {
    connectedContexts.add(serverState.contextId || `server:${serverID}`)
  }
  return connectedContexts.size
}

function dockerSummaryFor(serverID: number, input: BuildDashboardSummariesInput) {
  const hasAvailability = Object.prototype.hasOwnProperty.call(input.dockerAvailabilityByServerId, serverID)
  const availability = input.dockerAvailabilityByServerId[serverID]
  if (hasAvailability && availability && !availability.available) {
    return {
      dockerAvailable: false,
      dockerRunningContainers: null,
      dockerStoppedContainers: null,
      dockerTotalContainers: null,
      dockerStatusLabel: '不可用',
    }
  }

  let containers: DockerContainer[] | null = null
  if (Object.prototype.hasOwnProperty.call(input.dockerContainersByServerId, serverID)) {
    containers = input.dockerContainersByServerId[serverID] ?? []
  } else if (hasAvailability && availability) {
    containers = availability.containers ?? []
  }

  if (containers === null) {
    return {
      dockerAvailable: null,
      dockerRunningContainers: null,
      dockerStoppedContainers: null,
      dockerTotalContainers: null,
      dockerStatusLabel: '未检测',
    }
  }
  const counts = countDockerContainers(containers)
  return {
    dockerAvailable: availability?.available ?? true,
    dockerStatusLabel: `${counts.dockerRunningContainers}/${counts.dockerTotalContainers}`,
    ...counts,
  }
}

function countDockerContainers(containers: DockerContainer[]) {
  const running = containers.filter((container) => container.state === 'running').length
  return {
    dockerRunningContainers: running,
    dockerStoppedContainers: Math.max(containers.length - running, 0),
    dockerTotalContainers: containers.length,
  }
}

function countTransfers(transfers: SFTPTransferState[]) {
  const activeStatuses = [
    'queued',
    'planning',
    'running',
    'pausing',
    'paused',
    'resuming',
  ]
  const active = transfers.filter((transfer) => activeStatuses.includes(transfer.status))
  return {
    transferActiveCount: active.length,
    transferQueuedCount: transfers.filter((transfer) => transfer.status === 'queued').length,
    transferRunningCount: transfers.filter((transfer) => [
      'planning',
      'running',
      'pausing',
      'paused',
      'resuming',
    ].includes(transfer.status)).length,
    transferFailedCount: transfers.filter((transfer) => [
      'failed',
      'partial_failed',
    ].includes(transfer.status)).length,
    transferCompletedCount: transfers.filter((transfer) => transfer.status === 'completed').length,
    transferPreview: active.slice(0, 3).map(transferPreview),
  }
}

function countTunnels(tunnels: TunnelRuntime[]) {
  const running = tunnels.filter((runtime) => runtime.status === 'starting' || runtime.status === 'running')
  const stoppedOrFailed = tunnels.filter((runtime) => runtime.status === 'stopped' || runtime.status === 'failed')
  return {
    tunnelRunningCount: running.length,
    tunnelStoppedOrFailedCount: stoppedOrFailed.length,
    tunnelPreview: tunnels.slice(0, 3).map(tunnelPreview),
  }
}

function transferPreview(transfer: SFTPTransferState): DashboardTransferSummary {
  return {
    id: transfer.id,
    name: transfer.currentFile || transfer.fileName || basename(transfer.remotePath || transfer.localPath) || transfer.id,
    directionLabel: transfer.direction === 'upload' ? '上传' : '下载',
    statusLabel: transferStatusLabel(transfer.status),
    percent: Number.isFinite(transfer.percent) ? Math.max(0, Math.min(100, Math.round(transfer.percent))) : undefined,
  }
}

function tunnelPreview(runtime: TunnelRuntime): DashboardTunnelSummary {
  return {
    id: runtime.tunnelID,
    name: runtime.name || tunnelTypeLabel(runtime.type),
    endpoint: tunnelEndpoint(runtime),
    statusLabel: tunnelStatusLabel(runtime.status),
  }
}

function tunnelEndpoint(runtime: TunnelRuntime) {
  if (runtime.type === 'dynamic') {
    return `SOCKS5 ${runtime.bindHost || '127.0.0.1'}:${runtime.bindPort}`
  }
  if (runtime.type === 'remote') {
    const host = runtime.remoteBindHost || runtime.effectiveRemoteBindHost || '0.0.0.0'
    return `远程 ${host}:${runtime.remoteBindPort} → ${runtime.targetHost}:${runtime.targetPort}`
  }
  return `本地 ${runtime.bindHost || '127.0.0.1'}:${runtime.bindPort} → ${runtime.targetHost}:${runtime.targetPort}`
}

function basename(value: string) {
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() ?? ''
}

function transferStatusLabel(status: SFTPTransferState['status']) {
  return ({
    queued: '排队',
    planning: '准备',
    running: '传输中',
    pausing: '暂停中',
    paused: '已暂停',
    resuming: '继续中',
    completed: '已完成',
    partial_failed: '部分失败',
    failed: '失败',
    canceled: '已取消',
    skipped: '已跳过',
  } as Record<SFTPTransferState['status'], string>)[status] ?? status
}

function tunnelStatusLabel(status: TunnelRuntime['status']) {
  return ({
    starting: '启动中',
    running: '运行中',
    failed: '失败',
    stopping: '停止中',
    stopped: '已停止',
  } as Record<TunnelRuntime['status'], string>)[status] ?? status
}

function tunnelTypeLabel(type: TunnelRuntime['type']) {
  return ({
    local: '本地转发',
    remote: '远程转发',
    dynamic: 'SOCKS5',
  } as Record<TunnelRuntime['type'], string>)[type] ?? type
}
