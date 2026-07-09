import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '../api/backend'
import { useSftpStore } from './sftp'
import {
  commandPanelCommonCommands,
  type CommandPanelCommonCommand,
  type CommandShellType,
} from '../data/commandPanelCommonCommands'
import type {
  CommandFavorite,
  CommandHistoryEntry,
  CommandSuggestion,
  Connection,
  ListCommandFavoritesRequest,
  ListCommandHistoryRequest,
  RecordBatchCommandHistoryResult,
  SaveCommandFavoriteRequest,
  UpdateCommandHistoryRequest,
} from '../types'

export type CommandListScope = 'all' | 'currentServer'
export type LocalCommandHistoryScope = 'local:cmd' | 'local:powershell'
export const LOCAL_COMMAND_HISTORY_SERVER_IDS: Record<LocalCommandHistoryScope, number> = {
  'local:cmd': -1001,
  'local:powershell': -1002,
}
const LOCAL_COMMAND_HISTORY_STORAGE_KEYS: Record<LocalCommandHistoryScope, string> = {
  'local:cmd': 'hostdeck.commandHistory.local.cmd',
  'local:powershell': 'hostdeck.commandHistory.local.powershell',
}
const LOCAL_COMMAND_FAVORITES_STORAGE_KEY = 'hostdeck.commandFavorites.local'
const defaultHistoryLimit = 2000
let localHistorySequence = 0
let localFavoriteSequence = 0

