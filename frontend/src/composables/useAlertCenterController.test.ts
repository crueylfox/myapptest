// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAlertCenterController } from './useAlertCenterController'
import type { AlertEvent } from '../types'

const alertEvent = (values: Partial<AlertEvent> = {}): AlertEvent => ({
  eventID: 'alert-1',
  serverID: 7,
  serverName: 'server-7',
  ruleType: 'cpu_high',
  severity: 'warning',
  state: 'firing',
  title: 'CPU high',
  message: 'threshold crossed',
  currentValue: 95,
  threshold: 90,
  unit: '%',
  startedAt: '2026-07-01T00:00:00Z',
  read: false,
  muted: false,
  source: 'monitor',
  ...values,
})

describe('useAlertCenterController', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('opens and closes the alert center without touching alert history actions', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = useAlertCenterController()

    controller.open()
    expect(controller.isOpen.value).toBe(true)

    controller.close()
    expect(controller.isOpen.value).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('closes on outside or Escape intent and ignores inside interaction', () => {
    const controller = useAlertCenterController()
    controller.open()

    controller.ignoreInsideInteraction()
    expect(controller.isOpen.value).toBe(true)

    controller.closeFromOutside()
    expect(controller.isOpen.value).toBe(false)

    controller.open()
    controller.closeFromEscape()
    expect(controller.isOpen.value).toBe(false)
  })

  it('returns monitor detail intent with the clicked alert server id', () => {
    const controller = useAlertCenterController()
    controller.open()

    const intent = controller.viewAlert(alertEvent({ eventID: 'alert-7', serverID: 7 }))

    expect(intent).toEqual({ type: 'open-monitor-detail', eventID: 'alert-7', serverID: 7 })
    expect(controller.isOpen.value).toBe(true)
  })

  it('closes and returns no monitor intent for app-level alerts', () => {
    const controller = useAlertCenterController()
    controller.open()

    const intent = controller.viewAlert(alertEvent({ eventID: 'app-alert', serverID: 0 }))

    expect(intent).toEqual({ type: 'none', eventID: 'app-alert' })
    expect(controller.isOpen.value).toBe(false)
  })

  it('does not persist alerts or sensitive values', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = useAlertCenterController()

    controller.open()
    controller.viewAlert(alertEvent({ message: 'credential required' }))

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(controller)).not.toContain('password')
    expect(JSON.stringify(controller)).not.toContain('privateKey')
  })
})
