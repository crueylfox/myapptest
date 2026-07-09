// @vitest-environment jsdom

import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import ServerPicker from './components/ServerPicker.vue'
import { resolveAppDialog } from './composables/useAppDialog'
import { setInitialSettings } from './settingsBootstrap'
import { defaultAlertSettings } from './utils/alertSettings'
import { defaultShortcutSettings } from './utils/shortcutSettings'
import type { AppSettings, Connection } from './types'

vi.mock('../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('./components/TerminalWorkspace.vue', () => ({
  __esModule: true,
  __isTeleport: false,
  default: {
    name: 'TerminalWorkspace',
    template: '<section class="workspace-shell"><slot name="tabs" /><div class="terminal-empty">empty</div></section>',
  },
}))

const settings: AppSettings = {
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
  settingsVersion: 13,
  onboardingCompleted: true,
  trustOnFirstUseAcknowledged: false,
}
const connection: Connection = {
  id: 1, groupId: null, name: 'server', host: '192.0.2.1', port: 22,
  username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
  hostKeyFingerprint: '', credentialSaved: false, refreshInterval: 2,
  createdAt: '', updatedAt: '',
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await nextTick()
}

describe('App UI overlays', () => {
  let wrapper: ReturnType<typeof mount> | undefined

  beforeEach(() => {
    localStorage.clear()
    setInitialSettings(settings)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    window.go = {
      main: {
        App: {
          ListGroups: vi.fn(async () => []),
          ListConnections: vi.fn(async () => [connection]),
          ListTerminalProfiles: vi.fn(async () => []),
          DeleteConnection: vi.fn(async () => undefined),
          DisconnectServer: vi.fn(async () => undefined),
          PersistWindowState: vi.fn(async () => undefined),
          BeginAlertSession: vi.fn(async () => undefined),
          ListAlertHistory: vi.fn(async () => []),
          PersistAlertHistoryEvent: vi.fn(async () => ({ prunedCount: 0 })),
          MarkAlertHistoryRead: vi.fn(async () => undefined),
          MarkAllAlertHistoryRead: vi.fn(async () => undefined),
          ClearResolvedAlertHistory: vi.fn(async () => undefined),
          LogFrontendError: vi.fn(async () => undefined),
          GetLocalTerminalCapabilities: vi.fn(async () => ({
            platform: 'windows',
            enabled: false,
            supported: false,
            conptyAvailable: false,
            isProcessElevated: false,
            supportsElevation: false,
            shellOptions: [],
            adminShellOptions: [],
            defaultShellPreference: 'auto',
            currentShellPreference: 'auto',
            unsupportedMessage: 'LOCAL_TERMINAL_DISABLED: 本地终端暂未启用',
          })),
          GetStartupLocalTerminalRequest: vi.fn(async () => ({ shellKind: '' })),
          RelaunchElevatedLocalTerminal: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  afterEach(async () => {
    resolveAppDialog(null)
    await nextTick()
    wrapper?.unmount()
    wrapper = undefined
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  async function render() {
    wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
    })
    await settle()
    return wrapper
  }

  async function openPicker(wrapper: ReturnType<typeof mount>) {
    await wrapper.get('.topbar-add').trigger('click')
    await settle()
    expect(document.body.querySelector('.server-picker')).not.toBeNull()
  }

  it('does not render host-key policy onboarding or a residual overlay on first startup', async () => {
    setInitialSettings({ ...settings, onboardingCompleted: false, hostKeyPolicy: 'auto_update' })
    const wrapper = await render()

    expect(wrapper.find('.onboarding-modal').exists()).toBe(false)
    expect(document.body.querySelector('.onboarding-modal')).toBeNull()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
    expect(document.body.querySelector('[inert]')).toBeNull()
  })

  it('closes the server picker on an outside pointerdown', async () => {
    const wrapper = await render()
    await openPicker(wrapper)
    wrapper.get('.terminal-empty').element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    )
    await settle()
    expect(wrapper.findComponent(ServerPicker).props('open')).toBe(false)
    expect(document.body.querySelector('.server-picker')).toBeNull()
  })

  it('closes the picker before opening the add-server modal', async () => {
    const wrapper = await render()
    await openPicker(wrapper)
    document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')[0].click()
    await settle()
    expect(document.body.querySelector('.server-picker')).toBeNull()
    expect(document.body.querySelector('.connection-modal')).not.toBeNull()
  })

  it('keeps local terminal entries visible but disabled while the feature is disabled', async () => {
    const wrapper = await render()
    await openPicker(wrapper)
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')
    expect(actions).toHaveLength(4)
    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      'CMD',
      'PowerShell',
    ])
    expect(actions[2].disabled).toBe(true)
    expect(actions[3].disabled).toBe(true)
    actions[2].click()
    actions[3].click()
    expect(wrapper.findComponent(ServerPicker).emitted('openLocalTerminal')).toBeUndefined()
  })

  it('shows local terminal entries when the saved server list is empty', async () => {
    window.go!.main!.App!.ListConnections = vi.fn(async () => []) as never
    window.go!.main!.App!.GetLocalTerminalCapabilities = vi.fn(async () => ({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: false,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd' },
        { id: 'powershell', label: 'PowerShell', description: 'PowerShell' },
      ],
      adminShellOptions: [],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })) as never

    const wrapper = await render()
    await openPicker(wrapper)
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')

    expect([...actions].map((item) => item.textContent)).toEqual([
      '添加服务器',
      '添加分组',
      'CMD',
      'PowerShell',
    ])
    expect(actions[2].disabled).toBe(false)
    expect(actions[3].disabled).toBe(false)
  })

  it('shows and opens productized local terminal entries when capabilities are supported', async () => {
    window.go!.main!.App!.GetLocalTerminalCapabilities = vi.fn(async () => ({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: false,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd' },
        { id: 'powershell', label: 'PowerShell', description: 'PowerShell' },
      ],
      adminShellOptions: [
        { id: 'cmd-admin', label: 'CMD（管理员）', description: 'admin cmd' },
        { id: 'powershell-admin', label: 'PowerShell（管理员）', description: 'admin powershell' },
      ],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })) as never
    window.go!.main!.App!.OpenLocalTerminal = vi.fn(async () => ({
      sessionId: 'local-ui-1',
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      elevated: false,
      title: 'CMD',
      status: 'running',
      cwd: 'C:\\Users\\Administrator',
      startedAt: '2026-06-18T00:00:00Z',
    })) as never

    const wrapper = await render()
    await openPicker(wrapper)
    const actions = document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')
    expect(actions).toHaveLength(4)
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('CMD')
    expect(document.body.querySelector('.server-picker')?.textContent).toContain('PowerShell')
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('关闭')
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('CMD（管理员）')
    expect(document.body.querySelector('.server-picker')?.textContent).not.toContain('PowerShell（管理员）')

    actions[2].click()
    await settle()

    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledWith({
      shellKind: 'cmd',
      elevated: false,
      shell: '',
      cwd: '',
      cols: 100,
      rows: 30,
    })
    expect(wrapper.findComponent(ServerPicker).props('open')).toBe(false)
  })

  it('passes elevated=true from settings when the current process is elevated', async () => {
    setInitialSettings({ ...settings, localTerminalElevatedEnabled: true })
    window.go!.main!.App!.GetLocalTerminalCapabilities = vi.fn(async () => ({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: true,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd' },
        { id: 'powershell', label: 'PowerShell', description: 'PowerShell' },
      ],
      adminShellOptions: [],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })) as never
    window.go!.main!.App!.OpenLocalTerminal = vi.fn(async () => ({
      sessionId: 'local-ui-2',
      shellKind: 'powershell',
      shell: 'PowerShell（管理员）',
      shellName: 'powershell.exe',
      elevated: true,
      title: 'PowerShell（管理员）',
      status: 'running',
      cwd: 'C:\\Users\\Administrator',
      startedAt: '2026-06-18T00:00:00Z',
    })) as never

    const wrapper = await render()
    await openPicker(wrapper)
    document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')[3].click()
    await settle()

    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledWith({
      shellKind: 'powershell',
      elevated: true,
      shell: '',
      cwd: '',
      cols: 100,
      rows: 30,
    })
  })

  it('consumes startup local terminal request after elevated relaunch', async () => {
    setInitialSettings({ ...settings, localTerminalElevatedEnabled: true })
    window.go!.main!.App!.GetLocalTerminalCapabilities = vi.fn(async () => ({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: true,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd' },
        { id: 'powershell', label: 'PowerShell', description: 'PowerShell' },
      ],
      adminShellOptions: [],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })) as never
    window.go!.main!.App!.GetStartupLocalTerminalRequest = vi.fn(async () => ({ shellKind: 'cmd' })) as never
    window.go!.main!.App!.OpenLocalTerminal = vi.fn(async () => ({
      sessionId: 'local-startup-1',
      shellKind: 'cmd',
      shell: 'CMD（管理员）',
      shellName: 'cmd.exe',
      elevated: true,
      title: 'CMD（管理员）',
      status: 'running',
      cwd: 'C:\\Users\\Administrator',
      startedAt: '2026-06-18T00:00:00Z',
    })) as never

    await render()
    await settle()

    expect(window.go?.main?.App?.GetStartupLocalTerminalRequest).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledWith({
      shellKind: 'cmd',
      elevated: true,
      shell: '',
      cwd: '',
      cols: 100,
      rows: 30,
    })
  })

  it('uses an in-app explanation for settings-driven admin local terminals when not elevated', async () => {
    setInitialSettings({ ...settings, localTerminalElevatedEnabled: true })
    window.go!.main!.App!.GetLocalTerminalCapabilities = vi.fn(async () => ({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: false,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd' },
        { id: 'powershell', label: 'PowerShell', description: 'PowerShell' },
      ],
      adminShellOptions: [],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })) as never
    window.go!.main!.App!.OpenLocalTerminal = vi.fn(async () => ({})) as never

    const wrapper = await render()
    await openPicker(wrapper)
    document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')[2].click()
    await settle()

    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.RelaunchElevatedLocalTerminal).not.toHaveBeenCalled()
    expect(document.body.querySelector('.app-dialog')?.textContent).toContain('管理员模式需要以管理员身份重新启动 HostDeck')

    resolveAppDialog(true)
    await settle()
    expect(window.go?.main?.App?.RelaunchElevatedLocalTerminal).toHaveBeenCalledWith({ shellKind: 'cmd' })
    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
  })

  it('opens the custom add-group dialog without native prompt', async () => {
    const nativePrompt = vi.spyOn(window, 'prompt')
    const wrapper = await render()
    await openPicker(wrapper)
    document.body.querySelectorAll<HTMLButtonElement>('.server-picker-actions button')[1].click()
    await settle()
    expect(document.body.querySelector('.server-picker')).toBeNull()
    expect(document.body.querySelector('.app-dialog')?.textContent).toContain('添加分组')
    expect(nativePrompt).not.toHaveBeenCalled()
  })

  it('uses a custom danger confirmation for delete and removes test from context menu', async () => {
    const wrapper = await render()
    await openPicker(wrapper)
    const row = document.body.querySelector<HTMLElement>('.server-row')!
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await settle()
    expect(document.body.querySelector('.server-picker')).not.toBeNull()
    expect(document.body.querySelector('.context-menu')?.textContent).not.toContain('娴嬭瘯杩炴帴')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(document.body.querySelector('.context-menu')).toBeNull()
    expect(document.body.querySelector('.server-picker')).not.toBeNull()

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await settle()
    document.body.querySelector<HTMLInputElement>('.server-picker input')?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    )
    await settle()
    expect(document.body.querySelector('.context-menu')).toBeNull()
    expect(document.body.querySelector('.server-picker')).not.toBeNull()

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await settle()
    document.body.querySelectorAll<HTMLButtonElement>('.context-menu button')[3].dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    )
    document.body.querySelectorAll<HTMLButtonElement>('.context-menu button')[3].click()
    await settle()
    expect(document.body.querySelector('.context-menu')).toBeNull()
    expect(document.body.querySelector('.server-picker')).not.toBeNull()

    document.body.querySelector<HTMLButtonElement>('.server-row-actions .danger-link')?.click()
    await settle()
    expect(document.body.querySelector('.server-picker')).toBeNull()
    expect(document.body.querySelector('.danger-modal')?.textContent).toContain('删除服务器')
  })
})
