import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppMenuActions } from './useAppMenuActions'
import type { AlertEvent, Connection, ConnectionError, ReorderServersRequest } from '../types'

const connection = (id: number, name = `server-${id}`) => ({
  id,
  name,
  host: '127.0.0.1',
  port: 22,
}) as Connection

const alertEvent = (overrides: Partial<AlertEvent> = {}) => ({
  eventID: 'alert-1',
  serverID: 7,
  severity: 'warning',
  title: 'CPU high',
  message: 'CPU warning',
  status: 'firing',
  startedAt: '',
  updatedAt: '',
  ...overrides,
}) as AlertEvent

function createActions(overrides: Partial<Parameters<typeof useAppMenuActions>[0]> = {}) {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const busy = ref(false)
  const serverMenu = ref<{ x: number; y: number; connectionId: number } | null>({ x: 1, y: 2, connectionId: 7 })
  const logLevelFilter = ref('all')
  const logQuery = ref('')
  const sftpOpenRevision = ref(0)
  const deps: Parameters<typeof useAppMenuActions>[0] = {
    activeView,
    busy,
    serverMenu,
    logLevelFilter,
    logQuery,
    sftpOpenRevision,
    connections: () => [connection(7)],
    pendingForAction: vi.fn(() => ({ paneId: 'pane-a', action: 'connect-saved' as const, requestId: 1 })),
    clearPendingPaneOpenTarget: vi.fn(),
    beginPaneOpenTarget: vi.fn(),
    closeServerPickerOverlay: vi.fn(),
    toggleServerPickerFromTopbar: vi.fn(),
    openServerPickerForPaneTarget: vi.fn(),
    openOrActivateServerRuntime: vi.fn(async () => undefined),
    openSftpRuntime: vi.fn(async () => undefined),
    reconnectSftpRuntime: vi.fn(async () => true),
    openAlertCenterOverlay: vi.fn(),
    closeAlertCenterOverlay: vi.fn(),
    markAlertRead: vi.fn(),
    viewAlert: vi.fn(() => ({ type: 'none' as const, eventID: 'alert-1' })),
    createTestAlertNotifications: vi.fn(() => [{ event: alertEvent(), kind: 'firing' as const }]),
    sendNativeAlertNotifications: vi.fn(async () => undefined),
    openMonitorPanel: vi.fn(),
    refreshLogs: vi.fn(async () => undefined),
    writeClipboardText: vi.fn(async () => undefined),
    logFrontendError: vi.fn(async () => undefined),
    groups: () => [{ id: 1, name: 'prod' }],
    serverPickerAnchor: ref<HTMLElement | null>(null),
    nextTick: vi.fn(async () => undefined),
    inputDialog: vi.fn(async () => null),
    confirmDialog: vi.fn(async () => true),
    saveGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    loadConnections: vi.fn(async () => undefined),
    reorderServers: vi.fn(async () => undefined),
    showToast: vi.fn(),
    ...overrides,
  }
  return {
    activeView,
    busy,
    serverMenu,
    logLevelFilter,
    logQuery,
    sftpOpenRevision,
    deps,
    actions: useAppMenuActions(deps),
  }
}

