<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Connection, ConnectionStatus, Group, ReorderServersRequest } from '../types'
import { getViewportPopoverPosition } from '../utils/viewportPopover'
import AppIcon from './icons/AppIcon.vue'

const SERVER_DRAG_THRESHOLD = 6

const props = defineProps<{
  open: boolean
  anchor: HTMLElement | null
  groups: Array<{ id: number; name: string; items: Connection[] }>
  statuses: Record<number, ConnectionStatus>
  activeServerId: number | null
  localTerminalEnabled: boolean
  query: string
  outsideIgnoreSelector?: string
  targetPaneMode?: boolean
}>()
const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  addServer: []
  addGroup: []
  openLocalTerminal: [shellKind: 'cmd' | 'powershell']
  openServer: [connection: Connection]
  editServer: [connection: Connection]
  deleteServer: [connection: Connection]
  deleteGroup: [group: Group]
  reorderServer: [request: ReorderServersRequest]
  contextMenu: [event: MouseEvent, connection: Connection]
}>()
const popover = ref<HTMLElement>()
const listBody = ref<HTMLElement>()
const listContent = ref<HTMLElement>()
const pickerHeader = ref<HTMLElement>()
const pickerActions = ref<HTMLElement>()
const dragHint = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const position = ref<Record<string, string>>({ left: '8px', top: '50px' })
const listScrollable = ref(false)
const listHeight = ref(0)
const allConnections = computed(() => props.groups.flatMap((group) => group.items))
const layoutSignature = computed(() =>
  props.groups.map((group) => `${group.id}:${group.items.length}`).join('|'))
const dragState = ref<{
  serverID: number
  sourceGroupID: number | null
  startX: number
  startY: number
  active: boolean
} | null>(null)
const draggingServerId = ref<number | null>(null)
const dropTarget = ref<{
  targetGroupID: number | null
  beforeServerID: number | null
  afterServerID: number | null
  rowID: number | null
  before: boolean
} | null>(null)
const suppressClickServerId = ref<number | null>(null)
const searchDragDisabled = computed(() => props.query.trim().length > 0)

async function updatePosition() {
  if (!props.open || !props.anchor) return
  await nextTick()
  clampPanelScroll()
  const anchor = props.anchor.getBoundingClientRect()
  const bounds = popover.value?.getBoundingClientRect()
  const width = bounds && bounds.width > 0 ? bounds.width : 380
  const panelChromeHeight = getPanelChromeHeight()
  const listNaturalHeight = getListNaturalHeight()
  const contentHeight = panelChromeHeight + listNaturalHeight
  const requestedHeight = contentHeight > 0 ? contentHeight : bounds && bounds.height > 0 ? bounds.height : 620
  const result = getViewportPopoverPosition({
    anchorRect: anchor,
    popoverSize: { width, height: requestedHeight },
    viewport: {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    },
    placement: 'bottom-start',
    boundsRect: getWorkspaceBounds(anchor),
    margin: 8,
    gap: 6,
  })
  const availableListHeight = Math.max(0, result.maxHeight - panelChromeHeight)
  const nextListHeight = Math.round(Math.max(0, Math.min(listNaturalHeight, availableListHeight)))
  const isScrollable = listNaturalHeight > availableListHeight + 1
  listScrollable.value = isScrollable
  listHeight.value = nextListHeight
  const panelHeight = Math.round(panelChromeHeight + nextListHeight)
  position.value = {
    left: `${result.left}px`,
    top: `${result.top}px`,
    width: `${result.width}px`,
    height: `${panelHeight}px`,
    maxHeight: `${result.maxHeight}px`,
    '--server-picker-panel-max-height': `${result.maxHeight}px`,
    '--server-picker-list-height': `${nextListHeight}px`,
    '--server-picker-list-overflow-y': isScrollable ? 'auto' : 'hidden',
    '--server-picker-list-row-size': `${nextListHeight}px`,
    '--server-picker-list-scrollbar-gutter': 'auto',
    transformOrigin: result.transformOrigin,
  }
  clampListScroll()
  clampPanelScroll()
}

function getWorkspaceBounds(anchor: DOMRect) {
  const workspace = props.anchor?.closest<HTMLElement>('.workspace-shell')
  const terminalStage = workspace?.querySelector<HTMLElement>('.terminal-stage')
  const rect = terminalStage?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0 && rect.bottom > anchor.bottom) {
    return shrinkBottom(rect, 6)
  }
  const workspaceRect = workspace?.getBoundingClientRect()
  if (workspaceRect && workspaceRect.width > 0 && workspaceRect.height > 0 && workspaceRect.bottom > anchor.bottom) {
    return shrinkBottom(workspaceRect, 6)
  }
  return null
}

function shrinkBottom(rect: DOMRect, gap: number) {
  const bottom = Math.max(rect.top, rect.bottom - gap)
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom,
    width: rect.width,
    height: Math.max(0, bottom - rect.top),
  }
}

