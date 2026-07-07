<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { confirmDialog } from '../composables/useAppDialog'
import {
  SERVICE_ACTIONS,
  criticalWarningText as serviceCriticalWarningText,
  errorMessage,
  filterServices,
  journalFollowDisabledReason as buildJournalFollowDisabledReason,
  journalFollowSupported as isJournalFollowSupported,
  journalRefreshSupported as isJournalRefreshSupported,
  journalSourceText as buildJournalSourceText,
  journalSupported as isJournalSupported,
  partialWarningText as servicePartialWarningText,
  resourceMetricsSupported as isResourceMetricsSupported,
  serviceStatusShortText,
  serviceStatusText,
  type DetailTab,
  type RunningFilter,
  type ServiceAction,
  type StartupFilter,
} from '../composables/serviceManagerModel'
import { useServiceActionFlow } from '../composables/useServiceActionFlow'
import { useServiceJournalFlow } from '../composables/useServiceJournalFlow'
import { useServiceManagerStore } from '../stores/services'
import type { Connection, ConnectionRuntimeState, SystemServiceSummary } from '../types'
import ServiceManagerDetails from './service-manager/ServiceManagerDetails.vue'
import ServiceManagerList from './service-manager/ServiceManagerList.vue'

const props = defineProps<{
  open: boolean
  connections: Connection[]
  connectionStates: Record<number, ConnectionRuntimeState>
  activeServerId: number | null
}>()

