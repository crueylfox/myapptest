// @vitest-environment jsdom

import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import SettingsView from './components/SettingsView.vue'
import WorkspaceTabs from './components/WorkspaceTabs.vue'
import { setInitialSettings } from './settingsBootstrap'
import { useServerStore } from './stores/server'
import { defaultAlertSettings } from './utils/alertSettings'
import { defaultShortcutSettings } from './utils/shortcutSettings'
import type { AppSettings, Connection } from './types'

const terminalLifecycle = vi.hoisted(() => ({
  mounted: vi.fn(),
  unmounted: vi.fn(),
}))

vi.mock('../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

vi.mock('./components/MonitorDashboard.vue', () => ({
  default: {
    name: 'MonitorDashboard',
    template: '<div class="monitor-dashboard-stub" />',
  },
}))

vi.mock('./components/TerminalWorkspace.vue', () => ({
  __esModule: true,
  __isTeleport: false,
  default: {
    name: 'TerminalWorkspace',
    props: ['visible'],
    data: () => ({ pendingLine: '' }),
    mounted() {
      terminalLifecycle.mounted()
    },
    beforeUnmount() {
      terminalLifecycle.unmounted()
    },
    template: `
      <section class="terminal-workspace-stub">
        <slot name="tabs" />
        <input class="terminal-buffer-probe" v-model="pendingLine" />
      </section>
    `,
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
  id: 1,
  groupId: null,
  name: 'server',
  host: '192.0.2.1',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: 'SHA256:test',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await nextTick()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('terminal view preservation across app navigation', () => {
  let wrapper: ReturnType<typeof mount> | undefined

  beforeEach(() => {
    localStorage.clear()
    terminalLifecycle.mounted.mockClear()
    terminalLifecycle.unmounted.mockClear()
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
          GetSettings: vi.fn(async () => settings),
          ListTunnelProfiles: vi.fn(async () => []),
          ListTerminalProfiles: vi.fn(async () => []),
          ListLogs: vi.fn(async () => []),
          OpenTerminal: vi.fn(async () => {
            throw new Error('navigation must not open a terminal')
          }),
          CloseTerminal: vi.fn(async () => {
            throw new Error('navigation must not close a terminal')
          }),
          DisconnectServer: vi.fn(async () => undefined),
          ListKeyVaultEntries: vi.fn(async () => []),
          PersistWindowState: vi.fn(async () => undefined),
          BeginAlertSession: vi.fn(async () => undefined),
          ListAlertHistory: vi.fn(async () => []),
          PersistAlertHistoryEvent: vi.fn(async () => ({ prunedCount: 0 })),
          MarkAlertHistoryRead: vi.fn(async () => undefined),
          MarkAllAlertHistoryRead: vi.fn(async () => undefined),
          ClearResolvedAlertHistory: vi.fn(async () => undefined),
          GetLocalTerminalCapabilities: vi.fn(async () => ({
            platform: 'windows',
            enabled: false,
            supported: false,
            shellOptions: [],
            defaultShellPreference: 'auto',
            currentShellPreference: 'auto',
            unsupportedMessage: 'LOCAL_TERMINAL_DISABLED: 本地终端暂未启用',
          })),
          GetStartupLocalTerminalRequest: vi.fn(async () => ({ shellKind: '' })),
          RelaunchElevatedLocalTerminal: vi.fn(async () => undefined),
          LogFrontendError: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  afterEach(() => {
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

  async function navigate(view: 'terminals' | 'monitor' | 'logs' | 'settings') {
    wrapper!.findComponent(WorkspaceTabs).vm.$emit('navigate', view)
    await settle()
  }

  it('does not unmount the terminal workspace when switching to monitor, logs, or settings', async () => {
    const wrapper = await render()
    expect(terminalLifecycle.mounted).toHaveBeenCalledTimes(1)

    await navigate('monitor')
    await navigate('logs')
    await navigate('settings')
    await navigate('terminals')

    expect(wrapper.find('.terminal-buffer-probe').exists()).toBe(true)
    expect(terminalLifecycle.mounted).toHaveBeenCalledTimes(1)
    expect(terminalLifecycle.unmounted).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('preserves unsubmitted English and Chinese terminal input across page navigation', async () => {
    const wrapper = await render()
    const input = wrapper.get<HTMLInputElement>('.terminal-buffer-probe')
    await input.setValue('echo SHOULD_STAY')

    await navigate('monitor')
    expect(wrapper.get<HTMLInputElement>('.terminal-buffer-probe').element.value).toBe('echo SHOULD_STAY')

    await navigate('terminals')
    expect(wrapper.get<HTMLInputElement>('.terminal-buffer-probe').element.value).toBe('echo SHOULD_STAY')

    await wrapper.get<HTMLInputElement>('.terminal-buffer-probe').setValue('中文未回车')
    await navigate('settings')
    await navigate('terminals')

    expect(wrapper.get<HTMLInputElement>('.terminal-buffer-probe').element.value).toBe('中文未回车')
    expect(terminalLifecycle.unmounted).not.toHaveBeenCalled()
  })

  it('opens settings as an overlay without hiding or remounting the terminal workspace', async () => {
    const wrapper = await render()
    await wrapper.get<HTMLInputElement>('.terminal-buffer-probe').setValue('echo overlay-keeps-input')

    await navigate('settings')

    expect(wrapper.find('[data-testid="settings-overlay"]').exists()).toBe(true)
    expect(wrapper.find('.terminal-workspace-hidden').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('.terminal-buffer-probe').element.value).toBe('echo overlay-keeps-input')
    expect(terminalLifecycle.mounted).toHaveBeenCalledTimes(1)
    expect(terminalLifecycle.unmounted).not.toHaveBeenCalled()

    await wrapper.get('.settings-close-button').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="settings-overlay"]').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('.terminal-buffer-probe').element.value).toBe('echo overlay-keeps-input')
  })

  it('keeps the app log refresh button compact and preserves refresh behavior', async () => {
    const wrapper = await render()

    await navigate('logs')

    const filters = wrapper.get('.log-filters')
    expect(filters.find('select').exists()).toBe(true)
    expect(filters.get('input').attributes('placeholder')).toBe('搜索服务器、操作或错误码')

    const refresh = filters.get('button.app-log-refresh-button')
    expect(refresh.text()).toBe('刷新')
    expect(refresh.classes()).toContain('secondary')
    expect(window.go?.main?.App?.ListLogs).toHaveBeenCalledTimes(1)

    await refresh.trigger('click')
    await settle()

    expect(window.go?.main?.App?.ListLogs).toHaveBeenCalledTimes(2)
  })

  it('closes the app logs panel without refreshing or clearing filters', async () => {
    const logs = [{
      time: '2026-07-01T00:00:00Z',
      level: 'error',
      message: 'connection failed',
      summary: 'Deploy failed',
      serverName: 'server',
      operation: 'deploy',
      errorCode: 'DEPLOY_FAILED',
    }]
    window.go!.main!.App!.ListLogs = vi.fn(async () => logs) as never
    const wrapper = await render()

    await navigate('logs')

    const filters = wrapper.get('.log-filters')
    const level = filters.get<HTMLSelectElement>('select')
    const search = filters.get<HTMLInputElement>('input')
    await level.setValue('error')
    await search.setValue('deploy')
    expect(useServerStore().logs).toHaveLength(1)

    const close = filters.get('button.app-log-close-button')
    expect(close.text()).toBe('关闭')
    expect(close.text()).not.toBe('X')
    expect(close.classes()).toContain('secondary')

    await close.trigger('click')
    await settle()

    expect(wrapper.find('.logs-panel').exists()).toBe(false)
    expect(wrapper.find('.terminal-workspace-hidden').exists()).toBe(false)
    expect(window.go?.main?.App?.ListLogs).toHaveBeenCalledTimes(1)
    expect(useServerStore().logs).toHaveLength(1)

    await navigate('logs')

    const reopenedFilters = wrapper.get('.log-filters')
    expect(reopenedFilters.get<HTMLSelectElement>('select').element.value).toBe('error')
    expect(reopenedFilters.get<HTMLInputElement>('input').element.value).toBe('deploy')
    expect(window.go?.main?.App?.ListLogs).toHaveBeenCalledTimes(2)
  })

  it('releases the settings overlay and busy state before showing the backup import toast', async () => {
    const wrapper = await render()
    await navigate('settings')
    expect(wrapper.find('[data-testid="settings-overlay"]').exists()).toBe(true)

    const loaded = { ...settings, themeMode: 'light' as const }
    const pendingSettings = deferred<AppSettings>()
    window.go!.main!.App!.GetSettings = vi.fn(() => pendingSettings.promise) as never

    wrapper.findComponent(SettingsView).vm.$emit('backupImported')
    await nextTick()
    expect(wrapper.find('.busy').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-overlay"]').exists()).toBe(true)

    pendingSettings.resolve(loaded)
    await settle()

    expect(window.go?.main?.App?.GetSettings).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ListConnections).toHaveBeenCalled()
    expect(window.go?.main?.App?.ListTunnelProfiles).toHaveBeenCalled()
    expect(window.go?.main?.App?.ListAlertHistory).toHaveBeenCalled()
    expect(window.go?.main?.App?.ListTerminalProfiles).toHaveBeenCalled()
    expect(wrapper.find('.busy').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-overlay"]').exists()).toBe(false)
    expect(document.body.querySelector('.settings-overlay-backdrop')).toBeNull()
    expect(document.body.querySelector('.toast-host')?.textContent).toContain('备份导入完成')
    expect((document.body as HTMLElement & { inert?: boolean }).inert).not.toBe(true)
    expect(document.body.style.pointerEvents).not.toBe('none')
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
