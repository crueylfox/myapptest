<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Connection, DashboardSortMode, MonitorSnapshot } from '../types'
import { formatRate } from '../utils/format'
import type { DashboardServerStatus, DashboardServerSummary } from '../utils/multiServerDashboard'

defineOptions({ name: 'MultiServerDashboardDialog' })

const MonitorDashboard = defineAsyncComponent(() => import('./MonitorDashboard.vue'))

const sortOptions: Array<{ value: DashboardSortMode; label: string }> = [
  { value: 'manual', label: '手动排序' },
  { value: 'group', label: '按分组' },
  { value: 'remark', label: '按备注' },
  { value: 'cpu', label: '按 CPU' },
  { value: 'memory', label: '按内存' },
  { value: 'network', label: '按网络使用率' },
]

const props = defineProps<{
  open: boolean
  summaries: DashboardServerSummary[]
  connections: Connection[]
  selectedServerId: number | null
  activeWorkspaceServerId: number | null
  snapshots: Record<number, MonitorSnapshot>
  histories: Record<number, MonitorSnapshot[]>
  initialTab?: 'overview' | 'detail'
  initialServerId?: number | null
  batchOperation?: 'connect' | 'reconnect' | 'disconnect' | null
  dashboardSortMode?: DashboardSortMode
  dashboardManualServerOrder?: string[]
  activeAlertCountsByServerId?: Record<number, number>
  alertUnreadCount?: number
}>()

const emit = defineEmits<{
  close: []
  dashboardLayoutChange: [payload: { sortMode: DashboardSortMode; manualServerOrder: string[] }]
  switchServer: [serverID: number]
  connectServer: [serverID: number]
  disconnectServer: [serverID: number]
  editServer: [serverID: number]
  connectServers: [serverIDs: number[]]
  reconnectServers: [serverIDs: number[]]
  disconnectServers: [serverIDs: number[], scope: 'selected' | 'filtered']
  openTunnels: [serverID: number]
  openDocker: [serverID: number]
  openProcesses: [serverID: number]
  openNetworkDiagnostics: [serverID: number]
  alerts: []
}>()

const activeTab = ref<'overview' | 'detail'>('overview')
const detailServerId = ref<number | null>(null)
const selectedServerIds = ref<Set<number>>(new Set())
const query = ref('')
const statusFilter = ref<'all' | DashboardServerStatus>('all')
const groupFilter = ref('all')
const hideOffline = ref(false)
const sortMode = ref<DashboardSortMode>(normalizeDashboardSortMode(props.dashboardSortMode))
const manualServerOrder = ref<string[]>(normalizeManualServerOrder(props.dashboardManualServerOrder))
const draggedServerId = ref<number | null>(null)
const suppressCardClick = ref(false)
const refreshRevision = ref(0)
const lastRefreshAt = ref('')

const groups = computed(() => {
  const values = Array.from(new Set(props.summaries.map((summary) => summary.groupName || '未分组')))
  return values.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
})

const statusCounts = computed(() => props.summaries.reduce((counts, summary) => {
  counts[summary.status] += 1
  return counts
}, {
  online: 0,
  offline: 0,
  connecting: 0,
  error: 0,
} as Record<DashboardServerStatus, number>))

const filteredSummaries = computed(() => {
  void refreshRevision.value
  const term = query.value.trim().toLowerCase()
  const visible = props.summaries.filter((summary) => {
    if (statusFilter.value !== 'all' && summary.status !== statusFilter.value) return false
    if (groupFilter.value !== 'all' && summary.groupName !== groupFilter.value) return false
    if (hideOffline.value && !visibleWithOfflineHidden(summary)) return false
    if (!term) return true
    const remark = remarkForServer(summary.serverID)
    return [
      summary.name,
      summary.host,
      `${summary.host}:${summary.port}`,
      summary.groupName,
      remark,
    ].some((value) => value.toLowerCase().includes(term))
  })
  return sortSummaries(visible)
})

const selectedCount = computed(() => selectedServerIds.value.size)

const actionScope = computed<'selected' | 'filtered'>(() =>
  selectedServerIds.value.size > 0 ? 'selected' : 'filtered')

