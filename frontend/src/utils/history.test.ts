import { describe, expect, it } from 'vitest'
import type { MonitorSnapshot } from '../types'
import { appendHistory } from './history'

function snapshot(seconds: number): MonitorSnapshot {
  return {
    connectionId: 1, status: 'online', timestamp: new Date(seconds * 1000).toISOString(),
    latencyMillis: 0, latencyAvailable: false, cpuPercent: null, memoryTotal: 0, memoryAvailable: 0,
    memoryUsedPercent: null, swapTotal: 0, swapFree: 0, diskTotal: 0, diskUsed: 0,
    diskUsedPercent: null, loadOne: null, loadFive: null, loadFifteen: null,
    uptimeSeconds: null, defaultInterface: '', downloadBytesPerSecond: null,
    uploadBytesPerSecond: null, osName: '', kernel: '', architecture: '', errors: [], errorCode: '', message: '',
    mounts: [], processes: [], processStatus: 'empty', processMessage: '', monitorActive: true,
  }
}

describe('appendHistory', () => {
  it('retains a five-minute monitor window for one-second network samples', () => {
    const result = appendHistory([snapshot(1), snapshot(60), snapshot(120), snapshot(300)], snapshot(302))
    expect(result.map((item) => item.timestamp)).toEqual([
      snapshot(60).timestamp,
      snapshot(120).timestamp,
      snapshot(300).timestamp,
      snapshot(302).timestamp,
    ])
  })

  it('caps the default one-second sample window at 300 entries', () => {
    const history = Array.from({ length: 310 }, (_, index) => snapshot(index + 1))
    const result = appendHistory(history, snapshot(311))
    expect(result).toHaveLength(300)
    expect(result[0].timestamp).toBe(snapshot(12).timestamp)
    expect(result.at(-1)?.timestamp).toBe(snapshot(311).timestamp)
  })
})
