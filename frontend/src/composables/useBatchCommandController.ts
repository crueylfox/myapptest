import { computed, ref, watch, type Ref } from 'vue'
import type { Connection, ConnectionRuntimeState, TerminalSessionInfo } from '../types'

export interface BatchTargetSession {
  serverID: number
  terminalSessionID: string
  writable: boolean
  reason?: 'no-writable-session'
}

export interface BatchCommandTargetRow {
  serverID: number
  name: string
  terminalSessionID: string
}

export type BatchCommandExecuteIntent =
  | { enabled: true; command: string; targets: Array<{ serverID: number; terminalSessionID: string }> }
  | { enabled: false; command: string; targets: Array<{ serverID: number; terminalSessionID: string }>; reason: 'empty-command' | 'no-targets' }

export interface UseBatchCommandControllerOptions {
  connections: Ref<Connection[]>
  connectionStates: Ref<Record<number, ConnectionRuntimeState>>
  sessionsByServerId: Ref<Record<number, TerminalSessionInfo[]>>
  activeTab: Ref<TerminalSessionInfo | null | undefined>
  lastActiveTerminalByServer: Ref<Record<number, string>>
}

export function useBatchCommandController(options: UseBatchCommandControllerOptions) {
  const open = ref(false)
  const command = ref('')
  const selectedIds = ref<Set<number>>(new Set())
  const sending = ref(false)

  const availableTargets = computed<BatchCommandTargetRow[]>(() =>
    options.connections.value
      .map((connection) => {
        const target = resolveTarget(connection.id)
        if (!target.writable || !isTargetAvailable(connection.id)) return null
        return {
          serverID: connection.id,
          name: connection.name,
          terminalSessionID: target.terminalSessionID,
        }
      })
      .filter((target): target is BatchCommandTargetRow => Boolean(target)))

  const selectedTargets = computed(() =>
    availableTargets.value.filter((target) => selectedIds.value.has(target.serverID)))

  const selectedCount = computed(() => selectedIds.value.size)

  const executeIntent = computed<BatchCommandExecuteIntent>(() => {
    const normalized = normalizeBatchCommand(command.value)
    const targets = selectedTargets.value.map((target) => ({
      serverID: target.serverID,
      terminalSessionID: target.terminalSessionID,
    }))
    if (!normalized) return { enabled: false, command: '', targets, reason: 'empty-command' }
    if (!targets.length) return { enabled: false, command: normalized, targets, reason: 'no-targets' }
    return { enabled: true, command: normalized, targets }
  })

  watch(
    () => availableTargets.value.map((target) => target.serverID).join(','),
    () => pruneSelection(),
    { immediate: true },
  )

  function openPanel() {
    open.value = true
  }

  function closePanel() {
    open.value = false
    selectedIds.value = new Set()
    sending.value = false
  }

  function setSending(next: boolean) {
    sending.value = next
  }

  function resolveTarget(serverID: number): BatchTargetSession {
    const sessions = options.sessionsByServerId.value[serverID] ?? []
    const writableSessions = sessions.filter(isWritableTerminalSession)
    if (!writableSessions.length) {
      return { serverID, terminalSessionID: '', writable: false, reason: 'no-writable-session' }
    }
    const active = options.activeTab.value
    if (active?.connectionId === serverID && isWritableTerminalSession(active)) {
      return { serverID, terminalSessionID: active.sessionId, writable: true }
    }
    const recentID = options.lastActiveTerminalByServer.value[serverID]
    const recent = writableSessions.find((session) => session.sessionId === recentID)
    const session = recent ?? writableSessions[writableSessions.length - 1]
    return { serverID, terminalSessionID: session.sessionId, writable: true }
  }

  function isTargetAvailable(serverID: number) {
    const state = options.connectionStates.value[serverID]
    const target = resolveTarget(serverID)
    if (!target.writable) return false
    if (!state) return true
    return state.status === 'online' && state.terminalActive === true
  }

  function toggleTarget(serverID: number) {
    const next = new Set(selectedIds.value)
    if (next.has(serverID)) {
      next.delete(serverID)
    } else if (availableTargets.value.some((target) => target.serverID === serverID)) {
      next.add(serverID)
    }
    selectedIds.value = next
  }

  function selectAllTargets() {
    selectedIds.value = new Set(availableTargets.value.map((target) => target.serverID))
  }

  function invertTargets() {
    const next = new Set(selectedIds.value)
    for (const target of availableTargets.value) {
      if (next.has(target.serverID)) next.delete(target.serverID)
      else next.add(target.serverID)
    }
    selectedIds.value = next
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function clearCommand() {
    command.value = ''
  }

  function pruneSelection() {
    const available = new Set(availableTargets.value.map((target) => target.serverID))
    const next = new Set([...selectedIds.value].filter((id) => available.has(id)))
    if (next.size !== selectedIds.value.size) selectedIds.value = next
  }

  return {
    open,
    command,
    selectedIds,
    selectedCount,
    sending,
    availableTargets,
    selectedTargets,
    executeIntent,
    openPanel,
    closePanel,
    setSending,
    resolveTarget,
    isTargetAvailable,
    toggleTarget,
    selectAllTargets,
    invertTargets,
    clearSelection,
    clearCommand,
    pruneSelection,
  }
}

export function normalizeBatchCommand(value: string) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function isWritableTerminalSession(session: TerminalSessionInfo | undefined | null) {
  return Boolean(session && session.status === 'online' && session.sessionId)
}
