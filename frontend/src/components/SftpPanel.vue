<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import { choiceDialog, confirmDialog, inputDialog } from '../composables/useAppDialog'
import { useSftpColumnLayout } from '../composables/useSftpColumnLayout'
import { useSftpDeleteFlow } from '../composables/useSftpDeleteFlow'
import { useSftpFileFilter } from '../composables/useSftpFileFilter'
import { useSftpPathBookmarks } from '../composables/useSftpPathBookmarks'
import { useSftpPathNavigation } from '../composables/useSftpPathNavigation'
import { useSftpPropertiesFlow } from '../composables/useSftpPropertiesFlow'
import { isEditableTextEncoding, useSftpRemoteText } from '../composables/useSftpRemoteText'
import { useSftpTransferActions } from '../composables/useSftpTransferActions'
import { useSftpStore } from '../stores/sftp'
import type { Connection, ContextMenuItem, SFTPConflictPolicy, SFTPEntry } from '../types'
import { formatBytes } from '../utils/format'
import {
  calculateSftpDetailsDragWidth,
  loadSftpDetailsCollapsed,
  loadSftpDetailsWidth,
  persistSftpDetailsCollapsed,
  persistSftpDetailsWidth,
} from '../utils/sftpDetailsPanel'
import {
  isSftpHiddenEntry,
  sftpSelectedFileSize,
  sftpVisibleSelectedEntries,
  type SftpDisplayEntry,
} from '../utils/sftpDisplayEntries'
import {
  formatSftpEntryTime as formatTime,
  sftpEntryTypeLabel as entryType,
} from '../utils/sftpEntryPresentation'
import { applyFileTableWheel as handleFileTableWheel } from '../utils/sftpFileTableWheel'
import {
  type FileColumn,
  type FileColumnId,
  type FileSortableColumnId,
} from '../utils/sftpFileColumns'
import {
  joinRemoteTextPath,
  normalizeRemoteInputPath,
  remoteBasename,
  remoteParentPath,
  validateRemoteTextPathInput,
} from '../utils/sftpRemotePath'
import {
  type SftpPathBookmark,
} from '../utils/sftpPathState'
import { buildSftpContextMenuItems } from '../utils/sftpContextMenuModel'
import { sftpTransferSummary as transferSummary } from '../utils/sftpTransferPresentation'
import ContextMenu from './ContextMenu.vue'
import SftpDetailsPane, { type SftpDetailsRow } from './SftpDetailsPane.vue'
import SftpFileTable from './SftpFileTable.vue'
import SftpToolbar, { type SftpToolbarAction, type SftpToolbarActionId } from './SftpToolbar.vue'
import RemoteFilePropertiesDialog from './RemoteFilePropertiesDialog.vue'
import RemoteTextEditor from './RemoteTextEditor.vue'
import RemoteTextViewer from './RemoteTextViewer.vue'

type DisplayEntry = SftpDisplayEntry
type MenuTarget = 'entry' | 'blank'
type ToolbarActionId = SftpToolbarActionId
type ToolbarAction = SftpToolbarAction

