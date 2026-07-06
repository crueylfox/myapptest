import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  AlertCenterOverlayState,
  AuthOverlayState,
  ConnectionDialogOverlayState,
  ContextMenuOverlayState,
  MonitorPanelOverlayState,
  ServerPickerOverlayState,
  ToolDialogsOverlayState,
} from '../components/AppOverlayHost.vue'
import type {
  AppLogsPanelState,
  AppMonitorPanelState,
  AppSettingsPanelState,
  AppTerminalPanelState,
} from '../components/AppPanelHost.vue'
import type { AuthDialogMode } from './useAuthDialogController'
import type { PaneTargetAssignment, PendingPaneOpenTarget } from './usePaneTargetRequests'
import type { DashboardServerSummary } from '../utils/multiServerDashboard'
import type { AppPanelView } from '../utils/appPanelModel'
import { buildServerContextMenuItems } from '../utils/serverActionModel'
import type {
  AlertEvent,
  AppSettings,
  AuthRequest,
  Connection,
  ConnectionRuntimeState,
  ConnectionStatus,
  ContextMenuItem,
  DashboardSortMode,
  Group,
  LogEntry,
  LocalTerminalCapabilities,
  LocalTerminalShellKind,
  MonitorNetworkInterfaceMode,
  MonitorNetworkInterfacePreference,
  MonitorSnapshot,
  NetworkInterface,
  NativeNotificationStatus,
  ReorderServersRequest,
  SaveConnectionConfigRequest,
  TerminalProfile,
  ToastMessage,
} from '../types'

type ServerMenuState = { x: number; y: number; connectionId: number }
type ToolDialogKind = 'tunnels' | 'docker' | 'processes' | 'network'

interface StoreShellState {
  connections: Connection[]
  states: Record<number, ConnectionRuntimeState>
  groups: Group[]
  selected: Connection | null
  selectedId: number | null
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  snapshots: Record<number, MonitorSnapshot>
  histories: Record<number, MonitorSnapshot[]>
  connectionState: (connectionId: number) => ConnectionRuntimeState
  refreshConnections: () => Promise<void>
}

interface TerminalShellState {
  activeWorkspaceServerId: number | null
  workspaces: Record<number, { status?: string }>
  hasWorkspace: (connectionId: number) => boolean
}

interface TerminalProfileShellState {
  profiles: TerminalProfile[]
  defaultProfile: TerminalProfile | null | undefined
  applyRevision: number
}

interface AlertShellState {
  unreadCount: number
  activeEvents: AlertEvent[]
  resolvedEvents: AlertEvent[]
  allEvents: AlertEvent[]
  activeCountsByServerId: Record<number, number>
  markRead: (eventID: string) => unknown
  markAllRead: () => unknown
  clearResolved: () => unknown
  muteServer: (serverID: number, mode: '30m' | '2h' | 'session') => unknown
  unmuteServer: (serverID: number) => unknown
}

interface ServerPickerShellState {
  open: Ref<boolean>
  anchor: Ref<HTMLElement | null>
}

interface MonitorControllerShellState {
  closeMonitorPanel: () => unknown
  closeNetworkDetails: () => unknown
}

interface AlertCenterControllerShellState {
  close: () => unknown
}

