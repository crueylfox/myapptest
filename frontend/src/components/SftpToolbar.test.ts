// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SFTPConflictPolicy } from '../types'
import type { SftpPathBookmark } from '../utils/sftpPathState'
import SftpToolbar, { type SftpToolbarAction } from './SftpToolbar.vue'

const baseActions: SftpToolbarAction[] = [
  { id: 'reconnect', label: 'Reconnect', className: 'sftp-reconnect', disabled: true },
  { id: 'back', label: 'Back', disabled: true },
  { id: 'forward', label: 'Forward', disabled: true },
  { id: 'refresh', label: 'Refresh', className: 'sftp-refresh', disabled: false },
  { id: 'parent', label: 'Up', disabled: true },
  { id: 'home', label: 'Home', disabled: true },
  { id: 'bookmark', label: 'Bookmark', disabled: false },
  { id: 'bookmarks', label: 'Bookmarks', disabled: false },
  { id: 'open', label: 'Open', className: 'sftp-open', disabled: false },
  { id: 'mkdir', label: 'New Folder', disabled: false },
  { id: 'new-file', label: 'New File', disabled: false },
  { id: 'upload', label: 'Upload', disabled: false },
  { id: 'upload-directory', label: 'Upload Folder', disabled: false },
  { id: 'download', label: 'Download', disabled: false },
  { id: 'properties', label: 'Properties', disabled: false },
  { id: 'delete', label: 'Delete', tone: 'danger', disabled: true },
  { id: 'rename', label: 'Rename', disabled: false },
  { id: 'hidden', label: 'Show Hidden', active: true, disabled: false },
  { id: 'conflict-policy', label: 'Conflict Policy' },
]

const bookmarks: SftpPathBookmark[] = [{
  id: 'logs',
  path: '/var/log',
  label: 'log',
  createdAt: 1,
  updatedAt: 1,
}]

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

const mountedWrappers: VueWrapper[] = []

function mountToolbar(options: {
  actions?: SftpToolbarAction[]
  pathInput?: string
  online?: boolean
  showFileFilter?: boolean
  filterQuery?: string
  filterActive?: boolean
  filterStatus?: string
  conflictPolicy?: SFTPConflictPolicy
  bookmarks?: SftpPathBookmark[]
  latestTransferSummary?: string
} = {}) {
  const wrapper = mount(SftpToolbar, {
    attachTo: document.body,
    props: {
      actions: options.actions ?? baseActions,
      currentPath: '/home/demo',
      pathInput: options.pathInput ?? '/home/demo',
      scpMode: false,
      online: options.online ?? true,
      showFileFilter: options.showFileFilter ?? true,
      filterQuery: options.filterQuery ?? '',
      filterActive: options.filterActive ?? false,
      filterStatus: options.filterStatus ?? '',
      conflictPolicy: options.conflictPolicy ?? 'ask',
      bookmarks: options.bookmarks ?? bookmarks,
      latestTransferSummary: options.latestTransferSummary ?? '',
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

async function relayoutToolbar(wrapper: VueWrapper, width: number) {
  const toolbar = wrapper.get('.sftp-toolbar').element as HTMLElement
  Object.defineProperty(toolbar, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(toolbar, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      right: width,
      top: 0,
      bottom: 38,
      width,
      height: 38,
      toJSON: () => ({}),
    }),
  })
  window.dispatchEvent(new Event('resize'))
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await wrapper.vm.$nextTick()
}

function moreMenu() {
  return document.body.querySelector<HTMLElement>('.sftp-more-menu')
}

function bookmarkMenu() {
  return document.body.querySelector<HTMLElement>('.sftp-bookmarks-menu')
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

function mockElementRect(element: Element, values: {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: values.left,
      y: values.top,
      ...values,
      toJSON: () => ({}),
    }),
  })
}

