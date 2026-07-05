import type {
  AlertEvent,
  AlertRuleType,
  AlertSeverity,
  AlertSettings,
  AlertSource,
  Connection,
  ConnectionRuntimeState,
  MonitorSnapshot,
} from '../types'
import { normalizeAlertSettings } from './alertSettings'

export interface AlertNotification {
  event: AlertEvent
  kind: 'firing' | 'resolved'
}

interface RuleState {
  phase: 'inactive' | 'pending' | 'firing' | 'recovering'
  pendingSince: number
  recoveringSince: number
  eventID: string
  lastSampleAt: number
}

interface OfflineState {
  everConnected: boolean
  pendingSince: number
  eventID: string
  recoveringSince: number
  lastStatus: string
}

interface TestState {
  eventID: string
  resolveAt: number
}

interface MuteState {
  until: number | null
  session: boolean
}

interface MetricDefinition {
  ruleType: AlertRuleType
  source: AlertSource
  severity: AlertSeverity
  title: string
  unit: '%' | 'ms'
  threshold: number
  durationSeconds: number
  enabled: boolean
  value: number | null
  description: (serverName: string, current: number, threshold: number) => string
  recoveryTitle: string
  recoveryMessage: (serverName: string, current: number) => string
}

export class AlertEvaluator {
  private settings: AlertSettings
  private ruleStates = new Map<string, RuleState>()
  private offlineStates = new Map<number, OfflineState>()
  private expectedDisconnects = new Map<number, number>()
  private mutedServers = new Map<number, MuteState>()
  private testStates = new Map<string, TestState>()
  private activeEvents = new Map<string, AlertEvent>()
  private nextEventID = 1

  constructor(settings?: AlertSettings | null) {
    this.settings = normalizeAlertSettings(settings)
  }

  configure(settings?: AlertSettings | null) {
    const wasEnabled = this.settings.enabled
    this.settings = normalizeAlertSettings(settings)
    if (wasEnabled && !this.settings.enabled) {
      this.clearAllCycles()
    }
  }

  markExpectedDisconnect(serverID: number, now = Date.now(), ttlMs = 30000) {
    if (!Number.isInteger(serverID) || serverID <= 0) return
    this.expectedDisconnects.set(serverID, now + ttlMs)
    const offline = this.offlineStates.get(serverID) ?? {
      everConnected: false,
      pendingSince: 0,
      eventID: '',
      recoveringSince: 0,
      lastStatus: '',
    }
    this.offlineStates.set(serverID, offline)
    offline.everConnected = false
    if (!offline.eventID) {
      offline.pendingSince = 0
      offline.recoveringSince = 0
    }
  }

  deleteServer(serverID: number) {
    for (const key of Array.from(this.ruleStates.keys())) {
      if (key.startsWith(`${serverID}:`)) this.ruleStates.delete(key)
    }
    for (const [eventID, event] of Array.from(this.activeEvents.entries())) {
      if (event.serverID === serverID) this.activeEvents.delete(eventID)
    }
    this.offlineStates.delete(serverID)
    this.expectedDisconnects.delete(serverID)
    this.mutedServers.delete(serverID)
  }

  muteServer(serverID: number, mode: '30m' | '2h' | 'session', now = Date.now()) {
    if (mode === 'session') this.mutedServers.set(serverID, { until: null, session: true })
    else this.mutedServers.set(serverID, { until: now + (mode === '30m' ? 30 : 120) * 60 * 1000, session: false })
  }

  unmuteServer(serverID: number) {
    this.mutedServers.delete(serverID)
  }

  isMuted(serverID: number, now = Date.now()) {
    const muted = this.mutedServers.get(serverID)
    if (!muted) return false
    if (muted.session) return true
    if (muted.until !== null && muted.until > now) return true
    this.mutedServers.delete(serverID)
    return false
  }

  ingestSnapshot(snapshot: MonitorSnapshot, connection: Connection | null | undefined, now = Date.now()): AlertNotification[] {
    if (!this.settings.enabled) return []
    if (snapshot.status !== 'online') return []
    const serverName = serverDisplayName(connection, snapshot.connectionId)
    const sampleAt = Date.parse(snapshot.timestamp)
    if (!Number.isFinite(sampleAt)) return []
    const maxIntervalMs = Math.max(2, connection?.refreshInterval ?? 2) * 2 * 1000 + 1000
    if (now - sampleAt > maxIntervalMs) return []
    return metricDefinitions(snapshot, this.settings).flatMap((definition) =>
      this.evaluateMetric(snapshot.connectionId, serverName, definition, sampleAt, maxIntervalMs, now),
    )
  }

