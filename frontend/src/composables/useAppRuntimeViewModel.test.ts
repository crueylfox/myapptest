import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useAppRuntimeViewModel } from './useAppRuntimeViewModel'
import type {
  Connection,
  ConnectionRuntimeState,
  LogEntry,
  MonitorNetworkInterfacePreference,
  MonitorSnapshot,
  NetworkInterface,
  TerminalSessionInfo,
} from '../types'

const connection = (id: number, name: string, groupId: number | null = null): Connection => ({
  id,
  groupId,
  name,
  host: `${name}.example.test`,
  port: 22,
  username: 'user',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  terminalProfileId: null,
  connectionMode: 'direct',
  jumpServerId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
})

const state = (connectionId: number, status: ConnectionRuntimeState['status']): ConnectionRuntimeState => ({
  connectionId,
  status,
  monitorActive: status === 'online',
  terminalActive: status === 'online',
  terminalConnecting: false,
  sftpActive: false,
  connecting: false,
  hasActiveSession: status === 'online',
  updatedAt: '',
})

const snapshot = (connectionId: number): MonitorSnapshot => ({
  connectionId,
  status: 'online',
  timestamp: '2026-07-02T00:00:00Z',
  latencyMillis: 0,
  latencyAvailable: false,
  cpuPercent: null,
  memoryTotal: 0,
  memoryAvailable: 0,
  memoryUsedPercent: null,
  swapTotal: 0,
  swapFree: 0,
  diskTotal: 0,
  diskUsed: 0,
  diskUsedPercent: null,
  mounts: [],
  processes: [],
  processStatus: 'empty',
  processMessage: '',
  loadOne: null,
  loadFive: null,
  loadFifteen: null,
  uptimeSeconds: null,
  defaultInterface: '',
  downloadBytesPerSecond: null,
  uploadBytesPerSecond: null,
  osName: '',
  kernel: '',
  architecture: '',
  errors: [],
  errorCode: '',
  message: '',
  monitorActive: true,
})

const terminalSession = (connectionId: number): TerminalSessionInfo => ({
  sessionId: `ssh-${connectionId}`,
  connectionId,
  title: `server-${connectionId}`,
  status: 'online',
  code: '',
  message: '',
})

const networkInterface: NetworkInterface = {
  serverID: 2,
  name: 'eth0',
  displayName: 'eth0',
  isUp: true,
  isLoopback: false,
  ipv4: [],
  ipv6: [],
  rxBytes: 1,
  txBytes: 2,
  lastUpdatedAt: '',
}

const networkPreference: MonitorNetworkInterfacePreference = {
  serverID: 2,
  mode: 'all',
  selectedNetworkInterface: '',
  userSelected: false,
  updatedAt: '',
}

describe('useAppRuntimeViewModel', () => {
  it('builds filtered grouped connection and active workspace view state from injected stores', () => {
    const debian = connection(1, 'debian', 10)
    const fedora = connection(2, 'fedora')
    const disconnected = state(1, 'disconnected')
    const online = state(2, 'online')
    const search = ref('debian')
    const toolDialogServerId = ref<number | null>(null)
    const logs: LogEntry[] = [{ time: '', level: 'info', message: 'loaded', summary: 'loaded' }]

    const viewModel = useAppRuntimeViewModel({
      search,
      toolDialogServerId,
      store: {
        connections: [debian, fedora],
        groups: [{ id: 10, name: 'lab' }],
        logs,
        selectedId: 2,
        snapshots: { 2: snapshot(2) },
        histories: { 2: [snapshot(2)] },
        networkInterfaces: { 2: [networkInterface] },
        networkInterfacePreferences: { 2: networkPreference },
        networkInterfacesLoading: { 2: true },
        connectionState: (connectionId) => connectionId === 2 ? online : disconnected,
      },
      terminalStore: {
        activeServerId: 2,
        activeWorkspaceServerId: 2,
        sessionsByServerId: { 2: [terminalSession(2)] },
      },
      localTerminalStore: { enabled: true },
      sftpStore: {
        stateByServerId: {},
        stateByContextId: {},
        transfersByServerId: {},
      },
      tunnelStore: { runtimes: [] },
      dockerStore: {
        availabilityByServerId: {},
        containersByServerId: {},
      },
      appLogsController: {
        filteredLogs: () => logs,
      },
    })

    expect(viewModel.filteredConnections.value).toEqual([debian])
    expect(viewModel.groupedConnections.value).toEqual([{ id: 10, name: 'lab', items: [debian] }])
    expect(viewModel.activeWorkspaceConnection.value).toBe(fedora)
    expect(viewModel.activeWorkspaceState.value).toBe(online)
    expect(viewModel.activeWorkspaceHistory.value).toHaveLength(1)
    expect(viewModel.activeNetworkServerId.value).toBe(2)
    expect(viewModel.toolDialogActiveServerId.value).toBe(2)
    expect(viewModel.activeWorkspaceNetworkInterfaces.value).toEqual([networkInterface])
    expect(viewModel.activeWorkspaceNetworkInterfacesLoading.value).toBe(true)
    expect(viewModel.localTerminalEnabled.value).toBe(true)
    expect(viewModel.filteredLogs.value).toBe(logs)
    expect(viewModel.serverStatuses.value).toEqual({ 1: 'disconnected', 2: 'online' })
    expect(viewModel.dashboardSummaries.value.map((summary) => summary.serverID)).toEqual([1, 2])
  })

  it('falls back safely when there is no active workspace server', () => {
    const search = ref('')
    const toolDialogServerId = ref<number | null>(9)
    const viewModel = useAppRuntimeViewModel({
      search,
      toolDialogServerId,
      store: {
        connections: [],
        groups: [],
        logs: [],
        selectedId: null,
        snapshots: {},
        histories: {},
        networkInterfaces: {},
        networkInterfacePreferences: {},
        networkInterfacesLoading: {},
        connectionState: (connectionId) => state(connectionId, 'disconnected'),
      },
      terminalStore: {
        activeServerId: null,
        activeWorkspaceServerId: null,
        sessionsByServerId: {},
      },
      localTerminalStore: { enabled: false },
      sftpStore: {
        stateByServerId: {},
        stateByContextId: {},
        transfersByServerId: {},
      },
      tunnelStore: { runtimes: [] },
      dockerStore: {
        availabilityByServerId: {},
        containersByServerId: {},
      },
      appLogsController: {
        filteredLogs: () => [],
      },
    })

    expect(viewModel.activeWorkspaceConnection.value).toBeNull()
    expect(viewModel.activeWorkspaceHistory.value).toEqual([])
    expect(viewModel.activeWorkspaceState.value).toBeNull()
    expect(viewModel.activeWorkspaceNetworkInterfaces.value).toEqual([])
    expect(viewModel.activeWorkspaceNetworkInterfacePreference.value).toBeNull()
    expect(viewModel.activeWorkspaceNetworkInterfacesLoading.value).toBe(false)
    expect(viewModel.toolDialogActiveServerId.value).toBe(9)
  })
})
