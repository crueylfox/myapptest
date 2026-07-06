// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection, ConnectionStatus, LocalTerminalCapabilities } from '../types'
import ServerPicker from './ServerPicker.vue'

const connection: Connection = {
  id: 1, groupId: null, name: 'server', host: '192.0.2.1', port: 22,
  username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
  hostKeyFingerprint: '', credentialSaved: false, refreshInterval: 2,
  createdAt: '', updatedAt: '',
}
const secondConnection: Connection = { ...connection, id: 2, name: 'second', host: '192.0.2.2' }
const thirdConnection: Connection = { ...connection, id: 3, name: 'third', host: '192.0.2.3', groupId: 7 }

function macosCapabilities(): LocalTerminalCapabilities {
  return {
    platform: 'darwin',
    enabled: true,
    supported: true,
    conptyAvailable: false,
    isProcessElevated: false,
    supportsElevation: false,
    shellOptions: [{ id: 'local', label: '本地终端', description: '$SHELL' }],
    adminShellOptions: [],
    defaultShellPreference: 'local',
    currentShellPreference: 'local',
    unsupportedMessage: '',
  }
}

function render(localTerminalEnabled = false, localTerminalCapabilities?: LocalTerminalCapabilities) {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 120, y: 20, width: 36, height: 30, top: 20, right: 156,
    bottom: 50, left: 120, toJSON: () => undefined,
  })
  return mount(ServerPicker, {
    attachTo: document.body,
    props: {
      open: true,
      anchor,
      groups: [{ id: 0, name: '鏈垎缁?', items: [connection] }],
      statuses: { 1: 'online' },
      activeServerId: 1,
      localTerminalEnabled,
      localTerminalCapabilities,
      query: '',
    },
  })
}

function renderWithConnections(items: Connection[]) {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 120, y: 20, width: 36, height: 30, top: 20, right: 156,
    bottom: 50, left: 120, toJSON: () => undefined,
  })
  const statuses = items.reduce<Record<number, ConnectionStatus>>((acc, item) => {
    acc[item.id] = 'offline'
    return acc
  }, {})
  return mount(ServerPicker, {
    attachTo: document.body,
    props: {
      open: true,
      anchor,
      groups: [{ id: 0, name: '未分组', items }],
      statuses,
      activeServerId: null,
      localTerminalEnabled: false,
      query: '',
    },
  })
}

function renderWithWorkspaceConnections(items: Connection[], workspaceBottom = 900) {
  const shell = document.createElement('section')
  shell.className = 'workspace-shell'
  const anchor = document.createElement('button')
  anchor.className = 'topbar-add'
  const stage = document.createElement('div')
  stage.className = 'terminal-stage'
  shell.append(anchor, stage)
  document.body.append(shell)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 120, y: 20, width: 36, height: 30, top: 20, right: 156,
    bottom: 50, left: 120, toJSON: () => undefined,
  })
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 44, width: 900, height: workspaceBottom - 44, top: 44, right: 900,
    bottom: workspaceBottom, left: 0, toJSON: () => undefined,
  })
  const statuses = items.reduce<Record<number, ConnectionStatus>>((acc, item) => {
    acc[item.id] = 'offline'
    return acc
  }, {})
  return mount(ServerPicker, {
    attachTo: document.body,
    props: {
      open: true,
      anchor,
      groups: [{ id: 0, name: '未分组', items }],
      statuses,
      activeServerId: null,
      localTerminalEnabled: false,
      query: '',
    },
  })
}

function servers(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...connection,
    id: index + 1,
    name: `server-${index + 1}`,
    host: `192.0.2.${index + 1}`,
  }))
}

function mockPickerMetrics(options: {
  panelScrollHeight: number
  listNaturalHeight: number
  listClientHeight?: number
  headerHeight?: number
  actionsHeight?: number
  hintHeight?: number
}) {
  const picker = document.body.querySelector<HTMLElement>('.server-picker')!
  const header = picker.querySelector<HTMLElement>(':scope > header')!
  const actions = picker.querySelector<HTMLElement>('.server-picker-actions')!
  const hint = picker.querySelector<HTMLElement>('.server-picker-drag-hint')
  const list = document.body.querySelector<HTMLElement>('.server-picker-list')!
  vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue({
    x: 120, y: 56, width: 380, height: options.panelScrollHeight, top: 56, right: 500,
    bottom: 56 + options.panelScrollHeight, left: 120, toJSON: () => undefined,
  })
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    x: 129, y: 65, width: 362, height: options.headerHeight ?? 34, top: 65, right: 491,
    bottom: 65 + (options.headerHeight ?? 34), left: 129, toJSON: () => undefined,
  })
  vi.spyOn(actions, 'getBoundingClientRect').mockReturnValue({
    x: 129, y: 104, width: 362, height: options.actionsHeight ?? 50, top: 104, right: 491,
    bottom: 104 + (options.actionsHeight ?? 50), left: 129, toJSON: () => undefined,
  })
  if (hint) {
    vi.spyOn(hint, 'getBoundingClientRect').mockReturnValue({
      x: 129, y: 154, width: 362, height: options.hintHeight ?? 0, top: 154, right: 491,
      bottom: 154 + (options.hintHeight ?? 0), left: 129, toJSON: () => undefined,
    })
  }
  Object.defineProperty(picker, 'scrollHeight', { configurable: true, value: options.panelScrollHeight })
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: options.listNaturalHeight })
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: options.listClientHeight ?? options.listNaturalHeight })
  return { picker, list }
}

