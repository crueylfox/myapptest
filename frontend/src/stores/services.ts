import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import type {
  ServiceJournalCompletedEvent,
  ServiceJournalErrorEvent,
  ServiceJournalLine,
  ServiceJournalLineEvent,
  ServiceJournalPriority,
  ServiceJournalStateEvent,
  ServiceManagerCapability,
  SystemServiceActionResponse,
  SystemServiceDetail,
  SystemServiceJournalRequest,
  SystemServiceJournalResponse,
  SystemServiceListResponse,
  SystemServiceSummary,
} from '../types'

const MAX_JOURNAL_LINES = 5000
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024

export const useServiceManagerStore = defineStore('services', () => {
  const capabilityByServerId = ref<Record<number, ServiceManagerCapability>>({})
  const servicesByServerId = ref<Record<number, SystemServiceSummary[]>>({})
  const detailsByKey = ref<Record<string, SystemServiceDetail>>({})
  const listLoadedByServerId = ref<Record<number, boolean>>({})
  const listErrorByServerId = ref<Record<number, string>>({})
  const journalLinesByKey = ref<Record<string, ServiceJournalLine[]>>({})
  const journalOverflowByKey = ref<Record<string, boolean>>({})
  const journalStatusByKey = ref<Record<string, string>>({})
  const journalErrorByKey = ref<Record<string, string>>({})
  const activeJournalWatchesByKey = ref<Record<string, string>>({})
  let subscribed = false

  const serverIDsWithServices = computed(() => Object.keys(servicesByServerId.value).map(Number))

  function capability(serverID: number | null | undefined) {
    if (!serverID) return null
    return capabilityByServerId.value[serverID] ?? null
  }

  function services(serverID: number | null | undefined) {
    if (!serverID) return []
    return servicesByServerId.value[serverID] ?? []
  }

  function detail(serverID: number | null | undefined, unitName: string | null | undefined) {
    if (!serverID || !unitName) return null
    return detailsByKey.value[serviceKey(serverID, unitName)] ?? null
  }

  function hasLoadedList(serverID: number | null | undefined) {
    return Boolean(serverID && listLoadedByServerId.value[serverID])
  }

  function listError(serverID: number | null | undefined) {
    if (!serverID) return ''
    return listErrorByServerId.value[serverID] ?? ''
  }

  function journalLines(serverID: number | null | undefined, unitName: string | null | undefined) {
    if (!serverID || !unitName) return []
    return journalLinesByKey.value[serviceKey(serverID, unitName)] ?? []
  }

  function journalStatus(serverID: number | null | undefined, unitName: string | null | undefined) {
    if (!serverID || !unitName) return 'idle'
    return journalStatusByKey.value[serviceKey(serverID, unitName)] ?? 'idle'
  }

  function journalError(serverID: number | null | undefined, unitName: string | null | undefined) {
    if (!serverID || !unitName) return ''
    return journalErrorByKey.value[serviceKey(serverID, unitName)] ?? ''
  }

  function journalOverflow(serverID: number | null | undefined, unitName: string | null | undefined) {
    if (!serverID || !unitName) return false
    return journalOverflowByKey.value[serviceKey(serverID, unitName)] === true
  }

  function isFollowingJournal(serverID: number | null | undefined, unitName: string | null | undefined) {
    if (!serverID || !unitName) return false
    return Boolean(activeJournalWatchesByKey.value[serviceKey(serverID, unitName)])
  }

  async function check(serverID: number) {
    const value = normalizeCapability(await api.checkServiceManager(serverID), serverID)
    capabilityByServerId.value = { ...capabilityByServerId.value, [serverID]: value }
    return value
  }

  async function refresh(serverID: number) {
    try {
      const response = normalizeListResponse(await api.listSystemServices(serverID), serverID)
      servicesByServerId.value = { ...servicesByServerId.value, [serverID]: response.services }
      listLoadedByServerId.value = { ...listLoadedByServerId.value, [serverID]: true }
      const errors = { ...listErrorByServerId.value }
      delete errors[serverID]
      listErrorByServerId.value = errors
      pruneDetails(serverID, response.services.map((service) => service.unitName))
      return response
    } catch (reason) {
      setListError(serverID, errorMessage(reason, '读取系统服务列表失败。'))
      throw reason
    }
  }

  async function loadDetail(serverID: number, unitName: string, serviceID = unitName) {
    const value = normalizeDetail(await api.getSystemServiceDetail(serverID, unitName, serviceID), serverID, unitName)
    detailsByKey.value = { ...detailsByKey.value, [serviceKey(serverID, value.unitName)]: value }
    return value
  }

  async function start(serverID: number, unitName: string, serviceID = unitName) {
    return runAction(serverID, unitName, serviceID, () => api.startSystemService(serverID, unitName, serviceID))
  }

  async function stop(serverID: number, unitName: string, serviceID = unitName) {
    return runAction(serverID, unitName, serviceID, () => api.stopSystemService(serverID, unitName, serviceID))
  }

  async function restart(serverID: number, unitName: string, serviceID = unitName) {
    return runAction(serverID, unitName, serviceID, () => api.restartSystemService(serverID, unitName, serviceID))
  }

  async function enable(serverID: number, unitName: string, serviceID = unitName) {
    return runAction(serverID, unitName, serviceID, () => api.enableSystemService(serverID, unitName, serviceID))
  }

  async function disable(serverID: number, unitName: string, serviceID = unitName) {
    return runAction(serverID, unitName, serviceID, () => api.disableSystemService(serverID, unitName, serviceID))
  }

  async function runAction(
    serverID: number,
    unitName: string,
    serviceID: string,
    task: () => Promise<SystemServiceActionResponse>,
  ) {
    const response = await task()
    await refresh(serverID)
    await loadDetail(serverID, unitName, serviceID).catch(() => undefined)
    return response
  }

  async function cancelQueries(serverID: number) {
    if (!serverID) return
    await api.cancelSystemServiceRequests(serverID)
  }

  async function loadJournal(request: SystemServiceJournalRequest) {
    const normalized = normalizeJournalRequest(request)
    setJournalStatus(normalized.serverID, normalized.unitName, 'loading')
    try {
      const response = normalizeJournalResponse(await api.getSystemServiceJournal(normalized), normalized)
      setJournalLines(response.serverID, response.unitName, response.lines)
      setJournalStatus(response.serverID, response.unitName, 'idle')
      clearJournalError(response.serverID, response.unitName)
      return response
    } catch (reason) {
      setJournalStatus(normalized.serverID, normalized.unitName, 'error')
      setJournalError(normalized.serverID, normalized.unitName, errorMessage(reason, '读取系统服务日志失败。'))
      throw reason
    }
  }

  async function startJournalFollow(request: SystemServiceJournalRequest) {
    const normalized = normalizeJournalRequest(request)
    await stopJournalFollow(normalized.serverID, normalized.unitName)
    setJournalStatus(normalized.serverID, normalized.unitName, 'connecting')
    try {
      const response = await api.startSystemServiceJournalFollow(normalized)
      if (!response?.watchID) throw new Error('实时日志启动失败。')
      activeJournalWatchesByKey.value = {
        ...activeJournalWatchesByKey.value,
        [serviceKey(normalized.serverID, normalized.unitName)]: response.watchID,
      }
      setJournalStatus(normalized.serverID, normalized.unitName, 'running')
      clearJournalError(normalized.serverID, normalized.unitName)
      return response.watchID
    } catch (reason) {
      setJournalStatus(normalized.serverID, normalized.unitName, 'error')
      setJournalError(normalized.serverID, normalized.unitName, errorMessage(reason, '启动系统服务实时日志失败。'))
      throw reason
    }
  }

  async function stopJournalFollow(serverID: number, unitName: string) {
    const key = serviceKey(serverID, unitName)
    const watchID = activeJournalWatchesByKey.value[key]
    if (!watchID) return
    await api.stopSystemServiceJournalFollow(serverID, watchID).catch(() => undefined)
    removeJournalWatch(key)
    setJournalStatus(serverID, unitName, 'idle')
  }

  async function stopServerJournalRuntime(serverID: number) {
    const operations: Promise<unknown>[] = []
    for (const [key, watchID] of Object.entries(activeJournalWatchesByKey.value)) {
      if (keyServerID(key) === serverID) operations.push(api.stopSystemServiceJournalFollow(serverID, watchID).catch(() => undefined))
    }
    await Promise.allSettled(operations)
    clearServerJournalRuntime(serverID)
  }

  function clearJournal(serverID: number, unitName: string) {
    const key = serviceKey(serverID, unitName)
    journalLinesByKey.value = { ...journalLinesByKey.value, [key]: [] }
    const overflow = { ...journalOverflowByKey.value }
    delete overflow[key]
    journalOverflowByKey.value = overflow
  }

  function clearServer(serverID: number) {
    const capabilities = { ...capabilityByServerId.value }
    const services = { ...servicesByServerId.value }
    const loaded = { ...listLoadedByServerId.value }
    const errors = { ...listErrorByServerId.value }
    delete capabilities[serverID]
    delete services[serverID]
    delete loaded[serverID]
    delete errors[serverID]
    capabilityByServerId.value = capabilities
    servicesByServerId.value = services
    listLoadedByServerId.value = loaded
    listErrorByServerId.value = errors
    detailsByKey.value = Object.fromEntries(
      Object.entries(detailsByKey.value).filter(([key]) => !key.startsWith(`${serverID}:`)),
    )
    clearServerJournalRuntime(serverID)
  }

  function setListError(serverID: number, message: string) {
    if (!serverID) return
    listErrorByServerId.value = { ...listErrorByServerId.value, [serverID]: message }
  }

  function pruneDetails(serverID: number, unitNames: string[]) {
    const existing = new Set(unitNames)
    detailsByKey.value = Object.fromEntries(
      Object.entries(detailsByKey.value).filter(([key]) => {
        if (!key.startsWith(`${serverID}:`)) return true
        return existing.has(key.slice(String(serverID).length + 1))
      }),
    )
  }

  function acceptJournalState(value: unknown) {
    if (!isRecord(value)) return
    const event = value as Partial<ServiceJournalStateEvent>
    const serverID = safeInteger(event.serverID)
    const unitName = safeString(event.unitName)
    if (!serverID || !unitName || !isCurrentJournalWatch(serverID, unitName, safeString(event.watchID))) return
    setJournalStatus(serverID, unitName, safeString(event.state) || 'idle')
  }

  function acceptJournalLine(value: unknown) {
    if (!isRecord(value)) return
    const event = value as Partial<ServiceJournalLineEvent>
    const serverID = safeInteger(event.serverID)
    const unitName = safeString(event.unitName)
    const watchID = safeString(event.watchID)
    if (!serverID || !unitName || !isCurrentJournalWatch(serverID, unitName, watchID)) return
    const line = normalizeJournalLine(event.line, safeInteger(event.sequence))
    if (!line) return
    appendJournalLine(serverID, unitName, line)
  }

  function acceptJournalError(value: unknown) {
    if (!isRecord(value)) return
    const event = value as Partial<ServiceJournalErrorEvent>
    const serverID = safeInteger(event.serverID)
    const unitName = safeString(event.unitName)
    const watchID = safeString(event.watchID)
    if (!serverID || !unitName || !isCurrentJournalWatch(serverID, unitName, watchID)) return
    setJournalError(serverID, unitName, safeString(event.message) || '读取系统服务日志失败。')
    setJournalStatus(serverID, unitName, 'error')
  }

  function acceptJournalCompleted(value: unknown) {
    if (!isRecord(value)) return
    const event = value as Partial<ServiceJournalCompletedEvent>
    const serverID = safeInteger(event.serverID)
    const unitName = safeString(event.unitName)
    const watchID = safeString(event.watchID)
    if (!serverID || !unitName || !isCurrentJournalWatch(serverID, unitName, watchID)) return
    removeJournalWatch(serviceKey(serverID, unitName))
    setJournalStatus(serverID, unitName, 'idle')
  }

  function setJournalLines(serverID: number, unitName: string, lines: ServiceJournalLine[]) {
    const key = serviceKey(serverID, unitName)
    const trimmed = trimJournalLines(lines)
    journalLinesByKey.value = { ...journalLinesByKey.value, [key]: trimmed.lines }
    journalOverflowByKey.value = { ...journalOverflowByKey.value, [key]: trimmed.overflow }
  }

  function appendJournalLine(serverID: number, unitName: string, line: ServiceJournalLine) {
    const key = serviceKey(serverID, unitName)
    const existing = journalLinesByKey.value[key] ?? []
    const trimmed = trimJournalLines([...existing, line])
    journalLinesByKey.value = { ...journalLinesByKey.value, [key]: trimmed.lines }
    journalOverflowByKey.value = { ...journalOverflowByKey.value, [key]: trimmed.overflow || journalOverflowByKey.value[key] === true }
  }

  function setJournalStatus(serverID: number, unitName: string, status: string) {
    journalStatusByKey.value = { ...journalStatusByKey.value, [serviceKey(serverID, unitName)]: status }
  }

  function setJournalError(serverID: number, unitName: string, message: string) {
    journalErrorByKey.value = { ...journalErrorByKey.value, [serviceKey(serverID, unitName)]: message }
  }

  function clearJournalError(serverID: number, unitName: string) {
    const key = serviceKey(serverID, unitName)
    const errors = { ...journalErrorByKey.value }
    delete errors[key]
    journalErrorByKey.value = errors
  }

  function removeJournalWatch(key: string) {
    const watches = { ...activeJournalWatchesByKey.value }
    delete watches[key]
    activeJournalWatchesByKey.value = watches
  }

  function isCurrentJournalWatch(serverID: number, unitName: string, watchID: string) {
    const current = activeJournalWatchesByKey.value[serviceKey(serverID, unitName)]
    return Boolean(watchID && current && current === watchID)
  }

  function clearServerJournalRuntime(serverID: number) {
    const prefix = `${serverID}:`
    journalLinesByKey.value = Object.fromEntries(Object.entries(journalLinesByKey.value).filter(([key]) => !key.startsWith(prefix)))
    journalOverflowByKey.value = Object.fromEntries(Object.entries(journalOverflowByKey.value).filter(([key]) => !key.startsWith(prefix)))
    journalStatusByKey.value = Object.fromEntries(Object.entries(journalStatusByKey.value).filter(([key]) => !key.startsWith(prefix)))
    journalErrorByKey.value = Object.fromEntries(Object.entries(journalErrorByKey.value).filter(([key]) => !key.startsWith(prefix)))
    activeJournalWatchesByKey.value = Object.fromEntries(Object.entries(activeJournalWatchesByKey.value).filter(([key]) => !key.startsWith(prefix)))
  }

  function subscribe() {
    if (subscribed) return
    subscribed = true
    EventsOn('servicejournal:state', acceptJournalState)
    EventsOn('servicejournal:line', acceptJournalLine)
    EventsOn('servicejournal:error', acceptJournalError)
    EventsOn('servicejournal:completed', acceptJournalCompleted)
  }

  function unsubscribe() {
    if (!subscribed) return
    subscribed = false
    EventsOff('servicejournal:state')
    EventsOff('servicejournal:line')
    EventsOff('servicejournal:error')
    EventsOff('servicejournal:completed')
  }

  return {
    capabilityByServerId,
    servicesByServerId,
    detailsByKey,
    listLoadedByServerId,
    listErrorByServerId,
    journalLinesByKey,
    journalOverflowByKey,
    journalStatusByKey,
    journalErrorByKey,
    activeJournalWatchesByKey,
    serverIDsWithServices,
    capability,
    services,
    detail,
    hasLoadedList,
    listError,
    journalLines,
    journalStatus,
    journalError,
    journalOverflow,
    isFollowingJournal,
    check,
    refresh,
    loadDetail,
    start,
    stop,
    restart,
    enable,
    disable,
    cancelQueries,
    loadJournal,
    startJournalFollow,
    stopJournalFollow,
    stopServerJournalRuntime,
    clearJournal,
    clearServer,
    subscribe,
    unsubscribe,
  }
})

