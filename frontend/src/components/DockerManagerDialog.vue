<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { confirmDialog } from '../composables/useAppDialog'
import { useDockerStore } from '../stores/docker'
import type { Connection, DockerComposeProject, DockerContainer } from '../types'

type ContainerAction = 'start' | 'stop' | 'restart' | 'remove'

const props = defineProps<{
  open: boolean
  connections: Connection[]
  activeServerId: number | null
}>()

const emit = defineEmits<{
  close: []
  notify: [message: string, type: 'success' | 'error' | 'info']
  connectContainer: [payload: { serverID: number; containerID: string; containerName: string }]
}>()

const dockerStore = useDockerStore()
const selectedServerID = ref(0)
const query = ref('')
const stateFilter = ref<'all' | 'running' | 'stopped'>('all')
const selectedContainerID = ref('')
const activePanel = ref<'logs' | 'inspect' | 'stats'>('logs')
const activeMode = ref<'containers' | 'compose'>('containers')
const loading = ref(false)
const composeLoading = ref(false)
const batchBusy = ref(false)
const busyContainer = ref<Record<string, boolean>>({})
const pendingContainerActions = ref<Record<string, ContainerAction>>({})
const batchActionState = ref<{ action: ContainerAction; containerIDs: string[] } | null>(null)
const tailLines = ref(200)
const composeTailLines = ref(200)
const selectedComposeProjectName = ref('')
const selectedComposeServiceName = ref('')
const composeProjectFilter = ref('')
const composeServiceFilter = ref('')
const composeLogsFollowing = ref(false)
const composeLogsPaused = ref(false)
const composeLogsView = ref<string | null>(null)
let composeFollowTimer: ReturnType<typeof setInterval> | null = null

const selectedConnection = computed(() =>
  props.connections.find((connection) => connection.id === selectedServerID.value) ?? null)

const availability = computed(() => dockerStore.availability(selectedServerID.value))
const containers = computed(() => dockerStore.containers(selectedServerID.value))
const selectedContainer = computed(() =>
  containers.value.find((container) => container.id === selectedContainerID.value) ?? null)
const selectedLogs = computed(() =>
  selectedContainer.value ? dockerStore.containerLogs(selectedServerID.value, selectedContainer.value.id) : [])
const selectedStats = computed(() =>
  selectedContainer.value ? dockerStore.containerStats(selectedServerID.value, selectedContainer.value.id) : null)
const selectedInspect = computed(() =>
  selectedContainer.value ? dockerStore.containerInspect(selectedServerID.value, selectedContainer.value.id) : null)
const selectedFollowing = computed(() =>
  selectedContainer.value ? dockerStore.isFollowingLogs(selectedServerID.value, selectedContainer.value.id) : false)
const selectedStatsWatching = computed(() =>
  selectedContainer.value ? dockerStore.isWatchingStats(selectedServerID.value, selectedContainer.value.id) : false)
const composeCapability = computed(() => dockerStore.composeCapability(selectedServerID.value))
const composeProjects = computed(() => dockerStore.composeProjects(selectedServerID.value))
const filteredComposeProjects = computed(() => {
  const term = composeProjectFilter.value.trim().toLowerCase()
  if (!term) return composeProjects.value
  return composeProjects.value.filter((project) => [
    project.name,
    project.status,
    project.configFiles,
    project.workingDir,
  ].some((value) => value?.toLowerCase().includes(term)))
})
const selectedComposeProject = computed(() =>
  composeProjects.value.find((project) => project.name === selectedComposeProjectName.value) ?? null)
const selectedComposeServices = computed(() =>
  selectedComposeProjectName.value
    ? dockerStore.composeServices(selectedServerID.value, selectedComposeProjectName.value)?.services ?? []
    : [])
const filteredComposeServices = computed(() => {
  const term = composeServiceFilter.value.trim().toLowerCase()
  if (!term) return selectedComposeServices.value
  return selectedComposeServices.value.filter((service) => [
    service.name,
    service.service,
    service.image,
    service.state,
    service.status,
    service.ports,
  ].some((value) => value?.toLowerCase().includes(term)))
})
const selectedComposeService = computed(() =>
  selectedComposeServices.value.find((service) => serviceNameOf(service) === selectedComposeServiceName.value) ?? null)
const selectedComposeServiceDetail = computed(() =>
  selectedComposeServiceName.value
    ? dockerStore.composeServiceDetail(selectedServerID.value, selectedComposeProjectName.value, selectedComposeServiceName.value) ?? selectedComposeService.value
    : null)
const selectedComposeLogs = computed(() =>
  selectedComposeProjectName.value
    ? dockerStore.composeLogs(selectedServerID.value, selectedComposeProjectName.value, selectedComposeServiceName.value)
    : null)
const displayedComposeLogs = computed(() => {
  if (composeLogsView.value !== null) return composeLogsView.value
  return selectedComposeLogs.value?.output ?? ''
})

const filteredContainers = computed(() => {
  const term = query.value.trim().toLowerCase()
  return containers.value.filter((container) => {
    if (stateFilter.value === 'running' && container.state !== 'running') return false
    if (stateFilter.value === 'stopped' && container.state === 'running') return false
    if (!term) return true
    return [
      container.name,
      container.shortID,
      container.id,
      container.image,
      container.status,
      container.ports,
    ].some((value) => value?.toLowerCase().includes(term))
  })
})
const visibleContainerIDs = computed(() => filteredContainers.value.map((container) => container.id))
const selectedIDs = computed(() => dockerStore.selectedIDs(selectedServerID.value))
const selectedContainers = computed(() => {
  const selected = new Set(selectedIDs.value)
  return containers.value.filter((container) => selected.has(container.id))
})
const visibleSelectedCount = computed(() =>
  visibleContainerIDs.value.filter((containerID) => dockerStore.isSelected(selectedServerID.value, containerID)).length)
const allVisibleSelected = computed(() =>
  visibleContainerIDs.value.length > 0 && visibleSelectedCount.value === visibleContainerIDs.value.length)
const someVisibleSelected = computed(() =>
  visibleSelectedCount.value > 0 && visibleSelectedCount.value < visibleContainerIDs.value.length)
const batchStartEligible = computed(() => eligibleContainersFor('start'))
const batchStopEligible = computed(() => eligibleContainersFor('stop'))
const batchRestartEligible = computed(() => eligibleContainersFor('restart'))
const batchRemoveEligible = computed(() => eligibleContainersFor('remove'))
const batchSummaryText = computed(() => {
  if (!batchActionState.value) return `已选 ${selectedIDs.value.length} 个`
  return `正在${actionLabel(batchActionState.value.action)} ${batchActionState.value.containerIDs.length} 个容器...`
})

