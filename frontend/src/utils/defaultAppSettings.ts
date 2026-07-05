import type { AppSettings } from '../types'
import { defaultAlertSettings } from './alertSettings'
import { defaultShortcutSettings } from './shortcutSettings'

export function createDefaultAppSettings(): AppSettings {
  return {
    defaultRememberPassword: false,
    defaultRememberPassphrase: false,
    terminalCopyOnSelectEnabled: true,
    terminalRightClickPasteEnabled: true,
    shortcutSettings: defaultShortcutSettings(),
    hostKeyPolicy: 'auto_update',
    themeMode: 'dark',
    uiFontSize: 'large',
    localTerminalShellPreference: 'auto',
    localTerminalElevatedEnabled: false,
    defaultTerminalProfileId: 'default',
    commandHistoryMaxEntries: 2000,
    sshKeepaliveEnabled: true,
    sshKeepaliveIntervalSeconds: 30,
    sshKeepaliveTimeoutSeconds: 10,
    sshKeepaliveMaxFailures: 3,
    connectionTimeoutSeconds: 15,
    dashboardSortMode: 'manual',
    dashboardManualServerOrder: [],
    alerts: defaultAlertSettings(),
    backupImportOptions: {
      importSettings: true,
      importGroups: true,
      importServers: true,
      importKeyVault: true,
      importHostTrust: true,
    },
    windowWidth: 1360,
    windowHeight: 1500,
    windowMaximized: false,
    settingsVersion: 15,
    onboardingCompleted: true,
    trustOnFirstUseAcknowledged: false,
  }
}
