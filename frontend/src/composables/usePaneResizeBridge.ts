import type { Ref } from 'vue'
import { normalizeSplitRatio, type SplitResizeAxis } from '../utils/workspaceSplitTypes'

export type UsePaneResizeBridgeOptions = {
  workspaceRef: Ref<HTMLElement | null | undefined>
  columnRatio: Ref<number>
  rowRatio: Ref<number>
  onRatioChange: (axis: SplitResizeAxis, ratio: number) => void
  onRatioCommit: (axis: SplitResizeAxis, ratio: number) => void
  onLayoutBump: () => void
}

export function usePaneResizeBridge(options: UsePaneResizeBridgeOptions) {
  let splitResizeDrag: { axis: SplitResizeAxis; rect: DOMRect } | null = null
  let splitResizeFrame: number | null = null

  function scheduleSplitResizeBump() {
    if (splitResizeFrame !== null) return
    const run = () => {
      splitResizeFrame = null
      options.onLayoutBump()
    }
    if (typeof window.requestAnimationFrame === 'function') {
      splitResizeFrame = window.requestAnimationFrame(run)
    } else {
      splitResizeFrame = window.setTimeout(run, 16)
    }
  }

  function cancelSplitResizeBump() {
    if (splitResizeFrame === null) return
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(splitResizeFrame)
    else window.clearTimeout(splitResizeFrame)
    splitResizeFrame = null
  }

  function ratioFromSplitPointer(axis: SplitResizeAxis, event: PointerEvent) {
    if (!splitResizeDrag) return axis === 'column' ? options.columnRatio.value : options.rowRatio.value
    const size = axis === 'column' ? splitResizeDrag.rect.width : splitResizeDrag.rect.height
    if (!Number.isFinite(size) || size <= 0) return axis === 'column' ? options.columnRatio.value : options.rowRatio.value
    const origin = axis === 'column' ? splitResizeDrag.rect.left : splitResizeDrag.rect.top
    const position = axis === 'column' ? event.clientX : event.clientY
    return normalizeSplitRatio((position - origin) / size)
  }

  function applySplitResize(event: PointerEvent) {
    if (!splitResizeDrag) return
    const ratio = ratioFromSplitPointer(splitResizeDrag.axis, event)
    options.onRatioChange(splitResizeDrag.axis, ratio)
  }

  function startSplitResize(axis: SplitResizeAxis, event: PointerEvent) {
    if (event.button !== 0) return
    const workspace = options.workspaceRef.value
    if (!workspace) return
    const rect = workspace.getBoundingClientRect()
    const size = axis === 'column' ? rect.width : rect.height
    if (!Number.isFinite(size) || size <= 0) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    if (target && typeof event.pointerId === 'number') target.setPointerCapture?.(event.pointerId)
    splitResizeDrag = { axis, rect }
    document.body.classList.add('workspace-pane-resizing', `workspace-pane-resizing-${axis}`)
    window.addEventListener('pointermove', moveSplitResize, true)
    window.addEventListener('pointerup', stopSplitResize, true)
  }

  function moveSplitResize(event: PointerEvent) {
    if (!splitResizeDrag) return
    event.preventDefault()
    applySplitResize(event)
    scheduleSplitResizeBump()
  }

  function cleanupSplitResize() {
    cancelSplitResizeBump()
    window.removeEventListener('pointermove', moveSplitResize, true)
    window.removeEventListener('pointerup', stopSplitResize, true)
    document.body.classList.remove('workspace-pane-resizing', 'workspace-pane-resizing-column', 'workspace-pane-resizing-row')
    splitResizeDrag = null
  }

  function stopSplitResize(event?: PointerEvent) {
    if (splitResizeDrag && event) {
      event.preventDefault()
      applySplitResize(event)
      const ratio = ratioFromSplitPointer(splitResizeDrag.axis, event)
      options.onRatioCommit(splitResizeDrag.axis, ratio)
      options.onLayoutBump()
    }
    cleanupSplitResize()
  }

  return {
    startSplitResize,
    cleanupSplitResize,
  }
}
