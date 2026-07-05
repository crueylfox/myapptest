import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertEvent, AlertSettings } from '../types'
import { defaultAlertSettings } from '../utils/alertSettings'
import { useNativeAlertNotifications, type NativeNotificationRuntimeAdapter } from './useNativeAlertNotifications'

function alertSettings(enabled: boolean): AlertSettings {
  return {
    ...defaultAlertSettings(),
    nativeNotifications: { enabled },
  }
}

function alertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    eventID: 'alert-1',
    serverID: 7,
    serverName: 'debian-prod',
    ruleType: 'cpu_high',
    severity: 'warning',
    state: 'firing',
    title: 'CPU 使用率过高',
    message: '服务器 CPU 已持续达到 95%。',
    currentValue: 95,
    threshold: 90,
    unit: '%',
    startedAt: '2026-07-03T01:00:00.000Z',
    read: false,
    muted: false,
    source: 'monitor',
    ...overrides,
  }
}

function fakeRuntime(overrides: Partial<NativeNotificationRuntimeAdapter> = {}) {
  const adapter: NativeNotificationRuntimeAdapter = {
    initialize: vi.fn(async () => undefined),
    isAvailable: vi.fn(async () => true),
    requestAuthorization: vi.fn(async () => true),
    send: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
    ...overrides,
  }
  return adapter
}

describe('useNativeAlertNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes the runtime without sending historical alerts', async () => {
    const runtime = fakeRuntime()
    const controller = useNativeAlertNotifications({
      settings: ref(alertSettings(true)),
      runtime,
      notify: vi.fn(),
    })

    await controller.initialize()

    expect(runtime.initialize).toHaveBeenCalledTimes(1)
    expect(runtime.isAvailable).toHaveBeenCalledTimes(1)
    expect(runtime.send).not.toHaveBeenCalled()
    expect(controller.status.value.available).toBe(true)
  })

  it('sends one native notification for a new enabled alert and dedupes repeated events', async () => {
    const runtime = fakeRuntime()
    const controller = useNativeAlertNotifications({
      settings: ref(alertSettings(true)),
      runtime,
      notify: vi.fn(),
    })

    await controller.handleAlertNotifications([{ event: alertEvent(), kind: 'firing' }])
    await controller.handleAlertNotifications([{ event: alertEvent(), kind: 'firing' }])

    expect(runtime.send).toHaveBeenCalledTimes(1)
    expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({
      id: 'alert-1:firing',
      title: '警告：CPU 使用率过高',
    }))
  })

  it('does not send when settings are disabled, muted, or already read', async () => {
    const runtime = fakeRuntime()
    const settings = ref(alertSettings(false))
    const controller = useNativeAlertNotifications({
      settings,
      runtime,
      notify: vi.fn(),
    })

    await controller.handleAlertNotifications([{ event: alertEvent(), kind: 'firing' }])
    settings.value = alertSettings(true)
    await controller.handleAlertNotifications([{ event: alertEvent({ eventID: 'alert-2', muted: true }), kind: 'firing' }])
    await controller.handleAlertNotifications([{ event: alertEvent({ eventID: 'alert-3', read: true }), kind: 'firing' }])

    expect(runtime.send).not.toHaveBeenCalled()
  })

  it('sends recovery notifications when the existing alert model emits recovery events', async () => {
    const runtime = fakeRuntime()
    const controller = useNativeAlertNotifications({
      settings: ref(alertSettings(true)),
      runtime,
      notify: vi.fn(),
    })

    await controller.handleAlertNotifications([{
      event: alertEvent({ state: 'resolved', title: 'CPU 使用率已恢复', message: '服务器 CPU 已恢复。' }),
      kind: 'resolved',
    }])

    expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({
      id: 'alert-1:resolved',
      title: '已恢复：CPU 使用率已恢复',
    }))
  })

  it('reports unavailable or failed native notification attempts without throwing', async () => {
    const notify = vi.fn()
    const unavailable = useNativeAlertNotifications({
      settings: ref(alertSettings(true)),
      runtime: fakeRuntime({ isAvailable: vi.fn(async () => false) }),
      notify,
    })

    await expect(unavailable.sendTestNotification()).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(notify).toHaveBeenCalledWith('Windows 原生通知不可用', 'info')

    const failed = useNativeAlertNotifications({
      settings: ref(alertSettings(true)),
      runtime: fakeRuntime({ send: vi.fn(async () => { throw new Error('send failed') }) }),
      notify,
    })
    await expect(failed.handleAlertNotifications([{ event: alertEvent(), kind: 'firing' }])).resolves.toBeUndefined()
    expect(notify).toHaveBeenCalledWith('Windows 原生通知发送失败', 'error')
  })

  it('sends a safe test notification only when enabled', async () => {
    const runtime = fakeRuntime()
    const settings = ref(alertSettings(false))
    const controller = useNativeAlertNotifications({
      settings,
      runtime,
      notify: vi.fn(),
    })

    await expect(controller.sendTestNotification()).resolves.toEqual({ ok: false, reason: 'disabled' })
    settings.value = alertSettings(true)
    await expect(controller.sendTestNotification()).resolves.toEqual({ ok: true })

    expect(runtime.send).toHaveBeenCalledTimes(1)
    expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({
      id: 'serverpilot-native-notification-test',
      title: 'ServerPilot 测试通知',
    }))
  })
})
