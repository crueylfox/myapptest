<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { choiceDialog, confirmDialog } from '../composables/useAppDialog'
import { useTunnelStore } from '../stores/tunnels'
import type {
  Connection,
  SaveTunnelProfileRequest,
  StartTunnelRequest,
  TunnelProfile,
  TunnelRuntime,
  TunnelType,
} from '../types'

const props = defineProps<{
  open: boolean
  connections: Connection[]
  activeServerId: number | null
}>()

const emit = defineEmits<{
  close: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const tunnelStore = useTunnelStore()
const selectedServerID = ref<number>(0)
const editingID = ref<number>(0)
const saving = ref(false)
const starting = ref(false)
const checkingByTunnelID = ref<Record<string, boolean>>({})
const enablingRemoteAccessByTunnelID = ref<Record<string, boolean>>({})
const lastSaveRestarted = ref(false)
const formSnapshot = ref('')

const form = reactive<SaveTunnelProfileRequest>({
  id: 0,
  name: '',
  serverID: 0,
  type: 'local',
  bindHost: '127.0.0.1',
  bindPort: 8080,
  targetHost: '127.0.0.1',
  targetPort: 80,
  remoteBindHost: '0.0.0.0',
  remoteBindPort: 12380,
  autoStart: false,
})

const selectedConnection = computed(() =>
  props.connections.find((connection) => connection.id === selectedServerID.value) ?? null)
const profiles = computed(() => tunnelStore.profilesForServer(selectedServerID.value))
const runtimes = computed(() => tunnelStore.runtimesForServer(selectedServerID.value))

watch(() => props.open, async (open) => {
  if (!open) return
  selectedServerID.value = props.activeServerId
    ?? props.connections[0]?.id
    ?? 0
  resetForm()
  try {
    await Promise.all([
      tunnelStore.loadProfiles(),
      tunnelStore.loadRuntimes(selectedServerID.value),
    ])
  } catch (reason) {
    emit('notify', errorMessage(reason, '加载端口转发配置失败'), 'error')
  }
}, { immediate: true })

watch(selectedServerID, async (serverID) => {
  if (!props.open) return
  resetForm()
  if (!serverID) return
  try {
    await tunnelStore.loadRuntimes(serverID)
  } catch (reason) {
    emit('notify', errorMessage(reason, '加载端口转发状态失败'), 'error')
  }
})

function resetForm(type: TunnelType = 'local') {
  editingID.value = 0
  form.id = 0
  form.name = defaultName(type)
  form.serverID = selectedServerID.value
  form.type = type
  form.bindHost = '127.0.0.1'
  form.bindPort = type === 'dynamic' ? 1080 : 8080
  form.targetHost = '127.0.0.1'
  form.targetPort = type === 'remote' ? 3000 : 80
  form.remoteBindHost = type === 'remote' ? '0.0.0.0' : ''
  form.remoteBindPort = type === 'remote' ? 12380 : 0
  form.autoStart = false
  markFormClean()
}

function editProfile(profile: TunnelProfile) {
  editingID.value = profile.id
  Object.assign(form, {
    id: profile.id,
    name: profile.name,
    serverID: profile.serverID,
    type: profile.type,
    bindHost: profile.bindHost || '127.0.0.1',
    bindPort: profile.bindPort || (profile.type === 'dynamic' ? 1080 : 8080),
    targetHost: profile.targetHost || '127.0.0.1',
    targetPort: profile.targetPort || (profile.type === 'remote' ? 3000 : 80),
    remoteBindHost: profile.remoteBindHost || (profile.type === 'remote' ? '0.0.0.0' : ''),
    remoteBindPort: profile.remoteBindPort || (profile.type === 'remote' ? 12380 : 0),
    autoStart: profile.autoStart,
  })
  markFormClean()
}

async function requestNewProfile() {
  if (!await confirmDiscardOrSaveChanges()) return
  resetForm('local')
}

async function requestEditProfile(profile: TunnelProfile) {
  if (editingID.value === profile.id) return
  if (!await confirmDiscardOrSaveChanges()) return
  editProfile(profile)
}

async function confirmDiscardOrSaveChanges() {
  if (!isFormDirty()) return true
  const result = await choiceDialog({
    title: '未保存修改',
    message: '当前端口转发配置有未保存修改，是否保存？',
    confirmText: '保存',
    confirmValue: 'save',
    secondaryText: '放弃',
    secondaryValue: 'discard',
    cancelText: '取消',
  })
  if (result === 'discard') return true
  if (result !== 'save') return false
  const saved = await saveProfile()
  return Boolean(saved)
}

function markFormClean() {
  formSnapshot.value = formStateKey()
}

function isFormDirty() {
  return formSnapshot.value !== formStateKey()
}

function formStateKey() {
  return JSON.stringify({
    id: form.id,
    name: form.name,
    serverID: form.serverID,
    type: form.type,
    bindHost: form.bindHost,
    bindPort: form.bindPort,
    targetHost: form.targetHost,
    targetPort: form.targetPort,
    remoteBindHost: form.remoteBindHost,
    remoteBindPort: form.remoteBindPort,
    autoStart: form.autoStart,
  })
}

function selectTunnelType(type: TunnelType) {
  if (form.type === type) return
  const previousType = form.type
  if (!editingID.value) {
    resetForm(type)
    return
  }
  form.type = type
  if (type === 'dynamic') {
    form.bindHost = form.bindHost || '127.0.0.1'
    form.bindPort = form.bindPort || 1080
    form.targetHost = ''
    form.targetPort = 0
    form.remoteBindHost = ''
    form.remoteBindPort = 0
    return
  }
  form.targetHost = form.targetHost || '127.0.0.1'
  form.targetPort = form.targetPort || (type === 'remote' ? 80 : 80)
  if (type === 'remote') {
    form.bindHost = ''
    form.bindPort = 0
    form.remoteBindHost = previousType === 'remote' ? (form.remoteBindHost || '0.0.0.0') : '0.0.0.0'
    form.remoteBindPort = previousType === 'remote' ? (form.remoteBindPort || 12380) : 12380
  } else {
    form.bindHost = form.bindHost || '127.0.0.1'
    form.bindPort = form.bindPort || 8080
    form.remoteBindHost = ''
    form.remoteBindPort = 0
  }
}

async function saveProfile() {
  lastSaveRestarted.value = false
  const request = normalizedProfile()
  const validation = validateProfile(request)
  if (validation) {
    emit('notify', validation, 'error')
    return null
  }
  const runningRuntime = request.id > 0 ? activeRuntimeForProfileID(request.id) : null
  if (runningRuntime) {
    const ok = await confirmDialog({
      title: '保存并重启端口转发',
      message: '该端口转发正在运行。保存修改需要先停止当前隧道并重新启动，是否继续？',
      confirmText: '保存并重启',
      danger: true,
    })
    if (!ok) return null
  }
  saving.value = true
  try {
    if (runningRuntime) {
      await tunnelStore.stop(runningRuntime.serverID, runningRuntime.tunnelID)
    }
    const saved = await tunnelStore.saveProfile(request)
    editProfile(saved)
    if (runningRuntime) {
      await startProfile(saved, { skipNotify: true, skipPublicConfirm: true })
      lastSaveRestarted.value = true
      emit('notify', '端口转发配置已保存并重启', 'success')
    } else {
      emit('notify', '端口转发配置已保存', 'success')
    }
    return saved
  } catch (reason) {
    emit('notify', errorMessage(reason, '保存端口转发配置失败'), 'error')
    return null
  } finally {
    saving.value = false
  }
}

async function saveAndStart() {
  if (!selectedServerID.value) {
    emit('notify', '请选择服务器', 'error')
    return
  }
  const profile = await saveProfile()
  if (!profile) return
  if (lastSaveRestarted.value) return
  await startProfile(profile)
}

async function startProfile(profile: TunnelProfile, options: { skipNotify?: boolean; skipPublicConfirm?: boolean } = {}) {
  const request = startRequestFromProfile(profile)
  if (requiresPublicBind(request) && !options.skipPublicConfirm) {
    const ok = await confirmDialog({
      title: '确认公开监听端口',
      message: '监听 0.0.0.0 会让局域网或外部设备访问此端口，请确认是否继续。',
      confirmText: '继续启动',
      danger: true,
    })
    if (!ok) return
    request.confirmPublicBind = true
  }
  starting.value = true
  try {
    await tunnelStore.start(request)
    if (!options.skipNotify) emit('notify', '端口转发已启动', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '启动端口转发失败'), 'error')
  } finally {
    starting.value = false
  }
}

