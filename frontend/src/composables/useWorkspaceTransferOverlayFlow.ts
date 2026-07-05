import { nextTick, ref, type Ref } from 'vue'
import { getViewportPopoverPosition, type ViewportPopoverRect } from '../utils/viewportPopover'

type TransferScope = 'current' | 'all'

type WorkspaceTransferOverlayFlowOptions = {
  rootRef: Ref<HTMLElement | null | undefined>
  sftpExpanded: Ref<boolean>
  scheduleAfterOpen?: (callback: () => void) => void
}

const TRANSFER_POPOVER_MARGIN = 12
const TRANSFER_POPOVER_GAP = 8
const TRANSFER_POPOVER_MAX_WIDTH = 620
const TRANSFER_POPOVER_MAX_HEIGHT = 360
const TRANSFER_POPOVER_HEIGHT_OFFSET = 96

export function useWorkspaceTransferOverlayFlow(options: WorkspaceTransferOverlayFlowOptions) {
  const transferPopover = ref(false)
  const transferScope = ref<TransferScope>('current')
  const transferButton = ref<HTMLElement | null>(null)
  const transferPopoverStyle = ref<Record<string, string>>({})

  function viewportSize() {
    return {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    }
  }

  function transferPopoverBounds(triggerRect: DOMRect, viewportHeight: number): ViewportPopoverRect | null {
    const viewportTop = TRANSFER_POPOVER_MARGIN
    const viewportBottom = viewportHeight - TRANSFER_POPOVER_MARGIN
    if (!options.sftpExpanded.value || !options.rootRef.value) return null
    const sftpPanel = options.rootRef.value.querySelector<HTMLElement>('.sftp-panel.expanded')
    if (!sftpPanel) return null
    const rect = sftpPanel.getBoundingClientRect()
    if (rect.height <= 0 || rect.top >= viewportBottom) return null
    const top = Math.max(rect.top, viewportTop)
    const bottom = Math.min(rect.bottom, triggerRect.top - TRANSFER_POPOVER_GAP, viewportBottom)
    if (bottom <= top) return null
    return {
      left: rect.left,
      top,
      right: rect.right,
      bottom,
      width: Math.max(0, rect.right - rect.left),
      height: bottom - top,
    }
  }

  function updateTransferPopoverPosition() {
    if (!transferPopover.value || !transferButton.value) return
    const rect = transferButton.value.getBoundingClientRect()
    const { width: viewportWidth, height: viewportHeight } = viewportSize()
    const preferredHeight = Math.min(TRANSFER_POPOVER_MAX_HEIGHT, Math.max(0, viewportHeight - TRANSFER_POPOVER_HEIGHT_OFFSET))
    const boundsRect = transferPopoverBounds(rect, viewportHeight)
    const position = getViewportPopoverPosition({
      anchorRect: rect,
      boundsRect,
      popoverSize: { width: TRANSFER_POPOVER_MAX_WIDTH, height: preferredHeight },
      viewport: { width: viewportWidth, height: viewportHeight },
      placement: boundsRect ? 'panel-bound' : 'top-end',
      margin: TRANSFER_POPOVER_MARGIN,
      gap: TRANSFER_POPOVER_GAP,
      maxHeight: preferredHeight,
    })
    transferPopoverStyle.value = {
      position: 'fixed',
      left: `${Math.round(position.left)}px`,
      top: `${Math.round(position.top)}px`,
      width: `${Math.round(position.width)}px`,
      maxHeight: `${Math.round(position.maxHeight)}px`,
      transformOrigin: position.transformOrigin,
    }
  }

  function openTransferPopover() {
    transferScope.value = 'current'
    transferPopover.value = !transferPopover.value
    if (transferPopover.value) {
      const schedule = options.scheduleAfterOpen ?? ((callback: () => void) => { void nextTick(callback) })
      schedule(updateTransferPopoverPosition)
    }
  }

  function closeTransferPopover() {
    transferPopover.value = false
  }

  function closeTransferPopoverFromOutside(event: PointerEvent) {
    const target = event.target
    if (
      target instanceof Element
      && (target.closest('.status-transfer-wrap') || target.closest('.transfer-popover'))
    ) return false
    closeTransferPopover()
    return true
  }

  function closeTransferPopoverOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !transferPopover.value) return false
    closeTransferPopover()
    return true
  }

  return {
    transferPopover,
    transferScope,
    transferButton,
    transferPopoverStyle,
    updateTransferPopoverPosition,
    openTransferPopover,
    closeTransferPopover,
    closeTransferPopoverFromOutside,
    closeTransferPopoverOnEscape,
  }
}