function mockListContentScrollHeight(height: number) {
  const content = document.body.querySelector<HTMLElement>('.server-picker-list-content')!
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: height })
  return content
}

function mockListChildrenHeight(list: HTMLElement, heights: number[]) {
  Array.from(list.children).forEach((child, index) => {
    const height = heights[index] ?? 0
    vi.spyOn(child as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 129, y: 160 + index * height, width: 362, height, top: 160 + index * height, right: 491,
      bottom: 160 + (index + 1) * height, left: 129, toJSON: () => undefined,
    })
  })
}

function mockSearchResultHeights(list: HTMLElement, options: {
  groupHeight: number
  groupHeaderHeight: number
  rowHeight?: number
  emptyHeight?: number
}) {
  const group = list.querySelector<HTMLElement>('.server-group')!
  const groupHeader = group.querySelector<HTMLElement>(':scope > header')!
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({
    x: 129, y: 174, width: 362, height: options.groupHeight, top: 174, right: 491,
    bottom: 174 + options.groupHeight, left: 129, toJSON: () => undefined,
  })
  vi.spyOn(groupHeader, 'getBoundingClientRect').mockReturnValue({
    x: 129, y: 174, width: 362, height: options.groupHeaderHeight, top: 174, right: 491,
    bottom: 174 + options.groupHeaderHeight, left: 129, toJSON: () => undefined,
  })
  const row = group.querySelector<HTMLElement>('.server-row')
  if (row && options.rowHeight !== undefined) {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      x: 129, y: 174 + options.groupHeaderHeight, width: 362, height: options.rowHeight,
      top: 174 + options.groupHeaderHeight, right: 491,
      bottom: 174 + options.groupHeaderHeight + options.rowHeight, left: 129, toJSON: () => undefined,
    })
  }
  const empty = list.querySelector<HTMLElement>('.empty-side')
  if (empty && options.emptyHeight !== undefined) {
    vi.spyOn(empty, 'getBoundingClientRect').mockReturnValue({
      x: 129, y: 174 + options.groupHeaderHeight, width: 362, height: options.emptyHeight,
      top: 174 + options.groupHeaderHeight, right: 491,
      bottom: 174 + options.groupHeaderHeight + options.emptyHeight, left: 129, toJSON: () => undefined,
    })
  }
}

function mockSearchRowChildHeights(list: HTMLElement) {
  const row = list.querySelector<HTMLElement>('.server-row')!
  const childHeights: Array<[string, number]> = [
    ['.status-dot', 8],
    ['strong', 18],
    ['small', 18],
    ['.server-row-actions', 24],
  ]
  childHeights.forEach(([selector, height], index) => {
    const child = row.querySelector<HTMLElement>(selector)!
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue({
      x: 129 + index * 24, y: 202, width: 24, height, top: 202, right: 153 + index * 24,
      bottom: 202 + height, left: 129 + index * 24, toJSON: () => undefined,
    })
  })
}

function renderEmpty(localTerminalEnabled = false) {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 120, y: 20, width: 36, height: 30, top: 20, right: 156,
    bottom: 50, left: 120, toJSON: () => undefined,
  })
  return mount(ServerPicker, {
    attachTo: document.body,
    props: {
      open: true,
      anchor,
      groups: [{ id: 0, name: 'empty', items: [] }],
      statuses: {},
      activeServerId: null,
      localTerminalEnabled,
      query: '',
    },
  })
}

function statusMap(items: Connection[]) {
  return items.reduce<Record<number, ConnectionStatus>>((acc, item) => {
    acc[item.id] = 'offline'
    return acc
  }, {})
}

function renderGrouped(query = '') {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 120, y: 20, width: 36, height: 30, top: 20, right: 156,
    bottom: 50, left: 120, toJSON: () => undefined,
  })
  return mount(ServerPicker, {
    attachTo: document.body,
    props: {
      open: true,
      anchor,
      groups: [
        { id: 0, name: '未分组', items: [{ ...connection, groupId: null }, { ...secondConnection, groupId: null }] },
        { id: 7, name: '生产', items: [thirdConnection] },
      ],
      statuses: { 1: 'offline', 2: 'offline', 3: 'offline' },
      activeServerId: null,
      localTerminalEnabled: false,
      query,
    },
  })
}

