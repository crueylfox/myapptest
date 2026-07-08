// @vitest-environment jsdom

import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, LocalTerminalState } from '../types'
import { useLocalTerminalStore } from '../stores/localTerminal'
import { useTerminalStore } from '../stores/terminal'
import WorkspaceTabs from './WorkspaceTabs.vue'

const first: Connection = {
  id: 1, groupId: null, name: 'one', host: '192.0.2.1', port: 22,
  username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
  hostKeyFingerprint: '', credentialSaved: false, refreshInterval: 2,
  createdAt: '', updatedAt: '',
}
const second = { ...first, id: 2, name: 'two', host: '192.0.2.2' }

function localState(sessionId: string, overrides: Partial<LocalTerminalState> = {}): LocalTerminalState {
  return {
    sessionId,
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
    ...overrides,
  }
}

function pointer(type: string, x: number, y = 10) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
}

function mockTabRect(tab: Element, left: number, width = 120) {
  vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({
    x: left, y: 0, width, height: 36, top: 0, right: left + width,
    bottom: 36, left, toJSON: () => undefined,
  })
}

function mockHorizontalOverflow(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth })
}

function render() {
  const pinia = createPinia()
  const store = useTerminalStore(pinia)
  store.navigateToServer(first)
  store.navigateToServer(second)
  const wrapper = mount(WorkspaceTabs, {
    global: { plugins: [pinia], stubs: { ContextMenu: true } },
  })
  return { wrapper, store }
}

