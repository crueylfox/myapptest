<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import type {
  Connection,
  ConnectionRuntimeState,
  LocalTerminalCapabilities,
  MonitorNetworkInterfaceMode,
  MonitorNetworkInterfacePreference,
  MonitorSnapshot,
  NetworkInterface,
  ServerWorkspace,
  ShortcutSettings,
  TerminalSessionInfo,
  TerminalProfile,
} from '../types'
import { useTerminalStore } from '../stores/terminal'
import { useSftpStore } from '../stores/sftp'
import { useCommandStore } from '../stores/commands'
import { useLocalTerminalStore } from '../stores/localTerminal'
import { useTunnelStore } from '../stores/tunnels'
import { defaultTerminalProfile as builtinDefaultTerminalProfile } from '../stores/terminalProfiles'
import { api } from '../api/backend'
import { formatRate } from '../utils/format'
import { observeTerminalInstanceInput } from '../utils/terminalInstanceRegistry'
import {
  ALL_SPLIT_PANE_IDS,
  isSplitPaneId,
  type SplitPaneId,
} from '../utils/workspaceSplitTypes'
import { removeSessionFromPaneAssignments } from '../composables/usePaneAssignments'
import {
  resolveActiveCommandTarget,
  resolveTopTabPaneIntent,
} from '../composables/usePaneTargeting'
import { useWorkspaceCommandActions } from '../composables/useWorkspaceCommandActions'
import { useWorkspaceCommandPaletteFlow } from '../composables/useWorkspaceCommandPaletteFlow'
import {
  buildWorkspaceRightStyle,
  buildWorkspaceShellStyle,
  deriveVisibleOutputSessionIds,
} from '../composables/workspacePaneLayoutModel'
import { useWorkspacePaneResizeFlow } from '../composables/useWorkspacePaneResizeFlow'
import { useWorkspacePaneShellBindings } from '../composables/useWorkspacePaneShellBindings'
import { useWorkspaceSplitLayout } from '../composables/useWorkspaceSplitLayout'
import { useWorkspaceTransferActions } from '../composables/useWorkspaceTransferActions'
import { useWorkspaceTransferOverlayFlow } from '../composables/useWorkspaceTransferOverlayFlow'
import { useDockedCommandButton } from '../composables/useDockedCommandButton'
import { isLocalCommandTerminalReady, localCommandConnection, localCommandHistoryScope, localCommandTarget } from '../utils/localCommandPalette'
import { confirmDialog } from '../composables/useAppDialog'
import { localStatusLabel, statusLabel } from '../composables/workspaceCommandModel'
import {
  buildTransferRows,
  canResumeTransfer,
  isTerminalTransferStatus,
  transferMatchesContext,
  transferSummary,
  transferTerminalMessage,
  transferTerminalToastType,
} from '../composables/workspaceTransferOverlayModel'
import AppActionBar from './primitives/AppActionBar.vue'
import CommandPalette from './CommandPalette.vue'
import CompactMonitorSidebar from './CompactMonitorSidebar.vue'
import AppIcon from './icons/AppIcon.vue'
import LocalExplorerPanel from './LocalExplorerPanel.vue'
import LocalMonitorSidebar from './LocalMonitorSidebar.vue'
import LocalTerminalView from './LocalTerminalView.vue'
import SftpPanel from './SftpPanel.vue'
import TerminalEmptyPane from './TerminalEmptyPane.vue'
import TerminalPane from './TerminalPane.vue'
import TerminalPaneSelector from './TerminalPaneSelector.vue'
import TerminalSplitWorkspace from './TerminalSplitWorkspace.vue'
import TerminalView from './TerminalView.vue'
import WorkspaceStatePanel from './WorkspaceStatePanel.vue'
import { usePaneDragDrop } from '../composables/usePaneDragDrop'
import { usePaneResizeBridge } from '../composables/usePaneResizeBridge'