watch(() => props.open, (open) => {
  if (!open) {
    stopComposeFollow()
    if (selectedServerID.value) void dockerStore.stopServerRuntime(selectedServerID.value)
    return
  }
  const nextServerID = props.activeServerId || props.connections[0]?.id || 0
  selectedServerID.value = nextServerID
  if (selectedServerID.value) void refreshServer()
}, { immediate: true })

watch(selectedServerID, async (serverID, previous) => {
  if (!props.open) return
  stopComposeFollow()
  if (previous) await dockerStore.stopServerRuntime(previous)
  selectedContainerID.value = ''
  selectedComposeProjectName.value = ''
  selectedComposeServiceName.value = ''
  composeLogsView.value = null
  if (serverID) await refreshServer()
})

watch(filteredContainers, (rows) => {
  if (!rows.length) {
    selectedContainerID.value = ''
    return
  }
  if (!rows.some((row) => row.id === selectedContainerID.value)) {
    selectedContainerID.value = rows[0].id
  }
}, { immediate: true })

watch(selectedContainer, (container) => {
  if (!container || !props.open) return
  if (activePanel.value === 'logs') void loadLogs(container)
})

watch(activePanel, (panel) => {
  if (panel === 'logs' && selectedContainer.value && props.open) void loadLogs(selectedContainer.value)
})

onBeforeUnmount(() => {
  stopComposeFollow()
  if (selectedServerID.value) void dockerStore.stopServerRuntime(selectedServerID.value)
})

async function closeDialog() {
  stopComposeFollow()
  if (selectedServerID.value) await dockerStore.stopServerRuntime(selectedServerID.value)
  emit('close')
}

async function refreshServer() {
  if (!selectedServerID.value) return
  loading.value = true
  try {
    const state = await dockerStore.check(selectedServerID.value)
    if (state.available) await dockerStore.refresh(selectedServerID.value)
    else emit('notify', state.error || '服务器未检测到 Docker。', 'error')
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker 检测失败。'), 'error')
  } finally {
    loading.value = false
  }
}

async function refreshContainers() {
  if (!selectedServerID.value) return
  loading.value = true
  try {
    await dockerStore.refresh(selectedServerID.value)
    emit('notify', '容器列表已刷新。', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '刷新容器列表失败。'), 'error')
  } finally {
    loading.value = false
  }
}

async function activateCompose() {
  activeMode.value = 'compose'
  if (!selectedServerID.value) return
  if (!composeCapability.value) await refreshCompose()
}

async function refreshCompose() {
  if (!selectedServerID.value) return
  composeLoading.value = true
  try {
    const capability = await dockerStore.composeCheck(selectedServerID.value)
    if (!capability.available) {
      selectedComposeProjectName.value = ''
      return
    }
    const projects = await dockerStore.composeRefreshProjects(selectedServerID.value)
    if (!projects.some((project) => project.name === selectedComposeProjectName.value)) {
      selectedComposeProjectName.value = projects[0]?.name ?? ''
    }
    if (selectedComposeProjectName.value) {
      await dockerStore.composeLoadServices(selectedServerID.value, selectedComposeProjectName.value)
      ensureSelectedComposeService()
    }
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker Compose 刷新失败。'), 'error')
  } finally {
    composeLoading.value = false
  }
}

async function selectComposeProject(project: DockerComposeProject) {
  if (!selectedServerID.value || composeLoading.value) return
  stopComposeFollow()
  selectedComposeProjectName.value = project.name
  selectedComposeServiceName.value = ''
  composeLogsView.value = null
  composeLoading.value = true
  try {
    await dockerStore.composeLoadServices(selectedServerID.value, project.name)
    ensureSelectedComposeService()
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker Compose 服务列表读取失败。'), 'error')
  } finally {
    composeLoading.value = false
  }
}

async function refreshComposeServices() {
  if (!selectedServerID.value || !selectedComposeProjectName.value) return
  composeLoading.value = true
  try {
    await dockerStore.composeLoadServices(selectedServerID.value, selectedComposeProjectName.value)
    ensureSelectedComposeService()
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker Compose 服务刷新失败。'), 'error')
  } finally {
    composeLoading.value = false
  }
}

async function selectComposeService(service: { service?: string; name?: string }) {
  if (!selectedServerID.value || !selectedComposeProjectName.value) return
  const serviceName = serviceNameOf(service)
  if (!serviceName) return
  stopComposeFollow()
  selectedComposeServiceName.value = serviceName
  composeLogsView.value = null
  try {
    await dockerStore.composeLoadServiceDetail(selectedServerID.value, selectedComposeProjectName.value, serviceName)
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker Compose 服务详情刷新失败。'), 'error')
  }
}

async function refreshComposeLogs() {
  if (!selectedServerID.value || !selectedComposeProjectName.value) return
  composeLoading.value = true
  try {
    const snapshot = await dockerStore.composeLoadLogs(
      selectedServerID.value,
      selectedComposeProjectName.value,
      composeTailLines.value,
      selectedComposeServiceName.value,
    )
    composeLogsView.value = snapshot.output
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker Compose 日志读取失败。'), 'error')
  } finally {
    composeLoading.value = false
  }
}

async function toggleComposeFollow() {
  if (composeLogsFollowing.value) {
    stopComposeFollow()
    return
  }
  composeLogsFollowing.value = true
  composeLogsPaused.value = false
  await refreshComposeLogs()
  startComposeFollowTimer()
}

function toggleComposePause() {
  if (!composeLogsFollowing.value) return
  if (composeLogsPaused.value) {
    composeLogsPaused.value = false
    startComposeFollowTimer()
  } else {
    composeLogsPaused.value = true
    clearComposeFollowTimer()
  }
}

function startComposeFollowTimer() {
  clearComposeFollowTimer()
  composeFollowTimer = setInterval(() => {
    if (composeLogsFollowing.value && !composeLogsPaused.value) void refreshComposeLogs()
  }, 3000)
}

function clearComposeFollowTimer() {
  if (composeFollowTimer) {
    clearInterval(composeFollowTimer)
    composeFollowTimer = null
  }
}

function stopComposeFollow() {
  clearComposeFollowTimer()
  composeLogsFollowing.value = false
  composeLogsPaused.value = false
}

async function copyComposeLogs() {
  await navigator.clipboard?.writeText(displayedComposeLogs.value)
}

function clearComposeLogsView() {
  composeLogsView.value = ''
}

