export type ViewportPopoverPlacement =
  | 'bottom-end'
  | 'bottom-start'
  | 'top-end'
  | 'top-start'
  | 'auto-end'
  | 'auto-start'
  | 'panel-bound'

export type ViewportPopoverRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type ViewportPopoverSize = {
  width: number
  height: number
}

export type ViewportPopoverPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
  placementUsed: Exclude<ViewportPopoverPlacement, 'auto-end' | 'auto-start'>
  transformOrigin: string
}

export type ViewportPopoverOptions = {
  anchorRect: ViewportPopoverRect | DOMRect
  popoverSize: ViewportPopoverSize
  viewport: { width: number; height: number }
  placement?: ViewportPopoverPlacement
  boundsRect?: ViewportPopoverRect | DOMRect | null
  margin?: number
  gap?: number
  maxHeight?: number
}

export function getViewportPopoverPosition(options: ViewportPopoverOptions): ViewportPopoverPosition {
  const margin = nonNegativeNumber(options.margin, 8)
  const gap = nonNegativeNumber(options.gap, 6)
  const viewportWidth = positiveNumber(options.viewport.width, 0)
  const viewportHeight = positiveNumber(options.viewport.height, 0)
  const viewportArea = {
    left: margin,
    top: margin,
    right: Math.max(margin, viewportWidth - margin),
    bottom: Math.max(margin, viewportHeight - margin),
  }
  const area = constrainArea(viewportArea, options.boundsRect)
  const anchor = normalizeRect(options.anchorRect, area.left, area.top)
  const areaWidth = Math.max(0, area.right - area.left)
  const areaHeight = Math.max(0, area.bottom - area.top)
  const width = Math.min(positiveNumber(options.popoverSize.width, areaWidth), areaWidth)
  const requestedHeight = positiveNumber(options.popoverSize.height, areaHeight)
  const cappedHeight = Math.min(requestedHeight, positiveNumber(options.maxHeight, requestedHeight), areaHeight)
  const placement = options.placement ?? 'bottom-end'
  const side = placement.endsWith('start') ? 'start' : 'end'
  const horizontalLeft = side === 'start' ? anchor.left : anchor.right - width
  const left = clamp(horizontalLeft, area.left, area.right - width)

  if (placement === 'panel-bound') {
    const maxHeight = cappedHeight
    const top = clamp(anchor.top - gap - maxHeight, area.top, area.bottom - maxHeight)
    return withOrigin({ left, top, width, maxHeight, placementUsed: 'panel-bound' }, side)
  }

  const spaceBelow = Math.max(0, area.bottom - (anchor.bottom + gap))
  const spaceAbove = Math.max(0, anchor.top - gap - area.top)
  const preferTop = placement.startsWith('top')
    || placement.startsWith('auto') && spaceAbove > spaceBelow && spaceBelow < cappedHeight
    || placement.startsWith('bottom') && spaceAbove > spaceBelow && spaceBelow < cappedHeight
  const verticalSide = preferTop ? 'top' : 'bottom'
  const availableHeight = verticalSide === 'top' ? spaceAbove : spaceBelow
  const maxHeight = Math.min(cappedHeight, availableHeight > 0 ? availableHeight : areaHeight)
  const preferredTop = verticalSide === 'top'
    ? anchor.top - gap - maxHeight
    : anchor.bottom + gap
  const top = clamp(preferredTop, area.top, area.bottom - maxHeight)
  const placementUsed = `${verticalSide}-${side}` as Exclude<ViewportPopoverPlacement, 'auto-end' | 'auto-start' | 'panel-bound'>

  return withOrigin({ left, top, width, maxHeight, placementUsed }, side)
}

function positiveNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback
}

function nonNegativeNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? value : fallback
}

function finiteNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined ? value : fallback
}

function normalizeRect(rect: ViewportPopoverRect | DOMRect, fallbackLeft: number, fallbackTop: number) {
  const left = finiteNumber(rect.left, fallbackLeft)
  const top = finiteNumber(rect.top, fallbackTop)
  const width = positiveNumber(rect.width, 0)
  const height = positiveNumber(rect.height, 0)
  return {
    left,
    top,
    right: finiteNumber(rect.right, left + width),
    bottom: finiteNumber(rect.bottom, top + height),
    width,
    height,
  }
}

function constrainArea(area: { left: number; top: number; right: number; bottom: number }, bounds?: ViewportPopoverRect | DOMRect | null) {
  if (!bounds) return area
  const rect = normalizeRect(bounds, area.left, area.top)
  const left = Math.max(area.left, rect.left)
  const top = Math.max(area.top, rect.top)
  return {
    left,
    top,
    right: Math.max(left, Math.min(area.right, rect.right)),
    bottom: Math.max(top, Math.min(area.bottom, rect.bottom)),
  }
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function withOrigin(
  position: Omit<ViewportPopoverPosition, 'transformOrigin'>,
  side: 'start' | 'end',
): ViewportPopoverPosition {
  const vertical = position.placementUsed === 'panel-bound' || position.placementUsed.startsWith('top') ? 'bottom' : 'top'
  const horizontal = side === 'start' ? 'left' : 'right'
  return {
    ...position,
    transformOrigin: `${vertical} ${horizontal}`,
  }
}
