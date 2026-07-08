<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppOverlayHost from './components/AppOverlayHost.vue'
import AppPanelHost from './components/AppPanelHost.vue'
import AppShell from './components/AppShell.vue'
import AppStatusBar from './components/AppStatusBar.vue'
import AppTopBar from './components/AppTopBar.vue'
import { api } from './api/backend'
import { useToast } from './composables/useToast'
import { confirmDialog, inputDialog } from './composables/useAppDialog'
import { useAlertCenterController } from './composables/useAlertCenterController'
import { useAppLogsController } from './composables/useAppLogsController'
import { useMonitorPanelController } from './composables/useMonitorPanelController'
import { useServerPickerController } from './composables/useServerPickerController'
import { useAppShellBindings } from './composables/useAppShellBindings'
import { usePaneTargetRequests } from './composables/usePaneTargetRequests'
import { useConnectionDialogFlow } from './composables/useConnectionDialogFlow'
import { useAuthDialogFlow } from './composables/useAuthDialogFlow'
import { useHostKeyTrustFlow } from './composables/useHostKeyTrustFlow'
import { useAppStartupFlow } from './composables/useAppStartupFlow'
import { useAppEventSubscriptions } from './composables/useAppEventSubscriptions'
import { useAppLifecycleWatchers } from './composables/useAppLifecycleWatchers'
import { useAppMenuActions } from './composables/useAppMenuActions'
import { useAppPanelControllerWiring } from './composables/useAppPanelControllerWiring'
import { useAppRuntimeViewModel } from './composables/useAppRuntimeViewModel'
import { createWailsNativeNotificationRuntime } from './composables/nativeNotificationRuntime'
import { useNativeAlertNotifications } from './composables/useNativeAlertNotifications'
import { createEmptyAuth, useAppServerRuntimeWiring } from './composables/useAppServerRuntimeWiring'
import { useLocalTerminalLaunchFlow } from './composables/useLocalTerminalLaunchFlow'
import { useSettingsPanelFlow } from './composables/useSettingsPanelFlow'
import { useBackupRestoreFlow } from './composables/useBackupRestoreFlow'
import { useKeyVaultPanelFlow } from './composables/useKeyVaultPanelFlow'
import { useSftpActiveContextBridge } from './composables/useSftpActiveContextBridge'
import { useGlobalShortcutBridge } from './composables/useGlobalShortcutBridge'
import { useDockerContainerTerminalFlow } from './composables/useDockerContainerTerminalFlow'
import { getInitialSettings } from './settingsBootstrap'
import { useServerStore } from './stores/server'
import { useSftpStore } from './stores/sftp'
import { useTerminalStore } from './stores/terminal'
import { useLocalTerminalStore } from './stores/localTerminal'
import { useTunnelStore } from './stores/tunnels'
import { useDockerStore } from './stores/docker'
import { useProcessStore } from './stores/processes'
import { useTerminalProfileStore } from './stores/terminalProfiles'
import { useAlertStore } from './stores/alerts'
import type { AppSettings, Connection } from './types'
import { applyUIFontSize } from './utils/appearance'
import { applyTheme, stopThemeSync } from './utils/theme'
import { installUiDragSelectionGuard } from './utils/uiDragSelectionGuard'
import { createDefaultAppSettings } from './utils/defaultAppSettings'
import type { AppPanelView } from './utils/appPanelModel'

