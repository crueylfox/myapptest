import { ref } from 'vue'

type AppWindowTarget = {
  addEventListener: (name: string, listener: EventListener) => void
  removeEventListener: (name: string, listener: EventListener) => void
}

type TimerId = ReturnType<typeof window.setTimeout>
type IntervalId = ReturnType<typeof window.setInterval>

export interface AppEventSubscriptionsOptions {
  windowTarget?: AppWindowTarget
  setTimeout?: (handler: () => void, timeout: number) => TimerId
  clearTimeout?: (id: TimerId) => void
  setInterval?: (handler: () => void, timeout: number) => IntervalId
  clearInterval?: (id: IntervalId) => void
  installUiDragSelectionGuard: () => (() => void) | null | undefined
  installGlobalShortcuts: () => void
  uninstallGlobalShortcuts: () => void
  subscribeStores: Array<() => void>
  unsubscribeStores: Array<() => void>
  persistWindowState: () => Promise<unknown>
  logPersistWindowStateError: (reason: unknown) => void
  tickAlerts: () => void
  disposeAlerts: () => void
  stopThemeSync: () => void
  disposeToast: () => void
}

export function useAppEventSubscriptions(options: AppEventSubscriptionsOptions) {
  const target = options.windowTarget ?? window
  const setTimer = options.setTimeout ?? window.setTimeout.bind(window)
  const clearTimer = options.clearTimeout ?? window.clearTimeout.bind(window)
  const setRepeatingTimer = options.setInterval ?? window.setInterval.bind(window)
  const clearRepeatingTimer = options.clearInterval ?? window.clearInterval.bind(window)
  const started = ref(false)
  const disposersCount = ref(0)
  let persistTimer: TimerId | null = null
  let alertTickTimer: IntervalId | null = null
  let disposeUiDragSelectionGuard: (() => void) | null = null
  let finalDisposed = false

  const schedulePersistWindowState = () => {
    if (persistTimer !== null) clearTimer(persistTimer)
    persistTimer = setTimer(() => {
      persistTimer = null
      void options.persistWindowState().catch(options.logPersistWindowStateError)
    }, 500)
  }

  const flushPersistWindowState = () => {
    if (persistTimer !== null) {
      clearTimer(persistTimer)
      persistTimer = null
    }
    void options.persistWindowState().catch(() => undefined)
  }

  function refreshDisposerCount() {
    disposersCount.value = (started.value ? 2 + options.unsubscribeStores.length + 2 : 0) +
      (disposeUiDragSelectionGuard ? 1 : 0) +
      (alertTickTimer === null ? 0 : 1)
  }

  function start() {
    if (started.value) return
    disposeUiDragSelectionGuard = options.installUiDragSelectionGuard() ?? null
    options.installGlobalShortcuts()
    target.addEventListener('resize', schedulePersistWindowState)
    target.addEventListener('beforeunload', flushPersistWindowState)
    for (const subscribe of options.subscribeStores) subscribe()
    started.value = true
    refreshDisposerCount()
  }

  function startAlertTick() {
    if (alertTickTimer !== null) return
    alertTickTimer = setRepeatingTimer(options.tickAlerts, 1000)
    refreshDisposerCount()
  }

  function stop() {
    if (started.value) {
      disposeUiDragSelectionGuard?.()
      disposeUiDragSelectionGuard = null
      options.uninstallGlobalShortcuts()
      target.removeEventListener('resize', schedulePersistWindowState)
      target.removeEventListener('beforeunload', flushPersistWindowState)
      flushPersistWindowState()
      for (const unsubscribe of options.unsubscribeStores) unsubscribe()
      started.value = false
    }
    if (alertTickTimer !== null) {
      clearRepeatingTimer(alertTickTimer)
      alertTickTimer = null
    }
    if (!finalDisposed) {
      options.disposeAlerts()
      options.stopThemeSync()
      options.disposeToast()
      finalDisposed = true
    }
    refreshDisposerCount()
  }

  return {
    disposersCount,
    schedulePersistWindowState,
    flushPersistWindowState,
    start,
    startAlertTick,
    stop,
  }
}
