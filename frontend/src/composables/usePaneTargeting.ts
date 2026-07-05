import type { PaneAssignment, PaneAssignments, SplitPaneId } from '../utils/workspaceSplitTypes'
import { samePaneAssignment } from './usePaneAssignments'

export type SshCommandTabLike = {
  sessionId: string
  connectionId: number
  status?: string
}

export type TopTabPaneIntent =
  | { type: 'activate-pane'; paneId: SplitPaneId }
  | { type: 'assign-to-pane'; paneId: SplitPaneId; assignment: PaneAssignment }
  | { type: 'activate-tab' }

export function resolveActiveCommandTarget<T extends SshCommandTabLike>(input: {
  splitEnabled: boolean
  activePaneAssignment: PaneAssignment | null
  sshTabs: T[]
  activeSshTab: T | null
  localTerminalActive: boolean
}) {
  if (input.splitEnabled) {
    if (input.activePaneAssignment?.kind !== 'ssh') return null
    return input.sshTabs.find((tab) => tab.sessionId === input.activePaneAssignment?.sessionId) ?? null
  }
  if (input.localTerminalActive) return null
  return input.activeSshTab
}

export function resolveActiveSftpContextTarget<T extends Pick<SshCommandTabLike, 'sessionId' | 'connectionId'>>(input: {
  activePaneAssignment: PaneAssignment | null
  activeSshTab: T | null
}) {
  if (input.activePaneAssignment?.kind !== 'ssh' || !input.activeSshTab) return null
  return {
    connectionId: input.activeSshTab.connectionId,
    sessionId: input.activeSshTab.sessionId,
  }
}

export function resolveTopTabPaneIntent(input: {
  splitEnabled: boolean
  visiblePaneIds: SplitPaneId[]
  paneAssignments: PaneAssignments
  activePaneId: SplitPaneId
  assignment: PaneAssignment
}): TopTabPaneIntent {
  if (!input.splitEnabled) return { type: 'activate-tab' }
  const assignedPane = input.visiblePaneIds.find((paneId) => samePaneAssignment(input.paneAssignments[paneId], input.assignment))
  if (assignedPane) return { type: 'activate-pane', paneId: assignedPane }
  const paneId = input.visiblePaneIds.includes(input.activePaneId) ? input.activePaneId : input.visiblePaneIds[0]
  return { type: 'assign-to-pane', paneId, assignment: input.assignment }
}

export function resolvePaneTarget(input: {
  specifiedPaneId: SplitPaneId | null | undefined
  visiblePaneIds: SplitPaneId[]
  paneAssignments: PaneAssignments
  fillOrder: SplitPaneId[]
}) {
  if (input.specifiedPaneId && input.visiblePaneIds.includes(input.specifiedPaneId)) return input.specifiedPaneId
  return input.fillOrder.find((paneId) => input.visiblePaneIds.includes(paneId) && !input.paneAssignments[paneId]) ?? null
}
