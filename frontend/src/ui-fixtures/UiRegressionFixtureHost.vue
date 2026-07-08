<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ContextMenu from '../components/ContextMenu.vue'
import AlertCenter from '../components/AlertCenter.vue'
import MonitorDashboard from '../components/MonitorDashboard.vue'
import MultiServerDashboardDialog from '../components/MultiServerDashboardDialog.vue'
import CompactMonitorSidebar from '../components/CompactMonitorSidebar.vue'
import TerminalCompletionOverlay from '../components/TerminalCompletionOverlay.vue'
import ServerPicker from '../components/ServerPicker.vue'
import AppIcon from '../components/icons/AppIcon.vue'
import SftpDetailsPane from '../components/SftpDetailsPane.vue'
import SftpFileTable from '../components/SftpFileTable.vue'
import SftpToolbar, { type SftpToolbarAction } from '../components/SftpToolbar.vue'
import RemoteTextViewer from '../components/RemoteTextViewer.vue'
import RemoteTextEditor from '../components/RemoteTextEditor.vue'
import ServiceManagerDetails from '../components/service-manager/ServiceManagerDetails.vue'
import ServiceManagerList from '../components/service-manager/ServiceManagerList.vue'
import type { AlertEvent, CommandFavorite, CommandHistoryEntry, CommandSuggestion, Connection, ConnectionStatus, ContextMenuItem, LocalTerminalCapabilities, MonitorSnapshot, ServiceJournalLine, ServiceManagerCapability, ServiceManagerInitSystem, SFTPEntry, SFTPReadTextFileResult, SystemServiceDetail, SystemServiceSummary } from '../types'
import { formatBytes } from '../utils/format'
import { buildCommandCompletionSuggestions, commandCompletionToken, commandCompletionTriggerLength, completionInsertText } from '../composables/useCommandCompletion'
import { terminalCompletionOverlayCssWidth, terminalCompletionOverlayWidth } from '../composables/terminalCompletionPosition'
import { builtinLinuxCommandCompletions, commonLinuxCommandCompletions } from '../data/linuxCommandCompletions'
import {
  getSshCommandCompletionMaxSuggestions,
  getSshCommandCompletionTriggerChars,
  isSshCommandCompletionDescriptionVisible,
  isSshCommandCompletionEnabled,
  setSshCommandCompletionEnabled,
  setSshCommandCompletionMaxSuggestions,
  setSshCommandCompletionShowDescriptions,
  setSshCommandCompletionTriggerChars,
} from '../utils/sshCommandCompletionPreference'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'
import {
  defaultFileColumnLayout,
  FILE_COLUMN_BY_ID,
  clampFileColumnWidth,
  type FileColumn,
  type FileColumnId,
  type FileSortableColumnId,
} from '../utils/sftpFileColumns'
import type { SftpHighlightSegment } from '../utils/sftpFileFilter'
import type { DashboardServerSummary } from '../utils/multiServerDashboard'
import { getUiRegressionFixturesBySurface, type SftpFixtureData } from './uiRegressionFixtures'
import { useDockedCommandButton } from '../composables/useDockedCommandButton'

type FixtureName =
  | 'server-picker-search-debian'
  | 'server-picker-many-servers'
  | 'server-picker-search-empty'
  | 'server-picker-macos-local'
  | 'split-pane-two-empty'
  | 'split-pane-quad-empty-narrow'
  | 'workspace-tabs-many'
  | 'command-button-dock'
  | 'ssh-command-completion'
  | 'ssh-command-completion-split'
  | 'local-command-completion-disabled'
  | 'settings-backup-restore-options'
  | 'settings-native-notification'
  | 'settings-nav-final'
  | 'settings-content-scroll'
  | 'settings-font-slider-alignment'
  | 'settings-terminal-profile-spacing'
  | 'settings-header-actions'
  | 'compact-network-card-stats'
  | 'compact-network-card-stats-ens192'
  | 'local-terminal-cmd-workspace'
  | 'local-terminal-powershell-workspace'
  | 'local-terminal-macos-workspace'
  | 'local-terminal-gpu-unavailable'
  | 'settings-macos-dark-overlays'
  | 'transfer-popover-many'
  | 'service-manager-journal-narrow'
  | 'service-manager-openwrt-logread'
  | 'service-manager-openwrt-logread-unavailable'
  | 'service-manager-openwrt-logread-long-lines'
  | 'sftp-file-list-standard'
  | 'sftp-file-list-long-names'
  | 'sftp-toolbar-narrow'
  | 'sftp-context-menu-edge'
  | 'sftp-empty-directory'
  | 'sftp-loading-error'
  | 'sftp-selection-actions'
  | 'sftp-transfer-entry'
  | 'remote-text-viewer-toolbar'
  | 'remote-text-editor-toolbar'
  | 'docker-manager-container-list'
  | 'docker-manager-logs-stats-narrow'
  | 'docker-manager-batch-actions'
  | 'docker-manager-compose-supported'
  | 'docker-manager-compose-unavailable'
  | 'docker-manager-compose-narrow'
  | 'tunnel-manager-profile-list'
  | 'tunnel-manager-form-narrow'
  | 'process-manager-list-long-command'
  | 'process-manager-action-confirm'
  | 'network-diagnostics-summary'
  | 'connection-dialog-password'
  | 'connection-dialog-keyvault'
  | 'connection-dialog-advanced'
  | 'auth-dialog-password-error'
  | 'auth-dialog-key-passphrase'
  | 'host-key-trust-changed'
  | 'key-vault-list-empty-and-many'
  | 'key-vault-edit-form'
  | 'alert-center-list'
  | 'monitor-alert-center-entry'
  | 'dashboard-alert-center-layer'
  | 'app-logs-long-lines'
  | 'command-palette-search-disabled'
  | 'command-palette-management'
  | 'command-palette-no-results'

interface ServerPickerFixtureData {
  query: string
  servers: Array<{
    id: number
    name: string
    host: string
    port: number
    groupId: number | null
    connected: boolean
  }>
}

interface SplitPaneFixtureData {
  activePaneId: string
  panes: Array<{
    id: string
    assigned: boolean
  }>
}

interface SettingsFixtureData {
  importOptions?: Array<{ id: string; checked: boolean }>
  saved: boolean
  nativeNotifications?: { enabled: boolean; available: boolean }
}

type CommandManagementShell = 'ssh' | 'cmd' | 'powershell'
type CommandManagementTab = 'history' | 'favorites'

interface CommandManagementFavorite {
  id: string
  title: string
  command: string
  shell: CommandManagementShell | 'any'
}

interface TransferFixtureData {
  items: Array<{
    id: string
    name: string
    direction: 'upload' | 'download'
    status: 'active' | 'completed' | 'failed'
    percent: number
  }>
}

interface ServiceManagerFixtureData {
  initSystem?: ServiceManagerInitSystem
  journalSourceText?: string
  journalRefreshSupported?: boolean
  journalFollowSupported?: boolean
  journalFollowDisabledReason?: string
  selectedServiceId: string
  services: Array<{ id: string; name: string; description: string; status: 'running' | 'failed' | 'stopped' }>
  lines: Array<{ id: string; level: 'info' | 'warning' | 'error'; message: string }>
}

const fixtureName = computed(() => {
  const requested = new URLSearchParams(window.location.search).get('fixture') as FixtureName | null
  return requested ?? 'server-picker-search-debian'
})
const anchor = ref<HTMLElement | null>(null)
const pickerQuery = ref(serverPickerData('search-debian-one-result').query)
const tabCloseCount = ref(0)
const activeTabId = ref('tab-8')
const topbarMenuOpen = ref(false)
const commandButtonDockStage = ref<HTMLElement>()
const commandFixtureClickCount = ref(0)
const activeDetailTab = ref<'detail' | 'logs'>('logs')
const sftpContextMenuClosed = ref(false)
const monitorAlertCenterOpen = ref(false)
const dashboardAlertCenterOpen = ref(false)
const dashboardConnectEventCount = ref(0)
const sshCompletionInput = ref('')
const sshCompletionExecutedCount = ref(0)
const sshCompletionSelectedIndex = ref(0)
const sshCompletionFocusedPane = ref<'left' | 'right'>('left')
const sshCompletionAccepted = ref(false)
const sshCompletionEnabled = ref(isSshCommandCompletionEnabled())
const sshCompletionShowDescriptions = ref(isSshCommandCompletionDescriptionVisible())
const sshCompletionMaxSuggestions = ref(getSshCommandCompletionMaxSuggestions())
const sshCompletionTriggerChars = ref(getSshCommandCompletionTriggerChars())
const localCompletionDisabledInput = ref('')
const commandManagementShell = ref<CommandManagementShell>('cmd')
const commandManagementTab = ref<CommandManagementTab>('history')
const commandManagementQuery = ref('')
const commandManagementHistories = ref<Record<CommandManagementShell, string[]>>({
  ssh: ['ssh-fixture-health', 'ssh-fixture-disk'],
  cmd: ['cmd-fixture-list', 'cmd-fixture-network'],
  powershell: ['ps-fixture-list', 'ps-fixture-process'],
})
const commandManagementFavorites = ref<CommandManagementFavorite[]>([
  { id: 'fav-any', title: 'Any fixture echo', command: 'any-fixture-echo', shell: 'any' },
  { id: 'fav-ssh', title: 'SSH fixture status', command: 'ssh-fixture-status', shell: 'ssh' },
  { id: 'fav-cmd', title: 'CMD fixture list', command: 'cmd-fixture-list', shell: 'cmd' },
  { id: 'fav-ps', title: 'PowerShell fixture list', command: 'ps-fixture-list', shell: 'powershell' },
])
const commandManagementEditingFavoriteId = ref('')
const commandManagementEditTitle = ref('')
const commandManagementEditCommand = ref('')
const topbarFixtureItems = [
  { label: 'SSH 工作区', icon: 'terminal', active: true, badge: 0 },
  { label: '端口转发', icon: 'route', active: false, badge: 0 },
  { label: '容器管理', icon: 'box', active: false, badge: 0 },
  { label: '进程管理', icon: 'activity', active: false, badge: 0 },
  { label: '系统服务', icon: 'service', active: false, badge: 0 },
  { label: '网络详情', icon: 'network', active: false, badge: 0 },
  { label: '告警中心', icon: 'bell', active: false, badge: 2 },
  { label: '监控面板', icon: 'gauge', active: false, badge: 0 },
  { label: '设置', icon: 'gear', active: false, badge: 0 },
]
const settingsScrollCategories = [
  { id: 'appearance', label: '常规', icon: 'gear' },
  { id: 'terminal', label: '终端', icon: 'terminal' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'alerts', label: '告警', icon: 'bell' },
  { id: 'backup', label: '备份 / 恢复', icon: 'backup' },
  { id: 'keyvault', label: '密钥库', icon: 'key' },
]
const settingsScrollActive = ref(settingsScrollCategories[0].id)
const {
  buttonRef: commandFixtureButtonRef,
  buttonStyle: commandFixtureButtonStyle,
  dragging: commandFixtureButtonDragging,
  onPointerDown: startCommandFixtureButtonDrag,
  consumeClickAfterDrag: consumeCommandFixtureClickAfterDrag,
  cleanup: cleanupCommandFixtureButtonDock,
} = useDockedCommandButton(commandButtonDockStage)

function clickCommandFixtureButton() {
  if (consumeCommandFixtureClickAfterDrag()) return
  commandFixtureClickCount.value += 1
}

onBeforeUnmount(() => {
  cleanupCommandFixtureButtonDock()
  stopDockerComposeFixtureFollow()
  stopProcessFixtureColumnResize()
  stopNetworkEndpointFixtureColumnResize()
  stopFixtureBottomPanelResize()
})

const compactNetworkConnection: Connection = {
  id: 501,
  groupId: null,
  name: 'layout-fixture',
  host: '198.51.100.50',
  port: 22,
  username: 'fixture',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 1,
  createdAt: '2026-07-03T00:00:00Z',
  updatedAt: '2026-07-03T00:00:00Z',
}

const compactNetworkSnapshot: MonitorSnapshot = {
  connectionId: 501,
  status: 'online',
  timestamp: '2026-07-03T00:00:00Z',
  latencyMillis: 8,
  latencyAvailable: true,
  cpuPercent: 18,
  memoryTotal: 8_589_934_592,
  memoryAvailable: 4_294_967_296,
  memoryUsedPercent: 50,
  swapTotal: 2_147_483_648,
  swapFree: 1_610_612_736,
  diskTotal: 128_849_018_880,
  diskUsed: 64_424_509_440,
  diskUsedPercent: 50,
  loadOne: 0.22,
  loadFive: 0.18,
  loadFifteen: 0.12,
  uptimeSeconds: 86400,
  defaultInterface: 'eth0',
  effectiveNetworkInterface: 'eth0',
  networkInterfaceMode: 'interface',
  selectedNetworkInterface: 'eth0',
  downloadBytesPerSecond: 151_760_896,
  uploadBytesPerSecond: 18_350_080,
  osName: 'Linux',
  kernel: '6.6',
  architecture: 'x86_64',
  mounts: [
    { filesystem: '/dev/root', mountPath: '/', total: 100 * 1024 ** 3, used: 55 * 1024 ** 3, available: 45 * 1024 ** 3, usedPercent: 55 },
    { filesystem: '/dev/data', mountPath: '/data', total: 200 * 1024 ** 3, used: 40 * 1024 ** 3, available: 160 * 1024 ** 3, usedPercent: 20 },
  ],
  processes: [
    { pid: 1001, cpuPercent: 2, memoryPercent: 18, command: 'memory-heavy' },
    { pid: 1002, cpuPercent: 31, memoryPercent: 4, command: 'cpu-heavy' },
  ],
  processStatus: 'available',
  processMessage: '',
  errors: [],
  errorCode: '',
  message: '',
  monitorActive: true,
}

const compactNetworkHistory = Array.from({ length: 16 }, (_, index) => ({
  ...compactNetworkSnapshot,
  timestamp: `2026-07-03T00:00:${String(index).padStart(2, '0')}Z`,
  downloadBytesPerSecond: 72_000_000 + index * 4_750_000,
  uploadBytesPerSecond: 5_000_000 + index * 860_000,
}))
const compactNetworkInterfaceName = computed(() =>
  shouldRender('compact-network-card-stats-ens192') ? 'ens192' : 'eth0')
const compactNetworkFixtureSnapshot = computed<MonitorSnapshot>(() => ({
  ...compactNetworkSnapshot,
  defaultInterface: compactNetworkInterfaceName.value,
  effectiveNetworkInterface: compactNetworkInterfaceName.value,
  selectedNetworkInterface: compactNetworkInterfaceName.value,
}))
const compactNetworkFixtureHistory = computed(() => compactNetworkHistory.map((item) => ({
  ...item,
  defaultInterface: compactNetworkInterfaceName.value,
  effectiveNetworkInterface: compactNetworkInterfaceName.value,
  selectedNetworkInterface: compactNetworkInterfaceName.value,
})))
const compactNetworkFixtureInterfaces = computed(() => [{
  serverID: 501,
  name: compactNetworkInterfaceName.value,
  displayName: compactNetworkInterfaceName.value,
  isUp: true,
  isLoopback: false,
  ipv4: ['198.51.100.50'],
  ipv6: [],
  rxBytes: 1000,
  txBytes: 2000,
  lastUpdatedAt: '2026-07-03T00:00:00Z',
}])

const remoteTextEntry: SFTPEntry = {
  name: 'fixture.conf',
  path: '/etc/serverpilot/fixture.conf',
  parentPath: '/etc/serverpilot',
  size: 86,
  isDir: false,
  isSymlink: false,
  permissions: '-rw-r--r--',
  owner: 'root',
  group: 'root',
  modTime: '2026-07-03T00:00:00Z',
}

const remoteTextFile: SFTPReadTextFileResult = {
  connectionId: 501,
  contextId: 'server:501',
  generation: 1,
  requestId: 'fixture-read-1',
  entry: remoteTextEntry,
  content: 'alpha=1\nbeta=2\nalpha=3',
  encoding: 'utf-8',
  truncated: false,
  detectedLanguage: 'properties',
  textKind: 'plaintext',
}

function fixtureData<T>(surface: Parameters<typeof getUiRegressionFixturesBySurface>[0], state: string) {
  const fixture = getUiRegressionFixturesBySurface(surface).find((item) => item.state === state)
  if (!fixture) throw new Error(`Missing UI regression fixture: ${surface}/${state}`)
  return fixture.data as T
}

function serverPickerData(state: string) {
  return fixtureData<ServerPickerFixtureData>('server-picker-geometry', state)
}

const macosLocalTerminalCapabilities: LocalTerminalCapabilities = {
  platform: 'darwin',
  enabled: true,
  supported: true,
  conptyAvailable: false,
  isProcessElevated: false,
  supportsElevation: false,
  shellOptions: [{ id: 'local', label: '本地终端', description: '$SHELL' }],
  adminShellOptions: [],
  defaultShellPreference: 'local',
  currentShellPreference: 'local',
  unsupportedMessage: '',
}

const currentServerPickerData = computed(() => {
  if (fixtureName.value === 'server-picker-many-servers') return serverPickerData('many-servers')
  if (fixtureName.value === 'server-picker-search-empty') return serverPickerData('search-no-result')
  if (fixtureName.value === 'server-picker-macos-local') return serverPickerData('search-no-result')
  return serverPickerData('search-debian-one-result')
})

const serverPickerGroups = computed(() => [{
  id: 0,
  name: currentServerPickerData.value.query ? '搜索结果' : '默认分组',
  items: currentServerPickerData.value.servers.map(toConnection),
}])

const serverPickerStatuses = computed<Record<number, ConnectionStatus>>(() =>
  Object.fromEntries(currentServerPickerData.value.servers.map((server) => [server.id, server.connected ? 'online' : 'offline'])))

const splitPaneData = computed(() =>
  fixtureData<SplitPaneFixtureData>('split-pane-empty-state', fixtureName.value === 'split-pane-quad-empty-narrow' ? 'narrow-width' : 'two-pane-empty'))

const settingsData = computed(() =>
  fixtureData<SettingsFixtureData>('settings-state-ui', fixtureName.value === 'settings-native-notification' ? 'native-notification-unavailable' : 'manual-uncheck'))

const defaultSettingsData = computed(() =>
  fixtureData<SettingsFixtureData>('settings-state-ui', 'backup-import-five-options'))

const transferData = computed(() =>
  fixtureData<TransferFixtureData>('transfer-popover', 'many-items'))

const serviceManagerFixtureStates = new Set<string>([
  'service-manager-journal-narrow',
  'service-manager-openwrt-logread',
  'service-manager-openwrt-logread-unavailable',
  'service-manager-openwrt-logread-long-lines',
])

const serviceData = computed(() =>
  fixtureData<ServiceManagerFixtureData>(
    'manager-dialogs',
    serviceManagerFixtureStates.has(fixtureName.value) ? fixtureName.value : 'service-manager-journal-narrow',
  ))

const sftpFixtureStateByName: Record<string, string> = {
  'sftp-file-list-standard': 'file-list-standard',
  'sftp-file-list-long-names': 'file-list-long-names',
  'sftp-toolbar-narrow': 'toolbar-narrow',
  'sftp-context-menu-edge': 'context-menu-edge',
  'sftp-empty-directory': 'empty-directory',
  'sftp-loading-error': 'loading-error',
  'sftp-selection-actions': 'selection-actions',
  'sftp-transfer-entry': 'transfer-entry',
}

