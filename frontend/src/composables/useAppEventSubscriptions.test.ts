import { describe, expect, it, vi } from 'vitest'
import { useAppEventSubscriptions } from './useAppEventSubscriptions'

function createTarget() {
  const listeners = new Map<string, EventListener>()
  return {
    listeners,
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      listeners.set(name, listener)
    }),
    removeEventListener: vi.fn((name: string, listener: EventListener) => {
      if (listeners.get(name) === listener) listeners.delete(name)
    }),
  }
}

function createFlow(overrides: Partial<Parameters<typeof useAppEventSubscriptions>[0]> = {}) {
  vi.useFakeTimers()
  const target = createTarget()
  const deps: Parameters<typeof useAppEventSubscriptions>[0] = {
    windowTarget: target,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    installUiDragSelectionGuard: vi.fn(() => vi.fn()),
    installGlobalShortcuts: vi.fn(),
    uninstallGlobalShortcuts: vi.fn(),
    subscribeStores: [
      vi.fn(),
      vi.fn(),
    ],
    unsubscribeStores: [
      vi.fn(),
      vi.fn(),
    ],
    persistWindowState: vi.fn(async () => undefined),
    logPersistWindowStateError: vi.fn(),
    tickAlerts: vi.fn(),
    disposeAlerts: vi.fn(),
    stopThemeSync: vi.fn(),
    disposeToast: vi.fn(),
    ...overrides,
  }
  return {
    target,
    deps,
    flow: useAppEventSubscriptions(deps),
  }
}

describe('useAppEventSubscriptions', () => {
  it('registers window listeners and store subscriptions once', () => {
    const ctx = createFlow()

    ctx.flow.start()
    ctx.flow.start()

    expect(ctx.deps.installUiDragSelectionGuard).toHaveBeenCalledTimes(1)
    expect(ctx.deps.installGlobalShortcuts).toHaveBeenCalledTimes(1)
    expect(ctx.target.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(ctx.target.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    expect(ctx.deps.subscribeStores[0]).toHaveBeenCalledTimes(1)
    expect(ctx.deps.subscribeStores[1]).toHaveBeenCalledTimes(1)
    expect(ctx.flow.disposersCount.value).toBeGreaterThan(0)
  })

  it('debounces resize persistence and flushes before unload', async () => {
    const ctx = createFlow()
    ctx.flow.start()

    ctx.target.listeners.get('resize')?.(new Event('resize'))
    vi.advanceTimersByTime(499)
    expect(ctx.deps.persistWindowState).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(ctx.deps.persistWindowState).toHaveBeenCalledTimes(1)

    ctx.target.listeners.get('beforeunload')?.(new Event('beforeunload'))
    await Promise.resolve()
    expect(ctx.deps.persistWindowState).toHaveBeenCalledTimes(2)
  })

  it('starts alert ticking after startup and disposes all listeners', () => {
    const cleanupSelection = vi.fn()
    const ctx = createFlow({ installUiDragSelectionGuard: vi.fn(() => cleanupSelection) })
    ctx.flow.start()
    ctx.flow.startAlertTick()

    vi.advanceTimersByTime(1000)
    expect(ctx.deps.tickAlerts).toHaveBeenCalledTimes(1)

    ctx.flow.stop()
    ctx.flow.stop()
    vi.advanceTimersByTime(1000)

    expect(ctx.target.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(ctx.target.removeEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    expect(cleanupSelection).toHaveBeenCalledTimes(1)
    expect(ctx.deps.uninstallGlobalShortcuts).toHaveBeenCalledTimes(1)
    expect(ctx.deps.unsubscribeStores[0]).toHaveBeenCalledTimes(1)
    expect(ctx.deps.unsubscribeStores[1]).toHaveBeenCalledTimes(1)
    expect(ctx.deps.disposeAlerts).toHaveBeenCalledTimes(1)
    expect(ctx.deps.stopThemeSync).toHaveBeenCalledTimes(1)
    expect(ctx.deps.disposeToast).toHaveBeenCalledTimes(1)
    expect(ctx.deps.tickAlerts).toHaveBeenCalledTimes(1)
    expect(ctx.flow.disposersCount.value).toBe(0)
  })
})
