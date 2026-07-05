import { computed, ref, type Ref } from 'vue'
import {
  credentialPromptIssue,
  isCredentialError,
  useAuthDialogController,
  type AuthDialogMode,
} from './useAuthDialogController'
import type { PendingPaneOpenTarget, PaneTargetAssignment } from './usePaneTargetRequests'
import type { AuthRequest, Connection, ConnectionError } from '../types'

type AppView = 'terminals' | 'monitor' | 'logs' | 'settings'
type ToastType = 'success' | 'error' | 'info'
type TerminalInfo = { sessionId: string }

export interface AuthDialogFlowOptions {
  activeView: Ref<AppView>
  sftpOpenRevision: Ref<number>
  pendingPaneOpenTarget: Ref<PendingPaneOpenTarget | null>
  clearPendingPaneOpenTarget: (target?: PendingPaneOpenTarget | null) => void
  publishPaneTargetAssignment: (
    target: PendingPaneOpenTarget | null | undefined,
    kind: 'ssh',
    sessionId: string,
  ) => PaneTargetAssignment | null
  findConnection: (connectionId: number) => Connection | null
  testConnection: (
    connectionId: number,
    auth: AuthRequest,
  ) => Promise<{ success: boolean; latencyMillis: number; errorCode: string; message: string; connectionError?: ConnectionError }>
  connectServer: (connectionId: number, auth: AuthRequest) => Promise<void>
  ensureMonitorAndOpenTerminal: (connection: Connection, auth: AuthRequest) => Promise<TerminalInfo>
  reconnectTerminalAndSyncFiles: (sessionId: string, connectionId: number, auth: AuthRequest) => Promise<unknown>
  reconnectServerWithAuth: (connection: Connection, auth: AuthRequest) => Promise<unknown>
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
  showConnectionError: (connectionError: ConnectionError | undefined, fallback: string) => void
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
}

export function useAuthDialogFlow(options: AuthDialogFlowOptions) {
  const authController = useAuthDialogController()
  const reconnectSessionId = ref<string | null>(null)
  const authDialog = authController.isOpen
  const authMode = authController.mode
  const authConnectionId = authController.connectionId
  const authIssue = authController.issue
  const authConnection = computed(() => {
    const connectionId = authConnectionId.value
    return connectionId === null ? null : options.findConnection(connectionId)
  })

  function requestAuth(
    mode: AuthDialogMode,
    connectionId?: number,
    issue = '',
    sftpContextId = '',
    sftpTerminalSessionId = '',
    sftpReconnect = false,
  ) {
    authController.requestAuth({
      mode,
      connectionId,
      issue,
      sftpContextId,
      sftpTerminalSessionId,
      sftpReconnect,
    })
  }

  async function submitAuth(auth: AuthRequest) {
    if (!authController.beginSubmit()) return
    const paneTarget = authMode.value === 'terminal' ? options.pendingPaneOpenTarget.value : null
    try {
      await options.run(async () => {
        const connectionId = authConnectionId.value
        if (connectionId === null) return
        if (authMode.value === 'test') {
          const result = await options.testConnection(connectionId, auth)
          if (result.success) options.showToast(`连接成功，握手延迟 ${result.latencyMillis} ms`, 'success')
          else if (isCredentialError(result.errorCode)) {
            authController.setIssue(credentialPromptIssue(result.errorCode, result.connectionError, true))
            return
          } else options.showConnectionError(result.connectionError, result.message)
        } else if (authMode.value === 'terminal' || authMode.value === 'terminal-reconnect') {
          const connection = options.findConnection(connectionId)
          if (!connection) return
          if (authMode.value === 'terminal-reconnect' && reconnectSessionId.value) {
            await options.reconnectTerminalAndSyncFiles(reconnectSessionId.value, connectionId, auth)
          } else {
            const terminal = await options.ensureMonitorAndOpenTerminal(connection, auth)
            options.publishPaneTargetAssignment(paneTarget, 'ssh', terminal.sessionId)
          }
          options.activeView.value = 'terminals'
        } else if (authMode.value === 'server-reconnect') {
          const connection = options.findConnection(connectionId)
          if (connection) await options.reconnectServerWithAuth(connection, auth)
        } else if (authMode.value === 'sftp') {
          const contextId = authController.pendingSftpContextId.value || undefined
          const terminalSessionId = authController.pendingSftpTerminalSessionId.value || undefined
          if (authController.pendingSftpReconnect.value) {
            await options.sftpReconnect(connectionId, auth, contextId, terminalSessionId)
            options.showToast('SFTP/SCP 已重新连接', 'success')
          } else {
            await options.sftpOpen(connectionId, auth, contextId, terminalSessionId)
          }
          options.activeView.value = 'terminals'
          options.sftpOpenRevision.value += 1
        } else {
          await options.connectServer(connectionId, auth)
        }
        authController.completeSubmit()
      }, 'SSH 认证或连接失败')
    } finally {
      authController.endSubmit()
    }
  }

  function closeAuthDialog() {
    if (authMode.value === 'terminal') {
      options.clearPendingPaneOpenTarget(options.pendingPaneOpenTarget.value)
    }
    authController.close()
  }

  function setReconnectSessionId(sessionId: string | null) {
    reconnectSessionId.value = sessionId
  }

  return {
    authDialog,
    authMode,
    authConnectionId,
    authConnection,
    authIssue,
    pendingSftpContextId: authController.pendingSftpContextId,
    pendingSftpTerminalSessionId: authController.pendingSftpTerminalSessionId,
    pendingSftpReconnect: authController.pendingSftpReconnect,
    requestAuth,
    submitAuth,
    closeAuthDialog,
    setReconnectSessionId,
  }
}
