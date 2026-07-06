import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import type {
  DockerAvailability,
  DockerBatchContainerResponse,
  DockerComposeCapability,
  DockerComposeLogsSnapshot,
  DockerComposeProject,
  DockerComposeService,
  DockerComposeServicesResponse,
  DockerContainer,
  DockerContainerStats,
  DockerContainersEvent,
  DockerErrorEvent,
  DockerExecutionMode,
  DockerInspectSummary,
  DockerLogEvent,
  DockerStateEvent,
  DockerStatsEvent,
} from '../types'

const MAX_LOG_LINES = 5000

export const useDockerStore = defineStore('docker', () => {
  const availabilityByServerId = ref<Record<number, DockerAvailability>>({})
  const containersByServerId = ref<Record<number, DockerContainer[]>>({})
  const statsByContainer = ref<Record<string, DockerContainerStats>>({})
  const inspectByContainer = ref<Record<string, DockerInspectSummary>>({})
  const logsByContainer = ref<Record<string, string[]>>({})
  const activeLogStreams = ref<Record<string, string>>({})
  const activeStatsWatchers = ref<Record<string, string>>({})
  const composeCapabilityByServerId = ref<Record<number, DockerComposeCapability>>({})
  const composeProjectsByServerId = ref<Record<number, DockerComposeProject[]>>({})
  const composeServicesByProject = ref<Record<string, DockerComposeServicesResponse>>({})
  const composeServiceDetailByService = ref<Record<string, DockerComposeService>>({})
  const composeLogsByProject = ref<Record<string, DockerComposeLogsSnapshot>>({})
  const selectedIDsByServerId = ref<Record<number, string[]>>({})
  const executionModeByServerId = ref<Record<number, DockerExecutionMode>>({})
  const lastError = ref<DockerErrorEvent | null>(null)

  const serverIDsWithState = computed(() => Object.keys(availabilityByServerId.value).map(Number))

  function availability(serverID: number | null | undefined) {
    if (!serverID) return null
    return availabilityByServerId.value[serverID] ?? null
  }

  function containers(serverID: number | null | undefined) {
    if (!serverID) return []
    return containersByServerId.value[serverID] ?? []
  }

  function containerStats(serverID: number, containerID: string) {
    return statsByContainer.value[containerKey(serverID, containerID)] ?? null
  }

  function containerInspect(serverID: number, containerID: string) {
    return inspectByContainer.value[containerKey(serverID, containerID)] ?? null
  }

  function containerLogs(serverID: number, containerID: string) {
    return logsByContainer.value[containerKey(serverID, containerID)] ?? []
  }

  function isFollowingLogs(serverID: number, containerID: string) {
    return Boolean(activeLogStreams.value[containerKey(serverID, containerID)])
  }

  function isWatchingStats(serverID: number, containerID: string) {
    return Boolean(activeStatsWatchers.value[containerKey(serverID, containerID)])
  }

  function composeCapability(serverID: number | null | undefined) {
    if (!serverID) return null
    return composeCapabilityByServerId.value[serverID] ?? null
  }

  function composeProjects(serverID: number | null | undefined) {
    if (!serverID) return []
    return composeProjectsByServerId.value[serverID] ?? []
  }

  function composeServices(serverID: number | null | undefined, projectName: string) {
    if (!serverID || !projectName) return null
    return composeServicesByProject.value[composeKey(serverID, projectName)] ?? null
  }

  function composeServiceDetail(serverID: number | null | undefined, projectName: string, serviceName: string) {
    if (!serverID || !projectName || !serviceName) return null
    return composeServiceDetailByService.value[composeServiceKey(serverID, projectName, serviceName)] ?? null
  }

  function composeLogs(serverID: number | null | undefined, projectName: string, serviceName = '') {
    if (!serverID || !projectName) return null
    return composeLogsByProject.value[composeServiceKey(serverID, projectName, serviceName)] ?? null
  }

  function selectedIDs(serverID: number | null | undefined) {
    if (!serverID) return []
    return selectedIDsByServerId.value[serverID] ?? []
  }

  function selectedCount(serverID: number | null | undefined) {
    return selectedIDs(serverID).length
  }

  function executionMode(serverID: number | null | undefined): DockerExecutionMode {
    if (!serverID) return 'current_user'
    return executionModeByServerId.value[serverID] ?? 'current_user'
  }

  function setExecutionMode(serverID: number, mode: DockerExecutionMode) {
    const next = { ...executionModeByServerId.value }
    if (mode === 'sudo') next[serverID] = 'sudo'
    else delete next[serverID]
    executionModeByServerId.value = next
  }

  function requestExecutionMode(serverID: number): DockerExecutionMode | undefined {
    const mode = executionMode(serverID)
    return mode === 'sudo' ? mode : undefined
  }

  function isSelected(serverID: number | null | undefined, containerID: string) {
    return selectedIDs(serverID).includes(containerID)
  }

  async function check(serverID: number) {
    const mode = requestExecutionMode(serverID)
    const state = await api.dockerCheck(serverID, mode)
    availabilityByServerId.value[serverID] = state
    if (Array.isArray(state.containers)) {
      containersByServerId.value[serverID] = state.containers
      pruneSelection(serverID, state.containers.map((container) => container.id))
    }
    return state
  }

  async function refresh(serverID: number) {
    const mode = requestExecutionMode(serverID)
    const rows = await api.dockerListContainers(serverID, mode)
    containersByServerId.value[serverID] = rows ?? []
    availabilityByServerId.value[serverID] = {
      serverID,
      available: true,
      version: availabilityByServerId.value[serverID]?.version ?? '',
      error: '',
      lastRefreshAt: new Date().toISOString(),
      containers: rows ?? [],
    }
    pruneSelection(serverID, (rows ?? []).map((container) => container.id))
    return rows
  }

  async function start(serverID: number, containerID: string) {
    await api.dockerStartContainer(serverID, containerID, requestExecutionMode(serverID))
    return refresh(serverID)
  }

  async function stop(serverID: number, containerID: string) {
    await api.dockerStopContainer(serverID, containerID, requestExecutionMode(serverID))
    return refresh(serverID)
  }

  async function restart(serverID: number, containerID: string) {
    await api.dockerRestartContainer(serverID, containerID, requestExecutionMode(serverID))
    return refresh(serverID)
  }

  async function remove(serverID: number, containerID: string) {
    await stopContainerRuntime(serverID, containerID)
    await api.dockerRemoveContainer(serverID, containerID, requestExecutionMode(serverID))
    return refresh(serverID)
  }

  async function batchStart(serverID: number, containerIDs: string[]) {
    return runBatch(serverID, () => api.dockerBatchStartContainers(serverID, containerIDs, requestExecutionMode(serverID)))
  }

  async function batchStop(serverID: number, containerIDs: string[]) {
    return runBatch(serverID, () => api.dockerBatchStopContainers(serverID, containerIDs, requestExecutionMode(serverID)))
  }

  async function batchRestart(serverID: number, containerIDs: string[]) {
    return runBatch(serverID, () => api.dockerBatchRestartContainers(serverID, containerIDs, requestExecutionMode(serverID)))
  }

  async function batchRemove(serverID: number, containerIDs: string[]) {
    await Promise.allSettled(containerIDs.map((containerID) => stopContainerRuntime(serverID, containerID)))
    return runBatch(serverID, () => api.dockerBatchRemoveContainers(serverID, containerIDs, requestExecutionMode(serverID)))
  }

  async function runBatch(serverID: number, task: () => Promise<DockerBatchContainerResponse>) {
    const response = await task()
    await refresh(serverID)
    return response
  }

  async function loadLogs(serverID: number, containerID: string, tailLines = 200) {
    const output = await api.dockerGetContainerLogs(serverID, containerID, tailLines, requestExecutionMode(serverID))
    const key = containerKey(serverID, containerID)
    logsByContainer.value[key] = trimLogs(output.split(/\r?\n/).filter((line) => line.length > 0))
    return logsByContainer.value[key]
  }

  async function startLogStream(serverID: number, containerID: string, tailLines = 200) {
    const key = containerKey(serverID, containerID)
    if (activeLogStreams.value[key]) return activeLogStreams.value[key]
    const streamID = await api.dockerStartLogStream(serverID, containerID, tailLines, '', requestExecutionMode(serverID))
    activeLogStreams.value[key] = streamID
    return streamID
  }

  async function stopLogStream(serverID: number, containerID: string) {
    const key = containerKey(serverID, containerID)
    const streamID = activeLogStreams.value[key]
    if (!streamID) return
    await api.dockerStopLogStream(serverID, streamID)
    const next = { ...activeLogStreams.value }
    delete next[key]
    activeLogStreams.value = next
  }

  async function inspect(serverID: number, containerID: string) {
    const summary = await api.dockerGetContainerInspectSummary(serverID, containerID, requestExecutionMode(serverID))
    inspectByContainer.value[containerKey(serverID, containerID)] = summary
    return summary
  }

  async function stats(serverID: number, containerID: string) {
    const value = await api.dockerGetContainerStats(serverID, containerID, requestExecutionMode(serverID))
    statsByContainer.value[containerKey(serverID, containerID)] = value
    return value
  }

  async function startStatsWatch(serverID: number, containerID: string, intervalMs = 1500) {
    const key = containerKey(serverID, containerID)
    if (activeStatsWatchers.value[key]) return activeStatsWatchers.value[key]
    const watchID = await api.dockerStartStatsWatch(serverID, containerID, intervalMs, '', requestExecutionMode(serverID))
    activeStatsWatchers.value[key] = watchID
    return watchID
  }

  async function stopStatsWatch(serverID: number, containerID: string) {
    const key = containerKey(serverID, containerID)
    const watchID = activeStatsWatchers.value[key]
    if (!watchID) return
    await api.dockerStopStatsWatch(serverID, watchID)
    const next = { ...activeStatsWatchers.value }
    delete next[key]
    activeStatsWatchers.value = next
  }

  async function composeCheck(serverID: number) {
    const capability = await api.dockerComposeCheck(serverID, requestExecutionMode(serverID))
    composeCapabilityByServerId.value[serverID] = capability
    return capability
  }

  async function composeRefreshProjects(serverID: number) {
    const projects = await api.dockerComposeListProjects(serverID, requestExecutionMode(serverID))
    composeProjectsByServerId.value[serverID] = projects ?? []
    return composeProjectsByServerId.value[serverID]
  }

  async function composeLoadServices(serverID: number, projectName: string) {
    const response = await api.dockerComposeGetServices(serverID, projectName, requestExecutionMode(serverID))
    composeServicesByProject.value[composeKey(serverID, projectName)] = response
    return response
  }

  async function composeLoadServiceDetail(serverID: number, projectName: string, serviceName: string) {
    const detail = await api.dockerComposeGetServiceDetail(serverID, projectName, serviceName, requestExecutionMode(serverID))
    composeServiceDetailByService.value[composeServiceKey(serverID, projectName, serviceName)] = detail
    return detail
  }

  async function composeLoadLogs(serverID: number, projectName: string, tailLines = 200, serviceName = '') {
    const snapshot = await api.dockerComposeGetLogs(serverID, projectName, tailLines, serviceName, requestExecutionMode(serverID))
    composeLogsByProject.value[composeServiceKey(serverID, projectName, serviceName)] = snapshot
    return snapshot
  }

  async function stopContainerRuntime(serverID: number, containerID: string) {
    await Promise.allSettled([
      stopLogStream(serverID, containerID),
      stopStatsWatch(serverID, containerID),
    ])
  }

  async function stopServerRuntime(serverID: number) {
    const operations: Promise<void>[] = []
    for (const [key, streamID] of Object.entries(activeLogStreams.value)) {
      if (keyServerID(key) === serverID) operations.push(api.dockerStopLogStream(serverID, streamID))
    }
    for (const [key, watchID] of Object.entries(activeStatsWatchers.value)) {
      if (keyServerID(key) === serverID) operations.push(api.dockerStopStatsWatch(serverID, watchID))
    }
    await Promise.allSettled(operations)
    clearServerRuntime(serverID)
  }

  function clearLogs(serverID: number, containerID: string) {
    logsByContainer.value[containerKey(serverID, containerID)] = []
  }

  function clearServer(serverID: number) {
    clearServerRuntime(serverID)
    const availability = { ...availabilityByServerId.value }
    const containers = { ...containersByServerId.value }
    const selected = { ...selectedIDsByServerId.value }
    delete availability[serverID]
    delete containers[serverID]
    delete selected[serverID]
    const modes = { ...executionModeByServerId.value }
    delete modes[serverID]
    availabilityByServerId.value = availability
    containersByServerId.value = containers
    selectedIDsByServerId.value = selected
    executionModeByServerId.value = modes
    clearComposeServer(serverID)
  }

  function clearServerRuntime(serverID: number) {
    activeLogStreams.value = filterOutServer(activeLogStreams.value, serverID)
    activeStatsWatchers.value = filterOutServer(activeStatsWatchers.value, serverID)
    statsByContainer.value = filterOutServer(statsByContainer.value, serverID)
    inspectByContainer.value = filterOutServer(inspectByContainer.value, serverID)
    logsByContainer.value = filterOutServer(logsByContainer.value, serverID)
  }

  function clearComposeServer(serverID: number) {
    const capabilities = { ...composeCapabilityByServerId.value }
    const projects = { ...composeProjectsByServerId.value }
    delete capabilities[serverID]
    delete projects[serverID]
    composeCapabilityByServerId.value = capabilities
    composeProjectsByServerId.value = projects
    composeServicesByProject.value = filterOutServer(composeServicesByProject.value, serverID)
    composeServiceDetailByService.value = filterOutServer(composeServiceDetailByService.value, serverID)
    composeLogsByProject.value = filterOutServer(composeLogsByProject.value, serverID)
  }

  function acceptState(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<DockerStateEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID) || !event.state) return
    availabilityByServerId.value[serverID] = event.state
    if (Array.isArray(event.state.containers)) {
      containersByServerId.value[serverID] = event.state.containers
      pruneSelection(serverID, event.state.containers.map((container) => container.id))
    }
  }

  function acceptContainers(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<DockerContainersEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID) || !Array.isArray(event.containers)) return
    containersByServerId.value[serverID] = event.containers
    pruneSelection(serverID, event.containers.map((container) => container.id))
  }

  function setSelected(serverID: number, containerIDs: string[]) {
    const next = { ...selectedIDsByServerId.value }
    const unique = Array.from(new Set(containerIDs.filter(Boolean)))
    if (unique.length) next[serverID] = unique
    else delete next[serverID]
    selectedIDsByServerId.value = next
  }

  function toggleSelected(serverID: number, containerID: string) {
    const current = new Set(selectedIDs(serverID))
    if (current.has(containerID)) current.delete(containerID)
    else current.add(containerID)
    setSelected(serverID, Array.from(current))
  }

  function toggleAllVisible(serverID: number, visibleIDs: string[]) {
    const visible = Array.from(new Set(visibleIDs.filter(Boolean)))
    if (!visible.length) return
    const current = new Set(selectedIDs(serverID))
    const allSelected = visible.every((containerID) => current.has(containerID))
    if (allSelected) {
      visible.forEach((containerID) => current.delete(containerID))
    } else {
      visible.forEach((containerID) => current.add(containerID))
    }
    setSelected(serverID, Array.from(current))
  }

  function clearSelection(serverID: number) {
    setSelected(serverID, [])
  }

  function pruneSelection(serverID: number, existingIDs: string[]) {
    const existing = new Set(existingIDs)
    const next = selectedIDs(serverID).filter((containerID) => existing.has(containerID))
    setSelected(serverID, next)
  }

  function acceptLog(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<DockerLogEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID) || !event.containerID || !event.streamID) return
    const key = containerKey(serverID, event.containerID)
    if (activeLogStreams.value[key] !== event.streamID) return
    const current = logsByContainer.value[key] ?? []
    logsByContainer.value[key] = trimLogs([...current, event.line ?? ''])
  }

  function acceptStats(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<DockerStatsEvent>
    const serverID = event.serverID
    if (typeof serverID !== 'number' || !Number.isInteger(serverID) || !event.containerID || !event.watchID || !event.stats) return
    const key = containerKey(serverID, event.containerID)
    if (activeStatsWatchers.value[key] !== event.watchID) return
    statsByContainer.value[key] = event.stats
  }

  function acceptError(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<DockerErrorEvent>
    if (!Number.isInteger(event.serverID)) return
    lastError.value = event as DockerErrorEvent
  }

  function subscribe() {
    EventsOn('docker:state', acceptState)
    EventsOn('docker:containers', acceptContainers)
    EventsOn('docker:logs', acceptLog)
    EventsOn('docker:stats', acceptStats)
    EventsOn('docker:error', acceptError)
  }

  function unsubscribe() {
    EventsOff('docker:state')
    EventsOff('docker:containers')
    EventsOff('docker:logs')
    EventsOff('docker:stats')
    EventsOff('docker:error')
  }

  return {
    availabilityByServerId,
    containersByServerId,
    statsByContainer,
    inspectByContainer,
    logsByContainer,
    activeLogStreams,
    activeStatsWatchers,
    composeCapabilityByServerId,
    composeProjectsByServerId,
    composeServicesByProject,
    composeServiceDetailByService,
    composeLogsByProject,
    selectedIDsByServerId,
    lastError,
    serverIDsWithState,
    availability,
    containers,
    containerStats,
    containerInspect,
    containerLogs,
    isFollowingLogs,
    isWatchingStats,
    composeCapability,
    composeProjects,
    composeServices,
    composeServiceDetail,
    composeLogs,
    selectedIDs,
    selectedCount,
    isSelected,
    executionMode,
    setExecutionMode,
    check,
    refresh,
    start,
    stop,
    restart,
    remove,
    batchStart,
    batchStop,
    batchRestart,
    batchRemove,
    loadLogs,
    startLogStream,
    stopLogStream,
    inspect,
    stats,
    startStatsWatch,
    stopStatsWatch,
    composeCheck,
    composeRefreshProjects,
    composeLoadServices,
    composeLoadServiceDetail,
    composeLoadLogs,
    stopContainerRuntime,
    stopServerRuntime,
    clearLogs,
    clearServer,
    setSelected,
    toggleSelected,
    toggleAllVisible,
    clearSelection,
    pruneSelection,
    acceptState,
    acceptContainers,
    acceptLog,
    acceptStats,
    acceptError,
    subscribe,
    unsubscribe,
  }
})

function containerKey(serverID: number, containerID: string) {
  return `${serverID}:${containerID}`
}

function composeKey(serverID: number, projectName: string) {
  return `${serverID}:${projectName}`
}

function composeServiceKey(serverID: number, projectName: string, serviceName = '') {
  return `${serverID}:${projectName}:${serviceName}`
}

function keyServerID(key: string) {
  return Number(key.split(':', 1)[0] ?? 0)
}

function trimLogs(lines: string[]) {
  if (lines.length <= MAX_LOG_LINES) return lines
  return lines.slice(lines.length - MAX_LOG_LINES)
}

function filterOutServer<T>(source: Record<string, T>, serverID: number) {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(source)) {
    if (keyServerID(key) !== serverID) next[key] = value
  }
  return next
}