function renderWithRealContextMenu() {
  const pinia = createPinia()
  const store = useTerminalStore(pinia)
  store.navigateToServer(first)
  store.navigateToServer(second)
  const wrapper = mount(WorkspaceTabs, {
    attachTo: document.body,
    global: { plugins: [pinia] },
  })
  return { wrapper, store }
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

describe('WorkspaceTabs', () => {
  beforeEach(() => {
    localStorage.clear()
    window.go = {
      main: {
        App: {
          CloseLocalTerminal: vi.fn(async () => undefined),
          CloseTerminal: vi.fn(async () => undefined),
          CloseSftpContext: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  it('removes the content brand and keeps plus after the final tab', () => {
    const { wrapper } = render()
    expect(wrapper.find('.topbar-brand').exists()).toBe(false)
    const children = wrapper.get('.workspace-tabs').element.children
    expect(children[children.length - 1].classList).toContain('topbar-add')
  })

  it('emits the real plus element as the server popover anchor', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-add').trigger('click')
    const anchor = wrapper.emitted('servers')?.[0]?.[0]
    expect(anchor).toBe(wrapper.get('.topbar-add').element)
  })

  it('renders the split menu in the fixed topbar area immediately before the global menu', () => {
    const { wrapper } = render()
    const topbarChildren = Array.from(wrapper.get('.workspace-topbar').element.children)
    const splitButton = wrapper.get('.topbar-split .split-mode-button')

    expect(wrapper.find('.topbar-split .split-mode-button').exists()).toBe(true)
    expect(splitButton.text()).toBe('分屏')
    expect(splitButton.find('.app-icon').exists()).toBe(true)
    expect(splitButton.text()).not.toContain('：')
    expect(splitButton.attributes('aria-label')).toBe('分屏，当前：单窗格')
    expect(topbarChildren.at(-3)).toBe(wrapper.get('.topbar-split').element)
    expect(topbarChildren.at(-2)).toBe(wrapper.get('.topbar-action-separator').element)
    expect(topbarChildren.at(-1)).toBe(wrapper.get('.topbar-navigation').element)
    expect(wrapper.get('.topbar-action-separator').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.topbar-navigation > button .app-icon').exists()).toBe(true)
    expect(wrapper.find('.topbar-navigation-chevron').exists()).toBe(false)
    expect(wrapper.get('.workspace-tabs').find('.split-mode-button').exists()).toBe(false)
  })

  it('marks the current split layout in the dropdown without adding it to the button label', async () => {
    localStorage.setItem('serverpilot.workspaceSplitLayout.v1', JSON.stringify({ splitMode: 'quad' }))
    const { wrapper } = render()

    expect(wrapper.get('.topbar-split .split-mode-button').text()).toBe('分屏')
    expect(wrapper.get('.topbar-split .split-mode-button').text()).not.toContain('四宫格')
    expect(wrapper.get('.topbar-split .split-mode-button').attributes('aria-label')).toBe('分屏，当前：四宫格')

    await wrapper.get('.topbar-split .split-mode-button').trigger('click')

    const quad = wrapper.get('.topbar-split [data-split-mode="quad"]')
    expect(quad.classes()).toContain('active')
    expect(quad.attributes('aria-current')).toBe('true')
  })

  it('dispatches split mode changes from the topbar split menu', async () => {
    const { wrapper } = render()
    const events: Array<string | undefined> = []
    const listener = (event: Event) => {
      events.push((event as CustomEvent<{ mode?: string }>).detail.mode)
    }
    window.addEventListener('serverpilot:workspace-split-mode-change', listener)

    await wrapper.get('.topbar-split .split-mode-button').trigger('click')
    await wrapper.get('.topbar-split [data-split-mode="quad"]').trigger('click')

    window.removeEventListener('serverpilot:workspace-split-mode-change', listener)
    expect(events).toEqual(['quad'])
    expect(localStorage.getItem('serverpilot.workspaceSplitLayout.v1')).toContain('"splitMode":"quad"')
    expect(wrapper.get('.topbar-split .split-mode-button').text()).toBe('分屏')
    expect(wrapper.get('.topbar-split .split-mode-button').text()).not.toContain('四宫格')
  })

  it('adds split layout management actions to the topbar split menu', async () => {
    localStorage.setItem('serverpilot.workspaceSplitLayout.v1', JSON.stringify({ splitMode: 'quad' }))
    const { wrapper } = render()
    const events: string[] = []
    const reset = () => events.push('reset')
    const clear = () => events.push('clear')
    window.addEventListener('serverpilot:workspace-split-ratio-reset', reset)
    window.addEventListener('serverpilot:workspace-split-clear-panes', clear)

    await wrapper.get('.topbar-split .split-mode-button').trigger('click')
    const resetButton = wrapper.get('.topbar-split [data-split-action="reset-ratios"]')
    const clearButton = wrapper.get('.topbar-split [data-split-action="clear-panes"]')
    expect(resetButton.text()).toBe('重置分割比例')
    expect(clearButton.text()).toBe('清空所有窗格')
    expect(resetButton.attributes('disabled')).toBeUndefined()

    await resetButton.trigger('click')
    await wrapper.get('.topbar-split .split-mode-button').trigger('click')
    await wrapper.get('.topbar-split [data-split-action="clear-panes"]').trigger('click')

    window.removeEventListener('serverpilot:workspace-split-ratio-reset', reset)
    window.removeEventListener('serverpilot:workspace-split-clear-panes', clear)
    expect(events).toEqual(['reset', 'clear'])
  })

  it('disables ratio reset in single-pane mode while leaving clear layout available', async () => {
    const { wrapper } = render()

    await wrapper.get('.topbar-split .split-mode-button').trigger('click')

    expect(wrapper.get('.topbar-split [data-split-action="reset-ratios"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.topbar-split [data-split-action="clear-panes"]').attributes('disabled')).toBeUndefined()
  })

  it('keeps the split menu available while a local terminal tab is active', async () => {
    const pinia = createPinia()
    const localStore = useLocalTerminalStore(pinia)
    localStore.sessions.push(localState('local-active', { title: 'CMD', shellKind: 'cmd', shell: 'CMD' }))
    localStore.activeSessionId = 'local-active'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    expect(wrapper.find('.topbar-split .split-mode-button').exists()).toBe(true)
    await wrapper.get('.topbar-split .split-mode-button').trigger('click')
    expect(wrapper.find('.topbar-split [data-split-mode="quad"]').exists()).toBe(true)
  })

  it('scrolls overflowing tabs horizontally with the mouse wheel', async () => {
    const { wrapper } = render()
    const host = wrapper.get('.workspace-tabs').element as HTMLElement
    mockHorizontalOverflow(host, 900, 300)
    host.scrollLeft = 10

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })
    host.dispatchEvent(wheel)

    expect(host.scrollLeft).toBe(90)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('keeps trackpad horizontal delta and does not intercept wheel without overflow', () => {
    const { wrapper } = render()
    const host = wrapper.get('.workspace-tabs').element as HTMLElement
    mockHorizontalOverflow(host, 900, 300)
    host.scrollLeft = 4

    const horizontal = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 33, deltaY: 4 })
    host.dispatchEvent(horizontal)
    expect(host.scrollLeft).toBe(37)
    expect(horizontal.defaultPrevented).toBe(true)

    mockHorizontalOverflow(host, 300, 300)
    const noOverflow = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 50 })
    host.dispatchEvent(noOverflow)
    expect(noOverflow.defaultPrevented).toBe(false)
  })

  it('switches tabs with arrow keys only when the tab bar or tab button has focus', async () => {
    const { wrapper, store } = render()
    store.activateWorkspaceServer(1)
    await wrapper.vm.$nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(store.activeWorkspaceServerId).toBe(1)

    const firstTab = wrapper.findAll('.terminal-tab')[0]
    firstTab.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(store.activeWorkspaceServerId).toBe(2)

    wrapper.get('.workspace-tabs').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(store.activeWorkspaceServerId).toBe(1)

    wrapper.get('.workspace-tabs').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(store.activeWorkspaceServerId).toBe(2)
  })

  it('scrolls the active tab into view after keyboard switching and activation changes', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    const { wrapper, store } = render()
    store.activateWorkspaceServer(1)
    await wrapper.vm.$nextTick()
    scrollIntoView.mockClear()

    wrapper.get('.workspace-tabs').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(store.activeWorkspaceServerId).toBe(2)
    expect(scrollIntoView).toHaveBeenCalled()
    scrollIntoView.mockRestore()
  })

  it('shows the port forwarding entry in the top navigation menu', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text().includes('端口转发'))
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(wrapper.emitted('tunnels')).toEqual([[]])
  })

  it('moves server overview behind the monitor panel top navigation entry', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const labels = wrapper.findAll('.topbar-menu button').map((button) => button.text())
    expect(labels).not.toContain('服务器总览')

    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text() === '监控面板')
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(wrapper.emitted('monitorPanel')).toEqual([[]])
  })

  it('shows the docker management entry in the top navigation menu', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text().includes('容器管理'))
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(wrapper.emitted('docker')).toEqual([[]])
  })

  it('shows the process manager entry in the top navigation menu', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text().includes('进程管理'))
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(wrapper.emitted('processes')).toEqual([[]])
  })

  it('shows the network details entry in the top navigation menu', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text().includes('网络详情'))
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(wrapper.emitted('networkDiagnostics')).toEqual([[]])
  })

  it('shows the alert center menu entry with unread badge', async () => {
    const { wrapper } = render()
    await wrapper.setProps({ alertUnreadCount: 3 })
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text().includes('告警中心'))
    expect(item).toBeTruthy()
    expect(item!.text()).toContain('3')
    await item!.trigger('click')
    expect(wrapper.emitted('alerts')).toEqual([[]])
  })

  it('shows the system services entry in the top navigation menu', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const item = wrapper.findAll('.topbar-menu button')
      .find((button) => button.text().includes('系统服务'))
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(wrapper.emitted('systemServices')).toEqual([[]])
  })

  it('does not show batch command in the top navigation menu', async () => {
    const { wrapper } = render()
    await wrapper.get('.topbar-navigation > button').trigger('click')
    const labels = wrapper.findAll('.topbar-menu button').map((button) => button.text())
    expect(labels).not.toContain('批量命令')
    expect(labels).toEqual(expect.arrayContaining([
      'SSH 工作区',
      '端口转发',
      '容器管理',
      '进程管理',
      '系统服务',
      '网络详情',
      '监控面板',
      '设置',
    ]))
    expect(labels).not.toContain('应用日志')
  })

  it('renders top navigation menu as icon option items without item separators', async () => {
    const { wrapper } = render()
    await wrapper.setProps({ alertUnreadCount: 2 })
    await wrapper.get('.topbar-navigation > button').trigger('click')

    expect(wrapper.find('.topbar-split .topbar-action-inner').exists()).toBe(true)
    expect(wrapper.find('.topbar-navigation > button .topbar-action-inner').exists()).toBe(true)

    const menu = wrapper.get('.topbar-menu')
    const items = menu.findAll('button')
    const separators = menu.findAll('.topbar-menu-separator')
    const labels = menu.findAll('.topbar-menu-label').map((label) => label.text())

    expect(items).toHaveLength(9)
    expect(menu.findAll('.app-icon')).toHaveLength(9)
    expect(separators).toHaveLength(0)
    expect(labels).toEqual([
      'SSH 工作区',
      '端口转发',
      '容器管理',
      '进程管理',
      '系统服务',
      '网络详情',
      '告警中心',
      '监控面板',
      '设置',
    ])
    for (const item of items) {
      expect(item.classes()).toContain('topbar-menu-item')
      expect(item.find('.topbar-menu-leading').exists()).toBe(true)
      expect(item.find('.topbar-menu-content').exists()).toBe(true)
      expect(item.find('.topbar-menu-trailing').exists()).toBe(true)
      expect(item.find('.topbar-menu-label').classes()).not.toContain('truncate')
      expect(item.find('.topbar-menu-label').classes()).not.toContain('ellipsis')
      expect(item.classes()).not.toContain('primary')
      expect(item.classes()).not.toContain('secondary')
      expect(item.classes()).not.toContain('danger')
    }
    expect(menu.get('.topbar-menu-badge').text()).toBe('2')
    expect(menu.get('.topbar-menu-badge').element.parentElement?.classList.contains('topbar-menu-trailing')).toBe(true)
  })

  it('drags workspace order without changing the active workspace and persists it', async () => {
    const { wrapper, store } = render()
    store.activateWorkspaceServer(1)
    const tabs = wrapper.findAll('.terminal-tab')
    mockTabRect(tabs[0].element, 0)
    mockTabRect(tabs[1].element, 120)

    tabs[0].element.dispatchEvent(pointer('pointerdown', 12))
    window.dispatchEvent(pointer('pointermove', 230))
    window.dispatchEvent(pointer('pointerup', 230))
    await wrapper.vm.$nextTick()

    expect(store.workspaceOrder).toEqual([2, 1])
    expect(store.activeWorkspaceServerId).toBe(1)
    expect(localStorage.getItem('serverpilot.workspaceTabOrder')).toBe('[2,1]')
  })

  it('reorders SSH terminal tabs in the same window without recreating sessions', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 'ssh-1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 'ssh-2', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    store.activate('ssh-1')
    await wrapper.vm.$nextTick()
    const tabs = wrapper.findAll('.terminal-tab')
    mockTabRect(tabs[0].element, 0)
    mockTabRect(tabs[1].element, 120)

    tabs[0].element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 230))
    window.dispatchEvent(pointer('pointerup', 230))
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.attributes('data-session-id'))).toEqual(['ssh-2', 'ssh-1'])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['ssh-1', 'ssh-2'])
    expect(store.activeSessionId).toBe('ssh-1')
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('reorders Local Terminal tabs without restarting the local process', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    localStore.sessions.push(
      localState('local-1', { title: 'CMD', shell: 'CMD', shellName: 'cmd.exe' }),
      localState('local-2', { title: 'PowerShell' }),
    )
    localStore.activeSessionId = 'local-1'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    await wrapper.vm.$nextTick()
    const tabs = wrapper.findAll('.terminal-tab')
    mockTabRect(tabs[0].element, 0)
    mockTabRect(tabs[1].element, 120)

    tabs[0].element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 230))
    window.dispatchEvent(pointer('pointerup', 230))
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.attributes('data-local-session-id'))).toEqual(['local-2', 'local-1'])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-1', 'local-2'])
    expect(localStore.activeSessionId).toBe('local-1')
    expect(store.activeSessionId).toBeNull()
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
  })

  it('does not reorder tabs from close buttons, add button, or tiny pointer movement', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 'ssh-1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 'ssh-2', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    await wrapper.vm.$nextTick()
    const tabs = wrapper.findAll('.terminal-tab')
    mockTabRect(tabs[0].element, 0)
    mockTabRect(tabs[1].element, 120)

    tabs[0].find('.terminal-close').element.dispatchEvent(pointer('pointerdown', 12))
    window.dispatchEvent(pointer('pointermove', 230))
    window.dispatchEvent(pointer('pointerup', 230))
    wrapper.get('.topbar-add').element.dispatchEvent(pointer('pointerdown', 12))
    window.dispatchEvent(pointer('pointermove', 230))
    window.dispatchEvent(pointer('pointerup', 230))
    tabs[0].element.dispatchEvent(pointer('pointerdown', 12))
    window.dispatchEvent(pointer('pointermove', 15))
    window.dispatchEvent(pointer('pointerup', 15))
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.attributes('data-session-id'))).toEqual(['ssh-1', 'ssh-2'])
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('documents that native tab tear-out is unavailable instead of creating a fake window', async () => {
    const { wrapper, store } = render()
    store.tabs.push({ sessionId: 'ssh-1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.workspace-tabs').attributes('data-native-detach-supported')).toBe('false')

    const tab = wrapper.find('[data-session-id="ssh-1"]')
    mockTabRect(tab.element, 0)
    tab.element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 10, -60))
    window.dispatchEvent(pointer('pointerup', 10, -60))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.workspace-detached-window').exists()).toBe(false)
    expect(wrapper.find('[data-session-id="ssh-1"]').exists()).toBe(true)
    expect(store.tabs.map((item) => item.sessionId)).toEqual(['ssh-1'])
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['当前版本暂不支持拖出为新窗口。', 'info'])
  })

  it('lets an in-window split pane consume a tab drag outside the tab bar', async () => {
    const { wrapper, store } = render()
    store.tabs.push({ sessionId: 'ssh-1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    await wrapper.vm.$nextTick()
    const listener = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener('serverpilot:workspace-tab-external-drop', listener)

    const tab = wrapper.find('[data-session-id="ssh-1"]')
    mockTabRect(tab.element, 0)
    tab.element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 10, -60))
    window.dispatchEvent(pointer('pointerup', 10, -60))
    await wrapper.vm.$nextTick()
    window.removeEventListener('serverpilot:workspace-tab-external-drop', listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      kind: 'terminal',
      sessionId: 'ssh-1',
      clientX: 10,
      clientY: -60,
    })
    expect(wrapper.emitted('notify')).toBeUndefined()
    expect(wrapper.find('[data-session-id="ssh-1"]').exists()).toBe(true)
  })

  it('emits Local Terminal external drop details for split panes without showing the native tear-out toast', async () => {
    const pinia = createPinia()
    const localStore = useLocalTerminalStore(pinia)
    localStore.sessions.push(localState('local-drag', { title: 'CMD', shellKind: 'cmd', shell: 'CMD' }))
    localStore.activeSessionId = 'local-drag'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    await wrapper.vm.$nextTick()
    const listener = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener('serverpilot:workspace-tab-external-drop', listener)

    const tab = wrapper.find('[data-local-session-id="local-drag"]')
    mockTabRect(tab.element, 0)
    tab.element.dispatchEvent(pointer('pointerdown', 10))
    window.dispatchEvent(pointer('pointermove', 10, -60))
    window.dispatchEvent(pointer('pointerup', 10, -60))
    await wrapper.vm.$nextTick()
    window.removeEventListener('serverpilot:workspace-tab-external-drop', listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      kind: 'local',
      localSessionId: 'local-drag',
      clientX: 10,
      clientY: -60,
    })
    expect(wrapper.emitted('notify')).toBeUndefined()
  })

  it('does not render a permanent local terminal topbar shortcut', () => {
    const { wrapper, store } = render()
    store.activateWorkspaceServer(1)
    expect(wrapper.find('.topbar-local-terminal').exists()).toBe(false)
    expect(wrapper.find('.topbar-add').exists()).toBe(true)
    expect(store.activeWorkspaceServerId).toBe(1)
  })

  it('renders one terminal tab per session for the same server', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's3', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
    )
    store.activate('s2')
    await wrapper.vm.$nextTick()

    const serverTabs = wrapper.findAll('.terminal-tab').filter((tab) => tab.text().includes('one'))
    expect(serverTabs).toHaveLength(3)
    expect(serverTabs.map((tab) => tab.attributes('data-session-id'))).toEqual(['s1', 's2', 's3'])
    expect(serverTabs[0].text()).toContain('one')
    expect(serverTabs[1].text()).toContain('one #2')
    expect(serverTabs[2].text()).toContain('one #3')
    expect(serverTabs[1].classes()).toContain('active')
  })

  it('appends a new same-server terminal tab to the right instead of grouping it by server', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 'a1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 'b1', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    store.activate('b1')
    await wrapper.vm.$nextTick()

    store.tabs.push({ sessionId: 'a2', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    store.activate('a2')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.attributes('data-session-id'))).toEqual(['a1', 'b1', 'a2'])
    expect(wrapper.find('[data-session-id="a2"]').text()).toContain('one #2')
    expect(wrapper.find('[data-session-id="a2"]').classes()).toContain('active')
  })

  it('appends a newly opened server terminal tab to the far right', async () => {
    const { wrapper, store } = render()
    const third = { ...first, id: 3, name: 'three', host: '192.0.2.3' }
    store.ensureWorkspace(third)
    store.tabs.push(
      { sessionId: 'a1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 'b1', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    await wrapper.vm.$nextTick()

    store.tabs.push({ sessionId: 'c1', connectionId: 3, title: 'three', status: 'online', code: '', message: '' })
    store.activate('c1')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.attributes('data-session-id'))).toEqual(['a1', 'b1', 'c1'])
    expect(wrapper.find('[data-session-id="c1"]').text()).toContain('three')
  })

  it('closes only the selected terminal tab and does not disconnect the server', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's3', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
    )
    store.activate('s2')
    await wrapper.vm.$nextTick()

    const secondTerminalTab = wrapper.findAll('.terminal-tab')
      .find((tab) => tab.attributes('data-session-id') === 's2')!
    await secondTerminalTab.find('.terminal-close').trigger('click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith('s2')
    expect(window.go?.main?.App?.CloseSftpContext).toHaveBeenCalledWith({
      connectionId: 1,
      contextId: 's2',
      terminalSessionId: 's2',
    })
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['s1', 's3'])
    expect(store.activeWorkspaceServerId).toBe(1)
  })

  it('disconnects the server when closing its last terminal tab with one click', async () => {
    const { wrapper, store } = render()
    store.tabs.push({ sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    store.activate('s1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s1"] .terminal-close').trigger('click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseSftpContext).not.toHaveBeenCalled()
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(wrapper.emitted('finalTerminalDisconnect')).toEqual([[1]])
    expect(store.tabs).toHaveLength(0)
    expect(store.activeSessionId).toBeNull()
    expect(store.activeWorkspaceServerId).toBeNull()
    expect(store.hasWorkspace(1)).toBe(false)
    expect(store.workspaceOrder).not.toContain(1)
    expect(wrapper.findAll('.terminal-tab').some((tab) => tab.text().includes('one'))).toBe(false)
  })

  it('does not leave a disconnected workspace tab when closing another server final terminal', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    store.activate('s2')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s2"] .terminal-close').trigger('click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseSftpContext).not.toHaveBeenCalled()
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(wrapper.emitted('finalTerminalDisconnect')).toEqual([[2]])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['s1'])
    expect(store.activeWorkspaceServerId).toBe(1)
    expect(store.hasWorkspace(2)).toBe(false)
    expect(wrapper.findAll('.terminal-tab').some((tab) => tab.text().includes('two'))).toBe(false)
  })

  it('shows terminal-session close and server-disconnect as separate tab menu actions', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
    )
    store.activate('s1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s1"]').trigger('contextmenu')
    const menu = wrapper.getComponent({ name: 'ContextMenu' })
    const labels = menu.props('items').map((item: { label: string }) => item.label)
    expect(labels).not.toContain('关闭服务器工作区')
    expect(labels).toContain('仅关闭当前终端')
    expect(labels).toContain('关闭此服务器全部终端')
    expect(labels).toContain('断开此服务器')

    menu.vm.$emit('select', 'close-session')
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith('s1')
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
  })

  it('renders the tab context menu through the shared viewport popover helper near the right edge', async () => {
    setViewportSize(260, 180)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 260, top: 0, right: 190,
      bottom: 260, left: 0, toJSON: () => undefined,
    })
    const { wrapper, store } = renderWithRealContextMenu()
    store.tabs.push({ sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    store.activate('s1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s1"]').trigger('contextmenu', { clientX: 248, clientY: 24 })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    const menu = document.body.querySelector<HTMLElement>('.context-menu')!
    const left = Number.parseInt(menu.style.left, 10)
    const width = Number.parseInt(menu.style.width, 10)
    expect(menu.classList.contains('viewport-popover')).toBe(true)
    expect(left + width).toBeLessThanOrEqual(254)

    await wrapper.find('[data-session-id="s1"] .terminal-close').trigger('click')
    expect(document.body.querySelector('.context-menu')).not.toBeNull()
    wrapper.unmount()
  })

  it('shows and clears inactive SSH output activity on top tabs', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    store.activate('s1')
    store.outputActivityBySession.s2 = {
      hasActivity: true,
      unreadCount: 2,
      lastActivityAt: 123,
    }
    await wrapper.vm.$nextTick()

    const inactive = wrapper.get('[data-session-id="s2"]')
    expect(inactive.get('[data-terminal-activity-badge]').text()).toBe('2')
    expect(inactive.get('[data-terminal-activity-badge]').attributes('title')).toContain('新输出')

    await inactive.trigger('click')
    await wrapper.vm.$nextTick()

    expect(store.activeSessionId).toBe('s2')
    expect(store.outputActivityBySession.s2).toBeUndefined()
    expect(wrapper.find('[data-session-id="s2"] [data-terminal-activity-badge]').exists()).toBe(false)
  })

  it('shows and clears inactive Local Terminal output activity on top tabs', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.navigateToServer(first)
    localStore.setEnabled(true)
    localStore.sessions.push(
      localState('local-active', { title: 'CMD', shellKind: 'cmd', shell: 'CMD' }),
      localState('local-idle', { title: 'PowerShell' }),
    )
    localStore.activeSessionId = 'local-active'
    localStore.outputActivityBySession['local-idle'] = {
      hasActivity: true,
      unreadCount: 7,
      lastActivityAt: 456,
    }
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    await wrapper.vm.$nextTick()

    const inactive = wrapper.get('[data-local-session-id="local-idle"]')
    expect(inactive.get('[data-terminal-activity-badge]').text()).toBe('7')

    await inactive.trigger('click')
    await wrapper.vm.$nextTick()

    expect(localStore.activeSessionId).toBe('local-idle')
    expect(localStore.outputActivityBySession['local-idle']).toBeUndefined()
    expect(wrapper.find('[data-local-session-id="local-idle"] [data-terminal-activity-badge]').exists()).toBe(false)
  })

  it('clears output activity from the tab context menu without closing or activating another session', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    store.activate('s1')
    store.outputActivityBySession.s2 = {
      hasActivity: true,
      unreadCount: 4,
      lastActivityAt: 789,
    }
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s2"]').trigger('contextmenu')
    const menu = wrapper.getComponent({ name: 'ContextMenu' })
    const items = menu.props('items') as Array<{ id: string; label: string; disabled?: boolean }>
    expect(items).toContainEqual(expect.objectContaining({
      id: 'clear-activity',
      label: '清除新输出标记',
      disabled: false,
    }))

    menu.vm.$emit('select', 'clear-activity')
    await wrapper.vm.$nextTick()

    expect(store.outputActivityBySession.s2).toBeUndefined()
    expect(store.activeSessionId).toBe('s1')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('emits server edit from an SSH terminal tab without disconnecting or closing sessions', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
    )
    store.activate('s2')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s2"]').trigger('contextmenu')
    const menu = wrapper.getComponent({ name: 'ContextMenu' })
    const items = menu.props('items') as Array<{ id: string; label: string }>

    expect(items[0]).toMatchObject({ id: 'edit-server', label: '编辑' })
    expect(items.map((item) => item.label)).toContain('新建同服务器终端')

    menu.vm.$emit('select', 'edit-server')
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(wrapper.emitted('editServer')).toEqual([[1]])
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(wrapper.emitted('finalTerminalDisconnect')).toBeUndefined()
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseSftpContext).not.toHaveBeenCalled()
  })

  it('emits server edit from a workspace-only server tab', async () => {
    const { wrapper } = render()
    const tab = wrapper.findAll('.terminal-tab').find((item) => item.text().includes('one'))
    expect(tab).toBeTruthy()

    await tab!.trigger('contextmenu')
    const menu = wrapper.getComponent({ name: 'ContextMenu' })
    expect((menu.props('items') as Array<{ id: string }>)[0].id).toBe('edit-server')

    menu.vm.$emit('select', 'edit-server')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('editServer')).toEqual([[1]])
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
  })

  it('disconnects the server from the context menu when closing its last terminal tab', async () => {
    const { wrapper, store } = render()
    store.tabs.push({ sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    store.activate('s1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s1"]').trigger('contextmenu')
    wrapper.getComponent({ name: 'ContextMenu' }).vm.$emit('select', 'close-session')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseSftpContext).not.toHaveBeenCalled()
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(wrapper.emitted('finalTerminalDisconnect')).toEqual([[1]])
    expect(store.tabs).toHaveLength(0)
    expect(store.activeWorkspaceServerId).toBeNull()
    expect(store.hasWorkspace(1)).toBe(false)
    expect(wrapper.findAll('.terminal-tab').some((tab) => tab.text().includes('one'))).toBe(false)
  })

  it('emits disconnect only from the explicit server disconnect menu item', async () => {
    const { wrapper, store } = render()
    store.tabs.push({ sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    store.activate('s1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s1"]').trigger('contextmenu')
    wrapper.getComponent({ name: 'ContextMenu' }).vm.$emit('select', 'disconnect-server')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('disconnectServer')?.at(-1)).toEqual([1])
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('disconnects a server when closing all of its terminal sessions', async () => {
    const { wrapper, store } = render()
    store.tabs.push(
      { sessionId: 's1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 's2', connectionId: 1, title: 'one', status: 'online', code: '', message: '' },
      { sessionId: 'other', connectionId: 2, title: 'two', status: 'online', code: '', message: '' },
    )
    store.activate('s1')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-session-id="s1"]').trigger('contextmenu')
    wrapper.getComponent({ name: 'ContextMenu' }).vm.$emit('select', 'close-server-terminals')
    await Promise.resolve()
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(wrapper.emitted('finalTerminalDisconnect')).toEqual([[1]])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['other'])
  })

  it('closes a local terminal tab without disconnecting a server workspace', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.navigateToServer(first)
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-1'))
    localStore.activeSessionId = 'local-1'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    const localTab = wrapper.findAll('.terminal-tab').find((tab) => tab.text().includes('PowerShell'))
    expect(localTab).toBeTruthy()
    await localTab!.find('.terminal-close').trigger('click')
    await Promise.resolve()

    expect(window.go?.main?.App?.CloseLocalTerminal).toHaveBeenCalledWith('local-1')
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(store.hasWorkspace(1)).toBe(true)
  })

  it('does not show server edit on a local terminal tab menu', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.navigateToServer(first)
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-menu'))
    localStore.activeSessionId = 'local-menu'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    const localTab = wrapper.findAll('.terminal-tab').find((tab) => tab.text().includes('PowerShell'))
    expect(localTab).toBeTruthy()
    await localTab!.trigger('contextmenu')

    const items = wrapper.getComponent({ name: 'ContextMenu' }).props('items') as Array<{ id: string; label: string; disabled?: boolean }>
    expect(items.map((item) => item.id)).not.toContain('edit-server')
    expect(items).toContainEqual(expect.objectContaining({
      id: 'clear-activity',
      label: '清除新输出标记',
      disabled: true,
    }))
    expect(items.map((item) => item.label).filter(Boolean)).toContain('关闭本地终端')
  })

  it('prevents local tab close events from bubbling into tab activation', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.navigateToServer(first)
    store.clearActiveWorkspace()
    localStore.sessions.push(localState('local-2'))
    localStore.activeSessionId = 'local-2'
    const closeSpy = vi.spyOn(localStore, 'close').mockResolvedValue(undefined)
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    const localTab = wrapper.findAll('.terminal-tab').find((tab) => tab.text().includes('PowerShell'))
    expect(localTab).toBeTruthy()
    const tabClick = vi.fn()
    localTab!.element.addEventListener('click', tabClick)

    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
    localTab!.find('.terminal-close').element.dispatchEvent(pointer)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    localTab!.find('.terminal-close').element.dispatchEvent(click)
    await Promise.resolve()

    expect(pointer.defaultPrevented).toBe(true)
    expect(click.defaultPrevented).toBe(true)
    expect(tabClick).not.toHaveBeenCalled()
    expect(closeSpy).toHaveBeenCalledWith('local-2')
  })

  it('falls back to the adjacent server workspace after closing the active local tab', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.navigateToServer(first)
    store.clearActiveWorkspace()
    localStore.sessions.push(localState('local-3'))
    localStore.activeSessionId = 'local-3'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })

    const localTab = wrapper.findAll('.terminal-tab').find((tab) => tab.text().includes('PowerShell'))
    await localTab!.find('.terminal-close').trigger('click')
    await Promise.resolve()

    expect(localStore.activeSessionId).toBeNull()
    expect(store.activeWorkspaceServerId).toBe(1)
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
  })

  it('keeps local terminal tabs in the unified creation order instead of pinning them right', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.tabs.push({ sessionId: 'ssh-1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    await wrapper.vm.$nextTick()

    localStore.sessions.push(localState('local-cmd', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    await wrapper.vm.$nextTick()
    store.tabs.push({ sessionId: 'ssh-2', connectionId: 2, title: 'two', status: 'online', code: '', message: '' })
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.text().replace('×', '').trim())).toEqual([
      'one',
      'CMD',
      'two',
    ])
    expect(wrapper.findAll('.terminal-tab').map((tab) => tab.attributes('data-session-id'))).toEqual([
      'ssh-1',
      undefined,
      'ssh-2',
    ])
  })

  it('auto-removes only the matching local tab when its shell exits', async () => {
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    const localStore = useLocalTerminalStore(pinia)
    store.tabs.push({ sessionId: 'ssh-1', connectionId: 1, title: 'one', status: 'online', code: '', message: '' })
    localStore.sessions.push(
      localState('local-exit', { shellKind: 'cmd', shell: 'CMD', shellName: 'cmd.exe', title: 'CMD' }),
      localState('local-keep', { title: 'PowerShell' }),
    )
    localStore.activeSessionId = 'local-exit'
    const wrapper = mount(WorkspaceTabs, {
      global: { plugins: [pinia], stubs: { ContextMenu: true } },
    })
    await wrapper.vm.$nextTick()

    localStore.sessions[0] = {
      ...localStore.sessions[0],
      status: 'exited',
      exitCode: 0,
      endedAt: '2026-06-18T00:00:00Z',
    }
    await wrapper.vm.$nextTick()

    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-keep'])
    expect(wrapper.findAll('.terminal-tab').some((tab) => tab.text().includes('CMD'))).toBe(false)
    expect(wrapper.findAll('.terminal-tab').some((tab) => tab.text().includes('PowerShell'))).toBe(true)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['ssh-1'])
    expect(wrapper.emitted('disconnectServer')).toBeUndefined()
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['本地终端已退出', 'info'])
  })
})
