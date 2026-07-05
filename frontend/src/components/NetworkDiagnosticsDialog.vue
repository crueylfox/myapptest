<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useServerStore } from '../stores/server'
import type {
  Connection,
  MonitorNetworkInterfaceMode,
  NetworkDiagnosticStatus,
  NetworkDiagnosticType,
} from '../types'

type NetworkDiagnosticDisplayStatus = NetworkDiagnosticStatus | 'idle'

const props = defineProps<{
  open: boolean
  connections: Connection[]
  activeServerId: number | null
}>()

const emit = defineEmits<{
  close: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const store = useServerStore()
const diagnosticTypes: NetworkDiagnosticType[] = ['ping', 'traceroute', 'dns', 'tcp']
const selectedServerID = ref(0)
const diagnosticType = ref<NetworkDiagnosticType>('ping')
const target = ref('8.8.8.8')
const portText = ref('80')
const activeTaskID = ref('')
const loadingInterfaces = ref(false)
const starting = ref(false)
const canceling = ref(false)
const outputRef = ref<HTMLElement | null>(null)
const followOutput = ref(true)

const selectedConnection = computed(() =>
  props.connections.find((connection) => connection.id === selectedServerID.value) ?? null)
const selectedConnectionTitle = computed(() =>
  selectedConnection.value
    ? `${selectedConnection.value.name} · ${selectedConnection.value.username}@${selectedConnection.value.host}:${selectedConnection.value.port}`
    : '请选择服务器')
const interfaceRows = computed(() => store.networkInterfaces[selectedServerID.value] ?? [])
const preference = computed(() => store.networkInterfacePreferences[selectedServerID.value] ?? null)
const tasks = computed(() => store.diagnosticTasks[selectedServerID.value] ?? [])
const activeTask = computed(() =>
  tasks.value.find((task) => task.taskID === activeTaskID.value) ?? null)
const outputLines = computed(() =>
  activeTaskID.value ? store.diagnosticOutput[activeTaskID.value] ?? [] : [])
const outputText = computed(() => outputLines.value.join('\n'))
const activeTaskStatus = computed<NetworkDiagnosticDisplayStatus>(() => activeTask.value?.status ?? 'idle')
const activeTaskStatusText = computed(() =>
  taskStatusLabel(activeTaskStatus.value))
const interfaceSelectValue = computed(() => {
  if (preference.value?.mode === 'interface' && preference.value.selectedNetworkInterface) {
    return preference.value.selectedNetworkInterface
  }
  if (preference.value?.mode === 'physical' || preference.value?.mode === 'docker') {
    return preference.value.mode
  }
  return 'all'
})
const interfaceSelectTitle = computed(() =>
  networkInterfaceOptionLabel(interfaceSelectValue.value))
const canCancel = computed(() => Boolean(activeTask.value && activeTask.value.status === 'running'))

watch(() => props.open, async (open) => {
  if (!open) return
  selectedServerID.value = props.activeServerId ?? props.connections[0]?.id ?? 0
  activeTaskID.value = ''
  await loadServerState()
}, { immediate: true })

watch(selectedServerID, async () => {
  if (!props.open) return
  activeTaskID.value = ''
  await loadServerState()
})

watch(activeTaskID, () => {
  followOutput.value = true
  void scrollOutputToBottom()
})

watch(outputLines, () => {
  if (followOutput.value) void scrollOutputToBottom()
})

async function loadServerState() {
  if (!selectedServerID.value) return
  try {
    await store.loadNetworkInterfacePreference(selectedServerID.value)
  } catch (reason) {
    emit('notify', errorMessage(reason, '读取网络接口偏好失败'), 'error')
  }
  await Promise.allSettled([
    store.loadNetworkDiagnosticTasks(selectedServerID.value).then((rows) => {
      activeTaskID.value = rows.find((task) => task.status === 'running')?.taskID ?? rows[0]?.taskID ?? ''
    }).catch((reason) => {
      emit('notify', errorMessage(reason, '读取网络诊断任务失败'), 'error')
    }),
    refreshInterfaces(true),
  ])
}

async function refreshInterfaces(silent = false) {
  if (!selectedServerID.value) return
  loadingInterfaces.value = true
  try {
    await store.loadNetworkInterfaces(selectedServerID.value)
    if (!silent) emit('notify', '网络接口已刷新', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '刷新网络接口失败'), 'error')
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

function networkInterfaceOptionLabel(value: string) {
  if (value === 'all') return '全部接口'
  if (value === 'physical') return '全部物理'
  if (value === 'docker') return 'Docker 网络'
  return value
}

function selectType(type: NetworkDiagnosticType) {
  const previousDefault = defaultTarget(diagnosticType.value)
  diagnosticType.value = type
  if (!target.value.trim() || target.value.trim() === previousDefault) {
    target.value = defaultTarget(type)
  }
}

async function startDiagnostic() {
  if (!selectedServerID.value) {
    emit('notify', '请选择服务器', 'error')
    return
  }
  const normalizedTarget = target.value.trim()
  if (!normalizedTarget) {
    emit('notify', '请输入诊断目标', 'error')
    return
  }
  const request = {
    serverID: selectedServerID.value,
    type: diagnosticType.value,
    target: normalizedTarget,
    ...(diagnosticType.value === 'tcp' ? { port: normalizedPort() } : {}),
  }
  if (diagnosticType.value === 'tcp' && !request.port) return
  starting.value = true
  try {
    const task = await store.startNetworkDiagnostic(request)
    activeTaskID.value = task.taskID
    emit('notify', '网络诊断已启动', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '启动网络诊断失败'), 'error')
  } finally {
    starting.value = false
  }
}

async function cancelDiagnostic() {
  if (!selectedServerID.value || !activeTaskID.value) return
  canceling.value = true
  try {
    await store.cancelNetworkDiagnostic(selectedServerID.value, activeTaskID.value)
    emit('notify', '已请求取消诊断任务', 'info')
  } catch (reason) {
    emit('notify', errorMessage(reason, '取消网络诊断失败'), 'error')
  } finally {
    canceling.value = false
  }
}

function clearOutput() {
  if (activeTaskID.value) store.clearNetworkDiagnosticOutput(activeTaskID.value)
  followOutput.value = true
}

async function copyOutput() {
  if (!outputText.value) return
  try {
    await navigator.clipboard.writeText(outputText.value)
    emit('notify', '诊断输出已复制', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '复制诊断输出失败'), 'error')
  }
}

