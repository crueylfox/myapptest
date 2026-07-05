import type { AppSettings } from './types'

let initialSettings: AppSettings | null = null

export function setInitialSettings(value: AppSettings) {
  initialSettings = value
}

export function getInitialSettings(): AppSettings | null {
  return initialSettings
}