export const useCommandStore = defineStore('commands', () => {
  const historyByServer = ref<Record<number, CommandHistoryEntry[]>>({})
  const favorites = ref<CommandFavorite[]>([])
  const suggestions = ref<CommandSuggestion[]>([])
  const busy = ref(false)
  const historyScope = ref<CommandListScope>((localStorage.getItem('hostdeck.commandScope') as CommandListScope | null) || 'all')

  const safeFavorites = computed(() => normalizeFavorites(favorites.value))
  const globalFavorites = computed(() => safeFavorites.value.filter((item) => item.scope === 'global'))
  const groupFavorites = computed(() => safeFavorites.value.filter((item) => item.scope === 'group'))
  const serverFavorites = computed(() => safeFavorites.value.filter((item) => item.scope === 'server'))

  async function loadHistory(serverId: number, query = '', limit = defaultHistoryLimit, scope: CommandListScope = historyScope.value) {
    if (serverId < 0) {
      const localScope = localHistoryScopeForServerId(serverId)
      const entries = localScope ? localHistoryEntries(readPersistedLocalHistory(localScope), query, limit) : []
      historyByServer.value = { ...historyByServer.value, [serverId]: entries }
      return entries
    }
    if (!serverId && scope !== 'all') return []
    const request: ListCommandHistoryRequest = {
      serverId: scope === 'all' ? 0 : serverId,
      scope,
      query,
      limit: clampHistoryLimit(limit),
    }
    const entries = normalizeHistory(await api.listCommandHistory(request))
    historyByServer.value = { ...historyByServer.value, [historyKey(serverId, scope)]: entries }
    return entries
  }

  async function recordHistory(serverId: number, sessionId: string, command: string, source = 'terminal') {
    return api.recordCommandHistory({ serverId, sessionId, command, source })
  }

  async function recordLocalHistory(scope: LocalCommandHistoryScope, sessionId: string, command: string, limit = defaultHistoryLimit) {
    const normalized = normalizeHistoryCommand(command)
    if (!normalized) return { recorded: false, skipped: true, reasonCode: 'EMPTY', message: '' }
    if (localCommandLooksSensitive(normalized)) {
      return {
        recorded: false,
        skipped: true,
        reasonCode: 'SENSITIVE',
        message: '该命令可能包含敏感信息，已跳过历史记录',
      }
    }
    const serverId = localHistoryServerId(scope)
    const now = new Date().toISOString()
    const current = readPersistedLocalHistory(scope)
      .filter((entry) => normalizeHistoryCommand(entry.command) !== normalized)
    const entry = buildLocalHistoryEntry(scope, sessionId, normalized, now)
    const next = [entry, ...current].slice(0, clampHistoryLimit(limit))
    persistLocalHistory(scope, next, limit)
    historyByServer.value = {
      ...historyByServer.value,
      [serverId]: next,
    }
    return { recorded: true, skipped: false, reasonCode: '', message: '', entry }
  }

  async function recordBatchHistory(command: string, successfulServerIds: number[], submissionId: string): Promise<RecordBatchCommandHistoryResult> {
    return api.recordBatchCommandHistory({ command, successfulServerIds, submissionId })
  }

  async function deleteHistory(id: string, serverId: number, query = '', scope: CommandListScope = historyScope.value, limit = defaultHistoryLimit) {
    if (serverId < 0) {
      const localScope = localHistoryScopeForServerId(serverId)
      if (!localScope) return
      const next = readPersistedLocalHistory(localScope).filter((entry) => entry.id !== id)
      persistLocalHistory(localScope, next, limit)
      historyByServer.value = {
        ...historyByServer.value,
        [serverId]: localHistoryEntries(next, query, limit),
      }
      return
    }
    await api.deleteCommandHistory(id)
    await loadHistory(serverId, query, limit, scope)
  }

  async function updateHistory(request: UpdateCommandHistoryRequest, serverId: number, query = '', scope: CommandListScope = historyScope.value, limit = defaultHistoryLimit) {
    if (serverId < 0) {
      const localScope = localHistoryScopeForServerId(serverId)
      if (!localScope) throw new Error('Unknown local command history scope')
      const command = normalizeHistoryCommand(request.command)
      const current = readPersistedLocalHistory(localScope)
      const next = current.map((entry) => entry.id === request.id
        ? {
            ...entry,
            command,
            preview: buildCommandPreview(command),
            isMultiline: isMultilineCommand(command),
          }
        : entry)
      persistLocalHistory(localScope, next, limit)
      historyByServer.value = { ...historyByServer.value, [serverId]: localHistoryEntries(next, query, limit) }
      return historyByServer.value[serverId].find((entry) => entry.id === request.id) ?? next[0]
    }
    const result = await api.updateCommandHistory(request)
    const key = historyKey(serverId, scope)
    const current = normalizeHistory(historyByServer.value[key])
    historyByServer.value = {
      ...historyByServer.value,
      [key]: current.map((entry) => entry.id === result.entry.id ? result.entry : entry),
    }
    await loadHistory(serverId, query, limit, scope)
    return result.entry
  }

  async function clearHistory(serverId: number) {
    if (serverId < 0) {
      const localScope = localHistoryScopeForServerId(serverId)
      if (localScope) persistLocalHistory(localScope, [])
      historyByServer.value = { ...historyByServer.value, [serverId]: [] }
      return
    }
    await api.clearCommandHistory(serverId)
    historyByServer.value = { ...historyByServer.value, [serverId]: [] }
  }

  async function loadFavorites(connection: Connection | null, query = '', scope: CommandListScope = historyScope.value) {
    if ((connection?.id ?? 0) < 0) {
      favorites.value = filterFavoritesForShell(readPersistedLocalFavorites(), shellTypeForConnection(connection), query)
      return favorites.value
    }
    const request: ListCommandFavoritesRequest = {
      serverId: scope === 'all' ? 0 : connection?.id ?? 0,
      groupId: scope === 'all' ? null : connection?.groupId ?? null,
      scope,
      query,
    }
    favorites.value = filterFavoritesForShell(
      normalizeFavorites(await api.listCommandFavorites(request)),
      shellTypeForConnection(connection),
      query,
    )
    return favorites.value
  }

  async function saveFavorite(request: SaveCommandFavoriteRequest) {
    if ((request.serverId ?? 0) < 0 || request.tags.includes('source:local')) {
      const saved = saveLocalFavorite(request)
      favorites.value = filterFavoritesForShell(readPersistedLocalFavorites(), favoriteShellType(saved), '')
      return saved
    }
    const response = request.id
      ? await api.updateCommandFavorite(request)
      : await api.createCommandFavorite(request)
    const saved = normalizeFavorite(response)
    if (!saved?.id) throw new Error('保存常用命令失败：后端未返回有效结果')
    const current = normalizeFavorites(favorites.value)
    const existing = current.findIndex((item) => item.id === saved.id)
    if (existing >= 0) {
      current[existing] = saved
      favorites.value = current
    } else {
      favorites.value = [saved, ...current]
    }
    return saved
  }

  async function deleteFavorite(id: string) {
    if (id.startsWith('localfav-')) {
      const next = readPersistedLocalFavorites().filter((item) => item.id !== id)
      persistLocalFavorites(next)
      favorites.value = normalizeFavorites(favorites.value).filter((item) => item.id !== id)
      return
    }
    await api.deleteCommandFavorite(id)
    favorites.value = normalizeFavorites(favorites.value).filter((item) => item.id !== id)
  }

  async function markFavoriteUsed(id: string) {
    if (id.startsWith('localfav-')) {
      const now = new Date().toISOString()
      const next = readPersistedLocalFavorites().map((item) => item.id === id
        ? { ...item, useCount: item.useCount + 1, lastUsedAt: now, updatedAt: now }
        : item)
      persistLocalFavorites(next)
      const saved = next.find((item) => item.id === id)
      if (!saved) throw new Error('更新常用命令使用次数失败：本地收藏不存在')
      favorites.value = normalizeFavorites(favorites.value).map((item) => item.id === id ? saved : item)
      return saved
    }
    const saved = normalizeFavorite(await api.incrementCommandFavoriteUse(id))
    if (!saved?.id) throw new Error('更新常用命令使用次数失败：后端未返回有效结果')
    const current = normalizeFavorites(favorites.value)
    const existing = current.findIndex((item) => item.id === saved.id)
    if (existing >= 0) {
      current[existing] = saved
      favorites.value = current
    }
    return saved
  }

  async function loadSuggestions(connection: Connection | null, prefix: string, limit = 20) {
    if (!connection?.id) {
      suggestions.value = []
      return []
    }
    const backendSuggestions = normalizeSuggestions(await api.listCommandSuggestions({
      serverId: connection.id,
      groupId: connection.groupId ?? null,
      prefix,
      limit,
      includeHistory: true,
      includeFavorites: true,
      includeBuiltins: true,
    }))
    suggestions.value = mergeSuggestions(backendSuggestions, pathSuggestions(connection, prefix), limit)
    return suggestions.value
  }

  function setHistoryScope(scope: CommandListScope) {
    historyScope.value = scope
    localStorage.setItem('hostdeck.commandScope', scope)
  }

  function commonCommandsForConnection(connection: Connection | null, query = '', limit = 50): CommandPanelCommonCommand[] {
    const shell = shellTypeForConnection(connection)
    const normalizedQuery = query.trim().toLowerCase()
    return commandPanelCommonCommands
      .filter((item) => item.shell === 'any' || item.shell === shell)
      .filter((item) => !normalizedQuery ||
        item.command.toLowerCase().includes(normalizedQuery) ||
        item.title.toLowerCase().includes(normalizedQuery))
      .slice(0, Math.max(1, limit))
  }

  return {
    historyByServer,
    favorites,
    suggestions,
    historyScope,
    globalFavorites,
    groupFavorites,
    serverFavorites,
    busy,
    loadHistory,
    recordHistory,
    recordLocalHistory,
    recordBatchHistory,
    updateHistory,
    deleteHistory,
    clearHistory,
    loadFavorites,
    saveFavorite,
    deleteFavorite,
    markFavoriteUsed,
    loadSuggestions,
    setHistoryScope,
    commonCommandsForConnection,
  }
})

