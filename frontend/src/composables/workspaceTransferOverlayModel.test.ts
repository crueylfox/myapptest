import { describe, expect, it } from 'vitest'
import type { SFTPTransferState } from '../types'
import {
  buildTransferRows,
  buildTransferStats,
  canCancelTransfer,
  canPauseTransfer,
  canResumeTransfer,
  isTerminalTransferStatus,
  sftpContextKey,
  showTransferPauseAction,
  transferDirectionLabel,
  transferMatchesContext,
  transferPauseActionLabel,
  transferStatusLabel,
  transferSummary,
  transferTerminalMessage,
  transferTerminalToastType,
} from './workspaceTransferOverlayModel'

function transfer(values: Partial<SFTPTransferState> = {}): SFTPTransferState {
  return {
    id: 'transfer-1',
    connectionId: 7,
    contextId: 'server:7',
    direction: 'upload',
    recursive: false,
    sourceType: 'file',
    localPath: 'fake-local.txt',
    remotePath: '/fake/fake-local.txt',
    fileName: 'fake-local.txt',
    currentFile: '',
    totalBytes: 1024,
    transferredBytes: 512,
    filesTotal: 0,
    filesDone: 0,
    failedCount: 0,
    skippedCount: 0,
    percent: 50,
    speedBytesPerSecond: 1024,
    status: 'running',
    errorMessage: '',
    startedAt: '',
    finishedAt: '',
    ...values,
  }
}

describe('workspaceTransferOverlayModel', () => {
  it('keeps transfer labels, summaries, and pause actions compatible with the workspace status bar', () => {
    expect(transferSummary(null)).toBe('无传输')
    expect(transferStatusLabel('pausing')).toBe('暂停中')
    expect(transferStatusLabel('paused')).toBe('已暂停')
    expect(transferStatusLabel('resuming')).toBe('继续中')
    expect(transferDirectionLabel('download')).toBe('下载')
    expect(transferSummary(transfer({
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
    expect(showTransferPauseAction(transfer({ status: 'queued' }))).toBe(true)
    expect(transferPauseActionLabel(transfer({ status: 'paused' }))).toBe('继续')
  })

  it('builds stable row models, reversed ordering, and status counts without storing transfer contents', () => {
    const first = transfer({ id: 'first', status: 'completed', fileName: 'first.txt', currentFile: '' })
    const second = transfer({ id: 'second', status: 'failed', fileName: 'second.txt', errorMessage: 'failed for fake reason' })
    const third = transfer({ id: 'third', status: 'queued', fileName: 'third.txt' })

    expect(buildTransferRows([first, second, third]).map((row) => row.id)).toEqual(['third', 'second', 'first'])
    expect(buildTransferStats([first, second, third])).toEqual({
      active: 1,
      queued: 1,
      failed: 1,
      completed: 1,
      total: 3,
    })
    expect(buildTransferRows([second])[0]).toMatchObject({
      directionText: '上传',
      title: 'second.txt',
      statusText: '失败',
      percentText: '50%',
      canCancel: false,
    })
  })

  it('keeps terminal notification and active-context semantics unchanged', () => {
    expect(sftpContextKey(7, '')).toBe('server:7')
    expect(transferMatchesContext(transfer({ connectionId: 7, contextId: 'term-1' }), 7, 'term-1')).toBe(true)
    expect(transferMatchesContext(transfer({ connectionId: 7, contextId: 'term-1' }), 7, 'term-2')).toBe(false)
    expect(transferMatchesContext(transfer({ connectionId: 8, contextId: 'term-1' }), 7, 'term-1')).toBe(false)

    expect(isTerminalTransferStatus('completed')).toBe(true)
    expect(isTerminalTransferStatus('running')).toBe(false)
    expect(transferTerminalMessage(transfer({ direction: 'download', status: 'completed' }))).toBe('下载文件完成')
    expect(transferTerminalMessage(transfer({
      recursive: true,
      sourceType: 'directory',
      status: 'partial_failed',
      failedCount: 1,
      skippedCount: 2,
    }))).toBe('上传目录完成，但有 1 个失败、2 个跳过。')
    expect(transferTerminalToastType('completed')).toBe('success')
    expect(transferTerminalToastType('skipped')).toBe('info')
    expect(transferTerminalToastType('failed')).toBe('error')
  })

  it('centralizes transfer action availability without backend or terminal runtime calls', () => {
    expect(canCancelTransfer(transfer({ status: 'running' }))).toBe(true)
    expect(canCancelTransfer(transfer({ status: 'completed' }))).toBe(false)
    expect(canPauseTransfer(transfer({ status: 'running' }))).toBe(true)
    expect(canPauseTransfer(transfer({ status: 'paused' }))).toBe(false)
    expect(canResumeTransfer(transfer({ status: 'paused' }))).toBe(true)
    expect(canResumeTransfer(transfer({ status: 'running' }))).toBe(false)
  })
})
