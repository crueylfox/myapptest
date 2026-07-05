import type { SFTPTransferState } from '../types'
import {
  canCancelTransfer as canCancelTransferModel,
  canPauseTransfer as canPauseTransferModel,
  canResumeTransfer as canResumeTransferModel,
} from './workspaceTransferOverlayModel'

type NotifyType = 'success' | 'error' | 'info'
type TransferScope = 'current' | 'all'

type WorkspaceTransferActionsOptions = {
  cancelTransfer: (transferId: string) => Promise<void>
  pauseTransfer: (transferId: string) => Promise<unknown>
  resumeTransfer: (transferId: string) => Promise<unknown>
  clearCompleted: (connectionId: number, contextId?: string | null) => void
  clearCompletedAll: () => void
  activeServerId: () => number | null | undefined
  activeSftpContextId: () => string | null | undefined
  transferScope: () => TransferScope
  notify: (message: string, type: NotifyType) => void
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useWorkspaceTransferActions(options: WorkspaceTransferActionsOptions) {
  async function cancelTransfer(transfer: SFTPTransferState) {
    if (canCancelTransferModel(transfer)) await options.cancelTransfer(transfer.id)
  }

  async function pauseTransfer(transfer: SFTPTransferState) {
    if (!canPauseTransferModel(transfer)) return
    try {
      await options.pauseTransfer(transfer.id)
      options.notify(transfer.mode === 'scp' ? 'SCP 模式将在当前文件完成后暂停' : '传输已暂停', 'info')
    } catch (reason) {
      options.notify(options.errorMessage(reason, '暂停传输失败'), 'error')
    }
  }

  async function resumeTransfer(transfer: SFTPTransferState) {
    if (!canResumeTransferModel(transfer)) return
    try {
      await options.resumeTransfer(transfer.id)
      options.notify('传输已继续', 'success')
    } catch (reason) {
      options.notify(options.errorMessage(reason, '继续传输失败'), 'error')
    }
  }

  async function toggleTransferPause(transfer: SFTPTransferState) {
    if (canResumeTransferModel(transfer)) await resumeTransfer(transfer)
    else await pauseTransfer(transfer)
  }

  function clearFinishedTransfers() {
    if (options.transferScope() === 'all') {
      options.clearCompletedAll()
      return
    }
    const connectionId = options.activeServerId()
    if (connectionId) options.clearCompleted(connectionId, options.activeSftpContextId())
  }

  return {
    cancelTransfer,
    pauseTransfer,
    resumeTransfer,
    toggleTransferPause,
    clearFinishedTransfers,
  }
}
