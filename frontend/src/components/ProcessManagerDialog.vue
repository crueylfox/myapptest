<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, ref, watch } from 'vue'
import { confirmDialog } from '../composables/useAppDialog'
import { useProcessStore } from '../stores/processes'
import type { Connection, ProcessDetail, ProcessEntry, ProcessSignal, ProcessSortBy, ProcessSortDir } from '../types'
import { formatBytes } from '../utils/format'

type ProcessTableColumn = {
  key: ProcessSortBy | 'state'
  label: string
  numeric?: boolean
  sortable?: boolean
}

const props = defineProps<{
  open: boolean
  connections: Connection[]
  activeServerId: number | null
  initialPid?: number | null
}>()

const emit = defineEmits<{
  close: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const processStore = useProcessStore()
const selectedServerID = ref(0)
const selectedPid = ref<number | null>(null)
const query = ref('')
const sortBy = ref<ProcessSortBy>('cpu')
const sortDir = ref<ProcessSortDir>('desc')
const realtime = ref(false)
const loading = ref(false)
const detailLoading = ref(false)
const signalBusy = ref(false)
const cmdlineExpanded = ref(false)
const renderError = ref('')
const lastRefreshMs = ref<number | null>(null)
const processColumns: ProcessTableColumn[] = [
  { key: 'pid', label: 'PID', sortable: true },
  { key: 'user', label: '用户', sortable: true },
  { key: 'cpu', label: 'CPU', numeric: true, sortable: true },
  { key: 'memory', label: '内存', numeric: true, sortable: true },
  { key: 'state', label: '状态' },
  { key: 'command', label: '命令', sortable: true },
]
const processColumnWidths = ref([72, 96, 80, 88, 96, 150])
const processGridTemplate = computed(() => processColumnWidths.value.map((width) => `${width}px`).join(' '))
let searchTimer: number | undefined
let refreshSerial = 0
let detailSerial = 0
let processResizeState: { index: number; startX: number; widths: number[] } | null = null

const selectedConnection = computed(() =>
  props.connections.find((connection) => connection.id === selectedServerID.value) ?? null)
const rawProcesses = computed(() => safeProcessList(processStore.list(selectedServerID.value)))
const processes = computed(() =>
  sortProcesses(filterProcesses(rawProcesses.value, query.value), sortBy.value, sortDir.value))
const warnings = computed(() => processStore.warnings(selectedServerID.value))
const listError = computed(() => processStore.listError(selectedServerID.value))
const listLoaded = computed(() => processStore.hasLoadedList(selectedServerID.value))
const selectedProcess = computed(() =>
  rawProcesses.value.find((process) => process.pid === selectedPid.value) ?? null)
const selectedDetail = computed(() => {
  const process = selectedProcess.value
  if (!process || !selectedPid.value) return null
  return mergeDetailForDisplay(process, processStore.detail(selectedServerID.value, selectedPid.value))
})
const selectedDetailChildren = computed(() => safeProcessList(selectedDetail.value?.children))
const selectedDetailWarnings = computed(() => safeStringList(selectedDetail.value?.warnings))
const selectedDetailParent = computed(() => selectedDetail.value?.parent ?? null)
const selectedMissing = computed(() =>
  Boolean(selectedPid.value) && !loading.value && !selectedProcess.value)
const listStatusText = computed(() => {
  if (loading.value && rawProcesses.value.length === 0) return '正在读取进程列表...'
  if (listError.value && rawProcesses.value.length === 0) return '读取进程列表失败，请点击刷新重试'
  if (listError.value) return '读取进程列表失败'
  if (listLoaded.value && processes.value.length === 0) return '未找到匹配进程。'
  return ''
})
const signalDisabledReason = computed(() => {
  const process = selectedDetail.value ?? selectedProcess.value
  if (!process) return '请选择进程'
  if (process.pid === 1) return 'PID 1 是系统 init 进程，禁止操作'
  if (process.isKernelThread) return '内核线程不能发送信号'
  if (!process.canSignal) return '当前进程不可发送信号'
  return ''
})
const refreshStatusText = computed(() => {
  if (loading.value) return '刷新中...'
  return lastRefreshMs.value === null ? '' : `上次刷新 ${formatDuration(lastRefreshMs.value)}`
})

onErrorCaptured(() => {
  renderError.value = '进程管理显示异常，请刷新重试'
  return false
})

watch(() => props.open, async (open) => {
  if (!open) {
    refreshSerial++
    detailSerial++
    await stopRealtime()
    return
  }
  selectedServerID.value = props.activeServerId || props.connections[0]?.id || 0
  selectedPid.value = props.initialPid ?? null
  query.value = ''
  cmdlineExpanded.value = false
  renderError.value = ''
  if (selectedServerID.value) await refreshProcesses(true)
}, { immediate: true })

watch(() => props.initialPid, async (pid) => {
  if (!props.open || !pid) return
  selectedPid.value = pid
  await loadDetail(pid)
})

watch(selectedServerID, async (serverID, previous) => {
  if (!props.open) return
  if (!previous) return
  if (previous) await processStore.stopWatch(previous)
  realtime.value = false
  selectedPid.value = null
  query.value = ''
  cmdlineExpanded.value = false
  if (serverID) await refreshProcesses(true)
})

watch(query, () => {
  if (!props.open || !selectedServerID.value) return
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void refreshProcesses(false)
    if (realtime.value) void restartRealtime()
  }, 250)
})