const FILE_COLUMN_DRAG_THRESHOLD = 6
const props = defineProps<{
  connection: Connection | null
  expanded: boolean
  contextId?: string | null
  terminalSessionId?: string | null
}>()
const emit = defineEmits<{
  connect: [connectionId: number]
  reconnect: [connectionId: number, contextId: string, terminalSessionId: string]
  toggle: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const store = useSftpStore()
const pathInput = ref('')
const fileFilterInput = ref('')
const conflictPolicy = ref<SFTPConflictPolicy>('ask')
const busy = ref(false)
const sftpToolbarRef = ref<InstanceType<typeof SftpToolbar> | null>(null)
const pathNavigationState = useSftpPathNavigation()
const pathBookmarksState = useSftpPathBookmarks()
const fileColumnState = useSftpColumnLayout()
const menu = ref<{ x: number; y: number; target: MenuTarget; entry: DisplayEntry | null } | null>(null)
const {
  fileColumnLayout,
  visibleFileColumns,
  tableGridStyle,
  setColumnWidth,
  moveColumn,
  persistLayout: saveFileColumnLayout,
} = fileColumnState
const resizingColumnId = ref<FileColumnId | null>(null)
const draggingColumnId = ref<FileColumnId | null>(null)
const columnDropTargetIndex = ref<number | null>(null)
const detailsWidth = ref(loadSftpDetailsWidth())
const detailsCollapsed = ref(loadSftpDetailsCollapsed())
const dropActive = ref(false)
let draggingDetails = false
let resizingColumn: { id: FileColumnId; startX: number; startWidth: number } | null = null
let reorderingColumn: { id: FileColumnId; startX: number; active: boolean; headers: HTMLElement[] } | null = null
let previousBodyUserSelect = ''
let suppressNextColumnClick = false

const serverId = computed(() => props.connection?.id ?? null)
const sftpContextId = computed(() => serverId.value ? props.contextId || `server:${serverId.value}` : null)
const terminalSessionId = computed(() => props.terminalSessionId ?? '')
const state = computed(() => serverId.value ? store.state(serverId.value, sftpContextId.value) : null)
const currentPath = computed(() => {
  const raw = state.value?.currentPath || ''
  if (state.value?.mode === 'scp' && (!raw || raw === '.')) return '/'
  return raw
})
const online = computed(() => state.value?.status === 'online')
const mode = computed(() => state.value?.mode ?? 'sftp')
const scpMode = computed(() => mode.value === 'scp')
const scpLimitedMode = computed(() => scpMode.value && state.value?.capabilities?.browse === 'none')
const canBrowse = computed(() => state.value?.capabilities?.browse !== 'none')
const showFileFilter = computed(() => online.value && canBrowse.value)
const canUploadFile = computed(() => state.value?.capabilities?.uploadFile !== false)
const canDownloadFile = computed(() => state.value?.capabilities?.downloadFile !== false)
const canUploadDirectory = computed(() => state.value?.capabilities?.uploadDirectory !== false)
const canDownloadDirectory = computed(() => state.value?.capabilities?.downloadDirectory !== false)
const canMkdir = computed(() => state.value?.capabilities?.mkdir !== false)
const canRename = computed(() => state.value?.capabilities?.rename !== false)
const canDelete = computed(() => state.value?.capabilities?.delete !== false)
const canEditText = computed(() => state.value?.capabilities?.editText !== false)
const canGoParent = computed(() => Boolean(currentPath.value && !store.isRootRemotePath(currentPath.value)))
const pathNavigation = computed(() => navigationStateForCurrentContext())
const canUsePathNavigation = computed(() => online.value && canBrowse.value && !busy.value)
const canGoBack = computed(() => canUsePathNavigation.value && pathNavigation.value.backStack.length > 0)
const canGoForward = computed(() => canUsePathNavigation.value && pathNavigation.value.forwardStack.length > 0)
const showHidden = computed(() => store.showHidden(serverId.value, sftpContextId.value))
const selected = computed(() => store.selectedEntries(serverId.value, sftpContextId.value))
const fileEntries = computed<DisplayEntry[]>(() => store.entries(serverId.value, sftpContextId.value) as DisplayEntry[])
const fileFilter = useSftpFileFilter({
  query: fileFilterInput,
  entries: fileEntries,
  currentPath,
  isRootRemotePath: (path) => store.isRootRemotePath(path),
})
const filterActive = fileFilter.filterActive
const filteredFileEntries = fileFilter.filteredEntries
const entryHighlightSegments = fileFilter.highlightSegments
const visibleSelected = computed<DisplayEntry[]>(() =>
  sftpVisibleSelectedEntries(selected.value as DisplayEntry[], filteredFileEntries.value, filterActive.value))
const selectedPaths = computed(() => selected.value.map((entry) => entry.path))
const selectedCount = computed(() => visibleSelected.value.length)
const propertiesTarget = computed(() => {
  if (!online.value || !canBrowse.value || visibleSelected.value.length !== 1) return null
  const target = visibleSelected.value[0]
  if (target?.syntheticParent) return null
  return target
})
const entries = fileFilter.displayEntries
const selectedSize = computed(() => sftpSelectedFileSize(visibleSelected.value))
const fileFilterStatus = fileFilter.filterStatus
const latestTransfer = computed(() => store.lastTransfer(serverId.value, sftpContextId.value))
const latestTransferSummary = computed(() => transferSummary(latestTransfer.value))
const activeTransfers = computed(() => serverId.value
  ? store.transfersFor(serverId.value, 'current', sftpContextId.value)
    .filter((transfer) => ['queued', 'planning', 'running', 'pausing', 'paused', 'resuming'].includes(transfer.status))
  : [])
const remoteText = useSftpRemoteText({
  getContext: () => ({
    connectionId: serverId.value,
    contextId: sftpContextId.value ?? undefined,
    terminalSessionId: terminalSessionId.value,
    generation: state.value?.generation || 0,
  }),
  readTextFile: (request) => api.sftpReadTextFile(
    request.connectionId,
    request.path,
    request.maxBytes,
    request.contextId,
    request.terminalSessionId,
    request.requestId,
  ),
  writeTextFile: (request) => api.sftpWriteTextFile(
    request.connectionId,
    request.path,
    request.content,
    request.expectedSize,
    request.expectedMTime,
    request.forceOverwrite,
    request.contextId,
    request.terminalSessionId,
    request.encoding,
    request.generation,
    request.requestId,
    request.expectedHash,
    request.mode,
    request.conflictPolicy,
  ),
  reconnect: async () => {
    if (!serverId.value) return
    await store.reconnect(
      serverId.value,
      { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false },
      sftpContextId.value,
      terminalSessionId.value,
      false,
    )
  },
  chooseDirtyAction: (actionLabel) => choiceDialog({
    title: '未保存修改',
    message: `${actionLabel}前需要处理当前远程文件的未保存修改。`,
    confirmText: '保存并继续',
    confirmValue: 'save',
    secondaryText: '丢弃修改',
    secondaryValue: 'discard',
    cancelText: '取消',
  }).then((decision) => decision === 'save' || decision === 'discard' ? decision : false),
  chooseConflictAction: (detail, targetExistsConflict) => choiceDialog({
    title: targetExistsConflict ? '目标文件已存在' : '远程文件已被修改',
    message: detail.userMessage || (targetExistsConflict ? '目标文件已存在，是否覆盖？' : '远程文件已被修改，是否覆盖？'),
    confirmText: '覆盖保存',
    confirmValue: 'overwrite',
    secondaryText: targetExistsConflict ? undefined : '重新加载',
    secondaryValue: targetExistsConflict ? undefined : 'reload',
    cancelText: '取消',
    danger: true,
  }).then((decision) => decision === 'overwrite' || decision === 'reload' ? decision : false),
  notify: (message, type) => emit('notify', message, type),
  upsertEntry: updateStoredEntry,
  formatError: errorMessage,
  getUnlockReason: () => canEditText.value ? '' : '当前文件连接不支持文本编辑。',
})
const {
  viewerOpen,
  viewerBusy,
  viewerFile,
  viewerMode,
  viewerDraft,
  viewerSaveError,
  viewerDirty,
  viewerBusyAny,
  viewerUnlockReason,
  viewerUnlockDisabled,
} = remoteText
const openTextDraft = remoteText.createNewTextFileDraft
const reloadTextViewer = remoteText.reloadTextFile
const closeTextViewer = remoteText.closeTextFile
const unlockTextViewer = remoteText.unlockReadWrite
const lockTextViewerReadonly = remoteText.switchReadOnly
const saveTextViewer = remoteText.saveTextFile

async function openTextViewer(entry: DisplayEntry, discardDirty = false) {
  if (!canEditText.value) return false
  return remoteText.openTextFile(entry, discardDirty)
}
const propertiesFlow = useSftpPropertiesFlow({
  getContext: () => ({
    connectionId: serverId.value,
    contextId: sftpContextId.value ?? undefined,
    terminalSessionId: terminalSessionId.value,
    generation: state.value?.generation || 0,
    online: online.value,
    canBrowse: canBrowse.value,
  }),
  getProperties: (request) => api.sftpGetRemoteItemProperties(
    request.connectionId,
    request.path,
    request.contextId,
    request.terminalSessionId,
    request.generation,
    request.requestId,
  ),
  updatePermissions: (request) => api.sftpUpdateRemoteItemPermissions(
    request.connectionId,
    request.path,
    request.mode,
    request.preserveSpecialBits,
    request.contextId,
    request.terminalSessionId,
    request.generation,
    request.requestId,
  ),
  notify: (message, type) => emit('notify', message, type),
  upsertEntry: updateStoredEntry,
  formatError: errorMessage,
})
const {
  propertiesOpen,
  propertiesBusy,
  propertiesError,
  propertiesItem,
  openProperties,
  applyRemotePermissions,
  closeProperties,
} = propertiesFlow
const deleteFlow = useSftpDeleteFlow({
  getContext: () => ({
    connectionId: serverId.value,
    contextId: sftpContextId.value ?? undefined,
    terminalSessionId: terminalSessionId.value,
    busy: busy.value,
  }),
  inspectDelete: (request) => store.inspectDelete(
    request.connectionId,
    request.entries,
    request.recursive,
    request.contextId,
    request.terminalSessionId,
  ),
  deleteItems: (request) => store.removePaths(
    request.connectionId,
    request.paths,
    request.recursive,
    request.contextId,
    request.terminalSessionId,
  ),
  confirmDelete: confirmDialog,
  notify: (message, type) => emit('notify', message, type),
  setBusy: (value) => { busy.value = value },
  formatError: errorMessage,
})
const removeSelected = () => deleteFlow.removeSelected(visibleSelected.value)
const transferActions = useSftpTransferActions({
  getContext: () => ({
    connectionId: serverId.value,
    contextId: sftpContextId.value ?? undefined,
    terminalSessionId: terminalSessionId.value,
    online: online.value,
    scpMode: scpMode.value,
    currentPath: currentPath.value,
    scpRemotePath: scpRemotePath(),
    conflictPolicy: conflictPolicy.value,
    canUploadFile: canUploadFile.value,
    canUploadDirectory: canUploadDirectory.value,
    canDownloadFile: canDownloadFile.value,
    canDownloadDirectory: canDownloadDirectory.value,
  }),
  getSelectedEntries: () => visibleSelected.value,
  selectLocalUploadFiles: api.selectLocalUploadFiles,
  selectLocalUploadDirectory: api.selectLocalUploadDirectory,
  selectLocalDownloadDirectory: api.selectLocalDownloadDirectory,
  uploadFiles: (request) => store.uploadFiles(
    request.connectionId,
    request.localPaths,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  uploadFilesTo: (request) => store.uploadFilesTo(
    request.connectionId,
    request.localPaths,
    request.remoteDirectory,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  uploadDirectory: (request) => store.uploadDirectory(
    request.connectionId,
    request.localPath,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  uploadDirectoryTo: (request) => store.uploadDirectoryTo(
    request.connectionId,
    request.localPath,
    request.remoteDirectory,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  downloadEntries: (request) => store.downloadEntries(
    request.connectionId,
    request.localDirectory,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  downloadPath: (request) => store.downloadPath(
    request.connectionId,
    request.remotePath,
    request.localDirectory,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  downloadDirectoryPath: (request) => store.downloadDirectoryPath(
    request.connectionId,
    request.remotePath,
    request.localDirectory,
    request.conflictPolicy,
    request.contextId,
    request.terminalSessionId,
  ),
  chooseRecursiveConflictPolicy: recursiveConflictPolicy,
  confirmOverwrite: confirmDialog,
  restrictSelectionToVisible,
  notify: (message, type) => emit('notify', message, type),
  run: async (operation, fallback) => {
    await run(async () => { await operation() }, fallback)
  },
  formatError: errorMessage,
})
const upload = transferActions.upload
const uploadDirectory = transferActions.uploadDirectory
const uploadLocalPaths = transferActions.uploadLocalPaths
const download = transferActions.download
const downloadScpFile = transferActions.downloadScpFile
const downloadScpDirectory = transferActions.downloadScpDirectory
const toolbarActions = computed<ToolbarAction[]>(() => {
  const actions: ToolbarAction[] = [{
    id: 'reconnect',
    label: '重新连接',
    className: 'sftp-reconnect',
    disabled: !serverId.value || busy.value || state.value?.status === 'connecting',
  }, {
    id: 'back',
    label: '后退',
    disabled: !canGoBack.value,
  }, {
    id: 'forward',
    label: '前进',
    disabled: !canGoForward.value,
  }, {
    id: 'refresh',
    label: '刷新',
    className: 'sftp-refresh',
    disabled: !online.value || busy.value || !canBrowse.value,
  }, {
    id: 'parent',
    label: '向上',
    disabled: !online.value || busy.value || !canBrowse.value || !canGoParent.value,
  }, {
    id: 'home',
    label: 'Home',
    disabled: !online.value || busy.value || !canBrowse.value,
  }, {
    id: 'bookmark',
    label: '收藏',
    disabled: !canUsePathNavigation.value || !currentPath.value,
  }, {
    id: 'bookmarks',
    label: '收藏夹',
    disabled: !online.value || busy.value || !canBrowse.value || !serverId.value,
  }, {
    id: 'open',
    label: '打开',
    className: 'sftp-open',
    disabled: !online.value || busy.value || selectedCount.value !== 1 || visibleSelected.value[0]?.isDir || !canEditText.value,
  }, {
    id: 'mkdir',
    label: '新建文件夹',
    disabled: !online.value || busy.value || !canMkdir.value,
  }, {
    id: 'new-file',
    label: '新建文件',
    disabled: !online.value || busy.value || !canBrowse.value || !canEditText.value,
  }, {
    id: 'upload',
    label: '上传',
    disabled: !online.value || busy.value || !canUploadFile.value,
  }, {
    id: 'upload-directory',
    label: '上传文件夹',
    disabled: !online.value || busy.value || !canUploadDirectory.value,
  }, {
    id: 'download',
    label: '下载',
    disabled: !online.value || busy.value || selectedCount.value === 0 || (!canDownloadFile.value && !canDownloadDirectory.value),
  }, {
    id: 'scp-download-directory',
    label: '下载目录',
    disabled: !online.value || busy.value || !canDownloadDirectory.value,
    show: scpMode.value,
  }, {
    id: 'properties',
    label: '属性',
    disabled: !online.value || busy.value || !canBrowse.value || !propertiesTarget.value,
  }, {
    id: 'delete',
    label: '删除',
    tone: 'danger',
    disabled: !online.value || busy.value || selectedCount.value === 0 || !canDelete.value,
  }, {
    id: 'rename',
    label: '重命名',
    disabled: !online.value || busy.value || selectedCount.value !== 1 || !canRename.value,
  }, {
    id: 'hidden',
    label: '显示隐藏文件',
    disabled: !serverId.value || !canBrowse.value,
    active: showHidden.value,
  }, {
    id: 'conflict-policy',
    label: '冲突处理策略',
  }]
  return actions.filter((action) => action.show !== false)
})
const contentStyle = computed(() => ({
  gridTemplateColumns: detailsCollapsed.value
    ? 'minmax(0, 1fr) 28px'
    : `minmax(0, 1fr) ${detailsWidth.value}px`,
}))
const currentSortKey = computed(() => store.sortKey(serverId.value, sftpContextId.value))
const currentSortAsc = computed(() => store.sortAsc(serverId.value, sftpContextId.value))
const statusText = computed(() => {
  if (!props.connection) return '未连接服务器'
  if (state.value?.status === 'connecting') return '正在连接'
  if (state.value?.status === 'online') return scpMode.value ? 'SCP 兼容模式' : '已连接'
  if (state.value?.status === 'error') return shortError(state.value.message)
  return '未连接'
})
const detailsEntry = computed<DisplayEntry | null>(() => {
  if (visibleSelected.value.length === 1) return visibleSelected.value[0]
  return null
})
const detailsRows = computed<SftpDetailsRow[]>(() => {
  const entry = detailsEntry.value
  if (!entry) return []
  return [
    { label: '名称', value: entry.name, title: entry.name },
    { label: '类型', value: entryType(entry) },
    { label: '大小', value: entry.isDir ? '—' : formatBytes(entry.size) },
    { label: '权限', value: entry.permissions || '—' },
    { label: '所有者', value: entry.owner || '—' },
    { label: '用户组', value: entry.group || '—' },
    { label: '修改时间', value: formatTime(entry.modTime) },
    { label: '隐藏文件', value: isHidden(entry) ? '是' : '否' },
    { label: '符号链接', value: entry.isSymlink ? '是' : '否' },
    { label: '权限原文', value: entry.permissions || '—', code: true },
    { label: '远程路径', value: entry.path, title: entry.path },
  ]
})
const currentBookmarks = computed(() => {
  if (!serverId.value) return []
  return pathBookmarksState.bookmarks.value.byServerId[String(serverId.value)] ?? []
})
const menuItems = computed<ContextMenuItem[]>(() => {
  if (!menu.value) return []
  return buildSftpContextMenuItems({
    target: menu.value.target,
    entry: menu.value.entry,
    selectedCount: visibleSelected.value.length,
    online: online.value,
    busy: busy.value,
    canBrowse: canBrowse.value,
    canEditText: canEditText.value,
  })
})

watch(() => currentPath.value, (path, previousPath) => {
  pathInput.value = path ?? ''
  if (previousPath && path && normalizeRemoteInputPath(previousPath) !== normalizeRemoteInputPath(path)) {
    clearFileFilter()
  }
}, { immediate: true })

watch(fileFilterInput, async () => {
  if (serverId.value) store.clearSelection(serverId.value, sftpContextId.value)
  await nextTick()
})

watch(() => sftpContextId.value ? store.uploadRefreshErrorsByContextId[sftpContextId.value] : '', (message) => {
  if (!serverId.value || !sftpContextId.value || !message) return
  emit('notify', message, 'error')
  store.clearUploadRefreshError(serverId.value, sftpContextId.value)
})

function shortError(message = '') {
  if (!message) return '连接失败'
  if (message.includes('口令') || message.toLowerCase().includes('passphrase')) return '需要口令'
  return '连接失败'
}

function persistFileColumnLayout() {
  if (!saveFileColumnLayout()) {
    emit('notify', '文件列表列布局保存失败，本次调整仅临时生效', 'error')
  }
}

function persistPathBookmarkResult(saved: boolean) {
  if (!saved) {
    emit('notify', '路径收藏保存失败，本次调整仅临时生效', 'error')
  }
}

function navigationStateForCurrentContext() {
  return pathNavigationState.navigationFor(sftpContextId.value, serverId.value, currentPath.value || '')
}

function recordSuccessfulNavigation(previousPath: string, nextPath: string) {
  pathNavigationState.recordSuccessfulNavigation(sftpContextId.value, serverId.value, previousPath, nextPath)
}

async function handleToolbarAction(id: ToolbarActionId) {
  if (id === 'reconnect') await reconnectSftp()
  else if (id === 'back') await goBack()
  else if (id === 'forward') await goForward()
  else if (id === 'refresh') await refresh()
  else if (id === 'parent') await goParent()
  else if (id === 'home') await goHome()
  else if (id === 'bookmark') await addCurrentPathBookmark()
  else if (id === 'open') await openSelectedFile()
  else if (id === 'mkdir') await mkdir()
  else if (id === 'new-file') await createRemoteTextFile()
  else if (id === 'upload') await upload()
  else if (id === 'upload-directory') await uploadDirectory()
  else if (id === 'download') await download()
  else if (id === 'scp-download-directory') await downloadScpDirectory()
  else if (id === 'properties') await openSelectedProperties()
  else if (id === 'delete') await removeSelected()
  else if (id === 'rename') await rename()
  else if (id === 'hidden') toggleHidden()
}

async function run(action: () => Promise<void>, fallback: string) {
  if (!serverId.value) return false
  busy.value = true
  try {
    await action()
    return true
  } catch (reason) {
    emit('notify', errorMessage(reason, fallback), 'error')
    return false
  } finally {
    busy.value = false
  }
}

function retrySftp() {
  if (serverId.value && state.value?.status !== 'connecting') emit('connect', serverId.value)
}

async function reconnectSftp() {
  if (!serverId.value || !sftpContextId.value || state.value?.status === 'connecting') return
  if (activeTransfers.value.length > 0) {
    const confirmed = await confirmDialog({
      title: '重新连接文件传输',
      message: `当前有 ${activeTransfers.value.length} 个上传或下载任务仍在运行。重新连接会终止这些传输。`,
      confirmText: '终止传输并重连',
      cancelText: '取消',
      danger: true,
    })
    if (!confirmed) return
  }
  emit('reconnect', serverId.value, sftpContextId.value, terminalSessionId.value)
}

async function refresh() {
  if (!serverId.value || !currentPath.value) return
  await run(async () => { await store.list(serverId.value!, currentPath.value, sftpContextId.value, terminalSessionId.value) }, '刷新目录失败')
}

async function navigateToPath(path: string, fallback: string) {
  if (!serverId.value || !canBrowse.value) return false
  const targetPath = normalizeRemoteInputPath(path)
  if (!targetPath) {
    emit('notify', '远程路径无效', 'error')
    return false
  }
  const previousPath = currentPath.value
  if (normalizeRemoteInputPath(previousPath) === targetPath) {
    pathInput.value = targetPath
    return true
  }
  let loadedPath = targetPath
  const success = await run(async () => {
    const result = await store.list(serverId.value!, targetPath, sftpContextId.value, terminalSessionId.value)
    loadedPath = normalizeRemoteInputPath(result.path || targetPath) || targetPath
  }, fallback)
  if (success) recordSuccessfulNavigation(previousPath, loadedPath)
  return success
}

async function goHome() {
  if (!serverId.value || !canBrowse.value) return
  const previousPath = currentPath.value
  let loadedPath = previousPath
  const success = await run(async () => {
    const result = await store.home(serverId.value!, sftpContextId.value, terminalSessionId.value)
    loadedPath = normalizeRemoteInputPath(result.path || state.value?.currentPath || previousPath) || previousPath
  }, '返回 Home 失败')
  if (success) recordSuccessfulNavigation(previousPath, loadedPath)
}

async function goParent() {
  if (!serverId.value || !currentPath.value || store.isRootRemotePath(currentPath.value)) return
  await navigateToPath(store.parentRemotePath(currentPath.value), '返回上级目录失败')
}

async function goBack() {
  if (!serverId.value || !canGoBack.value) return
  const navigation = navigationStateForCurrentContext()
  const targetPath = navigation.backStack[navigation.backStack.length - 1]
  if (!targetPath) return
  const previousPath = currentPath.value
  let loadedPath = targetPath
  const success = await run(async () => {
    const result = await store.list(serverId.value!, targetPath, sftpContextId.value, terminalSessionId.value)
    loadedPath = normalizeRemoteInputPath(result.path || targetPath) || targetPath
  }, '后退失败')
  if (!success) return
  pathNavigationState.applyBackNavigation(sftpContextId.value, serverId.value, navigation, previousPath, loadedPath)
}

async function goForward() {
  if (!serverId.value || !canGoForward.value) return
  const navigation = navigationStateForCurrentContext()
  const targetPath = navigation.forwardStack[navigation.forwardStack.length - 1]
  if (!targetPath) return
  const previousPath = currentPath.value
  let loadedPath = targetPath
  const success = await run(async () => {
    const result = await store.list(serverId.value!, targetPath, sftpContextId.value, terminalSessionId.value)
    loadedPath = normalizeRemoteInputPath(result.path || targetPath) || targetPath
  }, '前进失败')
  if (!success) return
  pathNavigationState.applyForwardNavigation(sftpContextId.value, serverId.value, navigation, previousPath, loadedPath)
}

async function addCurrentPathBookmark() {
  if (!serverId.value || !canBrowse.value || !currentPath.value) return
  const path = normalizeRemoteInputPath(currentPath.value)
  if (!path) {
    emit('notify', '远程路径无效', 'error')
    return
  }
  const result = pathBookmarksState.addBookmark(serverId.value, path)
  if (result.status === 'invalid') {
    emit('notify', '远程路径无效', 'error')
    return
  }
  persistPathBookmarkResult(result.saved)
  if (result.status === 'duplicate') {
    emit('notify', '路径已在收藏夹', 'info')
    return
  }
  emit('notify', '路径已收藏', 'success')
}

async function jumpBookmark(bookmark: SftpPathBookmark) {
  const success = await navigateToPath(bookmark.path, '跳转收藏路径失败')
  if (success) sftpToolbarRef.value?.closeBookmarkMenu()
}

function deleteBookmark(bookmarkId: string) {
  if (!serverId.value) return
  persistPathBookmarkResult(pathBookmarksState.deleteBookmark(serverId.value, bookmarkId))
}

async function jumpPath() {
  if (!serverId.value || !pathInput.value.trim()) return
  const previous = currentPath.value
  await navigateToPath(pathInput.value, '切换远程目录失败')
  if (state.value?.currentPath === previous) pathInput.value = previous
}

async function enter(entry: DisplayEntry) {
  if (entry.syntheticParent) {
    await goParent()
    return
  }
  if (!serverId.value) return
  if (!entry.isDir) {
    await openTextViewer(entry)
    return
  }
  await navigateToPath(entry.path, '进入目录失败')
}

async function openSelectedFile() {
  if (visibleSelected.value.length !== 1 || visibleSelected.value[0].isDir) return
  await openTextViewer(visibleSelected.value[0])
}

function select(entry: DisplayEntry, event: MouseEvent) {
  if (!serverId.value || entry.syntheticParent) return
  store.toggleSelection(serverId.value, entry.path, event.ctrlKey || event.metaKey || event.shiftKey, sftpContextId.value)
}

function activateParentIcon(entry: DisplayEntry, event: MouseEvent) {
  if (!entry.syntheticParent) return
  event.preventDefault()
  event.stopPropagation()
  void goParent()
}

function selectForMenu(entry: DisplayEntry) {
  if (!serverId.value || entry.syntheticParent) return
  if (!selected.value.some((item) => item.path === entry.path)) {
    store.toggleSelection(serverId.value, entry.path, false, sftpContextId.value)
  }
}

async function mkdir() {
  if (!serverId.value || !online.value) return
  const value = await inputDialog({
    title: '新建远程文件夹',
    label: '文件夹名称',
    placeholder: '输入文件夹名称',
    confirmText: '新建',
    validate: (name) => {
      if (!name) return '名称不能为空'
      if (/[\\/]/.test(name)) return '名称不能包含路径分隔符'
      if (name === '.' || name === '..') return '该名称不可用'
      return ''
    },
  })
  if (!value) return
  await run(() => store.mkdir(serverId.value!, value, sftpContextId.value, terminalSessionId.value), '新建文件夹失败')
}

async function createRemoteTextFile() {
  if (!serverId.value || !online.value || !canBrowse.value || !canEditText.value) return
  const value = await inputDialog({
    title: '新建远程文件',
    label: '文件名或相对路径',
    placeholder: '例如 notes.txt 或 scripts/install.sh',
    confirmText: '新建',
    validate: (path) => validateRemoteTextPathInput(path, false),
  })
  if (!value) return
  const targetPath = joinRemoteTextPath(currentPath.value || '.', value, false)
  if (!targetPath) {
    emit('notify', '路径无效', 'error')
    return
  }
  openTextDraft(targetPath, 'create_new')
}

async function rename() {
  if (!serverId.value || visibleSelected.value.length !== 1) return
  const target = visibleSelected.value[0]
  const value = await inputDialog({
    title: '重命名',
    label: '新名称',
    initialValue: target.name,
    confirmText: '重命名',
    validate: (name) => {
      if (!name) return '名称不能为空'
      if (/[\\/]/.test(name)) return '本轮只支持同目录重命名'
      if (name === target.name) return '名称没有变化'
      return ''
    },
  })
  if (!value) return
  const parent = target.parentPath === '/' ? '/' : target.parentPath.replace(/\/+$/, '')
  const nextPath = parent === '/' ? `/${value}` : `${parent}/${value}`
  await run(() => store.rename(serverId.value!, target.path, nextPath, sftpContextId.value, terminalSessionId.value), '重命名失败')
}

function selectAllFileEntries() {
  if (!serverId.value) return
  store.clearSelection(serverId.value, sftpContextId.value)
  for (const entry of filteredFileEntries.value) store.toggleSelection(serverId.value, entry.path, true, sftpContextId.value)
}

function restrictSelectionToVisible() {
  if (!serverId.value || !filterActive.value) return
  const visiblePaths = new Set(visibleSelected.value.map((entry) => entry.path))
  const hiddenSelected = selected.value.some((entry) => !visiblePaths.has(entry.path))
  if (!hiddenSelected) return
  const visible = visibleSelected.value.slice()
  store.clearSelection(serverId.value, sftpContextId.value)
  for (const entry of visible) store.toggleSelection(serverId.value, entry.path, true, sftpContextId.value)
}

function clearFileFilter() {
  fileFilterInput.value = ''
}

function focusFileFilter() {
  if (!showFileFilter.value) return
  sftpToolbarRef.value?.focusFilter()
}

function handleFileFilterKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    event.stopPropagation()
    const input = event.currentTarget as HTMLInputElement
    input.select()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (filterActive.value) clearFileFilter()
    else (event.currentTarget as HTMLInputElement).blur()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
  }
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest([
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '.cm-editor',
    '.cm-content',
    '.sftp-editor',
    '.sftp-viewer',
  ].join(',')))
}

function handleFileListKeydown(event: KeyboardEvent) {
  if (isEditableKeyboardTarget(event.target)) return
  const targetElement = event.target instanceof HTMLElement ? event.target : null
  if (targetElement?.closest('.sftp-head, .sftp-column-head, .sftp-column-resizer')) return
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    event.stopPropagation()
    focusFileFilter()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    event.stopPropagation()
    selectAllFileEntries()
    return
  }
  if (event.key === 'Escape' && filterActive.value) {
    event.preventDefault()
    event.stopPropagation()
    clearFileFilter()
    return
  }
  if (event.key === 'Delete') {
    if (visibleSelected.value.length === 0 || busy.value || !canDelete.value) return
    event.preventDefault()
    event.stopPropagation()
    void removeSelected()
    return
  }
  if (event.key === 'F2') {
    if (visibleSelected.value.length !== 1 || !canRename.value) return
    event.preventDefault()
    event.stopPropagation()
    void rename()
    return
  }
  if (event.key === 'Enter') {
    if (visibleSelected.value.length !== 1) return
    event.preventDefault()
    event.stopPropagation()
    void enter(visibleSelected.value[0])
    return
  }
  if (event.key === 'Backspace') {
    if (!canGoParent.value) return
    event.preventDefault()
    event.stopPropagation()
    void goParent()
  }
}

async function recursiveConflictPolicy(title: string): Promise<SFTPConflictPolicy | null> {
  if (conflictPolicy.value !== 'ask') return conflictPolicy.value
  const decision = await choiceDialog({
    title,
    message: '递归任务会统一使用同一种冲突策略，不会在每个文件上反复弹窗。',
    confirmText: '覆盖全部',
    confirmValue: 'overwrite',
    secondaryText: '自动重命名',
    secondaryValue: 'rename',
    cancelText: '跳过冲突',
  }) as SFTPConflictPolicy | false | null
  if (decision === 'overwrite' || decision === 'rename') return decision
  return 'skip'
}

function sortBy(key: FileSortableColumnId) {
  if (serverId.value) store.sortBy(serverId.value, key, sftpContextId.value)
}

function sortColumn(column: FileColumn) {
  if (suppressNextColumnClick) {
    suppressNextColumnClick = false
    return
  }
  if (column.sortable) sortBy(column.sortable)
}

function sortDirection(column: FileColumn) {
  if (!column.sortable || currentSortKey.value !== column.sortable) return 'none'
  return currentSortAsc.value ? 'ascending' : 'descending'
}

function toggleHidden() {
  if (serverId.value) store.toggleHidden(serverId.value, sftpContextId.value)
}

function scpRemotePath() {
  return pathInput.value.trim() || currentPath.value || '.'
}

function isHidden(entry: DisplayEntry) {
  return isSftpHiddenEntry(entry)
}

async function showProperties(entry: DisplayEntry) {
  if (!serverId.value || entry.syntheticParent) return
  if (!selected.value.some((item) => item.path === entry.path)) {
    store.toggleSelection(serverId.value, entry.path, false, sftpContextId.value)
  }
  await openProperties(entry)
}

async function showSelectedProperties() {
  await openSelectedProperties()
}

async function openSelectedProperties() {
  const target = propertiesTarget.value
  if (!target) return
  await openProperties(target)
}

async function saveTextViewerAs() {
  if (!viewerFile.value || viewerBusyAny.value || viewerMode.value !== 'readwrite') return false
  if (viewerFile.value.truncated) {
    emit('notify', '当前文件是截断预览，不能另存为。', 'error')
    return false
  }
  if (!isEditableTextEncoding(viewerFile.value.encoding)) {
    emit('notify', '当前编码暂不支持安全写入，不能另存为。', 'error')
    return false
  }
  const value = await inputDialog({
    title: '另存为',
    label: '远程路径',
    initialValue: remoteBasename(viewerFile.value.path || viewerFile.value.entry.path),
    placeholder: '例如 copy.txt 或 /tmp/copy.txt',
    confirmText: '另存为',
    validate: (path) => validateRemoteTextPathInput(path, true),
  })
  if (!value) return false
  const targetPath = joinRemoteTextPath(remoteParentPath(viewerFile.value.path || viewerFile.value.entry.path), value, true)
  if (!targetPath) {
    emit('notify', '路径无效', 'error')
    return false
  }
  return remoteText.saveTextFileAs(targetPath)
}

function updateStoredEntry(entry: SFTPEntry) {
  if (!serverId.value) return
  const contextKey = sftpContextId.value || `server:${serverId.value}`
  const update = (rows?: SFTPEntry[]) => {
    if (!rows) return rows
    let found = false
    const next = rows.map((item) => {
      if (item.path !== entry.path) return item
      found = true
      return { ...item, ...entry }
    })
    const current = normalizeRemoteInputPath(currentPath.value || '')
    const parent = normalizeRemoteInputPath(entry.parentPath || remoteParentPath(entry.path))
    if (!found && current && parent === current) next.push(entry)
    return next
  }
  store.entriesByContextId[contextKey] = update(store.entriesByContextId[contextKey]) ?? store.entriesByContextId[contextKey]
  if (contextKey === `server:${serverId.value}`) {
    store.entriesByServerId[serverId.value] = update(store.entriesByServerId[serverId.value]) ?? store.entriesByServerId[serverId.value]
  }
}

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value)
    emit('notify', success, 'success')
  } catch (reason) {
    emit('notify', errorMessage(reason, '复制失败'), 'error')
  }
}