async function stopRuntime(runtime: TunnelRuntime) {
  try {
    await tunnelStore.stop(runtime.serverID, runtime.tunnelID)
    emit('notify', '端口转发已停止', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '停止端口转发失败'), 'error')
  }
}

async function checkRemoteListen(runtime: TunnelRuntime) {
  checkingByTunnelID.value = { ...checkingByTunnelID.value, [runtime.tunnelID]: true }
  try {
    await tunnelStore.checkRemoteListen(runtime.serverID, runtime.tunnelID)
    emit('notify', '远程监听状态已重新检测', 'info')
  } catch (reason) {
    emit('notify', errorMessage(reason, '重新检测远程监听失败'), 'error')
  } finally {
    const next = { ...checkingByTunnelID.value }
    delete next[runtime.tunnelID]
    checkingByTunnelID.value = next
  }
}

async function enableRemoteAccess(runtime: TunnelRuntime) {
  const ok = await confirmDialog({
    title: '放行并重启隧道',
    message: '此操作会先停止当前远程转发，修改服务器 sshd 配置为 GatewayPorts yes，重新加载 sshd，然后重新启动该端口转发。是否继续？',
    confirmText: '放行并重启',
    danger: true,
  })
  if (!ok) return
  enablingRemoteAccessByTunnelID.value = { ...enablingRemoteAccessByTunnelID.value, [runtime.tunnelID]: true }
  try {
    const result = await tunnelStore.enableRemoteForwardAccessAndRestart({
      serverID: runtime.serverID,
      tunnelID: runtime.tunnelID,
      profileID: runtime.profileID,
      auth: emptyAuth(),
    })
    const warning = result.runtime?.remoteListenExposure !== 'public'
      ? result.runtime?.remoteListenWarning || 'GatewayPorts 已修改，但服务器仍未对外监听，请检查 sshd 是否重载成功或防火墙。'
      : result.access.warnings?.[0]
    emit('notify', warning || result.access.message || 'GatewayPorts yes 已启用并已重启隧道', warning ? 'info' : 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '放行并重启隧道失败'), 'error')
  } finally {
    const next = { ...enablingRemoteAccessByTunnelID.value }
    delete next[runtime.tunnelID]
    enablingRemoteAccessByTunnelID.value = next
  }
}

