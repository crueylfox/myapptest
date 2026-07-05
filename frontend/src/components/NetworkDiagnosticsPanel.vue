<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useServerStore } from '../stores/server'
import type { NetworkDiagnosticStatus, NetworkDiagnosticType } from '../types'

type NetworkDiagnosticDisplayStatus = NetworkDiagnosticStatus | 'idle'

const props = defineProps<{
  serverId: number
  active: boolean
}>()

const emit = defineEmits<{
  notify: [message: string, type: 'success' | 'error' | 'info']
  runningChange: [running: boolean]
}>()

const store = useServerStore()
const diagnosticTypes: NetworkDiagnosticType[] = ['ping', 'traceroute', 'dns', 'tcp']
const diagnosticType = ref<NetworkDiagnosticType>('ping')
const target = ref('8.8.8.8')
const portText = ref('80')
const activeTaskID = ref('')
const starting = ref(false)
const canceling = ref(false)
const outputRef = ref<HTMLElement | null>(null)
const followOutput = ref(true)

const tasks = computed(() => store.diagnosticTasks[props.serverId] ?? [])
const activeTask = computed(() =>
  tasks.value.find((task) => task.taskID === activeTaskID.value) ?? null)
const outputLines = computed(() =>
  activeTaskID.value ? store.diagnosticOutput[activeTaskID.value] ?? [] : [])
const outputText = computed(() => outputLines.value.join('\n'))
const activeTaskStatus = computed<NetworkDiagnosticDisplayStatus>(() => activeTask.value?.status ?? 'idle')
const activeTaskStatusText = computed(() => taskStatusLabel(activeTaskStatus.value))
const canCancel = computed(() => Boolean(activeTask.value && activeTask.value.status === 'running'))
const running = computed(() => tasks.value.some((task) => task.status === 'running'))

watch(() => [props.serverId, props.active] as const, async ([serverId, active]) => {
  if (!serverId || !active) return
  await loadTasks()
}, { immediate: true })

watch(activeTaskID, () => {
  followOutput.value = true
  void scrollOutputToBottom()
})

watch(outputLines, () => {
  if (followOutput.value) void scrollOutputToBottom()
})

watch(running, (value) => emit('runningChange', value), { immediate: true })

async function loadTasks() {
  try {
    const rows = await store.loadNetworkDiagnosticTasks(props.serverId)
    activeTaskID.value = rows.find((task) => task.status === 'running')?.taskID ?? rows[0]?.taskID ?? ''
  } catch (reason) {
    emit('notify', errorMessage(reason, '读取网络诊断任务失败'), 'error')
  }
}

function selectType(type: NetworkDiagnosticType) {
  const previousDefault = defaultTarget(diagnosticType.value)
  diagnosticType.value = type
  if (!target.value.trim() || target.value.trim() === previousDefault) {
    target.value = defaultTarget(type)
  }
}

async function startDiagnostic() {
  if (!props.serverId) {
    emit('notify', '请选择服务器', 'error')
    return
  }
  const normalizedTarget = target.value.trim()
  if (!normalizedTarget) {
    emit('notify', '请输入诊断目标', 'error')
    return
  }
  const request = {
    serverID: props.serverId,
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

async function cancelDiagnostic(silent = false) {
  if (!props.serverId || !activeTaskID.value) return
  canceling.value = true
  try {
    await store.cancelNetworkDiagnostic(props.serverId, activeTaskID.value)
    if (!silent) emit('notify', '已请求取消诊断任务', 'info')
  } catch (reason) {
    if (!silent) emit('notify', errorMessage(reason, '取消网络诊断失败'), 'error')
  } finally {
    canceling.value = false
  }
}

async function cancelRunningDiagnostics() {
  const runningTasks = tasks.value.filter((task) => task.status === 'running')
  for (const task of runningTasks) {
    store.ignoreNetworkDiagnosticOutput(task.taskID)
  }
  await Promise.allSettled(runningTasks.map((task) =>
    store.cancelNetworkDiagnostic(task.serverID, task.taskID)))
}

function hasRunningDiagnostics() {
  return running.value
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

defineExpose({ cancelRunningDiagnostics, hasRunningDiagnostics })
</script>

<template>
  <div class="network-diagnostics-panel" data-testid="network-diagnostics-panel">
    <div class="network-diagnostics-commandbar">
      <nav class="network-diagnostics-types" aria-label="诊断类型">
        <template v-for="(type, index) in diagnosticTypes" :key="type">
          <button
            type="button"
            class="command-light-action"
            :class="{ active: diagnosticType === type }"
            @click="selectType(type)"
          >
            {{ typeLabel(type) }}
          </button>
          <span v-if="index < diagnosticTypes.length - 1" class="command-action-separator" aria-hidden="true">|</span>
        </template>
      </nav>

      <label class="network-diagnostics-target">
        <span>目标</span>
        <input v-model="target" class="network-diag-target-input" :placeholder="defaultTarget(diagnosticType)" />
      </label>
      <label v-if="diagnosticType === 'tcp'" class="network-diagnostics-port">
        <span>端口</span>
        <input v-model="portText" inputmode="numeric" placeholder="80" />
      </label>

      <div class="network-diagnostics-actions">
        <button type="button" class="primary" :disabled="starting || !serverId" @click="startDiagnostic">
          开始
        </button>
        <button type="button" class="secondary" :disabled="canceling || !canCancel" @click="cancelDiagnostic(false)">
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

    <pre ref="outputRef" class="network-diagnostics-output" @scroll="handleOutputScroll">{{ outputText || '等待诊断输出。' }}</pre>
  </div>
</template>
