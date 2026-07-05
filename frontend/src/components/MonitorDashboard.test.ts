// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorSnapshot } from '../types'
import MonitorDashboard from './MonitorDashboard.vue'

let observerCallback: ResizeObserverCallback | null = null
let rect = { width: 1360, height: 776 }

function snapshot(): MonitorSnapshot {
  return {
    connectionId: 1,
    status: 'online',
    timestamp: new Date('2026-06-16T10:00:00Z').toISOString(),
    latencyMillis: 18,
    latencyAvailable: true,
    cpuPercent: 12.5,
    memoryTotal: 8 * 1024 ** 3,
    memoryAvailable: 5 * 1024 ** 3,
    memoryUsedPercent: 37.5,
    swapTotal: 2 * 1024 ** 3,
    swapFree: 1024 ** 3,
    diskTotal: 80 * 1024 ** 3,
    diskUsed: 31 * 1024 ** 3,
    diskUsedPercent: 38.75,
    mounts: [],
    processes: [],
    processStatus: 'available',
    processMessage: '',
    loadOne: 0.21,
    loadFive: 0.18,
    loadFifteen: 0.16,
    uptimeSeconds: 3600,
    defaultInterface: 'eth0',
    downloadBytesPerSecond: 2048,
    uploadBytesPerSecond: 1024,
    osName: 'Ubuntu 24.04 LTS',
    kernel: '6.8.0',
    architecture: 'x86_64',
    errors: [],
    errorCode: '',
    message: '',
    monitorActive: true,
  }
}

describe('monitor dashboard layout', () => {
  beforeEach(() => {
    observerCallback = null
    rect = { width: 1360, height: 776 }
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: rect.height,
      right: rect.width,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }))
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    } as unknown as typeof ResizeObserver
  })

  it('starts with compact unavailable state and metric cards without the old server topbar', () => {
    const wrapper = mount(MonitorDashboard, {
      props: { snapshot: null, history: [] },
      global: { stubs: { MonitorChart: true } },
    })
    expect(wrapper.find('.topbar').exists()).toBe(false)
    expect(wrapper.find('.monitor-unavailable').text()).toBe('等待监控数据，连接后自动更新。')
    expect(wrapper.find('.monitor-dashboard').attributes('data-layout-mode')).toBe('overview-fit')
    expect(wrapper.find('.monitor-dashboard').attributes('data-chart-columns')).toBe('3')
    expect(wrapper.findAll('.metric-grid article')).toHaveLength(10)
    expect(wrapper.find('.system-card').exists()).toBe(true)
  })

  it('renders the top metric cards in the requested order', () => {
    const wrapper = mount(MonitorDashboard, {
      props: { snapshot: snapshot(), history: [snapshot()] },
      global: { stubs: { MonitorChart: true } },
    })

    expect(wrapper.findAll('.metric-grid article .metric-label').map((item) => item.text())).toEqual([
      '系统信息',
      'CPU',
      '内存',
      'SWAP',
      '系统负载',
      '运行时间',
      '根分区',
      '↑ 上传',
      '↓ 下载',
      '延迟',
    ])
  })

  it('keeps CPU, memory, and network charts in one row at the default content size', () => {
    const wrapper = mount(MonitorDashboard, {
      props: { snapshot: snapshot(), history: [snapshot()] },
      global: { stubs: { MonitorChart: true } },
    })
    const dashboard = wrapper.find('.monitor-dashboard')
    expect(dashboard.attributes('data-layout-mode')).toBe('overview-fit')
    expect(dashboard.attributes('data-chart-columns')).toBe('3')
    expect(dashboard.attributes('data-chart-height')).toBe('210')
    expect(wrapper.find('.wide').exists()).toBe(false)
  })

  it('labels network cards with the effective selected interface', () => {
    const wrapper = mount(MonitorDashboard, {
      props: {
        snapshot: { ...snapshot(), defaultInterface: 'eth0', effectiveNetworkInterface: 'all' },
        history: [],
      },
      global: { stubs: { MonitorChart: true } },
    })

    expect(wrapper.find('.download small').text()).toContain('全部接口')
    expect(wrapper.find('.upload small').text()).toContain('全部接口')
  })

  it('shows an alert center entry and emits the open action', async () => {
    const wrapper = mount(MonitorDashboard, {
      props: { snapshot: snapshot(), history: [snapshot()], showAlertCenter: true, alertUnreadCount: 2 },
      global: { stubs: { MonitorChart: true } },
    })

    const button = wrapper.get('[data-testid="monitor-alert-center"]')
    expect(button.text()).toContain('告警中心')
    expect(button.text()).toContain('2')

    await button.trigger('click')

    expect(wrapper.emitted('alerts')).toEqual([[]])
  })

  it('switches to the scroll layout when the observed content area is too short', async () => {
    const wrapper = mount(MonitorDashboard, {
      props: { snapshot: snapshot(), history: [snapshot()] },
      global: { stubs: { MonitorChart: true } },
    })
    observerCallback?.([
      { contentRect: { width: 1024, height: 656 } as DOMRectReadOnly } as ResizeObserverEntry,
    ], {} as ResizeObserver)
    await wrapper.vm.$nextTick()
    const dashboard = wrapper.find('.monitor-dashboard')
    expect(dashboard.attributes('data-layout-mode')).toBe('scroll')
    expect(dashboard.attributes('data-chart-columns')).toBe('2')
  })
})
