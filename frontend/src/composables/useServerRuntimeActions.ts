import type { Ref } from 'vue'
import {
  authenticationIssue,
  canConnectSilently as canAuthConnectSilently,
  credentialPromptIssue,
  isCredentialError,
  isHostKeyError,
  isNonCredentialReconnectError,
  needsReachabilityBeforeCredentialPrompt,
  privateKeyRejectedIssue,
  shouldOpenInteractiveCredentialDialog,
  type AuthDialogMode,
} from './useAuthDialogController'
import type { PendingPaneOpenTarget, PaneTargetAssignment } from './usePaneTargetRequests'
import type {
  AppSettings,
  AuthenticationState,
  AuthRequest,
  Connection,
  ConnectionError,
  ConnectionReachabilityResult,
  ConnectionRuntimeState,
} from '../types'

type AppView = 'terminals' | 'monitor' | 'logs' | 'settings'
type ToastType = 'success' | 'error' | 'info'
type TerminalTabLike = {
  sessionId: string
  connectionId: number
  status?: string
  connectionError?: ConnectionError
}
type TerminalInfo = {
  sessionId: string
  status?: string
}
type ReconnectableSftpContext = {
  contextId: string
  terminalSessionId: string
}
type TerminalBootstrapResult = 'online' | 'failed' | 'missing' | 'timeout'

const terminalBootstrapPollMs = 25
const terminalBootstrapTimeoutMs = 20_000
const monitorToSftpBootstrapGapMs = 75

export function createEmptyAuth(): AuthRequest {
  return {
    password: '',
    passphrase: '',
    trustUnknownHost: false,
    rememberSecret: false,
  }
}

export interface ServerRuntimeActionsOptions {
  settings: Ref<AppSettings>
  activeView: Ref<AppView>
  pendingPaneOpenTarget: Ref<PendingPaneOpenTarget | null>
  clearPendingPaneOpenTarget: (target?: PendingPaneOpenTarget | null) => void
  pendingForAction: (action: 'connect-saved') => PendingPaneOpenTarget | null
  publishPaneTargetAssignment: (
    target: PendingPaneOpenTarget | null | undefined,
    kind: 'ssh',
    sessionId: string,
  ) => PaneTargetAssignment | null
  connections: () => Connection[]
  findConnection: (connectionId?: number | null) => Connection | null
  selectedConnectionId: () => number | null | undefined
  selectConnection: (connectionId: number) => void
  connectionState: (connectionId: number) => ConnectionRuntimeState
  workspaceStatus: (connectionId: number) => string | undefined
  hasWorkspace: (connectionId: number) => boolean
  findTerminalByConnection: (connectionId: number) => TerminalTabLike | null | undefined
  activeTerminalTab?: () => TerminalTabLike | null | undefined
  navigateTerminalToServer?: (connection: Connection) => TerminalTabLike | null | undefined
  clearActiveLocalTerminal?: () => void
  activateTerminal: (sessionId: string) => void
  openTerminalSession: (connection: Connection, auth: AuthRequest) => Promise<TerminalInfo>
  reconnectTerminalSession: (
    sessionId: string,
    connectionId: number,
    auth: AuthRequest,
    rows: number,
    cols: number,
  ) => Promise<TerminalInfo | null | undefined>
  disconnectTerminalServer: (connectionId: number, closeWorkspace: boolean) => Promise<void>
  terminalTabs: () => TerminalTabLike[]
  clearActiveWorkspace: () => void
  syncConnectionState: (connection: Connection, state: ConnectionRuntimeState) => void
  resumeServer: (connectionId: number) => void
  markDisconnected: (connectionId: number) => void
  connectMonitor: (connectionId: number, auth: AuthRequest) => Promise<void>
  disconnectMonitor: (connectionId: number) => Promise<void>
  markExpectedDisconnect?: (connectionId: number) => void
  testConnection: (
    connectionId: number,
    auth: AuthRequest,
  ) => Promise<{ success: boolean; latencyMillis: number; errorCode: string; message: string; connectionError?: ConnectionError }>
  clearSftpServer: (connectionId: number) => void
  clearTunnelServer: (connectionId: number) => void
  clearDockerServer: (connectionId: number) => void
  clearProcessServer: (connectionId: number) => void
  sftpState: (connectionId: number, contextId?: string) => { status?: string } | null | undefined
  sftpOpen: (
    connectionId: number,
    auth: AuthRequest,
    contextId?: string,
    terminalSessionId?: string,
  ) => Promise<unknown>
  sftpReconnect: (
    connectionId: number,
    auth: AuthRequest,
    contextId?: string,
    terminalSessionId?: string,
  ) => Promise<unknown>
  sftpMarkAuthRequired: (
    connectionId: number,
    issue: string,
    contextId?: string,
    terminalSessionId?: string,
  ) => void
  reconnectableSftpContexts: (
    connectionId: number,
    terminalSessionId: string,
  ) => ReconnectableSftpContext[]
  markTerminalFileReconnectPending: (connectionId: number, sessionId: string) => void
  clearTerminalFileReconnectPending: (connectionId: number, sessionId: string) => void
  readAuthenticationState?: (connectionId: number) => Promise<AuthenticationState>
  probeConnectionReachability?: (connectionId: number) => Promise<ConnectionReachabilityResult>
  authenticationStateFor?: (connectionId: number) => Promise<AuthenticationState | null>
  probeReconnectReachability?: (connectionId: number) => Promise<boolean>
  credentialPromptReachabilityAllowed?: (connectionId: number) => Promise<boolean>
  requestAuthForState?: (
    mode: AuthDialogMode,
    connectionId: number,
    state: AuthenticationState,
    sftpContextId?: string,
    sftpTerminalSessionId?: string,
    sftpReconnect?: boolean,
  ) => Promise<boolean>
  requestAuth: (
    mode: AuthDialogMode,
    connectionId?: number,
    issue?: string,
    sftpContextId?: string,
    sftpTerminalSessionId?: string,
    sftpReconnect?: boolean,
  ) => void
  setReconnectSessionId?: (sessionId: string | null) => void
  trustHostKeyAndRun: (
    connection: Connection,
    action?: (trustedConnection: Connection) => Promise<void>,
  ) => Promise<void>
  showConnectionError: (connectionError: ConnectionError | undefined, fallback: string) => void
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  errorMessage?: (reason: unknown, fallback: string) => string
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
}

