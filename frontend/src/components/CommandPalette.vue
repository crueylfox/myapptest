<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useBatchCommandExecutionFlow } from '../composables/useBatchCommandExecutionFlow'
import {
  normalizeBatchCommand,
  useBatchCommandController,
} from '../composables/useBatchCommandController'
import { useCommandLibraryDataFlow } from '../composables/useCommandLibraryDataFlow'
import {
  useCommandPaletteController,
  type CommandPaletteScope,
  type CommandPaletteTab,
} from '../composables/useCommandPaletteController'
import { confirmDialog, inputDialog } from '../composables/useAppDialog'
import { useCommandStore } from '../stores/commands'
import { useTerminalStore } from '../stores/terminal'
import type {
  CommandFavorite,
  CommandHistoryEntry,
  Connection,
  ConnectionRuntimeState,
  SaveCommandFavoriteRequest,
} from '../types'
import BatchCommandPanel from './BatchCommandPanel.vue'
import CommandFavoriteEditor from './CommandFavoriteEditor.vue'
import CommandPaletteEditorDialog from './CommandPaletteEditorDialog.vue'
import CommandPaletteResultsList from './CommandPaletteResultsList.vue'
import CommandPaletteScopeTabs from './CommandPaletteScopeTabs.vue'
import CommandPaletteSearchBar from './CommandPaletteSearchBar.vue'
import CommandPaletteShell from './CommandPaletteShell.vue'
import ContextMenu from './ContextMenu.vue'

