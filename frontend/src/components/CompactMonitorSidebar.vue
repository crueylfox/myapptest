<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type {
  Connection,
  ConnectionRuntimeState,
  MonitorSnapshot,
  MonitorNetworkInterfaceMode,
  MonitorNetworkInterfacePreference,
  NetworkInterface,
  ServerWorkspaceStatus,
} from '../types'
import { formatBytes, formatPercent, formatRate, formatUptime } from '../utils/format'
import {
  sortProcesses,
  visibleMounts,
  type ProcessSort,
} from '../utils/workspaceMetrics'
import AppIcon from './icons/AppIcon.vue'
import ChevronIcon from './ChevronIcon.vue'
import MiniSparkline from './MiniSparkline.vue'

const props = defineProps<{
  connection: Connection | null
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  state: ConnectionRuntimeState | null
  workspaceStatus?: ServerWorkspaceStatus
  networkInterfaces?: NetworkInterface[]
  networkPreference?: MonitorNetworkInterfacePreference | null
  networkInterfacesLoading?: boolean
}>()
const emit = defineEmits<{
  layout: []
  process: [pid: number]
  networkInterface: [mode: MonitorNetworkInterfaceMode, selectedNetworkInterface: string]
  networkDiagnostics: []
  networkInterfacesRefresh: []
}>()
const root = ref<HTMLElement>()
const processSort = ref<ProcessSort>('memory')
const showAllMounts = ref(true)
const expandedSystemByServer = ref<Record<number, boolean>>({})
const MIN_MONITOR_HEIGHT = 180
const MIN_MOUNT_HEIGHT = 120
const DEFAULT_MONITOR_HEIGHT = 430
const NETWORK_DISPLAY_WINDOW_MS = 180_000
const storedMonitorHeightValue = localStorage.getItem('serverpilot.monitorPaneHeight')
const storedMonitorHeight = storedMonitorHeightValue === null
  ? Number.NaN
  : Number(storedMonitorHeightValue)
const monitorHeight = ref(clampStoredMonitorHeight(storedMonitorHeight))
type SplitMode = 'split' | 'monitorCollapsed' | 'mountsCollapsed'
const storedSplitMode = localStorage.getItem('serverpilot.monitorSidebarSplitMode') as SplitMode | null
const splitMode = ref<SplitMode>(
  storedSplitMode === 'monitorCollapsed' || storedSplitMode === 'mountsCollapsed'
    ? storedSplitMode
    : 'split',
)
const monitorDetailsExpanded = ref(localStorage.getItem('serverpilot.monitorDetailsExpanded') === 'true')
let dragging = false

const status = computed(() => {
  const value = props.workspaceStatus ?? props.state?.status ?? 'offline'
  return value === 'connected' ? 'online' : value
})
const live = computed(() =>
  props.snapshot?.status === 'online' && props.snapshot.monitorActive)
const stale = computed(() => Boolean(props.snapshot) && !live.value)
const rawProcesses = computed(() => props.snapshot?.processes ?? [])
const processCpuAvailable = computed(() =>
  rawProcesses.value.some((process) =>
    Number.isFinite(process.cpuPercent) && process.cpuPercent >= 0))
const processes = computed(() =>
  sortProcesses(rawProcesses.value, processSort.value).slice(0, 5))
const processStatus = computed(() => props.snapshot?.processStatus ??
  (props.snapshot ? (processes.value.length ? 'available' : 'empty') : 'loading'))
const processEmptyText = computed(() => {
  if (processSort.value === 'cpu' && rawProcesses.value.length && !processCpuAvailable.value) {
    return 'CPU 数据不可用'
  }
  if (props.snapshot?.processMessage) return props.snapshot.processMessage
  const labels = {
    loading: '正在加载进程数据',
    empty: '暂无进程数据',
    unsupported: '当前系统不支持进程采集',
    failed: '进程采集失败，请查看应用日志',
    available: '暂无进程数据',
  }
  return labels[processStatus.value]
})
const mounts = computed(() =>
  visibleMounts(props.snapshot?.mounts ?? [], showAllMounts.value))
