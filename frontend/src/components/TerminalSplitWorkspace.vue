<script setup lang="ts">
import { computed } from 'vue'
import type { SplitMode, SplitPaneId, SplitResizeAxis } from '../utils/workspaceSplitTypes'

const props = defineProps<{
  splitMode: SplitMode
  renderedPaneIds: SplitPaneId[]
  maximizedPaneId: SplitPaneId | null
  columnRatio: number
  rowRatio: number
  showColumnSplitter: boolean
  showRowSplitter: boolean
}>()

defineEmits<{
  splitterDragStart: [axis: SplitResizeAxis, event: PointerEvent]
}>()

const workspaceClass = computed(() => [
  `split-${props.splitMode}`,
  { 'pane-maximized': Boolean(props.maximizedPaneId) },
])

const workspaceStyle = computed<Record<string, string>>(() => {
  const columnRatio = props.columnRatio
  const rowRatio = props.rowRatio
  const style: Record<string, string> = {
    '--split-column-ratio': String(columnRatio),
    '--split-row-ratio': String(rowRatio),
  }
  if (props.splitMode === 'vertical' || props.splitMode === 'quad') {
    style.gridTemplateColumns = `minmax(0, ${columnRatio}fr) 8px minmax(0, ${Math.round((1 - columnRatio) * 1000) / 1000}fr)`
  } else {
    style.gridTemplateColumns = 'minmax(0, 1fr)'
  }
  if (props.splitMode === 'horizontal' || props.splitMode === 'quad') {
    style.gridTemplateRows = `minmax(0, ${rowRatio}fr) 8px minmax(0, ${Math.round((1 - rowRatio) * 1000) / 1000}fr)`
  } else {
    style.gridTemplateRows = 'minmax(0, 1fr)'
  }
  return style
})

function paneGridStyle(paneId: SplitPaneId): Record<string, string> {
  if (props.maximizedPaneId === paneId) {
    return {
      gridColumn: '1 / -1',
      gridRow: '1 / -1',
    }
  }
  if (props.splitMode === 'vertical') {
    return {
      gridColumn: paneId === 'pane-1' ? '1' : '3',
      gridRow: '1',
    }
  }
  if (props.splitMode === 'horizontal') {
    return {
      gridColumn: '1',
      gridRow: paneId === 'pane-1' ? '1' : '3',
    }
  }
  if (props.splitMode === 'quad') {
    const columns: Record<SplitPaneId, string> = {
      'pane-1': '1',
      'pane-2': '3',
      'pane-3': '1',
      'pane-4': '3',
    }
    const rows: Record<SplitPaneId, string> = {
      'pane-1': '1',
      'pane-2': '1',
      'pane-3': '3',
      'pane-4': '3',
    }
    return {
      gridColumn: columns[paneId],
      gridRow: rows[paneId],
    }
  }
  return {}
}
</script>

<template>
  <div
    class="terminal-split-workspace"
    :class="workspaceClass"
    :style="workspaceStyle"
  >
    <slot
      v-for="paneId in renderedPaneIds"
      name="pane"
      :pane-id="paneId"
      :pane-style="paneGridStyle(paneId)"
    ></slot>
    <div
      v-if="showColumnSplitter && !maximizedPaneId"
      class="terminal-pane-splitter column"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左右终端窗格比例"
      @pointerdown.stop.prevent="$emit('splitterDragStart', 'column', $event)"
    ><span></span></div>
    <div
      v-if="showRowSplitter && !maximizedPaneId"
      class="terminal-pane-splitter row"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整上下终端窗格比例"
      @pointerdown.stop.prevent="$emit('splitterDragStart', 'row', $event)"
    ><span></span></div>
  </div>
</template>
