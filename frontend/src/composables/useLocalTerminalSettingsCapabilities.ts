import { computed, ref } from 'vue'
import { api } from '../api/backend'
import type { LocalTerminalCapabilities } from '../types'

export function useLocalTerminalSettingsCapabilities(onAdminSettingHidden?: () => void) {
  const capabilities = ref<LocalTerminalCapabilities | null>(null)
  const showLocalTerminalAdminSetting = computed(() =>
    !capabilities.value || (capabilities.value.platform !== 'darwin' && capabilities.value.supportsElevation !== false))

  async function loadLocalTerminalCapabilities() {
    try {
      capabilities.value = await api.getLocalTerminalCapabilities()
    } catch {
      capabilities.value = null
    }
    if (!showLocalTerminalAdminSetting.value) onAdminSettingHidden?.()
  }

  return { showLocalTerminalAdminSetting, loadLocalTerminalCapabilities }
}
