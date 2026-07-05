<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api/backend'
import { confirmDialog } from '../composables/useAppDialog'
import { useServerStore } from '../stores/server'
import type {
  Connection,
  MonitorNetworkInterfaceMode,
  NetworkEndpointSnapshot,
  NetworkEndpointSummary,
} from '../types'
import { formatBytes, formatRate } from '../utils/format'
import MiniSparkline from './MiniSparkline.vue'
import NetworkDiagnosticsPanel from './NetworkDiagnosticsPanel.vue'

type NetworkDetailsTab = 'endpoints' | 'diagnostics'
type ProtocolFilter = 'all' | 'tcp' | 'udp'
type StateFilter = 'all' | 'listening' | 'connected'
type SourceFilter = 'all' | 'host' | 'docker'
type SortKey = 'pid' | 'process' | 'source' | 'protocol' | 'address' | 'port' | 'remoteIPs' | 'connections' | 'uploaded' | 'downloaded'
type SnapshotScope = 'host' | 'full'
type EndpointColumn = { key: SortKey; label: string; title?: string }

const props = defineProps<{
  open: boolean
  connections: Connection[]
  activeServerId: number | null
  initialTab?: NetworkDetailsTab
}>()

const emit = defineEmits<{
  close: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const store = useServerStore()
const selectedServerID = ref(0)
const activeTab = ref<NetworkDetailsTab>('endpoints')
const contextID = ref('')
const contextServerID = ref(0)
const loadingSnapshot = ref(false)
const loadingDockerSnapshot = ref(false)
const openingContext = ref(false)
const loadingInterfaces = ref(false)
const realtime = ref(false)
const consecutiveFailures = ref(0)
const snapshot = ref<NetworkEndpointSnapshot | null>(null)
const refreshFailureMessage = ref('')
const search = ref('')
const protocolFilter = ref<ProtocolFilter>('all')
const stateFilter = ref<StateFilter>('all')
const sourceFilter = ref<SourceFilter>('all')
const sortKey = ref<SortKey>('port')
const sortDirection = ref<'asc' | 'desc'>('asc')
const diagnosticPanel = ref<InstanceType<typeof NetworkDiagnosticsPanel> | null>(null)
const endpointColumns: EndpointColumn[] = [
  { key: 'pid', label: 'PID' },
  { key: 'process', label: '程序' },
  { key: 'source', label: '来源' },
  { key: 'protocol', label: '协议' },
  { key: 'address', label: '监听 IP' },
  { key: 'port', label: '端口' },
  { key: 'remoteIPs', label: 'IP 数' },
  { key: 'connections', label: '连接数' },
  { key: 'uploaded', label: '累计上传', title: '服务器视角的发送字节，来自 ss bytes_sent。' },
  { key: 'downloaded', label: '累计下载', title: '服务器视角的接收字节，来自 ss bytes_received。' },
]
const endpointColumnWidths = ref([52, 110, 98, 58, 104, 62, 58, 88, 82, 82])
const endpointGridTemplate = computed(() => endpointColumnWidths.value.map((width) => `${width}px`).join(' '))
const endpointTableMinWidth = computed(() => `${endpointColumnWidths.value.reduce((total, width) => total + width, 0) + 9 * 7 + 16}px`)
let realtimeTimer: number | null = null
let snapshotRequestSeq = 0
let endpointResizeState: { index: number; startX: number; widths: number[] } | null = null

const onlineConnections = computed(() =>
  props.connections.filter((connection) => hasActiveNetworkServer(connection.id)))
const selectedSnapshot = computed(() =>
  selectedServerID.value ? store.snapshots[selectedServerID.value] ?? null : null)
const selectedHistory = computed(() =>
  selectedServerID.value ? store.histories[selectedServerID.value] ?? [] : [])
const downloadHistory = computed(() =>
  selectedHistory.value.map((item) => item.downloadBytesPerSecond))
const uploadHistory = computed(() =>
  selectedHistory.value.map((item) => item.uploadBytesPerSecond))
const interfaceRows = computed(() =>
  selectedServerID.value ? store.networkInterfaces[selectedServerID.value] ?? [] : [])
const preference = computed(() =>
  selectedServerID.value ? store.networkInterfacePreferences[selectedServerID.value] ?? null : null)
const interfaceSelectValue = computed(() => {
  if (preference.value?.mode === 'interface' && preference.value.selectedNetworkInterface) {
    return preference.value.selectedNetworkInterface
  }
  if (preference.value?.mode === 'physical' || preference.value?.mode === 'docker') {
    return preference.value.mode
  }
  return 'all'
})
const interfaceTitle = computed(() =>
  networkInterfaceOptionLabel(interfaceSelectValue.value))
const interfaceHelpTitle = computed(() =>
  `当前选择：${interfaceTitle.value}。接口选择仅影响流量曲线；端口和连接表默认包含宿主机及可读取的 Docker 容器。`)
const endpointRows = computed(() => snapshot.value?.listeners ?? [])
const snapshotBusy = computed(() => loadingSnapshot.value || loadingDockerSnapshot.value)
const endpointStatusMessage = computed(() => {
  if (refreshFailureMessage.value) return refreshFailureMessage.value
  if (loadingDockerSnapshot.value && snapshot.value) return '正在补充 Docker 容器连接...'
  return snapshot.value?.warnings?.[0] ?? ''
})
const filteredRows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const rows = endpointRows.value.filter((row) => {
    if (sourceFilter.value !== 'all' && (row.sourceType ?? 'host') !== sourceFilter.value) return false
    if (protocolFilter.value !== 'all' && baseProtocol(row.protocol) !== protocolFilter.value) return false
    if (stateFilter.value === 'listening' && !row.hasListener) return false
    if (stateFilter.value === 'connected' && !(row.connectionCount !== null && row.connectionCount !== undefined && row.connectionCount > 0)) return false
    if (!query) return true
    return [
      row.processName,
      row.sourceName ?? '',
      row.containerName ?? '',
      row.pidLabel ?? '',
      String(row.pid ?? ''),
      row.protocol,
      row.listenAddress,
      String(row.listenPort),
      String(row.connectionCount ?? ''),
      String(row.uniqueRemoteIPCount ?? ''),
    ].some((value) => value.toLowerCase().includes(query))
  })
  return sortEndpointRows(rows)
})
const hasNoOnlineServer = computed(() => onlineConnections.value.length === 0)