function getPanelChromeHeight() {
  const extras = boxVerticalExtras(popover.value)
  const measured = measureHeight(pickerHeader.value) +
    measureHeight(pickerActions.value) +
    measureHeight(dragHint.value) +
    extras
  if (measured > extras) return measured
  const list = listBody.value
  const panel = popover.value
  const listTop = list?.offsetTop ?? 0
  if (listTop > 0) return listTop + extras
  const panelScrollHeight = panel?.scrollHeight ?? 0
  const listScrollHeight = list?.scrollHeight ?? 0
  const fallback = panelScrollHeight > listScrollHeight
    ? Math.max(0, panelScrollHeight - listScrollHeight)
    : 0
  return fallback > 0 ? fallback : props.targetPaneMode ? 132 : 112
}

function getListNaturalHeight() {
  const list = listBody.value
  if (!list) return 0
  const contentHeight = getElementNaturalHeight(listContent.value ?? list)
  if (contentHeight > 0) return contentHeight
  const scrollHeight = list.scrollHeight
  if (scrollHeight > 0) return scrollHeight
  return measureHeight(list)
}

function getElementNaturalHeight(element: HTMLElement): number {
  const scrollHeight = element.scrollHeight
  const measuredHeight = measureHeight(element)
  const childrenHeight = shouldMeasureStackedChildren(element) ? getChildrenNaturalHeight(element) : 0
  if (element.classList.contains('server-group') && childrenHeight > 0) {
    return Math.max(childrenHeight, measuredHeight)
  }
  if (childrenHeight > 0) return childrenHeight
  return Math.max(scrollHeight, measuredHeight)
}

function shouldMeasureStackedChildren(element: HTMLElement) {
  return element.classList.contains('server-picker-list') ||
    element.classList.contains('server-picker-list-content') ||
    element.classList.contains('server-group')
}

function getChildrenNaturalHeight(element: HTMLElement): number {
  const childrenHeight = Array.from(element.children).reduce<number>((total, child) => {
    return total + measureOuterNaturalHeight(child as HTMLElement)
  }, 0)
  if (childrenHeight <= 0) return 0
  const styles = window.getComputedStyle(element)
  return childrenHeight + parseCSSPixels(styles.paddingTop) + parseCSSPixels(styles.paddingBottom)
}

function measureHeight(element?: HTMLElement) {
  if (!element) return 0
  const rect = element.getBoundingClientRect()
  if (rect.height > 0) return rect.height
  return element.offsetHeight || 0
}

function measureOuterNaturalHeight(element?: HTMLElement): number {
  if (!element) return 0
  const height = getElementNaturalHeight(element)
  if (height <= 0) return 0
  const styles = window.getComputedStyle(element)
  return height + parseCSSPixels(styles.marginTop) + parseCSSPixels(styles.marginBottom)
}

function boxVerticalExtras(element?: HTMLElement) {
  if (!element) return 0
  const styles = window.getComputedStyle(element)
  return parseCSSPixels(styles.paddingTop) +
    parseCSSPixels(styles.paddingBottom) +
    parseCSSPixels(styles.borderTopWidth) +
    parseCSSPixels(styles.borderBottomWidth)
}