function ensureSelectedComposeService() {
  if (selectedComposeServiceName.value && selectedComposeServices.value.some((service) => serviceNameOf(service) === selectedComposeServiceName.value)) {
    return
  }
  selectedComposeServiceName.value = serviceNameOf(selectedComposeServices.value[0])
}

function serviceNameOf(service: { service?: string; name?: string } | null | undefined) {
  return service?.service || service?.name || ''
}

async function startContainer(container: DockerContainer) {
  await runContainerAction(container, 'start', async () => {
    await dockerStore.start(selectedServerID.value, container.id)
    emit('notify', `容器「${container.name}」已启动。`, 'success')
  })
}

async function stopContainer(container: DockerContainer) {
  const confirmed = await confirmDialog({
    title: '停止容器',
    message: `确定停止容器「${container.name}」吗？`,
    confirmText: '停止',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return
  await runContainerAction(container, 'stop', async () => {
    await dockerStore.stop(selectedServerID.value, container.id)
    emit('notify', `容器「${container.name}」已停止。`, 'success')
  })
}

async function restartContainer(container: DockerContainer) {
  const confirmed = await confirmDialog({
    title: '重启容器',
    message: `确定重启容器「${container.name}」吗？`,
    confirmText: '重启',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return
  await runContainerAction(container, 'restart', async () => {
    await dockerStore.restart(selectedServerID.value, container.id)
    emit('notify', `容器「${container.name}」已重启。`, 'success')
  })
}

async function removeContainer(container: DockerContainer) {
  if (container.state === 'running' || container.state === 'paused' || container.state === 'restarting') {
    emit('notify', '该容器正在运行，请先停止后再删除。', 'error')
    return
  }
  const confirmed = await confirmDialog({
    title: '删除容器',
    message: `确定删除容器「${container.name}」吗？此操作无法撤销。`,
    confirmText: '删除容器',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return
  await runContainerAction(container, 'remove', async () => {
    await dockerStore.remove(selectedServerID.value, container.id)
    emit('notify', `容器「${container.name}」已删除。`, 'success')
  })
}

function selectContainer(container: DockerContainer) {
  selectedContainerID.value = container.id
}

function toggleContainerSelection(containerID: string) {
  if (!selectedServerID.value) return
  dockerStore.toggleSelected(selectedServerID.value, containerID)
}

function toggleAllVisibleSelection() {
  if (!selectedServerID.value) return
  dockerStore.toggleAllVisible(selectedServerID.value, visibleContainerIDs.value)
}

async function batchStartContainers() {
  if (!selectedServerID.value || batchBusy.value || selectedIDs.value.length === 0) return
  await runBatchAction('start', batchStartEligible.value, '没有可启动的已停止容器。', (containerIDs) =>
    dockerStore.batchStart(selectedServerID.value, containerIDs))
}

async function batchStopContainers() {
  if (!selectedServerID.value || batchBusy.value || selectedIDs.value.length === 0) return
  await runBatchAction('stop', batchStopEligible.value, '没有可停止的运行中容器。', (containerIDs) =>
    dockerStore.batchStop(selectedServerID.value, containerIDs))
}

async function batchRestartContainers() {
  if (!selectedServerID.value || batchBusy.value || selectedIDs.value.length === 0) return
  await runBatchAction('restart', batchRestartEligible.value, '没有可重启的运行中容器。', (containerIDs) =>
    dockerStore.batchRestart(selectedServerID.value, containerIDs))
}

async function batchRemoveContainers() {
  if (!selectedServerID.value || batchBusy.value || selectedIDs.value.length === 0) return
  const eligible = batchRemoveEligible.value
  if (!eligible.length) {
    emit('notify', '没有可删除的已停止容器，请先停止容器。', 'error')
    return
  }
  const skipped = selectedContainers.value.length - eligible.length
  const confirmed = await confirmDialog({
    title: '批量删除容器',
    message: skipped > 0
      ? `将删除 ${eligible.length} 个已停止容器，跳过 ${skipped} 个运行中或不可删除容器。此操作无法撤销。`
      : `确定删除选中的 ${eligible.length} 个容器吗？此操作无法撤销。`,
    confirmText: '删除容器',
    cancelText: '取消',
    danger: true,
  })
  if (!confirmed) return
  await runBatchAction('remove', eligible, '', (containerIDs) => dockerStore.batchRemove(selectedServerID.value, containerIDs))
}

async function runBatchAction(
  action: ContainerAction,
  eligible: DockerContainer[],
  emptyMessage: string,
  task: (containerIDs: string[]) => Promise<{
    successCount: number
    failedCount: number
    skippedCount?: number
    results?: { error?: string; status?: string; reason?: string }[]
  }>,
) {
  if (!eligible.length) {
    if (emptyMessage) emit('notify', emptyMessage, 'info')
    return
  }
  const containerIDs = eligible.map((container) => container.id)
  const skippedBeforeCall = selectedContainers.value.length - eligible.length
  batchBusy.value = true
  batchActionState.value = { action, containerIDs }
  setPendingContainers(containerIDs, action)
  try {
    const response = await task(containerIDs)
    const skippedCount = skippedBeforeCall + (response.skippedCount ?? 0)
    const firstError = response.results?.find((result) => result.error)?.error
    const message = `批量${actionLabel(action)}完成：成功 ${response.successCount} 个，失败 ${response.failedCount} 个，跳过 ${skippedCount} 个。`
      + (firstError ? ` 首个错误：${firstError}` : '')
    emit('notify', message, response.failedCount > 0 ? 'error' : 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, `批量${actionLabel(action)}失败。`), 'error')
  } finally {
    clearPendingContainers(containerIDs)
    batchActionState.value = null
    batchBusy.value = false
  }
}

async function runContainerAction(container: DockerContainer, action: ContainerAction, task: () => Promise<void>) {
  setPendingContainer(container.id, action)
  setBusy(container.id, true)
  try {
    await task()
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Docker 操作失败。'), 'error')
  } finally {
    setBusy(container.id, false)
    setPendingContainer(container.id, null)
  }
}

async function openLogs(container: DockerContainer) {
  selectedContainerID.value = container.id
  activePanel.value = 'logs'
  await loadLogs(container)
}

async function loadLogs(container: DockerContainer) {
  setBusy(container.id, true)
  try {
    await dockerStore.loadLogs(selectedServerID.value, container.id, tailLines.value)
  } catch (reason) {
    emit('notify', errorMessage(reason, '读取容器日志失败。'), 'error')
  } finally {
    setBusy(container.id, false)
  }
}

async function toggleFollowLogs() {
  const container = selectedContainer.value
  if (!container) return
  setBusy(container.id, true)
  try {
    if (selectedFollowing.value) {
      await dockerStore.stopLogStream(selectedServerID.value, container.id)
      emit('notify', '日志追踪已停止。', 'info')
    } else {
      await dockerStore.startLogStream(selectedServerID.value, container.id, tailLines.value)
      emit('notify', '日志追踪已开始。', 'success')
    }
  } catch (reason) {
    emit('notify', errorMessage(reason, '日志追踪操作失败。'), 'error')
  } finally {
    setBusy(container.id, false)
  }
}

async function openInspect(container: DockerContainer) {
  selectedContainerID.value = container.id
  activePanel.value = 'inspect'
  setBusy(container.id, true)
  try {
    await dockerStore.inspect(selectedServerID.value, container.id)
  } catch (reason) {
    emit('notify', errorMessage(reason, '读取容器信息失败。'), 'error')
  } finally {
    setBusy(container.id, false)
  }
}

function connectContainer(container: DockerContainer) {
  if (!selectedServerID.value || !isConnectable(container)) return
  selectedContainerID.value = container.id
  emit('connectContainer', {
    serverID: selectedServerID.value,
    containerID: container.id,
    containerName: container.name || container.shortID,
  })
}

async function refreshStats(container: DockerContainer) {
  selectedContainerID.value = container.id
  activePanel.value = 'stats'
  setBusy(container.id, true)
  try {
    await dockerStore.stats(selectedServerID.value, container.id)
  } catch (reason) {
    emit('notify', errorMessage(reason, '读取容器资源占用失败。'), 'error')
  } finally {
    setBusy(container.id, false)
  }
}

async function toggleStatsWatch() {
  const container = selectedContainer.value
  if (!container) return
  setBusy(container.id, true)
  try {
    if (selectedStatsWatching.value) {
      await dockerStore.stopStatsWatch(selectedServerID.value, container.id)
      emit('notify', 'Stats 监视已停止。', 'info')
    } else {
      await dockerStore.startStatsWatch(selectedServerID.value, container.id)
      emit('notify', 'Stats 监视已开始。', 'success')
    }
  } catch (reason) {
    emit('notify', errorMessage(reason, 'Stats 监视操作失败。'), 'error')
  } finally {
    setBusy(container.id, false)
  }
}

function setBusy(containerID: string, value: boolean) {
  busyContainer.value = { ...busyContainer.value, [containerID]: value }
}

function setPendingContainer(containerID: string, action: ContainerAction | null) {
  const next = { ...pendingContainerActions.value }
  if (action) next[containerID] = action
  else delete next[containerID]
  pendingContainerActions.value = next
}

function setPendingContainers(containerIDs: string[], action: ContainerAction) {
  const next = { ...pendingContainerActions.value }
  for (const containerID of containerIDs) next[containerID] = action
  pendingContainerActions.value = next
}

function clearPendingContainers(containerIDs: string[]) {
  const next = { ...pendingContainerActions.value }
  for (const containerID of containerIDs) delete next[containerID]
  pendingContainerActions.value = next
}

function pendingAction(container: DockerContainer) {
  return pendingContainerActions.value[container.id] ?? null
}

function isContainerBusy(containerID: string) {
  return Boolean(busyContainer.value[containerID] || pendingContainerActions.value[containerID])
}

function displayStateLabel(container: DockerContainer) {
  const action = pendingAction(container)
  if (action) return `${actionLabel(action)}中...`
  return stateLabel(container.state)
}

function stateLabel(state: DockerContainer['state']) {
  const labels: Record<DockerContainer['state'], string> = {
    running: '运行中',
    exited: '已停止',
    paused: '已暂停',
    restarting: '重启中',
    dead: '异常',
    unknown: '未知',
  }
  return labels[state] ?? '未知'
}

function displayStateClass(container: DockerContainer) {
  if (pendingAction(container)) return 'pending'
  return stateClass(container.state)
}

function stateClass(state: DockerContainer['state']) {
  if (state === 'running') return 'running'
  if (state === 'exited') return 'stopped'
  if (state === 'dead') return 'failed'
  return 'warning'
}

function isStartable(container: DockerContainer) {
  return container.state === 'exited' || container.state === 'dead'
}

function isStoppable(container: DockerContainer) {
  return container.state === 'running' || container.state === 'restarting'
}

function isRestartable(container: DockerContainer) {
  return container.state === 'running'
}

function isConnectable(container: DockerContainer) {
  return container.state === 'running'
}

function isRemovable(container: DockerContainer) {
  return container.state === 'exited' || container.state === 'dead'
}

function eligibleContainersFor(action: ContainerAction) {
  switch (action) {
    case 'start':
      return selectedContainers.value.filter(isStartable)
    case 'stop':
      return selectedContainers.value.filter(isStoppable)
    case 'restart':
      return selectedContainers.value.filter(isRestartable)
    case 'remove':
      return selectedContainers.value.filter(isRemovable)
    default:
      return []
  }
}

function actionLabel(action: ContainerAction) {
  const labels: Record<ContainerAction, string> = {
    start: '启动',
    stop: '停止',
    restart: '重启',
    remove: '删除',
  }
  return labels[action]
}

function actionPendingLabel(container: DockerContainer, action: ContainerAction) {
  return pendingAction(container) === action ? `${actionLabel(action)}中` : actionLabel(action)
}

function statLabel(container: DockerContainer, kind: 'cpu' | 'memory') {
  const stats = dockerStore.containerStats(selectedServerID.value, container.id)
  if (!stats) return '—'
  return `${(kind === 'cpu' ? stats.cpuPercent : stats.memoryPercent).toFixed(2)}%`
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}
</script>

<template>
  <div v-if="open" class="docker-dialog-backdrop" data-testid="docker-dialog">
    <section class="docker-dialog" role="dialog" aria-modal="true" aria-label="容器管理">
      <header class="docker-dialog-header">
        <div>
          <h2>容器管理</h2>
          <p>通过独立 SSH exec 执行 Docker CLI，不复用 Terminal / SFTP / Monitor / Tunnel 会话。</p>
        </div>
        <button class="dialog-close-button" type="button" @click="closeDialog">关闭</button>
      </header>

      <div class="docker-toolbar">
        <label class="docker-server-select-field">
          当前服务器
          <select v-model.number="selectedServerID" data-testid="docker-server-select">
            <option :value="0">请选择服务器</option>
            <option v-for="connection in connections" :key="connection.id" :value="connection.id">
              {{ connection.name }} ({{ connection.username }}@{{ connection.host }}:{{ connection.port }})
            </option>
          </select>
        </label>
        <label class="docker-search-field">
          搜索
          <input v-model="query" data-testid="docker-search" placeholder="名称、镜像、端口或 ID" />
        </label>
        <label class="docker-filter-field">
          状态
          <select v-model="stateFilter" data-testid="docker-filter">
            <option value="all">全部</option>
            <option value="running">运行中</option>
            <option value="stopped">已停止</option>
          </select>
        </label>
        <button class="secondary" type="button" :disabled="loading || !selectedServerID" @click="refreshServer">
          {{ loading ? '检测中…' : '检测 Docker' }}
        </button>
        <button class="primary" type="button" :disabled="loading || !selectedServerID" data-testid="docker-refresh" @click="refreshContainers">
          刷新
        </button>
      </div>

      <div class="docker-status-line">
        <template v-if="!selectedConnection">请选择服务器后管理远程 Docker 容器。</template>
        <template v-else-if="availability?.available">
          <span v-if="availability.version">Docker v{{ availability.version }}</span>
        </template>
        <template v-else-if="availability?.error">{{ availability.error }}</template>
        <template v-else>尚未检测 Docker。</template>
      </div>

      <div class="docker-mode-tabs">
        <button
          :class="{ active: activeMode === 'containers' }"
          class="command-light-action"
          type="button"
          data-testid="docker-containers-tab"
          @click="activeMode = 'containers'"
        >
          容器
        </button>
        <span class="command-action-separator" aria-hidden="true">|</span>
        <button
          :class="{ active: activeMode === 'compose' }"
          class="command-light-action"
          type="button"
          data-testid="docker-compose-tab"
          @click="activateCompose"
        >
          Compose
        </button>
      </div>

      <section v-if="activeMode === 'compose'" class="docker-compose-panel" data-testid="docker-compose-panel">
        <div class="docker-compose-sidebar">
          <header class="docker-compose-section-header">
            <div>
              <strong>Compose 项目</strong>
              <span v-if="composeCapability?.available">
                {{ composeCapability.command }} <template v-if="composeCapability.version">{{ composeCapability.version }}</template>
              </span>
            </div>
            <button type="button" :disabled="composeLoading || !selectedServerID" data-testid="docker-compose-refresh" @click="refreshCompose">
              {{ composeLoading ? '刷新中…' : '刷新' }}
            </button>
          </header>
          <p v-if="composeCapability && !composeCapability.available" class="empty" data-testid="docker-compose-unavailable">
            {{ composeCapability.error || '服务器未检测到 Docker Compose。' }}
          </p>
          <p v-else-if="composeCapability?.available && composeProjects.length === 0" class="empty">
            暂无 Compose 项目。
          </p>
          <label v-if="composeCapability?.available" class="docker-compose-filter docker-compose-project-filter">
            筛选
            <input v-model="composeProjectFilter" data-testid="docker-compose-filter" placeholder="项目、状态、路径" />
          </label>
          <button
            v-for="project in filteredComposeProjects"
            :key="project.name"
            type="button"
            class="docker-compose-project-row"
            :class="{ selected: selectedComposeProjectName === project.name }"
            data-testid="docker-compose-project-row"
            @click="selectComposeProject(project)"
          >
            <strong>{{ project.name }}</strong>
            <span>{{ project.status || 'unknown' }}</span>
            <small :title="project.configFiles">{{ project.workingDir || project.configFiles || '—' }}</small>
          </button>
        </div>

        <div class="docker-compose-detail">
          <header class="docker-compose-section-header">
            <div>
              <strong>{{ selectedComposeProject?.name || 'Compose 服务' }}</strong>
            </div>
            <div class="docker-compose-action-row" data-testid="docker-compose-action-row">
              <button
                type="button"
                class="command-light-action"
                :disabled="composeLoading || !selectedComposeProjectName"
                data-testid="docker-compose-refresh-services"
                @click="refreshComposeServices"
              >
                刷新服务
              </button>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <button
                type="button"
                class="command-light-action"
                :disabled="composeLoading || !selectedComposeProjectName"
                data-testid="docker-compose-refresh-logs"
                @click="refreshComposeLogs"
              >
                刷新日志
              </button>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <div class="docker-compose-log-actions" data-testid="docker-compose-log-actions">
                <button class="command-light-action" type="button" data-testid="docker-compose-follow-logs" :disabled="!selectedComposeProjectName" @click="toggleComposeFollow">
                  {{ composeLogsFollowing ? '停止跟随' : '跟随' }}
                </button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" type="button" data-testid="docker-compose-pause-logs" :disabled="!composeLogsFollowing" @click="toggleComposePause">
                  {{ composeLogsPaused ? '继续' : '暂停' }}
                </button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" type="button" data-testid="docker-compose-copy-logs" :disabled="!displayedComposeLogs" @click="copyComposeLogs">复制</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" type="button" data-testid="docker-compose-clear-logs" @click="clearComposeLogsView">清空</button>
              </div>
              <span class="command-action-separator" aria-hidden="true">|</span>
              <label class="docker-compose-tail" data-testid="docker-compose-tail-control">
                <span>最近行数</span>
                <select v-model.number="composeTailLines" class="docker-compose-tail-select" data-testid="docker-compose-tail-select">
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                  <option :value="200">200</option>
                  <option :value="500">500</option>
                  <option :value="1000">1000</option>
                </select>
              </label>
            </div>
          </header>

          <div class="docker-compose-service-toolbar" data-testid="docker-compose-service-toolbar">
            <span class="docker-compose-service-count" data-testid="docker-compose-service-count">{{ selectedComposeServices.length }} 个服务</span>
            <label class="docker-compose-filter">
              筛选服务
              <input v-model="composeServiceFilter" data-testid="docker-compose-service-filter" placeholder="服务、镜像、状态" />
            </label>
          </div>

          <div class="docker-compose-services" data-testid="docker-compose-services">
            <article
              v-for="service in filteredComposeServices"
              :key="service.id || service.name || service.service"
              class="docker-compose-service-row"
              :class="{ selected: selectedComposeServiceName === serviceNameOf(service) }"
              data-testid="docker-compose-service-row"
              @click="selectComposeService(service)"
            >
              <strong :title="service.name">{{ service.service || service.name }}</strong>
              <span :title="service.image">{{ service.image || '—' }}</span>
              <span>{{ service.state || 'unknown' }}</span>
              <span :title="service.status">{{ service.status || '—' }}</span>
              <span :title="service.ports">{{ service.ports || '无端口' }}</span>
            </article>
          </div>

          <aside class="docker-compose-service-detail" data-testid="docker-compose-service-detail">
            <strong>{{ selectedComposeServiceDetail?.service || selectedComposeServiceDetail?.name || '未选择服务' }}</strong>
            <span>{{ selectedComposeServiceDetail?.image || '镜像不可用' }}</span>
            <span>{{ selectedComposeServiceDetail?.state || '状态不可用' }}</span>
            <span>{{ selectedComposeServiceDetail?.status || '详情不可用' }}</span>
            <span>{{ selectedComposeServiceDetail?.ports || '端口不可用' }}</span>
          </aside>

          <pre class="docker-compose-logs" data-testid="docker-compose-logs">{{ displayedComposeLogs || '点击“刷新日志”读取一次 Compose 日志快照。' }}</pre>
          <p v-if="selectedComposeLogs?.truncated" class="inspect-security-note">日志输出已截断，仅显示末尾片段。</p>
        </div>
      </section>

      <div class="docker-body">
        <section class="docker-list-panel">
          <div class="docker-list-header">
            <label class="docker-select-all">
              <input
                type="checkbox"
                data-testid="docker-select-all"
                :checked="allVisibleSelected"
                :indeterminate.prop="someVisibleSelected"
                :disabled="filteredContainers.length === 0"
                @change="toggleAllVisibleSelection"
              />
              <span>容器</span>
            </label>
            <span>{{ filteredContainers.length }} / {{ containers.length }}，已选 {{ selectedIDs.length }} 个</span>
          </div>
          <div v-if="selectedIDs.length" class="docker-batch-bar" data-testid="docker-batch-bar">
            <span>{{ batchSummaryText }}</span>
            <button type="button" data-testid="docker-batch-start" :disabled="batchBusy" @click="batchStartContainers">启动</button>
            <button type="button" data-testid="docker-batch-stop" :disabled="batchBusy" @click="batchStopContainers">停止</button>
            <button type="button" data-testid="docker-batch-restart" :disabled="batchBusy" @click="batchRestartContainers">重启</button>
            <button class="danger subtle" type="button" data-testid="docker-batch-remove" :disabled="batchBusy" @click="batchRemoveContainers">删除</button>
          </div>
          <p v-if="!selectedServerID" class="empty">请选择服务器。</p>
          <p v-else-if="availability && !availability.available" class="empty">{{ availability.error || 'Docker 不可用。' }}</p>
          <p v-else-if="filteredContainers.length === 0" class="empty">暂无容器或没有匹配结果。</p>

          <article
            v-for="container in filteredContainers"
            :key="container.id"
            class="docker-container-card"
            :class="{ selected: selectedContainerID === container.id }"
            data-testid="docker-container-row"
            @click="selectContainer(container)"
          >
            <label class="container-check" @click.stop>
              <input
                type="checkbox"
                data-testid="docker-row-checkbox"
                :checked="dockerStore.isSelected(selectedServerID, container.id)"
                @change="toggleContainerSelection(container.id)"
              />
            </label>
            <div class="container-main">
              <strong class="container-name" :title="container.name">{{ container.name || container.shortID }}</strong>
              <span class="container-image" :title="container.image">{{ container.image }}</span>
              <code class="container-id">{{ container.shortID }}</code>
            </div>
            <div class="container-meta">
              <span :class="['container-state', displayStateClass(container)]">{{ displayStateLabel(container) }}</span>
              <span :title="container.status">{{ container.status || '—' }}</span>
              <span :title="container.ports">{{ container.ports || '无端口' }}</span>
            </div>
            <div class="container-stats">
              <span>CPU {{ statLabel(container, 'cpu') }}</span>
              <span>MEM {{ statLabel(container, 'memory') }}</span>
            </div>
            <div class="container-actions">
              <button v-if="isStartable(container)" type="button" data-testid="docker-start" :disabled="isContainerBusy(container.id)" @click.stop="startContainer(container)">{{ actionPendingLabel(container, 'start') }}</button>
              <button v-if="isStoppable(container)" type="button" data-testid="docker-stop" :disabled="isContainerBusy(container.id)" @click.stop="stopContainer(container)">{{ actionPendingLabel(container, 'stop') }}</button>
              <button v-if="isRestartable(container)" type="button" data-testid="docker-restart" :disabled="isContainerBusy(container.id)" @click.stop="restartContainer(container)">{{ actionPendingLabel(container, 'restart') }}</button>
              <button v-if="isConnectable(container)" type="button" data-testid="docker-connect-container" :disabled="isContainerBusy(container.id)" @click.stop="connectContainer(container)">连接</button>
              <button type="button" data-testid="docker-inspect" :disabled="isContainerBusy(container.id)" @click.stop="openInspect(container)">详情</button>
              <button v-if="isRemovable(container)" class="danger subtle" type="button" data-testid="docker-remove" :disabled="isContainerBusy(container.id)" @click.stop="removeContainer(container)">{{ actionPendingLabel(container, 'remove') }}</button>
            </div>
          </article>
        </section>

        <section class="docker-detail-panel">
          <div class="detail-tabs">
            <button class="command-light-action" :class="{ active: activePanel === 'logs' }" type="button" @click="activePanel = 'logs'">日志</button>
            <span class="command-action-separator" aria-hidden="true">|</span>
            <button class="command-light-action" :class="{ active: activePanel === 'stats' }" type="button" @click="activePanel = 'stats'">资源</button>
            <span class="command-action-separator" aria-hidden="true">|</span>
            <button class="command-light-action" :class="{ active: activePanel === 'inspect' }" type="button" @click="activePanel = 'inspect'">信息</button>
          </div>

          <div class="detail-content">
            <p v-if="!selectedContainer" class="empty">请选择一个容器。</p>

            <template v-else-if="activePanel === 'logs'">
              <div class="detail-actions" data-testid="docker-container-log-actions">
                <button class="command-light-action" type="button" data-testid="docker-refresh-logs" @click="loadLogs(selectedContainer)">刷新日志</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" type="button" data-testid="docker-follow-logs" @click="toggleFollowLogs">
                  {{ selectedFollowing ? '停止追踪' : '实时追踪' }}
                </button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <button class="command-light-action" type="button" @click="dockerStore.clearLogs(selectedServerID, selectedContainer.id)">清空显示</button>
                <span class="command-action-separator" aria-hidden="true">|</span>
                <label class="detail-tail-control" data-testid="docker-container-tail-control">
                  <span>最近行数</span>
                  <input
                    v-model.number="tailLines"
                    type="number"
                    min="1"
                    max="5000"
                    data-testid="docker-container-tail-input"
                  />
                </label>
              </div>
              <pre class="docker-log-view" data-testid="docker-log-view">{{ selectedLogs.join('\n') }}</pre>
            </template>

            <template v-else-if="activePanel === 'stats'">
              <div class="detail-actions">
                <button type="button" data-testid="docker-refresh-stats" @click="refreshStats(selectedContainer)">刷新 Stats</button>
                <button type="button" data-testid="docker-watch-stats" @click="toggleStatsWatch">
                  {{ selectedStatsWatching ? '停止监视' : '实时监视' }}
                </button>
              </div>
              <dl v-if="selectedStats" class="docker-info-grid" data-testid="docker-stats-panel">
                <dt>CPU</dt><dd>{{ selectedStats.cpuPercent.toFixed(2) }}%</dd>
                <dt>内存</dt><dd>{{ formatBytes(selectedStats.memoryUsage) }} / {{ formatBytes(selectedStats.memoryLimit) }} ({{ selectedStats.memoryPercent.toFixed(2) }}%)</dd>
                <dt>网络</dt><dd>入 {{ formatBytes(selectedStats.netInput) }} / 出 {{ formatBytes(selectedStats.netOutput) }}</dd>
                <dt>磁盘 IO</dt><dd>入 {{ formatBytes(selectedStats.blockInput) }} / 出 {{ formatBytes(selectedStats.blockOutput) }}</dd>
                <dt>PIDs</dt><dd>{{ selectedStats.pids }}</dd>
                <dt>更新时间</dt><dd>{{ selectedStats.timestamp ? new Date(selectedStats.timestamp).toLocaleString() : '—' }}</dd>
              </dl>
              <p v-else class="empty">点击“刷新 Stats”获取一次资源占用。</p>
            </template>

            <template v-else>
              <div class="detail-actions">
                <button type="button" data-testid="docker-refresh-inspect" @click="openInspect(selectedContainer)">刷新信息</button>
              </div>
              <dl v-if="selectedInspect" class="docker-info-grid" data-testid="docker-inspect-panel">
                <dt>ID</dt><dd>{{ selectedInspect.id }}</dd>
                <dt>名称</dt><dd>{{ selectedInspect.name }}</dd>
                <dt>镜像</dt><dd>{{ selectedInspect.image }}</dd>
                <dt>创建时间</dt><dd>{{ selectedInspect.created }}</dd>
                <dt>状态</dt><dd>{{ stateLabel(selectedInspect.state) }} / {{ selectedInspect.status }}</dd>
                <dt>端口</dt><dd>{{ selectedInspect.ports || '—' }}</dd>
                <dt>挂载数量</dt><dd>{{ selectedInspect.mountCount }}</dd>
                <dt>网络</dt><dd>{{ selectedInspect.networkNames.join(', ') || '—' }}</dd>
                <dt>重启策略</dt><dd>{{ selectedInspect.restartPolicy || '—' }}</dd>
              </dl>
              <p v-if="selectedInspect" class="inspect-security-note">只展示 inspect 摘要，不会展示 Env 或完整 inspect 输出。</p>
              <p v-else class="empty">点击“刷新信息”读取摘要。不会展示 Env 或完整 inspect 输出。</p>
            </template>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.docker-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 800);
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(2, 6, 23, 0.64);
  backdrop-filter: blur(8px);
}

.docker-dialog {
  width: min(1180px, calc(100vw - 48px));
  max-height: calc(100vh - 56px);
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, auto) minmax(0, 1fr);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.22));
  border-radius: 18px;
  background: var(--panel, #101827);
  color: var(--text, #e5edf8);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
}

.docker-dialog-header,
.docker-toolbar,
.docker-list-header,
.docker-select-all,
.docker-batch-bar,
.container-actions,
.detail-tabs,
.docker-mode-tabs,
.docker-compose-section-header,
.detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.docker-dialog-header {
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.18));
}