export interface AppShellBindingSources {
  settings: Ref<AppSettings>
  busy: Ref<boolean>
  search: Ref<string>
  store: StoreShellState
  terminalStore: TerminalShellState
  terminalProfileStore: TerminalProfileShellState
  alertStore: AlertShellState
  serverPicker: ServerPickerShellState
  monitorPanelController: MonitorControllerShellState
  alertCenterController: AlertCenterControllerShellState
  activeTerminalSnapshot: ComputedRef<MonitorSnapshot | null>
  activeWorkspaceConnection: ComputedRef<Connection | null>
  activeWorkspaceState: ComputedRef<ConnectionRuntimeState | null>
  activeWorkspaceHistory: ComputedRef<MonitorSnapshot[]>
  activeWorkspaceNetworkInterfaces: ComputedRef<NetworkInterface[]>
  activeWorkspaceNetworkInterfacePreference: ComputedRef<MonitorNetworkInterfacePreference | null>
  activeWorkspaceNetworkInterfacesLoading: ComputedRef<boolean>
  localTerminalEnabled: ComputedRef<boolean>
  localTerminalCapabilities?: ComputedRef<LocalTerminalCapabilities | null>
  filteredLogs: ComputedRef<LogEntry[]>
  groupedConnections: ComputedRef<Array<{ id: number; name: string; items: Connection[] }>>
  serverStatuses: ComputedRef<Record<number, ConnectionStatus>>
  dashboardSummaries: ComputedRef<DashboardServerSummary[]>
  toolDialogActiveServerId: ComputedRef<number | null>
  authConnection: ComputedRef<Connection | null>
  logLevelFilter: Ref<string>
  logQuery: Ref<string>
  terminalLayoutRevision: Ref<number>
  sftpOpenRevision: Ref<number>
  paneTargetAssignment: Ref<PaneTargetAssignment | null>
  pendingPaneOpenTarget: Ref<PendingPaneOpenTarget | null>
  connectionDialog: Ref<boolean>
  editing: Ref<Connection | null>
  monitorPanelOpen: Ref<boolean>
  monitorPanelInitialTab: Ref<'overview' | 'detail'>
  monitorPanelInitialServerId: Ref<number | null>
  dashboardBatchOperation: Ref<'connect' | 'reconnect' | 'disconnect' | null>
  tunnelDialogOpen: Ref<boolean>
  dockerDialogOpen: Ref<boolean>
  processDialogOpen: Ref<boolean>
  serviceDialogOpen: Ref<boolean>
  networkDetailsOpen: Ref<boolean>
  networkDetailsInitialTab: Ref<'endpoints' | 'diagnostics'>
  processInitialPid: Ref<number | null>
  authDialog: Ref<boolean>
  authMode: Ref<AuthDialogMode>
  authIssue: Ref<string>
  serverMenu: Ref<ServerMenuState | null>
  alertCenterOpen: Ref<boolean>
  toast: Ref<ToastMessage | null>
  nativeNotificationStatus: Readonly<Ref<NativeNotificationStatus>>
}