const store = useServerStore()
const sftpStore = useSftpStore()
const terminalStore = useTerminalStore()
const localTerminalStore = useLocalTerminalStore()
const tunnelStore = useTunnelStore()
const dockerStore = useDockerStore()
const processStore = useProcessStore()
const terminalProfileStore = useTerminalProfileStore()
const alertStore = useAlertStore()
const search = ref('')
const activeView = ref<AppPanelView>('terminals')
const shellPlatform = computed(() => localTerminalStore.capabilities?.platform ?? 'windows')
const settingsOverlayOpen = ref(false)
const monitorPanelController = useMonitorPanelController()
const globalShortcutBridge = useGlobalShortcutBridge()
const dashboardBatchOperation = ref<'connect' | 'reconnect' | 'disconnect' | null>(null)
const toolDialogServerId = ref<number | null>(null)
const tunnelDialogOpen = ref(false)
const dockerDialogOpen = ref(false)
const processDialogOpen = ref(false)
const serviceDialogOpen = ref(false)
const alertCenterController = useAlertCenterController()
const processInitialPid = ref<number | null>(null)
const terminalLayoutRevision = ref(0)
const sftpOpenRevision = ref(0)
const connectionDialog = ref(false)
const editing = ref<Connection | null>(null)
const busy = ref(false)
const settings = ref<AppSettings>(createDefaultAppSettings())
const sftpActiveContextBridge = useSftpActiveContextBridge()
const appLogsController = useAppLogsController()
const logLevelFilter = appLogsController.levelFilter
const logQuery = appLogsController.query
const serverMenu = ref<{ x: number; y: number; connectionId: number } | null>(null)
const serverPickerController = useServerPickerController()
const serverPickerOpen = serverPickerController.isOpen
const serverPickerAnchor = serverPickerController.anchor
const {
  pendingPaneOpenTarget,
  paneTargetAssignment,
  beginPaneOpenTarget,
  clearPendingPaneOpenTarget,
  pendingForAction,
  publishPaneTargetAssignment,
} = usePaneTargetRequests()
const { toast, show: showToast, close: closeToast, dispose: disposeToast } = useToast()
const nativeAlertNotifications = useNativeAlertNotifications({
  settings: computed(() => settings.value.alerts),
  runtime: createWailsNativeNotificationRuntime(),
  notify: showToast,
  platform: shellPlatform,
})
let authFlow: ReturnType<typeof useAuthDialogFlow>
let hostKeyTrustFlow: ReturnType<typeof useHostKeyTrustFlow>
let runtimeOpenOrActivateServer: ReturnType<typeof useAppServerRuntimeWiring>['openOrActivateServer']
let runtimeOpenSftpForConnection: ReturnType<typeof useAppServerRuntimeWiring>['openSftpForConnection']
let runtimeReconnectSftpById: ReturnType<typeof useAppServerRuntimeWiring>['reconnectSftpById']

const {
  filteredConnections, activeTerminalSnapshot, activeWorkspaceConnection,
  activeWorkspaceHistory, activeWorkspaceState, activeNetworkServerId,
  toolDialogActiveServerId, activeWorkspaceNetworkInterfaces,
  activeWorkspaceNetworkInterfacePreference, activeWorkspaceNetworkInterfacesLoading,
  localTerminalEnabled, filteredLogs, groupedConnections, serverStatuses, dashboardSummaries,
} = useAppRuntimeViewModel({
  search,
  toolDialogServerId,
  store,
  terminalStore,
  localTerminalStore,
  sftpStore,
  tunnelStore,
  dockerStore,
  appLogsController,
})
const emptyAuth = createEmptyAuth

const appMenuActions = useAppMenuActions({
  activeView,
  busy,
  serverMenu,
  logLevelFilter,
  logQuery,
  sftpOpenRevision,
  connections: () => store.connections,
  pendingForAction,
  clearPendingPaneOpenTarget,
  beginPaneOpenTarget,
  closeServerPickerOverlay: () => serverPickerController.close(),
  toggleServerPickerFromTopbar: (anchor) => serverPickerController.toggleFromTopbar(anchor),
  openServerPickerForPaneTarget: () => serverPickerController.openForPaneTarget(),
  openOrActivateServerRuntime: (connection) => runtimeOpenOrActivateServer(connection),
  openSftpRuntime: (connection) => runtimeOpenSftpForConnection(connection),
  reconnectSftpRuntime: (connectionId, contextId, terminalSessionId) =>
    runtimeReconnectSftpById(connectionId, contextId, terminalSessionId),
  openAlertCenterOverlay: () => alertCenterController.open(),
  closeAlertCenterOverlay: () => alertCenterController.close(),
  markAlertRead: (eventID) => alertStore.markRead(eventID),
  viewAlert: (event) => alertCenterController.viewAlert(event),
  createTestAlertNotifications: () => alertStore.createTestAlert(),
  sendNativeAlertNotifications: (notifications) => nativeAlertNotifications.handleAlertNotifications(notifications),
  openMonitorPanel: (options) => monitorPanelController.openMonitorPanel(options),
  refreshLogs: (runTask) => appLogsController.refresh(() => runTask(store.loadLogs, '加载应用日志失败')),
  writeClipboardText: (detail) => navigator.clipboard.writeText(detail),
  logFrontendError: (scope) => api.logFrontendError(scope),
  groups: () => store.groups,
  serverPickerAnchor,
  nextTick,
  inputDialog,
  confirmDialog,
  saveGroup: async (group) => { await api.saveGroup(group) },
  deleteGroup: (id) => api.deleteGroup(id),
  loadConnections: async () => { await store.load() },
  reorderServers: async (request) => { await store.reorderServers(request) },
  showToast,
})
const {
  pendingConnectSavedTarget,
  closeServerPicker,
  closeTransientOverlays,
  toggleServerPicker,
  openSavedServerPickerForPane,
  openOrActivateServer,
  openSftpForConnection,
  openSftpById,
  reconnectSftpById,
  openAlertCenter,
  handleAlertNotifications,
  handleAlertView,
  createTestAlert,
  addGroup,
  removeGroup,
  reorderServer,
  showLogs,
  closeLogs,
  setLogLevelFilter,
  setLogQuery,
  showConnectionError,
  copyLogDetail,
  handleMonitorError,
  run,
  errorMessage,
} = appMenuActions

