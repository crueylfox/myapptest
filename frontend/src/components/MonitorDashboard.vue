<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MonitorSnapshot } from '../types'
import { formatBytes, formatPercent, formatRate, formatUptime } from '../utils/format'
import { resolveMonitorOverviewLayout } from '../utils/monitorOverviewLayout'
import MonitorChart from './MonitorChart.vue'

const props = withDefaults(defineProps<{
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  showAlertCenter?: boolean
  alertUnreadCount?: number
}>(), {
  showAlertCenter: false,
  alertUnreadCount: 0,
})
const emit = defineEmits<{
  alerts: []
}>()
const root = ref<HTMLElement>()
const containerWidth = ref(1360)
const containerHeight = ref(776)
const uiFontSize = ref(15)
let observer: ResizeObserver | null = null

const memoryUsed = computed(() => props.snapshot
  ? Math.max(0, props.snapshot.memoryTotal - props.snapshot.memoryAvailable)
  : 0)
const swapUsed = computed(() => props.snapshot
  ? Math.max(0, props.snapshot.swapTotal - props.snapshot.swapFree)
  : 0)
const networkSourceLabel = computed(() => {
  const source = props.snapshot?.effectiveNetworkInterface || props.snapshot?.defaultInterface
  if (source === 'all') return '全部接口'
  return source || '网络接口不可用'
})
const layout = computed(() => resolveMonitorOverviewLayout(
  containerWidth.value,
  containerHeight.value,
  uiFontSize.value,
  { hasNotice: !props.snapshot },
))
const dashboardStyle = computed(() => ({
  '--monitor-metric-columns': String(layout.value.metricColumns),
  '--monitor-chart-columns': String(layout.value.chartColumns),
  '--monitor-chart-height': `${layout.value.chartHeight}px`,
}))

function readUIFontSize() {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ui-font-size'),
  )
  uiFontSize.value = Number.isFinite(value) && value > 0 ? value : 15
}

function updateSize(width: number, height: number) {
  if (width > 0) containerWidth.value = Math.floor(width)
  if (height > 0) containerHeight.value = Math.floor(height)
}

function measureRoot() {
  readUIFontSize()
  const rect = root.value?.getBoundingClientRect()
  if (rect) updateSize(rect.width, rect.height)
}

function handleAppearanceChange() {
  measureRoot()
}

onMounted(() => {
  measureRoot()
  observer = new ResizeObserver((entries) => {
    readUIFontSize()
    const entry = entries[0]
    if (!entry) return
    updateSize(entry.contentRect.width, entry.contentRect.height)
  })
  if (root.value) observer.observe(root.value)
  window.addEventListener('serverpilot:appearance', handleAppearanceChange)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('serverpilot:appearance', handleAppearanceChange)
})
</script>

<template>
  <section
    ref="root"
    class="monitor-dashboard"
    :class="layout.mode"
    :style="dashboardStyle"
    :data-layout-mode="layout.mode"
    :data-chart-columns="layout.chartColumns"
    :data-chart-height="layout.chartHeight"
  >
    <header v-if="showAlertCenter" class="monitor-dashboard-header">
      <button
        type="button"
        class="secondary dashboard-alert-center-button monitor-alert-center-button"
        data-testid="monitor-alert-center"
        @click="emit('alerts')"
      >
        <span>告警中心</span>
        <span v-if="alertUnreadCount > 0" class="dashboard-alert-center-count">{{ alertUnreadCount }}</span>
      </button>
    </header>
    <div v-if="!snapshot" class="monitor-unavailable">
      等待监控数据，连接后自动更新。
    </div>
    <section class="metric-grid">
      <article class="system-card"><div class="metric-label">系统信息</div><strong class="compact">{{ snapshot?.osName || '—' }}</strong><small>{{ snapshot ? `${snapshot.kernel || '内核未知'} · ${snapshot.architecture || '架构未知'}` : '系统信息不可用' }}</small></article>
      <article><div class="metric-label">CPU</div><strong>{{ formatPercent(snapshot?.cpuPercent ?? null) }}</strong><small>连续采样差值</small></article>
      <article><div class="metric-label">内存</div><strong>{{ formatPercent(snapshot?.memoryUsedPercent ?? null) }}</strong><small>{{ snapshot ? `${formatBytes(memoryUsed)} / ${formatBytes(snapshot.memoryTotal)}` : '—' }}</small></article>
      <article><div class="metric-label">SWAP</div><strong class="compact">{{ snapshot ? formatBytes(swapUsed) : '—' }}</strong><small>{{ snapshot ? `总计 ${formatBytes(snapshot.swapTotal)}` : 'Swap 信息不可用' }}</small></article>
      <article><div class="metric-label">系统负载</div><strong>{{ snapshot?.loadOne?.toFixed(2) ?? '—' }}</strong><small>{{ snapshot?.loadFive != null && snapshot?.loadFifteen != null ? `${snapshot.loadFive.toFixed(2)} / ${snapshot.loadFifteen.toFixed(2)}` : '负载信息不可用' }}</small></article>
      <article><div class="metric-label">运行时间</div><strong class="compact">{{ formatUptime(snapshot?.uptimeSeconds ?? null) }}</strong><small>远程系统 uptime</small></article>
      <article><div class="metric-label">根分区</div><strong>{{ formatPercent(snapshot?.diskUsedPercent ?? null) }}</strong><small>{{ snapshot?.diskUsedPercent == null ? '磁盘信息不可用' : `${formatBytes(snapshot.diskUsed)} / ${formatBytes(snapshot.diskTotal)}` }}</small></article>
      <article class="upload"><div class="metric-label">↑ 上传</div><strong>{{ formatRate(snapshot?.uploadBytesPerSecond ?? null) }}</strong><small>TX · {{ networkSourceLabel }}</small></article>
      <article class="download"><div class="metric-label">↓ 下载</div><strong>{{ formatRate(snapshot?.downloadBytesPerSecond ?? null) }}</strong><small>RX · {{ networkSourceLabel }}</small></article>
      <article><div class="metric-label">延迟</div><strong class="compact">{{ snapshot?.latencyAvailable ? `${snapshot.latencyMillis} ms` : '—' }}</strong><small>SSH 连接建立耗时</small></article>
    </section>
    <div v-if="snapshot?.errors?.length" class="metric-errors">
      <span v-for="item in snapshot.errors" :key="`${item.metric}-${item.message}`">{{ item.metric }}: {{ item.message }}</span>
    </div>
    <section class="charts-grid">
      <MonitorChart title="CPU · 最近 60 秒" :history="history" unit="percent" :fields="[{ key: 'cpuPercent', name: 'CPU', color: '#6ea8fe' }]" />
      <MonitorChart title="内存 · 最近 60 秒" :history="history" unit="percent" :fields="[{ key: 'memoryUsedPercent', name: '内存', color: '#a78bfa' }]" />
      <MonitorChart title="网络吞吐 · 最近 60 秒（Byte/s）" :history="history" unit="rate" :fields="[{ key: 'downloadBytesPerSecond', name: '下载 RX', color: '#2dd4bf' }, { key: 'uploadBytesPerSecond', name: '上传 TX', color: '#fb923c' }]" />
    </section>
  </section>
</template>
