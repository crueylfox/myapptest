import type { Ref } from 'vue'
import { nextTick as vueNextTick } from 'vue'
import type {
  AuthRequest,
  Connection,
  ConnectionRuntimeState,
  SaveConnectionConfigRequest,
  SaveConnectionConfigResult,
  SaveConnectionRequest,
} from '../types'
import type { PendingPaneOpenTarget, PaneTargetAssignment } from './usePaneTargetRequests'

type AppView = 'terminals' | 'monitor' | 'logs' | 'settings'
type ToastType = 'success' | 'error' | 'info'
type ConfirmDialogOptions = {
  title: string
  message: string
  confirmText: string
  danger?: boolean
  returnFocus?: HTMLElement | null
}

export interface ConnectionDialogFlowOptions {
  connectionDialog: Ref<boolean>
  editing: Ref<Connection | null>
  activeView: Ref<AppView>
  serverPickerAnchor: Ref<HTMLElement | null>
  pendingPaneOpenTarget: Ref<PendingPaneOpenTarget | null>
  beginPaneOpenTarget: (paneId: string, action: 'add-server') => PendingPaneOpenTarget
  clearPendingPaneOpenTarget: (target?: PendingPaneOpenTarget | null) => void
  publishPaneTargetAssignment: (
    target: PendingPaneOpenTarget | null | undefined,
    kind: 'ssh',
    sessionId: string,
  ) => PaneTargetAssignment | null
  closeTransientOverlays: () => void
  nextTick?: typeof vueNextTick
  findConnection: (connectionId: number) => Connection | null
  saveConnectionConfig: (request: SaveConnectionConfigRequest) => Promise<SaveConnectionConfigResult>
  duplicateConnectionConfig?: (connection: SaveConnectionRequest) => Promise<void>
  deleteConnectionConfig?: (connectionId: number) => Promise<void>
  deleteSavedCredentialById?: (connectionId: number) => Promise<void>
  confirmDeleteSavedCredential?: (connection: Connection) => Promise<boolean>
  confirmDialog?: (options: ConfirmDialogOptions) => Promise<boolean>
  connections?: () => Connection[]
  markExpectedDisconnect?: (connectionId: number) => void
  removeServerAlerts?: (connectionId: number) => void
  removeWorkspaceLocal?: (connectionId: number) => void
  loadConnections: () => Promise<void>
  selectConnection: (connectionId: number) => void
  syncConnectionState: (connection: Connection, state: ConnectionRuntimeState) => void
  connectionState: (connectionId: number) => ConnectionRuntimeState
  hasWorkspace: (connectionId: number) => boolean
  sessionsByServerId: (connectionId: number) => unknown[]
  openTerminalForSavedConnection: (
    connection: Connection,
    auth: AuthRequest,
  ) => Promise<{ sessionId: string }>
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
}