const serverRuntimeActions = useAppServerRuntimeWiring({
  settings,
  activeView,
  pendingPaneOpenTarget,
  clearPendingPaneOpenTarget,
  pendingForAction,
  publishPaneTargetAssignment,
  connections: () => store.connections,
  selectedConnection: () => store.selected,
  selectedConnectionId: () => store.selected?.id,
  selectConnection: (connectionId) => store.select(connectionId),
  connectionState: (connectionId) => store.connectionState(connectionId),
  workspaceStatus: (connectionId) => terminalStore.workspaces[connectionId]?.status,
  hasWorkspace: (connectionId) => terminalStore.hasWorkspace(connectionId),
  findTerminalByConnection: (connectionId) => terminalStore.findByConnection(connectionId),
  activeTerminalTab: () => terminalStore.activeTab,
  navigateTerminalToServer: (connection) => terminalStore.navigateToServer(connection),
  clearActiveLocalTerminal: () => { localTerminalStore.activeSessionId = null },
  activateTerminal: (sessionId) => terminalStore.activate(sessionId),
  openTerminalSession: (connection, auth) => terminalStore.open(connection, auth),
  reconnectTerminalSession: (sessionId, connectionId, auth, rows, cols) =>
    terminalStore.reconnect(sessionId, connectionId, auth, rows, cols),
  disconnectTerminalServer: (connectionId, closeWorkspace) =>
    terminalStore.disconnectServer(connectionId, closeWorkspace),
  terminalTabs: () => terminalStore.tabs,
  clearActiveWorkspace: () => terminalStore.clearActiveWorkspace(),
  syncConnectionState: (connection, state) => terminalStore.syncConnectionState(connection, state),
  resumeServer: (connectionId) => store.resumeServer(connectionId),
  markDisconnected: (connectionId) => store.markDisconnected(connectionId),
  connectMonitor: (connectionId, auth) => store.connect(connectionId, auth),
  disconnectMonitor: (connectionId) => api.disconnectServer(connectionId),
  markExpectedDisconnect: (connectionId) => alertStore.markExpectedDisconnect(connectionId),
  testConnection: (connectionId, auth) => store.test(connectionId, auth),
  clearSftpServer: (connectionId) => sftpStore.clearServer(connectionId),
  clearTunnelServer: (connectionId) => tunnelStore.clearServer(connectionId),
  clearDockerServer: (connectionId) => dockerStore.clearServer(connectionId),
  clearProcessServer: (connectionId) => processStore.clearServer(connectionId),
  sftpState: (connectionId, contextId) => sftpStore.state(connectionId, contextId),
  sftpOpen: (connectionId, auth, contextId, terminalSessionId) =>
    sftpStore.open(connectionId, auth, contextId, terminalSessionId),
  sftpReconnect: (connectionId, auth, contextId, terminalSessionId) =>
    sftpStore.reconnect(connectionId, auth, contextId, terminalSessionId),
  sftpMarkAuthRequired: (connectionId, issue, contextId, terminalSessionId) =>
    sftpStore.markAuthRequired(connectionId, issue, contextId, terminalSessionId),
  sftpStatesByContextId: () => sftpStore.stateByContextId,
  sftpServerState: (connectionId) => sftpStore.stateByServerId[connectionId],
  sftpTransfersById: () => sftpStore.transfersById,
  sftpEntriesCount: (connectionId, contextId) => sftpStore.entries(connectionId, contextId).length,
  markTerminalFileReconnectPending: (connectionId, sessionId) =>
    sftpActiveContextBridge.markTerminalFileReconnectPending(connectionId, sessionId),
  clearTerminalFileReconnectPending: (connectionId, sessionId) =>
    sftpActiveContextBridge.clearTerminalFileReconnectPending(connectionId, sessionId),
  readAuthenticationState: (connectionId) => api.authenticationState(connectionId),
  probeConnectionReachability: (connectionId) => api.probeConnectionReachability(connectionId),
  requestAuth: (...args) => authFlow.requestAuth(...args),
  setReconnectSessionId: (sessionId) => { authFlow.setReconnectSessionId(sessionId) },
  trustHostKeyAndRun: (connection, action) => hostKeyTrustFlow.trustHostKeyAndRun(connection, action),
  showConnectionError,
  showToast,
  errorMessage,
  run,
})

