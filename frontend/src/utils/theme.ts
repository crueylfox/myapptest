import type { ThemeMode } from '../types'

let mediaQuery: MediaQueryList | null = null
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null

export function resolvedTheme(mode: ThemeMode, systemDark: boolean): 'dark' | 'light' {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}

export function stopThemeSync() {
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener)
  mediaQuery = null
  mediaListener = null
}

export function applyTheme(mode: ThemeMode): 'dark' | 'light' {
  stopThemeSync()
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (systemDark: boolean) => {
    const theme = resolvedTheme(mode, systemDark)
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.dispatchEvent(new Event('serverpilot:appearance'))
    return theme
  }
  const current = apply(query.matches)
  if (mode === 'system') {
    mediaQuery = query
    mediaListener = (event) => { apply(event.matches) }
    query.addEventListener('change', mediaListener)
  }
  return current
}
