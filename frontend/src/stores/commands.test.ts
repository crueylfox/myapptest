// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../types'
import { useCommandStore } from './commands'
import { useSftpStore } from './sftp'

const apiMock = vi.hoisted(() => ({
  listCommandHistory: vi.fn(),
  listCommandFavorites: vi.fn(),
  listCommandSuggestions: vi.fn(),
  createCommandFavorite: vi.fn(),
  updateCommandFavorite: vi.fn(),
  deleteCommandFavorite: vi.fn(),
  incrementCommandFavoriteUse: vi.fn(),
  recordCommandHistory: vi.fn(),
  recordBatchCommandHistory: vi.fn(),
  deleteCommandHistory: vi.fn(),
  clearCommandHistory: vi.fn(),
}))

vi.mock('../api/backend', () => ({ api: apiMock }))

const connection: Connection = {
  id: 7,
  groupId: null,
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
const localCmdHistoryKey = 'serverpilot.commandHistory.local.cmd'
const localPowerShellHistoryKey = 'serverpilot.commandHistory.local.powershell'
const localFavoritesKey = 'serverpilot.commandFavorites.local'

describe('commands store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('normalizes null backend list responses to empty arrays', async () => {
    apiMock.listCommandHistory.mockResolvedValueOnce(null)
    apiMock.listCommandFavorites.mockResolvedValueOnce(null)
    apiMock.listCommandSuggestions.mockResolvedValueOnce(null)
    const store = useCommandStore()

    await expect(store.loadHistory(7)).resolves.toEqual([])
    await expect(store.loadFavorites(connection)).resolves.toEqual([])
    await expect(store.loadSuggestions(connection, '')).resolves.toEqual([])

    expect(store.historyByServer[0]).toEqual([])
    expect(store.favorites).toEqual([])
    expect(store.suggestions).toEqual([])
  })

  it('keeps all-history and current-server history in separate cache buckets', async () => {
    apiMock.listCommandHistory
      .mockResolvedValueOnce([{ id: 'all', serverId: 8, command: 'uptime', sessionId: 's1', commandHash: 'h1', source: 'terminal', executedAt: '' }])
      .mockResolvedValueOnce([{ id: 'current', serverId: 7, command: 'df -h', sessionId: 's2', commandHash: 'h2', source: 'terminal', executedAt: '' }])
    const store = useCommandStore()

    await store.loadHistory(7, '', 500, 'all')
    await store.loadHistory(7, '', 200, 'currentServer')

    expect(apiMock.listCommandHistory).toHaveBeenNthCalledWith(1, { serverId: 0, scope: 'all', query: '', limit: 500 })
    expect(apiMock.listCommandHistory).toHaveBeenNthCalledWith(2, { serverId: 7, scope: 'currentServer', query: '', limit: 200 })
    expect(store.historyByServer[0].map((item) => item.id)).toEqual(['all'])
    expect(store.historyByServer[7].map((item) => item.id)).toEqual(['current'])
  })

  it('derives multiline metadata and preview for older history DTOs', async () => {
    const command = ['echo \\', '1 \\', '2 \\', '你好'].join('\r\n')
    apiMock.listCommandHistory.mockResolvedValueOnce([{
      id: 'multi',
      serverId: 7,
      command: ` ${command} `,
      sessionId: 's1',
      commandHash: 'h1',
      source: 'terminal',
      executedAt: '',
    }])
    const store = useCommandStore()

    await store.loadHistory(7, 'images', 500, 'currentServer')

    expect(store.historyByServer[7][0]).toMatchObject({
      command: ['echo \\', '1 \\', '2 \\', '你好'].join('\n'),
      preview: 'echo \\ ...',
      isMultiline: true,
    })
  })

  it('records history with a caller-provided source', async () => {
    apiMock.recordCommandHistory.mockResolvedValueOnce({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
    })
    const store = useCommandStore()

    await store.recordHistory(7, 'session-batch', 'uname -a', 'batch')

    expect(apiMock.recordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'session-batch',
      command: 'uname -a',
      source: 'batch',
    })
  })

  it('persists local CMD and PowerShell history in separate local scopes without calling backend history APIs', async () => {
    const store = useCommandStore()

    await store.recordLocalHistory('local:cmd', 'cmd-session', 'dir')
    await store.recordLocalHistory('local:powershell', 'ps-session', 'Get-Date')
    await expect(store.loadHistory(-1001, '', 500, 'currentServer')).resolves.toEqual([
      expect.objectContaining({ command: 'dir', sessionId: 'cmd-session', source: 'local:cmd' }),
    ])
    await expect(store.loadHistory(-1002, '', 500, 'currentServer')).resolves.toEqual([
      expect.objectContaining({ command: 'Get-Date', sessionId: 'ps-session', source: 'local:powershell' }),
    ])

    expect(store.historyByServer[-1001].map((item) => item.command)).toEqual(['dir'])
    expect(store.historyByServer[-1002].map((item) => item.command)).toEqual(['Get-Date'])
    expect(apiMock.recordCommandHistory).not.toHaveBeenCalled()
    expect(apiMock.listCommandHistory).not.toHaveBeenCalled()
    expect(localStorage.getItem('serverpilot.commandScope')).toBeNull()
    expect(localStorage.getItem(localCmdHistoryKey)).toContain('dir')
    expect(localStorage.getItem(localPowerShellHistoryKey)).toContain('Get-Date')

    setActivePinia(createPinia())
    const restartedStore = useCommandStore()

    await expect(restartedStore.loadHistory(-1001, '', 500, 'currentServer')).resolves.toEqual([
      expect.objectContaining({ command: 'dir', source: 'local:cmd' }),
    ])
    await expect(restartedStore.loadHistory(-1002, '', 500, 'currentServer')).resolves.toEqual([
      expect.objectContaining({ command: 'Get-Date', source: 'local:powershell' }),
    ])
    expect(restartedStore.historyByServer[-1001].map((item) => item.command)).toEqual(['dir'])
    expect(restartedStore.historyByServer[-1002].map((item) => item.command)).toEqual(['Get-Date'])
  })

  it('does not store sensitive local commands in the persisted local history scopes', async () => {
    const store = useCommandStore()

    const result = await store.recordLocalHistory('local:cmd', 'cmd-session', 'set TOKEN=secret-value')

    expect(result).toMatchObject({ recorded: false, skipped: true, reasonCode: 'SENSITIVE' })
    expect(store.historyByServer[-1001] ?? []).toEqual([])
    expect(localStorage.getItem(localCmdHistoryKey) ?? '').not.toContain('TOKEN')
    expect(apiMock.recordCommandHistory).not.toHaveBeenCalled()
  })

  it('updates local command history persistence when deleting or clearing local entries', async () => {
    const store = useCommandStore()
    await store.recordLocalHistory('local:cmd', 'cmd-session', 'dir')
    await store.recordLocalHistory('local:cmd', 'cmd-session', 'pwd')
    await store.recordLocalHistory('local:powershell', 'ps-session', 'Get-ChildItem')

    const cmdEntries = await store.loadHistory(-1001)
    const dirEntry = cmdEntries.find((entry) => entry.command === 'dir')
    expect(dirEntry).toBeTruthy()
    await store.deleteHistory(dirEntry!.id, -1001)

    expect(store.historyByServer[-1001].map((item) => item.command)).toEqual(['pwd'])
    expect(localStorage.getItem(localCmdHistoryKey)).toContain('pwd')
    expect(localStorage.getItem(localCmdHistoryKey)).not.toContain('dir')

    await store.clearHistory(-1002)

    expect(store.historyByServer[-1002]).toEqual([])
    expect(localStorage.getItem(localPowerShellHistoryKey)).toBe('[]')
  })

  it('persists local favorites and filters favorites by active shell type', async () => {
    const store = useCommandStore()

    await store.saveFavorite({
      id: '',
      title: 'CMD dir',
      command: 'dir',
      description: '',
      scope: 'server',
      serverId: -1001,
      groupId: null,
      tags: ['shell:cmd'],
      sortOrder: 0,
      allowSensitive: false,
    })
    await store.saveFavorite({
      id: '',
      title: 'PowerShell list',
      command: 'Get-ChildItem',
      description: '',
      scope: 'server',
      serverId: -1002,
      groupId: null,
      tags: ['shell:powershell'],
      sortOrder: 0,
      allowSensitive: false,
    })
    await store.saveFavorite({
      id: '',
      title: 'Common echo',
      command: 'echo ok',
      description: '',
      scope: 'global',
      serverId: null,
      groupId: null,
      tags: ['shell:any', 'source:local'],
      sortOrder: 0,
      allowSensitive: false,
    })

    await expect(store.loadFavorites({ ...connection, id: -1001, name: 'CMD' })).resolves.toEqual([
      expect.objectContaining({ title: 'Common echo' }),
      expect.objectContaining({ title: 'CMD dir' }),
    ])
    expect(store.favorites.map((item) => item.title)).not.toContain('PowerShell list')

    await expect(store.loadFavorites({ ...connection, id: -1002, name: 'PowerShell' })).resolves.toEqual([
      expect.objectContaining({ title: 'Common echo' }),
      expect.objectContaining({ title: 'PowerShell list' }),
    ])
    expect(store.favorites.map((item) => item.title)).not.toContain('CMD dir')
    expect(apiMock.createCommandFavorite).not.toHaveBeenCalled()
    expect(localStorage.getItem(localFavoritesKey)).toContain('CMD dir')
    expect(localStorage.getItem(localFavoritesKey)).toContain('PowerShell list')
  })

  it('filters backend favorites by shell tags for SSH sessions', async () => {
    apiMock.listCommandFavorites.mockResolvedValueOnce([
      { id: 'ssh', title: 'SSH uptime', command: 'uptime', description: '', scope: 'global', serverId: null, groupId: null, tags: ['shell:ssh'], sortOrder: 0, useCount: 0, createdAt: '', updatedAt: '', lastUsedAt: '' },
      { id: 'cmd', title: 'CMD dir', command: 'dir', description: '', scope: 'global', serverId: null, groupId: null, tags: ['shell:cmd'], sortOrder: 0, useCount: 0, createdAt: '', updatedAt: '', lastUsedAt: '' },
      { id: 'any', title: 'Any echo', command: 'echo ok', description: '', scope: 'global', serverId: null, groupId: null, tags: ['shell:any'], sortOrder: 0, useCount: 0, createdAt: '', updatedAt: '', lastUsedAt: '' },
    ])
    const store = useCommandStore()

    await store.loadFavorites(connection)

    expect(store.favorites.map((item) => item.title)).toEqual(['SSH uptime', 'Any echo'])
  })

  it('returns common commands filtered by shell type and query', () => {
    const store = useCommandStore()

    expect(store.commonCommandsForConnection(connection, 'sys').map((item) => item.command)).toContain('systemctl status')
    expect(store.commonCommandsForConnection({ ...connection, id: -1001, name: 'CMD' }, 'dir').map((item) => item.command)).toContain('dir')
    expect(store.commonCommandsForConnection({ ...connection, id: -1001, name: 'CMD' }, 'systemctl').map((item) => item.command)).toEqual([])
    expect(store.commonCommandsForConnection({ ...connection, id: -1002, name: 'PowerShell' }, 'Get-Child').map((item) => item.command)).toContain('Get-ChildItem')
    expect(store.commonCommandsForConnection({ ...connection, id: -1002, name: 'PowerShell' }, 'dir').map((item) => item.command)).toEqual([])
  })

  it('records one batch history request for successful server IDs', async () => {
    apiMock.recordBatchCommandHistory.mockResolvedValueOnce({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
      historyId: 'batch-1',
      targetCount: 2,
    })
    const store = useCommandStore()

    await store.recordBatchHistory('uname -a', [1, 5], 'submission-1')

    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledWith({
      command: 'uname -a',
      successfulServerIds: [1, 5],
      submissionId: 'submission-1',
    })
  })

  it('merges current SFTP directory entries as path suggestions without backend shell probes', async () => {
    apiMock.listCommandSuggestions.mockResolvedValueOnce([{
      id: 'hist-cat',
      source: 'history',
      kind: 'command',
      title: 'cat /var/log/syslog',
      command: 'cat /var/log/syslog',
      description: '',
      scope: 'server',
      serverId: 7,
      groupId: null,
      score: 900,
      useCount: 0,
      lastUsedAt: '2026-06-26T00:00:00Z',
    }])
    const sftp = useSftpStore()
    sftp.activeContextId = 'server:7'
    sftp.stateByContextId['server:7'] = {
      connectionId: 7,
      contextId: 'server:7',
      status: 'online',
      active: true,
      mode: 'sftp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
      currentPath: '/etc',
      message: 'online',
      updatedAt: '',
    }
    sftp.entriesByContextId['server:7'] = [{
      name: 'nginx.conf',
      path: '/etc/nginx.conf',
      parentPath: '/etc',
      size: 128,
      isDir: false,
      isSymlink: false,
      permissions: '-rw-r--r--',
      owner: '0',
      group: '0',
      modTime: '',
    }]
    const store = useCommandStore()

    const suggestions = await store.loadSuggestions(connection, 'cat /etc/n', 10)

    expect(apiMock.listCommandSuggestions).toHaveBeenCalledTimes(1)
    expect(suggestions.map((item) => item.command)).toContain('cat /etc/nginx.conf')
    expect(suggestions.find((item) => item.command === 'cat /etc/nginx.conf')).toMatchObject({
      source: 'path',
      kind: 'path',
      description: expect.stringContaining('/etc'),
    })
  })

  it('saves and updates favorites after the local array was polluted to null', async () => {
    apiMock.createCommandFavorite.mockResolvedValueOnce({
      id: 'fav-1',
      title: 'Pwd',
      command: 'pwd',
      description: null,
      scope: 'global',
      serverId: null,
      groupId: null,
      tags: null,
      sortOrder: null,
      useCount: null,
      createdAt: '',
      updatedAt: '',
      lastUsedAt: null,
    })
    apiMock.incrementCommandFavoriteUse.mockResolvedValueOnce({
      id: 'fav-1',
      title: 'Pwd',
      command: 'pwd',
      description: '',
      scope: 'global',
      serverId: null,
      groupId: null,
      tags: [],
      sortOrder: 0,
      useCount: 1,
      createdAt: '',
      updatedAt: '',
      lastUsedAt: '2026-06-18T00:00:00Z',
    })
    const store = useCommandStore()
    store.favorites = null as never

    const saved = await store.saveFavorite({
      id: '',
      title: 'Pwd',
      command: 'pwd',
      description: '',
      scope: 'global',
      serverId: null,
      groupId: null,
      tags: [],
      sortOrder: 0,
      allowSensitive: false,
    })
    expect(saved.tags).toEqual([])
    expect(store.favorites).toHaveLength(1)

    const used = await store.markFavoriteUsed('fav-1')
    expect(used.useCount).toBe(1)
    expect(store.favorites[0].useCount).toBe(1)
  })
})