const props = withDefaults(defineProps<{
  open: boolean
  initialTab: CommandPaletteTab
  connection: Connection | null
  hasActiveTerminal: boolean
  historyMaxEntries?: number
  connections?: Connection[]
  connectionStates?: Record<number, ConnectionRuntimeState>
}>(), {
  historyMaxEntries: 2000,
  connections: () => [],
  connectionStates: () => ({}),
})
const emit = defineEmits<{
  close: []
  insert: [command: string]
  execute: [command: string]
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const store = useCommandStore()
const terminalStore = useTerminalStore()
const serverId = computed(() => props.connection?.id ?? 0)
const commandPaletteController = useCommandPaletteController({
  open: toRef(props, 'open'),
  initialTab: toRef(props, 'initialTab'),
  serverId,
  hasActiveTerminal: toRef(props, 'hasActiveTerminal'),
  initialScope: store.historyScope,
  notify: (message, type) => emit('notify', message, type),
  onClose: () => emit('close'),
})
const batchController = useBatchCommandController({
  connections: computed(() => props.connections ?? []),
  connectionStates: computed(() => props.connectionStates ?? {}),
  sessionsByServerId: computed(() => terminalStore.sessionsByServerId),
  activeTab: computed(() => terminalStore.activeTab),
  lastActiveTerminalByServer: computed(() => terminalStore.lastActiveTerminalByServer),
})
const tab = commandPaletteController.activeTab
const query = commandPaletteController.query
const scope = commandPaletteController.scope
const busy = commandPaletteController.busy
const selectedIndex = commandPaletteController.selectedIndex
const historyLimit = computed(() => clampHistoryLimit(props.historyMaxEntries))
const libraryDataFlow = useCommandLibraryDataFlow({
  historyByServer: toRef(store, 'historyByServer'),
  favorites: toRef(store, 'favorites'),
  groupedFavorites: {
    global: computed(() => store.globalFavorites),
    group: computed(() => store.groupFavorites),
    server: computed(() => store.serverFavorites),
  },
  serverId,
  connection: computed(() => props.connection),
  query,
  scope,
  historyLimit,
  setBusy: commandPaletteController.setBusy,
  notify: (message, type) => emit('notify', message, type),
  confirm: confirmDialog,
  loadHistory: store.loadHistory,
  loadFavorites: store.loadFavorites,
  updateHistory: store.updateHistory,
  deleteHistory: store.deleteHistory,
  clearHistory: store.clearHistory,
  saveFavorite: store.saveFavorite,
  deleteFavorite: store.deleteFavorite,
  markFavoriteUsed: store.markFavoriteUsed,
  setHistoryScope: store.setHistoryScope,
})
const batchExecutionFlow = useBatchCommandExecutionFlow({
  resolveTarget: batchController.resolveTarget,
  reloadHistory: reloadHistoryAfterBatch,
})
const batchSelectedIds = batchController.selectedIds
const batchCommand = batchController.command
const batchSending = batchController.sending
const editorOpen = ref(false)
const editingFavorite = ref<CommandFavorite | null>(null)
const editorInitialCommand = ref('')
const historyEditorOpen = ref(false)
const editingHistory = ref<CommandHistoryEntry | null>(null)
const historyDraft = ref('')
const historySaving = ref(false)
const historyMenu = ref<{ x: number; y: number; entry: CommandHistoryEntry } | null>(null)

const history = libraryDataFlow.history
const favoriteCount = libraryDataFlow.favoriteCount
const groupedFavorites = libraryDataFlow.groupedFavorites
const commonCommands = computed(() => store.commonCommandsForConnection(props.connection, query.value))
const onlineBatchServers = batchController.availableTargets
const batchSelectedCount = batchController.selectedCount
const batchSelectedOnlineServers = batchController.selectedTargets

watch(() => props.open, async (open) => {
  if (!open) {
    batchController.closePanel()
    return
  }
  batchController.openPanel()
  await reload()
}, { immediate: true })

watch(query, () => {
  if (!props.open || tab.value === 'batch') return
  void reload()
})

watch(scope, () => {
  if (!serverId.value && scope.value === 'currentServer') {
    scope.value = 'all'
    return
  }
  libraryDataFlow.setScope(scope.value)
  if (!props.open || tab.value === 'batch') return
  void reload()
})

async function reload() {
  if (tab.value === 'batch') return
  await libraryDataFlow.reload()
}

function setTab(next: CommandPaletteTab) {
  commandPaletteController.setTab(next)
  if (next !== 'batch') void reload()
}

function setScope(next: CommandPaletteScope) {
  scope.value = next
}

function closePalette() {
  batchController.clearSelection()
  commandPaletteController.closePalette()
}

function insert(command: string) {
  const intent = commandPaletteController.commandIntent(command, 'insert')
  if (!intent.enabled) return
  emit('insert', command)
  closePalette()
}

function execute(command: string) {
  const intent = commandPaletteController.commandIntent(command, 'execute')
  if (!intent.enabled) return
  emit('execute', command)
  closePalette()
}

function addFavorite(command = '') {
  editingFavorite.value = null
  editorInitialCommand.value = command
  editorOpen.value = true
}

function editFavorite(favorite: CommandFavorite) {
  editingFavorite.value = favorite
  editorInitialCommand.value = favorite.command
  editorOpen.value = true
}

function editHistory(entry: CommandHistoryEntry) {
  editingHistory.value = entry
  historyDraft.value = entry.command
  historyEditorOpen.value = true
  historyMenu.value = null
}

function closeHistoryEditor() {
  historyEditorOpen.value = false
}

function openHistoryMenu(entry: CommandHistoryEntry, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  historyMenu.value = { x: event.clientX, y: event.clientY, entry }
}

async function saveHistoryEdit() {
  if (!editingHistory.value) return
  historySaving.value = true
  try {
    const result = await libraryDataFlow.updateHistoryEntry({ id: editingHistory.value.id, command: historyDraft.value })
    if (result.ok) {
      historyEditorOpen.value = false
      editingHistory.value = null
      historyDraft.value = ''
    }
  } finally {
    historySaving.value = false
  }
}

async function deleteHistory(entry: CommandHistoryEntry) {
  const ok = await confirmDialog({
    title: '删除命令历史',
    message: '确定删除这条命令历史吗？',
    confirmText: '删除',
    danger: true,
    hideCloseButton: true,
  })
  if (!ok) return
  await libraryDataFlow.deleteHistoryEntry(entry)
}

async function copyHistory(entry: CommandHistoryEntry) {
  try {
    await navigator.clipboard.writeText(entry.command)
    emit('notify', '命令已复制', 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '复制命令失败'), 'error')
  }
}