export function useServerRuntimeActions(options: ServerRuntimeActionsOptions) {
  const activatingConnections = new Set<number>()
  const autoOpeningSftp = new Set<string>()
  let terminalReconnectSuccessSequence = 0

  function errorMessage(reason: unknown, fallback: string) {
    return options.errorMessage?.(reason, fallback) || String(reason).replace(/^Error:\s*/i, '').trim() || fallback
  }

  function hostPolicyAllows(connection: Connection) {
    return Boolean(connection || options.settings.value.hostKeyPolicy)
  }

  function canConnectSilently(state: AuthenticationState) {
    return canAuthConnectSilently(state, options.settings.value.hostKeyPolicy)
  }

  function delay(ms: number) {
    return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))
  }

  function terminalBootstrapStatus(
    sessionId: string,
    connectionId: number,
    fallback?: string,
  ): TerminalBootstrapResult | null {
    const tab = options.terminalTabs().find((item) =>
      item.sessionId === sessionId && item.connectionId === connectionId)
    if (!tab) {
      if (fallback === 'online') return 'online'
      if (fallback === 'error' || fallback === 'offline' || fallback === 'disconnected') return 'failed'
      return 'missing'
    }
    const status = tab.status ?? fallback
    if (status === 'online') return 'online'
    if (status === 'error' || status === 'offline' || status === 'disconnected') return 'failed'
    return null
  }

  async function waitForTerminalBootstrap(
    sessionId: string,
    connectionId: number,
    fallback?: string,
  ): Promise<TerminalBootstrapResult> {
    const initial = terminalBootstrapStatus(sessionId, connectionId, fallback)
    if (initial) return initial
    const deadline = Date.now() + terminalBootstrapTimeoutMs
    while (Date.now() < deadline) {
      await delay(terminalBootstrapPollMs)
      const status = terminalBootstrapStatus(sessionId, connectionId, fallback)
      if (status) return status
    }
    return 'timeout'
  }

  async function continueTerminalBootstrap(
    connection: Connection,
    auth: AuthRequest,
    terminal: TerminalInfo,
    shouldStartMonitor: boolean,
  ) {
    const terminalBootstrap = await waitForTerminalBootstrap(terminal.sessionId, connection.id, terminal.status)
    if (terminalBootstrap !== 'online') return
    let monitorRequested = false
    if (shouldStartMonitor) {
      try {
        await options.connectMonitor(connection.id, auth)
        monitorRequested = true
      } catch {
        return
      }
    }
    if (monitorRequested) await delay(monitorToSftpBootstrapGapMs)
    await autoOpenSftpForServer(connection, auth, terminal.sessionId)
  }

  async function authenticationStateFor(connectionId: number): Promise<AuthenticationState | null> {
    if (options.authenticationStateFor) return options.authenticationStateFor(connectionId)
    try {
      return await options.readAuthenticationState!(connectionId)
    } catch (reason) {
      options.showToast(errorMessage(reason, '读取认证状态失败'), 'error')
      return null
    }
  }

  async function probeReconnectReachability(connectionId: number) {
    if (options.probeReconnectReachability) return options.probeReconnectReachability(connectionId)
    try {
      const result = await options.probeConnectionReachability!(connectionId)
      if (result.reachable) return true
      options.showConnectionError(result.connectionError, result.connectionError?.userMessage || 'SSH 连接失败')
      return false
    } catch (reason) {
      options.showToast(errorMessage(reason, 'SSH 连接预检查失败'), 'error')
      return false
    }
  }

  async function credentialPromptReachabilityAllowed(connectionId: number) {
    if (options.credentialPromptReachabilityAllowed) return options.credentialPromptReachabilityAllowed(connectionId)
    try {
      const result = await options.probeConnectionReachability!(connectionId)
      if (result.reachable) return true
      if (result.connectionError && isCredentialError(result.connectionError.code)) return true
      options.showConnectionError(result.connectionError, result.connectionError?.userMessage || 'SSH 连接失败')
      return false
    } catch (reason) {
      options.showToast(errorMessage(reason, 'SSH 连接预检查失败'), 'error')
      return false
    }
  }

  async function requestAuthForState(
    mode: AuthDialogMode,
    connectionId: number,
    state: AuthenticationState,
    sftpContextId = '',
    sftpTerminalSessionId = '',
    sftpReconnect = false,
  ) {
    if (options.requestAuthForState) {
      return options.requestAuthForState(mode, connectionId, state, sftpContextId, sftpTerminalSessionId, sftpReconnect)
    }
    if (needsReachabilityBeforeCredentialPrompt(state) &&
      !await credentialPromptReachabilityAllowed(connectionId)) {
      return false
    }
    options.requestAuth(
      mode,
      connectionId,
      authenticationIssue(state),
      sftpContextId,
      sftpTerminalSessionId,
      sftpReconnect,
    )
    return true
  }

  function navigateServer(connection: Connection) {
    options.clearActiveLocalTerminal?.()
    options.selectConnection(connection.id)
    const tab = options.navigateTerminalToServer?.(connection) ?? options.findTerminalByConnection(connection.id)
    const state = options.connectionState(connection.id)
    options.syncConnectionState(connection, state)
    const workspaceStatus = options.workspaceStatus(connection.id)
    if (tab || ['connecting', 'reconnecting', 'failed', 'disconnected'].includes(workspaceStatus ?? '')) {
      options.activeView.value = 'terminals'
      return
    }
    if (state.monitorActive) {
      options.activeView.value = 'monitor'
      return
    }
    options.activeView.value = 'terminals'
  }

  async function ensureMonitorAndOpenTerminal(connection: Connection, auth: AuthRequest) {
    options.resumeServer(connection.id)
    const state = options.connectionState(connection.id)
    const terminal = await options.openTerminalSession(connection, auth)
    void continueTerminalBootstrap(connection, auth, terminal, !state.monitorActive)
    return terminal
  }

  async function activateServer(connection: Connection) {
    navigateServer(connection)
    if (activatingConnections.has(connection.id)) {
      options.showToast('服务器正在连接，请稍候', 'info')
      return
    }
    options.selectConnection(connection.id)
    const existingTerminal = options.findTerminalByConnection(connection.id)
    if (existingTerminal?.status === 'online') {
      options.activateTerminal(existingTerminal.sessionId)
      options.activeView.value = 'terminals'
      return
    }
    const runtimeState = options.connectionState(connection.id)
    if (existingTerminal?.status === 'connecting' || runtimeState.connecting) {
      options.showToast('服务器正在连接，请稍候', 'info')
      return
    }
    if (!hostPolicyAllows(connection)) return
    activatingConnections.add(connection.id)
    try {
      const state = await authenticationStateFor(connection.id)
      if (!state) return
      if (!canConnectSilently(state)) {
        await requestAuthForState('terminal', connection.id, state)
        return
      }
      await options.run(async () => {
        if (existingTerminal) {
          await reconnectTerminalAndSyncFiles(existingTerminal.sessionId, connection.id, createEmptyAuth())
          options.activateTerminal(existingTerminal.sessionId)
          if (!runtimeState.monitorActive) await options.connectMonitor(connection.id, createEmptyAuth())
        } else {
          await ensureMonitorAndOpenTerminal(connection, createEmptyAuth())
        }
        options.activeView.value = 'terminals'
      }, '打开 SSH 终端失败')
    } finally {
      activatingConnections.delete(connection.id)
    }
  }

  async function openTerminalFromMenu(connection: Connection) {
    const existingTerminal = options.findTerminalByConnection(connection.id)
    if (existingTerminal) {
      navigateServer(connection)
      options.activeView.value = 'terminals'
      return
    }
    await activateServer(connection)
  }

  function hasTemporaryAuth(auth: AuthRequest) {
    return Boolean(auth.password || auth.passphrase || auth.trustUnknownHost)
  }

  function fileReconnectAuth(auth: AuthRequest) {
    return hasTemporaryAuth(auth) ? auth : createEmptyAuth()
  }

  async function reconnectFileContextsAfterTerminalOnline(
    connectionId: number,
    terminalSessionId: string,
    auth: AuthRequest,
  ) {
    const contexts = options.reconnectableSftpContexts(connectionId, terminalSessionId)
    if (contexts.length === 0) return
    const eventID = ++terminalReconnectSuccessSequence
    const seen = new Set<string>()
    await Promise.all(contexts.map(async (context) => {
      const key = `${eventID}:${connectionId}:${context.contextId}`
      if (seen.has(key)) return
      seen.add(key)
      try {
        await options.sftpReconnect(
          connectionId,
          fileReconnectAuth(auth),
          context.contextId,
          context.terminalSessionId,
        )
      } catch {
        // sftpReconnect leaves the panel in an error state with a usable reconnect button.
      }
    }))
  }

  async function reconnectTerminalAndSyncFiles(
    sessionId: string,
    connectionId: number,
    auth: AuthRequest,
  ) {
    options.markTerminalFileReconnectPending(connectionId, sessionId)
    try {
      const info = await options.reconnectTerminalSession(sessionId, connectionId, auth, 100, 30)
      if (info?.status === 'online') {
        options.clearTerminalFileReconnectPending(connectionId, sessionId)
        await reconnectFileContextsAfterTerminalOnline(connectionId, sessionId, auth)
      }
      return info
    } catch (reason) {
      options.clearTerminalFileReconnectPending(connectionId, sessionId)
      throw reason
    }
  }

  async function autoOpenSftpForServer(
    connection: Connection,
    auth: AuthRequest,
    terminalSessionId = '',
  ) {
    const contextId = terminalSessionId || undefined
    const autoOpeningKey = `${connection.id}:${contextId ?? 'default'}`
    if (autoOpeningSftp.has(autoOpeningKey)) return
    const current = options.sftpState(connection.id, contextId)
    if (current?.status === 'online' || current?.status === 'connecting') return
    autoOpeningSftp.add(autoOpeningKey)
    try {
      let effectiveAuth = auth
      if (!hasTemporaryAuth(auth)) {
        const state = await authenticationStateFor(connection.id)
        if (!state) return
        if (!canConnectSilently(state)) {
          if (await credentialPromptReachabilityAllowed(connection.id)) {
            options.sftpMarkAuthRequired(
              connection.id,
              authenticationIssue(state) || '需要口令',
              contextId,
              terminalSessionId,
            )
          }
          return
        }
        effectiveAuth = createEmptyAuth()
      }
      await options.sftpOpen(connection.id, effectiveAuth, contextId, terminalSessionId)
    } catch (reason) {
      if (options.sftpState(connection.id, contextId)?.status !== 'error') {
        options.sftpMarkAuthRequired(
          connection.id,
          errorMessage(reason, 'SFTP 自动连接失败'),
          contextId,
          terminalSessionId,
        )
      }
    } finally {
      autoOpeningSftp.delete(autoOpeningKey)
    }
  }

  async function newTerminal(
    connectionId = options.selectedConnectionId() ?? undefined,
    paneTarget: PendingPaneOpenTarget | null = null,
  ) {
    const connection = options.findConnection(connectionId)
    if (!connection) {
      options.clearPendingPaneOpenTarget(paneTarget)
      return null
    }
    navigateServer(connection)
    if (activatingConnections.has(connection.id) || options.connectionState(connection.id).connecting) {
      options.showToast('服务器正在连接，请稍候', 'info')
      options.clearPendingPaneOpenTarget(paneTarget)
      return null
    }
    if (!hostPolicyAllows(connection)) {
      options.clearPendingPaneOpenTarget(paneTarget)
      return null
    }
    activatingConnections.add(connection.id)
    let paneTargetHandled = false
    let openedTerminal: TerminalInfo | null = null
    try {
      const state = await authenticationStateFor(connection.id)
      if (!state) {
        options.clearPendingPaneOpenTarget(paneTarget)
        paneTargetHandled = true
        return null
      }
      if (!canConnectSilently(state)) {
        await requestAuthForState('terminal', connection.id, state)
        return null
      }
      await options.run(async () => {
        const terminal = await ensureMonitorAndOpenTerminal(connection, createEmptyAuth())
        openedTerminal = terminal
        options.publishPaneTargetAssignment(paneTarget, 'ssh', terminal.sessionId)
        paneTargetHandled = true
        options.activeView.value = 'terminals'
      }, '新建 SSH 终端失败')
      if (paneTarget && !paneTargetHandled) options.clearPendingPaneOpenTarget(paneTarget)
      return openedTerminal
    } finally {
      activatingConnections.delete(connection.id)
    }
  }

  async function reconnectTerminal(sessionId: string, connectionId: number, code = '') {
    options.setReconnectSessionId?.(sessionId)
    const connection = options.findConnection(connectionId)
    if (!connection) return
    if (!hostPolicyAllows(connection)) return
    if (isCredentialError(code)) {
      const terminal = options.terminalTabs().find((item) => item.sessionId === sessionId)
      const connectionError = terminal?.connectionError
      if (shouldOpenInteractiveCredentialDialog(connection, code, connectionError)) {
        options.requestAuth('terminal-reconnect', connectionId, credentialPromptIssue(code, connectionError))
      } else {
        options.showConnectionError(connectionError, privateKeyRejectedIssue(connectionError))
      }
      return
    }
    if (isHostKeyError(code)) {
      await options.trustHostKeyAndRun(connection, async (trustedConnection) => {
        options.resumeServer(trustedConnection.id)
        await reconnectTerminalAndSyncFiles(sessionId, trustedConnection.id, createEmptyAuth())
      })
      return
    }
    if (isNonCredentialReconnectError(code)) {
      if (!await probeReconnectReachability(connectionId)) return
      await options.run(async () => {
        options.resumeServer(connectionId)
        await reconnectTerminalAndSyncFiles(sessionId, connectionId, createEmptyAuth())
      }, '重新连接终端失败')
      return
    }
    const state = await authenticationStateFor(connectionId)
    if (!state) return
    if (!canConnectSilently(state)) {
      await requestAuthForState('terminal-reconnect', connectionId, state)
      return
    }
    await options.run(async () => {
      options.resumeServer(connectionId)
      await reconnectTerminalAndSyncFiles(sessionId, connectionId, createEmptyAuth())
    }, '重新连接终端失败')
  }

  async function openOrActivateServer(connection: Connection) {
    const paneTarget = options.pendingForAction('connect-saved')
    if (paneTarget) {
      await newTerminal(connection.id, paneTarget)
      return
    }
    await activateServer(connection)
  }

  async function openSftpForConnection(connection: Connection) {
    navigateServer(connection)
    if (!hostPolicyAllows(connection)) return
    const activeTab = options.activeTerminalTab?.()
    const terminalSessionId = activeTab?.connectionId === connection.id
      ? activeTab.sessionId
      : options.findTerminalByConnection(connection.id)?.sessionId ?? ''
    const contextId = terminalSessionId || undefined
    const current = options.sftpState(connection.id, contextId)
    if (current?.status === 'online' || current?.status === 'connecting') return
    const state = await authenticationStateFor(connection.id)
    if (!state) return
    if (!canConnectSilently(state)) {
      await requestAuthForState('sftp', connection.id, state, contextId ?? '', terminalSessionId)
      return
    }
    await options.run(async () => {
      await options.sftpOpen(connection.id, createEmptyAuth(), contextId, terminalSessionId)
    }, '打开 SFTP 失败')
  }

  function openSftpById(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (connection) void openSftpForConnection(connection)
  }

  async function reconnectSftpById(connectionId: number, contextId = '', terminalSessionId = '') {
    const connection = options.findConnection(connectionId)
    if (!connection || !hostPolicyAllows(connection)) return false
    const state = await authenticationStateFor(connection.id)
    if (!state) return false
    if (!canConnectSilently(state)) {
      await requestAuthForState('sftp', connection.id, state, contextId, terminalSessionId, true)
      return false
    }
    let reconnected = false
    await options.run(async () => {
      await options.sftpReconnect(connection.id, createEmptyAuth(), contextId || undefined, terminalSessionId)
      reconnected = true
    }, '重新连接 SFTP 失败')
    return reconnected
  }

  async function connectServer(connection: Connection) {
    options.selectConnection(connection.id)
    if (!hostPolicyAllows(connection)) return
    const state = await authenticationStateFor(connection.id)
    if (!state) return
    if (!canConnectSilently(state)) {
      await requestAuthForState('connect', connection.id, state)
      return
    }
    await options.run(() => options.connectMonitor(connection.id, createEmptyAuth()), '连接服务器失败')
  }

  async function testServer(connection: Connection) {
    options.selectConnection(connection.id)
    if (!hostPolicyAllows(connection)) return
    const state = await authenticationStateFor(connection.id)
    if (!state) return
    if (!canConnectSilently(state)) {
      await requestAuthForState('test', connection.id, state)
      return
    }
    await options.run(async () => {
      const result = await options.testConnection(connection.id, createEmptyAuth())
      if (result.success) options.showToast(`连接成功，握手延迟 ${result.latencyMillis} ms`, 'success')
      else if (isCredentialError(result.errorCode)) {
        options.requestAuth('test', connection.id, credentialPromptIssue(result.errorCode, result.connectionError, true))
      } else {
        options.showConnectionError(result.connectionError, result.message)
      }
    }, '测试连接失败')
  }

  async function reconnectServer(connection: Connection) {
    options.selectConnection(connection.id)
    if (!hostPolicyAllows(connection)) return
    const state = await authenticationStateFor(connection.id)
    if (!state) return
    if (!canConnectSilently(state)) {
      await requestAuthForState('server-reconnect', connection.id, state)
      return
    }
    await options.run(() => reconnectServerWithAuth(connection, createEmptyAuth()), '重新连接服务器失败')
  }

  async function reconnectServerWithAuth(connection: Connection, auth: AuthRequest) {
    const terminalIDs = options.terminalTabs()
      .filter((tab) => tab.connectionId === connection.id)
      .map((tab) => tab.sessionId)
    await options.disconnectMonitor(connection.id)
    options.markDisconnected(connection.id)
    options.resumeServer(connection.id)
    for (const sessionID of terminalIDs) {
      const info = await reconnectTerminalAndSyncFiles(sessionID, connection.id, auth)
      if (info?.sessionId) {
        await waitForTerminalBootstrap(info.sessionId, connection.id, info.status)
      }
    }
    await options.connectMonitor(connection.id, auth)
  }

  async function disconnectServer(connection: Connection, closeWorkspace = true, markImmediately = false) {
    options.markExpectedDisconnect?.(connection.id)
    await options.run(async () => {
      if (markImmediately) {
        options.clearSftpServer(connection.id)
        options.clearTunnelServer(connection.id)
        options.clearDockerServer(connection.id)
        options.clearProcessServer(connection.id)
        options.markDisconnected(connection.id)
      }
      await options.disconnectTerminalServer(connection.id, closeWorkspace)
      options.clearSftpServer(connection.id)
      options.clearTunnelServer(connection.id)
      options.clearDockerServer(connection.id)
      options.clearProcessServer(connection.id)
      options.markDisconnected(connection.id)
    }, '断开服务器失败')
  }

  function disconnectServerById(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (connection) void disconnectServer(connection)
  }

  function disconnectServerAfterFinalTerminalClose(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (connection) void disconnectServer(connection, true, true)
  }

  function connectWorkspace(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (connection) void activateServer(connection)
  }

  return {
    createEmptyAuth,
    authenticationStateFor,
    probeReconnectReachability,
    credentialPromptReachabilityAllowed,
    requestAuthForState,
    hostPolicyAllows,
    canConnectSilently,
    navigateServer,
    activateServer,
    openTerminalFromMenu,
    ensureMonitorAndOpenTerminal,
    reconnectFileContextsAfterTerminalOnline,
    reconnectTerminalAndSyncFiles,
    autoOpenSftpForServer,
    newTerminal,
    reconnectTerminal,
    openOrActivateServer,
    openSftpForConnection,
    openSftpById,
    reconnectSftpById,
    connectServer,
    testServer,
    reconnectServer,
    reconnectServerWithAuth,
    disconnectServer,
    disconnectServerById,
    disconnectServerAfterFinalTerminalClose,
    connectWorkspace,
  }
}
