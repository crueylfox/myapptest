export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index++
  }
  return `${index === 0 ? current.toFixed(0) : current.toFixed(2)} ${units[index]}`
}

export const formatRate = (value: number | null) => value === null ? '—' : `${formatBytes(value)}/s`
export const formatPercent = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`

export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days}天 ${hours}小时` : `${hours}小时 ${minutes}分钟`
}
