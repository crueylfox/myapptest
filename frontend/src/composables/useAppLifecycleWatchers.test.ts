// @vitest-environment jsdom

import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppLifecycleWatchers } from './useAppLifecycleWatchers'
import type { AppSettings, ConnectionRuntimeState, MonitorSnapshot, TerminalStatusEvent } from '../types'

const auth = {
  password: '',
  passphrase: '',
  trustUnknownHost: false,
  rememberSecret: false,
}

function createFlow() {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const terminalLayoutRevision = ref(0)
  const terminalLastStatus = ref<TerminalStatusEvent | null>(null)
  const states = ref<Record<number, ConnectionRuntimeState>>({})
  const snapshots = ref<Record<number, MonitorSnapshot>>({})
  const settings = ref({ defaultTerminalProfileId: 'default' } as AppSettings)
  const defaultProfileId = ref('default')
  const activeNetworkServerId = ref<number | null>(null)
  const monitorActive = ref(false)
  const deps: Parameters<typeof useAppLifecycleWatchers>[0] = {
    alertPersistenceWarning: ref(''),
    terminalLastStatus,
    activeView,
    terminalLayoutRevision,
    activeNetworkServerId: () => activeNetworkServerId.value,
    activeWorkspaceMonitorActive: () => monitorActive.value,
    terminalProfileDefaultProfileId: () => defaultProfileId.value,
    settings,
    tunnelLastError: ref(null),
    dockerLastError: ref(null),
    connectionStates: () => states.value,
    snapshots: () => snapshots.value,
    connections: () => [{ id: 7, name: 'server' }] as never,
    resolveTerminalStatusReconnectIntent: vi.fn(() => ({ type: 'noop' as const })),
    loadConnections: vi.fn(async () => undefined),
    reconnectFileContextsAfterTerminalOnline: vi.fn(async () => undefined),
    emptyAuth: () => auth,
    showConnectionError: vi.fn(),
    loadNetworkInterfacePreference: vi.fn(async () => undefined),
    loadNetworkInterfaces: vi.fn(async () => undefined),
    handleAlertNotifications: vi.fn(),
    ingestConnectionState: vi.fn(() => []),
    syncConnectionState: vi.fn(),
    refreshConnections: vi.fn(async () => undefined),
    setMonitorNetworkInterface: vi.fn(async () => undefined),
    ingestSnapshot: vi.fn(() => []),
    showToast: vi.fn(),
    logRefreshSecurityStateError: vi.fn(),
  }
  return { activeView, terminalLayoutRevision, terminalLastStatus, states, snapshots, settings, defaultProfileId, activeNetworkServerId, monitorActive, deps }
}

describe('useAppLifecycleWatchers', () => {
  it('moves active terminal view and terminal online events through injected callbacks', async () => {
    const ctx = createFlow()
    const scope = effectScope()
    scope.run(() => useAppLifecycleWatchers(ctx.deps))

    ctx.activeView.value = 'terminals'
    ctx.terminalLastStatus.value = { status: 'online', connectionId: 7, sessionId: 'ssh-1', code: '', message: '', active: true }
    await nextTick()

    expect(ctx.terminalLayoutRevision.value).toBe(1)
    expect(ctx.deps.loadConnections).toHaveBeenCalled()
    expect(ctx.deps.showConnectionError).not.toHaveBeenCalled()
    scope.stop()
  })

  it('reconnects file contexts on terminal online when the active context bridge asks for it', async () => {
    const ctx = createFlow()
    ctx.deps.resolveTerminalStatusReconnectIntent = vi.fn(() => ({
      type: 'reconnect-file-contexts' as const,
      connectionId: 7,
      terminalSessionId: 'ssh-1',
    }))
    const scope = effectScope()
    scope.run(() => useAppLifecycleWatchers(ctx.deps))

    ctx.terminalLastStatus.value = { status: 'online', connectionId: 7, sessionId: 'ssh-1', code: '', message: '', active: true }
    await nextTick()

    expect(ctx.deps.reconnectFileContextsAfterTerminalOnline).toHaveBeenCalledWith(7, 'ssh-1', auth)
    scope.stop()
  })

  it('stops watcher reactions after dispose', async () => {
    const ctx = createFlow()
    const scope = effectScope()
    const flow = scope.run(() => useAppLifecycleWatchers(ctx.deps))!
    flow.stop()

    ctx.activeView.value = 'terminals'
    ctx.defaultProfileId.value = 'profile-b'
    await nextTick()

    expect(ctx.terminalLayoutRevision.value).toBe(0)
    expect(ctx.settings.value.defaultTerminalProfileId).toBe('default')
    scope.stop()
  })
})
