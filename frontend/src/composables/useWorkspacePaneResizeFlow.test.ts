// @vitest-environment jsdom

import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspacePaneResizeFlow } from './useWorkspacePaneResizeFlow'

const source = String(useWorkspacePaneResizeFlow)

function pointer(type: string, values: { x?: number; y?: number; target?: HTMLElement } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: values.x ?? 0,
    clientY: values.y ?? 0,
  }) as PointerEvent
  if (values.target) Object.defineProperty(event, 'currentTarget', { value: values.target })
  Object.defineProperty(event, 'pointerId', { value: 9 })
  return event
}

function rootWithBounds(bounds: Partial<DOMRect>) {
  const root = document.createElement('div')
  root.getBoundingClientRect = () => ({
    x: bounds.x ?? bounds.left ?? 0,
    y: bounds.y ?? bounds.top ?? 0,
    width: bounds.width ?? 1000,
    height: bounds.height ?? 800,
    top: bounds.top ?? 0,
    right: bounds.right ?? 1000,
    bottom: bounds.bottom ?? 800,
    left: bounds.left ?? 0,
    toJSON: () => undefined,
  } as DOMRect)
  return root
}

describe('useWorkspacePaneResizeFlow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resizes the monitor sidebar with the existing clamp and persists on stop', () => {
    const sidebarWidth = ref(300)
    const sftpHeight = ref(240)
    const afterStop: Array<() => void> = []
    const target = document.createElement('div')
    target.setPointerCapture = vi.fn()
    const persistSidebarWidth = vi.fn()
    const bumpLayout = vi.fn()
    const flow = useWorkspacePaneResizeFlow({
      rootRef: ref(rootWithBounds({ left: 100, width: 1000, bottom: 900, height: 700 })),
      sidebarWidth,
      sftpHeight,
      persistSidebarWidth,
      persistSftpHeight: vi.fn(),
      bumpLayout,
      scheduleAfterStop: (callback) => afterStop.push(callback),
    })

    flow.startDrag('sidebar', pointer('pointerdown', { x: 250, target }))
    expect(flow.dragMode.value).toBe('sidebar')
    expect(target.setPointerCapture).toHaveBeenCalledWith(9)

    window.dispatchEvent(pointer('pointermove', { x: 900 }))
    expect(sidebarWidth.value).toBe(350)
    expect(bumpLayout).toHaveBeenCalledTimes(1)

    window.dispatchEvent(pointer('pointerup', { x: 900 }))
    expect(flow.dragMode.value).toBeNull()
    expect(persistSidebarWidth).toHaveBeenCalledWith(350)

    expect(afterStop).toHaveLength(1)
    afterStop[0]()
    expect(bumpLayout).toHaveBeenCalledTimes(2)
  })

  it('resizes the SFTP panel with the existing clamp and removes listeners on dispose', () => {
    const sidebarWidth = ref(300)
    const sftpHeight = ref(240)
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const persistSftpHeight = vi.fn()
    const flow = useWorkspacePaneResizeFlow({
      rootRef: ref(rootWithBounds({ bottom: 1000, height: 600 })),
      sidebarWidth,
      sftpHeight,
      persistSidebarWidth: vi.fn(),
      persistSftpHeight,
      bumpLayout: vi.fn(),
      scheduleAfterStop: (callback) => callback(),
    })

    flow.startDrag('sftp', pointer('pointerdown', { y: 600 }))
    flow.startDrag('sftp', pointer('pointerdown', { y: 620 }))
    window.dispatchEvent(pointer('pointermove', { y: 100 }))

    expect(sftpHeight.value).toBe(330)
    window.dispatchEvent(pointer('pointerup', { y: 100 }))
    expect(persistSftpHeight).toHaveBeenCalledWith(330)
    expect(addSpy.mock.calls.filter((call) => call[0] === 'pointermove')).toHaveLength(2)
    expect(removeSpy.mock.calls.filter((call) => call[0] === 'pointermove').length).toBeGreaterThanOrEqual(2)

    flow.dispose()
    expect(flow.dragMode.value).toBeNull()
  })

  it('cancels an active drag without persisting a size', () => {
    const flow = useWorkspacePaneResizeFlow({
      rootRef: ref(rootWithBounds({})),
      sidebarWidth: ref(300),
      sftpHeight: ref(240),
      persistSidebarWidth: vi.fn(),
      persistSftpHeight: vi.fn(),
      bumpLayout: vi.fn(),
      scheduleAfterStop: (callback) => callback(),
    })

    flow.startDrag('sidebar', pointer('pointerdown'))
    flow.cancelDrag()

    expect(flow.dragMode.value).toBeNull()
  })

  it('does not own terminal runtime, backend APIs, or persistence state', () => {
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('WriteTerminal')
    expect(source).not.toContain('DisconnectServer')
    expect(source).not.toContain('xterm')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
  })
})
