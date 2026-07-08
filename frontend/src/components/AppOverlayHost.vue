<script setup lang="ts">
import AppDialogHost from './AppDialogHost.vue'
import AppBackdrop from './primitives/AppBackdrop.vue'
import AlertCenter from './AlertCenter.vue'
import AuthDialog from './AuthDialog.vue'
import ConnectionDialog from './ConnectionDialog.vue'
import ContextMenu from './ContextMenu.vue'
import DockerManagerDialog from './DockerManagerDialog.vue'
import MultiServerDashboardDialog from './MultiServerDashboardDialog.vue'
import NetworkDetailsDialog from './NetworkDetailsDialog.vue'
import ProcessManagerDialog from './ProcessManagerDialog.vue'
import ServerPicker from './ServerPicker.vue'
import ServiceManagerDialog from './ServiceManagerDialog.vue'
import SettingsView from './SettingsView.vue'
import ToastHost from './ToastHost.vue'
import TunnelManagerDialog from './TunnelManagerDialog.vue'
import type { DashboardServerSummary } from '../utils/multiServerDashboard'
import type { ThemePreviewMode } from '../utils/theme'
import type { AuthDialogMode } from '../composables/useAuthDialogController'
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
  LocalTerminalCapabilities,
  LocalTerminalShellKind,
  MonitorSnapshot,
  NativeNotificationStatus,
  ReorderServersRequest,
  SaveConnectionConfigRequest,
  TerminalProfile,
  ToastMessage,
} from '../types'

defineOptions({ name: 'AppOverlayHost' })

export interface ServerPickerOverlayState {
  open: boolean
  anchor: HTMLElement | null
  groups: Array<{ id: number; name: string; items: Connection[] }>
  statuses: Record<number, ConnectionStatus>
  activeServerId: number | null
  localTerminalEnabled: boolean
  localTerminalCapabilities?: LocalTerminalCapabilities | null
  query: string
  targetPaneMode: boolean
}

export interface ConnectionDialogOverlayState {
  open: boolean
  connection: Connection | null
  groups: Group[]
  settings: AppSettings
  terminalProfiles: TerminalProfile[]
  connections: Connection[]
}

export interface SettingsOverlayState {
  open: boolean
  settings: AppSettings
  saving: boolean
  connections: Connection[]
  nativeNotificationStatus: NativeNotificationStatus
}

export interface MonitorPanelOverlayState {
  open: boolean
  summaries: DashboardServerSummary[]
  connections: Connection[]
  selectedServerId: number | null
  activeWorkspaceServerId: number | null
  snapshots: Record<number, MonitorSnapshot>
  histories: Record<number, MonitorSnapshot[]>
  initialTab?: 'overview' | 'detail'
  initialServerId?: number | null
  batchOperation?: 'connect' | 'reconnect' | 'disconnect' | null
  dashboardSortMode?: DashboardSortMode
  dashboardManualServerOrder?: string[]
  activeAlertCountsByServerId?: Record<number, number>
  alertUnreadCount?: number
}

export interface ToolDialogsOverlayState {
  activeServerId: number | null
  connections: Connection[]
  connectionStates: Record<number, ConnectionRuntimeState>
  tunnelsOpen: boolean
  dockerOpen: boolean
  processesOpen: boolean
  servicesOpen: boolean
  networkDetailsOpen: boolean
  processInitialPid: number | null
  networkDetailsInitialTab?: 'endpoints' | 'diagnostics'
}

export interface AuthOverlayState {
  open: boolean
  connection: Connection | null
  mode: AuthDialogMode
  issue?: string
}

export interface ContextMenuOverlayState {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}

export interface AlertCenterOverlayState {
  open: boolean
  activeEvents: AlertEvent[]
  resolvedEvents: AlertEvent[]
  allEvents: AlertEvent[]
}

withDefaults(defineProps<{
  serverPicker: ServerPickerOverlayState
  settings: SettingsOverlayState
  connectionDialog: ConnectionDialogOverlayState
  monitorPanel?: MonitorPanelOverlayState | null
  toolDialogs?: ToolDialogsOverlayState | null
  auth?: AuthOverlayState | null
  contextMenu?: ContextMenuOverlayState | null
  alertCenter?: AlertCenterOverlayState | null
  toast?: ToastMessage | null
  busy?: boolean
}>(), {
  monitorPanel: null,
  toolDialogs: null,
  auth: null,
  contextMenu: null,
  alertCenter: null,
  toast: null,
  busy: false,
})

