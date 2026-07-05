<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api/backend'
import type { ContextMenuItem, LocalDirectoryListing, LocalDrive } from '../types'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'
import type { SftpHighlightSegment } from '../utils/sftpFileFilter'
import {
  FILE_COLUMN_BY_ID,
  clampFileColumnWidth,
  type FileColumn,
  type FileColumnId,
  type FileSortableColumnId,
} from '../utils/sftpFileColumns'
import { sftpEntryHighlightText } from '../utils/sftpEntryPresentation'
import ContextMenu from './ContextMenu.vue'
import SftpFileTable from './SftpFileTable.vue'

const props = defineProps<{
  expanded: boolean
  initialPath?: string
}>()
const emit = defineEmits<{
  toggle: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const pathInput = ref(props.initialPath ?? '')
const listing = ref<LocalDirectoryListing | null>(null)
const drives = ref<LocalDrive[]>([])
const filter = ref('')
const loading = ref(false)
const error = ref('')
const backStack = ref<string[]>([])
const forwardStack = ref<string[]>([])
const localColumns = ['name', 'modTime', 'size', 'type']
  .map((columnId) => FILE_COLUMN_BY_ID.get(columnId as FileColumnId))
  .filter((column): column is FileColumn => Boolean(column))
const localColumnWidths = ref<Record<FileColumnId, number>>({
  name: 260,
  modTime: 150,
  size: 84,
  type: 74,
  permissions: 92,
  owner: 74,
  group: 74,
})
const currentSortKey = ref<FileSortableColumnId>('name')
const currentSortAsc = ref(true)
const resizingColumnId = ref<FileColumnId | null>(null)
const contextMenu = ref<{
  x: number
  y: number
  items: ContextMenuItem[]
  target: SftpDisplayEntry | null
} | null>(null)
let resizingColumn: { id: FileColumnId; startX: number; startWidth: number } | null = null

const currentPath = computed(() => listing.value?.path ?? pathInput.value)
const filterActive = computed(() => Boolean(filter.value.trim()))
const filteredEntries = computed(() => {
  const query = filter.value.trim().toLowerCase()
  const entries = listing.value?.entries ?? []
  if (!query) return entries
  return entries.filter((entry) => entry.name.toLowerCase().includes(query))
})
const localTableGridStyle = computed(() => {
  const widths = localColumns.map((column) => localColumnWidths.value[column.id])
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(localColumns.length - 1, 0) * 8 + 20
  return {
    gridTemplateColumns: widths.map((width) => `${width}px`).join(' '),
    minWidth: `${totalWidth}px`,
  }
})
const localEntries = computed<SftpDisplayEntry[]>(() => {
  const entries = filteredEntries.value
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      parentPath: currentPath.value,
      size: entry.size,
      isDir: entry.isDir,
      isSymlink: false,
      permissions: '',
      owner: '',
      group: '',
      modTime: entry.modTime,
    }))
    .sort((left, right) => compareLocalEntries(left, right, currentSortKey.value, currentSortAsc.value))
  const parent = listing.value?.parent
  if (!parent) return entries
  return [{
    name: '..',
    path: parent,
    parentPath: currentPath.value,
    size: 0,
    isDir: true,
    isSymlink: false,
    permissions: '',
    owner: '',
    group: '',
    modTime: '',
    syntheticParent: true,
  }, ...entries]
})

async function load(path: string, pushHistory = true) {
  loading.value = true
  try {
    const next = await api.listLocalDirectory(path)
    if (pushHistory && listing.value?.path && listing.value.path !== next.path) {
      backStack.value = [...backStack.value, listing.value.path]
      forwardStack.value = []
    }
    listing.value = next
    pathInput.value = next.path
    error.value = ''
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    error.value = message
    emit('notify', `本地目录读取失败：${message}`, 'error')
  } finally {
    loading.value = false
  }
}

async function loadHome() {
  try {
    const home = await api.getLocalExplorerHome()
    await load(home.path, home.path !== listing.value?.path)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    error.value = message
  }
}

async function loadDrives() {
  try {
    drives.value = await api.getLocalDrives()
  } catch {
    drives.value = []
  }
}

function submitPath() {
  void load(pathInput.value)
}

