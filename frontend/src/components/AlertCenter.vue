<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AlertEvent } from '../types'
import { getViewportPopoverPosition } from '../utils/viewportPopover'

const props = defineProps<{
  open: boolean
  activeEvents: AlertEvent[]
  resolvedEvents: AlertEvent[]
  allEvents: AlertEvent[]
}>()

const emit = defineEmits<{
  close: []
  markRead: [eventID: string]
  markAllRead: []
  clearResolved: []
  muteServer: [serverID: number, mode: '30m' | '2h' | 'session']
  unmuteServer: [serverID: number]
  viewMonitor: [event: AlertEvent]
}>()

const activeTab = ref<'active' | 'resolved' | 'all'>('active')
const panel = ref<HTMLElement>()
const panelStyle = ref<Record<string, string>>({})
const visibleEvents = computed(() => {
  if (activeTab.value === 'resolved') return props.resolvedEvents
  if (activeTab.value === 'all') return props.allEvents
  return props.activeEvents
})

watch(() => props.open, (open) => {
  if (open) activeTab.value = 'active'
})

async function updatePanelPosition() {
  if (!props.open) return
  await nextTick()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  const bounds = panel.value?.getBoundingClientRect()
  const width = bounds && bounds.width > 0 ? bounds.width : 500
  const height = bounds && bounds.height > 0 ? bounds.height : Math.max(0, viewportHeight - 16)
  const position = getViewportPopoverPosition({
    anchorRect: {
      left: Math.max(8, viewportWidth - 8),
      top: 8,
      right: Math.max(8, viewportWidth - 8),
      bottom: 8,
      width: 0,
      height: 0,
    },
    popoverSize: { width, height },
    viewport: { width: viewportWidth, height: viewportHeight },
    placement: 'bottom-end',
    margin: 8,
    gap: 0,
  })
  panelStyle.value = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    width: `${position.width}px`,
    maxHeight: `${position.maxHeight}px`,
    transformOrigin: position.transformOrigin,
  }
}

watch(
  () => [
    props.open,
    props.activeEvents.length,
    props.resolvedEvents.length,
    props.allEvents.length,
  ] as const,
  updatePanelPosition,
  { immediate: true, flush: 'post' },
)

onMounted(() => {
  window.addEventListener('resize', updatePanelPosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePanelPosition)
})

function severityLabel(event: AlertEvent) {
  return event.severity === 'critical' ? '严重' : '警告'
}

function ruleLabel(event: AlertEvent) {
  const labels: Record<string, string> = {
    server_offline: '离线',
    cpu_high: 'CPU',
    memory_high: '内存',
    root_disk_high: '根分区',
    latency_high: '延迟',
    test: '测试',
  }
  return labels[event.ruleType] ?? event.ruleType
}

function timeLabel(value: string | undefined) {
  if (!value) return '—'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Date(value).toLocaleString()
}

function metricText(event: AlertEvent) {
  if (event.currentValue === undefined || event.threshold === undefined || !event.unit) return ''
  return `${event.currentValue}${event.unit} / ${event.threshold}${event.unit}`
}

function stateTimeText(event: AlertEvent) {
  if (event.state === 'resolved') return `已恢复 ${timeLabel(event.resolvedAt)}`
  if (event.state === 'interrupted') return '上次运行期间未确认恢复'
  return `触发 ${timeLabel(event.startedAt)}`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="alert-center-backdrop" data-testid="alert-center" @pointerdown.self="emit('close')">
      <aside ref="panel" class="viewport-popover alert-center-panel" :style="panelStyle" @pointerdown.stop>
        <header>
          <div>
            <h2>告警中心</h2>
            <small>告警历史和已读状态保存在本机，静音仅在本次运行期间有效。</small>
          </div>
          <button type="button" class="dialog-close-button" @click="emit('close')">关闭</button>
        </header>
        <nav class="alert-center-tabs" aria-label="告警筛选">
          <button :class="{ active: activeTab === 'active' }" @click="activeTab = 'active'">进行中 {{ activeEvents.length }}</button>
          <button :class="{ active: activeTab === 'resolved' }" @click="activeTab = 'resolved'">已恢复 {{ resolvedEvents.length }}</button>
          <button :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">全部 {{ allEvents.length }}</button>
        </nav>
        <div class="alert-center-actions">
          <button type="button" class="secondary" @click="emit('markAllRead')">全部标记已读</button>
          <button type="button" class="secondary" @click="emit('clearResolved')">清除已恢复</button>
        </div>
        <div class="alert-center-list">
          <p v-if="visibleEvents.length === 0" class="alert-center-empty">暂无告警。</p>
          <article
            v-for="event in visibleEvents"
            :key="event.eventID"
            class="alert-row"
            :class="[`is-${event.severity}`, {
              unread: !event.read,
              muted: event.muted,
              resolved: event.state === 'resolved',
              interrupted: event.state === 'interrupted',
            }]"
          >
            <div class="alert-row-main" @click="emit('viewMonitor', event)">
              <div class="alert-row-title">
                <span class="alert-severity">{{ severityLabel(event) }}</span>
                <strong>{{ event.title }}</strong>
                <span>{{ ruleLabel(event) }}</span>
              </div>
              <p>{{ event.message }}</p>
              <small>
                {{ event.serverName }}
                <span v-if="metricText(event)"> · {{ metricText(event) }}</span>
                <span> · {{ stateTimeText(event) }}</span>
                <span v-if="event.muted"> · 已静音</span>
              </small>
            </div>
            <div class="alert-row-actions">
              <button type="button" class="text-button" @click="emit('viewMonitor', event)">查看监控</button>
              <button v-if="!event.read" type="button" class="text-button" @click="emit('markRead', event.eventID)">已读</button>
              <template v-if="event.serverID > 0">
                <button v-if="event.muted" type="button" class="text-button" @click="emit('unmuteServer', event.serverID)">取消静音</button>
                <button v-else type="button" class="text-button" @click="emit('muteServer', event.serverID, '30m')">静音 30 分钟</button>
                <button v-if="!event.muted" type="button" class="text-button" @click="emit('muteServer', event.serverID, '2h')">2 小时</button>
                <button v-if="!event.muted" type="button" class="text-button" @click="emit('muteServer', event.serverID, 'session')">本次运行</button>
              </template>
            </div>
          </article>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