const {
  authenticationStateFor,
  requestAuthForState,
  canConnectSilently,
  activateServer,
  openTerminalFromMenu,
  ensureMonitorAndOpenTerminal,
  reconnectFileContextsAfterTerminalOnline,
  reconnectTerminalAndSyncFiles,
  newTerminal,
  reconnectTerminal,
  openOrActivateServer: serverOpenOrActivateServer,
  openSftpForConnection: serverOpenSftpForConnection,
  reconnectSftpById: serverReconnectSftpById,
  connectServer,
  testServer,
  reconnectServer,
  reconnectServerWithAuth,
  disconnectServer,
  disconnectServerById,
  disconnectServerAfterFinalTerminalClose,
  connectWorkspace: runtimeConnectWorkspace,
} = serverRuntimeActions
runtimeOpenOrActivateServer = serverOpenOrActivateServer
runtimeOpenSftpForConnection = serverOpenSftpForConnection
runtimeReconnectSftpById = serverReconnectSftpById

authFlow = useAuthDialogFlow({
  activeView,
  sftpOpenRevision,
  pendingPaneOpenTarget,
  clearPendingPaneOpenTarget,
  publishPaneTargetAssignment,
  findConnection: (connectionId) => store.connections.find((item) => item.id === connectionId) ?? null,
  testConnection: (connectionId, auth) => store.test(connectionId, auth),
  connectServer: (connectionId, auth) => store.connect(connectionId, auth),
  ensureMonitorAndOpenTerminal,
  reconnectTerminalAndSyncFiles,
  reconnectServerWithAuth,
  sftpOpen: (connectionId, auth, contextId, terminalSessionId) =>
    sftpStore.open(connectionId, auth, contextId, terminalSessionId),
  sftpReconnect: (connectionId, auth, contextId, terminalSessionId) =>
    sftpStore.reconnect(connectionId, auth, contextId, terminalSessionId),
  showConnectionError,
  showToast,
  run,
})
const {
  authDialog,
  authMode,
  authConnection,
  authIssue,
  closeAuthDialog,
  submitAuth,
} = authFlow

hostKeyTrustFlow = useHostKeyTrustFlow({
  activeView,
  findConnection: (connectionId) => store.connections.find((item) => item.id === connectionId) ?? null,
  probeHostKey: (connectionId) => api.probeHostKey(connectionId),
  trustHostKey: (connectionId, fingerprint) => api.trustHostKey(connectionId, fingerprint),
  loadConnections: () => store.load(),
  confirmDialog,
  showToast,
  run,
  findTerminalByConnection: (connectionId) => terminalStore.findByConnection(connectionId),
  authenticationStateFor,
  canConnectSilently,
  requestAuthForState,
  reconnectTerminalAndSyncFiles,
  ensureMonitorAndOpenTerminal,
  emptyAuth,
})
const { trustHostKeyAndRun, trustWorkspaceHostKey } = hostKeyTrustFlow

const dockerContainerTerminalFlow = useDockerContainerTerminalFlow({
  activeView,
  dockerDialogOpen,
  connections: () => store.connections,
  openDedicatedTerminal: (connection) => newTerminal(connection.id),
  findTerminalBySession: (sessionId) => terminalStore.tabs.find((tab) => tab.sessionId === sessionId) ?? null,
  activateTerminal: (sessionId) => terminalStore.activate(sessionId),
  writeTerminal: (sessionId, dataBase64) => api.writeTerminal(sessionId, dataBase64),
  showToast,
})