function historyKey(serverId: number, scope: CommandListScope) {
  return scope === 'all' ? 0 : serverId
}

function localHistoryServerId(scope: LocalCommandHistoryScope) {
  return LOCAL_COMMAND_HISTORY_SERVER_IDS[scope] ?? LOCAL_COMMAND_HISTORY_SERVER_IDS['local:cmd']
}

function localHistoryScopeForServerId(serverId: number): LocalCommandHistoryScope | null {
  if (serverId === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:powershell']) return 'local:powershell'
  if (serverId === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:cmd']) return 'local:cmd'
  return null
}

function localHistoryLabel(scope: LocalCommandHistoryScope) {
  return scope === 'local:powershell' ? 'PowerShell' : 'CMD'
}

function localHistoryStorageKey(scope: LocalCommandHistoryScope) {
  return LOCAL_COMMAND_HISTORY_STORAGE_KEYS[scope]
}

function readPersistedLocalHistory(scope: LocalCommandHistoryScope): CommandHistoryEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(localStorage.getItem(localHistoryStorageKey(scope)) || '[]')
  } catch {
    parsed = []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const entries: CommandHistoryEntry[] = []
  for (const item of parsed) {
    const source = typeof item === 'string' ? { command: item } : (item as Partial<CommandHistoryEntry>)
    const command = normalizeHistoryCommand(source?.command ?? '')
    if (!command || localCommandLooksSensitive(command)) continue
    const duplicateKey = command.toLowerCase()
    if (seen.has(duplicateKey)) continue
    seen.add(duplicateKey)
    entries.push(normalizeLocalHistoryEntry(scope, source, command))
  }
  return entries
}

function normalizeLocalHistoryEntry(
  scope: LocalCommandHistoryScope,
  source: Partial<CommandHistoryEntry>,
  command: string,
): CommandHistoryEntry {
  const entry = buildLocalHistoryEntry(scope, source.sessionId ?? '', command, source.executedAt || '')
  return {
    ...entry,
    id: source.id || entry.id,
    commandHash: source.commandHash || entry.commandHash,
    preview: source.preview || entry.preview,
    isMultiline: Boolean(source.isMultiline ?? entry.isMultiline),
    targetServerIds: [],
    targetCount: 0,
    batchSubmissionId: '',
  }
}

function buildLocalHistoryEntry(
  scope: LocalCommandHistoryScope,
  sessionId: string,
  command: string,
  executedAt = '',
): CommandHistoryEntry {
  const sequence = ++localHistorySequence
  return {
    id: `localhist-${scope}-${Date.now()}-${sequence}`,
    serverId: localHistoryServerId(scope),
    serverName: localHistoryLabel(scope),
    sessionId,
    command,
    preview: buildCommandPreview(command),
    isMultiline: isMultilineCommand(command),
    commandHash: `local-${Date.now()}-${sequence}`,
    source: scope,
    sourceLabel: localHistoryLabel(scope),
    executedAt,
    targetServerIds: [],
    targetCount: 0,
    batchSubmissionId: '',
  }
}

function persistLocalHistory(scope: LocalCommandHistoryScope, entries: CommandHistoryEntry[], limit = defaultHistoryLimit) {
  const normalized = normalizeHistory(entries)
    .filter((entry) => entry.serverId === localHistoryServerId(scope))
    .slice(0, clampHistoryLimit(limit))
    .map((entry) => ({
      id: entry.id,
      serverId: localHistoryServerId(scope),
      serverName: localHistoryLabel(scope),
      sessionId: entry.sessionId,
      command: normalizeHistoryCommand(entry.command),
      preview: buildCommandPreview(entry.command),
      isMultiline: isMultilineCommand(entry.command),
      commandHash: entry.commandHash,
      source: scope,
      sourceLabel: localHistoryLabel(scope),
      executedAt: entry.executedAt,
      targetServerIds: [],
      targetCount: 0,
      batchSubmissionId: '',
    }))
  localStorage.setItem(localHistoryStorageKey(scope), JSON.stringify(normalized))
}

function clampHistoryLimit(value: number) {
  if (!Number.isFinite(value)) return defaultHistoryLimit
  return Math.min(Math.max(Math.trunc(value), 100), 20000)
}

function normalizeHistory(value: CommandHistoryEntry[] | null | undefined): CommandHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is CommandHistoryEntry => Boolean(item?.id))
    .map((item) => ({
      ...item,
      serverId: Number.isFinite(item.serverId) ? item.serverId : 0,
      serverName: item.serverName ?? '',
      sessionId: item.sessionId ?? '',
      command: normalizeHistoryCommand(item.command ?? ''),
      preview: item.preview || buildCommandPreview(item.command ?? ''),
      isMultiline: Boolean(item.isMultiline ?? isMultilineCommand(item.command ?? '')),
      source: item.source || 'terminal',
      sourceLabel: item.sourceLabel ?? '',
      targetServerIds: Array.isArray(item.targetServerIds) ? item.targetServerIds : [],
      targetCount: Number.isFinite(item.targetCount) ? item.targetCount : 0,
      batchSubmissionId: item.batchSubmissionId ?? '',
    }))
}