const actionSummaries = computed(() => {
  if (selectedServerIds.value.size === 0) return filteredSummaries.value
  return props.summaries.filter((summary) => selectedServerIds.value.has(summary.serverID))
})

const actionServerIds = computed(() => actionSummaries.value.map((summary) => summary.serverID))
const selectedActionSummaries = computed(() =>
  props.summaries.filter((summary) => selectedServerIds.value.has(summary.serverID)))
const selectedActionServerIds = computed(() => selectedActionSummaries.value.map((summary) => summary.serverID))

const connectableCount = computed(() => selectedActionSummaries.value.filter((summary) =>
  summary.status === 'offline' || summary.status === 'error').length)

const reconnectableCount = computed(() => actionSummaries.value.filter((summary) =>
  summary.status === 'offline' || summary.status === 'error').length)

const disconnectableCount = computed(() => actionSummaries.value.filter((summary) =>
  summary.status === 'online' || summary.status === 'connecting').length)

const singleSelectedServerId = computed(() => {
  if (selectedServerIds.value.size !== 1) return null
  return Array.from(selectedServerIds.value)[0] ?? null
})

const fallbackDetailServerId = computed(() =>
  props.activeWorkspaceServerId ??
  props.selectedServerId ??
  props.summaries[0]?.serverID ??
  props.connections[0]?.id ??
  null)

const detailConnection = computed(() =>
  props.connections.find((connection) => connection.id === detailServerId.value) ?? null)

const detailSummary = computed(() =>
  props.summaries.find((summary) => summary.serverID === detailServerId.value) ?? null)

const detailSnapshot = computed(() => {
  const serverID = detailServerId.value
  if (serverID === null || detailSummary.value?.status !== 'online') return null
  const snapshot = props.snapshots[serverID] ?? null
  return snapshot?.status === 'online' ? snapshot : null
})

const detailHistory = computed(() => {
  const serverID = detailServerId.value
  if (serverID === null || !detailSnapshot.value) return []
  return props.histories[serverID] ?? []
})

function ensureDetailServer() {
  const current = detailServerId.value
  if (current !== null && props.connections.some((connection) => connection.id === current)) return
  detailServerId.value = fallbackDetailServerId.value
}

watch(() => props.open, (open) => {
  if (!open) {
    selectedServerIds.value = new Set()
    return
  }
  activeTab.value = props.initialTab ?? 'overview'
  detailServerId.value = props.initialServerId ?? fallbackDetailServerId.value
})

watch(() => [props.initialTab, props.initialServerId] as const, ([tab, serverID]) => {
  if (!props.open) return
  activeTab.value = tab ?? 'overview'
  detailServerId.value = serverID ?? fallbackDetailServerId.value
})

watch(() => [
  props.connections.map((connection) => connection.id).join(','),
  fallbackDetailServerId.value,
], ensureDetailServer, { immediate: true })

watch(() => props.summaries.map((summary) => summary.serverID).join(','), () => {
  const valid = new Set(props.summaries.map((summary) => summary.serverID))
  selectedServerIds.value = new Set(Array.from(selectedServerIds.value).filter((serverID) => valid.has(serverID)))
  const hadManualOrder = manualServerOrder.value.length > 0
  syncManualOrder(props.open && hadManualOrder)
}, { immediate: true })

watch(() => props.dashboardSortMode, (value) => {
  const next = normalizeDashboardSortMode(value)
  if (sortMode.value !== next) sortMode.value = next
})

watch(() => props.dashboardManualServerOrder, (value) => {
  const next = normalizeManualServerOrder(value)
  if (sameStringArray(manualServerOrder.value, next)) return
  manualServerOrder.value = next
  syncManualOrder(false)
}, { deep: true })

watch(sortMode, () => {
  emitDashboardLayoutChange()
})

function refreshView() {
  refreshRevision.value += 1
  lastRefreshAt.value = new Date().toLocaleTimeString()
}

function statusLabel(status: DashboardServerStatus) {
  return {
    online: '在线',
    offline: '离线',
    connecting: '连接中',
    error: '错误',
  }[status]
}

function metricPercent(value: number | undefined) {
  return value === undefined ? '—' : `${value.toFixed(1)}%`
}

function metricLatency(value: number | undefined) {
  return value === undefined ? '—' : `${Math.round(value)} ms`
}

