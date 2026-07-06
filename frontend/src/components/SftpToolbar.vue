<script lang="ts">
export type SftpToolbarActionId =
  | 'reconnect'
  | 'back'
  | 'forward'
  | 'refresh'
  | 'parent'
  | 'home'
  | 'bookmark'
  | 'bookmarks'
  | 'open'
  | 'mkdir'
  | 'new-file'
  | 'upload'
  | 'upload-directory'
  | 'download'
  | 'scp-download-directory'
  | 'properties'
  | 'delete'
  | 'rename'
  | 'hidden'
  | 'conflict-policy'

export type SftpToolbarAction = {
  id: SftpToolbarActionId
  label: string
  tone?: 'secondary' | 'danger'
  className?: string
  disabled?: boolean
  active?: boolean
  show?: boolean
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SFTPConflictPolicy } from '../types'
import type { SftpPathBookmark } from '../utils/sftpPathState'
import { fitToolbarActionIds } from '../utils/sftpToolbarLayout'
import { getViewportPopoverPosition } from '../utils/viewportPopover'

const TOOLBAR_GAP = 6
const TOOLBAR_HORIZONTAL_PADDING = 16
const TOOLBAR_PATH_MIN_WIDTH = 180
const TOOLBAR_FILTER_MIN_WIDTH = 160
const TOOLBAR_INLINE_TRANSFER_RESERVE = 96
const TOOLBAR_MORE_FALLBACK_WIDTH = 96
const TOOLBAR_POPOVER_MARGIN = 8
const TOOLBAR_POPOVER_GAP = 6
const TOOLBAR_MORE_MENU_WIDTH = 128
const TOOLBAR_BOOKMARK_MENU_WIDTH = 280
const TOOLBAR_MORE_MENU_HEIGHT = 320
const TOOLBAR_BOOKMARK_MENU_HEIGHT = 360
const TOOLBAR_ACTION_FALLBACK_WIDTHS: Record<SftpToolbarActionId, number> = {
  reconnect: 78,
  back: 54,
  forward: 54,
  refresh: 54,
  parent: 54,
  home: 54,
  bookmark: 54,
  bookmarks: 66,
  open: 54,
  mkdir: 82,
  'new-file': 82,
  upload: 54,
  'upload-directory': 88,
  download: 54,
  'scp-download-directory': 78,
  properties: 54,
  delete: 54,
  rename: 66,
  hidden: 106,
  'conflict-policy': 112,
}

const props = defineProps<{
  actions: SftpToolbarAction[]
  currentPath: string
  pathInput: string
  scpMode: boolean
  online: boolean
  showFileFilter: boolean
  filterQuery: string
  filterActive: boolean
  filterStatus: string
  conflictPolicy: SFTPConflictPolicy
  bookmarks: SftpPathBookmark[]
  latestTransferSummary: string
}>()

const emit = defineEmits<{
  'update:pathInput': [value: string]
  submitPath: []
  'update:filterQuery': [value: string]
  filterKeydown: [event: KeyboardEvent]
  clearFilter: []
  'update:conflictPolicy': [value: SFTPConflictPolicy]
  action: [id: SftpToolbarActionId]
  jumpBookmark: [bookmark: SftpPathBookmark]
  deleteBookmark: [bookmarkId: string]
}>()

const moreOpen = ref(false)
const bookmarkMenuOpen = ref(false)
const toolbarRef = ref<HTMLElement | null>(null)
const toolbarMeasureRef = ref<HTMLElement | null>(null)
const moreButtonRef = ref<HTMLElement | null>(null)
const fileFilterInputRef = ref<HTMLInputElement | null>(null)
const toolbarAvailableWidth = ref(Number.POSITIVE_INFINITY)
const toolbarActionWidths = ref<Record<SftpToolbarActionId, number>>({ ...TOOLBAR_ACTION_FALLBACK_WIDTHS })
const toolbarMoreWidth = ref(TOOLBAR_MORE_FALLBACK_WIDTH)
const moreMenuStyle = ref<Record<string, string>>({})
const bookmarkMenuStyle = ref<Record<string, string>>({})

let toolbarResizeObserver: ResizeObserver | null = null
let toolbarLayoutFrame = 0
let bookmarkMenuAnchor: HTMLElement | null = null