function localHistoryEntries(value: CommandHistoryEntry[] | null | undefined, query: string, limit: number) {
  const normalizedQuery = query.trim().toLowerCase()
  const entries = normalizeHistory(value)
  const filtered = normalizedQuery
    ? entries.filter((entry) => entry.command.toLowerCase().includes(normalizedQuery) || (entry.preview ?? '').toLowerCase().includes(normalizedQuery))
    : entries
  return filtered.slice(0, clampHistoryLimit(limit))
}

function normalizeFavorites(value: CommandFavorite[] | null | undefined): CommandFavorite[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is CommandFavorite => Boolean(item?.id))
    .map((item) => normalizeFavorite(item)!)
}

function normalizeFavorite(value: CommandFavorite | null | undefined): CommandFavorite | null {
  if (!value?.id) return null
  return {
    ...value,
    serverId: value.serverId ?? null,
    groupId: value.groupId ?? null,
    tags: Array.isArray(value.tags) ? value.tags : [],
    sortOrder: Number.isFinite(value.sortOrder) ? value.sortOrder : 0,
    useCount: Number.isFinite(value.useCount) ? value.useCount : 0,
    description: value.description ?? '',
    lastUsedAt: value.lastUsedAt ?? '',
  }
}

function shellTypeForConnection(connection: Connection | null): CommandShellType {
  if (connection?.id === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:cmd']) return 'cmd'
  if (connection?.id === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:powershell']) return 'powershell'
  return 'ssh'
}

function favoriteShellType(favorite: Pick<CommandFavorite, 'tags'>): CommandShellType {
  const tag = (favorite.tags ?? []).find((item) => item.startsWith('shell:'))?.slice('shell:'.length)
  if (tag === 'cmd' || tag === 'powershell' || tag === 'ssh' || tag === 'any') return tag
  return 'any'
}

function filterFavoritesForShell(favorites: CommandFavorite[], shell: CommandShellType, query: string): CommandFavorite[] {
  const normalizedQuery = query.trim().toLowerCase()
  return normalizeFavorites(favorites)
    .filter((favorite) => {
      const favoriteShell = favoriteShellType(favorite)
      return favoriteShell === 'any' || favoriteShell === shell
    })
    .filter((favorite) => !normalizedQuery ||
      favorite.title.toLowerCase().includes(normalizedQuery) ||
      favorite.command.toLowerCase().includes(normalizedQuery) ||
      favorite.description.toLowerCase().includes(normalizedQuery) ||
      favorite.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)))
}