function dockerText(summary: DashboardServerSummary) {
  return summary.dockerStatusLabel || '—'
}

function connectionForServer(serverID: number) {
  return props.connections.find((connection) => connection.id === serverID) ?? null
}

function remarkForServer(serverID: number) {
  const connection = connectionForServer(serverID) as
    (Connection & {
      remark?: string
      note?: string
      notes?: string
      description?: string
      comment?: string
    }) | null
  return [
    connection?.remark,
    connection?.note,
    connection?.notes,
    connection?.description,
    connection?.comment,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

function sortSummaries(items: DashboardServerSummary[]) {
  const rows = [...items]
  if (sortMode.value === 'manual') {
    const manualIndex = new Map(manualServerOrder.value.map((serverID, index) => [serverID, index]))
    return rows.sort((left, right) =>
      (manualIndex.get(String(left.serverID)) ?? Number.MAX_SAFE_INTEGER) -
      (manualIndex.get(String(right.serverID)) ?? Number.MAX_SAFE_INTEGER))
  }
  if (sortMode.value === 'group') {
    return rows.sort((left, right) =>
      compareText(left.groupName, right.groupName) || compareText(left.name, right.name))
  }
  if (sortMode.value === 'remark') {
    return rows.sort((left, right) =>
      compareOptionalText(remarkForServer(left.serverID), remarkForServer(right.serverID)) ||
      compareText(left.name, right.name))
  }
  if (sortMode.value === 'cpu') {
    return rows.sort((left, right) =>
      compareOptionalNumberDesc(left.cpuPercent, right.cpuPercent) || compareText(left.name, right.name))
  }
  if (sortMode.value === 'memory') {
    return rows.sort((left, right) =>
      compareOptionalNumberDesc(left.memoryPercent, right.memoryPercent) || compareText(left.name, right.name))
  }
  return rows.sort((left, right) =>
    compareOptionalNumberDesc(networkUsage(left), networkUsage(right)) || compareText(left.name, right.name))
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

function compareOptionalText(left: string, right: string) {
  const leftEmpty = left.trim() === ''
  const rightEmpty = right.trim() === ''
  if (leftEmpty && rightEmpty) return 0
  if (leftEmpty) return 1
  if (rightEmpty) return -1
  return compareText(left, right)
}

function compareOptionalNumberDesc(left: number | undefined, right: number | undefined) {
  const leftValid = typeof left === 'number' && Number.isFinite(left)
  const rightValid = typeof right === 'number' && Number.isFinite(right)
  if (!leftValid && !rightValid) return 0
  if (!leftValid) return 1
  if (!rightValid) return -1
  return right - left
}

function networkUsage(summary: DashboardServerSummary) {
  const rx = typeof summary.networkRxRate === 'number' && Number.isFinite(summary.networkRxRate)
    ? summary.networkRxRate
    : undefined
  const tx = typeof summary.networkTxRate === 'number' && Number.isFinite(summary.networkTxRate)
    ? summary.networkTxRate
    : undefined
  if (rx === undefined && tx === undefined) return undefined
  return (rx ?? 0) + (tx ?? 0)
}

function syncManualOrder(persist = false) {
  const ids = props.summaries.map((summary) => String(summary.serverID))
  const valid = new Set(ids)
  const next = manualServerOrder.value.filter((serverID) => valid.has(serverID))
  for (const serverID of ids) {
    if (!next.includes(serverID)) next.push(serverID)
  }
  if (sameStringArray(manualServerOrder.value, next)) return
  manualServerOrder.value = next
  if (persist) emitDashboardLayoutChange()
}

function suppressCardSelectionOnce() {
  suppressCardClick.value = true
  window.setTimeout(() => {
    suppressCardClick.value = false
  }, 120)
}

function moveManualOrder(sourceServerId: number, targetServerId: number) {
  if (sourceServerId === targetServerId) return
  syncManualOrder()
  const sourceKey = String(sourceServerId)
  const targetKey = String(targetServerId)
  const next = [...manualServerOrder.value]
  const sourceIndex = next.indexOf(sourceKey)
  const targetIndex = next.indexOf(targetKey)
  if (sourceIndex === -1 || targetIndex === -1) return
  next.splice(sourceIndex, 1)
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  next.splice(adjustedTargetIndex, 0, sourceKey)
  manualServerOrder.value = next
  emitDashboardLayoutChange()
}

function normalizeDashboardSortMode(value: DashboardSortMode | undefined): DashboardSortMode {
  return sortOptions.some((option) => option.value === value) ? value as DashboardSortMode : 'manual'
}

function normalizeManualServerOrder(value: string[] | undefined) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const next = String(item).trim()
    if (!next || seen.has(next)) continue
    seen.add(next)
    result.push(next)
  }
  return result
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function emitDashboardLayoutChange() {
  const nextManualServerOrder = [...manualServerOrder.value]
  const currentSortMode = normalizeDashboardSortMode(props.dashboardSortMode)
  const currentManualOrder = normalizeManualServerOrder(props.dashboardManualServerOrder)
  if (sortMode.value === currentSortMode && sameStringArray(nextManualServerOrder, currentManualOrder)) return
  emit('dashboardLayoutChange', {
    sortMode: sortMode.value,
    manualServerOrder: nextManualServerOrder,
  })
}

function visibleWithOfflineHidden(summary: DashboardServerSummary) {
  if (summary.status === 'online' || summary.status === 'connecting') return true
  if (summary.status !== 'error') return false
  return summary.active ||
    summary.terminalCount > 0 ||
    summary.sftpConnectedCount > 0 ||
    summary.transferActiveCount > 0 ||
    summary.tunnelRunningCount > 0
}

function emptyMessage() {
  if (hideOffline.value && statusFilter.value === 'offline') {
    return '当前状态筛选与隐藏离线组合没有结果'
  }
  return '没有符合条件的服务器'
}

function detailDockerText(summary: DashboardServerSummary | null) {
  if (!summary) return 'Docker：—'
  if (summary.dockerTotalContainers === null) return `Docker：${summary.dockerStatusLabel || '未检测'}`
  return `容器：运行中 ${summary.dockerRunningContainers ?? 0} / 总数 ${summary.dockerTotalContainers}`
}

function quickActionDisabled(summary: DashboardServerSummary | null) {
  return !summary || (summary.status !== 'online' && summary.status !== 'connecting' && !visibleWithOfflineHidden(summary))
}

function openDetail(serverID: number) {
  selectServer(serverID)
  detailServerId.value = serverID
  activeTab.value = 'detail'
}

function selectServer(serverID: number) {
  if (selectedServerIds.value.has(serverID)) return
  selectedServerIds.value = new Set([...selectedServerIds.value, serverID])
}

function handleCardClick(serverID: number, event: MouseEvent) {
  if (suppressCardClick.value) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.detail > 1) return
  toggleSelection(serverID)
}

function handleCardDoubleClick(serverID: number, event: MouseEvent) {
  if (suppressCardClick.value) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  openDetail(serverID)
}

function handleCardDragStart(summary: DashboardServerSummary, event: DragEvent) {
  if (sortMode.value !== 'manual') {
    event.preventDefault()
    return
  }
  syncManualOrder()
  draggedServerId.value = summary.serverID
  suppressCardSelectionOnce()
  event.dataTransfer?.setData('text/plain', String(summary.serverID))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function handleCardDragOver(summary: DashboardServerSummary, event: DragEvent) {
  if (sortMode.value !== 'manual') return
  if (draggedServerId.value === null || draggedServerId.value === summary.serverID) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function handleCardDrop(summary: DashboardServerSummary, event: DragEvent) {
  if (sortMode.value !== 'manual') return
  event.preventDefault()
  const sourceFromEvent = Number(event.dataTransfer?.getData('text/plain') ?? NaN)
  const sourceServerId = draggedServerId.value ?? (Number.isFinite(sourceFromEvent) ? sourceFromEvent : null)
  if (sourceServerId !== null) moveManualOrder(sourceServerId, summary.serverID)
  draggedServerId.value = null
  suppressCardSelectionOnce()
}

function handleCardDragEnd() {
  draggedServerId.value = null
  suppressCardSelectionOnce()
}

function toggleSelection(serverID: number) {
  const next = new Set(selectedServerIds.value)
  if (next.has(serverID)) next.delete(serverID)
  else next.add(serverID)
  selectedServerIds.value = next
}

function selectVisible() {
  selectedServerIds.value = new Set([
    ...selectedServerIds.value,
    ...filteredSummaries.value.map((summary) => summary.serverID),
  ])
}

function invertVisible() {
  const next = new Set(selectedServerIds.value)
  for (const summary of filteredSummaries.value) {
    if (next.has(summary.serverID)) next.delete(summary.serverID)
    else next.add(summary.serverID)
  }
  selectedServerIds.value = next
}

function emitSwitchSelected() {
  if (singleSelectedServerId.value === null) return
  emit('switchServer', singleSelectedServerId.value)
}

function emitEditSelected() {
  if (singleSelectedServerId.value === null) return
  emit('editServer', singleSelectedServerId.value)
}

function emitBulkConnect() {
  if (connectableCount.value === 0 || props.batchOperation) return
  emit('connectServers', selectedActionServerIds.value)
}

function emitReconnect() {
  if (reconnectableCount.value === 0 || props.batchOperation) return
  emit('reconnectServers', actionServerIds.value)
}

function emitBulkDisconnect() {
  if (disconnectableCount.value === 0 || props.batchOperation) return
  emit('disconnectServers', actionServerIds.value, actionScope.value)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    v-if="open"
    class="multi-server-dashboard-backdrop"
    data-testid="multi-server-dashboard"
    @pointerdown.self="emit('close')"
  >
    <section class="multi-server-dashboard" role="dialog" aria-modal="true" aria-label="监控面板">
      <header class="multi-server-dashboard-header">
        <div class="dashboard-panel-title">
          <h2>监控面板</h2>
          <small>
            服务器 {{ summaries.length }} / 在线 {{ statusCounts.online }}
          </small>
        </div>
        <div class="dashboard-panel-header-actions">
          <div class="dashboard-panel-tabs" role="tablist" aria-label="监控面板视图">
            <button
              type="button"
              role="tab"
              class="command-light-action"
              :aria-selected="activeTab === 'overview'"
              :class="{ active: activeTab === 'overview' }"
              data-testid="dashboard-tab-overview"
              @click="activeTab = 'overview'"
            >服务器总览</button>
            <span class="command-action-separator" aria-hidden="true">|</span>
            <button
              type="button"
              role="tab"
              class="command-light-action"
              :aria-selected="activeTab === 'detail'"
              :class="{ active: activeTab === 'detail' }"
              data-testid="dashboard-tab-detail"
              @click="activeTab = 'detail'"
            >详细监控</button>
          </div>
          <button
            type="button"
            class="command-light-action dashboard-alert-center-button"
            data-testid="dashboard-alert-center"
            @click="emit('alerts')"
          >
            <span>告警中心</span>
            <span v-if="(alertUnreadCount ?? 0) > 0" class="dashboard-alert-center-count">{{ alertUnreadCount }}</span>
          </button>
          <button type="button" class="dialog-close-button" @click="emit('close')">关闭</button>
        </div>
      </header>

      <div v-if="activeTab === 'overview'" class="multi-server-dashboard-toolbar">
        <div class="monitor-dashboard-filter-grid" data-testid="monitor-dashboard-filter-grid">
          <div class="monitor-dashboard-field monitor-dashboard-search-field">
            <label class="monitor-dashboard-label" for="monitor-dashboard-search">搜索</label>
            <input
              id="monitor-dashboard-search"
              v-model="query"
              class="monitor-dashboard-control"
              placeholder="名称 / Host / 分组"
              data-testid="dashboard-search"
            />
          </div>
          <div class="monitor-dashboard-field monitor-dashboard-status-field">
            <label class="monitor-dashboard-label" for="monitor-dashboard-status-filter">状态</label>
            <select
              id="monitor-dashboard-status-filter"
              v-model="statusFilter"
              class="monitor-dashboard-control"
              data-testid="dashboard-status-filter"
            >
              <option value="all">全部</option>
              <option value="online">在线</option>
              <option value="offline">离线</option>
              <option value="connecting">连接中</option>
              <option value="error">错误</option>
            </select>
          </div>
          <div class="monitor-dashboard-field monitor-dashboard-group-field">
            <label class="monitor-dashboard-label" for="monitor-dashboard-group-filter">分组</label>
            <select
              id="monitor-dashboard-group-filter"
              v-model="groupFilter"
              class="monitor-dashboard-control"
              data-testid="dashboard-group-filter"
            >
              <option value="all">全部分组</option>
              <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
            </select>
          </div>
          <div class="monitor-dashboard-field monitor-dashboard-sort-field">
            <label class="monitor-dashboard-label" for="monitor-dashboard-sort-mode">排序</label>
            <select
              id="monitor-dashboard-sort-mode"
              v-model="sortMode"
              class="monitor-dashboard-control"
              data-testid="dashboard-sort-mode"
            >
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>
          <div class="monitor-dashboard-field monitor-dashboard-refresh-field">
            <label class="monitor-dashboard-label monitor-dashboard-label-placeholder" aria-hidden="true">&nbsp;</label>
            <div class="monitor-dashboard-refresh-row">
              <button type="button" class="secondary monitor-dashboard-control monitor-dashboard-refresh-button" @click="refreshView">
                刷新视图
              </button>
              <span v-if="lastRefreshAt" class="monitor-dashboard-refresh-time">{{ lastRefreshAt }}</span>
            </div>
          </div>
        </div>
        <div class="dashboard-bulk-actions" data-testid="dashboard-bulk-actions">
          <span class="dashboard-selected-count">已选 {{ selectedCount }} 个</span>
          <button type="button" class="command-light-action" :disabled="filteredSummaries.length === 0" data-testid="dashboard-select-all" @click="selectVisible">全选</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button type="button" class="command-light-action" :disabled="filteredSummaries.length === 0" data-testid="dashboard-invert-selection" @click="invertVisible">反选</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class="command-light-action"
            :disabled="batchOperation !== null || singleSelectedServerId === null"
            data-testid="dashboard-switch-selected"
            @click="emitSwitchSelected"
          >切换</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class="command-light-action"
            :disabled="batchOperation !== null || connectableCount === 0"
            data-testid="dashboard-connect-all"
            @click="emitBulkConnect"
          >{{ batchOperation === 'connect' ? '连接中...' : '连接' }}</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class="command-light-action"
            :disabled="batchOperation !== null || reconnectableCount === 0"
            data-testid="dashboard-reconnect-offline"
            title="按需重连当前筛选结果中的离线服务器"
            @click="emitReconnect"
          >{{ batchOperation === 'reconnect' ? '重连中...' : '自动重连' }}</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class="command-light-action dashboard-danger-action"
            :disabled="batchOperation !== null || disconnectableCount === 0"
            data-testid="dashboard-disconnect-all"
            @click="emitBulkDisconnect"
          >{{ batchOperation === 'disconnect' ? '断开中...' : '断开' }}</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class="command-light-action"
            :disabled="batchOperation !== null || singleSelectedServerId === null"
            data-testid="dashboard-edit-selected"
            @click="emitEditSelected"
          >编辑</button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class="command-light-action"
            :class="{ active: hideOffline }"
            data-testid="dashboard-hide-offline"
            @click="hideOffline = !hideOffline"
          >隐藏离线</button>
        </div>
      </div>

      <div v-else class="dashboard-detail-toolbar">
        <label class="dashboard-detail-select-field">
          <span>服务器</span>
          <select
            v-model.number="detailServerId"
            :disabled="connections.length === 0"
            data-testid="dashboard-detail-server-select"
          >
            <option v-for="connection in connections" :key="connection.id" :value="connection.id">
              {{ connection.name }} · {{ connection.host }}:{{ connection.port }}
            </option>
          </select>
        </label>
        <div v-if="detailConnection" class="dashboard-detail-status">
          <span
            class="dashboard-status-pill"
            :class="`is-${detailSummary?.status ?? 'offline'}`"
          >
            {{ statusLabel(detailSummary?.status ?? 'offline') }}
          </span>
          <span :title="`${detailConnection.host}:${detailConnection.port}`">
            {{ detailConnection.host }}:{{ detailConnection.port }}
          </span>
          <span>延迟 {{ metricLatency(detailSummary?.latencyMs) }}</span>
        </div>
      </div>

      <div v-if="activeTab === 'overview'" class="multi-server-dashboard-body" data-testid="dashboard-overview-panel">
        <p v-if="summaries.length === 0" class="dashboard-empty">暂无服务器</p>
        <p v-else-if="filteredSummaries.length === 0" class="dashboard-empty">{{ emptyMessage() }}</p>
        <article
          v-for="summary in filteredSummaries"
          :key="summary.serverID"
          class="dashboard-server-card"
          :class="[`is-${summary.status}`, {
            active: summary.active,
            selected: selectedServerIds.has(summary.serverID),
            dragging: draggedServerId === summary.serverID,
          }]"
          :draggable="sortMode === 'manual'"
          data-testid="dashboard-server-card"
          @click="handleCardClick(summary.serverID, $event)"
          @dblclick="handleCardDoubleClick(summary.serverID, $event)"
          @dragstart="handleCardDragStart(summary, $event)"
          @dragover="handleCardDragOver(summary, $event)"
          @drop="handleCardDrop(summary, $event)"
          @dragend="handleCardDragEnd"
        >
          <div class="dashboard-card-main">
            <div class="dashboard-card-top">
              <input
                type="checkbox"
                class="dashboard-card-select"
                :checked="selectedServerIds.has(summary.serverID)"
                :aria-label="`选择 ${summary.name}`"
                data-testid="dashboard-card-checkbox"
                @click.stop
                @change.stop="toggleSelection(summary.serverID)"
              />
              <div class="dashboard-card-identity">
                <strong class="dashboard-card-name-line" :title="summary.name">{{ summary.name }}</strong>
                <span class="dashboard-card-host" :title="`${summary.host}:${summary.port}`">
                  {{ summary.host }}:{{ summary.port }}
                </span>
              </div>
              <span class="dashboard-card-status" :class="`is-${summary.status}`">
                {{ statusLabel(summary.status) }}
              </span>
              <span
                v-if="(activeAlertCountsByServerId?.[summary.serverID] ?? 0) > 0"
                class="dashboard-card-alert-badge"
                title="进行中的告警"
              >告警 {{ activeAlertCountsByServerId?.[summary.serverID] }}</span>
            </div>

            <div class="dashboard-card-metric-grid" data-testid="dashboard-card-metric-grid">
              <div class="dashboard-card-metric-column dashboard-card-metric-left">
                <div class="dashboard-card-metric-item">
                  <span>CPU</span>
                  <strong>{{ metricPercent(summary.cpuPercent) }}</strong>
                </div>
                <div class="dashboard-card-metric-item">
                  <span>内存</span>
                  <strong>{{ metricPercent(summary.memoryPercent) }}</strong>
                </div>
                <div class="dashboard-card-metric-item">
                  <span>DISK</span>
                  <strong>{{ metricPercent(summary.diskUsagePercent) }}</strong>
                </div>
              </div>
              <div class="dashboard-card-metric-column dashboard-card-metric-right">
                <div class="dashboard-card-metric-item">
                  <span>延迟</span>
                  <strong>{{ metricLatency(summary.latencyMs) }}</strong>
                </div>
                <div class="dashboard-card-metric-item dashboard-card-upload">
                  <span>上传</span>
                  <strong>{{ formatRate(summary.networkTxRate ?? null) }}</strong>
                </div>
                <div class="dashboard-card-metric-item dashboard-card-download">
                  <span>下载</span>
                  <strong>{{ formatRate(summary.networkRxRate ?? null) }}</strong>
                </div>
              </div>
            </div>

            <div class="dashboard-runtime-row">
              <span>终端 {{ summary.terminalCount }}</span>
              <span>SFTP {{ summary.sftpConnectedCount }}</span>
              <span>传输 {{ summary.transferActiveCount }}</span>
              <span>隧道 {{ summary.tunnelRunningCount }}</span>
              <span>Docker {{ dockerText(summary) }}</span>
            </div>

            <p v-if="summary.lastError" class="dashboard-last-error" :title="summary.lastError">
              {{ summary.lastError }}
            </p>
          </div>

        </article>
      </div>

      <div v-else class="multi-server-dashboard-detail" data-testid="dashboard-detail-panel">
        <div v-if="detailConnection" class="dashboard-detail-monitor">
          <MonitorDashboard :snapshot="detailSnapshot" :history="detailHistory" />
        </div>
        <section v-if="detailConnection" class="dashboard-runtime-summary" data-testid="dashboard-runtime-summary">
          <article class="dashboard-runtime-summary-card" data-testid="dashboard-tunnel-summary">
            <header>
              <strong>隧道监控</strong>
              <button
                type="button"
                class="text-button"
                :disabled="quickActionDisabled(detailSummary)"
                @click="detailServerId !== null && emit('openTunnels', detailServerId)"
              >端口转发</button>
            </header>
            <div class="dashboard-summary-counts">
              <span>运行中隧道：{{ detailSummary?.tunnelRunningCount ?? 0 }}</span>
              <span>已停止/失败：{{ detailSummary?.tunnelStoppedOrFailedCount ?? 0 }}</span>
            </div>
            <ul v-if="detailSummary?.tunnelPreview.length" class="dashboard-summary-list">
              <li v-for="item in detailSummary.tunnelPreview" :key="item.id">
                <span :title="item.endpoint">{{ item.endpoint }}</span>
                <em>{{ item.statusLabel }}</em>
              </li>
            </ul>
            <p v-else class="dashboard-summary-empty">暂无隧道状态</p>
          </article>

          <article class="dashboard-runtime-summary-card" data-testid="dashboard-transfer-summary">
            <header>
              <strong>上传下载任务</strong>
              <span class="dashboard-summary-muted">SFTP / SCP</span>
            </header>
            <div class="dashboard-summary-counts four">
              <span>传输中：{{ detailSummary?.transferRunningCount ?? 0 }}</span>
              <span>排队：{{ detailSummary?.transferQueuedCount ?? 0 }}</span>
              <span>失败：{{ detailSummary?.transferFailedCount ?? 0 }}</span>
              <span>已完成：{{ detailSummary?.transferCompletedCount ?? 0 }}</span>
            </div>
            <ul v-if="detailSummary?.transferPreview.length" class="dashboard-summary-list">
              <li v-for="item in detailSummary.transferPreview" :key="item.id">
                <span :title="item.name">{{ item.directionLabel }} {{ item.name }}</span>
                <em>{{ item.statusLabel }}<template v-if="item.percent !== undefined"> · {{ item.percent }}%</template></em>
              </li>
            </ul>
            <p v-else class="dashboard-summary-empty">暂无活动传输</p>
          </article>

          <article class="dashboard-runtime-summary-card" data-testid="dashboard-docker-summary">
            <header>
              <strong>Docker 摘要</strong>
              <button
                type="button"
                class="text-button"
                :disabled="quickActionDisabled(detailSummary)"
                @click="detailServerId !== null && emit('openDocker', detailServerId)"
              >容器管理</button>
            </header>
            <p class="dashboard-summary-main">{{ detailDockerText(detailSummary) }}</p>
            <p class="dashboard-summary-empty">只读取已有 Docker 状态，不主动检测。</p>
          </article>

          <article class="dashboard-runtime-summary-card" data-testid="dashboard-shortcut-summary">
            <header>
              <strong>快捷入口</strong>
              <span class="dashboard-summary-muted">打开已有面板</span>
            </header>
            <div class="dashboard-summary-actions">
              <button
                type="button"
                class="secondary"
                :disabled="quickActionDisabled(detailSummary)"
                @click="detailServerId !== null && emit('openProcesses', detailServerId)"
              >进程管理</button>
              <button
                type="button"
                class="secondary"
                :disabled="quickActionDisabled(detailSummary)"
                @click="detailServerId !== null && emit('openNetworkDiagnostics', detailServerId)"
              >网络诊断</button>
              <button
                type="button"
                class="secondary"
                :disabled="quickActionDisabled(detailSummary)"
                @click="detailServerId !== null && emit('openDocker', detailServerId)"
              >容器管理</button>
              <button
                type="button"
                class="secondary"
                :disabled="quickActionDisabled(detailSummary)"
                @click="detailServerId !== null && emit('openTunnels', detailServerId)"
              >端口转发</button>
            </div>
          </article>
        </section>
        <p v-else class="dashboard-empty">暂无服务器</p>
      </div>
    </section>
  </div>
</template>
