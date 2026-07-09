import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import { hasVisibleTerminalOutput } from '../utils/terminalOutputActivity'
import type {
  AuthRequest,
  Connection,
  ConnectionError,
  ConnectionRuntimeState,
  ServerWorkspace,
  ServerWorkspaceStatus,
  TerminalOutputEvent,
  TerminalSessionInfo,
  TerminalStatusEvent,
} from '../types'

type OutputDeliveryMeta = { replay: boolean }
type OutputListener = (dataBase64: string, meta?: OutputDeliveryMeta) => void
type TerminalActivityState = {
  hasActivity: boolean
  unreadCount: number
  lastActivityAt: number
}
const workspaceOrderStorageKey = 'hostdeck.workspaceTabOrder'
const maxReplayOutputBytes = 1024 * 1024
const maxUnreadActivityCount = 99

function storedWorkspaceOrder(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(workspaceOrderStorageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is number =>
      Number.isInteger(value) && value > 0)
  } catch {
    return []
  }
}

export const useTerminalStore = defineStore('terminals', () => {
  const tabs = ref<TerminalSessionInfo[]>([])
  const activeSessionId = ref<string | null>(null)
  const activeWorkspaceServerId = ref<number | null>(null)
  const workspaces = ref<Record<number, ServerWorkspace>>({})
  const workspaceOrder = ref<number[]>(storedWorkspaceOrder())
  const workspaceHistory = ref<number[]>([])
  const lastActiveTerminalByServer = ref<Record<number, string>>({})
  const lastStatus = ref<TerminalStatusEvent | null>(null)
  const listeners = new Map<string, OutputListener>()
  const pendingOutput = new Map<string, string[]>()
  const replayOutput = new Map<string, { chunks: string[]; bytes: number }>()
  const pendingStatus = new Map<string, TerminalStatusEvent>()
  const outputActivityBySession = ref<Record<string, TerminalActivityState>>({})
  let visibleOutputSessionIds = new Set<string>()

  const activeTab = computed(() =>
    tabs.value.find((tab) => tab.sessionId === activeSessionId.value) ?? null)
  const activeServerId = computed(() => activeWorkspaceServerId.value)
  const activeWorkspace = computed(() =>
    activeWorkspaceServerId.value === null
      ? null
      : workspaces.value[activeWorkspaceServerId.value] ?? null)
  const sessionsByServerId = computed<Record<number, TerminalSessionInfo[]>>(() => {
    const grouped: Record<number, TerminalSessionInfo[]> = {}
    for (const tab of tabs.value) {
      grouped[tab.connectionId] = [...(grouped[tab.connectionId] ?? []), tab]
    }
    return grouped
  })
  const workspaceOnly = computed(() =>
    workspaceOrder.value
      .map((serverId) => workspaces.value[serverId])
      .filter((workspace): workspace is ServerWorkspace =>
        Boolean(workspace) && !sessionsByServerId.value[workspace.serverId]?.length))

  const closedSessionIds = new Map<string, number>()
  const closedSessionOrder: Array<{ sessionId: string; generation: number }> = []
  let closedGeneration = 0

  function now() {
    return new Date().toISOString()
  }

  function defaultWorkspaceMessage(status: ServerWorkspaceStatus) {
    switch (status) {
      case 'connecting':
        return '正在建立 SSH 连接'
      case 'connected':
        return 'SSH 终端已连接'
      case 'reconnecting':
        return '正在重新连接'
      case 'failed':
        return '连接失败'
      case 'disconnected':
        return '连接已断开'
      default:
        return '尚未连接'
    }
  }

  function ensureWorkspace(
    connection: Pick<Connection, 'id' | 'name'>,
    status: ServerWorkspaceStatus = 'offline',
  ) {
    const existing = workspaces.value[connection.id]
    if (existing) {
      existing.serverName = connection.name
      return existing
    }
    const workspace: ServerWorkspace = {
      serverId: connection.id,
      serverName: connection.name,
      status,
      message: defaultWorkspaceMessage(status),
      updatedAt: now(),
    }
    workspaces.value[connection.id] = workspace
    if (!workspaceOrder.value.includes(connection.id)) {
      workspaceOrder.value.push(connection.id)
      persistWorkspaceOrder()
    }
    return workspace
  }

  function persistWorkspaceOrder() {
    localStorage.setItem(
      workspaceOrderStorageKey,
      JSON.stringify(workspaceOrder.value),
    )
  }

  function reorderWorkspace(sourceServerId: number, targetServerId: number, before: boolean) {
    if (sourceServerId === targetServerId) return
    const current = workspaceOrder.value.filter((serverId) => serverId !== sourceServerId)
    const targetIndex = current.indexOf(targetServerId)
    if (targetIndex < 0) return
    current.splice(targetIndex + (before ? 0 : 1), 0, sourceServerId)
    workspaceOrder.value = current
    persistWorkspaceOrder()
  }

  function updateWorkspace(
    serverId: number,
    status: ServerWorkspaceStatus,
    message = defaultWorkspaceMessage(status),
    error?: ConnectionError,
  ) {
    const workspace = workspaces.value[serverId]
    if (!workspace) return
    workspace.status = status
    workspace.message = message
    workspace.error = error
    workspace.updatedAt = now()
  }

  function hasWorkspace(serverId: number) {
    return Boolean(workspaces.value[serverId])
  }

  function terminalForServer(serverId: number) {
    const serverTabs = sessionsByServerId.value[serverId] ?? []
    const recentSessionId = lastActiveTerminalByServer.value[serverId]
    return serverTabs.find((tab) => tab.sessionId === recentSessionId) ?? serverTabs[0]
  }

  function rememberWorkspaceActivation(serverId: number) {
    workspaceHistory.value = [
      ...workspaceHistory.value.filter((candidate) => candidate !== serverId),
      serverId,
    ]
  }

  function activateWorkspaceServer(serverId: number) {
    if (!workspaces.value[serverId]) return null
    activeWorkspaceServerId.value = serverId
    rememberWorkspaceActivation(serverId)
    const tab = terminalForServer(serverId)
    activeSessionId.value = tab?.sessionId ?? null
    if (tab) lastActiveTerminalByServer.value[serverId] = tab.sessionId
    if (tab) clearOutputActivity(tab.sessionId)
    return tab ?? null
  }

  function navigateToServer(connection: Connection) {
    ensureWorkspace(connection)
    return activateWorkspaceServer(connection.id)
  }

  function clearActiveWorkspace() {
    activeWorkspaceServerId.value = null
    activeSessionId.value = null
  }

  function failedTerminalForServer(serverId: number) {
    return tabs.value.find(
      (tab) => tab.connectionId === serverId && tab.status === 'error',
    )
  }

  function runtimeWorkspaceStatus(
    serverId: number,
    state?: ConnectionRuntimeState,
  ): ServerWorkspaceStatus {
    if (failedTerminalForServer(serverId)) return 'failed'
    if (state?.terminalConnecting) return 'connecting'
    if (state?.terminalActive) return 'connected'
    if (state?.status === 'reconnecting') return 'reconnecting'
    if (state?.lastError) return 'failed'
    if (state?.status === 'disconnected') return 'disconnected'
    return 'offline'
  }

  function syncConnectionState(
    connection: Connection,
    state?: ConnectionRuntimeState,
  ) {
    const workspace = workspaces.value[connection.id]
    if (!workspace) return
    workspace.serverName = connection.name
    for (const tab of tabs.value) {
      if (tab.connectionId === connection.id) tab.title = connection.name
    }
    if (
      workspace.status === 'failed' &&
      !failedTerminalForServer(connection.id) &&
      !state?.lastError &&
      !state?.terminalActive &&
      !state?.terminalConnecting
    ) {
      return
    }
    const status = runtimeWorkspaceStatus(connection.id, state)
    const error = failedTerminalForServer(connection.id)?.connectionError ?? state?.lastError
    const message = status === 'failed'
      ? error?.userMessage || defaultWorkspaceMessage(status)
      : defaultWorkspaceMessage(status)
    updateWorkspace(connection.id, status, message, error)
  }

  function markConnecting(connection: Connection, reconnecting = false) {
    ensureWorkspace(connection)
    updateWorkspace(connection.id, reconnecting ? 'reconnecting' : 'connecting')
  }

  function fallbackConnectionError(serverId: number, reason: unknown): ConnectionError {
    const detail = String(reason).replace(/^Error:\s*/i, '').trim()
    const message = detail || 'SSH 连接失败'
    return {
      code: 'UNKNOWN',
      userMessage: message,
      technicalMessage: message,
      retryable: true,
      serverId,
      operation: 'terminal.open',
      timestamp: now(),
    }
  }

  function markFailed(
    connection: Pick<Connection, 'id' | 'name'>,
    reason: unknown,
    connectionError?: ConnectionError,
  ) {
    ensureWorkspace(connection)
    const error = connectionError ?? fallbackConnectionError(connection.id, reason)
    updateWorkspace(connection.id, 'failed', error.userMessage, error)
  }

  function rememberClosedSession(sessionId: string) {
    const generation = ++closedGeneration
    closedSessionIds.set(sessionId, generation)
    closedSessionOrder.push({ sessionId, generation })
    while (closedSessionOrder.length > 1024) {
      const expired = closedSessionOrder.shift()
      if (expired && closedSessionIds.get(expired.sessionId) === expired.generation) {
        closedSessionIds.delete(expired.sessionId)
      }
    }
  }

  async function open(connection: Connection, auth: AuthRequest, columns = 100, rows = 30) {
    markConnecting(connection)
    if (activeWorkspaceServerId.value !== connection.id) {
      activeSessionId.value = null
    }
    activeWorkspaceServerId.value = connection.id
    rememberWorkspaceActivation(connection.id)
    try {
      const info = await api.openTerminal(connection.id, auth, columns, rows)
      closedSessionIds.delete(info.sessionId)
      info.code = info.code ?? ''
      const status = pendingStatus.get(info.sessionId)
      if (status) {
        info.status = status.status
        info.code = status.code
        info.message = status.message
        info.connectionError = status.connectionError
        pendingStatus.delete(info.sessionId)
      }
      tabs.value.push(info)
      activeSessionId.value = info.sessionId
      activeWorkspaceServerId.value = info.connectionId
      lastActiveTerminalByServer.value[info.connectionId] = info.sessionId
      if (info.status === 'online') {
        updateWorkspace(info.connectionId, 'connected')
      } else if (info.status === 'error') {
        updateWorkspace(
          info.connectionId,
          'failed',
          info.connectionError?.userMessage || info.message,
          info.connectionError,
        )
      }
      return info
    } catch (reason) {
      markFailed(connection, reason)
      throw reason
    }
  }

  function activate(sessionId: string) {
    const tab = tabs.value.find((candidate) => candidate.sessionId === sessionId)
    if (!tab) return
    activeSessionId.value = sessionId
    activeWorkspaceServerId.value = tab.connectionId
    rememberWorkspaceActivation(tab.connectionId)
    lastActiveTerminalByServer.value[tab.connectionId] = sessionId
    clearOutputActivity(sessionId)
  }

  function findByConnection(connectionId: number) {
    return terminalForServer(connectionId) ?? null
  }

  function nextActiveAfterRemoving(sessionIds: Set<string>): string | null {
    const activeIndex = tabs.value.findIndex((tab) => tab.sessionId === activeSessionId.value)
    const activeClosing = activeSessionId.value !== null && sessionIds.has(activeSessionId.value)
    const remaining = tabs.value.filter((tab) => !sessionIds.has(tab.sessionId))
    if (!activeClosing) return activeSessionId.value
    const previous = remaining.filter((tab) => tabs.value.indexOf(tab) < activeIndex)
    return previous[previous.length - 1]?.sessionId ?? remaining[0]?.sessionId ?? null
  }

  function removeSessions(sessionIds: Set<string>) {
    const nextActive = nextActiveAfterRemoving(sessionIds)
    const activeClosing = activeSessionId.value !== null && sessionIds.has(activeSessionId.value)
    const remaining = tabs.value.filter((tab) => !sessionIds.has(tab.sessionId))
    for (const sessionId of sessionIds) {
      rememberClosedSession(sessionId)
      listeners.delete(sessionId)
      pendingOutput.delete(sessionId)
      replayOutput.delete(sessionId)
      pendingStatus.delete(sessionId)
      clearOutputActivity(sessionId)
    }
    tabs.value = remaining
    activeSessionId.value = nextActive
    if (nextActive) {
      const nextTab = remaining.find((tab) => tab.sessionId === nextActive)
      if (nextTab) {
        activeWorkspaceServerId.value = nextTab.connectionId
        rememberWorkspaceActivation(nextTab.connectionId)
        lastActiveTerminalByServer.value[nextTab.connectionId] = nextTab.sessionId
      }
    } else if (activeClosing) {
      activeWorkspaceServerId.value = null
    }
    for (const [serverId, sessionId] of Object.entries(lastActiveTerminalByServer.value)) {
      if (sessionIds.has(sessionId)) delete lastActiveTerminalByServer.value[Number(serverId)]
    }
  }

  function removeWorkspaceShell(serverId: number) {
    workspaceOrder.value = workspaceOrder.value.filter((candidate) => candidate !== serverId)
    persistWorkspaceOrder()
    workspaceHistory.value = workspaceHistory.value.filter((candidate) => candidate !== serverId)
    delete workspaces.value[serverId]
    delete lastActiveTerminalByServer.value[serverId]
    if (activeWorkspaceServerId.value === serverId) clearActiveWorkspace()
  }

  async function closeSession(sessionId: string) {
    const tab = tabs.value.find((candidate) => candidate.sessionId === sessionId)
    if (!tab) {
      await api.closeTerminal(sessionId)
      return
    }
    const previousTabs = tabs.value.slice()
    const previousActiveSessionId = activeSessionId.value
    const previousActiveWorkspaceServerId = activeWorkspaceServerId.value
    const previousLastActiveByServer = { ...lastActiveTerminalByServer.value }
    const previousWorkspaces = { ...workspaces.value }
    const previousWorkspaceOrder = workspaceOrder.value.slice()
    const previousWorkspaceHistory = workspaceHistory.value.slice()
    const previousActivityBySession = { ...outputActivityBySession.value }
    removeSessions(new Set([sessionId]))
    const hasRemainingServerTerminal = tabs.value.some((candidate) => candidate.connectionId === tab.connectionId)
    if (!hasRemainingServerTerminal) {
      removeWorkspaceShell(tab.connectionId)
    }
    try {
      await api.closeTerminal(sessionId)
    } catch (reason) {
      closedSessionIds.delete(sessionId)
      tabs.value = previousTabs
      activeSessionId.value = previousActiveSessionId
      activeWorkspaceServerId.value = previousActiveWorkspaceServerId
      lastActiveTerminalByServer.value = previousLastActiveByServer
      workspaces.value = previousWorkspaces
      workspaceOrder.value = previousWorkspaceOrder
      workspaceHistory.value = previousWorkspaceHistory
      outputActivityBySession.value = previousActivityBySession
      persistWorkspaceOrder()
      throw reason
    }
    if (activeWorkspaceServerId.value === tab.connectionId && hasRemainingServerTerminal) {
      activateWorkspaceServer(tab.connectionId)
    } else if (activeWorkspaceServerId.value === tab.connectionId && !hasRemainingServerTerminal) {
      clearActiveWorkspace()
    }
  }

  function removeWorkspaceLocal(serverId: number) {
    const sessionIds = new Set(
      tabs.value.filter((tab) => tab.connectionId === serverId).map((tab) => tab.sessionId),
    )
    removeSessions(sessionIds)

    const removedIndex = workspaceOrder.value.indexOf(serverId)
    workspaceOrder.value = workspaceOrder.value.filter((candidate) => candidate !== serverId)
    persistWorkspaceOrder()
    workspaceHistory.value = workspaceHistory.value.filter(
      (candidate) => candidate !== serverId,
    )
    delete workspaces.value[serverId]
    delete lastActiveTerminalByServer.value[serverId]

    if (activeWorkspaceServerId.value !== serverId) return
    const nextIndex = Math.min(
      Math.max(removedIndex, 0),
      workspaceOrder.value.length - 1,
    )
    const nextServerId = workspaceOrder.value[nextIndex]
    if (nextServerId === undefined) {
      clearActiveWorkspace()
      return
    }
    activateWorkspaceServer(nextServerId)
  }

  async function disconnectServer(connectionId: number, closeWorkspace = true) {
    const previousWorkspaceServerId = activeWorkspaceServerId.value
    const previousSessionId = activeSessionId.value
    if (closeWorkspace && activeWorkspaceServerId.value === connectionId) {
      const removedIndex = workspaceOrder.value.indexOf(connectionId)
      const remaining = workspaceOrder.value.filter((candidate) =>
        candidate !== connectionId && Boolean(workspaces.value[candidate]))
      const nextServerId = remaining[
        Math.min(Math.max(removedIndex, 0), remaining.length - 1)
      ]
      if (nextServerId === undefined) clearActiveWorkspace()
      else activateWorkspaceServer(nextServerId)
    }
    try {
      await api.disconnectServer(connectionId)
    } catch (reason) {
      activeWorkspaceServerId.value = previousWorkspaceServerId
      activeSessionId.value = previousSessionId
      throw reason
    }
    if (closeWorkspace) {
      removeWorkspaceLocal(connectionId)
      return
    }
    const sessionIds = new Set(
      tabs.value
        .filter((tab) => tab.connectionId === connectionId)
        .map((tab) => tab.sessionId),
    )
    const keepWorkspaceActive = previousWorkspaceServerId === connectionId
    removeSessions(sessionIds)
    updateWorkspace(connectionId, 'disconnected')
    if (keepWorkspaceActive) {
      activeWorkspaceServerId.value = connectionId
      activeSessionId.value = null
      rememberWorkspaceActivation(connectionId)
      return
    }
    if (activeWorkspaceServerId.value === connectionId) {
      activateWorkspaceServer(connectionId)
    }
  }

  async function reconnect(
    sessionId: string,
    connectionId: number,
    auth: AuthRequest,
    columns: number,
    rows: number,
  ) {
    const workspace = workspaces.value[connectionId]
    if (workspace) updateWorkspace(connectionId, 'reconnecting')
    try {
      const info = await api.reconnectTerminal(
        sessionId,
        connectionId,
        auth,
        columns,
        rows,
      )
      closedSessionIds.delete(sessionId)
      info.code = info.code ?? ''
      const index = tabs.value.findIndex((tab) => tab.sessionId === sessionId)
      if (index >= 0) tabs.value[index] = info
      activeSessionId.value = sessionId
      activeWorkspaceServerId.value = connectionId
      rememberWorkspaceActivation(connectionId)
      lastActiveTerminalByServer.value[connectionId] = sessionId
      clearOutputActivity(sessionId)
      if (info.status === 'online') updateWorkspace(connectionId, 'connected')
      return info
    } catch (reason) {
      const connection = workspace
        ? { id: connectionId, name: workspace.serverName }
        : null
      if (connection) markFailed(connection, reason)
      throw reason
    }
  }

  function handleOutput(event: TerminalOutputEvent) {
    if (closedSessionIds.has(event.sessionId)) return
    if (
      event.sessionId !== activeSessionId.value
      && !visibleOutputSessionIds.has(event.sessionId)
      && hasVisibleTerminalOutput(event.dataBase64)
      && tabs.value.some((tab) => tab.sessionId === event.sessionId)
    ) {
      markOutputActivity(event.sessionId)
    }
    rememberReplayOutput(event.sessionId, event.dataBase64)
    const listener = listeners.get(event.sessionId)
    if (listener) {
      listener(event.dataBase64, { replay: false })
      return
    }
    const queued = pendingOutput.get(event.sessionId) ?? []
    queued.push(event.dataBase64)
    if (queued.length > 256) queued.shift()
    pendingOutput.set(event.sessionId, queued)
  }

  function estimatedBase64Bytes(dataBase64: string) {
    const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0
    return Math.max(0, Math.floor((dataBase64.length * 3) / 4) - padding)
  }

  function rememberReplayOutput(sessionId: string, dataBase64: string) {
    const current = replayOutput.get(sessionId) ?? { chunks: [], bytes: 0 }
    current.chunks.push(dataBase64)
    current.bytes += estimatedBase64Bytes(dataBase64)
    while (current.bytes > maxReplayOutputBytes && current.chunks.length > 1) {
      const removed = current.chunks.shift()
      if (removed) current.bytes -= estimatedBase64Bytes(removed)
    }
    if (current.bytes > maxReplayOutputBytes && current.chunks.length === 1) {
      current.chunks = current.chunks.slice(-1)
      current.bytes = estimatedBase64Bytes(current.chunks[0] ?? '')
    }
    replayOutput.set(sessionId, current)
  }

  function handleStatus(event: TerminalStatusEvent) {
    if (closedSessionIds.has(event.sessionId)) return
    lastStatus.value = { ...event, code: event.code ?? '' }
    const tab = tabs.value.find((candidate) => candidate.sessionId === event.sessionId)
    if (!tab) {
      pendingStatus.set(event.sessionId, event)
      return
    }
    tab.status = event.status
    tab.code = event.code ?? ''
    tab.message = event.message
    tab.connectionError = event.connectionError
    if (!workspaces.value[event.connectionId]) return
    if (event.status === 'online') {
      updateWorkspace(event.connectionId, 'connected')
    } else if (event.status === 'connecting') {
      updateWorkspace(event.connectionId, 'connecting', event.message)
    } else if (event.status === 'error') {
      updateWorkspace(
        event.connectionId,
        'failed',
        event.connectionError?.userMessage || event.message,
        event.connectionError,
      )
    } else {
      updateWorkspace(event.connectionId, 'disconnected', event.message)
    }
  }

  async function closeOther(sessionId: string) {
    const ids = tabs.value.filter((tab) => tab.sessionId !== sessionId).map((tab) => tab.sessionId)
    for (const id of ids) await closeSession(id)
    activate(sessionId)
  }

  async function closeRight(sessionId: string) {
    const index = tabs.value.findIndex((tab) => tab.sessionId === sessionId)
    if (index < 0) return
    const ids = tabs.value.slice(index + 1).map((tab) => tab.sessionId)
    for (const id of ids) await closeSession(id)
    activate(sessionId)
  }

  async function closeServerTerminalSessions(serverId: number) {
    const ids = tabs.value
      .filter((tab) => tab.connectionId === serverId)
      .map((tab) => tab.sessionId)
    for (const id of ids) await closeSession(id)
  }

  function registerOutput(sessionId: string, listener: OutputListener) {
    listeners.set(sessionId, listener)
    for (const chunk of replayOutput.get(sessionId)?.chunks ?? []) {
      listener(chunk, { replay: true })
    }
    pendingOutput.delete(sessionId)
  }

  function unregisterOutput(sessionId: string) {
    listeners.delete(sessionId)
  }

  function markOutputActivity(sessionId: string) {
    const current = outputActivityBySession.value[sessionId]
    outputActivityBySession.value[sessionId] = {
      hasActivity: true,
      unreadCount: Math.min((current?.unreadCount ?? 0) + 1, maxUnreadActivityCount),
      lastActivityAt: Date.now(),
    }
  }

  function clearOutputActivity(sessionId: string) {
    if (!outputActivityBySession.value[sessionId]) return
    const next = { ...outputActivityBySession.value }
    delete next[sessionId]
    outputActivityBySession.value = next
  }

  function clearAllOutputActivity() {
    outputActivityBySession.value = {}
  }

  function setVisibleOutputSessions(sessionIds: Iterable<string>) {
    visibleOutputSessionIds = new Set(Array.from(sessionIds).filter(Boolean))
    for (const sessionId of visibleOutputSessionIds) {
      clearOutputActivity(sessionId)
    }
  }

  function isOutputSessionVisible(sessionId: string) {
    return visibleOutputSessionIds.has(sessionId)
  }

  function outputActivityLabel(sessionId: string) {
    const count = outputActivityBySession.value[sessionId]?.unreadCount ?? 0
    if (count <= 0) return ''
    return count >= maxUnreadActivityCount ? `${maxUnreadActivityCount}+` : String(count)
  }

  function subscribe() {
    EventsOn('terminal:output', handleOutput)
    EventsOn('terminal:status', handleStatus)
  }

  function unsubscribe() {
    EventsOff('terminal:output')
    EventsOff('terminal:status')
  }

  return {
    tabs,
    activeSessionId,
    activeWorkspaceServerId,
    activeTab,
    activeServerId,
    activeWorkspace,
    sessionsByServerId,
    workspaces,
    workspaceOrder,
    workspaceOnly,
    lastActiveTerminalByServer,
    lastStatus,
    outputActivityBySession,
    open,
    activate,
    activateWorkspaceServer,
    navigateToServer,
    clearActiveWorkspace,
    ensureWorkspace,
    syncConnectionState,
    markConnecting,
    markFailed,
    hasWorkspace,
    findByConnection,
    reorderWorkspace,
    closeSession,
    closeServerTerminalSessions,
    disconnectServer,
    removeWorkspaceLocal,
    closeOther,
    closeRight,
    reconnect,
    registerOutput,
    unregisterOutput,
    clearOutputActivity,
    clearAllOutputActivity,
    setVisibleOutputSessions,
    isOutputSessionVisible,
    outputActivityLabel,
    subscribe,
    unsubscribe,
  }
})