watch(() => props.open, async (open) => {
  if (!open) {
    await cleanup()
    return
  }
  activeTab.value = props.initialTab ?? 'endpoints'
  selectedServerID.value = defaultServerID()
  await nextTick()
  await loadSelectedServer()
}, { immediate: true })

watch(() => props.initialTab, (tab) => {
  if (props.open && tab) activeTab.value = tab
})

watch(selectedServerID, async (serverID, previous) => {
  if (!props.open || serverID === previous) return
  await closeInspectionContext()
  snapshot.value = null
  refreshFailureMessage.value = ''
  consecutiveFailures.value = 0
  await loadSelectedServer()
})

watch(realtime, (enabled) => {
  if (enabled) startRealtime()
  else stopRealtime()
})

onBeforeUnmount(() => {
  stopEndpointColumnResize()
  void cleanup()
})

function defaultServerID() {
  if (props.activeServerId && hasActiveNetworkServer(props.activeServerId)) return props.activeServerId
  return onlineConnections.value[0]?.id ?? 0
}

function hasActiveNetworkServer(serverID: number) {
  const state = store.connectionState(serverID)
  return state.monitorActive || state.terminalActive || state.sftpActive ||
    state.hasActiveSession || state.status === 'online'
}

async function loadSelectedServer() {
  if (!selectedServerID.value) return
  await loadInterfaces(true)
  await openInspectionContext()
}

async function openInspectionContext() {
  if (!selectedServerID.value || openingContext.value) return
  openingContext.value = true
  try {
    const response = await api.openNetworkInspectionContext(selectedServerID.value)
    contextID.value = response.contextID
    contextServerID.value = response.serverID
    await refreshSnapshot(false)
  } catch (reason) {
    emit('notify', errorMessage(reason, '打开网络详情失败'), 'error')
  } finally {
    openingContext.value = false
  }
}

async function refreshSnapshot(showToast = true) {
  if (!selectedServerID.value) {
    emit('notify', '请先连接并选择一台服务器', 'error')
    return false
  }
  if (snapshotBusy.value) return true
  if (!contextID.value || contextServerID.value !== selectedServerID.value) {
    await openInspectionContext()
    return Boolean(snapshot.value)
  }
  const requestContextID = contextID.value
  const requestServerID = selectedServerID.value
  const requestSeq = ++snapshotRequestSeq
  const hostLoaded = await loadSnapshotScope('host', requestContextID, requestServerID, requestSeq, false)
  if (!hostLoaded) return false
  const fullRefresh = loadSnapshotScope('full', requestContextID, requestServerID, requestSeq, showToast)
  if (showToast) return fullRefresh
  void fullRefresh
  return true
}

