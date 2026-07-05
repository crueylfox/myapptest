import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useServerRuntimeActions } from './useServerRuntimeActions'
import { usePaneTargetRequests } from './usePaneTargetRequests'
import type { AppSettings, AuthRequest, AuthenticationState, Connection, ConnectionError, ConnectionRuntimeState } from '../types'
import { createDefaultAppSettings } from '../utils/defaultAppSettings'

const emptyAuth = (): AuthRequest => ({
  password: '',
  passphrase: '',
  trustUnknownHost: false,
  rememberSecret: false,
})

const connection = (values: Partial<Connection> = {}): Connection => ({
  id: 7,
  groupId: null,
  name: 'server',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  terminalProfileId: null,
  connectionMode: 'direct',
  jumpServerId: null,
  hostKeyFingerprint: '',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
  ...values,
})

const runtimeState = (values: Partial<ConnectionRuntimeState> = {}): ConnectionRuntimeState => ({
  connectionId: 7,
  status: 'offline',
  monitorActive: false,
  terminalActive: false,
  terminalConnecting: false,
  sftpActive: false,
  connecting: false,
  hasActiveSession: false,
  updatedAt: '',
  ...values,
})

const authState = (values: Partial<AuthenticationState> = {}): AuthenticationState => ({
  connectionId: 7,
  canAuthenticate: true,
  credentialSaved: true,
  credentialUsable: true,
  privateKeyEncrypted: false,
  hostTrusted: true,
  reasonCode: '',
  message: '',
  ...values,
})

const connectionError = (values: Partial<ConnectionError> = {}): ConnectionError => ({
  code: 'CONNECTION_TIMEOUT',
  userMessage: 'network failed',
  technicalMessage: '',
  retryable: true,
  serverId: 7,
  operation: 'terminal',
  timestamp: '',
  ...values,
})

function createRuntime(overrides: Partial<Parameters<typeof useServerRuntimeActions>[0]> = {}) {
  const item = connection()
  const settings = ref<AppSettings>(createDefaultAppSettings())
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const paneTargets = usePaneTargetRequests()
  const terminalTabs = ref<Array<{ sessionId: string; connectionId: number; status?: string; connectionError?: ConnectionError }>>([])
  const reconnectFileContextsAfterTerminalOnline = vi.fn(async () => undefined)
  const deps: Parameters<typeof useServerRuntimeActions>[0] = {
    settings,
    activeView,
    pendingPaneOpenTarget: paneTargets.pendingPaneOpenTarget,
    clearPendingPaneOpenTarget: paneTargets.clearPendingPaneOpenTarget,
    pendingForAction: paneTargets.pendingForAction,
    publishPaneTargetAssignment: paneTargets.publishPaneTargetAssignment,
    connections: () => [item],
    findConnection: (id) => id === item.id ? item : null,
    selectedConnectionId: () => item.id,
    selectConnection: vi.fn(),
    connectionState: () => runtimeState(),
    workspaceStatus: () => undefined,
    hasWorkspace: () => false,
    findTerminalByConnection: vi.fn(() => null),
    activateTerminal: vi.fn(),
    openTerminalSession: vi.fn(async () => ({ sessionId: 'ssh-1', status: 'online' })),
    reconnectTerminalSession: vi.fn(async () => ({ sessionId: 'ssh-1', status: 'online' })),
    disconnectTerminalServer: vi.fn(async () => undefined),
    terminalTabs: () => terminalTabs.value,
    clearActiveWorkspace: vi.fn(),
    syncConnectionState: vi.fn(),
    resumeServer: vi.fn(),
    markDisconnected: vi.fn(),
    connectMonitor: vi.fn(async () => undefined),
    disconnectMonitor: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => ({ success: true, latencyMillis: 12, errorCode: '', message: '', connectionError: undefined })),
    clearSftpServer: vi.fn(),
    clearTunnelServer: vi.fn(),
    clearDockerServer: vi.fn(),
    clearProcessServer: vi.fn(),
    sftpState: vi.fn(() => ({ status: 'offline' })),
    sftpOpen: vi.fn(async () => undefined),
    sftpReconnect: vi.fn(async () => undefined),
    sftpMarkAuthRequired: vi.fn(),
    reconnectableSftpContexts: vi.fn(() => []),
    markTerminalFileReconnectPending: vi.fn(),
    clearTerminalFileReconnectPending: vi.fn(),
    authenticationStateFor: vi.fn(async () => authState()),
    probeReconnectReachability: vi.fn(async () => true),
    credentialPromptReachabilityAllowed: vi.fn(async () => true),
    requestAuth: vi.fn(),
    requestAuthForState: vi.fn(async () => true),
    trustHostKeyAndRun: vi.fn(async (_connection, action) => { if (action) await action(_connection) }),
    showConnectionError: vi.fn(),
    showToast: vi.fn(),
    run: vi.fn(async (action: () => Promise<void>) => { await action() }),
    ...overrides,
  }
  return {
    ...paneTargets,
    item,
    terminalTabs,
    activeView,
    reconnectFileContextsAfterTerminalOnline,
    deps,
    runtime: useServerRuntimeActions(deps),
  }
}

