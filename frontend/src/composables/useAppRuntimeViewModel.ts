import { computed, type Ref } from 'vue'
import { snapshotForActiveServer } from '../utils/activeContext'
import { buildDashboardSummaries } from '../utils/multiServerDashboard'
import type {
  Connection,
  ConnectionRuntimeState,
  ConnectionStatus,
  DockerAvailability,
  DockerContainer,
  Group,
  LogEntry,
  MonitorNetworkInterfacePreference,
  MonitorSnapshot,
  NetworkInterface,
  SFTPState,
  SFTPTransferState,
  TerminalSessionInfo,
  TunnelRuntime,
} from '../types'

interface RuntimeViewStore {
  connections: Connection[]
  groups: Group[]
  logs: LogEntry[]
  selectedId: number | null
  snapshots: Record<number, MonitorSnapshot>
  histories: Record<number, MonitorSnapshot[]>
  networkInterfaces: Record<number, NetworkInterface[]>
  networkInterfacePreferences: Record<number, MonitorNetworkInterfacePreference>
  networkInterfacesLoading: Record<number, boolean>
  connectionState: (connectionId: number) => ConnectionRuntimeState
}

interface RuntimeViewTerminalStore {
  activeServerId: number | null
  activeWorkspaceServerId: number | null
  sessionsByServerId: Record<number, TerminalSessionInfo[]>
}

interface RuntimeViewLocalTerminalStore {
  enabled: boolean
}

interface RuntimeViewSftpStore {
  stateByServerId: Record<number, SFTPState>
  stateByContextId: Record<string, SFTPState>
  transfersByServerId: Record<number, SFTPTransferState[]>
}

interface RuntimeViewTunnelStore {
  runtimes: TunnelRuntime[]
}

interface RuntimeViewDockerStore {
  availabilityByServerId: Record<number, DockerAvailability>
  containersByServerId: Record<number, DockerContainer[]>
}

export interface AppRuntimeViewModelOptions {
  search: Ref<string>
  toolDialogServerId: Ref<number | null>
  store: RuntimeViewStore
  terminalStore: RuntimeViewTerminalStore
  localTerminalStore: RuntimeViewLocalTerminalStore
  sftpStore: RuntimeViewSftpStore
  tunnelStore: RuntimeViewTunnelStore
  dockerStore: RuntimeViewDockerStore
  appLogsController: {
    filteredLogs: (logs: LogEntry[]) => LogEntry[]
  }
}

export function useAppRuntimeViewModel(options: AppRuntimeViewModelOptions) {
  const filteredConnections = computed(() => {
    const query = options.search.value.trim().toLowerCase()
    return options.store.connections.filter((connection) =>
      !query || connection.name.toLowerCase().includes(query) || connection.host.toLowerCase().includes(query),
    )
  })
  const activeTerminalSnapshot = computed(() =>
    snapshotForActiveServer(options.terminalStore.activeServerId, options.store.snapshots))
  const activeWorkspaceConnection = computed(() =>
    options.store.connections.find((connection) =>
      connection.id === options.terminalStore.activeWorkspaceServerId) ?? null)
  const activeWorkspaceHistory = computed(() =>
    options.terminalStore.activeWorkspaceServerId === null
      ? []
      : options.store.histories[options.terminalStore.activeWorkspaceServerId] ?? [])
  const activeWorkspaceState = computed(() =>
    options.terminalStore.activeWorkspaceServerId === null
      ? null
      : options.store.connectionState(options.terminalStore.activeWorkspaceServerId))
  const activeNetworkServerId = computed(() =>
    options.terminalStore.activeWorkspaceServerId ?? options.store.selectedId)
  const toolDialogActiveServerId = computed(() =>
    options.toolDialogServerId.value ?? options.terminalStore.activeWorkspaceServerId ?? options.store.selectedId)
  const activeWorkspaceNetworkInterfaces = computed(() =>
    options.terminalStore.activeWorkspaceServerId === null
      ? []
      : options.store.networkInterfaces[options.terminalStore.activeWorkspaceServerId] ?? [])
  const activeWorkspaceNetworkInterfacePreference = computed(() =>
    options.terminalStore.activeWorkspaceServerId === null
      ? null
      : options.store.networkInterfacePreferences[options.terminalStore.activeWorkspaceServerId] ?? null)
  const activeWorkspaceNetworkInterfacesLoading = computed(() =>
    options.terminalStore.activeWorkspaceServerId === null
      ? false
      : options.store.networkInterfacesLoading[options.terminalStore.activeWorkspaceServerId] ?? false)
  const localTerminalEnabled = computed(() => Boolean(options.localTerminalStore.enabled))
  const filteredLogs = computed(() => options.appLogsController.filteredLogs(options.store.logs))
  const groupedConnections = computed(() => {
    const rows = options.store.groups.map((group) => ({
      id: group.id, name: group.name,
      items: filteredConnections.value.filter((item) => item.groupId === group.id),
    }))
    const ungrouped = filteredConnections.value.filter((item) => item.groupId === null)
    if (ungrouped.length || rows.length === 0) rows.push({ id: 0, name: '未分组', items: ungrouped })
    return rows
  })
  const serverStatuses = computed(() =>
    Object.fromEntries(options.store.connections.map((connection) => [
      connection.id,
      options.store.connectionState(connection.id).status,
    ])) as Record<number, ConnectionStatus>)
  const dashboardSummaries = computed(() => buildDashboardSummaries({
    connections: options.store.connections,
    groups: options.store.groups,
    connectionState: (serverID) => options.store.connectionState(serverID),
    snapshots: options.store.snapshots,
    terminalSessionsByServerId: options.terminalStore.sessionsByServerId,
    sftpStatesByServerId: options.sftpStore.stateByServerId,
    sftpStatesByContextId: options.sftpStore.stateByContextId,
    sftpTransfersByServerId: options.sftpStore.transfersByServerId,
    tunnelRuntimes: options.tunnelStore.runtimes,
    dockerAvailabilityByServerId: options.dockerStore.availabilityByServerId,
    dockerContainersByServerId: options.dockerStore.containersByServerId,
    activeWorkspaceServerId: options.terminalStore.activeWorkspaceServerId,
  }))

  return {
    filteredConnections,
    activeTerminalSnapshot,
    activeWorkspaceConnection,
    activeWorkspaceHistory,
    activeWorkspaceState,
    activeNetworkServerId,
    toolDialogActiveServerId,
    activeWorkspaceNetworkInterfaces,
    activeWorkspaceNetworkInterfacePreference,
    activeWorkspaceNetworkInterfacesLoading,
    localTerminalEnabled,
    filteredLogs,
    groupedConnections,
    serverStatuses,
    dashboardSummaries,
  }
}