.docker-dialog-header h2 {
  margin: 0;
  font-size: 20px;
}

.docker-dialog-header p {
  margin: 6px 0 0;
  color: var(--muted, #9aa8ba);
  font-size: 13px;
}

.docker-toolbar {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}

.docker-toolbar label,
.detail-actions label:not(.detail-tail-control) {
  display: grid;
  gap: 6px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.docker-server-select-field {
  flex: 0 1 420px;
  max-width: 520px;
  min-width: 260px;
}

.docker-search-field {
  flex: 1 1 240px;
  min-width: 180px;
}

.docker-filter-field {
  flex: 0 0 132px;
}

.docker-toolbar input,
.docker-toolbar select,
.detail-actions input {
  width: 100%;
  min-width: 0;
}

.docker-server-select-field select {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.docker-status-line {
  padding: 9px 20px;
  color: var(--muted, #9aa8ba);
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.12));
  font-size: 13px;
}

.docker-mode-tabs {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.12));
}

.docker-mode-tabs .command-light-action { min-height: 30px; font-size: 14px; padding: 3px 8px; }

.docker-compose-panel {
  min-height: 0;
  max-height: min(620px, calc(100vh - 260px));
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  padding: 14px 20px 16px;
  padding-bottom: 16px;
  overflow: auto;
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.12));
}

