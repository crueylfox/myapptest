import { ref, type Ref } from 'vue'
import type { PaneAssignment, SplitPaneId } from '../utils/workspaceSplitTypes'

export type PaneDropPayload = {
  assignment: PaneAssignment
  sourcePaneId: SplitPaneId
  targetPaneId: SplitPaneId
}

export type UsePaneDragDropOptions = {
  rootRef: Ref<HTMLElement | null | undefined>
  isPaneId: (value: unknown) => value is SplitPaneId
  isPaneVisible: (paneId: SplitPaneId) => boolean
  onDrop: (payload: PaneDropPayload) => void
}

export function usePaneDragDrop(options: UsePaneDragDropOptions) {
  const paneDropTargetId = ref<SplitPaneId | null>(null)
  let paneDrag: {
    assignment: PaneAssignment
    sourcePaneId: SplitPaneId
    startX: number
    startY: number
    active: boolean
  } | null = null

  function paneIdAtPoint(clientX?: number, clientY?: number) {
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return null
    const panes = Array.from(options.rootRef.value?.querySelectorAll<HTMLElement>('.terminal-pane') ?? [])
    for (const pane of panes) {
      const id = pane.dataset.paneId
      if (!options.isPaneId(id)) continue
      const bounds = pane.getBoundingClientRect()
      if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) return id
    }
    return null
  }

  function startPaneDrag(paneId: SplitPaneId, assignment: PaneAssignment | null, event: PointerEvent) {
    if (!assignment || event.button !== 0) return
    if ((event.target as HTMLElement | null)?.closest('button')) return
    paneDrag = { assignment, sourcePaneId: paneId, startX: event.clientX, startY: event.clientY, active: false }
    window.addEventListener('pointermove', movePaneDrag, true)
    window.addEventListener('pointerup', endPaneDrag, true)
  }

  function movePaneDrag(event: PointerEvent) {
    if (!paneDrag) return
    const distance = Math.hypot(event.clientX - paneDrag.startX, event.clientY - paneDrag.startY)
    if (!paneDrag.active) {
      if (distance < 6) return
      paneDrag.active = true
      document.body.classList.add('workspace-tab-dragging-active')
    }
    event.preventDefault()
    paneDropTargetId.value = paneIdAtPoint(event.clientX, event.clientY)
  }

  function cleanupPaneDrag() {
    window.removeEventListener('pointermove', movePaneDrag, true)
    window.removeEventListener('pointerup', endPaneDrag, true)
    document.body.classList.remove('workspace-tab-dragging-active')
    paneDrag = null
    paneDropTargetId.value = null
  }

  function endPaneDrag(event: PointerEvent) {
    if (paneDrag?.active) {
      event.preventDefault()
      const targetPaneId = paneDropTargetId.value
      if (targetPaneId && options.isPaneVisible(targetPaneId)) {
        options.onDrop({
          assignment: paneDrag.assignment,
          sourcePaneId: paneDrag.sourcePaneId,
          targetPaneId,
        })
      }
    }
    cleanupPaneDrag()
  }

  return {
    paneDropTargetId,
    paneIdAtPoint,
    startPaneDrag,
    cleanupPaneDrag,
  }
}