async function deleteProfile(profile: TunnelProfile) {
  const active = activeRuntimeForProfileID(profile.id)
  const ok = await confirmDialog({
    title: '删除端口转发配置',
    message: active
      ? `“${profile.name}”正在运行。删除会先停止隧道并释放端口，是否继续？`
      : `删除“${profile.name}”？删除配置不会记录任何流量内容。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    if (active) {
      await tunnelStore.stop(active.serverID, active.tunnelID)
    }
    await tunnelStore.deleteProfile(profile.id)
    if (editingID.value === profile.id) resetForm()
    emit('notify', active ? '端口转发已停止并删除' : '端口转发配置已删除', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '删除端口转发配置失败'), 'error')
  }
}

function normalizedProfile(): SaveTunnelProfileRequest {
  const request = { ...form, serverID: selectedServerID.value }
  request.name = request.name.trim()
  request.bindHost = request.bindHost.trim() || '127.0.0.1'
  request.remoteBindHost = request.remoteBindHost.trim()
  request.targetHost = request.targetHost.trim()
  if (request.type === 'dynamic') {
    request.targetHost = ''
    request.targetPort = 0
    request.remoteBindHost = ''
    request.remoteBindPort = 0
  } else if (request.type === 'local') {
    request.remoteBindHost = ''
    request.remoteBindPort = 0
  } else {
    request.bindHost = ''
    request.bindPort = 0
    request.remoteBindHost = request.remoteBindHost || '0.0.0.0'
  }
  return request
}

function startRequestFromProfile(profile: TunnelProfile): StartTunnelRequest {
  return {
    serverID: profile.serverID,
    profileID: profile.id,
    type: profile.type,
    name: profile.name,
    bindHost: profile.bindHost,
    bindPort: profile.bindPort,
    targetHost: profile.targetHost,
    targetPort: profile.targetPort,
    remoteBindHost: profile.remoteBindHost,
    remoteBindPort: profile.remoteBindPort,
    confirmPublicBind: false,
    auth: emptyAuth(),
  }
}

function validateProfile(request: SaveTunnelProfileRequest) {
  if (!request.serverID) return '请选择服务器'
  if (!request.name) return '请输入隧道名称'
  if (request.type === 'local' || request.type === 'dynamic') {
    if (!validPort(request.bindPort)) return '本地监听端口必须在 1-65535 之间'
    if (!request.bindHost) return '请输入本地监听地址'
  }
  if (request.type === 'remote') {
    if (!request.remoteBindHost) return '请输入远程监听地址'
    if (!validPort(request.remoteBindPort)) return '远程监听端口必须在 1-65535 之间'
  }
  if (request.type !== 'dynamic') {
    if (!request.targetHost) return '请输入目标地址'
    if (!validPort(request.targetPort)) return '目标端口必须在 1-65535 之间'
  }
  return ''
}

function validPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

function requiresPublicBind(request: StartTunnelRequest) {
  const host = request.type === 'remote' ? request.remoteBindHost : request.bindHost
  return host === '0.0.0.0' || host === '::'
}

function runtimeForProfile(profile: TunnelProfile) {
  const candidates = runtimes.value.filter((runtime) =>
    runtime.profileID === profile.id &&
    (runtime.status === 'starting' || runtime.status === 'running' || runtime.status === 'failed'))
  return candidates.find((runtime) => runtime.status === 'starting' || runtime.status === 'running')
    ?? candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

function activeRuntimeForProfileID(profileID: number) {
  return runtimes.value.find((runtime) =>
    runtime.profileID === profileID &&
    (runtime.status === 'starting' || runtime.status === 'running')) ?? null
}

function typeLabel(type: TunnelType) {
  if (type === 'remote') return '远程'
  if (type === 'dynamic') return '动态 SOCKS5'
  return '本地'
}

function statusLabel(status: TunnelRuntime['status']) {
  const labels: Record<TunnelRuntime['status'], string> = {
    starting: '启动中',
    running: '运行中',
    failed: '失败',
    stopping: '停止中',
    stopped: '已停止',
  }
  return labels[status] ?? status
}

function runtimeDisplayStatusLabel(runtime: TunnelRuntime) {
  if (runtime.type !== 'remote' || runtime.status !== 'running') return statusLabel(runtime.status)
  if (runtime.remoteListenExposure === 'public') return '运行中（局域网可访问）'
  if (runtime.remoteListenExposure === 'loopback_only' || runtime.remoteListenCheckStatus === 'loopback_only') {
    return '运行中（仅服务器本机）'
  }
  if (runtime.remoteListenExposure === 'unknown' || runtime.remoteListenCheckStatus === 'unknown') {
    return '运行中（未确认监听）'
  }
  return statusLabel(runtime.status)
}

function runtimeStatusClass(runtime: TunnelRuntime) {
  if (runtime.remoteListenExposure === 'public') return runtime.status
  if (runtime.status === 'failed' ||
    runtime.remoteListenExposure === 'not_listening' ||
    runtime.remoteListenCheckStatus === 'not_listening') return 'failed'
  if (runtime.remoteListenExposure === 'loopback_only' ||
    runtime.remoteListenExposure === 'unknown' ||
    runtime.remoteListenCheckStatus === 'loopback_only' ||
    runtime.remoteListenCheckStatus === 'unknown') return 'warning'
  return runtime.status
}

function endpoint(profile: TunnelProfile) {
  if (profile.type === 'remote') {
    return `${profile.remoteBindHost}:${profile.remoteBindPort} → ${profile.targetHost}:${profile.targetPort}`
  }
  if (profile.type === 'dynamic') return `${profile.bindHost}:${profile.bindPort}`
  return `${profile.bindHost}:${profile.bindPort} → ${profile.targetHost}:${profile.targetPort}`
}

function requestedListenLabel(runtime: TunnelRuntime) {
  return runtime.requestedListen || `${runtime.remoteBindHost}:${runtime.remoteBindPort}`
}

function actualListenLabel(runtime: TunnelRuntime) {
  if (runtime.remoteListenExposure === 'not_listening' || runtime.remoteListenCheckStatus === 'not_listening') return '未检测到'
  if (runtime.remoteListenExposure === 'unknown' || runtime.remoteListenCheckStatus === 'unknown') return '未知'
  return runtime.actualListen || '—'
}

function actualListenLabels(runtime: TunnelRuntime) {
  if (runtime.effectiveListenAddrs?.length) return runtime.effectiveListenAddrs
  const label = actualListenLabel(runtime)
  return label.split(/\s*\n\s*|\s*,\s*/).filter(Boolean)
}

function remoteListenLabel(runtime: TunnelRuntime) {
  const labels: Record<string, string> = {
    public: '局域网可访问',
    loopback_only: '仅本机监听',
    not_listening: '未监听',
    unknown: '无法确认',
    unchecked: '未检测',
    listening: '已监听',
  }
  return labels[runtime.remoteListenExposure] ?? labels[runtime.remoteListenCheckStatus] ?? '未检测'
}

function remoteListenWarning(runtime: TunnelRuntime) {
  if (runtime.remoteListenExposure === 'public' || runtime.remoteListenCheckStatus === 'listening') return ''
  if (runtime.remoteListenWarning) return runtime.remoteListenWarning
  if (runtime.remoteListenExposure === 'not_listening' || runtime.remoteListenCheckStatus === 'not_listening') {
    return '未在服务器上检测到远程监听端口，外部连接会被拒绝。'
  }
  if (runtime.remoteListenExposure === 'unknown' || runtime.remoteListenCheckStatus === 'unknown') {
    return '隧道已启动，但无法确认服务器实际监听状态。'
  }
  return ''
}

function showGatewayPortsHelp(runtime: TunnelRuntime) {
  if (runtime.remoteListenExposure === 'public' || runtime.remoteListenCheckStatus === 'listening') return false
  return runtime.remoteListenExposure === 'loopback_only' || runtime.remoteListenCheckStatus === 'loopback_only'
}

function canEnableRemoteAccess(runtime: TunnelRuntime) {
  return runtime.type === 'remote' && showGatewayPortsHelp(runtime)
}

function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let next = Math.max(0, value)
  let index = 0
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024
    index += 1
  }
  return `${next.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function defaultName(type: TunnelType) {
  if (type === 'remote') return '远程转发'
  if (type === 'dynamic') return '动态 SOCKS5'
  return '本地转发'
}

function emptyAuth() {
  return {
    password: '',
    passphrase: '',
    trustUnknownHost: false,
    rememberSecret: false,
  }
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  const lower = message.toLowerCase()
  if (message.includes('TUNNEL_PROFILE_NAME_EXISTS') ||
    lower.includes('idx_tunnel_profiles_server_name') ||
    lower.includes('unique constraint failed') ||
    lower.includes('(2067)')) {
    return '该服务器下已存在同名端口转发配置，请修改名称。'
  }
  if (message.includes('端口转发停止失败，配置未删除')) {
    return '端口转发停止失败，配置未删除，请先手动停止后再删除。'
  }
  return message || fallback
}
</script>

<template>
  <div v-if="open" class="tunnel-dialog-backdrop" data-testid="tunnel-dialog">
    <section class="tunnel-dialog" role="dialog" aria-modal="true" aria-label="端口转发">
      <header class="tunnel-dialog-header">
        <div>
          <h2>端口转发</h2>
          <p>Local / Remote / Dynamic SOCKS5 使用独立 SSH 隧道连接，不复用终端、SFTP 或监控会话。</p>
        </div>
        <button class="dialog-close-button" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="tunnel-dialog-toolbar">
        <label class="server-select-field">
          当前服务器
          <select v-model.number="selectedServerID">
            <option :value="0">请选择服务器</option>
            <option v-for="connection in connections" :key="connection.id" :value="connection.id">
              {{ connection.name }} ({{ connection.username }}@{{ connection.host }}:{{ connection.port }})
            </option>
          </select>
        </label>
        <button class="primary new-tunnel-button" type="button" data-testid="new-tunnel-profile" @click="requestNewProfile">
          新建端口转发
        </button>
      </div>

      <div class="tunnel-dialog-body">
        <section class="tunnel-profile-list">
          <h3>配置</h3>
          <p v-if="!selectedConnection" class="empty">请选择服务器后管理端口转发。</p>
          <p v-else-if="profiles.length === 0" class="empty">暂无端口转发配置。</p>
          <article
            v-for="profile in profiles"
            :key="profile.id"
            class="tunnel-profile-card"
            :class="{ active: editingID === profile.id }"
            role="button"
            tabindex="0"
            data-testid="tunnel-profile-card"
            @click="requestEditProfile(profile)"
            @keydown.enter.prevent="requestEditProfile(profile)"
          >
            <div class="tunnel-card-header">
              <div class="tunnel-card-title">
                <strong>{{ profile.name }}</strong>
                <span>{{ typeLabel(profile.type) }} · {{ endpoint(profile) }}</span>
              </div>
              <div class="tunnel-card-actions">
                <button
                  v-if="runtimeForProfile(profile)?.status === 'running' || runtimeForProfile(profile)?.status === 'starting'"
                  class="secondary"
                  type="button"
                  data-testid="stop-profile-runtime"
                  @click.stop="stopRuntime(runtimeForProfile(profile)!)"
                >停止</button>
                <button
                  v-if="runtimeForProfile(profile)?.type === 'remote'"
                  class="secondary"
                  type="button"
                  data-testid="check-remote-listen"
                  :disabled="checkingByTunnelID[runtimeForProfile(profile)!.tunnelID]"
                  @click.stop="checkRemoteListen(runtimeForProfile(profile)!)"
                >
                  {{ checkingByTunnelID[runtimeForProfile(profile)!.tunnelID] ? '检测中…' : '重新检测' }}
                </button>
                <button
                  v-if="!(runtimeForProfile(profile)?.status === 'running' || runtimeForProfile(profile)?.status === 'starting')"
                  class="primary"
                  type="button"
                  @click.stop="startProfile(profile)"
                >启动</button>
                <button class="danger subtle" type="button" data-testid="delete-profile" @click.stop="deleteProfile(profile)">删除</button>
              </div>
            </div>
            <div v-if="runtimeForProfile(profile)" class="tunnel-runtime-line">
              <span :class="['tunnel-status', runtimeStatusClass(runtimeForProfile(profile)!)]">
                {{ runtimeDisplayStatusLabel(runtimeForProfile(profile)!) }}
              </span>
              <span>连接 {{ runtimeForProfile(profile)!.activeConnections }}</span>
              <span>入 {{ formatBytes(runtimeForProfile(profile)!.bytesIn) }}</span>
              <span>出 {{ formatBytes(runtimeForProfile(profile)!.bytesOut) }}</span>
            </div>
            <div
              v-if="runtimeForProfile(profile)?.type === 'remote'"
              class="remote-listen-diagnostics"
              data-testid="remote-listen-diagnostics"
            >
              <div>
                <span>请求监听</span>
                <strong>{{ requestedListenLabel(runtimeForProfile(profile)!) }}</strong>
              </div>
              <div>
                <span>实际监听</span>
                <strong class="listen-address-list">
                  <b
                    v-for="address in actualListenLabels(runtimeForProfile(profile)!)"
                    :key="address"
                  >{{ address }}</b>
                </strong>
                <em>{{ remoteListenLabel(runtimeForProfile(profile)!) }}</em>
              </div>
              <div v-if="runtimeForProfile(profile)!.testCommand">
                <span>测试命令</span>
                <code>{{ runtimeForProfile(profile)!.testCommand }}</code>
              </div>
              <p
                v-if="remoteListenWarning(runtimeForProfile(profile)!)"
                class="remote-listen-warning"
              >
                {{ remoteListenWarning(runtimeForProfile(profile)!) }}
              </p>
              <p
                v-if="showGatewayPortsHelp(runtimeForProfile(profile)!)"
                class="remote-listen-help"
              >
                想让局域网访问 {{ selectedConnection?.host }}:{{ runtimeForProfile(profile)!.remoteBindPort }}，请在服务器 sshd 配置中启用：
                <code>GatewayPorts yes</code>
                或 <code>GatewayPorts clientspecified</code>。通常只需要启用 GatewayPorts yes；部分服务器可能还需要 AllowTcpForwarding。然后重启 sshd，并确认防火墙放行 {{ runtimeForProfile(profile)!.remoteBindPort }}。
              </p>
              <button
                v-if="canEnableRemoteAccess(runtimeForProfile(profile)!)"
                class="remote-access-button"
                type="button"
                data-testid="enable-remote-access"
                :disabled="enablingRemoteAccessByTunnelID[runtimeForProfile(profile)!.tunnelID]"
                @click.stop="enableRemoteAccess(runtimeForProfile(profile)!)"
              >
                {{ enablingRemoteAccessByTunnelID[runtimeForProfile(profile)!.tunnelID] ? '重启中…' : '放行并重启' }}
              </button>
            </div>
          </article>
        </section>

        <form class="tunnel-profile-form" @submit.prevent="saveAndStart">
          <h3>{{ editingID ? '编辑配置' : '新建配置' }}</h3>
          <label>
            名称
            <input v-model="form.name" data-testid="tunnel-name" placeholder="例如：Web 管理后台" />
          </label>

          <div class="tunnel-type-cards" role="radiogroup" aria-label="端口转发场景">
            <button
              type="button"
              data-testid="tunnel-type-local"
              :class="['tunnel-type-card', { selected: form.type === 'local' }]"
              @click="selectTunnelType('local')"
            >
              <strong>本地转发</strong>
              <span>把服务器上的 Web、数据库等服务映射到本机访问。</span>
            </button>
            <button
              type="button"
              data-testid="tunnel-type-remote"
              :class="['tunnel-type-card', { selected: form.type === 'remote' }]"
              @click="selectTunnelType('remote')"
            >
              <strong>远程转发</strong>
              <span>把你电脑上的服务暴露到服务器端口。</span>
            </button>
            <button
              type="button"
              data-testid="tunnel-type-dynamic"
              :class="['tunnel-type-card', { selected: form.type === 'dynamic' }]"
              @click="selectTunnelType('dynamic')"
            >
              <strong>SOCKS5 代理</strong>
              <span>在本机创建 SOCKS5 代理，通过 SSH 服务器访问网络。</span>
            </button>
          </div>
          <p v-if="form.type === 'local'" class="form-hint">
            例如：本机 127.0.0.1:9188 → SSH 服务器 → 服务器 127.0.0.1:9188
          </p>
          <p v-else-if="form.type === 'remote'" class="form-hint">
            例如：服务器 0.0.0.0:12380 → SSH 隧道 → 我电脑 192.168.0.2:80
          </p>
          <p v-else class="form-hint">
            在本机创建 SOCKS5 代理。浏览器或工具设置 SOCKS5 代理为 127.0.0.1:1080。
          </p>

          <template v-if="form.type !== 'remote'">
            <div class="tunnel-endpoint-row" data-testid="tunnel-endpoint-row">
              <label>
                {{ form.type === 'dynamic' ? '我的电脑地址' : '我的电脑地址' }}
                <input v-model="form.bindHost" data-testid="tunnel-bind-host" placeholder="127.0.0.1" />
              </label>
              <label>
                {{ form.type === 'dynamic' ? '我的电脑端口' : '我的电脑端口' }}
                <input v-model.number="form.bindPort" data-testid="tunnel-bind-port" type="number" min="1" max="65535" />
              </label>
            </div>
            <p v-if="form.type === 'dynamic'" class="form-hint">浏览器 SOCKS5 代理填写 {{ form.bindHost || '127.0.0.1' }}:{{ form.bindPort || 1080 }}</p>
          </template>

          <template v-if="form.type === 'remote'">
            <div class="tunnel-endpoint-row" data-testid="tunnel-endpoint-row">
              <label>
                服务器地址
                <input v-model="form.remoteBindHost" data-testid="tunnel-remote-bind-host" placeholder="0.0.0.0" />
              </label>
              <label>
                服务器端口
                <input v-model.number="form.remoteBindPort" data-testid="tunnel-remote-bind-port" type="number" min="1" max="65535" />
              </label>
            </div>
            <p class="form-hint">如果想让局域网访问，请使用 0.0.0.0，并确保 GatewayPorts yes。</p>
          </template>

          <template v-if="form.type !== 'dynamic'">
            <div class="tunnel-endpoint-row" data-testid="tunnel-endpoint-row">
              <label>
                {{ form.type === 'remote' ? '我的电脑地址' : '服务器地址' }}
                <input v-model="form.targetHost" data-testid="tunnel-target-host" placeholder="127.0.0.1" />
              </label>
              <label>
                {{ form.type === 'remote' ? '我的电脑端口' : '服务器端口' }}
                <input v-model.number="form.targetPort" data-testid="tunnel-target-port" type="number" min="1" max="65535" />
              </label>
            </div>
            <p v-if="form.type === 'local'" class="form-hint">例：访问服务器上的 {{ form.targetHost || '127.0.0.1' }}:{{ form.targetPort || 9188 }}，启动后在本机打开 http://{{ form.bindHost || '127.0.0.1' }}:{{ form.bindPort || 9188 }}</p>
            <p v-else class="form-hint">例：让服务器 {{ selectedConnection?.host || '服务器' }}:{{ form.remoteBindPort || 12380 }} 转到我电脑 {{ form.targetHost || '127.0.0.1' }}:{{ form.targetPort || 80 }}</p>
          </template>

          <label class="auto-start-field">
            <input v-model="form.autoStart" type="checkbox" data-testid="tunnel-auto-start" />
            <span>连接服务器后自动启动</span>
          </label>

          <div class="tunnel-form-actions">
            <button class="secondary" type="button" data-testid="save-profile" :disabled="saving" @click="saveProfile">保存配置</button>
            <button class="primary" type="submit" data-testid="save-and-start" :disabled="saving || starting">
              {{ starting ? '启动中…' : '保存并启动' }}
            </button>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tunnel-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 800);
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(2, 6, 23, 0.08);
  transform: translateZ(0);
}

.tunnel-dialog {
  width: min(1040px, calc(100vw - 48px));
  max-height: calc(100vh - 56px);
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.22));
  border-radius: 18px;
  background: var(--panel, #101827);
  color: var(--text, #e5edf8);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
}

.tunnel-dialog-header,
.tunnel-dialog-toolbar,
.tunnel-card-actions,
.tunnel-form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tunnel-dialog-header {
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.18));
}

