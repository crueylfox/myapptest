import type { ComputedRef, Ref } from 'vue'
import type { Connection, LocalTerminalState, ShortcutSettings, TerminalProfile, TerminalSessionInfo } from '../types'
import type { PaneAssignment, PaneAssignmentKind, PaneAssignments, SplitPaneId } from '../utils/workspaceSplitTypes'
import {
  localStatusClass,
  localStatusLabel,
  statusLabel,
  type PaneMenuMode,
  type PaneOption,
} from './workspaceCommandModel'

type MaybeReadonlyRef<T> = Ref<T> | ComputedRef<T>

export type PaneShellBinding = {
  paneId: SplitPaneId
  active: boolean
  maximized: boolean
  dropTarget: boolean
  kind: PaneAssignmentKind | null
  title: string
  statusClass: string
  statusText: string
  sessionId?: string
  localSessionId?: string
  hasActivity: boolean
  activityLabel: string
  activityTitle: string
  menuOpen: boolean
  menuMode: PaneMenuMode
  occupiedPaneOptions: PaneOption[]
  emptyPaneOptions: PaneOption[]
  paneStyle?: Record<string, string>
}

export type WorkspacePaneShellBindingOptions = {
  paneAssignments: Ref<PaneAssignments>
  activePaneId: MaybeReadonlyRef<SplitPaneId>
  maximizedPaneId: MaybeReadonlyRef<SplitPaneId | null>
  paneDropTargetId: MaybeReadonlyRef<SplitPaneId | null>
  menuPaneId: MaybeReadonlyRef<SplitPaneId | null>
  paneMenuMode: MaybeReadonlyRef<PaneMenuMode>
  sshTabs: MaybeReadonlyRef<TerminalSessionInfo[]>
  localSessions: MaybeReadonlyRef<LocalTerminalState[]>
  assignmentActivityState: (assignment: PaneAssignment | null) => { hasActivity?: boolean } | undefined
  assignmentActivityLabel: (assignment: PaneAssignment | null) => string
  assignmentActivityTitle: (assignment: PaneAssignment | null) => string
  occupiedPaneOptions: (paneId: SplitPaneId) => PaneOption[]
  emptyPaneOptions: (paneId: SplitPaneId) => PaneOption[]
  terminalView?: {
    visible: MaybeReadonlyRef<boolean>
    layoutRevision: MaybeReadonlyRef<number>
    copyOnSelectEnabled: MaybeReadonlyRef<boolean>
    rightClickPasteEnabled: MaybeReadonlyRef<boolean>
    shortcutSettings: MaybeReadonlyRef<ShortcutSettings | undefined>
    profileRevision: MaybeReadonlyRef<number>
    defaultLocalProfile: MaybeReadonlyRef<TerminalProfile>
    platform?: MaybeReadonlyRef<string>
    resolveConnection: (connectionId: number) => Connection | null
    resolveProfile: (connection: Connection | null) => TerminalProfile
  }
}

export function useWorkspacePaneShellBindings(options: WorkspacePaneShellBindingOptions) {
  function paneAssignment(paneId: SplitPaneId) {
    return options.paneAssignments.value[paneId]
  }

  function paneTab(paneId: SplitPaneId) {
    const assignment = paneAssignment(paneId)
    if (assignment?.kind !== 'ssh') return null
    return options.sshTabs.value.find((tab) => tab.sessionId === assignment.sessionId) ?? null
  }

  function paneLocalSession(paneId: SplitPaneId) {
    const assignment = paneAssignment(paneId)
    if (assignment?.kind !== 'local') return null
    return options.localSessions.value.find((session) => session.sessionId === assignment.sessionId) ?? null
  }

  function paneAssigned(paneId: SplitPaneId) {
    return Boolean(paneTab(paneId) || paneLocalSession(paneId))
  }

  function paneKind(paneId: SplitPaneId) {
    if (paneTab(paneId)) return 'ssh'
    if (paneLocalSession(paneId)) return 'local'
    return null
  }

  function paneTitle(paneId: SplitPaneId) {
    const tab = paneTab(paneId)
    if (tab) return tab.title
    const session = paneLocalSession(paneId)
    return session?.title || session?.shell || 'Local Terminal'
  }

  function paneStatusClass(paneId: SplitPaneId) {
    const tab = paneTab(paneId)
    if (tab) return tab.status
    return localStatusClass(paneLocalSession(paneId)?.status)
  }

  function paneStatusText(paneId: SplitPaneId) {
    const tab = paneTab(paneId)
    if (tab) return statusLabel(tab.status)
    return localStatusLabel(paneLocalSession(paneId)?.status)
  }

  function paneHasActivity(paneId: SplitPaneId) {
    return Boolean(options.assignmentActivityState(paneAssignment(paneId))?.hasActivity)
  }

  function paneShellBinding(paneId: SplitPaneId, paneStyle?: Record<string, string>): PaneShellBinding {
    const tab = paneTab(paneId)
    const localSession = paneLocalSession(paneId)
    return {
      paneId,
      active: options.activePaneId.value === paneId,
      maximized: options.maximizedPaneId.value === paneId,
      dropTarget: options.paneDropTargetId.value === paneId,
      kind: tab ? 'ssh' : localSession ? 'local' : null,
      title: paneTitle(paneId),
      statusClass: paneStatusClass(paneId),
      statusText: paneStatusText(paneId),
      sessionId: tab?.sessionId,
      localSessionId: localSession?.sessionId,
      hasActivity: paneHasActivity(paneId),
      activityLabel: options.assignmentActivityLabel(paneAssignment(paneId)),
      activityTitle: options.assignmentActivityTitle(paneAssignment(paneId)),
      menuOpen: options.menuPaneId.value === paneId,
      menuMode: options.paneMenuMode.value,
      occupiedPaneOptions: options.occupiedPaneOptions(paneId),
      emptyPaneOptions: options.emptyPaneOptions(paneId),
      paneStyle,
    }
  }

  function terminalViewCommonProps(active: boolean) {
    const terminalView = options.terminalView
    return {
      active,
      visible: terminalView?.visible.value ?? true,
      layoutRevision: terminalView?.layoutRevision.value ?? 0,
      copyOnSelectEnabled: terminalView?.copyOnSelectEnabled.value ?? true,
      rightClickPasteEnabled: terminalView?.rightClickPasteEnabled.value ?? true,
      shortcutSettings: terminalView?.shortcutSettings.value,
      profileRevision: terminalView?.profileRevision.value ?? 0,
      platform: terminalView?.platform?.value ?? 'windows',
    }
  }

  function sshTerminalViewProps(tab: TerminalSessionInfo, active: boolean) {
    const connection = options.terminalView?.resolveConnection(tab.connectionId) ?? null
    return {
      ...terminalViewCommonProps(active),
      sessionId: tab.sessionId,
      connection,
      profile: options.terminalView?.resolveProfile(connection),
    }
  }

  function localTerminalViewProps(session: LocalTerminalState, active: boolean) {
    return {
      ...terminalViewCommonProps(active),
      sessionId: session.sessionId,
      profile: options.terminalView?.defaultLocalProfile.value,
    }
  }

  return {
    paneAssignment,
    paneTab,
    paneLocalSession,
    paneAssigned,
    paneKind,
    paneTitle,
    paneStatusClass,
    paneStatusText,
    paneHasActivity,
    paneShellBinding,
    sshTerminalViewProps,
    localTerminalViewProps,
  }
}
