// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { AlertEvent } from '../types'
import AlertCenter from './AlertCenter.vue'

const active: AlertEvent = {
  eventID: 'a1',
  serverID: 1,
  serverName: 'prod',
  ruleType: 'cpu_high',
  severity: 'warning',
  state: 'firing',
  title: 'CPU 使用率过高',
  message: '服务器「prod」CPU 已持续达到 95%，告警阈值为 90%。',
  currentValue: 95,
  threshold: 90,
  unit: '%',
  startedAt: new Date().toISOString(),
  read: false,
  muted: false,
  source: 'monitor',
}

const resolved: AlertEvent = {
  ...active,
  eventID: 'r1',
  state: 'resolved',
  title: 'CPU 使用率已恢复',
  resolvedAt: new Date().toISOString(),
  read: true,
}

const interrupted: AlertEvent = {
  ...active,
  eventID: 'i1',
  state: 'interrupted',
  title: 'CPU 使用率过高',
  read: false,
  sessionID: 'old-session',
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

describe('AlertCenter', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('uses shared viewport panel positioning without overflowing narrow windows', async () => {
    setViewportSize(320, 220)
    const wrapper = mount(AlertCenter, {
      attachTo: document.body,
      props: {
        open: true,
        activeEvents: Array.from({ length: 8 }, (_, index) => ({ ...active, eventID: `a-${index}` })),
        resolvedEvents: [resolved],
        allEvents: [active, resolved],
      },
    })
    await wrapper.vm.$nextTick()

    const panel = document.body.querySelector<HTMLElement>('.alert-center-panel')!
    const list = document.body.querySelector<HTMLElement>('.alert-center-list')!
    const left = Number.parseInt(panel.style.left, 10)
    const top = Number.parseInt(panel.style.top, 10)
    const width = Number.parseInt(panel.style.width, 10)
    const maxHeight = Number.parseInt(panel.style.maxHeight, 10)
    expect(panel.classList.contains('viewport-popover')).toBe(true)
    expect(left + width).toBeLessThanOrEqual(312)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + maxHeight).toBeLessThanOrEqual(212)
    expect(list).not.toBeNull()
  })

  it('closes from the backdrop but not from inside the drawer', async () => {
    const wrapper = mount(AlertCenter, {
      props: {
        open: true,
        activeEvents: [active],
        resolvedEvents: [resolved],
        allEvents: [active, resolved],
      },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('.alert-center-panel').trigger('pointerdown')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('.alert-center-backdrop').trigger('pointerdown')
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('shows active alerts by default and emits row actions', async () => {
    const wrapper = mount(AlertCenter, {
      props: {
        open: true,
        activeEvents: [active],
        resolvedEvents: [resolved],
        allEvents: [active, resolved],
      },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('进行中 1')
    expect(wrapper.text()).toContain('CPU 使用率过高')
    await wrapper.findAll('button').find((button) => button.text() === '已读')!.trigger('click')
    expect(wrapper.emitted('markRead')).toEqual([['a1']])

    await wrapper.findAll('button').find((button) => button.text().includes('静音 30 分钟'))!.trigger('click')
    expect(wrapper.emitted('muteServer')).toEqual([[1, '30m']])

    await wrapper.findAll('button').find((button) => button.text() === '查看监控')!.trigger('click')
    expect(wrapper.emitted('viewMonitor')?.[0]?.[0]).toMatchObject({ eventID: 'a1' })

    await wrapper.findAll('button').find((button) => button.text() === '清除已恢复')!.trigger('click')
    expect(wrapper.emitted('clearResolved')).toEqual([[]])
    wrapper.unmount()
  })

  it('shows interrupted history without counting it as current active', async () => {
    const wrapper = mount(AlertCenter, {
      props: {
        open: true,
        activeEvents: [],
        resolvedEvents: [resolved],
        allEvents: [interrupted, resolved],
      },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.findAll('button').find((button) => button.text().startsWith('全部'))!.trigger('click')

    expect(wrapper.text()).toContain('进行中 0')
    expect(wrapper.text()).toContain('上次运行期间未确认恢复')
    expect(wrapper.find('.alert-row.interrupted').exists()).toBe(true)
  })
})