export interface AppShellBindingActions {
  toggleServerPicker: (anchor: HTMLElement) => unknown
  openAlertCenter: () => unknown
  openMonitorPanel: (options?: { tab?: 'overview' | 'detail'; serverID?: number | null }) => unknown
  openTunnelDialog: () => unknown
  openDockerDialog: () => unknown
  openProcessManager: (pid?: number) => unknown
  openServiceManager: () => unknown
  openNetworkDiagnostics: () => unknown
  navigateMain: (view: AppPanelView) => unknown
  newTerminal: (connectionId?: number) => unknown
  reconnectTerminal: (sessionId: string, connectionId: number, code: string) => unknown
  editServerFromTab: (connectionId: number) => unknown
  disconnectServerById: (connectionId: number) => unknown
  disconnectServerAfterFinalTerminalClose: (connectionId: number) => unknown
  closeServerPicker: () => unknown
  showToast: (message: string, type: 'success' | 'error' | 'info', detail?: string, code?: string) => unknown
  openActiveMonitorPanel: () => unknown
  openSftpById: (connectionId: number) => unknown
  reconnectSftpById: (connectionId: number, contextId: string, terminalSessionId: string) => unknown
  setActiveNetworkInterface: (mode: MonitorNetworkInterfaceMode, selectedNetworkInterface: string) => unknown
  refreshActiveNetworkInterfaces: () => unknown
  trustWorkspaceHostKey: (connectionId: number) => unknown
  openCreateForPane: (paneId: string) => unknown
  openSavedServerPickerForPane: (paneId: string) => unknown
  openLocalTerminalForPane: (paneId: string, shellKind: LocalTerminalShellKind | string) => unknown
  connectWorkspace: (connectionId: number) => unknown
  closeSettingsOverlay: () => unknown
  saveSettings: (settings: AppSettings) => unknown
  saveSettingsAndClose: (settings: AppSettings) => unknown
  applyTheme: (mode: AppSettings['themeMode']) => unknown
  applyUIFontSize: (size: AppSettings['uiFontSize']) => unknown
  reloadAfterBackupImport: () => unknown
  keyVaultDeleted: () => unknown
  terminalProfileDeleted: () => unknown
  createTestAlert: () => unknown
  sendNativeTestNotification: () => unknown
  handleMonitorError: (error?: unknown) => unknown
  showLogs: () => unknown
  closeLogs: () => unknown
  setLogLevelFilter: (value: string) => unknown
  setLogQuery: (value: string) => unknown
  copyLogDetail: (detail: string) => unknown
  openCreate: () => unknown
  addGroup: () => unknown
  openLocalTerminalFromPicker: (shellKind: LocalTerminalShellKind | string) => unknown
  openOrActivateServer: (connection: Connection) => unknown
  connectDockerContainer: (payload: { serverID: number; containerID: string; containerName: string }) => unknown
  openEdit: (connection: Connection) => unknown
  deleteConnection: (connection: Connection) => unknown
  removeGroup: (id: number, name: string) => unknown
  reorderServer: (request: ReorderServersRequest) => unknown
  openServerMenu: (event: MouseEvent, connection: Connection) => unknown
  closeConnectionDialog: () => unknown
  saveConnection: (request: SaveConnectionConfigRequest) => unknown
  deleteSavedCredential: (connectionId: number) => unknown
  saveDashboardLayout: (payload: { sortMode: DashboardSortMode; manualServerOrder: string[] }) => unknown
  switchDashboardServer: (serverID: number) => unknown
  connectDashboardServer: (serverID: number) => unknown
  disconnectDashboardServer: (serverID: number) => unknown
  editDashboardServer: (serverID: number) => unknown
  connectDashboardServers: (serverIDs: number[]) => unknown
  reconnectDashboardServers: (serverIDs: number[]) => unknown
  disconnectDashboardServers: (serverIDs: number[], scope: 'selected' | 'filtered') => unknown
  openDashboardToolDialog: (serverID: number, kind: ToolDialogKind) => unknown
  closeAuthDialog: () => unknown
  submitAuth: (auth: AuthRequest) => unknown
  selectServerMenu: (id: string) => unknown
  handleAlertView: (event: AlertEvent) => unknown
  closeToast: () => unknown
}