.docker-compose-sidebar,
.docker-compose-detail {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.5);
  padding: 10px;
}

.docker-compose-sidebar {
  display: grid;
  align-content: start;
  gap: 8px;
}

.docker-compose-detail {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(120px, 1fr) auto;
  align-content: start;
  gap: 8px;
}

.docker-compose-section-header {
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
}

.docker-compose-section-header > div:not(.docker-compose-action-row) {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.docker-compose-section-header strong,
.docker-compose-project-row strong,
.docker-compose-service-row strong,
.docker-compose-service-row span,
.docker-compose-project-row span,
.docker-compose-project-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docker-compose-section-header span,
.docker-compose-project-row span,
.docker-compose-project-row small,
.docker-compose-service-row span {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.docker-compose-tail {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.docker-compose-action-row {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.docker-compose-tail-select {
  width: 74px;
  min-width: 0;
}

.docker-compose-filter {
  display: grid;
  gap: 4px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.docker-compose-project-filter {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
}

.docker-compose-service-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.docker-compose-service-count {
  flex: 0 0 auto;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.docker-compose-service-toolbar .docker-compose-filter {
  flex: 1 1 240px;
  max-width: 520px;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
}

.docker-compose-filter input {
  width: 100%;
  min-width: 0;
}

.docker-compose-project-row {
  min-width: 0;
  display: grid;
  gap: 3px;
  text-align: left;
}

.docker-compose-project-row.selected {
  border-color: rgba(96, 165, 250, 0.62);
  background: rgba(37, 99, 235, 0.16);
}

.docker-compose-service-row.selected {
  border-color: rgba(96, 165, 250, 0.62);
  background: rgba(37, 99, 235, 0.14);
}

.docker-compose-services {
  min-height: 0;
  max-height: 118px;
  display: grid;
  align-content: start;
  gap: 8px;
  overflow: auto;
}

.docker-compose-service-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(96px, 1fr) minmax(130px, 1.2fr) 76px minmax(110px, 1fr) minmax(96px, 1fr);
  gap: 8px;
  align-items: center;
  padding: 8px 9px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.38);
}

.docker-compose-service-detail {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(80px, 1fr) minmax(120px, 1.2fr) 80px minmax(100px, 1fr) minmax(90px, 1fr);
  gap: 8px;
  align-items: center;
  padding: 8px 9px;
  border: 1px solid rgba(96, 165, 250, 0.24);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.42);
}

.docker-compose-service-detail span,
.docker-compose-service-detail strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docker-compose-log-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
}

.docker-compose-logs {
  min-height: 100px;
  height: 100%;
  max-height: 170px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-radius: 12px;
  background: #050816;
  color: #dbeafe;
  font-family: var(--mono-font, 'Cascadia Mono', Consolas, monospace);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.docker-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(640px, 1fr) minmax(340px, 420px);
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: hidden;
  min-width: 0;
}

.docker-list-panel,
.docker-detail-panel {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 14px;
  background: var(--panel-2, rgba(15, 23, 42, 0.72));
  padding: 12px;
}

.docker-list-panel {
  display: grid;
  align-content: start;
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
}

.docker-list-header {
  justify-content: space-between;
}

.docker-select-all {
  font-weight: 700;
}

.docker-select-all input,
.container-check input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #60a5fa;
}

.docker-batch-bar {
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 10px;
  background: rgba(37, 99, 235, 0.11);
}

.docker-batch-bar span {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  margin-right: 2px;
}

.docker-batch-bar button {
  min-height: 26px;
  padding: 3px 8px;
  font-size: 12px;
}

.docker-container-card {
  display: grid;
  grid-template-columns: 28px minmax(160px, 1fr) minmax(104px, 112px) minmax(92px, 104px) minmax(154px, 164px);
  align-items: center;
  column-gap: 8px;
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  min-height: 74px;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.38);
  cursor: pointer;
  overflow: hidden;
}