const sftpData = computed(() => fixtureData<SftpFixtureData>('sftp-real-render', sftpFixtureStateByName[fixtureName.value] ?? 'file-list-standard'))
const sftpColumnLayout = defaultFileColumnLayout()
const sftpColumns = sftpColumnLayout.columnOrder.map((columnId) => FILE_COLUMN_BY_ID.get(columnId)).filter(Boolean) as NonNullable<ReturnType<typeof FILE_COLUMN_BY_ID.get>>[]
const sftpTableGridStyle = {
  gridTemplateColumns: sftpColumns.map((column) => `${sftpColumnLayout.columnWidths[column.id]}px`).join(' '),
  minWidth: `${sftpColumns.reduce((total, column) => total + sftpColumnLayout.columnWidths[column.id], 0) + (sftpColumns.length - 1) * 8 + 20}px`,
}
const localExplorerColumnIds: FileColumnId[] = ['name', 'modTime', 'size', 'type']
const localExplorerColumns = localExplorerColumnIds
  .map((columnId) => FILE_COLUMN_BY_ID.get(columnId))
  .filter((column): column is FileColumn => Boolean(column))
const localExplorerColumnWidths = ref<Record<FileColumnId, number>>({
  name: 260,
  modTime: 150,
  size: 84,
  type: 74,
  permissions: 92,
  owner: 74,
  group: 74,
})
const localExplorerSortKey = ref<FileSortableColumnId>('name')
const localExplorerSortAsc = ref(true)
const localExplorerResizingColumnId = ref<FileColumnId | null>(null)
let localExplorerResizingColumn: { id: FileColumnId; startX: number; startWidth: number } | null = null
const localNetworkInterface = ref('Wi-Fi')
const localSystemExpanded = ref(false)
const localWorkspaceMode = ref<'local' | 'ssh'>('local')
const fixtureBottomPanelExpanded = ref(true)
let fixtureBottomPanelResizeRoot: HTMLElement | null = null
const localCommandPaletteOpen = ref(false)
const localTerminalFixtureInput = ref('')
const localCommandHistoryStorageKeys = {
  cmd: 'serverpilot.commandHistory.local.cmd',
  powershell: 'serverpilot.commandHistory.local.powershell',
} as const
const localCommandHistory = ref<Record<'cmd' | 'powershell', string[]>>({
  cmd: readLocalFixtureCommandHistory('cmd'),
  powershell: readLocalFixtureCommandHistory('powershell'),
})
const localExplorerOpenCount = ref(0)
const localExplorerRevealCount = ref(0)
const localExplorerContextMenu = ref<{
  x: number
  y: number
  items: ContextMenuItem[]
  target: SftpDisplayEntry | null
} | null>(null)
const localExplorerParentEntry = computed<SftpDisplayEntry>(() => ({
  name: '..',
  path: 'C:\\Temp',
  parentPath: localExplorerFixturePath.value,
  size: 0,
  isDir: true,
  isSymlink: false,
  permissions: '',
  owner: '',
  group: '',
  modTime: '',
  syntheticParent: true,
}))
const localExplorerBaseEntries: SftpDisplayEntry[] = [{
  name: 'Documents',
  path: 'C:\\Temp\\Fixture\\Documents',
  parentPath: 'C:\\Temp\\Fixture',
  size: 0,
  isDir: true,
  isSymlink: false,
  permissions: '',
  owner: '',
  group: '',
  modTime: '2026-07-03T12:00:00Z',
}, {
  name: 'notes.txt',
  path: 'C:\\Temp\\Fixture\\notes.txt',
  parentPath: 'C:\\Temp\\Fixture',
  size: 2048,
  isDir: false,
  isSymlink: false,
  permissions: '',
  owner: '',
  group: '',
  modTime: '2026-07-04T12:00:00Z',
}]
const localExplorerTableGridStyle = computed(() => {
  const widths = localExplorerColumns.map((column) => localExplorerColumnWidths.value[column.id])
  return {
    gridTemplateColumns: widths.map((width) => `${width}px`).join(' '),
    minWidth: `${widths.reduce((total, width) => total + width, 0) + (localExplorerColumns.length - 1) * 8 + 20}px`,
  }
})
const localExplorerEntries = computed(() =>
  [localExplorerParentEntry.value, ...localExplorerBaseEntries.slice().sort((left, right) =>
    compareFixtureEntries(left, right, localExplorerSortKey.value, localExplorerSortAsc.value))])
const localShellScope = computed<'cmd' | 'powershell'>(() =>
  shouldRender('local-terminal-powershell-workspace') ? 'powershell' : 'cmd')
const isMacosLocalFixture = computed(() => shouldRender('local-terminal-macos-workspace'))
const localTerminalFixtureLabel = computed(() =>
  isMacosLocalFixture.value ? '本地终端' : shouldRender('local-terminal-powershell-workspace') ? 'PowerShell' : 'CMD')
const localPlatformFixtureLabel = computed(() => isMacosLocalFixture.value ? 'macOS' : 'windows')
const localSystemFixtureSummary = computed(() => isMacosLocalFixture.value ? 'macOS 15.5 fixture' : 'Windows 11 fixture')
const visibleLocalCommandHistory = computed(() => localCommandHistory.value[localShellScope.value])
const localExplorerFixtureHome = computed(() => isMacosLocalFixture.value ? '/Users/fixture' : 'C:\\Users\\Fixture')
const localExplorerFixturePath = ref(fixtureName.value === 'local-terminal-macos-workspace' ? '/Users/fixture' : 'C:\\Temp\\Fixture')
const sftpEntries = computed<SftpDisplayEntry[]>(() => sftpData.value.entries)
const sftpSelectedEntries = computed(() => sftpEntries.value.filter((entry) => sftpData.value.selectedPaths.includes(entry.path)))
const sftpToolbarActions = computed<SftpToolbarAction[]>(() => [{
  id: 'reconnect',
  label: 'Reconnect',
}, {
  id: 'back',
  label: 'Back',
  disabled: true,
}, {
  id: 'forward',
  label: 'Forward',
  disabled: true,
}, {
  id: 'refresh',
  label: 'Refresh',
}, {
  id: 'parent',
  label: 'Up',
}, {
  id: 'home',
  label: 'Home',
}, {
  id: 'bookmark',
  label: 'Star',
}, {
  id: 'bookmarks',
  label: 'Bookmarks',
}, {
  id: 'open',
  label: 'Open',
  disabled: sftpSelectedEntries.value.length !== 1 || sftpSelectedEntries.value[0]?.isDir,
}, {
  id: 'mkdir',
  label: 'New folder',
}, {
  id: 'new-file',
  label: 'New file',
}, {
  id: 'upload',
  label: 'Upload',
}, {
  id: 'upload-directory',
  label: 'Upload dir',
}, {
  id: 'download',
  label: 'Download',
  disabled: sftpSelectedEntries.value.length === 0,
}, {
  id: 'properties',
  label: 'Properties',
  disabled: sftpSelectedEntries.value.length !== 1,
}, {
  id: 'delete',
  label: 'Delete',
  tone: 'danger',
  disabled: sftpSelectedEntries.value.length === 0,
}, {
  id: 'rename',
  label: 'Rename',
  disabled: sftpSelectedEntries.value.length !== 1,
}, {
  id: 'hidden',
  label: 'Hidden',
}, {
  id: 'conflict-policy',
  label: 'Conflict',
}])
const sftpDetailsRows = computed(() => {
  const entry = sftpSelectedEntries.value[0]
  if (!entry || sftpSelectedEntries.value.length !== 1) return []
  return [
    { label: 'Name', value: entry.name, title: entry.name },
    { label: 'Path', value: entry.path, title: entry.path, code: true },
    { label: 'Size', value: formatBytes(entry.size) },
    { label: 'Mode', value: entry.permissions, code: true },
    { label: 'Owner', value: entry.owner },
    { label: 'Group', value: entry.group },
  ]
})
const sftpContextMenuItems: ContextMenuItem[] = [
  { id: 'open', label: 'Open' },
  { id: 'download', label: 'Download' },
  { id: 'rename', label: 'Rename' },
  { id: 'properties', label: 'Properties' },
  { id: 'delete', label: 'Delete', danger: true },
  { id: 'disabled', label: 'Disabled item', disabled: true },
]
const dockerManagerFixtureNames = new Set<FixtureName>([
  'docker-manager-container-list',
  'docker-manager-logs-stats-narrow',
  'docker-manager-batch-actions',
  'docker-manager-compose-supported',
  'docker-manager-compose-unavailable',
  'docker-manager-compose-narrow',
])
const tunnelManagerFixtureNames = new Set<FixtureName>([
  'tunnel-manager-profile-list',
  'tunnel-manager-form-narrow',
])
const processManagerFixtureNames = new Set<FixtureName>([
  'process-manager-list-long-command',
  'process-manager-action-confirm',
])
const dockerContainers = Array.from({ length: 8 }, (_, index) => ({
  id: `container-${index + 1}`,
  name: index === 0
    ? 'api-worker-with-very-long-container-name-for-layout-checks'
    : `fixture-container-${index + 1}`,
  image: index === 0
    ? 'registry.example.invalid/platform/api-worker:2026.07-layout-fixture'
    : `fixture-image:${index + 1}`,
  shortID: `abc123${index + 1}`,
  state: index % 3 === 0 ? 'running' : 'exited',
  status: index % 3 === 0 ? 'Up 2 hours' : 'Exited 0',
  ports: index % 2 === 0 ? `127.0.0.1:${8080 + index}->80/tcp` : '',
  selected: index < 3,
}))
const dockerLogLines = Array.from({ length: 28 }, (_, index) =>
  `2026-07-03T10:${String(index).padStart(2, '0')}:00Z synthetic docker line ${index + 1}`)
const dockerComposeProjects = [
  { name: 'edge', status: 'running(2)', configFiles: '/srv/edge/compose.yml', workingDir: '/srv/edge' },
  { name: 'ops', status: 'exited(1)', configFiles: '/srv/ops/compose.yml', workingDir: '/srv/ops' },
]
const dockerComposeServices = [
  { service: 'web', name: 'edge-web-1', image: 'nginx:alpine', state: 'running', status: 'Up 2 minutes', ports: '0.0.0.0:8080->80/tcp' },
  { service: 'db', name: 'edge-db-1', image: 'postgres:16', state: 'exited', status: 'Exit 0', ports: '' },
]
const dockerComposeLogLines = Array.from({ length: 34 }, (_, index) =>
  `2026-07-03T11:${String(index).padStart(2, '0')}:00Z synthetic compose log ${index + 1}`)
const dockerComposeProjectFilter = ref('')
const dockerComposeServiceFilter = ref('')
const dockerComposeVisibleLogs = ref(dockerComposeLogLines.join('\n'))
const dockerComposeFollowing = ref(false)
const dockerComposePaused = ref(false)
const dockerComposeFollowCount = ref(0)
const dockerComposeCopied = ref(false)
let dockerComposeFollowTimer: ReturnType<typeof setInterval> | null = null
const filteredDockerComposeProjects = computed(() =>
  dockerComposeProjects.filter((project) => !dockerComposeProjectFilter.value ||
    [project.name, project.status, project.configFiles, project.workingDir].some((value) =>
      value.toLowerCase().includes(dockerComposeProjectFilter.value.toLowerCase()))))
const filteredDockerComposeServices = computed(() =>
  dockerComposeServices.filter((service) => !dockerComposeServiceFilter.value ||
    [service.service, service.name, service.image, service.state, service.status, service.ports].some((value) =>
      value.toLowerCase().includes(dockerComposeServiceFilter.value.toLowerCase()))))

function startDockerComposeFixtureFollow() {
  if (dockerComposeFollowing.value) {
    stopDockerComposeFixtureFollow()
    return
  }
  dockerComposeFollowing.value = true
  dockerComposePaused.value = false
  dockerComposeFollowCount.value += 1
  dockerComposeFollowTimer = setInterval(() => {
    if (dockerComposeFollowing.value && !dockerComposePaused.value) dockerComposeFollowCount.value += 1
  }, 500)
}

function toggleDockerComposeFixturePause() {
  if (!dockerComposeFollowing.value) return
  dockerComposePaused.value = !dockerComposePaused.value
}

function stopDockerComposeFixtureFollow() {
  dockerComposeFollowing.value = false
  dockerComposePaused.value = false
  if (dockerComposeFollowTimer) {
    clearInterval(dockerComposeFollowTimer)
    dockerComposeFollowTimer = null
  }
}

function closeDockerComposeFixture() {
  stopDockerComposeFixtureFollow()
}

async function copyDockerComposeFixtureLogs() {
  dockerComposeCopied.value = true
  try {
    await navigator.clipboard?.writeText(dockerComposeVisibleLogs.value)
  } catch {
    // Browser fixtures only need to verify the UI action path.
  }
}

function processFixtureSortArrow(key: (typeof processFixtureColumns)[number]['key']) {
  if (processFixtureSortKey.value !== key) return ''
  return processFixtureSortDir.value === 'desc' ? '↓' : '↑'
}

function toggleProcessFixtureSort(key: (typeof processFixtureColumns)[number]['key']) {
  if (processFixtureSortKey.value === key) {
    processFixtureSortDir.value = processFixtureSortDir.value === 'desc' ? 'asc' : 'desc'
    return
  }
  processFixtureSortKey.value = key
  processFixtureSortDir.value = 'desc'
}

function startProcessFixtureColumnResize(index: number, event: MouseEvent) {
  processFixtureResizeState = { index, startX: event.clientX, widths: [...processFixtureColumnWidths.value] }
  window.addEventListener('mousemove', resizeProcessFixtureColumn)
  window.addEventListener('mouseup', stopProcessFixtureColumnResize)
  event.preventDefault()
}

function resizeProcessFixtureColumn(event: MouseEvent) {
  if (!processFixtureResizeState) return
  const next = [...processFixtureResizeState.widths]
  next[processFixtureResizeState.index] = Math.max(52, processFixtureResizeState.widths[processFixtureResizeState.index] + event.clientX - processFixtureResizeState.startX)
  processFixtureColumnWidths.value = next
}

function stopProcessFixtureColumnResize() {
  if (!processFixtureResizeState) return
  window.removeEventListener('mousemove', resizeProcessFixtureColumn)
  window.removeEventListener('mouseup', stopProcessFixtureColumnResize)
  processFixtureResizeState = null
}

function networkEndpointFixtureSortArrow(key: (typeof networkEndpointFixtureColumns)[number]['key']) {
  if (networkEndpointFixtureSortKey.value !== key) return ''
  return networkEndpointFixtureSortDir.value === 'desc' ? '↓' : '↑'
}

function toggleNetworkEndpointFixtureSort(key: (typeof networkEndpointFixtureColumns)[number]['key']) {
  if (networkEndpointFixtureSortKey.value === key) {
    networkEndpointFixtureSortDir.value = networkEndpointFixtureSortDir.value === 'desc' ? 'asc' : 'desc'
    return
  }
  networkEndpointFixtureSortKey.value = key
  networkEndpointFixtureSortDir.value = 'desc'
}

function startNetworkEndpointFixtureColumnResize(index: number, event: MouseEvent) {
  networkEndpointFixtureResizeState = { index, startX: event.clientX, widths: [...networkEndpointFixtureColumnWidths.value] }
  window.addEventListener('mousemove', resizeNetworkEndpointFixtureColumn)
  window.addEventListener('mouseup', stopNetworkEndpointFixtureColumnResize)
  event.preventDefault()
}

function resizeNetworkEndpointFixtureColumn(event: MouseEvent) {
  if (!networkEndpointFixtureResizeState) return
  const next = [...networkEndpointFixtureResizeState.widths]
  next[networkEndpointFixtureResizeState.index] = Math.max(48, networkEndpointFixtureResizeState.widths[networkEndpointFixtureResizeState.index] + event.clientX - networkEndpointFixtureResizeState.startX)
  networkEndpointFixtureColumnWidths.value = next
}

function stopNetworkEndpointFixtureColumnResize() {
  if (!networkEndpointFixtureResizeState) return
  window.removeEventListener('mousemove', resizeNetworkEndpointFixtureColumn)
  window.removeEventListener('mouseup', stopNetworkEndpointFixtureColumnResize)
  networkEndpointFixtureResizeState = null
}
const tunnelProfiles = [
  { id: 'tunnel-1', name: 'admin-local-forward', type: 'Local', endpoint: '127.0.0.1:9080 -> 127.0.0.1:80', running: true },
  { id: 'tunnel-2', name: 'remote-public-preview', type: 'Remote', endpoint: '0.0.0.0:12380 -> 192.0.2.44:8080', running: true },
  { id: 'tunnel-3', name: 'socks5-lab-route', type: 'SOCKS5', endpoint: '127.0.0.1:1080', running: false },
]
const processRows = Array.from({ length: 18 }, (_, index) => ({
  pid: 4200 + index,
  user: index % 2 === 0 ? 'deploy' : 'svc',
  cpu: (index * 1.7 + 2).toFixed(1),
  mem: (index * 0.9 + 1.4).toFixed(1),
  state: index % 5 === 0 ? 'sleeping' : 'running',
  command: index === 0
    ? 'node /opt/serverpilot-fixture/current/dist/worker-with-very-long-command-and-many-arguments.js --queue layout-regression --mode synthetic'
    : `fixture-process-${index + 1}`,
}))
const processFixtureColumns = [
  { key: 'pid', label: 'PID', numeric: false, sortable: true },
  { key: 'user', label: '用户', numeric: false, sortable: true },
  { key: 'cpu', label: 'CPU', numeric: true, sortable: true },
  { key: 'memory', label: '内存', numeric: true, sortable: true },
  { key: 'state', label: '状态', numeric: false, sortable: false },
  { key: 'command', label: '命令', numeric: false, sortable: true },
] as const
const processFixtureColumnWidths = ref([64, 68, 64, 72, 80, 148])
const processFixtureGridStyle = computed(() => ({
  gridTemplateColumns: processFixtureColumnWidths.value.map((width) => `${width}px`).join(' '),
}))
const processFixtureSortKey = ref<(typeof processFixtureColumns)[number]['key']>('cpu')
const processFixtureSortDir = ref<'asc' | 'desc'>('desc')
let processFixtureResizeState: { index: number; startX: number; widths: number[] } | null = null
const networkEndpointFixtureColumns = [
  { key: 'pid', label: 'PID' },
  { key: 'process', label: '程序' },
  { key: 'source', label: '来源' },
  { key: 'protocol', label: '协议' },
  { key: 'address', label: '监听 IP' },
  { key: 'port', label: '端口' },
  { key: 'ipCount', label: 'IP 数' },
  { key: 'connectionCount', label: '连接数' },
  { key: 'upload', label: '累计上传' },
  { key: 'download', label: '累计下载' },
] as const
const networkEndpointFixtureRows = [
  { pid: 22, process: 'sshd', source: '宿主机', protocol: 'TCP', address: '0.0.0.0', port: 22, ipCount: 4, connectionCount: 9, upload: '42 KB', download: '91 KB' },
  { pid: 8080, process: 'nginx', source: 'Docker: web', protocol: 'TCP', address: '127.0.0.1', port: 8080, ipCount: 2, connectionCount: 6, upload: '18 KB', download: '54 KB' },
]
const networkEndpointFixtureColumnWidths = ref([52, 110, 98, 58, 104, 62, 58, 88, 82, 82])
const networkEndpointFixtureGridStyle = computed(() => ({
  gridTemplateColumns: networkEndpointFixtureColumnWidths.value.map((width) => `${width}px`).join(' '),
}))
const networkEndpointFixtureSortKey = ref<(typeof networkEndpointFixtureColumns)[number]['key']>('port')
const networkEndpointFixtureSortDir = ref<'asc' | 'desc'>('asc')
let networkEndpointFixtureResizeState: { index: number; startX: number; widths: number[] } | null = null
const networkDiagnosticLines = Array.from({ length: 24 }, (_, index) =>
  `hop ${index + 1} 198.51.100.${index + 1} synthetic latency ${12 + index} ms`)