  ingestConnectionState(state: ConnectionRuntimeState, connection: Connection | null | undefined, now = Date.now()): AlertNotification[] {
    this.pruneExpectedDisconnects(now)
    const serverName = serverDisplayName(connection, state.connectionId)
    const offline = this.offlineStates.get(state.connectionId) ?? {
      everConnected: false,
      pendingSince: 0,
      eventID: '',
      recoveringSince: 0,
      lastStatus: '',
    }
    this.offlineStates.set(state.connectionId, offline)
    offline.lastStatus = state.status

    const online = isOnlineStatus(state.status)
    if (online) {
      offline.everConnected = true
      offline.pendingSince = 0
      if (offline.eventID) {
        if (!offline.recoveringSince) offline.recoveringSince = now
        if (now - offline.recoveringSince >= 10000) {
          const event = this.resolvedEvent(offline.eventID, {
            title: '服务器连接已恢复',
            message: `服务器「${serverName}」已恢复连接。`,
            resolvedAt: iso(now),
          })
          offline.eventID = ''
          offline.recoveringSince = 0
          return event && this.settings.notifyRecovery ? [this.notification(event, 'resolved', now)] : []
        }
      }
      return []
    }

    offline.recoveringSince = 0
    if (!this.settings.enabled || !this.settings.offline.enabled || !offline.everConnected) return []
    if (this.isExpectedDisconnect(state.connectionId, now)) {
      offline.pendingSince = 0
      return []
    }
    if (offline.eventID) return []
    if (!offline.pendingSince) offline.pendingSince = now
    if (now - offline.pendingSince < this.settings.offline.graceSeconds * 1000) return []

    const event = this.newEvent({
      serverID: state.connectionId,
      serverName,
      ruleType: 'server_offline',
      severity: 'critical',
      source: 'connection',
      title: '服务器连接已中断',
      message: `服务器「${serverName}」连接已中断。`,
      startedAt: iso(now),
      read: false,
      muted: false,
    }, now)
    offline.eventID = event.eventID
    return [this.notification(event, 'firing', now)]
  }

  tick(
    now: number,
    states: Record<number, ConnectionRuntimeState>,
    connections: Connection[],
  ): AlertNotification[] {
    this.pruneExpectedDisconnects(now)
    const byID = new Map(connections.map((connection) => [connection.id, connection]))
    const notifications: AlertNotification[] = []
    for (const state of Object.values(states)) {
      const current = this.ingestConnectionState(state, byID.get(state.connectionId), now)
      notifications.push(...current)
    }
    for (const [eventID, test] of Array.from(this.testStates.entries())) {
      if (now < test.resolveAt) continue
      const event = this.resolvedEvent(eventID, {
        title: '测试告警已恢复',
        message: '测试告警已自动恢复。',
        resolvedAt: iso(now),
      })
      this.testStates.delete(eventID)
      if (event && this.settings.notifyRecovery) notifications.push(this.notification(event, 'resolved', now))
    }
    return notifications
  }

  createTestAlert(now = Date.now()): AlertNotification {
    const event = this.newEvent({
      serverID: 0,
      serverName: 'ServerPilot',
      ruleType: 'test',
      severity: 'warning',
      source: 'test',
      title: '测试告警',
      message: '这是一条 ServerPilot 应用内测试告警。',
      startedAt: iso(now),
      read: false,
      muted: false,
    }, now)
    this.testStates.set(event.eventID, { eventID: event.eventID, resolveAt: now + 5000 })
    return this.notification(event, 'firing', now)
  }

