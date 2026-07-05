// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMonitorPanelController } from './useMonitorPanelController'

describe('useMonitorPanelController', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('opens the monitor panel overview by default and closes it', () => {
    const controller = useMonitorPanelController()

    controller.openMonitorPanel()
    expect(controller.monitorPanelOpen.value).toBe(true)
    expect(controller.monitorPanelInitialTab.value).toBe('overview')
    expect(controller.monitorPanelInitialServerId.value).toBeNull()

    controller.closeMonitorPanel()
    expect(controller.monitorPanelOpen.value).toBe(false)
  })

  it('opens monitor detail for a specific server without backend side effects', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = useMonitorPanelController()

    controller.openMonitorPanel({ tab: 'detail', serverID: 12 })

    expect(controller.monitorPanelOpen.value).toBe(true)
    expect(controller.monitorPanelInitialTab.value).toBe('detail')
    expect(controller.monitorPanelInitialServerId.value).toBe(12)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('opens and closes network details with the requested initial tab', () => {
    const controller = useMonitorPanelController()

    controller.openNetworkDetails('diagnostics')
    expect(controller.networkDetailsOpen.value).toBe(true)
    expect(controller.networkDetailsInitialTab.value).toBe('diagnostics')

    controller.closeNetworkDetails()
    expect(controller.networkDetailsOpen.value).toBe(false)
  })

  it('creates explicit frontend intents for alert detail and network diagnostics entries', () => {
    const controller = useMonitorPanelController()

    expect(controller.monitorDetailIntent(9)).toEqual({
      type: 'monitor-detail',
      serverID: 9,
    })
    expect(controller.networkDetailsIntent(9, 'diagnostics')).toEqual({
      type: 'network-details',
      serverID: 9,
      tab: 'diagnostics',
    })
  })
})
