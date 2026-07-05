// @vitest-environment jsdom

import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useWorkspaceTransferOverlayFlow } from './useWorkspaceTransferOverlayFlow'

function rect(values: Partial<DOMRect> = {}): DOMRect {
  const left = values.left ?? values.x ?? 0
  const top = values.top ?? values.y ?? 0
  const width = values.width ?? 120
  const height = values.height ?? 24
  return {
    x: values.x ?? left,
    y: values.y ?? top,
    left,
    top,
    width,
    height,
    right: values.right ?? left + width,
    bottom: values.bottom ?? top + height,
    toJSON: () => undefined,
  } as DOMRect
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

describe('useWorkspaceTransferOverlayFlow', () => {
  it('opens, toggles, closes, and resets scope using the existing transfer popover semantics', async () => {
    const button = document.createElement('button')
    button.className = 'status-transfer'
    button.getBoundingClientRect = () => rect({ left: 300, top: 200, right: 360, bottom: 224, width: 60 })
    const flow = useWorkspaceTransferOverlayFlow({
      rootRef: ref<HTMLElement>(),
      sftpExpanded: ref(false),
      scheduleAfterOpen: (callback) => nextTick(callback),
    })
    flow.transferButton.value = button

    expect(flow.transferPopover.value).toBe(false)
    flow.openTransferPopover()
    await nextTick()
    expect(flow.transferPopover.value).toBe(true)
    expect(flow.transferScope.value).toBe('current')
    expect(flow.transferPopoverStyle.value.position).toBe('fixed')

    flow.openTransferPopover()
    expect(flow.transferPopover.value).toBe(false)

    flow.transferScope.value = 'all'
    flow.openTransferPopover()
    expect(flow.transferScope.value).toBe('current')
    flow.closeTransferPopover()
    expect(flow.transferPopover.value).toBe(false)
  })

  it('clamps popover position to the viewport and keeps it inside the expanded SFTP panel when present', async () => {
    setViewportSize(1200, 1200)
    const root = document.createElement('div')
    const panel = document.createElement('div')
    panel.className = 'sftp-panel expanded'
    panel.getBoundingClientRect = () => rect({ left: 0, top: 840, right: 1200, bottom: 1170, width: 1200, height: 330 })
    root.appendChild(panel)
    const button = document.createElement('button')
    button.getBoundingClientRect = () => rect({ left: 860, top: 1164, right: 1088, bottom: 1188, width: 228, height: 24 })
    const flow = useWorkspaceTransferOverlayFlow({
      rootRef: ref(root),
      sftpExpanded: ref(true),
      scheduleAfterOpen: (callback) => nextTick(callback),
    })
    flow.transferButton.value = button

    flow.openTransferPopover()
    await nextTick()

    const top = Number.parseInt(flow.transferPopoverStyle.value.top ?? '', 10)
    const maxHeight = Number.parseInt(flow.transferPopoverStyle.value.maxHeight ?? '', 10)
    expect(top).toBeGreaterThanOrEqual(840)
    expect(top + maxHeight).toBeLessThanOrEqual(1156)
    expect(flow.transferPopoverStyle.value.width).toBe('620px')
  })

  it('preserves outside click and Escape close behavior without owning other workspace Escape handling', () => {
    const flow = useWorkspaceTransferOverlayFlow({
      rootRef: ref<HTMLElement>(),
      sftpExpanded: ref(false),
      scheduleAfterOpen: (callback) => callback(),
    })
    flow.transferPopover.value = true
    const inside = document.createElement('div')
    inside.className = 'transfer-popover'
    const insideEvent = new MouseEvent('pointerdown', { bubbles: true }) as PointerEvent
    Object.defineProperty(insideEvent, 'target', { value: inside })

    flow.closeTransferPopoverFromOutside(insideEvent)
    expect(flow.transferPopover.value).toBe(true)

    const outsideEvent = new MouseEvent('pointerdown', { bubbles: true }) as PointerEvent
    Object.defineProperty(outsideEvent, 'target', { value: document.body })
    flow.closeTransferPopoverFromOutside(outsideEvent)
    expect(flow.transferPopover.value).toBe(false)

    flow.transferPopover.value = true
    expect(flow.closeTransferPopoverOnEscape(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    expect(flow.closeTransferPopoverOnEscape(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true)
    expect(flow.transferPopover.value).toBe(false)
  })

  it('does not import backend, stores, localStorage, or terminal runtime APIs', async () => {
    const source = String(useWorkspaceTransferOverlayFlow)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('WriteTerminal')
    expect(source).not.toContain('DisconnectServer')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
  })
})
