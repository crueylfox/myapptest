import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import type {
  ListProcessesRequest,
  ProcessDetail,
  ProcessDetailEvent,
  ProcessEntry,
  ProcessErrorEvent,
  ProcessListEvent,
  ProcessSignal,
  ProcessSortBy,
  ProcessSortDir,
  ProcessStateEvent,
} from '../types'

export const useProcessStore = defineStore('processes', () => {
  const processesByServerId = ref<Record<number, ProcessEntry[]>>({})
  const warningsByServerId = ref<Record<number, string[]>>({})
  const listLoadedByServerId = ref<Record<number, boolean>>({})
  const listErrorByServerId = ref<Record<number, string>>({})
  const detailByKey = ref<Record<string, ProcessDetail>>({})
  const activeWatchByServerId = ref<Record<number, string>>({})
  const lastError = ref<ProcessErrorEvent | null>(null)

  const serverIDsWithProcesses = computed(() => Object.keys(processesByServerId.value).map(Number))

  function list(serverID: number | null | undefined) {
    if (!serverID) return []
    return processesByServerId.value[serverID] ?? []
  }

  function warnings(serverID: number | null | undefined) {
    if (!serverID) return []
    return warningsByServerId.value[serverID] ?? []
  }

  function hasLoadedList(serverID: number | null | undefined) {
    return Boolean(serverID && listLoadedByServerId.value[serverID])
  }

  function listError(serverID: number | null | undefined) {
    if (!serverID) return ''
    return listErrorByServerId.value[serverID] ?? ''
  }

  function detail(serverID: number, pid: number) {
    return detailByKey.value[processKey(serverID, pid)] ?? null
  }

  async function refresh(request: ListProcessesRequest) {
    const normalized = normalizeRequest(request)
    try {
      const response = normalizeProcessListResponse(await api.listProcesses(normalized), normalized.serverID)
      processesByServerId.value = { ...processesByServerId.value, [response.serverID]: response.processes }
      warningsByServerId.value = { ...warningsByServerId.value, [response.serverID]: response.warnings }
      listLoadedByServerId.value = { ...listLoadedByServerId.value, [response.serverID]: true }
      const errors = { ...listErrorByServerId.value }
      delete errors[response.serverID]
      listErrorByServerId.value = errors
      return response
    } catch (reason) {
      setListError(normalized.serverID, errorMessage(reason, '读取进程列表失败'))
      throw reason
    }
  }

  async function loadDetail(serverID: number, pid: number) {
    const value = normalizeProcessDetail(await api.getProcessDetail({ serverID, pid }), serverID, pid)
    if (!value) throw new Error('进程详情不可用')
    const merged = mergeDetailWithListEntry(value, processesByServerId.value[serverID]?.find((process) => process.pid === pid))
    detailByKey.value[processKey(serverID, pid)] = merged
    return merged
  }

  function seedDetailFromEntry(serverID: number, entry: ProcessEntry) {
    const normalized = normalizeProcessEntry(entry, serverID)
    if (!normalized) return
    detailByKey.value[processKey(serverID, normalized.pid)] = detailFromEntry(normalized)
  }

  async function signal(serverID: number, pid: number, signalName: ProcessSignal, expectedCommand = '') {
    const response = await api.signalProcess({ serverID, pid, signal: signalName, expectedCommand })
    await refresh({ serverID, sortBy: 'cpu', sortDir: 'desc', limit: 500 })
    return response
  }

  async function startWatch(
    request: ListProcessesRequest & { intervalMs?: number },
  ) {
    const normalized = normalizeRequest(request)
    await stopWatch(normalized.serverID)
    const watchID = await api.startProcessWatch({ ...normalized, intervalMs: request.intervalMs ?? 2000 })
    activeWatchByServerId.value = { ...activeWatchByServerId.value, [normalized.serverID]: watchID }
    return watchID
  }

  async function stopWatch(serverID: number) {
    const watchID = activeWatchByServerId.value[serverID]
    if (!watchID) return
    await api.stopProcessWatch({ serverID, watchID })
    const next = { ...activeWatchByServerId.value }
    delete next[serverID]
    activeWatchByServerId.value = next
  }

  async function stopServerRuntime(serverID: number) {
    await stopWatch(serverID)
    clearServer(serverID)
  }

  function clearServer(serverID: number) {
    const processNext = { ...processesByServerId.value }
    const warningNext = { ...warningsByServerId.value }
    const loadedNext = { ...listLoadedByServerId.value }
    const errorNext = { ...listErrorByServerId.value }
    const watchNext = { ...activeWatchByServerId.value }
    delete processNext[serverID]
    delete warningNext[serverID]
    delete loadedNext[serverID]
    delete errorNext[serverID]
    delete watchNext[serverID]
    processesByServerId.value = processNext
    warningsByServerId.value = warningNext
    listLoadedByServerId.value = loadedNext
    listErrorByServerId.value = errorNext
    activeWatchByServerId.value = watchNext
    detailByKey.value = Object.fromEntries(
      Object.entries(detailByKey.value).filter(([key]) => !key.startsWith(`${serverID}:`)),
    )
  }

  function acceptList(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<ProcessListEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID)) return
    if (event.watchID && activeWatchByServerId.value[serverID] !== event.watchID) return
    processesByServerId.value = { ...processesByServerId.value, [serverID]: safeProcessList(event.processes, serverID) }
    warningsByServerId.value = { ...warningsByServerId.value, [serverID]: safeStringList(event.warnings) }
    listLoadedByServerId.value = { ...listLoadedByServerId.value, [serverID]: true }
    const errors = { ...listErrorByServerId.value }
    delete errors[serverID]
    listErrorByServerId.value = errors
  }

  function acceptDetail(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<ProcessDetailEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID)) return
    if (event.watchID && activeWatchByServerId.value[serverID] !== event.watchID) return
    const detail = normalizeProcessDetail(event.detail, serverID)
    if (!detail) return
    detailByKey.value[processKey(serverID, detail.pid)] = detail
  }

  function acceptState(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<ProcessStateEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID)) return
    if (event.state === 'stopped' && (!event.watchID || activeWatchByServerId.value[serverID] === event.watchID)) {
      const next = { ...activeWatchByServerId.value }
      delete next[serverID]
      activeWatchByServerId.value = next
    }
  }

  function acceptError(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<ProcessErrorEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID)) return
    if (event.watchID && activeWatchByServerId.value[serverID] !== event.watchID) return
    if (isListError(event.code)) setListError(serverID, event.message || '读取进程列表失败')
    lastError.value = event as ProcessErrorEvent
  }

  function setListError(serverID: number, message: string) {
    if (!serverID) return
    listErrorByServerId.value = {
      ...listErrorByServerId.value,
      [serverID]: message || '读取进程列表失败',
    }
  }

  function subscribe() {
    EventsOn('process:list', acceptList)
    EventsOn('process:detail', acceptDetail)
    EventsOn('process:state', acceptState)
    EventsOn('process:error', acceptError)
  }

  function unsubscribe() {
    EventsOff('process:list')
    EventsOff('process:detail')
    EventsOff('process:state')
    EventsOff('process:error')
  }

  return {
    processesByServerId,
    warningsByServerId,
    listLoadedByServerId,
    listErrorByServerId,
    detailByKey,
    activeWatchByServerId,
    lastError,
    serverIDsWithProcesses,
    list,
    warnings,
    hasLoadedList,
    listError,
    detail,
    refresh,
    loadDetail,
    signal,
    seedDetailFromEntry,
    startWatch,
    stopWatch,
    stopServerRuntime,
    clearServer,
    subscribe,
    unsubscribe,
  }
})

