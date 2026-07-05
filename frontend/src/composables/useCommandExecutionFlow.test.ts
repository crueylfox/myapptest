// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { useCommandExecutionFlow } from './useCommandExecutionFlow'

describe('useCommandExecutionFlow', () => {
  it('inserts and executes commands against the active writable SSH target', async () => {
    const writeTerminal = vi.fn(async () => undefined)
    const recordHistory = vi.fn(async () => ({ recorded: true, skipped: false, reasonCode: '', message: '' }))
    const observeTerminalInput = vi.fn(() => false)
    const flow = useCommandExecutionFlow({
      getActiveCommandTarget: () => ({ sessionId: 'term-1', connectionId: 7, status: 'online' }),
      writeTerminal,
      observeTerminalInput,
      recordHistory,
      notify: vi.fn(),
      recordHistoryFailure: vi.fn(),
    })

    await expect(flow.insertCommand('df -h')).resolves.toEqual({ ok: true, action: 'insert', sessionId: 'term-1' })
    expect(observeTerminalInput).toHaveBeenCalledWith('term-1', 'df -h')
    expect(writeTerminal).toHaveBeenCalledWith('term-1', btoa('df -h'), expect.any(Object))
    expect(recordHistory).not.toHaveBeenCalled()

    await expect(flow.executeCommand('uptime')).resolves.toEqual({ ok: true, action: 'execute', sessionId: 'term-1' })
    expect(observeTerminalInput).toHaveBeenLastCalledWith('term-1', 'uptime\r')
    expect(writeTerminal).toHaveBeenLastCalledWith('term-1', btoa('uptime\r'), expect.objectContaining({ connectionId: 7 }))
    expect(recordHistory).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 7, sessionId: 'term-1', command: 'uptime', localHistoryScope: undefined })
  })

  it('inserts and executes commands against a local terminal target without using a remote server id', async () => {
    const writeTerminal = vi.fn(async () => undefined)
    const recordHistory = vi.fn(async () => ({ recorded: true, skipped: false, reasonCode: '', message: '' }))
    const observeTerminalInput = vi.fn(() => false)
    const flow = useCommandExecutionFlow({
      getActiveCommandTarget: () => ({
        kind: 'local',
        sessionId: 'local-cmd',
        connectionId: -1001,
        status: 'online',
        localHistoryScope: 'local:cmd',
      }),
      writeTerminal,
      observeTerminalInput,
      recordHistory,
      notify: vi.fn(),
      recordHistoryFailure: vi.fn(),
    })

    await expect(flow.insertCommand('dir')).resolves.toEqual({ ok: true, action: 'insert', sessionId: 'local-cmd' })
    expect(writeTerminal).toHaveBeenCalledWith('local-cmd', btoa('dir'), expect.objectContaining({ kind: 'local' }))
    expect(recordHistory).not.toHaveBeenCalled()

    await expect(flow.executeCommand('Get-Date')).resolves.toEqual({ ok: true, action: 'execute', sessionId: 'local-cmd' })
    expect(writeTerminal).toHaveBeenLastCalledWith('local-cmd', btoa('Get-Date\r'), expect.objectContaining({ kind: 'local' }))
    expect(recordHistory).toHaveBeenCalledWith({
      kind: 'local',
      connectionId: -1001,
      sessionId: 'local-cmd',
      command: 'Get-Date',
      localHistoryScope: 'local:cmd',
    })
  })

  it('does not write to the previous SSH pane when no active writable SSH target exists', async () => {
    const writeTerminal = vi.fn(async () => undefined)
    const notify = vi.fn()
    const flow = useCommandExecutionFlow({
      getActiveCommandTarget: () => null,
      writeTerminal,
      observeTerminalInput: vi.fn(),
      recordHistory: vi.fn(),
      notify,
      recordHistoryFailure: vi.fn(),
    })

    await expect(flow.insertCommand('hostname')).resolves.toEqual({
      ok: false,
      action: 'insert',
      reason: 'no-active-terminal',
    })
    expect(writeTerminal).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('当前没有可用的终端会话', 'error')
  })

  it('keeps final edited Enter history capture by skipping immediate history when the terminal observes the execute draft', async () => {
    const recordHistory = vi.fn()
    const flow = useCommandExecutionFlow({
      getActiveCommandTarget: () => ({ sessionId: 'term-1', connectionId: 7, status: 'online' }),
      writeTerminal: vi.fn(async () => undefined),
      observeTerminalInput: vi.fn(() => true),
      recordHistory,
      notify: vi.fn(),
      recordHistoryFailure: vi.fn(),
    })

    await flow.executeCommand('vim /etc/config/network')

    expect(recordHistory).not.toHaveBeenCalled()
  })

  it('uses existing command-history service results for sensitive command handling without storing command text locally', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const notify = vi.fn()
    const flow = useCommandExecutionFlow({
      getActiveCommandTarget: () => ({ sessionId: 'term-1', connectionId: 7, status: 'online' }),
      writeTerminal: vi.fn(async () => undefined),
      observeTerminalInput: vi.fn(() => false),
      recordHistory: vi.fn(async () => ({
        recorded: false,
        skipped: true,
        reasonCode: 'SENSITIVE',
        message: '该命令可能包含敏感信息，已跳过历史记录',
      })),
      notify,
      recordHistoryFailure: vi.fn(),
    })

    await flow.executeCommand('history-service-rejected-sensitive-sample')

    expect(notify).toHaveBeenCalledWith('该命令可能包含敏感信息，已跳过历史记录', 'info')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('returns an error intent when terminal write fails and does not record history', async () => {
    const recordHistory = vi.fn()
    const notify = vi.fn()
    const flow = useCommandExecutionFlow({
      getActiveCommandTarget: () => ({ sessionId: 'term-1', connectionId: 7, status: 'online' }),
      writeTerminal: vi.fn(async () => { throw new Error('WRITE_FAILED') }),
      observeTerminalInput: vi.fn(() => false),
      recordHistory,
      notify,
      recordHistoryFailure: vi.fn(),
    })

    await expect(flow.executeCommand('date')).resolves.toEqual({
      ok: false,
      action: 'execute',
      reason: 'write-failed',
      sessionId: 'term-1',
    })
    expect(recordHistory).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('WRITE_FAILED', 'error')
  })
})
