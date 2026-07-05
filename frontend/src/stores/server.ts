import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import type {
  AuthRequest, Connection, ConnectionRuntimeState, ConnectionStatus, Group, LogEntry,
  MonitorNetworkInterfaceMode, MonitorNetworkInterfacePreference, MonitorSnapshot,
  NetworkDiagnosticErrorEvent, NetworkDiagnosticOutputEvent, NetworkDiagnosticStateEvent,
  NetworkDiagnosticTask, NetworkInterface, ReorderServersRequest, SaveConnectionRequest, StartNetworkDiagnosticRequest,
} from '../types'
import { appendHistory } from '../utils/history'
import { normalizeMonitorSnapshot } from '../utils/monitor'

export const useServerStore = defineStore('servers', () => {
  const groups = ref<Group[]>([])
  const connections = ref<Connection[]>([])
  const selectedId = ref<number | null>(null)
  const snapshots = ref<Record<number, MonitorSnapshot>>({})
  const histories = ref<Record<number, MonitorSnapshot[]>>({})
  const networkInterfaces = ref<Record<number, NetworkInterface[]>>({})
  const networkInterfacePreferences = ref<Record<number, MonitorNetworkInterfacePreference>>({})
  const networkInterfaceRecommendations = ref<Record<number, { name: string; reason: string }>>({})
  const networkInterfacesLoading = ref<Record<number, boolean>>({})
  const diagnosticTasks = ref<Record<number, NetworkDiagnosticTask[]>>({})
  const diagnosticOutput = ref<Record<string, string[]>>({})
  const states = ref<Record<number, ConnectionRuntimeState>>({})
  const logs = ref<LogEntry[]>([])
  const loading = ref(false)
  const error = ref('')
  const suppressedServerIds = new Set<number>()
  const ignoredDiagnosticTaskIds = new Set<string>()

  const selected = computed(() => connections.value.find((item) => item.id === selectedId.value) ?? null)
  const snapshot = computed(() => selectedId.value === null ? null : snapshots.value[selectedId.value] ?? null)
  const history = computed(() => selectedId.value === null ? [] : histories.value[selectedId.value] ?? [])
  const selectedState = computed(() =>
    selectedId.value === null ? null : connectionState(selectedId.value))

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [groupRows, connectionRows] = await Promise.all([api.listGroups(), api.listConnections()])
      groups.value = groupRows ?? []
      connections.value = connectionRows ?? []
      if (selectedId.value === null && connections.value.length > 0) selectedId.value = connections.value[0].id
    } catch (reason) {
      error.value = String(reason)
    } finally {
      loading.value = false
    }
  }
  async function refreshConnections() {
    connections.value = (await api.listConnections()) ?? []
  }
  async function reorderServers(request: ReorderServersRequest) {
    const previous = connections.value.slice()
    try {
      connections.value = (await api.reorderServers(request)) ?? []
      return connections.value
    } catch (reason) {
      try {
        await refreshConnections()
      } catch {
        connections.value = previous
      }
      throw reason
    }
  }

  const select = (id: number) => { selectedId.value = id }
  async function save(request: SaveConnectionRequest) {
    const saved = await api.saveConnection(request)
    await load()
    selectedId.value = saved.id
  }
  async function remove(id: number) {
    await api.deleteConnection(id)
    delete snapshots.value[id]
    delete histories.value[id]
    delete states.value[id]
    if (selectedId.value === id) selectedId.value = null
    await load()
  }
  async function connect(connectionId: number, auth: AuthRequest) {
    resumeServer(connectionId)
    await api.connect(connectionId, auth)
    await load()
  }
  async function disconnect() {
    if (selectedId.value === null) return
    await api.disconnectServer(selectedId.value)
    markDisconnected(selectedId.value)
  }
  async function test(connectionId: number, auth: AuthRequest) {
    const result = await api.testConnection(connectionId, auth)
    if (result.success) await load()
    return result
  }
  async function loadLogs() {
    logs.value = (await api.listLogs()) ?? []
  }
  function acceptSnapshot(value: unknown) {
    const snapshot = normalizeMonitorSnapshot(value)
    if (!snapshot) {
      void api.logFrontendError('monitor-boundary').catch(() => console.error('Unable to write monitor validation error to the application log'))
      return
    }
    if (suppressedServerIds.has(snapshot.connectionId)) return
    snapshots.value[snapshot.connectionId] = snapshot
    histories.value[snapshot.connectionId] = appendHistory(histories.value[snapshot.connectionId] ?? [], snapshot)
    networkInterfacePreferences.value[snapshot.connectionId] = {
      serverID: snapshot.connectionId,
      mode: snapshot.networkInterfaceMode ?? 'all',
      selectedNetworkInterface: snapshot.selectedNetworkInterface ?? '',
      userSelected: networkInterfacePreferences.value[snapshot.connectionId]?.userSelected ??
        connections.value.find((item) => item.id === snapshot.connectionId)?.networkInterfaceUserSelected ??
        false,
      updatedAt: snapshot.timestamp,
    }
  }
  function acceptConnectionState(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const candidate = value as Partial<ConnectionRuntimeState>
    if (!Number.isInteger(candidate.connectionId) || Number(candidate.connectionId) <= 0) return
    if (suppressedServerIds.has(Number(candidate.connectionId))) return
    states.value[Number(candidate.connectionId)] = candidate as ConnectionRuntimeState
  }
  function markDisconnected(connectionId: number) {
    suppressedServerIds.add(connectionId)
    delete snapshots.value[connectionId]
    delete histories.value[connectionId]
    delete networkInterfaces.value[connectionId]
    for (const task of diagnosticTasks.value[connectionId] ?? []) {
      if (task.status === 'running') ignoredDiagnosticTaskIds.add(task.taskID)
    }
    states.value[connectionId] = {
      connectionId,
      status: 'disconnected',
      monitorActive: false,
      terminalActive: false,
      terminalConnecting: false,
      sftpActive: false,
      connecting: false,
      hasActiveSession: false,
      updatedAt: new Date().toISOString(),
    }
  }
  function resumeServer(connectionId: number) {
    suppressedServerIds.delete(connectionId)
  }
  function connectionState(connectionId: number): ConnectionRuntimeState {
    return states.value[connectionId] ?? {
      connectionId,
      status: 'offline' as ConnectionStatus,
      monitorActive: false,
      terminalActive: false,
      terminalConnecting: false,
      sftpActive: false,
      connecting: false,
      hasActiveSession: false,
      updatedAt: '',
    }
  }
  const subscribe = () => {
    EventsOn('monitor:snapshot', acceptSnapshot)
    EventsOn('connection:state', acceptConnectionState)
    EventsOn('networkdiag:state', acceptNetworkDiagnosticState)
    EventsOn('networkdiag:output', acceptNetworkDiagnosticOutput)
    EventsOn('networkdiag:error', acceptNetworkDiagnosticError)
  }
  const unsubscribe = () => {
    EventsOff('monitor:snapshot')
    EventsOff('connection:state')
    EventsOff('networkdiag:state')
    EventsOff('networkdiag:output')
    EventsOff('networkdiag:error')
  }

  async function loadNetworkInterfaces(serverID: number) {
    if (!serverID) return []
    networkInterfacesLoading.value[serverID] = true
    try {
      const response = await api.listNetworkInterfaces(serverID)
      const rows = response.interfaces ?? []
      networkInterfaces.value[serverID] = rows
      networkInterfaceRecommendations.value[serverID] = {
        name: response.recommendedInterface || 'all',
        reason: response.recommendedInterfaceReason || 'fallback_all',
      }
      await applyRecommendedNetworkInterface(serverID)
      return rows
    } finally {
      networkInterfacesLoading.value[serverID] = false
    }
  }

  async function loadNetworkInterfacePreference(serverID: number) {
    const preference = await api.getMonitorNetworkInterface(serverID)
    networkInterfacePreferences.value[serverID] = preference
    return preference
  }

  async function setMonitorNetworkInterface(
    serverID: number,
    mode: MonitorNetworkInterfaceMode,
    selectedNetworkInterface = '',
    userSelected = true,
  ) {
    const preference = await api.setMonitorNetworkInterface({
      serverID,
      mode,
      selectedNetworkInterface: mode === 'interface' ? selectedNetworkInterface : '',
      userSelected,
    })
    networkInterfacePreferences.value[serverID] = preference
    histories.value[serverID] = []
    connections.value = connections.value.map((connection) => connection.id === serverID
      ? {
          ...connection,
          networkInterfaceMode: preference.mode,
          selectedNetworkInterface: preference.selectedNetworkInterface,
          networkInterfaceUserSelected: preference.userSelected,
        }
      : connection)
    return preference
  }

  async function applyRecommendedNetworkInterface(serverID: number) {
    const recommendation = networkInterfaceRecommendations.value[serverID]
    if (!recommendation) return null
    const recommended = recommendation.name || 'all'
    if (recommended !== 'all' && !(networkInterfaces.value[serverID] ?? []).some((item) => item.name === recommended)) {
      return null
    }
    const connection = connections.value.find((item) => item.id === serverID)
    const preference = networkInterfacePreferences.value[serverID]
    const userSelected = preference?.userSelected ?? connection?.networkInterfaceUserSelected ?? false
    if (userSelected) return null
    const currentMode = preference?.mode ?? connection?.networkInterfaceMode ?? 'all'
    const currentSelected = preference?.selectedNetworkInterface ?? connection?.selectedNetworkInterface ?? ''
    const nextMode: MonitorNetworkInterfaceMode = recommended === 'all' ? 'all' : 'interface'
    const nextSelected = nextMode === 'interface' ? recommended : ''
    if (currentMode === nextMode && currentSelected === nextSelected) return null
    return setMonitorNetworkInterface(serverID, nextMode, nextSelected, false)
  }

  async function loadNetworkDiagnosticTasks(serverID: number) {
    if (!serverID) return []
    const tasks = await api.listNetworkDiagnosticTasks(serverID)
    diagnosticTasks.value[serverID] = tasks ?? []
    return diagnosticTasks.value[serverID]
  }

  async function startNetworkDiagnostic(request: StartNetworkDiagnosticRequest) {
    const task = await api.startNetworkDiagnostic(request)
    ignoredDiagnosticTaskIds.delete(task.taskID)
    upsertDiagnosticTask(task)
    diagnosticOutput.value[task.taskID] = []
    return task
  }

  async function cancelNetworkDiagnostic(serverID: number, taskID: string) {
    await api.cancelNetworkDiagnostic({ serverID, taskID })
  }

  function clearNetworkDiagnosticOutput(taskID: string) {
    diagnosticOutput.value[taskID] = []
  }

  function ignoreNetworkDiagnosticOutput(taskID: string) {
    ignoredDiagnosticTaskIds.add(taskID)
  }

  function acceptNetworkDiagnosticState(value: unknown) {
    const event = networkDiagnosticStateEvent(value)
    if (!event) return
    upsertDiagnosticTask(event.task)
  }

  function acceptNetworkDiagnosticOutput(value: unknown) {
    const event = networkDiagnosticOutputEvent(value)
    if (!event || ignoredDiagnosticTaskIds.has(event.taskID)) return
    const current = diagnosticOutput.value[event.taskID] ?? []
    diagnosticOutput.value[event.taskID] = [...current, event.line].slice(-1000)
  }

  function acceptNetworkDiagnosticError(value: unknown) {
    const event = networkDiagnosticErrorEvent(value)
    if (!event || ignoredDiagnosticTaskIds.has(event.taskID)) return
    const current = diagnosticOutput.value[event.taskID] ?? []
    diagnosticOutput.value[event.taskID] = [...current, `错误：${event.message}`].slice(-1000)
  }

  function upsertDiagnosticTask(task: NetworkDiagnosticTask) {
    const current = diagnosticTasks.value[task.serverID] ?? []
    const index = current.findIndex((item) => item.taskID === task.taskID)
    const next = index >= 0
      ? current.map((item) => item.taskID === task.taskID ? task : item)
      : [task, ...current]
    diagnosticTasks.value[task.serverID] = next.slice(0, 20)
  }

  function networkDiagnosticStateEvent(value: unknown): NetworkDiagnosticStateEvent | null {
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<NetworkDiagnosticStateEvent>
    if (!Number.isInteger(candidate.serverID) || !candidate.taskID || !candidate.task) return null
    return candidate as NetworkDiagnosticStateEvent
  }

  function networkDiagnosticOutputEvent(value: unknown): NetworkDiagnosticOutputEvent | null {
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<NetworkDiagnosticOutputEvent>
    if (!Number.isInteger(candidate.serverID) || !candidate.taskID || typeof candidate.line !== 'string' || typeof candidate.stream !== 'string') return null
    return candidate as NetworkDiagnosticOutputEvent
  }

  function networkDiagnosticErrorEvent(value: unknown): NetworkDiagnosticErrorEvent | null {
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<NetworkDiagnosticErrorEvent>
    if (!Number.isInteger(candidate.serverID) || !candidate.taskID || typeof candidate.message !== 'string') return null
    return candidate as NetworkDiagnosticErrorEvent
  }

  return {
    groups, connections, selectedId, snapshots, histories, networkInterfaces, networkInterfacePreferences,
    networkInterfaceRecommendations, networkInterfacesLoading, diagnosticTasks, diagnosticOutput, states, logs, loading, error,
    selected, snapshot, history, selectedState, load, refreshConnections, reorderServers, select, save, remove, connect, disconnect,
    test, loadLogs, acceptSnapshot, acceptConnectionState, markDisconnected, resumeServer,
    connectionState, subscribe, unsubscribe, loadNetworkInterfaces, loadNetworkInterfacePreference,
    setMonitorNetworkInterface, applyRecommendedNetworkInterface, loadNetworkDiagnosticTasks, startNetworkDiagnostic, cancelNetworkDiagnostic,
    clearNetworkDiagnosticOutput, ignoreNetworkDiagnosticOutput, acceptNetworkDiagnosticState,
    acceptNetworkDiagnosticOutput, acceptNetworkDiagnosticError,
  }
})
