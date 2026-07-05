import type { SFTPTransferState } from '../types'
import { formatBytes, formatRate } from './format'

export function sftpTransferStatusText(transfer: SFTPTransferState | null) {
  if (!transfer) return '无传输'
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
  return labels[transfer.status] ?? transfer.status
}

export function sftpTransferSummary(transfer: SFTPTransferState | null) {
  if (!transfer) return ''
  const source = transfer.mode === 'scp' ? 'SCP ' : ''
  const direction = transfer.direction === 'upload' ? '上传' : '下载'
  const name = transfer.currentFile || transfer.fileName
  const kind = transfer.recursive || transfer.sourceType === 'directory' ? '目录' : '文件'
  const fileProgress = transfer.recursive && transfer.filesTotal
    ? ` ${transfer.filesDone ?? 0}/${transfer.filesTotal} 项`
    : ''
  const byteProgress = transfer.recursive && transfer.totalBytes
    ? ` ${formatBytes(transfer.transferredBytes || 0)}/${formatBytes(transfer.totalBytes)}`
    : ''
  const progress = transfer.status === 'running' || transfer.status === 'queued'
    ? `${Math.round(transfer.percent || 0)}%${fileProgress}${byteProgress} ${formatRate(transfer.speedBytesPerSecond || null)}`
    : transfer.status === 'planning'
      ? '扫描中'
      : sftpTransferStatusText(transfer)
  return `${source}${direction}${kind}：${name} ${progress}`
}
