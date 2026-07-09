// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../stores/terminal'
import type { Connection, ShortcutSettings } from '../types'
import { defaultShortcutSettings } from '../utils/shortcutSettings'
import { observeTerminalInstanceInput } from '../utils/terminalInstanceRegistry'
import { ClipboardGetText } from '../../wailsjs/runtime/runtime'
import TerminalView from './TerminalView.vue'

const terminalState = vi.hoisted(() => ({
  dataCallback: null as ((data: string) => void) | null,
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  selectionCallback: null as (() => void) | null,
  selection: '',
  clearSelectionCalls: 0,
  focusCalls: 0,
  eventCallbacks: new Map<string, (event: unknown) => void>(),
  instances: [] as Array<{ dataCallback: ((data: string) => void) | null }>,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    mockInstance = { dataCallback: null as ((data: string) => void) | null }
    constructor() {
      terminalState.instances.push(this.mockInstance)
    }
    cols = 100
    rows = 30
    get buffer() {
      return { active: { baseY: 0, viewportY: 0 } }
    }
    loadAddon() {}
    open() {}
    onData(callback: (data: string) => void) {
      terminalState.dataCallback = callback
      this.mockInstance.dataCallback = callback
    }
    onScroll() {}
    attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) {
      terminalState.keyHandler = callback
    }
    attachCustomWheelEventHandler() {}
    onSelectionChange(callback: () => void) {
      terminalState.selectionCallback = callback
      return { dispose: vi.fn() }
    }
    focus() { terminalState.focusCalls += 1 }
    write(_data: Uint8Array, callback?: () => void) { callback?.() }
    paste(data: string) {
      this.mockInstance.dataCallback?.(data.replace(/\r?\n/g, '\r'))
    }
    scrollToBottom() {}
    hasSelection() { return Boolean(terminalState.selection) }
    getSelection() { return terminalState.selection }
    selectAll() { terminalState.selection = 'all' }
    clearSelection() {
      terminalState.clearSelectionCalls += 1
      terminalState.selection = ''
    }
    dispose() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit() {} },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class { findNext() {} },
}))
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => {
    terminalState.eventCallbacks.set(name, callback)
  }),
  EventsOff: vi.fn(),
  ClipboardGetText: vi.fn(async () => ''),
}))

