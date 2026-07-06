<script lang="ts">
type LocalNetworkSample = {
  timestamp: string
  uploadBytesPerSecond: number
  downloadBytesPerSecond: number
}

const WINDOW_MS = 180_000
const localNetworkHistory = new Map<string, LocalNetworkSample[]>()
const localNetworkSelections = new Map<string, string>()
const localSystemInfoExpanded = new Map<string, boolean>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LocalNetworkInterface, LocalProcessInfo, LocalResourceSnapshot, LocalTerminalState } from '../types'
import { api } from '../api/backend'
import { formatBytes, formatPercent, formatRate, formatUptime } from '../utils/format'
import type { ProcessSort } from '../utils/workspaceMetrics'
import AppIcon from './icons/AppIcon.vue'
import MiniSparkline from './MiniSparkline.vue'

const props = defineProps<{
  session: LocalTerminalState | null
}>()

const snapshot = ref<LocalResourceSnapshot | null>(null)
const selectedInterfaceName = ref('')
const historyRevision = ref(0)
const error = ref('')
const systemExpanded = ref(false)
const processSort = ref<ProcessSort>('memory')
let timer: number | null = null

const memoryUsed = computed(() => {
  if (!snapshot.value) return -1
  return Math.max(0, snapshot.value.memoryTotal - snapshot.value.memoryAvailable)
})
const interfaceRows = computed(() => snapshot.value?.networkInterfaces ?? [])
const visibleInterfaceRows = computed(() => visibleNetworkInterfaces(interfaceRows.value))
const selectedInterface = computed(() =>
  interfaceRows.value.find((item) => item.name === selectedInterfaceName.value) ?? interfaceRows.value[0] ?? null)
const selectedInterfaceLabel = computed(() =>
  selectedInterface.value?.displayName || selectedInterface.value?.name || '本地网络')
const currentUploadRate = computed(() =>
  selectedInterface.value?.uploadBytesPerSecond ?? snapshot.value?.uploadBytesPerSecond ?? null)
const currentDownloadRate = computed(() =>
  selectedInterface.value?.downloadBytesPerSecond ?? snapshot.value?.downloadBytesPerSecond ?? null)
const selectedSamples = computed(() => {
  historyRevision.value
  return localNetworkHistory.get(historyKey(selectedInterfaceName.value)) ?? []
})
const uploadHistory = computed(() => selectedSamples.value.map((item) => ({
  timestamp: item.timestamp,
  value: item.uploadBytesPerSecond,
})))
const downloadHistory = computed(() => selectedSamples.value.map((item) => ({
  timestamp: item.timestamp,
  value: item.downloadBytesPerSecond,
})))
const networkRateStats = computed(() => {
  const values = selectedSamples.value.flatMap((item) => [
    item.uploadBytesPerSecond,
    item.downloadBytesPerSecond,
  ]).filter((value) => Number.isFinite(value) && value >= 0)
  if (!values.length) {
    const current = [currentUploadRate.value, currentDownloadRate.value]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    if (!current.length) return null
    return statsFromValues(current)
  }
  return statsFromValues(values)
})
const systemDetails = computed(() => {
  const current = snapshot.value
  if (!current) return []
  return [
    current.osVersion || current.osName,
    current.osBuild ? `Build ${current.osBuild}` : '',
    current.architecture,
    current.cpuLogicalProcessors ? `${current.cpuLogicalProcessors} logical CPUs` : '',
    current.memoryTotal ? `${formatBytes(current.memoryTotal)} RAM` : '',
    current.uptimeSeconds ? `Uptime ${formatUptime(current.uptimeSeconds)}` : '',
  ].filter(Boolean)
})
const primaryGpu = computed(() => {
  const rows = snapshot.value?.gpus ?? []
  return rows.find((item) => item.available) ?? null
})
const gpuAvailable = computed(() => Boolean(primaryGpu.value?.available))
const gpuUsagePercent = computed(() => {
  const usage = primaryGpu.value?.usagePercent
  return gpuAvailable.value && typeof usage === 'number' && usage >= 0 ? usage : null
})
const gpuUsageLabel = computed(() =>
  gpuUsagePercent.value === null ? '使用率不可用' : formatPercent(gpuUsagePercent.value))