const toolbarActionSignature = computed(() => props.actions.map((action) => action.id).join('|'))
const visibleToolbarActionIds = computed(() => fitToolbarActionIds(props.actions, {
  availableWidth: toolbarAvailableWidth.value,
  actionWidths: toolbarActionWidths.value,
  fallbackActionWidths: TOOLBAR_ACTION_FALLBACK_WIDTHS,
  moreWidth: toolbarMoreWidth.value,
  gap: TOOLBAR_GAP,
  horizontalPadding: TOOLBAR_HORIZONTAL_PADDING,
  pathMinWidth: TOOLBAR_PATH_MIN_WIDTH,
  filterMinWidth: TOOLBAR_FILTER_MIN_WIDTH,
  showFilter: props.showFileFilter,
  inlineTransferReserve: TOOLBAR_INLINE_TRANSFER_RESERVE,
  hasTransfer: Boolean(props.latestTransferSummary),
}))
const visibleToolbarActionSet = computed(() => new Set(visibleToolbarActionIds.value))
const visibleToolbarActions = computed(() => props.actions.filter((action) => visibleToolbarActionSet.value.has(action.id)))
const overflowToolbarActions = computed(() => props.actions.filter((action) => !visibleToolbarActionSet.value.has(action.id)))

function toolbarButtonClasses(action: SftpToolbarAction) {
  return [
    'sftp-toolbar-menu-action',
    { 'sftp-toolbar-menu-action-danger': action.tone === 'danger' },
    action.className,
    { active: action.active },
  ]
}

function toolbarMoreItemClasses(action: SftpToolbarAction) {
  return [
    'viewport-popover-compact-item',
    'sftp-toolbar-more-item',
    {
      active: action.active,
      'sftp-toolbar-more-item-danger': action.tone === 'danger',
    },
  ]
}

function toolbarActionTitle(action: SftpToolbarAction) {
  if (action.id === 'properties' && action.disabled) return '请选择一个项目'
  return action.label
}

function measureToolbarLayout() {
  const toolbar = toolbarRef.value
  const rawWidth = toolbar?.clientWidth || toolbar?.getBoundingClientRect().width || 0
  toolbarAvailableWidth.value = rawWidth > 0 ? rawWidth : Number.POSITIVE_INFINITY

  const nextWidths = { ...TOOLBAR_ACTION_FALLBACK_WIDTHS }
  toolbarMeasureRef.value?.querySelectorAll<HTMLElement>('[data-measure-toolbar-action-id]').forEach((element) => {
    const id = element.dataset.measureToolbarActionId as SftpToolbarActionId | undefined
    if (!id || !(id in nextWidths)) return
    const measured = element.getBoundingClientRect().width || element.offsetWidth
    if (measured > 0) nextWidths[id] = Math.ceil(measured)
  })
  const more = toolbarMeasureRef.value?.querySelector<HTMLElement>('[data-measure-toolbar-more]')
  const measuredMore = more ? more.getBoundingClientRect().width || more.offsetWidth : 0
  toolbarActionWidths.value = nextWidths
  toolbarMoreWidth.value = measuredMore > 0
    ? Math.max(TOOLBAR_MORE_FALLBACK_WIDTH, Math.ceil(measuredMore))
    : TOOLBAR_MORE_FALLBACK_WIDTH
  if (moreOpen.value) updateMoreMenuPosition()
  if (bookmarkMenuOpen.value) updateBookmarkMenuPosition()
}

function scheduleToolbarLayout() {
  if (toolbarLayoutFrame) return
  const runFrame = () => {
    toolbarLayoutFrame = 0
    measureToolbarLayout()
  }
  if (typeof window.requestAnimationFrame === 'function') {
    toolbarLayoutFrame = window.requestAnimationFrame(runFrame)
  } else {
    runFrame()
  }
}

function connectToolbarObserver() {
  toolbarResizeObserver?.disconnect()
  toolbarResizeObserver = null
  if (typeof ResizeObserver === 'undefined') return
  toolbarResizeObserver = new ResizeObserver(scheduleToolbarLayout)
  if (toolbarRef.value) toolbarResizeObserver.observe(toolbarRef.value)
  if (toolbarMeasureRef.value) toolbarResizeObserver.observe(toolbarMeasureRef.value)
}

function viewportSize() {
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  }
}