function openEntryMenu(entry: DisplayEntry, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  selectForMenu(entry)
  menu.value = { x: event.clientX, y: event.clientY, target: 'entry', entry }
}

function openBlankMenu(event: MouseEvent) {
  event.preventDefault()
  if ((event.target as HTMLElement).closest('.sftp-row')) return
  menu.value = { x: event.clientX, y: event.clientY, target: 'blank', entry: null }
}

function beginColumnInteraction() {
  if (!document.body) return
  if (!previousBodyUserSelect) previousBodyUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'
}

function endColumnInteraction() {
  if (!document.body) return
  document.body.style.userSelect = previousBodyUserSelect
  previousBodyUserSelect = ''
}

function startColumnResize(columnId: FileColumnId, event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  const startWidth = fileColumnLayout.value.columnWidths[columnId]
  resizingColumn = { id: columnId, startX: event.clientX, startWidth }
  resizingColumnId.value = columnId
  beginColumnInteraction()
  window.addEventListener('pointermove', moveColumnResize)
  window.addEventListener('pointerup', stopColumnResize)
}

function moveColumnResize(event: PointerEvent) {
  if (!resizingColumn) return
  event.preventDefault()
  setColumnWidth(resizingColumn.id, resizingColumn.startWidth + event.clientX - resizingColumn.startX)
}

