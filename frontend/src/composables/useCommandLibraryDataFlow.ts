import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  CommandFavorite,
  CommandHistoryEntry,
  Connection,
  SaveCommandFavoriteRequest,
  UpdateCommandHistoryRequest,
} from '../types'
import type { CommandListScope } from '../stores/commands'

export type CommandLibraryToastType = 'success' | 'error' | 'info'

export interface CommandLibraryConfirmOptions {
  title: string
  message: string
  confirmText: string
  danger?: boolean
}

export interface CommandLibraryGroupedFavorites {
  global: ComputedRef<CommandFavorite[]>
  group: ComputedRef<CommandFavorite[]>
  server: ComputedRef<CommandFavorite[]>
}

export type CommandLibraryActionResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'disabled' | 'failed' }

export interface UseCommandLibraryDataFlowOptions {
  historyByServer: Ref<Record<number, CommandHistoryEntry[]>>
  favorites: Ref<CommandFavorite[]>
  groupedFavorites: CommandLibraryGroupedFavorites
  serverId: ComputedRef<number>
  connection: ComputedRef<Connection | null>
  query: Ref<string>
  scope: Ref<CommandListScope>
  historyLimit: ComputedRef<number>
  setBusy: (busy: boolean) => void
  notify: (message: string, type: CommandLibraryToastType) => void
  confirm: (options: CommandLibraryConfirmOptions) => Promise<boolean>
  loadHistory: (serverId: number, query: string, limit: number, scope: CommandListScope) => Promise<CommandHistoryEntry[]>
  loadFavorites: (connection: Connection | null, query: string, scope: CommandListScope) => Promise<CommandFavorite[]>
  updateHistory: (
    request: UpdateCommandHistoryRequest,
    serverId: number,
    query: string,
    scope: CommandListScope,
    limit: number,
  ) => Promise<CommandHistoryEntry>
  deleteHistory: (
    id: string,
    serverId: number,
    query: string,
    scope: CommandListScope,
    limit: number,
  ) => Promise<void>
  clearHistory: (serverId: number) => Promise<void>
  saveFavorite: (request: SaveCommandFavoriteRequest) => Promise<CommandFavorite>
  deleteFavorite: (id: string) => Promise<void>
  markFavoriteUsed: (id: string) => Promise<CommandFavorite>
  setHistoryScope: (scope: CommandListScope) => void
}

