// @vitest-environment jsdom

import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppStartupFlow } from './useAppStartupFlow'
import { defaultShortcutSettings } from '../utils/shortcutSettings'
import type { AppSettings } from '../types'

const settingsValue = (values: Partial<AppSettings> = {}): AppSettings => ({
  defaultRememberPassword: false,
  defaultRememberPassphrase: false,
  terminalCopyOnSelectEnabled: true,
  terminalRightClickPasteEnabled: true,
  shortcutSettings: defaultShortcutSettings(),
  hostKeyPolicy: 'auto_update',
  themeMode: 'dark',
  uiFontSize: 'standard',
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
  alerts: { enabled: true } as AppSettings['alerts'],
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
  settingsVersion: 13,
  onboardingCompleted: false,
  trustOnFirstUseAcknowledged: false,
  ...values,
})

function createFlow(overrides: Partial<Parameters<typeof useAppStartupFlow>[0]> = {}) {
  const order: string[] = []
  const settings = ref(settingsValue())
  const localTerminalEnabled = ref(true)
  const localCapabilities = {
    platform: 'windows' as const,
    enabled: true,
    supported: true,
    conptyAvailable: true,
    isProcessElevated: false,
    supportsElevation: true,
    shellOptions: [],
    adminShellOptions: [],
    defaultShellPreference: 'powershell',
    currentShellPreference: 'powershell',
    unsupportedMessage: '',
  }
  const deps: Parameters<typeof useAppStartupFlow>[0] = {
    settings,
    localTerminalEnabled: computed(() => localTerminalEnabled.value),
    getInitialSettings: vi.fn(() => null),
    loadSettings: vi.fn(async () => { order.push('load-settings'); return settingsValue({ themeMode: 'light', uiFontSize: 'large', defaultTerminalProfileId: 'tp-main' }) }),
    loadLocalTerminalCapabilities: vi.fn(async () => { order.push('load-local-capabilities'); return localCapabilities }),
    setLocalTerminalCapabilities: vi.fn((capabilities) => { order.push(`set-local:${capabilities ? 'yes' : 'no'}`) }),
    loadConnections: vi.fn(async () => { order.push('load-connections') }),
    loadTunnelProfiles: vi.fn(async () => { order.push('load-tunnels') }),
    normalizeSettings: vi.fn((value) => { order.push('normalize-settings'); return value }),
    initializeAlerts: vi.fn(async () => { order.push('initialize-alerts') }),
    setDefaultTerminalProfileId: vi.fn(() => { order.push('set-default-profile') }),
    loadTerminalProfiles: vi.fn(async () => { order.push('load-terminal-profiles') }),
    applyTheme: vi.fn(() => { order.push('apply-theme') }),
    applyUIFontSize: vi.fn(() => { order.push('apply-font') }),
    getStartupLocalTerminalRequest: vi.fn(async () => { order.push('startup-local-request'); return { shellKind: 'powershell' } }),
    openLocalTerminal: vi.fn(() => { order.push('open-local-terminal') }),
    storeError: () => '',
    showToast: vi.fn((message: string, type: string) => { order.push(`toast:${type}:${message}`) }),
    errorMessage: (reason, fallback) => String(reason).replace(/^Error:\s*/i, '') || fallback,
    ...overrides,
  }
  return {
    order,
    settings,
    localTerminalEnabled,
    deps,
    flow: useAppStartupFlow(deps),
  }
}

describe('useAppStartupFlow', () => {
  it('runs startup callbacks in the existing App.vue order', async () => {
    const ctx = createFlow()

    await ctx.flow.startup()

    expect(ctx.order).toEqual([
      'load-settings',
      'load-local-capabilities',
      'load-connections',
      'load-tunnels',
      'set-local:yes',
      'normalize-settings',
      'initialize-alerts',
      'set-default-profile',
      'load-terminal-profiles',
      'apply-theme',
      'apply-font',
      'startup-local-request',
      'open-local-terminal',
    ])
    expect(ctx.settings.value.themeMode).toBe('light')
    expect(ctx.flow.isBootstrapping.value).toBe(false)
    expect(ctx.flow.startupError.value).toBeNull()
  })

  it('uses bootstrapped settings without loading settings again', async () => {
    const bootstrapped = settingsValue({ themeMode: 'system', uiFontSize: 'small' })
    const ctx = createFlow({ getInitialSettings: vi.fn(() => bootstrapped) })

    await ctx.flow.startup()

    expect(ctx.deps.loadSettings).not.toHaveBeenCalled()
    expect(ctx.settings.value.themeMode).toBe('system')
    expect(ctx.settings.value.uiFontSize).toBe('small')
  })

  it('reports startup loading errors without aborting later startup steps', async () => {
    const ctx = createFlow({
      loadSettings: vi.fn(async () => { throw new Error('settings failed') }),
      loadLocalTerminalCapabilities: vi.fn(async () => { throw new Error('capabilities failed') }),
      loadTunnelProfiles: vi.fn(async () => { throw new Error('tunnel failed') }),
      storeError: () => 'server load failed',
    })

    await ctx.flow.startup()

    expect(ctx.deps.showToast).toHaveBeenCalledWith('settings failed', 'error')
    expect(ctx.deps.showToast).toHaveBeenCalledWith('tunnel failed', 'error')
    expect(ctx.deps.showToast).toHaveBeenCalledWith('server load failed', 'error')
    expect(ctx.deps.setLocalTerminalCapabilities).toHaveBeenCalledWith(null)
    expect(ctx.deps.initializeAlerts).toHaveBeenCalled()
    expect(ctx.deps.applyTheme).toHaveBeenCalled()
  })

  it('does not open startup local terminal when local terminal is disabled', async () => {
    const ctx = createFlow()
    ctx.localTerminalEnabled.value = false

    await ctx.flow.startup()

    expect(ctx.deps.openLocalTerminal).not.toHaveBeenCalled()
  })
})
