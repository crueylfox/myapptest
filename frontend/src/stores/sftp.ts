import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import type {
  AuthRequest,
  SFTPConflictPolicy,
  SFTPCapabilities,
  SFTPEntry,
  SFTPErrorEvent,
  SFTPListResult,
  SFTPMode,
  SFTPState,
  SFTPTransferState,
} from '../types'

type SftpContextRecord = {
  connectionId: number
  terminalSessionId: string
  contextId: string
}
type SftpSortKey = 'name' | 'type' | 'size' | 'modTime' | 'permissions'

function capabilitiesFor(mode: SFTPMode): SFTPCapabilities {
  if (mode === 'scp') {
    return {
      browse: 'full',
      uploadFile: true,
      downloadFile: true,
      uploadDirectory: true,
      downloadDirectory: true,
      mkdir: true,
      rename: true,
      delete: true,
      editText: true,
    }
  }
  return {
    browse: 'full',
    uploadFile: true,
    downloadFile: true,
    uploadDirectory: true,
    downloadDirectory: true,
    mkdir: true,
    rename: true,
    delete: true,
    editText: true,
  }
}

function contextIdFor(connectionId: number, contextId?: string | null) {
  const value = contextId?.trim()
  return value || `server:${connectionId}`
}

function offlineState(connectionId: number, contextId?: string | null, terminalSessionId = ''): SFTPState {
  return {
    connectionId,
    contextId: contextIdFor(connectionId, contextId),
    terminalSessionId,
    generation: 0,
    status: 'offline',
    active: false,
    mode: 'sftp',
    capabilities: capabilitiesFor('sftp'),
    currentPath: '',
    message: 'SFTP 未连接',
    updatedAt: '',
  }
}

function basename(value: string) {
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() ?? value
}

function joinRemote(parent: string, name: string) {
  const safeName = name.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? name
  if (!parent || parent === '.') return safeName
  if (parent === '/') return `/${safeName}`
  return `${parent.replace(/\/+$/, '')}/${safeName}`
}

function normalizeRemotePath(value: string) {
  const path = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!path || path === '.') return '.'
  if (path === '/') return '/'
  return path.replace(/\/+$/, '')
}

function normalizeStatePath(mode: SFTPMode, value: string | undefined, fallback = '') {
  const raw = value && value.trim() ? value : fallback
  if (!raw) return ''
  const normalized = normalizeRemotePath(raw)
  if (mode === 'scp' && normalized === '.') return '/'
  return normalized
}

function parentRemotePath(value: string) {
  const path = normalizeRemotePath(value)
  if (path === '/' || path === '.') return path
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return path.startsWith('/') ? '/' : '.'
  const parent = parts.slice(0, -1).join('/')
  return path.startsWith('/') ? `/${parent}` : parent
}

function refreshKey(connectionId: number, contextId: string, path: string) {
  return `${connectionId}:${contextId}:${normalizeRemotePath(path)}`
}

function isRootRemotePath(value: string) {
  const path = normalizeRemotePath(value)
  return path === '/' || path === '.'
}