export function useCommandLibraryDataFlow(options: UseCommandLibraryDataFlowOptions) {
  const historyKey = computed(() => options.serverId.value < 0 ? options.serverId.value : (options.scope.value === 'all' ? 0 : options.serverId.value))
  const history = computed(() => options.historyByServer.value[historyKey.value] ?? [])
  const favoriteCount = computed(() => Array.isArray(options.favorites.value) ? options.favorites.value.length : 0)
  const groupedFavorites = computed(() => ({
    global: options.groupedFavorites.global.value,
    group: options.groupedFavorites.group.value,
    server: options.groupedFavorites.server.value,
  }))

  async function reload(): Promise<CommandLibraryActionResult> {
    options.setBusy(true)
    try {
      await options.loadHistory(options.serverId.value, options.query.value, options.historyLimit.value, options.scope.value)
      await options.loadFavorites(options.connection.value, options.query.value, options.scope.value)
      return { ok: true }
    } catch (reason) {
      options.notify(errorMessage(reason, '加载命令数据失败'), 'error')
      return { ok: false, reason: 'failed' }
    } finally {
      options.setBusy(false)
    }
  }

  async function reloadHistoryAfterBatch(): Promise<CommandLibraryActionResult> {
    const loaders = [options.loadHistory(options.serverId.value, '', options.historyLimit.value, 'all')]
    if (options.serverId.value) {
      loaders.push(options.loadHistory(options.serverId.value, '', options.historyLimit.value, 'currentServer'))
    }
    await Promise.allSettled(loaders)
    return { ok: true }
  }

  async function updateHistoryEntry(request: UpdateCommandHistoryRequest): Promise<CommandLibraryActionResult> {
    try {
      await options.updateHistory(
        request,
        options.serverId.value,
        options.query.value,
        options.scope.value,
        options.historyLimit.value,
      )
      options.notify('命令历史已保存', 'success')
      return { ok: true }
    } catch (reason) {
      options.notify(errorMessage(reason, '保存命令历史失败'), 'error')
      return { ok: false, reason: 'failed' }
    }
  }

  async function deleteHistoryEntry(entry: CommandHistoryEntry): Promise<CommandLibraryActionResult> {
    if (!options.serverId.value && options.scope.value !== 'all') return { ok: false, reason: 'disabled' }
    try {
      await options.deleteHistory(
        entry.id,
        options.serverId.value,
        options.query.value,
        options.scope.value,
        options.historyLimit.value,
      )
      return { ok: true }
    } catch (reason) {
      options.notify(errorMessage(reason, '删除历史失败'), 'error')
      return { ok: false, reason: 'failed' }
    }
  }

  async function clearCurrentServerHistory(): Promise<CommandLibraryActionResult> {
    if (!options.serverId.value || options.scope.value === 'all') return { ok: false, reason: 'disabled' }
    const ok = await options.confirm({
      title: '清空命令历史',
      message: '确定清空当前服务器的命令历史吗？',
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return { ok: false, reason: 'cancelled' }
    try {
      await options.clearHistory(options.serverId.value)
      return { ok: true }
    } catch (reason) {
      options.notify(errorMessage(reason, '清空历史失败'), 'error')
      return { ok: false, reason: 'failed' }
    }
  }

  async function deleteFavoriteEntry(favorite: CommandFavorite): Promise<CommandLibraryActionResult> {
    const ok = await options.confirm({
      title: '删除常用命令',
      message: '确定删除这个常用命令吗？',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return { ok: false, reason: 'cancelled' }
    try {
      await options.deleteFavorite(favorite.id)
      return { ok: true }
    } catch (reason) {
      options.notify(errorMessage(reason, '删除收藏失败'), 'error')
      return { ok: false, reason: 'failed' }
    }
  }

  async function markFavoriteEntryUsed(favorite: CommandFavorite): Promise<CommandLibraryActionResult> {
    try {
      await options.markFavoriteUsed(favorite.id)
      return { ok: true }
    } catch (reason) {
      options.notify(errorMessage(reason, '更新收藏使用次数失败'), 'error')
      return { ok: false, reason: 'failed' }
    }
  }

  async function saveFavoriteEntry(request: SaveCommandFavoriteRequest): Promise<CommandLibraryActionResult> {
    try {
      await options.saveFavorite(request)
      options.notify('常用命令已保存', 'success')
      await reload()
      return { ok: true }
    } catch (reason) {
      const message = String(reason)
      if (message.includes('COMMAND_FAVORITE_SENSITIVE_CONFIRM')) {
        const ok = await options.confirm({
          title: '确认保存敏感命令',
          message: '该命令可能包含密码、token、secret 或 key。确认后可以保存，但不会写入日志或备份。',
          confirmText: '仍然保存',
          danger: true,
        })
        if (!ok) return { ok: false, reason: 'cancelled' }
        return saveFavoriteEntry({ ...request, allowSensitive: true })
      }
      options.notify(errorMessage(reason, '保存收藏失败'), 'error')
      return { ok: false, reason: 'failed' }
    }
  }

  function setScope(scope: CommandListScope) {
    options.setHistoryScope(scope)
  }

  return {
    historyKey,
    history,
    favoriteCount,
    groupedFavorites,
    reload,
    reloadHistoryAfterBatch,
    updateHistoryEntry,
    deleteHistoryEntry,
    clearCurrentServerHistory,
    deleteFavoriteEntry,
    markFavoriteEntryUsed,
    saveFavoriteEntry,
    setScope,
  }
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}