function normalizeCapability(value: unknown, fallbackServerID: number): ServiceManagerCapability {
  const source = isRecord(value) ? value : {}
  const initSystem = normalizeInitSystem(source.initSystem)
  return {
    serverID: safeInteger(source.serverID, fallbackServerID),
    available: source.available === true,
    initSystem,
    displayName: safeOptionalString(source.displayName),
    systemdVersion: safeOptionalString(source.systemdVersion),
    distributionName: safeOptionalString(source.distributionName),
    distributionVersion: safeOptionalString(source.distributionVersion),
    supportsJournal: initSystem === 'systemd' ? source.supportsJournal !== false : source.supportsJournal === true,
    supportsLiveLogs: initSystem === 'systemd' ? source.supportsLiveLogs !== false : source.supportsLiveLogs === true,
    supportsResourceMetrics: initSystem === 'systemd' ? source.supportsResourceMetrics !== false : source.supportsResourceMetrics === true,
    supportsStart: source.available === true && source.supportsStart !== false,
    supportsStop: source.available === true && source.supportsStop !== false,
    supportsRestart: source.available === true && source.supportsRestart !== false,
    supportsEnable: source.available === true && source.supportsEnable !== false,
    supportsDisable: source.available === true && source.supportsDisable !== false,
    canManage: source.canManage === true,
    requiresPrivilege: source.requiresPrivilege === true,
    error: safeOptionalString(source.error),
  }
}

