import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import { hasVisibleTerminalOutput } from '../utils/terminalOutputActivity'
import type {
  LocalTerminalCapabilities,
  LocalTerminalOutputEvent,
  LocalTerminalShellKind,
  LocalTerminalState,
  LocalTerminalStateEvent,
} from '../types'

type OutputDeliveryMeta = { replay: boolean }
type OutputListener = (dataBase64: string, meta: OutputDeliveryMeta) => void
type TerminalActivityState = {
  hasActivity: boolean
  unreadCount: number
  lastActivityAt: number
}
const maxReplayOutputBytes = 1024 * 1024
const maxUnreadActivityCount = 99

export const useLocalTerminalStore = defineStore('localTerminals', () => {
  const enabled = ref(false)
  const capabilities = ref<LocalTerminalCapabilities | null>(null)
  const sessions = ref<LocalTerminalState[]>([])
  const activeSessionId = ref<string | null>(null)
  const listeners = new Map<string, OutputListener>()
  const pendingOutput = new Map<string, string[]>()
  const replayOutput = new Map<string, { chunks: string[]; bytes: number }>()
  const closedSessionIds = new Set<string>()
  const outputActivityBySession = ref<Record<string, TerminalActivityState>>({})
  let visibleOutputSessionIds = new Set<string>()
  let opening: Promise<LocalTerminalState> | null = null

  const activeSession = computed(() =>
    sessions.value.find((session) => session.sessionId === activeSessionId.value) ?? null)

  async function open(shellKind: LocalTerminalShellKind | string, elevated = false, cols = 100, rows = 30) {
    if (!enabled.value) throw new Error('LOCAL_TERMINAL_DISABLED: 本地终端暂未启用')
    if (opening) return opening
    opening = (async () => {
      const safeCols = Math.max(Math.floor(cols || 0), 80)
      const safeRows = Math.max(Math.floor(rows || 0), 24)
      const opened = await api.openLocalTerminal({
        shellKind,
        elevated,
        shell: '',
        cwd: '',
        cols: safeCols,
        rows: safeRows,
      })
      const state: LocalTerminalState = {
        sessionId: opened.sessionId,
        shellKind: opened.shellKind || shellKind,
        shell: opened.title || opened.shell,
        shellName: opened.shellName || opened.shell,
        elevated: opened.elevated,
        title: opened.title || opened.shell,
        cwd: opened.cwd,
        status: opened.status === 'starting' || opened.status === 'exited' || opened.status === 'failed' || opened.status === 'closed'
          ? opened.status
          : 'running',
        exitCode: null,
        error: '',
        startedAt: opened.startedAt,
        endedAt: '',
      }
      closedSessionIds.delete(opened.sessionId)
      upsertSession(state)
      activeSessionId.value = opened.sessionId
      return state
    })().finally(() => {
      opening = null
    })
    return opening
  }

  function activate(sessionId: string) {
    if (!sessions.value.some((session) => session.sessionId === sessionId)) return
    activeSessionId.value = sessionId
    clearOutputActivity(sessionId)
  }

  async function close(sessionId: string) {
    closedSessionIds.add(sessionId)
    if (enabled.value) await api.closeLocalTerminal(sessionId)
    removeLocal(sessionId)
  }

  function removeLocal(sessionId: string) {
    listeners.delete(sessionId)
    pendingOutput.delete(sessionId)
    replayOutput.delete(sessionId)
    clearOutputActivity(sessionId)
    const index = sessions.value.findIndex((session) => session.sessionId === sessionId)
    sessions.value = sessions.value.filter((session) => session.sessionId !== sessionId)
    if (activeSessionId.value !== sessionId) return
    const next = sessions.value[Math.min(Math.max(index, 0), sessions.value.length - 1)]
    activeSessionId.value = next?.sessionId ?? null
  }

  function removeExited(sessionId: string) {
    closedSessionIds.add(sessionId)
    removeLocal(sessionId)
  }

  function handleOutput(event: LocalTerminalOutputEvent) {
    if (!enabled.value) return
    if (closedSessionIds.has(event.sessionId)) return
    if (
      event.sessionId !== activeSessionId.value
      && !visibleOutputSessionIds.has(event.sessionId)
      && hasVisibleTerminalOutput(event.dataBase64)
      && sessions.value.some((session) => session.sessionId === event.sessionId)
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

  function handleState(event: LocalTerminalStateEvent) {
    if (!enabled.value) return
    const state = event.state
    if (closedSessionIds.has(state.sessionId)) return
    if (state.status === 'running' || state.status === 'starting') upsertSession(state)
    else updateSession(state)
  }

  function upsertSession(state: LocalTerminalState) {
    const index = sessions.value.findIndex((session) => session.sessionId === state.sessionId)
    if (index >= 0) {
      sessions.value[index] = state
      return
    }
    sessions.value = [...sessions.value, state]
  }

  function updateSession(state: LocalTerminalState) {
    const index = sessions.value.findIndex((session) => session.sessionId === state.sessionId)
    if (index < 0) return
    sessions.value[index] = state
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
    EventsOn('localterminal:output', handleOutput)
    EventsOn('localterminal:state', handleState)
  }

  function unsubscribe() {
    EventsOff('localterminal:output')
    EventsOff('localterminal:state')
    EventsOff('localterminal:error')
  }

  function setEnabled(value: boolean) {
    enabled.value = value
    if (value) return
    sessions.value = []
    activeSessionId.value = null
    listeners.clear()
    pendingOutput.clear()
    replayOutput.clear()
    clearAllOutputActivity()
  }

  function setCapabilities(value: LocalTerminalCapabilities | null) {
    capabilities.value = value
    setEnabled(Boolean(value?.enabled && value.supported))
  }

  return {
    enabled,
    capabilities,
    sessions,
    activeSessionId,
    activeSession,
    outputActivityBySession,
    open,
    activate,
    close,
    removeLocal,
    removeExited,
    registerOutput,
    unregisterOutput,
    subscribe,
    unsubscribe,
    setEnabled,
    setCapabilities,
    clearOutputActivity,
    clearAllOutputActivity,
    setVisibleOutputSessions,
    isOutputSessionVisible,
    outputActivityLabel,
  }
})