function updateMoreMenuPosition() {
  const button = moreButtonRef.value
  if (!button || !moreOpen.value) return
  const rect = button.getBoundingClientRect()
  const viewport = viewportSize()
  const width = Math.min(TOOLBAR_MORE_MENU_WIDTH, Math.max(96, viewport.width - TOOLBAR_POPOVER_MARGIN * 2))
  const spaceBelow = viewport.height - rect.bottom - TOOLBAR_POPOVER_MARGIN - TOOLBAR_POPOVER_GAP
  const spaceAbove = rect.top - TOOLBAR_POPOVER_MARGIN - TOOLBAR_POPOVER_GAP
  const placeAbove = spaceBelow < Math.min(TOOLBAR_MORE_MENU_HEIGHT, 180) && spaceAbove > spaceBelow
  const availableHeight = Math.max(80, placeAbove ? spaceAbove : spaceBelow)
  const maxHeight = Math.min(TOOLBAR_MORE_MENU_HEIGHT, availableHeight)
  const left = Math.min(
    viewport.width - TOOLBAR_POPOVER_MARGIN - width,
    Math.max(TOOLBAR_POPOVER_MARGIN, rect.right - width),
  )
  const style: Record<string, string> = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
    transformOrigin: placeAbove ? 'bottom right' : 'top right',
  }
  if (placeAbove) {
    style.bottom = `${Math.round(Math.max(TOOLBAR_POPOVER_MARGIN, viewport.height - rect.top + TOOLBAR_POPOVER_GAP))}px`
  } else {
    const top = Math.min(viewport.height - TOOLBAR_POPOVER_MARGIN - maxHeight, rect.bottom + TOOLBAR_POPOVER_GAP)
    style.top = `${Math.round(top)}px`
  }
  moreMenuStyle.value = style
}

function updateBookmarkMenuPosition(anchor?: HTMLElement | null) {
  if (anchor) bookmarkMenuAnchor = anchor
  const targetAnchor = bookmarkMenuAnchor
    ?? toolbarRef.value?.querySelector<HTMLElement>('[data-testid="sftp-toolbar-action-bookmarks"]')
    ?? document.body.querySelector<HTMLElement>('[data-testid="sftp-more-action-bookmarks"]')
  if (!targetAnchor || !bookmarkMenuOpen.value) return
  bookmarkMenuAnchor = targetAnchor
  const rect = targetAnchor.getBoundingClientRect()
  const position = getViewportPopoverPosition({
    anchorRect: rect,
    popoverSize: { width: TOOLBAR_BOOKMARK_MENU_WIDTH, height: TOOLBAR_BOOKMARK_MENU_HEIGHT },
    viewport: viewportSize(),
    placement: 'bottom-end',
    margin: TOOLBAR_POPOVER_MARGIN,
    gap: TOOLBAR_POPOVER_GAP,
  })
  bookmarkMenuStyle.value = {
    position: 'fixed',
    top: `${Math.round(position.top)}px`,
    left: `${Math.round(position.left)}px`,
    width: `${Math.round(position.width)}px`,
    maxHeight: `${Math.round(position.maxHeight)}px`,
    transformOrigin: position.transformOrigin,
  }
}

function updateFloatingMenuPositions() {
  updateMoreMenuPosition()
  updateBookmarkMenuPosition()
}

async function toggleMore() {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) {
    await nextTick()
    updateMoreMenuPosition()
  }
}

async function toggleBookmarkMenu(event?: MouseEvent) {
  moreOpen.value = false
  bookmarkMenuOpen.value = !bookmarkMenuOpen.value
  if (bookmarkMenuOpen.value) {
    await nextTick()
    updateBookmarkMenuPosition(event?.currentTarget as HTMLElement | null)
  }
}

function emitAction(action: SftpToolbarAction, event?: MouseEvent) {
  if (action.disabled) return
  if (action.id === 'bookmarks') {
    void toggleBookmarkMenu(event)
    return
  }
  moreOpen.value = false
  emit('action', action.id)
}

function updatePathInput(event: Event) {
  emit('update:pathInput', (event.target as HTMLInputElement).value)
}

function updateFilterQuery(event: Event) {
  emit('update:filterQuery', (event.target as HTMLInputElement).value)
}

function updateConflictPolicy(event: Event, closeMore = false) {
  emit('update:conflictPolicy', (event.target as HTMLSelectElement).value as SFTPConflictPolicy)
  if (closeMore) moreOpen.value = false
}

