import type { DiskMount, ProcessInfo } from '../types'

export type ProcessSort = 'cpu' | 'memory'

export function isDefaultHiddenMount(mount: DiskMount): boolean {
  const filesystem = mount.filesystem.toLowerCase()
  const path = mount.mountPath.toLowerCase()
  const pseudoFilesystems = new Set([
    'overlay',
    'tmpfs',
    'devtmpfs',
    'proc',
    'sysfs',
    'cgroup',
    'cgroup2',
  ])
  return pseudoFilesystems.has(filesystem) ||
    ['/dev', '/proc', '/run', '/sys'].some((prefix) =>
      path === prefix || path.startsWith(`${prefix}/`)) ||
    path.includes('/var/lib/docker/overlay2/') ||
    path.includes('/var/lib/containers/storage/overlay/')
}

export function visibleMounts(mounts: DiskMount[], showAll: boolean): DiskMount[] {
  return mounts
    .filter((mount) => showAll || !isDefaultHiddenMount(mount))
    .sort((left, right) => left.mountPath.localeCompare(right.mountPath))
}

export function sortProcesses(
  processes: ProcessInfo[],
  sort: ProcessSort,
): ProcessInfo[] {
  const field = sort === 'cpu' ? 'cpuPercent' : 'memoryPercent'
  return processes
    .filter((process) =>
      Number.isFinite(process.pid) && process.pid > 0 &&
      Number.isFinite(process[field]) && process[field] >= 0)
    .map((process) => ({
      ...process,
      command: process.command.trim() || `[${process.pid}]`,
    }))
    .sort((left, right) =>
      right[field] - left[field] ||
      left.pid - right.pid)
    .slice(0, 8)
}