async function closeDialog() {
  const runningTasks = selectedServerID.value
    ? (store.diagnosticTasks[selectedServerID.value] ?? []).filter((task) => task.status === 'running')
    : []
  for (const task of runningTasks) {
    store.ignoreNetworkDiagnosticOutput(task.taskID)
  }
  emit('close')
  await Promise.allSettled(runningTasks.map((task) =>
    store.cancelNetworkDiagnostic(task.serverID, task.taskID).catch((reason) => {
      console.debug('Network diagnostic close cancel failed:', errorMessage(reason, 'cancel failed'))
    })))
}

function normalizedPort() {
  const value = Number(portText.value)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    emit('notify', 'TCP 端口必须是 1-65535 的整数', 'error')
    return 0
  }
  return value
}

function defaultTarget(type: NetworkDiagnosticType) {
  if (type === 'ping') return '8.8.8.8'
  if (type === 'tcp') return '192.168.0.1'
  return 'baidu.com'
}

function typeLabel(type: NetworkDiagnosticType) {
  return {
    ping: 'Ping',
    traceroute: 'Traceroute',
    dns: 'DNS',
    tcp: 'TCP',
  }[type]
}

function taskStatusLabel(status: NetworkDiagnosticDisplayStatus) {
  const labels: Record<NetworkDiagnosticDisplayStatus, string> = {
    idle: '暂无任务',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
  }
  return labels[status]
}

function connectionTitle(connection: Connection) {
  return `${connection.name} · ${connection.username}@${connection.host}:${connection.port}`
}

function handleOutputScroll() {
  const element = outputRef.value
  if (!element) return
  followOutput.value = element.scrollHeight - element.scrollTop - element.clientHeight < 24
}

async function scrollOutputToBottom() {
  await nextTick()
  const element = outputRef.value
  if (!element) return
  element.scrollTop = element.scrollHeight
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}
</script>

