import { nextTick, ref, type Ref } from 'vue'

type TransferScope = 'current' | 'all'

type WorkspaceTransferOverlayFlowOptions = {
  rootRef: Ref<HTMLElement | null | undefined>
  sftpExpanded: Ref<boolean>
  scheduleAfterOpen?: (callback: () => void) => void
}

const TRANSFER_POPOVER_MARGIN = 12
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

  function updateTransferPopoverPosition() {
    if (!transferPopover.value || !transferButton.value) return
    const { width: viewportWidth, height: viewportHeight } = viewportSize()
    const rootRect = options.rootRef.value?.getBoundingClientRect()
    const workspaceLeft = Math.max(TRANSFER_POPOVER_MARGIN, rootRect?.left ?? TRANSFER_POPOVER_MARGIN)
    const workspaceTop = Math.max(TRANSFER_POPOVER_MARGIN, rootRect?.top ?? TRANSFER_POPOVER_MARGIN)
    const workspaceRight = Math.min(
      viewportWidth - TRANSFER_POPOVER_MARGIN,
      rootRect?.right && rootRect.right > rootRect.left ? rootRect.right : viewportWidth - TRANSFER_POPOVER_MARGIN,
    )
    const workspaceBottom = Math.min(
      viewportHeight - TRANSFER_POPOVER_MARGIN,
      rootRect?.bottom && rootRect.bottom > rootRect.top ? rootRect.bottom : viewportHeight - TRANSFER_POPOVER_MARGIN,
    )
    const availableWidth = Math.max(0, workspaceRight - workspaceLeft)
    const availableHeight = Math.max(0, workspaceBottom - workspaceTop)
    const width = Math.min(TRANSFER_POPOVER_MAX_WIDTH, availableWidth)
    const maxHeight = Math.min(
      TRANSFER_POPOVER_MAX_HEIGHT,
      Math.max(0, viewportHeight - TRANSFER_POPOVER_HEIGHT_OFFSET),
      availableHeight,
    )
    const left = workspaceRight - width
    const bottom = Math.max(TRANSFER_POPOVER_MARGIN, viewportHeight - workspaceBottom)
    transferPopoverStyle.value = {
      position: 'fixed',
      left: `${Math.round(left)}px`,
      bottom: `${Math.round(bottom)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
      transformOrigin: 'bottom right',
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