function jumpBookmark(bookmark: SftpPathBookmark) {
  emit('jumpBookmark', bookmark)
}

function deleteBookmark(bookmarkId: string) {
  emit('deleteBookmark', bookmarkId)
}

function focusFilter() {
  fileFilterInputRef.value?.focus()
}

function closeBookmarkMenu() {
  bookmarkMenuOpen.value = false
}

function closeFloatingMenus(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (!target.closest('.sftp-more, .sftp-more-menu')) moreOpen.value = false
  if (!target.closest('.sftp-bookmarks-menu, [data-testid="sftp-toolbar-action-bookmarks"], [data-testid="sftp-more-action-bookmarks"]')) {
    bookmarkMenuOpen.value = false
  }
}

function closeMenusOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!moreOpen.value && !bookmarkMenuOpen.value)) return
  event.stopPropagation()
  moreOpen.value = false
  bookmarkMenuOpen.value = false
}

watch(toolbarActionSignature, async () => {
  await nextTick()
  scheduleToolbarLayout()
})

watch(() => [props.showFileFilter, props.latestTransferSummary, props.filterActive], async () => {
  await nextTick()
  scheduleToolbarLayout()
})

watch(() => overflowToolbarActions.value.length, async (count) => {
  if (count === 0) {
    moreOpen.value = false
    return
  }
  if (moreOpen.value) {
    await nextTick()
    updateMoreMenuPosition()
  }
})

onMounted(() => {
  window.addEventListener('pointerdown', closeFloatingMenus, true)
  window.addEventListener('keydown', closeMenusOnEscape, true)
  window.addEventListener('resize', scheduleToolbarLayout)
  window.addEventListener('scroll', updateFloatingMenuPositions, true)
  void nextTick(() => {
    connectToolbarObserver()
    scheduleToolbarLayout()
  })
})

