import { computed, ref } from 'vue'
import type { SFTPEntry, SFTPSaveError, SFTPReadTextFileResult, SFTPWriteTextFileResult } from '../types'
import {
  normalizeRemoteInputPath,
  remoteBasename,
  remoteParentPath,
} from '../utils/sftpRemotePath'

export type RemoteTextMode = 'readonly' | 'readwrite'
export type RemoteTextSaveMode = 'save_existing' | 'create_new' | 'save_as'
export type RemoteTextConflictPolicy = 'fail_if_changed' | 'fail_if_exists' | 'overwrite'
export type RemoteTextChoice = 'save' | 'discard' | false | null
export type RemoteTextConflictChoice = 'overwrite' | 'reload' | false | null
export type RemoteTextNotifyType = 'success' | 'error' | 'info'

export type RemoteTextContext = {
  connectionId: number | null
  contextId?: string | null
  terminalSessionId?: string
  generation?: number
}

export type RemoteTextReadRequest = {
  connectionId: number
  path: string
  maxBytes: number
  contextId?: string
  terminalSessionId?: string
  requestId: string
}

export type RemoteTextWriteRequest = {
  connectionId: number
  path: string
  content: string
  expectedSize: number
  expectedMTime: string
  forceOverwrite: boolean
  contextId?: string
  terminalSessionId?: string
  encoding: string
  generation: number
  requestId: string
  expectedHash: string
  mode: RemoteTextSaveMode
  conflictPolicy: RemoteTextConflictPolicy
}

