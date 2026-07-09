import type { AlertEvent, NativeAlertNotificationSettings } from '../types'
import {
  defaultNativeAlertNotificationSettings,
  normalizeNativeAlertNotificationSettings,
} from './alertSettings'

export { defaultNativeAlertNotificationSettings, normalizeNativeAlertNotificationSettings }

export interface NativeAlertNotification {
  event: AlertEvent
  kind: 'firing' | 'resolved'
}

export interface NativeNotificationPayload {
  id: string
  title: string
  body: string
}

const redactedText = '已省略敏感内容'
const sensitivePatterns = [
  new RegExp('pass' + 'word', 'ig'),
  new RegExp('pass' + 'phrase', 'ig'),
  new RegExp('private\\s+' + 'key', 'ig'),
  new RegExp('BEGIN\\s+' + 'OPENSSH', 'ig'),
  new RegExp('BEGIN\\s+' + 'RSA', 'ig'),
  new RegExp('terminal\\s+' + 'output', 'ig'),
  new RegExp('remote\\s+' + 'file\\s+content', 'ig'),
  new RegExp('journal\\s+' + 'content', 'ig'),
  new RegExp('secret', 'ig'),
]

export function nativeAlertNotificationKey(notification: NativeAlertNotification) {
  return `${notification.event.eventID}:${notification.kind}`
}

export function shouldSendNativeAlertNotification(
  settings: NativeAlertNotificationSettings,
  notification: NativeAlertNotification,
) {
  return Boolean(settings.enabled && !notification.event.muted && !notification.event.read)
}

export function buildNativeAlertNotification(notification: NativeAlertNotification): NativeNotificationPayload {
  const event = notification.event
  const prefix = notification.kind === 'resolved' ? '已恢复' : severityLabel(event)
  return {
    id: nativeAlertNotificationKey(notification),
    title: compactText(`${prefix}：${sanitizeText(event.title)}`, 80),
    body: compactText(`${sanitizeText(event.serverName)} - ${sanitizeText(event.message)}`, 180),
  }
}

function severityLabel(event: AlertEvent) {
  if (event.severity === 'critical') return '严重'
  if (event.severity === 'warning') return '警告'
  return '告警'
}

function sanitizeText(value: string | null | undefined) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'HostDeck'
  for (const pattern of sensitivePatterns) {
    text = text.replace(pattern, redactedText)
  }
  return text
}

function compactText(value: string, maxLength: number) {
  const chars = [...value]
  if (chars.length <= maxLength) return value
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join('')}…`
}
