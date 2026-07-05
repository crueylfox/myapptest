// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToast } from './useToast'

describe('useToast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('removes success messages after two seconds', () => {
    vi.useFakeTimers()
    const controller = useToast()
    controller.show('saved', 'success')
    vi.advanceTimersByTime(1999)
    expect(controller.toast.value?.message).toBe('saved')
    vi.advanceTimersByTime(1)
    expect(controller.toast.value).toBeNull()
  })

  it('can be closed manually', () => {
    vi.useFakeTimers()
    const controller = useToast()
    controller.show('failed', 'error')
    controller.close()
    expect(controller.toast.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces the current message instead of stacking messages', () => {
    vi.useFakeTimers()
    const controller = useToast()
    controller.show('first', 'success')
    const firstID = controller.toast.value?.id
    controller.show('second', 'success')
    expect(controller.toast.value).toMatchObject({ message: 'second', type: 'success' })
    expect(controller.toast.value?.id).not.toBe(firstID)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('keeps structured technical detail separate from the user message', () => {
    vi.useFakeTimers()
    const controller = useToast()
    controller.show('连接被拒绝', 'error', 'connectex: target machine refused it', 'CONNECTION_REFUSED')
    expect(controller.toast.value).toMatchObject({
      message: '连接被拒绝',
      detail: 'connectex: target machine refused it',
      code: 'CONNECTION_REFUSED',
    })
  })
})
