export type FileTableWheelEvent = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>

export type FileTableWheelMetrics = {
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

const WHEEL_LINE_PIXELS = 16

function normalizeFileTableWheelDelta(event: FileTableWheelEvent, metrics: FileTableWheelMetrics) {
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!rawDelta) return 0
  if (event.deltaMode === 1) return rawDelta * WHEEL_LINE_PIXELS
  if (event.deltaMode === 2) return rawDelta * metrics.clientWidth
  return rawDelta
}

function hasFileTableVerticalOverflow(event: FileTableWheelEvent, metrics: FileTableWheelMetrics) {
  if (!event.deltaY) return false
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  return maxScrollTop > 0
}

export function resolveFileTableWheelScrollLeft(
  event: FileTableWheelEvent,
  metrics: FileTableWheelMetrics,
): number | null {
  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  if (maxScrollLeft <= 0) return null
  if (Math.abs(event.deltaY) >= Math.abs(event.deltaX) && hasFileTableVerticalOverflow(event, metrics)) return null
  const delta = normalizeFileTableWheelDelta(event, metrics)
  if (!delta) return null
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, metrics.scrollLeft + delta))
  return nextScrollLeft === metrics.scrollLeft ? null : nextScrollLeft
}

export function applyFileTableWheel(event: WheelEvent) {
  const table = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  if (!table) return false
  const nextScrollLeft = resolveFileTableWheelScrollLeft(event, {
    clientWidth: table.clientWidth,
    scrollWidth: table.scrollWidth,
    scrollLeft: table.scrollLeft,
    clientHeight: table.clientHeight,
    scrollHeight: table.scrollHeight,
    scrollTop: table.scrollTop,
  })
  if (nextScrollLeft === null) return false
  table.scrollLeft = nextScrollLeft
  event.preventDefault()
  return true
}