function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

function mockElementFromPoint(element: Element) {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(),
    })
  }
  vi.mocked(document.elementFromPoint).mockReturnValue(element)
}

describe('ServerPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('anchors to the actual plus button and has no management action', async () => {
    const wrapper = render()
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const picker = document.body.querySelector<HTMLElement>('.server-picker')
    expect(picker?.classList.contains('viewport-popover')).toBe(true)
    expect(picker?.style.left).toBe('120px')
    expect(picker?.style.top).toBe('56px')
    expect(picker?.textContent).not.toContain('绠＄悊鏈嶅姟鍣?')
  })

  it('uses shared viewport positioning to clamp the picker in a narrow window', async () => {
    setViewportSize(300, 180)
    const wrapper = render()
    await Promise.resolve()
    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 380, height: 620, top: 0, right: 380,
      bottom: 620, left: 0, toJSON: () => undefined,
    })

    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const left = Number.parseInt(picker.style.left, 10)
    const top = Number.parseInt(picker.style.top, 10)
    const width = Number.parseInt(picker.style.width, 10)
    const maxHeight = Number.parseInt(picker.style.maxHeight, 10)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(left + width).toBeLessThanOrEqual(292)
    expect(top + maxHeight).toBeLessThanOrEqual(172)
    expect(picker.style.getPropertyValue('--server-picker-list-max-height')).toBe('')
    expect(picker.classList.contains('viewport-popover-scroll')).toBe(true)
  })

  it('remeasures max height when imported servers grow while the picker stays mounted', async () => {
    setViewportSize(900, 720)
    const initial = [
      { ...connection, id: 1, name: 'server-1' },
      { ...secondConnection, id: 2, name: 'server-2' },
    ]
    const wrapper = renderWithConnections(initial)
    await wrapper.vm.$nextTick()
    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue({
      x: 120, y: 56, width: 380, height: 180, top: 56, right: 500,
      bottom: 236, left: 120, toJSON: () => undefined,
    })
    Object.defineProperty(picker, 'scrollHeight', { configurable: true, value: 180 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    const shortMaxHeight = Number.parseInt(picker.style.maxHeight, 10)

    const imported = Array.from({ length: 20 }, (_, index) => ({
      ...connection,
      id: index + 1,
      name: `server-${index + 1}`,
      host: `192.0.2.${index + 1}`,
    }))
    Object.defineProperty(picker, 'scrollHeight', { configurable: true, value: 640 })
    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: imported }],
      statuses: statusMap(imported),
    })
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const refreshedMaxHeight = Number.parseInt(picker.style.maxHeight, 10)
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('server-20')
    expect(refreshedMaxHeight).toBeGreaterThan(shortMaxHeight)
    expect(refreshedMaxHeight).toBeLessThanOrEqual(656)
  })

  it('expands long server lists to the available bottom and keeps scrolling internal', async () => {
    setViewportSize(900, 720)
    const wrapper = renderWithConnections(Array.from({ length: 30 }, (_, index) => ({
      ...connection,
      id: index + 1,
      name: `server-${index + 1}`,
      host: `192.0.2.${index + 1}`,
    })))
    await wrapper.vm.$nextTick()

    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    const list = document.body.querySelector<HTMLElement>('.server-picker-list')!
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue({
      x: 120, y: 56, width: 380, height: 620, top: 56, right: 500,
      bottom: 676, left: 120, toJSON: () => undefined,
    })
    Object.defineProperty(picker, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 760 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 520 })

    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const top = Number.parseInt(picker.style.top, 10)
    const height = Number.parseInt(picker.style.height, 10)
    const maxHeight = Number.parseInt(picker.style.maxHeight, 10)
    expect(height).toBe(maxHeight)
    expect(top + height).toBeLessThanOrEqual(712)
    const listHeight = Number.parseInt(picker.style.getPropertyValue('--server-picker-list-height'), 10)
    expect(listHeight).toBeGreaterThan(500)
    expect(picker.style.getPropertyValue('--server-picker-list-row-size')).toBe(`${listHeight}px`)
    expect(picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('auto')

    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }))
    expect(list.scrollTop).toBe(120)
    expect(picker.scrollTop).toBe(0)
  })

  it('does not make the server list scrollable when workspace height can show every row', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(12), 900)
    await wrapper.vm.$nextTick()
    const { picker, list } = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 408,
      listClientHeight: 408,
    })

    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(Number.parseInt(picker.style.top, 10)).toBe(56)
    expect(Number.parseInt(picker.style.height, 10)).toBe(492)
    expect(picker.style.getPropertyValue('--server-picker-list-height')).toBe('408px')
    expect(picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(picker.style.getPropertyValue('--server-picker-list-row-size')).toBe('408px')
    expect(picker.style.getPropertyValue('--server-picker-list-scrollbar-gutter')).toBe('auto')
    expect(list.scrollTop).toBe(0)
  })

  it('uses the workspace bottom before enabling internal list scrolling', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(32), 900)
    await wrapper.vm.$nextTick()
    const { picker, list } = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 700,
    })

    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const top = Number.parseInt(picker.style.top, 10)
    const height = Number.parseInt(picker.style.height, 10)
    const listHeight = Number.parseInt(picker.style.getPropertyValue('--server-picker-list-height'), 10)
    expect(top + height).toBeGreaterThanOrEqual(890)
    expect(top + height).toBeLessThanOrEqual(900)
    expect(listHeight).toBeGreaterThan(720)
    expect(picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('auto')
    expect(picker.style.getPropertyValue('--server-picker-list-row-size')).toBe(`${listHeight}px`)
    expect(picker.scrollTop).toBe(0)

    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }))
    await wrapper.vm.$nextTick()
    expect(list.scrollTop).toBe(120)
    expect(picker.scrollTop).toBe(0)
  })

  it('does not change row horizontal layout while the list scrolls', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(32), 900)
    await wrapper.vm.$nextTick()
    const { picker, list } = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    const row = document.body.querySelector<HTMLElement>('.server-row')!
    const actions = row.querySelector<HTMLElement>('.server-row-actions')!
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      x: 129, y: 160, width: 362, height: 34, top: 160, right: 491,
      bottom: 194, left: 129, toJSON: () => undefined,
    })
    vi.spyOn(actions, 'getBoundingClientRect').mockReturnValue({
      x: 430, y: 165, width: 56, height: 24, top: 165, right: 486,
      bottom: 189, left: 430, toJSON: () => undefined,
    })
    const beforeRow = row.getBoundingClientRect()
    const beforeActions = actions.getBoundingClientRect()

    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 160 }))
    await wrapper.vm.$nextTick()
    const afterRow = row.getBoundingClientRect()
    const afterActions = actions.getBoundingClientRect()

    expect(picker.style.getPropertyValue('--server-picker-list-scrollbar-gutter')).toBe('auto')
    expect(list.style.paddingLeft).toBe('')
    expect(beforeRow.left).toBe(afterRow.left)
    expect(beforeRow.width).toBe(afterRow.width)
    expect(beforeActions.right).toBe(afterActions.right)
  })

  it('keeps non-scrollable list wheel from creating stale scroll geometry', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(10), 900)
    await wrapper.vm.$nextTick()
    const { picker, list } = mockPickerMetrics({
      panelScrollHeight: 472,
      listNaturalHeight: 340,
      listClientHeight: 340,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    const before = {
      top: picker.style.top,
      height: picker.style.height,
      listHeight: picker.style.getPropertyValue('--server-picker-list-height'),
      overflow: picker.style.getPropertyValue('--server-picker-list-overflow-y'),
    }

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 240 })
    list.dispatchEvent(wheel)
    await wrapper.vm.$nextTick()

    expect(wheel.defaultPrevented).toBe(true)
    expect(list.scrollTop).toBe(0)
    expect(picker.scrollTop).toBe(0)
    expect({
      top: picker.style.top,
      height: picker.style.height,
      listHeight: picker.style.getPropertyValue('--server-picker-list-height'),
      overflow: picker.style.getPropertyValue('--server-picker-list-overflow-y'),
    }).toEqual(before)
  })

  it('remeasures after close and reopen without keeping stale list scroll', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(12), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 408,
      listClientHeight: 408,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    metrics.list.scrollTop = 80
    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 408,
      listClientHeight: 408,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(metrics.list.scrollTop).toBe(0)
    expect(metrics.picker.scrollTop).toBe(0)
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-height')).toBe('408px')
  })

  it('recalculates list scrolling when search filters reduce and restore rows', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(32), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('auto')

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: servers(3) }],
      statuses: statusMap(servers(3)),
      query: 'server-1',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 804,
      listNaturalHeight: 720,
      listClientHeight: 720,
    })
    mockListChildrenHeight(metrics.list, [102])
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-height')).toBe('102px')

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: servers(32) }],
      statuses: statusMap(servers(32)),
      query: '',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    mockListChildrenHeight(metrics.list, [1088])
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('auto')
    expect(Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)).toBeGreaterThan(720)
  })

  it('fully measures one filtered search row even when the group wrapper height is stale', async () => {
    setViewportSize(1000, 940)
    const debian = { ...connection, id: 99, name: 'debian', host: '192.0.2.99' }
    const wrapper = renderWithWorkspaceConnections(servers(30), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    metrics.list.scrollTop = 320

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: [debian] }],
      statuses: statusMap([debian]),
      query: 'debian',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 760,
      listNaturalHeight: 720,
      listClientHeight: 720,
      hintHeight: 18,
    })
    mockSearchResultHeights(metrics.list, {
      groupHeight: 20,
      groupHeaderHeight: 28,
      rowHeight: 42,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(document.body.querySelector('.server-picker')?.textContent).toContain('debian')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)).toBeGreaterThanOrEqual(70)
    expect(metrics.list.scrollTop).toBe(0)
    expect(metrics.picker.scrollTop).toBe(0)
  })

  it('shrinks one filtered search result to content when inner scrollHeight is stale', async () => {
    setViewportSize(1000, 940)
    const debian = { ...connection, id: 99, name: 'debian', host: '192.0.2.99' }
    const wrapper = renderWithWorkspaceConnections(servers(30), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    mockListContentScrollHeight(1088)
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    metrics.list.scrollTop = 320

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: [debian] }],
      statuses: statusMap([debian]),
      query: 'debian',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 760,
      listNaturalHeight: 720,
      listClientHeight: 720,
      hintHeight: 18,
    })
    mockListContentScrollHeight(260)
    mockSearchResultHeights(metrics.list, {
      groupHeight: 20,
      groupHeaderHeight: 28,
      rowHeight: 42,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const listHeight = Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)
    const visibleContentHeight = 28 + 42
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('debian')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(listHeight).toBeLessThan(260)
    expect(listHeight).toBeGreaterThanOrEqual(visibleContentHeight)
    expect(listHeight - visibleContentHeight).toBeLessThanOrEqual(16)
    expect(Number.parseInt(metrics.picker.style.height, 10)).toBeLessThan(260)
    expect(metrics.list.scrollTop).toBe(0)
    expect(metrics.picker.scrollTop).toBe(0)
  })

  it('does not sum horizontal row children when shrinking one filtered search result', async () => {
    setViewportSize(1000, 940)
    const debian = { ...connection, id: 99, name: 'debian', host: '192.0.2.99' }
    const wrapper = renderWithWorkspaceConnections(servers(30), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    mockListContentScrollHeight(1088)
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: [debian] }],
      statuses: statusMap([debian]),
      query: 'debian',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 760,
      listNaturalHeight: 720,
      listClientHeight: 720,
      hintHeight: 18,
    })
    mockListContentScrollHeight(260)
    mockSearchResultHeights(metrics.list, {
      groupHeight: 20,
      groupHeaderHeight: 28,
      rowHeight: 42,
    })
    mockSearchRowChildHeights(metrics.list)
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const listHeight = Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)
    const visibleContentHeight = 28 + 42
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('debian')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(listHeight).toBeGreaterThanOrEqual(visibleContentHeight)
    expect(listHeight - visibleContentHeight).toBeLessThanOrEqual(16)
  })

  it('keeps one filtered search row fully visible when the group box is taller than summed children', async () => {
    setViewportSize(1000, 940)
    const debian = { ...connection, id: 99, name: 'debian', host: '192.0.2.99' }
    const wrapper = renderWithWorkspaceConnections(servers(30), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    mockListContentScrollHeight(1088)
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: [debian] }],
      statuses: statusMap([debian]),
      query: 'debian',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 760,
      listNaturalHeight: 720,
      listClientHeight: 720,
      hintHeight: 18,
    })
    mockListContentScrollHeight(260)
    mockSearchResultHeights(metrics.list, {
      groupHeight: 78,
      groupHeaderHeight: 28,
      rowHeight: 42,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const listHeight = Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('debian')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(listHeight).toBeGreaterThanOrEqual(78)
    expect(listHeight - 78).toBeLessThanOrEqual(16)
  })

  it('keeps the filtered empty state fully measured without inheriting list scroll', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(30), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    metrics.list.scrollTop = 260

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: [] }],
      statuses: {},
      query: 'missing',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 720,
      listNaturalHeight: 720,
      listClientHeight: 720,
      hintHeight: 18,
    })
    mockSearchResultHeights(metrics.list, {
      groupHeight: 18,
      groupHeaderHeight: 28,
      emptyHeight: 44,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(document.body.querySelector('.server-picker')?.textContent).toContain('暂无服务器')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)).toBeGreaterThanOrEqual(72)
    expect(metrics.list.scrollTop).toBe(0)
    expect(metrics.picker.scrollTop).toBe(0)
  })

  it('does not stretch filtered empty state to stale inner scrollHeight', async () => {
    setViewportSize(1000, 940)
    const wrapper = renderWithWorkspaceConnections(servers(30), 900)
    await wrapper.vm.$nextTick()
    let metrics = mockPickerMetrics({
      panelScrollHeight: 540,
      listNaturalHeight: 1088,
      listClientHeight: 720,
    })
    mockListContentScrollHeight(1088)
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    metrics.list.scrollTop = 240

    await wrapper.setProps({
      groups: [{ id: 0, name: '未分组', items: [] }],
      statuses: {},
      query: 'missing',
    })
    await wrapper.vm.$nextTick()
    metrics = mockPickerMetrics({
      panelScrollHeight: 720,
      listNaturalHeight: 720,
      listClientHeight: 720,
      hintHeight: 18,
    })
    mockListContentScrollHeight(260)
    mockSearchResultHeights(metrics.list, {
      groupHeight: 18,
      groupHeaderHeight: 28,
      emptyHeight: 44,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const listHeight = Number.parseInt(metrics.picker.style.getPropertyValue('--server-picker-list-height'), 10)
    const visibleContentHeight = 28 + 44
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('暂无服务器')
    expect(metrics.picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(listHeight).toBeLessThan(260)
    expect(listHeight).toBeGreaterThanOrEqual(visibleContentHeight)
    expect(listHeight - visibleContentHeight).toBeLessThanOrEqual(16)
    expect(metrics.list.scrollTop).toBe(0)
    expect(metrics.picker.scrollTop).toBe(0)
  })

  it('keeps wheel movement inside the server list instead of scrolling the picker panel', async () => {
    const wrapper = renderWithConnections([connection])
    await wrapper.vm.$nextTick()
    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    const list = document.body.querySelector<HTMLElement>('.server-picker-list')!
    picker.scrollTop = 14
    list.scrollTop = 0
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 80 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 120 })
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })

    list.dispatchEvent(wheel)
    await wrapper.vm.$nextTick()

    expect(wheel.defaultPrevented).toBe(true)
    expect(picker.scrollTop).toBe(0)
    expect(list.scrollTop).toBe(0)
  })

  it('stops wheel propagation at server list edges when the list is scrollable', async () => {
    const wrapper = renderWithConnections(Array.from({ length: 20 }, (_, index) => ({
      ...connection,
      id: index + 1,
      name: `server-${index + 1}`,
      host: `192.0.2.${index + 1}`,
    })))
    await wrapper.vm.$nextTick()
    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    const list = document.body.querySelector<HTMLElement>('.server-picker-list')!
    const parentWheel = vi.fn()
    picker.addEventListener('wheel', parentWheel)
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 640 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 160 })
    list.scrollTop = 480
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })

    list.dispatchEvent(wheel)
    await wrapper.vm.$nextTick()

    expect(wheel.defaultPrevented).toBe(true)
    expect(parentWheel).not.toHaveBeenCalled()
    expect(picker.scrollTop).toBe(0)
  })

  it('manually scrolls the server list and prevents native wheel chaining after reopen', async () => {
    setViewportSize(900, 360)
    const wrapper = renderWithConnections(Array.from({ length: 20 }, (_, index) => ({
      ...connection,
      id: index + 1,
      name: `server-${index + 1}`,
      host: `192.0.2.${index + 1}`,
    })))
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    const list = document.body.querySelector<HTMLElement>('.server-picker-list')!
    const rootWheel = vi.fn()
    document.body.addEventListener('wheel', rootWheel)
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 640 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 160 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    list.scrollTop = 0
    picker.scrollTop = 12
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })

    list.dispatchEvent(wheel)
    await wrapper.vm.$nextTick()
    document.body.removeEventListener('wheel', rootWheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(rootWheel).not.toHaveBeenCalled()
    expect(picker.scrollTop).toBe(0)
    expect(list.scrollTop).toBe(80)
  })

  it('keeps a short saved-server list from scrolling rows out after reopen', async () => {
    setViewportSize(900, 720)
    const wrapper = renderWithConnections(Array.from({ length: 4 }, (_, index) => ({
      ...connection,
      id: index + 1,
      name: `server-${index + 1}`,
      host: `192.0.2.${index + 1}`,
    })))
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    const list = document.body.querySelector<HTMLElement>('.server-picker-list')!
    Object.defineProperty(picker, 'scrollHeight', { configurable: true, value: 260 })
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 148 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 148 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 320 })

    list.dispatchEvent(wheel)
    await wrapper.vm.$nextTick()

    expect(Number.parseInt(picker.style.getPropertyValue('--server-picker-list-height'), 10)).toBe(148)
    expect(picker.style.getPropertyValue('--server-picker-list-overflow-y')).toBe('hidden')
    expect(wheel.defaultPrevented).toBe(true)
    expect(list.scrollTop).toBe(0)
    expect(picker.scrollTop).toBe(0)
  })

  it('blocks panel wheel after the picker closes and reopens with an empty list', async () => {
    const wrapper = renderEmpty(true)
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()

    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    picker.scrollTop = 18
    const rootWheel = vi.fn()
    document.body.addEventListener('wheel', rootWheel)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 90 })

    picker.dispatchEvent(wheel)
    await wrapper.vm.$nextTick()
    document.body.removeEventListener('wheel', rootWheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(rootWheel).not.toHaveBeenCalled()
    expect(picker.scrollTop).toBe(0)
  })

  it('closes on outside pointerdown and Escape but not inside pointerdown', async () => {
    const wrapper = render()
    await Promise.resolve()
    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    picker.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toBeUndefined()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('keeps the picker open while a server-row context menu is being used', async () => {
    const wrapper = mount(ServerPicker, {
      attachTo: document.body,
      props: {
        open: true,
        anchor: document.body.appendChild(document.createElement('button')),
        groups: [{ id: 0, name: '未分组', items: [connection] }],
        statuses: { 1: 'online' },
        activeServerId: 1,
        localTerminalEnabled: false,
        query: '',
        outsideIgnoreSelector: '.context-menu',
      },
    })
    await Promise.resolve()
    const context = document.createElement('div')
    context.className = 'context-menu'
    document.body.append(context)

    context.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('uses a compact single row and action clicks do not open the server', async () => {
    const wrapper = render()
    await Promise.resolve()
    const row = document.body.querySelector<HTMLElement>('.server-row')!
    expect(row.children).toHaveLength(4)
    expect(row.textContent).toContain('server')
    expect(row.textContent).toContain('192.0.2.1:22')
    expect(row.querySelector('.server-row-actions')).not.toBeNull()

    const edit = row.querySelectorAll<HTMLButtonElement>('.server-row-actions button')[0]
    edit.click()
    expect(wrapper.emitted('editServer')).toHaveLength(1)
    expect(wrapper.emitted('openServer')).toBeUndefined()
  })

  it('shows compact jump route labels without adding a second row', async () => {
    const jump: Connection = { ...connection, id: 2, name: '堡垒机A', host: '198.51.100.2' }
    const target: Connection = {
      ...connection,
      id: 3,
      name: 'target',
      host: '10.0.0.3',
      connectionMode: 'jump',
      jumpServerId: 2,
    }
    const missing: Connection = {
      ...connection,
      id: 4,
      name: 'missing-target',
      host: '10.0.0.4',
      connectionMode: 'jump',
      jumpServerId: null,
    }
    renderWithConnections([jump, target, missing])
    await Promise.resolve()

    const rows = document.body.querySelectorAll<HTMLElement>('.server-row')
    expect(rows[1].children).toHaveLength(4)
    expect(rows[1].textContent).toContain('经由：堡垒机A')
    expect(rows[2].textContent).toContain('经由：需重选')
  })

  it('keeps local terminal actions visible but disabled while the feature is disabled', async () => {
    const wrapper = render()
    await Promise.resolve()
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')
    const separators = document.body.querySelectorAll<HTMLElement>('.server-picker-actions .action-separator')
    expect(actions).toHaveLength(4)
    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      'CMD',
      'PowerShell',
    ])
    expect(document.body.querySelectorAll('.server-picker-actions .app-icon')).toHaveLength(4)
    expect(separators).toHaveLength(3)
    expect([...separators].every((item) => item.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(actions[0].previousElementSibling?.classList.contains('action-separator')).not.toBe(true)
    expect(actions[3].nextElementSibling?.classList.contains('action-separator')).not.toBe(true)
    expect(actions[2].disabled).toBe(true)
    expect(actions[3].disabled).toBe(true)
    actions[2].click()
    actions[3].click()
    expect(wrapper.emitted('openLocalTerminal')).toBeUndefined()
  })

  it('shows CMD and PowerShell for an empty server list when local terminals are supported', async () => {
    const wrapper = renderEmpty(true)
    await Promise.resolve()
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')
    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      'CMD',
      'PowerShell',
    ])

    actions[2].click()
    actions[3].click()

    expect(wrapper.emitted('openLocalTerminal')).toEqual([
      ['cmd'],
      ['powershell'],
    ])
  })

  it('renders search on its own row without a visible close action', async () => {
    const wrapper = render(true)
    await Promise.resolve()
    const picker = document.body.querySelector<HTMLElement>('.server-picker')!
    const header = picker.querySelector<HTMLElement>(':scope > header')!
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')

    expect(header.querySelector('input')).not.toBeNull()
    expect(header.querySelector('button')).toBeNull()
    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      'CMD',
      'PowerShell',
    ])
    expect(picker.textContent).not.toContain('关闭')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await Promise.resolve()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows productized CMD and PowerShell entries when capabilities are supported', async () => {
    const wrapper = render(true)
    await Promise.resolve()
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')
    expect(actions).toHaveLength(4)
    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      'CMD',
      'PowerShell',
    ])
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('CMD（管理员）')
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('PowerShell（管理员）')

    actions[2].click()
    actions[3].click()

    expect(wrapper.emitted('openLocalTerminal')).toEqual([
      ['cmd'],
      ['powershell'],
    ])
    expect(wrapper.emitted('openServer')).toBeUndefined()
  })

  it('shows only the macOS local terminal action when Darwin capabilities are supported', async () => {
    const wrapper = render(true, macosCapabilities())
    await Promise.resolve()
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')

    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      '本地终端',
    ])
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('CMD')
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('PowerShell')

    actions[2].click()

    expect(wrapper.emitted('openLocalTerminal')).toEqual([['local']])
  })

  it('emits a typed reorder request when a server row is dragged within its group', async () => {
    const wrapper = renderGrouped()
    await Promise.resolve()
    const rows = document.body.querySelectorAll<HTMLElement>('.server-row')
    vi.spyOn(rows[1], 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 80, width: 320, height: 28, top: 80, right: 340,
      bottom: 108, left: 20, toJSON: () => undefined,
    })
    mockElementFromPoint(rows[1])

    rows[0].dispatchEvent(pointer('pointerdown', 24, 52))
    window.dispatchEvent(pointer('pointermove', 40, 104))
    window.dispatchEvent(pointer('pointerup', 40, 104))

    expect(wrapper.emitted('reorderServer')).toEqual([[
      {
        serverID: 1,
        sourceGroupID: null,
        targetGroupID: null,
        beforeServerID: null,
        afterServerID: 2,
      },
    ]])
    expect(wrapper.emitted('openServer')).toBeUndefined()
  })

  it('emits a target group when dragging a server row into another group', async () => {
    const wrapper = renderGrouped()
    await Promise.resolve()
    const row = document.body.querySelector<HTMLElement>('[data-server-id="1"]')!
    const targetGroup = document.body.querySelector<HTMLElement>('[data-group-id="7"]')!
    mockElementFromPoint(targetGroup)

    row.dispatchEvent(pointer('pointerdown', 24, 52))
    window.dispatchEvent(pointer('pointermove', 44, 150))
    window.dispatchEvent(pointer('pointerup', 44, 150))

    expect(wrapper.emitted('reorderServer')).toEqual([[
      {
        serverID: 1,
        sourceGroupID: null,
        targetGroupID: 7,
        beforeServerID: null,
        afterServerID: 3,
      },
    ]])
  })

  it('keeps edit and delete clicks out of drag handling', async () => {
    const wrapper = renderGrouped()
    await Promise.resolve()
    const row = document.body.querySelector<HTMLElement>('[data-server-id="1"]')!
    const edit = row.querySelectorAll<HTMLButtonElement>('.server-row-actions button')[0]
    edit.dispatchEvent(pointer('pointerdown', 200, 52))
    window.dispatchEvent(pointer('pointermove', 220, 80))
    edit.click()
    edit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    edit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))

    expect(wrapper.emitted('editServer')).toHaveLength(1)
    expect(wrapper.emitted('contextMenu')).toBeUndefined()
    expect(wrapper.emitted('reorderServer')).toBeUndefined()
    expect(wrapper.emitted('openServer')).toBeUndefined()
  })

  it('renders edit and delete as visible inline buttons with distinct semantics', async () => {
    renderGrouped()
    await Promise.resolve()
    const row = document.body.querySelector<HTMLElement>('[data-server-id="1"]')!
    const buttons = row.querySelectorAll<HTMLButtonElement>('.server-row-actions button')

    expect(buttons).toHaveLength(2)
    expect(buttons[0].type).toBe('button')
    expect(buttons[0].classList.contains('server-row-action')).toBe(true)
    expect(buttons[0].classList.contains('edit-action')).toBe(true)
    expect(buttons[1].type).toBe('button')
    expect(buttons[1].classList.contains('server-row-action')).toBe(true)
    expect(buttons[1].classList.contains('delete-action')).toBe(true)
  })

  it('disables server drag while searching and shows the ambiguity hint', async () => {
    const wrapper = renderGrouped('server')
    await Promise.resolve()
    const row = document.body.querySelector<HTMLElement>('[data-server-id="1"]')!
    const target = document.body.querySelector<HTMLElement>('[data-server-id="2"]')!
    mockElementFromPoint(target)

    row.dispatchEvent(pointer('pointerdown', 24, 52))
    window.dispatchEvent(pointer('pointermove', 40, 104))
    window.dispatchEvent(pointer('pointerup', 40, 104))

    expect(document.body.querySelector('.server-picker')?.textContent).toContain('清空搜索后可拖动排序')
    expect(wrapper.emitted('reorderServer')).toBeUndefined()
  })
})