<template>
  <div v-if="open" class="modal-backdrop network-diagnostics-backdrop" @click.self="closeDialog">
    <section class="modal network-diagnostics-modal" data-testid="network-diagnostics-dialog">
      <header>
        <div>
          <h2>网络诊断</h2>
          <small>{{ selectedConnection ? `${selectedConnection.username}@${selectedConnection.host}:${selectedConnection.port}` : '请选择服务器' }}</small>
        </div>
        <button type="button" class="dialog-close-button" @click="closeDialog">关闭</button>
      </header>

      <div class="network-diagnostics-toolbar">
        <label class="network-diag-select-field network-diag-server-select-field">
          <span>服务器</span>
          <select
            v-model.number="selectedServerID"
            class="network-diag-select network-diag-server-select"
            :title="selectedConnectionTitle"
          >
            <option :value="0">请选择服务器</option>
            <option
              v-for="connection in connections"
              :key="connection.id"
              :value="connection.id"
              :title="connectionTitle(connection)"
            >
              {{ connection.name }}
            </option>
          </select>
        </label>
        <label class="network-diag-select-field network-diag-interface-select-field">
          <span>接口</span>
          <select
            :value="interfaceSelectValue"
            class="network-diag-select network-diag-interface-select"
            :title="interfaceSelectTitle"
            :disabled="!selectedServerID"
            @change="updateNetworkInterface"
          >
            <option value="all" title="聚合全部非 lo 接口">全部接口</option>
            <option value="physical" title="聚合非虚拟物理接口，排除 Docker/bridge/veth/tun/tap/wg 等接口">全部物理</option>
            <option value="docker" title="聚合 docker0、br-*、veth* 以及 cni/flannel/vxlan 等容器网络接口；macvlan/ipvlan 流量可能只体现在父接口或外部交换设备">Docker 网络</option>
            <option v-for="item in interfaceRows" :key="item.name" :value="item.name" :title="item.displayName || item.name">
              {{ item.displayName || item.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="secondary network-diag-refresh-button"
          title="刷新接口列表"
          :disabled="!selectedServerID || loadingInterfaces"
          @click="refreshInterfaces(false)"
        >
          刷新
        </button>
      </div>

      <div class="network-diagnostics-body">
        <nav class="network-diagnostics-types" aria-label="诊断类型">
          <button
            v-for="type in diagnosticTypes"
            :key="type"
            type="button"
            :class="{ active: diagnosticType === type }"
            @click="selectType(type)"
          >
            {{ typeLabel(type) }}
          </button>
        </nav>

        <section class="network-diagnostics-main">
          <div class="network-diagnostics-form">
            <div class="network-diag-run-row" :class="{ 'with-port': diagnosticType === 'tcp' }">
              <label class="network-diag-target-field">
                <span>目标</span>
                <input v-model="target" class="network-diag-target-input" :placeholder="defaultTarget(diagnosticType)" />
              </label>
              <label v-if="diagnosticType === 'tcp'" class="network-diag-port-field">
                <span>端口</span>
                <input v-model="portText" inputmode="numeric" placeholder="80" />
              </label>
              <div class="network-diagnostics-actions network-diag-actions">
                <button type="button" class="primary" :disabled="starting || !selectedServerID" @click="startDiagnostic">
                  开始
                </button>
                <button type="button" class="secondary" :disabled="canceling || !canCancel" @click="cancelDiagnostic">
                  取消
                </button>
                <button type="button" class="secondary" :disabled="!activeTaskID" @click="clearOutput">
                  清空
                </button>
                <button type="button" class="secondary" :disabled="!outputText" @click="copyOutput">
                  复制
                </button>
              </div>
              <span :class="['network-diag-status-badge', `is-${activeTaskStatus}`]" aria-label="诊断状态">
                {{ activeTaskStatusText }}
              </span>
            </div>
          </div>

          <pre ref="outputRef" class="network-diagnostics-output" @scroll="handleOutputScroll">{{ outputText || '等待诊断输出。' }}</pre>
        </section>
      </div>
    </section>
  </div>
</template>