function normalizeListResponse(value: unknown, fallbackServerID: number): SystemServiceListResponse {
  const source = isRecord(value) ? value : {}
  const serverID = safeInteger(source.serverID, fallbackServerID)
  return {
    serverID,
    services: safeServices(source.services, serverID),
    timestamp: safeString(source.timestamp),
  }
}

function safeServices(value: unknown, fallbackServerID: number): SystemServiceSummary[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeSummary(item, fallbackServerID))
    .filter((item): item is SystemServiceSummary => Boolean(item))
}

function normalizeSummary(value: unknown, fallbackServerID: number): SystemServiceSummary | null {
  if (!isRecord(value)) return null
  const serviceID = safeString(value.serviceID) || safeString(value.unitName)
  const unitName = safeString(value.unitName) || serviceID
  if (!serviceID || !unitName) return null
  return {
    serverID: safeInteger(value.serverID, fallbackServerID),
    initSystem: normalizeInitSystem(value.initSystem),
    serviceID,
    unitName,
    displayName: safeString(value.displayName) || unitName,
    description: safeString(value.description),
    startupState: safeOptionalString(value.startupState),
    loadState: safeString(value.loadState),
    activeState: safeString(value.activeState),
    subState: safeString(value.subState),
    unitFileState: safeString(value.unitFileState),
    activeStateLabel: safeString(value.activeStateLabel) || '未知',
    unitFileStateLabel: safeString(value.unitFileStateLabel) || '未知',
    isActive: value.isActive === true,
    isFailed: value.isFailed === true,
    isEnabled: value.isEnabled === true,
    canStart: value.canStart === true,
    canStop: value.canStop === true,
    canRestart: value.canRestart === true,
    canEnable: value.canEnable === true,
    canDisable: value.canDisable === true,
    critical: value.critical === true,
    protected: value.protected === true,
  }
}