const emit = defineEmits<{
  close: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const serviceStore = useServiceManagerStore()
const selectedServerID = ref(0)
const selectedUnitName = ref('')
const query = ref('')
const runningFilter = ref<RunningFilter>('all')
const startupFilter = ref<StartupFilter>('all')
const loading = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const activeDetailTab = ref<DetailTab>('detail')
let listSerial = 0
let detailSerial = 0

const openRef = toRef(props, 'open')
const onlineConnections = computed(() =>
  props.connections.filter((connection) => isOnline(connection.id)))
const capability = computed(() => serviceStore.capability(selectedServerID.value))
const rawServices = computed(() => serviceStore.services(selectedServerID.value))
const selectedService = computed(() =>
  rawServices.value.find((service) => service.unitName === selectedUnitName.value) ?? null)
const selectedDetail = computed(() =>
  serviceStore.detail(selectedServerID.value, selectedUnitName.value))
const showCriticalWarning = computed(() => Boolean(selectedService.value?.critical))
const criticalWarningText = computed(() => serviceCriticalWarningText(selectedService.value))
const partialWarningText = computed(() => servicePartialWarningText(selectedDetail.value))
const showPartialWarning = computed(() => partialWarningText.value.length > 0)
const journalSupported = computed(() => isJournalSupported(capability.value))
const journalRefreshSupported = computed(() => isJournalRefreshSupported(capability.value))
const journalFollowSupported = computed(() => isJournalFollowSupported(capability.value))
const journalSourceText = computed(() => buildJournalSourceText(capability.value))
const journalFollowDisabledReason = computed(() => buildJournalFollowDisabledReason(capability.value))
const resourceMetricsSupported = computed(() => isResourceMetricsSupported(capability.value))
const journalLines = computed(() =>
  serviceStore.journalLines(selectedServerID.value, selectedUnitName.value))
const journalStatus = computed(() =>
  serviceStore.journalStatus(selectedServerID.value, selectedUnitName.value))
const journalError = computed(() =>
  serviceStore.journalError(selectedServerID.value, selectedUnitName.value))
const journalOverflow = computed(() =>
  serviceStore.journalOverflow(selectedServerID.value, selectedUnitName.value))
const journalFollowing = computed(() =>
  serviceStore.isFollowingJournal(selectedServerID.value, selectedUnitName.value))
const statusText = computed(() => serviceStatusText({
  onlineCount: onlineConnections.value.length,
  selectedServerID: selectedServerID.value,
  loading: loading.value,
  rawCount: rawServices.value.length,
  capability: capability.value,
  listError: serviceStore.listError(selectedServerID.value),
}))
const statusShortText = computed(() => serviceStatusShortText(capability.value, statusText.value))
const filteredServices = computed(() =>
  filterServices(rawServices.value, {
    query: query.value,
    runningFilter: runningFilter.value,
    startupFilter: startupFilter.value,
  }))
const canManage = computed(() => Boolean(capability.value?.available && capability.value.canManage))

function notify(message: string, type: 'success' | 'error' | 'info') {
  emit('notify', message, type)
}

const actionFlow = useServiceActionFlow({
  selectedServerID,
  selectedService,
  capability,
  canManage,
  loading,
  confirm: confirmDialog,
  notify,
  actions: {
    start: serviceStore.start,
    stop: serviceStore.stop,
    restart: serviceStore.restart,
    enable: serviceStore.enable,
    disable: serviceStore.disable,
  },
})

const journalFlow = useServiceJournalFlow({
  open: openRef,
  selectedServerID,
  selectedUnitName,
  journalLines,
  journalStatus,
  journalError,
  journalOverflow,
  journalFollowing,
  journalRefreshSupported,
  journalFollowSupported,
  journalFollowDisabledReason,
  loadJournal: serviceStore.loadJournal,
  startFollow: serviceStore.startJournalFollow,
  stopFollow: serviceStore.stopJournalFollow,
  stopServerRuntime: serviceStore.stopServerJournalRuntime,
  clearJournal: serviceStore.clearJournal,
  notify,
  afterDomUpdate: nextTick,
})

const actionBusy = actionFlow.actionBusy
const actionDisabled = actionFlow.actionDisabled
const runServiceAction = actionFlow.runServiceAction
const {
  journalAutoScroll,
  journalCountText,
  journalCurrentBootOnly,
  journalFollowBusy,
  journalLineLimit,
  journalLoading,
  journalPriority,
  journalQuery,
  journalStatusText,
  journalWordWrap,
  visibleJournalLines,
  cancelPendingJournalWork,
  clearJournalDisplay,
  copyVisibleJournal,
  loadJournalSnapshot,
  onJournalScroll,
  scrollJournalToBottom,
  stopServerJournalRuntime,
  toggleJournalFollow,
} = journalFlow

const disabledActions = computed(() =>
  Object.fromEntries(SERVICE_ACTIONS.map((action) => [action, actionDisabled(action)])) as Record<ServiceAction, boolean>)

const journalProps = computed(() => ({
  autoScroll: journalAutoScroll.value,
  currentBootOnly: journalCurrentBootOnly.value,
  journalCountText: journalCountText.value,
  journalFollowBusy: journalFollowBusy.value,
  journalFollowDisabledReason: journalFollowDisabledReason.value,
  journalFollowSupported: journalFollowSupported.value,
  journalFollowing: journalFollowing.value,
  journalLoading: journalLoading.value,
  journalRefreshSupported: journalRefreshSupported.value,
  journalSourceText: journalSourceText.value,
  journalStatus: journalStatus.value,
  journalStatusText: journalStatusText.value,
  journalSupported: journalSupported.value,
  lineLimit: journalLineLimit.value,
  priority: journalPriority.value,
  query: journalQuery.value,
  selectedUnitName: selectedUnitName.value,
  visibleLines: visibleJournalLines.value,
  wordWrap: journalWordWrap.value,
}))

watch(() => props.open, async (open) => {
  if (!open) {
    listSerial++
    detailSerial++
    cancelPendingJournalWork()
    if (selectedServerID.value) await stopServerJournalRuntime(selectedServerID.value)
    if (selectedServerID.value) await serviceStore.cancelQueries(selectedServerID.value).catch(() => undefined)
    return
  }
  query.value = ''
  runningFilter.value = 'all'
  startupFilter.value = 'all'
  activeDetailTab.value = 'detail'
  journalQuery.value = ''
  selectedServerID.value = initialServerID()
  if (selectedServerID.value) await refreshAll(false)
}, { immediate: true })

watch(() => [props.activeServerId, onlineConnections.value.map((connection) => connection.id).join(',')] as const, async () => {
  if (!props.open) return
  if (selectedServerID.value && onlineConnections.value.some((connection) => connection.id === selectedServerID.value)) return
  selectedServerID.value = initialServerID()
  if (selectedServerID.value) await refreshAll(false)
})

watch(selectedServerID, async (serverID, previous) => {
  if (!props.open || serverID === previous) return
  if (previous) {
    await stopServerJournalRuntime(previous)
    await serviceStore.cancelQueries(previous).catch(() => undefined)
  }
  selectedUnitName.value = ''
  detailError.value = ''
  activeDetailTab.value = 'detail'
  if (serverID) await refreshAll(false)
})

watch(filteredServices, async (services) => {
  if (!props.open) return
  if (!services.length) {
    selectedUnitName.value = ''
    return
  }
  if (!services.some((service) => service.unitName === selectedUnitName.value)) {
    selectedUnitName.value = services[0].unitName
  }
})

watch(selectedUnitName, async (unitName, previous) => {
  if (!props.open || !selectedServerID.value) return
  if (previous) await serviceStore.stopJournalFollow(selectedServerID.value, previous)
  if (!unitName) return
  detailError.value = ''
  if (activeDetailTab.value === 'logs') {
    await loadJournalSnapshot(false)
  } else {
    await loadDetail(unitName)
  }
})

watch(activeDetailTab, async (tab) => {
  if (!props.open || !selectedServerID.value || !selectedUnitName.value) return
  if (tab === 'logs' && !journalSupported.value) {
    activeDetailTab.value = 'detail'
    return
  }
  if (tab === 'logs') {
    await loadJournalSnapshot(false)
  } else {
    await serviceStore.stopJournalFollow(selectedServerID.value, selectedUnitName.value)
    await loadDetail(selectedUnitName.value)
  }
})

watch(() => [journalLineLimit.value, journalPriority.value, journalCurrentBootOnly.value] as const, async () => {
  if (!props.open || activeDetailTab.value !== 'logs' || !selectedServerID.value || !selectedUnitName.value) return
  await loadJournalSnapshot(false)
})

watch(() => journalLines.value.length, async () => {
  if (!journalAutoScroll.value) return
  await nextTick()
  scrollJournalToBottom()
})

onMounted(() => {
  serviceStore.subscribe()
})

onBeforeUnmount(() => {
  listSerial++
  detailSerial++
  cancelPendingJournalWork()
  if (selectedServerID.value) void stopServerJournalRuntime(selectedServerID.value)
  if (selectedServerID.value) void serviceStore.cancelQueries(selectedServerID.value)
  serviceStore.unsubscribe()
})

async function closeDialog() {
  listSerial++
  detailSerial++
  cancelPendingJournalWork()
  if (selectedServerID.value) await stopServerJournalRuntime(selectedServerID.value)
  if (selectedServerID.value) await serviceStore.cancelQueries(selectedServerID.value).catch(() => undefined)
  emit('close')
}

async function refreshAll(showSuccess = true) {
  if (!selectedServerID.value) return
  const serial = ++listSerial
  loading.value = true
  detailError.value = ''
  const previousUnit = selectedUnitName.value
  try {
    const currentCapability = await serviceStore.check(selectedServerID.value)
    if (!props.open || serial !== listSerial) return
    if (currentCapability.available && !isJournalSupported(currentCapability)) {
      if (activeDetailTab.value === 'logs') activeDetailTab.value = 'detail'
      await stopServerJournalRuntime(selectedServerID.value)
    }
    if (!currentCapability.available) return
    const response = await serviceStore.refresh(selectedServerID.value)
    if (!props.open || serial !== listSerial) return
    const next = response.services.some((service) => service.unitName === previousUnit)
      ? previousUnit
      : (response.services[0]?.unitName ?? '')
    if (selectedUnitName.value === next && previousUnit === next) {
      if (next) await loadDetail(next)
    } else {
      selectedUnitName.value = next
    }
    if (showSuccess) emit('notify', '系统服务列表已刷新。', 'success')
  } catch (reason) {
    if (!props.open || serial !== listSerial) return
    emit('notify', errorMessage(reason, '读取系统服务列表失败。'), 'error')
  } finally {
    if (serial === listSerial) loading.value = false
  }
}

async function loadDetail(unitName: string) {
  if (!selectedServerID.value) return
  const serial = ++detailSerial
  detailLoading.value = true
  detailError.value = ''
  try {
    await serviceStore.loadDetail(selectedServerID.value, unitName)
  } catch (reason) {
    if (!props.open || serial !== detailSerial) return
    detailError.value = errorMessage(reason, '读取服务详情失败。')
  } finally {
    if (serial === detailSerial) detailLoading.value = false
  }
}

function selectService(service: SystemServiceSummary) {
  selectedUnitName.value = service.unitName
}

function initialServerID() {
  if (props.activeServerId && onlineConnections.value.some((connection) => connection.id === props.activeServerId)) {
    return props.activeServerId
  }
  return onlineConnections.value[0]?.id ?? 0
}

function isOnline(serverID: number) {
  const state = props.connectionStates[serverID]
  if (!state) return false
  if (state.status === 'disconnecting' || state.status === 'offline' || state.status === 'disconnected') return false
  return state.status === 'online' || state.hasActiveSession || state.terminalActive || state.monitorActive || state.sftpActive
}
</script>

<template>
  <div v-if="open" class="service-dialog-backdrop" data-testid="service-manager-dialog">
    <section class="service-dialog" role="dialog" aria-modal="true" aria-label="系统服务">
      <header class="service-dialog-header">
        <div>
          <h2>系统服务</h2>
          <p>管理 systemd / OpenWrt procd 服务生命周期和开机启动；具体 PID 与资源占用请使用进程管理。</p>
        </div>
        <button class="dialog-close-button" type="button" @click="closeDialog">关闭</button>
      </header>

      <div class="service-filter-toolbar">
        <label class="service-filter-inline service-filter-server">
          <span>当前服务器</span>
          <select v-model.number="selectedServerID" data-testid="service-server-select" :disabled="onlineConnections.length === 0">
            <option v-if="onlineConnections.length === 0" :value="0">请先连接一台服务器</option>
            <option v-for="connection in onlineConnections" :key="connection.id" :value="connection.id">
              {{ connection.name }}
            </option>
          </select>
        </label>
        <label class="service-filter-inline service-filter-search">
          <span>搜索</span>
          <input v-model="query" data-testid="service-search" placeholder="服务名或描述" />
        </label>
        <label class="service-filter-inline service-filter-status">
          <span>运行状态</span>
          <select v-model="runningFilter" data-testid="service-running-filter">
            <option value="all">全部</option>
            <option value="running">运行中</option>
            <option value="stopped">已停止</option>
            <option value="failed">失败</option>
          </select>
        </label>
        <label class="service-filter-inline service-filter-startup">
          <span>开机启动</span>
          <select v-model="startupFilter" data-testid="service-startup-filter">
            <option value="all">全部</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已禁用</option>
            <option value="static">静态</option>
            <option value="other">其他</option>
          </select>
        </label>
        <button class="primary service-filter-refresh" type="button" :disabled="loading || !selectedServerID" data-testid="service-refresh" @click="refreshAll(true)">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
        <span
          class="service-systemd-capability"
          data-testid="service-systemd-capability"
          :data-short-label="statusShortText"
          :title="statusText"
        >
          {{ statusText }}
        </span>
      </div>

      <div v-if="onlineConnections.length === 0" class="service-empty">请先连接一台服务器。</div>
      <div v-else class="service-body">
        <ServiceManagerList
          :capability="capability"
          :raw-count="rawServices.length"
          :selected-unit-name="selectedUnitName"
          :services="filteredServices"
          @select="selectService"
        />
        <ServiceManagerDetails
          v-model:active-detail-tab="activeDetailTab"
          v-model:auto-scroll="journalAutoScroll"
          v-model:current-boot-only="journalCurrentBootOnly"
          v-model:line-limit="journalLineLimit"
          v-model:priority="journalPriority"
          v-model:query="journalQuery"
          v-model:word-wrap="journalWordWrap"
          :action-busy="actionBusy"
          :action-disabled="disabledActions"
          :capability="capability"
          :critical-warning-text="criticalWarningText"
          :detail="selectedDetail"
          :detail-error="detailError"
          :detail-loading="detailLoading"
          :journal-props="journalProps"
          :partial-warning-text="partialWarningText"
          :resource-metrics-supported="resourceMetricsSupported"
          :selected-service="selectedService"
          :show-critical-warning="showCriticalWarning"
          :show-partial-warning="showPartialWarning"
          @action="runServiceAction"
          @clear="clearJournalDisplay"
          @copy="copyVisibleJournal"
          @journal-scroll="onJournalScroll"
          @refresh="loadJournalSnapshot(true)"
          @toggle-follow="toggleJournalFollow"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.service-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 800);
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--glass-backdrop-bg);
  transform: translateZ(0);
}

