export const terminalZoomMinFontSize = 10
export const terminalZoomMaxFontSize = 28
const terminalFontZoomDeltaBySessionID = new Map<string, number>()
const terminalWheelZoomHandlers = new Map<string, (wheelDeltaY: number) => void>()

export type TerminalZoomKind = 'ssh' | 'local'

export function clampTerminalFontSize(value: number) {
  if (!Number.isFinite(value)) return terminalZoomMinFontSize
  return Math.min(terminalZoomMaxFontSize, Math.max(terminalZoomMinFontSize, Math.round(value)))
}

export function nextTerminalZoomDelta(baseFontSize: number, currentDelta: number, wheelDeltaY: number) {
  const base = clampTerminalFontSize(baseFontSize)
  const current = clampTerminalFontSize(base + currentDelta)
  const direction = wheelDeltaY < 0 ? 1 : -1
  return clampTerminalFontSize(current + direction) - base
}

export function terminalZoomDeltaForSession(sessionID: string) {
  return terminalFontZoomDeltaBySessionID.get(sessionID) ?? 0
}

export function nextTerminalZoomDeltaForSession(sessionID: string, baseFontSize: number, wheelDeltaY: number) {
  const nextDelta = nextTerminalZoomDelta(baseFontSize, terminalZoomDeltaForSession(sessionID), wheelDeltaY)
  terminalFontZoomDeltaBySessionID.set(sessionID, nextDelta)
  return nextDelta
}

export function effectiveTerminalFontSizeForSession(sessionID: string, baseFontSize: number) {
  return clampTerminalFontSize(baseFontSize + terminalZoomDeltaForSession(sessionID))
}

export function clearTerminalZoomDelta(sessionID: string) {
  terminalFontZoomDeltaBySessionID.delete(sessionID)
}

export function registerTerminalWheelZoomHandler(sessionID: string, handler: (wheelDeltaY: number) => void) {
  terminalWheelZoomHandlers.set(sessionID, handler)
}

export function unregisterTerminalWheelZoomHandler(sessionID: string) {
  terminalWheelZoomHandlers.delete(sessionID)
}

export function dispatchTerminalWheelZoom(sessionID: string, wheelDeltaY: number) {
  const handler = terminalWheelZoomHandlers.get(sessionID)
  if (!handler) return false
  handler(wheelDeltaY)
  return true
}

export function applyTerminalFontSizeOption(terminal: { options?: unknown }, fontSize: number) {
  if (typeof terminal.options === 'object' && terminal.options !== null) {
    const options = terminal.options as { fontSize: number }
    options.fontSize = fontSize
  } else {
    terminal.options = { fontSize }
  }

  const refresh = (terminal as { refresh?: (start: number, end: number) => void }).refresh
  const rows = (terminal as { rows?: number }).rows
  if (typeof refresh === 'function' && typeof rows === 'number' && Number.isFinite(rows) && rows > 0) {
    refresh.call(terminal, 0, rows - 1)
  }
}
