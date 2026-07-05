// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalPaneHeader, { type TerminalPaneMoveOption } from './TerminalPaneHeader.vue'

const occupiedPaneOptions: TerminalPaneMoveOption[] = [{ paneId: 'pane-2', label: 'right: server #2' }]
const emptyPaneOptions: TerminalPaneMoveOption[] = [{ paneId: 'pane-3', label: 'bottom-left' }]

function mountHeader(options: {
  kind?: 'ssh' | 'local'
  menuOpen?: boolean
  menuMode?: 'main' | 'swap' | 'move'
  hasActivity?: boolean
  maximized?: boolean
} = {}) {
  return mount(TerminalPaneHeader, {
    attachTo: document.body,
    props: {
      paneId: 'pane-1',
      kind: options.kind ?? 'ssh',
      title: options.kind === 'local' ? 'PowerShell' : 'server #1',
      statusClass: 'online',
      statusText: 'connected',
      activityLabel: options.hasActivity ? '2' : '',
      activityTitle: '2 new outputs',
      hasActivity: options.hasActivity ?? false,
      maximized: options.maximized ?? false,
      menuOpen: options.menuOpen ?? false,
      menuMode: options.menuMode ?? 'main',
      occupiedPaneOptions,
      emptyPaneOptions,
    },
  })
}

function paneMenu() {
  return document.body.querySelector<HTMLElement>('.terminal-pane-menu')
}

function paneMenuButton(selector: string) {
  return document.body.querySelector<HTMLButtonElement>(selector)!
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

describe('TerminalPaneHeader', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('renders title, status, activity badge, clear button, and menu trigger', async () => {
    const wrapper = mountHeader({ hasActivity: true })

    expect(wrapper.get('.terminal-pane-title').text()).toBe('server #1')
    expect(wrapper.get('.status-dot').classes()).toContain('online')
    expect(wrapper.get('.terminal-pane-activity').text()).toBe('2')

    await wrapper.get('.terminal-pane-menu-trigger').trigger('click')
    await wrapper.get('.terminal-pane-clear').trigger('click')
    wrapper.get('.terminal-pane-header').element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    )

    expect(wrapper.emitted('toggleMenu')).toEqual([['pane-1']])
    expect(wrapper.emitted('clearPane')).toEqual([['pane-1']])
    expect(wrapper.emitted('dragStart')?.[0][0]).toBe('pane-1')
  })

  it('renders the current pane menu actions and emits semantic events only', async () => {
    const wrapper = mountHeader({ menuOpen: true, hasActivity: true })

    expect(paneMenuButton('[data-action="add-server-pane"]')).not.toBeNull()
    expect(paneMenuButton('[data-action="connect-saved-pane"]')).not.toBeNull()
    expect(paneMenuButton('[data-action="select-connected-pane"]')).not.toBeNull()
    expect(paneMenuButton('[data-action="clear-activity"]').disabled).toBe(false)

    paneMenuButton('[data-action="add-server-pane"]').click()
    paneMenuButton('[data-action="connect-saved-pane"]').click()
    paneMenuButton('[data-action="select-connected-pane"]').click()
    paneMenuButton('[data-action="new-cmd-pane"]').click()
    paneMenuButton('[data-action="new-powershell-pane"]').click()
    paneMenuButton('[data-action="replace-terminal"]').click()
    paneMenuButton('[data-action="clear-activity"]').click()
    paneMenuButton('[data-action="clear-pane"]').click()
    paneMenuButton('[data-action="toggle-maximize"]').click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('addServer')).toEqual([['pane-1']])
    expect(wrapper.emitted('connectSaved')).toEqual([['pane-1']])
    expect(wrapper.emitted('selectConnected')).toEqual([['pane-1']])
    expect(wrapper.emitted('newLocal')).toEqual([['pane-1', 'cmd'], ['pane-1', 'powershell']])
    expect(wrapper.emitted('replaceTerminal')).toEqual([['pane-1']])
    expect(wrapper.emitted('clearActivity')).toEqual([['pane-1']])
    expect(wrapper.emitted('clearPane')).toEqual([['pane-1']])
    expect(wrapper.emitted('toggleMaximize')).toEqual([['pane-1']])
  })

  it('renders swap and move target menus with disabled states matching options', async () => {
    const swap = mountHeader({ menuOpen: true, menuMode: 'swap' })
    expect(paneMenuButton('[data-action="swap-pane"]').disabled).toBe(false)
    paneMenuButton('[data-swap-target="pane-2"]').click()
    await swap.vm.$nextTick()
    expect(swap.emitted('swapPane')).toEqual([['pane-1', 'pane-2']])
    swap.unmount()
    document.body.replaceChildren()

    const move = mountHeader({ menuOpen: true, menuMode: 'move' })
    expect(paneMenuButton('[data-action="move-pane"]').disabled).toBe(false)
    paneMenuButton('[data-move-target="pane-3"]').click()
    await move.vm.$nextTick()
    expect(move.emitted('movePane')).toEqual([['pane-1', 'pane-3']])
  })

  it('positions the pane header menu with the shared viewport helper without starting pane drag', async () => {
    setViewportSize(260, 180)
    const wrapper = mountHeader({ menuOpen: true, menuMode: 'main', maximized: true })
    vi.spyOn(wrapper.get('.terminal-pane-menu-trigger').element, 'getBoundingClientRect').mockReturnValue({
      x: 226, y: 8, width: 26, height: 22, top: 8, right: 252,
      bottom: 30, left: 226, toJSON: () => undefined,
    })
    vi.spyOn(paneMenu()!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 210, height: 360, top: 0, right: 210,
      bottom: 360, left: 0, toJSON: () => undefined,
    })

    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const menu = paneMenu()!
    const left = Number.parseInt(menu.style.left, 10)
    const top = Number.parseInt(menu.style.top, 10)
    const width = Number.parseInt(menu.style.width, 10)
    const maxHeight = Number.parseInt(menu.style.maxHeight, 10)
    expect(menu.parentElement).toBe(document.body)
    expect(menu.classList.contains('viewport-popover')).toBe(true)
    expect(menu.classList.contains('viewport-popover-scroll')).toBe(true)
    expect(left + width).toBeLessThanOrEqual(252)
    expect(top + maxHeight).toBeLessThanOrEqual(172)

    menu.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('dragStart')).toBeUndefined()
  })
})