export function useConnectionDialogFlow(options: ConnectionDialogFlowOptions) {
  const nextTick = options.nextTick ?? vueNextTick

  function isRuntimeActiveForConnection(connectionId: number) {
    const state = options.connectionState(connectionId)
    return Boolean(
      options.hasWorkspace(connectionId) ||
      options.sessionsByServerId(connectionId).length > 0 ||
      state.hasActiveSession ||
      state.monitorActive ||
      state.terminalActive ||
      state.terminalConnecting ||
      state.sftpActive ||
      ['online', 'connecting', 'reconnecting'].includes(state.status),
    )
  }

  async function openCreate() {
    options.closeTransientOverlays()
    await nextTick()
    options.editing.value = null
    options.connectionDialog.value = true
  }

  async function openCreateForPane(paneId: string) {
    options.closeTransientOverlays()
    options.beginPaneOpenTarget(paneId, 'add-server')
    await nextTick()
    options.editing.value = null
    options.connectionDialog.value = true
  }

  async function openEdit(connection: Connection | null = null) {
    options.closeTransientOverlays()
    await nextTick()
    options.editing.value = connection
    options.connectionDialog.value = true
  }

  async function editServerFromTab(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (!connection) {
      options.showToast('无法编辑，该服务器配置不存在。', 'error')
      return
    }
    await openEdit(connection)
  }

  function closeConnectionDialog() {
    options.connectionDialog.value = false
    if (options.pendingPaneOpenTarget.value?.action === 'add-server') {
      options.clearPendingPaneOpenTarget(options.pendingPaneOpenTarget.value)
    }
    void nextTick(() => options.serverPickerAnchor.value?.focus())
  }

  async function saveConnection(request: SaveConnectionConfigRequest) {
    const paneTarget = options.pendingPaneOpenTarget.value?.action === 'add-server'
      ? options.pendingPaneOpenTarget.value
      : null
    let paneTargetHandled = false
    await options.run(async () => {
      const wasEditingConnected = request.connection.id > 0 &&
        isRuntimeActiveForConnection(request.connection.id)
      const result = await options.saveConnectionConfig(request)
      await options.loadConnections()
      options.selectConnection(result.connection.id)
      options.syncConnectionState(result.connection, options.connectionState(result.connection.id))
      closeConnectionDialog()
      if (!result.connectAfterSave) {
        options.showToast(
          wasEditingConnected
            ? '服务器配置已保存，当前已连接会话不会自动重连，新配置将在下次连接时生效。'
            : '服务器配置已保存',
          'success',
        )
        options.clearPendingPaneOpenTarget(paneTarget)
        paneTargetHandled = true
        return
      }
      const terminal = await options.openTerminalForSavedConnection(result.connection, { ...request.auth })
      options.publishPaneTargetAssignment(paneTarget, 'ssh', terminal.sessionId)
      paneTargetHandled = true
      options.activeView.value = 'terminals'
      options.showToast('服务器已保存并连接', 'success')
    }, '保存服务器配置失败')
    if (paneTarget && !paneTargetHandled) options.clearPendingPaneOpenTarget(paneTarget)
  }

  async function deleteSavedCredential(connectionId: number) {
    const connection = options.findConnection(connectionId)
    if (!connection || !options.deleteSavedCredentialById) return
    const confirmed = options.confirmDeleteSavedCredential
      ? await options.confirmDeleteSavedCredential(connection)
      : await options.confirmDialog?.({
        title: '删除已保存凭据',
        message: `删除“${connection.name}”已保存的系统凭据？`,
        confirmText: '删除凭据',
        danger: true,
      })
    if (!confirmed) return
    await options.run(async () => {
      await options.deleteSavedCredentialById!(connectionId)
      await options.loadConnections()
      options.editing.value = options.findConnection(connectionId)
      options.showToast('已删除保存的系统凭据', 'success')
    }, '删除保存的系统凭据失败')
  }

  async function duplicateConnection(connection: Connection) {
    if (!options.duplicateConnectionConfig) return
    await options.run(async () => {
      await options.duplicateConnectionConfig!({
        id: 0,
        groupId: connection.groupId,
        name: `${connection.name} 副本`,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        authType: connection.authType,
        privateKeySource: connection.privateKeySource || 'local_file',
        privateKeyPath: connection.privateKeyPath,
        keyVaultId: connection.keyVaultId,
        terminalProfileId: connection.terminalProfileId ?? null,
        refreshInterval: connection.refreshInterval,
      })
      options.showToast('服务器配置已复制；凭据和主机信任未复制', 'success')
    }, '复制服务器失败')
  }

  async function deleteConnection(connection: Connection | null) {
    if (!connection || !options.confirmDialog || !options.deleteConnectionConfig) return
    options.closeTransientOverlays()
    await nextTick()
    const affectedJumpTargets = (options.connections?.() ?? []).filter((item) =>
      (item.connectionMode ?? 'direct') === 'jump' && item.jumpServerId === connection.id)
    const affectedText = affectedJumpTargets.length
      ? `\n\n该服务器正被 ${affectedJumpTargets.length} 台服务器用作跳板机：${affectedJumpTargets.map((item) => item.name).join('、')}。删除后这些服务器会保留为跳板模式，但需要重新选择跳板机。`
      : ''
    if (!await options.confirmDialog({
      title: '删除服务器',
      message: `删除服务器“${connection.name}”？此操作不可撤销，并会关闭该服务器已有工作区。${affectedText}`,
      confirmText: '删除服务器',
      danger: true,
      returnFocus: options.serverPickerAnchor.value,
    })) return
    options.markExpectedDisconnect?.(connection.id)
    options.removeServerAlerts?.(connection.id)
    await options.run(async () => {
      await options.deleteConnectionConfig!(connection.id)
      options.removeWorkspaceLocal?.(connection.id)
      options.showToast('服务器配置已删除', 'success')
    }, '删除服务器失败')
  }

  return {
    openCreate,
    openCreateForPane,
    openEdit,
    editServerFromTab,
    closeConnectionDialog,
    saveConnection,
    deleteSavedCredential,
    duplicateConnection,
    deleteConnection,
    isRuntimeActiveForConnection,
  }
}