  private evaluateMetric(
    serverID: number,
    serverName: string,
    definition: MetricDefinition,
    sampleAt: number,
    maxIntervalMs: number,
    now: number,
  ): AlertNotification[] {
    if (!definition.enabled || definition.value === null) return []
    const key = `${serverID}:${definition.ruleType}`
    const state = this.ruleStates.get(key) ?? {
      phase: 'inactive' as const,
      pendingSince: 0,
      recoveringSince: 0,
      eventID: '',
      lastSampleAt: 0,
    }
    this.ruleStates.set(key, state)

    if (state.lastSampleAt && (sampleAt < state.lastSampleAt || sampleAt - state.lastSampleAt > maxIntervalMs)) {
      if (state.phase !== 'firing') {
        state.phase = 'inactive'
        state.pendingSince = 0
      }
      state.recoveringSince = 0
    }
    if (state.lastSampleAt === sampleAt) return []
    state.lastSampleAt = sampleAt

    const trigger = definition.value >= definition.threshold
    const recoveryThreshold = definition.ruleType === 'latency_high'
      ? definition.threshold - 50
      : definition.threshold - 5
    const healthy = definition.value <= recoveryThreshold

    if (state.phase === 'firing' || state.phase === 'recovering') {
      if (!healthy) {
        state.phase = 'firing'
        state.recoveringSince = 0
        return []
      }
      if (!state.recoveringSince) state.recoveringSince = sampleAt
      state.phase = 'recovering'
      if (sampleAt - state.recoveringSince < 20000) return []
      const event = this.resolvedEvent(state.eventID, {
        title: definition.recoveryTitle,
        message: definition.recoveryMessage(serverName, definition.value),
        currentValue: rounded(definition.value),
        resolvedAt: iso(now),
      })
      state.phase = 'inactive'
      state.pendingSince = 0
      state.recoveringSince = 0
      state.eventID = ''
      return event && this.settings.notifyRecovery ? [this.notification(event, 'resolved', now)] : []
    }

    if (!trigger) {
      state.phase = 'inactive'
      state.pendingSince = 0
      return []
    }
    if (state.phase !== 'pending') {
      state.phase = 'pending'
      state.pendingSince = sampleAt
      return []
    }
    if (sampleAt - state.pendingSince < definition.durationSeconds * 1000) return []

    const event = this.newEvent({
      serverID,
      serverName,
      ruleType: definition.ruleType,
      severity: definition.severity,
      source: definition.source,
      title: definition.title,
      message: definition.description(serverName, definition.value, definition.threshold),
      currentValue: rounded(definition.value),
      threshold: definition.threshold,
      unit: definition.unit,
      startedAt: iso(now),
      read: false,
      muted: false,
    }, now)
    state.phase = 'firing'
    state.eventID = event.eventID
    state.recoveringSince = 0
    return [this.notification(event, 'firing', now)]
  }

  private newEvent(base: Omit<AlertEvent, 'eventID' | 'state'>, now: number): AlertEvent {
    const muted = base.serverID > 0 && this.isMuted(base.serverID, now)
    const event: AlertEvent = {
      ...base,
      eventID: `alert-${this.nextEventID++}`,
      state: 'firing',
      muted,
      read: muted ? true : base.read,
    }
    this.activeEvents.set(event.eventID, event)
    return event
  }

  private resolvedEvent(eventID: string, patch: Partial<AlertEvent>): AlertEvent | null {
    if (!eventID) return null
    const active = this.activeEvents.get(eventID)
    if (!active) return null
    const event: AlertEvent = {
      ...active,
      state: 'resolved',
      read: active.muted ? true : false,
      ...patch,
    }
    this.activeEvents.delete(eventID)
    return event
  }

  private notification(event: AlertEvent, kind: 'firing' | 'resolved', now: number): AlertNotification {
    const muted = event.serverID > 0 && this.isMuted(event.serverID, now)
    return {
      kind,
      event: {
        ...event,
        muted,
        read: muted ? true : event.read,
      },
    }
  }

  private isExpectedDisconnect(serverID: number, now: number) {
    const until = this.expectedDisconnects.get(serverID)
    if (!until) return false
    if (until > now) return true
    this.expectedDisconnects.delete(serverID)
    return false
  }

  private pruneExpectedDisconnects(now: number) {
    for (const [serverID, until] of this.expectedDisconnects.entries()) {
      if (until <= now) this.expectedDisconnects.delete(serverID)
    }
  }