const memoryUsed = computed(() => props.snapshot
  ? Math.max(0, props.snapshot.memoryTotal - props.snapshot.memoryAvailable)
  : -1)
const swapUsed = computed(() => props.snapshot
  ? Math.max(0, props.snapshot.swapTotal - props.snapshot.swapFree)
  : -1)
const swapPercent = computed(() =>
  props.snapshot?.swapTotal
    ? swapUsed.value / props.snapshot.swapTotal * 100
    : null)
const diskPercent = computed(() => props.snapshot?.diskUsedPercent ?? null)
const diskSummary = computed(() => {
  const used = props.snapshot?.diskUsed ?? -1
  const total = props.snapshot?.diskTotal ?? -1
  if (used < 0 || total <= 0) return '--'
  return `${formatBytes(used)} / ${formatBytes(total)}`
})
const lastUpdated = computed(() => {
  if (!props.snapshot?.timestamp) return ''
  return new Date(props.snapshot.timestamp).toLocaleTimeString()
})
const networkHistoryNowMs = computed(() => {
  const timestamps = [
    ...props.history.map((item) => timestampMs(item.timestamp)),
    timestampMs(props.snapshot?.timestamp),
  ].filter((value): value is number => value !== null)
  return timestamps.length ? Math.max(...timestamps) : Date.now()
})
const networkHistoryWindow = computed(() => {
  const now = networkHistoryNowMs.value
  return props.history.filter((item) => {
    const timestamp = timestampMs(item.timestamp)
    if (timestamp === null) return false
    const age = now - timestamp
    return age >= 0 && age <= NETWORK_DISPLAY_WINDOW_MS
  })
})
const uploadHistory = computed(() =>
  networkHistoryWindow.value.map((item) => ({
    timestamp: item.timestamp,
    value: item.uploadBytesPerSecond,
  })))
const downloadHistory = computed(() =>
  networkHistoryWindow.value.map((item) => ({
    timestamp: item.timestamp,
    value: item.downloadBytesPerSecond,
  })))
const networkRateStats = computed(() => {
  const values = networkHistoryWindow.value
    .flatMap((item) => networkSampleRates(item))
  if (!values.length) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    max: Math.max(...values),
    avg: total / values.length,
    min: Math.min(...values),
  }
})
const interfaceRows = computed(() => props.networkInterfaces ?? [])
const networkMode = computed<MonitorNetworkInterfaceMode>(() =>
  props.networkPreference?.mode ??
  props.snapshot?.networkInterfaceMode ??
  props.connection?.networkInterfaceMode ??
  'all')
const selectedNetworkInterface = computed(() =>
  props.networkPreference?.selectedNetworkInterface ??
  props.snapshot?.selectedNetworkInterface ??
  props.connection?.selectedNetworkInterface ??
  '')
const networkSelectValue = computed(() =>
  networkMode.value === 'interface' && selectedNetworkInterface.value
    ? selectedNetworkInterface.value
    : networkMode.value === 'physical' || networkMode.value === 'docker'
      ? networkMode.value
    : 'all')
const networkInterfaceLabel = computed(() => {
  if (networkMode.value === 'interface' && selectedNetworkInterface.value) {
    return selectedNetworkInterface.value
  }
  if (networkMode.value === 'physical') return '全部物理'
  if (networkMode.value === 'docker') return 'Docker 网络'
  if (props.snapshot?.effectiveNetworkInterface === 'all') return '全部接口'
  if (props.snapshot?.effectiveNetworkInterface === 'physical') return '全部物理'
  if (props.snapshot?.effectiveNetworkInterface === 'docker') return 'Docker 网络'
  if (props.snapshot?.effectiveNetworkInterface) return props.snapshot.effectiveNetworkInterface
  return '全部接口'
})
const networkDataUnavailable = computed(() =>
  !props.networkInterfacesLoading && interfaceRows.value.length === 0 && live.value)