.tunnel-dialog-header h2 {
  margin: 0;
  font-size: 20px;
}

.tunnel-dialog-header p {
  margin: 6px 0 0;
  color: var(--muted, #9aa8ba);
  font-size: 13px;
}

.tunnel-dialog-toolbar {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  flex-wrap: wrap;
  align-items: end;
}

.server-select-field {
  flex: 0 1 420px;
}

.new-tunnel-button {
  flex: 0 0 auto;
  min-height: 34px;
}

.tunnel-dialog-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(340px, 1fr) minmax(320px, 420px);
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: auto;
}

.tunnel-profile-form {
  grid-column: 1;
  grid-row: 1;
}

.tunnel-profile-list {
  grid-column: 2;
  grid-row: 1;
}

.tunnel-profile-list,
.tunnel-profile-form {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tunnel-profile-list h3,
.tunnel-profile-form h3 {
  margin: 0;
}

.tunnel-profile-card,
.tunnel-profile-form {
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 14px;
  background: var(--panel-2, rgba(15, 23, 42, 0.72));
  padding: 12px;
}

.tunnel-profile-card {
  display: grid;
  gap: 8px;
  cursor: pointer;
}

.tunnel-card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.tunnel-card-title {
  min-width: 0;
}

.tunnel-card-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.tunnel-card-actions button {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 12px;
}

.tunnel-profile-card.active {
  border-color: rgba(96, 165, 250, 0.62);
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.18) inset;
}