.docker-container-card.selected {
  border-color: rgba(96, 165, 250, 0.62);
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.16) inset;
}

.container-main,
.container-meta,
.container-stats {
  min-width: 0;
  overflow: hidden;
}

.container-actions {
  min-width: 0;
  overflow: visible;
}

.container-main,
.container-meta,
.container-stats {
  display: grid;
  gap: 2px;
  line-height: 1.25;
}

.container-check {
  grid-column: 1;
  align-self: center;
  justify-self: center;
  cursor: default;
}

.container-main {
  grid-column: 2;
}

.container-meta {
  grid-column: 3;
  justify-items: start;
}

.container-stats {
  grid-column: 4;
  grid-template-columns: 1fr;
  justify-items: start;
}

.container-main strong,
.container-main span,
.container-meta span,
.container-stats span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.container-main span,
.container-meta span,
.container-stats span {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.container-stats span {
  display: block;
}

.container-main code {
  color: #93c5fd;
  font-family: var(--mono-font, 'Cascadia Mono', Consolas, monospace);
  font-size: 12px;
}

.container-state {
  justify-self: start;
  border-radius: 999px;
  padding: 2px 7px;
  background: rgba(148, 163, 184, 0.1);
}

.container-state.running {
  color: #86efac;
}

.container-state.stopped {
  color: #cbd5e1;
}

.container-state.warning {
  color: #fde68a;
}

.container-state.failed {
  color: #fca5a5;
}

.container-state.pending {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.24);
}

