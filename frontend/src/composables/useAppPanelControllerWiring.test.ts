import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppPanelControllerWiring } from './useAppPanelControllerWiring'
import type { Connection, ConnectionRuntimeState } from '../types'

const connection = (id = 7): Connection => ({
  id,
  groupId: null,
  name: `server-${id}`,
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  terminalProfileId: null,
  connectionMode: 'direct',
  jumpServerId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
})

const runtimeState = (overrides: Partial<ConnectionRuntimeState> = {}) => ({
  connectionId: 7,
  status: 'online',
  monitorActive: true,
  terminalActive: true,
  sftpActive: false,
  connecting: false,
  hasActiveSession: true,
  lastUpdated: '',
  ...overrides,
}) as ConnectionRuntimeState

function createWiring(overrides: Partial<Parameters<typeof useAppPanelControllerWiring>[0]> = {}) {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('terminals')
  const settingsOverlayOpen = ref(false)
  const serverMenu = ref<{ x: number; y: number; connectionId: number } | null>(null)
  const tunnelDialogOpen = ref(false)
  const dockerDialogOpen = ref(false)
  const processDialogOpen = ref(false)
  const serviceDialogOpen = ref(false)
  const processInitialPid = ref<number | null>(null)
  const dashboardBatchOperation = ref<'connect' | 'reconnect' | 'disconnect' | null>(null)
  const deps: Parameters<typeof useAppPanelControllerWiring>[0] = {
    activeView,
    settingsOverlayOpen,
    toolDialogServerId: ref<number | null>(null),
    tunnelDialogOpen,
    dockerDialogOpen,
    processDialogOpen,
    serviceDialogOpen,
    processInitialPid,
    dashboardBatchOperation,
    activeNetworkServerId: computed(() => 7),
    serverMenu,
    activeWorkspaceServerId: () => 7,
    selectedServerId: () => 7,
    connections: () => [connection(7)],
    dashboardSummaries: () => [{ serverID: 7, status: 'online' }],
    connectionState: () => runtimeState(),
    workspaceStatus: () => 'online',
    selectConnection: vi.fn(),
    closeTransientOverlays: vi.fn(),
    openMonitorPanel: vi.fn(),
    closeMonitorPanel: vi.fn(),
    openNetworkDetailsPanel: vi.fn(),
    loadNetworkInterfacePreference: vi.fn(async () => undefined),
    loadNetworkInterfaces: vi.fn(async () => undefined),
    setMonitorNetworkInterface: vi.fn(async () => undefined),
    showLogs: vi.fn(async () => undefined),
    findTerminalByConnection: vi.fn(() => ({ sessionId: 'ssh-7' })),
    clearActiveLocalTerminal: vi.fn(),
    activateTerminal: vi.fn(),
    openTerminalFromMenu: vi.fn(async () => undefined),
    newTerminal: vi.fn(async () => undefined),
    openSftpForConnection: vi.fn(async () => undefined),
    activateServer: vi.fn(async () => undefined),
    connectServer: vi.fn(async () => undefined),
    reconnectServer: vi.fn(async () => undefined),
    disconnectServer: vi.fn(async () => undefined),
    editServerFromTab: vi.fn(async () => undefined),
    openEdit: vi.fn(async () => undefined),
    duplicateConnection: vi.fn(async () => undefined),
    trustHostKeyAndRun: vi.fn(async () => undefined),
    deleteConnection: vi.fn(async () => undefined),
    confirmDialog: vi.fn(async () => true),
    showToast: vi.fn(),
    errorMessage: vi.fn((reason, fallback) => reason instanceof Error ? reason.message : fallback),
    ...overrides,
  }
  return {
    deps,
    activeView,
    settingsOverlayOpen,
    serverMenu,
    tunnelDialogOpen,
    dockerDialogOpen,
    processDialogOpen,
    serviceDialogOpen,
    processInitialPid,
    dashboardBatchOperation,
    wiring: useAppPanelControllerWiring(deps),
  }
}

describe('useAppPanelControllerWiring', () => {
  it('wires server context menu actions through existing injected callbacks', async () => {
    const ctx = createWiring()
    const event = { clientX: 10, clientY: 20 } as MouseEvent

    ctx.wiring.openServerMenu(event, connection(7))
    expect(ctx.deps.selectConnection).toHaveBeenCalledWith(7)
    expect(ctx.serverMenu.value).toEqual({ x: 10, y: 20, connectionId: 7 })

    await ctx.wiring.selectServerMenu('open-terminal')
    await ctx.wiring.selectServerMenu('sftp')
    await ctx.wiring.selectServerMenu('monitor')

    expect(ctx.deps.openTerminalFromMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
    expect(ctx.deps.openSftpForConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
    expect(ctx.deps.selectConnection).toHaveBeenCalledWith(7)
    expect(ctx.activeView.value).toBe('monitor')
  })

  it('wires manager panel open and no-active-server behavior without touching runtime lifecycles', async () => {
    const noActive = createWiring({
      activeWorkspaceServerId: () => null,
      selectedServerId: () => null,
      activeNetworkServerId: computed(() => null),
    })

    await noActive.wiring.openProcessManager()
    expect(noActive.processDialogOpen.value).toBe(false)
    expect(noActive.deps.showToast).toHaveBeenCalled()
    expect(noActive.deps.openTerminalFromMenu).not.toHaveBeenCalled()

    const active = createWiring()
    active.wiring.openTunnelDialog()
    active.wiring.openDockerDialog()
    await active.wiring.openProcessManager(123)

    expect(active.tunnelDialogOpen.value).toBe(true)
    expect(active.dockerDialogOpen.value).toBe(true)
    expect(active.processDialogOpen.value).toBe(true)
    expect(active.processInitialPid.value).toBe(123)
  })

  it('wires dashboard server actions and confirmation callbacks to existing manager flow', async () => {
    const ctx = createWiring()

    ctx.wiring.switchDashboardServer(7)
    await ctx.wiring.connectDashboardServer(7)
    await ctx.wiring.disconnectDashboardServer(7)
    await ctx.wiring.editDashboardServer(7)

    expect(ctx.deps.clearActiveLocalTerminal).toHaveBeenCalled()
    expect(ctx.deps.activateTerminal).toHaveBeenCalledWith('ssh-7')
    expect(ctx.deps.connectServer).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
    expect(ctx.deps.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ danger: true }))
    expect(ctx.deps.disconnectServer).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), false)
    expect(ctx.deps.editServerFromTab).toHaveBeenCalledWith(7)
  })
})