export const useSftpStore = defineStore('sftp', () => {
  const stateByServerId = ref<Record<number, SFTPState>>({})
  const stateByContextId = ref<Record<string, SFTPState>>({})
  const entriesByServerId = ref<Record<number, SFTPEntry[]>>({})
  const entriesByContextId = ref<Record<string, SFTPEntry[]>>({})
  const transfersById = ref<Record<string, SFTPTransferState>>({})
  const errorsByServerId = ref<Record<number, SFTPErrorEvent>>({})
  const errorsByContextId = ref<Record<string, SFTPErrorEvent>>({})
  const uploadRefreshErrorsByServerId = ref<Record<number, string>>({})
  const uploadRefreshErrorsByContextId = ref<Record<string, string>>({})
  const selectedPathsByServerId = ref<Record<number, string[]>>({})
  const selectedPathsByContextId = ref<Record<string, string[]>>({})
  const sortKeyByServerId = ref<Record<number, SftpSortKey>>({})
  const sortKeyByContextId = ref<Record<string, SftpSortKey>>({})
  const sortAscByServerId = ref<Record<number, boolean>>({})
  const sortAscByContextId = ref<Record<string, boolean>>({})
  const showHiddenByServerId = ref<Record<number, boolean>>({})
  const showHiddenByContextId = ref<Record<string, boolean>>({})
  const contextByTerminalSessionId = ref<Record<string, SftpContextRecord>>({})
  const activeContextId = ref<string | null>(null)
  const suppressedServerIds = new Set<number>()
  const latestDirectoryRequestByContextId = new Map<string, string>()
  let directoryRequestCounter = 0
  const pendingUploadRefreshes = new Map<string, {
    connectionId: number
    contextId: string
    path: string
    remotePath: string
    timer: ReturnType<typeof window.setTimeout>
  }>()

  const transfersByServerId = computed<Record<number, SFTPTransferState[]>>(() => {
    const grouped: Record<number, SFTPTransferState[]> = {}
    for (const transfer of Object.values(transfersById.value)) {
      grouped[transfer.connectionId] = [...(grouped[transfer.connectionId] ?? []), transfer]
    }
    for (const serverId of Object.keys(grouped)) {
      grouped[Number(serverId)].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    }
    return grouped
  })

  const transfersByContextId = computed<Record<string, SFTPTransferState[]>>(() => {
    const grouped: Record<string, SFTPTransferState[]> = {}
    for (const transfer of Object.values(transfersById.value)) {
      const contextId = contextIdFor(transfer.connectionId, transfer.contextId)
      grouped[contextId] = [...(grouped[contextId] ?? []), transfer]
    }
    for (const contextId of Object.keys(grouped)) {
      grouped[contextId].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    }
    return grouped
  })

  const allTransfers = computed(() =>
    Object.values(transfersById.value).sort((a, b) => a.startedAt.localeCompare(b.startedAt)))

  function state(connectionId: number | null | undefined, contextId?: string | null) {
    if (!connectionId) return null
    const key = contextIdFor(connectionId, contextId)
    return stateByContextId.value[key] ?? stateByServerId.value[connectionId] ?? offlineState(connectionId, key)
  }

  function rawEntries(connectionId: number | null | undefined, contextId?: string | null) {
    if (!connectionId) return []
    const key = contextIdFor(connectionId, contextId)
    return entriesByContextId.value[key] ?? entriesByServerId.value[connectionId] ?? []
  }

  function compareNames(left: SFTPEntry, right: SFTPEntry, asc: boolean) {
    const result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    return asc ? result : -result
  }

  function fileTypeRank(entry: SFTPEntry) {
    if (entry.isSymlink) return 2
    if (entry.isDir) return 0
    return 1
  }

  function permissionMode(permissions = '') {
    if (permissions.length < 10) return null
    const bits = permissions.slice(1, 10)
    if (!/^[rwxstST-]{9}$/.test(bits)) return null
    let mode = 0
    for (let index = 0; index < 3; index++) {
      const offset = index * 3
      let digit = 0
      if (bits[offset] === 'r') digit += 4
      if (bits[offset + 1] === 'w') digit += 2
      if ('xst'.includes(bits[offset + 2])) digit += 1
      mode = mode * 8 + digit
    }
    return mode
  }

  function comparePermissions(left: SFTPEntry, right: SFTPEntry, asc: boolean) {
    const leftMode = permissionMode(left.permissions)
    const rightMode = permissionMode(right.permissions)
    if (leftMode !== null && rightMode !== null && leftMode !== rightMode) {
      return asc ? leftMode - rightMode : rightMode - leftMode
    }
    if (leftMode !== null && rightMode === null) return -1
    if (leftMode === null && rightMode !== null) return 1
    const leftEmpty = !left.permissions
    const rightEmpty = !right.permissions
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1
    const fallback = (left.permissions || '').localeCompare(right.permissions || '', undefined, { sensitivity: 'base' })
    return fallback || compareNames(left, right, true)
  }

  function compareEntries(left: SFTPEntry, right: SFTPEntry, key: SftpSortKey, asc: boolean) {
    if (key !== 'type' && key !== 'permissions' && left.isDir !== right.isDir) return left.isDir ? -1 : 1
    let result = 0
    if (key === 'type') result = fileTypeRank(left) - fileTypeRank(right)
    else if (key === 'permissions') result = comparePermissions(left, right, asc)
    else if (key === 'size') result = left.size - right.size
    else if (key === 'modTime') result = left.modTime.localeCompare(right.modTime)
    else result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    if (key === 'permissions') return result || compareNames(left, right, asc)
    return asc ? (result || compareNames(left, right, true)) : -(result || compareNames(left, right, true))
  }

  function entries(connectionId: number | null | undefined, contextId?: string | null) {
    if (!connectionId) return []
    const contextKey = contextIdFor(connectionId, contextId)
    const hidden = showHiddenByContextId.value[contextKey] ?? showHiddenByServerId.value[connectionId] ?? false
    const key = sortKeyByContextId.value[contextKey] ?? sortKeyByServerId.value[connectionId] ?? 'name'
    const asc = sortAscByContextId.value[contextKey] ?? sortAscByServerId.value[connectionId] ?? true
    return rawEntries(connectionId, contextKey)
      .filter((entry) => hidden || !entry.name.startsWith('.'))
      .slice()
      .sort((left, right) => compareEntries(left, right, key, asc))
  }

  function selectedEntries(connectionId: number | null | undefined, contextId?: string | null) {
    if (!connectionId) return []
    const contextKey = contextIdFor(connectionId, contextId)
    const selected = new Set(selectedPathsByContextId.value[contextKey] ?? selectedPathsByServerId.value[connectionId] ?? [])
    return rawEntries(connectionId, contextKey).filter((entry) => selected.has(entry.path))
  }

  function nextDirectoryRequestId(connectionId: number, contextId: string) {
    directoryRequestCounter += 1
    return `${connectionId}:${contextId}:${Date.now()}:${directoryRequestCounter}`
  }

  function currentGeneration(connectionId: number, contextId: string) {
    return stateByContextId.value[contextId]?.generation ?? stateByServerId.value[connectionId]?.generation ?? 0
  }

  function acceptsGeneration(connectionId: number, contextId: string, generation?: number) {
    if (!Number.isFinite(generation) || !generation) return true
    const current = currentGeneration(connectionId, contextId)
    return !current || generation >= current
  }

  function terminalTransferStatus(status: string | undefined) {
    return ['completed', 'partial_failed', 'failed', 'canceled', 'skipped'].includes(status ?? '')
  }

  function activeTransferStatus(status: string | undefined) {
    return ['queued', 'planning', 'running', 'pausing', 'paused', 'resuming'].includes(status ?? '')
  }

  function emptyAuth(): AuthRequest {
    return { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false }
  }

  function reconnectableError(reason: unknown) {
    const message = String(reason).toLowerCase()
    return message.includes('eof') ||
      message.includes('closed pipe') ||
      message.includes('connection reset') ||
      message.includes('broken pipe') ||
      message.includes('ssh: session closed') ||
      message.includes('sftp connection lost') ||
      message.includes('operation timeout') ||
      message.includes('route transport closed') ||
      message.includes('connection closed') ||
      message.includes('sftp connection closed') ||
      message.includes('sftp 连接已关闭')
  }

  function acceptState(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const next = value as Partial<SFTPState>
    if (!Number.isInteger(next.connectionId) || Number(next.connectionId) <= 0) return
    const mode = next.mode === 'scp' ? 'scp' : 'sftp'
    const connectionId = Number(next.connectionId)
    if (suppressedServerIds.has(connectionId)) return
    const contextKey = contextIdFor(connectionId, next.contextId)
    if (!acceptsGeneration(connectionId, contextKey, next.generation)) return
    const normalized = {
      ...next,
      connectionId,
      contextId: contextKey,
      mode,
      capabilities: next.capabilities?.browse ? next.capabilities : capabilitiesFor(mode),
      currentPath: normalizeStatePath(mode, next.currentPath),
    } as SFTPState
    stateByContextId.value[contextKey] = normalized
    if (!next.contextId || next.contextId === contextIdFor(connectionId)) {
      stateByServerId.value[connectionId] = normalized
    }
    if (next.status === 'offline') {
      delete entriesByContextId.value[contextKey]
      delete selectedPathsByContextId.value[contextKey]
      if (!next.contextId || next.contextId === contextIdFor(connectionId)) {
        delete entriesByServerId.value[connectionId]
        delete selectedPathsByServerId.value[connectionId]
      }
    }
  }

  function acceptEntries(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const result = value as Partial<SFTPListResult>
    if (!Number.isInteger(result.connectionId) || !Array.isArray(result.entries)) return
    const connectionId = Number(result.connectionId)
    if (suppressedServerIds.has(connectionId)) return
    const contextKey = contextIdFor(connectionId, result.contextId)
    if (!acceptsGeneration(connectionId, contextKey, result.generation)) return
    const latestRequestId = latestDirectoryRequestByContextId.get(contextKey)
    if (result.requestId && latestRequestId && result.requestId !== latestRequestId) return
    entriesByContextId.value[contextKey] = result.entries as SFTPEntry[]
    if (!result.contextId || result.contextId === contextIdFor(connectionId)) {
      entriesByServerId.value[connectionId] = result.entries as SFTPEntry[]
    }
    const current = stateByContextId.value[contextKey] ?? stateByServerId.value[connectionId] ?? offlineState(connectionId, contextKey)
    const mode = result.mode === 'scp' || current.mode === 'scp' ? 'scp' : 'sftp'
    const capabilities = current.mode === mode && current.capabilities?.browse
      ? current.capabilities
      : capabilitiesFor(mode)
    const nextState = {
      ...current,
      connectionId,
      contextId: contextKey,
      status: 'online',
      active: true,
      mode,
      capabilities,
      currentPath: normalizeStatePath(mode, result.path, current.currentPath),
      message: mode === 'scp' ? 'SCP 兼容模式：已使用 SCP + Shell 兼容文件管理。' : 'SFTP 已连接',
      updatedAt: new Date().toISOString(),
    } as SFTPState
    stateByContextId.value[contextKey] = nextState
    if (!result.contextId || result.contextId === contextIdFor(connectionId)) {
      stateByServerId.value[connectionId] = nextState
    }
    const available = new Set(result.entries.map((entry) => entry.path))
    selectedPathsByContextId.value[contextKey] =
      (selectedPathsByContextId.value[contextKey] ?? selectedPathsByServerId.value[connectionId] ?? []).filter((path) => available.has(path))
    if (!result.contextId || result.contextId === contextIdFor(connectionId)) {
      selectedPathsByServerId.value[connectionId] = selectedPathsByContextId.value[contextKey]
    }
  }

  function acceptTransfer(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const transfer = value as Partial<SFTPTransferState>
    if (!transfer.id || !Number.isInteger(transfer.connectionId)) return
    if (suppressedServerIds.has(Number(transfer.connectionId))) return
    const contextKey = contextIdFor(Number(transfer.connectionId), transfer.contextId)
    if (
      !transfersById.value[transfer.id] &&
      transfer.generation &&
      !acceptsGeneration(Number(transfer.connectionId), contextKey, transfer.generation) &&
      activeTransferStatus(transfer.status)
    ) return
    const normalized = {
      ...transfer,
      contextId: contextKey,
    } as SFTPTransferState
    transfersById.value[transfer.id] = normalized
    scheduleUploadRefresh(normalized)
  }

  function scheduleUploadRefresh(transfer: SFTPTransferState) {
    if (transfer.direction !== 'upload' || !['completed', 'partial_failed'].includes(transfer.status) || !transfer.remotePath) return
    const connectionId = transfer.connectionId
    const contextKey = contextIdFor(connectionId, transfer.contextId)
    const path = parentRemotePath(transfer.remotePath)
    const key = refreshKey(connectionId, contextKey, path)
    const pending = pendingUploadRefreshes.get(key)
    if (pending) window.clearTimeout(pending.timer)
    const timer = window.setTimeout(() => {
      pendingUploadRefreshes.delete(key)
      void refreshAfterUpload(connectionId, contextKey, path, transfer.remotePath)
    }, 250)
    pendingUploadRefreshes.set(key, { connectionId, contextId: contextKey, path, remotePath: transfer.remotePath, timer })
  }

  async function refreshAfterUpload(connectionId: number, contextId: string, path: string, remotePath: string) {
    const current = normalizeRemotePath(state(connectionId, contextId)?.currentPath ?? '')
    if (current !== normalizeRemotePath(path)) return
    try {
      await list(connectionId, path, contextId)
      if (rawEntries(connectionId, contextId).some((entry) => entry.path === remotePath)) {
        selectedPathsByContextId.value[contextId] = [remotePath]
        if (contextId === contextIdFor(connectionId)) selectedPathsByServerId.value[connectionId] = [remotePath]
      }
      delete uploadRefreshErrorsByContextId.value[contextId]
      if (contextId === contextIdFor(connectionId)) delete uploadRefreshErrorsByServerId.value[connectionId]
    } catch (reason) {
      uploadRefreshErrorsByContextId.value[contextId] =
        String(reason).replace(/^Error:\s*/i, '').trim() ||
        '\u4e0a\u4f20\u5df2\u5b8c\u6210\uff0c\u4f46\u5237\u65b0\u8fdc\u7a0b\u76ee\u5f55\u5931\u8d25\u3002'
      if (contextId === contextIdFor(connectionId)) {
        uploadRefreshErrorsByServerId.value[connectionId] = uploadRefreshErrorsByContextId.value[contextId]
      }
    }
  }

  function acceptError(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<SFTPErrorEvent>
    if (!Number.isInteger(event.connectionId)) return
    const connectionId = Number(event.connectionId)
    if (suppressedServerIds.has(connectionId)) return
    const contextKey = contextIdFor(connectionId, event.contextId)
    if (!acceptsGeneration(connectionId, contextKey, event.generation)) return
    const normalized = { ...event, connectionId, contextId: contextKey } as SFTPErrorEvent
    errorsByContextId.value[contextKey] = normalized
    if (!event.contextId || event.contextId === contextIdFor(connectionId)) {
      errorsByServerId.value[connectionId] = normalized
    }
  }

  async function open(connectionId: number, auth: AuthRequest, contextId?: string | null, terminalSessionId = '') {
    suppressedServerIds.delete(connectionId)
    const contextKey = contextIdFor(connectionId, contextId)
    const current = state(connectionId, contextKey)
    if (current?.status === 'online' || current?.status === 'connecting') return current
    stateByContextId.value[contextKey] = {
      ...offlineState(connectionId, contextKey, terminalSessionId),
      status: 'connecting',
      active: true,
      message: '正在连接 SFTP',
      updatedAt: new Date().toISOString(),
    }
    if (contextKey === contextIdFor(connectionId)) stateByServerId.value[connectionId] = stateByContextId.value[contextKey]
    const next = await api.openSftp(connectionId, auth, contextKey, terminalSessionId)
    acceptState(next)
    if (next.currentPath && next.capabilities?.browse !== 'none') {
      try {
        await list(connectionId, next.currentPath, contextKey, terminalSessionId)
      } catch {
        if (next.mode === 'scp') {
          const limitedState: SFTPState = {
            ...next,
            capabilities: {
              ...(next.capabilities ?? capabilitiesFor('scp')),
              browse: 'none',
              downloadDirectory: false,
              mkdir: false,
              rename: false,
              delete: false,
              editText: false,
            },
            message: '当前服务器无法递归列出目录，暂不支持文件夹下载。',
          }
          stateByContextId.value[contextKey] = limitedState
          if (contextKey === contextIdFor(connectionId)) stateByServerId.value[connectionId] = limitedState
        } else {
          throw new Error('读取远程目录失败')
        }
      }
    }
    return state(connectionId, contextKey) ?? next
  }

  async function reconnect(connectionId: number, auth: AuthRequest, contextId?: string | null, terminalSessionId = '', refreshDirectory = true) {
    suppressedServerIds.delete(connectionId)
    const contextKey = contextIdFor(connectionId, contextId)
    const previousPath = normalizeRemotePath(state(connectionId, contextKey)?.currentPath ?? '')
    const current = state(connectionId, contextKey) ?? offlineState(connectionId, contextKey, terminalSessionId)
    stateByContextId.value[contextKey] = {
      ...current,
      terminalSessionId,
      status: 'connecting',
      active: true,
      message: '正在重新连接 SFTP',
      updatedAt: new Date().toISOString(),
    }
    if (contextKey === contextIdFor(connectionId)) stateByServerId.value[connectionId] = stateByContextId.value[contextKey]
    let next: Awaited<ReturnType<typeof api.reconnectSftp>>
    try {
      next = await api.reconnectSftp(connectionId, auth, contextKey, terminalSessionId)
    } catch (reason) {
      const failedState = {
        ...current,
        terminalSessionId,
        status: 'error' as const,
        active: false,
        message: String(reason).replace(/^Error:\s*/i, '').trim() || '重新连接 SFTP 失败',
        updatedAt: new Date().toISOString(),
      }
      stateByContextId.value[contextKey] = failedState
      if (contextKey === contextIdFor(connectionId)) stateByServerId.value[connectionId] = failedState
      throw reason
    }
    acceptState(next)
    if (refreshDirectory && next.capabilities?.browse !== 'none') {
      const targetPath = previousPath || normalizeRemotePath(next.currentPath || '')
      if (targetPath) {
        try {
          await list(connectionId, targetPath, contextKey, terminalSessionId)
        } catch {
          await home(connectionId, contextKey, terminalSessionId)
        }
      }
    }
    return state(connectionId, contextKey) ?? next
  }

  async function withReconnectBeforeStart<T>(
    connectionId: number,
    contextId: string,
    terminalSessionId: string,
    action: () => Promise<T>,
  ) {
    try {
      return await action()
    } catch (reason) {
      if (!reconnectableError(reason)) throw reason
      await reconnect(connectionId, emptyAuth(), contextId, terminalSessionId, false)
      return action()
    }
  }

  function markAuthRequired(connectionId: number, message = '需要口令', contextId?: string | null, terminalSessionId = '') {
    suppressedServerIds.delete(connectionId)
    const contextKey = contextIdFor(connectionId, contextId)
    const current = state(connectionId, contextKey) ?? offlineState(connectionId, contextKey, terminalSessionId)
    stateByContextId.value[contextKey] = {
      ...current,
      status: 'error',
      active: false,
      message,
      updatedAt: new Date().toISOString(),
    }
    if (contextKey === contextIdFor(connectionId)) stateByServerId.value[connectionId] = stateByContextId.value[contextKey]
  }

  async function close(connectionId: number, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    if (contextId) {
      await api.closeSftpContext(connectionId, contextKey, terminalSessionId)
      clearContext(connectionId, contextKey)
      stateByContextId.value[contextKey] = offlineState(connectionId, contextKey, terminalSessionId)
      return
    }
    await api.closeSftp(connectionId)
    clearServer(connectionId)
    stateByServerId.value[connectionId] = offlineState(connectionId)
  }

  async function loadState(connectionId: number, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const next = contextId
      ? await api.sftpContextState(connectionId, contextKey, terminalSessionId)
      : await api.sftpState(connectionId)
    acceptState(next)
    return next
  }

  async function list(connectionId: number, path: string, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const requestId = nextDirectoryRequestId(connectionId, contextKey)
    latestDirectoryRequestByContextId.set(contextKey, requestId)
    try {
      const result = await api.readSftpDir(connectionId, path, contextKey, terminalSessionId, requestId)
      const normalized = { ...result, requestId }
      acceptEntries(normalized)
      return normalized
    } catch (reason) {
      if (!reconnectableError(reason)) throw reason
      await reconnect(connectionId, emptyAuth(), contextKey, terminalSessionId, false)
      const retryRequestId = nextDirectoryRequestId(connectionId, contextKey)
      latestDirectoryRequestByContextId.set(contextKey, retryRequestId)
      const result = await api.readSftpDir(connectionId, path, contextKey, terminalSessionId, retryRequestId)
      const normalized = { ...result, requestId: retryRequestId }
      acceptEntries(normalized)
      return normalized
    }
  }

  async function home(connectionId: number, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const requestId = nextDirectoryRequestId(connectionId, contextKey)
    latestDirectoryRequestByContextId.set(contextKey, requestId)
    const result = await api.sftpGoHome(connectionId, contextKey, terminalSessionId, requestId)
    const normalized = { ...result, requestId }
    acceptEntries(normalized)
    return normalized
  }

  async function parent(connectionId: number, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const requestId = nextDirectoryRequestId(connectionId, contextKey)
    latestDirectoryRequestByContextId.set(contextKey, requestId)
    const result = await api.sftpGoParent(connectionId, contextKey, terminalSessionId, requestId)
    const normalized = { ...result, requestId }
    acceptEntries(normalized)
    return normalized
  }

  async function mkdir(connectionId: number, path: string, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    await api.sftpMkdir(connectionId, path, contextKey, terminalSessionId)
    const current = state(connectionId, contextKey)?.currentPath ?? ''
    await list(connectionId, current, contextKey, terminalSessionId)
  }

  async function rename(connectionId: number, oldPath: string, newPath: string, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    await api.sftpRename(connectionId, oldPath, newPath, contextKey, terminalSessionId)
    const current = state(connectionId, contextKey)?.currentPath ?? ''
    await list(connectionId, current, contextKey, terminalSessionId)
  }

  async function remove(connectionId: number, entry: SFTPEntry, contextId?: string | null, terminalSessionId = '') {
    await api.sftpDelete(connectionId, entry.path, entry.isDir, contextIdFor(connectionId, contextId), terminalSessionId)
  }

  async function inspectDelete(connectionId: number, entries: SFTPEntry[], recursive: boolean, contextId?: string | null, terminalSessionId = '') {
    return api.sftpInspectDelete(connectionId, entries.map((entry) => entry.path), recursive, contextIdFor(connectionId, contextId), terminalSessionId)
  }

  async function removeSelected(connectionId: number, recursive = false, contextId?: string | null, terminalSessionId = '') {
    const paths = selectedEntries(connectionId, contextId).map((entry) => entry.path)
    await removePaths(connectionId, paths, recursive, contextId, terminalSessionId)
  }

  async function removePaths(connectionId: number, paths: string[], recursive = false, contextId?: string | null, terminalSessionId = '') {
    if (!paths.length) return
    const contextKey = contextIdFor(connectionId, contextId)
    const current = state(connectionId, contextKey)?.currentPath ?? ''
    await api.sftpDeletePaths(connectionId, paths, recursive, contextKey, terminalSessionId)
    if (current && normalizeRemotePath(state(connectionId, contextKey)?.currentPath ?? '') === normalizeRemotePath(current)) {
      await list(connectionId, current, contextKey, terminalSessionId)
    }
  }

  async function uploadFiles(connectionId: number, localPaths: string[], policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const current = state(connectionId, contextKey)?.currentPath ?? '.'
    await uploadFilesTo(connectionId, localPaths, current, policy, contextKey, terminalSessionId)
  }

  async function uploadFilesTo(connectionId: number, localPaths: string[], remoteDirectory: string, policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    for (const localPath of localPaths) {
      const transfer = await withReconnectBeforeStart(connectionId, contextKey, terminalSessionId, () =>
        api.sftpUpload(connectionId, localPath, joinRemote(remoteDirectory || '.', basename(localPath)), policy, contextKey, terminalSessionId))
      acceptTransfer(transfer)
    }
  }

  async function uploadDirectory(connectionId: number, localPath: string, policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const current = state(connectionId, contextKey)?.currentPath ?? '.'
    return uploadDirectoryTo(connectionId, localPath, current, policy, contextKey, terminalSessionId)
  }

  async function uploadDirectoryTo(connectionId: number, localPath: string, remoteDirectory: string, policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const transfer = await withReconnectBeforeStart(connectionId, contextKey, terminalSessionId, () =>
      api.sftpUploadDirectory(connectionId, localPath, remoteDirectory || '.', policy, contextKey, terminalSessionId))
    acceptTransfer(transfer)
    return transfer
  }

  function clearUploadRefreshError(connectionId: number, contextId?: string | null) {
    const contextKey = contextIdFor(connectionId, contextId)
    delete uploadRefreshErrorsByContextId.value[contextKey]
    if (contextKey === contextIdFor(connectionId)) delete uploadRefreshErrorsByServerId.value[connectionId]
  }

  async function downloadEntries(connectionId: number, localDirectory: string, policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    for (const entry of selectedEntries(connectionId, contextKey)) {
      const transfer = entry.isDir
        ? await withReconnectBeforeStart(connectionId, contextKey, terminalSessionId, () =>
          api.sftpDownloadDirectory(connectionId, entry.path, localDirectory, policy, contextKey, terminalSessionId))
        : await withReconnectBeforeStart(connectionId, contextKey, terminalSessionId, () =>
          api.sftpDownload(connectionId, localDirectory, entry.path, policy, contextKey, terminalSessionId))
      acceptTransfer(transfer)
    }
  }

  async function downloadPath(connectionId: number, remotePath: string, localDirectory: string, policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const transfer = await withReconnectBeforeStart(connectionId, contextKey, terminalSessionId, () =>
      api.sftpDownload(connectionId, localDirectory, remotePath, policy, contextKey, terminalSessionId))
    acceptTransfer(transfer)
    return transfer
  }

  async function downloadDirectoryPath(connectionId: number, remotePath: string, localDirectory: string, policy: SFTPConflictPolicy, contextId?: string | null, terminalSessionId = '') {
    const contextKey = contextIdFor(connectionId, contextId)
    const transfer = await withReconnectBeforeStart(connectionId, contextKey, terminalSessionId, () =>
      api.sftpDownloadDirectory(connectionId, remotePath, localDirectory, policy, contextKey, terminalSessionId))
    acceptTransfer(transfer)
    return transfer
  }

  function toggleSelection(connectionId: number, path: string, additive: boolean, contextId?: string | null) {
    const contextKey = contextIdFor(connectionId, contextId)
    const selected = new Set(additive ? selectedPathsByContextId.value[contextKey] ?? selectedPathsByServerId.value[connectionId] ?? [] : [])
    if (selected.has(path)) selected.delete(path)
    else selected.add(path)
    selectedPathsByContextId.value[contextKey] = [...selected]
    if (contextKey === contextIdFor(connectionId)) selectedPathsByServerId.value[connectionId] = [...selected]
  }

  function clearSelection(connectionId: number, contextId?: string | null) {
    const contextKey = contextIdFor(connectionId, contextId)
    selectedPathsByContextId.value[contextKey] = []
    if (contextKey === contextIdFor(connectionId)) selectedPathsByServerId.value[connectionId] = []
  }

  function sortBy(connectionId: number, key: SftpSortKey, contextId?: string | null) {
    const contextKey = contextIdFor(connectionId, contextId)
    if ((sortKeyByContextId.value[contextKey] ?? sortKeyByServerId.value[connectionId]) === key) {
      sortAscByContextId.value[contextKey] = !(sortAscByContextId.value[contextKey] ?? sortAscByServerId.value[connectionId] ?? true)
    } else {
      sortKeyByContextId.value[contextKey] = key
      sortAscByContextId.value[contextKey] = true
    }
    if (contextKey === contextIdFor(connectionId)) {
      sortKeyByServerId.value[connectionId] = sortKeyByContextId.value[contextKey]
      sortAscByServerId.value[connectionId] = sortAscByContextId.value[contextKey]
    }
  }

  function sortKey(connectionId: number | null | undefined, contextId?: string | null): SftpSortKey {
    if (!connectionId) return 'name'
    const contextKey = contextIdFor(connectionId, contextId)
    return sortKeyByContextId.value[contextKey] ?? sortKeyByServerId.value[connectionId] ?? 'name'
  }

  function sortAsc(connectionId: number | null | undefined, contextId?: string | null) {
    if (!connectionId) return true
    const contextKey = contextIdFor(connectionId, contextId)
    return sortAscByContextId.value[contextKey] ?? sortAscByServerId.value[connectionId] ?? true
  }

  function toggleHidden(connectionId: number, contextId?: string | null) {
    const contextKey = contextIdFor(connectionId, contextId)
    showHiddenByContextId.value[contextKey] = !(showHiddenByContextId.value[contextKey] ?? showHiddenByServerId.value[connectionId] ?? false)
    if (contextKey === contextIdFor(connectionId)) showHiddenByServerId.value[connectionId] = showHiddenByContextId.value[contextKey]
  }

  function showHidden(connectionId: number | null | undefined, contextId?: string | null) {
    if (!connectionId) return false
    const contextKey = contextIdFor(connectionId, contextId)
    return showHiddenByContextId.value[contextKey] ?? showHiddenByServerId.value[connectionId] ?? false
  }

  function clearCompleted(connectionId: number, contextId?: string | null) {
    const contextKey = contextId ? contextIdFor(connectionId, contextId) : ''
    for (const [id, transfer] of Object.entries(transfersById.value)) {
      if (
        transfer.connectionId === connectionId &&
        (!contextKey || contextIdFor(transfer.connectionId, transfer.contextId) === contextKey) &&
        ['completed', 'partial_failed', 'failed', 'canceled', 'skipped'].includes(transfer.status)
      ) {
        delete transfersById.value[id]
      }
    }
  }

  function clearCompletedAll() {
    for (const [id, transfer] of Object.entries(transfersById.value)) {
      if (['completed', 'partial_failed', 'failed', 'canceled', 'skipped'].includes(transfer.status)) {
        delete transfersById.value[id]
      }
    }
  }

  async function cancelTransfer(transferId: string) {
    await api.sftpCancelTransfer(transferId)
  }

  async function pauseTransfer(transferId: string) {
    const transfer = transfersById.value[transferId]
    if (!transfer) throw new Error('传输任务不存在')
    const contextKey = contextIdFor(transfer.connectionId, transfer.contextId)
    return api.sftpPauseTransfer(transfer.connectionId, contextKey, transfer.id)
  }

  async function resumeTransfer(transferId: string) {
    const transfer = transfersById.value[transferId]
    if (!transfer) throw new Error('传输任务不存在')
    const contextKey = contextIdFor(transfer.connectionId, transfer.contextId)
    return api.sftpResumeTransfer(transfer.connectionId, contextKey, transfer.id)
  }

  function lastTransfer(connectionId: number | null | undefined, contextId?: string | null) {
    const transfers = connectionId
      ? contextId
        ? transfersByContextId.value[contextIdFor(connectionId, contextId)] ?? []
        : transfersByServerId.value[connectionId] ?? []
      : allTransfers.value
    return transfers[transfers.length - 1] ?? null
  }

  function transfersFor(connectionId: number | null | undefined, scope: 'current' | 'all', contextId?: string | null) {
    if (scope === 'all') return allTransfers.value
    if (!connectionId) return []
    if (contextId) return transfersByContextId.value[contextIdFor(connectionId, contextId)] ?? []
    return transfersByServerId.value[connectionId] ?? []
  }

  async function closeContextForTerminal(connectionId: number, terminalSessionId: string) {
    const context = contextByTerminalSessionId.value[terminalSessionId]
    const contextKey = context?.contextId ?? terminalSessionId
    await close(connectionId, contextKey, terminalSessionId)
    delete contextByTerminalSessionId.value[terminalSessionId]
    if (activeContextId.value === contextKey) activeContextId.value = null
  }

  function ensureContext(connectionId: number, terminalSessionId: string | null | undefined) {
    suppressedServerIds.delete(connectionId)
    const contextKey = terminalSessionId ? contextIdFor(connectionId, terminalSessionId) : contextIdFor(connectionId)
    if (terminalSessionId) {
      contextByTerminalSessionId.value[terminalSessionId] = {
        connectionId,
        terminalSessionId,
        contextId: contextKey,
      }
    }
    if (!stateByContextId.value[contextKey]) {
      stateByContextId.value[contextKey] = offlineState(connectionId, contextKey, terminalSessionId ?? '')
    }
    return contextKey
  }

  function activateContextForTerminal(connectionId: number | null | undefined, terminalSessionId: string | null | undefined) {
    if (!connectionId) {
      activeContextId.value = null
      return null
    }
    const contextKey = ensureContext(connectionId, terminalSessionId)
    activeContextId.value = contextKey
    return contextKey
  }

  function clearContext(connectionId: number, contextId: string) {
    delete entriesByContextId.value[contextId]
    delete selectedPathsByContextId.value[contextId]
    delete errorsByContextId.value[contextId]
    delete uploadRefreshErrorsByContextId.value[contextId]
    for (const [key, pending] of pendingUploadRefreshes.entries()) {
      if (pending.connectionId === connectionId && pending.contextId === contextId) {
        window.clearTimeout(pending.timer)
        pendingUploadRefreshes.delete(key)
      }
    }
    for (const [id, transfer] of Object.entries(transfersById.value)) {
      if (
        transfer.connectionId === connectionId &&
        contextIdFor(transfer.connectionId, transfer.contextId) === contextId &&
        !terminalTransferStatus(transfer.status)
      ) {
        delete transfersById.value[id]
      }
    }
  }

  function clearServer(connectionId: number) {
    suppressedServerIds.add(connectionId)
    delete stateByServerId.value[connectionId]
    delete entriesByServerId.value[connectionId]
    delete selectedPathsByServerId.value[connectionId]
    delete errorsByServerId.value[connectionId]
    delete uploadRefreshErrorsByServerId.value[connectionId]
    for (const [contextId, current] of Object.entries(stateByContextId.value)) {
      if (current.connectionId === connectionId) {
        delete stateByContextId.value[contextId]
        delete entriesByContextId.value[contextId]
        delete selectedPathsByContextId.value[contextId]
        delete errorsByContextId.value[contextId]
        delete uploadRefreshErrorsByContextId.value[contextId]
      }
    }
    for (const [sessionId, context] of Object.entries(contextByTerminalSessionId.value)) {
      if (context.connectionId === connectionId) delete contextByTerminalSessionId.value[sessionId]
    }
    if (activeContextId.value) {
      const current = stateByContextId.value[activeContextId.value]
      if (!current || current.connectionId === connectionId) activeContextId.value = null
    }
    for (const [key, pending] of pendingUploadRefreshes.entries()) {
      if (pending.connectionId === connectionId) {
        window.clearTimeout(pending.timer)
        pendingUploadRefreshes.delete(key)
      }
    }
    for (const [id, transfer] of Object.entries(transfersById.value)) {
      if (transfer.connectionId === connectionId && !terminalTransferStatus(transfer.status)) delete transfersById.value[id]
    }
  }

  function subscribe() {
    EventsOn('sftp:state', acceptState)
    EventsOn('sftp:entries', acceptEntries)
    EventsOn('sftp:transfer', acceptTransfer)
    EventsOn('sftp:error', acceptError)
  }

  function unsubscribe() {
    EventsOff('sftp:state')
    EventsOff('sftp:entries')
    EventsOff('sftp:transfer')
    EventsOff('sftp:error')
  }

  return {
    stateByServerId,
    stateByContextId,
    entriesByServerId,
    entriesByContextId,
    transfersById,
    transfersByServerId,
    transfersByContextId,
    allTransfers,
    errorsByServerId,
    errorsByContextId,
    uploadRefreshErrorsByServerId,
    uploadRefreshErrorsByContextId,
    selectedPathsByServerId,
    selectedPathsByContextId,
    contextByTerminalSessionId,
    activeContextId,
    state,
    entries,
    selectedEntries,
    parentRemotePath,
    isRootRemotePath,
    open,
    reconnect,
    markAuthRequired,
    close,
    loadState,
    list,
    home,
    parent,
    mkdir,
    rename,
    inspectDelete,
    removeSelected,
    removePaths,
    uploadFiles,
    uploadFilesTo,
    uploadDirectory,
    uploadDirectoryTo,
    clearUploadRefreshError,
    downloadEntries,
    downloadPath,
    downloadDirectoryPath,
    toggleSelection,
    clearSelection,
    sortBy,
    sortKey,
    sortAsc,
    toggleHidden,
    showHidden,
    clearCompleted,
    clearCompletedAll,
    cancelTransfer,
    pauseTransfer,
    resumeTransfer,
    ensureContext,
    activateContextForTerminal,
    closeContextForTerminal,
    clearContext,
    clearServer,
    lastTransfer,
    transfersFor,
    subscribe,
    unsubscribe,
  }
})
