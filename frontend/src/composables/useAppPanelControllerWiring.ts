import type { ComputedRef, Ref } from 'vue'
import { useManagerToolLaunchFlow } from './useManagerToolLaunchFlow'
import { useServerContextMenuController, type ServerMenuState } from './useServerContextMenuController'
import type { AppPanelView } from '../utils/appPanelModel'
import type {
  Connection,
  ConnectionRuntimeState,
  MonitorNetworkInterfaceMode,
} from '../types'

type ToastType = 'success' | 'error' | 'info'
type BatchOperation = 'connect' | 'reconnect' | 'disconnect'
type DashboardSummary = {
  serverID: number
  status: string
}

export interface AppPanelControllerWiringOptions {
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
  serverMenu: Ref<ServerMenuState | null>
  activeWorkspaceServerId: () => number | null
  selectedServerId: () => number | null
  connections: () => Connection[]
  dashboardSummaries: () => DashboardSummary[]
  connectionState: (serverID: number) => ConnectionRuntimeState
  workspaceStatus: (serverID: number) => string | undefined
  selectConnection: (serverID: number) => void
  closeTransientOverlays: () => void
  openMonitorPanel: (options?: { tab?: 'overview' | 'detail'; serverID?: number | null }) => void
  closeMonitorPanel: () => void
  openNetworkDetailsPanel: (initialTab: 'endpoints' | 'diagnostics') => void
  loadNetworkInterfacePreference: (serverID: number) => Promise<void>
  loadNetworkInterfaces: (serverID: number) => Promise<void>
  setMonitorNetworkInterface: (
    serverID: number,
    mode: MonitorNetworkInterfaceMode,
    selectedNetworkInterface: string,
  ) => Promise<void>
  showLogs: () => Promise<void>
  findTerminalByConnection: (serverID: number) => { sessionId: string } | null | undefined
  clearActiveLocalTerminal: () => void
  activateTerminal: (sessionId: string) => void
  openTerminalFromMenu: (connection: Connection) => unknown | Promise<unknown>
  newTerminal: (connectionId?: number) => unknown | Promise<unknown>
  openSftpForConnection: (connection: Connection) => unknown | Promise<unknown>
  activateServer: (connection: Connection) => unknown | Promise<unknown>
  connectServer: (connection: Connection) => Promise<void>
  reconnectServer: (connection: Connection) => unknown | Promise<unknown>
  disconnectServer: (connection: Connection, closeWorkspace?: boolean) => Promise<void>
  editServerFromTab: (serverID: number) => Promise<void>
  openEdit: (connection: Connection) => unknown | Promise<unknown>
  duplicateConnection: (connection: Connection) => unknown | Promise<unknown>
  trustHostKeyAndRun: (connection: Connection) => unknown | Promise<unknown>
  deleteConnection: (connection: Connection) => unknown | Promise<unknown>
  confirmDialog: (request: {
    title: string
    message: string
    confirmText: string
    danger?: boolean
  }) => Promise<boolean>
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useAppPanelControllerWiring(options: AppPanelControllerWiringOptions) {
  function findConnection(serverID: number) {
    return options.connections().find((connection) => connection.id === serverID) ?? null
  }

  const serverContextMenuController = useServerContextMenuController({
    serverMenu: options.serverMenu,
    menuConnection: () => {
      const connectionId = options.serverMenu.value?.connectionId
      return connectionId === undefined ? null : findConnection(connectionId)
    },
    retryWorkspace: (connection) => {
      const status = options.workspaceStatus(connection.id)
      return status === 'failed' || status === 'disconnected'
    },
    selectConnection: options.selectConnection,
    openTerminalFromMenu: options.openTerminalFromMenu,
    newTerminal: options.newTerminal,
    openSftpForConnection: options.openSftpForConnection,
    openMonitor: (connection) => {
      options.selectConnection(connection.id)
      options.activeView.value = 'monitor'
    },
    activateServer: options.activateServer,
    connectServer: options.connectServer,
    reconnectServer: options.reconnectServer,
    disconnectServer: options.disconnectServer,
    openEdit: options.openEdit,
    duplicateConnection: options.duplicateConnection,
    closeWorkspace: (connection) => options.disconnectServer(connection),
    resetHostTrust: options.trustHostKeyAndRun,
    deleteConnection: options.deleteConnection,
  })

  const managerToolLaunchFlow = useManagerToolLaunchFlow<Connection>({
    activeView: options.activeView,
    settingsOverlayOpen: options.settingsOverlayOpen,
    toolDialogServerId: options.toolDialogServerId,
    tunnelDialogOpen: options.tunnelDialogOpen,
    dockerDialogOpen: options.dockerDialogOpen,
    processDialogOpen: options.processDialogOpen,
    serviceDialogOpen: options.serviceDialogOpen,
    processInitialPid: options.processInitialPid,
    dashboardBatchOperation: options.dashboardBatchOperation,
    activeNetworkServerId: options.activeNetworkServerId,
    activeWorkspaceServerId: options.activeWorkspaceServerId,
    selectedServerId: options.selectedServerId,
    connections: options.connections,
    dashboardSummaries: options.dashboardSummaries,
    connectionState: options.connectionState,
    selectConnection: options.selectConnection,
    closeTransientOverlays: options.closeTransientOverlays,
    openMonitorPanel: options.openMonitorPanel,
    closeMonitorPanel: options.closeMonitorPanel,
    openNetworkDetailsPanel: options.openNetworkDetailsPanel,
    loadNetworkInterfacePreference: options.loadNetworkInterfacePreference,
    loadNetworkInterfaces: options.loadNetworkInterfaces,
    setMonitorNetworkInterface: options.setMonitorNetworkInterface,
    showLogs: options.showLogs,
    findTerminalByConnection: options.findTerminalByConnection,
    clearActiveLocalTerminal: options.clearActiveLocalTerminal,
    activateTerminal: options.activateTerminal,
    connectServer: options.connectServer,
    disconnectServer: options.disconnectServer,
    editServer: options.editServerFromTab,
    confirmDisconnectServer: (connection) => options.confirmDialog({
      title: '断开服务器',
      message: `确定断开服务器「${connection.name}」吗？`,
      confirmText: '断开',
      danger: true,
    }),
    confirmDisconnectServers: ({ scope, count }) => options.confirmDialog({
      title: '批量断开服务器',
      message: scope === 'selected'
        ? `确定断开选中的 ${count} 台服务器吗？`
        : `确定断开当前筛选结果中的 ${count} 台在线服务器吗？`,
      confirmText: '断开',
      danger: true,
    }),
    showToast: options.showToast,
    errorMessage: options.errorMessage,
  })

  return {
    ...serverContextMenuController,
    ...managerToolLaunchFlow,
  }
}