.container-actions {
  grid-column: 5;
  justify-self: end;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  width: 164px;
}

.container-actions button,
.detail-actions button {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 12px;
}

.container-actions button {
  flex: 0 0 auto;
  min-width: 54px;
}

.docker-detail-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  align-content: start;
  align-items: stretch;
  justify-content: stretch;
}

.detail-content {
  min-height: 0;
  align-self: start;
  display: block;
}

.detail-tabs button.active {
  color: var(--text, #e5edf8);
  border-color: transparent;
  background: rgba(37, 99, 235, 0.18);
  box-shadow: inset 0 -2px 0 var(--primary, #60a5fa);
}

.detail-actions {
  align-items: center;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
}

.detail-tail-control {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.detail-tail-control input {
  width: 72px;
  min-width: 0;
}

.docker-log-view {
  min-height: 220px;
  max-height: 46vh;
  overflow: auto;
  margin: 10px 0 0;
  padding: 10px;
  border-radius: 12px;
  background: #050816;
  color: #dbeafe;
  font-family: var(--mono-font, 'Cascadia Mono', Consolas, monospace);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.docker-info-grid {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px 12px;
  margin: 8px 0 0;
  align-self: start;
}

.docker-info-grid dt {
  color: var(--muted, #9aa8ba);
}

.docker-info-grid dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.empty {
  margin: 0;
  color: var(--muted, #9aa8ba);
}

.inspect-security-note {
  margin: 10px 0 0;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.danger.subtle {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.45);
}

@media (max-width: 1120px) {
  .docker-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}

@media (max-width: 840px) {
  .docker-compose-panel {
    grid-template-columns: 1fr;
    max-height: min(520px, 68vh);
    overflow: auto;
  }

  .docker-compose-service-row {
    grid-template-columns: minmax(120px, 1fr) minmax(160px, 1fr);
  }

  .docker-compose-services {
    min-height: 68px;
  }
}

@media (max-width: 760px) {
  .docker-container-card {
    grid-template-columns: 28px minmax(0, 1fr) minmax(154px, auto);
    grid-template-areas:
      "check main actions"
      "check meta stats";
    align-items: center;
    row-gap: 6px;
  }

  .container-check {
    grid-area: check;
  }

  .container-main {
    grid-area: main;
  }

  .container-meta {
    grid-area: meta;
  }

  .container-stats {
    grid-area: stats;
    justify-self: end;
  }

  .container-actions {
    grid-area: actions;
    width: min(164px, 40vw);
  }

  .container-actions {
    justify-self: end;
  }
}

@media (max-width: 620px) {
  .docker-container-card {
    grid-template-columns: 28px minmax(0, 1fr);
    grid-template-areas:
      "check main"
      "check meta"
      "check stats"
      "check actions";
  }

  .container-stats,
  .container-actions {
    justify-self: start;
  }

  .container-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
