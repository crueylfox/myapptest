import { ref, type Ref } from 'vue'
import {
  monitorSidebarResizeIntent,
  sftpPanelResizeIntent,
  type WorkspacePanelDragMode,
} from './workspacePaneLayoutModel'

type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

export type UseWorkspacePaneResizeFlowOptions = {
  rootRef: Ref<HTMLElement | null | undefined>
  sidebarWidth: Ref<number>
  sftpHeight: Ref<number>
  persistSidebarWidth: (width: number) => void
  persistSftpHeight: (height: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSftpExpanded: (expanded: boolean) => void
  bumpLayout: () => void
  scheduleAfterStop: (callback: () => void) => void
  windowTarget?: ListenerTarget
}

export function useWorkspacePaneResizeFlow(options: UseWorkspacePaneResizeFlowOptions) {
  const dragMode = ref<WorkspacePanelDragMode | null>(null)
  const listenerTarget = options.windowTarget ?? window
  let listening = false

  function addListeners() {
    if (listening) removeListeners()
    listenerTarget.addEventListener('pointermove', moveDrag as EventListener)
    listenerTarget.addEventListener('pointerup', stopDrag as EventListener, { once: true })
    listening = true
  }

  function removeListeners() {
    listenerTarget.removeEventListener('pointermove', moveDrag as EventListener)
    listenerTarget.removeEventListener('pointerup', stopDrag as EventListener)
    listening = false
  }

  function startDrag(mode: WorkspacePanelDragMode, event: PointerEvent) {
    dragMode.value = mode
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    addListeners()
  }

  function moveDrag(event: PointerEvent) {
    if (!dragMode.value || !options.rootRef.value) return
    const rect = options.rootRef.value.getBoundingClientRect()
    if (dragMode.value === 'sidebar') {
      const intent = monitorSidebarResizeIntent(event.clientX, rect)
      options.setSidebarCollapsed(intent.collapsed)
      if (!intent.collapsed) options.sidebarWidth.value = intent.width
    } else {
      const intent = sftpPanelResizeIntent(event.clientY, rect)
      options.setSftpExpanded(intent.expanded)
      if (intent.expanded) options.sftpHeight.value = intent.height
    }
    options.bumpLayout()
  }

  function stopDrag() {
    if (dragMode.value === 'sidebar') {
      options.persistSidebarWidth(Math.round(options.sidebarWidth.value))
    }
    if (dragMode.value === 'sftp') {
      options.persistSftpHeight(Math.round(options.sftpHeight.value))
    }
    dragMode.value = null
    removeListeners()
    options.scheduleAfterStop(options.bumpLayout)
  }

  function cancelDrag() {
    dragMode.value = null
    removeListeners()
  }

  function dispose() {
    cancelDrag()
  }

  return {
    dragMode,
    startDrag,
    moveDrag,
    stopDrag,
    cancelDrag,
    dispose,
  }
}
