import { describe, expect, it } from 'vitest'
import { resolveMonitorOverviewLayout } from './monitorOverviewLayout'

describe('resolveMonitorOverviewLayout', () => {
  it('fits the overview in a 1360x1950 default window content area', () => {
    const layout = resolveMonitorOverviewLayout(1360, 1906, 15)
    expect(layout.mode).toBe('overview-fit')
    expect(layout.metricColumns).toBe(5)
    expect(layout.chartColumns).toBe(3)
    expect(layout.chartHeight).toBeGreaterThanOrEqual(210)
    expect(layout.estimatedContentHeight).toBeLessThanOrEqual(1906)
  })

  it('keeps all three charts on one row at 1440x900 and 1920x1080 content sizes', () => {
    const medium = resolveMonitorOverviewLayout(1440, 856, 15)
    const large = resolveMonitorOverviewLayout(1920, 1036, 15)
    expect(medium.mode).toBe('overview-fit')
    expect(medium.chartColumns).toBe(3)
    expect(medium.estimatedContentHeight).toBeLessThanOrEqual(856)
    expect(large.mode).toBe('overview-fit')
    expect(large.chartColumns).toBe(3)
    expect(large.estimatedContentHeight).toBeLessThanOrEqual(1036)
  })

  it('allows scrolling when the available 1024x700 window content area is too short', () => {
    const layout = resolveMonitorOverviewLayout(1024, 656, 15)
    expect(layout.mode).toBe('scroll')
    expect(layout.chartColumns).toBe(2)
    expect(layout.estimatedContentHeight).toBeGreaterThan(656)
  })

  it('uses a compact two-column chart layout for medium width when height permits', () => {
    const layout = resolveMonitorOverviewLayout(1000, 860, 15)
    expect(layout.mode).toBe('compact-fit')
    expect(layout.metricColumns).toBe(4)
    expect(layout.chartColumns).toBe(2)
    expect(layout.estimatedContentHeight).toBeLessThanOrEqual(860)
  })

  it('falls back to a single-column scroll layout for narrow containers', () => {
    const layout = resolveMonitorOverviewLayout(640, 760, 15)
    expect(layout.mode).toBe('scroll')
    expect(layout.metricColumns).toBe(2)
    expect(layout.chartColumns).toBe(1)
  })

  it('accounts for the compact empty-data notice without clipping', () => {
    const layout = resolveMonitorOverviewLayout(1360, 1906, 15, { hasNotice: true })
    expect(layout.mode).toBe('overview-fit')
    expect(layout.estimatedContentHeight).toBeLessThanOrEqual(1906)
  })

  it('keeps larger UI fonts readable by using the scroll mode when necessary', () => {
    const layout = resolveMonitorOverviewLayout(1180, 480, 22)
    expect(layout.mode).toBe('scroll')
    expect(layout.chartHeight).toBeGreaterThan(220)
  })
})
