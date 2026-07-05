import { describe, expect, it } from 'vitest'
import { calculateTerminalCompletionPosition } from './terminalCompletionPosition'

describe('terminal completion positioning', () => {
  it('uses a 500px overlay width when the pane has room', () => {
    const position = calculateTerminalCompletionPosition({
      paneWidth: 800,
      paneHeight: 420,
      terminalLeft: 18,
      terminalTop: 20,
      terminalWidth: 764,
      terminalHeight: 360,
      columns: 100,
      rows: 30,
      cursorX: 36,
      cursorY: 10,
      overlayWidth: 500,
      overlayHeight: 260,
    })

    expect(position.width).toBe(500)
  })

  it('keeps the visual overlay width near 500px on high-DPI Windows scaling', () => {
    const position = calculateTerminalCompletionPosition({
      paneWidth: 800,
      paneHeight: 420,
      terminalLeft: 18,
      terminalTop: 20,
      terminalWidth: 764,
      terminalHeight: 360,
      columns: 100,
      rows: 30,
      cursorX: 36,
      cursorY: 10,
      overlayWidth: 500,
      overlayHeight: 260,
      devicePixelRatio: 1.5,
    })

    expect(position.width).toBe(333)
    expect(Math.round(position.width * 1.5)).toBe(500)
  })

  it('shrinks the overlay to the pane width minus 24px in narrow panes', () => {
    const position = calculateTerminalCompletionPosition({
      paneWidth: 360,
      paneHeight: 420,
      terminalLeft: 18,
      terminalTop: 20,
      terminalWidth: 324,
      terminalHeight: 360,
      columns: 80,
      rows: 30,
      cursorX: 20,
      cursorY: 8,
      overlayWidth: 500,
      overlayHeight: 260,
    })

    expect(position.width).toBe(336)
    expect(position.left).toBeGreaterThanOrEqual(12)
    expect(position.left + position.width).toBeLessThanOrEqual(348)
  })

  it('places the overlay below and to the right of the cursor when there is room', () => {
    const position = calculateTerminalCompletionPosition({
      paneWidth: 900,
      paneHeight: 500,
      terminalLeft: 20,
      terminalTop: 24,
      terminalWidth: 800,
      terminalHeight: 320,
      columns: 100,
      rows: 20,
      cursorX: 20,
      cursorY: 5,
      overlayWidth: 500,
      overlayHeight: 220,
    })

    const cursor = rect(20 + 20 * 8, 24 + 5 * 16, 8, 16)
    const token = rect(cursor.x - 3 * 8, cursor.y, 4 * 8, cursor.height)
    const overlay = rect(position.left, position.top, position.width, position.height)
    expect(position.left).toBeGreaterThanOrEqual(cursor.x + cursor.width + 8)
    expect(position.top).toBeGreaterThanOrEqual(cursor.y + cursor.height + 8)
    expect(overlaps(overlay, cursor)).toBe(false)
    expect(overlaps(overlay, token)).toBe(false)
    expect(position.left + position.width).toBeLessThanOrEqual(800)
  })

  it('flips above the cursor when there is not enough room below', () => {
    const position = calculateTerminalCompletionPosition({
      paneWidth: 800,
      paneHeight: 420,
      terminalLeft: 18,
      terminalTop: 20,
      terminalWidth: 764,
      terminalHeight: 360,
      columns: 100,
      rows: 30,
      cursorX: 88,
      cursorY: 27,
      overlayWidth: 500,
      overlayHeight: 260,
    })

    const cellHeight = 360 / 30
    const cursorTop = 20 + 27 * cellHeight
    expect(position.top + position.height).toBeLessThanOrEqual(cursorTop - 8)
    expect(position.left + position.width).toBeLessThanOrEqual(800)
    expect(position.top).toBeGreaterThanOrEqual(12)
  })

  it('clamps horizontally without leaving the pane', () => {
    const position = calculateTerminalCompletionPosition({
      paneWidth: 640,
      paneHeight: 420,
      terminalLeft: 18,
      terminalTop: 20,
      terminalWidth: 604,
      terminalHeight: 360,
      columns: 100,
      rows: 30,
      cursorX: 96,
      cursorY: 10,
      overlayWidth: 500,
      overlayHeight: 260,
    })

    expect(position.left).toBeGreaterThanOrEqual(12)
    expect(position.left + position.width).toBeLessThanOrEqual(628)
  })
})

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height }
}

function overlaps(first: ReturnType<typeof rect>, second: ReturnType<typeof rect>) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  )
}