function b64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeB64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const connection: Connection = {
  id: 7,
  groupId: 3,
  name: 'server',
  host: '192.0.2.7',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mountTerminal(options: { sessionId?: string; connectionId?: number; pinia?: ReturnType<typeof createPinia>; shortcutSettings?: ShortcutSettings } = {}) {
  const sessionId = options.sessionId ?? 'session-1'
  const connectionId = options.connectionId ?? 7
  const pinia = options.pinia ?? createPinia()
  const store = useTerminalStore(pinia)
  store.tabs.push({
    sessionId,
    connectionId,
    title: 'server',
    status: 'online',
    code: '',
    message: '',
  })
  store.activeSessionId = sessionId
  store.subscribe()
  const wrapper = mount(TerminalView, {
    props: {
      sessionId,
      active: true,
      connection: { ...connection, id: connectionId },
      visible: true,
      layoutRevision: 0,
      shortcutSettings: options.shortcutSettings,
    },
    global: { plugins: [pinia], stubs: { ContextMenu: true } },
  })
  return { wrapper, store }
}

describe('TerminalView command history attachment', () => {
  beforeEach(() => {
    terminalState.dataCallback = null
    terminalState.keyHandler = null
    terminalState.selectionCallback = null
    terminalState.selection = ''
    terminalState.clearSelectionCalls = 0
    terminalState.focusCalls = 0
    terminalState.eventCallbacks.clear()
    terminalState.instances = []
    localStorage.clear()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    window.go = {
      main: {
        App: {
          WriteTerminal: vi.fn(async () => undefined),
          ResizeTerminal: vi.fn(async () => undefined),
          RecordCommandHistory: vi.fn(async () => ({
            recorded: true,
            skipped: false,
            reasonCode: '',
            message: '',
          })),
          ListCommandHistory: vi.fn(async () => [{
            id: 'history-docker-compose',
            serverId: 7,
            serverName: 'server',
            sessionId: 'session-1',
            command: 'docker compose ps',
            preview: 'docker compose ps',
            isMultiline: false,
            commandHash: 'history-docker-compose',
            source: 'terminal',
            sourceLabel: 'Terminal',
            executedAt: '2026-07-04T10:00:00Z',
            targetServerIds: [],
            targetCount: 0,
            batchSubmissionId: '',
          }]),
          ListCommandFavorites: vi.fn(async () => [{
            id: 'favorite-docker-logs',
            title: 'Docker logs',
            command: 'docker logs api',
            description: 'Inspect logs',
            scope: 'server',
            serverId: 7,
            groupId: 3,
            tags: [],
            sortOrder: 0,
            useCount: 3,
            createdAt: '',
            updatedAt: '',
            lastUsedAt: '',
          }]),
          ListCommandSuggestions: vi.fn(async () => []),
          CreateCommandFavorite: vi.fn(async () => ({
            id: 'fav',
            title: 'Service status',
            command: 'systemctl status nginx',
            description: '',
            scope: 'server',
            serverId: 7,
            groupId: null,
            tags: [],
            sortOrder: 0,
            useCount: 0,
            createdAt: '',
            updatedAt: '',
            lastUsedAt: '',
          })),
          IncrementCommandFavoriteUse: vi.fn(),
        } as never,
      },
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(async () => ''),
        writeText: vi.fn(async () => undefined),
      },
    })
  })

  it('records a submitted command after Enter without blocking terminal input', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('uptime')
    terminalState.dataCallback?.('\r')
    await Promise.resolve()
    await Promise.resolve()

    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('uptime'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'uptime',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('tracks externally inserted command drafts and records the final edited command on Enter', async () => {
    const { wrapper } = mountTerminal()

    expect(observeTerminalInstanceInput('session-1', 'docker ps')).toBe(true)
    await flush()
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()

    terminalState.dataCallback?.(' -a | grep nginx')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'docker ps -a | grep nginx',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('records the final command after editing an imported history entry with cursor movement', async () => {
    const { wrapper } = mountTerminal()
    const imported = 'vi /etc/config/network'

    expect(observeTerminalInstanceInput('session-1', imported)).toBe(true)
    await flush()
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()

    terminalState.dataCallback?.('\x1b[D'.repeat(imported.length - 2))
    terminalState.dataCallback?.('m')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'vim /etc/config/network',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('does not record the next line after a password prompt', async () => {
    const { wrapper } = mountTerminal()
    terminalState.eventCallbacks.get('terminal:output')?.({
      sessionId: 'session-1',
      dataBase64: b64('Password: '),
    })
    terminalState.dataCallback?.('not-a-command')
    terminalState.dataCallback?.('\r')
    await Promise.resolve()
    await Promise.resolve()

    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens command overlays with Ctrl+Shift+H and Ctrl+Shift+P only', () => {
    const { wrapper } = mountTerminal()
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))).toBe(true)
    expect(wrapper.emitted('commands')).toEqual([['history'], ['favorites']])
    wrapper.unmount()
  })

  it('records multiline clipboard paste as one normalized history entry', async () => {
    const { wrapper } = mountTerminal()
    const pasted = [
      'openssl s_client \\',
      '  -connect 127.0.0.1:44399 \\',
      '  -servername bz.412027.xyz \\',
      '  </dev/null 2>/dev/null |',
      'openssl x509 -noout -subject -issuer -dates -ext subjectAltName',
    ].join('\r\n')
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce(pasted)

    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }))).toBe(false)
    await flush()
    await flush()

    const expected = pasted.replace(/\r?\n/g, '\r')
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64(expected),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: pasted.replace(/\r\n/g, '\n'),
      source: 'terminal',
    })
    expect(window.go?.main?.App?.ListCommandSuggestions).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('records backslash-continued typed input as one multiline history entry on the final Enter', async () => {
    const { wrapper } = mountTerminal()
    const expected = ['echo \\', '1 \\', '2 \\', '你好'].join('\n')

    terminalState.dataCallback?.('echo \\')
    terminalState.dataCallback?.('\r')
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()

    terminalState.dataCallback?.('1 \\')
    terminalState.dataCallback?.('\r')
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()

    terminalState.dataCallback?.('2 \\')
    terminalState.dataCallback?.('\r')
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()

    terminalState.dataCallback?.('你好')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: expected,
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('recognizes only odd raw trailing backslashes as continuation markers', async () => {
    const { wrapper } = mountTerminal()
    const recordHistory = vi.mocked(window.go!.main!.App!.RecordCommandHistory)

    const doubleSlash = 'echo ' + '\\'.repeat(2)
    terminalState.dataCallback?.(doubleSlash)
    terminalState.dataCallback?.('\r')
    await flush()
    expect(recordHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: doubleSlash,
      source: 'terminal',
    })

    recordHistory.mockClear()
    terminalState.dataCallback?.('echo \\ ')
    terminalState.dataCallback?.('\r')
    await flush()
    expect(recordHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'echo \\',
      source: 'terminal',
    })

    recordHistory.mockClear()
    terminalState.dataCallback?.('echo \\')
    terminalState.dataCallback?.('\r')
    await flush()
    expect(recordHistory).not.toHaveBeenCalled()
    terminalState.dataCallback?.('\x03')

    const tripleSlash = 'echo ' + '\\'.repeat(3)
    terminalState.dataCallback?.(tripleSlash)
    terminalState.dataCallback?.('\r')
    await flush()
    expect(recordHistory).not.toHaveBeenCalled()
    terminalState.dataCallback?.('\x03')
    wrapper.unmount()
  })

  it('clears pending continuation on Ctrl+C without recording a half command', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('echo \\')
    terminalState.dataCallback?.('\r')
    terminalState.dataCallback?.('\x03')
    terminalState.dataCallback?.('你好')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: '你好',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('clears pending continuation when the terminal session component is closed', async () => {
    const first = mountTerminal()
    terminalState.dataCallback?.('echo \\')
    terminalState.dataCallback?.('\r')
    first.wrapper.unmount()

    const second = mountTerminal()
    terminalState.dataCallback?.('你好')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: '你好',
      source: 'terminal',
    })
    second.wrapper.unmount()
  })

  it('keeps continuation buffers isolated between terminal tabs on the same server', async () => {
    const pinia = createPinia()
    const first = mountTerminal({ pinia, sessionId: 'session-a' })
    const second = mountTerminal({ pinia, sessionId: 'session-b' })
    const [firstTerminal, secondTerminal] = terminalState.instances

    firstTerminal.dataCallback?.('echo \\')
    firstTerminal.dataCallback?.('\r')
    secondTerminal.dataCallback?.('pwd')
    secondTerminal.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-b',
      command: 'pwd',
      source: 'terminal',
    })

    vi.mocked(window.go!.main!.App!.RecordCommandHistory).mockClear()
    firstTerminal.dataCallback?.('你好')
    firstTerminal.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-a',
      command: ['echo \\', '你好'].join('\n'),
      source: 'terminal',
    })
    first.wrapper.unmount()
    second.wrapper.unmount()
  })

  it('records bracketed multiline paste as one normalized history entry', async () => {
    const { wrapper } = mountTerminal()
    const command = ['echo \\', '1 \\', '2 \\', '你好'].join('\n')
    terminalState.dataCallback?.(`\x1b[200~${command.replace(/\n/g, '\r\n')}\x1b[201~`)
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command,
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('surfaces sanitized skip feedback for sensitive multiline paste', async () => {
    window.go!.main!.App!.RecordCommandHistory = vi.fn(async () => ({
      recorded: false,
      skipped: true,
      reasonCode: 'SENSITIVE',
      message: '该命令可能包含敏感信息，已跳过历史记录',
    })) as never
    const { wrapper } = mountTerminal()
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('echo start\nexport TOKEN=secret-value')

    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }))).toBe(false)
    await flush()

    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('echo start\rexport TOKEN=secret-value'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'echo start\nexport TOKEN=secret-value',
      source: 'terminal',
    })
    expect(wrapper.emitted('commandSkip')?.at(-1)?.[0]).toContain('敏感')
    wrapper.unmount()
  })

  it('copies terminal selection when the setting is enabled', async () => {
    const { wrapper } = mountTerminal()
    terminalState.selection = 'selected text'
    terminalState.selectionCallback?.()
    await flush()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('selected text')
    wrapper.unmount()
  })

  it('does not copy terminal selection when the setting is disabled', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    store.tabs.push({
      sessionId: 'session-1',
      connectionId: 7,
      title: 'server',
      status: 'online',
      code: '',
      message: '',
    })
    store.activeSessionId = 'session-1'
    store.subscribe()
    const wrapper = mount(TerminalView, {
      props: {
        sessionId: 'session-1',
        active: true,
        connection,
        visible: true,
        layoutRevision: 0,
        copyOnSelectEnabled: false,
      },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    terminalState.selection = 'selected text'
    terminalState.selectionCallback?.()
    await flush()

    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith('selected text')
    wrapper.unmount()
  })

  it('pastes clipboard text on right click when enabled and no text is selected', async () => {
    const { wrapper } = mountTerminal()
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('echo right click\n')

    await wrapper.get('.terminal-view').trigger('contextmenu')
    await flush()

    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('echo right click\r'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'echo right click',
      source: 'terminal',
    })
    expect(terminalState.clearSelectionCalls).toBeGreaterThanOrEqual(1)
    expect(terminalState.focusCalls).toBeGreaterThanOrEqual(1)
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('falls back to Wails clipboard text when browser clipboard read fails on right click paste', async () => {
    const { wrapper } = mountTerminal()
    vi.mocked(navigator.clipboard.readText).mockRejectedValueOnce(new Error('not allowed'))
    vi.mocked(ClipboardGetText).mockResolvedValueOnce('echo fallback\n')

    await wrapper.get('.terminal-view').trigger('contextmenu')
    await flush()

    expect(ClipboardGetText).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('echo fallback\r'),
    })
    expect(wrapper.emitted('commandSkip')).toBeUndefined()
    wrapper.unmount()
  })

  it('records single-line clipboard paste submitted through Ctrl+Shift+V', async () => {
    const { wrapper } = mountTerminal()
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('docker ps')

    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }))).toBe(false)
    await flush()
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'docker ps',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('uses the configured paste shortcut and blocks the old native Ctrl+Shift+V path', async () => {
    const shortcuts = { ...defaultShortcutSettings(), terminalPaste: 'ctrl+alt+v' } as ShortcutSettings
    const { wrapper } = mountTerminal({ shortcutSettings: shortcuts })
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('echo custom paste')
    const surface = wrapper.get('.terminal-view').element

    const oldKey = new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    surface.dispatchEvent(oldKey)
    expect(oldKey.defaultPrevented).toBe(true)

    const nativePaste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    surface.dispatchEvent(nativePaste)
    expect(nativePaste.defaultPrevented).toBe(true)
    await flush()
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalledWith(expect.objectContaining({
      dataBase64: b64('echo custom paste'),
    }))

    const newKey = new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    surface.dispatchEvent(newKey)
    expect(newKey.defaultPrevented).toBe(true)
    await flush()

    expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('echo custom paste'),
    })
    wrapper.unmount()
  })

  it('runs a reassigned Ctrl+Shift+V action instead of paste', async () => {
    const shortcuts = {
      ...defaultShortcutSettings(),
      terminalPaste: 'ctrl+alt+v',
      openCommandHistory: 'ctrl+shift+v',
    } as ShortcutSettings
    const { wrapper } = mountTerminal({ shortcutSettings: shortcuts })
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('should-not-paste')

    const event = new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    wrapper.get('.terminal-view').element.dispatchEvent(event)
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalledWith(expect.objectContaining({
      dataBase64: b64('should-not-paste'),
    }))
    expect(wrapper.emitted('commands')?.at(-1)).toEqual(['history'])
    wrapper.unmount()
  })

  it('records a pasted single command with a trailing newline', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('pwd\n')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'pwd',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('records a pasted single command with a Windows trailing newline', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('pwd\r\n')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'pwd',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('ignores internal cursor-right paste nudges without marking history dirty', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('pwd')
    terminalState.dataCallback?.('\x1b[C')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'pwd',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('pastes clipboard text on right click and clears the current selection', async () => {
    const { wrapper } = mountTerminal()
    terminalState.selection = 'selected text'
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('echo selected paste\n')

    await wrapper.get('.terminal-view').trigger('contextmenu')
    await flush()

    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('echo selected paste\r'),
    })
    expect(terminalState.selection).toBe('')
    expect(terminalState.clearSelectionCalls).toBeGreaterThanOrEqual(1)
    expect(terminalState.focusCalls).toBeGreaterThanOrEqual(1)
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the terminal content menu when right click action is menu', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    store.tabs.push({
      sessionId: 'session-1',
      connectionId: 7,
      title: 'server',
      status: 'online',
      code: '',
      message: '',
    })
    store.activeSessionId = 'session-1'
    store.subscribe()
    const wrapper = mount(TerminalView, {
      props: {
        sessionId: 'session-1',
        active: true,
        connection,
        visible: true,
        layoutRevision: 0,
        rightClickPasteEnabled: false,
      },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    terminalState.selection = 'selected text'
    await wrapper.get('.terminal-view').trigger('contextmenu')
    await flush()

    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses the configured alternate trigger for the terminal content menu while right click pastes', async () => {
    const { wrapper } = mountTerminal()
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('echo should not paste\n')

    await wrapper.get('.terminal-view').trigger('contextmenu', { shiftKey: true })
    await flush()

    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(true)
    wrapper.unmount()
  })

  it('lets IME composing keys pass through and writes Unicode input through onData', async () => {
    const { wrapper } = mountTerminal()
    const composingSpace = new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true })
    Object.defineProperty(composingSpace, 'isComposing', { value: true })

    expect(terminalState.keyHandler?.(composingSpace)).toBe(true)
    expect(window.go?.main?.App?.ListCommandSuggestions).not.toHaveBeenCalled()

    terminalState.dataCallback?.('echo 中文测试')
    terminalState.dataCallback?.('\r')
    await flush()

    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('echo 中文测试'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'echo 中文测试',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('sends a single Chinese character as UTF-8 bytes and never as 0xff', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('啊')
    await flush()

    const calls = vi.mocked(window.go!.main!.App!.WriteTerminal).mock.calls
    const payload = (calls.at(-1)?.[0] as { dataBase64: string }).dataBase64
    expect([...decodeB64(payload)]).toEqual([0xe5, 0x95, 0x8a])
    expect([...decodeB64(payload)]).not.toContain(0xff)
    wrapper.unmount()
  })

  it('opens SSH command completion after two typed characters and leaves Tab untouched while closed', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('\t')
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('\t'),
    })

    terminalState.dataCallback?.('do')
    await flush()

    expect(window.go?.main?.App?.ListCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      scope: 'currentServer',
      query: 'do',
      limit: 100,
    })
    expect(window.go?.main?.App?.ListCommandFavorites).toHaveBeenCalledWith({
      serverId: 7,
      groupId: 3,
      scope: 'currentServer',
      query: 'do',
    })
    expect(window.go?.main?.App?.ListCommandSuggestions).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').text()).toContain('docker compose ps')
    wrapper.unmount()
  })

  it('uses SSH completion trigger length and max suggestion preferences', async () => {
    localStorage.setItem('hostdeck.sshCommandCompletion.triggerChars', '3')
    localStorage.setItem('hostdeck.sshCommandCompletion.maxSuggestions', '5')
    vi.mocked(window.go!.main!.App!.ListCommandHistory).mockResolvedValue([])
    vi.mocked(window.go!.main!.App!.ListCommandFavorites).mockResolvedValue([])
    const { wrapper } = mountTerminal()

    terminalState.dataCallback?.('do')
    await flush()
    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').exists()).toBe(false)
    expect(window.go?.main?.App?.ListCommandHistory).not.toHaveBeenCalled()

    terminalState.dataCallback?.('c')
    await flush()
    const overlay = wrapper.get('[data-testid="terminal-completion-overlay"]')
    expect(overlay.findAll('.completion-row')).toHaveLength(5)
    wrapper.unmount()
  })

  it('shows command descriptions in the SSH completion overlay when enabled', async () => {
    localStorage.setItem('hostdeck.sshCommandCompletion.showDescriptions', 'true')
    vi.mocked(window.go!.main!.App!.ListCommandHistory).mockResolvedValue([])
    vi.mocked(window.go!.main!.App!.ListCommandFavorites).mockResolvedValue([])
    const { wrapper } = mountTerminal()

    terminalState.dataCallback?.('systemctl st')
    await flush()

    const overlay = wrapper.get('[data-testid="terminal-completion-overlay"]')
    expect(overlay.text()).toContain('systemctl status')
    expect(overlay.text()).toContain('查看 systemd 服务状态')
    wrapper.unmount()
  })

  it('leaves Ctrl+Space to Windows and input methods without opening completion or sending NUL', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('system')
    const event = new KeyboardEvent('keydown', {
      key: 'Spacebar',
      code: 'Space',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    wrapper.get('.terminal-view').element.dispatchEvent(event)
    await flush()

    expect(event.defaultPrevented).toBe(false)
    expect(window.go?.main?.App?.ListCommandSuggestions).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('\x00'),
    })
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      ctrlKey: true,
    }))).toBe(true)
    wrapper.unmount()
  })

  it('captures Ctrl+Shift+A once to open completion without sending Ctrl+A bytes', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('do')
    const event = new KeyboardEvent('keydown', {
      key: 'A',
      code: 'KeyA',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    wrapper.get('.terminal-view').element.dispatchEvent(event)
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(window.go?.main?.App?.ListCommandHistory).toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('\x01'),
    })
    wrapper.unmount()
  })

  it('accepts the selected completion with Tab and lets Enter execute normally', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('do')
    await flush()

    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'Tab' }))).toBe(false)
    await flush()
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('cker compose ps'),
    })

    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true)
    terminalState.dataCallback?.('\r')
    await flush()
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      dataBase64: b64('\r'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-1',
      command: 'docker compose ps',
      source: 'terminal',
    })
    wrapper.unmount()
  })

  it('moves selection with arrows and closes completion with Esc', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('do')
    await flush()

    expect(wrapper.find('[data-testid="completion-selected"]').text()).toContain('docker compose ps')
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false)
    await flush()
    expect(wrapper.find('[data-testid="completion-selected"]').text()).toContain('docker logs api')
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false)
    await flush()
    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('disables SSH command completion from the overlay and restores Tab passthrough', async () => {
    const { wrapper } = mountTerminal()
    vi.mocked(window.go!.main!.App!.ListCommandHistory).mockResolvedValueOnce([])
    vi.mocked(window.go!.main!.App!.ListCommandFavorites).mockResolvedValueOnce([])
    terminalState.dataCallback?.('sys')
    await flush()

    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').exists()).toBe(true)
    await wrapper.get('[data-testid="completion-disable"]').trigger('click')
    await flush()

    expect(localStorage.getItem('hostdeck.sshCommandCompletion.enabled')).toBe('false')
    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').exists()).toBe(false)

    terminalState.dataCallback?.('\x15')
    terminalState.dataCallback?.('sys')
    await flush()
    expect(wrapper.find('[data-testid="terminal-completion-overlay"]').exists()).toBe(false)
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'Tab' }))).toBe(true)
    wrapper.unmount()
  })

  it('blocks completion when the line buffer is dirty', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('\x1b[A')
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true }))).toBe(false)
    await flush()

    expect(window.go?.main?.App?.ListCommandSuggestions).not.toHaveBeenCalled()
    expect(wrapper.emitted('commandSkip')?.at(-1)?.[0]).toContain('不确定')
    wrapper.unmount()
  })

  it('blocks completion when local cursor tracking is not at the command end', async () => {
    const { wrapper } = mountTerminal()
    terminalState.dataCallback?.('system')
    terminalState.dataCallback?.('\x1b[D')
    expect(terminalState.keyHandler?.(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true }))).toBe(false)
    await flush()

    expect(window.go?.main?.App?.ListCommandSuggestions).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