onBeforeUnmount(() => {
  stopProcessColumnResize()
  refreshSerial++
  detailSerial++
  if (searchTimer) window.clearTimeout(searchTimer)
  if (selectedServerID.value) void processStore.stopWatch(selectedServerID.value)
})

async function closeDialog() {
  await stopRealtime()
  emit('close')
}

async function refreshProcesses(selectInitial = false) {
  if (!selectedServerID.value) return
  if (loading.value) return
  const serial = ++refreshSerial
  loading.value = true
  const startedAt = Date.now()
  try {
    const response = await processStore.refresh(request())
    if (!props.open || serial !== refreshSerial) return
    lastRefreshMs.value = Date.now() - startedAt
    const rows = sortProcesses(filterProcesses(safeProcessList(response.processes), query.value), sortBy.value, sortDir.value)
    if (selectedPid.value) {
      const current = rows.find((process) => process.pid === selectedPid.value)
      if (current) {
        processStore.seedDetailFromEntry(selectedServerID.value, current)
        await loadDetail(selectedPid.value)
      } else {
        detailSerial++
        detailLoading.value = false
      }
    } else if ((selectInitial || !selectedPid.value) && rows.length) {
      await selectProcess(rows[0])
    }
  } catch (reason) {
    if (!props.open || serial !== refreshSerial) return
    emit('notify', '读取进程列表失败', 'error')
  } finally {
    if (serial === refreshSerial) loading.value = false
  }
}

async function selectProcess(process: ProcessEntry) {
  selectedPid.value = process.pid
  cmdlineExpanded.value = false
  if (selectedServerID.value) processStore.seedDetailFromEntry(selectedServerID.value, process)
  await loadDetail(process.pid)
}

async function loadDetail(pid: number) {
  if (!selectedServerID.value) return
  if (!rawProcesses.value.some((process) => process.pid === pid)) return
  const serial = ++detailSerial
  detailLoading.value = true
  try {
    await processStore.loadDetail(selectedServerID.value, pid)
  } catch (reason) {
    if (!props.open || serial !== detailSerial) return
    emit('notify', errorMessage(reason, '读取进程详情失败'), 'error')
  } finally {
    if (serial === detailSerial) detailLoading.value = false
  }
}

async function toggleRealtime() {
  if (!selectedServerID.value) return
  if (realtime.value) await stopRealtime()
  else await startRealtime()
}

async function startRealtime() {
  if (!selectedServerID.value) return
  try {
    await processStore.startWatch({ ...request(), intervalMs: 2000 })
    realtime.value = true
    emit('notify', '进程列表实时刷新已开启。', 'info')
  } catch (reason) {
    realtime.value = false
    emit('notify', errorMessage(reason, '开启实时刷新失败'), 'error')
  }
}

