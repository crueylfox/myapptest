// @vitest-environment jsdom

import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCommandLibraryDataFlow } from './useCommandLibraryDataFlow'
import type { CommandFavorite, CommandHistoryEntry, Connection } from '../types'

const connection: Connection = {
  id: 7,
  groupId: 3,
  name: 'server',
  host: '192.0.2.7',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

const historyEntry: CommandHistoryEntry = {
  id: 'h1',
  serverId: 7,
  serverName: 'server',
  sessionId: 's1',
  command: 'uptime',
  commandHash: 'hash',
  source: 'terminal',
  executedAt: '2026-06-17T00:00:00Z',
}

const favorite: CommandFavorite = {
  id: 'f1',
  title: 'Disk',
  command: 'df -h',
  description: '',
  scope: 'server',
  serverId: 7,
  groupId: null,
  tags: ['fs'],
  sortOrder: 0,
  useCount: 0,
  createdAt: '',
  updatedAt: '',
  lastUsedAt: '',
}

function createFlow() {
  const historyByServer = ref<Record<number, CommandHistoryEntry[]>>({ 0: [historyEntry], 7: [] })
  const favorites = ref<CommandFavorite[]>([favorite])
  const scope = ref<'all' | 'currentServer'>('all')
  const query = ref('')
  const serverId = computed(() => connection.id)
  const currentConnection = computed(() => connection)
  const historyLimit = computed(() => 2000)
  const setBusy = vi.fn()
  const notify = vi.fn()
  const confirm = vi.fn(async () => true)
  const loadHistory = vi.fn(async () => [historyEntry])
  const loadFavorites = vi.fn(async () => [favorite])
  const updateHistory = vi.fn(async () => ({ ...historyEntry, command: 'uptime -p' }))
  const deleteHistory = vi.fn(async () => undefined)
  const clearHistory = vi.fn(async () => undefined)
  const saveFavorite = vi.fn(async () => favorite)
  const deleteFavorite = vi.fn(async () => undefined)
  const markFavoriteUsed = vi.fn(async () => ({ ...favorite, useCount: 1 }))
  const setHistoryScope = vi.fn((next: 'all' | 'currentServer') => { scope.value = next })
  const flow = useCommandLibraryDataFlow({
    historyByServer,
    favorites,
    groupedFavorites: {
      global: computed(() => favorites.value.filter((item) => item.scope === 'global')),
      group: computed(() => favorites.value.filter((item) => item.scope === 'group')),
      server: computed(() => favorites.value.filter((item) => item.scope === 'server')),
    },
    serverId,
    connection: currentConnection,
    query,
    scope,
    historyLimit,
    setBusy,
    notify,
    confirm,
    loadHistory,
    loadFavorites,
    updateHistory,
    deleteHistory,
    clearHistory,
    saveFavorite,
    deleteFavorite,
    markFavoriteUsed,
    setHistoryScope,
  })
  return {
    flow,
    historyByServer,
    favorites,
    scope,
    query,
    setBusy,
    notify,
    confirm,
    loadHistory,
    loadFavorites,
    updateHistory,
    deleteHistory,
    clearHistory,
    saveFavorite,
    deleteFavorite,
    markFavoriteUsed,
    setHistoryScope,
  }
}

describe('useCommandLibraryDataFlow', () => {
  it('loads history and favorites with the current palette context', async () => {
    const { flow, loadHistory, loadFavorites, setBusy } = createFlow()

    await flow.reload()

    expect(setBusy).toHaveBeenNthCalledWith(1, true)
    expect(loadHistory).toHaveBeenCalledWith(7, '', 2000, 'all')
    expect(loadFavorites).toHaveBeenCalledWith(connection, '', 'all')
    expect(setBusy).toHaveBeenLastCalledWith(false)
    expect(flow.history.value).toEqual([historyEntry])
    expect(flow.favoriteCount.value).toBe(1)
    expect(flow.groupedFavorites.value.server).toEqual([favorite])
  })

  it('returns a toast intent when reload fails without clearing existing rows', async () => {
    const { flow, historyByServer, loadHistory, notify } = createFlow()
    loadHistory.mockRejectedValueOnce(new Error('LOAD_FAILED'))

    await flow.reload()

    expect(historyByServer.value[0]).toEqual([historyEntry])
    expect(notify).toHaveBeenCalledWith('LOAD_FAILED', 'error')
  })

  it('updates and deletes history through injected callbacks', async () => {
    const { flow, updateHistory, deleteHistory } = createFlow()

    await expect(flow.updateHistoryEntry({ id: 'h1', command: 'uptime -p' })).resolves.toEqual({ ok: true })
    await expect(flow.deleteHistoryEntry(historyEntry)).resolves.toEqual({ ok: true })

    expect(updateHistory).toHaveBeenCalledWith({ id: 'h1', command: 'uptime -p' }, 7, '', 'all', 2000)
    expect(deleteHistory).toHaveBeenCalledWith('h1', 7, '', 'all', 2000)
  })

  it('refreshes both batch history scopes without failing the flow when one reload fails', async () => {
    const { flow, loadHistory, notify } = createFlow()
    loadHistory.mockRejectedValueOnce(new Error('ALL_SCOPE_FAILED')).mockResolvedValueOnce([historyEntry])

    await expect(flow.reloadHistoryAfterBatch()).resolves.toEqual({ ok: true })

    expect(loadHistory).toHaveBeenCalledWith(7, '', 2000, 'all')
    expect(loadHistory).toHaveBeenCalledWith(7, '', 2000, 'currentServer')
    expect(notify).not.toHaveBeenCalled()
  })

  it('asks for confirmation before clearing history or deleting favorites', async () => {
    const { flow, confirm, clearHistory, deleteFavorite } = createFlow()
    flow.setScope('currentServer')

    await flow.clearCurrentServerHistory()
    await flow.deleteFavoriteEntry(favorite)

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, confirmText: '清空' }))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, confirmText: '删除' }))
    expect(clearHistory).toHaveBeenCalledWith(7)
    expect(deleteFavorite).toHaveBeenCalledWith('f1')
  })

  it('does not run destructive callbacks when confirmation is cancelled', async () => {
    const { flow, confirm, clearHistory, deleteFavorite } = createFlow()
    flow.setScope('currentServer')
    confirm.mockResolvedValue(false)

    await expect(flow.clearCurrentServerHistory()).resolves.toEqual({ ok: false, reason: 'cancelled' })
    await expect(flow.deleteFavoriteEntry(favorite)).resolves.toEqual({ ok: false, reason: 'cancelled' })

    expect(clearHistory).not.toHaveBeenCalled()
    expect(deleteFavorite).not.toHaveBeenCalled()
  })

  it('saves favorites, handles sensitive confirmation through injected policy, and reloads library data', async () => {
    const { flow, confirm, saveFavorite, loadHistory, loadFavorites, notify } = createFlow()
    saveFavorite
      .mockRejectedValueOnce(new Error('COMMAND_FAVORITE_SENSITIVE_CONFIRM'))
      .mockResolvedValueOnce({ ...favorite, id: 'saved' })

    const result = await flow.saveFavoriteEntry({
      id: '',
      title: 'Disk',
      command: 'df -h',
      description: '',
      scope: 'server',
      serverId: 7,
      groupId: null,
      tags: [],
      sortOrder: 0,
      allowSensitive: false,
    })

    expect(result).toEqual({ ok: true })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: '仍然保存', danger: true }))
    expect(saveFavorite).toHaveBeenLastCalledWith(expect.objectContaining({ allowSensitive: true }))
    expect(loadHistory).toHaveBeenCalled()
    expect(loadFavorites).toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('常用命令已保存', 'success')
  })

  it('marks favorites as used without inserting terminal output or writing localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { flow, markFavoriteUsed } = createFlow()

    await flow.markFavoriteEntryUsed(favorite)

    expect(markFavoriteUsed).toHaveBeenCalledWith('f1')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('updates scope through the injected store boundary', () => {
    const { flow, setHistoryScope, scope } = createFlow()

    flow.setScope('currentServer')

    expect(setHistoryScope).toHaveBeenCalledWith('currentServer')
    expect(scope.value).toBe('currentServer')
  })
})
