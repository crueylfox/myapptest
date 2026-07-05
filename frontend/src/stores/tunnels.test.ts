// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useTunnelStore } from './tunnels'
import type { SaveTunnelProfileRequest, TunnelRuntime } from '../types'

const runtime = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => runtime.callbacks.set(name, callback)),
  EventsOff: vi.fn((name: string) => runtime.callbacks.delete(name)),
}))

const profile: SaveTunnelProfileRequest = {
  id: 1,
  name: 'web',
  serverID: 7,
  type: 'local',
  bindHost: '127.0.0.1',
  bindPort: 8080,
  targetHost: '127.0.0.1',
  targetPort: 80,
  remoteBindHost: '',
  remoteBindPort: 0,
  autoStart: false,
}

function tunnel(values: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    tunnelID: 'tun-1',
    serverID: 7,
    profileID: 1,
    name: 'web',
    type: 'local',
    status: 'running',
    bindHost: '127.0.0.1',
    bindPort: 8080,
    targetHost: '127.0.0.1',
    targetPort: 80,
    remoteBindHost: '',
    remoteBindPort: 0,
    requestedListen: '',
    actualListen: '',
    effectiveRemoteBindHost: '',
    effectiveListenAddrs: [],
    remoteListenExposure: 'unknown',
    remoteListenCheckStatus: 'unchecked',
    remoteListenWarning: '',
    testCommand: '',
    activeConnections: 0,
    bytesIn: 0,
    bytesOut: 0,
    startedAt: '2026-06-18T00:00:00Z',
    updatedAt: '2026-06-18T00:00:00Z',
    error: '',
    ...values,
  }
}