async function loadSnapshotScope(
  scope: SnapshotScope,
  requestContextID: string,
  requestServerID: number,
  requestSeq: number,
  showToast: boolean,
) {
  if (scope === 'host') loadingSnapshot.value = true
  else loadingDockerSnapshot.value = true
  try {
    const response = await api.getNetworkEndpointSnapshot({
      serverID: requestServerID,
      contextID: requestContextID,
      interfaceName: '',
      scope,
    })
    if (!isCurrentSnapshotRequest(requestContextID, requestServerID, requestSeq)) {
      return true
    }
    snapshot.value = response
    refreshFailureMessage.value = ''
    consecutiveFailures.value = 0
    if (response.warnings?.length) {
      if (scope === 'full' || showToast) emit('notify', response.warnings[0], 'info')
      if (response.warnings.some((warning) => warning.includes('接口不存在'))) {
        void store.setMonitorNetworkInterface(requestServerID, 'all', '', false).catch(() => undefined)
      }
    } else if (showToast && scope === 'full') {
      emit('notify', '网络详情已刷新', 'success')
    }
    return true
  } catch (reason) {
    if (!isCurrentSnapshotRequest(requestContextID, requestServerID, requestSeq)) {
      return false
    }
    if (scope === 'full' && snapshot.value) {
      const message = 'Docker 容器连接补充读取失败，当前显示宿主机数据。'
      refreshFailureMessage.value = message
      if (showToast) emit('notify', message, 'error')
      return false
    }
    consecutiveFailures.value += 1
    const message = snapshot.value
      ? '读取网络信息失败，当前显示的是上次成功数据。'
      : errorMessage(reason, '读取网络信息失败')
    refreshFailureMessage.value = message
    emit('notify', message, 'error')
    if (realtime.value && consecutiveFailures.value >= 3) {
      realtime.value = false
      emit('notify', '网络详情连续刷新失败，已关闭实时刷新。', 'error')
    }
    return false
  } finally {
    if (scope === 'host') loadingSnapshot.value = false
    else loadingDockerSnapshot.value = false
  }
}

function isCurrentSnapshotRequest(requestContextID: string, requestServerID: number, requestSeq: number) {
  return props.open &&
    requestContextID === contextID.value &&
    requestServerID === selectedServerID.value &&
    requestSeq === snapshotRequestSeq
}

async function loadInterfaces(silent = false) {
  if (!selectedServerID.value) return
  loadingInterfaces.value = true
  try {
    await store.loadNetworkInterfacePreference(selectedServerID.value)
    await store.loadNetworkInterfaces(selectedServerID.value)
    if (!silent) emit('notify', '网络接口已刷新', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '读取网络接口失败'), 'error')
  } finally {
    loadingInterfaces.value = false
  }
}

async function updateNetworkInterface(event: Event) {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : 'all'
  const mode: MonitorNetworkInterfaceMode =
    value === 'all' || value === 'physical' || value === 'docker' ? value : 'interface'
  const selectedNetworkInterface = mode === 'interface' ? value : ''
  if (!selectedServerID.value) return
  try {
    await store.setMonitorNetworkInterface(selectedServerID.value, mode, selectedNetworkInterface)
    emit('notify', `已切换网络接口：${networkInterfaceOptionLabel(value)}`, 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '切换网络接口失败'), 'error')
  }
}

async function switchTab(tab: NetworkDetailsTab) {
  if (tab === activeTab.value) return
  if (activeTab.value === 'diagnostics' && tab !== 'diagnostics' && diagnosticPanel.value?.hasRunningDiagnostics()) {
    const confirmed = await confirmDialog({
      title: '停止网络诊断',
      message: '切换页面会停止当前网络诊断，是否继续？',
      confirmText: '继续',
      cancelText: '取消',
      danger: true,
    })
    if (!confirmed) return
    await diagnosticPanel.value?.cancelRunningDiagnostics()
  }
  activeTab.value = tab
}

function startRealtime() {
  stopRealtime()
  realtimeTimer = window.setInterval(() => {
    if (!props.open || activeTab.value !== 'endpoints' || snapshotBusy.value) return
    void refreshSnapshot(false)
  }, 5000)
}

function stopRealtime() {
  if (realtimeTimer !== null) {
    window.clearInterval(realtimeTimer)
    realtimeTimer = null
  }
}

