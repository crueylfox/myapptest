import { computed, ref, type CSSProperties, type Ref } from 'vue'

export type CommandButtonDockEdge = 'top' | 'right' | 'bottom' | 'left'
export interface CommandButtonDock {
  edge: CommandButtonDockEdge
  offset: number
}
export interface CommandButtonRect {
  left: number
  top: number
  width: number
  height: number
}
export interface CommandButtonSize {
  width: number
  height: number
}
export interface CommandButtonPoint {
  x: number
  y: number
}

export const COMMAND_BUTTON_DOCK_STORAGE_KEY = 'serverpilot.commandButtonDock'
export const DEFAULT_COMMAND_BUTTON_DOCK: CommandButtonDock = { edge: 'bottom', offset: 18 }
export const COMMAND_BUTTON_MARGIN = 12
export const COMMAND_BUTTON_DRAG_THRESHOLD = 6

const validEdges = new Set<CommandButtonDockEdge>(['top', 'right', 'bottom', 'left'])

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeDock(value: unknown): CommandButtonDock | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { edge?: unknown; offset?: unknown }
  if (typeof candidate.edge !== 'string' || !validEdges.has(candidate.edge as CommandButtonDockEdge)) return null
  if (typeof candidate.offset !== 'number' || !Number.isFinite(candidate.offset)) return null
  return { edge: candidate.edge as CommandButtonDockEdge, offset: candidate.offset }
}

export function commandButtonMovedPastThreshold(
  start: CommandButtonPoint,
  current: CommandButtonPoint,
  threshold = COMMAND_BUTTON_DRAG_THRESHOLD,
) {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold
}