async function restartRealtime() {
  if (!realtime.value || !selectedServerID.value) return
  try {
    await processStore.startWatch({ ...request(), intervalMs: 2000 })
  } catch (reason) {
    realtime.value = false
    emit('notify', errorMessage(reason, '更新实时刷新失败'), 'error')
  }
}

async function stopRealtime() {
  if (!selectedServerID.value) return
  try {
    await processStore.stopWatch(selectedServerID.value)
  } finally {
    realtime.value = false
  }
}

async function sendSignal(signalName: ProcessSignal) {
  const process = selectedDetail.value ?? selectedProcess.value
  if (!selectedServerID.value || !process || signalDisabledReason.value) return
  const isKill = signalName === 'kill'
  const confirmed = await confirmDialog({
    title: isKill ? '强制结束进程' : '终止进程',
    message: isKill
      ? `强制结束进程可能导致数据丢失，确定向 PID ${process.pid}（${process.command}）发送 SIGKILL 吗？`
      : `确定向进程 PID ${process.pid}（${process.command}）发送 SIGTERM 吗？`,
    confirmText: isKill ? '强制结束' : '终止进程',
    danger: true,
  })
  if (!confirmed) return
  signalBusy.value = true
  try {
    const response = await processStore.signal(selectedServerID.value, process.pid, signalName, process.command)
    emit('notify', response.message || '进程操作已完成。', 'success')
    await refreshProcesses(false)
  } catch (reason) {
    emit('notify', errorMessage(reason, isKill ? '强制结束进程失败' : '终止进程失败'), 'error')
  } finally {
    signalBusy.value = false
  }
}

function toggleSort(field: ProcessSortBy) {
  if (sortBy.value === field) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    return
  }
  sortBy.value = field
  sortDir.value = 'desc'
}

function sortArrow(field: ProcessSortBy) {
  if (sortBy.value !== field) return ''
  return sortDir.value === 'desc' ? '↓' : '↑'
}

function ariaSort(field: ProcessSortBy) {
  if (sortBy.value !== field) return 'none'
  return sortDir.value === 'desc' ? 'descending' : 'ascending'
}

function startProcessColumnResize(index: number, event: MouseEvent) {
  processResizeState = { index, startX: event.clientX, widths: [...processColumnWidths.value] }
  window.addEventListener('mousemove', resizeProcessColumn)
  window.addEventListener('mouseup', stopProcessColumnResize)
  event.preventDefault()
}

function resizeProcessColumn(event: MouseEvent) {
  if (!processResizeState) return
  const next = [...processResizeState.widths]
  next[processResizeState.index] = Math.max(52, processResizeState.widths[processResizeState.index] + event.clientX - processResizeState.startX)
  processColumnWidths.value = next
}

function stopProcessColumnResize() {
  if (!processResizeState) return
  window.removeEventListener('mousemove', resizeProcessColumn)
  window.removeEventListener('mouseup', stopProcessColumnResize)
  processResizeState = null
}

function request() {
  return {
    serverID: selectedServerID.value,
    query: query.value,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
    limit: 500,
  }
}

