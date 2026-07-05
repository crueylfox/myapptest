import { describe, expect, it } from 'vitest'
import type { MonitorSnapshot } from '../types'
import { snapshotForActiveServer } from './activeContext'

function snapshot(connectionId: number, latencyMillis: number): MonitorSnapshot {
  return {
    connectionId, status: 'online', timestamp: new Date().toISOString(),
    latencyMillis, latencyAvailable: true, cpuPercent: null, memoryTotal: 0,
    memoryAvailable: 0, memoryUsedPercent: null, swapTotal: 0, swapFree: 0,
    diskTotal: 0, diskUsed: 0, diskUsedPercent: null, loadOne: null, loadFive: null,
    loadFifteen: null, uptimeSeconds: null, defaultInterface: '',
    downloadBytesPerSecond: null, uploadBytesPerSecond: null, osName: '', kernel: '',
    architecture: '', mounts: [], processes: [], processStatus: 'empty', processMessage: '',
    errors: [], errorCode: '', message: '', monitorActive: true,
  }
}

describe('active terminal monitor context', () => {
  it('uses activeServerID even when selectedServerID points elsewhere', () => {
    const snapshots = { 1: snapshot(1, 11), 2: snapshot(2, 22) }
    const selectedServerId = 2
    expect(selectedServerId).toBe(2)
    expect(snapshotForActiveServer(1, snapshots)?.latencyMillis).toBe(11)
  })

  it('switches immediately and returns unavailable without an active terminal', () => {
    const snapshots = { 1: snapshot(1, 11), 2: snapshot(2, 22) }
    expect(snapshotForActiveServer(2, snapshots)?.connectionId).toBe(2)
    expect(snapshotForActiveServer(1, snapshots)?.connectionId).toBe(1)
    expect(snapshotForActiveServer(null, snapshots)).toBeNull()
    expect(snapshotForActiveServer(3, snapshots)).toBeNull()
  })
})