const connectionDialogFlow = useConnectionDialogFlow({
  connectionDialog,
  editing,
  activeView,
  serverPickerAnchor,
  pendingPaneOpenTarget,
  beginPaneOpenTarget,
  clearPendingPaneOpenTarget,
  publishPaneTargetAssignment,
  closeTransientOverlays,
  nextTick,
  findConnection: (connectionId) => store.connections.find((item) => item.id === connectionId) ?? null,
  saveConnectionConfig: (request) => api.saveConnectionConfig(request),
  duplicateConnectionConfig: (connection) => store.save(connection),
  deleteConnectionConfig: (connectionId) => store.remove(connectionId),
  deleteSavedCredentialById: (connectionId) => api.deleteSavedCredential(connectionId),
  confirmDialog,
  connections: () => store.connections,
  markExpectedDisconnect: (connectionId) => alertStore.markExpectedDisconnect(connectionId),
  removeServerAlerts: (connectionId) => alertStore.removeServer(connectionId),
  removeWorkspaceLocal: (connectionId) => terminalStore.removeWorkspaceLocal(connectionId),
  loadConnections: () => store.load(),
  selectConnection: (connectionId) => store.select(connectionId),
  syncConnectionState: (connection, state) => terminalStore.syncConnectionState(connection, state),
  connectionState: (connectionId) => store.connectionState(connectionId),
  hasWorkspace: (connectionId) => terminalStore.hasWorkspace(connectionId),
  sessionsByServerId: (connectionId) => terminalStore.sessionsByServerId[connectionId] ?? [],
  openTerminalForSavedConnection: ensureMonitorAndOpenTerminal,
  showToast,
  run,
})

const {
  openCreate,
  openCreateForPane,
  editServerFromTab,
  closeConnectionDialog,
  saveConnection,
  deleteSavedCredential,
  duplicateConnection,
  deleteConnection,
} = connectionDialogFlow
const openEdit = (connection: Connection | null = store.selected) => connectionDialogFlow.openEdit(connection)

const localTerminalLaunchFlow = useLocalTerminalLaunchFlow({
  activeView,
  settings,
  enabled: localTerminalEnabled,
  capabilities: () => localTerminalStore.capabilities,
  beginPaneOpenTarget,
  clearPendingPaneOpenTarget,
  pendingConnectSavedTarget,
  publishPaneTargetAssignment,
  clearActiveWorkspace: () => terminalStore.clearActiveWorkspace(),
  openLocalTerminalSession: (shellKind, elevated, rows, cols) =>
    localTerminalStore.open(shellKind, elevated, rows, cols),
  relaunchElevatedLocalTerminal: (shellKind) => api.relaunchElevatedLocalTerminal({ shellKind }),
  confirmElevatedRelaunch: () => confirmDialog({
    title: '管理员本地终端',
    message: '管理员模式需要以管理员身份重新启动 ServerPilot，是否继续？',
    confirmText: '重新启动',
  }),
  closeTransientOverlays,
  showToast,
  run,
})
const {
  openLocalTerminal,
  openLocalTerminalForPane,
  openLocalTerminalFromPicker,
} = localTerminalLaunchFlow

const settingsPanelFlow = useSettingsPanelFlow({
  settings,
  settingsOverlayOpen,
  saveSettingsValue: (value) => api.saveSettings(value),
  confirmDisableShortcutConflicts: (message) => confirmDialog({
    title: '快捷键绑定冲突',
    message,
    confirmText: '禁用冲突快捷键并保存',
    cancelText: '返回设置',
  }),
  configureAlerts: (value) => alertStore.configure(value),
  reloadAlertHistory: () => alertStore.reloadHistory(),
  setDefaultTerminalProfileId: (id) => terminalProfileStore.setDefaultProfileId(id),
  applyTheme,
  applyUIFontSize,
  showToast,
  run,
  errorMessage,
})
const {
  closeSettingsOverlay, normalizeAppSettings, saveSettings, saveSettingsAndClose, saveDashboardLayout,
} = settingsPanelFlow

