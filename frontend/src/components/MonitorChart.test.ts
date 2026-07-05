// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  resize: vi.fn(),
  setOption: vi.fn(),
  init: vi.fn(),
  observe: vi.fn(),
  disconnect: vi.fn(),
  observerCallback: null as ResizeObserverCallback | null,
}))

mocks.init.mockReturnValue({
  dispose: mocks.dispose,
  resize: mocks.resize,
  setOption: mocks.setOption,
})

vi.mock('echarts/core', () => ({ init: mocks.init, use: vi.fn() }))
vi.mock('echarts/charts', () => ({ LineChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, LegendComponent: {}, TooltipComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import MonitorChart from './MonitorChart.vue'

describe('MonitorChart lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 640,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 245,
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now())
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        mocks.observerCallback = callback
      }
      observe = mocks.observe
      disconnect = mocks.disconnect
      unobserve = vi.fn()
    } as unknown as typeof ResizeObserver
  })

  it('resizes the existing chart when its own container changes', async () => {
    const wrapper = mount(MonitorChart, {
      props: {
        title: 'CPU',
        history: [],
        unit: 'percent',
        fields: [{ key: 'cpuPercent', name: 'CPU', color: '#fff' }],
      },
    })
    await wrapper.vm.$nextTick()
    mocks.resize.mockClear()
    mocks.observerCallback?.([], {} as ResizeObserver)
    await wrapper.vm.$nextTick()
    expect(mocks.resize).toHaveBeenCalledTimes(1)
    expect(mocks.init).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('uses a DOM header and disposes every repeatedly mounted chart', () => {
    for (let index = 0; index < 3; index++) {
      const wrapper = mount(MonitorChart, {
        props: {
          title: 'CPU · 最近 60 秒',
          history: [],
          unit: 'percent',
          fields: [{ key: 'cpuPercent', name: 'CPU', color: '#fff' }],
        },
      })
      expect(wrapper.find('.chart-header').text()).toContain('CPU')
      wrapper.unmount()
    }

    expect(mocks.init).toHaveBeenCalledTimes(3)
    expect(mocks.dispose).toHaveBeenCalledTimes(3)
    expect(mocks.disconnect).toHaveBeenCalledTimes(3)
  })
})
