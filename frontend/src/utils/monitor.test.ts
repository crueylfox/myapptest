import { describe, expect, it } from 'vitest'
import { normalizeMonitorSnapshot } from './monitor'

describe('normalizeMonitorSnapshot', () => {
  it('normalizes missing and null metric fields without throwing', () => {
    const result = normalizeMonitorSnapshot({
      connectionId: 1,
      status: 'online',
      timestamp: '2026-06-13T10:00:00Z',
      errors: null,
    })

    expect(result).not.toBeNull()
    expect(result?.errors).toEqual([])
    expect(result?.cpuPercent).toBeNull()
    expect(result?.memoryUsedPercent).toBeNull()
    expect(result?.defaultInterface).toBe('')
    expect(result?.latencyAvailable).toBe(false)
    expect(result?.mounts).toEqual([])
    expect(result?.processes).toEqual([])
  })

  it('normalizes valid mounts and processes while dropping malformed rows', () => {
    const result = normalizeMonitorSnapshot({
      connectionId: 3,
      status: 'online',
      timestamp: '2026-06-13T10:00:00Z',
      mounts: [
        { filesystem: '/dev/root', mountPath: '/', total: 100, used: 40, available: 60, usedPercent: 40 },
        { filesystem: 'bad' },
      ],
      processes: [
        { pid: 10, cpuPercent: 4.5, memoryPercent: 1.2, command: 'sshd' },
        { pid: 0, command: 'bad' },
      ],
    })
    expect(result?.mounts).toHaveLength(1)
    expect(result?.processes).toEqual([
      { pid: 10, cpuPercent: 4.5, memoryPercent: 1.2, command: 'sshd' },
    ])
  })

  it('rejects NaN and Infinity metrics as unavailable', () => {
    const result = normalizeMonitorSnapshot({
      connectionId: 2,
      status: 'online',
      timestamp: '2026-06-13T10:00:00Z',
      cpuPercent: Number.NaN,
      memoryUsedPercent: Number.POSITIVE_INFINITY,
      downloadBytesPerSecond: Number.NEGATIVE_INFINITY,
      uptimeSeconds: -1,
    })

    expect(result?.cpuPercent).toBeNull()
    expect(result?.memoryUsedPercent).toBeNull()
    expect(result?.downloadBytesPerSecond).toBeNull()
    expect(result?.uptimeSeconds).toBeNull()
  })

  it('rejects snapshots without a valid connection identity', () => {
    expect(normalizeMonitorSnapshot({ status: 'online' })).toBeNull()
    expect(normalizeMonitorSnapshot({ connectionId: 0, status: 'online' })).toBeNull()
  })

  it('normalizes monitor network interface metadata', () => {
    const result = normalizeMonitorSnapshot({
      connectionId: 4,
      status: 'online',
      timestamp: '2026-06-19T10:00:00Z',
      networkInterfaceMode: 'interface',
      selectedNetworkInterface: 'eth1',
      effectiveNetworkInterface: 'eth1',
      networkInterfaceFallback: true,
      networkInterfaceMessage: '所选网络接口不存在，已切换为全部接口',
    })

    expect(result).toMatchObject({
      networkInterfaceMode: 'interface',
      selectedNetworkInterface: 'eth1',
      effectiveNetworkInterface: 'eth1',
      networkInterfaceFallback: true,
      networkInterfaceMessage: '所选网络接口不存在，已切换为全部接口',
    })
  })
})