describe('SftpToolbar', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('renders the path input and main navigation disabled states while emitting path updates and actions', async () => {
    const wrapper = mountToolbar()

    expect(wrapper.get('.sftp-pathbar').classes()).toContain('sftp-toolbar-path')
    expect(wrapper.get<HTMLInputElement>('.sftp-pathbar input').element.value).toBe('/home/demo')
    expect(wrapper.get('[data-testid="sftp-toolbar-action-back"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-forward"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-reconnect"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-refresh"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-parent"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-home"]').attributes('disabled')).toBeDefined()

    await wrapper.get('.sftp-pathbar input').setValue('/var/log')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await wrapper.get('[data-testid="sftp-toolbar-action-refresh"]').trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-delete"]').trigger('click')

    expect(wrapper.emitted('update:pathInput')?.at(-1)).toEqual(['/var/log'])
    expect(wrapper.emitted('submitPath')).toBeTruthy()
    expect(wrapper.emitted('action')).toContainEqual(['refresh'])
    expect(wrapper.emitted('action')).not.toContainEqual(['delete'])
  })

  it('renders visible file actions as borderless menu actions separated by non-clickable vertical pipes', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 1800)

    const actions = wrapper.findAll('[data-toolbar-action-id]')
    const separators = wrapper.findAll('.sftp-toolbar-action-separator')
    expect(actions.length).toBeGreaterThan(4)
    expect(separators).toHaveLength(actions.length - 1)
    for (const action of actions) {
      expect(action.classes()).toContain('sftp-toolbar-menu-action')
      expect(action.classes()).not.toContain('secondary')
      expect(action.classes()).not.toContain('danger')
    }
    for (const separator of separators) {
      expect(separator.text()).toBe('|')
      expect(separator.attributes('aria-hidden')).toBe('true')
    }
    expect(wrapper.get('[data-testid="sftp-toolbar-action-delete"]').classes()).toContain('sftp-toolbar-menu-action-danger')
    expect(wrapper.get('[data-testid="sftp-toolbar-action-delete"]').attributes('disabled')).toBeDefined()
  })

  it('renders current-directory filter state and emits filter updates, clear, and keydown events', async () => {
    const wrapper = mountToolbar({
      filterQuery: 'app',
      filterActive: true,
      filterStatus: 'Filtered: 1 / 2',
    })

    const input = wrapper.get<HTMLInputElement>('[data-testid="sftp-file-filter"]')
    expect(input.element.value).toBe('app')
    expect(wrapper.get('[data-testid="sftp-filter-status"]').text()).toBe('Filtered: 1 / 2')

    await input.setValue('log')
    await input.trigger('keydown', { key: 'Escape' })
    await wrapper.get('[data-testid="sftp-file-filter-clear"]').trigger('click')

    expect(wrapper.emitted('update:filterQuery')?.at(-1)).toEqual(['log'])
    expect(wrapper.emitted('filterKeydown')).toBeTruthy()
    expect(wrapper.emitted('clearFilter')).toBeTruthy()
  })

  it('keeps bookmark UI in the toolbar component and emits jump and delete events from the teleported menu', async () => {
    const wrapper = mountToolbar()

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmark"]').trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('action')).toContainEqual(['bookmark'])
    expect(bookmarkMenu()).not.toBeNull()
    expect(bookmarkMenu()?.closest('.sftp-toolbar')).toBeNull()
    expect(bookmarkMenu()?.textContent).toContain('log')

    bookmarkMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-bookmark-jump-logs"]')?.click()
    bookmarkMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-bookmark-delete-logs"]')?.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('jumpBookmark')?.[0]).toEqual([bookmarks[0]])
    expect(wrapper.emitted('deleteBookmark')?.[0]).toEqual(['logs'])
  })

  it('moves overflowed toolbar actions into a teleported More menu and emits enabled item actions only', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 760)

    expect(wrapper.find('[data-testid="sftp-toolbar-more"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-toolbar-action-id]').map((action) => action.attributes('data-toolbar-action-id')))
      .not.toContain('upload-directory')

    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(moreMenu()).not.toBeNull()
    expect(moreMenu()?.closest('.sftp-toolbar')).toBeNull()

    moreMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-more-action-upload-directory"]')?.click()
    moreMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-more-action-delete"]')?.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('action')).toContainEqual(['upload-directory'])
    expect(wrapper.emitted('action')).not.toContainEqual(['delete'])
  })

  it('uses compact More menu item classes instead of oversized toolbar button classes', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 520)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    const upload = moreMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-more-action-upload-directory"]')
    const deleteAction = moreMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-more-action-delete"]')

    expect(upload).not.toBeNull()
    expect(upload?.classList.contains('sftp-toolbar-more-item')).toBe(true)
    expect(upload?.classList.contains('secondary')).toBe(false)
    expect(upload?.classList.contains('danger')).toBe(false)
    expect(deleteAction?.classList.contains('sftp-toolbar-more-item')).toBe(true)
    expect(deleteAction?.classList.contains('sftp-toolbar-more-item-danger')).toBe(true)
    expect(deleteAction?.classList.contains('danger')).toBe(false)
  })

  it('hides More on wide layouts and closes More on outside pointerdown or Escape', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 1800)
    expect(wrapper.find('[data-testid="sftp-toolbar-more"]').exists()).toBe(false)

    await relayoutToolbar(wrapper, 520)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    expect(moreMenu()).not.toBeNull()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(moreMenu()).toBeNull()

    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(moreMenu()).toBeNull()
  })

  it('emits conflict policy changes from inline and overflow controls', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 1800)
    await wrapper.get<HTMLSelectElement>('[data-testid="sftp-toolbar-action-conflict-policy"]').setValue('overwrite')
    expect(wrapper.emitted('update:conflictPolicy')?.at(-1)).toEqual(['overwrite'])

    await relayoutToolbar(wrapper, 520)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    const conflict = moreMenu()?.querySelector<HTMLSelectElement>('[data-testid="sftp-more-conflict-policy"]')
    expect(conflict).not.toBeNull()
    conflict!.value = 'rename'
    conflict!.dispatchEvent(new Event('change', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:conflictPolicy')?.at(-1)).toEqual(['rename'])
    expect(moreMenu()).toBeNull()
  })

  it('uses shared viewport positioning for the teleported More menu without clipping overflow actions', async () => {
    setViewportSize(260, 180)
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 420)
    mockElementRect(wrapper.get('[data-testid="sftp-toolbar-more"]').element, {
      left: 220,
      top: 8,
      right: 252,
      bottom: 36,
      width: 32,
      height: 28,
    })
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = moreMenu()
    expect(menu).not.toBeNull()
    expect(menu?.classList.contains('viewport-popover')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-menu')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-scroll')).toBe(true)
    const menuWidth = Number.parseInt(menu?.style.width ?? '', 10)
    expect(menuWidth).toBeGreaterThanOrEqual(124)
    expect(menuWidth).toBeLessThanOrEqual(128)
    expect(Number.parseInt(menu?.style.left ?? '', 10)).toBeGreaterThanOrEqual(8)
    expect(Number.parseInt(menu?.style.left ?? '', 10) + Number.parseInt(menu?.style.width ?? menu?.style.minWidth ?? '', 10)).toBeLessThanOrEqual(252)
    expect(Number.parseInt(menu?.style.maxHeight ?? '', 10)).toBeLessThanOrEqual(130)
    expect(menu?.querySelector('[data-testid="sftp-more-action-upload-directory"]')).not.toBeNull()
    expect(menu?.querySelector<HTMLSelectElement>('[data-testid="sftp-more-conflict-policy"]')).not.toBeNull()
  })

  it('keeps the More menu anchored within 12px of the More button when bottom space is tight', async () => {
    setViewportSize(900, 640)
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 420)
    const moreButton = wrapper.get('[data-testid="sftp-toolbar-more"]').element
    mockElementRect(moreButton, {
      left: 742,
      top: 592,
      right: 824,
      bottom: 620,
      width: 82,
      height: 28,
    })
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = moreMenu()
    expect(menu).not.toBeNull()
    const top = Number.parseInt(menu?.style.top ?? '', 10)
    const left = Number.parseInt(menu?.style.left ?? '', 10)
    const width = Number.parseInt(menu?.style.width ?? '', 10)
    expect(Math.abs(left + width - 824)).toBeLessThanOrEqual(12)
    expect(Number.isNaN(top)).toBe(true)
    const bottom = Number.parseInt(menu?.style.bottom ?? '', 10)
    expect(Math.abs((640 - bottom) - (592 - 6))).toBeLessThanOrEqual(1)
  })

  it('uses bottom anchoring for an above-placed More menu so short menus stay beside the toolbar', async () => {
    setViewportSize(900, 640)
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 420)
    const moreButton = wrapper.get('[data-testid="sftp-toolbar-more"]').element
    mockElementRect(moreButton, {
      left: 742,
      top: 592,
      right: 824,
      bottom: 620,
      width: 82,
      height: 28,
    })
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = moreMenu()
    expect(menu).not.toBeNull()
    expect(menu?.style.top).toBe('')
    expect(menu?.style.bottom).toBe('54px')
    expect(menu?.style.transformOrigin).toBe('bottom right')
  })

  it('keeps the overflow conflict policy select from forcing a wide More menu', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 520)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = moreMenu()
    const conflictRow = menu?.querySelector<HTMLElement>('.sftp-more-select')
    const conflict = menu?.querySelector<HTMLSelectElement>('[data-testid="sftp-more-conflict-policy"]')

    expect(menu).not.toBeNull()
    expect(conflictRow).not.toBeNull()
    expect(conflict).not.toBeNull()
    expect(menu?.classList.contains('sftp-more-menu')).toBe(true)
    expect(conflictRow?.classList.contains('sftp-more-select')).toBe(true)
    expect(conflict?.style.width).not.toBe('172px')
  })

  it('keeps the toolbar More button fully readable when overflow is active', async () => {
    const wrapper = mountToolbar()

    await relayoutToolbar(wrapper, 360)

    const more = wrapper.get<HTMLElement>('[data-testid="sftp-toolbar-more"]')
    expect(more.text()).toBe('更多')
    expect(more.classes()).toContain('sftp-toolbar-menu-action')
    expect(more.element.closest('.sftp-more')).not.toBeNull()
  })

  it('renders a separator before More when visible actions exist to its left', async () => {
    const wrapper = mountToolbar({
      showFileFilter: false,
      actions: baseActions.slice(0, 6),
    })

    await relayoutToolbar(wrapper, 420)

    const visibleActions = wrapper.findAll('[data-toolbar-action-id]')
    expect(visibleActions.length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="sftp-toolbar-more"]').exists()).toBe(true)
    const separators = wrapper.findAll('.sftp-toolbar-action-separator')
    expect(separators).toHaveLength(visibleActions.length)
    expect(separators.at(-1)?.attributes('aria-hidden')).toBe('true')
    expect(separators.at(-1)?.element.nextElementSibling?.classList.contains('sftp-more')).toBe(true)
  })

  it('clamps measured More button reserve to the full readable label width before fitting actions', async () => {
    const wrapper = mountToolbar({ showFileFilter: false })
    const measuredMore = wrapper.get<HTMLElement>('[data-measure-toolbar-more]').element
    Object.defineProperty(measuredMore, 'offsetWidth', { configurable: true, value: 32 })
    Object.defineProperty(measuredMore, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        right: 32,
        top: 0,
        bottom: 28,
        width: 32,
        height: 28,
        toJSON: () => ({}),
      }),
    })

    await relayoutToolbar(wrapper, 386)

    const visibleActions = wrapper.findAll('[data-toolbar-action-id]')
      .filter((item) => item.attributes('data-toolbar-action-id') !== 'conflict-policy')
    expect(visibleActions.map((item) => item.attributes('data-toolbar-action-id'))).toEqual(['reconnect'])
    expect(wrapper.get('[data-testid="sftp-toolbar-more"]').text()).toBe('更多')
  })

  it('uses shared viewport positioning for the teleported bookmark menu while preserving empty state and actions', async () => {
    setViewportSize(260, 180)
    const wrapper = mountToolbar({ bookmarks: [] })

    mockElementRect(wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').element, {
      left: 218,
      top: 8,
      right: 252,
      bottom: 36,
      width: 34,
      height: 28,
    })
    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = bookmarkMenu()
    expect(menu).not.toBeNull()
    expect(menu?.classList.contains('viewport-popover')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-menu')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-scroll')).toBe(true)
    expect(menu?.querySelector('.sftp-bookmarks-empty')).not.toBeNull()
    expect(Number.parseInt(menu?.style.left ?? '', 10)).toBeGreaterThanOrEqual(8)
    expect(Number.parseInt(menu?.style.maxHeight ?? '', 10)).toBeLessThanOrEqual(130)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(bookmarkMenu()).toBeNull()
  })
})