const props = withDefaults(defineProps<{
  connection: Connection | null
  state: ConnectionRuntimeState | null
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  layoutRevision: number
  visible?: boolean
  sftpOpenRevision?: number
  terminalCopyOnSelectEnabled?: boolean
  terminalRightClickPasteEnabled?: boolean
  shortcutSettings?: ShortcutSettings
  commandHistoryMaxEntries?: number
  connections?: Connection[]
  connectionStates?: Record<number, ConnectionRuntimeState>
  terminalProfiles?: TerminalProfile[]
  defaultTerminalProfile?: TerminalProfile
  terminalProfileApplyRevision?: number
  networkInterfaces?: NetworkInterface[]
  networkInterfacePreference?: MonitorNetworkInterfacePreference | null
  networkInterfacesLoading?: boolean
  alertActiveCount?: number; localTerminalCapabilities?: LocalTerminalCapabilities | null
  paneTargetAssignment?: {
    paneId: string
    kind: 'ssh' | 'local'
    sessionId: string
    requestId: number
  } | null
}>(), {
  visible: true,
})
const emit = defineEmits<{
  monitor: []
  newTerminal: [connectionId?: number]
  reconnect: [sessionId: string, connectionId: number, code: string]
  connectWorkspace: [connectionId: number]
  trustHostKey: [connectionId: number]
  editWorkspace: [connectionId: number]
  disconnectServer: [connectionId: number]
  finalTerminalDisconnect: [connectionId: number]
  openSftp: [connectionId: number]
  reconnectSftp: [connectionId: number, contextId: string, terminalSessionId: string]
  openTunnels: []
  processManager: [pid?: number]
  networkInterface: [mode: MonitorNetworkInterfaceMode, selectedNetworkInterface: string]
  networkDiagnostics: []
  networkInterfacesRefresh: []
  alerts: []
  paneAddServer: [paneId: string]
  paneConnectSaved: [paneId: string]
  paneOpenLocalTerminal: [paneId: string, shellKind: string]
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()
const store = useTerminalStore()
const sftpStore = useSftpStore()
const commandStore = useCommandStore()
const localTerminalStore = useLocalTerminalStore()
const tunnelStore = useTunnelStore()
const root = ref<HTMLElement>()
const terminalStage = ref<HTMLElement>()
const storedWidthValue = localStorage.getItem('hostdeck.monitorSidebarWidth')
const storedWidth = storedWidthValue === null ? Number.NaN : Number(storedWidthValue)
const sidebarWidth = ref(Number.isFinite(storedWidth) ? storedWidth : 230)
const sidebarCollapsed = ref(localStorage.getItem('hostdeck.monitorSidebarCollapsed') === 'true')
const autoCollapsed = ref(false)
const sftpExpanded = ref(localStorage.getItem('hostdeck.sftpExpanded') !== 'false')
const storedSFTPHeightValue = localStorage.getItem('hostdeck.sftpHeight')
const storedSFTPHeight = storedSFTPHeightValue === null ? Number.NaN : Number(storedSFTPHeightValue)
const sftpHeight = ref(Number.isFinite(storedSFTPHeight) ? storedSFTPHeight : 140)
const internalRevision = ref(0)
const autoCollapseDismissed = ref(false)
const notifiedTransferStatuses = new Map<string, string>()
let rootObserver: ResizeObserver | null = null
type ExternalTabDropDetail = {
  kind?: 'terminal' | 'local' | 'workspace'
  key?: string
  sessionId?: string
  localSessionId?: string
  clientX?: number
  clientY?: number
}
const transferOverlayFlow = useWorkspaceTransferOverlayFlow({
  rootRef: root,
  sftpExpanded,
  scheduleAfterOpen: (callback) => { void nextTick(callback) },
})
const {
  transferPopover,
  transferScope,
  transferButton,
  transferPopoverStyle,
  updateTransferPopoverPosition,
  openTransferPopover,
  closeTransferPopover,
  closeTransferPopoverFromOutside,
  closeTransferPopoverOnEscape,
} = transferOverlayFlow
const splitLayout = useWorkspaceSplitLayout()
const {
  splitMode,
  paneAssignments,
  activePaneId,
  splitColumnRatio,
  splitRowRatio,
  maximizedPaneId,
  visibleSplitPaneIds,
  splitEnabled,
  renderedSplitPaneIds,
  showColumnSplitter,
  showRowSplitter,
} = splitLayout
let knownTerminalSessionIds = new Set<string>()
let knownLocalSessionIds = new Set<string>()
let lastPaneTargetAssignmentRequestId = 0

const localTerminalActive = computed(() => Boolean(localTerminalStore.activeSessionId))
const collapsed = computed(() => sidebarCollapsed.value || autoCollapsed.value)
const shellStyle = computed(() => buildWorkspaceShellStyle({ collapsed: collapsed.value, sidebarWidth: sidebarWidth.value }))
const bottomPanelExpanded = computed(() => sftpExpanded.value)
const rightStyle = computed(() => buildWorkspaceRightStyle({ sftpExpanded: bottomPanelExpanded.value, sftpHeight: sftpHeight.value }))
const bottomPanelLabel = computed(() => localTerminalActive.value ? '本地文件管理' : 'SFTP panel')
const revision = computed(() => props.layoutRevision + internalRevision.value)
const activeSftpContextId = ref<string | null>(null)
const effectiveDefaultProfile = computed(() => props.defaultTerminalProfile ?? builtinDefaultTerminalProfile)
const splitWorkspaceElement = computed(() => root.value?.querySelector<HTMLElement>('.terminal-split-workspace') ?? null)
const paneDragDrop = usePaneDragDrop({
  rootRef: root,
  isPaneId: isSplitPaneId,
  isPaneVisible: (paneId) => visibleSplitPaneIds.value.includes(paneId),
  onDrop: ({ assignment, targetPaneId }) => {
    assignToPane(assignment, targetPaneId)
  },
})
const paneDropTargetId = paneDragDrop.paneDropTargetId
const paneResizeBridge = usePaneResizeBridge({
  workspaceRef: splitWorkspaceElement,
  columnRatio: splitColumnRatio,
  rowRatio: splitRowRatio,
  onRatioChange: (axis, ratio) => {
    if (axis === 'column') splitColumnRatio.value = ratio
    else splitRowRatio.value = ratio
  },
  onRatioCommit: () => {
    persistSplitLayout()
  },
  onLayoutBump: bumpLayout,
})
const activePaneAssignment = computed(() => paneAssignments.value[activePaneId.value])
const activePaneSessionId = computed(() => activePaneAssignment.value?.sessionId ?? null)
const visibleOutputSessions = computed(() => deriveVisibleOutputSessionIds({
  visible: props.visible !== false,
  splitEnabled: splitEnabled.value,
  renderedPaneIds: renderedSplitPaneIds.value,
  paneAssignments: paneAssignments.value,
  activeSshSessionId: store.activeSessionId,
  activeLocalSessionId: localTerminalStore.activeSessionId,
  localTerminalActive: localTerminalActive.value,
}))

function syncVisibleOutputSessions() {
  store.setVisibleOutputSessions(visibleOutputSessions.value.ssh)
  localTerminalStore.setVisibleOutputSessions(visibleOutputSessions.value.local)
}

function refreshVisibleOutputSessions() {
  syncVisibleOutputSessions()
  void nextTick(syncVisibleOutputSessions)
}

const workspaceCommandActions = useWorkspaceCommandActions({
  splitMode,
  splitEnabled,
  paneAssignments,
  activePaneId,
  maximizedPaneId,
  visibleSplitPaneIds,
  sshTabs: computed(() => store.tabs),
  activeSshSessionId: toRef(store, 'activeSessionId'),
  localSessions: computed(() => localTerminalStore.sessions),
  activeLocalSessionId: toRef(localTerminalStore, 'activeSessionId'),
  sshOutputActivityBySession: computed(() => store.outputActivityBySession),
  localOutputActivityBySession: computed(() => localTerminalStore.outputActivityBySession),
  sshOutputActivityLabel: (sessionId) => store.outputActivityLabel(sessionId),
  localOutputActivityLabel: (sessionId) => localTerminalStore.outputActivityLabel(sessionId),
  setSplitMode: (mode) => splitLayout.setSplitMode(mode),
  clearAllPanes: () => splitLayout.clearAllPanes(),
  togglePaneMaximize: (paneId) => splitLayout.togglePaneMaximize(paneId),
  restoreMaximizedPane: () => splitLayout.restoreMaximizedPane(),
  saveLayout: () => splitLayout.saveLayout(),
  refreshVisibleOutputSessions,
  bumpLayout,
  scheduleLayoutBump: (callback) => { void nextTick(callback) },
  activateSshSession: (sessionId) => store.activate(sessionId),
  activateLocalSession: (sessionId) => localTerminalStore.activate(sessionId),
  clearActiveWorkspace: () => store.clearActiveWorkspace(),
  clearSshOutputActivity: (sessionId) => store.clearOutputActivity(sessionId),
  clearLocalOutputActivity: (sessionId) => localTerminalStore.clearOutputActivity(sessionId),
  notify: (message, type) => emit('notify', message, type),
  confirmClearAllPanes: () => confirmDialog({
    title: '清空所有窗格',
    message: '这只会清空窗格布局，不会关闭 SSH 或本地终端。',
    confirmText: '清空窗格',
    cancelText: '取消',
  }),
  emitPaneAddServer: (paneId) => emit('paneAddServer', paneId),
  emitPaneConnectSaved: (paneId) => emit('paneConnectSaved', paneId),
  emitPaneOpenLocalTerminal: (paneId, shellKind) => emit('paneOpenLocalTerminal', paneId, shellKind),
})
const {
  selectorPaneId,
  menuPaneId,
  paneMenuMode,
  terminalSelectorOptions,
  sameAssignment,
  assignmentAvailable,
  activateAssignment,
  persistSplitLayout,
  assignmentActivityState,
  assignmentActivityLabel,
  assignmentActivityTitle,
  occupiedPaneOptions,
  emptyPaneOptions,
  sanitizePaneAssignments,
  handleSplitModeChange,
  handleSplitClearPanes,
  activatePane,
  assignToPane,
  assignSessionToPane,
  assignLocalSessionToPane,
  assignNewTerminalToFirstEmptyPane,
  assignNewLocalTerminalToFirstEmptyPane,
  clearPane,
  togglePaneMaximize,
  restoreMaximizedPane,
  openTerminalSelector,
  openReplacementSelector,
  addServerToPane,
  connectSavedToPane,
  openLocalTerminalToPane,
  selectConnectedToPane,
  selectTerminalForPane,
  togglePaneMenu,
  openPaneSwapMenu,
  openPaneMoveMenu,
  swapPaneAssignments,
  movePaneAssignment,
  clearPaneActivityFromMenu,
  togglePaneMaximizeFromMenu,
  closePaneOverlays,
} = workspaceCommandActions
const paneShellBindings = useWorkspacePaneShellBindings({
  paneAssignments,
  activePaneId,
  maximizedPaneId,
  paneDropTargetId,
  menuPaneId,
  paneMenuMode,
  sshTabs: computed(() => store.tabs),
  localSessions: computed(() => localTerminalStore.sessions),
  assignmentActivityState,
  assignmentActivityLabel,
  assignmentActivityTitle,
  occupiedPaneOptions,
  emptyPaneOptions,
  terminalView: {
    visible: computed(() => props.visible !== false),
    layoutRevision: revision,
    copyOnSelectEnabled: computed(() => props.terminalCopyOnSelectEnabled !== false),
    rightClickPasteEnabled: computed(() => props.terminalRightClickPasteEnabled !== false),
    shortcutSettings: computed(() => props.shortcutSettings),
    profileRevision: computed(() => props.terminalProfileApplyRevision ?? 0),
    defaultLocalProfile: effectiveDefaultProfile, platform: computed(() => props.localTerminalCapabilities?.platform ?? 'windows'),
    resolveConnection: connectionForTab,
    resolveProfile: profileForConnection,
  },
})
const {
  paneAssignment,
  paneTab,
  paneLocalSession,
  paneKind,
  paneShellBinding,
  sshTerminalViewProps,
  localTerminalViewProps,
} = paneShellBindings
const panelResizeFlow = useWorkspacePaneResizeFlow({
  rootRef: root,
  sidebarWidth,
  sftpHeight,
  persistSidebarWidth: (width) => localStorage.setItem('hostdeck.monitorSidebarWidth', String(width)),
  persistSftpHeight: (height) => localStorage.setItem('hostdeck.sftpHeight', String(height)),
  setSidebarCollapsed: setSidebarCollapsedFromSplitter,
  setSftpExpanded: setBottomPanelExpandedFromSplitter,
  bumpLayout,
  scheduleAfterStop: (callback) => { void nextTick(callback) },
})
const { startDrag } = panelResizeFlow

function visibleOutputSessionSignature() {
  return [visibleOutputSessions.value.ssh.join(','), visibleOutputSessions.value.local.join(',')].join('|')
}
const activePaneTab = computed(() =>
  activePaneAssignment.value?.kind === 'ssh' && activePaneSessionId.value
    ? store.tabs.find((tab) => tab.sessionId === activePaneSessionId.value) ?? null
    : null)
const activeCommandTab = computed(() => resolveActiveCommandTarget({
  splitEnabled: splitEnabled.value,
  activePaneAssignment: activePaneAssignment.value,
  sshTabs: store.tabs,
  activeSshTab: store.activeTab,
  localTerminalActive: localTerminalActive.value,
}))
const activeLocalCommandSession = computed(() => {
  if (splitEnabled.value && activePaneAssignment.value?.kind === 'local' && activePaneSessionId.value) {
    return localTerminalStore.sessions.find((session) => session.sessionId === activePaneSessionId.value) ?? null
  }
  return localTerminalActive.value ? localTerminalStore.activeSession : null
})
const activeWorkspaceConnection = computed(() => activeCommandTab.value ? connectionForTab(activeCommandTab.value.connectionId) : (!localTerminalActive.value && !splitEnabled.value ? props.connection : null))
const activeRemoteState = computed(() => activeWorkspaceConnection.value?.id ? props.connectionStates?.[activeWorkspaceConnection.value.id] ?? (props.connection?.id === activeWorkspaceConnection.value.id ? props.state : null) : null)
const activeRemoteSnapshot = computed(() => props.connection?.id === activeWorkspaceConnection.value?.id ? props.snapshot : null)
const hasRemoteStatusSummary = computed(() => Boolean(activeWorkspaceConnection.value || activeRemoteState.value || activeRemoteSnapshot.value))
const hasRecoveredRemoteMonitor = computed(() => activeCommandTab.value?.status === 'online' || activeRemoteState.value?.status === 'online' || activeRemoteSnapshot.value?.status === 'online')
const activeRemoteStatus = computed(() => hasRecoveredRemoteMonitor.value ? 'online' : activeRemoteState.value?.status ?? store.activeWorkspace?.status); const showRemoteStatusLabel = computed(() => !['connected', 'online'].includes(activeRemoteStatus.value ?? ''))
const quietMonitorSidebar = computed(() => !localTerminalActive.value && (!activeWorkspaceConnection.value || (Boolean(store.activeWorkspace) && !hasRecoveredRemoteMonitor.value && !['connected', 'connecting', 'reconnecting'].includes(store.activeWorkspace?.status ?? ''))))
const monitorSidebarProps = computed(() => quietMonitorSidebar.value ? { connection: null, state: null, snapshot: null, history: [], workspaceStatus: undefined } : { connection: activeWorkspaceConnection.value, state: activeRemoteState.value, snapshot: activeRemoteSnapshot.value, history: props.connection?.id === activeWorkspaceConnection.value?.id ? props.history : [], workspaceStatus: hasRecoveredRemoteMonitor.value ? 'connected' : store.activeWorkspace?.status })
const activeServerId = computed(() => activeCommandTab.value?.connectionId ?? activeWorkspaceConnection.value?.id ?? null)
const activeSftpTerminalSessionId = computed(() => activeCommandTab.value?.sessionId ?? '')
const latestTransfer = computed(() => sftpStore.lastTransfer(activeServerId.value, activeSftpContextId.value))
const activeTunnelCount = computed(() => tunnelStore.runningCount(activeServerId.value))
const visibleTransferRows = computed(() =>
  buildTransferRows(sftpStore.transfersFor(activeServerId.value, transferScope.value, activeSftpContextId.value)))
const hasActiveTerminal = computed(() => {
  const local = activeLocalCommandSession.value
  if (local) return isLocalCommandTerminalReady(local)
  return !localTerminalActive.value && Boolean(activeCommandTab.value?.status === 'online')
})
const commandPaletteConnection = computed(() =>
  activeLocalCommandSession.value ? localCommandConnection(activeLocalCommandSession.value) : props.connection)
const transferActions = useWorkspaceTransferActions({
  cancelTransfer: (transferId) => sftpStore.cancelTransfer(transferId),
  pauseTransfer: (transferId) => sftpStore.pauseTransfer(transferId),
  resumeTransfer: (transferId) => sftpStore.resumeTransfer(transferId),
  clearCompleted: (connectionId, contextId) => sftpStore.clearCompleted(connectionId, contextId),
  clearCompletedAll: () => sftpStore.clearCompletedAll(),
  activeServerId: () => activeServerId.value,
  activeSftpContextId: () => activeSftpContextId.value,
  transferScope: () => transferScope.value,
  notify: (message, type) => emit('notify', message, type),
  errorMessage,
})
const {
  cancelTransfer,
  resumeTransfer,
  toggleTransferPause,
  clearFinishedTransfers,
} = transferActions
const commandPaletteFlow = useWorkspaceCommandPaletteFlow({
  getActiveCommandTarget: () => {
    const local = activeLocalCommandSession.value
    if (local) return localCommandTarget(local)
    return activeCommandTab.value
      ? {
          kind: 'ssh',
          sessionId: activeCommandTab.value.sessionId,
          connectionId: activeCommandTab.value.connectionId,
          status: activeCommandTab.value.status,
        }
      : null
  },
  writeTerminal: (sessionId, dataBase64, target) =>
    target.kind === 'local'
      ? api.writeLocalTerminal(sessionId, dataBase64)
      : api.writeTerminal(sessionId, dataBase64),
  observeTerminalInput: observeTerminalInstanceInput,
  recordHistory: ({ kind, connectionId, sessionId, command, localHistoryScope }) =>
    kind === 'local'
      ? commandStore.recordLocalHistory(localHistoryScope ?? 'local:cmd', sessionId, command, props.commandHistoryMaxEntries ?? 2000)
      : commandStore.recordHistory(connectionId, sessionId, command),
  notify: (message, type) => emit('notify', message, type),
  recordHistoryFailure: (command, reason) =>
    console.error('Unable to record command history', String(reason).replace(command, '[command]')),
})
const { commandPaletteOpen, commandPaletteTab, openCommandPalette, closeCommandPalette, writeCommand } = commandPaletteFlow
const {
  buttonRef: commandButtonRef,
  buttonStyle: commandButtonStyle,
  dragging: commandButtonDragging,
  onPointerDown: startCommandButtonDrag,
  consumeClickAfterDrag: consumeCommandButtonClickAfterDrag,
  cleanup: cleanupCommandButtonDock,
} = useDockedCommandButton(terminalStage, revision)

function handleCommandButtonClick() {
  if (consumeCommandButtonClickAfterDrag()) return
  openCommandPalette('history')
}

function recordLocalTerminalCommand(sessionId: string, command: string) {
  const session = localTerminalStore.sessions.find((item) => item.sessionId === sessionId)
  if (!session) return
  void commandStore.recordLocalHistory(localCommandHistoryScope(session), sessionId, command, props.commandHistoryMaxEntries ?? 2000)
    .catch((reason) => console.error('Unable to record command history', String(reason).replace(command, '[command]')))
}

function connectionForTab(connectionId: number) {
  return props.connections?.find((item) => item.id === connectionId)
    ?? (props.connection?.id === connectionId ? props.connection : null)
}

function resetSplitRatios() {
  if (splitMode.value === 'single') return
  splitLayout.resetSplitRatios()
  bumpLayout()
}

function handleSplitRatioReset() {
  resetSplitRatios()
}

function focusAllowsGlobalEscape() {
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) return true
  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || element.isContentEditable) return false
  if (element.closest('.xterm, .terminal-view, .local-terminal-view, .remote-text-editor, .sftp-editor')) return false
  return true
}

