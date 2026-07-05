import { describe, expect, it, vi } from 'vitest'
import type { SFTPTransferState } from '../types'
import { useWorkspaceTransferActions } from './useWorkspaceTransferActions'

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

describe('useWorkspaceTransferActions', () => {
  it('dispatches cancel, pause, resume, and clear through injected callbacks only', async () => {
    const cancel = vi.fn(async () => undefined)
    const pause = vi.fn(async () => undefined)
    const resume = vi.fn(async () => undefined)
    const clearCurrent = vi.fn()
    const clearAll = vi.fn()
    const notify = vi.fn()
    const actions = useWorkspaceTransferActions({
      cancelTransfer: cancel,
      pauseTransfer: pause,
      resumeTransfer: resume,
      clearCompleted: clearCurrent,
      clearCompletedAll: clearAll,
      activeServerId: () => 7,
      activeSftpContextId: () => 'server:7',
      transferScope: () => 'current',
      notify,
      errorMessage: (reason, fallback) => `${fallback}: ${String(reason).replace(/^Error:\s*/, '')}`,
    })

    await actions.cancelTransfer(transfer({ id: 'cancel-me', status: 'running' }))
    await actions.pauseTransfer(transfer({ id: 'pause-me', status: 'running' }))
    await actions.resumeTransfer(transfer({ id: 'resume-me', status: 'paused' }))
    actions.clearFinishedTransfers()

    expect(cancel).toHaveBeenCalledWith('cancel-me')
    expect(pause).toHaveBeenCalledWith('pause-me')
    expect(resume).toHaveBeenCalledWith('resume-me')
    expect(clearCurrent).toHaveBeenCalledWith(7, 'server:7')
    expect(clearAll).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('传输已暂停', 'info')
    expect(notify).toHaveBeenCalledWith('传输已继续', 'success')
  })

  it('does not execute disabled actions and clears all finished transfers in all-server scope', async () => {
    const cancel = vi.fn(async () => undefined)
    const pause = vi.fn(async () => undefined)
    const resume = vi.fn(async () => undefined)
    const clearAll = vi.fn()
    const actions = useWorkspaceTransferActions({
      cancelTransfer: cancel,
      pauseTransfer: pause,
      resumeTransfer: resume,
      clearCompleted: vi.fn(),
      clearCompletedAll: clearAll,
      activeServerId: () => null,
      activeSftpContextId: () => null,
      transferScope: () => 'all',
      notify: vi.fn(),
      errorMessage: (_reason, fallback) => fallback,
    })

    await actions.cancelTransfer(transfer({ status: 'completed' }))
    await actions.pauseTransfer(transfer({ status: 'paused' }))
    await actions.resumeTransfer(transfer({ status: 'running' }))
    await actions.toggleTransferPause(transfer({ status: 'completed' }))
    actions.clearFinishedTransfers()

    expect(cancel).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(clearAll).toHaveBeenCalledTimes(1)
  })

  it('routes action failures through the injected error-message and notify helpers', async () => {
    const notify = vi.fn()
    const actions = useWorkspaceTransferActions({
      cancelTransfer: vi.fn(async () => undefined),
      pauseTransfer: vi.fn(async () => { throw new Error('pause failed') }),
      resumeTransfer: vi.fn(async () => { throw new Error('resume failed') }),
      clearCompleted: vi.fn(),
      clearCompletedAll: vi.fn(),
      activeServerId: () => 7,
      activeSftpContextId: () => 'server:7',
      transferScope: () => 'current',
      notify,
      errorMessage: (reason, fallback) => `${fallback}: ${String(reason).replace(/^Error:\s*/, '')}`,
    })

    await actions.pauseTransfer(transfer({ status: 'running' }))
    await actions.resumeTransfer(transfer({ status: 'paused' }))

    expect(notify).toHaveBeenCalledWith('暂停传输失败: pause failed', 'error')
    expect(notify).toHaveBeenCalledWith('继续传输失败: resume failed', 'error')
  })

  it('does not import backend, stores, localStorage, or terminal runtime APIs', async () => {
    // @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./useWorkspaceTransferActions.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('WriteTerminal')
    expect(source).not.toContain('DisconnectServer')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
  })
})