const gpuName = computed(() => primaryGpu.value?.name?.trim() || 'GPU')
const gpuMemorySummary = computed(() => {
  const gpu = primaryGpu.value
  if (!gpu?.available) return 'GPU 不可用'
  if (gpu.memoryTotalBytes > 0) {
    return gpu.memoryUsedBytes > 0
      ? `${gpuName.value} · ${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(gpu.memoryTotalBytes)}`
      : `${gpuName.value} · ${formatBytes(gpu.memoryTotalBytes)}`
  }
  return gpuName.value
})
const showGpuCard = computed(() => snapshot.value?.platform !== 'darwin')
const disks = computed(() => snapshot.value?.disks ?? [])
const rawProcesses = computed(() => snapshot.value?.processes ?? [])
const processCpuAvailable = computed(() =>
  rawProcesses.value.some((process) =>
    Number.isFinite(process.cpuPercent) && process.cpuPercent >= 0))
const processes = computed(() => sortLocalProcesses(rawProcesses.value, processSort.value).slice(0, 5))
const processEmptyText = computed(() => {
  if (processSort.value === 'cpu' && rawProcesses.value.length && !processCpuAvailable.value) {
    return 'CPU 数据不可用'
  }
  return 'unavailable'
})

function selectionKey() {
  return props.session?.sessionId ?? 'local'
}

function syncSystemExpanded() {
  systemExpanded.value = localSystemInfoExpanded.get(selectionKey()) ?? false
}

function toggleSystemExpanded() {
  const next = !systemExpanded.value
  systemExpanded.value = next
  localSystemInfoExpanded.set(selectionKey(), next)
}

function historyKey(interfaceName: string) {
  return `${props.session?.sessionId ?? 'local'}:${interfaceName || '__all__'}`
}

function statsFromValues(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    max: Math.max(...values),
    avg: total / values.length,
    min: Math.min(...values),
  }
}

function clampPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 100)
}

function processCpuLabel(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) || value < 0 ? '—' : formatPercent(value)
}

function hasProcessMetric(process: LocalProcessInfo, sort: ProcessSort) {
  const value = sort === 'cpu' ? process.cpuPercent : process.memoryBytes
  return Number.isFinite(value) && value >= 0
}

function sortLocalProcesses(rows: LocalProcessInfo[], sort: ProcessSort) {
  return rows
    .filter((process) =>
      Number.isFinite(process.pid) && process.pid > 0 &&
      hasProcessMetric(process, sort))
    .sort((left, right) => {
      const primary = sort === 'cpu'
        ? right.cpuPercent - left.cpuPercent
        : right.memoryBytes - left.memoryBytes
      return primary || left.pid - right.pid
    })
}

function ensureSelectedInterface(next: LocalResourceSnapshot) {
  const rows = visibleNetworkInterfaces(next.networkInterfaces ?? [])
  if (!rows.length) {
    selectedInterfaceName.value = ''
    localNetworkSelections.delete(selectionKey())
    return
  }
  const saved = localNetworkSelections.get(selectionKey()) || ''
  const savedExists = saved && rows.some((item) => item.name === saved)
  const nextName = savedExists
    ? saved
    : rows.find((item) => item.isDefaultRoute)?.name ?? rows[0].name
  if (saved && !savedExists) localNetworkSelections.delete(selectionKey())
  if (nextName) {
    selectedInterfaceName.value = nextName
  }
}

function pushSample(key: string, sample: LocalNetworkSample) {
  const cutoff = Date.parse(sample.timestamp) - WINDOW_MS
  const previous = localNetworkHistory.get(key) ?? []
  const next = [...previous, sample].filter((item) => {
    const time = Date.parse(item.timestamp)
    return Number.isFinite(time) && time >= cutoff
  })
  localNetworkHistory.set(key, next)
}

