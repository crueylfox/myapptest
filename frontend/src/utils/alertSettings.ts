import type { AlertSettings, NativeAlertNotificationSettings, ThresholdAlertRuleSettings } from '../types'

export const defaultAlertSettings = (): AlertSettings => ({
  enabled: true,
  notifyRecovery: true,
  historyLimit: 500,
  offline: {
    enabled: true,
    graceSeconds: 20,
  },
  cpu: {
    enabled: true,
    threshold: 90,
    durationSeconds: 60,
  },
  memory: {
    enabled: true,
    threshold: 90,
    durationSeconds: 60,
  },
  rootDisk: {
    enabled: true,
    threshold: 90,
    durationSeconds: 60,
  },
  latency: {
    enabled: false,
    threshold: 500,
    durationSeconds: 60,
  },
  nativeNotifications: defaultNativeAlertNotificationSettings(),
})

export function normalizeAlertSettings(value: AlertSettings | null | undefined): AlertSettings {
  const defaults = defaultAlertSettings()
  if (!value) return defaults
  return {
    enabled: value.enabled ?? defaults.enabled,
    notifyRecovery: value.notifyRecovery ?? defaults.notifyRecovery,
    historyLimit: clampInt(value.historyLimit, 50, 5000, defaults.historyLimit),
    offline: {
      enabled: value.offline?.enabled ?? defaults.offline.enabled,
      graceSeconds: clampInt(value.offline?.graceSeconds, 5, 300, defaults.offline.graceSeconds),
    },
    cpu: normalizeThresholdRule(value.cpu, defaults.cpu, 50, 100),
    memory: normalizeThresholdRule(value.memory, defaults.memory, 50, 100),
    rootDisk: normalizeThresholdRule(value.rootDisk, defaults.rootDisk, 50, 100),
    latency: normalizeThresholdRule(value.latency, defaults.latency, 50, 5000),
    nativeNotifications: normalizeNativeAlertNotificationSettings(value.nativeNotifications),
  }
}

export function cloneAlertSettings(value: AlertSettings | null | undefined): AlertSettings {
  return normalizeAlertSettings(value)
}

function normalizeThresholdRule(
  value: ThresholdAlertRuleSettings | null | undefined,
  defaults: ThresholdAlertRuleSettings,
  min: number,
  max: number,
): ThresholdAlertRuleSettings {
  return {
    enabled: value?.enabled ?? defaults.enabled,
    threshold: clampNumber(value?.threshold, min, max, defaults.threshold),
    durationSeconds: clampInt(value?.durationSeconds, 15, 600, defaults.durationSeconds),
  }
}

function clampNumber(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function clampInt(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function defaultNativeAlertNotificationSettings(): NativeAlertNotificationSettings {
  return { enabled: false }
}

export function normalizeNativeAlertNotificationSettings(
  value: NativeAlertNotificationSettings | null | undefined,
): NativeAlertNotificationSettings {
  const defaults = defaultNativeAlertNotificationSettings()
  return {
    enabled: value?.enabled ?? defaults.enabled,
  }
}
