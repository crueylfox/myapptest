import { ref } from 'vue'
import type { LogEntry } from '../types'

export function filterAppLogs(entries: LogEntry[], levelFilter: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false
    if (!normalizedQuery) return true
    return [
      entry.summary,
      entry.message,
      entry.serverName,
      entry.operation,
      entry.errorCode,
      entry.technicalMessage,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery))
  })
}

export function useAppLogsController() {
  const levelFilter = ref('all')
  const query = ref('')
  const refreshing = ref(false)

  function filteredLogs(entries: LogEntry[]) {
    return filterAppLogs(entries, levelFilter.value, query.value)
  }

  async function refresh(loadLogs: () => Promise<void>) {
    refreshing.value = true
    try {
      await loadLogs()
    } finally {
      refreshing.value = false
    }
  }

  return {
    levelFilter,
    query,
    refreshing,
    filteredLogs,
    refresh,
  }
}