async function clearHistory() {
  await libraryDataFlow.clearCurrentServerHistory()
}

async function deleteFavorite(favorite: CommandFavorite) {
  await libraryDataFlow.deleteFavoriteEntry(favorite)
}

async function favoriteUsed(command: string, favorite?: CommandFavorite, run = false) {
  if (!commandPaletteController.commandIntent(command, run ? 'execute' : 'insert').enabled) return
  if (favorite) {
    await libraryDataFlow.markFavoriteEntryUsed(favorite)
  }
  if (run) execute(command)
  else insert(command)
}

function insertFavorite(payload: { command: string; favorite: CommandFavorite }) {
  void favoriteUsed(payload.command, payload.favorite)
}

function executeFavorite(payload: { command: string; favorite: CommandFavorite }) {
  void favoriteUsed(payload.command, payload.favorite, true)
}

async function saveFavorite(request: SaveCommandFavoriteRequest) {
  const result = await libraryDataFlow.saveFavoriteEntry(request)
  if (result.ok) {
    editorOpen.value = false
    editingFavorite.value = null
  }
}

function toggleBatchServer(serverID: number) {
  batchController.toggleTarget(serverID)
}

function selectAllBatchServers() {
  batchController.selectAllTargets()
}

function invertBatchServers() {
  batchController.invertTargets()
}

function clearBatchCommand() {
  batchController.clearCommand()
}

async function saveBatchFavorite() {
  const normalizedCommand = normalizeBatchCommand(batchCommand.value)
  if (!normalizedCommand) {
    emit('notify', '请输入要保存的命令。', 'error')
    return
  }
  const title = await inputDialog({
    title: '保存到常用命令',
    label: '标题',
    initialValue: normalizedCommand.split(/\s+/).slice(0, 4).join(' ').slice(0, 80),
    confirmText: '保存',
    validate: (value) => value.trim() ? '' : '标题不能为空。',
  })
  if (!title) return
  await saveFavorite({
    id: '',
    title: title.trim(),
    command: normalizedCommand,
    description: '批量命令',
    scope: 'global',
    serverId: null,
    groupId: null,
    tags: ['batch'],
    sortOrder: 0,
    allowSensitive: false,
  })
}

async function startBatchTerminalCommand() {
  if (batchSending.value) return
  const normalizedCommand = normalizeBatchCommand(batchCommand.value)
  if (!normalizedCommand) {
    emit('notify', '请输入要执行的命令。', 'error')
    return
  }
  const servers = batchSelectedOnlineServers.value
  if (servers.length === 0) {
    emit('notify', '请选择至少一台在线 SSH 终端。', 'error')
    return
  }
  const dangerous = looksDangerous(normalizedCommand)
  const confirmed = await confirmDialog({
    title: '确认执行',
    message: `即将把命令直接发送到 ${servers.length} 台在线服务器的 SSH 终端并自动回车执行。\n\n请确认这些终端当前处于空闲状态。`,
    confirmText: '确认执行',
    danger: dangerous,
  })
  if (!confirmed) return
  if (dangerous) {
    const typed = await inputDialog({
      title: '危险命令确认',
      message: '检测到可能造成数据丢失或服务中断的命令。请再次确认。',
      label: '请输入：确认执行',
      placeholder: '确认执行',
      confirmText: '确认执行',
      danger: true,
      validate: (value) => value.trim() === '确认执行' ? '' : '必须输入“确认执行”才会继续。',
    })
    if (typed !== '确认执行') return
  }

  batchSending.value = true
  try {
    const result = await batchExecutionFlow.executeBatchCommand({
      command: normalizedCommand,
      selectedTargets: servers,
    })
    emit('notify', result.toast.message, result.toast.type)
  } finally {
    batchSending.value = false
  }
}

async function reloadHistoryAfterBatch() {
  await libraryDataFlow.reloadHistoryAfterBatch()
}