function readPersistedLocalFavorites(): CommandFavorite[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(localStorage.getItem(LOCAL_COMMAND_FAVORITES_STORAGE_KEY) || '[]')
  } catch {
    parsed = []
  }
  return normalizeFavorites(Array.isArray(parsed) ? parsed as CommandFavorite[] : [])
}

function persistLocalFavorites(entries: CommandFavorite[]) {
  localStorage.setItem(LOCAL_COMMAND_FAVORITES_STORAGE_KEY, JSON.stringify(normalizeFavorites(entries)))
}

function saveLocalFavorite(request: SaveCommandFavoriteRequest): CommandFavorite {
  const current = readPersistedLocalFavorites()
  const now = new Date().toISOString()
  const id = request.id || `localfav-${Date.now()}-${++localFavoriteSequence}`
  const existing = current.find((item) => item.id === id)
  const saved: CommandFavorite = {
    id,
    title: request.title.trim(),
    command: normalizeHistoryCommand(request.command),
    description: request.description.trim(),
    scope: request.scope,
    serverId: request.serverId,
    groupId: request.groupId,
    tags: normalizeShellTags(request.tags, request.serverId),
    sortOrder: Number.isFinite(request.sortOrder) ? request.sortOrder : 0,
    useCount: existing?.useCount ?? 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt ?? '',
  }
  const next = existing
    ? current.map((item) => item.id === id ? saved : item)
    : [saved, ...current]
  persistLocalFavorites(next)
  return saved
}

