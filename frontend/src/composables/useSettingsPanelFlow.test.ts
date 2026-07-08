// @vitest-environment jsdom

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSettingsPanelFlow } from './useSettingsPanelFlow'
import { createDefaultAppSettings } from '../utils/defaultAppSettings'
import type { AppSettings } from '../types'

function createFlow(overrides: Partial<Parameters<typeof useSettingsPanelFlow>[0]> = {}) {
  const settings = ref<AppSettings>(createDefaultAppSettings())
  const settingsOverlayOpen = ref(false)
  const savedSettings = { ...settings.value, defaultTerminalProfileId: 'profile-a', uiFontSize: 'large' as const }
  const deps: Parameters<typeof useSettingsPanelFlow>[0] = {
    settings,
    settingsOverlayOpen,
    saveSettingsValue: vi.fn(async () => savedSettings),
    configureAlerts: vi.fn(),
    reloadAlertHistory: vi.fn(async () => undefined),
    setDefaultTerminalProfileId: vi.fn(),
    applyTheme: vi.fn(),
    applyUIFontSize: vi.fn(),
    showToast: vi.fn(),
    run: vi.fn(async (action: () => Promise<void>) => { await action() }),
    errorMessage: (reason, fallback) => reason instanceof Error ? reason.message || fallback : fallback,
    ...overrides,
  }
  return {
    settings,
    settingsOverlayOpen,
    deps,
    flow: useSettingsPanelFlow(deps),
  }
}

