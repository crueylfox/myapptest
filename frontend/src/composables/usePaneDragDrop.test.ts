// @vitest-environment jsdom

import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePaneDragDrop } from './usePaneDragDrop'
import type { PaneAssignment } from '../utils/workspaceSplitTypes'

function pointer(type: string, values: { x?: number; y?: number; button?: number; target?: EventTarget } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: values.button ?? 0,
    clientX: values.x ?? 0,
    clientY: values.y ?? 0,
  }) as PointerEvent
  if (values.target) Object.defineProperty(event, 'target', { value: values.target })
  return event
}

function pane(id: string, bounds: Partial<DOMRect>) {
  const element = document.createElement('section')
  element.className = 'terminal-pane'
  element.dataset.paneId = id
  element.getBoundingClientRect = () => ({
    x: bounds.x ?? bounds.left ?? 0,
    y: bounds.y ?? bounds.top ?? 0,
    width: bounds.width ?? 100,
    height: bounds.height ?? 100,
    top: bounds.top ?? 0,
    right: bounds.right ?? 100,
    bottom: bounds.bottom ?? 100,
    left: bounds.left ?? 0,
    toJSON: () => undefined,
  } as DOMRect)
  return element
}

describe('usePaneDragDrop', () => {
  it('waits for the drag threshold, highlights valid target, emits drop, and cleans up', () => {
    const root = document.createElement('div')
    root.append(pane('pane-1', { left: 0, right: 100, top: 0, bottom: 100 }))
    root.append(pane('pane-2', { left: 150, right: 250, top: 0, bottom: 100 }))
    const drops: Array<{ assignment: PaneAssignment; sourcePaneId: string; targetPaneId: string }> = []
    const bridge = usePaneDragDrop({
      rootRef: ref(root),
      isPaneId: (value): value is 'pane-1' | 'pane-2' => value === 'pane-1' || value === 'pane-2',
      isPaneVisible: (paneId) => paneId === 'pane-1' || paneId === 'pane-2',
      onDrop: (payload) => drops.push(payload),
    })
    const assignment: PaneAssignment = { kind: 'ssh', sessionId: 'term-1' }

    bridge.startPaneDrag('pane-1', assignment, pointer('pointerdown', { x: 10, y: 10 }))
    window.dispatchEvent(pointer('pointermove', { x: 12, y: 12 }))
    expect(bridge.paneDropTargetId.value).toBeNull()

    window.dispatchEvent(pointer('pointermove', { x: 180, y: 20 }))
    expect(bridge.paneDropTargetId.value).toBe('pane-2')

    window.dispatchEvent(pointer('pointerup', { x: 180, y: 20 }))
    expect(drops).toEqual([{ assignment, sourcePaneId: 'pane-1', targetPaneId: 'pane-2' }])
    expect(bridge.paneDropTargetId.value).toBeNull()
    expect(document.body.classList.contains('workspace-tab-dragging-active')).toBe(false)
  })

  it('does not start pane drag from buttons', () => {
    const button = document.createElement('button')
    const bridge = usePaneDragDrop({
      rootRef: ref(document.createElement('div')),
      isPaneId: (value): value is 'pane-1' => value === 'pane-1',
      isPaneVisible: () => true,
      onDrop: () => undefined,
    })

    bridge.startPaneDrag('pane-1', { kind: 'ssh', sessionId: 'term-1' }, pointer('pointerdown', { target: button }))
    window.dispatchEvent(pointer('pointermove', { x: 100, y: 100 }))

    expect(bridge.paneDropTargetId.value).toBeNull()
  })
})
