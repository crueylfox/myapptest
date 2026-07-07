// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalTerminalStore } from '../stores/localTerminal'
import { applyTerminalProfileToRegisteredInstances, observeTerminalInstanceInput } from '../utils/terminalInstanceRegistry'
import type { ShortcutSettings } from '../types'
import { defaultShortcutSettings } from '../utils/shortcutSettings'
import { ClipboardGetText } from '../../wailsjs/runtime/runtime'
import LocalTerminalView from './LocalTerminalView.vue'

const terminalState = vi.hoisted(() => ({
  columns: 80,
  rows: 24,
  writes: [] as Uint8Array[],
  dataCallback: null as ((data: string) => void) | null,
  selectionCallback: null as (() => void) | null,
  selection: '',
  hasSelection: false,
  clearSelectionCalls: 0,
  focusCalls: 0,
  resizeCallbacks: [] as Array<() => void>,
  wheelHandler: null as ((event: WheelEvent) => boolean) | null,
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  eventCallbacks: new Map<string, (event: unknown) => void>(),
  options: {} as Record<string, unknown>,
  disposeCalls: 0,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    get options() { return terminalState.options }
    set options(value: Record<string, unknown>) { terminalState.options = value }
    constructor(options: Record<string, unknown> = {}) {
      this.options = options
    }
    get cols() { return terminalState.columns }
    get rows() { return terminalState.rows }
    loadAddon() {}
    open() {}
    onData(callback: (data: string) => void) {
      terminalState.dataCallback = callback
    }
    attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) {
      terminalState.keyHandler = callback
    }
    attachCustomWheelEventHandler(callback: (event: WheelEvent) => boolean) {
      terminalState.wheelHandler = callback
    }
    focus() { terminalState.focusCalls += 1 }
    write(data: Uint8Array) {
      terminalState.writes.push(data)
    }
    hasSelection() { return terminalState.hasSelection }
    getSelection() { return terminalState.selection }
    clearSelection() {
      terminalState.clearSelectionCalls += 1
      terminalState.selection = ''
      terminalState.hasSelection = false
    }
    onSelectionChange(callback: () => void) {
      terminalState.selectionCallback = callback
      return { dispose: vi.fn() }
    }
    dispose() {
      terminalState.disposeCalls += 1
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      terminalState.columns = 120
      terminalState.rows = 40
    }
  },
}))
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => {
    terminalState.eventCallbacks.set(name, callback)
  }),
  EventsOff: vi.fn(),
  ClipboardGetText: vi.fn(async () => ''),
}))

function mountLocalTerminal(props: Partial<{ copyOnSelectEnabled: boolean; rightClickPasteEnabled: boolean; shortcutSettings: ShortcutSettings }> = {}) {
  const pinia = createPinia()
  const store = useLocalTerminalStore(pinia)
  store.setEnabled(true)
  store.sessions.push({
    sessionId: 'local-1',
    shellKind: 'powershell',
    shell: 'PowerShell',
    shellName: 'powershell.exe',
    elevated: false,
    title: 'PowerShell',
    cwd: 'C:\\Users\\Administrator',
    status: 'running',
    exitCode: null,
    error: '',
    startedAt: '',
    endedAt: '',
  })
  store.activeSessionId = 'local-1'
  const wrapper = mount(LocalTerminalView, {
    props: { sessionId: 'local-1', active: true, visible: true, layoutRevision: 0, ...props },
    global: { plugins: [pinia] },
  })
  return { wrapper, store }
}

