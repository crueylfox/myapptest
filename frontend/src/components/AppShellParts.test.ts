// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AppShell from './AppShell.vue'
import AppTopBar from './AppTopBar.vue'
import AppStatusBar from './AppStatusBar.vue'
import AppPanelHost from './AppPanelHost.vue'
import AppOverlayHost from './AppOverlayHost.vue'
import type { AppSettings, Connection, ContextMenuItem } from '../types'
import { defaultAlertSettings } from '../utils/alertSettings'
import { defaultShortcutSettings } from '../utils/shortcutSettings'

vi.mock('./WorkspaceTabs.vue', () => ({
  default: {
    name: 'WorkspaceTabs',
    props: ['alertUnreadCount'],
    emits: [
      'servers',
      'alerts',
      'monitorPanel',
      'tunnels',
      'docker',
      'processes',
      'systemServices',
      'networkDiagnostics',
      'navigate',
      'newTerminal',
      'reconnect',
      'editServer',
      'disconnectServer',
      'finalTerminalDisconnect',
      'contextOpen',
      'notify',
    ],
    template: `
      <header class="workspace-topbar">
        <button class="topbar-add" @click="$emit('servers', $event.currentTarget)">+</button>
        <button class="topbar-alerts" @click="$emit('alerts')">alerts {{ alertUnreadCount }}</button>
        <button class="topbar-menu" @click="$emit('navigate', 'logs')">menu</button>
      </header>
    `,
  },
}))

vi.mock('./TerminalWorkspace.vue', () => ({
  __esModule: true,
  name: 'TerminalWorkspace',
  __isTeleport: false,
  __isKeepAlive: false,
  default: {
    name: 'TerminalWorkspace',
    props: ['connection', 'visible', 'paneTargetAssignment'],
    emits: [
      'monitor',
      'alerts',
      'disconnectServer',
      'finalTerminalDisconnect',
      'openSftp',
      'reconnectSftp',
      'openTunnels',
      'processManager',
      'networkInterface',
      'networkDiagnostics',
      'networkInterfacesRefresh',
      'notify',
      'newTerminal',
      'reconnect',
      'trustHostKey',
      'paneAddServer',
      'paneConnectSaved',
      'paneOpenLocalTerminal',
      'connectWorkspace',
      'editWorkspace',
    ],
    template: '<section class="preserved-terminal-workspace"><slot name="tabs" /><button data-testid="connect-workspace" @click="$emit(\'connectWorkspace\', 1)">connect</button></section>',
  },
}))

vi.mock('./SettingsView.vue', () => ({
  default: {
    name: 'SettingsView',
    props: ['settings', 'saving', 'connections', 'overlay'],
    emits: [
      'closeRequest',
      'save',
      'saveAndClose',
      'previewTheme',
      'previewFontSize',
      'backupImported',
      'keyVaultDeleted',
      'terminalProfileDeleted',
      'testAlert',
      'testNativeNotification',
      'openLogs',
      'notify',
    ],
    template: '<section class="settings-view-stub" data-testid="settings-view-stub">settings <button data-testid="settings-open-logs" @click="$emit(\'openLogs\')">应用日志</button></section>',
  },
}))

vi.mock('./MonitorDashboard.vue', () => ({
  __esModule: true,
  name: 'MonitorDashboard',
  __isTeleport: false,
  __isKeepAlive: false,
  default: {
    name: 'MonitorDashboard',
    props: ['snapshot', 'history', 'alertUnreadCount'],
    emits: ['alerts'],
    template: '<section class="monitor-dashboard-stub">monitor <button data-testid="monitor-alert-center" @click="$emit(\'alerts\')">alerts {{ alertUnreadCount }}</button></section>',
  },
}))

vi.mock('./ErrorBoundary.vue', () => ({
  default: {
    name: 'ErrorBoundary',
    emits: ['error'],
    template: '<div class="error-boundary-stub"><slot /></div>',
  },
}))

vi.mock('./ServerPicker.vue', () => ({
  default: {
    name: 'ServerPicker',
    props: ['open', 'query'],
    emits: ['close', 'update:query', 'addServer', 'openServer'],
    template: '<section v-if="open" class="server-picker"><button data-testid="picker-close" @click="$emit(\'close\')">close</button></section>',
  },
}))

vi.mock('./ConnectionDialog.vue', () => ({
  default: {
    name: 'ConnectionDialog',
    props: ['open'],
    emits: ['close', 'save', 'deleteCredential'],
    template: '<section v-if="open" class="connection-modal">connection</section>',
  },
}))

