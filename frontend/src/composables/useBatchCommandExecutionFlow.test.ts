// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { useBatchCommandExecutionFlow } from './useBatchCommandExecutionFlow'

describe('useBatchCommandExecutionFlow', () => {
  it('re-resolves selected targets, writes commands with Enter, and records one batch history row', async () => {
    const writeTerminal = vi.fn(async () => undefined)
    const recordBatchHistory = vi.fn(async () => ({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
      targetCount: 2,
    }))
    const flow = useBatchCommandExecutionFlow({
      resolveTarget: (serverID) => ({
        serverID,
        terminalSessionID: serverID === 1 ? 'term-1-recent' : 'term-5',
        writable: true,
      }),
      writeTerminal,
      recordBatchHistory,
      reloadHistory: vi.fn(async () => undefined),
      createSubmissionID: () => 'batch-test-1',
    })

    const result = await flow.executeBatchCommand({
      command: 'uptime',
      selectedTargets: [{ serverID: 1 }, { serverID: 5 }],
    })

    expect(writeTerminal).toHaveBeenCalledTimes(2)
    expect(writeTerminal).toHaveBeenCalledWith('term-1-recent', btoa('uptime\r'))
    expect(writeTerminal).toHaveBeenCalledWith('term-5', btoa('uptime\r'))
    expect(recordBatchHistory).toHaveBeenCalledTimes(1)
    expect(recordBatchHistory).toHaveBeenCalledWith({
      command: 'uptime',
      successfulServerIds: [1, 5],
      submissionId: 'batch-test-1',
    })
    expect(result.toast).toEqual({
      message: '已将命令发送到 2 台在线服务器，并写入历史记录。',
      type: 'success',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected batch command to succeed, got ${result.reason}`)
    expect(result.successfulTargets).toEqual([
      { ok: true, serverID: 1, terminalSessionID: 'term-1-recent' },
      { ok: true, serverID: 5, terminalSessionID: 'term-5' },
    ])
  })

  it('returns disabled intents for empty commands or no selected targets', async () => {
    const writeTerminal = vi.fn()
    const flow = useBatchCommandExecutionFlow({
      resolveTarget: vi.fn(),
      writeTerminal,
      recordBatchHistory: vi.fn(),
      reloadHistory: vi.fn(),
      createSubmissionID: () => 'batch-test-2',
    })

    await expect(flow.executeBatchCommand({ command: '   ', selectedTargets: [{ serverID: 1 }] })).resolves.toEqual({
      ok: false,
      reason: 'empty-command',
      toast: { message: '请输入要执行的命令。', type: 'error' },
    })
    await expect(flow.executeBatchCommand({ command: 'date', selectedTargets: [] })).resolves.toEqual({
      ok: false,
      reason: 'no-targets',
      toast: { message: '请选择至少一台在线 SSH 终端。', type: 'error' },
    })
    expect(writeTerminal).not.toHaveBeenCalled()
  })

  it('skips stale or failed targets without creating stdout or stderr result cards', async () => {
    const recordBatchHistory = vi.fn(async () => ({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
      targetCount: 1,
    }))
    const flow = useBatchCommandExecutionFlow({
      resolveTarget: (serverID) => serverID === 1
        ? { serverID, terminalSessionID: 'term-1', writable: true }
        : { serverID, terminalSessionID: '', writable: false },
      writeTerminal: vi.fn(async (sessionID) => {
        if (sessionID === 'term-1') return
        throw new Error('not reached')
      }),
      recordBatchHistory,
      reloadHistory: vi.fn(async () => undefined),
      createSubmissionID: () => 'batch-test-3',
    })

    const result = await flow.executeBatchCommand({
      command: 'hostname',
      selectedTargets: [{ serverID: 1 }, { serverID: 2 }],
    })

    expect(recordBatchHistory).toHaveBeenCalledWith({
      command: 'hostname',
      successfulServerIds: [1],
      submissionId: 'batch-test-3',
    })
    expect(JSON.stringify(result)).not.toContain('stdout')
    expect(JSON.stringify(result)).not.toContain('stderr')
    expect(result.toast).toEqual({
      message: '已发送到 1 台并写入历史记录，1 台发送失败或终端已关闭。',
      type: 'error',
    })
  })

  it('uses the existing batch history service result for sensitive command skip semantics', async () => {
    const flow = useBatchCommandExecutionFlow({
      resolveTarget: (serverID) => ({ serverID, terminalSessionID: 'term-1', writable: true }),
      writeTerminal: vi.fn(async () => undefined),
      recordBatchHistory: vi.fn(async () => ({
        recorded: false,
        skipped: true,
        reasonCode: 'SENSITIVE',
        message: '该命令可能包含敏感信息，已跳过历史记录',
        targetCount: 1,
      })),
      reloadHistory: vi.fn(async () => undefined),
      createSubmissionID: () => 'batch-test-4',
    })

    const result = await flow.executeBatchCommand({
      command: 'history-service-rejected-sensitive-sample',
      selectedTargets: [{ serverID: 1 }],
    })

    expect(result.toast).toEqual({
      message: '命令已发送；根据历史记录安全规则，本次命令未保存。',
      type: 'success',
    })
  })
})