function handleExternalTabDrop(event: Event) {
  if (!splitEnabled.value || !(event instanceof CustomEvent)) return
  const detail = event.detail as ExternalTabDropDetail
  const paneId = paneDragDrop.paneIdAtPoint(detail.clientX, detail.clientY)
  if (!paneId || !visibleSplitPaneIds.value.includes(paneId)) return
  if (detail.kind === 'terminal' && detail.sessionId && assignSessionToPane(detail.sessionId, paneId)) {
    event.preventDefault()
  } else if (detail.kind === 'local' && detail.localSessionId && assignLocalSessionToPane(detail.localSessionId, paneId)) {
    event.preventDefault()
  }
}

function startPaneDrag(paneId: SplitPaneId, event: PointerEvent) {
  paneDragDrop.startPaneDrag(paneId, paneAssignment(paneId), event)
}

function profileForConnection(connection: Connection | null) {
  const overrideId = connection?.terminalProfileId?.trim()
  if (overrideId) {
    return props.terminalProfiles?.find((profile) => profile.id === overrideId)
      ?? effectiveDefaultProfile.value
  }
  return effectiveDefaultProfile.value
}

function reconnectWorkspace(workspace: ServerWorkspace, tab: TerminalSessionInfo | null) {
  if (tab) emit('reconnect', tab.sessionId, tab.connectionId, tab.code)
  else emit('connectWorkspace', workspace.serverId)
}