const keyVaultRows = Array.from({ length: 18 }, (_, index) => ({
  id: `fixture-key-${index + 1}`,
  name: index === 0
    ? 'layout-fixture-key-with-a-very-long-name-that-must-ellipsis-inside-the-row'
    : `layout-fixture-key-${index + 1}`,
  algorithm: index % 2 === 0 ? 'ED25519' : 'RSA 4096',
  usage: index % 3,
  fingerprint: `SHA256:fixtureFingerprint${String(index + 1).padStart(2, '0')}abcdefghijklmnopqrstuvwxyz`,
  legacy: index === 2,
}))
const alertRows = Array.from({ length: 12 }, (_, index) => ({
  id: `alert-${index + 1}`,
  severity: index % 4 === 0 ? 'critical' : 'warning',
  title: index === 0
    ? 'Synthetic CPU alert with a long title for bounded action layout'
    : `Synthetic alert ${index + 1}`,
  rule: index % 3 === 0 ? 'CPU' : index % 3 === 1 ? '内存' : '延迟',
  message: `Synthetic alert message ${index + 1} for real-render layout checks.`,
  serverName: index % 2 === 0 ? 'fixture-server-with-long-display-name.example.invalid' : 'fixture-server',
  muted: index % 5 === 0,
  read: index % 4 === 0,
}))
const monitorFixtureSnapshot: MonitorSnapshot = {
  connectionId: 1,
  status: 'online',
  timestamp: '2026-07-03T10:00:00Z',
  latencyMillis: 18,
  latencyAvailable: true,
  cpuPercent: 12.5,
  memoryTotal: 8 * 1024 ** 3,
  memoryAvailable: 5 * 1024 ** 3,
  memoryUsedPercent: 37.5,
  swapTotal: 2 * 1024 ** 3,
  swapFree: 1024 ** 3,
  diskTotal: 80 * 1024 ** 3,
  diskUsed: 31 * 1024 ** 3,
  diskUsedPercent: 38.75,
  mounts: [],
  processes: [],
  processStatus: 'available',
  processMessage: '',
  loadOne: 0.21,
  loadFive: 0.18,
  loadFifteen: 0.16,
  uptimeSeconds: 3600,
  defaultInterface: 'eth0',
  downloadBytesPerSecond: 2048,
  uploadBytesPerSecond: 1024,
  osName: 'Fixture Linux',
  kernel: '6.8.0',
  architecture: 'x86_64',
  errors: [],
  errorCode: '',
  message: '',
  monitorActive: true,
}
const monitorAlertEvents: AlertEvent[] = alertRows.slice(0, 3).map((row, index) => ({
  eventID: row.id,
  serverID: 1,
  serverName: row.serverName,
  ruleType: index === 0 ? 'cpu_high' : index === 1 ? 'memory_high' : 'latency_high',
  severity: row.severity as AlertEvent['severity'],
  state: 'firing',
  title: row.title,
  message: row.message,
  currentValue: 92,
  threshold: 90,
  unit: '%',
  startedAt: `2026-07-03T10:0${index}:00Z`,
  read: row.read,
  muted: row.muted,
  source: 'monitor',
}))
const dashboardConnections: Connection[] = [
  {
    id: 252,
    groupId: null,
    name: '252',
    host: '192.168.0.252',
    port: 22,
    username: 'root',
    authType: 'password',
    privateKeyPath: '',
    privateKeySource: 'local_file',
    keyVaultId: null,
    refreshInterval: 2,
    hostKeyFingerprint: '',
    credentialSaved: false,
    createdAt: '2026-07-03T10:00:00Z',
    updatedAt: '2026-07-03T10:00:00Z',
    connectionMode: 'direct',
    jumpServerId: null,
    terminalProfileId: null,
  },
]
const dashboardSummaries: DashboardServerSummary[] = dashboardConnections.map((connection) => ({
  serverID: connection.id,
  name: connection.name,
  groupName: 'fixture',
  host: connection.host,
  port: connection.port,
  status: 'offline',
  terminalCount: 0,
  sftpConnectedCount: 0,
  transferActiveCount: 0,
  transferQueuedCount: 0,
  transferRunningCount: 0,
  transferFailedCount: 0,
  transferCompletedCount: 0,
  transferPreview: [],
  tunnelRunningCount: 0,
  tunnelStoppedOrFailedCount: 0,
  tunnelPreview: [],
  dockerAvailable: null,
  dockerRunningContainers: null,
  dockerStoppedContainers: null,
  dockerTotalContainers: null,
  dockerStatusLabel: 'unknown',
  active: false,
}))
const appLogRows = Array.from({ length: 24 }, (_, index) => ({
  id: `log-${index + 1}`,
  time: `2026-07-03T10:${String(index).padStart(2, '0')}:00Z`,
  level: index % 6 === 0 ? 'error' : index % 4 === 0 ? 'warn' : 'info',
  server: index % 3 === 0 ? 'fixture-server-with-long-display-name.example.invalid' : '应用',
  summary: index === 0
    ? 'Synthetic application event with a long summary that must not force document horizontal scrolling in the app logs panel'
    : `Synthetic application event ${index + 1}`,
  operation: index % 2 === 0 ? 'fixture.operation.long-name' : 'fixture.refresh',
  code: index % 6 === 0 ? 'E_FIXTURE' : '',
}))
const commandRows = Array.from({ length: 16 }, (_, index) => ({
  id: `command-${index + 1}`,
  title: index === 0
    ? 'Synthetic disabled command with a long title that should stay inside the palette'
    : `Synthetic command ${index + 1}`,
  command: index === 0
    ? 'fixturectl inspect --target example.invalid --format compact --layout-check'
    : `fixturectl status ${index + 1}`,
  source: index % 2 === 0 ? '全局收藏' : '当前服务器',
  disabled: index === 0,
}))
const commandManagementCommonCommands = [
  { id: 'common-ssh', title: 'SSH common fixture', command: 'ssh-common-fixture', shell: 'ssh' },
  { id: 'common-cmd', title: 'CMD common fixture', command: 'cmd-common-fixture', shell: 'cmd' },
  { id: 'common-ps', title: 'PowerShell common fixture', command: 'ps-common-fixture', shell: 'powershell' },
] as const
const commandManagementVisibleHistory = computed(() => filterCommandManagementStrings(commandManagementHistories.value[commandManagementShell.value]))
const commandManagementVisibleFavorites = computed(() => commandManagementFavorites.value
  .filter((item) => item.shell === 'any' || item.shell === commandManagementShell.value)
  .filter((item) => commandManagementMatches([item.title, item.command])))
const commandManagementVisibleCommon = computed(() => commandManagementCommonCommands
  .filter((item) => item.shell === commandManagementShell.value)
  .filter((item) => commandManagementMatches([item.title, item.command])))

const sshCompletionHistory: CommandHistoryEntry[] = [{
  id: 'ssh-completion-history-docker-compose',
  serverId: 7,
  serverName: 'fixture-server',
  sessionId: 'ssh-fixture',
  command: 'docker compose ps',
  preview: 'docker compose ps',
  isMultiline: false,
  commandHash: 'ssh-completion-history-docker-compose',
  source: 'terminal',
  sourceLabel: 'Terminal',
  executedAt: '2026-07-04T10:00:00Z',
  targetServerIds: [],
  targetCount: 0,
  batchSubmissionId: '',
}]
const sshCompletionFavorites: CommandFavorite[] = [{
  id: 'ssh-completion-favorite-docker-logs',
  title: 'Docker logs',
  command: 'docker logs api',
  description: 'Synthetic favorite command',
  scope: 'server',
  serverId: 7,
  groupId: 3,
  tags: [],
  sortOrder: 0,
  useCount: 2,
  createdAt: '',
  updatedAt: '',
  lastUsedAt: '',
}]
const sshCompletionSuggestions = computed<CommandSuggestion[]>(() => {
  if (commandCompletionTriggerLength(sshCompletionInput.value) < sshCompletionTriggerChars.value) return []
  return buildCommandCompletionSuggestions({
    prefix: sshCompletionInput.value,
    history: sshCompletionHistory,
    favorites: sshCompletionFavorites,
    commonCommands: commonLinuxCommandCompletions,
    builtinCommands: builtinLinuxCommandCompletions,
    limit: sshCompletionMaxSuggestions.value,
  })
})
const sshCompletionOpen = computed(() =>
  (shouldRender('ssh-command-completion') || shouldRender('ssh-command-completion-split'))
  && sshCompletionEnabled.value
  && !sshCompletionAccepted.value
  && sshCompletionSuggestions.value.length > 0)
const sshCompletionPosition = computed(() => ({
  left: shouldRender('ssh-command-completion-split') ? 36 : 96,
  top: 112,
  width: shouldRender('ssh-command-completion-split')
    ? 430
    : terminalCompletionOverlayCssWidth(window.devicePixelRatio || 1, terminalCompletionOverlayWidth),
  height: 330,
}))
function selectSshCompletion(index: number) {
  const count = sshCompletionSuggestions.value.length
  sshCompletionSelectedIndex.value = count ? ((index % count) + count) % count : 0
}
function acceptSshCompletion() {
  const suggestion = sshCompletionSuggestions.value[sshCompletionSelectedIndex.value]
  if (!suggestion) return
  sshCompletionInput.value += completionInsertText(sshCompletionInput.value, suggestion.command)
  sshCompletionAccepted.value = true
}
function disableSshCompletion() {
  setSshCommandCompletionEnabled(false)
  sshCompletionEnabled.value = false
  sshCompletionAccepted.value = false
}
function enableSshCompletionFromSettings() {
  setSshCommandCompletionEnabled(true)
  sshCompletionEnabled.value = true
}
function setSshCompletionDescriptionsFromSettings(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  setSshCommandCompletionShowDescriptions(checked)
  sshCompletionShowDescriptions.value = checked
}
function setSshCompletionMaxFromSettings(event: Event) {
  setSshCommandCompletionMaxSuggestions((event.target as HTMLInputElement).valueAsNumber)
  sshCompletionMaxSuggestions.value = getSshCommandCompletionMaxSuggestions()
}
function setSshCompletionTriggerFromSettings(event: Event) {
  setSshCommandCompletionTriggerChars((event.target as HTMLInputElement).valueAsNumber)
  sshCompletionTriggerChars.value = getSshCommandCompletionTriggerChars()
}
function handleSshCompletionInput() {
  sshCompletionAccepted.value = false
  sshCompletionEnabled.value = isSshCommandCompletionEnabled()
  sshCompletionShowDescriptions.value = isSshCommandCompletionDescriptionVisible()
  sshCompletionMaxSuggestions.value = getSshCommandCompletionMaxSuggestions()
  sshCompletionTriggerChars.value = getSshCommandCompletionTriggerChars()
  selectSshCompletion(0)
}
function handleSshCompletionKeydown(event: KeyboardEvent) {
  if (!sshCompletionOpen.value) {
    if (event.key === 'Enter') sshCompletionExecutedCount.value += 1
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectSshCompletion(sshCompletionSelectedIndex.value + 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectSshCompletion(sshCompletionSelectedIndex.value - 1)
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    acceptSshCompletion()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    sshCompletionInput.value = ''
    sshCompletionAccepted.value = false
    return
  }
  if (event.key === 'Enter') {
    sshCompletionExecutedCount.value += 1
  }
}

const sftpLatestTransferSummary = computed(() => {
  const transfer = sftpData.value.transfers?.[0]
  if (!transfer) return ''
  return `${transfer.direction} ${transfer.name} ${transfer.percent}%`
})

watch(fixtureName, () => {
  sftpContextMenuClosed.value = false
  sshCompletionInput.value = ''
  sshCompletionSelectedIndex.value = 0
  sshCompletionExecutedCount.value = 0
  sshCompletionFocusedPane.value = 'left'
  sshCompletionAccepted.value = false
  sshCompletionEnabled.value = isSshCommandCompletionEnabled()
  sshCompletionShowDescriptions.value = isSshCommandCompletionDescriptionVisible()
  sshCompletionMaxSuggestions.value = getSshCommandCompletionMaxSuggestions()
  sshCompletionTriggerChars.value = getSshCommandCompletionTriggerChars()
  localCompletionDisabledInput.value = ''
})

const serviceCapability = computed<ServiceManagerCapability>(() => {
  const initSystem = serviceData.value.initSystem ?? 'systemd'
  const isOpenWrt = initSystem === 'openwrt-procd'
  return {
    serverID: 1,
    available: true,
    initSystem,
    displayName: isOpenWrt ? 'OpenWrt procd' : 'systemd',
    distributionName: isOpenWrt ? 'OpenWrt' : undefined,
    distributionVersion: isOpenWrt ? '23.05' : undefined,
    supportsJournal: serviceData.value.journalRefreshSupported ?? true,
    supportsLiveLogs: serviceData.value.journalFollowSupported ?? !isOpenWrt,
    supportsResourceMetrics: !isOpenWrt,
    supportsStart: true,
    supportsStop: true,
    supportsRestart: true,
    supportsEnable: true,
    supportsDisable: true,
    canManage: true,
    requiresPrivilege: false,
    error: serviceData.value.journalRefreshSupported === false ? serviceData.value.journalFollowDisabledReason : undefined,
  }
})

const serviceSummaries = computed<SystemServiceSummary[]>(() =>
  serviceData.value.services.map((service) => ({
    serverID: 1,
    initSystem: serviceCapability.value.initSystem,
    serviceID: service.id,
    unitName: service.name,
    displayName: service.name,
    description: service.description,
    loadState: 'loaded',
    activeState: service.status === 'running' ? 'active' : service.status === 'failed' ? 'failed' : 'inactive',
    subState: service.status === 'running' ? 'running' : service.status === 'failed' ? 'failed' : 'dead',
    unitFileState: service.status === 'stopped' ? 'disabled' : 'enabled',
    activeStateLabel: service.status === 'running' ? '运行中' : service.status === 'failed' ? '失败' : '已停止',
    unitFileStateLabel: service.status === 'stopped' ? '禁用' : '启用',
    isActive: service.status === 'running',
    isFailed: service.status === 'failed',
    isEnabled: service.status !== 'stopped',
    canStart: true,
    canStop: true,
    canRestart: true,
    canEnable: true,
    canDisable: true,
    critical: false,
    protected: false,
  })))

const selectedService = computed<SystemServiceSummary>(() => {
  const service = serviceSummaries.value.find((item) => item.serviceID === serviceData.value.selectedServiceId) ?? serviceSummaries.value[0]
  if (!service) throw new Error('Missing service manager fixture service')
  return service
})

const serviceDetail = computed<SystemServiceDetail>(() => ({
  ...selectedService.value,
  mainPID: 4242,
  memoryCurrentBytes: 16_777_216,
  cpuUsageNSec: 3_500_000_000,
  tasksCurrent: 12,
  restartCount: 1,
  fragmentPath: serviceCapability.value.initSystem === 'systemd' ? '/etc/systemd/system/fixture-daemon.service' : undefined,
  scriptPath: serviceCapability.value.initSystem === 'openwrt-procd' ? `/etc/init.d/${selectedService.value.serviceID}` : undefined,
  distributionName: serviceCapability.value.distributionName,
  distributionVersion: serviceCapability.value.distributionVersion,
  result: 'success',
  startedAt: '2026-07-03 10:00:00',
  exitedAt: '',
  partial: false,
  warnings: [],
}))

const serviceLines = computed<ServiceJournalLine[]>(() =>
  serviceData.value.lines.map((line, index) => ({
    sequence: index + 1,
    timestampText: `10:${String(index).padStart(2, '0')}:00`,
    priority: line.level === 'error' ? 3 : line.level === 'warning' ? 4 : 6,
    priorityLabel: line.level,
    identifier: selectedService.value.serviceID,
    pid: '4242',
    message: line.message,
    truncated: false,
  })))

function toConnection(server: ServerPickerFixtureData['servers'][number]): Connection {
  return {
    id: server.id,
    groupId: server.groupId,
    name: server.name,
    host: server.host,
    port: server.port,
    username: 'fixture',
    authType: 'password',
    privateKeySource: 'local_file',
    privateKeyPath: '',
    keyVaultId: null,
    hostKeyFingerprint: '',
    credentialSaved: false,
    refreshInterval: 5,
    createdAt: '2026-07-03T00:00:00Z',
    updatedAt: '2026-07-03T00:00:00Z',
  }
}

function optionLabel(id: string) {
  return {
    servers: '服务器',
    groups: '分组',
    settings: '设置',
    'command-history': '命令历史',
    'key-vault-metadata': '密钥库数据',
  }[id] ?? id
}

function sftpHighlightSegments(entry: SftpDisplayEntry, columnId: string): SftpHighlightSegment[] {
  const value = columnId === 'name'
    ? entry.name
    : columnId === 'type'
      ? entry.isDir ? 'directory' : entry.isSymlink ? 'symlink' : 'file'
      : columnId === 'size'
        ? entry.isDir ? '-' : formatBytes(entry.size)
        : columnId === 'modTime'
          ? entry.modTime
          : columnId === 'permissions'
            ? entry.permissions
            : columnId === 'owner'
              ? entry.owner
              : entry.group
  return [{ text: value, matched: false }]
}

function compareFixtureNames(left: SftpDisplayEntry, right: SftpDisplayEntry, asc: boolean) {
  const result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return asc ? result : -result
}

function fixtureTypeRank(entry: SftpDisplayEntry) {
  if (entry.isSymlink) return 2
  if (entry.isDir) return 0
  return 1
}

function compareFixtureEntries(left: SftpDisplayEntry, right: SftpDisplayEntry, key: FileSortableColumnId, asc: boolean) {
  if (key !== 'type' && key !== 'permissions' && left.isDir !== right.isDir) return left.isDir ? -1 : 1
  let result = 0
  if (key === 'type') result = fixtureTypeRank(left) - fixtureTypeRank(right)
  else if (key === 'size') result = left.size - right.size
  else if (key === 'modTime') result = left.modTime.localeCompare(right.modTime)
  else result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return asc ? (result || compareFixtureNames(left, right, true)) : -(result || compareFixtureNames(left, right, true))
}

function submitLocalFixtureCommand() {
  const command = cleanLocalFixtureCommand(localTerminalFixtureInput.value).trim()
  if (!command) return
  const scope = localShellScope.value
  const next = [command, ...localCommandHistory.value[scope].filter((item) => item !== command)].slice(0, 12)
  localCommandHistory.value = {
    ...localCommandHistory.value,
    [scope]: next,
  }
  persistLocalFixtureCommandHistory(scope, next)
  localTerminalFixtureInput.value = ''
}

function readLocalFixtureCommandHistory(scope: 'cmd' | 'powershell') {
  let parsed: unknown
  try {
    parsed = JSON.parse(localStorage.getItem(localCommandHistoryStorageKeys[scope]) || '[]')
  } catch {
    parsed = []
  }
  if (!Array.isArray(parsed)) return []
  const commands: string[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    const rawCommand = typeof item === 'string'
      ? item
      : typeof item?.command === 'string'
        ? item.command
        : ''
    const command = cleanLocalFixtureCommand(rawCommand).trim()
    if (!command) continue
    const key = command.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    commands.push(command)
  }
  return commands.slice(0, 12)
}

function persistLocalFixtureCommandHistory(scope: 'cmd' | 'powershell', commands: string[]) {
  localStorage.setItem(localCommandHistoryStorageKeys[scope], JSON.stringify(commands.slice(0, 12)))
}

function cleanLocalFixtureCommand(value: string) {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b/g, '')
}

function insertLocalFixtureHistory(command: string) {
  localTerminalFixtureInput.value = command
}

function commandManagementMatches(values: string[]) {
  const query = commandManagementQuery.value.trim().toLowerCase()
  if (!query) return true
  return values.some((value) => value.toLowerCase().includes(query))
}