.tunnel-profile-card strong,
.tunnel-profile-card span {
  display: block;
}

.tunnel-profile-card span {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.tunnel-runtime-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tunnel-runtime-line span {
  display: inline-flex;
  border-radius: 999px;
  padding: 2px 7px;
  background: rgba(148, 163, 184, 0.1);
}

.tunnel-status.running {
  color: #86efac;
}

.tunnel-status.warning {
  color: #fde68a;
}

.tunnel-status.failed {
  color: #fca5a5;
}

.remote-listen-diagnostics {
  display: grid;
  gap: 6px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.48);
  padding: 10px;
}

.remote-listen-diagnostics div {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.remote-listen-diagnostics span {
  color: var(--muted, #9aa8ba);
}

.remote-listen-diagnostics strong,
.remote-listen-diagnostics code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #e5edf8);
  font-size: 12px;
}

.listen-address-list {
  display: inline-grid;
  gap: 2px;
}

.listen-address-list b {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.remote-listen-diagnostics code {
  font-family: var(--mono-font, 'Cascadia Mono', Consolas, monospace);
}

.remote-listen-diagnostics em {
  font-style: normal;
  color: #fde68a;
  font-size: 12px;
}

.remote-listen-warning {
  margin: 2px 0 0;
  color: #fde68a;
  font-size: 12px;
  line-height: 1.45;
}

.remote-listen-help {
  margin: 0;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  line-height: 1.5;
}

.remote-listen-help code {
  display: inline-flex;
  margin: 0 3px;
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.12);
  color: var(--text, #e5edf8);
}

.remote-access-button {
  justify-self: start;
  min-height: 30px;
  border-color: rgba(251, 191, 36, 0.38);
  background: rgba(251, 191, 36, 0.12);
  color: #fde68a;
}

.remote-access-button:hover:not(:disabled) {
  border-color: rgba(251, 191, 36, 0.62);
  background: rgba(251, 191, 36, 0.18);
}

.tunnel-type-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.tunnel-type-card {
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 10px;
  text-align: left;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.18));
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.38);
  color: var(--text, #e5edf8);
}

