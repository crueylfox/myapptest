import { shallowRef } from 'vue'

export type PendingPaneOpenAction =
  | 'add-server'
  | 'connect-saved'
  | 'select-connected'
  | 'new-cmd'
  | 'new-powershell'

export type PendingPaneOpenTarget = {
  paneId: string
  action: PendingPaneOpenAction
  requestId: number
}

export type PaneTargetAssignment = {
  paneId: string
  kind: 'ssh' | 'local'
  sessionId: string
  requestId: number
}

export function usePaneTargetRequests() {
  const pendingPaneOpenTarget = shallowRef<PendingPaneOpenTarget | null>(null)
  const paneTargetAssignment = shallowRef<PaneTargetAssignment | null>(null)
  let paneTargetRequestSequence = 0
  let paneTargetAssignmentSequence = 0

  function beginPaneOpenTarget(paneId: string, action: PendingPaneOpenAction) {
    const target = { paneId, action, requestId: ++paneTargetRequestSequence }
    pendingPaneOpenTarget.value = target
    return target
  }

  function clearPendingPaneOpenTarget(target?: PendingPaneOpenTarget | null) {
    if (target === undefined || (target && pendingPaneOpenTarget.value?.requestId === target.requestId)) {
      pendingPaneOpenTarget.value = null
    }
  }

  function pendingForAction(action: PendingPaneOpenAction) {
    const target = pendingPaneOpenTarget.value
    return target?.action === action ? target : null
  }

  function publishPaneTargetAssignment(
    target: PendingPaneOpenTarget | null | undefined,
    kind: 'ssh' | 'local',
    sessionId: string,
  ) {
    if (!target || !sessionId) return null
    if (target.requestId < paneTargetRequestSequence && pendingPaneOpenTarget.value?.requestId !== target.requestId) {
      return null
    }
    const assignment = {
      paneId: target.paneId,
      kind,
      sessionId,
      requestId: ++paneTargetAssignmentSequence,
    }
    paneTargetAssignment.value = assignment
    clearPendingPaneOpenTarget(target)
    return assignment
  }

  return {
    pendingPaneOpenTarget,
    paneTargetAssignment,
    beginPaneOpenTarget,
    clearPendingPaneOpenTarget,
    pendingForAction,
    publishPaneTargetAssignment,
  }
}
