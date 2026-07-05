import { ref, type ComputedRef, type Ref } from 'vue'
import type { AppSettings, LocalTerminalCapabilities } from '../types'

type ToastType = 'success' | 'error' | 'info'
type StartupLocalTerminalRequest = { shellKind: string }

export interface AppStartupFlowOptions {
  settings: Ref<AppSettings>
  localTerminalEnabled: ComputedRef<boolean>
  getInitialSettings: () => AppSettings | null
  loadSettings: () => Promise<AppSettings>
  loadLocalTerminalCapabilities: () => Promise<LocalTerminalCapabilities>
  setLocalTerminalCapabilities: (capabilities: LocalTerminalCapabilities | null) => void
  loadConnections: () => Promise<unknown>
  loadTunnelProfiles: () => Promise<unknown>
  normalizeSettings: (settings: AppSettings) => AppSettings
  initializeAlerts: (settings: AppSettings['alerts']) => Promise<unknown>
  setDefaultTerminalProfileId: (id: string | null | undefined) => void
  loadTerminalProfiles: (defaultProfileId: string | null | undefined) => Promise<unknown>
  applyTheme: (mode: AppSettings['themeMode']) => void
  applyUIFontSize: (size: AppSettings['uiFontSize']) => void
  getStartupLocalTerminalRequest: () => Promise<StartupLocalTerminalRequest>
  openLocalTerminal: (shellKind: string) => unknown
  storeError: () => string
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useAppStartupFlow(options: AppStartupFlowOptions) {
  const isBootstrapping = ref(false)
  const startupError = ref<string | null>(null)

  async function startup() {
    isBootstrapping.value = true
    startupError.value = null
    try {
      const bootstrappedSettings = options.getInitialSettings()
      const [loadedSettings] = await Promise.all([
        bootstrappedSettings
          ? Promise.resolve(bootstrappedSettings)
          : options.loadSettings().catch((reason) => {
            options.showToast(options.errorMessage(reason, '加载连接设置失败'), 'error')
            return options.settings.value
          }),
        options.loadLocalTerminalCapabilities()
          .then((capabilities) => {
            options.setLocalTerminalCapabilities(capabilities)
          })
          .catch(() => {
            options.setLocalTerminalCapabilities(null)
          }),
        options.loadConnections(),
        options.loadTunnelProfiles().catch((reason) => {
          options.showToast(options.errorMessage(reason, '加载端口转发配置失败'), 'error')
        }),
      ])
      options.settings.value = options.normalizeSettings(loadedSettings)
      await options.initializeAlerts(options.settings.value.alerts)
      options.setDefaultTerminalProfileId(options.settings.value.defaultTerminalProfileId)
      await options.loadTerminalProfiles(options.settings.value.defaultTerminalProfileId).catch((reason) => {
        options.showToast(options.errorMessage(reason, '加载终端配置失败'), 'error')
      })
      options.applyTheme(options.settings.value.themeMode)
      options.applyUIFontSize(options.settings.value.uiFontSize)
      const startupLocalTerminal = await options.getStartupLocalTerminalRequest().catch(() => ({ shellKind: '' }))
      if (startupLocalTerminal.shellKind && options.localTerminalEnabled.value) {
        void options.openLocalTerminal(startupLocalTerminal.shellKind)
      }
      const storeError = options.storeError()
      if (storeError) options.showToast(storeError, 'error')
    } catch (reason) {
      startupError.value = options.errorMessage(reason, '启动初始化失败')
      throw reason
    } finally {
      isBootstrapping.value = false
    }
  }

  return {
    isBootstrapping,
    startupError,
    startup,
  }
}
