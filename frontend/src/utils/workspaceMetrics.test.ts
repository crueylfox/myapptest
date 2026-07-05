import { describe, expect, it } from 'vitest'
import type { DiskMount, ProcessInfo } from '../types'
import { sortProcesses, visibleMounts } from './workspaceMetrics'

const mounts: DiskMount[] = [
  { filesystem: '/dev/data', mountPath: '/data', total: 200, used: 50, available: 150, usedPercent: 25 },
  { filesystem: 'overlay', mountPath: '/var/lib/docker/overlay2/a/merged', total: 100, used: 50, available: 50, usedPercent: 50 },
  { filesystem: '/dev/root', mountPath: '/', total: 100, used: 40, available: 60, usedPercent: 40 },
]

describe('workspace metrics', () => {
  it('hides Docker overlay mounts by default and sorts by mount path', () => {
    expect(visibleMounts(mounts, false).map((mount) => mount.mountPath)).toEqual([
      '/',
      '/data',
    ])
  })

  it('shows all mounts when explicitly requested', () => {
    expect(visibleMounts(mounts, true)).toHaveLength(3)
  })

  it('sorts processes by CPU by default and memory when selected', () => {
    const processes: ProcessInfo[] = [
      { pid: 1, cpuPercent: 2, memoryPercent: 8, command: 'one' },
      { pid: 2, cpuPercent: 9, memoryPercent: 3, command: 'two' },
      { pid: 3, cpuPercent: 4, memoryPercent: 12, command: 'three' },
    ]
    expect(sortProcesses(processes, 'cpu').map((process) => process.pid)).toEqual([2, 3, 1])
    expect(sortProcesses(processes, 'memory').map((process) => process.pid)).toEqual([3, 1, 2])
  })

  it('tolerates a process disappearing between samples', () => {
    const first = sortProcesses([
      { pid: 1, cpuPercent: 10, memoryPercent: 1, command: 'short-lived' },
      { pid: 2, cpuPercent: 5, memoryPercent: 2, command: 'stable' },
    ], 'cpu')
    const second = sortProcesses([
      { pid: 2, cpuPercent: 6, memoryPercent: 2, command: 'stable' },
    ], 'cpu')
    expect(first).toHaveLength(2)
    expect(second).toEqual([
      { pid: 2, cpuPercent: 6, memoryPercent: 2, command: 'stable' },
    ])
  })

  it('filters invalid usage and uses stable PID ties with a command fallback', () => {
    const processes: ProcessInfo[] = [
      { pid: 4, cpuPercent: 5, memoryPercent: 2, command: '' },
      { pid: 2, cpuPercent: 5, memoryPercent: 3, command: 'two' },
      { pid: 3, cpuPercent: Number.NaN, memoryPercent: 1, command: 'invalid' },
      { pid: 5, cpuPercent: -1, memoryPercent: 1, command: 'negative' },
    ]
    expect(sortProcesses(processes, 'cpu')).toEqual([
      { pid: 2, cpuPercent: 5, memoryPercent: 3, command: 'two' },
      { pid: 4, cpuPercent: 5, memoryPercent: 2, command: '[4]' },
    ])
    expect(sortProcesses(processes, 'memory').map((process) => process.pid)).toEqual([2, 4, 3, 5])
  })
})
