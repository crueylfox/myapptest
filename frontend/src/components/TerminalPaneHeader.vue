<script lang="ts">
import type { SplitPaneId as TerminalSplitPaneId } from '../utils/workspaceSplitTypes'

export type TerminalPaneMoveOption = {
  paneId: TerminalSplitPaneId
  label: string
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PaneAssignmentKind, SplitPaneId } from '../utils/workspaceSplitTypes'
import { getViewportPopoverPosition } from '../utils/viewportPopover'

const props = defineProps<{
  paneId: SplitPaneId
  kind: PaneAssignmentKind | null
  title: string
  statusClass: string
  statusText: string
  activityLabel: string
  activityTitle: string
  hasActivity: boolean
  maximized: boolean
  menuOpen: boolean
  menuMode: 'main' | 'swap' | 'move'
  occupiedPaneOptions: TerminalPaneMoveOption[]
  emptyPaneOptions: TerminalPaneMoveOption[]
}>()

defineEmits<{
  dragStart: [paneId: SplitPaneId, event: PointerEvent]
  toggleMenu: [paneId: SplitPaneId]
  clearPane: [paneId: SplitPaneId]
  addServer: [paneId: SplitPaneId]
  connectSaved: [paneId: SplitPaneId]
  selectConnected: [paneId: SplitPaneId]
  newLocal: [paneId: SplitPaneId, shellKind: 'cmd' | 'powershell']
  replaceTerminal: [paneId: SplitPaneId]
  clearActivity: [paneId: SplitPaneId]
  openSwapMenu: [paneId: SplitPaneId]
  swapPane: [sourcePaneId: SplitPaneId, targetPaneId: SplitPaneId]
  openMoveMenu: [paneId: SplitPaneId]
  movePane: [sourcePaneId: SplitPaneId, targetPaneId: SplitPaneId]
  toggleMaximize: [paneId: SplitPaneId]
}>()

const menuTrigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

async function updateMenuPosition() {
  if (!props.kind || !props.menuOpen) return
  await nextTick()
  const anchor = menuTrigger.value?.getBoundingClientRect()
  if (!anchor) return
  const bounds = menu.value?.getBoundingClientRect()
  const width = bounds && bounds.width > 0 ? bounds.width : 210
  const height = bounds && bounds.height > 0 ? bounds.height : 360
  const position = getViewportPopoverPosition({
    anchorRect: anchor,
    popoverSize: { width, height },
    viewport: {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    },
    placement: 'bottom-end',
    margin: 8,
    gap: 6,
  })
  menuStyle.value = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    width: `${position.width}px`,
    maxHeight: `${position.maxHeight}px`,
    transformOrigin: position.transformOrigin,
  }
}

watch(
  () => [props.menuOpen, props.menuMode, props.maximized, props.occupiedPaneOptions.length, props.emptyPaneOptions.length] as const,
  updateMenuPosition,
  { immediate: true, flush: 'post' },
)

onMounted(() => {
  window.addEventListener('resize', updateMenuPosition)
  document.addEventListener('scroll', updateMenuPosition, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateMenuPosition)
  document.removeEventListener('scroll', updateMenuPosition, true)
})
</script>

<template>
  <header
    class="terminal-pane-header"
    @pointerdown="$emit('dragStart', paneId, $event)"
    @dblclick.stop="$emit('toggleMaximize', paneId)"
  >
    <template v-if="kind">
      <span class="status-dot" :class="statusClass" :title="statusText"></span>
      <strong class="terminal-pane-title">{{ title }}</strong>
      <small>{{ statusText }}</small>
      <span v-if="hasActivity" class="terminal-pane-activity terminal-activity-badge" :title="activityTitle" data-terminal-activity-badge>{{ activityLabel }}</span>
    </template>
    <template v-else>
      <strong>空窗格</strong>
      <small>将标签拖到这里</small>
    </template>
    <button
      v-if="kind"
      type="button"
      class="terminal-pane-icon terminal-pane-maximize"
      :title="props.maximized ? '恢复分屏' : '最大化窗格'"
      @pointerdown.stop
      @dblclick.stop
      @click.stop="$emit('toggleMaximize', paneId)"
    >{{ props.maximized ? '↙' : '▣' }}</button>
    <button
      v-if="kind"
      ref="menuTrigger"
      type="button"
      class="terminal-pane-icon terminal-pane-menu-trigger"
      title="窗格菜单"
      aria-label="窗格菜单"
      @pointerdown.stop
      @click.stop="$emit('toggleMenu', paneId)"
    >⋯</button>
    <button
      v-if="kind"
      type="button"
      class="terminal-pane-icon terminal-pane-clear"
      title="清空窗格"
      aria-label="清空窗格"
      @pointerdown.stop
      @click.stop="$emit('clearPane', paneId)"
    >×</button>
    <Teleport to="body">
    <div
      v-if="kind && menuOpen"
      ref="menu"
      class="viewport-popover viewport-popover-menu viewport-popover-scroll terminal-pane-menu"
      role="menu"
      :style="menuStyle"
      @pointerdown.stop
      @dblclick.stop
      @click.stop
    >
      <button type="button" data-action="add-server-pane" @click="$emit('addServer', paneId)">新建服务器到此窗格</button>
      <button type="button" data-action="connect-saved-pane" @click="$emit('connectSaved', paneId)">连接已保存到此窗格</button>
      <button type="button" data-action="select-connected-pane" @click="$emit('selectConnected', paneId)">选择已连接到此窗格</button>
      <button type="button" data-action="new-cmd-pane" @click="$emit('newLocal', paneId, 'cmd')">新建 CMD 到此窗格</button>
      <button type="button" data-action="new-powershell-pane" @click="$emit('newLocal', paneId, 'powershell')">新建 PowerShell 到此窗格</button>
      <button type="button" data-action="replace-terminal" @click="$emit('replaceTerminal', paneId)">更换终端</button>
      <button
        type="button"
        data-action="clear-activity"
        :disabled="!hasActivity"
        @click="$emit('clearActivity', paneId)"
      >清除新输出标记</button>
      <button
        type="button"
        data-action="swap-pane"
        :disabled="occupiedPaneOptions.length === 0"
        @click="$emit('openSwapMenu', paneId)"
      >与其它窗格交换</button>
      <button
        v-for="target in menuMode === 'swap' ? occupiedPaneOptions : []"
        :key="`swap-${target.paneId}`"
        type="button"
        :data-swap-target="target.paneId"
        @click="$emit('swapPane', paneId, target.paneId)"
      >{{ target.label }}</button>
      <button
        type="button"
        data-action="move-pane"
        :disabled="emptyPaneOptions.length === 0"
        @click="$emit('openMoveMenu', paneId)"
      >移动到空窗格</button>
      <button
        v-for="target in menuMode === 'move' ? emptyPaneOptions : []"
        :key="`move-${target.paneId}`"
        type="button"
        :data-move-target="target.paneId"
        @click="$emit('movePane', paneId, target.paneId)"
      >{{ target.label }}</button>
      <button type="button" data-action="clear-pane" @click="$emit('clearPane', paneId)">清空窗格</button>
      <button type="button" data-action="toggle-maximize" @click="$emit('toggleMaximize', paneId)">
        {{ props.maximized ? '恢复分屏' : '最大化窗格' }}
      </button>
    </div>
    </Teleport>
  </header>
</template>
