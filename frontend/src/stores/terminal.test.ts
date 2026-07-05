// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthRequest,
  Connection,
  ConnectionError,
  ConnectionRuntimeState,
  TerminalOutputEvent,
  TerminalStatusEvent,
} from '../types'

const runtime = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => runtime.callbacks.set(name, callback)),
  EventsOff: vi.fn((name: string) => runtime.callbacks.delete(name)),
}))

import { useTerminalStore } from './terminal'

const auth: AuthRequest = {
  password: '', passphrase: '', trustUnknownHost: false,
  rememberSecret: false,
}
const connection: Connection = {
  id: 1, groupId: null, name: 'server', host: '192.0.2.1', port: 22,
  username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
  hostKeyFingerprint: 'SHA256:test', credentialSaved: true,
  refreshInterval: 2, createdAt: '', updatedAt: '',
}
const connectionError: ConnectionError = {
  code: 'AUTH_FAILED',
  userMessage: 'SSH 韬唤楠岃瘉澶辫触锛岃妫€鏌ョ敤鎴峰悕銆佸瘑鐮佹垨绉侀挜銆?',
  technicalMessage: 'ssh: unable to authenticate',
  retryable: false,
  serverId: 1,
  operation: 'terminal.connect',
  timestamp: '2026-06-14T00:00:00Z',
}

function runtimeState(
  connectionId: number,
  values: Partial<ConnectionRuntimeState> = {},
): ConnectionRuntimeState {
  return {
    connectionId,
    status: 'offline',
    monitorActive: false,
    terminalActive: false,
    terminalConnecting: false,
    sftpActive: false,
    connecting: false,
    hasActiveSession: false,
    updatedAt: '',
    ...values,
  }
}