const dangerousPatterns = [
  /rm\s+-rf/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,
  /\bmkfs\b/i,
  /\bfdisk\b/i,
  /\bparted\b/i,
  /\bdd\s+if=/i,
  /\biptables\s+-F\b/i,
  /\bnft\s+flush\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
]

function looksDangerous(value: string) {
  return dangerousPatterns.some((pattern) => pattern.test(value))
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

function clampHistoryLimit(value: number) {
  if (!Number.isFinite(value)) return 2000
  return Math.min(Math.max(Math.trunc(value), 100), 20000)
}

function handleHistoryMenu(id: string) {
  const entry = historyMenu.value?.entry
  if (!entry) return
  if (id === 'insert') insert(entry.command)
  else if (id === 'execute') execute(entry.command)
  else if (id === 'edit-history') editHistory(entry)
  else if (id === 'copy') void copyHistory(entry)
  else if (id === 'favorite') addFavorite(entry.command)
  else if (id === 'delete') void deleteHistory(entry)
  historyMenu.value = null
}
</script>

<template>
  <CommandPaletteShell
    :open="open"
    title="命令面板"
    :subtitle="connection?.name ?? '未连接服务器'"
    @close="closePalette"
  >
    <template #tabs>
      <CommandPaletteScopeTabs
        :active-tab="tab"
        :scope="scope"
        :has-server="Boolean(serverId)"
        :show-add-favorite="tab !== 'batch'"
        @tab-change="setTab"
        @scope-change="setScope"
        @add-favorite="addFavorite()"
      >
        <template #search>
          <CommandPaletteSearchBar
            v-if="tab !== 'batch'"
            v-model="query"
            placeholder="搜索命令、标题或标签"
          />
        </template>
      </CommandPaletteScopeTabs>
    </template>

    <BatchCommandPanel
      v-if="tab === 'batch'"
      v-model:command="batchCommand"
      :targets="onlineBatchServers"
      :selected-ids="batchSelectedIds"
      :selected-count="batchSelectedCount"
      :sending="batchSending"
      @toggle-target="toggleBatchServer"
      @select-all="selectAllBatchServers"
      @invert="invertBatchServers"
      @clear-command="clearBatchCommand"
      @save-favorite="saveBatchFavorite"
      @start="startBatchTerminalCommand"
    />
    <CommandPaletteResultsList
      v-else
      :tab="tab"
      :history="history"
      :common-commands="commonCommands"
      :query="query"
      :grouped-favorites="groupedFavorites"
      :favorite-count="favoriteCount"
      :busy="busy"
      :scope="scope"
      :selected-index="selectedIndex"
      @insert="insert"
      @execute="execute"
      @edit-history="editHistory"
      @copy-history="copyHistory"
      @favorite-history="addFavorite"
      @delete-history="deleteHistory"
      @clear-history="clearHistory"
      @history-context-menu="openHistoryMenu"
      @favorite-insert="insertFavorite"
      @favorite-execute="executeFavorite"
      @edit-favorite="editFavorite"
      @delete-favorite="deleteFavorite"
    />

    <template #overlays>
      <CommandFavoriteEditor
        :open="editorOpen"
        :favorite="editingFavorite"
        :initial-command="editorInitialCommand"
        :connection="connection"
        @close="editorOpen = false"
        @save="saveFavorite"
      />
      <CommandPaletteEditorDialog
        v-model="historyDraft"
        :open="historyEditorOpen"
        :saving="historySaving"
        @confirm="saveHistoryEdit"
        @cancel="closeHistoryEditor"
      />
      <ContextMenu
        v-if="historyMenu"
        :x="historyMenu.x"
        :y="historyMenu.y"
        :items="[
          { id: 'insert', label: '插入' },
          { id: 'execute', label: '执行' },
          { id: 'edit-history', label: '编辑历史' },
          { id: 'copy', label: '复制' },
          { id: 'favorite', label: '收藏' },
          { id: 'separator', label: '', separator: true },
          { id: 'delete', label: '删除', danger: true },
        ]"
        @close="historyMenu = null"
        @select="handleHistoryMenu"
      />
    </template>
  </CommandPaletteShell>
</template>