  private clearAllCycles() {
    for (const state of this.ruleStates.values()) {
      state.phase = 'inactive'
      state.pendingSince = 0
      state.recoveringSince = 0
      state.eventID = ''
    }
    for (const state of this.offlineStates.values()) {
      state.pendingSince = 0
      state.recoveringSince = 0
      state.eventID = ''
    }
    this.activeEvents.clear()
  }
}

function metricDefinitions(snapshot: MonitorSnapshot, settings: AlertSettings): MetricDefinition[] {
  const root = snapshot.mounts.find((mount) => mount.mountPath === '/')
  return [
    {
      ruleType: 'cpu_high',
      source: 'monitor',
      severity: 'warning',
      title: 'CPU 使用率过高',
      unit: '%',
      threshold: settings.cpu.threshold,
      durationSeconds: settings.cpu.durationSeconds,
      enabled: settings.cpu.enabled,
      value: finitePercent(snapshot.cpuPercent),
      description: (serverName, current, threshold) =>
        `服务器「${serverName}」CPU 已持续达到 ${formatNumber(current)}%，告警阈值为 ${formatNumber(threshold)}%。`,
      recoveryTitle: 'CPU 使用率已恢复',
      recoveryMessage: (serverName, current) => `服务器「${serverName}」CPU 已恢复到 ${formatNumber(current)}%。`,
    },
    {
      ruleType: 'memory_high',
      source: 'monitor',
      severity: 'warning',
      title: '内存使用率过高',
      unit: '%',
      threshold: settings.memory.threshold,
      durationSeconds: settings.memory.durationSeconds,
      enabled: settings.memory.enabled,
      value: finitePercent(snapshot.memoryUsedPercent),
      description: (serverName, current, threshold) =>
        `服务器「${serverName}」内存已持续达到 ${formatNumber(current)}%，告警阈值为 ${formatNumber(threshold)}%。`,
      recoveryTitle: '内存使用率已恢复',
      recoveryMessage: (serverName, current) => `服务器「${serverName}」内存已恢复到 ${formatNumber(current)}%。`,
    },
    {
      ruleType: 'root_disk_high',
      source: 'monitor',
      severity: 'critical',
      title: '根分区空间不足',
      unit: '%',
      threshold: settings.rootDisk.threshold,
      durationSeconds: settings.rootDisk.durationSeconds,
      enabled: settings.rootDisk.enabled,
      value: finitePercent(root?.usedPercent),
      description: (serverName, current, threshold) =>
        `服务器「${serverName}」根分区已使用 ${formatNumber(current)}%，告警阈值为 ${formatNumber(threshold)}%。`,
      recoveryTitle: '根分区使用率已恢复',
      recoveryMessage: (serverName, current) => `服务器「${serverName}」根分区已恢复到 ${formatNumber(current)}%。`,
    },
    {
      ruleType: 'latency_high',
      source: 'monitor',
      severity: 'warning',
      title: '网络延迟过高',
      unit: 'ms',
      threshold: settings.latency.threshold,
      durationSeconds: settings.latency.durationSeconds,
      enabled: settings.latency.enabled && snapshot.latencyAvailable,
      value: snapshot.latencyAvailable ? finiteNumber(snapshot.latencyMillis, 0, Number.POSITIVE_INFINITY) : null,
      description: (serverName, current, threshold) =>
        `服务器「${serverName}」延迟已持续达到 ${formatNumber(current)} ms，告警阈值为 ${formatNumber(threshold)} ms。`,
      recoveryTitle: '网络延迟已恢复',
      recoveryMessage: (serverName, current) => `服务器「${serverName}」延迟已恢复到 ${formatNumber(current)} ms。`,
    },
  ]
}

function finitePercent(value: number | null | undefined) {
  return finiteNumber(value, 0, 100)
}

function finiteNumber(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null
  return value
}

function rounded(value: number) {
  return Math.round(value * 10) / 10
}

export function formatNumber(value: number) {
  return rounded(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

function iso(now: number) {
  return new Date(now).toISOString()
}

function serverDisplayName(connection: Connection | null | undefined, fallbackID: number) {
  const name = connection?.name?.trim()
  return name || (fallbackID > 0 ? `服务器 ${fallbackID}` : '未命名服务器')
}

function isOnlineStatus(status: string) {
  return status === 'online' || status === 'connected'
}