function normalizeShellTags(tags: string[], serverId: number | null): string[] {
  const withoutShell = tags.filter((tag) => !tag.startsWith('shell:'))
  if (tags.some((tag) => tag.startsWith('shell:'))) return withoutShell.concat(tags.find((tag) => tag.startsWith('shell:'))!)
  if (serverId === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:cmd']) return [...withoutShell, 'shell:cmd', 'source:local']
  if (serverId === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:powershell']) return [...withoutShell, 'shell:powershell', 'source:local']
  return [...withoutShell, 'shell:ssh']
}

function normalizeSuggestions(value: CommandSuggestion[] | null | undefined): CommandSuggestion[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is CommandSuggestion => Boolean(item?.command))
    .map((item) => ({
      ...item,
      kind: item.kind || 'command',
      description: item.description ?? '',
      serverId: item.serverId ?? null,
      groupId: item.groupId ?? null,
      useCount: Number.isFinite(item.useCount) ? item.useCount : 0,
      score: Number.isFinite(item.score) ? item.score : 0,
      lastUsedAt: item.lastUsedAt ?? '',
    }))
}

function pathSuggestions(connection: Connection, prefix: string): CommandSuggestion[] {
  const sftp = useSftpStore()
  const contextId = sftp.activeContextId ?? `server:${connection.id}`
  const state = sftp.state(connection.id, contextId)
  if (state?.status !== 'online') return []
  const entries = sftp.entries(connection.id, contextId)
  if (!entries.length) return []
  const token = trailingToken(prefix)
  if (!token.value || !looksLikePathFragment(token.value)) return []
  const normalizedFragment = token.value.replace(/\\/g, '/')
  const parent = state.currentPath || ''
  return entries
    .filter((entry) => !entry.isDir)
    .map((entry) => entry.path || joinRemotePath(parent, entry.name))
    .filter((path) => path.startsWith(normalizedFragment) || basename(path).startsWith(basename(normalizedFragment)))
    .slice(0, 10)
    .map((path, index) => ({
      id: `path:${contextId}:${path}`,
      source: 'path',
      kind: 'path',
      title: path,
      command: `${token.head}${path}`,
      description: `当前目录 ${parent || '/'}`,
      scope: 'server',
      serverId: connection.id,
      groupId: connection.groupId ?? null,
      score: 300000 - index,
      useCount: 0,
      lastUsedAt: '',
    }))
}

function mergeSuggestions(backendSuggestions: CommandSuggestion[], extraSuggestions: CommandSuggestion[], limit: number) {
  const ranked = [...backendSuggestions, ...extraSuggestions]
  const byCommand = new Map<string, CommandSuggestion>()
  for (const suggestion of ranked) {
    const key = suggestion.command.trim().toLowerCase()
    if (!key) continue
    const existing = byCommand.get(key)
    if (!existing || sourceRank(suggestion.source) < sourceRank(existing.source) || suggestion.score > existing.score) {
      byCommand.set(key, suggestion)
    }
  }
  return [...byCommand.values()]
    .sort((left, right) => {
      const rank = sourceRank(left.source) - sourceRank(right.source)
      if (rank !== 0) return rank
      if (left.score !== right.score) return right.score - left.score
      if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt.localeCompare(left.lastUsedAt)
      return left.command.localeCompare(right.command)
    })
    .slice(0, Math.max(1, limit))
}

function sourceRank(source: CommandSuggestion['source']) {
  if (source === 'history') return 1
  if (source === 'favorite') return 2
  if (source === 'common') return 3
  if (source === 'builtin') return 4
  return 5
}

function trailingToken(prefix: string) {
  const match = String(prefix ?? '').match(/^(.*?)([^\s]*)$/s)
  return { head: match?.[1] ?? '', value: match?.[2] ?? '' }
}

function looksLikePathFragment(value: string) {
  return value.includes('/') || value.startsWith('.') || value.startsWith('~')
}

function basename(value: string) {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? value
}

function joinRemotePath(parent: string, name: string) {
  const safeName = name.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? name
  if (!parent || parent === '.') return safeName
  if (parent === '/') return `/${safeName}`
  return `${parent.replace(/\/+$/, '')}/${safeName}`
}

function normalizeHistoryCommand(value: string) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function isMultilineCommand(value: string) {
  return normalizeHistoryCommand(value)
    .split('\n')
    .filter((line) => line.trim())
    .length >= 2
}

function buildCommandPreview(value: string) {
  const lines = normalizeHistoryCommand(value).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const preview = lines[index].trim().replace(/\s+/g, ' ')
    if (!preview) continue
    const hasMore = lines.slice(index + 1).some((line) => line.trim())
    return hasMore ? `${preview} ...` : preview
  }
  return ''
}

function localCommandLooksSensitive(command: string) {
  return [
    /\bauthorization\s*:/i,
    /\bpassword\s*=/i,
    /\btoken\s*=/i,
    /\bsecret\s*=/i,
    /private\s+key/i,
    /\bpassphrase\s*=/i,
    /\b(api[_-]?key|access[_-]?key)\s*=/i,
  ].some((pattern) => pattern.test(command))
}