const paneStyle = computed(() => ({
  gridTemplateRows: !monitorDetailsExpanded.value
    ? 'minmax(0, 1fr) 0 0'
    : splitMode.value === 'monitorCollapsed'
    ? '10px minmax(0, 1fr)'
    : splitMode.value === 'mountsCollapsed'
      ? 'minmax(0, 1fr) 10px'
      : `${monitorHeight.value}px 10px minmax(120px, 1fr)`,
}))
const systemExpanded = computed(() => {
  const serverId = props.connection?.id
  return serverId ? expandedSystemByServer.value[serverId] ?? false : false
})
const systemSummary = computed(() => {
  const os = props.snapshot?.osName || '—'
  const uptime = formatUptime(props.snapshot?.uptimeSeconds ?? null)
  const latency = props.snapshot?.latencyAvailable
    ? `${props.snapshot.latencyMillis} ms`
    : '—'
  return `${os} · 运行 ${uptime} · 延迟 ${latency}`
})

function clampPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 100)
}

function normalizeNetworkRate(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.max(value, 0)
}

function networkSampleRates(item: Pick<MonitorSnapshot, 'uploadBytesPerSecond' | 'downloadBytesPerSecond'>) {
  const upload = normalizeNetworkRate(item.uploadBytesPerSecond)
  const download = normalizeNetworkRate(item.downloadBytesPerSecond)
  return [upload, download].filter((value): value is number => value !== null)
}

function timestampMs(value: string | undefined) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function clampStoredMonitorHeight(value: number) {
  if (!Number.isFinite(value) || value < MIN_MONITOR_HEIGHT) return DEFAULT_MONITOR_HEIGHT
  return value
}

function toggleSystemInfo() {
  const serverId = props.connection?.id
  if (!serverId) return
  expandedSystemByServer.value = {
    ...expandedSystemByServer.value,
    [serverId]: !systemExpanded.value,
  }
}

function toggleMonitorDetails() {
  monitorDetailsExpanded.value = !monitorDetailsExpanded.value
  localStorage.setItem('serverpilot.monitorDetailsExpanded', String(monitorDetailsExpanded.value))
  void nextTick(() => emit('layout'))
}

function processTitle(process: MonitorSnapshot['processes'][number]) {
  return `PID ${process.pid} · ${process.command} · CPU ${process.cpuPercent.toFixed(1)}% · 内存 ${process.memoryPercent.toFixed(1)}%`
}

function updateNetworkInterface(event: Event) {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : 'all'
  if (value === 'all' || value === 'physical' || value === 'docker') {
    emit('networkInterface', value, '')
  } else {
    emit('networkInterface', 'interface', value)
  }
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    online: '在线',
    connecting: '连接中',
    reconnecting: '重连中',
    failed: '失败',
    auth_failed: '认证失败',
    disconnected: '已断开',
    offline: '离线',
  }
  return labels[value] ?? '离线'
}

function startSplit(event: PointerEvent) {
  if (splitMode.value !== 'split') return
  dragging = true
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  window.addEventListener('pointermove', moveSplit)
  window.addEventListener('pointerup', stopSplit, { once: true })
}

function setSplitMode(mode: SplitMode) {
  splitMode.value = mode
  localStorage.setItem('serverpilot.monitorSidebarSplitMode', mode)
  void nextTick(() => emit('layout'))
}

function collapseMonitorPane() {
  setSplitMode('monitorCollapsed')
}

function collapseMountsPane() {
  setSplitMode('mountsCollapsed')
}

function restoreSplitPanes() {
  setSplitMode('split')
}

function moveSplit(event: PointerEvent) {
  if (!dragging || !root.value) return
  const rect = root.value.getBoundingClientRect()
  const maxMonitorHeight = Math.max(MIN_MONITOR_HEIGHT, rect.height - MIN_MOUNT_HEIGHT - 10)
  const next = Math.min(Math.max(event.clientY - rect.top, MIN_MONITOR_HEIGHT), maxMonitorHeight)
  monitorHeight.value = next
  emit('layout')
}