describe('useSettingsPanelFlow', () => {
  it('opens and closes the settings overlay without touching persistence', () => {
    const ctx = createFlow()

    ctx.flow.openSettingsOverlay()
    expect(ctx.settingsOverlayOpen.value).toBe(true)

    ctx.flow.closeSettingsOverlay()
    expect(ctx.settingsOverlayOpen.value).toBe(false)
  })

  it('normalizes shortcut, alert, local terminal, profile, history, and dashboard defaults', () => {
    const ctx = createFlow()
    const normalized = ctx.flow.normalizeAppSettings({
      ...ctx.settings.value,
      shortcutSettings: undefined as unknown as AppSettings['shortcutSettings'],
      terminalCopyOnSelectEnabled: false,
      terminalRightClickPasteEnabled: true,
      localTerminalElevatedEnabled: undefined as unknown as boolean,
      defaultTerminalProfileId: '',
      commandHistoryMaxEntries: 0,
      dashboardSortMode: undefined as unknown as AppSettings['dashboardSortMode'],
      dashboardManualServerOrder: undefined as unknown as string[],
      alerts: undefined as unknown as AppSettings['alerts'],
      backupImportOptions: {
        importSettings: false,
        importGroups: undefined as unknown as boolean,
        importServers: true,
        importKeyVault: false,
        importHostTrust: undefined as unknown as boolean,
      },
    })

    expect(normalized.terminalCopyOnSelectEnabled).toBe(false)
    expect(normalized.terminalRightClickPasteEnabled).toBe(true)
    expect(normalized.localTerminalElevatedEnabled).toBe(false)
    expect(normalized.defaultTerminalProfileId).toBe('default')
    expect(normalized.commandHistoryMaxEntries).toBe(2000)
    expect(normalized.dashboardSortMode).toBe('manual')
    expect(normalized.dashboardManualServerOrder).toEqual([])
    expect(normalized.alerts).toBeTruthy()
    expect(normalized.backupImportOptions).toEqual({
      importSettings: false,
      importGroups: true,
      importServers: true,
      importKeyVault: false,
      importHostTrust: true,
    })
  })

  it('saves settings through injected callbacks and applies the returned settings', async () => {
    const ctx = createFlow()

    await expect(ctx.flow.saveSettings({ ...ctx.settings.value, hostKeyPolicy: 'strict' })).resolves.toBe(true)

    expect(ctx.deps.saveSettingsValue).toHaveBeenCalledWith(expect.objectContaining({ hostKeyPolicy: 'strict' }))
    expect(ctx.deps.configureAlerts).toHaveBeenCalledWith(ctx.settings.value.alerts)
    expect(ctx.deps.reloadAlertHistory).toHaveBeenCalled()
    expect(ctx.deps.setDefaultTerminalProfileId).toHaveBeenCalledWith('profile-a')
    expect(ctx.deps.applyTheme).toHaveBeenCalledWith(ctx.settings.value.themeMode)
    expect(ctx.deps.applyUIFontSize).toHaveBeenCalledWith('large')
    expect(ctx.deps.showToast).toHaveBeenCalledWith(expect.any(String), 'success')
  })

  it('closes the overlay only after save succeeds', async () => {
    const ctx = createFlow()
    ctx.settingsOverlayOpen.value = true

    await ctx.flow.saveSettingsAndClose(ctx.settings.value)

    expect(ctx.settingsOverlayOpen.value).toBe(false)
  })

  it('keeps the overlay open when save fails', async () => {
    const run = vi.fn(async (action: () => Promise<void>) => {
      try {
        await action()
      } catch {
        // mirror App.vue run(): surface the error and continue
      }
    })
    const ctx = createFlow({
      run,
      saveSettingsValue: vi.fn(async () => { throw new Error('save failed') }),
    })
    ctx.settingsOverlayOpen.value = true

    await expect(ctx.flow.saveSettingsAndClose(ctx.settings.value)).resolves.toBeUndefined()

    expect(ctx.settingsOverlayOpen.value).toBe(true)
  })

  it('can disable conflicting keyboard shortcuts and retry save before closing', async () => {
    const savedSettings = { ...createDefaultAppSettings() }
    const saveSettingsValue = vi.fn()
      .mockRejectedValueOnce(new Error('快捷键绑定无效'))
      .mockResolvedValueOnce(savedSettings)
    const confirmDisableShortcutConflicts = vi.fn(async () => true)
    const ctx = createFlow({ saveSettingsValue, confirmDisableShortcutConflicts })
    ctx.settingsOverlayOpen.value = true
    ctx.settings.value.shortcutSettings = {
      ...ctx.settings.value.shortcutSettings,
      terminalCopy: 'meta+c',
      terminalPaste: 'meta+v',
      terminalCompletion: 'meta+k',
      openCommandHistory: 'shift+meta+h',
      openCommandFavorites: 'shift+meta+p',
    }

    await ctx.flow.saveSettingsAndClose(ctx.settings.value)

    expect(confirmDisableShortcutConflicts).toHaveBeenCalledWith(expect.stringContaining('禁用所有键盘快捷键'))
    expect(saveSettingsValue).toHaveBeenCalledTimes(2)
    expect(saveSettingsValue).toHaveBeenLastCalledWith(expect.objectContaining({
      shortcutSettings: expect.objectContaining({
        terminalCopy: 'disabled',
        terminalPaste: 'disabled',
        terminalCompletion: 'disabled',
        openCommandHistory: 'disabled',
        openCommandFavorites: 'disabled',
      }),
    }))
    expect(ctx.settingsOverlayOpen.value).toBe(false)
  })

  it('keeps settings open when the shortcut conflict retry is cancelled', async () => {
    const saveSettingsValue = vi.fn(async () => { throw new Error('快捷键绑定无效') })
    const confirmDisableShortcutConflicts = vi.fn(async () => false)
    const ctx = createFlow({ saveSettingsValue, confirmDisableShortcutConflicts })
    ctx.settingsOverlayOpen.value = true

    await ctx.flow.saveSettingsAndClose(ctx.settings.value)

    expect(saveSettingsValue).toHaveBeenCalledTimes(1)
    expect(ctx.settingsOverlayOpen.value).toBe(true)
  })

  it('saves dashboard layout by updating only dashboard settings fields', async () => {
    const ctx = createFlow()

    await ctx.flow.saveDashboardLayout({ sortMode: 'group', manualServerOrder: ['2', '1'] })

    expect(ctx.deps.saveSettingsValue).toHaveBeenCalledWith(expect.objectContaining({
      dashboardSortMode: 'group',
      dashboardManualServerOrder: ['2', '1'],
    }))
  })
})
