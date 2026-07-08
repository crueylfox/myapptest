import { dispatchTerminalWheelZoom, type TerminalZoomKind } from './terminalZoom'

const terminalSurfaceSelector = '[data-terminal-surface="true"]'
let ctrlZoomModifierDown = false
let metaZoomModifierDown = false

function elementFromEventTarget(target: EventTarget | null) {
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}

export function isTerminalSurfaceTarget(target: EventTarget | null) {
  return Boolean(terminalSurfaceFromTarget(target))
}

export function terminalSurfaceFromTarget(target: EventTarget | null) {
  return elementFromEventTarget(target)?.closest<HTMLElement>(terminalSurfaceSelector) ?? null
}

export function shouldPreventWebviewWheelZoom(event: WheelEvent) {
  return isWebviewZoomWheelGesture(event)
}

export function shouldStopWebviewWheelZoomPropagation(event: WheelEvent) {
  return shouldPreventWebviewWheelZoom(event)
}

export function zoomTerminalSurfaceFromWheel(event: WheelEvent) {
  const surface = terminalSurfaceFromTarget(event.target)
  const sessionID = surface?.dataset.terminalSessionId?.trim()
  const kind = surface?.dataset.terminalKind as TerminalZoomKind | undefined
  if (!surface || !sessionID || (kind !== 'ssh' && kind !== 'local')) return false
  return dispatchTerminalWheelZoom(sessionID, event.deltaY)
}

export function preventWebviewWheelZoom(event: WheelEvent) {
  if (!shouldPreventWebviewWheelZoom(event)) return
  event.preventDefault()
  zoomTerminalSurfaceFromWheel(event)
  event.stopPropagation()
  event.stopImmediatePropagation?.()
}

export function isWebviewZoomWheelGesture(event: WheelEvent) {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.getModifierState?.('Control') === true ||
    event.getModifierState?.('Meta') === true ||
    ctrlZoomModifierDown ||
    metaZoomModifierDown
  )
}

export function trackWebviewZoomModifierKeyDown(event: KeyboardEvent) {
  if (event.key === 'Control' || event.ctrlKey) ctrlZoomModifierDown = true
  if (event.key === 'Meta' || event.key === 'OS' || event.metaKey) metaZoomModifierDown = true
}

export function trackWebviewZoomModifierKeyUp(event: KeyboardEvent) {
  if (event.key === 'Control' || !event.ctrlKey) ctrlZoomModifierDown = false
  if (event.key === 'Meta' || event.key === 'OS' || !event.metaKey) metaZoomModifierDown = false
}

export function resetWebviewZoomModifierKeys() {
  ctrlZoomModifierDown = false
  metaZoomModifierDown = false
}

export function shouldPreventWebviewKeyboardZoom(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key.toLowerCase()
  const code = event.code
  return (
    key === '+' ||
    key === '-' ||
    key === '=' ||
    key === '0' ||
    code === 'Equal' ||
    code === 'Minus' ||
    code === 'Digit0' ||
    code === 'NumpadAdd' ||
    code === 'NumpadSubtract' ||
    code === 'Numpad0'
  )
}

export function preventWebviewKeyboardZoom(event: KeyboardEvent) {
  if (!shouldPreventWebviewKeyboardZoom(event)) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
}