describe('useServerRuntimeActions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects a saved server through the existing silent SSH monitor flow', async () => {
    const ctx = createRuntime()

    await ctx.runtime.connectServer(ctx.item)

    expect(ctx.deps.selectConnection).toHaveBeenCalledWith(ctx.item.id)
    expect(ctx.deps.connectMonitor).toHaveBeenCalledWith(ctx.item.id, emptyAuth())
  })

  it('opens AuthDialog for credential reconnect errors', async () => {
    const terminalError = connectionError({
      code: 'PASSWORD_REQUIRED',
      userMessage: 'password required',
      retryable: false,
    })
    const ctx = createRuntime()
    ctx.terminalTabs.value = [{ sessionId: 'ssh-1', connectionId: 7, connectionError: terminalError }]

    await ctx.runtime.reconnectTerminal('ssh-1', 7, 'PASSWORD_REQUIRED')

    expect(ctx.deps.requestAuth).toHaveBeenCalledWith(
      'terminal-reconnect',
      7,
      'password required',
    )
    expect(ctx.deps.probeReconnectReachability).not.toHaveBeenCalled()
  })

  it('does not open AuthDialog when a reconnect network precheck fails', async () => {
    const requestAuth = vi.fn()
    const reconnectTerminalSession = vi.fn()
    const ctx = createRuntime({
      requestAuth,
      reconnectTerminalSession,
      probeReconnectReachability: vi.fn(async () => false),
    })

    await ctx.runtime.reconnectTerminal('ssh-1', 7, 'CONNECTION_TIMEOUT')

    expect(requestAuth).not.toHaveBeenCalled()
    expect(reconnectTerminalSession).not.toHaveBeenCalled()
  })

  it('reconnect success refreshes eligible SFTP contexts but reconnect failure does not', async () => {
    const sftpReconnect = vi.fn(async () => undefined)
    const success = createRuntime({
      sftpReconnect,
      reconnectableSftpContexts: vi.fn(() => [{
        contextId: 'ssh-1',
        terminalSessionId: 'ssh-1',
      }]),
    })

    await success.runtime.reconnectTerminalAndSyncFiles('ssh-1', 7, emptyAuth())
    expect(sftpReconnect).toHaveBeenCalledWith(7, emptyAuth(), 'ssh-1', 'ssh-1')

    const failedReconnect = vi.fn(async () => { throw new Error('offline') })
    const failure = createRuntime({
      reconnectTerminalSession: failedReconnect,
      sftpReconnect: vi.fn(),
      reconnectableSftpContexts: vi.fn(() => [{
        contextId: 'ssh-1',
        terminalSessionId: 'ssh-1',
      }]),
    })
    await expect(failure.runtime.reconnectTerminalAndSyncFiles('ssh-1', 7, emptyAuth())).rejects.toThrow('offline')
    expect(failure.deps.sftpReconnect).not.toHaveBeenCalled()
  })

  it('pane-targeted new SSH terminal publishes assignment and takes precedence over first-empty auto-fill', async () => {
    const ctx = createRuntime()
    const target = ctx.beginPaneOpenTarget('pane-a', 'connect-saved')

    await ctx.runtime.newTerminal(7, target)

    expect(ctx.paneTargetAssignment.value).toMatchObject({
      paneId: 'pane-a',
      kind: 'ssh',
      sessionId: 'ssh-1',
    })
    expect(ctx.activeView.value).toBe('terminals')
  })

  it('waits for the first terminal handshake before starting monitor and SFTP bootstrap', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const tabs = ref<Array<{ sessionId: string; connectionId: number; status?: string }>>([])
    const connectMonitor = vi.fn(async () => { calls.push('monitor') })
    const sftpOpen = vi.fn(async () => { calls.push('sftp') })
    const ctx = createRuntime({
      terminalTabs: () => tabs.value,
      openTerminalSession: vi.fn(async () => {
        calls.push('terminal')
        tabs.value = [{ sessionId: 'ssh-1', connectionId: 7, status: 'connecting' }]
        return { sessionId: 'ssh-1', status: 'connecting' }
      }),
      connectMonitor,
      sftpOpen,
      sftpState: vi.fn(() => ({ status: 'offline' })),
    })

    const opened = await ctx.runtime.ensureMonitorAndOpenTerminal(ctx.item, emptyAuth())
    await Promise.resolve()

    expect(opened.sessionId).toBe('ssh-1')
    expect(connectMonitor).not.toHaveBeenCalled()
    expect(sftpOpen).not.toHaveBeenCalled()
    expect(calls).toEqual(['terminal'])

    tabs.value = [{ sessionId: 'ssh-1', connectionId: 7, status: 'online' }]
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(connectMonitor).toHaveBeenCalledWith(7, emptyAuth())
    expect(sftpOpen).toHaveBeenCalledWith(7, emptyAuth(), 'ssh-1', 'ssh-1')
    expect(calls).toEqual(['terminal', 'monitor', 'sftp'])
  })

  it('keeps original navigate fallback to monitor when no terminal tab exists but monitor is active', () => {
    const ctx = createRuntime({
      connectionState: () => runtimeState({ monitorActive: true }),
      findTerminalByConnection: vi.fn(() => null),
      navigateTerminalToServer: vi.fn(() => null),
    })

    ctx.runtime.navigateServer(ctx.item)

    expect(ctx.activeView.value).toBe('monitor')
  })

  it('disconnect server uses the injected user-initiated disconnect path and clears dependent frontend contexts', async () => {
    const ctx = createRuntime()

    await ctx.runtime.disconnectServer(ctx.item, false)

    expect(ctx.deps.disconnectTerminalServer).toHaveBeenCalledWith(ctx.item.id, false)
    expect(ctx.deps.clearSftpServer).toHaveBeenCalledWith(ctx.item.id)
    expect(ctx.deps.clearTunnelServer).toHaveBeenCalledWith(ctx.item.id)
    expect(ctx.deps.clearDockerServer).toHaveBeenCalledWith(ctx.item.id)
    expect(ctx.deps.clearProcessServer).toHaveBeenCalledWith(ctx.item.id)
    expect(ctx.deps.markDisconnected).toHaveBeenCalledWith(ctx.item.id)
  })
})
