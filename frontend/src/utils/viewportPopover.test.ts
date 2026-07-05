import { describe, expect, it } from 'vitest'
import { getViewportPopoverPosition, type ViewportPopoverRect } from './viewportPopover'

function rect(values: Partial<ViewportPopoverRect>): ViewportPopoverRect {
  return {
    left: values.left ?? 0,
    top: values.top ?? 0,
    right: values.right ?? (values.left ?? 0) + (values.width ?? 0),
    bottom: values.bottom ?? (values.top ?? 0) + (values.height ?? 0),
    width: values.width ?? Math.max(0, (values.right ?? 0) - (values.left ?? 0)),
    height: values.height ?? Math.max(0, (values.bottom ?? 0) - (values.top ?? 0)),
  }
}

describe('getViewportPopoverPosition', () => {
  it('positions bottom-end popovers while clamping right overflow', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 280, top: 32, right: 316, bottom: 56, width: 36, height: 24 }),
      popoverSize: { width: 160, height: 120 },
      viewport: { width: 320, height: 240 },
      placement: 'bottom-end',
      margin: 8,
      gap: 6,
    })

    expect(position.left).toBe(152)
    expect(position.top).toBe(62)
    expect(position.left + position.width).toBeLessThanOrEqual(312)
    expect(position.placementUsed).toBe('bottom-end')
  })

  it('positions bottom-start popovers while clamping left overflow', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: -30, top: 32, right: 8, bottom: 56, width: 38, height: 24 }),
      popoverSize: { width: 150, height: 100 },
      viewport: { width: 320, height: 240 },
      placement: 'bottom-start',
      margin: 10,
      gap: 4,
    })

    expect(position.left).toBe(10)
    expect(position.top).toBe(60)
    expect(position.placementUsed).toBe('bottom-start')
  })

  it('flips above when bottom placement would overflow more than top placement', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 220, top: 210, right: 260, bottom: 234, width: 40, height: 24 }),
      popoverSize: { width: 150, height: 120 },
      viewport: { width: 320, height: 260 },
      placement: 'auto-end',
      margin: 8,
      gap: 6,
    })

    expect(position.top).toBe(84)
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(210)
    expect(position.placementUsed).toBe('top-end')
  })

  it('constrains panel-bound popovers to the supplied bounds rect', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 860, top: 1164, right: 1088, bottom: 1188, width: 228, height: 24 }),
      boundsRect: rect({ left: 0, top: 840, right: 1200, bottom: 1156, width: 1200, height: 316 }),
      popoverSize: { width: 620, height: 360 },
      viewport: { width: 1200, height: 1200 },
      placement: 'panel-bound',
      margin: 12,
      gap: 8,
      maxHeight: 360,
    })

    expect(position.top).toBe(840)
    expect(position.maxHeight).toBe(316)
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(1156)
    expect(position.left).toBe(468)
    expect(position.placementUsed).toBe('panel-bound')
  })

  it('uses the passed maxHeight when it is smaller than available space', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 100, top: 24, right: 160, bottom: 48, width: 60, height: 24 }),
      popoverSize: { width: 180, height: 600 },
      viewport: { width: 640, height: 480 },
      placement: 'bottom-start',
      margin: 12,
      gap: 6,
      maxHeight: 140,
    })

    expect(position.maxHeight).toBe(140)
    expect(position.top).toBe(54)
  })

  it('returns an internal-scroll maxHeight when content is taller than available space', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 40, top: 150, right: 80, bottom: 174, width: 40, height: 24 }),
      popoverSize: { width: 200, height: 900 },
      viewport: { width: 360, height: 260 },
      placement: 'bottom-start',
      margin: 12,
      gap: 6,
    })

    expect(position.maxHeight).toBeLessThan(900)
    expect(position.top).toBeGreaterThanOrEqual(12)
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(248)
  })

  it('shrinks width in narrow viewports without overflowing past the margin', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 130, top: 24, right: 160, bottom: 48, width: 30, height: 24 }),
      popoverSize: { width: 420, height: 160 },
      viewport: { width: 180, height: 320 },
      placement: 'bottom-end',
      margin: 12,
      gap: 6,
    })

    expect(position.left).toBe(12)
    expect(position.width).toBe(156)
    expect(position.left + position.width).toBe(168)
  })

  it('handles invalid or zero anchor rects without throwing', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: Number.NaN, top: Number.NaN, right: Number.NaN, bottom: Number.NaN, width: 0, height: 0 }),
      popoverSize: { width: 160, height: 90 },
      viewport: { width: 320, height: 240 },
      placement: 'bottom-end',
      margin: 8,
      gap: 6,
    })

    expect(Number.isFinite(position.left)).toBe(true)
    expect(Number.isFinite(position.top)).toBe(true)
    expect(position.left).toBeGreaterThanOrEqual(8)
    expect(position.top).toBeGreaterThanOrEqual(8)
  })

  it('positions a menu from a virtual pointer anchor rect', () => {
    const position = getViewportPopoverPosition({
      anchorRect: rect({ left: 302, top: 226, right: 302, bottom: 226, width: 0, height: 0 }),
      popoverSize: { width: 140, height: 120 },
      viewport: { width: 320, height: 240 },
      placement: 'bottom-start',
      margin: 6,
      gap: 0,
    })

    expect(position.left).toBe(174)
    expect(position.top).toBe(106)
    expect(position.width).toBe(140)
    expect(position.maxHeight).toBe(120)
    expect(position.placementUsed).toBe('top-start')
  })
})
