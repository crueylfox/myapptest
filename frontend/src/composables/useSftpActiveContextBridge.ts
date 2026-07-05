import type { SFTPState, SFTPTransferState, TerminalStatusEvent } from '../types'
import type { PaneAssignment } from '../utils/workspaceSplitTypes'

export type SftpActiveContextIntent =
  | { type: 'activate'; connectionId: number; contextId: string; terminalSessionId: string }
  | { type: 'noop' }

export type ReconnectableSftpContext = {
  contextId: string
  terminalSessionId: string
}

export type TerminalStatusReconnectIntent =
  | { type: 'reconnect-file-contexts'; connectionId: number; terminalSessionId: string }
  | { type: 'clear-pending' }
  | { type: 'noop' }

export function sftpContextKey(connectionId: number, contextId?: string | null) {
  const value = contextId?.trim()
  return value || `server:${connectionId}`
}

export function resolveActiveSftpContextIntent(input: {
  activePaneAssignment: PaneAssignment | null
  activeSshTab: { sessionId: string; connectionId: number } | null
}): SftpActiveContextIntent {
  if (input.activePaneAssignment?.kind !== 'ssh' || !input.activeSshTab) return { type: 'noop' }
  return {
    type: 'activate',
    connectionId: input.activeSshTab.connectionId,
    contextId: input.activeSshTab.sessionId,
    terminalSessionId: input.activeSshTab.sessionId,
  }
}

function isActiveTransferStatus(status = '') {
  return ['queued', 'planning', 'running', 'pausing', 'paused', 'resuming'].includes(status)
}

function hasRunningFileTransfer(input: {
  connectionId: number
  contextId: string
  transfersById: Record<string, SFTPTransferState | undefined>
}) {
  const contextKey = sftpContextKey(input.connectionId, input.contextId)
  return Object.values(input.transfersById).some((transfer) =>
    transfer?.connectionId === input.connectionId &&
    sftpContextKey(transfer.connectionId, transfer.contextId) === contextKey &&
    isActiveTransferStatus(transfer.status),
  )
}

function fileContextWasOpened(
  state: SFTPState,
  entriesCount: (connectionId: number, contextId?: string) => number,
) {
  if (state.status === 'connecting') return false
  return state.active ||
    state.status === 'online' ||
    state.status === 'error' ||
    Boolean(state.currentPath?.trim()) ||
    entriesCount(state.connectionId, state.contextId) > 0
}

export function selectReconnectableSftpContexts(input: {
  connectionId: number
  terminalSessionId: string
  statesByContextId: Record<string, SFTPState | undefined>
  serverState?: SFTPState
  transfersById: Record<string, SFTPTransferState | undefined>
  entriesCount: (connectionId: number, contextId?: string) => number
}) {
  const contexts = new Map<string, ReconnectableSftpContext>()
  const addState = (state: SFTPState | undefined) => {
    if (!state || state.connectionId !== input.connectionId || !fileContextWasOpened(state, input.entriesCount)) return
    const contextId = sftpContextKey(input.connectionId, state.contextId)
    if (hasRunningFileTransfer({
      connectionId: input.connectionId,
      contextId,
      transfersById: input.transfersById,
    })) return
    contexts.set(contextId, {
      contextId,
      terminalSessionId: state.terminalSessionId || (contextId === input.terminalSessionId ? input.terminalSessionId : ''),
    })
  }
  for (const state of Object.values(input.statesByContextId)) addState(state)
  addState(input.serverState)
  if (input.terminalSessionId && contexts.has(input.terminalSessionId)) {
    const current = contexts.get(input.terminalSessionId)
    if (current) current.terminalSessionId = input.terminalSessionId
  }
  return [...contexts.values()]
}

function terminalReconnectKey(connectionId: number, sessionId: string) {
  return `${connectionId}:${sessionId}`
}

export function useSftpActiveContextBridge() {
  const pendingTerminalFileReconnects = new Set<string>()

  function markTerminalFileReconnectPending(connectionId: number, sessionId: string) {
    if (!sessionId) return
    pendingTerminalFileReconnects.add(terminalReconnectKey(connectionId, sessionId))
  }

  function clearTerminalFileReconnectPending(connectionId: number, sessionId: string) {
    if (!sessionId) return
    pendingTerminalFileReconnects.delete(terminalReconnectKey(connectionId, sessionId))
  }

  function hasTerminalFileReconnectPending(connectionId: number, sessionId: string) {
    return pendingTerminalFileReconnects.has(terminalReconnectKey(connectionId, sessionId))
  }

  function resolveTerminalStatusReconnectIntent(event: TerminalStatusEvent | null | undefined): TerminalStatusReconnectIntent {
    if (!event) return { type: 'noop' }
    if (event.status === 'online') {
      if (!hasTerminalFileReconnectPending(event.connectionId, event.sessionId)) return { type: 'noop' }
      clearTerminalFileReconnectPending(event.connectionId, event.sessionId)
      return {
        type: 'reconnect-file-contexts',
        connectionId: event.connectionId,
        terminalSessionId: event.sessionId,
      }
    }
    if (event.status === 'error' || event.status === 'offline') {
      clearTerminalFileReconnectPending(event.connectionId, event.sessionId)
      return { type: 'clear-pending' }
    }
    return { type: 'noop' }
  }

  return {
    markTerminalFileReconnectPending,
    clearTerminalFileReconnectPending,
    hasTerminalFileReconnectPending,
    resolveTerminalStatusReconnectIntent,
  }
}
