// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../types'

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

import { useServerStore } from './server'

const connections: Connection[] = [
  {
    id: 1, groupId: null, name: 'online', host: '192.0.2.1', port: 22,
    username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
    hostKeyFingerprint: '', credentialSaved: false, refreshInterval: 2, createdAt: '', updatedAt: '',
  },
  {
    id: 2, groupId: null, name: 'failed', host: '192.0.2.2', port: 22,
    username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
    hostKeyFingerprint: '', credentialSaved: false, refreshInterval: 2, createdAt: '', updatedAt: '',
  },
]

function snapshot(connectionId: number, status: string, second: number) {
  return {
    connectionId, status, timestamp: new Date(second * 1000).toISOString(),
    cpuPercent: null, memoryUsedPercent: null, errors: null,
  }
}

describe('server monitor state isolation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.go = {
      main: {
        App: {
          GetMonitorNetworkInterface: vi.fn(async (serverID: number) => ({
            serverID,
            mode: 'all',
            selectedNetworkInterface: '',
            userSelected: false,
            updatedAt: '2026-06-19T00:00:00Z',
          })),
          SetMonitorNetworkInterface: vi.fn(async (request) => ({
            serverID: request.serverID,
            mode: request.mode,
            selectedNetworkInterface: request.selectedNetworkInterface,
            userSelected: request.userSelected,
            updatedAt: '2026-06-19T00:00:00Z',
          })),
          ListNetworkInterfaces: vi.fn(async (request) => ({
            serverID: request.serverID,
            interfaces: [],
            recommendedInterface: 'all',
            recommendedInterfaceReason: 'fallback_all',
            updatedAt: '2026-06-19T00:00:00Z',
          })),
          ListNetworkDiagnosticTasks: vi.fn(async () => []),
          StartNetworkDiagnostic: vi.fn(async (request) => ({
            taskID: 'task-1',
            serverID: request.serverID,
            type: request.type,
            target: request.target,
            port: request.port,
            status: 'running',
            startedAt: '2026-06-19T00:00:00Z',
          })),
          CancelNetworkDiagnostic: vi.fn(async () => undefined),
          ListGroups: vi.fn(async () => []),
          ListConnections: vi.fn(async () => connections),
          ReorderServers: vi.fn(async () => connections),
          LogFrontendError: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  it('keeps snapshots isolated while rapidly switching servers', () => {
    const store = useServerStore()
    store.connections = connections
    store.acceptSnapshot(snapshot(1, 'online', 1))
    store.acceptSnapshot(snapshot(2, 'error', 2))

    store.select(1)
    expect(store.snapshot?.status).toBe('online')
    store.select(2)
    expect(store.snapshot?.status).toBe('error')
    store.select(1)
    expect(store.snapshot?.connectionId).toBe(1)
  })

  it('handles connect then immediate disconnect and repeated reconnect states', () => {
    const store = useServerStore()
    store.connections = connections
    store.select(1)

    store.acceptSnapshot(snapshot(1, 'connecting', 1))
    store.acceptSnapshot(snapshot(1, 'offline', 2))
    store.acceptSnapshot(snapshot(1, 'reconnecting', 3))
    store.acceptSnapshot(snapshot(1, 'reconnecting', 4))
    store.acceptSnapshot(snapshot(1, 'online', 5))

    expect(store.snapshot?.status).toBe('online')
    expect(store.history.map((item) => item.status)).toEqual([
      'connecting', 'offline', 'reconnecting', 'reconnecting', 'online',
    ])
  })

  it('does not let a failed server overwrite an online server', () => {
    const store = useServerStore()
    store.connections = connections
    store.acceptSnapshot(snapshot(1, 'online', 1))
    store.acceptSnapshot(snapshot(2, 'reconnecting', 2))

    expect(store.snapshots[1].status).toBe('online')
    expect(store.snapshots[2].status).toBe('reconnecting')
  })

  it('keeps selectedServerID independent and ignores late events after disconnect', () => {
    const store = useServerStore()
    store.connections = connections
    store.select(2)
    store.acceptSnapshot(snapshot(1, 'online', 1))
    store.acceptSnapshot(snapshot(2, 'online', 2))
    store.markDisconnected(2)
    store.acceptSnapshot(snapshot(2, 'online', 3))

    expect(store.selectedId).toBe(2)
    expect(store.snapshots[1].status).toBe('online')
    expect(store.snapshots[2]).toBeUndefined()
    expect(store.connectionState(2).status).toBe('disconnected')

    store.resumeServer(2)
    store.acceptSnapshot(snapshot(2, 'online', 4))
    expect(store.snapshots[2].status).toBe('online')
  })

  it('clears active session flags after failure and permits a new connecting transition', () => {
    const store = useServerStore()
    store.acceptConnectionState({
      connectionId: 1,
      status: 'auth_failed',
      monitorActive: false,
      terminalActive: false,
      terminalConnecting: false,
      sftpActive: false,
      connecting: false,
      hasActiveSession: false,
      lastError: {
        code: 'AUTH_FAILED',
        userMessage: 'SSH 韬唤楠岃瘉澶辫触',
        technicalMessage: 'unable to authenticate',
        retryable: false,
        serverId: 1,
        operation: 'terminal.connect',
        timestamp: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    })
    expect(store.connectionState(1).hasActiveSession).toBe(false)

    store.acceptConnectionState({
      ...store.connectionState(1),
      status: 'connecting',
      terminalConnecting: true,
      connecting: true,
      hasActiveSession: true,
      lastError: undefined,
    })
    expect(store.connectionState(1)).toMatchObject({
      status: 'connecting',
      connecting: true,
      hasActiveSession: true,
    })
  })

  it('caps network diagnostic output at 1000 in-memory lines', () => {
    const store = useServerStore()
    for (let index = 0; index < 1005; index += 1) {
      store.acceptNetworkDiagnosticOutput({
        serverID: 1,
        taskID: 'task-1',
        timestamp: '2026-06-19T00:00:00Z',
        line: `line-${index}`,
        stream: 'stdout',
      })
    }

    expect(store.diagnosticOutput['task-1']).toHaveLength(1000)
    expect(store.diagnosticOutput['task-1'][0]).toBe('line-5')
    expect(store.diagnosticOutput['task-1'].at(-1)).toBe('line-1004')
  })

  it('ignores diagnostic output and errors for closed or disconnected tasks', () => {
    const store = useServerStore()
    store.ignoreNetworkDiagnosticOutput('task-closed')
    store.acceptNetworkDiagnosticOutput({
      serverID: 1,
      taskID: 'task-closed',
      timestamp: '2026-06-19T00:00:00Z',
      line: 'late output',
      stream: 'stdout',
    })
    store.acceptNetworkDiagnosticError({
      serverID: 1,
      taskID: 'task-closed',
      timestamp: '2026-06-19T00:00:00Z',
      message: 'late error',
      code: 'NETWORK_DIAGNOSTIC_FAILED',
    })

    expect(store.diagnosticOutput['task-closed']).toBeUndefined()

    store.diagnosticTasks[1] = [{
      taskID: 'task-running',
      serverID: 1,
      type: 'ping',
      target: '8.8.8.8',
      status: 'running',
      startedAt: '2026-06-19T00:00:00Z',
    }]
    store.markDisconnected(1)
    store.acceptNetworkDiagnosticOutput({
      serverID: 1,
      taskID: 'task-running',
      timestamp: '2026-06-19T00:00:00Z',
      line: 'late output after disconnect',
      stream: 'stdout',
    })
    expect(store.diagnosticOutput['task-running']).toBeUndefined()
  })

  it('updates monitor network interface preference and clears mixed network history', async () => {
    const store = useServerStore()
    store.connections = connections
    store.histories[1] = [snapshot(1, 'online', 1) as never]

    const preference = await store.setMonitorNetworkInterface(1, 'interface', 'eth0')

    expect(window.go?.main?.App?.SetMonitorNetworkInterface).toHaveBeenCalledWith({
      serverID: 1,
      mode: 'interface',
      selectedNetworkInterface: 'eth0',
      userSelected: true,
    })
    expect(preference).toMatchObject({
      serverID: 1,
      mode: 'interface',
      selectedNetworkInterface: 'eth0',
    })
    expect(store.histories[1]).toEqual([])
    expect(store.connections[0]).toMatchObject({
      networkInterfaceMode: 'interface',
      selectedNetworkInterface: 'eth0',
      networkInterfaceUserSelected: true,
    })
  })

  it('applies the recommended network interface only when no manual preference exists', async () => {
    const store = useServerStore()
    store.connections = connections
    const app = window.go!.main!.App!
    vi.mocked(app.ListNetworkInterfaces).mockResolvedValueOnce({
      serverID: 1,
      interfaces: [{
        serverID: 1,
        name: 'eth0',
        displayName: 'eth0',
        isUp: true,
        isLoopback: false,
        ipv4: ['192.0.2.10'],
        ipv6: [],
        rxBytes: 1,
        txBytes: 2,
        lastUpdatedAt: '2026-06-19T00:00:00Z',
      }],
      recommendedInterface: 'eth0',
      recommendedInterfaceReason: 'ssh_connection_local_ip',
      updatedAt: '2026-06-19T00:00:00Z',
    })

    await store.loadNetworkInterfacePreference(1)
    await store.loadNetworkInterfaces(1)

    expect(window.go?.main?.App?.SetMonitorNetworkInterface).toHaveBeenCalledWith({
      serverID: 1,
      mode: 'interface',
      selectedNetworkInterface: 'eth0',
      userSelected: false,
    })
    expect(store.networkInterfacePreferences[1]).toMatchObject({
      mode: 'interface',
      selectedNetworkInterface: 'eth0',
      userSelected: false,
    })
  })

  it('does not apply the recommended interface over a manual preference', async () => {
    const store = useServerStore()
    const app = window.go!.main!.App!
    store.connections = [{ ...connections[0], networkInterfaceUserSelected: true }]
    store.networkInterfacePreferences[1] = {
      serverID: 1,
      mode: 'all',
      selectedNetworkInterface: '',
      userSelected: true,
      updatedAt: '2026-06-19T00:00:00Z',
    }
    vi.mocked(app.SetMonitorNetworkInterface).mockClear()
    vi.mocked(app.ListNetworkInterfaces).mockResolvedValueOnce({
      serverID: 1,
      interfaces: [{
        serverID: 1,
        name: 'eth0',
        displayName: 'eth0',
        isUp: true,
        isLoopback: false,
        ipv4: ['192.0.2.10'],
        ipv6: [],
        rxBytes: 1,
        txBytes: 2,
        lastUpdatedAt: '2026-06-19T00:00:00Z',
      }],
      recommendedInterface: 'eth0',
      recommendedInterfaceReason: 'ssh_connection_local_ip',
      updatedAt: '2026-06-19T00:00:00Z',
    })

    await store.loadNetworkInterfaces(1)

    expect(window.go?.main?.App?.SetMonitorNetworkInterface).not.toHaveBeenCalled()
    expect(store.networkInterfacePreferences[1]).toMatchObject({
      mode: 'all',
      userSelected: true,
    })
  })

  it('persists server reorder through the typed backend API and refreshes connection rows', async () => {
    const store = useServerStore()
    const reordered = [connections[1], connections[0]]
    vi.mocked(window.go!.main!.App!.ReorderServers).mockResolvedValueOnce(reordered)

    await store.reorderServers({
      serverID: 1,
      sourceGroupID: null,
      targetGroupID: null,
      beforeServerID: null,
      afterServerID: 2,
    })

    expect(window.go?.main?.App?.ReorderServers).toHaveBeenCalledWith({
      serverID: 1,
      sourceGroupID: null,
      targetGroupID: null,
      beforeServerID: null,
      afterServerID: 2,
    })
    expect(store.connections.map((item) => item.id)).toEqual([2, 1])
  })

  it('reloads server rows if reorder fails so optimistic UI cannot keep a bad order', async () => {
    const store = useServerStore()
    store.connections = [connections[1], connections[0]]
    vi.mocked(window.go!.main!.App!.ReorderServers).mockRejectedValueOnce(new Error('missing group'))
    vi.mocked(window.go!.main!.App!.ListConnections).mockResolvedValueOnce(connections)

    await expect(store.reorderServers({
      serverID: 1,
      sourceGroupID: null,
      targetGroupID: 999,
      beforeServerID: null,
      afterServerID: null,
    })).rejects.toThrow('missing group')

    expect(window.go?.main?.App?.ListConnections).toHaveBeenCalled()
    expect(store.connections.map((item) => item.id)).toEqual([1, 2])
  })
})