function stopColumnResize() {
  if (resizingColumn) persistFileColumnLayout()
  resizingColumn = null
  resizingColumnId.value = null
  window.removeEventListener('pointermove', moveColumnResize)
  window.removeEventListener('pointerup', stopColumnResize)
  endColumnInteraction()
}

function startColumnReorder(columnId: FileColumnId, event: PointerEvent) {
  if (event.button !== undefined && event.button !== 0) return
  if ((event.target as HTMLElement).closest('.sftp-column-resizer')) return
  const table = (event.currentTarget as HTMLElement).closest('.sftp-table')
  const headers = table
    ? Array.from(table.querySelectorAll<HTMLElement>('.sftp-column-head[data-column-id]'))
    : []
  reorderingColumn = { id: columnId, startX: event.clientX, active: false, headers }
  window.addEventListener('pointermove', moveColumnReorder)
  window.addEventListener('pointerup', stopColumnReorder)
}

function moveColumnReorder(event: PointerEvent) {
  if (!reorderingColumn) return
  if (!reorderingColumn.active) {
    if (Math.abs(event.clientX - reorderingColumn.startX) < FILE_COLUMN_DRAG_THRESHOLD) return
    reorderingColumn.active = true
    draggingColumnId.value = reorderingColumn.id
    beginColumnInteraction()
  }
  event.preventDefault()
  const targetIndex = fileColumnTargetIndex(event.clientX, reorderingColumn.id)
  if (targetIndex < 0) return
  columnDropTargetIndex.value = targetIndex
  moveColumn(reorderingColumn.id, targetIndex)
}

