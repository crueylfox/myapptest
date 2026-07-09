export const terminalZoomMinFontSize = 10
export const terminalZoomMaxFontSize = 28
const terminalZoomLetterSpacingPerFontPixel = 0.16
const terminalZoomMinLetterSpacing = -1
const terminalZoomMaxLetterSpacing = 4
const terminalFontZoomDeltaBySessionID = new Map<string, number>()
const terminalWheelZoomHandlers = new Map<string, (wheelDeltaY: number) => void>()

export type TerminalZoomKind = 'ssh' | 'local'
export type TerminalZoomProfileMetrics = {
  fontSize: number
  lineHeight: number
  letterSpacing: number
}
export type TerminalZoomedProfileOptions = TerminalZoomProfileMetrics & {
  fontWeight: 'normal'
  fontWeightBold: 'bold'
}

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

function roundedMetric(value: number) {
  return Math.round(value * 1000) / 1000
}

function clampTerminalLetterSpacing(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(terminalZoomMaxLetterSpacing, Math.max(terminalZoomMinLetterSpacing, roundedMetric(value)))
}

function effectiveTerminalLetterSpacing(profile: TerminalZoomProfileMetrics, fontSize: number, baseFontSize: number, ratio: number) {
  const fontDelta = fontSize - baseFontSize
  return clampTerminalLetterSpacing(
    profile.letterSpacing * ratio + fontDelta * terminalZoomLetterSpacingPerFontPixel,
  )
}

export function effectiveTerminalZoomedProfileOptions(
  sessionID: string,
  profile: TerminalZoomProfileMetrics,
): TerminalZoomedProfileOptions {
  const baseFontSize = clampTerminalFontSize(profile.fontSize)
  const fontSize = effectiveTerminalFontSizeForSession(sessionID, baseFontSize)
  const ratio = fontSize / baseFontSize
  return {
    fontSize,
    lineHeight: roundedMetric(profile.lineHeight * ratio),
    letterSpacing: effectiveTerminalLetterSpacing(profile, fontSize, baseFontSize, ratio),
    fontWeight: 'normal',
    fontWeightBold: 'bold',
  }
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

export function applyTerminalZoomedProfileOptions(
  terminal: { options?: unknown },
  sessionID: string,
  profile: TerminalZoomProfileMetrics,
) {
  const next = effectiveTerminalZoomedProfileOptions(sessionID, profile)
  if (typeof terminal.options === 'object' && terminal.options !== null) {
    const options = terminal.options as Record<string, unknown>
    options.fontSize = next.fontSize
    options.lineHeight = next.lineHeight
    options.letterSpacing = next.letterSpacing
    options.fontWeight = next.fontWeight
    options.fontWeightBold = next.fontWeightBold
  } else {
    terminal.options = { ...next }
  }

  const refresh = (terminal as { refresh?: (start: number, end: number) => void }).refresh
  const rows = (terminal as { rows?: number }).rows
  if (typeof refresh === 'function' && typeof rows === 'number' && Number.isFinite(rows) && rows > 0) {
    refresh.call(terminal, 0, rows - 1)
  }
}