describe('terminal store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtime.callbacks.clear()
    let next = 0
    window.go = {
      main: {
        App: {
          OpenTerminal: vi.fn(async (request: { connectionId: number }) => ({
            sessionId: `session-${++next}`, connectionId: request.connectionId, title: `server-${request.connectionId}`,
            status: 'connecting', code: '', message: '',
          })),
          CloseTerminal: vi.fn(async () => undefined),
          DisconnectServer: vi.fn(async () => undefined),
          WriteTerminal: vi.fn(async () => undefined),
          ResizeTerminal: vi.fn(async () => undefined),
          ReconnectTerminal: vi.fn(),
        } as never,
      },
    }
  })

  it('keeps multiple terminal tabs and status events isolated', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    const statusCallback = runtime.callbacks.get('terminal:status')
    statusCallback?.({
      sessionId: first.sessionId, connectionId: 1, status: 'online', code: '', message: '', active: true,
    } satisfies TerminalStatusEvent)

    expect(store.tabs).toHaveLength(2)
    expect(store.tabs[0].status).toBe('online')
    expect(store.tabs[1].status).toBe('connecting')
    expect(store.activeSessionId).toBe(second.sessionId)
  })

  it('buffers output until the matching terminal view registers', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)
    const outputCallback = runtime.callbacks.get('terminal:output')
    outputCallback?.({
      sessionId: session.sessionId, dataBase64: 'aGVsbG8=',
    } satisfies TerminalOutputEvent)
    const received: string[] = []
    store.registerOutput(session.sessionId, (chunk) => received.push(chunk))
    expect(received).toEqual(['aGVsbG8='])
  })

  it('keeps an in-memory replay buffer while a terminal view listener is active', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)
    const outputCallback = runtime.callbacks.get('terminal:output')
    const live: string[] = []
    const replayed: Array<{ chunk: string; replay: boolean }> = []

    store.registerOutput(session.sessionId, (chunk) => live.push(chunk))
    outputCallback?.({
      sessionId: session.sessionId,
      dataBase64: 'cHJvbXB0PiA=',
    } satisfies TerminalOutputEvent)
    store.unregisterOutput(session.sessionId)
    store.registerOutput(session.sessionId, (chunk, meta) => {
      replayed.push({ chunk, replay: Boolean(meta?.replay) })
    })

    expect(live).toEqual(['cHJvbXB0PiA='])
    expect(replayed).toEqual([{ chunk: 'cHJvbXB0PiA=', replay: true }])
    expect(localStorage.getItem('terminal:output')).toBeNull()
    expect(localStorage.getItem('serverpilot.terminalReplay')).toBeNull()
  })

  it('clears in-memory terminal replay output when a session closes', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)
    runtime.callbacks.get('terminal:output')?.({
      sessionId: session.sessionId,
      dataBase64: 'cmVjZW50',
    } satisfies TerminalOutputEvent)

    await store.closeSession(session.sessionId)
    const replayed: string[] = []
    store.registerOutput(session.sessionId, (chunk) => replayed.push(chunk))

    expect(replayed).toEqual([])
  })

  it('bounds terminal replay output to recent in-memory chunks', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)
    const chunk = 'A'.repeat(400 * 1024)
    for (let index = 0; index < 5; index += 1) {
      runtime.callbacks.get('terminal:output')?.({
        sessionId: session.sessionId,
        dataBase64: chunk,
      } satisfies TerminalOutputEvent)
    }
    const replayed: string[] = []

    store.registerOutput(session.sessionId, (value, meta) => {
      if (meta?.replay) replayed.push(value)
    })

    expect(replayed.length).toBeGreaterThan(0)
    expect(replayed.length).toBeLessThan(5)
    expect(replayed.at(-1)).toBe(chunk)
  })

  it('marks inactive SSH live output as runtime-only unread activity and caps the count', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    expect(store.activeSessionId).toBe(second.sessionId)

    for (let index = 0; index < 110; index += 1) {
      runtime.callbacks.get('terminal:output')?.({
        sessionId: first.sessionId,
        dataBase64: 'bGl2ZQ==',
      } satisfies TerminalOutputEvent)
    }

    expect(store.outputActivityBySession[first.sessionId]).toMatchObject({
      hasActivity: true,
      unreadCount: 99,
    })
    expect(store.outputActivityLabel(first.sessionId)).toBe('99+')
    expect(localStorage.getItem('serverpilot.terminalActivity')).toBeNull()
  })

  it('does not mark active SSH output or replay chunks as unread activity', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)
    runtime.callbacks.get('terminal:output')?.({
      sessionId: session.sessionId,
      dataBase64: 'YWN0aXZl',
    } satisfies TerminalOutputEvent)
    expect(store.outputActivityBySession[session.sessionId]).toBeUndefined()

    store.unregisterOutput(session.sessionId)
    store.registerOutput(session.sessionId, vi.fn())
    expect(store.outputActivityBySession[session.sessionId]).toBeUndefined()
  })

  it('does not mark visible split-pane SSH output or pure control chunks as unread activity', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    expect(store.activeSessionId).toBe(second.sessionId)

    store.setVisibleOutputSessions([first.sessionId])
    runtime.callbacks.get('terminal:output')?.({
      sessionId: first.sessionId,
      dataBase64: btoa('visible pane text'),
    } satisfies TerminalOutputEvent)
    expect(store.outputActivityBySession[first.sessionId]).toBeUndefined()

    store.setVisibleOutputSessions([])
    runtime.callbacks.get('terminal:output')?.({
      sessionId: first.sessionId,
      dataBase64: btoa('\x1b[?25l\x1b[2K\r\n\x1b]0;title\x07'),
    } satisfies TerminalOutputEvent)
    expect(store.outputActivityBySession[first.sessionId]).toBeUndefined()

    runtime.callbacks.get('terminal:output')?.({
      sessionId: first.sessionId,
      dataBase64: btoa('hidden text'),
    } satisfies TerminalOutputEvent)
    expect(store.outputActivityBySession[first.sessionId]?.unreadCount).toBe(1)
  })

  it('clears SSH unread activity on activation and session close', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    runtime.callbacks.get('terminal:output')?.({
      sessionId: first.sessionId,
      dataBase64: 'aW5hY3RpdmU=',
    } satisfies TerminalOutputEvent)
    expect(store.outputActivityBySession[first.sessionId]?.hasActivity).toBe(true)

    store.activate(first.sessionId)
    expect(store.outputActivityBySession[first.sessionId]).toBeUndefined()

    runtime.callbacks.get('terminal:output')?.({
      sessionId: second.sessionId,
      dataBase64: 'aW5hY3RpdmU=',
    } satisfies TerminalOutputEvent)
    await store.closeSession(second.sessionId)
    expect(store.outputActivityBySession[second.sessionId]).toBeUndefined()
  })

  it('closes only the requested tab', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    await store.closeSession(first.sessionId)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([second.sessionId])
  })

  it('closes the final terminal tab in one action and clears the active workspace', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)

    await store.closeSession(session.sessionId)

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith(session.sessionId)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(store.tabs).toHaveLength(0)
    expect(store.activeSessionId).toBeNull()
    expect(store.activeWorkspaceServerId).toBeNull()
    expect(store.hasWorkspace(1)).toBe(false)
    expect(store.workspaceOrder).not.toContain(1)

    runtime.callbacks.get('terminal:status')?.({
      sessionId: session.sessionId,
      connectionId: 1,
      status: 'online',
      code: '',
      message: '',
      active: true,
    } satisfies TerminalStatusEvent)
    expect(store.tabs).toHaveLength(0)
    expect(store.hasWorkspace(1)).toBe(false)
    expect(store.lastStatus?.sessionId).not.toBe(session.sessionId)
  })

  it('removes a server workspace shell when closing that server final terminal while other terminals remain', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    const other = await store.open(otherConnection, auth)

    await store.closeSession(other.sessionId)

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith(other.sessionId)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([first.sessionId, second.sessionId])
    expect(store.activeSessionId).toBe(second.sessionId)
    expect(store.activeServerId).toBe(1)
    expect(store.hasWorkspace(2)).toBe(false)
    expect(store.workspaceOrder).not.toContain(2)

    runtime.callbacks.get('terminal:status')?.({
      sessionId: other.sessionId,
      connectionId: 2,
      status: 'online',
      code: '',
      message: '',
      active: true,
    } satisfies TerminalStatusEvent)
    expect(store.hasWorkspace(2)).toBe(false)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([first.sessionId, second.sessionId])
  })

  it('removes an inactive server final terminal without switching away from the active terminal', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    const other = await store.open(otherConnection, auth)
    store.activate(first.sessionId)

    await store.closeSession(other.sessionId)

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith(other.sessionId)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([first.sessionId])
    expect(store.activeSessionId).toBe(first.sessionId)
    expect(store.activeServerId).toBe(1)
    expect(store.hasWorkspace(2)).toBe(false)
  })

  it('activates the adjacent remaining terminal when closing the active tab', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    const second = await store.open(otherConnection, auth)
    store.activate(first.sessionId)

    await store.closeSession(first.sessionId)

    expect(store.activeSessionId).toBe(second.sessionId)
    expect(store.activeServerId).toBe(2)
  })

  it('closes all terminal sessions for one server without disconnecting the server runtime', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    const other = await store.open(otherConnection, auth)

    await store.closeServerTerminalSessions(1)

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith(first.sessionId)
    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith(second.sessionId)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([other.sessionId])
    expect(store.activeSessionId).toBe(other.sessionId)
    expect(store.activeServerId).toBe(2)
  })

  it('binds activeServerId to the active terminal instead of left-side selection', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const secondConnection = { ...connection, id: 2, name: 'server-2' }
    const second = await store.open(secondConnection, auth)

    expect(store.activeServerId).toBe(2)
    store.activate(first.sessionId)
    expect(store.activeServerId).toBe(1)
    store.activate(second.sessionId)
    expect(store.activeServerId).toBe(2)
    expect(store.sessionsByServerId[1]).toHaveLength(1)
    expect(store.sessionsByServerId[2]).toHaveLength(1)
  })

  it('disconnects a server once, removes all its tabs, and selects another server immediately', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const secondConnection = { ...connection, id: 2, name: 'server-2' }
    await store.open(secondConnection, auth)
    await store.open(secondConnection, auth)

    const pending = store.disconnectServer(2)
    expect(store.activeSessionId).toBe(first.sessionId)
    expect(store.activeServerId).toBe(1)
    await pending

    expect(window.go?.main?.App?.DisconnectServer).toHaveBeenCalledTimes(1)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([first.sessionId])
    expect(store.activeSessionId).toBe(first.sessionId)
    expect(store.activeServerId).toBe(1)
  })

  it('shows no active server after closing all server workspaces', async () => {
    const store = useTerminalStore()
    await store.open(connection, auth)
    await store.disconnectServer(1)
    expect(store.activeSessionId).toBeNull()
    expect(store.activeServerId).toBeNull()
  })

  it('restores the active terminal when server disconnect fails', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const secondConnection = { ...connection, id: 2, name: 'server-2' }
    const second = await store.open(secondConnection, auth)
    vi.mocked(window.go!.main!.App!.DisconnectServer).mockRejectedValueOnce(new Error('failed'))

    await expect(store.disconnectServer(2)).rejects.toThrow('failed')
    expect(store.tabs).toHaveLength(2)
    expect(store.activeSessionId).toBe(second.sessionId)
    expect(store.activeServerId).toBe(2)
    expect(store.tabs[0].sessionId).toBe(first.sessionId)
  })

  it('ignores late events for sessions removed by a server disconnect', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const session = await store.open(connection, auth)
    await store.disconnectServer(1)
    runtime.callbacks.get('terminal:status')?.({
      sessionId: session.sessionId, connectionId: 1, status: 'online',
      code: '', message: '', active: true,
    } satisfies TerminalStatusEvent)
    expect(store.tabs).toHaveLength(0)
    expect(store.lastStatus?.sessionId).not.toBe(session.sessionId)
  })

  it('closes other tabs and tabs to the right', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    const third = await store.open(connection, auth)
    await store.closeRight(first.sessionId)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([first.sessionId])

    const fourth = await store.open(connection, auth)
    const fifth = await store.open(connection, auth)
    await store.closeOther(fourth.sessionId)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual([fourth.sessionId])
    expect(store.tabs.some((tab) => tab.sessionId === second.sessionId || tab.sessionId === third.sessionId || tab.sessionId === fifth.sessionId)).toBe(false)
  })

  it('navigates to an offline workspace without opening or reconnecting a terminal', () => {
    const store = useTerminalStore()
    store.navigateToServer(connection)
    store.syncConnectionState(connection, runtimeState(1))

    expect(store.activeWorkspaceServerId).toBe(1)
    expect(store.activeWorkspace?.status).toBe('offline')
    expect(store.activeWorkspace?.message).toBe('尚未连接')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
  })

  it('activates the most recently used terminal for each server', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    await store.open(otherConnection, auth)

    store.activate(first.sessionId)
    store.navigateToServer(otherConnection)
    store.navigateToServer(connection)
    expect(store.activeSessionId).toBe(first.sessionId)

    store.activate(second.sessionId)
    store.navigateToServer(otherConnection)
    store.navigateToServer(connection)
    expect(store.activeSessionId).toBe(second.sessionId)
  })

  it('falls back to the first remaining terminal when the recent terminal was closed', async () => {
    const store = useTerminalStore()
    const first = await store.open(connection, auth)
    const second = await store.open(connection, auth)
    store.activate(second.sessionId)
    await store.closeSession(second.sessionId)

    store.navigateToServer(connection)
    expect(store.activeSessionId).toBe(first.sessionId)
  })

  it('retains a failed workspace and its structured Chinese error', () => {
    const store = useTerminalStore()
    store.navigateToServer(connection)
    store.syncConnectionState(connection, runtimeState(1, {
      status: 'auth_failed',
      lastError: connectionError,
    }))

    expect(store.activeWorkspace?.status).toBe('failed')
    expect(store.activeWorkspace?.message).toContain('SSH 韬唤楠岃瘉澶辫触')
    expect(store.activeWorkspace?.error?.technicalMessage).toContain('unable to authenticate')
  })

  it('does not let a healthy monitor update erase a terminal failure workspace', () => {
    const store = useTerminalStore()
    store.navigateToServer(connection)
    store.syncConnectionState(connection, runtimeState(1, {
      status: 'auth_failed',
      lastError: connectionError,
    }))
    store.syncConnectionState(connection, runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    }))

    expect(store.activeWorkspace?.status).toBe('failed')
    expect(store.activeWorkspace?.error?.code).toBe('AUTH_FAILED')
  })

  it('represents an active monitor without inventing a terminal connection', () => {
    const store = useTerminalStore()
    store.navigateToServer(connection)
    store.syncConnectionState(connection, runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    }))

    expect(store.activeWorkspace?.status).toBe('offline')
    expect(store.findByConnection(1)).toBeNull()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('shows connecting and reconnecting workspace states without duplicate sessions', () => {
    const store = useTerminalStore()
    store.navigateToServer(connection)
    store.syncConnectionState(connection, runtimeState(1, {
      status: 'connecting',
      terminalConnecting: true,
      connecting: true,
      hasActiveSession: true,
    }))
    expect(store.activeWorkspace?.status).toBe('connecting')

    store.syncConnectionState(connection, runtimeState(1, {
      status: 'reconnecting',
      connecting: true,
      hasActiveSession: true,
    }))
    expect(store.activeWorkspace?.status).toBe('reconnecting')
    expect(store.tabs).toHaveLength(0)
  })

  it('does not let a late event switch the active workspace', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const first = await store.open(connection, auth)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    await store.open(otherConnection, auth)
    expect(store.activeWorkspaceServerId).toBe(2)

    runtime.callbacks.get('terminal:status')?.({
      sessionId: first.sessionId,
      connectionId: 1,
      status: 'online',
      code: '',
      message: '',
      active: true,
    } satisfies TerminalStatusEvent)
    expect(store.activeWorkspaceServerId).toBe(2)
  })

  it('closes a failed workspace and immediately selects the previous workspace', async () => {
    const store = useTerminalStore()
    store.navigateToServer(connection)
    const otherConnection = { ...connection, id: 2, name: 'server-2' }
    store.navigateToServer(otherConnection)
    store.syncConnectionState(otherConnection, runtimeState(2, {
      status: 'auth_failed',
      lastError: { ...connectionError, serverId: 2 },
    }))

    const pending = store.disconnectServer(2)
    expect(store.activeWorkspaceServerId).toBe(1)
    await pending
    expect(store.hasWorkspace(2)).toBe(false)
  })

  it('disconnects resources without removing the server workspace', async () => {
    const store = useTerminalStore()
    await store.open(connection, auth)
    await store.disconnectServer(1, false)

    expect(store.tabs).toHaveLength(0)
    expect(store.hasWorkspace(1)).toBe(true)
    expect(store.activeWorkspaceServerId).toBe(1)
    expect(store.activeWorkspace?.status).toBe('disconnected')
  })

  it('selects the adjacent workspace in the persisted order when closing', async () => {
    const store = useTerminalStore()
    const second = { ...connection, id: 2, name: 'server-2' }
    const third = { ...connection, id: 3, name: 'server-3' }
    store.navigateToServer(connection)
    store.navigateToServer(second)
    store.navigateToServer(third)
    store.navigateToServer(connection)

    const pending = store.disconnectServer(1)
    expect(store.activeWorkspaceServerId).toBe(2)
    await pending
  })

  it('keeps a failed workspace when OpenTerminal rejects before creating a session', async () => {
    const store = useTerminalStore()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockRejectedValueOnce(
      new Error('SSH 韬唤楠岃瘉澶辫触'),
    )

    await expect(store.open(connection, auth)).rejects.toThrow('SSH 韬唤楠岃瘉澶辫触')
    expect(store.tabs).toHaveLength(0)
    expect(store.activeWorkspace?.status).toBe('failed')
    expect(store.activeWorkspace?.serverId).toBe(1)
  })

  it('replaces a failed workspace state after a later terminal succeeds', async () => {
    const store = useTerminalStore()
    store.subscribe()
    const terminal = await store.open(connection, auth)
    runtime.callbacks.get('terminal:status')?.({
      sessionId: terminal.sessionId,
      connectionId: 1,
      status: 'error',
      code: 'AUTH_FAILED',
      message: connectionError.userMessage,
      active: false,
      connectionError,
    } satisfies TerminalStatusEvent)
    expect(store.activeWorkspace?.status).toBe('failed')

    runtime.callbacks.get('terminal:status')?.({
      sessionId: terminal.sessionId,
      connectionId: 1,
      status: 'online',
      code: '',
      message: '',
      active: true,
    } satisfies TerminalStatusEvent)
    expect(store.activeWorkspace?.status).toBe('connected')
    expect(store.activeWorkspace?.error).toBeUndefined()
  })

  it('keeps selected server state independent from active workspace state', async () => {
    const store = useTerminalStore()
    await store.open(connection, auth)
    const selectedServerId = 2
    expect(selectedServerId).not.toBe(store.activeWorkspaceServerId)
    expect(store.activeWorkspaceServerId).toBe(1)
  })
})
