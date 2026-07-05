<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import ErrorBoundary from './ErrorBoundary.vue'
import SettingsView from './SettingsView.vue'
import type {
  AppSettings,
  Connection,
  ConnectionRuntimeState,
  LogEntry,
  MonitorNetworkInterfaceMode,
  MonitorNetworkInterfacePreference,
  MonitorSnapshot,
  NetworkInterface,
  NativeNotificationStatus,
  TerminalProfile,
} from '../types'
import type { PaneTargetAssignment } from '../composables/usePaneTargetRequests'
import type { AppPanelView } from '../utils/appPanelModel'
import { isAppLogsView, isMonitorView, isTerminalView } from '../utils/appPanelModel'

defineOptions({ name: 'AppPanelHost' })

const TerminalWorkspace = defineAsyncComponent(() => import('./TerminalWorkspace.vue'))
const MonitorDashboard = defineAsyncComponent(() => import('./MonitorDashboard.vue'))

export interface AppTerminalPanelState {
  connection: Connection | null
  state: ConnectionRuntimeState | null
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  layoutRevision: number
  sftpOpenRevision: number
  terminalCopyOnSelectEnabled: boolean
  terminalRightClickPasteEnabled: boolean
  shortcutSettings: AppSettings['shortcutSettings']
  commandHistoryMaxEntries: number
  connections: Connection[]
  connectionStates: Record<number, ConnectionRuntimeState>
  terminalProfiles: TerminalProfile[]
  defaultTerminalProfile: TerminalProfile | null
  terminalProfileApplyRevision: number
  networkInterfaces: NetworkInterface[]
  networkInterfacePreference: MonitorNetworkInterfacePreference | null
  networkInterfacesLoading: boolean
  alertActiveCount: number
  paneTargetAssignment: PaneTargetAssignment | null
}

export interface AppSettingsPanelState {
  settings: AppSettings
  saving: boolean
  connections: Connection[]
  nativeNotificationStatus: NativeNotificationStatus
}

export interface AppMonitorPanelState {
  selected: Connection | null
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  alertUnreadCount: number
}

export interface AppLogsPanelState {
  levelFilter: string
  query: string
  entries: LogEntry[]
}

defineProps<{
  activeView: AppPanelView
  settingsOverlayOpen: boolean
  terminal: AppTerminalPanelState
  settingsPanel: AppSettingsPanelState
  monitor: AppMonitorPanelState
  logs: AppLogsPanelState
}>()

const emit = defineEmits<{
  monitor: []
  alerts: []
  disconnectServer: [connectionId: number]
  finalTerminalDisconnect: [connectionId: number]
  openSftp: [connectionId: number]
  reconnectSftp: [connectionId: number, contextId: string, terminalSessionId: string]
  openTunnels: []
  processManager: [pid?: number]
  networkInterface: [mode: MonitorNetworkInterfaceMode, selectedNetworkInterface: string]
  networkDiagnostics: []
  networkInterfacesRefresh: []
  notify: [message: string, type: 'success' | 'error' | 'info']
  newTerminal: [connectionId?: number]
  reconnect: [sessionId: string, connectionId: number, code: string]
  trustHostKey: [connectionId: number]
  paneAddServer: [paneId: string]
  paneConnectSaved: [paneId: string]
  paneOpenLocalTerminal: [paneId: string, shellKind: 'cmd' | 'powershell']
  connectWorkspace: [connectionId: number]
  editWorkspace: [connectionId: number]
  closeSettings: []
  saveSettings: [settings: AppSettings]
  saveSettingsAndClose: [settings: AppSettings]
  previewTheme: [mode: AppSettings['themeMode']]
  previewFontSize: [size: AppSettings['uiFontSize']]
  backupImported: []
  keyVaultDeleted: []
  terminalProfileDeleted: []
  testAlert: []
  testNativeNotification: []
  openLogs: []
  monitorError: [error: unknown]
  refreshLogs: []
  closeLogs: []
  updateLogLevelFilter: [value: string]
  updateLogQuery: [value: string]
  copyLogDetail: [detail: string]
}>()

function logLevelLabel(value: string) {
  return ({ info: '信息', warn: '警告', error: '错误', debug: '调试' } as Record<string, string>)[value] ?? value
}

function updateLogLevelFilter(event: Event) {
  emit('updateLogLevelFilter', (event.target as HTMLSelectElement).value)
}

