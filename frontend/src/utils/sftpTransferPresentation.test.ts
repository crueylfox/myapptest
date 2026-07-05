import { describe, expect, it } from 'vitest'
import type { SFTPTransferState } from '../types'
import { sftpTransferStatusText, sftpTransferSummary } from './sftpTransferPresentation'

function transfer(values: Partial<SFTPTransferState> = {}): SFTPTransferState {
  return {
    id: 'transfer-1',
    connectionId: 7,
    direction: 'upload',
    recursive: false,
    sourceType: 'file',
    localPath: 'local-file.txt',
    remotePath: '/tmp/local-file.txt',
    fileName: 'local-file.txt',
    totalBytes: 1024,
    transferredBytes: 512,
    filesTotal: 0,
    filesDone: 0,
    percent: 50,
    speedBytesPerSecond: 1024,
    status: 'running',
    errorMessage: '',
    startedAt: '',
    finishedAt: '',
    ...values,
  }
}

describe('sftp transfer presentation helpers', () => {
  it('maps transfer statuses to the compact labels used by the toolbar', () => {
    expect(sftpTransferStatusText(null)).toBe('无传输')
    expect(sftpTransferStatusText(transfer({ status: 'queued' }))).toBe('排队')
    expect(sftpTransferStatusText(transfer({ status: 'planning' }))).toBe('扫描中')
    expect(sftpTransferStatusText(transfer({ status: 'completed' }))).toBe('已完成')
    expect(sftpTransferStatusText(transfer({ status: 'partial_failed' }))).toBe('部分失败')
    expect(sftpTransferStatusText(transfer({ status: 'failed' }))).toBe('失败')
    expect(sftpTransferStatusText(transfer({ status: 'canceled' }))).toBe('已取消')
    expect(sftpTransferStatusText(transfer({ status: 'skipped' }))).toBe('已跳过')
  })

  it('formats a running file upload summary with percent and transfer rate', () => {
    expect(sftpTransferSummary(transfer())).toBe('上传文件：local-file.txt 50% 1.00 KB/s')
  })

  it('formats recursive SCP download progress with file and byte counts', () => {
    expect(sftpTransferSummary(transfer({
      mode: 'scp',
      direction: 'download',
      recursive: true,
      sourceType: 'directory',
      currentFile: 'nested.txt',
      fileName: 'bundle',
      totalBytes: 2048,
      transferredBytes: 1024,
      filesTotal: 4,
      filesDone: 2,
      percent: 25,
      speedBytesPerSecond: 2048,
    }))).toBe('SCP 下载目录：nested.txt 25% 2/4 项 1.00 KB/2.00 KB 2.00 KB/s')
  })

  it('uses planning and final status text for non-running summaries', () => {
    expect(sftpTransferSummary(transfer({ status: 'planning' }))).toBe('上传文件：local-file.txt 扫描中')
    expect(sftpTransferSummary(transfer({ status: 'completed', percent: 100 }))).toBe('上传文件：local-file.txt 已完成')
    expect(sftpTransferSummary(null)).toBe('')
  })
})
