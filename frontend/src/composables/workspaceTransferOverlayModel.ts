import type { SFTPTransferDirection, SFTPTransferState } from '../types'
import { formatBytes, formatRate } from '../utils/format'

export type WorkspaceTransferScope = 'current' | 'all'
export type WorkspaceTransferToastType = 'success' | 'error' | 'info'

type TransferContext = Pick<SFTPTransferState, 'connectionId' | 'contextId'>
type TransferTerminalNotification = Pick<
  SFTPTransferState,
  'direction' | 'recursive' | 'sourceType' | 'status' | 'failedCount' | 'skippedCount' | 'errorMessage'
>

export type WorkspaceTransferRowModel = {
  id: string
  transfer: SFTPTransferState
  directionText: string
  leadingText: string
  title: string
  percentValue: number
  percentText: string
  statusText: string
  detailText: string
  showPauseAction: boolean
  pauseActionLabel: string
  pauseDisabled: boolean
  canCancel: boolean
  recursiveStatsText: string
  errorMessage: string
}

export type WorkspaceTransferStats = {
  active: number
  queued: number
  failed: number
  completed: number
  total: number
}

const runningStatuses = ['running', 'queued', 'pausing', 'resuming']
const activeStatuses = ['queued', 'planning', 'running', 'pausing', 'paused', 'resuming']
const failedStatuses = ['partial_failed', 'failed', 'canceled', 'skipped']
const terminalStatuses = ['completed', 'partial_failed', 'failed', 'canceled', 'skipped']
const pauseActionStatuses = ['queued', 'planning', 'running', 'pausing', 'paused', 'resuming']

export function transferStatusLabel(status = '') {
  const labels: Record<string, string> = {
    queued: '排队',
    planning: '扫描中',
    running: '传输中',
    completed: '已完成',
    partial_failed: '部分失败',
    failed: '失败',
    canceled: '已取消',
    skipped: '已跳过',
  }
  const pauseLabels: Record<string, string> = {
    pausing: '暂停中',
    paused: '已暂停',
    resuming: '继续中',
  }
  return pauseLabels[status] ?? labels[status] ?? status
}

export function transferDirectionLabel(direction: SFTPTransferDirection | string = '') {
  return direction === 'upload' ? '上传' : '下载'
}

export function sftpContextKey(connectionId: number, contextId?: string | null) {
  const value = contextId?.trim()
  return value || `server:${connectionId}`
}

export function transferSummary(transfer: SFTPTransferState | null) {
  if (!transfer) return '无传输'
  const running = runningStatuses.includes(transfer.status)
  const source = transfer.mode === 'scp' ? 'SCP ' : ''
  const name = transfer.currentFile || transfer.fileName
  const kind = transfer.recursive || transfer.sourceType === 'directory' ? '目录' : ''
  const fileProgress = transfer.recursive && transfer.filesTotal
    ? ` ${transfer.filesDone ?? 0}/${transfer.filesTotal} 项`
    : ''
  const byteProgress = transfer.recursive && transfer.totalBytes
    ? ` ${formatBytes(transfer.transferredBytes || 0)}/${formatBytes(transfer.totalBytes)}`
    : ''
  const progress = running
    ? `${Math.round(transfer.percent || 0)}%${fileProgress}${byteProgress} ${formatRate(transfer.speedBytesPerSecond || null)}`
    : transfer.status === 'planning'
      ? '扫描中'
      : transferStatusLabel(transfer.status)
  return `${source}${transferDirectionLabel(transfer.direction)}${kind}：${name} ${progress}`
}

