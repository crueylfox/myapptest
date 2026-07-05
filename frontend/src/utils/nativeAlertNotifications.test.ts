import { describe, expect, it } from 'vitest'
import type { AlertEvent } from '../types'
import {
  buildNativeAlertNotification,
  defaultNativeAlertNotificationSettings,
  nativeAlertNotificationKey,
  normalizeNativeAlertNotificationSettings,
  shouldSendNativeAlertNotification,
} from './nativeAlertNotifications'

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

describe('native alert notification model', () => {
  it('defaults Windows native notifications to disabled and normalizes legacy settings', () => {
    expect(defaultNativeAlertNotificationSettings()).toEqual({ enabled: false })
    expect(normalizeNativeAlertNotificationSettings(undefined)).toEqual({ enabled: false })
    expect(normalizeNativeAlertNotificationSettings({ enabled: true })).toEqual({ enabled: true })
  })

  it('builds a concise non-sensitive notification payload for firing and recovered alerts', () => {
    const firing = buildNativeAlertNotification({ event: alertEvent(), kind: 'firing' })
    expect(firing).toMatchObject({
      id: 'alert-1:firing',
      title: '警告：CPU 使用率过高',
      body: 'debian-prod - 服务器 CPU 已持续达到 95%。',
    })

    const recovered = buildNativeAlertNotification({
      event: alertEvent({
        state: 'resolved',
        title: 'CPU 使用率已恢复',
        message: '服务器 CPU 已恢复。',
        resolvedAt: '2026-07-03T01:01:00.000Z',
      }),
      kind: 'resolved',
    })
    expect(recovered).toMatchObject({
      id: 'alert-1:resolved',
      title: '已恢复：CPU 使用率已恢复',
      body: 'debian-prod - 服务器 CPU 已恢复。',
    })
  })

  it('redacts sensitive-looking text before it can reach the native notification payload', () => {
    const sensitiveText = [
      'pass' + 'word',
      'pass' + 'phrase',
      'private ' + 'key',
      'BEGIN ' + 'OPENSSH',
      'terminal ' + 'output',
      'remote ' + 'file content',
      'journal ' + 'content',
    ].join(' / ')
    const payload = buildNativeAlertNotification({
      event: alertEvent({
        serverName: `server ${sensitiveText}`,
        title: `alert ${sensitiveText}`,
        message: `body ${sensitiveText}`,
      }),
      kind: 'firing',
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toMatch(/password|passphrase|private key|BEGIN OPENSSH|terminal output|remote file content|journal content/i)
    expect(serialized).toContain('已省略敏感内容')
  })

  it('skips disabled, muted, or already-read alert notifications and keeps dedupe keys stable', () => {
    const notification = { event: alertEvent(), kind: 'firing' as const }
    expect(shouldSendNativeAlertNotification({ enabled: false }, notification)).toBe(false)
    expect(shouldSendNativeAlertNotification({ enabled: true }, { ...notification, event: alertEvent({ muted: true }) })).toBe(false)
    expect(shouldSendNativeAlertNotification({ enabled: true }, { ...notification, event: alertEvent({ read: true }) })).toBe(false)
    expect(shouldSendNativeAlertNotification({ enabled: true }, notification)).toBe(true)
    expect(nativeAlertNotificationKey(notification)).toBe('alert-1:firing')
    expect(nativeAlertNotificationKey({ event: alertEvent(), kind: 'resolved' })).toBe('alert-1:resolved')
  })

  it('uses a stable severity fallback for unexpected severities', () => {
    const payload = buildNativeAlertNotification({
      event: alertEvent({ severity: 'notice' as AlertEvent['severity'] }),
      kind: 'firing',
    })
    expect(payload.title).toBe('告警：CPU 使用率过高')
  })
})