function normalizeRequest(request: ListProcessesRequest): ListProcessesRequest {
  return {
    serverID: request.serverID,
    query: request.query ?? '',
    sortBy: normalizeSortBy(request.sortBy),
    sortDir: normalizeSortDir(request.sortDir),
    limit: request.limit ?? 500,
  }
}

function normalizeSortBy(value: ProcessSortBy | string | undefined): ProcessSortBy {
  return value === 'memory' || value === 'pid' || value === 'user' || value === 'command' ? value : 'cpu'
}

function normalizeSortDir(value: ProcessSortDir | string | undefined): ProcessSortDir {
  return value === 'asc' ? 'asc' : 'desc'
}

function processKey(serverID: number, pid: number) {
  return `${serverID}:${pid}`
}

function normalizeProcessListResponse(value: unknown, fallbackServerID: number): {
  serverID: number
  processes: ProcessEntry[]
  warnings: string[]
  parserStrategy?: string
  timestamp: string
} {
  const source = isRecord(value) ? value : {}
  const serverID = safeInteger(source.serverID, fallbackServerID)
  return {
    serverID,
    processes: safeProcessList(source.processes, serverID),
    warnings: safeStringList(source.warnings),
    parserStrategy: safeOptionalString(source.parserStrategy),
    timestamp: safeString(source.timestamp),
  }
}

function safeProcessList(value: unknown, fallbackServerID = 0): ProcessEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeProcessEntry(item, fallbackServerID))
    .filter((item): item is ProcessEntry => Boolean(item))
}

