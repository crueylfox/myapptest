// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useLocalTerminalStore } from './localTerminal'
import type { LocalTerminalOutputEvent, LocalTerminalStateEvent } from '../types'

const runtimeState = vi.hoisted(() => ({
  eventCallbacks: new Map<string, (event: unknown) => void>(),
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => {
    runtimeState.eventCallbacks.set(name, callback)
  }),
  EventsOff: vi.fn(),
}))

function stateEvent(sessionId: string, status: 'starting' | 'running' | 'exited' = 'running'): LocalTerminalStateEvent {
  return {
    state: {
      sessionId,
      shellKind: 'powershell',
      shell: 'PowerShell',
      shellName: 'powershell.exe',
      elevated: false,
      title: 'PowerShell',
      cwd: 'C:\\Users\\Administrator',
      status,
      exitCode: status === 'exited' ? 0 : null,
      error: '',
      startedAt: '2026-06-17T00:00:00Z',
      endedAt: status === 'exited' ? '2026-06-17T00:00:01Z' : '',
    },
    timestamp: '2026-06-17T00:00:00Z',
  }
}

function outputEvent(sessionId: string, dataBase64: string): LocalTerminalOutputEvent {
  return {
    sessionId,
    dataBase64,
    timestamp: '2026-06-17T00:00:00Z',
  }
}