function updateLogQuery(event: Event) {
  emit('updateLogQuery', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <TerminalWorkspace
    class="preserved-terminal-workspace"
    :class="{ 'terminal-workspace-hidden': !isTerminalView(activeView) }"
    :connection="terminal.connection"
    :state="terminal.state"
    :snapshot="terminal.snapshot"
    :history="terminal.history"
    :layout-revision="terminal.layoutRevision"
    :sftp-open-revision="terminal.sftpOpenRevision"
    :terminal-copy-on-select-enabled="terminal.terminalCopyOnSelectEnabled"
    :terminal-right-click-paste-enabled="terminal.terminalRightClickPasteEnabled"
    :shortcut-settings="terminal.shortcutSettings"
    :command-history-max-entries="terminal.commandHistoryMaxEntries"
    :connections="terminal.connections"
    :connection-states="terminal.connectionStates"
    :terminal-profiles="terminal.terminalProfiles"
    :default-terminal-profile="terminal.defaultTerminalProfile ?? undefined"
    :terminal-profile-apply-revision="terminal.terminalProfileApplyRevision"
    :network-interfaces="terminal.networkInterfaces"
    :network-interface-preference="terminal.networkInterfacePreference"
    :network-interfaces-loading="terminal.networkInterfacesLoading"
    :alert-active-count="terminal.alertActiveCount"
    :pane-target-assignment="terminal.paneTargetAssignment"
    :visible="isTerminalView(activeView)"
    @monitor="emit('monitor')"
    @alerts="emit('alerts')"
    @disconnect-server="emit('disconnectServer', $event)"
    @final-terminal-disconnect="emit('finalTerminalDisconnect', $event)"
    @open-sftp="emit('openSftp', $event)"
    @reconnect-sftp="(connectionId, contextId, terminalSessionId) => emit('reconnectSftp', connectionId, contextId, terminalSessionId)"
    @open-tunnels="emit('openTunnels')"
    @process-manager="emit('processManager', $event)"
    @network-interface="(mode, selected) => emit('networkInterface', mode, selected)"
    @network-diagnostics="emit('networkDiagnostics')"
    @network-interfaces-refresh="emit('networkInterfacesRefresh')"
    @notify="(message, type) => emit('notify', message, type)"
    @new-terminal="emit('newTerminal', $event)"
    @reconnect="(sessionId, connectionId, code) => emit('reconnect', sessionId, connectionId, code)"
    @trust-host-key="emit('trustHostKey', $event)"
    @pane-add-server="emit('paneAddServer', $event)"
    @pane-connect-saved="emit('paneConnectSaved', $event)"
    @pane-open-local-terminal="(paneId, shellKind) => emit('paneOpenLocalTerminal', paneId, shellKind)"
    @connect-workspace="emit('connectWorkspace', $event)"
    @edit-workspace="emit('editWorkspace', $event)"
  >
    <template #tabs>
      <slot name="tabs" />
    </template>
  </TerminalWorkspace>

  <div
    v-if="settingsOverlayOpen"
    class="settings-overlay-backdrop"
    data-testid="settings-overlay"
  >
    <SettingsView
      overlay
      :settings="settingsPanel.settings"
      :saving="settingsPanel.saving"
      :connections="settingsPanel.connections"
      :native-notification-status="settingsPanel.nativeNotificationStatus"
      @close-request="emit('closeSettings')"
      @save="emit('saveSettings', $event)"
      @save-and-close="emit('saveSettingsAndClose', $event)"
      @preview-theme="emit('previewTheme', $event)"
      @preview-font-size="emit('previewFontSize', $event)"
      @backup-imported="emit('backupImported')"
      @key-vault-deleted="emit('keyVaultDeleted')"
      @terminal-profile-deleted="emit('terminalProfileDeleted')"
      @test-alert="emit('testAlert')"
      @test-native-notification="emit('testNativeNotification')"
      @open-logs="emit('openLogs')"
      @notify="(message, type) => emit('notify', message, type)"
    />
  </div>

  <template v-if="isMonitorView(activeView)">
    <ErrorBoundary v-if="monitor.selected" @error="emit('monitorError', $event)">
      <MonitorDashboard
        :snapshot="monitor.snapshot"
        :history="monitor.history"
        show-alert-center
        :alert-unread-count="monitor.alertUnreadCount"
        @alerts="emit('alerts')"
      />
    </ErrorBoundary>
    <section v-else class="monitor-empty">
      <h2>请选择服务器</h2>
      <p>使用顶部 `+` 选择服务器后查看完整监控数据。</p>
    </section>
  </template>

  <section v-if="isAppLogsView(activeView)" class="logs-panel">
    <header>
      <h2>应用日志</h2>
      <div class="log-filters">
        <select :value="logs.levelFilter" aria-label="日志级别筛选" @change="updateLogLevelFilter">
          <option value="all">全部级别</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
          <option value="debug">调试</option>
        </select>
        <input :value="logs.query" placeholder="搜索服务器、操作或错误码" @input="updateLogQuery" />
        <button class="secondary app-log-refresh-button" @click="emit('refreshLogs')">刷新</button>
        <button class="secondary app-log-close-button" @click="emit('closeLogs')">关闭</button>
      </div>
    </header>
    <div class="log-table">
      <div v-for="(entry, index) in logs.entries" :key="`${entry.time}-${index}`" class="log-row">
        <time>{{ new Date(entry.time).toLocaleString() }}</time>
        <span class="log-level" :class="entry.level">{{ logLevelLabel(entry.level) }}</span>
        <strong>{{ entry.serverName || '应用' }}</strong>
        <span>{{ entry.summary || entry.message }}</span>
        <code>{{ entry.operation }}</code>
        <code v-if="entry.errorCode" class="log-code">{{ entry.errorCode }}</code>
        <details v-if="entry.technicalMessage || entry.error" class="log-detail">
          <summary>查看技术详情</summary>
          <pre>{{ entry.technicalMessage || entry.error }}</pre>
          <button class="text-button" @click="emit('copyLogDetail', entry.technicalMessage || entry.error || '')">复制详情</button>
        </details>
      </div>
      <p v-if="logs.entries.length === 0" class="empty">暂无符合条件的日志</p>
    </div>
  </section>
</template>
