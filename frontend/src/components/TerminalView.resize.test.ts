// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../stores/terminal'
import { applyTerminalProfileToRegisteredInstances, terminalInstanceCount } from '../utils/terminalInstanceRegistry'
import TerminalView from './TerminalView.vue'

const terminalState = vi.hoisted(() => ({
  columns: 80,
  rows: 24,
  baseY: 100,
  viewportY: 100,
  scrollBottomCalls: 0,
  fitCalls: 0,
  resizeCallbacks: [] as Array<() => void>,
  scrollCallbacks: [] as Array<() => void>,
  wheelHandler: null as ((event: WheelEvent) => boolean) | null,
  eventCallbacks: new Map<string, (event: unknown) => void>(),
  options: {} as Record<string, unknown>,
  instances: [] as Array<{ options: Record<string, unknown>; disposeCalls: number }>,
  disposeCalls: 0,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    instance!: { options: Record<string, unknown>; disposeCalls: number }
    get options() { return this.instance.options }
    set options(value: Record<string, unknown>) {
      this.instance.options = value
      terminalState.options = value
    }
    constructor(options: Record<string, unknown> = {}) {
      this.instance = { options: {}, disposeCalls: 0 }
      terminalState.instances.push(this.instance)
      this.options = options
    }
    setOption(key: string, value: unknown) {
      this.options = { ...(this.options ?? {}), [key]: value }
    }
    get cols() { return terminalState.columns }
    get rows() { return terminalState.rows }
    get buffer() {
      return {
        active: {
          baseY: terminalState.baseY,
          viewportY: terminalState.viewportY,
        },
      }
    }
    loadAddon() {}
    open() {}
    onData() {}
    onScroll(callback: () => void) {
      terminalState.scrollCallbacks.push(callback)
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler(callback: (event: WheelEvent) => boolean) {
      terminalState.wheelHandler = callback
    }
    focus() {}
    write(_data: Uint8Array, callback?: () => void) {
      callback?.()
    }
    scrollToBottom() {
      terminalState.viewportY = terminalState.baseY
      terminalState.scrollBottomCalls += 1
      terminalState.scrollCallbacks.forEach((callback) => callback())
    }
    hasSelection() { return false }
    dispose() {
      this.instance.disposeCalls += 1
      terminalState.disposeCalls += 1
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      terminalState.fitCalls += 1
      terminalState.columns = 132
      terminalState.rows = 38
    }
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {},
}))
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => {
    terminalState.eventCallbacks.set(name, callback)
  }),
  EventsOff: vi.fn(),
}))