export function readCommandButtonDock(storage: Storage | null | undefined = window.localStorage): CommandButtonDock {
  try {
    const raw = storage?.getItem(COMMAND_BUTTON_DOCK_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return normalizeDock(parsed) ?? { ...DEFAULT_COMMAND_BUTTON_DOCK }
  } catch {
    return { ...DEFAULT_COMMAND_BUTTON_DOCK }
  }
}

export function writeCommandButtonDock(
  storage: Storage | null | undefined,
  dock: CommandButtonDock,
) {
  try {
    storage?.setItem(COMMAND_BUTTON_DOCK_STORAGE_KEY, JSON.stringify(dock))
  } catch {
    // UI preference persistence is best-effort only.
  }
}

export function dockedCommandButtonPosition(
  dock: CommandButtonDock,
  container: CommandButtonRect,
  button: CommandButtonSize,
  margin = COMMAND_BUTTON_MARGIN,
) {
  const maxLeft = Math.max(margin, container.width - button.width - margin)
  const maxTop = Math.max(margin, container.height - button.height - margin)
  const offsetX = clamp(dock.offset, margin, maxLeft)
  const offsetY = clamp(dock.offset, margin, maxTop)

  if (dock.edge === 'top') return { left: container.left + offsetX, top: container.top + margin }
  if (dock.edge === 'left') return { left: container.left + margin, top: container.top + offsetY }
  if (dock.edge === 'right') return { left: container.left + container.width - button.width - margin, top: container.top + offsetY }
  return { left: container.left + offsetX, top: container.top + container.height - button.height - margin }
}

export function snapCommandButtonDock(
  center: CommandButtonPoint,
  container: CommandButtonRect,
  button: CommandButtonSize,
  margin = COMMAND_BUTTON_MARGIN,
): CommandButtonDock {
  const distances: Record<CommandButtonDockEdge, number> = {
    top: center.y - container.top,
    right: container.left + container.width - center.x,
    bottom: container.top + container.height - center.y,
    left: center.x - container.left,
  }
  const edge = (Object.entries(distances) as Array<[CommandButtonDockEdge, number]>)
    .sort((first, second) => first[1] - second[1])[0][0]
  const rawOffset = edge === 'left' || edge === 'right'
    ? center.y - container.top - button.height / 2
    : center.x - container.left - button.width / 2
  const maxOffset = edge === 'left' || edge === 'right'
    ? container.height - button.height - margin
    : container.width - button.width - margin
  return {
    edge,
    offset: clamp(rawOffset, margin, Math.max(margin, maxOffset)),
  }
}

export function useDockedCommandButton(stageRef: Ref<HTMLElement | undefined>, layoutRevision?: Ref<unknown>) {
  const buttonRef = ref<HTMLButtonElement>()
  const dock = ref<CommandButtonDock>(readCommandButtonDock())
  const dragging = ref(false)
  const draggedDuringPointer = ref(false)
  const dragPosition = ref<{ left: number; top: number } | null>(null)
  const pointerState = ref<{
    start: CommandButtonPoint
    pointerOffset: CommandButtonPoint
  } | null>(null)

  function rectFromElement(element: HTMLElement): CommandButtonRect {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  function currentButtonSize(): CommandButtonSize {
    const rect = buttonRef.value?.getBoundingClientRect()
    return {
      width: Math.max(rect?.width || 64, 54),
      height: Math.max(rect?.height || 32, 32),
    }
  }

  const buttonStyle = computed<CSSProperties>(() => {
    layoutRevision?.value
    if (!stageRef.value) return {}
    if (dragPosition.value) {
      return {
        left: `${dragPosition.value.left}px`,
        top: `${dragPosition.value.top}px`,
        right: 'auto',
        bottom: 'auto',
      }
    }
    const stageRect = rectFromElement(stageRef.value)
    const position = dockedCommandButtonPosition(dock.value, stageRect, currentButtonSize())
    return {
      left: `${position.left - stageRect.left}px`,
      top: `${position.top - stageRect.top}px`,
      right: 'auto',
      bottom: 'auto',
    }
  })

  function moveButton(event: PointerEvent) {
    if (!pointerState.value || !stageRef.value) return
    const state = pointerState.value
    if (!dragging.value && commandButtonMovedPastThreshold(state.start, { x: event.clientX, y: event.clientY })) {
      dragging.value = true
      draggedDuringPointer.value = true
    }
    if (!dragging.value) return
    const stageRect = rectFromElement(stageRef.value)
    const buttonSize = currentButtonSize()
    const maxLeft = Math.max(COMMAND_BUTTON_MARGIN, stageRect.width - buttonSize.width - COMMAND_BUTTON_MARGIN)
    const maxTop = Math.max(COMMAND_BUTTON_MARGIN, stageRect.height - buttonSize.height - COMMAND_BUTTON_MARGIN)
    dragPosition.value = {
      left: clamp(event.clientX - stageRect.left - state.pointerOffset.x, COMMAND_BUTTON_MARGIN, maxLeft),
      top: clamp(event.clientY - stageRect.top - state.pointerOffset.y, COMMAND_BUTTON_MARGIN, maxTop),
    }
  }

  function finishDrag(event: PointerEvent) {
    window.removeEventListener('pointermove', moveButton, true)
    window.removeEventListener('pointerup', finishDrag, true)
    if (dragging.value && stageRef.value) {
      const stageRect = rectFromElement(stageRef.value)
      const buttonSize = currentButtonSize()
      const position = dragPosition.value ?? {
        left: event.clientX - stageRect.left - buttonSize.width / 2,
        top: event.clientY - stageRect.top - buttonSize.height / 2,
      }
      const nextDock = snapCommandButtonDock({
        x: stageRect.left + position.left + buttonSize.width / 2,
        y: stageRect.top + position.top + buttonSize.height / 2,
      }, stageRect, buttonSize)
      dock.value = nextDock
      writeCommandButtonDock(window.localStorage, nextDock)
    }
    pointerState.value = null
    dragging.value = false
    dragPosition.value = null
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !stageRef.value || !buttonRef.value) return
    const buttonRect = buttonRef.value.getBoundingClientRect()
    pointerState.value = {
      start: { x: event.clientX, y: event.clientY },
      pointerOffset: { x: event.clientX - buttonRect.left, y: event.clientY - buttonRect.top },
    }
    draggedDuringPointer.value = false
    buttonRef.value.setPointerCapture?.(event.pointerId)
    window.addEventListener('pointermove', moveButton, true)
    window.addEventListener('pointerup', finishDrag, true)
  }

  function consumeClickAfterDrag() {
    if (!draggedDuringPointer.value) return false
    draggedDuringPointer.value = false
    return true
  }

  function cleanup() {
    window.removeEventListener('pointermove', moveButton, true)
    window.removeEventListener('pointerup', finishDrag, true)
  }

  return {
    buttonRef,
    buttonStyle,
    dragging,
    onPointerDown,
    consumeClickAfterDrag,
    cleanup,
  }
}