function workspaceForTab(tab: TerminalSessionInfo | null) {
  if (!tab || tab.status === 'online') return null
  const status: ServerWorkspace['status'] = tab.status === 'error'
    ? 'failed'
    : tab.status === 'connecting' ? 'connecting' : 'disconnected'
  return {
    serverId: tab.connectionId,
    serverName: connectionForTab(tab.connectionId)?.name ?? tab.title,
    status,
    message: tab.connectionError?.userMessage || tab.message || '连接失败',
    error: tab.connectionError,
    updatedAt: '',
  } satisfies ServerWorkspace
}

function bumpLayout() {
  internalRevision.value += 1
}

function setSidebarCollapsedFromSplitter(nextCollapsed: boolean) {
  sidebarCollapsed.value = nextCollapsed
  if (!nextCollapsed) {
    autoCollapsed.value = false
    autoCollapseDismissed.value = true
  }
  localStorage.setItem('hostdeck.monitorSidebarCollapsed', String(sidebarCollapsed.value))
}

function restoreMonitorSidebar() {
  sidebarCollapsed.value = false
  autoCollapsed.value = false
  autoCollapseDismissed.value = true
  localStorage.setItem('hostdeck.monitorSidebarCollapsed', 'false')
  bumpLayout()
}

function setBottomPanelExpandedFromSplitter(nextExpanded: boolean) {
  sftpExpanded.value = nextExpanded
  localStorage.setItem('hostdeck.sftpExpanded', String(sftpExpanded.value))
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

async function closeTerminalSession(sessionId: string) {
  const tab = store.tabs.find((candidate) => candidate.sessionId === sessionId)
  const removedPaneIds = ALL_SPLIT_PANE_IDS.filter((paneId) =>
    sameAssignment(paneAssignments.value[paneId], { kind: 'ssh', sessionId }))
  const result = removeSessionFromPaneAssignments(paneAssignments.value, { kind: 'ssh', sessionId })
  if (result.changed) paneAssignments.value = result.assignments
  for (const paneId of removedPaneIds) {
    if (maximizedPaneId.value === paneId) maximizedPaneId.value = null
    if (selectorPaneId.value === paneId) selectorPaneId.value = null
    if (menuPaneId.value === paneId) menuPaneId.value = null
    if (menuPaneId.value === null) paneMenuMode.value = 'main'
  }
  persistSplitLayout()
  if (tab && (store.sessionsByServerId[tab.connectionId] ?? []).length <= 1) {
    store.removeWorkspaceLocal(tab.connectionId)
    emit('finalTerminalDisconnect', tab.connectionId)
    return
  }
  try {
    if (tab) await sftpStore.closeContextForTerminal(tab.connectionId, sessionId)
    await store.closeSession(sessionId)
  } catch (reason) {
    emit('notify', errorMessage(reason, '关闭当前终端失败'), 'error')
  }
}

function handleWorkspaceKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (selectorPaneId.value || menuPaneId.value) {
    selectorPaneId.value = null
    menuPaneId.value = null
    paneMenuMode.value = 'main'
    return
  }
  if (closeTransferPopoverOnEscape(event)) return
  if (maximizedPaneId.value && focusAllowsGlobalEscape()) {
    restoreMaximizedPane()
  }
}