function percent(value: unknown) {
  return `${safeNumber(value).toFixed(1)}%`
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—'
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

function bytes(value: unknown) {
  const parsed = safeNumber(value, Number.NaN)
  return Number.isFinite(parsed) && parsed >= 0 ? formatBytes(parsed) : '—'
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

function mergeDetailForDisplay(process: ProcessEntry, detail: ProcessDetail | null): ProcessDetail {
  return {
    serverID: process.serverID,
    pid: process.pid,
    ppid: process.ppid,
    user: process.user,
    state: process.state,
    stateLabel: process.stateLabel,
    command: process.command,
    cmdline: detail?.cmdline || process.argsPreview,
    cwd: detail?.cwd,
    exe: detail?.exe,
    openFilesCount: detail?.openFilesCount,
    threads: detail?.threads,
    rssBytes: process.rssBytes || detail?.rssBytes || 0,
    vszBytes: process.vszBytes || detail?.vszBytes || 0,
    memoryPercent: process.memoryPercent || detail?.memoryPercent || 0,
    cpuPercent: process.cpuPercent || detail?.cpuPercent || 0,
    environmentRedacted: detail?.environmentRedacted !== false,
    children: safeProcessList(detail?.children),
    parent: detail?.parent,
    lastUpdatedAt: detail?.lastUpdatedAt || '',
    warnings: safeStringList(detail?.warnings),
    isKernelThread: process.isKernelThread,
    canSignal: process.canSignal,
  }
}

function filterProcesses(items: ProcessEntry[], value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return items
  return items.filter((process) =>
    String(process.pid).includes(normalized) ||
    process.user.toLowerCase().includes(normalized) ||
    process.command.toLowerCase().includes(normalized) ||
    process.argsPreview.toLowerCase().includes(normalized))
}

function sortProcesses(items: ProcessEntry[], field: ProcessSortBy, direction: ProcessSortDir) {
  const rows = [...items]
  const desc = direction !== 'asc'
  rows.sort((left, right) => {
    const result = compareProcess(left, right, field)
    return desc ? -result : result
  })
  return rows
}

function compareProcess(left: ProcessEntry, right: ProcessEntry, field: ProcessSortBy) {
  switch (field) {
    case 'memory':
      return numericCompare(left.memoryPercent, right.memoryPercent, left.pid, right.pid)
    case 'pid':
      return numericCompare(left.pid, right.pid, left.pid, right.pid)
    case 'user':
      return textCompare(left.user, right.user, left.pid, right.pid)
    case 'command':
      return textCompare(left.command, right.command, left.pid, right.pid)
    case 'cpu':
    default:
      return numericCompare(left.cpuPercent, right.cpuPercent, left.pid, right.pid)
  }
}

function numericCompare(left: unknown, right: unknown, leftPid: number, rightPid: number) {
  const diff = safeNumber(left) - safeNumber(right)
  return diff === 0 ? leftPid - rightPid : diff
}

function textCompare(left: unknown, right: unknown, leftPid: number, rightPid: number) {
  const diff = safeString(left).localeCompare(safeString(right), 'zh-Hans-CN')
  return diff === 0 ? leftPid - rightPid : diff
}

function safeProcessList(value: unknown): ProcessEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeProcessEntry(item))
    .filter((item): item is ProcessEntry => Boolean(item))
}

function normalizeProcessEntry(value: unknown): ProcessEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const pid = Math.trunc(safeNumber(source.pid))
  if (pid <= 0) return null
  return {
    serverID: Math.trunc(safeNumber(source.serverID)),
    pid,
    ppid: Math.trunc(safeNumber(source.ppid)),
    user: safeString(source.user),
    state: safeString(source.state),
    stateLabel: safeString(source.stateLabel),
    cpuPercent: safeNumber(source.cpuPercent),
    memoryPercent: safeNumber(source.memoryPercent),
    rssBytes: safeNumber(source.rssBytes),
    vszBytes: safeNumber(source.vszBytes),
    command: safeString(source.command) || `PID ${pid}`,
    argsPreview: safeString(source.argsPreview),
    startedOrElapsed: safeString(source.startedOrElapsed),
    isKernelThread: source.isKernelThread === true,
    canSignal: source.canSignal === true,
  }
}

function safeNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(/%$/, ''))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(safeString).filter(Boolean)
}
</script>

