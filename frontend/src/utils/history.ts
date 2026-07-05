import type { MonitorSnapshot } from '../types'

export const MONITOR_HISTORY_WINDOW_SECONDS = 300
export const MONITOR_HISTORY_SAMPLE_LIMIT = 300

export function appendHistory(
  history: MonitorSnapshot[],
  snapshot: MonitorSnapshot,
  seconds = MONITOR_HISTORY_WINDOW_SECONDS,
  limit = MONITOR_HISTORY_SAMPLE_LIMIT,
): MonitorSnapshot[] {
  const cutoff = new Date(snapshot.timestamp).getTime() - seconds * 1000
  return [...history, snapshot]
    .filter((item) => new Date(item.timestamp).getTime() > cutoff)
    .slice(-limit)
}