function stopColumnReorder() {
  if (reorderingColumn?.active) {
    suppressNextColumnClick = true
    window.setTimeout(() => { suppressNextColumnClick = false }, 0)
    persistFileColumnLayout()
  }
  reorderingColumn = null
  draggingColumnId.value = null
  columnDropTargetIndex.value = null
  window.removeEventListener('pointermove', moveColumnReorder)
  window.removeEventListener('pointerup', stopColumnReorder)
  endColumnInteraction()
}

function fileColumnTargetIndex(clientX: number, draggedId: FileColumnId) {
  const headers = reorderingColumn?.headers ?? []
  const rawIndex = headers.findIndex((header) => {
    const rect = header.getBoundingClientRect()
    return clientX < rect.left + rect.width / 2
  })
  const currentOrder = fileColumnLayout.value.columnOrder
  const fromIndex = currentOrder.indexOf(draggedId)
  if (fromIndex < 0) return -1
  let targetIndex = rawIndex < 0 ? currentOrder.length : rawIndex
  if (fromIndex < targetIndex) targetIndex -= 1
  return Math.max(0, Math.min(targetIndex, currentOrder.length - 1))
}

function cleanupColumnInteractions() {
  window.removeEventListener('pointermove', moveColumnResize)
  window.removeEventListener('pointerup', stopColumnResize)
  window.removeEventListener('pointermove', moveColumnReorder)
  window.removeEventListener('pointerup', stopColumnReorder)
  resizingColumn = null
  reorderingColumn = null
  resizingColumnId.value = null
  draggingColumnId.value = null
  columnDropTargetIndex.value = null
  endColumnInteraction()
}

