export interface TerminalCompletionPositionInput {
  paneWidth: number
  paneHeight: number
  terminalLeft: number
  terminalTop: number
  terminalWidth: number
  terminalHeight: number
  columns: number
  rows: number
  cursorX: number
  cursorY: number
  overlayWidth: number
  overlayHeight: number
  devicePixelRatio?: number
}

export interface TerminalCompletionPosition {
  left: number
  top: number
  width: number
  height: number
}

export const terminalCompletionOverlayWidth = 500
const panePadding = 12
const cursorGap = 8

export function terminalCompletionOverlayCssWidth(devicePixelRatio = 1, visualWidth = terminalCompletionOverlayWidth) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 1 ? devicePixelRatio : 1
  return Math.max(1, Math.round(visualWidth / ratio))
}

export function calculateTerminalCompletionPosition(input: TerminalCompletionPositionInput): TerminalCompletionPosition {
  const paneWidth = Math.max(1, input.paneWidth)
  const paneHeight = Math.max(1, input.paneHeight)
  const columns = Math.max(1, input.columns)
  const rows = Math.max(1, input.rows)
  const cellWidth = Math.max(1, input.terminalWidth / columns)
  const cellHeight = Math.max(1, input.terminalHeight / rows)
  const cursorLeft = input.terminalLeft + clamp(input.cursorX, 0, columns - 1) * cellWidth
  const cursorTop = input.terminalTop + clamp(input.cursorY, 0, rows - 1) * cellHeight
  const cursorRight = cursorLeft + cellWidth
  const cursorBottom = cursorTop + cellHeight
  const maxWidth = Math.max(1, paneWidth - panePadding * 2)
  const requestedWidth = terminalCompletionOverlayCssWidth(input.devicePixelRatio, input.overlayWidth || terminalCompletionOverlayWidth)
  const width = Math.min(Math.max(1, requestedWidth), maxWidth)
  const maxHeight = Math.max(1, paneHeight - panePadding * 2)
  const requestedHeight = Math.min(Math.max(1, input.overlayHeight), maxHeight)
  const availableBelow = paneHeight - panePadding - (cursorBottom + cursorGap)
  const availableAbove = cursorTop - cursorGap - panePadding
  const placeBelow = availableBelow >= requestedHeight || availableBelow >= availableAbove
  const sideSpace = Math.max(1, placeBelow ? availableBelow : availableAbove)
  const height = Math.min(requestedHeight, sideSpace)
  const top = placeBelow
    ? cursorBottom + cursorGap
    : cursorTop - cursorGap - height
  const left = clamp(cursorRight + cursorGap, panePadding, Math.max(panePadding, paneWidth - width - panePadding))

  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