function normalizeDetail(value: unknown, fallbackServerID: number, fallbackUnitName: string): SystemServiceDetail {
  const source = isRecord(value) ? value : {}
  const serviceID = safeString(source.serviceID) || safeString(source.unitName) || fallbackUnitName
  const unitName = safeString(source.unitName) || serviceID
  return {
    serverID: safeInteger(source.serverID, fallbackServerID),
    initSystem: normalizeInitSystem(source.initSystem),
    serviceID,
    unitName,
    displayName: safeOptionalString(source.displayName),
    description: safeString(source.description),
    startupState: safeOptionalString(source.startupState),
    loadState: safeString(source.loadState),
    activeState: safeString(source.activeState),
    subState: safeString(source.subState),
    unitFileState: safeString(source.unitFileState),
    activeStateLabel: safeString(source.activeStateLabel) || '未知',
    unitFileStateLabel: safeString(source.unitFileStateLabel) || '未知',
    mainPID: safeInteger(source.mainPID),
    memoryCurrentBytes: safeOptionalInteger(source.memoryCurrentBytes),
    cpuUsageNSec: safeOptionalInteger(source.cpuUsageNSec),
    tasksCurrent: safeOptionalInteger(source.tasksCurrent),
    restartCount: safeOptionalInteger(source.restartCount),
    fragmentPath: safeOptionalString(source.fragmentPath),
    scriptPath: safeOptionalString(source.scriptPath),
    distributionName: safeOptionalString(source.distributionName),
    distributionVersion: safeOptionalString(source.distributionVersion),
    lastUpdatedAt: safeOptionalString(source.lastUpdatedAt),
    result: safeOptionalString(source.result),
    startedAt: safeOptionalString(source.startedAt),
    exitedAt: safeOptionalString(source.exitedAt),
    partial: source.partial === true,
    warnings: safeStringArray(source.warnings),
    critical: source.critical === true,
    protected: source.protected === true,
  }
}