async function handleMenu(id: string) {
  const entry = menu.value?.entry
  if (id === 'parent') await goParent()
  else if (id === 'open' && entry) await enter(entry)
  else if (id === 'download') await download()
  else if (id === 'rename') await rename()
  else if (id === 'delete') await removeSelected()
  else if (id === 'refresh') await refresh()
  else if (id === 'home') await goHome()
  else if (id === 'mkdir') await mkdir()
  else if (id === 'new-file') await createRemoteTextFile()
  else if (id === 'upload') await upload()
  else if (id === 'upload-directory') await uploadDirectory()
  else if (id === 'hidden') toggleHidden()
  else if (id === 'copy-path' && entry) await copyText(entry.path, '路径已复制')
  else if (id === 'copy-name' && entry) await copyText(entry.name, '名称已复制')
  else if (id === 'copy-paths') await copyText(visibleSelected.value.map((item) => item.path).join('\n'), '路径已复制')
  else if (id === 'copy-current-path') await copyText(currentPath.value, '当前路径已复制')
  else if (id === 'properties') {
    if (visibleSelected.value.length > 1) return
    if (entry) await showProperties(entry)
    else await showSelectedProperties()
    await nextTick()
  }
}

function startDetailsDrag(event: PointerEvent) {
  if (detailsCollapsed.value) return
  draggingDetails = true
  window.addEventListener('pointermove', moveDetailsDrag)
  window.addEventListener('pointerup', stopDetailsDrag, { once: true })
  event.preventDefault()
}