async function closeInspectionContext() {
  snapshotRequestSeq += 1
  loadingSnapshot.value = false
  loadingDockerSnapshot.value = false
  const serverID = contextServerID.value
  const id = contextID.value
  contextID.value = ''
  contextServerID.value = 0
  if (!serverID || !id) return
  await api.closeNetworkInspectionContext({ serverID, contextID: id }).catch(() => undefined)
}

async function cleanup() {
  stopEndpointColumnResize()
  stopRealtime()
  realtime.value = false
  await diagnosticPanel.value?.cancelRunningDiagnostics()
  await closeInspectionContext()
}

async function closeDialog() {
  emit('close')
  await cleanup()
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDirection.value = key === 'port' ? 'asc' : 'desc'
  }
}

function sortArrow(key: SortKey) {
  if (sortKey.value !== key) return ''
  return sortDirection.value === 'asc' ? '↑' : '↓'
}

function ariaSort(key: SortKey) {
  if (sortKey.value !== key) return 'none'
  return sortDirection.value === 'asc' ? 'ascending' : 'descending'
}

function startEndpointColumnResize(index: number, event: MouseEvent) {
  endpointResizeState = { index, startX: event.clientX, widths: [...endpointColumnWidths.value] }
  window.addEventListener('mousemove', resizeEndpointColumn)
  window.addEventListener('mouseup', stopEndpointColumnResize)
  event.preventDefault()
}

function resizeEndpointColumn(event: MouseEvent) {
  if (!endpointResizeState) return
  const next = [...endpointResizeState.widths]
  next[endpointResizeState.index] = Math.max(44, endpointResizeState.widths[endpointResizeState.index] + event.clientX - endpointResizeState.startX)
  endpointColumnWidths.value = next
}

function stopEndpointColumnResize() {
  if (!endpointResizeState) return
  window.removeEventListener('mousemove', resizeEndpointColumn)
  window.removeEventListener('mouseup', stopEndpointColumnResize)
  endpointResizeState = null
}

function sortEndpointRows(rows: NetworkEndpointSummary[]) {
  const direction = sortDirection.value === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sortKey.value)
    const bv = sortValue(b, sortKey.value)
    const aMissing = av === null || av === undefined || av === ''
    const bMissing = bv === null || bv === undefined || bv === ''
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return a.listenPort - b.listenPort
      return aMissing ? 1 : -1
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * direction
    }
    return String(av).localeCompare(String(bv)) * direction
  })
}

function sortValue(row: NetworkEndpointSummary, key: SortKey) {
  const values: Record<SortKey, string | number | null | undefined> = {
    pid: row.pid,
    process: row.processName || (row.permissionLimited ? '权限受限' : ''),
    source: sourceLabel(row),
    protocol: row.protocol,
    address: listenAddressLabel(row),
    port: row.hasListener === false ? null : row.listenPort,
    remoteIPs: row.uniqueRemoteIPCount,
    connections: row.connectionCount,
    uploaded: row.uploadedBytes ?? row.uploadedBytesEstimate,
    downloaded: row.downloadedBytes,
  }
  return values[key]
}

function networkInterfaceOptionLabel(value: string) {
  if (value === 'all') return '全部接口'
  if (value === 'physical') return '全部物理'
  if (value === 'docker') return 'Docker 网络'
  return value
}

function baseProtocol(protocol: string): ProtocolFilter {
  return protocol.startsWith('udp') ? 'udp' : 'tcp'
}

function protocolLabel(protocol: string) {
  return protocol.toUpperCase()
}

function processLabel(row: NetworkEndpointSummary) {
  if (row.processName) return row.processName
  return row.permissionLimited ? '权限受限' : '—'
}

function sourceLabel(row: NetworkEndpointSummary) {
  if ((row.sourceType ?? 'host') === 'docker') {
    return `Docker: ${row.containerName || row.sourceName || '容器'}`
  }
  return '宿主机'
}

function pidLabel(row: NetworkEndpointSummary) {
  if (row.pidLabel) return row.pidLabel
  return row.pid ? String(row.pid) : '—'
}

function listenAddressLabel(row: NetworkEndpointSummary) {
  return row.hasListener === false || row.rowKind === 'connection' ? '—' : row.listenAddress
}

function listenPortLabel(row: NetworkEndpointSummary) {
  return row.hasListener === false || row.rowKind === 'connection' ? '—' : String(row.listenPort)
}

function optionalNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : String(value)
}

function optionalBytes(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : formatBytes(value)
}

function uploadBytesLabel(row: NetworkEndpointSummary) {
  if (row.uploadedBytes !== null && row.uploadedBytes !== undefined) {
    return formatBytes(row.uploadedBytes)
  }
  if (row.uploadedBytesEstimate !== null && row.uploadedBytesEstimate !== undefined) {
    return `≈ ${formatBytes(row.uploadedBytesEstimate)}`
  }
  return '—'
}

function byteTitle(row: NetworkEndpointSummary) {
  if (row.uploadedBytesEstimated) {
    return '当前系统未提供 bytes_sent，累计上传使用 bytes_acked 近似值。'
  }
  return row.byteCountersPartial ? '部分连接未提供累计字节统计。' : ''
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}
</script>

<template>
  <div v-if="open" class="modal-backdrop network-details-backdrop" @click.self="closeDialog">
    <section class="modal network-details-modal" data-testid="network-details-dialog">
      <header class="network-details-commandbar">
        <h2>网络详情</h2>
        <label class="network-details-inline-field network-details-server-field">
          <span>服务器</span>
          <select v-model.number="selectedServerID" class="network-details-select network-details-server-select" :disabled="hasNoOnlineServer">
            <option :value="0">请选择服务器</option>
            <option v-for="connection in onlineConnections" :key="connection.id" :value="connection.id" :title="connection.name">
              {{ connection.name }}
            </option>
          </select>
        </label>
        <label class="network-details-inline-field network-details-interface-field">
          <span>接口</span>
          <select
            :value="interfaceSelectValue"
            class="network-details-select network-details-interface-select"
            :disabled="!selectedServerID"
            :title="interfaceHelpTitle"
            @change="updateNetworkInterface"
          >
            <option value="all" title="仅控制顶部流量曲线；连接表默认包含宿主机及可读取的 Docker 容器。">全部接口</option>
            <option value="physical" title="聚合非虚拟物理接口；仅影响曲线，不过滤连接表。">全部物理</option>
            <option value="docker" title="聚合 docker0、br-* 等容器网络接口；docker0 只代表默认 bridge 的曲线，不决定 Docker 连接表是否可见。">Docker 网络</option>
            <option v-for="item in interfaceRows" :key="item.name" :value="item.name" :title="item.displayName || item.name">
              {{ item.displayName || item.name }}
            </option>
          </select>
        </label>
        <nav class="network-details-tabs" aria-label="网络详情功能">
          <button type="button" class="command-light-action" :class="{ active: activeTab === 'endpoints' }" @click="switchTab('endpoints')">
            端口与连接
          </button>
          <span class="command-action-separator" aria-hidden="true">|</span>
          <button type="button" class="command-light-action" :class="{ active: activeTab === 'diagnostics' }" @click="switchTab('diagnostics')">
            网络诊断
          </button>
        </nav>
        <button type="button" class="secondary network-details-refresh" :disabled="!selectedServerID || snapshotBusy" @click="refreshSnapshot(true)">
          刷新
        </button>
        <label class="network-details-realtime">
          <input v-model="realtime" type="checkbox" :disabled="!selectedServerID" />
          实时刷新
        </label>
        <button type="button" class="secondary network-details-refresh" :disabled="!selectedServerID || loadingInterfaces" @click="loadInterfaces(false)">
          接口
        </button>
        <button type="button" class="dialog-close-button" @click="closeDialog">关闭</button>
      </header>

      <p v-if="hasNoOnlineServer" class="network-details-empty">请先连接并选择一台服务器。</p>

      <template v-else>
        <section class="network-details-overview">
          <div>
            <span>下载</span>
            <strong class="download">{{ formatRate(selectedSnapshot?.downloadBytesPerSecond ?? null) }}</strong>
          </div>
          <div>
            <span>上传</span>
            <strong class="upload">{{ formatRate(selectedSnapshot?.uploadBytesPerSecond ?? null) }}</strong>
          </div>
          <div>
            <span>当前接口</span>
            <strong :title="interfaceTitle">{{ interfaceTitle }}</strong>
          </div>
          <div>
            <span>监听端口</span>
            <strong>{{ snapshot?.listenerCount ?? snapshot?.totalListeners ?? '—' }}</strong>
          </div>
          <div title="当前 active socket 去重数量；接口选择不会改变该统计。">
            <span>当前连接</span>
            <strong>{{ optionalNumber(snapshot?.totalConnections ?? snapshot?.socketConnectionCount) }}</strong>
          </div>
          <div title="当前 active socket 对端 IP 去重数量；接口选择不会改变该统计。">
            <span>远程 IP</span>
            <strong>{{ optionalNumber(snapshot?.totalRemoteIPCount ?? snapshot?.socketRemoteIPCount ?? snapshot?.uniqueRemoteIPs) }}</strong>
          </div>
          <div title="可读取 Docker 容器 network namespace 中的 active socket 数；不依赖选择 docker0。">
            <span>Docker 连接</span>
            <strong>{{ optionalNumber(snapshot?.dockerAvailable ? snapshot?.dockerSocketConnectionCount : null) }}</strong>
          </div>
        </section>

        <section v-if="activeTab === 'endpoints'" class="network-details-endpoints network-endpoint-tab">
          <MiniSparkline class="network-details-chart" :series="[downloadHistory, uploadHistory]" :colors="['#2dd4bf', '#fb923c']" />
          <div class="network-details-filters">
            <input v-model="search" placeholder="搜索 程序 / PID / IP / 端口" />
            <select v-model="protocolFilter">
              <option value="all">全部协议</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
            <select v-model="stateFilter">
              <option value="all">全部状态</option>
              <option value="listening">监听中</option>
              <option value="connected">有连接</option>
            </select>
            <select v-model="sourceFilter">
              <option value="all">全部来源</option>
              <option value="host">宿主机</option>
              <option value="docker">Docker</option>
            </select>
          </div>
          <p v-if="endpointStatusMessage" class="network-details-warning" data-testid="network-details-warning">
            {{ endpointStatusMessage }}
          </p>

          <div class="network-endpoint-table" data-testid="network-endpoint-table" :style="{ '--endpoint-table-min-width': endpointTableMinWidth }">
            <div class="network-endpoint-row network-endpoint-head" :style="{ gridTemplateColumns: endpointGridTemplate }">
              <div
                v-for="(column, index) in endpointColumns"
                :key="column.key"
                class="network-endpoint-head-cell"
              >
                <button
                  type="button"
                  :title="column.title"
                  :aria-sort="ariaSort(column.key)"
                  @click="setSort(column.key)"
                >
                  <span>{{ column.label }}</span>
                  <span class="table-sort-arrow" aria-hidden="true">{{ sortArrow(column.key) }}</span>
                </button>
                <span
                  v-if="index < endpointColumns.length - 1"
                  class="table-column-resizer"
                  :data-testid="`network-endpoint-column-resizer-${index}`"
                  role="separator"
                  aria-orientation="vertical"
                  @mousedown.stop="startEndpointColumnResize(index, $event)"
                ></span>
              </div>
            </div>
            <div
              v-for="row in filteredRows"
              :key="row.rowID"
              class="network-endpoint-row"
              :class="[`is-${baseProtocol(row.protocol)}`, `row-kind-${row.rowKind || 'listener'}`, { approximate: row.aggregationApproximate }]"
              :style="{ gridTemplateColumns: endpointGridTemplate }"
            >
              <span>{{ pidLabel(row) }}</span>
              <strong :title="processLabel(row)">{{ processLabel(row) }}</strong>
              <span :title="sourceLabel(row)" class="network-endpoint-source">{{ sourceLabel(row) }}</span>
              <span>{{ protocolLabel(row.protocol) }}</span>
              <span :title="listenAddressLabel(row)">{{ listenAddressLabel(row) }}</span>
              <span>{{ listenPortLabel(row) }}</span>
              <span>{{ optionalNumber(row.uniqueRemoteIPCount) }}</span>
              <span>{{ optionalNumber(row.connectionCount) }}</span>
              <span class="upload" :title="byteTitle(row)">{{ uploadBytesLabel(row) }}</span>
              <span class="download" :title="byteTitle(row)">{{ optionalBytes(row.downloadedBytes) }}</span>
            </div>
            <p v-if="!snapshotBusy && filteredRows.length === 0" class="network-details-empty">暂无端口或连接数据。</p>
            <p v-if="loadingSnapshot" class="network-details-empty">正在读取端口与连接信息...</p>
          </div>
        </section>

        <NetworkDiagnosticsPanel
          v-else
          ref="diagnosticPanel"
          :server-id="selectedServerID"
          :active="activeTab === 'diagnostics'"
          @notify="(message, type) => emit('notify', message, type)"
        />
      </template>
    </section>
  </div>
</template>