vi.mock('./MultiServerDashboardDialog.vue', () => ({
  default: { name: 'MultiServerDashboardDialog', props: ['open'], template: '<section v-if="open" class="dashboard-dialog">dashboard</section>' },
}))
vi.mock('./TunnelManagerDialog.vue', () => ({
  default: { name: 'TunnelManagerDialog', props: ['open'], template: '<section v-if="open" class="tunnel-dialog">tunnel</section>' },
}))
vi.mock('./DockerManagerDialog.vue', () => ({
  default: {
    name: 'DockerManagerDialog',
    props: ['open'],
    emits: ['connectContainer'],
    template: '<section v-if="open" class="docker-dialog"><button data-testid="docker-connect-container" @click="$emit(\'connectContainer\', { serverID: 1, containerID: \'abc123\', containerName: \'web\' })">connect</button></section>',
  },
}))
vi.mock('./ProcessManagerDialog.vue', () => ({
  default: { name: 'ProcessManagerDialog', props: ['open'], template: '<section v-if="open" class="process-dialog">process</section>' },
}))
vi.mock('./ServiceManagerDialog.vue', () => ({
  default: { name: 'ServiceManagerDialog', props: ['open'], template: '<section v-if="open" class="service-dialog">service</section>' },
}))
vi.mock('./NetworkDetailsDialog.vue', () => ({
  default: { name: 'NetworkDetailsDialog', props: ['open'], template: '<section v-if="open" class="network-dialog">network</section>' },
}))
vi.mock('./AuthDialog.vue', () => ({
  default: { name: 'AuthDialog', props: ['open'], emits: ['close', 'submit'], template: '<section v-if="open" class="auth-dialog">auth</section>' },
}))
vi.mock('./ContextMenu.vue', () => ({
  default: { name: 'ContextMenu', props: ['x', 'y', 'items'], emits: ['close', 'select'], template: '<section class="context-menu">menu</section>' },
}))
vi.mock('./AlertCenter.vue', () => ({
  default: { name: 'AlertCenter', props: ['open'], emits: ['close'], template: '<section v-if="open" class="alert-center">alerts</section>' },
}))
vi.mock('./ToastHost.vue', () => ({
  default: { name: 'ToastHost', props: ['toast'], emits: ['close'], template: '<section v-if="toast" class="toast-host">toast</section>' },
}))
vi.mock('./AppDialogHost.vue', () => ({
  default: { name: 'AppDialogHost', template: '<section class="app-dialog-host">dialogs</section>' },
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
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

async function settleAsyncComponents() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await nextTick()
}

describe('App shell parts', () => {
  it('AppShell owns only the root layout and named slots', () => {
    const wrapper = mount(AppShell, {
      props: { terminalLayout: true },
      slots: {
        topbar: '<nav data-testid="topbar-slot">top</nav>',
        default: '<section data-testid="main-slot">main</section>',
        status: '<footer data-testid="status-slot">status</footer>',
        overlays: '<aside data-testid="overlay-slot">overlay</aside>',
      },
    })

    expect(wrapper.classes()).toContain('app-shell')
    expect(wrapper.classes()).toContain('terminal-layout')
    expect(wrapper.find('[data-testid="app-visual-root"]').exists()).toBe(true)
    expect(wrapper.get('main.content').classes()).toContain('terminal-mode')
    expect(wrapper.find('[data-testid="topbar-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="main-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="status-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="overlay-slot"]').exists()).toBe(true)
  })

  it('AppTopBar forwards WorkspaceTabs events without owning business actions', async () => {
    const wrapper = mount(AppTopBar, { props: { alertUnreadCount: 3 } })

    await wrapper.get('.topbar-add').trigger('click')
    await wrapper.get('.topbar-alerts').trigger('click')
    await wrapper.get('.topbar-menu').trigger('click')

    expect(wrapper.emitted('servers')).toHaveLength(1)
    expect(wrapper.emitted('alerts')).toHaveLength(1)
    expect(wrapper.emitted('navigate')).toEqual([[['logs'][0]]])
  })

  it('AppStatusBar renders status items in order and forwards actions', async () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        items: [
          { id: 'alerts', label: 'Alerts', count: 2 },
          { id: 'transfers', label: 'Transfers' },
        ],
      },
    })

    expect(wrapper.findAll('.app-status-item').map((item) => item.text())).toEqual(['Alerts2', 'Transfers'])
    await wrapper.get('[data-status-action="transfers"]').trigger('click')
    expect(wrapper.emitted('action')).toEqual([['transfers']])
  })

  it('AppPanelHost renders terminal, monitor, and logs panels from props and emits actions', async () => {
    const wrapper = mount(AppPanelHost, {
      props: {
        activeView: 'terminals',
        terminal: {
          connection,
          state: null,
          snapshot: null,
          history: [],
          layoutRevision: 1,
          sftpOpenRevision: 0,
          terminalCopyOnSelectEnabled: true,
          terminalRightClickPasteEnabled: true,
          shortcutSettings: settings.shortcutSettings,
          commandHistoryMaxEntries: 2000,
          connections: [connection],
          connectionStates: {},
          terminalProfiles: [],
          defaultTerminalProfile: null,
          terminalProfileApplyRevision: 0,
          networkInterfaces: [],
          networkInterfacePreference: null,
          networkInterfacesLoading: false,
          alertActiveCount: 0,
          paneTargetAssignment: null,
        },
        monitor: {
          selected: null,
          snapshot: null,
          history: [],
          alertUnreadCount: 0,
        },
        logs: {
          levelFilter: 'all',
          query: '',
          entries: [],
        },
      },
      slots: {
        tabs: '<nav data-testid="terminal-tabs">tabs</nav>',
      },
    })
    await settleAsyncComponents()

    expect(wrapper.find('.preserved-terminal-workspace').exists()).toBe(true)
    expect(wrapper.find('[data-testid="terminal-tabs"]').exists()).toBe(true)

    await wrapper.get('[data-testid="connect-workspace"]').trigger('click')
    expect(wrapper.emitted('connectWorkspace')).toEqual([[1]])

    await wrapper.setProps({ activeView: 'logs' })
    expect(wrapper.find('.logs-panel').exists()).toBe(true)
  })

  it('AppPanelHost forwards monitor dashboard alert center events', async () => {
    const wrapper = mount(AppPanelHost, {
      props: {
        activeView: 'monitor',
        terminal: {
          connection,
          state: null,
          snapshot: null,
          history: [],
          layoutRevision: 1,
          sftpOpenRevision: 0,
          terminalCopyOnSelectEnabled: true,
          terminalRightClickPasteEnabled: true,
          shortcutSettings: settings.shortcutSettings,
          commandHistoryMaxEntries: 2000,
          connections: [connection],
          connectionStates: {},
          terminalProfiles: [],
          defaultTerminalProfile: null,
          terminalProfileApplyRevision: 0,
          networkInterfaces: [],
          networkInterfacePreference: null,
          networkInterfacesLoading: false,
          alertActiveCount: 0,
          paneTargetAssignment: null,
        },
        monitor: {
          selected: connection,
          snapshot: null,
          history: [],
          alertUnreadCount: 4,
        },
        logs: {
          levelFilter: 'all',
          query: '',
          entries: [],
        },
      },
    })
    await settleAsyncComponents()

    const button = wrapper.get('[data-testid="monitor-alert-center"]')
    expect(button.text()).toContain('4')

    await button.trigger('click')

    expect(wrapper.emitted('alerts')).toEqual([[]])
  })

  it('AppOverlayHost renders top-level overlays and forwards close events', async () => {
    const menuItems: ContextMenuItem[] = [{ id: 'edit', label: 'Edit' }]
    const wrapper = mount(AppOverlayHost, {
      props: {
        serverPicker: {
          open: true,
          anchor: null,
          groups: [],
          statuses: {},
          activeServerId: null,
          localTerminalEnabled: false,
          query: '',
          targetPaneMode: false,
        },
        settings: {
          open: true,
          settings,
          saving: false,
          connections: [connection],
          nativeNotificationStatus: {
            initialized: false,
            available: false,
            message: 'disabled',
          },
        },
        connectionDialog: {
          open: true,
          connection: null,
          groups: [],
          settings,
          terminalProfiles: [],
          connections: [connection],
        },
        contextMenu: {
          open: true,
          x: 10,
          y: 20,
          items: menuItems,
        },
        alertCenter: {
          open: true,
          activeEvents: [],
          resolvedEvents: [],
          allEvents: [],
        },
        toast: null,
        busy: true,
        toolDialogs: {
          activeServerId: 1,
          connections: [connection],
          connectionStates: {},
          tunnelsOpen: false,
          dockerOpen: true,
          processesOpen: false,
          servicesOpen: false,
          networkDetailsOpen: false,
          processInitialPid: null,
        },
      },
    })

    expect(wrapper.find('.server-picker').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-view-stub"]').exists()).toBe(true)
    expect(wrapper.find('.connection-modal').exists()).toBe(true)
    expect(wrapper.find('.context-menu').exists()).toBe(true)
    expect(wrapper.find('.alert-center').exists()).toBe(true)
    expect(wrapper.find('.app-dialog-host').exists()).toBe(true)
    expect(wrapper.find('.busy').exists()).toBe(true)

    await wrapper.get('[data-testid="picker-close"]').trigger('click')
    expect(wrapper.emitted('serverPickerClose')).toHaveLength(1)

    await wrapper.get('[data-testid="settings-open-logs"]').trigger('click')
    expect(wrapper.emitted('settingsOpenLogs')).toEqual([[]])

    await wrapper.get('[data-testid="docker-connect-container"]').trigger('click')
    expect(wrapper.emitted('dockerConnectContainer')).toEqual([[
      { serverID: 1, containerID: 'abc123', containerName: 'web' },
    ]])
  })
})
