import type { MonitorSnapshot } from '../types'

export function snapshotForActiveServer(
  activeServerId: number | null,
  snapshotsByServerId: Record<number, MonitorSnapshot>,
): MonitorSnapshot | null {
  return activeServerId === null ? null : snapshotsByServerId[activeServerId] ?? null
}