describe('local terminal store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtimeState.eventCallbacks.clear()
    vi.clearAllMocks()
  })

  it('upserts state events and API responses by sessionID without duplicate tabs', async () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()
    window.go = {
      main: {
        App: {
          OpenLocalTerminal: vi.fn(async () => {
            runtimeState.eventCallbacks.get('localterminal:state')?.(stateEvent('local-1', 'starting'))
            return {
              sessionId: 'local-1',
              shellKind: 'powershell',
              shell: 'PowerShell',
              shellName: 'powershell.exe',
              elevated: false,
              title: 'PowerShell',
              status: 'running',
              cwd: 'C:\\Users\\Administrator',
              startedAt: '2026-06-17T00:00:00Z',
            }
          }),
        } as never,
      },
    }

    await store.open('powershell', false, 100, 30)
    runtimeState.eventCallbacks.get('localterminal:state')?.(stateEvent('local-1', 'running'))

    expect(window.go.main?.App?.OpenLocalTerminal).toHaveBeenCalledTimes(1)
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].sessionId).toBe('local-1')
    expect(store.sessions[0].status).toBe('running')
    expect(store.activeSessionId).toBe('local-1')
  })

  it('guards concurrent open calls so one click cannot create two local sessions', async () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    let resolveOpen!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveOpen = resolve })
    window.go = {
      main: {
        App: {
          OpenLocalTerminal: vi.fn(() => pending),
        } as never,
      },
    }

    const first = store.open('cmd', false, 0, 0)
    const second = store.open('cmd', false, 0, 0)
    expect(window.go.main?.App?.OpenLocalTerminal).toHaveBeenCalledTimes(1)

    resolveOpen({
      sessionId: 'local-2',
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      elevated: false,
      title: 'CMD',
      status: 'running',
      cwd: 'C:\\',
      startedAt: '2026-06-17T00:00:00Z',
    })
    await Promise.all([first, second])

    expect(window.go.main?.App?.OpenLocalTerminal).toHaveBeenCalledWith({
      shell: '',
      shellKind: 'cmd',
      elevated: false,
      cwd: '',
      cols: 80,
      rows: 24,
    })
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].sessionId).toBe('local-2')
  })

  it('does not create a blank tab when OpenLocalTerminal fails', async () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    window.go = {
      main: {
        App: {
          OpenLocalTerminal: vi.fn(async () => {
            throw new Error('创建本地终端失败')
          }),
        } as never,
      },
    }

    await expect(store.open('cmd', false, 100, 30)).rejects.toThrow('创建本地终端失败')

    expect(window.go.main?.App?.OpenLocalTerminal).toHaveBeenCalledTimes(1)
    expect(store.sessions).toHaveLength(0)
    expect(store.activeSessionId).toBeNull()
  })

  it('blocks opening and ignores late events while disabled', async () => {
    const store = useLocalTerminalStore()
    store.subscribe()
    window.go = {
      main: {
        App: {
          OpenLocalTerminal: vi.fn(async () => {
            throw new Error('must not be called')
          }),
        } as never,
      },
    }

    await expect(store.open('cmd', false, 100, 30)).rejects.toThrow('LOCAL_TERMINAL_DISABLED')
    runtimeState.eventCallbacks.get('localterminal:state')?.(stateEvent('local-disabled', 'running'))

    expect(window.go.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
    expect(store.sessions).toHaveLength(0)
    expect(store.activeSessionId).toBeNull()
  })

  it('closing a local tab only calls CloseLocalTerminal and keeps server shutdown untouched', async () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.sessions.push(stateEvent('local-3').state)
    store.activeSessionId = 'local-3'
    window.go = {
      main: {
        App: {
          CloseLocalTerminal: vi.fn(async () => undefined),
          DisconnectServer: vi.fn(async () => undefined),
        } as never,
      },
    }

    await store.close('local-3')

    expect(window.go.main?.App?.CloseLocalTerminal).toHaveBeenCalledWith('local-3')
    expect(window.go.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(store.sessions).toHaveLength(0)
  })

  it('removes stale local tabs without calling the backend while disabled', async () => {
    const store = useLocalTerminalStore()
    store.sessions.push(stateEvent('local-stale').state)
    store.activeSessionId = 'local-stale'
    window.go = {
      main: {
        App: {
          CloseLocalTerminal: vi.fn(async () => undefined),
          DisconnectServer: vi.fn(async () => undefined),
        } as never,
      },
    }

    await store.close('local-stale')

    expect(window.go.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
    expect(window.go.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(store.sessions).toHaveLength(0)
    expect(store.activeSessionId).toBeNull()
  })

  it('subscribes to isolated local terminal events', () => {
    const store = useLocalTerminalStore()
    store.subscribe()
    expect(EventsOn).toHaveBeenCalledWith('localterminal:state', expect.any(Function))
    expect(EventsOn).toHaveBeenCalledWith('localterminal:output', expect.any(Function))
  })

  it('replays bounded in-memory output to a remounted LocalTerminalView listener', () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()

    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-replay', 'YQ=='))
    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-replay', 'Yg=='))
    const listener = vi.fn()
    store.registerOutput('local-replay', listener)

    expect(listener).toHaveBeenNthCalledWith(1, 'YQ==', { replay: true })
    expect(listener).toHaveBeenNthCalledWith(2, 'Yg==', { replay: true })

    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-replay', 'Yw=='))

    expect(listener).toHaveBeenNthCalledWith(3, 'Yw==', { replay: false })
  })

  it('marks inactive Local Terminal live output as runtime-only unread activity and caps the count', () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()
    store.sessions.push(stateEvent('local-1').state, stateEvent('local-2').state)
    store.activeSessionId = 'local-2'

    for (let index = 0; index < 110; index += 1) {
      runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-1', 'bGl2ZQ=='))
    }

    expect(store.outputActivityBySession['local-1']).toMatchObject({
      hasActivity: true,
      unreadCount: 99,
    })
    expect(store.outputActivityLabel('local-1')).toBe('99+')
    expect(localStorage.getItem('serverpilot.localTerminalActivity')).toBeNull()
  })

  it('does not mark active Local output or replay chunks as unread activity', () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()
    store.sessions.push(stateEvent('local-active').state)
    store.activeSessionId = 'local-active'

    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-active', 'YWN0aXZl'))
    expect(store.outputActivityBySession['local-active']).toBeUndefined()

    store.unregisterOutput('local-active')
    store.registerOutput('local-active', vi.fn())
    expect(store.outputActivityBySession['local-active']).toBeUndefined()
  })

  it('does not mark visible split-pane Local output or pure control chunks as unread activity', () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()
    store.sessions.push(stateEvent('local-1').state, stateEvent('local-2').state)
    store.activeSessionId = 'local-2'

    store.setVisibleOutputSessions(['local-1'])
    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-1', btoa('visible local text')))
    expect(store.outputActivityBySession['local-1']).toBeUndefined()

    store.setVisibleOutputSessions([])
    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-1', btoa('\x1b[?25l\x1b[2K\r\n\x1b]0;title\x07')))
    expect(store.outputActivityBySession['local-1']).toBeUndefined()

    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-1', btoa('hidden local text')))
    expect(store.outputActivityBySession['local-1']?.unreadCount).toBe(1)
  })

  it('clears Local unread activity on activation and close', async () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()
    store.sessions.push(stateEvent('local-1').state, stateEvent('local-2').state)
    store.activeSessionId = 'local-2'
    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-1', 'aW5hY3RpdmU='))
    expect(store.outputActivityBySession['local-1']?.hasActivity).toBe(true)

    store.activate('local-1')
    expect(store.outputActivityBySession['local-1']).toBeUndefined()

    runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-2', 'aW5hY3RpdmU='))
    window.go = {
      main: {
        App: {
          CloseLocalTerminal: vi.fn(async () => undefined),
        } as never,
      },
    }
    await store.close('local-2')
    expect(store.outputActivityBySession['local-2']).toBeUndefined()
  })

  it('caps Local Terminal replay to about 1 MiB and clears it on close', async () => {
    const store = useLocalTerminalStore()
    store.setEnabled(true)
    store.subscribe()
    const largeChunk = btoa('x'.repeat(64 * 1024))
    for (let index = 0; index < 20; index += 1) {
      runtimeState.eventCallbacks.get('localterminal:output')?.(outputEvent('local-bounded', largeChunk))
    }
    const listener = vi.fn()
    store.registerOutput('local-bounded', listener)
    expect(listener.mock.calls.length).toBeLessThan(20)

    store.sessions.push(stateEvent('local-bounded').state)
    store.activeSessionId = 'local-bounded'
    window.go = {
      main: {
        App: {
          CloseLocalTerminal: vi.fn(async () => undefined),
        } as never,
      },
    }
    await store.close('local-bounded')
    const afterClose = vi.fn()
    store.registerOutput('local-bounded', afterClose)

    expect(afterClose).not.toHaveBeenCalled()
  })
})
