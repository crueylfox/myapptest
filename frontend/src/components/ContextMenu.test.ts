// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu.vue'

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

describe('ContextMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('clamps to the viewport and closes with Escape', async () => {
    setViewportSize(320, 240)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 180, height: 240, top: 0, right: 180,
      bottom: 240, left: 0, toJSON: () => undefined,
    })
    const wrapper = mount(ContextMenu, {
      attachTo: document.body,
      props: {
        x: window.innerWidth + 100,
        y: window.innerHeight + 100,
        items: [{ id: 'open', label: '打开终端' }],
      },
    })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const menu = document.body.querySelector<HTMLElement>('.context-menu')
    expect(menu?.classList.contains('viewport-popover')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-menu')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-scroll')).toBe(true)
    expect(Number.parseInt(menu?.style.left ?? '', 10)).toBeLessThan(window.innerWidth)
    expect(Number.parseInt(menu?.style.top ?? '', 10) + Number.parseInt(menu?.style.maxHeight ?? '', 10)).toBeLessThanOrEqual(234)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('uses a virtual pointer anchor and keeps tall menus internally scrollable', async () => {
    setViewportSize(260, 180)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 400, top: 0, right: 190,
      bottom: 400, left: 0, toJSON: () => undefined,
    })
    const wrapper = mount(ContextMenu, {
      attachTo: document.body,
      props: {
        x: 248,
        y: 168,
        interactionScope: 'sftp',
        items: Array.from({ length: 16 }, (_, index) => ({ id: `item-${index}`, label: `Item ${index}` })),
      },
    })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    const menu = document.body.querySelector<HTMLElement>('.context-menu')!
    const left = Number.parseInt(menu.style.left, 10)
    const top = Number.parseInt(menu.style.top, 10)
    const width = Number.parseInt(menu.style.width, 10)
    const maxHeight = Number.parseInt(menu.style.maxHeight, 10)
    expect(menu.dataset.interactionScope).toBe('sftp')
    expect(left + width).toBeLessThanOrEqual(254)
    expect(top + maxHeight).toBeLessThanOrEqual(174)
    expect(maxHeight).toBeLessThan(400)
  })

  it('does not select disabled items', async () => {
    const wrapper = mount(ContextMenu, {
      attachTo: document.body,
      props: {
        x: 10, y: 10,
        items: [{ id: 'connect', label: '连接', disabled: true }],
      },
    })
    await wrapper.vm.$nextTick()
    const button = document.body.querySelector<HTMLButtonElement>('.context-menu button')
    button?.click()
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('keeps danger styling and outside-click close behavior', async () => {
    const wrapper = mount(ContextMenu, {
      attachTo: document.body,
      props: {
        x: 10, y: 10,
        items: [{ id: 'delete', label: '删除', danger: true }],
      },
    })
    await wrapper.vm.$nextTick()
    const button = document.body.querySelector<HTMLButtonElement>('.context-menu button')!
    expect(button.classList.contains('danger')).toBe(true)

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