describe('LocalTerminalView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    terminalState.columns = 80
    terminalState.rows = 24
    terminalState.writes = []
    terminalState.dataCallback = null
    terminalState.selectionCallback = null
    terminalState.selection = ''
    terminalState.hasSelection = false
    terminalState.clearSelectionCalls = 0
    terminalState.focusCalls = 0
    terminalState.resizeCallbacks = []
    terminalState.wheelHandler = null
    terminalState.keyHandler = null
    terminalState.eventCallbacks.clear()
    terminalState.options = {}
    terminalState.disposeCalls = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(async () => 'paste-中文'),
        writeText: vi.fn(async () => undefined),
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 500,
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(performance.now()), 0)
    ))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        terminalState.resizeCallbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    })
    window.go = {
      main: {
        App: {
          WriteLocalTerminal: vi.fn(async () => undefined),
          ResizeLocalTerminal: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  it('writes input to the local terminal API and resizes the local PTY', async () => {
    const { wrapper } = mountLocalTerminal()
    terminalState.dataCallback?.('\x03')
    expect(window.go?.main?.App?.WriteLocalTerminal).toHaveBeenCalledWith({
      sessionId: 'local-1',
      dataBase64: btoa('\x03'),
    })

    terminalState.resizeCallbacks[0]?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(window.go?.main?.App?.ResizeLocalTerminal).toHaveBeenCalledWith({
      sessionId: 'local-1',
      cols: 120,
      rows: 40,
    })
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('emits submitted local commands from typed Enter and registered command-palette input without changing raw writes', async () => {
    const { wrapper } = mountLocalTerminal()
    await Promise.resolve()
    await Promise.resolve()

    terminalState.dataCallback?.('dir\r')
    await Promise.resolve()

    expect(window.go?.main?.App?.WriteLocalTerminal).toHaveBeenCalledWith({
      sessionId: 'local-1',
      dataBase64: btoa('dir\r'),
    })
    expect(wrapper.emitted('command')?.at(-1)).toEqual(['local-1', 'dir'])

    expect(observeTerminalInstanceInput('local-1', 'Get-ChildItem\r')).toBe(true)
    await Promise.resolve()
    expect(wrapper.emitted('command')?.at(-1)).toEqual(['local-1', 'Get-ChildItem'])

    terminalState.dataCallback?.('   \r')
    await Promise.resolve()
    expect(wrapper.emitted('command')).toHaveLength(2)

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('strips xterm focus and ANSI control sequences before capturing local command history', async () => {
    const { wrapper } = mountLocalTerminal()
    await Promise.resolve()
    await Promise.resolve()

    terminalState.dataCallback?.('\x1b[Ipwd\r')
    await Promise.resolve()

    expect(window.go?.main?.App?.WriteLocalTerminal).toHaveBeenCalledWith({
      sessionId: 'local-1',
      dataBase64: btoa('\x1b[Ipwd\r'),
    })
    expect(wrapper.emitted('command')?.at(-1)).toEqual(['local-1', 'pwd'])
    expect(wrapper.emitted('command')?.at(-1)).not.toEqual(['local-1', '[Ipwd'])

    terminalState.dataCallback?.('\x1b[Ils\r')
    await Promise.resolve()

    expect(wrapper.emitted('command')?.at(-1)).toEqual(['local-1', 'ls'])
    expect(wrapper.emitted('command')?.at(-1)).not.toEqual(['local-1', '[Ils'])

    terminalState.dataCallback?.('\x1b[O')
    await Promise.resolve()
    expect(wrapper.emitted('command')).toHaveLength(2)

    terminalState.dataCallback?.('\x1b[200~Get-ChildItem\r\x1b[201~')
    await Promise.resolve()
    expect(wrapper.emitted('command')?.at(-1)).toEqual(['local-1', 'Get-ChildItem'])

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('renders only matching local terminal output', () => {
    const { wrapper, store } = mountLocalTerminal()
    store.subscribe()
    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-2',
      dataBase64: btoa('wrong'),
      timestamp: '',
    })
    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('right'),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('right')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('applies the default terminal profile without restarting the local terminal process', async () => {
    const { wrapper } = mountLocalTerminal()
    await wrapper.setProps({
      profile: {
        id: 'tp-local',
        name: 'Local',
        fontFamily: 'Cascadia Mono',
        fontSize: 19,
        lineHeight: 1.35,
        letterSpacing: 1,
        cursorStyle: 'underline',
        cursorBlink: false,
        scrollback: 25000,
        themeName: 'custom',
        foreground: '#f8fafc',
        background: '#020617',
        selectionBackground: '#3f7dff66',
        cursorColor: '#facc15',
        createdAt: '',
        updatedAt: '',
      },
      profileRevision: 1,
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(terminalState.options.fontSize).toBe(19)
    expect(terminalState.options.fontFamily).toBe('Cascadia Mono')
    expect(window.go?.main?.App?.WriteLocalTerminal).not.toHaveBeenCalled()
    expect(terminalState.disposeCalls).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('applies the default profile directly to a registered local terminal', async () => {
    const { wrapper } = mountLocalTerminal()
    await vi.advanceTimersByTimeAsync(100)

    const count = applyTerminalProfileToRegisteredInstances({
      id: 'default',
      name: '默认',
      fontFamily: 'Fira Code',
      fontSize: 20,
      lineHeight: 1.45,
      letterSpacing: 1,
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollback: 30000,
      themeName: 'custom',
      foreground: '#e5e7eb',
      background: '#020617',
      selectionBackground: '#3f7dff66',
      cursorColor: '#ffffff',
      createdAt: '',
      updatedAt: '',
    }, 'default')
    await vi.advanceTimersByTimeAsync(100)

    expect(count).toBe(1)
    expect(terminalState.options.fontFamily).toBe('Fira Code')
    expect(terminalState.options.fontSize).toBe(20)
    expect(terminalState.options.theme).toMatchObject({ background: '#020617' })
    expect(window.go?.main?.App?.ResizeLocalTerminal).toHaveBeenCalledWith({
      sessionId: 'local-1',
      cols: 120,
      rows: 40,
    })
    expect(window.go?.main?.App?.WriteLocalTerminal).not.toHaveBeenCalled()
    expect(terminalState.disposeCalls).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('handles Ctrl+wheel inside the local terminal without WebView page zoom', async () => {
    const { wrapper } = mountLocalTerminal()
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })
    wrapper.get('[data-terminal-surface="true"]').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(terminalState.options.fontSize).toBe(14)
    expect(terminalState.disposeCalls).toBe(0)
    expect(wrapper.get('[data-terminal-surface="true"]').attributes('data-terminal-kind')).toBe('local')
    expect(wrapper.get('[data-terminal-surface="true"]').attributes('data-terminal-session-id')).toBe('local-1')

    await vi.advanceTimersByTimeAsync(100)
    expect(window.go?.main?.App?.ResizeLocalTerminal).toHaveBeenCalledWith({
      sessionId: 'local-1',
      cols: 120,
      rows: 40,
    })
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('handles local terminal Ctrl+wheel during capture before xterm child wheel handlers can stop bubbling', () => {
    const { wrapper } = mountLocalTerminal()
    const surface = wrapper.get('[data-terminal-surface="true"]').element
    const xtermChild = document.createElement('div')
    xtermChild.addEventListener('wheel', (event) => event.stopPropagation())
    surface.appendChild(xtermChild)
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })

    xtermChild.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(terminalState.options.fontSize).toBe(14)
    expect(terminalState.disposeCalls).toBe(0)
    expect(wrapper.get('.local-terminal-view-host').attributes('data-terminal-surface')).toBeUndefined()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('handles local terminal Ctrl+wheel through xterm custom wheel interception', () => {
    const { wrapper } = mountLocalTerminal()
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    expect(terminalState.wheelHandler?.(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(terminalState.options.fontSize).toBe(14)
    expect(terminalState.disposeCalls).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('copies selected text when copy-on-select is enabled', async () => {
    const { wrapper } = mountLocalTerminal()
    terminalState.hasSelection = true
    terminalState.selection = 'selected text'
    terminalState.selectionCallback?.()
    await Promise.resolve()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('selected text')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('pastes clipboard text through WriteLocalTerminal on right click', async () => {
    const { wrapper } = mountLocalTerminal()
    await wrapper.get('.local-terminal-view').trigger('contextmenu')
    await Promise.resolve()
    await Promise.resolve()

    const payload = (window.go?.main?.App?.WriteLocalTerminal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(payload.sessionId).toBe('local-1')
    expect(terminalState.clearSelectionCalls).toBeGreaterThanOrEqual(1)
    expect(terminalState.focusCalls).toBeGreaterThanOrEqual(1)
    expect(new TextDecoder().decode(Uint8Array.from(atob(payload.dataBase64), (char) => char.charCodeAt(0)))).toBe('paste-中文')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('falls back to Wails clipboard text when browser clipboard read fails on local right click paste', async () => {
    const { wrapper } = mountLocalTerminal()
    vi.mocked(navigator.clipboard.readText).mockRejectedValueOnce(new Error('not allowed'))
    vi.mocked(ClipboardGetText).mockResolvedValueOnce('fallback-local')

    await wrapper.get('.local-terminal-view').trigger('contextmenu')
    await Promise.resolve()
    await Promise.resolve()

    expect(ClipboardGetText).toHaveBeenCalledTimes(1)
    const payload = (window.go?.main?.App?.WriteLocalTerminal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(payload.sessionId).toBe('local-1')
    expect(new TextDecoder().decode(Uint8Array.from(atob(payload.dataBase64), (char) => char.charCodeAt(0)))).toBe('fallback-local')
    expect(wrapper.emitted('notify')).toBeUndefined()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('uses the same configured paste shortcut as SSH terminals and blocks old Ctrl+Shift+V paste', async () => {
    const shortcutSettings = { ...defaultShortcutSettings(), terminalPaste: 'ctrl+alt+v' } as ShortcutSettings
    const { wrapper } = mountLocalTerminal({ shortcutSettings })
    const surface = wrapper.get('.local-terminal-view').element

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
    await Promise.resolve()
    await Promise.resolve()
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteLocalTerminal).not.toHaveBeenCalled()

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
    await Promise.resolve()
    await Promise.resolve()

    expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.WriteLocalTerminal).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not swallow completion shortcuts for unsupported local terminal completion', () => {
    const { wrapper } = mountLocalTerminal()
    const ctrlSpace = new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true })
    const ctrlShiftA = new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true })

    expect(terminalState.keyHandler?.(ctrlSpace)).toBe(true)
    expect(terminalState.keyHandler?.(ctrlShiftA)).toBe(true)
    expect(wrapper.emitted('notify')).toBeUndefined()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('pastes on right click even when text remains selected', async () => {
    const { wrapper } = mountLocalTerminal()
    terminalState.hasSelection = true
    terminalState.selection = 'selected text'

    await wrapper.get('.local-terminal-view').trigger('contextmenu')
    await Promise.resolve()
    await Promise.resolve()

    expect(navigator.clipboard.readText).toHaveBeenCalled()
    const payload = (window.go?.main?.App?.WriteLocalTerminal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(payload.sessionId).toBe('local-1')
    expect(terminalState.hasSelection).toBe(false)
    expect(terminalState.selection).toBe('')
    expect(terminalState.clearSelectionCalls).toBeGreaterThanOrEqual(1)
    expect(terminalState.focusCalls).toBeGreaterThanOrEqual(1)
    expect(new TextDecoder().decode(Uint8Array.from(atob(payload.dataBase64), (char) => char.charCodeAt(0)))).toBe('paste-中文')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('drops only the first isolated macOS zsh percent line for local terminals', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('%\r\nuser@mac ~ % '),
      timestamp: '',
    })
    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('% normal prompt remains'),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(2)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('user@mac ~ % ')
    expect(new TextDecoder().decode(terminalState.writes[1])).toBe('% normal prompt remains')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('drops the first isolated macOS zsh percent line when it arrives split across output chunks', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('%'),
      timestamp: '',
    })
    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('\r\nuser@mac ~ % '),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('user@mac ~ % ')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('buffers the first isolated macOS zsh percent prompt when prompt space arrives before repaint', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('% '),
      timestamp: '',
    })
    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('\r\ncrueyl@CrueyldeMac ~ % '),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('crueyl@CrueyldeMac ~ % ')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('drops the first isolated macOS zsh percent line even when zsh emits ANSI control sequences before the newline', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('%\x1b[?2004h\r\nuser@mac ~ % '),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('\x1b[?2004huser@mac ~ % ')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('drops the first isolated macOS zsh percent line when prompt repaint uses carriage return only', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('%\ruser@mac ~ % '),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('user@mac ~ % ')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('drops the first isolated macOS zsh percent line when control-prefixed output is split across chunks', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('\x1b[?2004h%'),
      timestamp: '',
    })
    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('\ruser@mac ~ % '),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('\x1b[?2004huser@mac ~ % ')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('keeps a normal first macOS zsh prompt that contains a trailing percent prompt marker', async () => {
    const { wrapper, store } = mountLocalTerminal()
    store.sessions[0].shellKind = 'local'
    store.subscribe()

    terminalState.eventCallbacks.get('localterminal:output')?.({
      sessionId: 'local-1',
      dataBase64: btoa('user@mac ~ % '),
      timestamp: '',
    })

    expect(terminalState.writes).toHaveLength(1)
    expect(new TextDecoder().decode(terminalState.writes[0])).toBe('user@mac ~ % ')
    wrapper.unmount()
    store.unsubscribe()
    vi.useRealTimers()
  })

  it('shows the local terminal menu when right-click paste is disabled', async () => {
    const { wrapper } = mountLocalTerminal({ rightClickPasteEnabled: false })

    await wrapper.get('.local-terminal-view').trigger('contextmenu')
    await Promise.resolve()
    await Promise.resolve()

    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteLocalTerminal).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })
})
