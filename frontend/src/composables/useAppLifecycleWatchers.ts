import { watch, type Ref } from 'vue'
import type {
  AlertEvent,
  AppSettings,
  AuthRequest,
  Connection,
  ConnectionError,
  ConnectionRuntimeState,
  MonitorSnapshot,
  TerminalStatusEvent,
} from '../types'
import type { TerminalStatusReconnectIntent } from './useSftpActiveContextBridge'

type AppView = 'terminals' | 'monitor' | 'logs' | 'settings'
type ToastType = 'success' | 'error' | 'info'
type StoreErrorEvent = { message?: string } | null
type AlertNotification = { event: AlertEvent; kind: 'firing' | 'resolved' }

export interface AppLifecycleWatchersOptions {
  alertPersistenceWarning: Ref<string>
  terminalLastStatus: Ref<TerminalStatusEvent | null>
  activeView: Ref<AppView>
  terminalLayoutRevision: Ref<number>
  activeNetworkServerId: () => number | null | undefined
  activeWorkspaceMonitorActive: () => boolean | null | undefined
  terminalProfileDefaultProfileId: () => string | null | undefined
  settings: Ref<AppSettings>
  tunnelLastError: Ref<StoreErrorEvent>
  dockerLastError: Ref<StoreErrorEvent>
  connectionStates: () => Record<number, ConnectionRuntimeState>
  snapshots: () => Record<number, MonitorSnapshot>
  connections: () => Connection[]
  resolveTerminalStatusReconnectIntent: (event: TerminalStatusEvent) => TerminalStatusReconnectIntent
  loadConnections: () => Promise<unknown>
  reconnectFileContextsAfterTerminalOnline: (
    connectionId: number,
    terminalSessionId: string,
    auth: AuthRequest,
  ) => Promise<unknown>
  emptyAuth: () => AuthRequest
  showConnectionError: (connectionError: ConnectionError | undefined, fallback: string) => void
  loadNetworkInterfacePreference: (serverID: number) => Promise<unknown>
  loadNetworkInterfaces: (serverID: number) => Promise<unknown>
  handleAlertNotifications: (notifications: AlertNotification[]) => void
  ingestConnectionState: (state: ConnectionRuntimeState, connection: Connection | undefined) => AlertNotification[]
  syncConnectionState: (connection: Connection, state: ConnectionRuntimeState) => void
  refreshConnections: () => Promise<unknown>
  setMonitorNetworkInterface: (
    serverID: number,
    mode: 'all',
    selectedNetworkInterface: string,
    userSelected: boolean,
  ) => Promise<unknown>
  ingestSnapshot: (snapshot: MonitorSnapshot, connection: Connection | undefined) => AlertNotification[]
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  logRefreshSecurityStateError: (reason: unknown) => void
}

export function useAppLifecycleWatchers(options: AppLifecycleWatchersOptions) {
  const refreshedSecurityState = new Set<number>()
  const reportedConnectionErrors = new Map<number, string>()
  const reportedNetworkFallbacks = new Set<string>()
  const stops = [
    watch(() => options.alertPersistenceWarning.value, (message) => {
      if (message) options.showToast('告警历史保存失败', 'error')
    }),

    watch(() => options.terminalLastStatus.value, (event) => {
      if (!event) return
      const fileReconnectIntent = options.resolveTerminalStatusReconnectIntent(event)
      if (event.status === 'online') {
        void options.loadConnections()
        if (fileReconnectIntent.type === 'reconnect-file-contexts') {
          void options.reconnectFileContextsAfterTerminalOnline(
            fileReconnectIntent.connectionId,
            fileReconnectIntent.terminalSessionId,
            options.emptyAuth(),
          )
        }
        return
      }
      if (event.status === 'error') {
        options.showConnectionError(event.connectionError, event.message)
      }
    }, { deep: true }),

    watch(options.activeView, (view) => {
      if (view === 'terminals') options.terminalLayoutRevision.value += 1
    }),

    watch(() => [options.activeNetworkServerId(), options.activeWorkspaceMonitorActive()] as const, ([serverID, monitorActive]) => {
      if (!serverID) return
      void (async () => {
        await options.loadNetworkInterfacePreference(serverID).catch(() => undefined)
        if (monitorActive) await options.loadNetworkInterfaces(serverID).catch(() => undefined)
      })()
    }),

    watch(() => options.terminalProfileDefaultProfileId(), (id) => {
      if (!id || options.settings.value.defaultTerminalProfileId === id) return
      options.settings.value = { ...options.settings.value, defaultTerminalProfileId: id }
    }),

    watch(() => options.tunnelLastError.value, (event) => {
      if (!event) return
      options.showToast(event.message || '端口转发失败', 'error')
    }, { deep: true }),

    watch(() => options.dockerLastError.value, (event) => {
      if (!event) return
      options.showToast(event.message || 'Docker 操作失败。', 'error')
    }, { deep: true }),

    watch(options.connectionStates, (states) => {
      for (const state of Object.values(states)) {
        const connection = options.connections().find((item) => item.id === state.connectionId)
        options.handleAlertNotifications(options.ingestConnectionState(state, connection))
        if (connection) options.syncConnectionState(connection, state)
        if (state.lastError) {
          const signature = `${state.lastError.code}:${state.lastError.technicalMessage}`
          if (reportedConnectionErrors.get(state.connectionId) !== signature) {
            reportedConnectionErrors.set(state.connectionId, signature)
            options.showConnectionError(state.lastError, state.lastError.userMessage)
          }
        } else if (state.status === 'online') {
          reportedConnectionErrors.delete(state.connectionId)
        }
      }
    }, { deep: true }),

    watch(options.snapshots, (snapshots) => {
      for (const snapshot of Object.values(snapshots)) {
        if (snapshot.status !== 'online' || refreshedSecurityState.has(snapshot.connectionId)) continue
        refreshedSecurityState.add(snapshot.connectionId)
        void options.refreshConnections().catch((reason) => {
          refreshedSecurityState.delete(snapshot.connectionId)
          options.logRefreshSecurityStateError(reason)
        })
      }
    }, { deep: true }),

    watch(options.snapshots, (snapshots) => {
      for (const snapshot of Object.values(snapshots)) {
        if (!snapshot.networkInterfaceFallback || !snapshot.networkInterfaceMessage) continue
        const key = `${snapshot.connectionId}:${snapshot.networkInterfaceMessage}`
        if (reportedNetworkFallbacks.has(key)) continue
        reportedNetworkFallbacks.add(key)
        options.showToast(snapshot.networkInterfaceMessage, 'info')
        void options.setMonitorNetworkInterface(snapshot.connectionId, 'all', '', false).catch(() => undefined)
      }
    }, { deep: true }),

    watch(options.snapshots, (snapshots) => {
      for (const snapshot of Object.values(snapshots)) {
        const connection = options.connections().find((item) => item.id === snapshot.connectionId)
        options.handleAlertNotifications(options.ingestSnapshot(snapshot, connection))
      }
    }, { deep: true }),
  ]

  function stop() {
    for (const stopWatcher of stops) stopWatcher()
  }

  return {
    stop,
  }
}
