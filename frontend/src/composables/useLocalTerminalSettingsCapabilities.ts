import { computed, ref } from 'vue'
import { api } from '../api/backend'
import type { LocalTerminalCapabilities } from '../types'
import { buildPlatformCapabilities } from '../utils/platformCapabilities'

export function useLocalTerminalSettingsCapabilities(onAdminSettingHidden?: () => void) {
  const capabilities = ref<LocalTerminalCapabilities | null>(null)
  const platformCapabilities = computed(() => buildPlatformCapabilities(capabilities.value))
  const showLocalTerminalAdminSetting = computed(() =>
    platformCapabilities.value.supportsWindowsAdminTerminal)

  async function loadLocalTerminalCapabilities() {
    try {
      capabilities.value = await api.getLocalTerminalCapabilities()
    } catch {
      capabilities.value = null
    }
    if (!showLocalTerminalAdminSetting.value) onAdminSettingHidden?.()
  }

  return { capabilities, platformCapabilities, showLocalTerminalAdminSetting, loadLocalTerminalCapabilities }
}