const emit = defineEmits<{
  serverPickerClose: []
  serverPickerQueryUpdate: [value: string]
  serverPickerAddServer: []
  serverPickerAddGroup: []
  serverPickerOpenLocalTerminal: [shellKind: LocalTerminalShellKind | string]
  serverPickerOpenServer: [connection: Connection]
  serverPickerEditServer: [connection: Connection]
  serverPickerDeleteServer: [connection: Connection]
  serverPickerDeleteGroup: [group: Group]
  serverPickerReorderServer: [request: ReorderServersRequest]
  serverPickerContextMenu: [event: MouseEvent, connection: Connection]
  connectionDialogClose: []
  connectionDialogSave: [request: SaveConnectionConfigRequest]
  connectionDialogDeleteCredential: [connectionId: number]
  settingsClose: []
  settingsSave: [settings: AppSettings]
  settingsSaveAndClose: [settings: AppSettings]
  settingsPreviewTheme: [mode: ThemePreviewMode]
  settingsPreviewFontSize: [size: AppSettings['uiFontSize']]
  settingsBackupImported: []
  settingsKeyVaultDeleted: []
  settingsTerminalProfileDeleted: []
  settingsTestAlert: []
  settingsTestNativeNotification: []
  settingsOpenLogs: []
  monitorPanelClose: []
  dashboardLayoutChange: [payload: { sortMode: DashboardSortMode; manualServerOrder: string[] }]
  dashboardSwitchServer: [serverID: number]
  dashboardConnectServer: [serverID: number]
  dashboardDisconnectServer: [serverID: number]
  dashboardEditServer: [serverID: number]
  dashboardConnectServers: [serverIDs: number[]]
  dashboardReconnectServers: [serverIDs: number[]]
  dashboardDisconnectServers: [serverIDs: number[], scope: 'selected' | 'filtered']
  dashboardOpenTunnels: [serverID: number]
  dashboardOpenDocker: [serverID: number]
  dashboardOpenProcesses: [serverID: number]
  dashboardOpenNetworkDiagnostics: [serverID: number]
  dashboardAlerts: []
  closeTunnels: []
  closeDocker: []
  dockerConnectContainer: [payload: { serverID: number; containerID: string; containerName: string }]
  closeProcesses: []
  closeServices: []
  closeNetworkDetails: []
  notify: [message: string, type: 'success' | 'error' | 'info']
  authClose: []
  authSubmit: [auth: AuthRequest]
  contextMenuClose: []
  contextMenuSelect: [id: string]
  alertCenterClose: []
  alertMarkRead: [eventID: string]
  alertMarkAllRead: []
  alertClearResolved: []
  alertMuteServer: [serverID: number, mode: '30m' | '2h' | 'session']
  alertUnmuteServer: [serverID: number]
  alertViewMonitor: [event: AlertEvent]
  toastClose: []
}>()
</script>

