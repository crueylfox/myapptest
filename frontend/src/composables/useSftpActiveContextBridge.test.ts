// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  resolveActiveSftpContextIntent,
  selectReconnectableSftpContexts,
  sftpContextKey,
  useSftpActiveContextBridge,
} from './useSftpActiveContextBridge'
import type { SFTPState, SFTPTransferState, TerminalStatusEvent } from '../types'

const sftpState = (values: Partial<SFTPState> = {}): SFTPState => ({
  connectionId: 7,
  contextId: '',
  terminalSessionId: '',
  status: 'offline',
  active: false,
  currentPath: '',
  message: '',
  updatedAt: '',
  ...values,
})

const transfer = (values: Partial<SFTPTransferState> = {}): SFTPTransferState => ({
  id: 'transfer-1',
  connectionId: 7,
  direction: 'upload',
  localPath: '',
  remotePath: '',
  fileName: '',
  totalBytes: 0,
  transferredBytes: 0,
  percent: 0,
  speedBytesPerSecond: 0,
  status: 'queued',
  errorMessage: '',
  startedAt: '',
  finishedAt: '',
  ...values,
})

const terminalEvent = (values: Partial<TerminalStatusEvent> = {}): TerminalStatusEvent => ({
  sessionId: 'term-1',
  connectionId: 7,
  status: 'online',
  code: '',
  message: '',
  active: true,
  ...values,
})

describe('useSftpActiveContextBridge', () => {
  it('produces an SFTP activation intent for the active SSH pane', () => {
    expect(resolveActiveSftpContextIntent({
      activePaneAssignment: { kind: 'ssh', sessionId: 'term-1' },
      activeSshTab: { sessionId: 'term-1', connectionId: 7 },
    })).toEqual({
      type: 'activate',
      connectionId: 7,
      contextId: 'term-1',
      terminalSessionId: 'term-1',
    })
  })

  it('returns no-op for an active Local pane and never creates a reconnect intent', () => {
    expect(resolveActiveSftpContextIntent({
      activePaneAssignment: { kind: 'local', sessionId: 'local-1' },
      activeSshTab: null,
    })).toEqual({ type: 'noop' })
  })

  it('returns no-op for stale SSH pane snapshots', () => {
    expect(resolveActiveSftpContextIntent({
      activePaneAssignment: { kind: 'ssh', sessionId: 'missing' },
      activeSshTab: null,
    })).toEqual({ type: 'noop' })
  })

  it('selects only opened SFTP contexts for reconnect and skips running transfers', () => {
    const contexts = selectReconnectableSftpContexts({
      connectionId: 7,
      terminalSessionId: 'term-1',
      statesByContextId: {
        'term-1': sftpState({
          connectionId: 7,
          contextId: 'term-1',
          terminalSessionId: '',
          status: 'online',
          active: true,
        }),
        'term-2': sftpState({
          connectionId: 7,
          contextId: 'term-2',
          terminalSessionId: 'term-2',
          status: 'error',
        }),
        stale: sftpState({
          connectionId: 8,
          contextId: 'stale',
          status: 'online',
        }),
        connecting: sftpState({
          connectionId: 7,
          contextId: 'connecting',
          status: 'connecting',
        }),
      },
      serverState: sftpState({
        connectionId: 7,
        status: 'online',
        active: true,
      }),
      transfersById: {
        t1: transfer({ connectionId: 7, contextId: 'term-2', status: 'running' }),
      },
      entriesCount: vi.fn((connectionId, contextId) => connectionId === 7 && contextId === 'with-entries' ? 2 : 0),
    })

    expect(contexts).toEqual([
      { contextId: 'term-1', terminalSessionId: 'term-1' },
      { contextId: 'server:7', terminalSessionId: '' },
    ])
  })

  it('treats context keys consistently for explicit and default server contexts', () => {
    expect(sftpContextKey(7, 'term-1')).toBe('term-1')
    expect(sftpContextKey(7, '')).toBe('server:7')
    expect(sftpContextKey(7, undefined)).toBe('server:7')
  })

  it('emits reconnect intent only for marked terminal online events and clears pending on failure', () => {
    const bridge = useSftpActiveContextBridge()

    bridge.markTerminalFileReconnectPending(7, 'term-1')
    expect(bridge.hasTerminalFileReconnectPending(7, 'term-1')).toBe(true)

    expect(bridge.resolveTerminalStatusReconnectIntent(terminalEvent({ status: 'offline' }))).toEqual({ type: 'clear-pending' })
    expect(bridge.hasTerminalFileReconnectPending(7, 'term-1')).toBe(false)

    bridge.markTerminalFileReconnectPending(7, 'term-1')
    expect(bridge.resolveTerminalStatusReconnectIntent(terminalEvent())).toEqual({
      type: 'reconnect-file-contexts',
      connectionId: 7,
      terminalSessionId: 'term-1',
    })
    expect(bridge.hasTerminalFileReconnectPending(7, 'term-1')).toBe(false)
  })

  it('does not write terminal output, remote file content, or credentials to localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const bridge = useSftpActiveContextBridge()

    bridge.markTerminalFileReconnectPending(7, 'term-1')
    bridge.resolveTerminalStatusReconnectIntent(terminalEvent())

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(bridge)).not.toContain('password')
    expect(JSON.stringify(bridge)).not.toContain('remote file')
  })
})