async function openEntry(path: string, isDir: boolean) {
  if (isDir) {
    await load(path)
    return
  }
  try {
    await api.openLocalPath(path)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    emit('notify', `本地文件打开失败：${message}`, 'error')
  }
}

function goParent() {
  const parent = listing.value?.parent
  if (parent) void load(parent)
}

function goBack() {
  const previous = backStack.value.at(-1)
  if (!previous) return
  backStack.value = backStack.value.slice(0, -1)
  if (listing.value?.path) forwardStack.value = [...forwardStack.value, listing.value.path]
  void load(previous, false)
}

function goForward() {
  const next = forwardStack.value.at(-1)
  if (!next) return
  forwardStack.value = forwardStack.value.slice(0, -1)
  if (listing.value?.path) backStack.value = [...backStack.value, listing.value.path]
  void load(next, false)
}

function refresh() {
  const path = currentPath.value
  if (path) void load(path, false)
}

function localEntryMenuItems(): ContextMenuItem[] {
  return [
    { id: 'open', label: '打开' },
    { id: 'reveal', label: '在资源管理器中显示' },
    { id: 'copy-path', label: '复制路径' },
    { id: 'copy-name', label: '复制名称' },
    { id: 'properties', label: '属性' },
    { id: 'refresh', label: '刷新' },
  ]
}

function blankMenuItems(): ContextMenuItem[] {
  return [
    { id: 'refresh', label: '刷新' },
    { id: 'parent', label: '上一级', disabled: !listing.value?.parent },
    { id: 'home', label: 'Home' },
    { id: 'copy-current-path', label: '复制当前路径' },
  ]
}

function openRowContextMenu(entry: SftpDisplayEntry, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    items: localEntryMenuItems(),
    target: entry,
  }
}

function openBlankContextMenu(event: MouseEvent) {
  event.preventDefault()
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    items: blankMenuItems(),
    target: null,
  }
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard?.writeText(text)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    emit('notify', `复制失败：${message}`, 'error')
  }
}

async function handleContextSelect(id: string) {
  const target = contextMenu.value?.target ?? null
  if (id === 'refresh') {
    refresh()
    return
  }
  if (id === 'parent') {
    goParent()
    return
  }
  if (id === 'home') {
    await loadHome()
    return
  }
  if (id === 'copy-current-path') {
    await writeClipboard(currentPath.value)
    return
  }
  if (!target) return
  if (id === 'open') {
    await openEntry(target.path, target.isDir)
    return
  }
  if (id === 'reveal') {
    try {
      await api.revealLocalPath(target.path)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      emit('notify', `资源管理器显示失败：${message}`, 'error')
    }
    return
  }
  if (id === 'properties') {
    try {
      await api.showLocalPathProperties(target.path)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      emit('notify', `属性打开失败：${message}`, 'error')
    }
    return
  }
  if (id === 'copy-path') {
    await writeClipboard(target.path)
    return
  }
  if (id === 'copy-name') {
    await writeClipboard(target.name)
  }
}

function driveLabel(drive: LocalDrive) {
  return drive.name || drive.path
}

function compareNames(left: SftpDisplayEntry, right: SftpDisplayEntry, asc: boolean) {
  const result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return asc ? result : -result
}

function fileTypeRank(entry: SftpDisplayEntry) {
  if (entry.isSymlink) return 2
  if (entry.isDir) return 0
  return 1
}

function compareLocalEntries(left: SftpDisplayEntry, right: SftpDisplayEntry, key: FileSortableColumnId, asc: boolean) {
  if (key !== 'type' && key !== 'permissions' && left.isDir !== right.isDir) return left.isDir ? -1 : 1
  let result = 0
  if (key === 'type') result = fileTypeRank(left) - fileTypeRank(right)
  else if (key === 'size') result = left.size - right.size
  else if (key === 'modTime') result = left.modTime.localeCompare(right.modTime)
  else result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return asc ? (result || compareNames(left, right, true)) : -(result || compareNames(left, right, true))
}

function sortColumn(column: FileColumn) {
  if (!column.sortable) return
  if (currentSortKey.value === column.sortable) currentSortAsc.value = !currentSortAsc.value
  else {
    currentSortKey.value = column.sortable
    currentSortAsc.value = true
  }
}

