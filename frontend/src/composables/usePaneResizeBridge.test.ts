// @vitest-environment jsdom

import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePaneResizeBridge } from './usePaneResizeBridge'

function pointer(type: string, values: { x?: number; y?: number; button?: number } = {}) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: values.button ?? 0,
    clientX: values.x ?? 0,
    clientY: values.y ?? 0,
  }) as PointerEvent
}

describe('usePaneResizeBridge', () => {
  afterEach(() => {
    document.body.className = ''
  })

  it('emits clamped ratio changes and commit while cleaning body classes and listeners', () => {
    const workspace = document.createElement('div')
    workspace.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
      top: 0,
      right: 1000,
      bottom: 800,
      left: 0,
      toJSON: () => undefined,
    } as DOMRect))
    const changes: Array<{ axis: string; ratio: number }> = []
    const commits: Array<{ axis: string; ratio: number }> = []
    const bridge = usePaneResizeBridge({
      workspaceRef: ref(workspace),
      columnRatio: ref(0.5),
      rowRatio: ref(0.5),
      onRatioChange: (axis, ratio) => changes.push({ axis, ratio }),
      onRatioCommit: (axis, ratio) => commits.push({ axis, ratio }),
      onLayoutBump: vi.fn(),
    })

    bridge.startSplitResize('column', pointer('pointerdown', { x: 500 }))
    expect(document.body.classList.contains('workspace-pane-resizing-column')).toBe(true)

    window.dispatchEvent(pointer('pointermove', { x: 900 }))
    window.dispatchEvent(pointer('pointerup', { x: 900 }))

    expect(changes.at(-1)).toEqual({ axis: 'column', ratio: 0.75 })
    expect(commits.at(-1)).toEqual({ axis: 'column', ratio: 0.75 })
    expect(document.body.classList.contains('workspace-pane-resizing-column')).toBe(false)
  })
})
