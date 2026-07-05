import {
  ALL_SPLIT_PANE_IDS,
  defaultPaneAssignments,
  getPaneFillOrder,
  parsePaneAssignment,
  type PaneAssignment,
  type PaneAssignments,
  type SplitMode,
  type SplitPaneId,
} from '../utils/workspaceSplitTypes'

export type PaneAssignmentMutation = {
  assignments: PaneAssignments
  activePaneId: SplitPaneId | null
  changed: boolean
}

export function assignmentKey(assignment: PaneAssignment) {
  return `${assignment.kind}:${assignment.sessionId}`
}

export function samePaneAssignment(left: PaneAssignment | null, right: PaneAssignment) {
  return Boolean(left && left.kind === right.kind && left.sessionId === right.sessionId)
}

export function normalizePersistedPaneAssignments(values: Record<string, unknown> | null | undefined): PaneAssignments {
  const assignments = defaultPaneAssignments()
  if (!values || typeof values !== 'object') return assignments
  for (const paneId of ALL_SPLIT_PANE_IDS) {
    assignments[paneId] = parsePaneAssignment(values[paneId])
  }
  return assignments
}

export function assignPaneAssignment(assignments: PaneAssignments, assignment: PaneAssignment, paneId: SplitPaneId): PaneAssignmentMutation {
  const next = { ...assignments }
  for (const id of ALL_SPLIT_PANE_IDS) {
    if (samePaneAssignment(next[id], assignment)) next[id] = null
  }
  next[paneId] = assignment
  return { assignments: next, activePaneId: paneId, changed: true }
}

export function clearPaneAssignment(
  assignments: PaneAssignments,
  paneId: SplitPaneId,
  visiblePaneIds: SplitPaneId[],
  activePaneId: SplitPaneId,
): PaneAssignmentMutation {
  const next = { ...assignments, [paneId]: null }
  const nextActive = activePaneId === paneId
    ? visiblePaneIds.find((candidate) => next[candidate]) ?? paneId
    : activePaneId
  return { assignments: next, activePaneId: nextActive, changed: assignments[paneId] !== null }
}

export function removeSessionFromPaneAssignments(assignments: PaneAssignments, assignment: PaneAssignment): PaneAssignmentMutation {
  let changed = false
  const next = { ...assignments }
  for (const paneId of ALL_SPLIT_PANE_IDS) {
    if (samePaneAssignment(next[paneId], assignment)) {
      next[paneId] = null
      changed = true
    }
  }
  return { assignments: next, activePaneId: null, changed }
}

export function swapPaneAssignments(
  assignments: PaneAssignments,
  sourcePaneId: SplitPaneId,
  targetPaneId: SplitPaneId,
  visiblePaneIds: SplitPaneId[],
): PaneAssignmentMutation {
  if (!visiblePaneIds.includes(sourcePaneId) || !visiblePaneIds.includes(targetPaneId) || sourcePaneId === targetPaneId) {
    return { assignments, activePaneId: null, changed: false }
  }
  const sourceAssignment = assignments[sourcePaneId]
  const targetAssignment = assignments[targetPaneId]
  if (!sourceAssignment || !targetAssignment) return { assignments, activePaneId: null, changed: false }
  const next = { ...assignments, [sourcePaneId]: targetAssignment, [targetPaneId]: sourceAssignment }
  return { assignments: next, activePaneId: sourcePaneId, changed: true }
}

export function movePaneAssignment(
  assignments: PaneAssignments,
  sourcePaneId: SplitPaneId,
  targetPaneId: SplitPaneId,
  visiblePaneIds: SplitPaneId[],
): PaneAssignmentMutation {
  if (!visiblePaneIds.includes(sourcePaneId) || !visiblePaneIds.includes(targetPaneId) || sourcePaneId === targetPaneId || assignments[targetPaneId]) {
    return { assignments, activePaneId: null, changed: false }
  }
  const sourceAssignment = assignments[sourcePaneId]
  if (!sourceAssignment) return { assignments, activePaneId: null, changed: false }
  const next = { ...assignments, [sourcePaneId]: null, [targetPaneId]: sourceAssignment }
  return { assignments: next, activePaneId: targetPaneId, changed: true }
}

export function autoFillPaneAssignment(assignments: PaneAssignments, assignment: PaneAssignment, splitMode: SplitMode): PaneAssignmentMutation {
  const fillOrder = getPaneFillOrder(splitMode)
  if (!fillOrder.length) return { assignments, activePaneId: null, changed: false }
  const assignedPane = fillOrder.find((paneId) => samePaneAssignment(assignments[paneId], assignment))
  if (assignedPane) return { assignments, activePaneId: assignedPane, changed: false }
  const paneId = fillOrder.find((candidate) => !assignments[candidate])
  if (!paneId) return { assignments, activePaneId: null, changed: false }
  return assignPaneAssignment(assignments, assignment, paneId)
}

export function dropStalePaneAssignments(
  assignments: PaneAssignments,
  isAssignmentAvailable: (assignment: PaneAssignment) => boolean,
): PaneAssignmentMutation {
  const used = new Set<string>()
  const next = defaultPaneAssignments()
  let changed = false
  for (const paneId of ALL_SPLIT_PANE_IDS) {
    const assignment = assignments[paneId]
    if (!assignment) continue
    const key = assignmentKey(assignment)
    if (!isAssignmentAvailable(assignment) || used.has(key)) {
      changed = true
      continue
    }
    next[paneId] = assignment
    used.add(key)
  }
  for (const paneId of ALL_SPLIT_PANE_IDS) {
    if (!sameNullableAssignment(next[paneId], assignments[paneId])) changed = true
  }
  return { assignments: next, activePaneId: null, changed }
}

function sameNullableAssignment(left: PaneAssignment | null, right: PaneAssignment | null) {
  if (!left && !right) return true
  if (!left || !right) return false
  return samePaneAssignment(left, right)
}