function localHighlightSegments(entry: SftpDisplayEntry, columnId: FileColumnId): SftpHighlightSegment[] {
  const text = sftpEntryHighlightText(entry, columnId)
  return text ? [{ text, matched: false }] : []
}

function openLocalEntry(entry: SftpDisplayEntry) {
  void openEntry(entry.path, entry.isDir)
}

function startColumnResize(columnId: FileColumnId, event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  resizingColumn = {
    id: columnId,
    startX: event.clientX,
    startWidth: localColumnWidths.value[columnId],
  }
  resizingColumnId.value = columnId
  window.addEventListener('pointermove', moveColumnResize)
  window.addEventListener('pointerup', stopColumnResize)
}

function moveColumnResize(event: PointerEvent) {
  if (!resizingColumn) return
  event.preventDefault()
  localColumnWidths.value = {
    ...localColumnWidths.value,
    [resizingColumn.id]: clampFileColumnWidth(
      resizingColumn.id,
      resizingColumn.startWidth + event.clientX - resizingColumn.startX,
    ),
  }
}

function stopColumnResize() {
  resizingColumn = null
  resizingColumnId.value = null
  window.removeEventListener('pointermove', moveColumnResize)
  window.removeEventListener('pointerup', stopColumnResize)
}

onMounted(() => {
  void loadDrives()
  if (props.initialPath) void load(props.initialPath, false)
  else void loadHome()
})

onBeforeUnmount(() => {
  stopColumnResize()
})

watch(() => props.initialPath, (path) => {
  if (path && path !== currentPath.value) void load(path, false)
})
</script>

<template>
  <section class="local-explorer-panel" :class="{ expanded: props.expanded }">
    <header class="local-explorer-toolbar">
      <form class="local-explorer-path" @submit.prevent="submitPath">
        <input v-model="pathInput" aria-label="本地路径" />
      </form>
      <input v-model="filter" class="local-explorer-filter" type="search" placeholder="过滤当前目录" aria-label="过滤当前目录" />
      <div class="local-explorer-nav-actions">
        <button type="button" class="sftp-toolbar-menu-action text-button" :disabled="!backStack.length" @click="goBack">后退</button>
        <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
        <button type="button" class="sftp-toolbar-menu-action text-button" :disabled="!forwardStack.length" @click="goForward">前进</button>
        <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
        <button type="button" class="sftp-toolbar-menu-action text-button" :disabled="!listing?.parent" @click="goParent">向上</button>
        <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
        <button type="button" class="sftp-toolbar-menu-action text-button" data-testid="local-explorer-home" title="Home (user directory)" aria-label="Home user directory" @click="loadHome">Home</button>
        <span class="sftp-toolbar-action-separator" aria-hidden="true">|</span>
        <button type="button" class="sftp-toolbar-menu-action text-button" @click="refresh">刷新</button>
      </div>
    </header>

    <div class="local-explorer-body">
      <aside class="local-explorer-drives" aria-label="本地驱动器">
        <button
          v-for="drive in drives"
          :key="drive.path"
          type="button"
          :class="{ active: currentPath.toLowerCase().startsWith(drive.path.toLowerCase()) }"
          @click="load(drive.path)"
        >
          {{ driveLabel(drive) }}
        </button>
      </aside>
      <div class="local-explorer-table-wrap">
        <p v-if="error" class="local-explorer-state">{{ error }}</p>
        <SftpFileTable
          v-else
          table-test-id="local-explorer-table"
          :columns="localColumns"
          :entries="localEntries"
          :selected-paths="[]"
          :table-grid-style="localTableGridStyle"
          :filter-active="filterActive"
          :filtered-entry-count="filteredEntries.length"
          :current-sort-key="currentSortKey"
          :current-sort-asc="currentSortAsc"
          :resizing-column-id="resizingColumnId"
          :dragging-column-id="null"
          :column-drop-target-index="null"
          :loading="loading"
          :highlight-segments="localHighlightSegments"
          @row-dblclick="openLocalEntry"
          @row-contextmenu="openRowContextMenu"
          @blank-contextmenu="openBlankContextMenu"
          @header-sort="sortColumn"
          @column-resize-start="startColumnResize"
        />
      </div>
    </div>
    <ContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      interaction-scope="local-explorer"
      @select="handleContextSelect"
      @close="contextMenu = null"
    />
  </section>
</template>
