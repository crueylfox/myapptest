// @vitest-environment jsdom

import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useManagerToolLaunchFlow } from './useManagerToolLaunchFlow'
import type { ConnectionRuntimeState } from '../types'

const offlineState = (values: Partial<ConnectionRuntimeState> = {}): ConnectionRuntimeState => ({
  connectionId: 7,
  status: 'offline',
  monitorActive: false,
  terminalActive: false,
  terminalConnecting: false,
  sftpActive: false,
  connecting: false,
  hasActiveSession: false,
  updatedAt: '',
  ...values,
})

function createFlow(overrides: Partial<Parameters<typeof useManagerToolLaunchFlow>[0]> = {}) {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('terminals')
  const settingsOverlayOpen = ref(false)
  const toolDialogServerId = ref<number | null>(null)
  const tunnelDialogOpen = ref(false)
  const dockerDialogOpen = ref(false)
  const processDialogOpen = ref(false)
  const serviceDialogOpen = ref(false)
  const processInitialPid = ref<number | null>(null)
  const dashboardBatchOperation = ref<'connect' | 'reconnect' | 'disconnect' | null>(null)
  const states = new Map<number, ConnectionRuntimeState>([
    [7, offlineState({ status: 'online', hasActiveSession: true })],
    [8, offlineState()],
  ])
  const deps: Parameters<typeof useManagerToolLaunchFlow>[0] = {
    activeView,
    settingsOverlayOpen,
    toolDialogServerId,
    tunnelDialogOpen,
    dockerDialogOpen,
    processDialogOpen,
    serviceDialogOpen,
    processInitialPid,
    dashboardBatchOperation,
    activeNetworkServerId: computed(() => 7),
    activeWorkspaceServerId: () => 7,
    selectedServerId: () => null,
    connections: () => [
      { id: 7, name: 'online' },
      { id: 8, name: 'offline' },
    ],
    connectionState: (serverID) => states.get(serverID) ?? offlineState({ connectionId: serverID }),
    selectConnection: vi.fn(),
    closeTransientOverlays: vi.fn(),
    openMonitorPanel: vi.fn(),
    closeMonitorPanel: vi.fn(),
    openNetworkDetailsPanel: vi.fn(),
    loadNetworkInterfacePreference: vi.fn(async () => undefined),
    loadNetworkInterfaces: vi.fn(async () => undefined),
    setMonitorNetworkInterface: vi.fn(async () => undefined),
    showLogs: vi.fn(async () => undefined),
    connectServer: vi.fn(async () => undefined),
    disconnectServer: vi.fn(async () => undefined),
    editServer: vi.fn(async () => undefined),
    confirmDisconnectServers: vi.fn(async () => true),
    showToast: vi.fn(),
    errorMessage: (reason, fallback) => reason instanceof Error ? reason.message || fallback : fallback,
    ...overrides,
  }
  return {
    activeView,
    settingsOverlayOpen,
    toolDialogServerId,
    tunnelDialogOpen,
    dockerDialogOpen,
    processDialogOpen,
    serviceDialogOpen,
    processInitialPid,
    dashboardBatchOperation,
    states,
    deps,
    flow: useManagerToolLaunchFlow(deps),
  }
}

describe('useManagerToolLaunchFlow', () => {
  it('routes main navigation to settings overlay, logs refresh, monitor server selection, and normal panels', async () => {
    const ctx = createFlow()

    await ctx.flow.navigateMain('settings')
    expect(ctx.settingsOverlayOpen.value).toBe(true)

    await ctx.flow.navigateMain('logs')
    expect(ctx.deps.showLogs).toHaveBeenCalled()

    await ctx.flow.navigateMain('monitor')
    expect(ctx.deps.selectConnection).toHaveBeenCalledWith(7)
    expect(ctx.activeView.value).toBe('monitor')
  })

  it('opens process and service managers for the active connected server', async () => {
    const ctx = createFlow()

    await ctx.flow.openProcessManager(42)
    expect(ctx.deps.selectConnection).toHaveBeenCalledWith(7)
    expect(ctx.processInitialPid.value).toBe(42)
    expect(ctx.processDialogOpen.value).toBe(true)

    await ctx.flow.openServiceManager()
    expect(ctx.serviceDialogOpen.value).toBe(true)
  })

  it('blocks network tools for an inactive server without mutating sessions', async () => {
    const ctx = createFlow({ activeNetworkServerId: computed(() => 8) })

    await ctx.flow.openNetworkDiagnostics()

    expect(ctx.deps.openNetworkDetailsPanel).not.toHaveBeenCalled()
    expect(ctx.deps.disconnectServer).not.toHaveBeenCalled()
    expect(ctx.deps.showToast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  it('opens dashboard tools for the requested server and preserves inactive network guard', async () => {
    const ctx = createFlow()

    ctx.flow.openDashboardToolDialog(7, 'docker')
    expect(ctx.toolDialogServerId.value).toBe(7)
    expect(ctx.dockerDialogOpen.value).toBe(true)

    ctx.flow.openDashboardToolDialog(8, 'network')
    expect(ctx.deps.showToast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  it('refreshes and sets network interfaces through injected store callbacks', async () => {
    const ctx = createFlow()

    await ctx.flow.refreshActiveNetworkInterfaces()
    await ctx.flow.setActiveNetworkInterface('all', '')

    expect(ctx.deps.loadNetworkInterfacePreference).toHaveBeenCalledWith(7)
    expect(ctx.deps.loadNetworkInterfaces).toHaveBeenCalledWith(7)
    expect(ctx.deps.setMonitorNetworkInterface).toHaveBeenCalledWith(7, 'all', '')
  })

  it('connects and disconnects dashboard batches with a bounded concurrency helper', async () => {
    const ctx = createFlow()
    ctx.states.set(8, offlineState({ connectionId: 8, status: 'error' }))

    await ctx.flow.connectDashboardServers([8, 8], 'connect')
    expect(ctx.deps.connectServer).toHaveBeenCalledTimes(1)

    await ctx.flow.disconnectDashboardServers([7], 'selected')
    expect(ctx.deps.disconnectServer).toHaveBeenCalledTimes(1)
  })
})
