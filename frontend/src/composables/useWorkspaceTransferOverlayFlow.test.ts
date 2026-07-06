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

  it('anchors the open popover to the workspace bottom-right even when SFTP is expanded', async () => {
    setViewportSize(1200, 1200)
    const root = document.createElement('div')
    const panel = document.createElement('div')
    panel.className = 'sftp-panel expanded'
    panel.getBoundingClientRect = () => rect({ left: 0, top: 840, right: 1200, bottom: 1170, width: 1200, height: 330 })
    root.getBoundingClientRect = () => rect({ left: 24, top: 40, right: 1180, bottom: 1160, width: 1156, height: 1120 })
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

    const left = Number.parseInt(flow.transferPopoverStyle.value.left ?? '', 10)
    const bottom = Number.parseInt(flow.transferPopoverStyle.value.bottom ?? '', 10)
    const width = Number.parseInt(flow.transferPopoverStyle.value.width ?? '', 10)
    expect(1180 - (left + width)).toBeLessThanOrEqual(24)
    expect(bottom).toBe(40)
    expect(flow.transferPopoverStyle.value.top).toBeUndefined()
    expect(flow.transferPopoverStyle.value.width).toBe('620px')
  })

  it('keeps the popover bottom-right anchored after resize and SFTP height changes', async () => {
    setViewportSize(1000, 720)
    const root = document.createElement('div')
    root.getBoundingClientRect = () => rect({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 })
    const panel = document.createElement('div')
    panel.className = 'sftp-panel expanded'
    panel.getBoundingClientRect = () => rect({ left: 0, top: 520, right: 1000, bottom: 700, width: 1000, height: 180 })
    root.appendChild(panel)
    const button = document.createElement('button')
    button.getBoundingClientRect = () => rect({ left: 800, top: 680, right: 980, bottom: 704, width: 180, height: 24 })
    const flow = useWorkspaceTransferOverlayFlow({
      rootRef: ref(root),
      sftpExpanded: ref(true),
      scheduleAfterOpen: (callback) => nextTick(callback),
    })
    flow.transferButton.value = button

    flow.openTransferPopover()
    await nextTick()
    root.getBoundingClientRect = () => rect({ left: 0, top: 0, right: 900, bottom: 640, width: 900, height: 640 })
    panel.getBoundingClientRect = () => rect({ left: 0, top: 500, right: 900, bottom: 640, width: 900, height: 140 })
    flow.updateTransferPopoverPosition()

    const left = Number.parseInt(flow.transferPopoverStyle.value.left ?? '', 10)
    const bottom = Number.parseInt(flow.transferPopoverStyle.value.bottom ?? '', 10)
    const width = Number.parseInt(flow.transferPopoverStyle.value.width ?? '', 10)
    expect(900 - (left + width)).toBeLessThanOrEqual(24)
    expect(bottom).toBe(80)
    expect(flow.transferPopoverStyle.value.top).toBeUndefined()
  })

  it('uses bottom anchoring so a short transfer queue stays attached to a short SFTP workspace', async () => {
    setViewportSize(900, 640)
    const root = document.createElement('div')
    root.getBoundingClientRect = () => rect({ left: 0, top: 0, right: 900, bottom: 620, width: 900, height: 620 })
    const button = document.createElement('button')
    button.getBoundingClientRect = () => rect({ left: 760, top: 596, right: 884, bottom: 620, width: 124, height: 24 })
    const flow = useWorkspaceTransferOverlayFlow({
      rootRef: ref(root),
      sftpExpanded: ref(true),
      scheduleAfterOpen: (callback) => nextTick(callback),
    })
    flow.transferButton.value = button

    flow.openTransferPopover()
    await nextTick()

    expect(flow.transferPopoverStyle.value.top).toBeUndefined()
    expect(flow.transferPopoverStyle.value.bottom).toBe('20px')
    expect(flow.transferPopoverStyle.value.transformOrigin).toBe('bottom right')
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