function normalizeInitSystem(value: unknown) {
  return value === 'openwrt-procd' || value === 'systemd' ? value : 'unsupported'
}

function normalizeJournalRequest(request: SystemServiceJournalRequest): SystemServiceJournalRequest {
  return {
    serverID: safeInteger(request.serverID),
    unitName: safeString(request.unitName),
    lineLimit: [100, 200, 500, 1000].includes(request.lineLimit) ? request.lineLimit : 200,
    priority: normalizeJournalPriority(request.priority),
    currentBootOnly: request.currentBootOnly !== false,
  }
}

function normalizeJournalPriority(value: unknown): ServiceJournalPriority {
  return value === 'error' || value === 'warning' || value === 'info' || value === 'debug'
    ? value
    : 'all'
}

function normalizeJournalResponse(
  value: unknown,
  fallback: SystemServiceJournalRequest,
): SystemServiceJournalResponse {
  const source = isRecord(value) ? value : {}
  return {
    serverID: safeInteger(source.serverID, fallback.serverID),
    unitName: safeString(source.unitName) || fallback.unitName,
    lines: safeJournalLines(source.lines),
    fallback: source.fallback === true,
    timestamp: safeString(source.timestamp),
  }
}

function safeJournalLines(value: unknown): ServiceJournalLine[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => normalizeJournalLine(item, index + 1))
    .filter((item): item is ServiceJournalLine => Boolean(item))
}

