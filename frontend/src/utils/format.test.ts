import { describe, expect, it } from 'vitest'
import { formatBytes, formatPercent, formatRate, formatUptime } from './format'

describe('monitor formatting', () => {
  it('uses byte units rather than bit units', () => {
    expect(formatRate(1024)).toBe('1.00 KB/s')
    expect(formatRate(1024 ** 2)).toBe('1.00 MB/s')
  })

  it('keeps unavailable values explicit', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatPercent(null)).toBe('—')
  })

  it('formats uptime', () => {
    expect(formatUptime(90061)).toBe('1天 1小时')
    expect(formatBytes(1536)).toBe('1.50 KB')
  })
})