function toggleSFTP() {
  sftpExpanded.value = !sftpExpanded.value
  localStorage.setItem('hostdeck.sftpExpanded', String(sftpExpanded.value))
  void nextTick(bumpLayout)
}

function toggleBottomPanel() {
  toggleSFTP()
}

watch(
  () => ({
    local: localTerminalActive.value,
    sessionId: activeCommandTab.value?.sessionId ?? null,
    connectionId: activeCommandTab.value?.connectionId ?? activeServerId.value,
  }),
  (value) => {
    if (value.local || !value.connectionId) {
      activeSftpContextId.value = null
      return
    }
    activeSftpContextId.value = sftpStore.activateContextForTerminal(value.connectionId, value.sessionId)
  },
  { immediate: true },
)

watch(
  () => Object.values(sftpStore.transfersById).map((transfer) => ({
    id: transfer.id,
    connectionId: transfer.connectionId,
    contextId: transfer.contextId,
    direction: transfer.direction,
    recursive: transfer.recursive,
    sourceType: transfer.sourceType,
    status: transfer.status,
    failedCount: transfer.failedCount,
    skippedCount: transfer.skippedCount,
    errorMessage: transfer.errorMessage,
  })),
  (transfers) => {
    const ids = new Set(transfers.map((transfer) => transfer.id))
    for (const key of Array.from(notifiedTransferStatuses.keys())) {
      if (!ids.has(key)) notifiedTransferStatuses.delete(key)
    }
    for (const transfer of transfers) {
      if (notifiedTransferStatuses.get(transfer.id) === transfer.status) continue
      notifiedTransferStatuses.set(transfer.id, transfer.status)
      if (!isTerminalTransferStatus(transfer.status) || !transferMatchesContext(transfer, activeServerId.value, activeSftpContextId.value)) continue
      emit('notify', transferTerminalMessage(transfer), transferTerminalToastType(transfer.status))
    }
  },
)

watch(() => props.sftpOpenRevision, () => {
  if (!props.sftpOpenRevision) return
  sftpExpanded.value = true
  localStorage.setItem('hostdeck.sftpExpanded', 'true')
  void nextTick(bumpLayout)
})

