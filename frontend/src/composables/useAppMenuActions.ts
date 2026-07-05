import type { Ref } from 'vue'
import type { AppDialogRequest } from './useAppDialog'
import type { AlertCenterViewIntent } from './useAlertCenterController'
import type { PendingPaneOpenTarget } from './usePaneTargetRequests'
import type { AppPanelView } from '../utils/appPanelModel'
import type { AlertEvent, Connection, ConnectionError, ReorderServersRequest } from '../types'

type ToastType = 'success' | 'error' | 'info'
type ServerMenuState = { x: number; y: number; connectionId: number } | null
type AppDialogOptions = Omit<AppDialogRequest, 'id' | 'kind'>
type OpenMonitorPanelOptions = { tab?: 'overview' | 'detail'; serverID?: number | null }
type ServerGroup = { id: number; name: string }
type GroupPayload = { id: number; name: string }

export type AlertNotification = {
  event: AlertEvent
  kind: 'firing' | 'resolved'
}

export interface UseAppMenuActionsOptions {
  activeView: Ref<AppPanelView>
  busy: Ref<boolean>
  serverMenu: Ref<ServerMenuState>
  logLevelFilter: Ref<string>
  logQuery: Ref<string>
  sftpOpenRevision: Ref<number>
  connections: () => Connection[]
  pendingForAction: (action: 'connect-saved') => PendingPaneOpenTarget | null
  clearPendingPaneOpenTarget: (target?: PendingPaneOpenTarget | null) => void
  beginPaneOpenTarget: (paneId: string, action: 'connect-saved') => PendingPaneOpenTarget
  closeServerPickerOverlay: () => void
  toggleServerPickerFromTopbar: (anchor: HTMLElement) => void
  openServerPickerForPaneTarget: () => void
  openOrActivateServerRuntime: (connection: Connection) => Promise<void>
  openSftpRuntime: (connection: Connection) => Promise<void>
  reconnectSftpRuntime: (connectionId: number, contextId: string, terminalSessionId: string) => Promise<boolean>
  openAlertCenterOverlay: () => void
  closeAlertCenterOverlay: () => void
  markAlertRead: (eventID: string) => void
  viewAlert: (event: AlertEvent) => AlertCenterViewIntent
  createTestAlertNotifications: () => AlertNotification[]
  sendNativeAlertNotifications: (notifications: AlertNotification[]) => Promise<void> | void
  openMonitorPanel: (options?: OpenMonitorPanelOptions) => void
  refreshLogs: (run: (action: () => Promise<void>, fallback: string) => Promise<void>) => Promise<void>
  writeClipboardText: (detail: string) => Promise<void>
  logFrontendError: (scope: string) => Promise<void>
  groups: () => ServerGroup[]
  serverPickerAnchor: Ref<HTMLElement | null>
  nextTick: () => Promise<void>
  inputDialog: (request: AppDialogOptions) => Promise<string | null>
  confirmDialog: (request: AppDialogOptions) => Promise<boolean>
  saveGroup: (group: GroupPayload) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  loadConnections: () => Promise<void>
  reorderServers: (request: ReorderServersRequest) => Promise<void>
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
}

