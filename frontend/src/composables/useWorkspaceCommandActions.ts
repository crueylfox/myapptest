import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { LocalTerminalState, TerminalSessionInfo } from '../types'
import {
  ALL_SPLIT_PANE_IDS,
  isSplitMode,
  type PaneAssignment,
  type PaneAssignments,
  type SplitMode,
  type SplitPaneId,
} from '../utils/workspaceSplitTypes'
import {
  assignPaneAssignment,
  assignmentKey,
  autoFillPaneAssignment,
  clearPaneAssignment,
  dropStalePaneAssignments,
  movePaneAssignment as movePaneAssignmentState,
  samePaneAssignment,
  swapPaneAssignments as swapPaneAssignmentsState,
} from './usePaneAssignments'
import {
  buildEmptyPaneOptions,
  buildOccupiedPaneOptions,
  buildTerminalSelectorOptions,
  paneActivityTitle,
  paneAssignmentTitle,
  type PaneMenuMode,
} from './workspaceCommandModel'

type MaybeReadonlyRef<T> = Ref<T> | ComputedRef<T>
type NotifyType = 'success' | 'error' | 'info'

export type WorkspaceCommandActionsOptions = {
  splitMode: Ref<SplitMode>
  splitEnabled: MaybeReadonlyRef<boolean>
  paneAssignments: Ref<PaneAssignments>
  activePaneId: Ref<SplitPaneId>
  maximizedPaneId: Ref<SplitPaneId | null>
  visibleSplitPaneIds: MaybeReadonlyRef<SplitPaneId[]>
  sshTabs: MaybeReadonlyRef<TerminalSessionInfo[]>
  localSessions: MaybeReadonlyRef<LocalTerminalState[]>
  activeSshSessionId: MaybeReadonlyRef<string | null>
  activeLocalSessionId: MaybeReadonlyRef<string | null>
  sshOutputActivityBySession: MaybeReadonlyRef<Record<string, { hasActivity?: boolean } | undefined>>
  localOutputActivityBySession: MaybeReadonlyRef<Record<string, { hasActivity?: boolean } | undefined>>
  sshOutputActivityLabel: (sessionId: string) => string
  localOutputActivityLabel: (sessionId: string) => string
  setSplitMode: (mode: SplitMode) => void
  clearAllPanes: () => void
  togglePaneMaximize: (paneId: SplitPaneId) => void
  restoreMaximizedPane: () => void
  saveLayout: () => void
  refreshVisibleOutputSessions: () => void
  bumpLayout: () => void
  scheduleLayoutBump: (callback: () => void) => void
  activateSshSession: (sessionId: string) => void
  activateLocalSession: (sessionId: string) => void
  clearActiveWorkspace: () => void
  clearSshOutputActivity: (sessionId: string) => void
  clearLocalOutputActivity: (sessionId: string) => void
  notify: (message: string, type: NotifyType) => void
  confirmClearAllPanes?: () => Promise<boolean>
  emitPaneAddServer: (paneId: SplitPaneId) => void
  emitPaneConnectSaved: (paneId: SplitPaneId) => void
  emitPaneOpenLocalTerminal: (paneId: SplitPaneId, shellKind: 'cmd' | 'powershell') => void
}