watch(() => props.visible, () => {
  refreshVisibleOutputSessions()
})

watch(
  () => props.paneTargetAssignment,
  (target) => {
    if (!target || target.requestId === lastPaneTargetAssignmentRequestId) return
    lastPaneTargetAssignmentRequestId = target.requestId
    if (!isSplitPaneId(target.paneId) || !visibleSplitPaneIds.value.includes(target.paneId)) return
    const sessionId = target.sessionId.trim()
    if (!sessionId) return
    assignToPane({ kind: target.kind, sessionId }, target.paneId)
  },
  { immediate: true },
)

watch(
  () => store.tabs.map((tab) => tab.sessionId),
  (sessionIds, previousSessionIds) => {
    const newSessionIds = previousSessionIds
      ? sessionIds.filter((sessionId) => !knownTerminalSessionIds.has(sessionId))
      : []
    sanitizePaneAssignments(false)
    for (const sessionId of newSessionIds) {
      assignNewTerminalToFirstEmptyPane(sessionId)
    }
    knownTerminalSessionIds = new Set(sessionIds)
  },
  { immediate: true },
)

watch(
  () => localTerminalStore.sessions.map((session) => session.sessionId),
  (sessionIds, previousSessionIds) => {
    const newSessionIds = previousSessionIds
      ? sessionIds.filter((sessionId) => !knownLocalSessionIds.has(sessionId))
      : []
    sanitizePaneAssignments(false)
    for (const sessionId of newSessionIds) {
      assignNewLocalTerminalToFirstEmptyPane(sessionId)
    }
    knownLocalSessionIds = new Set(sessionIds)
  },
  { immediate: true },
)

watch(
  visibleOutputSessionSignature,
  () => syncVisibleOutputSessions(),
  { immediate: true, flush: 'post' },
)

watch(() => store.activeSessionId, (sessionId) => {
  if (!splitEnabled.value || !sessionId) {
    refreshVisibleOutputSessions()
    return
  }
  const intent = resolveTopTabPaneIntent({
    splitEnabled: splitEnabled.value,
    visiblePaneIds: visibleSplitPaneIds.value,
    paneAssignments: paneAssignments.value,
    activePaneId: activePaneId.value,
    assignment: { kind: 'ssh', sessionId },
  })
  if (intent.type === 'activate-pane') {
    activePaneId.value = intent.paneId
    persistSplitLayout()
    refreshVisibleOutputSessions()
    void nextTick(bumpLayout)
    return
  }
  refreshVisibleOutputSessions()
})

watch(() => localTerminalStore.activeSessionId, (sessionId) => {
  if (!splitEnabled.value || !sessionId) {
    refreshVisibleOutputSessions()
    return
  }
  const intent = resolveTopTabPaneIntent({
    splitEnabled: splitEnabled.value,
    visiblePaneIds: visibleSplitPaneIds.value,
    paneAssignments: paneAssignments.value,
    activePaneId: activePaneId.value,
    assignment: { kind: 'local', sessionId },
  })
  if (intent.type === 'activate-pane') {
    activePaneId.value = intent.paneId
    persistSplitLayout()
    refreshVisibleOutputSessions()
    void nextTick(bumpLayout)
    return
  }
  refreshVisibleOutputSessions()
})

onMounted(() => {
  rootObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0
    if (width >= 900) autoCollapseDismissed.value = false
    autoCollapsed.value = width > 0 && width < 900 && !autoCollapseDismissed.value
    bumpLayout()
    updateTransferPopoverPosition()
  })
  if (root.value) rootObserver.observe(root.value)
  window.addEventListener('pointerdown', closeTransferPopoverFromOutside, true)
  window.addEventListener('pointerdown', closePaneOverlays, true)
  window.addEventListener('keydown', handleWorkspaceKeydown, true)
  window.addEventListener('resize', updateTransferPopoverPosition)
  window.addEventListener('hostdeck:workspace-tab-external-drop', handleExternalTabDrop)
  window.addEventListener('hostdeck:workspace-split-mode-change', handleSplitModeChange)
  window.addEventListener('hostdeck:workspace-split-ratio-reset', handleSplitRatioReset)
  window.addEventListener('hostdeck:workspace-split-clear-panes', handleSplitClearPanes)
  refreshVisibleOutputSessions()
})

onBeforeUnmount(() => {
  rootObserver?.disconnect()
  store.setVisibleOutputSessions([])
  localTerminalStore.setVisibleOutputSessions([])
  panelResizeFlow.dispose()
  cleanupCommandButtonDock()
  paneDragDrop.cleanupPaneDrag()
  paneResizeBridge.cleanupSplitResize()
  window.removeEventListener('pointerdown', closeTransferPopoverFromOutside, true)
  window.removeEventListener('pointerdown', closePaneOverlays, true)
  window.removeEventListener('keydown', handleWorkspaceKeydown, true)
  window.removeEventListener('resize', updateTransferPopoverPosition)
  window.removeEventListener('hostdeck:workspace-tab-external-drop', handleExternalTabDrop)
  window.removeEventListener('hostdeck:workspace-split-mode-change', handleSplitModeChange)
  window.removeEventListener('hostdeck:workspace-split-ratio-reset', handleSplitRatioReset)
  window.removeEventListener('hostdeck:workspace-split-clear-panes', handleSplitClearPanes)
})
</script>