<template>
  <div v-if="open" class="process-dialog-backdrop" data-testid="process-manager-dialog">
    <section class="process-dialog" role="dialog" aria-modal="true" aria-label="进程管理">
      <header class="process-dialog-header">
        <div>
          <h2>进程管理</h2>
          <p>通过独立 SSH exec 读取进程列表和执行受保护的进程信号操作。</p>
        </div>
        <button class="dialog-close-button" type="button" @click="closeDialog">关闭</button>
      </header>

      <p v-if="renderError" class="process-error-state">{{ renderError }}</p>

      <div v-else class="process-toolbar">
        <label class="process-server-select">
          当前服务器
          <select v-model.number="selectedServerID" aria-label="选择服务器">
            <option :value="0">请选择服务器</option>
            <option v-for="connection in connections" :key="connection.id" :value="connection.id">
              {{ connection.name }}
            </option>
          </select>
        </label>
        <label class="process-search">
          搜索
          <input v-model="query" placeholder="搜索 PID / 用户 / 命令" />
        </label>
        <div class="process-toolbar-actions">
          <button class="secondary" :disabled="!selectedServerID || loading" @click="refreshProcesses(false)">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
          <button class="secondary" :class="{ active: realtime }" :disabled="!selectedServerID" @click="toggleRealtime">
            {{ realtime ? '关闭实时刷新' : '实时刷新' }}
          </button>
          <span v-if="refreshStatusText" class="process-refresh-status">{{ refreshStatusText }}</span>
        </div>
      </div>

      <p v-if="!renderError && !selectedConnection" class="process-empty">请先连接并选择一个服务器。</p>
      <div v-else-if="!renderError" class="process-body">
        <section class="process-list-panel">
          <div v-if="warnings.length" class="process-warning">
            <span v-for="warning in warnings" :key="warning">{{ warning }}</span>
          </div>
          <div class="process-table" role="table" aria-label="进程列表">
            <div class="process-table-head-shell">
              <div class="process-table-head" role="row" :style="{ gridTemplateColumns: processGridTemplate }">
                <div
                  v-for="(column, index) in processColumns"
                  :key="column.key"
                  class="process-table-head-cell"
                  :class="{ numeric: column.numeric }"
                  role="columnheader"
                >
                  <button
                    v-if="column.sortable"
                    type="button"
                    :class="{ numeric: column.numeric }"
                    :aria-sort="ariaSort(column.key as ProcessSortBy)"
                    @click="toggleSort(column.key as ProcessSortBy)"
                  >
                    <span>{{ column.label }}</span>
                    <span class="table-sort-arrow" aria-hidden="true">{{ sortArrow(column.key as ProcessSortBy) }}</span>
                  </button>
                  <span v-else>{{ column.label }}</span>
                  <span
                    v-if="index < processColumns.length - 1"
                    class="table-column-resizer"
                    :data-testid="`process-column-resizer-${index}`"
                    role="separator"
                    aria-orientation="vertical"
                    @mousedown.stop="startProcessColumnResize(index, $event)"
                  ></span>
                </div>
              </div>
            </div>
            <button
              v-for="process in processes"
              :key="process.pid"
              class="process-table-row"
              :class="{ selected: process.pid === selectedPid }"
              :title="process.argsPreview"
              role="row"
              :style="{ gridTemplateColumns: processGridTemplate }"
              @click="selectProcess(process)"
            >
              <span>{{ process.pid }}</span>
              <span>{{ process.user || '未知' }}</span>
              <span class="numeric">{{ percent(process.cpuPercent) }}</span>
              <span class="numeric">{{ percent(process.memoryPercent) }}</span>
              <span>{{ process.stateLabel || process.state || '未知' }}</span>
              <strong>{{ process.command || `PID ${process.pid}` }}</strong>
            </button>
            <p
              v-if="listStatusText"
              class="process-empty"
              :class="{ 'process-error-inline': Boolean(listError) }"
            >{{ listStatusText }}</p>
          </div>
        </section>

        <aside class="process-detail-panel">
          <p v-if="selectedMissing" class="process-warning">进程已退出或无法读取。</p>
          <p v-else-if="!selectedPid" class="process-empty">请选择一个进程查看详情。</p>
          <template v-else-if="selectedDetail">
            <header class="process-detail-header">
              <div class="process-detail-heading">
                <div class="process-detail-title">
                  <span class="process-state">{{ selectedDetail.stateLabel || selectedDetail.state || '未知' }}</span>
                  <h3>{{ selectedDetail.command || `PID ${selectedDetail.pid}` }}</h3>
                </div>
                <small>PID {{ selectedDetail.pid }} / PPID {{ selectedDetail.ppid }}</small>
              </div>
              <div class="process-actions process-detail-actions">
                <button class="danger" :disabled="Boolean(signalDisabledReason) || signalBusy" @click="sendSignal('term')">
                  终止进程
                </button>
                <button class="danger ghost" :disabled="Boolean(signalDisabledReason) || signalBusy" @click="sendSignal('kill')">
                  强制结束
                </button>
              </div>
            </header>
            <p v-if="signalDisabledReason" class="process-warning">{{ signalDisabledReason }}</p>
            <dl class="process-facts">
              <div><dt>用户</dt><dd>{{ selectedDetail.user || '未知' }}</dd></div>
              <div><dt>CPU</dt><dd>{{ percent(selectedDetail.cpuPercent) }}</dd></div>
              <div><dt>内存</dt><dd>{{ percent(selectedDetail.memoryPercent) }}</dd></div>
              <div><dt>RSS</dt><dd>{{ bytes(selectedDetail.rssBytes) }}</dd></div>
              <div><dt>VSZ</dt><dd>{{ bytes(selectedDetail.vszBytes) }}</dd></div>
              <div><dt>线程</dt><dd>{{ selectedDetail.threads ?? '未知' }}</dd></div>
              <div><dt>打开文件</dt><dd>{{ selectedDetail.openFilesCount ?? '未知' }}</dd></div>
              <div><dt>子进程</dt><dd>{{ selectedDetailChildren.length }}</dd></div>
              <div><dt>环境变量</dt><dd>{{ selectedDetail.environmentRedacted ? '已隐藏' : '未读取' }}</dd></div>
            </dl>
            <div v-if="selectedDetailWarnings.length" class="process-warning">
              <span v-for="warning in selectedDetailWarnings" :key="warning">{{ warning }}</span>
            </div>
            <section class="process-paths">
              <p><strong>CWD</strong><span>{{ selectedDetail.cwd || '不可读取' }}</span></p>
              <p><strong>EXE</strong><span>{{ selectedDetail.exe || '不可读取' }}</span></p>
            </section>
            <section class="process-cmdline">
              <button class="text-button" @click="cmdlineExpanded = !cmdlineExpanded">
                {{ cmdlineExpanded ? '收起命令行' : '展开命令行' }}
              </button>
              <pre v-if="cmdlineExpanded">{{ selectedDetail.cmdline || '命令行不可读取或为空。' }}</pre>
            </section>
            <p v-if="detailLoading" class="process-loading">正在补充详情...</p>
            <section v-if="selectedDetailParent || selectedDetailChildren.length" class="process-relations">
              <p v-if="selectedDetailParent">
                父进程：PID {{ selectedDetailParent.pid }} / {{ selectedDetailParent.command }}
              </p>
              <p v-if="selectedDetailChildren.length">
                子进程：{{ selectedDetailChildren.map((child) => `${child.pid}:${child.command}`).join('，') }}
              </p>
            </section>
          </template>
          <p v-else class="process-empty">{{ detailLoading ? '正在读取详情...' : '进程详情不可用。' }}</p>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.process-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: var(--glass-backdrop-bg);
  transform: translateZ(0);
}