export function useAppShellBindings(sources: AppShellBindingSources, actions: AppShellBindingActions) {
  const terminalPanel = computed<AppTerminalPanelState>(() => ({
    connection: sources.activeWorkspaceConnection.value,
    state: sources.activeWorkspaceState.value,
    snapshot: sources.activeTerminalSnapshot.value,
    history: sources.activeWorkspaceHistory.value,
    layoutRevision: sources.terminalLayoutRevision.value,
    sftpOpenRevision: sources.sftpOpenRevision.value,
    terminalCopyOnSelectEnabled: sources.settings.value.terminalCopyOnSelectEnabled,
    terminalRightClickPasteEnabled: sources.settings.value.terminalRightClickPasteEnabled,
    shortcutSettings: sources.settings.value.shortcutSettings,
    commandHistoryMaxEntries: sources.settings.value.commandHistoryMaxEntries,
    connections: sources.store.connections,
    connectionStates: sources.store.states,
    terminalProfiles: sources.terminalProfileStore.profiles,
    defaultTerminalProfile: sources.terminalProfileStore.defaultProfile ?? null,
    terminalProfileApplyRevision: sources.terminalProfileStore.applyRevision,
    networkInterfaces: sources.activeWorkspaceNetworkInterfaces.value,
    networkInterfacePreference: sources.activeWorkspaceNetworkInterfacePreference.value,
    networkInterfacesLoading: sources.activeWorkspaceNetworkInterfacesLoading.value,
    alertActiveCount: sources.alertStore.activeEvents.length,
    localTerminalCapabilities: sources.localTerminalCapabilities?.value ?? null,
    paneTargetAssignment: sources.paneTargetAssignment.value,
  }))

  const settingsPanel = computed<AppSettingsPanelState>(() => ({
    settings: sources.settings.value,
    saving: sources.busy.value,
    connections: sources.store.connections,
    nativeNotificationStatus: sources.nativeNotificationStatus.value,
  }))

  const monitorPanel = computed<AppMonitorPanelState>(() => ({
    selected: sources.store.selected,
    snapshot: sources.store.snapshot,
    history: sources.store.history,
    alertUnreadCount: sources.alertStore.unreadCount,
  }))

  const logsPanel = computed<AppLogsPanelState>(() => ({
    levelFilter: sources.logLevelFilter.value,
    query: sources.logQuery.value,
    entries: sources.filteredLogs.value,
  }))

  const serverPickerOverlay = computed<ServerPickerOverlayState>(() => ({
    open: sources.serverPicker.open.value,
    anchor: sources.serverPicker.anchor.value,
    groups: sources.groupedConnections.value,
    statuses: sources.serverStatuses.value,
    activeServerId: sources.terminalStore.activeWorkspaceServerId,
    localTerminalEnabled: sources.localTerminalEnabled.value,
    localTerminalCapabilities: sources.localTerminalCapabilities?.value ?? null,
    query: sources.search.value,
    targetPaneMode: sources.pendingPaneOpenTarget.value?.action === 'connect-saved',
  }))

  const connectionDialogOverlay = computed<ConnectionDialogOverlayState>(() => ({
    open: sources.connectionDialog.value,
    connection: sources.editing.value,
    groups: sources.store.groups,
    settings: sources.settings.value,
    terminalProfiles: sources.terminalProfileStore.profiles,
    connections: sources.store.connections,
  }))

  const monitorPanelOverlay = computed<MonitorPanelOverlayState>(() => ({
    open: sources.monitorPanelOpen.value,
    summaries: sources.dashboardSummaries.value,
    connections: sources.store.connections,
    selectedServerId: sources.store.selectedId,
    activeWorkspaceServerId: sources.terminalStore.activeWorkspaceServerId,
    snapshots: sources.store.snapshots,
    histories: sources.store.histories,
    initialTab: sources.monitorPanelInitialTab.value,
    initialServerId: sources.monitorPanelInitialServerId.value,
    batchOperation: sources.dashboardBatchOperation.value,
    dashboardSortMode: sources.settings.value.dashboardSortMode,
    dashboardManualServerOrder: sources.settings.value.dashboardManualServerOrder,
    activeAlertCountsByServerId: sources.alertStore.activeCountsByServerId,
    alertUnreadCount: sources.alertStore.unreadCount,
  }))

  const toolDialogsOverlay = computed<ToolDialogsOverlayState>(() => ({
    activeServerId: sources.toolDialogActiveServerId.value,
    connections: sources.store.connections,
    connectionStates: sources.store.states,
    tunnelsOpen: sources.tunnelDialogOpen.value,
    dockerOpen: sources.dockerDialogOpen.value,
    processesOpen: sources.processDialogOpen.value,
    servicesOpen: sources.serviceDialogOpen.value,
    networkDetailsOpen: sources.networkDetailsOpen.value,
    processInitialPid: sources.processInitialPid.value,
    networkDetailsInitialTab: sources.networkDetailsInitialTab.value,
  }))

  const authOverlay = computed<AuthOverlayState>(() => ({
    open: sources.authDialog.value,
    connection: sources.authConnection.value,
    mode: sources.authMode.value,
    issue: sources.authIssue.value,
  }))

  const menuConnection = computed(() =>
    sources.store.connections.find((connection) => connection.id === sources.serverMenu.value?.connectionId) ?? null)

  const serverMenuItems = computed<ContextMenuItem[]>(() => {
    const connection = menuConnection.value
    const state = connection ? sources.store.connectionState(connection.id) : null
    const connecting = state?.connecting ?? false
    const active = state?.hasActiveSession ?? false
    const workspaceStatus = connection ? sources.terminalStore.workspaces[connection.id]?.status : undefined
    const retryWorkspace = workspaceStatus === 'failed' || workspaceStatus === 'disconnected'
    return buildServerContextMenuItems({
      connecting,
      active,
      retryWorkspace,
      hasWorkspace: Boolean(connection && sources.terminalStore.hasWorkspace(connection.id)),
      hasHostKeyFingerprint: Boolean(connection?.hostKeyFingerprint),
    })
  })

  const contextMenuOverlay = computed<ContextMenuOverlayState | null>(() => sources.serverMenu.value
    ? { open: true, x: sources.serverMenu.value.x, y: sources.serverMenu.value.y, items: serverMenuItems.value }
    : null)

  const alertCenterOverlay = computed<AlertCenterOverlayState>(() => ({
    open: sources.alertCenterOpen.value,
    activeEvents: sources.alertStore.activeEvents,
    resolvedEvents: sources.alertStore.resolvedEvents,
    allEvents: sources.alertStore.allEvents,
  }))

  const topBarListeners = {
    servers: actions.toggleServerPicker,
    alerts: actions.openAlertCenter,
    monitorPanel: actions.openMonitorPanel,
    tunnels: actions.openTunnelDialog,
    docker: actions.openDockerDialog,
    processes: () => actions.openProcessManager(),
    systemServices: actions.openServiceManager,
    networkDiagnostics: actions.openNetworkDiagnostics,
    navigate: actions.navigateMain,
    newTerminal: actions.newTerminal,
    reconnect: actions.reconnectTerminal,
    editServer: actions.editServerFromTab,
    disconnectServer: actions.disconnectServerById,
    finalTerminalDisconnect: actions.disconnectServerAfterFinalTerminalClose,
    contextOpen: actions.closeServerPicker,
    notify: actions.showToast,
  }

  const panelListeners = {
    monitor: actions.openActiveMonitorPanel,
    alerts: actions.openAlertCenter,
    disconnectServer: actions.disconnectServerById,
    finalTerminalDisconnect: actions.disconnectServerAfterFinalTerminalClose,
    openSftp: actions.openSftpById,
    reconnectSftp: actions.reconnectSftpById,
    openTunnels: actions.openTunnelDialog,
    processManager: actions.openProcessManager,
    networkInterface: actions.setActiveNetworkInterface,
    networkDiagnostics: actions.openNetworkDiagnostics,
    networkInterfacesRefresh: actions.refreshActiveNetworkInterfaces,
    notify: actions.showToast,
    newTerminal: actions.newTerminal,
    reconnect: actions.reconnectTerminal,
    trustHostKey: actions.trustWorkspaceHostKey,
    paneAddServer: actions.openCreateForPane,
    paneConnectSaved: actions.openSavedServerPickerForPane,
    paneOpenLocalTerminal: actions.openLocalTerminalForPane,
    connectWorkspace: actions.connectWorkspace,
    editWorkspace: actions.editServerFromTab,
    closeSettings: actions.closeSettingsOverlay,
    saveSettings: actions.saveSettings,
    saveSettingsAndClose: actions.saveSettingsAndClose,
    previewTheme: actions.applyTheme,
    previewFontSize: actions.applyUIFontSize,
    backupImported: actions.reloadAfterBackupImport,
    keyVaultDeleted: actions.keyVaultDeleted,
    terminalProfileDeleted: actions.terminalProfileDeleted,
    testAlert: actions.createTestAlert,
    testNativeNotification: actions.sendNativeTestNotification,
    openLogs: () => {
      actions.closeSettingsOverlay()
      return actions.showLogs()
    },
    monitorError: actions.handleMonitorError,
    refreshLogs: actions.showLogs,
    closeLogs: actions.closeLogs,
    updateLogLevelFilter: actions.setLogLevelFilter,
    updateLogQuery: actions.setLogQuery,
    copyLogDetail: actions.copyLogDetail,
  }

  const overlayListeners = {
    serverPickerClose: actions.closeServerPicker,
    serverPickerQueryUpdate: (value: string) => { sources.search.value = value },
    serverPickerAddServer: actions.openCreate,
    serverPickerAddGroup: actions.addGroup,
    serverPickerOpenLocalTerminal: actions.openLocalTerminalFromPicker,
    serverPickerOpenServer: actions.openOrActivateServer,
    serverPickerEditServer: actions.openEdit,
    serverPickerDeleteServer: actions.deleteConnection,
    serverPickerDeleteGroup: (group: Group) => actions.removeGroup(group.id, group.name),
    serverPickerReorderServer: actions.reorderServer,
    serverPickerContextMenu: actions.openServerMenu,
    connectionDialogClose: actions.closeConnectionDialog,
    connectionDialogSave: actions.saveConnection,
    connectionDialogDeleteCredential: actions.deleteSavedCredential,
    monitorPanelClose: sources.monitorPanelController.closeMonitorPanel,
    dashboardLayoutChange: actions.saveDashboardLayout,
    dashboardSwitchServer: actions.switchDashboardServer,
    dashboardConnectServer: actions.connectDashboardServer,
    dashboardDisconnectServer: actions.disconnectDashboardServer,
    dashboardEditServer: actions.editDashboardServer,
    dashboardConnectServers: actions.connectDashboardServers,
    dashboardReconnectServers: actions.reconnectDashboardServers,
    dashboardDisconnectServers: actions.disconnectDashboardServers,
    dashboardOpenTunnels: (serverID: number) => actions.openDashboardToolDialog(serverID, 'tunnels'),
    dashboardOpenDocker: (serverID: number) => actions.openDashboardToolDialog(serverID, 'docker'),
    dashboardOpenProcesses: (serverID: number) => actions.openDashboardToolDialog(serverID, 'processes'),
    dashboardOpenNetworkDiagnostics: (serverID: number) => actions.openDashboardToolDialog(serverID, 'network'),
    dashboardAlerts: actions.openAlertCenter,
    closeTunnels: () => { sources.tunnelDialogOpen.value = false },
    closeDocker: () => { sources.dockerDialogOpen.value = false },
    dockerConnectContainer: actions.connectDockerContainer,
    closeProcesses: () => { sources.processDialogOpen.value = false },
    closeServices: () => { sources.serviceDialogOpen.value = false },
    closeNetworkDetails: sources.monitorPanelController.closeNetworkDetails,
    notify: actions.showToast,
    authClose: actions.closeAuthDialog,
    authSubmit: actions.submitAuth,
    contextMenuClose: () => { sources.serverMenu.value = null },
    contextMenuSelect: actions.selectServerMenu,
    alertCenterClose: sources.alertCenterController.close,
    alertMarkRead: sources.alertStore.markRead,
    alertMarkAllRead: sources.alertStore.markAllRead,
    alertClearResolved: sources.alertStore.clearResolved,
    alertMuteServer: (serverID: number, mode: '30m' | '2h' | 'session') => sources.alertStore.muteServer(serverID, mode),
    alertUnmuteServer: sources.alertStore.unmuteServer,
    alertViewMonitor: actions.handleAlertView,
    toastClose: actions.closeToast,
  }

  return {
    terminalPanel,
    settingsPanel,
    monitorPanel,
    logsPanel,
    serverPickerOverlay,
    connectionDialogOverlay,
    monitorPanelOverlay,
    toolDialogsOverlay,
    authOverlay,
    contextMenuOverlay,
    alertCenterOverlay,
    menuConnection,
    serverMenuItems,
    topBarListeners,
    panelListeners,
    overlayListeners,
  }
}