export function buildTransferRows(transfers: SFTPTransferState[]): WorkspaceTransferRowModel[] {
  return transfers.slice().reverse().map((transfer) => {
    const recursive = Boolean(transfer.recursive || transfer.sourceType === 'directory')
    const title = transfer.currentFile || transfer.fileName
    const directionText = transferDirectionLabel(transfer.direction)
    return {
      id: transfer.id,
      transfer,
      directionText,
      leadingText: `${transfer.mode === 'scp' ? 'SCP ' : ''}${directionText}${recursive ? '目录' : ''}`,
      title,
      percentValue: transfer.percent || 0,
      percentText: `${Math.round(transfer.percent || 0)}%`,
      statusText: transferStatusLabel(transfer.status),
      detailText: transfer.recursive
        ? `${transfer.filesDone ?? 0}/${transfer.filesTotal ?? 0} 项`
        : formatRate(transfer.speedBytesPerSecond || null),
      showPauseAction: showTransferPauseAction(transfer),
      pauseActionLabel: transferPauseActionLabel(transfer),
      pauseDisabled: transfer.status === 'pausing' || transfer.status === 'resuming',
      canCancel: canCancelTransfer(transfer),
      recursiveStatsText: transfer.recursive
        ? `${formatBytes(transfer.transferredBytes || 0)}/${formatBytes(transfer.totalBytes || 0)} · 失败 ${transfer.failedCount ?? 0} · 跳过 ${transfer.skippedCount ?? 0}`
        : '',
      errorMessage: transfer.errorMessage,
    }
  })
}

export function buildTransferStats(transfers: SFTPTransferState[]): WorkspaceTransferStats {
  return transfers.reduce<WorkspaceTransferStats>((stats, transfer) => {
    stats.total += 1
    if (activeStatuses.includes(transfer.status)) stats.active += 1
    if (transfer.status === 'queued') stats.queued += 1
    if (failedStatuses.includes(transfer.status)) stats.failed += 1
    if (transfer.status === 'completed') stats.completed += 1
    return stats
  }, { active: 0, queued: 0, failed: 0, completed: 0, total: 0 })
}

export function isTerminalTransferStatus(status: string) {
  return terminalStatuses.includes(status)
}

export function transferMatchesContext(
  transfer: TransferContext,
  activeServerId: number | null | undefined,
  activeSftpContextId?: string | null,
) {
  if (!activeServerId || transfer.connectionId !== activeServerId) return false
  if (!activeSftpContextId) return true
  return sftpContextKey(transfer.connectionId, transfer.contextId) === activeSftpContextId
}

export function transferTerminalMessage(transfer: TransferTerminalNotification) {
  const direction = transfer.direction === 'upload' ? '上传' : '下载'
  const kind = transfer.recursive || transfer.sourceType === 'directory' ? '目录' : '文件'
  if (transfer.status === 'completed') return `${direction}${kind}完成`
  if (transfer.status === 'partial_failed') {
    const failed = transfer.failedCount ?? 0
    const skipped = transfer.skippedCount ?? 0
    const parts = [
      failed > 0 ? `${failed} 个失败` : '',
      skipped > 0 ? `${skipped} 个跳过` : '',
    ].filter(Boolean)
    return `${direction}${kind}完成，但有 ${parts.join('、') || '部分项目未完成'}。`
  }
  if (transfer.status === 'canceled') return '传输已取消'
  if (transfer.status === 'skipped') return '传输已跳过'
  return transfer.errorMessage || `${direction}${kind}失败`
}

export function transferTerminalToastType(status: string): WorkspaceTransferToastType {
  if (status === 'completed') return 'success'
  if (status === 'canceled' || status === 'skipped') return 'info'
  return 'error'
}

export function canCancelTransfer(transfer: SFTPTransferState) {
  return transfer.canCancel ?? transfer.cancelable ?? ['planning', 'running', 'queued', 'pausing', 'paused', 'resuming'].includes(transfer.status)
}

export function canPauseTransfer(transfer: SFTPTransferState) {
  return transfer.canPause ?? ['queued', 'planning', 'running', 'resuming'].includes(transfer.status)
}

export function canResumeTransfer(transfer: SFTPTransferState) {
  return transfer.canResume ?? transfer.status === 'paused'
}

export function transferPauseActionLabel(transfer: SFTPTransferState) {
  if (transfer.status === 'pausing') return '暂停中'
  if (transfer.status === 'paused') return '继续'
  if (transfer.status === 'resuming') return '继续中'
  return '暂停'
}

export function showTransferPauseAction(transfer: SFTPTransferState) {
  return pauseActionStatuses.includes(transfer.status)
}