<template>
  <section ref="root" class="workspace-shell" :class="{ 'sidebar-collapsed': collapsed }" :style="shellStyle">
    <CompactMonitorSidebar
      v-if="!collapsed && !localTerminalActive"
      v-bind="monitorSidebarProps"
      :network-interfaces="networkInterfaces"
      :network-preference="networkInterfacePreference"
      :network-interfaces-loading="networkInterfacesLoading"
      @layout="bumpLayout"
      @process="(pid) => emit('processManager', pid)"
      @network-interface="(mode, selected) => emit('networkInterface', mode, selected)"
      @network-diagnostics="emit('networkDiagnostics')"
      @network-interfaces-refresh="emit('networkInterfacesRefresh')"
      @collapse="setSidebarCollapsedFromSplitter(true)"
    />
    <LocalMonitorSidebar
      v-else-if="!collapsed && localTerminalActive"
      :session="localTerminalStore.activeSession"
      @collapse="setSidebarCollapsedFromSplitter(true)"
    />
    <div
      class="vertical-splitter"
      aria-label="Drag to resize or hide monitor sidebar"
      @pointerdown="startDrag('sidebar', $event)"
    ></div>
    <slot name="tabs"></slot>
    <button v-if="collapsed" class="sidebar-restore-button" type="button" aria-label="显示监控侧栏" title="显示监控侧栏" @click="restoreMonitorSidebar">
      <AppIcon name="gauge" :size="15" />
    </button>
    <section class="right-workspace" :class="{ 'bottom-panel-collapsed': !bottomPanelExpanded }" :style="rightStyle">
      <div ref="terminalStage" class="terminal-stage">
        <TerminalSplitWorkspace
          v-if="splitEnabled"
          :split-mode="splitMode"
          :rendered-pane-ids="renderedSplitPaneIds"
          :maximized-pane-id="maximizedPaneId"
          :column-ratio="splitColumnRatio"
          :row-ratio="splitRowRatio"
          :show-column-splitter="showColumnSplitter"
          :show-row-splitter="showRowSplitter"
          @splitter-drag-start="paneResizeBridge.startSplitResize"
        >
          <template #pane="{ paneId, paneStyle }">
          <TerminalPane v-bind="paneShellBinding(paneId, paneStyle)" :local-terminal-capabilities="localTerminalCapabilities"
            @pane-click="activatePane"
            @drag-start="startPaneDrag"
            @toggle-menu="togglePaneMenu"
            @clear-pane="clearPane"
            @toggle-maximize="togglePaneMaximize"
            @add-server="addServerToPane"
            @connect-saved="connectSavedToPane"
            @select-connected="paneKind($event) ? selectConnectedToPane($event) : openTerminalSelector($event)"
            @new-local="openLocalTerminalToPane"
            @replace-terminal="openReplacementSelector"
            @clear-activity="clearPaneActivityFromMenu"
            @open-swap-menu="openPaneSwapMenu"
            @swap-pane="swapPaneAssignments"
            @open-move-menu="openPaneMoveMenu"
            @move-pane="movePaneAssignment"
          >
            <template #ssh>
              <TerminalView
                v-if="paneTab(paneId)"
                :key="paneTab(paneId)!.sessionId"
                v-bind="sshTerminalViewProps(paneTab(paneId)!, activePaneId === paneId)"
                @commands="openCommandPalette"
                @command-skip="(message) => emit('notify', message, 'info')"
                @close="closeTerminalSession(paneTab(paneId)!.sessionId)"
              />
              <WorkspaceStatePanel
                v-if="workspaceForTab(paneTab(paneId))"
                :workspace="workspaceForTab(paneTab(paneId))!"
                :tab="paneTab(paneId)"
                compact
                :show-message="false"
                :show-technical="false"
                @reconnect="reconnectWorkspace"
                @trust-host-key="emit('trustHostKey', $event)"
                @edit-workspace="emit('editWorkspace', $event)"
                @disconnect-server="emit('disconnectServer', $event)"
              />
            </template>
            <template #local>
              <LocalTerminalView
                v-if="paneLocalSession(paneId)"
                :key="paneLocalSession(paneId)!.sessionId"
                v-bind="localTerminalViewProps(paneLocalSession(paneId)!, activePaneId === paneId)"
                @notify="(message, type) => emit('notify', message, type)"
                @command="recordLocalTerminalCommand"
              />
            </template>
            <template #selector>
              <TerminalPaneSelector
                v-if="selectorPaneId === paneId && terminalSelectorOptions.length"
                :options="terminalSelectorOptions"
                :selected-assignment="paneAssignments[paneId]"
                @select="selectTerminalForPane($event, paneId)"
              />
            </template>
          </TerminalPane>
          </template>
        </TerminalSplitWorkspace>
        <div v-if="!splitEnabled && !localTerminalActive && !store.activeWorkspace" class="terminal-empty">
          <TerminalEmptyPane
            :show-drop-message="false"
            @add-server="addServerToPane('pane-1')"
            @connect-saved="connectSavedToPane('pane-1')"
           />
          <TerminalPaneSelector
            v-if="selectorPaneId === 'pane-1' && terminalSelectorOptions.length"
            class="terminal-pane-selector single-terminal-selector"
            :options="terminalSelectorOptions"
            :selected-assignment="paneAssignments['pane-1']"
            @select="selectTerminalForPane($event, 'pane-1')"
          />
        </div>
        <template v-if="!splitEnabled">
          <LocalTerminalView
            v-for="session in localTerminalStore.sessions"
            v-show="session.sessionId === localTerminalStore.activeSessionId"
            :key="session.sessionId"
            v-bind="localTerminalViewProps(session, session.sessionId === localTerminalStore.activeSessionId)"
            @notify="(message, type) => emit('notify', message, type)"
            @command="recordLocalTerminalCommand"
          />
        </template>
        <template v-if="!splitEnabled">
          <TerminalView
            v-for="tab in store.tabs"
            v-show="!localTerminalActive && tab.sessionId === store.activeSessionId"
            :key="tab.sessionId"
            v-bind="sshTerminalViewProps(tab, tab.sessionId === store.activeSessionId)"
            @commands="openCommandPalette"
            @command-skip="(message) => emit('notify', message, 'info')"
            @close="closeTerminalSession(tab.sessionId)"
          />
        </template>
        <WorkspaceStatePanel
          v-if="!splitEnabled && !localTerminalActive && store.activeWorkspace && (!store.activeTab || store.activeTab.status !== 'online')"
          :workspace="store.activeWorkspace"
          :tab="store.activeTab"
          @reconnect="reconnectWorkspace"
          @trust-host-key="emit('trustHostKey', $event)"
          @edit-workspace="emit('editWorkspace', $event)"
          @disconnect-server="emit('disconnectServer', $event)"
        />
        <button
          v-if="activeLocalCommandSession || (!localTerminalActive && (splitEnabled || store.activeWorkspace))"
          ref="commandButtonRef"
          class="terminal-command-button"
          :class="{ dragging: commandButtonDragging }"
          :style="commandButtonStyle"
          type="button"
          :disabled="!hasActiveTerminal"
          @pointerdown="startCommandButtonDrag"
          @click="handleCommandButtonClick"
        >命令</button>
      </div>
      <div
        class="horizontal-splitter"
        :aria-label="`Drag to resize or hide ${bottomPanelLabel}`"
        @pointerdown="startDrag('sftp', $event)"
      ></div>
      <SftpPanel
        v-if="!localTerminalActive"
        :connection="activeWorkspaceConnection"
        :expanded="bottomPanelExpanded"
        :context-id="activeSftpContextId"
        :terminal-session-id="activeSftpTerminalSessionId"
        @toggle="toggleSFTP"
        @connect="emit('openSftp', $event)"
        @reconnect="(connectionId, contextId, terminalSessionId) => emit('reconnectSftp', connectionId, contextId, terminalSessionId)"
        @notify="(message, type) => emit('notify', message, type)"
      />
      <LocalExplorerPanel
        v-else
        :expanded="bottomPanelExpanded"
        :initial-path="localTerminalStore.activeSession?.cwd"
        @toggle="toggleBottomPanel"
        @notify="(message, type) => emit('notify', message, type)"
      />
      <div class="terminal-statusbar">
        <button v-if="!localTerminalActive" class="status-sftp-toggle" data-testid="status-sftp-toggle" type="button" :aria-label="bottomPanelExpanded ? 'Hide SFTP panel' : 'Show SFTP panel'" :aria-pressed="bottomPanelExpanded" :title="bottomPanelExpanded ? 'Hide SFTP panel' : 'Show SFTP panel'" @click.stop="toggleSFTP"><AppIcon :name="bottomPanelExpanded ? 'chevron-down' : 'chevron-up'" :size="13" /></button>
        <button v-if="localTerminalActive" class="status-monitor-region">
          <span>本地终端</span>
          <span>{{ localTerminalStore.activeSession?.shell || 'Shell' }}</span>
          <span>{{ localStatusLabel(localTerminalStore.activeSession?.status) }}</span>
          <span>{{ localTerminalStore.activeSession?.cwd || '—' }}</span>
        </button>
        <button v-else class="status-monitor-region" @click="emit('monitor')">
          <span class="status-server-name">{{ activeWorkspaceConnection?.name ?? '未连接服务器' }}</span>
          <span v-if="hasRemoteStatusSummary && showRemoteStatusLabel" class="status-connection-state">{{ statusLabel(activeRemoteStatus) }}</span>
          <span v-if="hasRemoteStatusSummary" class="status-latency">延迟 {{ snapshot?.latencyAvailable ? `${snapshot.latencyMillis} ms` : '—' }}</span>
          <span v-if="hasRemoteStatusSummary" class="status-rate">↓ {{ formatRate(snapshot?.downloadBytesPerSecond ?? null) }}</span>
          <span v-if="hasRemoteStatusSummary" class="status-rate">↑ {{ formatRate(snapshot?.uploadBytesPerSecond ?? null) }}</span>
        </button>
        <div class="status-transfer-wrap">
          <button ref="transferButton" class="status-transfer" :title="transferSummary(latestTransfer)" @click.stop="openTransferPopover">
            {{ transferSummary(latestTransfer) }}
          </button>
          <button
            v-if="latestTransfer && canResumeTransfer(latestTransfer)"
            class="text-button status-transfer-action"
            type="button"
            @click.stop="resumeTransfer(latestTransfer)"
          >继续</button>
          <button class="status-tunnel" type="button" @click.stop="emit('openTunnels')">
            隧道 {{ activeTunnelCount }}
          </button>
          <button class="status-alert" type="button" @click.stop="emit('alerts')">
            告警 {{ alertActiveCount ?? 0 }}
          </button>
          <Teleport to="body">
            <div v-if="transferPopover" class="viewport-popover transfer-popover" :style="transferPopoverStyle" @click.stop>
              <header>
                <strong>传输队列</strong>
                <div class="transfer-popover-actions transfer-popover-tabs">
                  <button :class="{ active: transferScope === 'current' }" @click="transferScope = 'current'">当前服务器</button>
                  <span class="transfer-popover-action-separator" aria-hidden="true">|</span>
                  <button :class="{ active: transferScope === 'all' }" @click="transferScope = 'all'">全部服务器</button>
                </div>
              </header>
              <div class="transfer-popover-list">
                <div v-if="visibleTransferRows.length === 0" class="transfer-empty">暂无传输</div>
                <article v-for="row in visibleTransferRows" :key="row.id" class="transfer-popover-row">
                  <span>{{ row.leadingText }}</span>
                  <strong :title="row.title">{{ row.title }}</strong>
                  <progress max="100" :value="row.percentValue"></progress>
                  <span>{{ row.statusText }}</span>
                  <span>{{ row.percentText }}</span>
                  <span>{{ row.detailText }}</span>
                  <button
                    v-if="row.showPauseAction"
                    class="text-button"
                    :disabled="row.pauseDisabled"
                    @click="toggleTransferPause(row.transfer)"
                  >{{ row.pauseActionLabel }}</button>
                  <button class="text-button" :disabled="!row.canCancel" @click="cancelTransfer(row.transfer)">取消</button>
                  <small v-if="row.recursiveStatsText">{{ row.recursiveStatsText }}</small>
                  <small v-if="row.errorMessage" :title="row.errorMessage">{{ row.errorMessage }}</small>
                </article>
              </div>
              <AppActionBar as="footer" class="transfer-popover-actions">
                <button class="text-button" @click="clearFinishedTransfers">清除已完成</button>
                <span class="transfer-popover-action-separator" aria-hidden="true">|</span><button class="text-button" @click="closeTransferPopover">关闭</button>
              </AppActionBar>
            </div>
          </Teleport>
        </div>
      </div>
    </section>
    <CommandPalette
      :open="commandPaletteOpen"
      :initial-tab="commandPaletteTab"
      :connection="commandPaletteConnection"
      :has-active-terminal="hasActiveTerminal"
      :history-max-entries="commandHistoryMaxEntries ?? 2000"
      :connections="connections ?? []"
      :connection-states="connectionStates ?? {}"
      @close="closeCommandPalette"
      @insert="(command) => writeCommand(command, false)"
      @execute="(command) => writeCommand(command, true)"
      @notify="(message, type) => emit('notify', message, type)"
    />
  </section>
</template>
