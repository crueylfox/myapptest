import type { Ref } from 'vue'
import { createEmptyAuth, useServerRuntimeActions } from './useServerRuntimeActions'
import { selectReconnectableSftpContexts } from './useSftpActiveContextBridge'
import type { AuthDialogMode } from './useAuthDialogController'
import type { PendingPaneOpenTarget, PaneTargetAssignment } from './usePaneTargetRequests'
import type { AppPanelView } from '../utils/appPanelModel'
import type {
  AppSettings,
  AuthRequest,
  AuthenticationState,
  Connection,
  ConnectionError,
  ConnectionReachabilityResult,
  ConnectionRuntimeState,
  SFTPState,
  SFTPTransferState,
  TestConnectionResult,
} from '../types'

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

export interface AppServerRuntimeWiringOptions {
  settings: Ref<AppSettings>
  activeView: Ref<AppPanelView>
  pendingPaneOpenTarget: Ref<PendingPaneOpenTarget | null>
  clearPendingPaneOpenTarget: (target?: PendingPaneOpenTarget | null) => void
  pendingForAction: (action: 'connect-saved') => PendingPaneOpenTarget | null
  publishPaneTargetAssignment: (
    target: PendingPaneOpenTarget | null | undefined,
    kind: 'ssh',
    sessionId: string,
  ) => PaneTargetAssignment | null
  connections: () => Connection[]
  selectedConnection: () => Connection | null
  selectedConnectionId: () => number | null | undefined
  selectConnection: (connectionId: number) => void
  connectionState: (connectionId: number) => ConnectionRuntimeState
  workspaceStatus: (connectionId: number) => string | undefined
  hasWorkspace: (connectionId: number) => boolean
  findTerminalByConnection: (connectionId: number) => TerminalTabLike | null | undefined
  activeTerminalTab: () => TerminalTabLike | null | undefined
  navigateTerminalToServer: (connection: Connection) => TerminalTabLike | null | undefined
  clearActiveLocalTerminal: () => void
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
  markExpectedDisconnect: (connectionId: number) => void
  testConnection: (connectionId: number, auth: AuthRequest) => Promise<TestConnectionResult>
  clearSftpServer: (connectionId: number) => void
  clearTunnelServer: (connectionId: number) => void
  clearDockerServer: (connectionId: number) => void
  clearProcessServer: (connectionId: number) => void
  sftpState: (connectionId: number, contextId?: string) => SFTPState | null | undefined
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
  sftpStatesByContextId: () => Record<string, SFTPState | undefined>
  sftpServerState: (connectionId: number) => SFTPState | undefined
  sftpTransfersById: () => Record<string, SFTPTransferState | undefined>
  sftpEntriesCount: (connectionId: number, contextId?: string) => number
  markTerminalFileReconnectPending: (connectionId: number, sessionId: string) => void
  clearTerminalFileReconnectPending: (connectionId: number, sessionId: string) => void
  readAuthenticationState: (connectionId: number) => Promise<AuthenticationState>
  probeConnectionReachability: (connectionId: number) => Promise<ConnectionReachabilityResult>
  requestAuth: (
    mode: AuthDialogMode,
    connectionId?: number,
    issue?: string,
    sftpContextId?: string,
    sftpTerminalSessionId?: string,
    sftpReconnect?: boolean,
  ) => void
  setReconnectSessionId: (sessionId: string | null) => void
  trustHostKeyAndRun: (
    connection: Connection,
    action?: (trustedConnection: Connection) => Promise<void>,
  ) => Promise<void>
  showConnectionError: (connectionError: ConnectionError | undefined, fallback: string) => void
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  errorMessage: (reason: unknown, fallback: string) => string
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
}

export function useAppServerRuntimeWiring(options: AppServerRuntimeWiringOptions) {
  return useServerRuntimeActions({
    settings: options.settings,
    activeView: options.activeView,
    pendingPaneOpenTarget: options.pendingPaneOpenTarget,
    clearPendingPaneOpenTarget: options.clearPendingPaneOpenTarget,
    pendingForAction: options.pendingForAction,
    publishPaneTargetAssignment: options.publishPaneTargetAssignment,
    connections: options.connections,
    findConnection: (connectionId) => {
      const targetId = connectionId ?? options.selectedConnection()?.id ?? null
      return targetId === null
        ? null
        : options.connections().find((item) => item.id === targetId) ?? null
    },
    selectedConnectionId: options.selectedConnectionId,
    selectConnection: options.selectConnection,
    connectionState: options.connectionState,
    workspaceStatus: options.workspaceStatus,
    hasWorkspace: options.hasWorkspace,
    findTerminalByConnection: options.findTerminalByConnection,
    activeTerminalTab: options.activeTerminalTab,
    navigateTerminalToServer: options.navigateTerminalToServer,
    clearActiveLocalTerminal: options.clearActiveLocalTerminal,
    activateTerminal: options.activateTerminal,
    openTerminalSession: options.openTerminalSession,
    reconnectTerminalSession: options.reconnectTerminalSession,
    disconnectTerminalServer: options.disconnectTerminalServer,
    terminalTabs: options.terminalTabs,
    clearActiveWorkspace: options.clearActiveWorkspace,
    syncConnectionState: options.syncConnectionState,
    resumeServer: options.resumeServer,
    markDisconnected: options.markDisconnected,
    connectMonitor: options.connectMonitor,
    disconnectMonitor: options.disconnectMonitor,
    markExpectedDisconnect: options.markExpectedDisconnect,
    testConnection: options.testConnection,
    clearSftpServer: options.clearSftpServer,
    clearTunnelServer: options.clearTunnelServer,
    clearDockerServer: options.clearDockerServer,
    clearProcessServer: options.clearProcessServer,
    sftpState: options.sftpState,
    sftpOpen: options.sftpOpen,
    sftpReconnect: options.sftpReconnect,
    sftpMarkAuthRequired: options.sftpMarkAuthRequired,
    reconnectableSftpContexts: (connectionId, terminalSessionId) =>
      selectReconnectableSftpContexts({
        connectionId,
        terminalSessionId,
        statesByContextId: options.sftpStatesByContextId(),
        serverState: options.sftpServerState(connectionId),
        transfersById: options.sftpTransfersById(),
        entriesCount: options.sftpEntriesCount,
      }),
    markTerminalFileReconnectPending: options.markTerminalFileReconnectPending,
    clearTerminalFileReconnectPending: options.clearTerminalFileReconnectPending,
    readAuthenticationState: options.readAuthenticationState,
    probeConnectionReachability: options.probeConnectionReachability,
    requestAuth: options.requestAuth,
    setReconnectSessionId: options.setReconnectSessionId,
    trustHostKeyAndRun: options.trustHostKeyAndRun,
    showConnectionError: options.showConnectionError,
    showToast: options.showToast,
    errorMessage: options.errorMessage,
    run: options.run,
  })
}

export { createEmptyAuth }