export function useAppMenuActions(options: UseAppMenuActionsOptions) {
  function pendingConnectSavedTarget() {
    return options.pendingForAction('connect-saved')
  }

  function closeServerPicker() {
    options.closeServerPickerOverlay()
    options.clearPendingPaneOpenTarget(pendingConnectSavedTarget())
  }

  function closeTransientOverlays() {
    closeServerPicker()
    options.serverMenu.value = null
  }

  function toggleServerPicker(anchor: HTMLElement) {
    options.serverMenu.value = null
    options.clearPendingPaneOpenTarget()
    options.toggleServerPickerFromTopbar(anchor)
  }

  function openSavedServerPickerForPane(paneId: string) {
    closeTransientOverlays()
    options.beginPaneOpenTarget(paneId, 'connect-saved')
    options.openServerPickerForPaneTarget()
    options.activeView.value = 'terminals'
  }

  async function openOrActivateServer(connection: Connection) {
    options.closeServerPickerOverlay()
    await options.openOrActivateServerRuntime(connection)
  }

  async function openSftpForConnection(connection: Connection) {
    options.activeView.value = 'terminals'
    options.sftpOpenRevision.value += 1
    await options.openSftpRuntime(connection)
  }

  function openSftpById(connectionId: number) {
    const connection = options.connections().find((item) => item.id === connectionId)
    if (connection) void openSftpForConnection(connection)
  }

  async function reconnectSftpById(connectionId: number, contextId = '', terminalSessionId = '') {
    if (await options.reconnectSftpRuntime(connectionId, contextId, terminalSessionId)) {
      options.showToast('SFTP/SCP 已重新连接', 'success')
    }
  }

  function openAlertCenter() {
    options.openAlertCenterOverlay()
  }

  function handleAlertNotifications(notifications: AlertNotification[]) {
    for (const notification of notifications) {
      const type = notification.kind === 'resolved'
        ? 'success'
        : notification.event.severity === 'critical'
          ? 'error'
          : 'info'
      options.showToast(notification.event.title, type, notification.event.message)
    }
    void options.sendNativeAlertNotifications(notifications)
  }

  function handleAlertView(event: AlertEvent) {
    options.markAlertRead(event.eventID)
    const intent = options.viewAlert(event)
    if (intent.type !== 'open-monitor-detail') {
      return
    }
    const connection = options.connections().find((item) => item.id === intent.serverID)
    if (!connection) {
      options.showToast('该服务器已被删除。', 'error')
      return
    }
    options.closeAlertCenterOverlay()
    closeTransientOverlays()
    options.openMonitorPanel({ tab: 'detail', serverID: intent.serverID })
  }

  function createTestAlert() {
    handleAlertNotifications(options.createTestAlertNotifications())
  }

  async function addGroup() {
    closeTransientOverlays()
    await options.nextTick()
    await options.inputDialog({
      title: '添加分组',
      label: '分组名称',
      placeholder: '输入分组名称',
      confirmText: '添加',
      returnFocus: options.serverPickerAnchor.value,
      validate: (value) => {
        if (!value) return '请输入分组名称'
        if (options.groups().some((group) =>
          group.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
          return '分组名称已存在'
        }
        return ''
      },
      submit: async (value) => {
        await options.saveGroup({ id: 0, name: value })
        await options.loadConnections()
        options.showToast('分组已添加', 'success')
      },
    })
  }

  async function removeGroup(id: number, name: string) {
    closeTransientOverlays()
    await options.nextTick()
    if (!await options.confirmDialog({
      title: '删除分组',
      message: `删除分组“${name}”？组内服务器将移至未分组。`,
      confirmText: '删除分组',
      danger: true,
      returnFocus: options.serverPickerAnchor.value,
    })) return
    await run(async () => {
      await options.deleteGroup(id)
      await options.loadConnections()
    }, '删除服务器分组失败')
  }

  async function reorderServer(request: ReorderServersRequest) {
    try {
      await options.reorderServers(request)
    } catch (reason) {
      options.showToast('服务器排序保存失败', 'error', errorMessage(reason, '服务器排序保存失败'))
    }
  }

  async function showLogs() {
    options.activeView.value = 'logs'
    await options.refreshLogs(run)
  }

  function closeLogs() {
    options.activeView.value = 'terminals'
  }

  function setLogLevelFilter(value: string) {
    options.logLevelFilter.value = value
  }

  function setLogQuery(value: string) {
    options.logQuery.value = value
  }

  function showConnectionError(connectionError: ConnectionError | undefined, fallback: string) {
    if (!connectionError) {
      options.showToast(fallback || 'SSH 连接失败', 'error')
      return
    }
    options.showToast(
      connectionError.userMessage || fallback || 'SSH 连接失败',
      'error',
      connectionError.technicalMessage,
      connectionError.code,
    )
  }

  async function copyLogDetail(detail = '') {
    if (!detail) return
    try {
      await options.writeClipboardText(detail)
      options.showToast('技术详情已复制', 'success')
    } catch (reason) {
      options.showToast(errorMessage(reason, '复制技术详情失败'), 'error')
    }
  }

  function handleMonitorError() {
    options.showToast('监控面板发生错误，其他功能仍可继续使用', 'error')
    void options.logFrontendError('monitor-boundary')
      .catch(() => console.error('Unable to write monitor component error to the application log'))
  }

  async function run(action: () => Promise<void>, fallback: string) {
    options.busy.value = true
    try {
      await action()
    } catch (reason) {
      options.showToast(errorMessage(reason, fallback), 'error')
    } finally {
      options.busy.value = false
    }
  }

  function errorMessage(reason: unknown, fallback: string) {
    const message = String(reason).replace(/^Error:\s*/i, '').trim()
    return message || fallback
  }

  return {
    pendingConnectSavedTarget,
    closeServerPicker,
    closeTransientOverlays,
    toggleServerPicker,
    openSavedServerPickerForPane,
    openOrActivateServer,
    openSftpForConnection,
    openSftpById,
    reconnectSftpById,
    openAlertCenter,
    handleAlertNotifications,
    handleAlertView,
    createTestAlert,
    addGroup,
    removeGroup,
    reorderServer,
    showLogs,
    closeLogs,
    setLogLevelFilter,
    setLogQuery,
    showConnectionError,
    copyLogDetail,
    handleMonitorError,
    run,
    errorMessage,
  }
}