describe('tunnel store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtime.callbacks.clear()
    window.go = {
      main: {
        App: {
          ListTunnelProfiles: vi.fn(async () => [{ ...profile, createdAt: '', updatedAt: '' }]),
          CreateTunnelProfile: vi.fn(async (request: SaveTunnelProfileRequest) => ({
            ...request,
            id: 2,
            createdAt: '',
            updatedAt: '',
          })),
          UpdateTunnelProfile: vi.fn(async (request: SaveTunnelProfileRequest) => ({
            ...request,
            createdAt: '',
            updatedAt: '',
          })),
          DeleteTunnelProfile: vi.fn(async () => undefined),
          ListTunnels: vi.fn(async () => []),
          StartTunnel: vi.fn(async () => tunnel()),
          StopTunnel: vi.fn(async () => undefined),
          RestartTunnel: vi.fn(async () => tunnel({ tunnelID: 'tun-2' })),
          GetTunnelState: vi.fn(async () => tunnel()),
          CheckTunnelRemoteListen: vi.fn(async () => tunnel({
            type: 'remote',
            remoteBindHost: '0.0.0.0',
            remoteBindPort: 12380,
            requestedListen: '0.0.0.0:12380',
            actualListen: '0.0.0.0:12380',
            effectiveRemoteBindHost: '0.0.0.0',
            effectiveListenAddrs: ['0.0.0.0:12380'],
            remoteListenExposure: 'public',
            remoteListenCheckStatus: 'listening',
            testCommand: 'ssh -p 12380 root@192.0.2.7',
          })),
          InspectRemoteForwardAccess: vi.fn(async () => ({
            serverID: 7,
            sshdType: 'openssh',
            configPath: '/etc/ssh/sshd_config',
            gatewayPortsEffective: 'no',
            allowTcpForwardingEffective: 'yes',
            canModify: true,
            requiresSudo: false,
            warnings: [],
          })),
          EnableRemoteForwardAccess: vi.fn(async () => ({
            success: true,
            backupPath: '/etc/ssh/sshd_config.serverpilot.bak.20260618210000',
            changedFiles: ['/etc/ssh/sshd_config'],
            reloadCommand: 'systemctl reload sshd',
            message: 'GatewayPorts yes 已启用。',
            warnings: [],
          })),
        } as never,
      },
    }
  })

  it('loads and saves non-sensitive tunnel profiles', async () => {
    const store = useTunnelStore()
    await store.loadProfiles()
    expect(store.profilesForServer(7)).toHaveLength(1)
    const saved = await store.saveProfile({ ...profile, id: 0, name: 'api' })
    expect(saved.id).toBe(2)
    expect(window.go?.main?.App?.CreateTunnelProfile).toHaveBeenCalled()
    await store.deleteProfile(2)
    expect(window.go?.main?.App?.DeleteTunnelProfile).toHaveBeenCalledWith(2)
  })

  it('starts and stops tunnels through typed backend requests', async () => {
    const store = useTunnelStore()
    const started = await store.start({
      serverID: 7,
      profileID: 1,
      type: 'local',
      name: 'web',
      bindHost: '127.0.0.1',
      bindPort: 8080,
      targetHost: '127.0.0.1',
      targetPort: 80,
      remoteBindHost: '',
      remoteBindPort: 0,
      confirmPublicBind: false,
      auth: { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false },
    })
    expect(started.tunnelID).toBe('tun-1')
    expect(store.runningCount(7)).toBe(1)
    await store.stop(7, 'tun-1')
    expect(window.go?.main?.App?.StopTunnel).toHaveBeenCalledWith({ serverID: 7, tunnelID: 'tun-1' })
    expect(store.runtimesById['tun-1'].status).toBe('stopped')
  })

  it('rechecks remote listen through typed backend requests', async () => {
    const store = useTunnelStore()
    const updated = await store.checkRemoteListen(7, 'tun-1')
    expect(window.go?.main?.App?.CheckTunnelRemoteListen).toHaveBeenCalledWith({ serverID: 7, tunnelID: 'tun-1' })
    expect(updated.remoteListenCheckStatus).toBe('listening')
    expect(store.runtimesById['tun-1'].actualListen).toBe('0.0.0.0:12380')
  })

  it('passes remote access inspect and enable requests through typed backend calls', async () => {
    const store = useTunnelStore()
    const request = {
      serverID: 7,
      tunnelID: 'tun-1',
      remoteBindHost: '0.0.0.0',
      remoteBindPort: 12380,
    }
    const inspect = await store.inspectRemoteForwardAccess(request)
    const enabled = await store.enableRemoteForwardAccess(request)
    expect(window.go?.main?.App?.InspectRemoteForwardAccess).toHaveBeenCalledWith(request)
    expect(window.go?.main?.App?.EnableRemoteForwardAccess).toHaveBeenCalledWith(request)
    expect(inspect.sshdType).toBe('openssh')
    expect(enabled.backupPath).toContain('serverpilot.bak')
  })

  it('applies state, traffic, and error events by tunnel id', () => {
    const store = useTunnelStore()
    store.subscribe()
    runtime.callbacks.get('tunnel:state')?.({
      serverID: 7,
      tunnelID: 'tun-1',
      state: tunnel(),
      timestamp: '2026-06-18T00:00:00Z',
    })
    runtime.callbacks.get('tunnel:traffic')?.({
      serverID: 7,
      tunnelID: 'tun-1',
      activeConnections: 2,
      bytesIn: 10,
      bytesOut: 20,
      timestamp: '2026-06-18T00:00:01Z',
    })
    expect(store.runtimesById['tun-1'].activeConnections).toBe(2)
    expect(store.runtimesById['tun-1'].bytesOut).toBe(20)
    runtime.callbacks.get('tunnel:error')?.({
      serverID: 7,
      tunnelID: 'tun-1',
      code: 'TUNNEL_ERROR',
      message: '端口转发失败',
      timestamp: '2026-06-18T00:00:02Z',
    })
    expect(store.lastError?.message).toBe('端口转发失败')
    expect(store.runtimesById['tun-1'].status).toBe('failed')
  })

  it('clears only the target server runtimes after server disconnect', () => {
    const store = useTunnelStore()
    store.runtimesById = {
      'tun-1': tunnel({ tunnelID: 'tun-1', serverID: 7 }),
      'tun-2': tunnel({ tunnelID: 'tun-2', serverID: 8 }),
    }
    store.clearServer(7)
    expect(store.runtimesById['tun-1']).toBeUndefined()
    expect(store.runtimesById['tun-2']).toBeTruthy()
  })

  it('removes deleted profile runtimes and ignores late state events for that profile', async () => {
    const store = useTunnelStore()
    store.subscribe()
    store.runtimesById = {
      'tun-1': tunnel({ tunnelID: 'tun-1', profileID: 1 }),
      'tun-2': tunnel({ tunnelID: 'tun-2', profileID: 2 }),
    }

    await store.deleteProfile(1)
    expect(store.runtimesById['tun-1']).toBeUndefined()
    expect(store.runtimesById['tun-2']).toBeTruthy()

    runtime.callbacks.get('tunnel:state')?.({
      serverID: 7,
      tunnelID: 'tun-late',
      state: tunnel({ tunnelID: 'tun-late', profileID: 1 }),
      timestamp: '2026-06-18T00:00:03Z',
    })
    expect(store.runtimesById['tun-late']).toBeUndefined()
  })
})
