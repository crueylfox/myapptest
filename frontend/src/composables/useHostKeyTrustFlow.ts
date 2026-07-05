import { ref, type Ref } from 'vue'
import type { AuthDialogMode } from './useAuthDialogController'
import type { AuthenticationState, AuthRequest, Connection, HostKeyProbeResult } from '../types'

type AppView = 'terminals' | 'monitor' | 'logs' | 'settings'
type ToastType = 'success' | 'error' | 'info'
type TerminalInfo = { sessionId: string; connectionId?: number }
type ConfirmDialogOptions = {
  title: string
  message: string
  confirmText: string
  danger?: boolean
}

export interface HostKeyTrustRequestState {
  connection: Connection
  previousFingerprint: string
  observedFingerprint: string
  hasExistingFingerprint: boolean
  willContinueAfterTrust: boolean
}

export interface HostKeyTrustFlowOptions {
  activeView: Ref<AppView>
  findConnection: (connectionId: number) => Connection | null
  probeHostKey: (connectionId: number) => Promise<HostKeyProbeResult>
  trustHostKey: (connectionId: number, expectedFingerprint: string) => Promise<void>
  loadConnections: () => Promise<void>
  confirmTrust?: (request: HostKeyTrustRequestState) => Promise<boolean>
  confirmDialog?: (options: ConfirmDialogOptions) => Promise<boolean>
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
  findTerminalByConnection: (connectionId: number) => TerminalInfo | null | undefined
  authenticationStateFor: (connectionId: number) => Promise<AuthenticationState | null>
  canConnectSilently: (state: AuthenticationState) => boolean
  requestAuthForState: (
    mode: AuthDialogMode,
    connectionId: number,
    state: AuthenticationState,
  ) => Promise<boolean>
  reconnectTerminalAndSyncFiles: (sessionId: string, connectionId: number, auth: AuthRequest) => Promise<unknown>
  ensureMonitorAndOpenTerminal: (connection: Connection, auth: AuthRequest) => Promise<unknown>
  emptyAuth: () => AuthRequest
}

export function useHostKeyTrustFlow(options: HostKeyTrustFlowOptions) {
  const trustRequest = ref<HostKeyTrustRequestState | null>(null)

  function confirmTrust(request: HostKeyTrustRequestState) {
    if (options.confirmTrust) return options.confirmTrust(request)
    return options.confirmDialog?.({
      title: request.hasExistingFingerprint ? '主机指纹已变化' : '首次连接此服务器',
      message: `确认信任“${request.connection.name}”当前主机指纹？\n\n已保存：${request.previousFingerprint}\n当前检测：${request.observedFingerprint}`,
      confirmText: request.willContinueAfterTrust
        ? request.hasExistingFingerprint ? '信任并更新后连接' : '信任并连接'
        : '保存指纹',
      danger: request.hasExistingFingerprint,
    }) ?? Promise.resolve(false)
  }

  async function trustHostKeyAndRun(
    connection: Connection,
    afterTrust?: (trustedConnection: Connection) => Promise<void>,
  ) {
    await options.run(async () => {
      const observed = await options.probeHostKey(connection.id)
      const previousFingerprint = connection.hostKeyFingerprint || '未保存'
      const request: HostKeyTrustRequestState = {
        connection,
        previousFingerprint,
        observedFingerprint: observed.fingerprint,
        hasExistingFingerprint: Boolean(connection.hostKeyFingerprint),
        willContinueAfterTrust: Boolean(afterTrust),
      }
      trustRequest.value = request
      try {
        if (!await confirmTrust(request)) return
        await options.trustHostKey(connection.id, observed.fingerprint)
        await options.loadConnections()
        const trustedConnection = options.findConnection(connection.id) ?? {
          ...connection,
          hostKeyFingerprint: observed.fingerprint,
        }
        options.showToast('当前主机指纹已明确保存', 'success')
        if (afterTrust) await afterTrust(trustedConnection)
      } finally {
        trustRequest.value = null
      }
    }, '信任并更新主机指纹失败')
  }

  async function trustWorkspaceHostKey(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (!connection) return
    await trustHostKeyAndRun(connection, async (trustedConnection) => {
      const terminal = options.findTerminalByConnection(trustedConnection.id)
      const state = await options.authenticationStateFor(trustedConnection.id)
      if (!state) return
      if (!options.canConnectSilently(state)) {
        await options.requestAuthForState(terminal ? 'terminal-reconnect' : 'terminal', trustedConnection.id, state)
        return
      }
      if (terminal) {
        await options.reconnectTerminalAndSyncFiles(terminal.sessionId, trustedConnection.id, options.emptyAuth())
      } else {
        await options.ensureMonitorAndOpenTerminal(trustedConnection, options.emptyAuth())
      }
      options.activeView.value = 'terminals'
    })
  }

  return {
    trustRequest,
    trustHostKeyAndRun,
    trustWorkspaceHostKey,
  }
}