const backupRestoreFlow = useBackupRestoreFlow({
  settings,
  settingsOverlayOpen,
  busy,
  loadSettings: () => api.settings(),
  loadConnections: () => store.load(),
  loadTunnelProfiles: () => tunnelStore.loadProfiles(),
  configureAlerts: (value) => alertStore.configure(value),
  reloadAlertHistory: () => alertStore.reloadHistory(),
  loadTerminalProfiles: (defaultProfileId) => terminalProfileStore.load(defaultProfileId),
  normalizeAppSettings,
  applyTheme,
  applyUIFontSize,
  showToast,
  errorMessage,
})
const { reloadAfterBackupImport } = backupRestoreFlow

const keyVaultPanelFlow = useKeyVaultPanelFlow({
  refreshConnections: () => store.refreshConnections(),
})
const { handleKeyVaultDeleted, handleTerminalProfileDeleted } = keyVaultPanelFlow

const appPanelControllerWiring = useAppPanelControllerWiring({
  activeView,
  settingsOverlayOpen,
  toolDialogServerId,
  tunnelDialogOpen,
  dockerDialogOpen,
  processDialogOpen,
  serviceDialogOpen,
  processInitialPid,
  dashboardBatchOperation,
  activeNetworkServerId,
  serverMenu,
  activeWorkspaceServerId: () => terminalStore.activeWorkspaceServerId,
  selectedServerId: () => store.selectedId,
  connections: () => store.connections,
  dashboardSummaries: () => dashboardSummaries.value,
  connectionState: (serverID) => store.connectionState(serverID),
  workspaceStatus: (serverID) => terminalStore.workspaces[serverID]?.status,
  selectConnection: (serverID) => store.select(serverID),
  closeTransientOverlays,
  openMonitorPanel: (options) => monitorPanelController.openMonitorPanel(options),
  closeMonitorPanel: () => monitorPanelController.closeMonitorPanel(),
  openNetworkDetailsPanel: (initialTab) => monitorPanelController.openNetworkDetails(initialTab),
  loadNetworkInterfacePreference: async (serverID) => { await store.loadNetworkInterfacePreference(serverID) },
  loadNetworkInterfaces: async (serverID) => { await store.loadNetworkInterfaces(serverID) },
  setMonitorNetworkInterface: async (serverID, mode, selectedNetworkInterface) => {
    await store.setMonitorNetworkInterface(serverID, mode, selectedNetworkInterface)
  },
  showLogs,
  findTerminalByConnection: (serverID) => terminalStore.findByConnection(serverID),
  clearActiveLocalTerminal: () => { localTerminalStore.activeSessionId = null },
  activateTerminal: (sessionId) => terminalStore.activate(sessionId),
  openTerminalFromMenu,
  newTerminal,
  openSftpForConnection,
  activateServer,
  connectServer,
  reconnectServer,
  disconnectServer,
  editServerFromTab,
  openEdit,
  duplicateConnection,
  trustHostKeyAndRun,
  deleteConnection,
  confirmDialog,
  showToast,
  errorMessage,
})
const {
  navigateMain, openMonitorPanel, openActiveMonitorPanel, openTunnelDialog,
  openDockerDialog, openProcessManager, openServiceManager, openNetworkDiagnostics,
  openDashboardToolDialog, refreshActiveNetworkInterfaces, setActiveNetworkInterface,
  switchDashboardServer, connectDashboardServer, disconnectDashboardServer,
  editDashboardServer, connectDashboardServers, reconnectDashboardServers, disconnectDashboardServers,
  openServerMenu, selectServerMenu,
} = appPanelControllerWiring

const appStartupFlow = useAppStartupFlow({
  settings,
  localTerminalEnabled,
  getInitialSettings,
  loadSettings: () => api.settings(),
  loadLocalTerminalCapabilities: () => api.getLocalTerminalCapabilities(),
  setLocalTerminalCapabilities: (capabilities) => { localTerminalStore.setCapabilities(capabilities) },
  loadConnections: store.load,
  loadTunnelProfiles: tunnelStore.loadProfiles,
  normalizeSettings: normalizeAppSettings,
  initializeAlerts: (alertSettings) => alertStore.initialize(alertSettings),
  setDefaultTerminalProfileId: (id) => terminalProfileStore.setDefaultProfileId(id ?? undefined),
  loadTerminalProfiles: (defaultProfileId) => terminalProfileStore.load(defaultProfileId ?? undefined),
  applyTheme,
  applyUIFontSize,
  getStartupLocalTerminalRequest: () => api.getStartupLocalTerminalRequest(),
  openLocalTerminal,
  storeError: () => store.error,
  showToast,
  errorMessage,
})