function normalizeJournalLine(value: unknown, fallbackSequence = 0): ServiceJournalLine | null {
  if (!isRecord(value)) return null
  const message = safeString(value.message)
  if (!message) return null
  return {
    sequence: safeInteger(value.sequence, fallbackSequence),
    timestamp: safeOptionalString(value.timestamp),
    timestampText: safeOptionalString(value.timestampText),
    priority: safeInteger(value.priority, -1),
    priorityLabel: safeString(value.priorityLabel) || '未知',
    identifier: safeOptionalString(value.identifier),
    pid: safeOptionalString(value.pid),
    message,
    truncated: value.truncated === true,
  }
}

function trimJournalLines(lines: ServiceJournalLine[]) {
  let result = lines.slice(-MAX_JOURNAL_LINES)
  let overflow = result.length < lines.length
  let bytes = journalBufferBytes(result)
  while (result.length > 0 && bytes > MAX_JOURNAL_BYTES) {
    result = result.slice(1)
    overflow = true
    bytes = journalBufferBytes(result)
  }
  return { lines: result, overflow }
}

function journalBufferBytes(lines: ServiceJournalLine[]) {
  return lines.reduce((total, line) => total + line.message.length * 2 + 80, 0)
}

function serviceKey(serverID: number, unitName: string) {
  return `${serverID}:${unitName}`
}

function keyServerID(key: string) {
  const parsed = Number.parseInt(key.split(':', 1)[0], 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function safeOptionalString(value: unknown): string | undefined {
  const text = safeString(value)
  return text ? text : undefined
}

function safeInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function safeOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return safeInteger(value)
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => safeString(item).trim()).filter(Boolean)
  return items.length ? items : undefined
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}