function parseCSSPixels(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampPanelScroll() {
  if (popover.value) popover.value.scrollTop = 0
}

function clampListScroll() {
  const list = listBody.value
  if (!list) return
  if (!listScrollable.value) {
    list.scrollTop = 0
    return
  }
  const viewportHeight = list.clientHeight || listHeight.value
  const maxScrollTop = Math.max(0, list.scrollHeight - viewportHeight)
  list.scrollTop = Math.min(Math.max(list.scrollTop, 0), maxScrollTop)
}

function resetListScroll() {
  if (listBody.value) listBody.value.scrollTop = 0
}

function handlePickerWheel(event: WheelEvent) {
  const list = listBody.value
  clampPanelScroll()
  event.preventDefault()
  event.stopPropagation()
  if (!list) {
    return
  }
  const fromList = (event.target as HTMLElement | null)?.closest('.server-picker-list')
  if (!fromList) return
  if (!listScrollable.value) {
    list.scrollTop = 0
    return
  }
  const viewportHeight = list.clientHeight || listHeight.value
  const maxScrollTop = Math.max(0, list.scrollHeight - viewportHeight)
  if (maxScrollTop <= 0) return
  list.scrollTop = Math.min(Math.max(list.scrollTop + event.deltaY, 0), maxScrollTop)
}

function handleListScroll() {
  clampListScroll()
  clampPanelScroll()
}

function closeOnPointer(event: PointerEvent) {
  if (!props.open) return
  const path = event.composedPath()
  if (popover.value && path.includes(popover.value)) return
  if (props.anchor && path.includes(props.anchor)) return
  if (isInsideOutsideIgnore(path)) return
  emit('close')
}

function closeOnKey(event: KeyboardEvent) {
  if (!props.open || event.key !== 'Escape') return
  if (hasOutsideIgnoreElement()) return
  emit('close')
}

function closeOnBlur() {
  if (props.open) emit('close')
}

function openServer(connection: Connection) {
  if (suppressClickServerId.value === connection.id) {
    suppressClickServerId.value = null
    return
  }
  emit('openServer', connection)
}

function jumpLabel(connection: Connection) {
  if ((connection.connectionMode ?? 'direct') !== 'jump') return ''
  if (!connection.jumpServerId) return '经由：需重选'
  const jump = allConnections.value.find((item) => item.id === connection.jumpServerId)
  return jump ? `经由：${jump.name}` : '经由：需重选'
}

function normalizeGroupID(groupID: number) {
  return groupID > 0 ? groupID : null
}

function groupItems(groupID: number | null) {
  const key = groupID ?? 0
  return props.groups.find((group) => group.id === key)?.items ?? []
}

function startServerDrag(event: PointerEvent, connection: Connection, groupID: number) {
  if (searchDragDisabled.value) return
  if (event.button !== 0) return
  if ((event.target as HTMLElement).closest('.server-row-actions')) return
  dragState.value = {
    serverID: connection.id,
    sourceGroupID: normalizeGroupID(groupID),
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  }
  window.addEventListener('pointermove', moveServerDrag, true)
  window.addEventListener('pointerup', endServerDrag, true)
}

function isInsideOutsideIgnore(path: EventTarget[]) {
  const selector = props.outsideIgnoreSelector
  if (!selector) return false
  return path.some((target) => target instanceof Element && (
    target.matches(selector) || Boolean(target.closest(selector))
  ))
}

function hasOutsideIgnoreElement() {
  const selector = props.outsideIgnoreSelector
  return Boolean(selector && document.querySelector(selector))
}

function openContextMenu(event: MouseEvent, connection: Connection) {
  if (dragState.value) cleanupServerDrag()
  emit('contextMenu', event, connection)
}

function targetFromPointer(event: PointerEvent) {
  const element = document.elementFromPoint?.(event.clientX, event.clientY) as HTMLElement | null
  const groupEl = element?.closest<HTMLElement>('[data-group-id]')
  if (!groupEl) return null
  const targetGroupID = normalizeGroupID(Number(groupEl.dataset.groupId ?? 0))
  const rowEl = element?.closest<HTMLElement>('[data-server-id]')
  if (rowEl && groupEl.contains(rowEl)) {
    const rowID = Number(rowEl.dataset.serverId ?? 0)
    if (!rowID || rowID === dragState.value?.serverID) return null
    const bounds = rowEl.getBoundingClientRect()
    const before = event.clientY < bounds.top + bounds.height / 2
    return {
      targetGroupID,
      beforeServerID: before ? rowID : null,
      afterServerID: before ? null : rowID,
      rowID,
      before,
    }
  }
  const items = groupItems(targetGroupID).filter((item) => item.id !== dragState.value?.serverID)
  const last = items.at(-1)
  return {
    targetGroupID,
    beforeServerID: null,
    afterServerID: last?.id ?? null,
    rowID: null,
    before: false,
  }
}

function moveServerDrag(event: PointerEvent) {
  const state = dragState.value
  if (!state) return
  const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
  if (!state.active) {
    if (distance < SERVER_DRAG_THRESHOLD) return
    state.active = true
    draggingServerId.value = state.serverID
    document.body.classList.add('server-row-dragging-active')
  }
  event.preventDefault()
  dropTarget.value = targetFromPointer(event)
}

function cleanupServerDrag() {
  window.removeEventListener('pointermove', moveServerDrag, true)
  window.removeEventListener('pointerup', endServerDrag, true)
  document.body.classList.remove('server-row-dragging-active')
  dragState.value = null
  draggingServerId.value = null
  dropTarget.value = null
}

function endServerDrag(event: PointerEvent) {
  const state = dragState.value
  const target = dropTarget.value
  if (state?.active) {
    event.preventDefault()
    suppressClickServerId.value = state.serverID
    window.setTimeout(() => {
      if (suppressClickServerId.value === state.serverID) suppressClickServerId.value = null
    }, 0)
    if (target) {
      emit('reorderServer', {
        serverID: state.serverID,
        sourceGroupID: state.sourceGroupID,
        targetGroupID: target.targetGroupID,
        beforeServerID: target.beforeServerID,
        afterServerID: target.afterServerID,
      })
    }
  }
  cleanupServerDrag()
}

watch(() => props.open, async (open) => {
  if (!open) return
  resetListScroll()
  await updatePosition()
  searchInput.value?.focus()
}, { immediate: true })

watch([layoutSignature, () => props.query, () => props.targetPaneMode], () => {
  resetListScroll()
  void updatePosition()
})

onMounted(() => {
  window.addEventListener('pointerdown', closeOnPointer, true)
  window.addEventListener('keydown', closeOnKey, true)
  window.addEventListener('blur', closeOnBlur)
  window.addEventListener('resize', updatePosition)
  document.addEventListener('scroll', updatePosition, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeOnPointer, true)
  window.removeEventListener('keydown', closeOnKey, true)
  window.removeEventListener('blur', closeOnBlur)
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('scroll', updatePosition, true)
  cleanupServerDrag()
})
</script>

<template>
  <Teleport to="body">
    <section
      v-if="open"
      ref="popover"
      class="viewport-popover viewport-popover-scroll server-picker"
      :style="position"
      data-testid="server-picker"
      @wheel.capture="handlePickerWheel"
    >
      <header ref="pickerHeader">
        <strong v-if="targetPaneMode" class="server-picker-target-title">连接到当前窗格</strong>
        <input
          ref="searchInput"
          :value="query"
          placeholder="搜索服务器或主机"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        />
      </header>
      <div ref="pickerActions" class="server-picker-actions">
        <button type="button" @click="emit('addServer')"><AppIcon name="server-plus" :size="18" /><span>添加服务器</span></button>
        <span class="action-separator server-picker-action-separator" aria-hidden="true"></span>
        <button type="button" @click="emit('addGroup')"><AppIcon name="folder-plus" :size="18" /><span>添加分组</span></button>
        <span class="action-separator server-picker-action-separator" aria-hidden="true"></span>
        <button type="button" :disabled="!localTerminalEnabled" @click="emit('openLocalTerminal', 'cmd')"><AppIcon name="terminal" :size="18" /><span>CMD</span></button>
        <span class="action-separator server-picker-action-separator" aria-hidden="true"></span>
        <button type="button" :disabled="!localTerminalEnabled" @click="emit('openLocalTerminal', 'powershell')"><AppIcon name="powershell" :size="18" /><span>PowerShell</span></button>
      </div>
      <p v-if="searchDragDisabled" ref="dragHint" class="server-picker-drag-hint">清空搜索后可拖动排序</p>
      <div ref="listBody" class="server-picker-list" @scroll="handleListScroll">
        <div ref="listContent" class="server-picker-list-content">
        <section
          v-for="group in groups"
          :key="group.id"
          class="server-group"
          :class="{ 'group-drop-target': dropTarget?.rowID === null && dropTarget?.targetGroupID === normalizeGroupID(group.id) }"
          :data-group-id="group.id"
        >
          <header>
            <span>{{ group.name }}</span>
            <button
              v-if="group.id"
              title="删除分组"
              @click.stop="emit('deleteGroup', { id: group.id, name: group.name })"
            >×</button>
          </header>
          <div
            v-for="connection in group.items"
            :key="connection.id"
            class="server-row"
            :class="{
              active: connection.id === activeServerId,
              dragging: draggingServerId === connection.id,
              'drop-before': dropTarget?.rowID === connection.id && dropTarget.before,
              'drop-after': dropTarget?.rowID === connection.id && !dropTarget.before,
            }"
            :data-server-id="connection.id"
            role="button"
            tabindex="0"
            @pointerdown="startServerDrag($event, connection, group.id)"
            @click="openServer(connection)"
            @dblclick.prevent="openServer(connection)"
            @keydown.enter.prevent="openServer(connection)"
            @contextmenu.prevent.stop="openContextMenu($event, connection)"
          >
            <span class="status-dot" :class="statuses[connection.id] ?? 'offline'"></span>
            <strong :title="connection.name">{{ connection.name }}</strong>
            <small :title="jumpLabel(connection) ? `${connection.host}:${connection.port} · ${jumpLabel(connection)}` : `${connection.host}:${connection.port}`">
              {{ connection.host }}:{{ connection.port }}<template v-if="jumpLabel(connection)"> · {{ jumpLabel(connection) }}</template>
            </small>
            <span class="server-row-actions">
              <button
                type="button"
                class="server-row-action edit-action"
                title="编辑服务器"
                @pointerdown.stop
                @contextmenu.prevent.stop
                @dblclick.stop
                @click.stop="emit('editServer', connection)"
              >编辑</button>
              <button
                type="button"
                class="server-row-action delete-action danger-link"
                title="删除服务器"
                @pointerdown.stop
                @contextmenu.prevent.stop
                @dblclick.stop
                @click.stop="emit('deleteServer', connection)"
              >删除</button>
            </span>
          </div>
        </section>
        <p v-if="groups.every((group) => group.items.length === 0)" class="empty-side">暂无服务器</p>
        </div>
      </div>
    </section>
  </Teleport>
</template>