<template>
  <ServerPicker
    :open="serverPicker.open"
    :anchor="serverPicker.anchor"
    :groups="serverPicker.groups"
    :statuses="serverPicker.statuses"
    :active-server-id="serverPicker.activeServerId"
    :local-terminal-enabled="serverPicker.localTerminalEnabled"
    :local-terminal-capabilities="serverPicker.localTerminalCapabilities"
    :query="serverPicker.query"
    :target-pane-mode="serverPicker.targetPaneMode"
    outside-ignore-selector="[data-interaction-scope='server-picker-menu']"
    @close="emit('serverPickerClose')"
    @update:query="emit('serverPickerQueryUpdate', $event)"
    @add-server="emit('serverPickerAddServer')"
    @add-group="emit('serverPickerAddGroup')"
    @open-local-terminal="emit('serverPickerOpenLocalTerminal', $event)"
    @open-server="emit('serverPickerOpenServer', $event)"
    @edit-server="emit('serverPickerEditServer', $event)"
    @delete-server="emit('serverPickerDeleteServer', $event)"
    @delete-group="emit('serverPickerDeleteGroup', $event)"
    @reorder-server="emit('serverPickerReorderServer', $event)"
    @context-menu="(event, connection) => emit('serverPickerContextMenu', event, connection)"
  />

  <ConnectionDialog
    :open="connectionDialog.open"
    :connection="connectionDialog.connection"
    :groups="connectionDialog.groups"
    :settings="connectionDialog.settings"
    :terminal-profiles="connectionDialog.terminalProfiles"
    :connections="connectionDialog.connections"
    @close="emit('connectionDialogClose')"
    @save="emit('connectionDialogSave', $event)"
    @delete-credential="emit('connectionDialogDeleteCredential', $event)"
  />

  <AppBackdrop
    v-if="settings.open"
    kind="popover"
    class="settings-overlay-backdrop"
    data-testid="settings-overlay"
  >
    <SettingsView
      overlay
      :settings="settings.settings"
      :saving="settings.saving"
      :connections="settings.connections"
      :native-notification-status="settings.nativeNotificationStatus"
      @close-request="emit('settingsClose')"
      @save="emit('settingsSave', $event)"
      @save-and-close="emit('settingsSaveAndClose', $event)"
      @preview-theme="emit('settingsPreviewTheme', $event)"
      @preview-font-size="emit('settingsPreviewFontSize', $event)"
      @backup-imported="emit('settingsBackupImported')"
      @key-vault-deleted="emit('settingsKeyVaultDeleted')"
      @terminal-profile-deleted="emit('settingsTerminalProfileDeleted')"
      @test-alert="emit('settingsTestAlert')"
      @test-native-notification="emit('settingsTestNativeNotification')"
      @open-logs="emit('settingsOpenLogs')"
      @notify="(message, type) => emit('notify', message, type)"
    />
  </AppBackdrop>

  <MultiServerDashboardDialog
    v-if="monitorPanel"
    :open="monitorPanel.open"
    :summaries="monitorPanel.summaries"
    :connections="monitorPanel.connections"
    :selected-server-id="monitorPanel.selectedServerId"
    :active-workspace-server-id="monitorPanel.activeWorkspaceServerId"
    :snapshots="monitorPanel.snapshots"
    :histories="monitorPanel.histories"
    :initial-tab="monitorPanel.initialTab"
    :initial-server-id="monitorPanel.initialServerId"
    :batch-operation="monitorPanel.batchOperation"
    :dashboard-sort-mode="monitorPanel.dashboardSortMode"
    :dashboard-manual-server-order="monitorPanel.dashboardManualServerOrder"
    :active-alert-counts-by-server-id="monitorPanel.activeAlertCountsByServerId"
    :alert-unread-count="monitorPanel.alertUnreadCount"
    @close="emit('monitorPanelClose')"
    @dashboard-layout-change="emit('dashboardLayoutChange', $event)"
    @switch-server="emit('dashboardSwitchServer', $event)"
    @connect-server="emit('dashboardConnectServer', $event)"
    @disconnect-server="emit('dashboardDisconnectServer', $event)"
    @edit-server="emit('dashboardEditServer', $event)"
    @connect-servers="emit('dashboardConnectServers', $event)"
    @reconnect-servers="emit('dashboardReconnectServers', $event)"
    @disconnect-servers="(serverIDs, scope) => emit('dashboardDisconnectServers', serverIDs, scope)"
    @open-tunnels="emit('dashboardOpenTunnels', $event)"
    @open-docker="emit('dashboardOpenDocker', $event)"
    @open-processes="emit('dashboardOpenProcesses', $event)"
    @open-network-diagnostics="emit('dashboardOpenNetworkDiagnostics', $event)"
    @alerts="emit('dashboardAlerts')"
  />

  <template v-if="toolDialogs">
    <TunnelManagerDialog
      :open="toolDialogs.tunnelsOpen"
      :connections="toolDialogs.connections"
      :active-server-id="toolDialogs.activeServerId"
      @close="emit('closeTunnels')"
      @notify="(message, type) => emit('notify', message, type)"
    />
    <DockerManagerDialog
      :open="toolDialogs.dockerOpen"
      :connections="toolDialogs.connections"
      :active-server-id="toolDialogs.activeServerId"
      @close="emit('closeDocker')"
      @notify="(message, type) => emit('notify', message, type)"
      @connect-container="emit('dockerConnectContainer', $event)"
    />
    <ProcessManagerDialog
      :open="toolDialogs.processesOpen"
      :connections="toolDialogs.connections"
      :active-server-id="toolDialogs.activeServerId"
      :initial-pid="toolDialogs.processInitialPid"
      @close="emit('closeProcesses')"
      @notify="(message, type) => emit('notify', message, type)"
    />
    <ServiceManagerDialog
      :open="toolDialogs.servicesOpen"
      :connections="toolDialogs.connections"
      :connection-states="toolDialogs.connectionStates"
      :active-server-id="toolDialogs.activeServerId"
      @close="emit('closeServices')"
      @notify="(message, type) => emit('notify', message, type)"
    />
    <NetworkDetailsDialog
      :open="toolDialogs.networkDetailsOpen"
      :connections="toolDialogs.connections"
      :active-server-id="toolDialogs.activeServerId"
      :initial-tab="toolDialogs.networkDetailsInitialTab"
      @close="emit('closeNetworkDetails')"
      @notify="(message, type) => emit('notify', message, type)"
    />
  </template>

  <AuthDialog
    v-if="auth"
    :open="auth.open"
    :connection="auth.connection"
    :mode="auth.mode"
    :issue="auth.issue"
    @close="emit('authClose')"
    @submit="emit('authSubmit', $event)"
  />

  <ContextMenu
    v-if="contextMenu?.open"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="contextMenu.items"
    interaction-scope="server-picker-menu"
    @close="emit('contextMenuClose')"
    @select="emit('contextMenuSelect', $event)"
  />

  <AlertCenter
    v-if="alertCenter"
    :open="alertCenter.open"
    :active-events="alertCenter.activeEvents"
    :resolved-events="alertCenter.resolvedEvents"
    :all-events="alertCenter.allEvents"
    @close="emit('alertCenterClose')"
    @mark-read="emit('alertMarkRead', $event)"
    @mark-all-read="emit('alertMarkAllRead')"
    @clear-resolved="emit('alertClearResolved')"
    @mute-server="(serverID, mode) => emit('alertMuteServer', serverID, mode)"
    @unmute-server="emit('alertUnmuteServer', $event)"
    @view-monitor="emit('alertViewMonitor', $event)"
  />
  <ToastHost :toast="toast" @close="emit('toastClose')" />
  <AppDialogHost />
  <div v-if="busy" class="busy">处理中…</div>
</template>
