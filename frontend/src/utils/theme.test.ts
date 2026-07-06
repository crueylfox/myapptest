// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, resolvedTheme, stopThemeSync } from './theme'

describe('theme mode', () => {
  afterEach(() => {
    stopThemeSync()
    vi.restoreAllMocks()
  })

  it('applies dark and light modes immediately', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    expect(applyTheme('dark')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(applyTheme('light')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('keeps the legacy macOS gray dark preview name as a dark-theme alias', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    expect(applyTheme('macos_gray_dark')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(resolvedTheme('dark', false)).toBe('dark')
    expect(resolvedTheme('light', true)).toBe('light')
  })

  it('follows system changes', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn((_name: string, callback: (event: MediaQueryListEvent) => void) => {
        listener = callback
      }),
      removeEventListener: vi.fn(),
    })))
    expect(applyTheme('system')).toBe('dark')
    listener?.({ matches: false } as MediaQueryListEvent)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(resolvedTheme('system', true)).toBe('dark')
  })
})
