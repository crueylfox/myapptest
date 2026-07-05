// @vitest-environment jsdom

import { createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import ServerPicker from './components/ServerPicker.vue'
import { resolveAppDialog, useAppDialog } from './composables/useAppDialog'
import { setInitialSettings } from './settingsBootstrap'
import { useServerStore } from './stores/server'
import { useSftpStore } from './stores/sftp'
import { useTerminalStore } from './stores/terminal'
import { useAlertStore } from './stores/alerts'
import { defaultAlertSettings } from './utils/alertSettings'
import { defaultShortcutSettings } from './utils/shortcutSettings'
import { encodeTerminalInputToBase64 } from './utils/terminalEncoding'
import type {
  AppSettings,
  AuthenticationState,
  Connection,
  ConnectionRuntimeState,
  MonitorSnapshot,
} from './types'

vi.mock('../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('./components/MonitorDashboard.vue', () => ({
  __esModule: true,
  __isTeleport: false,
  default: {
    name: 'MonitorDashboard',
    props: ['snapshot', 'history', 'alertUnreadCount'],
    emits: ['alerts'],
    template: `
      <div class="monitor-dashboard-stub">
        <span data-testid="app-detail-snapshot">{{ snapshot ? snapshot.connectionId + ':' + snapshot.cpuPercent : 'empty' }}</span>
        <span data-testid="app-detail-history">{{ history.length }}</span>
        <button data-testid="monitor-alert-center" @click="$emit('alerts')">alerts {{ alertUnreadCount }}</button>
      </div>
    `,
  },
}))
vi.mock('./components/TerminalWorkspace.vue', () => ({
  default: {
    name: 'TerminalWorkspace',
    props: ['paneTargetAssignment'],
    emits: ['paneAddServer', 'paneConnectSaved', 'paneOpenLocalTerminal'],
    template: '<div class="terminal-workspace-stub"><slot name="tabs" /></div>',
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
const connections: Connection[] = [
  {
    id: 1,
    groupId: null,
    name: 'server-1',
    host: '192.0.2.1',
    port: 22,
    username: 'root',
    authType: 'password',
    privateKeySource: 'local_file',
    privateKeyPath: '',
    keyVaultId: null,
    hostKeyFingerprint: 'SHA256:one',
    credentialSaved: true,
    refreshInterval: 2,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 2,
    groupId: null,
    name: 'server-2',
    host: '192.0.2.2',
    port: 22,
    username: 'root',
    authType: 'password',
    privateKeySource: 'local_file',
    privateKeyPath: '',
    keyVaultId: null,
    hostKeyFingerprint: 'SHA256:two',
    credentialSaved: true,
    refreshInterval: 2,
    createdAt: '',
    updatedAt: '',
  },
]

function authenticationState(connectionId: number): AuthenticationState {
  return {
    connectionId,
    canAuthenticate: true,
    credentialSaved: true,
    credentialUsable: true,
    privateKeyEncrypted: false,
    hostTrusted: true,
    reasonCode: '',
    message: '',
  }
}

function runtimeState(
  connectionId: number,
  values: Partial<ConnectionRuntimeState> = {},
): ConnectionRuntimeState {
  return {
    connectionId,
    status: 'offline',
    monitorActive: false,
    terminalActive: false,
    terminalConnecting: false,
    sftpActive: false,
    connecting: false,
    hasActiveSession: false,
    updatedAt: '',
    ...values,
  }
}

function monitorSnapshot(connectionId: number): MonitorSnapshot {
  return {
    connectionId,
    status: 'online',
    timestamp: new Date('2026-06-20T00:00:00Z').toISOString(),
    latencyMillis: 18,
    latencyAvailable: true,
    cpuPercent: connectionId === 1 ? 22 : 44,
    memoryTotal: 8 * 1024 ** 3,
    memoryAvailable: 4 * 1024 ** 3,
    memoryUsedPercent: 50,
    swapTotal: 0,
    swapFree: 0,
    diskTotal: 80 * 1024 ** 3,
    diskUsed: 40 * 1024 ** 3,
    diskUsedPercent: 50,
    mounts: [],
    processes: [],
    processStatus: 'available',
    processMessage: '',
    loadOne: 0.1,
    loadFive: 0.2,
    loadFifteen: 0.3,
    uptimeSeconds: 3600,
    defaultInterface: 'eth0',
    downloadBytesPerSecond: 1024,
    uploadBytesPerSecond: 2048,
    osName: 'Ubuntu',
    kernel: '6.8.0',
    architecture: 'x86_64',
    errors: [],
    errorCode: '',
    message: '',
    monitorActive: true,
  }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('server list navigation', () => {
  beforeEach(() => {
    setInitialSettings(settings)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    let terminalSequence = 0
    window.go = {
      main: {
        App: {
          ListGroups: vi.fn(async () => []),
          ListConnections: vi.fn(async () => connections),
          ListTerminalProfiles: vi.fn(async () => []),
          GetAuthenticationState: vi.fn(async (id: number) => authenticationState(id)),
          OpenTerminal: vi.fn(async (request: { connectionId: number }) => ({
            sessionId: `session-${++terminalSequence}`,
            connectionId: request.connectionId,
            title: `server-${request.connectionId}`,
            status: 'connecting',
            code: '',
            message: '',
          })),
          WriteTerminal: vi.fn(async () => undefined),
          Connect: vi.fn(async () => undefined),
          OpenSftp: vi.fn(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId,
            terminalSessionId: request.terminalSessionId,
            status: 'online',
            active: true,
            currentPath: '/home/demo',
            message: 'SFTP 已连接',
            updatedAt: '',
          })),
          ReconnectSftp: vi.fn(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId,
            terminalSessionId: request.terminalSessionId,
            generation: 2,
            status: 'online',
            active: true,
            currentPath: '/home/demo',
            message: 'SFTP reconnected',
            updatedAt: '',
          })),
          ReadSftpDir: vi.fn(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId,
            terminalSessionId: request.terminalSessionId,
            path: request.path,
            parentPath: '/home',
            entries: [],
          })),
          SaveConnectionConfig: vi.fn(async (request: { connection: Connection; connectAfterSave: boolean }) => ({
            connection: {
              ...(connections.find((item) => item.id === request.connection.id) ?? {}),
              ...request.connection,
              credentialSaved: true,
              createdAt: '',
              updatedAt: 'saved',
            },
            connectAfterSave: request.connectAfterSave,
          })),
          SaveSettings: vi.fn(async (value: AppSettings) => value),
          DisconnectServer: vi.fn(async () => undefined),
          CloseTerminal: vi.fn(async () => undefined),
          PersistWindowState: vi.fn(async () => undefined),
          BeginAlertSession: vi.fn(async () => undefined),
          ListAlertHistory: vi.fn(async () => []),
          PersistAlertHistoryEvent: vi.fn(async () => ({ prunedCount: 0 })),
          MarkAlertHistoryRead: vi.fn(async () => undefined),
          MarkAllAlertHistoryRead: vi.fn(async () => undefined),
          ClearResolvedAlertHistory: vi.fn(async () => undefined),
          ReconnectTerminal: vi.fn(async () => {
            throw new Error('unexpected reconnect')
          }),
          OpenLocalTerminal: vi.fn(async (request: { shellKind: string }) => ({
            sessionId: `local-${request.shellKind}-1`,
            shellKind: request.shellKind,
            shell: request.shellKind === 'cmd' ? 'cmd.exe' : 'powershell.exe',
            shellName: request.shellKind === 'cmd' ? 'cmd.exe' : 'powershell.exe',
            title: request.shellKind === 'cmd' ? 'CMD' : 'PowerShell',
            cwd: 'C:\\Users\\Administrator',
            elevated: false,
            status: 'running',
            startedAt: '2026-06-29T00:00:00Z',
          })),
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
          ProbeConnectionReachability: vi.fn(async () => ({ reachable: true })),
          LogFrontendError: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  async function mountApp() {
    const pinia = createPinia()
    const wrapper = shallowMount(App, {
      global: {
        plugins: [pinia],
        stubs: {
          AppShell: false,
          AppTopBar: false,
          AppStatusBar: false,
          AppPanelHost: false,
          AppOverlayHost: false,
          TerminalWorkspace: {
            name: 'TerminalWorkspace',
            props: ['paneTargetAssignment'],
            emits: [
              'monitor',
              'editWorkspace',
              'finalTerminalDisconnect',
              'reconnect',
              'openSftp',
              'reconnectSftp',
              'paneAddServer',
              'paneConnectSaved',
              'paneOpenLocalTerminal',
            ],
            template: '<div class="terminal-workspace-stub"><slot name="tabs" /></div>',
          },
          WorkspaceTabs: {
            name: 'WorkspaceTabs',
            emits: ['monitorPanel', 'alerts', 'servers', 'navigate'],
            template: '<div class="workspace-tabs-stub" />',
          },
          AlertCenter: {
            name: 'AlertCenter',
            props: ['open', 'allEvents'],
            emits: ['viewMonitor'],
            template: '<section v-if="open" data-testid="alert-center-open"><button v-if="allEvents.length" class="alert-view-stub" @click="$emit(\'viewMonitor\', allEvents[0])">view</button></section>',
          },
          ErrorBoundary: {
            name: 'ErrorBoundary',
            emits: ['error'],
            template: '<div class="error-boundary-stub"><slot /></div>',
          },
          MultiServerDashboardDialog: false,
          MonitorDashboard: false,
        },
      },
    })
    await settle()
    return {
      wrapper,
      serverStore: useServerStore(pinia),
      sftpStore: useSftpStore(pinia),
      terminalStore: useTerminalStore(pinia),
      alertStore: useAlertStore(pinia),
    }
  }

  async function openConnection(
    wrapper: Awaited<ReturnType<typeof mountApp>>['wrapper'],
    connectionId: number,
  ) {
    wrapper.findComponent(ServerPicker).vm.$emit(
      'openServer',
      connections.find((connection) => connection.id === connectionId),
    )
    await settle()
  }

  async function openMonitorPanelFromTopTabs(wrapper: Awaited<ReturnType<typeof mountApp>>['wrapper']) {
    wrapper.findComponent({ name: 'WorkspaceTabs' }).vm.$emit('monitorPanel')
    await settle()
  }

  async function openMonitorPanelFromStatusbar(wrapper: Awaited<ReturnType<typeof mountApp>>['wrapper']) {
    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('monitor')
    await settle()
  }

  it('server menu single click uses the unified open or activate path', async () => {
    const { wrapper, terminalStore } = await mountApp()
    await openConnection(wrapper, 2)

    expect(terminalStore.activeWorkspaceServerId).toBe(2)
    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
  })

  it('automatically opens SFTP after SSH terminal opens successfully', async () => {
    const { wrapper } = await mountApp()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockResolvedValueOnce({
      sessionId: 'session-1',
      connectionId: 2,
      title: 'server-2',
      status: 'online',
      code: '',
      message: '',
    })
    await openConnection(wrapper, 2)
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 100))
    await settle()

    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenSftp).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenSftp).toHaveBeenCalledWith({
      connectionId: 2,
      contextId: 'session-1',
      terminalSessionId: 'session-1',
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
  })

  it('does not open the credential dialog before network reachability is confirmed during initial terminal open', async () => {
    const { wrapper } = await mountApp()
    vi.mocked(window.go!.main!.App!.GetAuthenticationState).mockResolvedValue({
      ...authenticationState(1),
      canAuthenticate: false,
      credentialSaved: false,
      credentialUsable: false,
      reasonCode: 'credential_unavailable',
      message: 'missing saved password',
    })
    vi.mocked(window.go!.main!.App!.ProbeConnectionReachability).mockResolvedValueOnce({
      reachable: false,
      connectionError: {
        code: 'CONNECTION_REFUSED',
        userMessage: 'connection refused',
        technicalMessage: 'dial tcp 43.161.195.207:7002: connectex: No connection could be made',
        retryable: true,
        serverId: 1,
        operation: 'terminal.open.probe',
        timestamp: '2026-06-27T00:00:00Z',
      },
    })

    await openConnection(wrapper, 1)
    await settle()

    expect(window.go?.main?.App?.ProbeConnectionReachability).toHaveBeenCalledWith(1)
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it('opens credentials during initial terminal open only after the SSH endpoint is reachable', async () => {
    const { wrapper } = await mountApp()
    vi.mocked(window.go!.main!.App!.GetAuthenticationState).mockResolvedValue({
      ...authenticationState(1),
      canAuthenticate: false,
      credentialSaved: false,
      credentialUsable: false,
      reasonCode: 'credential_unavailable',
      message: 'missing saved password',
    })
    vi.mocked(window.go!.main!.App!.ProbeConnectionReachability).mockResolvedValueOnce({ reachable: true })

    await openConnection(wrapper, 1)
    await settle()

    expect(window.go?.main?.App?.ProbeConnectionReachability).toHaveBeenCalledWith(1)
    const dialog = wrapper.findComponent({ name: 'AuthDialog' })
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('mode')).toBe('terminal')
  })

  it('does not auto-open another SFTP session when SFTP is already connecting or connected', async () => {
    const { wrapper } = await mountApp()
    await openConnection(wrapper, 1)
    await settle()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()
    vi.mocked(window.go!.main!.App!.OpenSftp).mockClear()

    await openConnection(wrapper, 1)
    await settle()

    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenSftp).not.toHaveBeenCalled()
  })

  it('opens saved servers from a target pane picker and assigns the new SSH tab to that pane', async () => {
    const { wrapper, terminalStore } = await mountApp()
    const workspace = wrapper.findComponent({ name: 'TerminalWorkspace' })

    workspace.vm.$emit('paneConnectSaved', 'pane-2')
    await settle()

    const picker = wrapper.findComponent(ServerPicker)
    expect(picker.props('open')).toBe(true)
    expect(picker.props('targetPaneMode')).toBe(true)

    picker.vm.$emit('openServer', connections[1])
    await settle()

    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 2,
    }))
    expect(terminalStore.tabs.map((tab) => tab.sessionId)).toContain('session-1')
    expect(workspace.props('paneTargetAssignment')).toMatchObject({
      paneId: 'pane-2',
      kind: 'ssh',
      sessionId: 'session-1',
    })
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
  })

  it('opens the pane-targeted saved server picker at the same visual anchor as the topbar add picker', async () => {
    const { wrapper } = await mountApp()
    const workspaceTabs = wrapper.findComponent({ name: 'WorkspaceTabs' })
    const workspace = wrapper.findComponent({ name: 'TerminalWorkspace' })
    const topbarAnchor = document.createElement('button')
    topbarAnchor.className = 'topbar-add'
    document.body.appendChild(topbarAnchor)

    workspaceTabs.vm.$emit('servers', topbarAnchor)
    await settle()
    let picker = wrapper.findComponent(ServerPicker)
    expect(picker.props('open')).toBe(true)
    expect(picker.props('anchor')).toBe(topbarAnchor)

    picker.vm.$emit('close')
    await settle()
    workspace.vm.$emit('paneConnectSaved', 'pane-2')
    await settle()

    picker = wrapper.findComponent(ServerPicker)
    expect(picker.props('open')).toBe(true)
    expect(picker.props('targetPaneMode')).toBe(true)
    expect(picker.props('anchor')).toBe(topbarAnchor)

    document.body.removeChild(topbarAnchor)
  })

  it('saves and connects a new server from a target pane and assigns the created SSH tab to that pane', async () => {
    const { wrapper } = await mountApp()
    const workspace = wrapper.findComponent({ name: 'TerminalWorkspace' })
    const createdConnection: Connection = {
      ...connections[0],
      id: 3,
      name: 'server-3',
      host: '192.0.2.3',
      hostKeyFingerprint: 'SHA256:three',
      credentialSaved: true,
    }
    vi.mocked(window.go!.main!.App!.SaveConnectionConfig).mockResolvedValueOnce({
      connection: createdConnection,
      connectAfterSave: true,
    })

    workspace.vm.$emit('paneAddServer', 'pane-3')
    await settle()
    const dialog = wrapper.findComponent({ name: 'ConnectionDialog' })
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('connection')).toBeNull()

    dialog.vm.$emit('save', {
      connection: createdConnection,
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
      connectAfterSave: true,
    })
    await settle()

    expect(window.go?.main?.App?.SaveConnectionConfig).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 3,
    }))
    expect(workspace.props('paneTargetAssignment')).toMatchObject({
      paneId: 'pane-3',
      kind: 'ssh',
      sessionId: 'session-1',
    })
  })

  it('saving a new server without connecting from a target pane does not occupy the pane', async () => {
    const { wrapper } = await mountApp()
    const workspace = wrapper.findComponent({ name: 'TerminalWorkspace' })
    vi.mocked(window.go!.main!.App!.SaveConnectionConfig).mockResolvedValueOnce({
      connection: {
        ...connections[0],
        id: 4,
        name: 'server-4',
      },
      connectAfterSave: false,
    })

    workspace.vm.$emit('paneAddServer', 'pane-4')
    await settle()
    wrapper.findComponent({ name: 'ConnectionDialog' }).vm.$emit('save', {
      connection: {
        ...connections[0],
        id: 4,
        name: 'server-4',
      },
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
      connectAfterSave: false,
    })
    await settle()

    expect(window.go?.main?.App?.SaveConnectionConfig).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(workspace.props('paneTargetAssignment')).toBeNull()
  })

  it('opens a local terminal from a target pane and assigns the new local session to that pane', async () => {
    vi.mocked(window.go!.main!.App!.GetLocalTerminalCapabilities).mockResolvedValueOnce({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: false,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd.exe' },
        { id: 'powershell', label: 'PowerShell', description: 'powershell.exe' },
      ],
      adminShellOptions: [],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })
    const { wrapper, terminalStore } = await mountApp()
    const workspace = wrapper.findComponent({ name: 'TerminalWorkspace' })

    workspace.vm.$emit('paneOpenLocalTerminal', 'pane-4', 'cmd')
    await settle()

    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledWith(expect.objectContaining({
      shellKind: 'cmd',
    }))
    expect(terminalStore.activeWorkspaceServerId).toBeNull()
    expect(workspace.props('paneTargetAssignment')).toMatchObject({
      paneId: 'pane-4',
      kind: 'local',
      sessionId: 'local-cmd-1',
    })
  })

  it('keeps local terminal creation target-aware from the saved-server picker', async () => {
    vi.mocked(window.go!.main!.App!.GetLocalTerminalCapabilities).mockResolvedValueOnce({
      platform: 'windows',
      enabled: true,
      supported: true,
      conptyAvailable: true,
      isProcessElevated: false,
      supportsElevation: true,
      shellOptions: [
        { id: 'cmd', label: 'CMD', description: 'cmd.exe' },
        { id: 'powershell', label: 'PowerShell', description: 'powershell.exe' },
      ],
      adminShellOptions: [],
      defaultShellPreference: 'auto',
      currentShellPreference: 'auto',
      unsupportedMessage: '',
    })
    const { wrapper } = await mountApp()
    const workspace = wrapper.findComponent({ name: 'TerminalWorkspace' })

    workspace.vm.$emit('paneConnectSaved', 'pane-2')
    await settle()
    const picker = wrapper.findComponent(ServerPicker)
    expect(picker.props('targetPaneMode')).toBe(true)
    expect(picker.props('localTerminalEnabled')).toBe(true)

    picker.vm.$emit('openLocalTerminal', 'powershell')
    await settle()

    expect(window.go?.main?.App?.OpenLocalTerminal).toHaveBeenCalledWith(expect.objectContaining({
      shellKind: 'powershell',
    }))
    expect(workspace.props('paneTargetAssignment')).toMatchObject({
      paneId: 'pane-2',
      kind: 'local',
      sessionId: 'local-powershell-1',
    })
  })

  it('does not open the SFTP credential dialog before reachability is confirmed', async () => {
    const { wrapper } = await mountApp()
    vi.mocked(window.go!.main!.App!.GetAuthenticationState).mockResolvedValue({
      ...authenticationState(1),
      canAuthenticate: false,
      credentialSaved: false,
      credentialUsable: false,
      reasonCode: 'credential_unavailable',
      message: 'missing saved password',
    })
    vi.mocked(window.go!.main!.App!.ProbeConnectionReachability).mockResolvedValueOnce({
      reachable: false,
      connectionError: {
        code: 'CONNECTION_TIMEOUT',
        userMessage: 'connection timed out',
        technicalMessage: 'dial tcp 43.161.195.207:7002: i/o timeout',
        retryable: true,
        serverId: 1,
        operation: 'sftp.open.probe',
        timestamp: '2026-06-27T00:00:00Z',
      },
    })

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('openSftp', 1)
    await settle()

    expect(window.go?.main?.App?.ProbeConnectionReachability).toHaveBeenCalledWith(1)
    expect(window.go?.main?.App?.OpenSftp).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it.each([
    'CONNECTION_TIMEOUT',
    'CONNECTION_REFUSED',
    'HANDSHAKE_FAILED',
    'SSH_ALGORITHM_UNSUPPORTED',
    'target_unreachable_through_jump',
    'jump_connection_failed',
  ])('does not open the credential dialog for %s during terminal reconnect', async (code) => {
    const { wrapper, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.GetAuthenticationState).mockResolvedValue({
      ...authenticationState(1),
      canAuthenticate: false,
      credentialSaved: false,
      credentialUsable: false,
      reasonCode: 'credential_unavailable',
      message: 'missing saved password',
    })
    vi.mocked(window.go!.main!.App!.GetAuthenticationState).mockClear()
    vi.mocked(window.go!.main!.App!.ReconnectTerminal).mockRejectedValueOnce(new Error('network still unavailable'))
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-timeout',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code,
      message: 'network failure',
    })
    terminalStore.activate('session-timeout')
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-timeout', 1, code)
    await settle()

    expect(window.go?.main?.App?.GetAuthenticationState).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it.each([
    'AUTH_FAILED',
    'target_auth_failed',
    'jump_auth_failed',
    'PASSPHRASE_INVALID',
    'PRIVATE_KEY_INVALID',
  ])('opens the credential dialog for %s during terminal reconnect', async (code) => {
    const { wrapper, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-auth',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code,
      message: 'auth failure',
    })
    terminalStore.activate('session-auth')
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-auth', 1, code)
    await settle()

    const dialog = wrapper.findComponent({ name: 'AuthDialog' })
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('mode')).toBe('terminal-reconnect')
  })

  it('does not describe missing credentials as saved credential rejection during terminal reconnect', async () => {
    const { wrapper, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-missing-credential',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code: 'CREDENTIAL_REQUIRED',
      message: 'password is required',
    })
    terminalStore.activate('session-missing-credential')
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-missing-credential', 1, 'CREDENTIAL_REQUIRED')
    await settle()

    const dialog = wrapper.findComponent({ name: 'AuthDialog' })
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('issue')).toContain('认证信息')
    expect(dialog.props('issue')).not.toContain('已保存的凭据被服务器拒绝')
  })

  it('describes private-key passphrase failures as local unlock failures during interactive reconnect', async () => {
    const keyConnection: Connection = {
      ...connections[0],
      id: 3,
      name: 'key-server',
      authType: 'private_key',
      privateKeyPath: 'C:/keys/server.pem',
      credentialSaved: true,
    }
    vi.mocked(window.go!.main!.App!.ListConnections).mockResolvedValueOnce([keyConnection])
    const { wrapper, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(keyConnection, 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-passphrase',
      connectionId: 3,
      title: 'key-server',
      status: 'error',
      code: 'PASSPHRASE_INVALID',
      message: 'passphrase failed',
    })
    terminalStore.activate('session-passphrase')
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-passphrase', 3, 'PASSPHRASE_INVALID')
    await settle()

    const dialog = wrapper.findComponent({ name: 'AuthDialog' })
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('issue')).toContain('私钥口令')
    expect(dialog.props('issue')).not.toContain('服务器拒绝')
  })

  it('does not prompt for passphrase when the server rejects a decryptable private key', async () => {
    const keyConnection: Connection = {
      ...connections[0],
      id: 4,
      name: 'key-rejected',
      authType: 'private_key',
      privateKeyPath: 'C:/keys/rejected.pem',
      credentialSaved: true,
    }
    vi.mocked(window.go!.main!.App!.ListConnections).mockResolvedValueOnce([keyConnection])
    const { wrapper, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(keyConnection, 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-key-rejected',
      connectionId: 4,
      title: 'key-rejected',
      status: 'error',
      code: 'AUTH_FAILED',
      message: 'key rejected',
      connectionError: {
        code: 'AUTH_FAILED',
        userMessage: '服务器拒绝当前密钥认证，请编辑凭据或选择其他密钥。',
        technicalMessage: 'ssh: unable to authenticate, attempted methods [none publickey]',
        retryable: false,
        serverId: 4,
        operation: 'terminal.reconnect',
        timestamp: '2026-06-27T00:00:00Z',
        credentialFromStore: true,
      },
    })
    terminalStore.activate('session-key-rejected')
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-key-rejected', 4, 'AUTH_FAILED')
    await settle()

    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it('stops terminal reconnect before credentials when pre-auth reachability still fails', async () => {
    const { wrapper, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.ProbeConnectionReachability).mockResolvedValueOnce({
      reachable: false,
      connectionError: {
        code: 'CONNECTION_TIMEOUT',
        userMessage: 'connection timed out',
        technicalMessage: 'dial tcp: i/o timeout',
        retryable: true,
        serverId: 1,
        operation: 'terminal.reconnect.probe',
        timestamp: '2026-06-26T00:00:00Z',
      },
    })
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-probe',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code: 'CONNECTION_TIMEOUT',
      message: 'timeout',
    })
    terminalStore.activate('session-probe')
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-probe', 1, 'CONNECTION_TIMEOUT')
    await settle()

    expect(window.go?.main?.App?.ProbeConnectionReachability).toHaveBeenCalledWith(1)
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it('does not open AuthDialog from a terminal status auth error event', async () => {
    const callbacks = new Map<string, (event: unknown) => void>()
    vi.mocked(EventsOn).mockImplementation((name: string, callback: (event: unknown) => void) => {
      callbacks.set(name, callback)
      return vi.fn()
    })
    const { wrapper, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(connections[0], 'connected')
    terminalStore.tabs.push({
      sessionId: 'session-status-auth',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    terminalStore.activate('session-status-auth')
    await settle()

    callbacks.get('terminal:status')?.({
      sessionId: 'session-status-auth',
      connectionId: 1,
      status: 'error',
      code: 'PASSPHRASE_INVALID',
      message: 'saved passphrase failed',
      connectionError: {
        code: 'PASSPHRASE_INVALID',
        userMessage: '私钥口令错误，无法解密私钥。',
        technicalMessage: 'parse private key: incorrect passphrase',
        retryable: false,
        serverId: 1,
        operation: 'terminal.keepalive',
        timestamp: '2026-06-27T00:00:00Z',
        credentialFromStore: true,
      },
    })
    await settle()

    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it('does not open AuthDialog from a background connection state auth error', async () => {
    const callbacks = new Map<string, (event: unknown) => void>()
    vi.mocked(EventsOn).mockImplementation((name: string, callback: (event: unknown) => void) => {
      callbacks.set(name, callback)
      return vi.fn()
    })
    const { wrapper } = await mountApp()

    callbacks.get('connection:state')?.(runtimeState(1, {
      status: 'auth_failed',
      lastError: {
        code: 'AUTH_FAILED',
        userMessage: '服务器拒绝当前认证。',
        technicalMessage: 'ssh: unable to authenticate',
        retryable: false,
        serverId: 1,
        operation: 'monitor.credential',
        timestamp: '2026-06-27T00:00:00Z',
        credentialFromStore: true,
      },
    }))
    await settle()

    expect(wrapper.findComponent({ name: 'AuthDialog' }).props('open')).toBe(false)
  })

  it('automatically reconnects the active SFTP panel after terminal reconnect succeeds', async () => {
    const { wrapper, sftpStore, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.ReconnectTerminal).mockResolvedValueOnce({
      sessionId: 'session-sync',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-sync',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code: 'CONNECTION_CLOSED',
      message: 'closed',
    })
    terminalStore.activate('session-sync')
    sftpStore.stateByContextId['session-sync'] = {
      connectionId: 1,
      contextId: 'session-sync',
      terminalSessionId: 'session-sync',
      generation: 1,
      status: 'error',
      active: false,
      mode: 'sftp',
      capabilities: { browse: 'full', uploadFile: true, downloadFile: true, uploadDirectory: true, downloadDirectory: true, mkdir: true, rename: true, delete: true, editText: true },
      currentPath: '/srv/current',
      message: 'old runtime closed',
      updatedAt: '',
    }
    sftpStore.stateByServerId[1] = sftpStore.stateByContextId['session-sync']
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-sync', 1, 'CONNECTION_CLOSED')
    await settle()

    expect(window.go?.main?.App?.ReconnectTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectSftp).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectSftp).toHaveBeenCalledWith({
      connectionId: 1,
      contextId: 'session-sync',
      terminalSessionId: 'session-sync',
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 1,
      contextId: 'session-sync',
      terminalSessionId: 'session-sync',
      path: '/srv/current',
    }))
  })

  it('does not silently interrupt a running transfer during automatic file reconnect', async () => {
    const { wrapper, sftpStore, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.ReconnectTerminal).mockResolvedValueOnce({
      sessionId: 'session-running',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-running',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code: 'CONNECTION_CLOSED',
      message: 'closed',
    })
    terminalStore.activate('session-running')
    sftpStore.stateByContextId['session-running'] = {
      connectionId: 1,
      contextId: 'session-running',
      terminalSessionId: 'session-running',
      generation: 1,
      status: 'error',
      active: false,
      mode: 'sftp',
      capabilities: { browse: 'full', uploadFile: true, downloadFile: true, uploadDirectory: true, downloadDirectory: true, mkdir: true, rename: true, delete: true, editText: true },
      currentPath: '/srv/current',
      message: 'old runtime closed',
      updatedAt: '',
    }
    sftpStore.transfersById.running = {
      id: 'running',
      connectionId: 1,
      contextId: 'session-running',
      direction: 'upload',
      localPath: '',
      remotePath: '/srv/current/file.txt',
      fileName: 'file.txt',
      totalBytes: 100,
      transferredBytes: 20,
      percent: 20,
      speedBytesPerSecond: 1,
      status: 'running',
      errorMessage: '',
      startedAt: '',
      finishedAt: '',
    }
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-running', 1, 'CONNECTION_CLOSED')
    await settle()

    expect(window.go?.main?.App?.ReconnectTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectSftp).not.toHaveBeenCalled()
  })

  it('allows automatic file reconnect when previous transfers are already failed or canceled', async () => {
    const { wrapper, sftpStore, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.ReconnectTerminal).mockResolvedValueOnce({
      sessionId: 'session-finished',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-finished',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code: 'CONNECTION_CLOSED',
      message: 'closed',
    })
    terminalStore.activate('session-finished')
    sftpStore.stateByContextId['session-finished'] = {
      connectionId: 1,
      contextId: 'session-finished',
      terminalSessionId: 'session-finished',
      generation: 1,
      status: 'error',
      active: false,
      mode: 'scp',
      capabilities: { browse: 'full', uploadFile: true, downloadFile: true, uploadDirectory: true, downloadDirectory: true, mkdir: true, rename: true, delete: true, editText: true },
      currentPath: '/srv/current',
      message: 'old runtime closed',
      updatedAt: '',
    }
    sftpStore.transfersById.failed = {
      id: 'failed',
      connectionId: 1,
      contextId: 'session-finished',
      direction: 'download',
      localPath: '',
      remotePath: '/srv/current/file.txt',
      fileName: 'file.txt',
      totalBytes: 100,
      transferredBytes: 20,
      percent: 20,
      speedBytesPerSecond: 0,
      status: 'failed',
      errorMessage: 'connection closed',
      startedAt: '',
      finishedAt: '',
    }
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-finished', 1, 'CONNECTION_CLOSED')
    await settle()

    expect(window.go?.main?.App?.ReconnectTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectSftp).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectSftp).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 1,
      contextId: 'session-finished',
      terminalSessionId: 'session-finished',
    }))
  })

  it('does not automatically reconnect SFTP when terminal reconnect fails', async () => {
    const { wrapper, sftpStore, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.ReconnectTerminal).mockRejectedValueOnce(new Error('still down'))
    terminalStore.ensureWorkspace(connections[0], 'failed')
    terminalStore.tabs.push({
      sessionId: 'session-failed',
      connectionId: 1,
      title: 'server-1',
      status: 'error',
      code: 'CONNECTION_CLOSED',
      message: 'closed',
    })
    terminalStore.activate('session-failed')
    sftpStore.stateByContextId['session-failed'] = {
      connectionId: 1,
      contextId: 'session-failed',
      terminalSessionId: 'session-failed',
      generation: 1,
      status: 'error',
      active: false,
      mode: 'sftp',
      capabilities: { browse: 'full', uploadFile: true, downloadFile: true, uploadDirectory: true, downloadDirectory: true, mkdir: true, rename: true, delete: true, editText: true },
      currentPath: '/srv/current',
      message: 'old runtime closed',
      updatedAt: '',
    }
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('reconnect', 'session-failed', 1, 'CONNECTION_CLOSED')
    await settle()

    expect(window.go?.main?.App?.ReconnectTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectSftp).not.toHaveBeenCalled()
  })

  it('double click in the server menu opens at most one terminal', async () => {
    const { wrapper } = await mountApp()
    await openConnection(wrapper, 1)

    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
  })

  it('double click activates an existing online terminal without opening another', async () => {
    const { wrapper, terminalStore } = await mountApp()
    const terminal = await terminalStore.open(connections[0], {
      password: '',
      passphrase: '',
      trustUnknownHost: false,
      rememberSecret: false,
    })
    terminalStore.tabs[0].status = 'online'
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()

    await openConnection(wrapper, 1)

    expect(terminalStore.activeSessionId).toBe(terminal.sessionId)
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('double click on monitor-only online server creates one terminal', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    })

    await openConnection(wrapper, 1)
    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
  })

  it('double click while connecting does not create a duplicate terminal', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'connecting',
      terminalConnecting: true,
      connecting: true,
      hasActiveSession: true,
    })

    await openConnection(wrapper, 1)
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('single click on monitor-only server creates its missing terminal', async () => {
    const { wrapper, serverStore, terminalStore } = await mountApp()
    serverStore.states[2] = runtimeState(2, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    })

    await openConnection(wrapper, 2)

    await new Promise((resolve) => setTimeout(resolve, 0))
    await settle()
    expect(wrapper.find('main').classes()).toContain('terminal-mode')
    expect(terminalStore.activeWorkspaceServerId).toBe(2)
    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
  })

  it('repeated server-picker open events remain idempotent', async () => {
    const { wrapper } = await mountApp()
    await openConnection(wrapper, 1)
    await openConnection(wrapper, 1)

    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledTimes(1)
  })

  it('workspace activation does not create another connection', async () => {
    const { terminalStore } = await mountApp()
    terminalStore.navigateToServer(connections[0])
    await settle()
    expect(terminalStore.activeWorkspaceServerId).toBe(1)
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('opens the monitor panel from the top menu entry and defaults to server overview', async () => {
    const { wrapper } = await mountApp()
    const dashboard = wrapper.findComponent({ name: 'MultiServerDashboardDialog' })
    expect(dashboard.props('open')).toBe(false)

    await openMonitorPanelFromTopTabs(wrapper)

    expect(wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).props('open')).toBe(true)
    expect(wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).props('summaries')).toHaveLength(2)
    expect(wrapper.get('[data-testid="dashboard-tab-overview"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')).toHaveLength(2)
  })

  it('persists dashboard manual order changes through non-sensitive settings only', async () => {
    setInitialSettings({
      ...settings,
      dashboardSortMode: 'manual',
      dashboardManualServerOrder: ['2', '1'],
    })
    const { wrapper } = await mountApp()

    await openMonitorPanelFromTopTabs(wrapper)

    const dashboard = wrapper.findComponent({ name: 'MultiServerDashboardDialog' })
    expect(dashboard.props('dashboardSortMode')).toBe('manual')
    expect(dashboard.props('dashboardManualServerOrder')).toEqual(['2', '1'])

    dashboard.vm.$emit('dashboardLayoutChange', {
      sortMode: 'manual',
      manualServerOrder: ['1', '2'],
    })
    await settle()

    expect(window.go?.main?.App?.SaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      dashboardSortMode: 'manual',
      dashboardManualServerOrder: ['1', '2'],
    }))
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.Connect).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
  })

  it('monitor panel detail tab reads current monitor data without opening SSH', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, { status: 'online', monitorActive: true, hasActiveSession: true })
    serverStore.snapshots[1] = monitorSnapshot(1)
    serverStore.histories[1] = [monitorSnapshot(1)]
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()
    vi.mocked(window.go!.main!.App!.Connect).mockClear()

    await openMonitorPanelFromTopTabs(wrapper)
    await wrapper.get('[data-testid="dashboard-tab-detail"]').trigger('click')
    await settle()

    expect(wrapper.get('[data-testid="app-detail-snapshot"]').text()).toBe('1:22')
    expect(wrapper.get('[data-testid="app-detail-history"]').text()).toBe('1')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.Connect).not.toHaveBeenCalled()
  })

  it('bottom monitor status opens monitor panel detail for the active workspace without opening SSH', async () => {
    const { wrapper, serverStore, terminalStore } = await mountApp()
    terminalStore.navigateToServer(connections[1])
    serverStore.states[2] = runtimeState(2, { status: 'online', monitorActive: true, hasActiveSession: true })
    serverStore.snapshots[2] = monitorSnapshot(2)
    serverStore.histories[2] = [monitorSnapshot(2)]
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()
    vi.mocked(window.go!.main!.App!.Connect).mockClear()

    await openMonitorPanelFromStatusbar(wrapper)

    const dashboard = wrapper.findComponent({ name: 'MultiServerDashboardDialog' })
    expect(dashboard.props('open')).toBe(true)
    expect(dashboard.props('initialTab')).toBe('detail')
    expect(dashboard.props('initialServerId')).toBe(2)
    expect(wrapper.get('[data-testid="dashboard-tab-detail"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="dashboard-detail-server-select"]').element).toHaveProperty('value', '2')
    expect(wrapper.get('[data-testid="app-detail-snapshot"]').text()).toBe('2:44')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.Connect).not.toHaveBeenCalled()
  })

  it('opens alert center from the monitor view alert entry', async () => {
    const { wrapper, serverStore, alertStore } = await mountApp()
    serverStore.select(1)
    serverStore.states[1] = runtimeState(1, { status: 'online', monitorActive: true, hasActiveSession: true })
    serverStore.snapshots[1] = monitorSnapshot(1)
    serverStore.histories[1] = [monitorSnapshot(1)]
    alertStore.events.push({
      eventID: 'alert-monitor-entry',
      serverID: 1,
      serverName: 'server-1',
      ruleType: 'cpu_high',
      severity: 'warning',
      state: 'firing',
      title: 'CPU usage high',
      message: 'Synthetic monitor alert for UI routing.',
      currentValue: 91,
      threshold: 90,
      unit: '%',
      startedAt: new Date().toISOString(),
      read: false,
      muted: false,
      source: 'monitor',
    })

    wrapper.findComponent({ name: 'WorkspaceTabs' }).vm.$emit('navigate', 'monitor')
    await settle()

    const button = wrapper.get('[data-testid="monitor-alert-center"]')
    expect(button.text()).toContain('1')

    await button.trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="alert-center-open"]').exists()).toBe(true)
  })

  it('opens monitor detail from an alert without changing the active terminal', async () => {
    const { wrapper, serverStore, terminalStore, alertStore } = await mountApp()
    terminalStore.tabs.push(
      { sessionId: 'session-a', connectionId: 1, title: 'server-1', status: 'online', code: '', message: '' },
      { sessionId: 'session-b', connectionId: 2, title: 'server-2', status: 'online', code: '', message: '' },
    )
    terminalStore.activate('session-b')
    serverStore.snapshots[2] = monitorSnapshot(2)
    serverStore.histories[2] = [serverStore.snapshots[2]]
    alertStore.events.push({
      eventID: 'alert-2',
      serverID: 2,
      serverName: 'server-2',
      ruleType: 'cpu_high',
      severity: 'warning',
      state: 'firing',
      title: 'CPU 使用率过高',
      message: '服务器「server-2」CPU 已持续达到 95%。',
      currentValue: 95,
      threshold: 90,
      unit: '%',
      startedAt: new Date().toISOString(),
      read: false,
      muted: false,
      source: 'monitor',
    })
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()

    wrapper.findComponent({ name: 'WorkspaceTabs' }).vm.$emit('alerts')
    await settle()
    await wrapper.get('.alert-view-stub').trigger('click')
    await settle()

    const dashboard = wrapper.findComponent({ name: 'MultiServerDashboardDialog' })
    expect(dashboard.props('open')).toBe(true)
    expect(dashboard.props('initialTab')).toBe('detail')
    expect(dashboard.props('initialServerId')).toBe(2)
    expect(terminalStore.activeSessionId).toBe('session-b')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('dashboard switch activates an existing terminal without opening SSH', async () => {
    const { wrapper, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(connections[1], 'connected')
    terminalStore.tabs.push({
      sessionId: 'session-existing-2',
      connectionId: 2,
      title: 'server-2',
      status: 'online',
      code: '',
      message: '',
    })
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()
    vi.mocked(window.go!.main!.App!.Connect).mockClear()

    await openMonitorPanelFromTopTabs(wrapper)
    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('switchServer', 2)
    await settle()

    expect(terminalStore.activeWorkspaceServerId).toBe(2)
    expect(terminalStore.activeSessionId).toBe('session-existing-2')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.Connect).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).props('open')).toBe(false)
  })

  it('dashboard switch without an open terminal only selects the server and keeps the panel open', async () => {
    const { wrapper, serverStore, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()
    vi.mocked(window.go!.main!.App!.Connect).mockClear()

    await openMonitorPanelFromTopTabs(wrapper)
    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('switchServer', 2)
    await settle()

    expect(serverStore.selectedId).toBe(2)
    expect(terminalStore.activeWorkspaceServerId).toBeNull()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.Connect).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).props('open')).toBe(true)
    expect(wrapper.findComponent({ name: 'ToastHost' }).props('toast')).toMatchObject({
      message: '该服务器未打开终端',
      type: 'info',
    })
  })

  it('dashboard connect uses the existing connection flow without opening a terminal', async () => {
    const { wrapper } = await mountApp()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()
    vi.mocked(window.go!.main!.App!.Connect).mockClear()

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('connectServer', 2)
    await settle()

    expect(window.go?.main?.App?.Connect).toHaveBeenCalledWith({
      connectionId: 2,
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('dashboard disconnect confirms and calls DisconnectServer for only that server', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      terminalActive: true,
      hasActiveSession: true,
    })

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('disconnectServer', 1)
    await settle()
    expect(useAppDialog().dialog.value?.message).toBe('确定断开服务器「server-1」吗？')

    resolveAppDialog(true)
    await settle()

    expect(window.go?.main?.App?.DisconnectServer).toHaveBeenCalledWith(1)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalledWith(2)
    expect(serverStore.connectionState(1).status).toBe('disconnected')
  })

  it('dashboard batch connect skips online servers and reuses the existing connect flow', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    })
    serverStore.states[2] = runtimeState(2, { status: 'error' })
    vi.mocked(window.go!.main!.App!.Connect).mockClear()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('connectServers', [1, 2])
    await settle()

    expect(window.go?.main?.App?.Connect).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.Connect).toHaveBeenCalledWith({
      connectionId: 2,
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('dashboard on-demand reconnect skips online servers and reuses the existing connect flow', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    })
    serverStore.states[2] = runtimeState(2, { status: 'error' })
    vi.mocked(window.go!.main!.App!.Connect).mockClear()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockClear()

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('reconnectServers', [1, 2])
    await settle()

    expect(window.go?.main?.App?.Connect).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.Connect).toHaveBeenCalledWith({
      connectionId: 2,
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('dashboard batch disconnect confirms and calls DisconnectServer for online servers only', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      terminalActive: true,
      hasActiveSession: true,
    })
    serverStore.states[2] = runtimeState(2, { status: 'offline' })

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('disconnectServers', [1, 2], 'selected')
    await settle()
    expect(useAppDialog().dialog.value?.message).toBe('确定断开选中的 1 台服务器吗？')

    resolveAppDialog(true)
    await settle()

    expect(window.go?.main?.App?.DisconnectServer).toHaveBeenCalledWith(1)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalledWith(2)
    expect(serverStore.connectionState(1).status).toBe('disconnected')
  })

  it('dashboard edit opens the existing server edit dialog', async () => {
    const { wrapper } = await mountApp()

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('editServer', 1)
    await settle()

    expect(wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).props('open')).toBe(false)
    expect(wrapper.findComponent({ name: 'ConnectionDialog' }).props('connection')).toMatchObject({
      id: 1,
      name: 'server-1',
    })
  })

  it('dashboard detail shortcuts open existing tool dialogs for the requested server', async () => {
    const { wrapper, serverStore } = await mountApp()
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    })
    const dashboard = wrapper.findComponent({ name: 'MultiServerDashboardDialog' })

    dashboard.vm.$emit('openTunnels', 2)
    await settle()
    expect(wrapper.findComponent({ name: 'TunnelManagerDialog' }).props('open')).toBe(true)
    expect(wrapper.findComponent({ name: 'TunnelManagerDialog' }).props('activeServerId')).toBe(2)

    dashboard.vm.$emit('openDocker', 1)
    await settle()
    expect(wrapper.findComponent({ name: 'DockerManagerDialog' }).props('open')).toBe(true)
    expect(wrapper.findComponent({ name: 'DockerManagerDialog' }).props('activeServerId')).toBe(1)

    dashboard.vm.$emit('openProcesses', 2)
    await settle()
    expect(wrapper.findComponent({ name: 'ProcessManagerDialog' }).props('open')).toBe(true)
    expect(wrapper.findComponent({ name: 'ProcessManagerDialog' }).props('activeServerId')).toBe(2)

    dashboard.vm.$emit('openNetworkDiagnostics', 1)
    await settle()
    const networkDetails = wrapper.findComponent({ name: 'NetworkDetailsDialog' })
    expect(networkDetails.props('open')).toBe(true)
    expect(networkDetails.props('activeServerId')).toBe(1)
    expect(networkDetails.props('initialTab')).toBe('diagnostics')
  })

  it('container connect closes Docker manager, opens a fresh SSH terminal, and writes docker exec into the new terminal', async () => {
    const { wrapper, serverStore, terminalStore } = await mountApp()
    vi.mocked(window.go!.main!.App!.OpenTerminal).mockResolvedValueOnce({
      sessionId: 'session-second-container',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      terminalActive: true,
      hasActiveSession: true,
    })
    terminalStore.ensureWorkspace(connections[0], 'connected')
    terminalStore.tabs.push({
      sessionId: 'session-docker',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    terminalStore.activate('session-docker')

    wrapper.findComponent({ name: 'MultiServerDashboardDialog' }).vm.$emit('openDocker', 1)
    await settle()
    const dockerDialog = wrapper.findComponent({ name: 'DockerManagerDialog' })
    expect(dockerDialog.props('open')).toBe(true)

    dockerDialog.vm.$emit('connectContainer', { serverID: 1, containerID: 'abc123', containerName: 'web' })
    await settle()

    expect(wrapper.findComponent({ name: 'DockerManagerDialog' }).props('open')).toBe(false)
    expect(terminalStore.activeSessionId).toBe('session-second-container')
    expect(window.go?.main?.App?.OpenTerminal).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 1,
    }))
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'session-second-container',
      dataBase64: encodeTerminalInputToBase64(
        "docker exec -it abc123 sh -lc 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'\r",
      ),
    })
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-docker',
    }))
  })

  it('opens server editing from a workspace tab and saves without rebuilding active sessions', async () => {
    const { wrapper, serverStore, terminalStore } = await mountApp()
    terminalStore.ensureWorkspace(connections[0], 'connected')
    terminalStore.tabs.push({
      sessionId: 'session-edit',
      connectionId: 1,
      title: 'server-1',
      status: 'online',
      code: '',
      message: '',
    })
    terminalStore.activate('session-edit')
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    })
    await settle()

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('editWorkspace', 1)
    await settle()

    const dialog = wrapper.findComponent({ name: 'ConnectionDialog' })
    expect(dialog.props('connection')).toMatchObject({ id: 1, name: 'server-1' })

    dialog.vm.$emit('save', {
      connection: {
        ...connections[0],
        name: 'server-1-renamed',
        host: '192.0.2.10',
      },
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
      connectAfterSave: false,
    })
    await settle()

    expect(window.go?.main?.App?.SaveConnectionConfig).toHaveBeenCalledTimes(1)
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(terminalStore.tabs[0].title).toBe('server-1-renamed')
    expect(terminalStore.workspaces[1].serverName).toBe('server-1-renamed')
  })

  it('disconnects and clears monitor and SFTP state when the final terminal tab closes', async () => {
    const { wrapper, serverStore, sftpStore, terminalStore } = await mountApp()
    terminalStore.navigateToServer(connections[0])
    terminalStore.tabs.push(
      { sessionId: 'session-a', connectionId: 1, title: 'server-1', status: 'online', code: '', message: '' },
      { sessionId: 'session-b', connectionId: 2, title: 'server-2', status: 'online', code: '', message: '' },
    )
    terminalStore.ensureWorkspace(connections[1], 'connected')
    terminalStore.activate('session-b')
    serverStore.states[1] = runtimeState(1, {
      status: 'online',
      monitorActive: true,
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    })
    serverStore.states[2] = runtimeState(2, {
      status: 'online',
      monitorActive: true,
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    })
    serverStore.snapshots[1] = { connectionId: 1, status: 'online', timestamp: '', monitorActive: true } as never
    serverStore.snapshots[2] = { connectionId: 2, status: 'online', timestamp: '', monitorActive: true } as never
    serverStore.histories[1] = [serverStore.snapshots[1]]
    serverStore.histories[2] = [serverStore.snapshots[2]]
    sftpStore.stateByServerId[1] = {
      connectionId: 1,
      status: 'online',
      active: true,
      currentPath: '/srv/a',
      message: 'online',
      updatedAt: '',
    }
    sftpStore.stateByServerId[2] = {
      connectionId: 2,
      status: 'online',
      active: true,
      currentPath: '/srv/b',
      message: 'online',
      updatedAt: '',
    }
    sftpStore.transfersById.a = {
      id: 'a',
      connectionId: 1,
      direction: 'download',
      localPath: '',
      remotePath: '/srv/a/file',
      fileName: 'file',
      totalBytes: 1,
      transferredBytes: 0,
      percent: 0,
      speedBytesPerSecond: 0,
      status: 'running',
      errorMessage: '',
      startedAt: '',
      finishedAt: '',
    }

    wrapper.findComponent({ name: 'TerminalWorkspace' }).vm.$emit('finalTerminalDisconnect', 1)
    await settle()

    expect(window.go?.main?.App?.DisconnectServer).toHaveBeenCalledWith(1)
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(serverStore.connectionState(1)).toMatchObject({
      status: 'disconnected',
      monitorActive: false,
      terminalActive: false,
      sftpActive: false,
      hasActiveSession: false,
    })
    expect(serverStore.connectionState(2).status).toBe('online')
    expect(serverStore.snapshots[1]).toBeUndefined()
    expect(serverStore.histories[1]).toBeUndefined()
    expect(serverStore.snapshots[2]).toBeDefined()
    expect(sftpStore.stateByServerId[1]).toBeUndefined()
    expect(sftpStore.transfersById.a).toBeUndefined()
    expect(sftpStore.stateByServerId[2]?.status).toBe('online')
    expect(terminalStore.tabs.map((tab) => tab.sessionId)).toEqual(['session-b'])
    expect(terminalStore.activeWorkspaceServerId).toBe(2)
    expect(wrapper.findComponent(ServerPicker).props('statuses')).toMatchObject({
      1: 'disconnected',
      2: 'online',
    })

    serverStore.acceptSnapshot({ connectionId: 1, status: 'online', timestamp: '', monitorActive: true })
    serverStore.acceptConnectionState(runtimeState(1, {
      status: 'online',
      monitorActive: true,
      hasActiveSession: true,
    }))
    expect(serverStore.connectionState(1).status).toBe('disconnected')
    expect(serverStore.snapshots[1]).toBeUndefined()
  })
})