export type UseSftpRemoteTextOptions = {
  getContext: () => RemoteTextContext
  readTextFile: (request: RemoteTextReadRequest) => Promise<SFTPReadTextFileResult>
  writeTextFile: (request: RemoteTextWriteRequest) => Promise<SFTPWriteTextFileResult>
  chooseDirtyAction: (actionLabel: string) => Promise<RemoteTextChoice>
  chooseConflictAction: (detail: SFTPSaveError, targetExistsConflict: boolean) => Promise<RemoteTextConflictChoice>
  reconnect?: () => Promise<void>
  notify?: (message: string, type: RemoteTextNotifyType) => void
  upsertEntry?: (entry: SFTPEntry) => void
  formatError?: (reason: unknown, fallback: string) => string
  getUnlockReason?: () => string
  createOpenRequestId?: () => string
  createSaveRequestId?: () => string
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function useSftpRemoteText(options: UseSftpRemoteTextOptions) {
  const viewerOpen = ref(false)
  const viewerBusy = ref(false)
  const viewerFile = ref<SFTPReadTextFileResult | null>(null)
  const viewerMode = ref<RemoteTextMode>('readonly')
  const viewerDraft = ref('')
  const viewerBaseline = ref('')
  const viewerSaveBusy = ref(false)
  const viewerSaveError = ref<SFTPSaveError | null>(null)
  const viewerSaveMode = ref<RemoteTextSaveMode>('save_existing')
  const latestViewerRequestId = ref('')
  const latestViewerSaveRequestId = ref('')

  const viewerDirty = computed(() => viewerMode.value === 'readwrite' && viewerDraft.value !== viewerBaseline.value)
  const viewerBusyAny = computed(() => viewerBusy.value || viewerSaveBusy.value)
  const viewerUnlockReason = computed(() => {
    if (!viewerFile.value) return ''
    if (viewerFile.value.truncated) return '当前仅预览部分内容，不能直接编辑保存。'
    if (!isEditableTextEncoding(viewerFile.value.encoding)) return '该编码暂不支持编辑保存。'
    const injectedReason = options.getUnlockReason?.() ?? ''
    if (injectedReason) return injectedReason
    return ''
  })
  const viewerUnlockDisabled = computed(() => Boolean(viewerUnlockReason.value))

  function notify(message: string, type: RemoteTextNotifyType) {
    options.notify?.(message, type)
  }

  function setDraft(value: string) {
    viewerDraft.value = value
  }

  function context() {
    return options.getContext()
  }

  function createNewTextFileDraft(path: string, saveMode: RemoteTextSaveMode = 'create_new') {
    const current = context()
    if (!current.connectionId) return
    const normalizedPath = normalizeRemoteInputPath(path)
    if (!normalizedPath) return
    const name = remoteBasename(normalizedPath)
    const parentPath = remoteParentPath(normalizedPath)
    const draftEntry: SFTPEntry = {
      name,
      path: normalizedPath,
      parentPath,
      size: 0,
      isDir: false,
      isSymlink: false,
      permissions: '',
      owner: '',
      group: '',
      modTime: '',
    }
    latestViewerRequestId.value = nextViewerRequestId()
    latestViewerSaveRequestId.value = ''
    viewerFile.value = {
      connectionId: current.connectionId,
      contextId: current.contextId ?? undefined,
      generation: current.generation || 0,
      requestId: latestViewerRequestId.value,
      path: normalizedPath,
      name,
      size: 0,
      encoding: 'utf-8',
      contentHash: '',
      truncated: false,
      content: '',
      detectedLanguage: 'generic',
      textKind: 'plaintext',
      entry: draftEntry,
    }
    viewerSaveMode.value = saveMode
    viewerMode.value = 'readwrite'
    viewerBaseline.value = ''
    viewerDraft.value = ''
    viewerSaveError.value = null
    viewerBusy.value = false
    viewerSaveBusy.value = false
    viewerOpen.value = true
  }

  async function openTextFile(entry: SFTPEntry & { syntheticParent?: boolean }, discardDirty = false) {
    const current = context()
    if (!current.connectionId || entry.syntheticParent || entry.isDir) return false
    if (!discardDirty && viewerDirty.value && viewerFile.value?.entry?.path !== entry.path) {
      const decision = await resolveDirtyViewerChoice('打开其它文件')
      if (!decision) return false
    }
    const requestId = nextViewerRequestId()
    latestViewerRequestId.value = requestId
    viewerBusy.value = true
    viewerSaveError.value = null
    try {
      const result = await options.readTextFile({
        connectionId: current.connectionId,
        path: entry.path,
        maxBytes: MAX_TEXT_BYTES,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
        requestId,
      })
      if (requestId !== latestViewerRequestId.value) return false
      viewerFile.value = normalizeViewerFile(result, entry, requestId)
      viewerSaveMode.value = 'save_existing'
      viewerMode.value = 'readonly'
      viewerBaseline.value = viewerFile.value.content
      viewerDraft.value = viewerFile.value.content
      latestViewerSaveRequestId.value = ''
      viewerOpen.value = true
      return true
    } catch (reason) {
      if (requestId === latestViewerRequestId.value) notify(formatError(reason, '打开远程文件失败'), 'error')
      return false
    } finally {
      if (requestId === latestViewerRequestId.value) viewerBusy.value = false
    }
  }

  async function reloadTextFile(discardDirty = false) {
    if (!viewerFile.value?.entry) return false
    if (!discardDirty && viewerDirty.value) {
      const decision = await resolveDirtyViewerChoice('重新加载')
      if (!decision) return false
    }
    return openTextFile(viewerFile.value.entry, true)
  }

  async function closeTextFile() {
    if (viewerDirty.value) {
      const decision = await resolveDirtyViewerChoice('关闭')
      if (!decision) return false
    }
    latestViewerRequestId.value = nextViewerRequestId()
    latestViewerSaveRequestId.value = ''
    viewerOpen.value = false
    viewerBusy.value = false
    viewerSaveBusy.value = false
    viewerFile.value = null
    viewerMode.value = 'readonly'
    viewerDraft.value = ''
    viewerBaseline.value = ''
    viewerSaveError.value = null
    viewerSaveMode.value = 'save_existing'
    return true
  }

  function unlockReadWrite() {
    if (!viewerFile.value) return
    if (viewerUnlockDisabled.value) {
      notify(viewerUnlockReason.value || '当前文件不能编辑保存', 'info')
      return
    }
    viewerMode.value = 'readwrite'
    viewerSaveError.value = null
    viewerSaveMode.value = 'save_existing'
  }

  async function switchReadOnly() {
    if (viewerDirty.value) {
      const decision = await resolveDirtyViewerChoice('切回只读')
      if (!decision) return false
    }
    viewerDraft.value = viewerBaseline.value
    viewerSaveError.value = null
    viewerMode.value = 'readonly'
    return true
  }

  async function resolveDirtyViewerChoice(actionLabel: string) {
    const decision = await options.chooseDirtyAction(actionLabel)
    if (decision === 'save') return saveTextFile(false)
    if (decision === 'discard') {
      viewerDraft.value = viewerBaseline.value
      viewerSaveError.value = null
      return true
    }
    return false
  }

  function viewerConflictPolicy(mode: RemoteTextSaveMode, forceOverwrite: boolean): RemoteTextConflictPolicy {
    if (forceOverwrite) return 'overwrite'
    return mode === 'save_existing' ? 'fail_if_changed' : 'fail_if_exists'
  }

  async function saveTextFileAs(targetPath: string) {
    if (!viewerFile.value || viewerSaveBusy.value || viewerMode.value !== 'readwrite') return false
    if (viewerFile.value.truncated) {
      notify('当前文件是截断预览，不能另存为。', 'error')
      return false
    }
    if (!isEditableTextEncoding(viewerFile.value.encoding)) {
      notify('当前编码暂不支持安全写入，不能另存为。', 'error')
      return false
    }
    const normalizedTarget = normalizeRemoteInputPath(targetPath)
    if (!normalizedTarget) {
      notify('路径无效', 'error')
      return false
    }
    return saveTextFile(false, true, normalizedTarget, 'save_as')
  }

  async function saveTextFile(
    forceOverwrite = false,
    retryBeforeWrite = true,
    targetPath = '',
    targetMode: RemoteTextSaveMode = viewerSaveMode.value,
  ): Promise<boolean> {
    const current = context()
    if (!current.connectionId || !viewerFile.value || viewerSaveBusy.value) return false
    if (targetMode === 'save_existing' && !viewerDirty.value && !forceOverwrite) return true
    const file = viewerFile.value
    const savePath = targetPath || file.path || file.entry.path
    const conflictPolicy = viewerConflictPolicy(targetMode, forceOverwrite)
    const savingExisting = targetMode === 'save_existing'
    const requestId = nextSaveRequestId()
    latestViewerSaveRequestId.value = requestId
    viewerSaveBusy.value = true
    viewerSaveError.value = null
    try {
      const result = await options.writeTextFile({
        connectionId: current.connectionId,
        path: savePath,
        content: viewerDraft.value,
        expectedSize: savingExisting ? (file.size ?? file.entry.size ?? -1) : -1,
        expectedMTime: savingExisting ? (file.entry.modTime || '') : '',
        forceOverwrite,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
        encoding: file.encoding || 'utf-8',
        generation: file.generation || current.generation || 0,
        requestId,
        expectedHash: savingExisting ? (file.contentHash || '') : '',
        mode: targetMode,
        conflictPolicy,
      })
      if (requestId !== latestViewerSaveRequestId.value) return false
      acceptSavedTextResult(result, requestId)
      viewerSaveMode.value = 'save_existing'
      notify(targetMode === 'save_as' ? '已另存为。' : '文件已保存。', 'success')
      return true
    } catch (reason) {
      if (requestId !== latestViewerSaveRequestId.value) return false
      const detail = parseSaveError(reason, viewerFile.value)
      viewerSaveError.value = detail
      if (retryBeforeWrite && canRetrySaveBeforeWrite(detail) && options.reconnect) {
        viewerSaveBusy.value = false
        try {
          await options.reconnect()
          const nextGeneration = context().generation
          if (viewerFile.value && nextGeneration) viewerFile.value = { ...viewerFile.value, generation: nextGeneration }
          return saveTextFile(forceOverwrite, false, targetPath, targetMode)
        } catch (reconnectReason) {
          viewerSaveError.value = parseSaveError(reconnectReason, viewerFile.value)
          return false
        }
      }
      if (detail.code === 'SFTP_SAVE_CONFLICT') {
        viewerSaveBusy.value = false
        const targetExistsConflict = targetMode !== 'save_existing'
        const decision = await options.chooseConflictAction(detail, targetExistsConflict)
        if (decision === 'overwrite') return saveTextFile(true, true, targetPath, targetMode)
        if (decision === 'reload') {
          await reloadTextFile(true)
          return true
        }
        return false
      }
      return false
    } finally {
      if (requestId === latestViewerSaveRequestId.value) viewerSaveBusy.value = false
    }
  }

  function acceptSavedTextResult(result: SFTPWriteTextFileResult, requestId: string) {
    if (!viewerFile.value) return
    const entry = result.entry
    const encoding = result.encoding || viewerFile.value.encoding || 'utf-8'
    viewerFile.value = {
      ...viewerFile.value,
      requestId: result.requestId || requestId,
      generation: result.generation || viewerFile.value.generation,
      path: result.path || entry.path,
      name: result.name || entry.name,
      size: Number.isFinite(result.size) ? result.size : entry.size,
      encoding,
      contentHash: result.contentHash || '',
      content: viewerDraft.value,
      entry,
    }
    viewerBaseline.value = viewerDraft.value
    viewerSaveError.value = null
    options.upsertEntry?.(entry)
  }

  function formatError(reason: unknown, fallback: string) {
    return options.formatError ? options.formatError(reason, fallback) : String(reason || fallback)
  }

  function nextViewerRequestId() {
    return options.createOpenRequestId?.() ?? defaultRequestId('open')
  }

  function nextSaveRequestId() {
    return options.createSaveRequestId?.() ?? defaultRequestId('save')
  }

  return {
    viewerOpen,
    viewerBusy,
    viewerFile,
    viewerMode,
    viewerDraft,
    viewerBaseline,
    viewerSaveBusy,
    viewerSaveError,
    viewerSaveMode,
    viewerDirty,
    viewerBusyAny,
    viewerUnlockReason,
    viewerUnlockDisabled,
    setDraft,
    createNewTextFileDraft,
    openTextFile,
    reloadTextFile,
    closeTextFile,
    unlockReadWrite,
    switchReadOnly,
    saveTextFile,
    saveTextFileAs,
  }
}

export function isEditableTextEncoding(encoding = 'utf-8') {
  return ['utf-8', 'utf8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'gb18030'].includes(encoding.trim().toLowerCase())
}

export function normalizeViewerFile(result: SFTPReadTextFileResult, fallback: SFTPEntry, requestId: string): SFTPReadTextFileResult {
  const entry = result.entry ?? fallback
  return {
    ...result,
    requestId: result.requestId || requestId,
    path: result.path || entry.path,
    name: result.name || entry.name,
    size: Number.isFinite(result.size) ? result.size : entry.size,
    encoding: result.encoding || 'utf-8',
    contentHash: result.contentHash || '',
    truncated: Boolean(result.truncated),
    detectedLanguage: result.detectedLanguage || 'generic',
    textKind: result.textKind || 'plaintext',
    entry,
  }
}

export function parseSaveError(reason: unknown, file?: SFTPReadTextFileResult | null): SFTPSaveError {
  const raw = String(reason).replace(/^Error:\s*/i, '').trim()
  try {
    const parsed = JSON.parse(raw) as Partial<SFTPSaveError>
    return {
      code: parsed.code || 'SFTP_SAVE_FAILED',
      stage: parsed.stage || 'save',
      userMessage: parsed.userMessage || '保存失败。',
      technicalMessage: parsed.technicalMessage || '',
      remotePath: parsed.remotePath || file?.path || file?.entry.path || '',
      operation: parsed.operation || 'sftp.write_text',
      retryable: Boolean(parsed.retryable),
    }
  } catch {
    return {
      code: 'SFTP_SAVE_FAILED',
      stage: 'save',
      userMessage: raw || '保存失败。',
      technicalMessage: '',
      remotePath: file?.path || file?.entry.path || '',
      operation: 'sftp.write_text',
      retryable: false,
    }
  }
}

export function canRetrySaveBeforeWrite(detail: SFTPSaveError) {
  return detail.retryable && ['stat_before_save', 'conflict_check', 'validate_generation'].includes(detail.stage)
}

function defaultRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