describe('TerminalView resize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    terminalState.columns = 80
    terminalState.rows = 24
    terminalState.baseY = 100
    terminalState.viewportY = 100
    terminalState.scrollBottomCalls = 0
    terminalState.fitCalls = 0
    terminalState.resizeCallbacks = []
    terminalState.scrollCallbacks = []
    terminalState.wheelHandler = null
    terminalState.eventCallbacks.clear()
    terminalState.options = {}
    terminalState.instances = []
    terminalState.disposeCalls = 0
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
          ResizeTerminal: vi.fn(async () => undefined),
          WriteTerminal: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  it('fits and sends new PTY rows and columns after panel resize', async () => {
    const pinia = createPinia()
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-1', active: true, layoutRevision: 0 },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    terminalState.resizeCallbacks[0]?.()
    await vi.advanceTimersByTimeAsync(100)

    expect(window.go?.main?.App?.ResizeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      columns: 132,
      rows: 38,
    })
    expect(wrapper.emitted('size')?.at(-1)).toEqual([{ columns: 132, rows: 38 }])
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('coalesces resize bursts and cancels pending work after unmount', async () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-burst', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
    terminalState.resizeCallbacks[0]?.()
    terminalState.resizeCallbacks[0]?.()
    terminalState.resizeCallbacks[0]?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(terminalState.fitCalls).toBe(1)
    expect(window.go?.main?.App?.ResizeTerminal).toHaveBeenCalledTimes(1)

    terminalState.resizeCallbacks[0]?.()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(100)
    expect(window.go?.main?.App?.ResizeTerminal).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does not fit while hidden and fits once when shown again', async () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-hidden', active: true, visible: false, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
    terminalState.resizeCallbacks[0]?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(terminalState.fitCalls).toBe(0)
    expect(window.go?.main?.App?.ResizeTerminal).not.toHaveBeenCalled()

    await wrapper.setProps({ visible: true, layoutRevision: 1 })
    await vi.advanceTimersByTimeAsync(100)
    expect(terminalState.fitCalls).toBe(1)
    expect(window.go?.main?.App?.ResizeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-hidden',
      columns: 132,
      rows: 38,
    })
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('zooms only the current SSH terminal font with Ctrl+wheel and refits the PTY', async () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-zoom', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })
    wrapper.get('[data-terminal-surface="true"]').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(terminalState.options.fontSize).toBe(14)
    expect(Number(terminalState.options.lineHeight)).toBeGreaterThan(1.2)
    expect(Number(terminalState.options.letterSpacing)).toBeGreaterThan(0)
    expect(terminalState.options.fontWeight).toBe('normal')
    expect(terminalState.disposeCalls).toBe(0)
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
    expect(wrapper.get('[data-terminal-surface="true"]').attributes('data-terminal-kind')).toBe('ssh')
    expect(wrapper.get('[data-terminal-surface="true"]').attributes('data-terminal-session-id')).toBe('session-zoom')

    await vi.advanceTimersByTimeAsync(100)
    expect(terminalState.fitCalls).toBeGreaterThanOrEqual(1)
    expect(window.go?.main?.App?.ResizeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-zoom',
      columns: 132,
      rows: 38,
    })
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('handles terminal Ctrl+wheel during capture before xterm child wheel handlers can stop bubbling', () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-capture-zoom', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
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
    expect(Number(terminalState.options.lineHeight)).toBeGreaterThan(1.2)
    expect(Number(terminalState.options.letterSpacing)).toBeGreaterThan(0)
    expect(terminalState.disposeCalls).toBe(0)
    expect(wrapper.get('.terminal-view-host').attributes('data-terminal-surface')).toBeUndefined()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not mount a text overlay above the SSH terminal viewport', () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-no-highlight-overlay', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })

    expect(wrapper.find('.terminal-highlight-overlay').exists()).toBe(false)
    expect(wrapper.get('[data-terminal-surface="true"]').element.textContent).toBe('')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('enables the xterm proposed API required by viewport cell decorations', () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-decoration-api', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })

    try {
      expect(terminalState.instances[0].options.allowProposedApi).toBe(true)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('handles terminal Ctrl+wheel through xterm custom wheel interception', () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-xterm-wheel-zoom', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
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
    expect(Number(terminalState.options.letterSpacing)).toBeGreaterThan(0)
    expect(terminalState.options.fontWeight).toBe('normal')
    expect(terminalState.disposeCalls).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('keeps Ctrl+wheel zoom isolated from other SSH terminal tabs', () => {
    const pinia = createPinia()
    const sameServer = {
      id: 101,
      groupId: null,
      name: 'same-server',
      host: '192.0.2.101',
      port: 22,
      username: 'root',
      authType: 'password',
      privateKeySource: 'local_file',
      privateKeyPath: '',
      keyVaultId: null,
      terminalProfileId: null,
      hostKeyFingerprint: '',
      credentialSaved: false,
      refreshInterval: 2,
      createdAt: '',
      updatedAt: '',
    } as const
    const otherServer = { ...sameServer, id: 202, name: 'other-server', host: '192.0.2.202' } as const
    const first = mount(TerminalView, {
      props: { sessionId: 'session-a', active: true, layoutRevision: 0, connection: sameServer },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    const sameServerTab = mount(TerminalView, {
      props: { sessionId: 'session-b', active: false, layoutRevision: 0, connection: sameServer },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    const otherServerTab = mount(TerminalView, {
      props: { sessionId: 'session-c', active: false, layoutRevision: 0, connection: otherServer },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    first.get('[data-terminal-surface="true"]').element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    }))

    expect(terminalState.instances[0].options.fontSize).toBe(14)
    expect(terminalState.instances[1].options.fontSize).toBe(13)
    expect(terminalState.instances[2].options.fontSize).toBe(13)
    expect(terminalState.instances[0].disposeCalls).toBe(0)
    expect(terminalState.instances[1].disposeCalls).toBe(0)
    expect(terminalState.instances[2].disposeCalls).toBe(0)

    first.unmount()
    sameServerTab.unmount()
    otherServerTab.unmount()
    vi.useRealTimers()
  })

  it('clamps SSH terminal wheel zoom between 10 and 28 without changing profile state', () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-zoom-clamp', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
    const surface = wrapper.get('[data-terminal-surface="true"]').element

    for (let index = 0; index < 30; index += 1) {
      surface.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
      }))
    }
    expect(terminalState.options.fontSize).toBe(28)

    for (let index = 0; index < 40; index += 1) {
      surface.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: 100,
      }))
    }
    expect(terminalState.options.fontSize).toBe(10)
    expect(terminalState.disposeCalls).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('retains the session zoom delta when a terminal profile is applied', async () => {
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-retain-zoom', active: true, layoutRevision: 0 },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
    wrapper.get('[data-terminal-surface="true"]').element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    }))
    expect(terminalState.options.fontSize).toBe(14)

    await wrapper.setProps({
      profile: {
        id: 'tp-retain',
        name: 'Retain',
        fontFamily: 'Cascadia Mono',
        fontSize: 20,
        lineHeight: 1.5,
        letterSpacing: 0,
        cursorStyle: 'block',
        cursorBlink: true,
        scrollback: 10000,
        themeName: 'custom',
        foreground: '#eceff4',
        background: '#020617',
        selectionBackground: '#93c5fd88',
        cursorColor: '#f5f7fa',
        createdAt: '',
        updatedAt: '',
      },
      profileRevision: 1,
    })

    expect(terminalState.options.fontSize).toBe(21)
    expect(terminalState.disposeCalls).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('applies terminal profile options without recreating the terminal', async () => {
    const wrapper = mount(TerminalView, {
      props: {
        sessionId: 'session-profile',
        active: true,
        layoutRevision: 0,
        profile: {
          id: 'tp-ops',
          name: 'Ops',
          fontFamily: 'Consolas',
          fontSize: 18,
          lineHeight: 1.4,
          letterSpacing: 1,
          cursorStyle: 'bar',
          cursorBlink: false,
          scrollback: 20000,
          themeName: 'custom',
          foreground: '#ffffff',
          background: '#111827',
          selectionBackground: '#3f7dff66',
          cursorColor: '#facc15',
          createdAt: '',
          updatedAt: '',
        },
        profileRevision: 0,
      },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })

    await wrapper.setProps({
      profile: {
        id: 'tp-ops',
        name: 'Ops',
        fontFamily: 'Cascadia Mono',
        fontSize: 20,
        lineHeight: 1.5,
        letterSpacing: 2,
        cursorStyle: 'underline',
        cursorBlink: true,
        scrollback: 30000,
        themeName: 'custom',
        foreground: '#eceff4',
        background: '#020617',
        selectionBackground: '#93c5fd88',
        cursorColor: '#f5f7fa',
        createdAt: '',
        updatedAt: '',
      },
      profileRevision: 1,
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(terminalState.options.fontSize).toBe(20)
    expect(terminalState.options.fontFamily).toBe('Cascadia Mono')
    expect(terminalState.options.scrollback).toBe(30000)
    expect(terminalState.disposeCalls).toBe(0)
    expect(terminalState.fitCalls).toBeGreaterThanOrEqual(1)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('applies a matching registered profile directly to an open SSH terminal', async () => {
    const wrapper = mount(TerminalView, {
      props: {
        sessionId: 'session-registry',
        active: true,
        layoutRevision: 0,
        connection: {
          id: 42,
          groupId: null,
          name: 'server',
          host: '192.0.2.42',
          port: 22,
          username: 'root',
          authType: 'password',
          privateKeySource: 'local_file',
          privateKeyPath: '',
          keyVaultId: null,
          terminalProfileId: 'tp-registry',
          hostKeyFingerprint: '',
          credentialSaved: false,
          refreshInterval: 2,
          createdAt: '',
          updatedAt: '',
        },
        profile: {
          id: 'tp-registry',
          name: 'Registry',
          fontFamily: 'Consolas',
          fontSize: 15,
          lineHeight: 1.2,
          letterSpacing: 0,
          cursorStyle: 'block',
          cursorBlink: true,
          scrollback: 10000,
          themeName: 'serverpilot-dark',
          foreground: '#eceff4',
          background: '#1f2023',
          selectionBackground: '#3f7dff66',
          cursorColor: '#f5f7fa',
          createdAt: '',
          updatedAt: '',
        },
      },
      global: { plugins: [createPinia()], stubs: { ContextMenu: true } },
    })
    await vi.advanceTimersByTimeAsync(100)

    const count = applyTerminalProfileToRegisteredInstances({
      id: 'tp-registry',
      name: 'Registry',
      fontFamily: 'JetBrains Mono',
      fontSize: 21,
      lineHeight: 1.5,
      letterSpacing: 1,
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 32000,
      themeName: 'custom',
      foreground: '#ffffff',
      background: '#020617',
      selectionBackground: '#93c5fd88',
      cursorColor: '#facc15',
      createdAt: '',
      updatedAt: '',
    }, 'default')
    await vi.advanceTimersByTimeAsync(100)

    expect(count).toBe(1)
    expect(terminalState.options.fontFamily).toBe('JetBrains Mono')
    expect(terminalState.options.fontSize).toBe(21)
    expect(terminalState.options.theme).toMatchObject({ background: '#020617' })
    expect(terminalState.disposeCalls).toBe(0)
    expect(window.go?.main?.App?.ResizeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-registry',
      columns: 132,
      rows: 38,
    })
    wrapper.unmount()
    expect(terminalInstanceCount()).toBe(0)
    vi.useRealTimers()
  })

  it('follows output at the bottom but preserves history scrolling', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    store.subscribe()
    const wrapper = mount(TerminalView, {
      props: { sessionId: 'session-2', active: true, layoutRevision: 0 },
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    await vi.advanceTimersByTimeAsync(100)

    terminalState.eventCallbacks.get('terminal:output')?.({
      sessionId: 'session-2',
      dataBase64: btoa('first'),
    })
    expect(terminalState.scrollBottomCalls).toBe(1)
    expect(wrapper.find('.terminal-scroll-bottom').exists()).toBe(false)

    terminalState.viewportY = 60
    terminalState.scrollCallbacks.forEach((callback) => callback())
    terminalState.eventCallbacks.get('terminal:output')?.({
      sessionId: 'session-2',
      dataBase64: btoa('second'),
    })
    await wrapper.vm.$nextTick()
    expect(terminalState.scrollBottomCalls).toBe(1)
    expect(wrapper.find('.terminal-scroll-bottom').exists()).toBe(false)
    wrapper.unmount()
    vi.useRealTimers()
  })
})
