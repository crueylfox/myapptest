// @vitest-environment jsdom

import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBackupRestoreFlow } from './useBackupRestoreFlow'
import { createDefaultAppSettings } from '../utils/defaultAppSettings'
import type { AppSettings } from '../types'

function createFlow(overrides: Partial<Parameters<typeof useBackupRestoreFlow>[0]> = {}) {
  const settings = ref<AppSettings>(createDefaultAppSettings())
  const settingsOverlayOpen = ref(true)
  const busy = ref(false)
  const deps: Parameters<typeof useBackupRestoreFlow>[0] = {
    settings,
    settingsOverlayOpen,
    busy,
    nextTick,
    loadSettings: vi.fn(async () => ({ ...settings.value, themeMode: 'dark' as const })),
    loadConnections: vi.fn(async () => undefined),
    loadTunnelProfiles: vi.fn(async () => undefined),
    configureAlerts: vi.fn(),
    reloadAlertHistory: vi.fn(async () => undefined),
    loadTerminalProfiles: vi.fn(async () => undefined),
    normalizeAppSettings: (value) => value,
    applyTheme: vi.fn(),
    applyUIFontSize: vi.fn(),
    showToast: vi.fn(),
    errorMessage: (reason, fallback) => reason instanceof Error ? reason.message || fallback : fallback,
    ...overrides,
  }
  return {
    settings,
    settingsOverlayOpen,
    busy,
    deps,
    flow: useBackupRestoreFlow(deps),
  }
}

describe('useBackupRestoreFlow', () => {
  it('reloads app state after backup import and always clears overlay/busy state', async () => {
    const ctx = createFlow()

    await ctx.flow.reloadAfterBackupImport()

    expect(ctx.deps.loadSettings).toHaveBeenCalled()
    expect(ctx.deps.loadConnections).toHaveBeenCalled()
    expect(ctx.deps.loadTunnelProfiles).toHaveBeenCalled()
    expect(ctx.deps.configureAlerts).toHaveBeenCalledWith(ctx.settings.value.alerts)
    expect(ctx.deps.reloadAlertHistory).toHaveBeenCalled()
    expect(ctx.deps.loadTerminalProfiles).toHaveBeenCalledWith(ctx.settings.value.defaultTerminalProfileId)
    expect(ctx.deps.applyTheme).toHaveBeenCalledWith('dark')
    expect(ctx.busy.value).toBe(false)
    expect(ctx.settingsOverlayOpen.value).toBe(false)
    expect(ctx.deps.showToast).toHaveBeenCalledWith(expect.any(String), 'success')
  })

  it('still cleans the overlay and reports an error when reload after import fails', async () => {
    const ctx = createFlow({
      loadSettings: vi.fn(async () => { throw new Error('reload failed') }),
    })

    await ctx.flow.reloadAfterBackupImport()

    expect(ctx.busy.value).toBe(false)
    expect(ctx.settingsOverlayOpen.value).toBe(false)
    expect(ctx.deps.showToast).toHaveBeenCalledWith('reload failed', 'error')
  })
})