function storeNetworkSamples(next: LocalResourceSnapshot) {
  const timestamp = next.timestamp || new Date().toISOString()
  const rows = next.networkInterfaces ?? []
  if (!rows.length) {
    pushSample(historyKey(''), {
      timestamp,
      uploadBytesPerSecond: next.uploadBytesPerSecond ?? 0,
      downloadBytesPerSecond: next.downloadBytesPerSecond ?? 0,
    })
  } else {
    for (const item of rows) {
      pushSample(historyKey(item.name), {
        timestamp,
        uploadBytesPerSecond: item.uploadBytesPerSecond ?? 0,
        downloadBytesPerSecond: item.downloadBytesPerSecond ?? 0,
      })
    }
  }
  historyRevision.value += 1
}

async function refresh() {
  try {
    const next = await api.getLocalResourceSnapshot()
    ensureSelectedInterface(next)
    snapshot.value = next
    storeNetworkSamples(next)
    error.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function updateSelectedInterface(event: Event) {
  selectedInterfaceName.value = (event.target as HTMLSelectElement).value
  if (selectedInterfaceName.value) localNetworkSelections.set(selectionKey(), selectedInterfaceName.value)
  historyRevision.value += 1
}

function visibleNetworkInterfaces(rows: LocalNetworkInterface[]) {
  const visible = rows.filter((item) => !item.isHiddenByDefault)
  if (visible.length) return visible
  const fallback = rows.filter((item) => item.isUp !== false && !item.isLoopback)
  return fallback.length ? fallback : rows
}

onMounted(() => {
  void refresh()
  timer = window.setInterval(() => void refresh(), 2000)
})

watch(() => props.session?.sessionId, syncSystemExpanded, { immediate: true })

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <aside class="local-monitor-sidebar">
    <section class="compact-monitor local-monitor-card">
      <header class="compact-server-header">
        <div>
          <strong>{{ snapshot?.hostname || '本机' }}</strong>
          <small>{{ props.session?.shell || '本地终端' }} · {{ snapshot?.platform || '本机' }}</small>
        </div>
        <span class="compact-state"><i class="status-dot online"></i>本地</span>
      </header>

      <section class="system-info local-system-info">
        <button
          type="button"
          class="system-info-summary"
          :aria-expanded="systemExpanded"
          @click="toggleSystemExpanded"
        >
          <span class="system-info-summary-text">
            <strong>系统信息</strong>
            <span>{{ systemDetails[0] || (error ? '本地监控暂不可用' : '正在加载') }}</span>
          </span>
          <span class="system-info-summary-chevron" aria-hidden="true">
            <AppIcon :name="systemExpanded ? 'chevron-up' : 'chevron-down'" :size="14" />
          </span>
        </button>
        <div v-if="systemExpanded && systemDetails.length > 1" class="local-system-detail">
          <span v-for="item in systemDetails.slice(1)" :key="item">{{ item }}</span>
        </div>
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
      <section v-if="showGpuCard" class="compact-resource gpu-resource" data-testid="local-gpu-card">
        <div class="resource-line">
          <strong>GPU</strong>
          <span>{{ gpuUsageLabel }}</span>
          <small>{{ gpuMemorySummary }}</small>
        </div>
        <div class="metric-progress gpu"><i :style="{ width: `${clampPercent(gpuUsagePercent)}%` }"></i></div>
      </section>

      <section class="network-compact local-network-compact">
        <header>
          <div class="network-title-cluster">
            <strong>网络</strong>
            <div class="network-controls network-controls-compact" data-testid="local-network-current" @click.stop @pointerdown.stop>
              <select
                v-model="selectedInterfaceName"
                class="monitor-network-interface-select"
                data-testid="local-network-interface-select"
                aria-label="选择本地网络接口"
                @change="updateSelectedInterface"
              >
                <option
                  v-for="item in visibleInterfaceRows"
                  :key="item.name"
                  :value="item.name"
                  :title="item.description || item.displayName || item.name"
                >
                  {{ item.displayName || item.name }}
                </option>
                <option v-if="!visibleInterfaceRows.length" value="">本地网络</option>
              </select>
              <span class="network-inline-separator" aria-hidden="true">|</span>
              <button type="button" class="network-icon-button" title="刷新本地监控" aria-label="刷新本地监控" @click.stop="refresh">↻</button>
            </div>
          </div>
          <div class="network-rate-cluster">
            <span class="network-current-rate upload">↑ {{ formatRate(currentUploadRate) }}</span>
            <span class="network-inline-separator" aria-hidden="true">|</span>
            <span class="network-current-rate download">↓ {{ formatRate(currentDownloadRate) }}</span>
          </div>
        </header>
        <span class="network-chart-body" :aria-label="`${selectedInterfaceLabel} 最近 3 分钟流量`">
          <span class="network-stat-column" data-testid="local-network-stats">
            <span class="network-stat-value network-stat-max" :aria-label="`最高 ${formatRate(networkRateStats?.max ?? null)}`">{{ formatRate(networkRateStats?.max ?? null) }}</span>
            <span class="network-stat-value network-stat-avg" :aria-label="`平均 ${formatRate(networkRateStats?.avg ?? null)}`">{{ formatRate(networkRateStats?.avg ?? null) }}</span>
            <span class="network-stat-value network-stat-min" :aria-label="`最低 ${formatRate(networkRateStats?.min ?? null)}`">{{ formatRate(networkRateStats?.min ?? null) }}</span>
          </span>
          <span class="network-chart-plot">
            <MiniSparkline
              :timed-series="[uploadHistory, downloadHistory]"
              :window-ms="WINDOW_MS"
              :colors="['#fb923c', '#2dd4bf']"
              flow
              left-fade
            />
          </span>
        </span>
      </section>

      <section class="local-monitor-extra-card mount-panel local-disk-card" data-testid="local-disk-card">
        <header><strong>磁盘与挂载点</strong></header>
        <div v-if="disks.length" class="mount-list local-disk-list">
          <article v-for="disk in disks" :key="disk.mountPath || disk.name">
            <strong :title="disk.mountPath || disk.name">{{ disk.name || disk.mountPath }}</strong>
            <div class="mount-progress">
              <i :style="{ width: `${clampPercent(disk.usedPercent)}%` }"></i>
              <span>{{ formatPercent(disk.usedPercent) }} · {{ formatBytes(disk.available) }} / {{ formatBytes(disk.total) }}</span>
            </div>
          </article>
        </div>
        <p v-else class="compact-empty">—</p>
      </section>

      <section class="process-panel local-process-card" data-testid="local-process-card">
        <header>
          <strong>Top Processes</strong>
          <div class="process-sort-options">
            <button :class="{ active: processSort === 'cpu' }" @click="processSort = 'cpu'">CPU</button>
            <span class="process-option-separator" aria-hidden="true">|</span>
            <button :class="{ active: processSort === 'memory' }" @click="processSort = 'memory'">内存</button>
          </div>
        </header>
        <div v-if="processes.length" class="local-process-list process-table">
          <div v-for="process in processes" :key="process.pid" class="local-process-row">
            <span>{{ process.name || process.pid }} · PID {{ process.pid }}</span>
            <strong>{{ processSort === 'cpu' ? processCpuLabel(process.cpuPercent) : formatBytes(process.memoryBytes) }}</strong>
            <small>{{ processSort === 'cpu' ? formatBytes(process.memoryBytes) : processCpuLabel(process.cpuPercent) }}</small>
          </div>
        </div>
        <p v-else class="compact-empty">{{ processEmptyText }}</p>
      </section>
    </section>
  </aside>
</template>