const appEventSubscriptions = useAppEventSubscriptions({
  installUiDragSelectionGuard,
  installGlobalShortcuts: globalShortcutBridge.install,
  uninstallGlobalShortcuts: globalShortcutBridge.uninstall,
  subscribeStores: [store.subscribe, sftpStore.subscribe, terminalStore.subscribe, localTerminalStore.subscribe,
    tunnelStore.subscribe, dockerStore.subscribe, processStore.subscribe],
  unsubscribeStores: [store.unsubscribe, sftpStore.unsubscribe, terminalStore.unsubscribe, localTerminalStore.unsubscribe,
    tunnelStore.unsubscribe, dockerStore.unsubscribe, processStore.unsubscribe],
  persistWindowState: () => api.persistWindowState(),
  logPersistWindowStateError: (reason) => { console.warn('Unable to persist window state', String(reason)) },
  tickAlerts: () => { handleAlertNotifications(alertStore.tick(Date.now(), store.states, store.connections)) },
  disposeAlerts: alertStore.dispose,
  stopThemeSync,
  disposeToast,
})

const appLifecycleWatchers = useAppLifecycleWatchers({
  alertPersistenceWarning: computed(() => alertStore.persistenceWarning),
  terminalLastStatus: computed(() => terminalStore.lastStatus),
  activeView,
  terminalLayoutRevision,
  activeNetworkServerId: () => activeNetworkServerId.value,
  activeWorkspaceMonitorActive: () => activeWorkspaceState.value?.monitorActive,
  terminalProfileDefaultProfileId: () => terminalProfileStore.defaultProfileId,
  settings,
  tunnelLastError: computed(() => tunnelStore.lastError),
  dockerLastError: computed(() => dockerStore.lastError),
  connectionStates: () => store.states,
  snapshots: () => store.snapshots,
  connections: () => store.connections,
  resolveTerminalStatusReconnectIntent: (event) => sftpActiveContextBridge.resolveTerminalStatusReconnectIntent(event),
  loadConnections: store.load,
  reconnectFileContextsAfterTerminalOnline,
  emptyAuth,
  showConnectionError,
  loadNetworkInterfacePreference: (serverID) => store.loadNetworkInterfacePreference(serverID),
  loadNetworkInterfaces: (serverID) => store.loadNetworkInterfaces(serverID),
  handleAlertNotifications,
  ingestConnectionState: (state, connection) => alertStore.ingestConnectionState(state, connection),
  syncConnectionState: (connection, state) => terminalStore.syncConnectionState(connection, state),
  refreshConnections: () => store.refreshConnections(),
  setMonitorNetworkInterface: (serverID, mode, selectedNetworkInterface, userSelected) =>
    store.setMonitorNetworkInterface(serverID, mode, selectedNetworkInterface, userSelected),
  ingestSnapshot: (snapshot, connection) => alertStore.ingestSnapshot(snapshot, connection),
  showToast,
  logRefreshSecurityStateError: (reason) => { console.error('Unable to refresh connection security state', reason) },
})

onMounted(async () => {
  appEventSubscriptions.start()
  await appStartupFlow.startup()
  if (settings.value.alerts.nativeNotifications.enabled) {
    void nativeAlertNotifications.initialize()
  }
  appEventSubscriptions.startAlertTick()
})

onBeforeUnmount(() => {
  appEventSubscriptions.stop()
  appLifecycleWatchers.stop()
  void nativeAlertNotifications.cleanup()
})

