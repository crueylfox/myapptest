// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MiniSparkline from './MiniSparkline.vue'

describe('MiniSparkline', () => {
  it('renders smooth SVG paths instead of hard polyline segments', () => {
    const wrapper = mount(MiniSparkline, {
      props: {
        series: [
          [0, 1024, 4096, 2048],
          [512, 2048, 1024, 3072],
        ],
      },
    })

    expect(wrapper.find('polyline').exists()).toBe(false)
    const paths = wrapper.findAll('path.sparkline-path')
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.attributes('d')).toMatch(/^M /)
      expect(path.attributes('d')).toContain(' C ')
    }
  })

  it('keeps plotted values above the baseline as solid paths with visual interpolation', () => {
    const wrapper = mount(MiniSparkline, {
      props: {
        flow: true,
        series: [
          [0, 1024, 4096, 2048],
        ],
      },
    })

    expect(wrapper.get('svg').classes()).toContain('is-flowing')
    expect(wrapper.get('svg').classes()).toContain('is-visual-interpolated')
    expect(wrapper.get('line').attributes('y1')).toBe('25.5')
    expect(wrapper.get('line').attributes('y2')).toBe('25.5')
    expect(wrapper.find('animate[attributeName="stroke-dashoffset"]').exists()).toBe(false)

    const path = wrapper.get('path.sparkline-path')
    expect(path.attributes('stroke-dasharray')).toBeUndefined()
    expect(path.attributes('stroke-linecap')).toBe('round')
    expect(path.attributes('stroke-linejoin')).toBe('round')
    const d = path.attributes('d')
    expect(d).toBeTruthy()
    const yValues = Array.from(d!.matchAll(/,([0-9.]+)/g)).map((match) => Number(match[1]))
    expect(Math.max(...yValues)).toBeLessThanOrEqual(24)
  })

  it('interpolates visual path updates without mutating the sampling contract', async () => {
    const wrapper = mount(MiniSparkline, {
      props: {
        flow: true,
        series: [
          [0, 10, 20, 30],
        ],
      },
    })
    const before = wrapper.get('path.sparkline-path').attributes('d')

    await wrapper.setProps({
      series: [
        [30, 20, 10, 0],
      ],
    })

    expect(wrapper.get('svg').attributes('data-visual-refresh')).toBe('interpolated')
    expect(wrapper.get('path.sparkline-path').attributes('d')).not.toBe(before)
  })

  it('maps timestamped points into a fixed three-minute time window instead of spreading by index', () => {
    const now = Date.parse('2026-06-15T00:03:00Z')
    const wrapper = mount(MiniSparkline, {
      props: {
        windowMs: 180_000,
        now,
        timedSeries: [[
          { timestamp: now - 240_000, value: 999 },
          { timestamp: now - 90_000, value: 10 },
          { timestamp: now, value: 20 },
        ]],
      },
    })

    const path = wrapper.get('path.sparkline-path').attributes('d') ?? ''
    expect(path).toMatch(/^M 50\.00,/)
    expect(path).toContain('100.00,')
    expect(path).not.toMatch(/(?:^|[ MC])0\.00,/)
  })

  it('moves the same timestamped sample left as now advances', async () => {
    const now = Date.parse('2026-06-15T00:03:00Z')
    const wrapper = mount(MiniSparkline, {
      props: {
        windowMs: 180_000,
        now,
        timedSeries: [[
          { timestamp: now - 60_000, value: 10 },
        ]],
      },
    })
    const before = wrapper.get('path.sparkline-path').attributes('d') ?? ''

    await wrapper.setProps({ now: now + 30_000 })

    const after = wrapper.get('path.sparkline-path').attributes('d') ?? ''
    expect(before).toMatch(/^M 66\.67,/)
    expect(after).toMatch(/^M 50\.00,/)
  })

  it('can apply a left-edge fade mask to old time-window data without dashed strokes', () => {
    const now = Date.parse('2026-06-15T00:03:00Z')
    const wrapper = mount(MiniSparkline, {
      props: {
        leftFade: true,
        windowMs: 180_000,
        now,
        timedSeries: [[
          { timestamp: now - 170_000, value: 10 },
          { timestamp: now, value: 20 },
        ]],
      },
    })

    expect(wrapper.find('mask[id^="mini-sparkline-left-fade"]').exists()).toBe(true)
    expect(wrapper.get('path.sparkline-path').attributes('stroke-dasharray')).toBeUndefined()
  })
})
