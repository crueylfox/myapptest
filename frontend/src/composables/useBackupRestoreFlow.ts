import type { Ref } from 'vue'
import { nextTick as vueNextTick } from 'vue'
import type { AppSettings } from '../types'

type ToastType = 'success' | 'error' | 'info'

export interface BackupRestoreFlowOptions {
  settings: Ref<AppSettings>
  settingsOverlayOpen: Ref<boolean>
  busy: Ref<boolean>
  nextTick?: typeof vueNextTick
  loadSettings: () => Promise<AppSettings>
  loadConnections: () => Promise<void>
  loadTunnelProfiles: () => Promise<void>
  configureAlerts: (settings: AppSettings['alerts']) => void
  reloadAlertHistory: () => Promise<void>
  loadTerminalProfiles: (defaultProfileId: string) => Promise<unknown>
  normalizeAppSettings: (settings: AppSettings) => AppSettings
  applyTheme: (mode: AppSettings['themeMode']) => void
  applyUIFontSize: (size: AppSettings['uiFontSize']) => void
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useBackupRestoreFlow(options: BackupRestoreFlowOptions) {
  const nextTick = options.nextTick ?? vueNextTick

  async function reloadAfterBackupImport() {
    options.busy.value = true
    let toastMessage = '备份导入完成'
    let toastType: ToastType = 'success'
    try {
      const [nextSettings] = await Promise.all([
        options.loadSettings(),
        options.loadConnections(),
        options.loadTunnelProfiles(),
      ])
      options.settings.value = options.normalizeAppSettings(nextSettings)
      options.configureAlerts(options.settings.value.alerts)
      await options.reloadAlertHistory()
      await options.loadTerminalProfiles(options.settings.value.defaultTerminalProfileId)
      options.applyTheme(options.settings.value.themeMode)
      options.applyUIFontSize(options.settings.value.uiFontSize)
    } catch (reason) {
      toastMessage = options.errorMessage(reason, '刷新导入后的配置失败')
      toastType = 'error'
    } finally {
      options.busy.value = false
      options.settingsOverlayOpen.value = false
      await nextTick()
      options.showToast(toastMessage, toastType)
    }
  }

  return {
    reloadAfterBackupImport,
  }
}