function moveDetailsDrag(event: PointerEvent) {
  if (!draggingDetails) return
  detailsWidth.value = calculateSftpDetailsDragWidth(window.innerWidth, event.clientX)
}

function stopDetailsDrag() {
  draggingDetails = false
  persistSftpDetailsWidth(detailsWidth.value)
  window.removeEventListener('pointermove', moveDetailsDrag)
}

function toggleDetails() {
  detailsCollapsed.value = !detailsCollapsed.value
  persistSftpDetailsCollapsed(detailsCollapsed.value)
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

function setupFileDrop() {
  OnFileDrop((_, __, paths) => {
    dropActive.value = false
    void uploadLocalPaths(paths)
  }, true)
}

onMounted(() => {
  setupFileDrop()
})

onBeforeUnmount(() => {
  OnFileDropOff()
  window.removeEventListener('pointermove', moveDetailsDrag)
  window.removeEventListener('pointerup', stopDetailsDrag)
  cleanupColumnInteractions()
})
</script>

<template>
  <section class="sftp-panel" :class="{ expanded }">
    <template v-if="expanded">
      <SftpToolbar
        ref="sftpToolbarRef"
        :actions="toolbarActions"
        :current-path="currentPath"
        :path-input="pathInput"
        :scp-mode="scpMode"
        :online="online"
        :show-file-filter="showFileFilter"
        :filter-query="fileFilterInput"
        :filter-active="filterActive"
        :filter-status="fileFilterStatus"
        :conflict-policy="conflictPolicy"
        :bookmarks="currentBookmarks"
        :latest-transfer-summary="latestTransferSummary"
        @update:path-input="pathInput = $event"
        @submit-path="jumpPath"
        @update:filter-query="fileFilterInput = $event"
        @filter-keydown="handleFileFilterKeydown"
        @clear-filter="clearFileFilter"
        @update:conflict-policy="conflictPolicy = $event"
        @action="handleToolbarAction"
        @jump-bookmark="jumpBookmark"
        @delete-bookmark="deleteBookmark"
      />
      <div v-if="!connection" class="sftp-empty">没有活动服务器工作区。</div>
      <div v-else-if="state?.status !== 'online'" class="sftp-empty">
        <strong>{{ statusText }}</strong>
        <span>{{ state?.message || '连接后显示真实远程目录，不使用伪文件列表。' }}</span>
        <button
          v-if="state?.status === 'error' || state?.status === 'offline'"
          class="secondary"
          @click="retrySftp"
        >重试 SFTP</button>
      </div>
      <div v-else-if="scpLimitedMode" class="sftp-empty sftp-compat">
        <strong>SCP 兼容模式</strong>
        <span>当前服务器不支持 SFTP，正在使用 SCP 传输。当前服务器无法递归列出目录，暂不支持文件夹下载。</span>
        <span>请在上方输入远程路径：上传会把该路径作为远程目录，下载会把该路径作为文件或目录路径。</span>
        <div class="sftp-compat-actions">
          <button class="secondary" :disabled="busy || !canUploadFile" @click="upload">上传文件</button>
          <button class="secondary" :disabled="busy || !canUploadDirectory" @click="uploadDirectory">上传文件夹</button>
          <button class="secondary" :disabled="busy || !canDownloadFile" @click="downloadScpFile">下载文件</button>
          <button
            class="secondary"
            :disabled="busy || !canDownloadDirectory"
            title="当前服务器无法递归列出目录，暂不支持文件夹下载。"
            @click="downloadScpDirectory"
          >下载目录</button>
        </div>
      </div>
      <div
        v-else-if="canBrowse"
        class="sftp-content"
        :class="{ 'drop-active': dropActive }"
        :style="contentStyle"
        @dragenter.prevent="dropActive = true"
        @dragleave.prevent="dropActive = false"
        @dragover.prevent
      >
        <SftpFileTable
          :columns="visibleFileColumns"
          :entries="entries"
          :selected-paths="selectedPaths"
          :table-grid-style="tableGridStyle"
          :filter-active="filterActive"
          :filtered-entry-count="filteredFileEntries.length"
          :current-sort-key="currentSortKey"
          :current-sort-asc="currentSortAsc"
          :resizing-column-id="resizingColumnId"
          :dragging-column-id="draggingColumnId"
          :column-drop-target-index="columnDropTargetIndex"
          :highlight-segments="entryHighlightSegments"
          @blank-click="serverId && store.clearSelection(serverId, sftpContextId)"
          @blank-contextmenu="openBlankMenu"
          @keydown="handleFileListKeydown"
          @wheel="handleFileTableWheel"
          @row-click="select"
          @row-dblclick="enter"
          @row-contextmenu="openEntryMenu"
          @parent-click="activateParentIcon"
          @header-sort="sortColumn"
          @column-resize-start="startColumnResize"
          @column-reorder-start="startColumnReorder"
        />
        <SftpDetailsPane
          :collapsed="detailsCollapsed"
          :selected-count="selectedCount"
          :selected-size-text="formatBytes(selectedSize)"
          :detail-rows="detailsRows"
          @toggle-collapsed="toggleDetails"
          @resize-start="startDetailsDrag"
        />
        <div class="sftp-drop-overlay">
          <strong>释放以上传到当前远程目录</strong>
          <span>{{ currentPath || '.' }}</span>
        </div>
      </div>
    </template>

    <RemoteTextViewer
      v-if="viewerOpen && viewerFile && viewerMode === 'readonly'"
      :file="viewerFile"
      :busy="viewerBusyAny"
      :unlock-disabled="viewerUnlockDisabled"
      :unlock-reason="viewerUnlockReason"
      @unlock="unlockTextViewer"
      @reload="reloadTextViewer"
      @close="closeTextViewer"
    />
    <RemoteTextEditor
      v-else-if="viewerOpen && viewerFile"
      :entry="viewerFile.entry"
      :content="viewerDraft"
      :dirty="viewerDirty"
      :busy="viewerBusyAny"
      :save-error="viewerSaveError"
      @update:content="viewerDraft = $event"
      @save="saveTextViewer(false)"
      @save-as="saveTextViewerAs"
      @reload="reloadTextViewer"
      @readonly="lockTextViewerReadonly"
      @close="closeTextViewer"
    />
    <Teleport to="body">
      <RemoteFilePropertiesDialog
        v-if="propertiesOpen && propertiesItem"
        :item="propertiesItem"
        :busy="propertiesBusy"
        :error="propertiesError"
        :connection-name="connection?.name || ''"
        @apply-permissions="applyRemotePermissions"
        @close="closeProperties"
      />
    </Teleport>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @close="menu = null"
      @select="handleMenu"
    />
  </section>
</template>