function filterCommandManagementStrings(values: string[]) {
  return values.filter((value) => commandManagementMatches([value]))
}

function commandManagementHighlight(value: string) {
  const query = commandManagementQuery.value.trim()
  if (!query) return [{ text: value, match: false }]
  const index = value.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return [{ text: value, match: false }]
  return [
    { text: value.slice(0, index), match: false },
    { text: value.slice(index, index + query.length), match: true },
    { text: value.slice(index + query.length), match: false },
  ].filter((part) => part.text)
}

function deleteCommandManagementHistory(command: string) {
  if (!window.confirm('delete history?')) return
  const shell = commandManagementShell.value
  commandManagementHistories.value = {
    ...commandManagementHistories.value,
    [shell]: commandManagementHistories.value[shell].filter((item) => item !== command),
  }
}

function clearCommandManagementHistory() {
  if (!window.confirm('clear history?')) return
  commandManagementHistories.value = {
    ...commandManagementHistories.value,
    [commandManagementShell.value]: [],
  }
}

function addCommandManagementFavorite(command: string) {
  const exists = commandManagementFavorites.value.some((item) =>
    item.command === command && item.shell === commandManagementShell.value)
  if (exists) return
  commandManagementFavorites.value = [{
    id: `fav-${commandManagementShell.value}-${Date.now()}`,
    title: `${commandManagementShell.value.toUpperCase()} favorite`,
    command,
    shell: commandManagementShell.value,
  }, ...commandManagementFavorites.value]
}

function removeCommandManagementFavorite(id: string) {
  if (!window.confirm('remove favorite?')) return
  commandManagementFavorites.value = commandManagementFavorites.value.filter((item) => item.id !== id)
}

function startCommandManagementFavoriteEdit(favorite: CommandManagementFavorite) {
  commandManagementEditingFavoriteId.value = favorite.id
  commandManagementEditTitle.value = favorite.title
  commandManagementEditCommand.value = favorite.command
}

function saveCommandManagementFavoriteEdit() {
  const id = commandManagementEditingFavoriteId.value
  if (!id) return
  commandManagementFavorites.value = commandManagementFavorites.value.map((item) => item.id === id
    ? { ...item, title: commandManagementEditTitle.value.trim(), command: commandManagementEditCommand.value.trim() }
    : item)
  commandManagementEditingFavoriteId.value = ''
}

function sortLocalExplorerColumn(column: FileColumn) {
  if (!column.sortable) return
  if (localExplorerSortKey.value === column.sortable) localExplorerSortAsc.value = !localExplorerSortAsc.value
  else {
    localExplorerSortKey.value = column.sortable
    localExplorerSortAsc.value = true
  }
}

function goLocalExplorerFixtureHome() {
  localExplorerFixturePath.value = localExplorerFixtureHome.value
}

function openLocalExplorerFixtureEntry(entry: SftpDisplayEntry) {
  if (entry.syntheticParent) {
    localExplorerFixturePath.value = entry.path
    return
  }
  if (entry.isDir) {
    localExplorerFixturePath.value = entry.path
    return
  }
  localExplorerOpenCount.value += 1
}

function localExplorerFixtureMenuItems(target: SftpDisplayEntry | null): ContextMenuItem[] {
  if (!target) {
    return [
      { id: 'refresh', label: '刷新' },
      { id: 'parent', label: '上一级' },
      { id: 'home', label: 'Home' },
      { id: 'copy-current-path', label: '复制当前路径' },
    ]
  }
  return [
    { id: 'open', label: '打开' },
    { id: 'reveal', label: '在资源管理器中显示' },
    { id: 'copy-path', label: '复制路径' },
    { id: 'copy-name', label: '复制名称' },
    { id: 'properties', label: '属性' },
    { id: 'refresh', label: '刷新' },
  ]
}

function openLocalExplorerFixtureContextMenu(entry: SftpDisplayEntry | null, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  localExplorerContextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    items: localExplorerFixtureMenuItems(entry),
    target: entry,
  }
}

function selectLocalExplorerFixtureMenu(id: string) {
  const target = localExplorerContextMenu.value?.target ?? null
  if (id === 'open' && target) {
    openLocalExplorerFixtureEntry(target)
  } else if (id === 'reveal' && target) {
    localExplorerRevealCount.value += 1
  } else if (id === 'parent') {
    localExplorerFixturePath.value = 'C:\\Temp'
  } else if (id === 'home') {
    goLocalExplorerFixtureHome()
  }
  localExplorerContextMenu.value = null
}

function startFixtureBottomPanelResize(event: PointerEvent) {
  event.preventDefault()
  fixtureBottomPanelResizeRoot = (event.currentTarget as HTMLElement | null)?.closest('.right-workspace') as HTMLElement | null
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', moveFixtureBottomPanelResize)
  window.addEventListener('pointerup', stopFixtureBottomPanelResize, { once: true })
}

function moveFixtureBottomPanelResize(event: PointerEvent) {
  if (!fixtureBottomPanelResizeRoot) return
  const rect = fixtureBottomPanelResizeRoot.getBoundingClientRect()
  const bottomPanelHeight = rect.bottom - event.clientY - 28
  fixtureBottomPanelExpanded.value = bottomPanelHeight > 96
}

function stopFixtureBottomPanelResize() {
  fixtureBottomPanelResizeRoot = null
  window.removeEventListener('pointermove', moveFixtureBottomPanelResize)
  window.removeEventListener('pointerup', stopFixtureBottomPanelResize)
}

function startLocalExplorerColumnResize(columnId: FileColumnId, event: PointerEvent) {
  event.preventDefault()
  localExplorerResizingColumn = {
    id: columnId,
    startX: event.clientX,
    startWidth: localExplorerColumnWidths.value[columnId],
  }
  localExplorerResizingColumnId.value = columnId
  window.addEventListener('pointermove', moveLocalExplorerColumnResize)
  window.addEventListener('pointerup', stopLocalExplorerColumnResize)
}

function moveLocalExplorerColumnResize(event: PointerEvent) {
  if (!localExplorerResizingColumn) return
  event.preventDefault()
  localExplorerColumnWidths.value = {
    ...localExplorerColumnWidths.value,
    [localExplorerResizingColumn.id]: clampFileColumnWidth(
      localExplorerResizingColumn.id,
      localExplorerResizingColumn.startWidth + event.clientX - localExplorerResizingColumn.startX,
    ),
  }
}

function stopLocalExplorerColumnResize() {
  localExplorerResizingColumn = null
  localExplorerResizingColumnId.value = null
  window.removeEventListener('pointermove', moveLocalExplorerColumnResize)
  window.removeEventListener('pointerup', stopLocalExplorerColumnResize)
}

onBeforeUnmount(() => stopLocalExplorerColumnResize())

function isSftpFixture(name: FixtureName | string) {
  return String(name).startsWith('sftp-')
}

function isDockerManagerFixture(name: FixtureName | string) {
  return dockerManagerFixtureNames.has(name as FixtureName)
}

function isTunnelManagerFixture(name: FixtureName | string) {
  return tunnelManagerFixtureNames.has(name as FixtureName)
}

function isProcessManagerFixture(name: FixtureName | string) {
  return processManagerFixtureNames.has(name as FixtureName)
}

function isServiceManagerFixture(name: FixtureName | string) {
  return serviceManagerFixtureStates.has(String(name))
}

function shouldRender(name: FixtureName | string) {
  return fixtureName.value === name
}

if (shouldRender('compact-network-card-stats') || shouldRender('compact-network-card-stats-ens192')) {
  localStorage.setItem('serverpilot.monitorDetailsExpanded', 'true')
}

const appBlurOverlayFixture = computed(() =>
  shouldRender('settings-macos-dark-overlays') ||
  fixtureName.value.startsWith('connection-dialog') ||
  isDockerManagerFixture(fixtureName.value) ||
  isTunnelManagerFixture(fixtureName.value) ||
  isProcessManagerFixture(fixtureName.value) ||
  isServiceManagerFixture(fixtureName.value) ||
  shouldRender('network-diagnostics-summary') ||
  shouldRender('dashboard-alert-center-layer') ||
  shouldRender('alert-center-list'))
</script>