.tunnel-type-card strong {
  font-size: 13px;
  line-height: 1.25;
}

.tunnel-type-card span {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  line-height: 1.4;
}

.tunnel-type-card.selected {
  border-color: rgba(96, 165, 250, 0.68);
  background: rgba(37, 99, 235, 0.14);
}

.form-hint {
  margin: -4px 0 2px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  line-height: 1.45;
}

.auto-start-field {
  display: inline-flex !important;
  align-items: center;
  gap: 8px !important;
  color: var(--muted, #9aa8ba);
}

.auto-start-field input {
  width: auto !important;
}

.tunnel-endpoint-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(96px, 132px);
  gap: 10px;
  align-items: end;
}

.tunnel-profile-form label,
.tunnel-dialog-toolbar label {
  display: grid;
  gap: 6px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.tunnel-profile-form input,
.tunnel-profile-form select,
.tunnel-dialog-toolbar select {
  width: 100%;
}

.tunnel-form-actions {
  justify-content: flex-end;
  margin-top: 4px;
}

.empty {
  margin: 0;
  color: var(--muted, #9aa8ba);
}

.danger.subtle {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.45);
}

@media (max-width: 860px) {
  .tunnel-dialog-body {
    grid-template-columns: 1fr;
  }

  .tunnel-profile-form,
  .tunnel-profile-list {
    grid-column: auto;
    grid-row: auto;
  }

  .tunnel-type-cards {
    grid-template-columns: 1fr;
  }

  .tunnel-endpoint-row {
    grid-template-columns: 1fr;
  }

  .server-select-field {
    flex-basis: 100%;
  }
}
</style>