export function useWorkspaceCommandActions(options: WorkspaceCommandActionsOptions) {
  const selectorPaneId = ref<SplitPaneId | null>(null)
  const menuPaneId = ref<SplitPaneId | null>(null)
  const paneMenuMode = ref<PaneMenuMode>('main')
  const terminalSelectorOptions = computed(() => buildTerminalSelectorOptions(options.sshTabs.value, options.localSessions.value))

  function getAvailableConnectedTabsForPaneSelector() {
    return terminalSelectorOptions.value
  }

  function sameAssignment(left: PaneAssignment | null, right: PaneAssignment) {
    return samePaneAssignment(left, right)
  }

  function assignmentAvailable(assignment: PaneAssignment) {
    if (assignment.kind === 'ssh') return options.sshTabs.value.some((tab) => tab.sessionId === assignment.sessionId)
    return options.localSessions.value.some((session) => session.sessionId === assignment.sessionId)
  }

  function activateAssignment(assignment: PaneAssignment | null) {
    if (!assignment) return
    if (assignment.kind === 'ssh') {
      setWritableRef(options.activeLocalSessionId, null)
      options.activateSshSession(assignment.sessionId)
      return
    }
    options.clearActiveWorkspace()
    options.activateLocalSession(assignment.sessionId)
  }

  function persistSplitLayout() {
    options.saveLayout()
  }

  function closePaneCommandOverlays() {
    selectorPaneId.value = null
    menuPaneId.value = null
    paneMenuMode.value = 'main'
  }

  function assignmentActivityState(assignment: PaneAssignment | null) {
    if (!assignment) return undefined
    if (assignment.kind === 'ssh') return options.sshOutputActivityBySession.value[assignment.sessionId]
    return options.localOutputActivityBySession.value[assignment.sessionId]
  }

  function assignmentActivityLabel(assignment: PaneAssignment | null) {
    if (!assignment) return ''
    if (assignment.kind === 'ssh') return options.sshOutputActivityLabel(assignment.sessionId)
    return options.localOutputActivityLabel(assignment.sessionId)
  }

  function assignmentActivityTitle(assignment: PaneAssignment | null) {
    return paneActivityTitle(assignmentActivityLabel(assignment))
  }

  function clearAssignmentActivity(assignment: PaneAssignment | null) {
    if (!assignment) return
    if (assignment.kind === 'ssh') {
      options.clearSshOutputActivity(assignment.sessionId)
      return
    }
    options.clearLocalOutputActivity(assignment.sessionId)
  }

  function occupiedPaneOptions(sourcePaneId: SplitPaneId) {
    return buildOccupiedPaneOptions({
      sourcePaneId,
      visiblePaneIds: options.visibleSplitPaneIds.value,
      paneAssignments: options.paneAssignments.value,
      splitMode: options.splitMode.value,
      assignmentAvailable,
      assignmentTitle: (assignment) => paneAssignmentTitle(assignment, options.sshTabs.value, options.localSessions.value),
    })
  }

  function emptyPaneOptions(sourcePaneId: SplitPaneId) {
    return buildEmptyPaneOptions({
      sourcePaneId,
      visiblePaneIds: options.visibleSplitPaneIds.value,
      paneAssignments: options.paneAssignments.value,
      splitMode: options.splitMode.value,
    })
  }

  function sanitizePaneAssignments(fillEmpty = false) {
    const staleResult = dropStalePaneAssignments(options.paneAssignments.value, assignmentAvailable)
    const used = new Set<string>()
    const next = staleResult.assignments
    for (const paneId of ALL_SPLIT_PANE_IDS) {
      const assignment = next[paneId]
      if (assignment) used.add(assignmentKey(assignment))
    }
    if (fillEmpty && options.splitMode.value !== 'single') {
      const candidates: PaneAssignment[] = [
        ...options.sshTabs.value
          .filter((tab) => tab.sessionId === options.activeSshSessionId.value)
          .map((tab) => ({ kind: 'ssh' as const, sessionId: tab.sessionId })),
        ...options.localSessions.value
          .filter((session) => session.sessionId === options.activeLocalSessionId.value)
          .map((session) => ({ kind: 'local' as const, sessionId: session.sessionId })),
        ...options.sshTabs.value
          .filter((tab) => tab.sessionId !== options.activeSshSessionId.value)
          .map((tab) => ({ kind: 'ssh' as const, sessionId: tab.sessionId })),
        ...options.localSessions.value
          .filter((session) => session.sessionId !== options.activeLocalSessionId.value)
          .map((session) => ({ kind: 'local' as const, sessionId: session.sessionId })),
      ]
      for (const paneId of options.visibleSplitPaneIds.value) {
        if (next[paneId]) continue
        const candidate = candidates.find((item) => !used.has(assignmentKey(item)))
        if (!candidate) break
        next[paneId] = candidate
        used.add(assignmentKey(candidate))
      }
    }
    options.paneAssignments.value = next
    if (!options.visibleSplitPaneIds.value.includes(options.activePaneId.value)) options.activePaneId.value = 'pane-1'
    if (options.maximizedPaneId.value && (!options.visibleSplitPaneIds.value.includes(options.maximizedPaneId.value) || !next[options.maximizedPaneId.value])) {
      options.maximizedPaneId.value = null
    }
    if (selectorPaneId.value && !options.visibleSplitPaneIds.value.includes(selectorPaneId.value)) selectorPaneId.value = null
    if (menuPaneId.value && !options.visibleSplitPaneIds.value.includes(menuPaneId.value)) menuPaneId.value = null
    if (!menuPaneId.value) paneMenuMode.value = 'main'
    const activeAssigned = options.paneAssignments.value[options.activePaneId.value]
    if (!activeAssigned && options.splitMode.value !== 'single') {
      options.activePaneId.value = options.visibleSplitPaneIds.value.find((paneId) => options.paneAssignments.value[paneId]) ?? options.visibleSplitPaneIds.value[0]
    }
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
  }

  function setWorkspaceSplitMode(mode: SplitMode) {
    const previousActiveAssignment = options.paneAssignments.value[options.activePaneId.value]
    options.maximizedPaneId.value = null
    closePaneCommandOverlays()
    options.setSplitMode(mode)
    sanitizePaneAssignments(mode !== 'single')
    if (mode === 'single') activateAssignment(previousActiveAssignment)
    else activateAssignment(options.paneAssignments.value[options.activePaneId.value])
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function handleSplitModeChange(event: Event) {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as { mode?: unknown }
    if (!isSplitMode(detail.mode)) return
    setWorkspaceSplitMode(detail.mode)
  }

  async function clearAllSplitPanes() {
    if (options.confirmClearAllPanes && !(await options.confirmClearAllPanes())) return
    options.clearAllPanes()
    closePaneCommandOverlays()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function handleSplitClearPanes() {
    void clearAllSplitPanes()
  }

  function activatePane(paneId: SplitPaneId) {
    options.activePaneId.value = paneId
    activateAssignment(options.paneAssignments.value[paneId])
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function assignToPane(assignment: PaneAssignment, paneId: SplitPaneId) {
    if (!assignmentAvailable(assignment)) return false
    const result = assignPaneAssignment(options.paneAssignments.value, assignment, paneId)
    options.paneAssignments.value = result.assignments
    if (result.activePaneId) options.activePaneId.value = result.activePaneId
    closePaneCommandOverlays()
    activateAssignment(assignment)
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
    return true
  }

  function assignSessionToPane(sessionId: string, paneId: SplitPaneId) {
    return assignToPane({ kind: 'ssh', sessionId }, paneId)
  }

  function assignLocalSessionToPane(sessionId: string, paneId: SplitPaneId) {
    return assignToPane({ kind: 'local', sessionId }, paneId)
  }

  function assignNewToFirstEmptyPane(assignment: PaneAssignment) {
    if (!options.splitEnabled.value) return false
    if (!assignmentAvailable(assignment)) return false
    const result = autoFillPaneAssignment(options.paneAssignments.value, assignment, options.splitMode.value)
    if (!result.activePaneId) return false
    if (result.changed) {
      options.paneAssignments.value = result.assignments
      activateAssignment(assignment)
    }
    options.activePaneId.value = result.activePaneId
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
    return true
  }

  function assignNewTerminalToFirstEmptyPane(sessionId: string) {
    return assignNewToFirstEmptyPane({ kind: 'ssh', sessionId })
  }

  function assignNewLocalTerminalToFirstEmptyPane(sessionId: string) {
    return assignNewToFirstEmptyPane({ kind: 'local', sessionId })
  }

  function clearPane(paneId: SplitPaneId) {
    const result = clearPaneAssignment(options.paneAssignments.value, paneId, options.visibleSplitPaneIds.value, options.activePaneId.value)
    options.paneAssignments.value = result.assignments
    if (options.maximizedPaneId.value === paneId) options.maximizedPaneId.value = null
    if (selectorPaneId.value === paneId) selectorPaneId.value = null
    if (menuPaneId.value === paneId) menuPaneId.value = null
    if (menuPaneId.value === null) paneMenuMode.value = 'main'
    if (result.activePaneId) {
      const wasActive = options.activePaneId.value === paneId
      options.activePaneId.value = result.activePaneId
      if (wasActive) activateAssignment(options.paneAssignments.value[options.activePaneId.value])
    } else if (options.activePaneId.value === paneId) {
      activateAssignment(options.paneAssignments.value[options.activePaneId.value])
    }
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function togglePaneMaximize(paneId: SplitPaneId) {
    if (!options.splitEnabled.value || !options.visibleSplitPaneIds.value.includes(paneId)) return
    closePaneCommandOverlays()
    const wasMaximized = options.maximizedPaneId.value === paneId
    options.togglePaneMaximize(paneId)
    if (!wasMaximized) activateAssignment(options.paneAssignments.value[paneId])
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function restoreMaximizedPane() {
    if (!options.maximizedPaneId.value) return
    options.restoreMaximizedPane()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function openTerminalSelector(paneId: SplitPaneId) {
    if (!options.visibleSplitPaneIds.value.includes(paneId)) return
    if (!getAvailableConnectedTabsForPaneSelector().length) {
      closePaneCommandOverlays()
      options.notify('没有可用终端。', 'info')
      return
    }
    options.activePaneId.value = paneId
    menuPaneId.value = null
    paneMenuMode.value = 'main'
    selectorPaneId.value = selectorPaneId.value === paneId ? null : paneId
    persistSplitLayout()
  }

  function openReplacementSelector(paneId: SplitPaneId) {
    if (!options.visibleSplitPaneIds.value.includes(paneId)) return
    if (!getAvailableConnectedTabsForPaneSelector().length) {
      closePaneCommandOverlays()
      options.notify('没有可用终端。', 'info')
      return
    }
    options.activePaneId.value = paneId
    menuPaneId.value = null
    paneMenuMode.value = 'main'
    selectorPaneId.value = paneId
    persistSplitLayout()
  }

  function activatePaneTarget(paneId: SplitPaneId) {
    if (!options.visibleSplitPaneIds.value.includes(paneId)) return false
    options.activePaneId.value = paneId
    activateAssignment(options.paneAssignments.value[paneId])
    closePaneCommandOverlays()
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
    return true
  }

  function addServerToPane(paneId: SplitPaneId) {
    if (!activatePaneTarget(paneId)) return
    options.emitPaneAddServer(paneId)
  }

  function connectSavedToPane(paneId: SplitPaneId) {
    if (!activatePaneTarget(paneId)) return
    options.emitPaneConnectSaved(paneId)
  }

  function openLocalTerminalToPane(paneId: SplitPaneId, shellKind: 'cmd' | 'powershell') {
    if (!activatePaneTarget(paneId)) return
    options.emitPaneOpenLocalTerminal(paneId, shellKind)
  }

  function selectConnectedToPane(paneId: SplitPaneId) {
    openReplacementSelector(paneId)
  }

  function selectTerminalForPane(assignment: PaneAssignment, paneId: SplitPaneId) {
    assignToPane(assignment, paneId)
  }

  function togglePaneMenu(paneId: SplitPaneId) {
    if (!options.splitEnabled.value || !options.visibleSplitPaneIds.value.includes(paneId)) return
    options.activePaneId.value = paneId
    activateAssignment(options.paneAssignments.value[paneId])
    selectorPaneId.value = null
    if (menuPaneId.value === paneId) {
      menuPaneId.value = null
      paneMenuMode.value = 'main'
    } else {
      menuPaneId.value = paneId
      paneMenuMode.value = 'main'
    }
    persistSplitLayout()
  }

  function openPaneSwapMenu(paneId: SplitPaneId) {
    if (!occupiedPaneOptions(paneId).length) return
    options.activePaneId.value = paneId
    activateAssignment(options.paneAssignments.value[paneId])
    selectorPaneId.value = null
    menuPaneId.value = paneId
    paneMenuMode.value = 'swap'
    persistSplitLayout()
  }

  function openPaneMoveMenu(paneId: SplitPaneId) {
    if (!emptyPaneOptions(paneId).length) return
    options.activePaneId.value = paneId
    activateAssignment(options.paneAssignments.value[paneId])
    selectorPaneId.value = null
    menuPaneId.value = paneId
    paneMenuMode.value = 'move'
    persistSplitLayout()
  }

  function swapPaneAssignments(sourcePaneId: SplitPaneId, targetPaneId: SplitPaneId) {
    if (!options.splitEnabled.value) return
    const targetAssignment = options.paneAssignments.value[targetPaneId]
    const result = swapPaneAssignmentsState(options.paneAssignments.value, sourcePaneId, targetPaneId, options.visibleSplitPaneIds.value)
    if (!result.changed) return
    options.paneAssignments.value = result.assignments
    if (result.activePaneId) options.activePaneId.value = result.activePaneId
    closePaneCommandOverlays()
    activateAssignment(targetAssignment)
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function movePaneAssignment(sourcePaneId: SplitPaneId, targetPaneId: SplitPaneId) {
    if (!options.splitEnabled.value) return
    const sourceAssignment = options.paneAssignments.value[sourcePaneId]
    const result = movePaneAssignmentState(options.paneAssignments.value, sourcePaneId, targetPaneId, options.visibleSplitPaneIds.value)
    if (!result.changed || !sourceAssignment) return
    options.paneAssignments.value = result.assignments
    options.maximizedPaneId.value = null
    if (result.activePaneId) options.activePaneId.value = result.activePaneId
    closePaneCommandOverlays()
    activateAssignment(sourceAssignment)
    persistSplitLayout()
    options.refreshVisibleOutputSessions()
    options.scheduleLayoutBump(options.bumpLayout)
  }

  function clearPaneFromMenu(paneId: SplitPaneId) {
    menuPaneId.value = null
    paneMenuMode.value = 'main'
    clearPane(paneId)
  }

  function clearPaneActivityFromMenu(paneId: SplitPaneId) {
    clearAssignmentActivity(options.paneAssignments.value[paneId])
    menuPaneId.value = null
    paneMenuMode.value = 'main'
  }

  function togglePaneMaximizeFromMenu(paneId: SplitPaneId) {
    menuPaneId.value = null
    paneMenuMode.value = 'main'
    togglePaneMaximize(paneId)
  }

  function closePaneOverlays(event?: PointerEvent) {
    const target = event?.target instanceof HTMLElement ? event.target : null
    if (target?.closest('.terminal-pane-menu, .terminal-pane-selector, .terminal-pane-menu-trigger, .terminal-pane-empty-actions')) return
    closePaneCommandOverlays()
  }

  return {
    selectorPaneId,
    menuPaneId,
    paneMenuMode,
    terminalSelectorOptions,
    getAvailableConnectedTabsForPaneSelector,
    sameAssignment,
    assignmentAvailable,
    activateAssignment,
    persistSplitLayout,
    assignmentActivityState,
    assignmentActivityLabel,
    assignmentActivityTitle,
    clearAssignmentActivity,
    occupiedPaneOptions,
    emptyPaneOptions,
    sanitizePaneAssignments,
    setSplitMode: setWorkspaceSplitMode,
    handleSplitModeChange,
    clearAllSplitPanes,
    handleSplitClearPanes,
    activatePane,
    assignToPane,
    assignSessionToPane,
    assignLocalSessionToPane,
    assignNewToFirstEmptyPane,
    assignNewTerminalToFirstEmptyPane,
    assignNewLocalTerminalToFirstEmptyPane,
    clearPane,
    togglePaneMaximize,
    restoreMaximizedPane,
    openTerminalSelector,
    openReplacementSelector,
    activatePaneTarget,
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
    clearPaneFromMenu,
    clearPaneActivityFromMenu,
    togglePaneMaximizeFromMenu,
    closePaneOverlays,
  }
}

function setWritableRef<T>(target: MaybeReadonlyRef<T>, value: T) {
  ;(target as Ref<T>).value = value
}