.process-dialog {
  width: min(1180px, calc(100vw - 48px));
  height: min(760px, calc(100vh - 56px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  background: var(--glass-surface-bg);
  box-shadow: var(--glass-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  overflow: hidden;
}

.process-dialog-header,
.process-toolbar {
  display: flex;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-header-bg);
}

.process-dialog-header {
  align-items: center;
  justify-content: space-between;
}

.process-dialog-header h2,
.process-dialog-header p {
  margin: 0;
}

.process-dialog-header p {
  color: var(--muted);
}

.process-toolbar {
  align-items: flex-end;
  flex-wrap: wrap;
}

.process-toolbar label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.process-toolbar select,
.process-toolbar input {
  min-width: 120px;
}

.process-server-select {
  flex: 0 1 260px;
  max-width: 320px;
}

.process-search {
  flex: 0 1 300px;
  min-width: 220px;
  max-width: 340px;
}

.process-search input {
  width: 100%;
}

.process-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
}

.process-toolbar-actions button {
  min-height: 34px;
}

.process-refresh-status {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.process-error-state {
  margin: 16px 18px;
  padding: 12px 14px;
  border: 1px solid rgba(248, 113, 113, 0.36);
  border-radius: 14px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.28);
}

.process-body {
  display: grid;
  grid-template-columns: minmax(460px, 1.2fr) minmax(320px, 0.8fr);
  min-height: 0;
  background: var(--glass-panel-bg);
}

.process-list-panel,
.process-detail-panel {
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.process-detail-panel {
  border-left: 1px solid var(--glass-border);
  padding: 12px;
}

.process-warning {
  display: grid;
  gap: 4px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  border-radius: 12px;
  color: #fde68a;
  background: rgba(251, 191, 36, 0.08);
}

.process-empty {
  margin: 18px;
  color: var(--muted);
}

.process-error-inline {
  color: #fecaca;
}

.process-loading {
  margin: 10px 0;
  color: var(--muted);
  font-size: 12px;
}

.process-table {
  display: grid;
  gap: 6px;
}

.process-table-head,
.process-table-row {
  display: grid;
  grid-template-columns: 72px minmax(72px, 0.7fr) 72px 72px 84px minmax(140px, 1.5fr);
  align-items: center;
  gap: 10px;
}

.process-table-head-shell {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  overflow: hidden;
  background: var(--glass-card-bg);
}

.process-table-head {
  padding: 6px 12px;
  color: var(--muted);
  font-size: 12px;
}

.process-table-head-cell {
  position: relative;
  min-width: 0;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-right: 8px;
}

.process-table-head-cell > span:not(.table-column-resizer) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-table-head-cell.numeric {
  justify-content: center;
}

.process-table-head button {
  min-width: 0;
  width: 100%;
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: inherit;
  background: transparent;
  text-align: center;
  font: inherit;
  cursor: pointer;
}

.process-table-head button.numeric {
  justify-content: center;
  text-align: center;
}

.process-table-head button:hover {
  color: var(--text);
  background: rgba(148, 163, 184, 0.1);
}

.table-sort-arrow {
  flex: 0 0 auto;
  color: #9ec0ff;
  font-size: 11px;
}

.table-column-resizer {
  position: absolute;
  top: 2px;
  right: -5px;
  z-index: 2;
  width: 10px;
  height: calc(100% - 4px);
  cursor: col-resize;
}

.table-column-resizer::before {
  content: "";
  display: block;
  width: 1px;
  height: 100%;
  margin: 0 auto;
  background: rgba(148, 163, 184, 0.36);
}

.table-column-resizer:hover::before {
  background: #60a5fa;
}

.process-table-row {
  width: 100%;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  color: inherit;
  background: var(--glass-card-bg);
  text-align: left;
}

.process-table-row:hover,
.process-table-row.selected {
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(37, 99, 235, 0.16);
}

.process-table-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-table-row .numeric {
  text-align: left;
}

.numeric {
  font-variant-numeric: tabular-nums;
}

.process-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.process-detail-heading {
  flex: 1 1 auto;
  display: grid;
  gap: 3px;
  min-width: 0;
}

.process-detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.process-detail-title h3,
.process-detail-heading small {
  margin: 0;
}

.process-detail-title h3 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-detail-heading small {
  color: var(--muted);
}

.process-state {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
  font-size: 12px;
}

.process-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin: 10px 0;
}

.process-facts div,
.process-paths p,
.process-relations p {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.65);
}

.process-facts dt {
  color: var(--muted);
  font-size: 12px;
}

.process-facts dd {
  margin: 2px 0 0;
  font-size: 13px;
}

.process-paths,
.process-relations {
  display: grid;
  gap: 6px;
  margin: 8px 0;
}

.process-paths p {
  display: grid;
  gap: 4px;
}

.process-paths span {
  overflow-wrap: anywhere;
  color: var(--muted);
}

.process-cmdline pre {
  max-height: 120px;
  overflow: auto;
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.72);
  white-space: pre-wrap;
  word-break: break-word;
}

.process-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.process-detail-actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}

.process-detail-actions button {
  min-height: 32px;
  padding: 6px 10px;
}

.ghost {
  background: transparent;
}

@media (max-width: 900px) {
  .process-dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .process-body {
    grid-template-columns: 1fr;
  }

  .process-detail-panel {
    border-left: 0;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
  }
}
</style>