<template>
  <main class="ui-fixture-root" :data-ui-fixture="fixtureName">
    <div class="ui-fixture-stage">
      <button ref="anchor" class="ui-fixture-anchor" type="button" aria-hidden="true">+</button>

      <div
        v-if="appBlurOverlayFixture"
        class="app-visual-root ui-fixture-app-visual-root"
        data-testid="app-visual-root"
      >
        <header>
          <strong>ServerPilot fixture workspace</strong>
          <span>macOS modal blur background</span>
        </header>
        <section>
          <article>
            <strong>Production gateway</strong>
            <span>online</span>
          </article>
          <article>
            <strong>Terminal workspace</strong>
            <span>tail -f app.log</span>
          </article>
          <article>
            <strong>Monitor</strong>
            <span>CPU 18% / RAM 52%</span>
          </article>
        </section>
      </div>

      <ServerPicker
        v-if="fixtureName.startsWith('server-picker') && anchor"
        :open="true"
        :anchor="anchor"
        :groups="serverPickerGroups"
        :statuses="serverPickerStatuses"
        :active-server-id="null"
        :local-terminal-enabled="true"
        :local-terminal-capabilities="shouldRender('server-picker-macos-local') ? macosLocalTerminalCapabilities : null"
        :query="currentServerPickerData.query"
        @update:query="pickerQuery = $event"
      />

      <section
        v-if="shouldRender('split-pane-two-empty')"
        class="ui-fixture-split two"
        data-testid="split-pane-two-empty"
      >
        <article
          v-for="pane in splitPaneData.panes"
          :key="pane.id"
          class="ui-fixture-pane"
          :class="{ active: pane.id === splitPaneData.activePaneId }"
          :data-pane-id="pane.id"
        >
          <div class="terminal-pane-body terminal-pane-empty-body">
            <div class="terminal-pane-empty">
              <span class="terminal-pane-empty-message">将标签拖到这里</span>
              <div class="terminal-pane-empty-actions terminal-empty-actions terminal-empty-actions--vertical centered concept-c-action-stack">
                <button type="button"><AppIcon name="server-plus" :size="30" /><span>新建服务器</span></button>
                <span class="action-separator action-separator--horizontal-stack" aria-hidden="true"></span>
                <button type="button"><AppIcon name="link" :size="30" /><span>连接已保存</span></button>
                <span class="action-separator action-separator--horizontal-stack" aria-hidden="true"></span>
                <button type="button"><AppIcon name="terminal-check" :size="30" /><span>选择已连接</span></button>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section
        v-if="shouldRender('split-pane-quad-empty-narrow')"
        class="ui-fixture-split quad"
        data-testid="split-pane-quad-empty-narrow"
      >
        <article
          v-for="pane in splitPaneData.panes"
          :key="pane.id"
          class="ui-fixture-pane"
          :class="{ active: pane.id === splitPaneData.activePaneId }"
          :data-pane-id="pane.id"
        >
          <div class="terminal-pane-body terminal-pane-empty-body">
            <div class="terminal-pane-empty">
              <span class="terminal-pane-empty-message">将标签拖到这里</span>
              <div class="terminal-pane-empty-actions terminal-empty-actions terminal-empty-actions--horizontal centered concept-c-action-stack">
                <button type="button"><AppIcon name="server-plus" :size="30" /><span>新建服务器</span></button>
                <span class="action-separator action-separator--vertical-stack" aria-hidden="true"></span>
                <button type="button"><AppIcon name="link" :size="30" /><span>连接已保存</span></button>
                <span class="action-separator action-separator--vertical-stack" aria-hidden="true"></span>
                <button type="button"><AppIcon name="terminal-check" :size="30" /><span>选择已连接</span></button>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section
        v-if="shouldRender('compact-network-card-stats') || shouldRender('compact-network-card-stats-ens192')"
        class="ui-fixture-compact-monitor"
        data-testid="compact-network-card-stats"
      >
        <CompactMonitorSidebar
          :connection="compactNetworkConnection"
          :snapshot="compactNetworkFixtureSnapshot"
          :history="compactNetworkFixtureHistory"
          :state="null"
          workspace-status="connected"
          :network-interfaces="compactNetworkFixtureInterfaces"
        />
      </section>

      <section
        v-if="shouldRender('local-terminal-cmd-workspace') || shouldRender('local-terminal-powershell-workspace') || shouldRender('local-terminal-macos-workspace') || shouldRender('local-terminal-gpu-unavailable')"
        class="ui-fixture-local-workspace workspace-shell"
        :class="{ 'is-powershell': shouldRender('local-terminal-powershell-workspace'), 'is-macos': isMacosLocalFixture }"
        data-testid="local-terminal-workspace"
      >
        <aside class="local-monitor-sidebar">
          <section class="compact-monitor local-monitor-card">
            <header class="compact-server-header">
              <div>
                <strong>fixture-local-host</strong>
                <small>{{ localTerminalFixtureLabel }} · {{ localPlatformFixtureLabel }}</small>
              </div>
              <span class="compact-state"><i class="status-dot online"></i>Local</span>
            </header>
            <section class="system-info local-system-info">
              <button
                type="button"
                class="system-info-summary"
                :aria-expanded="localSystemExpanded"
                @click="localSystemExpanded = !localSystemExpanded"
              >
                <span class="system-info-summary-text"><strong>系统信息</strong><span>{{ localSystemFixtureSummary }}</span></span>
                <span class="system-info-summary-chevron" aria-hidden="true">
                  <svg
                    class="splitter-chevron"
                    :class="localSystemExpanded ? 'chevron-up' : 'chevron-down'"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    focusable="false"
                  ><path d="M3 4.25 6 7.25 9 4.25" /></svg>
                </span>
              </button>
              <div v-if="localSystemExpanded" class="local-system-detail">
                <span>Build 22631</span>
                <span>amd64</span>
                <span>16 logical CPUs</span>
                <span>16.00 GB RAM</span>
                <span>Uptime 1小时 2分钟</span>
              </div>
            </section>
            <section class="compact-resource">
              <div class="resource-line"><strong>CPU</strong><span>12.0%</span></div>
              <div class="metric-progress"><i style="width: 12%;"></i></div>
            </section>
            <section class="compact-resource">
              <div class="resource-line"><strong>内存</strong><span>38.0%</span><small>6.00 GB / 16.00 GB</small></div>
              <div class="metric-progress memory"><i style="width: 38%;"></i></div>
            </section>
            <section v-if="!isMacosLocalFixture" class="compact-resource gpu-resource" data-testid="local-gpu-card">
              <div class="resource-line">
                <strong>GPU</strong>
                <span>{{ shouldRender('local-terminal-gpu-unavailable') ? '使用率不可用' : '34.0%' }}</span>
                <small>{{ shouldRender('local-terminal-gpu-unavailable') ? 'Fixture GPU · 8.00 GB' : 'Fixture GPU · 2.00 GB / 8.00 GB' }}</small>
              </div>
              <div class="metric-progress gpu"><i :style="{ width: shouldRender('local-terminal-gpu-unavailable') ? '0%' : '34%' }"></i></div>
            </section>
            <section class="network-compact local-network-compact">
              <header>
                <div class="network-title-cluster">
                  <strong>网络</strong>
                  <div class="network-controls network-controls-compact" data-testid="local-network-current">
                    <select v-model="localNetworkInterface" class="monitor-network-interface-select" data-testid="local-network-interface-select" aria-label="选择本地网络接口">
                      <option value="Wi-Fi">Wi-Fi</option>
                      <option value="Ethernet">Ethernet</option>
                    </select>
                    <span class="network-inline-separator" aria-hidden="true">|</span>
                    <button type="button" class="network-icon-button" aria-label="刷新本地监控">↻</button>
                  </div>
                </div>
                <div class="network-rate-cluster">
                  <span class="network-current-rate upload">↑ 48.0 KB/s</span>
                  <span class="network-inline-separator" aria-hidden="true">|</span>
                  <span class="network-current-rate download">↓ 128 KB/s</span>
                </div>
              </header>
              <span class="network-chart-body" aria-label="local network fixture">
                <span class="network-stat-column" data-testid="local-network-stats">
                  <span class="network-stat-value">128 KB/s</span>
                  <span class="network-stat-value">64.0 KB/s</span>
                  <span class="network-stat-value">8.00 KB/s</span>
                </span>
                <span class="network-chart-plot">
                  <span class="mini-sparkline"></span>
                </span>
              </span>
            </section>
            <section class="local-monitor-extra-card mount-panel local-disk-card" data-testid="local-disk-card">
              <header><strong>磁盘与挂载点</strong></header>
              <div class="mount-list local-disk-list">
                <article>
                  <strong title="C:\\">C:</strong>
                  <div class="mount-progress"><i style="width: 44.5%;"></i><span>44.5% · 165.99 GB / 299.06 GB</span></div>
                </article>
                <article>
                  <strong title="D:\\">D:</strong>
                  <div class="mount-progress"><i style="width: 51%;"></i><span>51.0% · 196.00 GB / 400.00 GB</span></div>
                </article>
              </div>
            </section>
            <section class="process-panel local-process-card" data-testid="local-process-card">
              <header>
                <strong>Top Processes</strong>
                <div class="process-sort-options">
                  <button type="button">CPU</button>
                  <span class="process-option-separator" aria-hidden="true">|</span>
                  <button type="button" class="active">内存</button>
                </div>
              </header>
              <div class="local-process-list process-table">
                <div class="local-process-row"><span>fixture.exe · PID 100</span><strong>64.0 MB</strong><small>—</small></div>
                <div class="local-process-row"><span>worker.exe · PID 200</span><strong>42.0 MB</strong><small>1.2%</small></div>
              </div>
            </section>
          </section>
        </aside>
        <div class="workspace-topbar">
          <div class="workspace-tabs" role="tablist" aria-label="local workspace fixture tabs">
            <button
              type="button"
              class="terminal-tab"
              :class="{ active: localWorkspaceMode === 'local' }"
              role="tab"
              :aria-selected="localWorkspaceMode === 'local'"
              @click="localWorkspaceMode = 'local'"
            >
              <span class="terminal-tab-title">{{ localTerminalFixtureLabel }}</span>
            </button>
            <button
              type="button"
              class="terminal-tab"
              :class="{ active: localWorkspaceMode === 'ssh' }"
              role="tab"
              :aria-selected="localWorkspaceMode === 'ssh'"
              @click="localWorkspaceMode = 'ssh'"
            >
              <span class="terminal-tab-title">SSH</span>
            </button>
          </div>
        </div>
        <section class="right-workspace">
          <div class="terminal-stage">
            <div v-if="localWorkspaceMode === 'local'" class="local-terminal-view-stub">
              <strong>{{ localTerminalFixtureLabel }}</strong>
              <input
                v-model="localTerminalFixtureInput"
                data-testid="local-terminal-command-input"
                aria-label="local terminal command"
                @keydown.enter.prevent="submitLocalFixtureCommand"
              />
            </div>
            <div v-else class="terminal-view-stub">
              SSH
            </div>
            <button
              v-if="localWorkspaceMode === 'local'"
              type="button"
              class="terminal-command-button"
              @click="localCommandPaletteOpen = true"
            >鍛戒护</button>
            <section v-if="localCommandPaletteOpen" class="command-palette-shell" data-testid="local-command-palette">
              <strong>鍛戒护闈㈡澘</strong>
              <span>{{ localTerminalFixtureLabel }}</span>
              <div class="command-list" data-testid="local-command-history-list">
                <button
                  v-for="command in visibleLocalCommandHistory"
                  :key="command"
                  type="button"
                  class="command-row command-history-row"
                  @click="insertLocalFixtureHistory(command)"
                >
                  <code>{{ command }}</code>
                </button>
                <p v-if="!visibleLocalCommandHistory.length" class="empty-state">暂无命令历史。</p>
              </div>
            </section>
          </div>
          <div
            class="horizontal-splitter"
            aria-label="Drag to resize or hide bottom panel"
            @pointerdown="startFixtureBottomPanelResize"
            @dblclick="fixtureBottomPanelExpanded = !fixtureBottomPanelExpanded"
          ></div>
          <section
            v-show="localWorkspaceMode === 'local'"
            class="local-explorer-panel"
            :class="{ expanded: fixtureBottomPanelExpanded }"
          >
            <header class="local-explorer-toolbar">
              <form class="local-explorer-path"><input v-model="localExplorerFixturePath" readonly /></form>
              <input class="local-explorer-filter" value="" readonly placeholder="过滤当前目录" />
              <div class="local-explorer-nav-actions">
                <button class="sftp-toolbar-menu-action text-button" type="button">后退</button>
                <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
                <button class="sftp-toolbar-menu-action text-button" type="button">前进</button>
                <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
                <button class="sftp-toolbar-menu-action text-button" type="button">向上</button>
                <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
                <button class="sftp-toolbar-menu-action text-button" type="button" data-testid="local-explorer-fixture-home" @click="goLocalExplorerFixtureHome">Home</button>
                <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
                <button class="sftp-toolbar-menu-action text-button" type="button">刷新</button>
              </div>
            </header>
            <div class="local-explorer-body">
              <aside class="local-explorer-drives"><button class="active" type="button">C:</button><button type="button">D:</button></aside>
              <div class="local-explorer-table-wrap">
                <SftpFileTable
                  table-test-id="local-explorer-table"
                  :columns="localExplorerColumns"
                  :entries="localExplorerEntries"
                  :selected-paths="[]"
                  :table-grid-style="localExplorerTableGridStyle"
                  :filter-active="false"
                  :filtered-entry-count="localExplorerEntries.length"
                  :current-sort-key="localExplorerSortKey"
                  :current-sort-asc="localExplorerSortAsc"
                  :resizing-column-id="localExplorerResizingColumnId"
                  :dragging-column-id="null"
                  :column-drop-target-index="null"
                  :highlight-segments="sftpHighlightSegments"
                  @row-dblclick="openLocalExplorerFixtureEntry"
                  @row-contextmenu="openLocalExplorerFixtureContextMenu"
                  @blank-contextmenu="(event) => openLocalExplorerFixtureContextMenu(null, event)"
                  @header-sort="sortLocalExplorerColumn"
                  @column-resize-start="startLocalExplorerColumnResize"
                />
                <span data-testid="local-explorer-open-count" hidden>{{ localExplorerOpenCount }}</span>
                <span data-testid="local-explorer-reveal-count" hidden>{{ localExplorerRevealCount }}</span>
                <ContextMenu
                  v-if="localExplorerContextMenu"
                  :x="localExplorerContextMenu.x"
                  :y="localExplorerContextMenu.y"
                  :items="localExplorerContextMenu.items"
                  interaction-scope="local-explorer-fixture"
                  @select="selectLocalExplorerFixtureMenu"
                  @close="localExplorerContextMenu = null"
                />
              </div>
            </div>
          </section>
          <section
            v-if="localWorkspaceMode === 'ssh'"
            v-show="fixtureBottomPanelExpanded"
            class="sftp-panel expanded"
          >
            <div class="sftp-toolbar">
              <strong>SSH SFTP fixture</strong>
            </div>
            <div class="sftp-content">
              <div class="sftp-fixture-main">remote files</div>
            </div>
          </section>
        </section>
      </section>

      <section v-if="shouldRender('settings-nav-final')" class="ui-fixture-settings-nav" data-testid="settings-nav-final">
        <nav class="settings-category-nav" aria-label="Settings categories">
          <template
            v-for="category in [
              { label: '常规', icon: 'gear' },
              { label: '终端', icon: 'terminal' },
              { label: '快捷键', icon: 'keyboard' },
              { label: '告警', icon: 'bell' },
              { label: '备份 / 恢复', icon: 'backup' },
              { label: '密钥库', icon: 'key' },
            ]"
            :key="category.label"
          >
            <button type="button" :class="{ active: category.label === '常规' }">
              <AppIcon :name="category.icon" :size="20" />
              <span class="settings-category-nav-label">{{ category.label }}</span>
            </button>
          </template>
        </nav>
      </section>

      <section
        v-if="shouldRender('settings-content-scroll')"
        class="settings-page settings-page-overlay"
        data-testid="settings-content-scroll"
      >
        <header class="settings-page-header">
          <div>
            <h1>Settings</h1>
            <p class="settings-app-version">ServerPilot v0.5.0-beta.28</p>
          </div>
          <div class="settings-header-actions" data-testid="settings-scroll-action-bar">
            <button class="secondary settings-save-button" type="button">Save</button>
            <button class="dialog-close-button settings-close-button" type="button">Close</button>
          </div>
        </header>
        <div class="settings-category-shell" data-testid="settings-scroll-shell">
          <nav class="settings-category-nav" data-testid="settings-scroll-nav" aria-label="Settings categories">
            <button
              v-for="category in settingsScrollCategories"
              :key="category.id"
              type="button"
              class="settings-category-nav-button"
              :class="{ active: settingsScrollActive === category.id }"
              @click="settingsScrollActive = category.id"
            >
              <AppIcon :name="category.icon" :size="20" />
              <span class="settings-category-nav-label">{{ category.label }}</span>
            </button>
          </nav>
          <div class="settings-category-content" data-testid="settings-scroll-content">
            <article class="settings-card" data-testid="settings-scroll-panel">
              <h2>{{ settingsScrollCategories.find((category) => category.id === settingsScrollActive)?.label }}</h2>
              <div v-if="settingsScrollActive === 'appearance'" class="settings-security-fixture" data-testid="settings-general-security-fixture">
                <span data-testid="settings-command-history-fixture">Command history max entries</span>
                <span data-testid="settings-host-key-policy-fixture">SSH host key policy</span>
              </div>
              <div v-if="settingsScrollActive === 'terminal'" class="settings-security-fixture" data-testid="settings-terminal-security-fixture">
                <span data-testid="settings-ssh-timeout-fixture">SSH connection timeout</span>
                <span data-testid="settings-ssh-keepalive-fixture">SSH keepalive</span>
                <span data-testid="settings-terminal-profile-fixture">Terminal Profile</span>
                <span data-testid="settings-ssh-completion-fixture">SSH command completion</span>
              </div>
              <div v-if="settingsScrollActive === 'backup'" class="settings-security-fixture" data-testid="settings-backup-security-fixture">
                <button type="button" class="secondary" data-testid="settings-backup-create-fixture">Create backup</button>
                <button type="button" class="secondary" data-testid="settings-backup-restore-fixture">Restore backup</button>
                <p class="form-error" data-testid="settings-invalid-backup-error-fixture">Invalid backup file</p>
              </div>
              <div v-if="settingsScrollActive === 'keyvault'" class="settings-security-fixture" data-testid="settings-keyvault-security-fixture">
                <span data-testid="settings-keyvault-list-fixture">Key vault entries</span>
                <button type="button" class="secondary" data-testid="settings-keyvault-edit-fixture">Edit key</button>
                <input type="password" value="" placeholder="Saved secret is masked" data-testid="settings-keyvault-masked-secret-fixture" readonly />
              </div>
              <label
                v-for="index in 28"
                :key="`${settingsScrollActive}-${index}`"
                class="setting-toggle"
              >
                <span>
                  <strong>{{ settingsScrollActive }} option {{ index }}</strong>
                  <small>Fixture content row for scroll contract.</small>
                </span>
                <input type="checkbox" :checked="index % 2 === 0" readonly />
              </label>
              <article
                v-if="settingsScrollActive === 'appearance'"
                class="settings-card settings-app-log-entry-card"
                data-testid="settings-app-log-entry"
              >
                <div>
                  <h2>应用日志</h2>
                  <p class="settings-note">查看应用运行日志、筛选级别并复制错误详情。</p>
                </div>
                <button type="button" class="secondary" data-testid="settings-open-app-logs">
                  打开应用日志
                </button>
              </article>
              <button type="button" class="secondary" data-testid="settings-scroll-bottom">
                Bottom of {{ settingsScrollActive }}
              </button>
            </article>
          </div>
        </div>
      </section>

      <section
        v-if="shouldRender('settings-terminal-profile-spacing')"
        class="ui-fixture-settings-profile-spacing settings-card"
        data-testid="settings-terminal-profile-spacing"
      >
        <label class="setting-toggle" data-testid="ssh-command-completion-setting">
          <span>
            <strong>Enable SSH command completion</strong>
            <small>Only applies to SSH/Linux terminals.</small>
          </span>
          <input
            :checked="sshCompletionEnabled"
            data-testid="ssh-command-completion-enabled"
            type="checkbox"
            @change="enableSshCompletionFromSettings"
          />
        </label>
        <label class="setting-toggle" data-testid="ssh-command-completion-description-setting">
          <span>
            <strong>Show command descriptions</strong>
            <small>Only applies to SSH/Linux completion overlays.</small>
          </span>
          <input
            :checked="sshCompletionShowDescriptions"
            data-testid="ssh-command-completion-show-descriptions"
            type="checkbox"
            @change="setSshCompletionDescriptionsFromSettings"
          />
        </label>
        <label class="settings-number-field" data-testid="ssh-command-completion-max-setting">
          <span>
            Max suggestions
            <small>Range 5 - 20.</small>
          </span>
          <input
            :value="sshCompletionMaxSuggestions"
            data-testid="ssh-command-completion-max-suggestions"
            type="number"
            min="5"
            max="20"
            step="1"
            @input="setSshCompletionMaxFromSettings"
          />
        </label>
        <label class="settings-number-field" data-testid="ssh-command-completion-trigger-setting">
          <span>
            Trigger characters
            <small>Range 1 - 4.</small>
          </span>
          <input
            :value="sshCompletionTriggerChars"
            data-testid="ssh-command-completion-trigger-chars"
            type="number"
            min="1"
            max="4"
            step="1"
            @input="setSshCompletionTriggerFromSettings"
          />
        </label>
        <section class="ssh-keepalive-settings" data-testid="ssh-keepalive-settings">
          <h3 class="settings-subheading">SSH 保活</h3>
          <label class="settings-number-field">
            <span>
              连续失败次数
              <small>范围 1 到 10 次。</small>
            </span>
            <input value="3" readonly />
          </label>
        </section>
        <div class="terminal-profile-section" data-testid="terminal-profile-settings">
          <div class="settings-card-header">
            <div>
              <h3 class="terminal-profile-title" data-testid="terminal-profile-title">终端配置 Profile</h3>
              <p class="settings-note">只影响 xterm 外观。</p>
            </div>
          </div>
        </div>
      </section>

      <section
        v-if="shouldRender('settings-macos-dark-overlays')"
        class="settings-overlay-backdrop app-material-backdrop"
        data-testid="settings-macos-dark-overlays"
      >
        <div class="topbar-menu">
          <button type="button" class="topbar-menu-item">
            <span class="topbar-menu-leading" aria-hidden="true"></span>
            <span class="topbar-menu-content"><AppIcon name="gear" :size="18" /><span class="topbar-menu-label">设置</span></span>
            <span class="topbar-menu-trailing"></span>
          </button>
        </div>
        <div class="modal-backdrop app-dialog-backdrop app-material-backdrop ui-fixture-modal-backdrop">
          <form class="modal app-dialog app-material-surface" @submit.prevent>
            <header>
              <h2>Delete server</h2>
            </header>
            <p class="app-dialog-message">Delete this fixture server?</p>
            <footer>
              <button type="button" class="secondary">Cancel</button>
              <button type="submit" class="danger">Delete server</button>
            </footer>
          </form>
        </div>
        <section class="settings-page settings-page-overlay">
          <header class="settings-page-header">
            <div>
              <h1>Settings</h1>
              <p class="settings-app-version">macOS fixture</p>
            </div>
          </header>
          <div class="settings-category-shell">
            <nav class="settings-category-nav" aria-label="Settings categories">
              <button type="button" class="active"><AppIcon name="gear" :size="18" /><span class="settings-category-nav-label">常规</span></button>
            </nav>
            <article class="settings-card">
              <fieldset class="backup-option-list">
                <label><input data-testid="macos-dark-radio-checked" type="radio" name="macos-theme" checked />深色</label>
                <label><input type="radio" name="macos-theme" />浅色</label>
                <label><input data-testid="macos-dark-checkbox-checked" type="checkbox" checked />导入密钥库</label>
              </fieldset>
            </article>
          </div>
        </section>
      </section>

      <section
        v-if="shouldRender('settings-font-slider-alignment')"
        class="settings-card ui-fixture-settings-font-slider"
        data-testid="settings-font-slider-alignment"
      >
        <h3 class="settings-subheading">界面字体大小</h3>
        <div class="settings-font-slider" data-testid="ui-font-size-stepper">
          <div
            class="settings-font-slider-control"
            data-testid="ui-font-size-slider-control"
            style="--font-slider-percent: 50%;"
          >
            <input type="range" min="12" max="18" step="1" value="15" data-testid="ui-font-size-slider" aria-label="界面字体大小" />
            <div class="settings-font-track" data-testid="ui-font-size-track" aria-hidden="true">
              <div class="settings-font-track-scale" data-testid="ui-font-size-track-scale">
                <span class="settings-font-track-line" data-testid="ui-font-size-track-line"></span>
                <span class="settings-font-thumb" data-testid="ui-font-size-thumb" style="--font-slider-percent: 50%;"></span>
                <div class="settings-font-ticks" data-testid="ui-font-size-ticks">
                  <span class="settings-font-tick" style="--font-slider-percent: 0%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">小</span></span>
                  <span class="settings-font-tick" style="--font-slider-percent: 16.666666666666664%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">13</span></span>
                  <span class="settings-font-tick" style="--font-slider-percent: 33.33333333333333%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">正常</span></span>
                  <span class="settings-font-tick" data-testid="ui-font-size-current-tick" style="--font-slider-percent: 50%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">15</span></span>
                  <span class="settings-font-tick" style="--font-slider-percent: 66.66666666666666%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">较大</span></span>
                  <span class="settings-font-tick" style="--font-slider-percent: 83.33333333333334%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">大</span></span>
                  <span class="settings-font-tick" style="--font-slider-percent: 100%;"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">最大</span></span>
                </div>
              </div>
            </div>
          </div>
          <span class="settings-font-size-value" data-testid="ui-font-size-value">15px</span>
        </div>
      </section>

      <section
        v-if="shouldRender('settings-header-actions')"
        class="ui-fixture-settings-header"
        data-testid="settings-header-actions"
      >
        <header class="settings-page-header">
          <div>
            <h1>Settings</h1>
            <p class="settings-app-version">ServerPilot v0.5.0-beta.28</p>
          </div>
          <div class="settings-header-actions" data-testid="settings-action-bar">
            <button class="secondary settings-reset-defaults-button" type="button">Reset</button>
            <button class="secondary settings-save-button" type="button">Save</button>
            <button class="primary settings-save-close-button" type="button">Save and close</button>
            <button class="dialog-close-button settings-close-button" type="button">Close</button>
          </div>
        </header>
      </section>

      <section v-if="shouldRender('workspace-tabs-many')" class="ui-fixture-topbar-shell">
        <header class="workspace-topbar">
          <div class="workspace-tabs" role="tablist" data-testid="workspace-tabs-many">
            <button
              v-for="tab in [
                { id: 'tab-ip', title: '192.0.2.10:22' },
                { id: 'tab-long', title: 'very-long-fixture-server-name-for-ellipsis.example.invalid' },
                ...Array.from({ length: 10 }, (_, index) => ({ id: `tab-${index + 1}`, title: `server-${index + 1}` })),
              ]"
              :key="tab.id"
              class="terminal-tab"
              :class="{ active: activeTabId === tab.id }"
              :data-tab-id="tab.id"
              @click="activeTabId = tab.id"
            >
              <i class="status-dot online"></i>
              <span class="terminal-tab-title">{{ tab.title }}</span>
              <span
                class="terminal-close"
                @pointerdown.stop.prevent
                @mousedown.stop.prevent
                @click.stop.prevent="tabCloseCount += 1"
              >×</span>
            </button>
            <button class="topbar-add" type="button">+</button>
          </div>
          <div class="topbar-split">
            <button class="split-mode-button" type="button">
              <span class="topbar-action-inner">
                <AppIcon name="layout-grid" :size="16" />
                <span>分屏</span>
              </span>
            </button>
          </div>
          <span class="topbar-action-separator" aria-hidden="true"></span>
          <div class="topbar-navigation">
            <button type="button" :aria-expanded="topbarMenuOpen" @click="topbarMenuOpen = !topbarMenuOpen">
              <span class="topbar-action-inner">
                <AppIcon name="menu" :size="16" />
                <span>菜单</span>
                <span aria-hidden="true">▾</span>
              </span>
            </button>
            <div v-if="topbarMenuOpen" class="topbar-menu">
              <template v-for="item in topbarFixtureItems" :key="item.label">
                <button
                  type="button"
                  class="topbar-menu-item"
                  :class="{ active: item.active, 'topbar-menu-badge-row': item.badge > 0 }"
                >
                  <span class="topbar-menu-leading" aria-hidden="true"></span>
                  <span class="topbar-menu-content">
                    <AppIcon :name="item.icon" :size="18" />
                    <span class="topbar-menu-label">{{ item.label }}</span>
                  </span>
                  <span class="topbar-menu-trailing">
                    <span v-if="item.badge > 0" class="topbar-menu-badge">{{ item.badge }}</span>
                  </span>
                </button>
              </template>
            </div>
          </div>
        </header>
        <span class="ui-fixture-tabs-close-count" data-testid="tabs-close-count">{{ tabCloseCount }}</span>
      </section>

      <section v-if="shouldRender('command-button-dock')" class="ui-fixture-command-dock" data-testid="command-button-dock">
        <div ref="commandButtonDockStage" class="terminal-stage" data-testid="command-button-dock-stage">
          <button
            ref="commandFixtureButtonRef"
            class="terminal-command-button"
            :class="{ dragging: commandFixtureButtonDragging }"
            :style="commandFixtureButtonStyle"
            type="button"
            @pointerdown="startCommandFixtureButtonDrag"
            @click="clickCommandFixtureButton"
          >命令</button>
        </div>
        <span data-testid="command-button-click-count">{{ commandFixtureClickCount }}</span>
      </section>

      <section
        v-if="shouldRender('ssh-command-completion')"
        class="ui-fixture-command-completion"
        data-testid="ssh-command-completion"
      >
        <div class="terminal-view-host command-completion-fixture-host">
          <div class="terminal-view command-completion-terminal" data-terminal-kind="ssh">
            <label>
              SSH
              <input
                v-model="sshCompletionInput"
                data-testid="ssh-completion-input"
                aria-label="ssh command input"
                @input="handleSshCompletionInput"
                @keydown="handleSshCompletionKeydown"
              />
            </label>
            <span data-testid="ssh-completion-executed">executed {{ sshCompletionExecutedCount }}</span>
          </div>
          <TerminalCompletionOverlay
            :open="sshCompletionOpen"
            :suggestions="sshCompletionSuggestions"
            :selected-index="sshCompletionSelectedIndex"
            :prefix="sshCompletionInput"
            :busy="false"
            :position="sshCompletionPosition"
            :show-descriptions="sshCompletionShowDescriptions"
            @select="selectSshCompletion"
            @insert="acceptSshCompletion"
            @disable="disableSshCompletion"
          />
        </div>
      </section>

      <section
        v-if="shouldRender('ssh-command-completion-split')"
        class="ui-fixture-command-completion split"
        data-testid="ssh-command-completion-split"
      >
        <div class="command-completion-split-pane" data-testid="ssh-completion-pane-left">
          <button type="button" @click="sshCompletionFocusedPane = 'left'">Focus left</button>
          <div class="terminal-view-host command-completion-fixture-host">
            <div class="terminal-view command-completion-terminal">
              <input
                v-model="sshCompletionInput"
                data-testid="ssh-completion-split-input-left"
                aria-label="left ssh command input"
                @focus="sshCompletionFocusedPane = 'left'"
                @input="handleSshCompletionInput"
                @keydown="handleSshCompletionKeydown"
              />
            </div>
            <TerminalCompletionOverlay
              :open="sshCompletionOpen && sshCompletionFocusedPane === 'left'"
              :suggestions="sshCompletionSuggestions"
              :selected-index="sshCompletionSelectedIndex"
              :prefix="sshCompletionInput"
              :busy="false"
              :position="sshCompletionPosition"
              :show-descriptions="sshCompletionShowDescriptions"
              @select="selectSshCompletion"
              @insert="acceptSshCompletion"
              @disable="disableSshCompletion"
            />
          </div>
        </div>
        <div class="command-completion-split-pane" data-testid="ssh-completion-pane-right">
          <button type="button" @click="sshCompletionFocusedPane = 'right'">Focus right</button>
          <div class="terminal-view-host command-completion-fixture-host">
            <div class="terminal-view command-completion-terminal">
              <input
                data-testid="ssh-completion-split-input-right"
                aria-label="right ssh command input"
                value="do"
                @focus="sshCompletionFocusedPane = 'right'"
              />
            </div>
            <TerminalCompletionOverlay
              :open="sshCompletionOpen && sshCompletionFocusedPane === 'right'"
              :suggestions="sshCompletionSuggestions"
              :selected-index="sshCompletionSelectedIndex"
              :prefix="sshCompletionInput"
              :busy="false"
              :position="sshCompletionPosition"
              :show-descriptions="sshCompletionShowDescriptions"
              @select="selectSshCompletion"
              @insert="acceptSshCompletion"
              @disable="disableSshCompletion"
            />
          </div>
        </div>
      </section>

      <section
        v-if="shouldRender('local-command-completion-disabled')"
        class="ui-fixture-command-completion"
        data-testid="local-command-completion-disabled"
      >
        <div class="terminal-view-host command-completion-fixture-host">
          <div class="terminal-view command-completion-terminal" data-terminal-kind="local">
            <label>
              CMD
              <input
                v-model="localCompletionDisabledInput"
                data-testid="local-completion-input"
                aria-label="local command input"
              />
            </label>
          </div>
        </div>
      </section>

      <section v-if="shouldRender('settings-backup-restore-options')" class="ui-fixture-settings">
        <div class="ui-fixture-settings-card" data-testid="settings-backup-restore-options">
          <strong>导入内容</strong>
          <div class="backup-preview" data-testid="backup-default-import-options">
            <label
              v-for="option in defaultSettingsData.importOptions"
              :key="`default-${option.id}`"
              :data-option-id="option.id"
            >
              <input type="checkbox" :checked="option.checked" />
              <span>{{ optionLabel(option.id) }}</span>
            </label>
          </div>
          <div class="backup-preview" data-testid="backup-import-options">
            <label
              v-for="option in settingsData.importOptions"
              :key="option.id"
              :data-option-id="option.id"
            >
              <input type="checkbox" :checked="option.checked" />
              <span>{{ optionLabel(option.id) }}</span>
            </label>
          </div>
          <label data-testid="settings-saved-false">
            <input type="checkbox" :checked="settingsData.saved" />
            <span>保存状态</span>
          </label>
          <div class="backup-actions">
            <button type="button">导入</button>
            <button type="button">取消</button>
          </div>
        </div>
      </section>

      <section v-if="shouldRender('settings-native-notification')" class="ui-fixture-settings">
        <div class="ui-fixture-settings-card" data-testid="settings-native-notification">
          <div class="alert-native-controlbar" data-testid="alert-native-notifications">
            <label class="alert-global-control">
              <input type="checkbox" :checked="false" disabled data-testid="alert-native-notifications-enabled" />
              <span class="alert-global-control__text">
                <strong>macOS 系统通知</strong>
                <small>macOS 系统通知暂不可用；应用内告警中心行为不变。</small>
              </span>
            </label>
            <div class="alert-native-controlbar__status">
              <span data-testid="alert-native-notifications-status">macOS 系统通知暂不可用。</span>
              <button type="button" disabled>发送系统通知</button>
            </div>
          </div>
        </div>
      </section>

      <section
        v-if="fixtureName.startsWith('connection-dialog')"
        class="ui-fixture-security-shell"
        :data-testid="fixtureName"
      >
        <div class="modal-backdrop app-material-backdrop ui-fixture-modal-backdrop">
          <form class="modal connection-modal app-material-surface" @submit.prevent>
            <div class="connection-dialog-rail">
              <header class="connection-dialog-header">
                <h2>{{ shouldRender('connection-dialog-advanced') ? '编辑服务器' : '添加服务器' }}</h2>
              </header>
              <div class="connection-form">
                <div class="connection-form-row is-long-short">
                  <label class="connection-field is-long">名称（可选）
                    <input class="connection-name-input" value="layout-fixture-server-with-long-display-name" readonly data-testid="name" />
                  </label>
                  <label class="connection-field is-short">分组
                    <select class="connection-group-select" data-testid="group"><option>生产分组</option></select>
                  </label>
                </div>
                <p class="form-note connection-form-hint">未填写名称时，保存后自动使用服务器地址和端口作为名称。</p>
                <div class="connection-form-row is-long-short">
                  <label class="connection-field is-long">主机/IP
                    <input class="connection-host-input" data-testid="host" value="fixture.example.invalid" readonly required />
                  </label>
                  <label class="connection-field is-short">端口
                    <input class="connection-port-input" data-testid="port" type="number" value="22" readonly required />
                  </label>
                </div>
                <div class="connection-form-row is-long-short">
                  <label class="connection-field is-long">用户名
                    <input class="connection-username-input" data-testid="username" value="fixture-user" readonly required />
                  </label>
                  <label class="connection-field is-short">认证方式
                    <select class="connection-auth-select" data-testid="auth-type">
                      <option v-if="shouldRender('connection-dialog-password')" selected>密码</option>
                      <option v-else selected>SSH 私钥</option>
                    </select>
                  </label>
                </div>
                <template v-if="shouldRender('connection-dialog-password')">
                  <div class="connection-form-row is-long-short">
                    <label class="connection-field is-long">密码
                      <input class="connection-password-input" data-testid="password" type="password" autocomplete="off" value="" readonly />
                    </label>
                    <label class="connection-field is-short">刷新周期
                      <select class="connection-refresh-select" data-testid="refresh-interval"><option>2 秒</option></select>
                    </label>
                  </div>
                  <label class="checkbox connection-auth-checkbox">
                    <input data-testid="remember-secret" type="checkbox" checked />
                    记住密码到系统凭据库
                  </label>
                </template>
                <template v-if="shouldRender('connection-dialog-keyvault')">
                  <div class="connection-form-row is-long-short">
                    <label class="connection-field is-long">密钥库私钥
                      <select class="connection-key-source-select" data-testid="private-key-source"><option>密钥库私钥</option></select>
                    </label>
                    <label class="connection-field is-short">刷新周期
                      <select class="connection-refresh-select" data-testid="refresh-interval"><option>2 秒</option></select>
                    </label>
                  </div>
                  <div class="connection-form-row is-one-long">
                    <label class="connection-field is-long">密钥库条目
                      <span class="connection-key-control">
                        <select class="connection-key-vault-select" data-testid="key-vault-select">
                          <option>layout-fixture-key-with-a-very-long-name-that-must-ellipsis · ED25519</option>
                        </select>
                        <button type="button" class="secondary" data-testid="connection-add-key">添加密钥</button>
                      </span>
                    </label>
                  </div>
                  <div class="key-vault-summary connection-form-wide" data-testid="selected-key-vault-summary">
                    <strong>layout-fixture-key-with-a-very-long-name-that-must-ellipsis</strong>
                    <small>SHA256:fixtureSelectedKeyFingerprintABCDEFGHIJKLMNOPQRSTUVWXYZ</small>
                  </div>
                </template>
                <div v-if="!shouldRender('connection-dialog-password')" class="connection-form-row is-one-long">
                  <label class="connection-field is-long">连接路径
                    <select class="connection-route-select" data-testid="connection-route-select">
                      <option v-if="shouldRender('connection-dialog-advanced')">通过：jump-fixture.example.invalid</option>
                      <option v-else>直接连接</option>
                    </select>
                  </label>
                </div>
                <p
                  v-if="shouldRender('connection-dialog-advanced')"
                  class="form-error connection-form-wide"
                  data-testid="jump-server-missing"
                >
                  该服务器配置的跳板机已不存在，请重新选择跳板机。
                </p>
                <div v-if="!shouldRender('connection-dialog-password')" class="connection-form-row is-one-long">
                  <label class="connection-field is-long">终端配置
                    <select class="connection-profile-select" data-testid="terminal-profile-select">
                      <option>Fixture terminal profile with a long display name</option>
                    </select>
                  </label>
                </div>
                <template v-if="shouldRender('connection-dialog-advanced')">
                  <div class="connection-form-row is-one-long">
                    <label class="connection-field is-long">代理策略
                      <select><option>继承全局默认</option></select>
                    </label>
                  </div>
                  <div class="connection-form-row is-one-long">
                    <label class="connection-field is-long">标签
                      <input value="layout, security, modal, form, regression" readonly />
                    </label>
                  </div>
                  <div class="connection-form-row is-one-long">
                    <label class="connection-field is-long">备注
                      <textarea class="app-textarea" rows="4" readonly>Fixture-only advanced note used to make the dialog body scroll internally.</textarea>
                    </label>
                  </div>
                </template>
              </div>
              <p
                v-if="shouldRender('connection-dialog-password')"
                class="form-error connection-form-wide"
                data-testid="connection-validation-error"
              >
                请填写主机地址并确认认证信息。
              </p>
              <p class="form-note">密码和私钥口令不会写入 SQLite。密钥库私钥会经 Windows 用户级保护后存入本地数据库。</p>
              <footer class="connection-dialog-footer">
                <button type="button" class="secondary">取消</button>
                <button type="submit" class="secondary">保存</button>
                <button type="button" class="primary" data-testid="save-connect">保存并连接</button>
              </footer>
            </div>
          </form>
        </div>
      </section>

      <section
        v-if="fixtureName.startsWith('auth-dialog')"
        class="ui-fixture-security-shell"
        :data-testid="fixtureName"
      >
        <div class="modal-backdrop ui-fixture-modal-backdrop">
          <form class="modal auth-modal" @submit.prevent>
            <header>
              <h2>{{ shouldRender('auth-dialog-key-passphrase') ? '打开 SSH 终端' : '输入认证信息' }}</h2>
            </header>
            <p class="target">fixture-user@fixture-server-with-long-hostname.example.invalid:22</p>
            <p v-if="shouldRender('auth-dialog-password-error')" class="form-error">认证失败，请重新输入认证信息。</p>
            <p v-else class="saved-credential">系统凭据库中已有保存的私钥口令</p>
            <label v-if="shouldRender('auth-dialog-password-error')">密码
              <input type="password" autocomplete="off" readonly />
            </label>
            <label v-else>私钥口令（无口令可留空）
              <input type="password" autocomplete="off" readonly />
            </label>
            <label class="checkbox">
              <input type="checkbox" checked />
              记住{{ shouldRender('auth-dialog-password-error') ? '密码' : '私钥口令' }}到系统凭据库
            </label>
            <footer>
              <button type="button" class="secondary">取消</button>
              <button type="submit" class="primary">{{ shouldRender('auth-dialog-key-passphrase') ? '打开终端' : '提交' }}</button>
            </footer>
          </form>
        </div>
      </section>

      <section
        v-if="shouldRender('host-key-trust-changed')"
        class="ui-fixture-security-shell"
        data-testid="host-key-trust-changed"
      >
        <div class="modal-backdrop ui-fixture-modal-backdrop">
          <section class="modal host-key-trust-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>主机指纹已变化</h2>
              <button type="button" class="dialog-close-button">关闭</button>
            </header>
            <p class="form-error" data-testid="host-key-warning">当前检测到的主机指纹与已保存记录不一致。请确认这是预期变更。</p>
            <dl class="host-key-fingerprints" data-testid="host-key-fingerprints">
              <div>
                <dt>服务器</dt>
                <dd>fixture-server-with-long-hostname.example.invalid:22</dd>
              </div>
              <div>
                <dt>已保存</dt>
                <dd>SHA256:fixturePreviousFingerprintABCDEFGHIJKLMNOPQRSTUVWXYZ123456</dd>
              </div>
              <div>
                <dt>当前检测</dt>
                <dd>SHA256:fixtureObservedFingerprintZYXWVUTSRQPONMLKJIHGFEDCBA654321</dd>
              </div>
            </dl>
            <footer class="host-key-actions">
              <button type="button" class="secondary">取消</button>
              <button type="button" class="secondary">拒绝</button>
              <button type="button" class="primary danger">信任并更新</button>
            </footer>
          </section>
        </div>
      </section>

      <section
        v-if="shouldRender('key-vault-list-empty-and-many')"
        class="ui-fixture-security-shell ui-fixture-key-vault-shell"
        data-testid="key-vault-list-empty-and-many"
      >
        <article class="settings-card key-vault-card">
          <div class="settings-card-header">
            <div>
              <h2>密钥库</h2>
              <p>Fixture-only metadata list; no key material is present.</p>
            </div>
            <button type="button" class="primary key-vault-add-button">新增密钥</button>
          </div>
          <div class="key-vault-toolbar">
            <input data-testid="key-vault-search" placeholder="搜索名称、文件名、算法、指纹或备注" value="fixture" readonly />
            <button type="button" class="secondary">刷新</button>
          </div>
          <div class="empty-state" data-testid="key-vault-empty">无匹配密钥。调整搜索条件后继续查看列表。</div>
          <div class="key-vault-list">
            <div v-for="entry in keyVaultRows" :key="entry.id" class="key-vault-row">
              <div class="key-vault-main">
                <div class="key-vault-row-header">
                  <strong>{{ entry.name }}</strong>
                  <span>{{ entry.algorithm }}</span>
                  <span>使用中 {{ entry.usage }} 台</span>
                  <span v-if="entry.legacy" class="key-vault-badge">旧版密钥</span>
                </div>
                <button type="button" class="text-button fingerprint" :title="entry.fingerprint">{{ entry.fingerprint }}</button>
                <small class="key-vault-last-used">最后使用 2026-07-03 10:00</small>
              </div>
              <div class="key-vault-actions">
                <button type="button" class="secondary">编辑</button>
                <button v-if="entry.legacy" type="button" class="secondary">导入到密钥库</button>
                <button type="button" class="secondary danger-button">删除</button>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section
        v-if="shouldRender('key-vault-edit-form')"
        class="ui-fixture-security-shell"
        data-testid="key-vault-edit-form"
      >
        <div class="modal-backdrop ui-fixture-modal-backdrop">
          <form class="modal key-vault-modal" @submit.prevent>
            <header>
              <h2>编辑密钥</h2>
              <button type="button" class="dialog-close-button">关闭</button>
            </header>
            <div class="form-grid">
              <label class="span-2">名称
                <input value="layout-fixture-key-with-a-very-long-name-that-must-ellipsis" readonly />
              </label>
              <label class="span-2">来源文件名
                <input value="fixture-layout-key.ed25519" readonly />
              </label>
              <label>算法
                <input value="ED25519" readonly />
              </label>
              <label>位数
                <input value="256" readonly />
              </label>
              <label class="span-2">备注
                <textarea class="app-textarea key-import-remark" rows="3" readonly>Fixture metadata only. No key body is rendered.</textarea>
              </label>
            </div>
            <div class="validation-panel">
              <button type="button" class="secondary">验证密钥</button>
              <span class="form-error">请先选择有效的密钥文件元数据。</span>
            </div>
            <footer>
              <button type="button" class="secondary">取消</button>
              <button type="submit" class="primary">保存</button>
            </footer>
          </form>
        </div>
      </section>

      <section
        v-if="shouldRender('alert-center-list')"
        class="ui-fixture-security-shell ui-fixture-alert-shell"
        data-testid="alert-center-list"
      >
        <div class="alert-center-backdrop">
        <aside class="viewport-popover alert-center-panel">
          <header>
            <div>
              <h2>告警中心</h2>
              <small>告警历史和已读状态保存在本机。</small>
            </div>
            <button type="button" class="dialog-close-button">关闭</button>
          </header>
          <nav class="alert-center-tabs" aria-label="告警筛选">
            <button class="active" type="button">进行中 {{ alertRows.length }}</button>
            <button type="button">已恢复 2</button>
            <button type="button">全部 {{ alertRows.length }}</button>
          </nav>
          <div class="alert-center-actions">
            <button type="button" class="secondary">全部标记已读</button>
            <button type="button" class="secondary">清除已恢复</button>
          </div>
          <div class="alert-center-list">
            <article
              v-for="event in alertRows"
              :key="event.id"
              class="alert-row"
              :class="[`is-${event.severity}`, { unread: !event.read, muted: event.muted }]"
            >
              <div class="alert-row-main">
                <div class="alert-row-title">
                  <span class="alert-severity">{{ event.severity === 'critical' ? '严重' : '警告' }}</span>
                  <strong>{{ event.title }}</strong>
                  <span>{{ event.rule }}</span>
                </div>
                <p>{{ event.message }}</p>
                <small>{{ event.serverName }} · 92% / 90% · 触发 2 分钟前<span v-if="event.muted"> · 已静音</span></small>
              </div>
              <div class="alert-row-actions">
                <button type="button" class="text-button">查看监控</button>
                <button v-if="!event.read" type="button" class="text-button">已读</button>
                <button v-if="event.muted" type="button" class="text-button">取消静音</button>
                <button v-else type="button" class="text-button">静音 30 分钟</button>
              </div>
            </article>
          </div>
        </aside>
        </div>
      </section>

      <section
        v-if="shouldRender('monitor-alert-center-entry')"
        class="ui-fixture-security-shell ui-fixture-monitor-alert-shell"
        data-testid="monitor-alert-center-entry"
      >
        <div class="ui-fixture-monitor-panel">
          <MonitorDashboard
            :snapshot="monitorFixtureSnapshot"
            :history="[monitorFixtureSnapshot]"
            show-alert-center
            :alert-unread-count="monitorAlertEvents.filter((event) => !event.read).length"
            @alerts="monitorAlertCenterOpen = true"
          />
        </div>
        <AlertCenter
          :open="monitorAlertCenterOpen"
          :active-events="monitorAlertEvents"
          :resolved-events="[]"
          :all-events="monitorAlertEvents"
          @close="monitorAlertCenterOpen = false"
        />
      </section>

      <section
        v-if="shouldRender('dashboard-alert-center-layer')"
        class="ui-fixture-security-shell"
        data-testid="dashboard-alert-center-layer"
      >
        <MultiServerDashboardDialog
          open
          :summaries="dashboardSummaries"
          :connections="dashboardConnections"
          :selected-server-id="null"
          :active-workspace-server-id="null"
          :snapshots="{}"
          :histories="{}"
          initial-tab="overview"
          :initial-server-id="null"
          :batch-operation="null"
          dashboard-sort-mode="manual"
          :dashboard-manual-server-order="[]"
          :active-alert-counts-by-server-id="{ 252: 2 }"
          :alert-unread-count="2"
          @alerts="dashboardAlertCenterOpen = true"
          @connect-servers="dashboardConnectEventCount += 1"
        />
        <span data-testid="dashboard-connect-event-count">{{ dashboardConnectEventCount }}</span>
        <AlertCenter
          :open="dashboardAlertCenterOpen"
          :active-events="monitorAlertEvents"
          :resolved-events="[]"
          :all-events="monitorAlertEvents"
          @close="dashboardAlertCenterOpen = false"
        />
      </section>

      <section
        v-if="shouldRender('app-logs-long-lines')"
        class="logs-panel ui-fixture-app-logs"
        data-testid="app-logs-long-lines"
      >
        <header>
          <h2>应用日志</h2>
          <div class="log-filters">
            <select aria-label="日志级别筛选"><option>全部级别</option></select>
            <input placeholder="搜索服务器、操作或错误码" value="fixture" readonly />
            <button class="secondary app-log-refresh-button" type="button">刷新</button>
            <button class="secondary app-log-close-button" type="button">关闭</button>
          </div>
        </header>
        <div class="log-table">
          <div v-for="entry in appLogRows" :key="entry.id" class="log-row">
            <time>{{ entry.time }}</time>
            <span class="log-level" :class="entry.level">{{ entry.level }}</span>
            <strong>{{ entry.server }}</strong>
            <span>{{ entry.summary }}</span>
            <code>{{ entry.operation }}</code>
            <code v-if="entry.code" class="log-code">{{ entry.code }}</code>
          </div>
        </div>
      </section>

      <section
        v-if="fixtureName.startsWith('command-palette')"
        class="ui-fixture-security-shell ui-fixture-command-shell"
        :data-testid="fixtureName"
      >
        <div class="command-palette-backdrop">
          <section class="command-palette" role="dialog" aria-label="命令面板">
            <header>
              <div>
                <h2>命令面板</h2>
                <small>fixture-server.example.invalid</small>
              </div>
              <button type="button" class="command-light-action command-palette-close-button" data-testid="command-palette-close">关闭</button>
            </header>
            <template v-if="shouldRender('command-palette-management')">
              <div class="command-palette-tabs" data-testid="command-management-tabs">
                <button class="command-light-action" :class="{ active: commandManagementTab === 'history' }" type="button" data-testid="command-tab-history" @click="commandManagementTab = 'history'">历史命令</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" :class="{ active: commandManagementTab === 'favorites' }" type="button" data-testid="command-tab-favorites" @click="commandManagementTab = 'favorites'">常用命令</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" type="button" data-testid="command-open-batch">批量命令</button>
                <span class="command-action-separator command-action-separator-spacer" aria-hidden="true">|</span>
                <button type="button" class="command-light-action command-add-favorite-button" data-testid="command-add-favorite">新增收藏</button>
              </div>
              <div class="command-scope-filter" data-testid="command-management-shells">
                <button class="command-light-action" :class="{ active: commandManagementShell === 'ssh' }" type="button" data-testid="command-shell-ssh" @click="commandManagementShell = 'ssh'">SSH/Linux</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" :class="{ active: commandManagementShell === 'cmd' }" type="button" data-testid="command-shell-cmd" @click="commandManagementShell = 'cmd'">CMD</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" :class="{ active: commandManagementShell === 'powershell' }" type="button" data-testid="command-shell-powershell" @click="commandManagementShell = 'powershell'">PowerShell</button>
              </div>
              <div class="command-search-row">
                <input v-model="commandManagementQuery" class="command-search" data-testid="command-management-search" placeholder="搜索命令、标题或标签" />
                <button type="button" class="command-search-clear" @click="commandManagementQuery = ''">清除</button>
              </div>
              <div v-if="commandManagementTab === 'history'" class="command-list" data-testid="command-management-history-list">
                <div class="command-list-toolbar">
                  <span>History {{ commandManagementVisibleHistory.length }}</span>
                  <button type="button" class="text-button" data-testid="command-management-clear-history" :disabled="!commandManagementVisibleHistory.length" @click="clearCommandManagementHistory">清空当前 scope</button>
                </div>
                <article
                  v-for="command in commandManagementVisibleHistory"
                  :key="command"
                  class="command-row command-history-row"
                >
                  <code>
                    <template v-for="(part, index) in commandManagementHighlight(command)" :key="`${command}-${index}`">
                      <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </code>
                  <div class="command-row-actions">
                    <button type="button" class="text-button" data-testid="command-management-favorite-history" @click="addCommandManagementFavorite(command)">收藏</button>
                    <button type="button" class="danger-link" data-testid="command-management-delete-history" @click="deleteCommandManagementHistory(command)">删除</button>
                  </div>
                </article>
                <p v-if="!commandManagementVisibleHistory.length" class="empty-state">暂无命令历史。</p>
              </div>
              <div v-else class="command-list" data-testid="command-management-favorites-list">
                <article
                  v-for="favorite in commandManagementVisibleFavorites"
                  :key="favorite.id"
                  class="command-row command-favorite-row"
                  :data-shell="favorite.shell"
                >
                  <strong>{{ favorite.title }}</strong>
                  <code>
                    <template v-for="(part, index) in commandManagementHighlight(favorite.command)" :key="`${favorite.id}-${index}`">
                      <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </code>
                  <span class="command-source-badge">{{ favorite.shell }}</span>
                  <div class="command-row-actions">
                    <button type="button" class="text-button" data-testid="command-management-edit-favorite" @click="startCommandManagementFavoriteEdit(favorite)">编辑</button>
                    <button type="button" class="danger-link" data-testid="command-management-remove-favorite" @click="removeCommandManagementFavorite(favorite.id)">取消收藏</button>
                  </div>
                </article>
                <section v-if="commandManagementVisibleCommon.length" data-testid="command-management-common-list">
                  <h3>常用命令</h3>
                  <article
                    v-for="command in commandManagementVisibleCommon"
                    :key="command.id"
                    class="command-row command-common-row"
                    :data-shell="command.shell"
                  >
                    <strong>{{ command.title }}</strong>
                    <code>
                      <template v-for="(part, index) in commandManagementHighlight(command.command)" :key="`${command.id}-${index}`">
                        <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </code>
                  </article>
                </section>
                <form v-if="commandManagementEditingFavoriteId" class="command-history-editor" data-testid="command-management-favorite-editor" @submit.prevent="saveCommandManagementFavoriteEdit">
                  <input v-model="commandManagementEditTitle" data-testid="command-management-edit-title" />
                  <input v-model="commandManagementEditCommand" data-testid="command-management-edit-command" />
                  <button type="submit" class="primary">保存</button>
                </form>
                <p v-if="!commandManagementVisibleFavorites.length && !commandManagementVisibleCommon.length" class="empty-state">没有匹配命令。</p>
              </div>
            </template>
            <template v-else>
            <div class="command-palette-tabs">
              <button class="command-light-action active" type="button" data-testid="command-tab-history">历史命令</button>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <button class="command-light-action" type="button" data-testid="command-tab-favorites">常用命令</button>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <button class="command-light-action" type="button" data-testid="command-open-batch">批量命令</button>
              <span class="command-action-separator command-action-separator-spacer" aria-hidden="true">|</span>
              <button type="button" class="command-light-action command-add-favorite-button" data-testid="command-add-favorite">新增收藏</button>
            </div>
            <div class="command-search-row">
              <input class="command-search" value="fixture" readonly placeholder="搜索命令、标题或标签" />
              <button type="button" class="command-search-clear">清除</button>
            </div>
            <div class="command-scope-filter">
              <button class="command-light-action active" type="button" data-testid="command-scope-all">全部命令</button>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <button class="command-light-action" type="button" data-testid="command-scope-current-server">当前服务器</button>
            </div>
            <div class="command-list" data-testid="command-history-list">
              <p v-if="shouldRender('command-palette-no-results')" class="empty-state">暂无命令历史。</p>
              <article
                v-for="row in shouldRender('command-palette-no-results') ? [] : commandRows"
                :key="row.id"
                class="command-row command-history-row"
              >
                <div>
                  <strong>{{ row.title }}</strong>
                  <code>{{ row.command }}</code>
                  <small class="command-source-badge">{{ row.source }}</small>
                </div>
                <div class="command-row-actions">
                  <button type="button">插入</button>
                  <button type="button" :disabled="row.disabled">执行</button>
                  <button type="button" class="text-button">复制</button>
                </div>
              </article>
            </div>
            </template>
          </section>
        </div>
      </section>

      <section
        v-if="shouldRender('remote-text-viewer-toolbar')"
        class="ui-fixture-remote-text-shell"
        data-testid="remote-text-viewer-toolbar"
      >
        <RemoteTextViewer
          :file="remoteTextFile"
          :busy="false"
        />
      </section>

      <section
        v-if="shouldRender('remote-text-editor-toolbar')"
        class="ui-fixture-remote-text-shell"
        data-testid="remote-text-editor-toolbar"
      >
        <RemoteTextEditor
          :entry="remoteTextEntry"
          :content="remoteTextFile.content"
          :dirty="true"
          :busy="false"
        />
      </section>

      <section
        v-if="isSftpFixture(fixtureName)"
        class="ui-fixture-sftp-shell"
        :class="{ narrow: sftpData.narrow }"
        :data-testid="fixtureName"
      >
        <section class="sftp-panel expanded">
          <SftpToolbar
            :actions="sftpToolbarActions"
            :current-path="sftpData.path"
            :path-input="sftpData.path"
            :scp-mode="false"
            :online="true"
            :show-file-filter="true"
            :filter-query="''"
            :filter-active="false"
            :filter-status="''"
            conflict-policy="ask"
            :bookmarks="[]"
            :latest-transfer-summary="sftpLatestTransferSummary"
          />
          <div
            class="sftp-content"
            :class="{ 'sftp-fixture-has-transfers': sftpData.transfers?.length }"
            :style="{ gridTemplateColumns: 'minmax(0, 1fr) 210px' }"
            data-testid="sftp-fixture-content"
          >
            <div class="sftp-fixture-main">
              <div v-if="sftpData.error" class="sftp-empty sftp-fixture-error" data-testid="sftp-fixture-error">
                <strong>Directory refresh failed</strong>
                <span>{{ sftpData.error }}</span>
                <button class="secondary" type="button">Retry</button>
              </div>
              <SftpFileTable
                :columns="sftpColumns"
                :entries="sftpEntries"
                :selected-paths="sftpData.selectedPaths"
                :table-grid-style="sftpTableGridStyle"
                :filter-active="false"
                :filtered-entry-count="sftpEntries.length"
                current-sort-key="name"
                :current-sort-asc="true"
                :resizing-column-id="null"
                :dragging-column-id="null"
                :column-drop-target-index="null"
                :loading="sftpData.loading"
                :highlight-segments="sftpHighlightSegments"
              />
              <div
                v-if="sftpData.selectedPaths.length > 1"
                class="sftp-selection-actions"
                data-testid="sftp-selection-actions"
              >
                <strong>{{ sftpData.selectedPaths.length }} selected</strong>
                <button class="secondary" type="button">Download</button>
                <button class="secondary" type="button">Chmod</button>
                <button class="secondary" type="button">Rename</button>
                <button class="danger" type="button">Delete</button>
              </div>
              <div
                v-if="sftpData.transfers?.length"
                class="sftp-fixture-transfer-list"
                data-testid="sftp-transfer-entry-list"
              >
                <article
                  v-for="item in sftpData.transfers"
                  :key="item.id"
                  class="transfer-popover-row"
                >
                  <span>{{ item.direction }}</span>
                  <strong>{{ item.name }}</strong>
                  <span>{{ item.status }}</span>
                  <span>{{ item.percent }}%</span>
                  <progress :value="item.percent" max="100"></progress>
                  <span>0 B/s</span>
                  <button type="button">Pause</button>
                  <button type="button">Cancel</button>
                </article>
              </div>
            </div>
            <SftpDetailsPane
              :collapsed="false"
              :selected-count="sftpSelectedEntries.length"
              :selected-size-text="formatBytes(sftpSelectedEntries.reduce((total, entry) => total + (entry.isDir ? 0 : entry.size), 0))"
              :detail-rows="sftpDetailsRows"
            />
            <ContextMenu
              v-if="sftpData.contextMenu && !sftpContextMenuClosed"
              :x="780"
              :y="580"
              :items="sftpContextMenuItems"
              @close="sftpContextMenuClosed = true"
            />
          </div>
        </section>
      </section>

      <section v-if="shouldRender('transfer-popover-many')" class="ui-fixture-transfer-stage">
        <div class="ui-fixture-terminal-area"></div>
        <div class="ui-fixture-terminal-input-reserved" data-testid="terminal-input-reserved">terminal input reserved</div>
        <div class="viewport-popover transfer-popover" data-testid="transfer-popover-many" style="left: 48px; top: 48px; width: 620px; max-height: 430px;">
          <header>
            <strong>传输队列</strong>
            <span>{{ transferData.items.length }} 项</span>
          </header>
          <div class="transfer-popover-list">
            <article
              v-for="item in transferData.items"
              :key="item.id"
              class="transfer-popover-row"
              :data-transfer-id="item.id"
            >
              <span>{{ item.direction === 'upload' ? '上传' : '下载' }}</span>
              <strong>{{ item.name }}</strong>
              <span>{{ item.status }}</span>
              <span>{{ item.percent }}%</span>
              <progress :value="item.percent" max="100"></progress>
              <span>0 B/s</span>
              <button type="button">暂停</button>
              <button type="button">取消</button>
            </article>
          </div>
          <footer>
            <button type="button">清理完成</button>
            <button type="button">关闭</button>
          </footer>
        </div>
      </section>

      <section
        v-if="isDockerManagerFixture(fixtureName)"
        class="ui-fixture-manager-shell"
        :data-testid="fixtureName"
      >
        <div class="docker-dialog-backdrop">
          <section class="docker-dialog" role="dialog" aria-modal="true" aria-label="Docker Manager fixture">
            <header class="docker-dialog-header">
              <div>
                <h2>Docker Manager</h2>
                <p>Fixture shell with synthetic container data only.</p>
              </div>
              <button class="dialog-close-button" type="button" @click="closeDockerComposeFixture">Close</button>
            </header>
            <div class="docker-toolbar">
              <label class="docker-server-select-field">
                Server
                <select><option>fixture-server</option></select>
              </label>
              <label class="docker-search-field">
                Search
                <input value="fixture" readonly />
              </label>
              <label class="docker-filter-field">
                State
                <select><option>All</option></select>
              </label>
              <button class="secondary" type="button">检测 Docker</button>
              <button class="primary" type="button" data-testid="docker-refresh">刷新</button>
            </div>
            <div class="docker-status-line">Docker v27.3.1。Fixture 不调用后端。</div>
            <div class="docker-mode-tabs">
              <button class="command-light-action active" type="button" data-testid="docker-containers-tab">容器</button>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <button
                :class="{ active: shouldRender('docker-manager-compose-supported') || shouldRender('docker-manager-compose-unavailable') || shouldRender('docker-manager-compose-narrow') }"
                class="command-light-action"
                type="button"
                data-testid="docker-compose-tab"
              >
                Compose
              </button>
            </div>
            <section
              v-if="shouldRender('docker-manager-compose-supported') || shouldRender('docker-manager-compose-unavailable') || shouldRender('docker-manager-compose-narrow')"
              class="docker-compose-panel"
              data-testid="docker-compose-panel"
            >
              <div class="docker-compose-sidebar">
                <header class="docker-compose-section-header">
                  <div>
                    <strong>Compose Projects</strong>
                    <span v-if="!shouldRender('docker-manager-compose-unavailable')">docker compose v2.27.1</span>
                  </div>
                  <button class="command-light-action" type="button" data-testid="docker-compose-refresh">刷新项目</button>
                </header>
                <p
                  v-if="shouldRender('docker-manager-compose-unavailable')"
                  class="empty"
                  data-testid="docker-compose-unavailable"
                >
                  服务器未检测到 Docker Compose。
                </p>
                <template v-else>
                  <label class="docker-compose-filter docker-compose-project-filter">
                    筛选项目
                    <input v-model="dockerComposeProjectFilter" data-testid="docker-compose-filter" />
                  </label>
                  <button
                    v-for="project in filteredDockerComposeProjects"
                    :key="project.name"
                    type="button"
                    class="docker-compose-project-row"
                    :class="{ selected: project.name === 'edge' }"
                    data-testid="docker-compose-project-row"
                  >
                    <strong>{{ project.name }}</strong>
                    <span>{{ project.status }}</span>
                    <small :title="project.configFiles">{{ project.workingDir }}</small>
                  </button>
                </template>
              </div>
              <div v-if="!shouldRender('docker-manager-compose-unavailable')" class="docker-compose-detail">
                <header class="docker-compose-section-header">
                  <div>
                    <strong>edge</strong>
                  </div>
                  <div class="docker-compose-action-row" data-testid="docker-compose-action-row">
                    <button class="command-light-action" type="button" data-testid="docker-compose-refresh-services">刷新服务</button>
                    <span class="command-action-separator" aria-hidden="true">|</span>
                    <button class="command-light-action" type="button" data-testid="docker-compose-refresh-logs">刷新日志</button>
                    <span class="command-action-separator" aria-hidden="true">|</span>
                    <div class="docker-compose-log-actions" data-testid="docker-compose-log-actions">
                      <button class="command-light-action" type="button" data-testid="docker-compose-follow-logs" @click="startDockerComposeFixtureFollow">
                        {{ dockerComposeFollowing ? '停止跟随' : '跟随' }}
                      </button>
                      <span class="command-action-separator" aria-hidden="true">|</span>
                      <button class="command-light-action" type="button" data-testid="docker-compose-pause-logs" :disabled="!dockerComposeFollowing" @click="toggleDockerComposeFixturePause">
                        {{ dockerComposePaused ? '继续' : '暂停' }}
                      </button>
                      <span class="command-action-separator" aria-hidden="true">|</span>
                      <button class="command-light-action" type="button" data-testid="docker-compose-copy-logs" @click="copyDockerComposeFixtureLogs">复制</button>
                      <span class="command-action-separator" aria-hidden="true">|</span>
                      <button class="command-light-action" type="button" data-testid="docker-compose-clear-logs" @click="dockerComposeVisibleLogs = ''">清空</button>
                      <span data-testid="docker-compose-follow-count">{{ dockerComposeFollowCount }}</span>
                      <span data-testid="docker-compose-copy-state">{{ dockerComposeCopied ? 'copied' : 'idle' }}</span>
                    </div>
                    <span class="command-action-separator" aria-hidden="true">|</span>
                    <label class="docker-compose-tail" data-testid="docker-compose-tail-control">
                      <span>最近行数</span>
                      <select class="docker-compose-tail-select" data-testid="docker-compose-tail-select">
                        <option>50</option>
                        <option>100</option>
                        <option selected>200</option>
                        <option>500</option>
                        <option>1000</option>
                      </select>
                    </label>
                  </div>
                </header>
                <div class="docker-compose-service-toolbar" data-testid="docker-compose-service-toolbar">
                  <span class="docker-compose-service-count" data-testid="docker-compose-service-count">{{ dockerComposeServices.length }} 个服务</span>
                  <label class="docker-compose-filter">
                    筛选服务
                    <input v-model="dockerComposeServiceFilter" data-testid="docker-compose-service-filter" />
                  </label>
                </div>
                <div class="docker-compose-services" data-testid="docker-compose-services">
                  <article
                    v-for="service in filteredDockerComposeServices"
                    :key="service.name"
                    class="docker-compose-service-row"
                    data-testid="docker-compose-service-row"
                  >
                    <strong :title="service.name">{{ service.service }}</strong>
                    <span :title="service.image">{{ service.image }}</span>
                    <span>{{ service.state }}</span>
                    <span :title="service.status">{{ service.status }}</span>
                    <span :title="service.ports">{{ service.ports || 'no ports' }}</span>
                  </article>
                </div>
                <aside class="docker-compose-service-detail" data-testid="docker-compose-service-detail">
                  <strong>web</strong>
                  <span>nginx:alpine</span>
                  <span>running</span>
                  <span>Up 2 minutes</span>
                  <span>0.0.0.0:8080-&gt;80/tcp</span>
                </aside>
                <pre class="docker-compose-logs" data-testid="docker-compose-logs">{{ dockerComposeVisibleLogs }}</pre>
              </div>
            </section>
            <div class="docker-body">
              <section class="docker-list-panel">
                <div class="docker-list-header">
                  <label class="docker-select-all">
                    <input type="checkbox" :checked="shouldRender('docker-manager-batch-actions')" />
                    <span>容器</span>
                  </label>
                  <span>{{ dockerContainers.length }} / {{ dockerContainers.length }}</span>
                </div>
                <div
                  v-if="shouldRender('docker-manager-batch-actions')"
                  class="docker-batch-bar"
                  data-testid="docker-batch-bar"
                >
                  <span>3 selected</span>
                  <button type="button" data-testid="docker-batch-start">Start</button>
                  <button type="button" data-testid="docker-batch-stop">Stop</button>
                  <button type="button" data-testid="docker-batch-restart">Restart</button>
                  <button class="danger subtle" type="button" data-testid="docker-batch-remove">Remove</button>
                </div>
                <article
                  v-for="container in dockerContainers"
                  :key="container.id"
                  class="docker-container-card"
                  :class="{ selected: container.id === 'container-1' }"
                >
                  <label class="container-check">
                    <input type="checkbox" :checked="shouldRender('docker-manager-batch-actions') && container.selected" />
                  </label>
                  <div class="container-main">
                    <strong class="container-name" :title="container.name">{{ container.name }}</strong>
                    <span class="container-image" :title="container.image">{{ container.image }}</span>
                    <code class="container-id">{{ container.shortID }}</code>
                  </div>
                  <div class="container-meta">
                    <span :class="['container-state', container.state === 'running' ? 'running' : 'stopped']">{{ container.state }}</span>
                    <span :title="container.status">{{ container.status }}</span>
                    <span :title="container.ports">{{ container.ports || 'no ports' }}</span>
                  </div>
                  <div class="container-stats">
                    <span>CPU 1.2%</span>
                    <span>MEM 64 MB</span>
                  </div>
                  <div class="container-actions">
                    <button type="button">{{ container.state === 'running' ? 'Stop' : 'Start' }}</button>
                    <button v-if="container.state === 'running'" type="button" data-testid="docker-connect-container">连接</button>
                    <button type="button" data-testid="docker-inspect">详情</button>
                    <button type="button">资源</button>
                  </div>
                </article>
              </section>
              <section class="docker-detail-panel">
                <div class="detail-tabs">
                  <button class="command-light-action active" type="button">日志</button>
                  <span class="command-action-separator" aria-hidden="true">|</span>
                  <button class="command-light-action" type="button">资源</button>
                  <span class="command-action-separator" aria-hidden="true">|</span>
                  <button class="command-light-action" type="button">信息</button>
                </div>
                <div class="detail-content">
                  <div class="detail-actions" data-testid="docker-container-log-actions">
                    <button class="command-light-action" type="button" data-testid="docker-refresh-logs">刷新日志</button>
                    <span class="command-action-separator" aria-hidden="true">|</span>
                    <button class="command-light-action" type="button" data-testid="docker-follow-logs">实时追踪</button>
                    <span class="command-action-separator" aria-hidden="true">|</span>
                    <button class="command-light-action" type="button" data-testid="docker-clear-logs">清空显示</button>
                    <span class="command-action-separator" aria-hidden="true">|</span>
                    <label class="detail-tail-control" data-testid="docker-container-tail-control">
                      <span>最近行数</span>
                      <input type="number" value="200" min="1" max="5000" data-testid="docker-container-tail-input" />
                    </label>
                  </div>
                  <pre class="docker-log-view" data-testid="docker-log-view">{{ dockerLogLines.join('\n') }}</pre>
                  <dl class="docker-info-grid" data-testid="docker-stats-panel">
                    <dt>CPU</dt><dd>2.40%</dd>
                    <dt>Memory</dt><dd>64 MB / 512 MB</dd>
                    <dt>Network</dt><dd>In 2 MB / Out 8 MB</dd>
                    <dt>PIDs</dt><dd>8</dd>
                  </dl>
                  <dl class="docker-info-grid" data-testid="docker-inspect-panel">
                    <dt>ID</dt><dd>container-1</dd>
                    <dt>Image</dt><dd>nginx:alpine</dd>
                  </dl>
                </div>
              </section>
            </div>
          </section>
        </div>
      </section>

      <section
        v-if="isTunnelManagerFixture(fixtureName)"
        class="ui-fixture-manager-shell"
        :data-testid="fixtureName"
      >
        <div class="tunnel-dialog-backdrop">
          <section class="tunnel-dialog" role="dialog" aria-modal="true" aria-label="Tunnel Manager fixture">
            <header class="tunnel-dialog-header">
              <div>
                <h2>Tunnel Manager</h2>
                <p>Fixture shell for profile list, runtime status, and form layout.</p>
              </div>
              <button class="dialog-close-button" type="button">Close</button>
            </header>
            <div class="tunnel-dialog-toolbar">
              <label class="server-select-field">
                Server
                <select><option>fixture-server</option></select>
              </label>
              <button class="primary new-tunnel-button" type="button" data-testid="new-tunnel-profile">New tunnel</button>
            </div>
            <div class="tunnel-dialog-body">
              <form class="tunnel-profile-form">
                <h3>{{ shouldRender('tunnel-manager-form-narrow') ? 'Remote profile' : 'Edit profile' }}</h3>
                <label>
                  Name
                  <input value="remote-public-preview" readonly data-testid="tunnel-name" />
                </label>
                <div
                  v-if="shouldRender('tunnel-manager-form-narrow')"
                  class="remote-listen-diagnostics"
                  data-testid="remote-listen-diagnostics"
                >
                  <div>
                    <span>requested</span>
                    <strong>0.0.0.0:12380</strong>
                    <em>warning</em>
                  </div>
                  <p class="remote-listen-warning">Public bind requires an explicit server-side allow rule.</p>
                </div>
                <div class="tunnel-form-actions">
                  <button class="secondary" type="button">Save profile</button>
                  <button class="primary" type="button">Save and start</button>
                </div>
                <div class="tunnel-type-cards" role="radiogroup" aria-label="Tunnel type">
                  <button type="button" class="tunnel-type-card selected">
                    <strong>Local</strong>
                    <span>Forward a server service to this computer.</span>
                  </button>
                  <button type="button" class="tunnel-type-card">
                    <strong>Remote</strong>
                    <span>Expose a local service through the server port.</span>
                  </button>
                  <button type="button" class="tunnel-type-card">
                    <strong>SOCKS5</strong>
                    <span>Create a local proxy through SSH.</span>
                  </button>
                </div>
                <p class="form-hint">Synthetic tunnel form values avoid runtime calls.</p>
                <div class="tunnel-endpoint-row" data-testid="tunnel-endpoint-row">
                  <label>
                    我的电脑地址
                    <input value="127.0.0.1" readonly />
                  </label>
                  <label>
                    我的电脑端口
                    <input value="9080" readonly />
                  </label>
                </div>
                <div class="tunnel-endpoint-row" data-testid="tunnel-endpoint-row">
                  <label>
                    服务器地址
                    <input value="192.0.2.44" readonly />
                  </label>
                  <label>
                    服务器端口
                    <input value="8080" readonly />
                  </label>
                </div>
                <label class="auto-start-field">
                  <input type="checkbox" checked />
                  <span>Auto start</span>
                </label>
              </form>
              <section class="tunnel-profile-list">
                <h3>Profiles</h3>
                <article
                  v-for="profile in tunnelProfiles"
                  :key="profile.id"
                  class="tunnel-profile-card"
                  :class="{ active: profile.id === 'tunnel-2' }"
                  data-testid="tunnel-profile-card"
                >
                  <div class="tunnel-card-header">
                    <div class="tunnel-card-title">
                      <strong>{{ profile.name }}</strong>
                      <span>{{ profile.type }} | {{ profile.endpoint }}</span>
                    </div>
                    <div class="tunnel-card-actions">
                      <button v-if="profile.running" class="secondary" type="button">Stop</button>
                      <button v-else class="primary" type="button">Start</button>
                      <button class="danger subtle" type="button">Delete</button>
                    </div>
                  </div>
                  <div class="tunnel-runtime-line">
                    <span :class="['tunnel-status', profile.running ? 'running' : 'stopped']">{{ profile.running ? 'running' : 'stopped' }}</span>
                    <span>connections 2</span>
                    <span>in 1 MB</span>
                    <span>out 4 MB</span>
                  </div>
                  <div
                    v-if="profile.id === 'tunnel-1'"
                    class="remote-listen-diagnostics"
                    data-testid="remote-listen-diagnostics"
                  >
                    <div>
                      <span>requested</span>
                      <strong>0.0.0.0:12380</strong>
                      <em>warning</em>
                    </div>
                    <p class="remote-listen-warning">Public bind requires an explicit server-side allow rule.</p>
                    <button class="remote-access-button" type="button">Allow and restart</button>
                  </div>
                </article>
              </section>
            </div>
          </section>
        </div>
      </section>

      <section
        v-if="isProcessManagerFixture(fixtureName)"
        class="ui-fixture-manager-shell"
        :data-testid="fixtureName"
      >
        <div class="process-dialog-backdrop">
          <section class="process-dialog" role="dialog" aria-modal="true" aria-label="Process Manager fixture">
            <header class="process-dialog-header">
              <div>
                <h2>Process Manager</h2>
                <p>Fixture shell with synthetic process rows only.</p>
              </div>
              <button class="dialog-close-button" type="button">Close</button>
            </header>
            <div class="process-toolbar">
              <label class="process-server-select">
                Server
                <select><option>fixture-server</option></select>
              </label>
              <label class="process-search">
                Search
                <input value="fixture" readonly />
              </label>
              <div class="process-toolbar-actions">
                <button class="secondary" type="button">Refresh</button>
                <button class="secondary active" type="button">Realtime</button>
                <span class="process-refresh-status">last refresh 42ms</span>
              </div>
            </div>
            <div class="process-body">
              <section class="process-list-panel">
                <div class="process-warning"><span>Synthetic high CPU process warning.</span></div>
                <div class="process-table" role="table" aria-label="Process list fixture">
                  <div class="process-table-head-shell">
                    <div class="process-table-head" role="row" :style="processFixtureGridStyle">
                      <div
                        v-for="(column, index) in processFixtureColumns"
                        :key="column.key"
                        class="process-table-head-cell"
                        :class="{ numeric: column.numeric }"
                        role="columnheader"
                      >
                        <button
                          v-if="column.sortable"
                          type="button"
                          :class="{ numeric: column.numeric }"
                          :aria-sort="processFixtureSortKey === column.key ? processFixtureSortDir === 'desc' ? 'descending' : 'ascending' : 'none'"
                          @click="toggleProcessFixtureSort(column.key)"
                        >
                          <span>{{ column.label }}</span>
                          <span class="table-sort-arrow" aria-hidden="true">{{ processFixtureSortArrow(column.key) }}</span>
                        </button>
                        <span v-else>{{ column.label }}</span>
                        <span
                          v-if="index < processFixtureColumns.length - 1"
                          class="table-column-resizer"
                          :data-testid="`process-column-resizer-${index}`"
                          role="separator"
                          aria-orientation="vertical"
                          @mousedown.stop="startProcessFixtureColumnResize(index, $event)"
                        ></span>
                      </div>
                    </div>
                  </div>
                  <button
                    v-for="row in processRows"
                    :key="row.pid"
                    class="process-table-row"
                    :class="{ selected: row.pid === 4200 }"
                    type="button"
                    role="row"
                    :style="processFixtureGridStyle"
                  >
                    <span>{{ row.pid }}</span>
                    <span>{{ row.user }}</span>
                    <span class="numeric">{{ row.cpu }}%</span>
                    <span class="numeric">{{ row.mem }}%</span>
                    <span>{{ row.state }}</span>
                    <strong>{{ row.command }}</strong>
                  </button>
                </div>
              </section>
              <aside class="process-detail-panel">
                <header class="process-detail-header">
                  <div class="process-detail-heading">
                    <div class="process-detail-title">
                      <span class="process-state">running</span>
                      <h3>{{ processRows[0].command }}</h3>
                    </div>
                    <small>PID {{ processRows[0].pid }} / PPID 1</small>
                  </div>
                  <div class="process-actions process-detail-actions">
                    <button class="danger" type="button">Terminate</button>
                    <button class="danger ghost" type="button">Kill</button>
                  </div>
                </header>
                <dl class="process-facts">
                  <div><dt>User</dt><dd>deploy</dd></div>
                  <div><dt>CPU</dt><dd>12.4%</dd></div>
                  <div><dt>Memory</dt><dd>4.2%</dd></div>
                  <div><dt>Threads</dt><dd>18</dd></div>
                </dl>
                <section class="process-paths">
                  <p><strong>CWD</strong><span>/opt/serverpilot-fixture/current</span></p>
                  <p><strong>EXE</strong><span>/usr/bin/node</span></p>
                </section>
                <section class="process-cmdline">
                  <pre>{{ processRows[0].command }}</pre>
                </section>
              </aside>
            </div>
          </section>
          <div
            v-if="shouldRender('process-manager-action-confirm')"
            class="ui-fixture-confirm-dialog"
            data-testid="process-confirm-dialog"
            role="dialog"
            aria-modal="false"
          >
            <strong>Confirm process action</strong>
            <p>Send the selected synthetic signal to PID 4200?</p>
            <div>
              <button type="button">Cancel</button>
              <button class="danger" type="button">Confirm</button>
            </div>
          </div>
        </div>
      </section>

      <section
        v-if="shouldRender('network-diagnostics-summary')"
        class="ui-fixture-manager-shell"
        data-testid="network-diagnostics-summary"
      >
        <div class="modal-backdrop network-diagnostics-backdrop">
          <section class="modal network-diagnostics-modal" data-testid="network-diagnostics-dialog">
            <header>
              <div>
                <h2>Network Diagnostics</h2>
                <small>fixture@198.51.100.10:22</small>
              </div>
              <button type="button" class="dialog-close-button">Close</button>
            </header>
            <div class="network-diagnostics-toolbar">
              <label class="network-diag-select-field network-diag-server-select-field">
                <span>Server</span>
                <select class="network-diag-select network-diag-server-select"><option>fixture-server</option></select>
              </label>
              <label class="network-diag-select-field network-diag-interface-select-field">
                <span>Interface</span>
                <select class="network-diag-select network-diag-interface-select"><option>all</option></select>
              </label>
              <button type="button" class="secondary network-diag-refresh-button">Refresh</button>
            </div>
            <div class="network-diagnostics-body">
              <nav class="network-diagnostics-types" aria-label="Diagnostic types">
                <button type="button" class="command-light-action active">Ping</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button type="button" class="command-light-action">Traceroute</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button type="button" class="command-light-action">DNS</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button type="button" class="command-light-action">TCP</button>
              </nav>
              <section class="network-diagnostics-main">
                <div class="network-diagnostics-form">
                  <div class="network-diag-run-row">
                    <label class="network-diag-target-field">
                      <span>目标</span>
                      <input class="network-diag-target-input" value="example.invalid" readonly />
                    </label>
                    <div class="network-diagnostics-actions network-diag-actions">
                      <button type="button" class="primary">开始</button>
                      <button type="button" class="secondary">取消</button>
                      <button type="button" class="secondary">清空</button>
                      <button type="button" class="secondary">复制</button>
                    </div>
                    <span class="network-diag-status-badge is-running" aria-label="Diagnostic status">running</span>
                  </div>
                </div>
                <pre class="network-diagnostics-output">{{ networkDiagnosticLines.join('\n') }}</pre>
                <div class="network-endpoint-table" data-testid="network-endpoint-table">
                  <div class="network-endpoint-row network-endpoint-head" :style="networkEndpointFixtureGridStyle">
                    <div
                      v-for="(column, index) in networkEndpointFixtureColumns"
                      :key="column.key"
                      class="network-endpoint-head-cell"
                      role="columnheader"
                    >
                      <button
                        type="button"
                        :aria-sort="networkEndpointFixtureSortKey === column.key ? networkEndpointFixtureSortDir === 'desc' ? 'descending' : 'ascending' : 'none'"
                        @click="toggleNetworkEndpointFixtureSort(column.key)"
                      >
                        <span>{{ column.label }}</span>
                        <span class="table-sort-arrow" aria-hidden="true">{{ networkEndpointFixtureSortArrow(column.key) }}</span>
                      </button>
                      <span
                        v-if="index < networkEndpointFixtureColumns.length - 1"
                        class="table-column-resizer"
                        :data-testid="`network-endpoint-column-resizer-${index}`"
                        role="separator"
                        aria-orientation="vertical"
                        @mousedown.stop="startNetworkEndpointFixtureColumnResize(index, $event)"
                      ></span>
                    </div>
                  </div>
                  <div
                    v-for="row in networkEndpointFixtureRows"
                    :key="`${row.pid}-${row.port}`"
                    class="network-endpoint-row"
                    :style="networkEndpointFixtureGridStyle"
                  >
                    <span>{{ row.pid }}</span>
                    <strong>{{ row.process }}</strong>
                    <span>{{ row.source }}</span>
                    <span>{{ row.protocol }}</span>
                    <span>{{ row.address }}</span>
                    <span>{{ row.port }}</span>
                    <span>{{ row.ipCount }}</span>
                    <span>{{ row.connectionCount }}</span>
                    <span>{{ row.upload }}</span>
                    <span>{{ row.download }}</span>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
      </section>

      <section
        v-if="isServiceManagerFixture(fixtureName)"
        class="ui-fixture-manager-shell"
        :data-testid="fixtureName"
      >
        <div class="service-dialog-backdrop">
          <section class="service-dialog ui-fixture-service-manager ui-fixture-service-manager-narrow">
            <ServiceManagerList
              :capability="serviceCapability"
              :services="serviceSummaries"
              :raw-count="serviceSummaries.length"
              :selected-unit-name="selectedService.unitName"
            />
            <ServiceManagerDetails
              v-model:active-detail-tab="activeDetailTab"
              :action-busy="null"
              :action-disabled="{ start: false, stop: false, restart: false, enable: false, disable: false }"
              :capability="serviceCapability"
              :critical-warning-text="''"
              :detail="serviceDetail"
              :detail-error="''"
              :detail-loading="false"
              :journal-props="{
                autoScroll: true,
                currentBootOnly: true,
                journalCountText: `${serviceLines.length} 行`,
                journalFollowBusy: false,
                journalFollowDisabledReason: serviceData.journalFollowDisabledReason || '',
                journalFollowSupported: serviceData.journalFollowSupported !== false,
                journalFollowing: false,
                journalLoading: false,
                journalRefreshSupported: serviceData.journalRefreshSupported !== false,
                journalSourceText: serviceData.journalSourceText || '',
                journalStatus: 'ready',
                journalStatusText: 'Synthetic fixture lines',
                journalSupported: serviceCapability.available && (serviceCapability.initSystem === 'openwrt-procd' || serviceCapability.supportsJournal),
                lineLimit: 100,
                priority: 'all',
                query: '',
                selectedUnitName: selectedService.unitName,
                visibleLines: serviceLines,
                wordWrap: true,
              }"
              :partial-warning-text="''"
              :resource-metrics-supported="true"
              :selected-service="selectedService"
              :show-critical-warning="false"
              :show-partial-warning="false"
            />
          </section>
        </div>
      </section>
    </div>
  </main>
</template>