const {
  terminalPanel, settingsOverlay, monitorPanel, logsPanel, serverPickerOverlay,
  connectionDialogOverlay, monitorPanelOverlay, toolDialogsOverlay, authOverlay,
  contextMenuOverlay, alertCenterOverlay, menuConnection, topBarListeners,
  panelListeners, overlayListeners,
} = useAppShellBindings({
  settings, busy, search, store, terminalStore, terminalProfileStore, alertStore,
  serverPicker: { open: serverPickerOpen, anchor: serverPickerAnchor },
  monitorPanelController, alertCenterController,
  nativeNotificationStatus: nativeAlertNotifications.status,
  activeTerminalSnapshot, activeWorkspaceConnection, activeWorkspaceState, activeWorkspaceHistory,
  activeWorkspaceNetworkInterfaces, activeWorkspaceNetworkInterfacePreference,
  activeWorkspaceNetworkInterfacesLoading, localTerminalEnabled,
  localTerminalCapabilities: computed(() => localTerminalStore.capabilities),
  filteredLogs,
  groupedConnections, serverStatuses, dashboardSummaries, toolDialogActiveServerId,
  authConnection, logLevelFilter, logQuery, terminalLayoutRevision, sftpOpenRevision,
  paneTargetAssignment, pendingPaneOpenTarget, connectionDialog, editing,
  settingsOverlayOpen,
  monitorPanelOpen: monitorPanelController.monitorPanelOpen,
  monitorPanelInitialTab: monitorPanelController.monitorPanelInitialTab,
  monitorPanelInitialServerId: monitorPanelController.monitorPanelInitialServerId, dashboardBatchOperation,
  tunnelDialogOpen, dockerDialogOpen, processDialogOpen, serviceDialogOpen,
  networkDetailsOpen: monitorPanelController.networkDetailsOpen,
  networkDetailsInitialTab: monitorPanelController.networkDetailsInitialTab,
  processInitialPid, authDialog, authMode, authIssue, serverMenu,
  alertCenterOpen: alertCenterController.isOpen, toast,
}, {
  toggleServerPicker, openAlertCenter, openMonitorPanel, openTunnelDialog,
  openDockerDialog, openProcessManager, openServiceManager, openNetworkDiagnostics,
  navigateMain, newTerminal, reconnectTerminal, editServerFromTab, disconnectServerById,
  disconnectServerAfterFinalTerminalClose, closeServerPicker, showToast, openActiveMonitorPanel,
  openSftpById, reconnectSftpById, setActiveNetworkInterface, refreshActiveNetworkInterfaces,
  trustWorkspaceHostKey, openCreateForPane, openSavedServerPickerForPane,
  openLocalTerminalForPane, connectWorkspace: runtimeConnectWorkspace, closeSettingsOverlay, saveSettings,
  saveSettingsAndClose, applyTheme, applyUIFontSize, reloadAfterBackupImport,
  keyVaultDeleted: handleKeyVaultDeleted, terminalProfileDeleted: handleTerminalProfileDeleted,
  createTestAlert, sendNativeTestNotification: nativeAlertNotifications.sendTestNotification,
  handleMonitorError, showLogs, closeLogs, setLogLevelFilter,
  setLogQuery, copyLogDetail, openCreate, addGroup, openLocalTerminalFromPicker,
  openOrActivateServer, openEdit, deleteConnection, removeGroup, reorderServer,
  openServerMenu, closeConnectionDialog, saveConnection, deleteSavedCredential,
  saveDashboardLayout, switchDashboardServer, connectDashboardServer, disconnectDashboardServer,
  editDashboardServer, connectDashboardServers, reconnectDashboardServers,
  disconnectDashboardServers, openDashboardToolDialog, closeAuthDialog, submitAuth,
  connectDockerContainer: dockerContainerTerminalFlow.connectDockerContainer,
  selectServerMenu, handleAlertView, closeToast,
})
</script>

<template>
  <AppShell :terminal-layout="activeView === 'terminals'" :platform="shellPlatform">
    <template #topbar>
      <AppTopBar
        v-if="activeView !== 'terminals'"
        :alert-unread-count="alertStore.unreadCount"
        v-on="topBarListeners"
      />
    </template>

    <AppPanelHost
      :active-view="activeView"
      :terminal="terminalPanel"
      :monitor="monitorPanel"
      :logs="logsPanel"
      v-on="panelListeners"
    >
      <template #tabs>
        <AppTopBar
          v-if="activeView === 'terminals'"
          :alert-unread-count="alertStore.unreadCount"
          v-on="topBarListeners"
        />
      </template>
    </AppPanelHost>

    <template #status>
      <AppStatusBar />
    </template>

    <template #overlays>
      <AppOverlayHost
        :server-picker="serverPickerOverlay"
        :settings="settingsOverlay"
        :connection-dialog="connectionDialogOverlay"
        :monitor-panel="monitorPanelOverlay"
        :tool-dialogs="toolDialogsOverlay"
        :auth="authOverlay"
        :context-menu="contextMenuOverlay"
        :alert-center="alertCenterOverlay"
        :toast="toast"
        :busy="busy"
        v-on="overlayListeners"
      />
    </template>
  </AppShell>
</template>
