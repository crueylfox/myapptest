import type { Ref } from 'vue'
import { normalizeAlertSettings } from '../utils/alertSettings'
import { normalizeShortcutSettings } from '../utils/shortcutSettings'
import type { AppSettings, DashboardSortMode } from '../types'

type ToastType = 'success' | 'error' | 'info'

export interface SettingsPanelFlowOptions {
  settings: Ref<AppSettings>
  settingsOverlayOpen: Ref<boolean>
  saveSettingsValue: (settings: AppSettings) => Promise<AppSettings>
  configureAlerts: (settings: AppSettings['alerts']) => void
  reloadAlertHistory: () => Promise<void>
  setDefaultTerminalProfileId: (id: string) => void
  applyTheme: (mode: AppSettings['themeMode']) => void
  applyUIFontSize: (size: AppSettings['uiFontSize']) => void
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useSettingsPanelFlow(options: SettingsPanelFlowOptions) {
  function openSettingsOverlay() {
    options.settingsOverlayOpen.value = true
  }

  function closeSettingsOverlay() {
    options.settingsOverlayOpen.value = false
  }

  function normalizeAppSettings(value: AppSettings): AppSettings {
    const shortcutSettings = normalizeShortcutSettings(
      value.shortcutSettings,
      value.terminalCopyOnSelectEnabled ?? true,
      value.terminalRightClickPasteEnabled ?? true,
    )
    return {
      ...value,
      terminalCopyOnSelectEnabled: shortcutSettings.terminalCopyOnSelectEnabled,
      terminalRightClickPasteEnabled: shortcutSettings.terminalRightClickAction === 'paste',
      shortcutSettings,
      localTerminalElevatedEnabled: Boolean(value.localTerminalElevatedEnabled),
      defaultTerminalProfileId: value.defaultTerminalProfileId || 'default',
      commandHistoryMaxEntries: value.commandHistoryMaxEntries || 2000,
      dashboardSortMode: value.dashboardSortMode || 'manual',
      dashboardManualServerOrder: Array.isArray(value.dashboardManualServerOrder)
        ? value.dashboardManualServerOrder
        : [],
      alerts: normalizeAlertSettings(value.alerts),
      backupImportOptions: {
        importSettings: value.backupImportOptions?.importSettings ?? true,
        importGroups: value.backupImportOptions?.importGroups ?? true,
        importServers: value.backupImportOptions?.importServers ?? true,
        importKeyVault: value.backupImportOptions?.importKeyVault ?? true,
        importHostTrust: value.backupImportOptions?.importHostTrust ?? true,
      },
    }
  }

  async function saveSettings(value: AppSettings) {
    const next = normalizeAppSettings(value)
    if (next.hostKeyPolicy !== 'strict') next.hostKeyPolicy = 'auto_update'
    let saved = false
    await options.run(async () => {
      options.settings.value = normalizeAppSettings(await options.saveSettingsValue(next))
      options.configureAlerts(options.settings.value.alerts)
      await options.reloadAlertHistory()
      options.setDefaultTerminalProfileId(options.settings.value.defaultTerminalProfileId)
      options.applyTheme(options.settings.value.themeMode)
      options.applyUIFontSize(options.settings.value.uiFontSize)
      options.showToast('设置已保存', 'success')
      saved = true
    }, '保存连接设置失败')
    return saved
  }

  async function saveSettingsAndClose(value: AppSettings) {
    if (await saveSettings(value)) closeSettingsOverlay()
  }

  async function saveDashboardLayout(payload: { sortMode: DashboardSortMode; manualServerOrder: string[] }) {
    const next = {
      ...options.settings.value,
      dashboardSortMode: payload.sortMode,
      dashboardManualServerOrder: payload.manualServerOrder,
    }
    options.settings.value = normalizeAppSettings(next)
    try {
      options.settings.value = normalizeAppSettings(await options.saveSettingsValue(options.settings.value))
    } catch (reason) {
      options.showToast(options.errorMessage(reason, '保存服务器总览布局失败'), 'error')
    }
  }

  return {
    openSettingsOverlay,
    closeSettingsOverlay,
    normalizeAppSettings,
    saveSettings,
    saveSettingsAndClose,
    saveDashboardLayout,
  }
}
