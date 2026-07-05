<script setup lang="ts">
import { computed } from 'vue'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'
import { sftpEntryIconLabel, sftpEntryKind } from '../utils/sftpEntryPresentation'
import type { FileColumn, FileColumnId, FileSortableColumnId } from '../utils/sftpFileColumns'
import type { SftpHighlightSegment } from '../utils/sftpFileFilter'
import FolderIcon from './FolderIcon.vue'

const props = defineProps<{
  columns: FileColumn[]
  entries: SftpDisplayEntry[]
  selectedPaths: string[]
  tableGridStyle: Record<string, string>
  filterActive: boolean
  filteredEntryCount: number
  currentSortKey: FileSortableColumnId
  currentSortAsc: boolean
  resizingColumnId: FileColumnId | null
  draggingColumnId: FileColumnId | null
  columnDropTargetIndex: number | null
  loading?: boolean
  tableTestId?: string
  highlightSegments: (entry: SftpDisplayEntry, columnId: FileColumnId) => SftpHighlightSegment[]
}>()

const emit = defineEmits<{
  'blank-click': [event: MouseEvent]
  'blank-contextmenu': [event: MouseEvent]
  keydown: [event: KeyboardEvent]
  wheel: [event: WheelEvent]
  'row-click': [entry: SftpDisplayEntry, event: MouseEvent]
  'row-dblclick': [entry: SftpDisplayEntry, event: MouseEvent]
  'row-contextmenu': [entry: SftpDisplayEntry, event: MouseEvent]
  'parent-click': [entry: SftpDisplayEntry, event: MouseEvent]
  'header-sort': [column: FileColumn]
  'column-resize-start': [columnId: FileColumnId, event: PointerEvent]
  'column-reorder-start': [columnId: FileColumnId, event: PointerEvent]
}>()

const selectedPathSet = computed(() => new Set(props.selectedPaths))

function sortDirection(column: FileColumn) {
  if (!column.sortable || props.currentSortKey !== column.sortable) return 'none'
  return props.currentSortAsc ? 'ascending' : 'descending'
}

function onColumnResizeStart(columnId: FileColumnId, event: PointerEvent) {
  event.stopPropagation()
  emit('column-resize-start', columnId, event)
}

function onParentIconClick(entry: SftpDisplayEntry, event: MouseEvent) {
  if (!entry.syntheticParent) return
  emit('parent-click', entry, event)
}
</script>