.service-dialog {
  width: min(1120px, calc(100vw - 40px));
  height: min(720px, calc(100vh - 40px));
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--glass-border, var(--border, rgba(148, 163, 184, 0.22)));
  border-radius: 14px;
  background: var(--glass-surface-bg);
  color: var(--text, #e5edf8);
  box-shadow: var(--glass-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

.service-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--glass-border, var(--border, rgba(148, 163, 184, 0.18)));
  background: var(--glass-header-bg);
}

.service-dialog-header h2,
.service-dialog-header p {
  margin: 0;
}

.service-dialog-header h2 {
  font-size: 20px;
}

.service-dialog-header p {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.service-filter-toolbar {
  min-width: 0;
  min-height: 52px;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  overflow: hidden;
  box-sizing: border-box;
  padding: 9px 14px;
  border-bottom: 1px solid var(--glass-border, var(--border, rgba(148, 163, 184, 0.14)));
  background: var(--glass-header-bg);
}

.service-filter-inline {
  min-width: 0;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.service-filter-inline > span {
  flex: 0 0 auto;
}

.service-filter-server {
  flex: 0 0 auto;
}

.service-filter-server select {
  width: 124px;
}

.service-filter-search {
  flex: 1 1 180px;
}

.service-filter-search input {
  width: 100%;
  min-width: 130px;
}

.service-filter-status select,
.service-filter-startup select {
  width: 92px;
}

.service-filter-toolbar input,
.service-filter-toolbar select,
.service-filter-refresh {
  min-width: 0;
  height: 34px;
  min-height: 34px;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
}

.service-filter-refresh {
  flex: 0 0 auto;
  min-width: 76px;
  padding: 0 12px;
}

.service-systemd-capability {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 210px;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.service-body {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 12px 14px 14px;
  background: var(--glass-panel-bg);
}

.service-empty {
  margin: 0;
  padding: 18px;
  color: var(--muted, #9aa8ba);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: var(--glass-card-bg);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .service-dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .service-filter-toolbar {
    gap: 7px;
    padding: 8px 12px;
  }

  .service-filter-server select {
    width: 112px;
  }

  .service-filter-search input {
    min-width: 120px;
  }

  .service-filter-status select,
  .service-filter-startup select {
    width: 86px;
  }

  .service-systemd-capability {
    max-width: 136px;
    font-size: 0;
  }

  .service-systemd-capability::after {
    content: attr(data-short-label);
    font-size: 12px;
  }

  .service-body {
    grid-template-columns: minmax(280px, 36%) minmax(0, 1fr);
  }
}

@media (max-width: 780px) {
  .service-body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 38vh) minmax(0, 1fr);
    overflow: hidden;
  }
}

@media (max-width: 680px) {
  .service-filter-toolbar {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .service-filter-search {
    flex: 0 0 170px;
  }
}
</style>
