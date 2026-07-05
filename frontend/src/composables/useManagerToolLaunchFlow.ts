import type { ComputedRef, Ref } from 'vue'
import type { AppPanelView } from '../utils/appPanelModel'
import { buildToolPanelActions, dashboardToolToAction, type DashboardToolKind } from '../utils/appToolPanelModel'
import type { ConnectionRuntimeState, DashboardSortMode, MonitorNetworkInterfaceMode } from '../types'

type ToastType = 'success' | 'error' | 'info'
type BatchOperation = 'connect' | 'reconnect' | 'disconnect'
type ToolConnection = { id: number; name?: string }
type DashboardSummary = {
  serverID: number
  status: string
}

export interface ManagerToolLaunchFlowOptions<TConnection extends ToolConnection = ToolConnection> {
  activeView: Ref<AppPanelView>
  settingsOverlayOpen: Ref<boolean>
  toolDialogServerId: Ref<number | null>
  tunnelDialogOpen: Ref<boolean>
  dockerDialogOpen: Ref<boolean>
  processDialogOpen: Ref<boolean>
  serviceDialogOpen: Ref<boolean>
  processInitialPid: Ref<number | null>
  dashboardBatchOperation: Ref<BatchOperation | null>
  activeNetworkServerId: Ref<number | null> | ComputedRef<number | null>
  activeWorkspaceServerId: () => number | null
  selectedServerId: () => number | null
  connections: () => TConnection[]
  dashboardSummaries?: () => DashboardSummary[]
  connectionState: (serverID: number) => ConnectionRuntimeState
  selectConnection: (serverID: number) => void
  closeTransientOverlays: () => void
  openMonitorPanel: (options?: { tab?: 'overview' | 'detail'; serverID?: number | null }) => void
  closeMonitorPanel?: () => void
  openNetworkDetailsPanel: (initialTab: 'endpoints' | 'diagnostics') => void
  loadNetworkInterfacePreference: (serverID: number) => Promise<void>
  loadNetworkInterfaces: (serverID: number) => Promise<void>
  setMonitorNetworkInterface: (
    serverID: number,
    mode: MonitorNetworkInterfaceMode,
    selectedNetworkInterface: string,
  ) => Promise<void>
  showLogs: () => Promise<void>
  findTerminalByConnection?: (serverID: number) => { sessionId: string } | null | undefined
  clearActiveLocalTerminal?: () => void
  activateTerminal?: (sessionId: string) => void
  connectServer: (connection: TConnection) => Promise<void>
  disconnectServer: (connection: TConnection, closeWorkspace?: boolean) => Promise<void>
  editServer: (serverID: number) => Promise<void>
  confirmDisconnectServer?: (connection: TConnection) => Promise<boolean>
  confirmDisconnectServers: (payload: {
    scope: 'selected' | 'filtered'
    count: number
  }) => Promise<boolean>
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useManagerToolLaunchFlow<TConnection extends ToolConnection>(
  options: ManagerToolLaunchFlowOptions<TConnection>,
) {
  function findConnection(serverID: number) {
    return options.connections().find((item) => item.id === serverID) ?? null
  }

  function activeServerId() {
    return options.activeWorkspaceServerId() ?? options.selectedServerId()
  }

  function hasActiveNetworkServer(serverID: number) {
    const state = options.connectionState(serverID)
    return state.monitorActive || state.terminalActive || state.sftpActive ||
      state.connecting || state.hasActiveSession || state.status === 'online'
  }

  function toolPanelActions() {
    const serverID = activeServerId()
    return buildToolPanelActions({
      hasActiveServer: Boolean(serverID),
      hasActiveNetworkServer: Boolean(serverID && hasActiveNetworkServer(serverID)),
      localTerminalEnabled: true,
    })
  }

  async function navigateMain(view: AppPanelView) {
    if (view === 'settings') {
      options.settingsOverlayOpen.value = true
      return
    }
    if (view === 'logs') {
      await options.showLogs()
      return
    }
    if (view === 'monitor' && options.activeWorkspaceServerId() !== null) {
      options.selectConnection(options.activeWorkspaceServerId()!)
    }
    options.activeView.value = view
  }

  function openMonitorPanel(panelOptions: { tab?: 'overview' | 'detail'; serverID?: number | null } = {}) {
    options.closeTransientOverlays()
    options.openMonitorPanel(panelOptions)
  }

  function openActiveMonitorPanel() {
    const serverID = options.activeWorkspaceServerId() ?? options.selectedServerId()
    if (!serverID) {
      options.showToast('请先选择一个服务器', 'error')
      return
    }
    openMonitorPanel({ tab: 'detail', serverID })
  }

  function openTunnelDialog() {
    options.toolDialogServerId.value = null
    options.closeTransientOverlays()
    options.tunnelDialogOpen.value = true
  }

  function openDockerDialog() {
    options.toolDialogServerId.value = null
    options.closeTransientOverlays()
    options.dockerDialogOpen.value = true
  }

  async function openProcessManager(pid?: number) {
    options.toolDialogServerId.value = null
    const serverID = activeServerId()
    if (!serverID) {
      options.showToast('请先连接并选择一个服务器', 'error')
      return
    }
    options.closeTransientOverlays()
    options.selectConnection(serverID)
    options.processInitialPid.value = pid ?? null
    options.processDialogOpen.value = true
  }

  async function openServiceManager() {
    options.toolDialogServerId.value = null
    const serverID = activeServerId()
    if (!serverID || !hasActiveNetworkServer(serverID)) {
      options.showToast('请先连接一台服务器。', 'error')
      return
    }
    options.closeTransientOverlays()
    options.selectConnection(serverID)
    options.serviceDialogOpen.value = true
  }

  async function openNetworkDetails(initialTab: 'endpoints' | 'diagnostics' = 'endpoints') {
    const serverID = options.activeNetworkServerId.value
    if (!serverID || !hasActiveNetworkServer(serverID)) {
      options.showToast('请先连接并选择一个服务器', 'error')
      return
    }
    options.toolDialogServerId.value = null
    options.selectConnection(serverID)
    options.closeTransientOverlays()
    options.openNetworkDetailsPanel(initialTab)
  }

  async function openNetworkDiagnostics() {
    await openNetworkDetails('endpoints')
  }

  function openDashboardToolDialog(serverID: number, tool: DashboardToolKind) {
    const connection = findConnection(serverID)
    if (!connection) {
      options.showToast('无法打开工具，该服务器配置不存在。', 'error')
      return
    }
    options.toolDialogServerId.value = serverID
    options.selectConnection(serverID)
    options.closeTransientOverlays()
    const action = dashboardToolToAction(tool)
    if (action === 'tunnels') {
      options.tunnelDialogOpen.value = true
    } else if (action === 'docker') {
      options.dockerDialogOpen.value = true
    } else if (action === 'processes') {
      options.processInitialPid.value = null
      options.processDialogOpen.value = true
    } else if (hasActiveNetworkServer(serverID)) {
      options.openNetworkDetailsPanel('diagnostics')
    } else {
      options.showToast('请先连接该服务器后再打开网络详情', 'error')
    }
  }

  async function refreshActiveNetworkInterfaces() {
    await loadActiveNetworkInterfaces(true)
  }

  async function loadActiveNetworkInterfaces(showSuccess: boolean) {
    const serverID = options.activeNetworkServerId.value
    if (!serverID) {
      options.showToast('请先连接并选择一个服务器', 'error')
      return
    }
    try {
      await options.loadNetworkInterfacePreference(serverID)
      await options.loadNetworkInterfaces(serverID)
      if (showSuccess) options.showToast('网络接口已刷新', 'success')
    } catch (reason) {
      options.showToast(options.errorMessage(reason, '读取网络接口失败'), 'error')
    }
  }

  async function setActiveNetworkInterface(
    mode: MonitorNetworkInterfaceMode,
    selectedNetworkInterface: string,
  ) {
    const serverID = options.activeNetworkServerId.value
    if (!serverID) {
      options.showToast('请先连接并选择一个服务器', 'error')
      return
    }
    try {
      await options.setMonitorNetworkInterface(serverID, mode, selectedNetworkInterface)
      options.showToast(`已切换网络接口：${mode === 'all' ? '全部接口' : selectedNetworkInterface}`, 'success')
    } catch (reason) {
      options.showToast(options.errorMessage(reason, '切换网络接口失败'), 'error')
    }
  }

  function switchDashboardServer(serverID: number) {
    const connection = findConnection(serverID)
    if (!connection) return
    options.selectConnection(connection.id)
    const tab = options.findTerminalByConnection?.(connection.id)
    if (!tab) {
      options.showToast('该服务器未打开终端', 'info')
      return
    }
    options.clearActiveLocalTerminal?.()
    options.activateTerminal?.(tab.sessionId)
    options.activeView.value = 'terminals'
    options.closeMonitorPanel?.()
  }

  async function connectDashboardServer(serverID: number) {
    const connection = findConnection(serverID)
    if (connection) await options.connectServer(connection)
  }

  async function disconnectDashboardServer(serverID: number) {
    const connection = findConnection(serverID)
    if (!connection) return
    const confirmed = options.confirmDisconnectServer
      ? await options.confirmDisconnectServer(connection)
      : await options.confirmDisconnectServers({ scope: 'selected', count: 1 })
    if (!confirmed) return
    await options.disconnectServer(connection, false)
  }

  async function editDashboardServer(serverID: number) {
    options.closeMonitorPanel?.()
    await options.editServer(serverID)
  }

  function dashboardSummary(serverID: number) {
    return options.dashboardSummaries?.().find((summary) => summary.serverID === serverID) ?? {
      serverID,
      status: options.connectionState(serverID).status,
    }
  }

  async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
    let index = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++]
        await task(item)
      }
    })
    await Promise.all(workers)
  }

  async function connectDashboardServers(serverIDs: number[], mode: Extract<BatchOperation, 'connect' | 'reconnect'> = 'connect') {
    if (options.dashboardBatchOperation.value) return
    const uniqueIds = Array.from(new Set(serverIDs))
    const summaries = uniqueIds
      .map((serverID) => dashboardSummary(serverID))
      .filter((summary): summary is DashboardSummary => Boolean(summary))
    const targets = summaries.filter((summary) => summary.status === 'offline' || summary.status === 'error')
    const skipped = Math.max(summaries.length - targets.length, 0)
    if (targets.length === 0) {
      options.showToast(mode === 'reconnect'
        ? '没有需要重连的离线服务器'
        : `已开始连接 0 台，跳过 ${skipped} 台已在线服务器`, 'info')
      return
    }
    options.dashboardBatchOperation.value = mode
    try {
      await runWithConcurrency(targets, 3, async (summary) => {
        const connection = findConnection(summary.serverID)
        if (connection) await options.connectServer(connection)
      })
      options.showToast(mode === 'reconnect'
        ? `已开始重连 ${targets.length} 台，跳过 ${skipped} 台在线服务器`
        : `已开始连接 ${targets.length} 台，跳过 ${skipped} 台已在线服务器`, 'success')
    } finally {
      options.dashboardBatchOperation.value = null
    }
  }

  async function reconnectDashboardServers(serverIDs: number[]) {
    await connectDashboardServers(serverIDs, 'reconnect')
  }

  async function disconnectDashboardServers(serverIDs: number[], scope: 'selected' | 'filtered') {
    if (options.dashboardBatchOperation.value) return
    const uniqueIds = Array.from(new Set(serverIDs))
    const summaries = uniqueIds
      .map((serverID) => dashboardSummary(serverID))
      .filter((summary): summary is DashboardSummary => Boolean(summary))
    const targets = summaries.filter((summary) => summary.status === 'online' || summary.status === 'connecting')
    const skipped = Math.max(summaries.length - targets.length, 0)
    if (targets.length === 0) {
      options.showToast(`已断开 0 台，跳过 ${skipped} 台离线服务器`, 'info')
      return
    }
    if (!await options.confirmDisconnectServers({ scope, count: targets.length })) return
    options.dashboardBatchOperation.value = 'disconnect'
    try {
      await runWithConcurrency(targets, 3, async (summary) => {
        const connection = findConnection(summary.serverID)
        if (connection) await options.disconnectServer(connection, false)
      })
      options.showToast(`已断开 ${targets.length} 台，跳过 ${skipped} 台离线服务器`, 'success')
    } finally {
      options.dashboardBatchOperation.value = null
    }
  }

  return {
    toolPanelActions,
    navigateMain,
    openMonitorPanel,
    openActiveMonitorPanel,
    openTunnelDialog,
    openDockerDialog,
    openProcessManager,
    openServiceManager,
    openNetworkDetails,
    openNetworkDiagnostics,
    openDashboardToolDialog,
    hasActiveNetworkServer,
    refreshActiveNetworkInterfaces,
    loadActiveNetworkInterfaces,
    setActiveNetworkInterface,
    switchDashboardServer,
    connectDashboardServer,
    disconnectDashboardServer,
    editDashboardServer,
    connectDashboardServers,
    reconnectDashboardServers,
    disconnectDashboardServers,
  }
}