onBeforeUnmount(() => {
  if (toolbarLayoutFrame && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(toolbarLayoutFrame)
  toolbarLayoutFrame = 0
  toolbarResizeObserver?.disconnect()
  toolbarResizeObserver = null
  window.removeEventListener('pointerdown', closeFloatingMenus, true)
  window.removeEventListener('keydown', closeMenusOnEscape, true)
  window.removeEventListener('resize', scheduleToolbarLayout)
  window.removeEventListener('scroll', updateFloatingMenuPositions, true)
})

defineExpose({ focusFilter, closeBookmarkMenu })
</script>

<template>
  <div ref="toolbarRef" class="sftp-toolbar">
    <form class="sftp-pathbar sftp-toolbar-path" @submit.prevent="$emit('submitPath')">
      <span class="sftp-path-label">{{ scpMode ? 'SCP 远程路径' : '远程路径' }}</span>
      <input
        :value="pathInput"
        :disabled="!online"
        :title="pathInput"
        @input="updatePathInput"
      />
    </form>
    <div v-if="showFileFilter" class="sftp-filterbar" :class="{ active: filterActive }">
      <input
        ref="fileFilterInputRef"
        :value="filterQuery"
        class="sftp-filter-input"
        type="search"
        placeholder="过滤当前目录"
        aria-label="过滤当前目录"
        :disabled="!online"
        data-testid="sftp-file-filter"
        @input="updateFilterQuery"
        @keydown="$emit('filterKeydown', $event)"
      />
      <span
        v-if="filterActive"
        class="sftp-filter-status"
        data-testid="sftp-filter-status"
      >{{ filterStatus }}</span>
      <button
        v-if="filterActive"
        type="button"
        class="sftp-filter-clear"
        title="清除过滤"
        aria-label="清除过滤"
        data-testid="sftp-file-filter-clear"
        @click="$emit('clearFilter')"
      >清除过滤</button>
    </div>
    <template v-for="(action, index) in visibleToolbarActions" :key="action.id">
      <span
        v-if="index > 0"
        class="sftp-toolbar-action-separator"
        aria-hidden="true"
      >|</span>
      <select
        v-if="action.id === 'conflict-policy'"
        :value="conflictPolicy"
        class="sftp-toolbar-action sftp-toolbar-menu-action"
        data-toolbar-action-id="conflict-policy"
        data-testid="sftp-toolbar-action-conflict-policy"
        title="冲突处理策略"
        @change="updateConflictPolicy"
      >
        <option value="ask">冲突时询问</option>
        <option value="overwrite">覆盖</option>
        <option value="skip">跳过</option>
        <option value="rename">自动重命名</option>
      </select>
      <button
        v-else
        :class="toolbarButtonClasses(action)"
        :disabled="action.disabled"
        :title="toolbarActionTitle(action)"
        :data-toolbar-action-id="action.id"
        :data-testid="`sftp-toolbar-action-${action.id}`"
        @click="emitAction(action, $event)"
      >{{ action.label }}</button>
    </template>
    <span
      v-if="overflowToolbarActions.length && visibleToolbarActions.length"
      class="sftp-toolbar-action-separator"
      aria-hidden="true"
    >|</span>
    <div v-if="overflowToolbarActions.length" class="sftp-more">
      <button ref="moreButtonRef" class="sftp-toolbar-menu-action" data-testid="sftp-toolbar-more" @click="toggleMore">更多</button>
    </div>
    <span class="sftp-toolbar-spacer"></span>
    <span v-if="latestTransferSummary" class="sftp-inline-transfer" :title="latestTransferSummary">
      {{ latestTransferSummary }}
    </span>
  </div>
  <div ref="toolbarMeasureRef" class="sftp-toolbar sftp-toolbar-measure" aria-hidden="true">
    <template v-for="action in actions" :key="`measure-${action.id}`">
      <select
        v-if="action.id === 'conflict-policy'"
        data-measure-toolbar-action-id="conflict-policy"
        tabindex="-1"
      >
        <option>冲突时询问</option>
      </select>
      <button
        v-else
        :class="toolbarButtonClasses(action)"
        :data-measure-toolbar-action-id="action.id"
        :title="toolbarActionTitle(action)"
        tabindex="-1"
      >{{ action.label }}</button>
    </template>
    <button class="sftp-toolbar-menu-action" data-measure-toolbar-more tabindex="-1">更多</button>
  </div>

  <Teleport to="body">
    <div
      v-if="moreOpen && overflowToolbarActions.length"
      class="viewport-popover viewport-popover-menu viewport-popover-scroll sftp-more-menu"
      :style="moreMenuStyle"
      @pointerdown.stop
    >
      <template v-for="action in overflowToolbarActions" :key="`more-${action.id}`">
        <label
          v-if="action.id === 'conflict-policy'"
          class="sftp-more-select"
          data-testid="sftp-more-action-conflict-policy"
        >
          <span>{{ action.label }}</span>
          <select
            :value="conflictPolicy"
            data-testid="sftp-more-conflict-policy"
            @change="updateConflictPolicy($event, true)"
          >
            <option value="ask">冲突时询问</option>
            <option value="overwrite">覆盖</option>
            <option value="skip">跳过</option>
            <option value="rename">自动重命名</option>
          </select>
        </label>
        <button
          v-else
          :class="toolbarMoreItemClasses(action)"
          :disabled="action.disabled"
          :title="toolbarActionTitle(action)"
          :data-testid="`sftp-more-action-${action.id}`"
          @click="emitAction(action, $event)"
        >{{ action.label }}</button>
      </template>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="bookmarkMenuOpen"
      class="viewport-popover viewport-popover-menu viewport-popover-scroll sftp-bookmarks-menu"
      :style="bookmarkMenuStyle"
      @pointerdown.stop
    >
      <header>
        <strong>路径收藏</strong>
        <span>{{ currentPath || '/' }}</span>
      </header>
      <p v-if="bookmarks.length === 0" class="sftp-bookmarks-empty">暂无收藏路径</p>
      <div v-else class="sftp-bookmarks-list">
        <div
          v-for="bookmark in bookmarks"
          :key="bookmark.id"
          class="sftp-bookmark-item"
        >
          <button
            class="sftp-bookmark-jump"
            :title="bookmark.path"
            :data-testid="`sftp-bookmark-jump-${bookmark.id}`"
            @click="jumpBookmark(bookmark)"
          >
            <strong>{{ bookmark.label }}</strong>
            <span>{{ bookmark.path }}</span>
          </button>
          <button
            class="sftp-bookmark-delete"
            :data-testid="`sftp-bookmark-delete-${bookmark.id}`"
            title="删除收藏"
            @click.stop="deleteBookmark(bookmark.id)"
          >删除</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