function stopSplit() {
  dragging = false
  localStorage.setItem('serverpilot.monitorPaneHeight', String(Math.round(monitorHeight.value)))
  window.removeEventListener('pointermove', moveSplit)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', moveSplit)
  window.removeEventListener('pointerup', stopSplit)
})
</script>

<template>
  <aside ref="root" class="compact-monitor-sidebar" :class="`split-${splitMode}`" :style="paneStyle">
    <section v-if="splitMode !== 'monitorCollapsed'" class="compact-monitor" :class="{ stale }">
      <header class="compact-server-header">
        <div>
          <strong>{{ connection?.name ?? '未连接服务器' }}</strong>
          <small>{{ connection ? `${connection.username}@${connection.host}:${connection.port}` : '—' }}</small>
        </div>
        <span class="compact-state"><i class="status-dot" :class="status"></i>{{ statusLabel(status) }}</span>
      </header>
      <p v-if="stale" class="last-update">非实时数据 · 最后更新 {{ lastUpdated }}</p>
      <section class="system-info">
        <button class="system-info-summary" @pointerdown.prevent @click="toggleSystemInfo">
          <span class="system-info-summary-text">
            <strong>系统信息</strong>
            <span :title="systemSummary">{{ systemSummary }}</span>
          </span>
          <span class="system-info-summary-chevron" aria-hidden="true">
            <AppIcon :name="systemExpanded ? 'chevron-up' : 'chevron-down'" :size="14" />
          </span>
        </button>
        <dl v-if="systemExpanded" class="system-facts">
          <div><dt>操作系统</dt><dd :title="snapshot?.osName">{{ snapshot?.osName || '—' }}</dd></div>
          <div><dt>内核</dt><dd :title="snapshot?.kernel">{{ snapshot?.kernel || '—' }}</dd></div>
          <div><dt>架构</dt><dd>{{ snapshot?.architecture || '—' }}</dd></div>
          <div><dt>运行时间</dt><dd>{{ formatUptime(snapshot?.uptimeSeconds ?? null) }}</dd></div>
          <div><dt>系统负载</dt><dd>{{ snapshot?.loadOne?.toFixed(2) ?? '—' }} / {{ snapshot?.loadFive?.toFixed(2) ?? '—' }} / {{ snapshot?.loadFifteen?.toFixed(2) ?? '—' }}</dd></div>
          <div><dt>延迟</dt><dd>{{ snapshot?.latencyAvailable ? `${snapshot.latencyMillis} ms` : '—' }}</dd></div>
          <div><dt>默认网卡</dt><dd>{{ snapshot?.defaultInterface || '—' }}</dd></div>
          <div><dt>最后采样</dt><dd>{{ lastUpdated || '—' }}</dd></div>
        </dl>
      </section>

      <section class="compact-resource">
        <div class="resource-line">
          <strong>CPU</strong>
          <span>{{ formatPercent(snapshot?.cpuPercent ?? null) }}</span>
        </div>
        <div class="metric-progress"><i :style="{ width: `${clampPercent(snapshot?.cpuPercent)}%` }"></i></div>
      </section>
      <section class="compact-resource">
        <div class="resource-line">
          <strong>内存</strong>
          <span>{{ formatPercent(snapshot?.memoryUsedPercent ?? null) }}</span>
          <small>{{ formatBytes(memoryUsed) }} / {{ formatBytes(snapshot?.memoryTotal ?? -1) }}</small>
        </div>
        <div class="metric-progress memory"><i :style="{ width: `${clampPercent(snapshot?.memoryUsedPercent)}%` }"></i></div>
      </section>
      <section class="compact-resource swap-resource">
        <div class="resource-line">
          <strong>Swap</strong>
          <span>{{ formatPercent(swapPercent) }}</span>
          <small>{{ formatBytes(swapUsed) }} / {{ formatBytes(snapshot?.swapTotal ?? -1) }}</small>
        </div>
        <div class="metric-progress swap"><i :style="{ width: `${clampPercent(swapPercent)}%` }"></i></div>
      </section>
      <section class="compact-resource compact-resource-disk">
        <div class="resource-line">
          <strong>纾佺洏</strong>
          <span>{{ formatPercent(diskPercent) }}</span>
          <small>{{ diskSummary }}</small>
        </div>
        <div class="metric-progress disk"><i :style="{ width: `${clampPercent(diskPercent)}%` }"></i></div>
      </section>
      <section class="compact-resource compact-resource-network">
        <div class="resource-line">
          <strong>缃戠粶</strong>
          <span>{{ formatRate(snapshot?.downloadBytesPerSecond ?? null) }}</span>
          <small>{{ formatRate(snapshot?.uploadBytesPerSecond ?? null) }}</small>
        </div>
      </section>

      <button type="button" class="monitor-details-toggle" @click="toggleMonitorDetails">
        {{ monitorDetailsExpanded ? '收起详细监控' : '展开详细监控' }}
      </button>

      <section v-show="monitorDetailsExpanded" class="process-panel">
        <header>
          <strong>TOP</strong>
          <div class="process-sort-options">
            <button :class="{ active: processSort === 'cpu' }" @click="processSort = 'cpu'">CPU</button>
            <span class="process-option-separator" aria-hidden="true">|</span>
            <button :class="{ active: processSort === 'memory' }" @click="processSort = 'memory'">内存</button>
          </div>
        </header>
        <div v-if="processes.length" class="process-table">
          <button
            v-for="process in processes"
            :key="process.pid"
            class="process-row"
            :title="processTitle(process)"
            @click="emit('process', process.pid)"
          >
            <span>{{ processSort === 'cpu' ? `${process.cpuPercent.toFixed(1)}%` : `${process.memoryPercent.toFixed(1)}%` }}</span>
            <strong>{{ process.command }}</strong>
          </button>
        </div>
        <p v-else class="compact-empty" :data-process-status="processStatus">{{ processEmptyText }}</p>
      </section>

      <section v-show="monitorDetailsExpanded" class="network-compact">
        <header>
          <div class="network-title-cluster">
            <strong>网络</strong>
            <div class="network-controls network-controls-compact" @click.stop @pointerdown.stop>
              <select
                :value="networkSelectValue"
                class="monitor-network-interface-select"
                :disabled="!connection"
                :title="networkInterfaceLabel"
                aria-label="选择网络接口"
                @click.stop
                @pointerdown.stop
                @change="updateNetworkInterface"
              >
                <option value="all" title="聚合全部非 lo 接口">全部</option>
                <option value="physical" title="聚合非虚拟物理接口，排除 Docker/bridge/veth/tun/tap/wg 等接口">物理</option>
                <option value="docker" title="聚合 docker0、br-*、veth* 以及 cni/flannel/vxlan 等容器网络接口；macvlan/ipvlan 流量可能只体现在父接口或外部交换设备">Docker</option>
                <option
                  v-for="item in interfaceRows"
                  :key="item.name"
                  :value="item.name"
                  :title="item.displayName || item.name"
                >
                  {{ item.displayName || item.name }}
                </option>
              </select>
              <span class="network-inline-separator" aria-hidden="true">|</span>
              <button
                type="button"
                class="network-icon-button"
                title="刷新接口列表"
                aria-label="刷新网络接口"
                :disabled="!connection || networkInterfacesLoading"
                @click.stop="emit('networkInterfacesRefresh')"
                @pointerdown.stop
              >↻</button>
            </div>
          </div>
          <div class="network-rate-cluster">
            <span class="network-current-rate upload">↑ {{ formatRate(snapshot?.uploadBytesPerSecond ?? null) }}</span>
            <span class="network-inline-separator" aria-hidden="true">|</span>
            <span class="network-current-rate download">↓ {{ formatRate(snapshot?.downloadBytesPerSecond ?? null) }}</span>
          </div>
        </header>
        <button
          type="button"
          class="network-chart-trigger"
          :disabled="!connection"
          :title="connection ? '打开网络详情' : '请先连接并选择一个服务器'"
          @click="emit('networkDiagnostics')"
        >
          <span class="network-chart-body" aria-label="最近 3 分钟流量统计">
            <span class="network-stat-column">
              <span class="network-stat-value network-stat-max" :aria-label="`最高 ${formatRate(networkRateStats?.max ?? null)}`">{{ formatRate(networkRateStats?.max ?? null) }}</span>
              <span class="network-stat-value network-stat-avg" :aria-label="`平均 ${formatRate(networkRateStats?.avg ?? null)}`">{{ formatRate(networkRateStats?.avg ?? null) }}</span>
              <span class="network-stat-value network-stat-min" :aria-label="`最低 ${formatRate(networkRateStats?.min ?? null)}`">{{ formatRate(networkRateStats?.min ?? null) }}</span>
            </span>
            <span class="network-chart-plot">
              <MiniSparkline
                :timed-series="[uploadHistory, downloadHistory]"
                :window-ms="NETWORK_DISPLAY_WINDOW_MS"
                :colors="['#fb923c', '#2dd4bf']"
                flow
                left-fade
              />
            </span>
          </span>
        </button>
        <p v-if="networkDataUnavailable" class="network-unavailable">接口数据不可用</p>
      </section>
    </section>

    <div
      v-show="monitorDetailsExpanded"
      v-if="splitMode === 'split' || splitMode === 'monitorCollapsed' || splitMode === 'mountsCollapsed'"
      class="horizontal-splitter monitor-pane-splitter"
      :class="{ 'restore-splitter': splitMode !== 'split' }"
      role="separator"
      aria-label="Resize monitor and mounts panes"
      @pointerdown="splitMode === 'split' && startSplit($event)"
    >
      <span v-if="splitMode === 'split'" class="monitor-splitter-controls" aria-label="Collapse monitor or mounts pane">
        <button
          type="button"
          class="splitter-handle-inline monitor-splitter-toggle collapse-monitor"
          title="Collapse monitor pane"
          aria-label="Collapse monitor pane"
          @pointerdown.stop.prevent
          @click.stop="collapseMonitorPane"
        ><ChevronIcon direction="up" /></button>
        <button
          type="button"
          class="splitter-handle-inline monitor-splitter-toggle collapse-mounts"
          title="Collapse mounts pane"
          aria-label="Collapse mounts pane"
          @pointerdown.stop.prevent
          @click.stop="collapseMountsPane"
        ><ChevronIcon direction="down" /></button>
      </span>
      <button
        v-else
        type="button"
        class="splitter-handle-inline monitor-splitter-toggle restore-split"
        title="Restore monitor and mounts panes"
        aria-label="Restore monitor and mounts panes"
        @pointerdown.stop.prevent
        @click.stop="restoreSplitPanes"
      >
        <ChevronIcon :direction="splitMode === 'monitorCollapsed' ? 'down' : 'up'" />
      </button>
    </div>
    <section v-if="splitMode !== 'mountsCollapsed'" v-show="monitorDetailsExpanded" class="mount-panel">
      <header>
        <strong>磁盘与挂载点</strong>
        <label><input v-model="showAllMounts" type="checkbox" />显示全部</label>
      </header>
      <div class="mount-list">
        <article v-for="mount in mounts" :key="`${mount.filesystem}-${mount.mountPath}`">
          <strong :title="mount.mountPath">{{ mount.mountPath }}</strong>
          <div class="mount-progress">
            <i :style="{ width: `${clampPercent(mount.usedPercent)}%` }"></i>
            <span>{{ clampPercent(mount.usedPercent).toFixed(0) }}% · {{ formatBytes(mount.available) }} / {{ formatBytes(mount.total) }}</span>
          </div>
        </article>
        <p v-if="mounts.length === 0" class="compact-empty">暂无挂载点数据</p>
      </div>
    </section>
  </aside>
</template>