function normalizeProcessEntry(value: unknown, fallbackServerID = 0): ProcessEntry | null {
  if (!isRecord(value)) return null
  const pid = safeInteger(value.pid)
  if (pid <= 0) return null
  const command = safeString(value.command) || commandFromArgs(safeString(value.argsPreview)) || `PID ${pid}`
  return {
    serverID: safeInteger(value.serverID, fallbackServerID),
    pid,
    ppid: safeInteger(value.ppid),
    user: safeString(value.user),
    state: safeString(value.state),
    stateLabel: safeString(value.stateLabel),
    cpuPercent: safeNumber(value.cpuPercent),
    memoryPercent: safeNumber(value.memoryPercent),
    rssBytes: safeNumber(value.rssBytes),
    vszBytes: safeNumber(value.vszBytes),
    command,
    argsPreview: safeString(value.argsPreview),
    startedOrElapsed: safeString(value.startedOrElapsed),
    isKernelThread: value.isKernelThread === true,
    canSignal: value.canSignal === true,
  }
}

function normalizeProcessDetail(value: unknown, fallbackServerID: number, fallbackPID = 0): ProcessDetail | null {
  if (!isRecord(value)) return null
  const pid = safeInteger(value.pid, fallbackPID)
  if (pid <= 0) return null
  const command = safeString(value.command) || commandFromArgs(safeString(value.cmdline)) || `PID ${pid}`
  const parent = normalizeProcessEntry(value.parent, fallbackServerID) ?? undefined
  return {
    serverID: safeInteger(value.serverID, fallbackServerID),
    pid,
    ppid: safeInteger(value.ppid),
    user: safeString(value.user),
    state: safeString(value.state),
    stateLabel: safeString(value.stateLabel),
    command,
    cmdline: safeString(value.cmdline),
    cwd: safeOptionalString(value.cwd),
    exe: safeOptionalString(value.exe),
    openFilesCount: safeOptionalInteger(value.openFilesCount),
    threads: safeOptionalInteger(value.threads),
    rssBytes: safeNumber(value.rssBytes),
    vszBytes: safeNumber(value.vszBytes),
    memoryPercent: safeNumber(value.memoryPercent),
    cpuPercent: safeNumber(value.cpuPercent),
    environmentRedacted: value.environmentRedacted !== false,
    children: safeProcessList(value.children, fallbackServerID),
    parent,
    lastUpdatedAt: safeString(value.lastUpdatedAt),
    warnings: safeStringList(value.warnings),
    isKernelThread: value.isKernelThread === true,
    canSignal: value.canSignal === true,
  }
}

function mergeDetailWithListEntry(detail: ProcessDetail, entry: ProcessEntry | undefined): ProcessDetail {
  if (!entry) return detail
  return {
    ...detail,
    user: detail.user || entry.user,
    state: detail.state || entry.state,
    stateLabel: detail.stateLabel || entry.stateLabel,
    command: detail.command || entry.command,
    cmdline: detail.cmdline || entry.argsPreview,
    rssBytes: detail.rssBytes || entry.rssBytes,
    vszBytes: detail.vszBytes || entry.vszBytes,
    memoryPercent: detail.memoryPercent || entry.memoryPercent,
    cpuPercent: detail.cpuPercent || entry.cpuPercent,
    isKernelThread: detail.isKernelThread || entry.isKernelThread,
    canSignal: detail.canSignal && !entry.isKernelThread,
  }
}

function detailFromEntry(entry: ProcessEntry): ProcessDetail {
  return {
    serverID: entry.serverID,
    pid: entry.pid,
    ppid: entry.ppid,
    user: entry.user,
    state: entry.state,
    stateLabel: entry.stateLabel,
    command: entry.command,
    cmdline: entry.argsPreview,
    rssBytes: entry.rssBytes,
    vszBytes: entry.vszBytes,
    memoryPercent: entry.memoryPercent,
    cpuPercent: entry.cpuPercent,
    environmentRedacted: true,
    children: [],
    lastUpdatedAt: '',
    warnings: [],
    isKernelThread: entry.isKernelThread,
    canSignal: entry.canSignal,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(/%$/, ''))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function safeInteger(value: unknown, fallback = 0): number {
  const parsed = Math.trunc(safeNumber(value, fallback))
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return safeInteger(value)
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function safeOptionalString(value: unknown): string | undefined {
  const text = safeString(value)
  return text ? text : undefined
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(safeString).filter(Boolean)
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

function isListError(code: unknown) {
  const value = safeString(code)
  return value === 'PROCESS_LIST_FAILED' || value === 'PROCESS_WATCH_FAILED' || value === 'PROCESS_CONNECT_FAILED'
}

function commandFromArgs(value: string): string {
  const first = value.trim().split(/\s+/)[0] ?? ''
  const normalized = first.replace(/^"+|"+$/g, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}