<template>
  <div
    class="sftp-table"
    tabindex="0"
    data-ui-no-text-select="true"
    :data-testid="tableTestId ?? 'sftp-file-list'"
    @click.self="emit('blank-click', $event)"
    @contextmenu="emit('blank-contextmenu', $event)"
    @keydown="emit('keydown', $event)"
    @wheel="emit('wheel', $event)"
  >
    <div
      class="sftp-row sftp-head"
      data-testid="sftp-table-head"
      :style="tableGridStyle"
    >
      <div
        v-for="(column, columnIndex) in columns"
        :key="column.id"
        class="sftp-column-head"
        :class="{
          'sftp-column-resizing': resizingColumnId === column.id,
          'sftp-column-dragging': draggingColumnId === column.id,
          'sftp-column-drop-before': columnDropTargetIndex === columnIndex,
          'sftp-column-drop-after': columnDropTargetIndex === columns.length - 1 && columnIndex === columns.length - 1,
        }"
        :data-column-id="column.id"
        :data-testid="`sftp-column-header-${column.id}`"
        @pointerdown="emit('column-reorder-start', column.id, $event)"
      >
        <button
          v-if="column.sortable"
          class="sftp-column-title"
          :data-testid="`sftp-column-sort-${column.id}`"
          :aria-sort="sortDirection(column)"
          @click.stop="emit('header-sort', column)"
        >
          <span class="sftp-column-title-text">{{ column.label }}</span>
          <span
            v-if="currentSortKey === column.sortable"
            class="sftp-column-sort-indicator"
            aria-hidden="true"
          >{{ currentSortAsc ? '▲' : '▼' }}</span>
        </button>
        <span v-else class="sftp-column-title">{{ column.label }}</span>
        <button
          class="sftp-column-resizer"
          :aria-label="`调整${column.label}列宽`"
          :data-testid="`sftp-column-resize-${column.id}`"
          @pointerdown="onColumnResizeStart(column.id, $event)"
        >
          <span
            class="sftp-column-separator"
            :class="{ 'sftp-column-separator-active': resizingColumnId === column.id }"
            :data-testid="`sftp-column-separator-${column.id}`"
            aria-hidden="true"
          ></span>
        </button>
      </div>
    </div>

    <button
      v-for="entry in entries"
      :key="entry.syntheticParent ? '__parent__' : entry.path"
      class="sftp-row"
      data-testid="sftp-entry-row"
      :class="[{ selected: selectedPathSet.has(entry.path), parent: entry.syntheticParent }, `sftp-entry-${sftpEntryKind(entry)}`]"
      :style="tableGridStyle"
      @click="emit('row-click', entry, $event)"
      @dblclick="emit('row-dblclick', entry, $event)"
      @contextmenu="emit('row-contextmenu', entry, $event)"
    >
      <template v-for="column in columns" :key="column.id">
        <span
          v-if="column.id === 'name'"
          class="sftp-entry-cell sftp-entry-name-cell"
          data-column-id="name"
        >
          <span
            class="sftp-entry-icon"
            :class="`sftp-entry-icon-${sftpEntryKind(entry)}`"
            :aria-label="sftpEntryIconLabel(entry)"
            role="img"
            @click="onParentIconClick(entry, $event)"
          >
            <FolderIcon v-if="sftpEntryKind(entry) === 'directory'" />
            <svg v-else-if="sftpEntryKind(entry) === 'symlink'" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6.1 10.6 5 11.7a2.6 2.6 0 1 1-3.7-3.7l2-2a2.6 2.6 0 0 1 3.7 0l.4.4-1.1 1.1-.4-.4a1 1 0 0 0-1.5 0l-2 2a1 1 0 1 0 1.5 1.5L5 9.5zm3.8-5.2L11 4.3A2.6 2.6 0 1 1 14.7 8l-2 2a2.6 2.6 0 0 1-3.7 0l-.4-.4 1.1-1.1.4.4a1 1 0 0 0 1.5 0l2-2a1 1 0 1 0-1.5-1.5L11 6.5z" />
              <path d="m5.4 9.5 4.1-4.1 1.1 1.1-4.1 4.1z" />
            </svg>
            <svg v-else-if="sftpEntryKind(entry) === 'parent'" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3 3 8l5 5 1.1-1.1L6 8.8h7V7.2H6l3.1-3.1z" />
            </svg>
            <svg v-else viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 1.8h5.2L12 4.6v9.6H4zm5 1.8v1.2h1.2z" />
            </svg>
          </span>
          <strong class="sftp-entry-label" :title="entry.syntheticParent ? '返回上级目录' : entry.name">
            <span
              v-for="(segment, segmentIndex) in highlightSegments(entry, 'name')"
              :key="`name-${segmentIndex}`"
              class="sftp-entry-segment"
              :class="{ 'sftp-filter-match': segment.matched }"
            >{{ segment.text }}</span>
          </strong>
        </span>
        <code
          v-else-if="column.id === 'permissions'"
          class="sftp-entry-cell"
          data-column-id="permissions"
        >
          <span
            v-for="(segment, segmentIndex) in highlightSegments(entry, 'permissions')"
            :key="`permissions-${segmentIndex}`"
            class="sftp-entry-segment"
            :class="{ 'sftp-filter-match': segment.matched }"
          >{{ segment.text }}</span>
        </code>
        <span
          v-else
          class="sftp-entry-cell"
          :data-column-id="column.id"
        >
          <span
            v-for="(segment, segmentIndex) in highlightSegments(entry, column.id)"
            :key="`${column.id}-${segmentIndex}`"
            class="sftp-entry-segment"
            :class="{ 'sftp-filter-match': segment.matched }"
          >{{ segment.text }}</span>
        </span>
      </template>
    </button>

    <p
      v-if="loading"
      class="sftp-empty-inline"
      data-testid="sftp-table-loading"
      :style="{ minWidth: tableGridStyle.minWidth }"
    >加载中...</p>
    <p
      v-else-if="filterActive && filteredEntryCount === 0"
      class="sftp-empty-inline"
      data-testid="sftp-filter-empty"
      :style="{ minWidth: tableGridStyle.minWidth }"
    >没有匹配的文件</p>
    <p
      v-else-if="entries.length === 0"
      class="sftp-empty-inline"
      data-testid="sftp-table-empty"
      :style="{ minWidth: tableGridStyle.minWidth }"
    >空目录</p>
  </div>
</template>