describe('useAppMenuActions', () => {
  it('opens and closes ServerPicker entry points without changing picker behavior', async () => {
    const ctx = createActions()
    const anchor = {} as HTMLElement

    ctx.actions.toggleServerPicker(anchor)
    expect(ctx.serverMenu.value).toBeNull()
    expect(ctx.deps.clearPendingPaneOpenTarget).toHaveBeenCalledWith()
    expect(ctx.deps.toggleServerPickerFromTopbar).toHaveBeenCalledWith(anchor)

    ctx.serverMenu.value = { x: 1, y: 2, connectionId: 7 }
    ctx.actions.openSavedServerPickerForPane('pane-b')
    expect(ctx.deps.closeServerPickerOverlay).toHaveBeenCalled()
    expect(ctx.deps.clearPendingPaneOpenTarget).toHaveBeenCalledWith({ paneId: 'pane-a', action: 'connect-saved', requestId: 1 })
    expect(ctx.serverMenu.value).toBeNull()
    expect(ctx.deps.beginPaneOpenTarget).toHaveBeenCalledWith('pane-b', 'connect-saved')
    expect(ctx.deps.openServerPickerForPaneTarget).toHaveBeenCalled()
    expect(ctx.activeView.value).toBe('terminals')
  })

  it('routes server and SFTP actions through injected runtime callbacks only', async () => {
    const ctx = createActions()

    await ctx.actions.openOrActivateServer(connection(7))
    expect(ctx.deps.closeServerPickerOverlay).toHaveBeenCalled()
    expect(ctx.deps.openOrActivateServerRuntime).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))

    await ctx.actions.openSftpForConnection(connection(7))
    expect(ctx.activeView.value).toBe('terminals')
    expect(ctx.sftpOpenRevision.value).toBe(1)
    expect(ctx.deps.openSftpRuntime).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))

    ctx.actions.openSftpById(7)
    await Promise.resolve()
    expect(ctx.deps.openSftpRuntime).toHaveBeenCalledTimes(2)

    await ctx.actions.reconnectSftpById(7, 'ctx-a', 'ssh-a')
    expect(ctx.deps.reconnectSftpRuntime).toHaveBeenCalledWith(7, 'ctx-a', 'ssh-a')
    expect(ctx.deps.showToast).toHaveBeenCalledWith('SFTP/SCP 已重新连接', 'success')
  })

  it('maps alert notifications and alert view intents to existing UI callbacks', () => {
    const ctx = createActions({
      viewAlert: vi.fn(() => ({ type: 'open-monitor-detail' as const, eventID: 'alert-1', serverID: 7 })),
    })

    ctx.actions.handleAlertNotifications([
      { event: alertEvent({ severity: 'critical', title: 'Critical' }), kind: 'firing' },
      { event: alertEvent({ severity: 'warning', title: 'Recovered' }), kind: 'resolved' },
    ])
    expect(ctx.deps.showToast).toHaveBeenCalledWith('Critical', 'error', 'CPU warning')
    expect(ctx.deps.showToast).toHaveBeenCalledWith('Recovered', 'success', 'CPU warning')
    expect(ctx.deps.sendNativeAlertNotifications).toHaveBeenCalledWith([
      { event: expect.objectContaining({ title: 'Critical' }), kind: 'firing' },
      { event: expect.objectContaining({ title: 'Recovered' }), kind: 'resolved' },
    ])

    ctx.actions.createTestAlert()
    expect(ctx.deps.createTestAlertNotifications).toHaveBeenCalled()

    ctx.actions.handleAlertView(alertEvent())
    expect(ctx.deps.markAlertRead).toHaveBeenCalledWith('alert-1')
    expect(ctx.deps.closeAlertCenterOverlay).toHaveBeenCalled()
    expect(ctx.deps.openMonitorPanel).toHaveBeenCalledWith({ tab: 'detail', serverID: 7 })
  })

  it('keeps logs, clipboard, monitor error, run, and connection error glue behavior', async () => {
    const ctx = createActions()

    await ctx.actions.showLogs()
    expect(ctx.activeView.value).toBe('logs')
    expect(ctx.deps.refreshLogs).toHaveBeenCalledWith(ctx.actions.run)

    ctx.actions.closeLogs()
    ctx.actions.setLogLevelFilter('error')
    ctx.actions.setLogQuery('needle')
    expect(ctx.activeView.value).toBe('terminals')
    expect(ctx.logLevelFilter.value).toBe('error')
    expect(ctx.logQuery.value).toBe('needle')

    await ctx.actions.copyLogDetail('detail text')
    expect(ctx.deps.writeClipboardText).toHaveBeenCalledWith('detail text')
    expect(ctx.deps.showToast).toHaveBeenCalledWith('技术详情已复制', 'success')

    const failure = new Error('boom')
    await ctx.actions.run(async () => { throw failure }, 'fallback')
    expect(ctx.busy.value).toBe(false)
    expect(ctx.deps.showToast).toHaveBeenCalledWith('boom', 'error')

    ctx.actions.showConnectionError({
      userMessage: 'user message',
      technicalMessage: 'technical',
      code: 'ERR',
    } as ConnectionError, 'fallback')
    expect(ctx.deps.showToast).toHaveBeenCalledWith('user message', 'error', 'technical', 'ERR')

    ctx.actions.handleMonitorError()
    expect(ctx.deps.showToast).toHaveBeenCalledWith('监控面板发生错误，其他功能仍可继续使用', 'error')
    expect(ctx.deps.logFrontendError).toHaveBeenCalledWith('monitor-boundary')
  })

  it('moves ServerPicker group actions behind injected dialog and persistence callbacks', async () => {
    const request: ReorderServersRequest = {
      serverID: 7,
      sourceGroupID: null,
      targetGroupID: 1,
      beforeServerID: null,
      afterServerID: null,
    }
    const ctx = createActions({
      inputDialog: vi.fn(async (dialog) => {
        expect(dialog.title).toBe('添加分组')
        expect(dialog.validate?.('prod')).toBe('分组名称已存在')
        await dialog.submit?.('stage')
        return 'stage'
      }),
      confirmDialog: vi.fn(async () => true),
    })

    await ctx.actions.addGroup()
    expect(ctx.deps.closeServerPickerOverlay).toHaveBeenCalled()
    expect(ctx.deps.saveGroup).toHaveBeenCalledWith({ id: 0, name: 'stage' })
    expect(ctx.deps.loadConnections).toHaveBeenCalled()
    expect(ctx.deps.showToast).toHaveBeenCalledWith('分组已添加', 'success')

    await ctx.actions.removeGroup(1, 'prod')
    expect(ctx.deps.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '删除分组',
      danger: true,
    }))
    expect(ctx.deps.deleteGroup).toHaveBeenCalledWith(1)

    await ctx.actions.reorderServer(request)
    expect(ctx.deps.reorderServers).toHaveBeenCalledWith(request)
  })
})
