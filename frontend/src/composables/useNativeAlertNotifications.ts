import { readonly, ref, type ComputedRef, type Ref } from 'vue'
import type { AlertSettings, NativeNotificationStatus } from '../types'
import {
  buildNativeAlertNotification,
  nativeAlertNotificationKey,
  shouldSendNativeAlertNotification,
  type NativeAlertNotification,
  type NativeNotificationPayload,
} from '../utils/nativeAlertNotifications'

type ToastType = 'success' | 'error' | 'info'
type NotificationSendOptions = NativeNotificationPayload

export interface NativeNotificationRuntimeAdapter {
  initialize: () => Promise<void>
  cleanup: () => Promise<void>
  isAvailable: () => Promise<boolean>
  requestAuthorization: () => Promise<boolean>
  send: (options: NotificationSendOptions) => Promise<void>
}

export type NativeNotificationResult =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'unavailable' | 'failed' }

export interface UseNativeAlertNotificationsOptions {
  settings: Ref<AlertSettings> | ComputedRef<AlertSettings>
  runtime: NativeNotificationRuntimeAdapter
  notify: (message: string, type: ToastType) => void
  platform?: Ref<string> | ComputedRef<string>
}

export function useNativeAlertNotifications(options: UseNativeAlertNotificationsOptions) {
  const status = ref<NativeNotificationStatus>({
    initialized: false,
    available: false,
    message: '默认关闭，开启后会检查系统通知可用性。',
  })
  const deliveredKeys = new Set<string>()
  let initializePromise: Promise<boolean> | null = null
  let unavailableNotified = false
  let failureNotified = false

  async function initialize() {
    await ensureInitialized()
  }

  async function cleanup() {
    try {
      await options.runtime.cleanup()
    } catch {
      // Cleanup should never affect app shutdown or terminal/SFTP runtimes.
    }
  }

  async function handleAlertNotifications(notifications: NativeAlertNotification[]) {
    if (!options.settings.value.nativeNotifications.enabled || notifications.length === 0) return
    const available = await ensureInitialized()
    if (!available) {
      notifyUnavailableOnce()
      return
    }
    for (const notification of notifications) {
      const key = nativeAlertNotificationKey(notification)
      if (deliveredKeys.has(key)) continue
      if (!shouldSendNativeAlertNotification(options.settings.value.nativeNotifications, notification)) continue
      const payload = buildNativeAlertNotification(notification)
      deliveredKeys.add(key)
      try {
        await options.runtime.send(payload)
      } catch {
        notifyFailureOnce()
      }
    }
  }

  async function sendTestNotification(): Promise<NativeNotificationResult> {
    if (!options.settings.value.nativeNotifications.enabled) {
      return { ok: false, reason: 'disabled' }
    }
    const available = await ensureInitialized()
    if (!available) {
      notifyUnavailableOnce()
      return { ok: false, reason: 'unavailable' }
    }
    try {
      await options.runtime.send({
        id: 'serverpilot-native-notification-test',
        title: 'ServerPilot 测试通知',
        body: nativeNotificationEnabledBody(platformName()),
      })
      options.notify(nativeNotificationSentMessage(platformName()), 'success')
      return { ok: true }
    } catch {
      notifyFailureOnce()
      return { ok: false, reason: 'failed' }
    }
  }

  async function ensureInitialized() {
    if (status.value.initialized) return status.value.available
    if (!initializePromise) {
      initializePromise = initializeRuntime()
    }
    return initializePromise
  }

  async function initializeRuntime() {
    if (platformName() === 'darwin') {
      status.value = {
        initialized: true,
        available: false,
        message: 'macOS 系统通知暂不可用。',
      }
      return false
    }
    try {
      await options.runtime.initialize()
      const available = await options.runtime.isAvailable()
      const authorized = available ? await options.runtime.requestAuthorization().catch(() => true) : false
      const ready = available && authorized
      status.value = {
        initialized: true,
        available: ready,
        message: ready ? nativeNotificationAvailableMessage(platformName()) : nativeNotificationUnavailableMessage(platformName()),
      }
      return ready
    } catch {
      status.value = {
        initialized: true,
        available: false,
        message: nativeNotificationInitFailedMessage(platformName()),
      }
      return false
    }
  }

  function notifyUnavailableOnce() {
    if (unavailableNotified) return
    unavailableNotified = true
    options.notify(nativeNotificationUnavailableMessage(platformName()).replace(/。$/, ''), 'info')
  }

  function notifyFailureOnce() {
    if (failureNotified) return
    failureNotified = true
    options.notify(nativeNotificationFailedMessage(platformName()), 'error')
  }

  function platformName() {
    return options.platform?.value ?? 'windows'
  }

  return {
    settings: options.settings,
    status: readonly(status),
    initialize,
    cleanup,
    handleAlertNotifications,
    sendTestNotification,
  }
}

function nativeNotificationAvailableMessage(platform: string) {
  return platform === 'darwin' ? 'macOS 系统通知可用。' : 'Windows 原生通知可用。'
}

function nativeNotificationUnavailableMessage(platform: string) {
  return platform === 'darwin' ? 'macOS 系统通知暂不可用。' : 'Windows 原生通知不可用。'
}

function nativeNotificationInitFailedMessage(platform: string) {
  return platform === 'darwin' ? 'macOS 系统通知初始化失败。' : 'Windows 原生通知初始化失败。'
}

function nativeNotificationEnabledBody(platform: string) {
  return platform === 'darwin' ? 'macOS 系统通知已启用。' : 'Windows 原生通知已启用。'
}

function nativeNotificationSentMessage(platform: string) {
  return platform === 'darwin' ? 'macOS 系统通知测试已发送' : 'Windows 原生通知测试已发送'
}

function nativeNotificationFailedMessage(platform: string) {
  return platform === 'darwin' ? 'macOS 系统通知发送失败' : 'Windows 原生通知发送失败'
}
