// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useSftpStore } from './sftp'
import type { SFTPEntry, SFTPTransferState } from '../types'

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

function transfer(values: Partial<SFTPTransferState>): SFTPTransferState {
  return {
    id: 't1',
    connectionId: 7,
    direction: 'upload',
    localPath: '',
    remotePath: '/home/demo/a.txt',
    fileName: 'a.txt',
    totalBytes: 100,
    transferredBytes: 0,
    percent: 0,
    speedBytesPerSecond: 0,
    status: 'queued',
    errorMessage: '',
    startedAt: '2026-06-16T00:00:00Z',
    finishedAt: '',
    ...values,
  }
}

function entry(values: Partial<SFTPEntry>): SFTPEntry {
  return {
    name: 'a.txt',
    path: '/home/demo/a.txt',
    parentPath: '/home/demo',
    size: 1,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: '1000',
    group: '1000',
    modTime: '2026-06-16T00:00:00Z',
    ...values,
  }
}

function transferHandler(store = useSftpStore()) {
  store.subscribe()
  return vi.mocked(EventsOn).mock.calls.find(([name]) => name === 'sftp:transfer')?.[1] as (value: unknown) => void
}

function entriesHandler(store = useSftpStore()) {
  store.subscribe()
  return vi.mocked(EventsOn).mock.calls.find(([name]) => name === 'sftp:entries')?.[1] as (value: unknown) => void
}

function stateHandler(store = useSftpStore()) {
  store.subscribe()
  return vi.mocked(EventsOn).mock.calls.find(([name]) => name === 'sftp:state')?.[1] as (value: unknown) => void
}

describe('sftp store', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.go = {
      main: {
        App: {
          OpenSftp: vi.fn(async (request: { connectionId: number }) => ({
            connectionId: request.connectionId,
            generation: 1,
            status: 'online',
            active: true,
            currentPath: '/home/demo',
            message: 'SFTP 已连接',
            updatedAt: '2026-06-16T00:00:00Z',
          })),
          ReconnectSftp: vi.fn(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId,
            terminalSessionId: request.terminalSessionId,
            generation: 2,
            status: 'online',
            active: true,
            currentPath: '/home/demo',
            message: 'SFTP reconnected',
            updatedAt: '2026-06-16T00:00:02Z',
          })),
          ReadSftpDir: vi.fn(async (request: { connectionId: number; path: string }) => ({
            connectionId: request.connectionId,
            generation: 1,
            requestId: 'request-1',
            path: request.path,
            parentPath: '/home',
            entries: [],
          })),
          SftpGoHome: vi.fn(async (request: { connectionId: number }) => ({
            connectionId: request.connectionId,
            generation: 2,
            requestId: 'home-request',
            path: '/home/demo',
            parentPath: '/home',
            entries: [],
          })),
          CloseSftpContext: vi.fn(async () => undefined),
          SftpCancelTransfer: vi.fn(async () => undefined),
          SftpPauseTransfer: vi.fn(async (request: { transferID: string }) => ({ transferID: request.transferID, status: 'pausing' })),
          SftpResumeTransfer: vi.fn(async (request: { transferID: string }) => ({ transferID: request.transferID, status: 'resuming' })),
        } as never,
      },
    }
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('does not open another SFTP session when already connected or connecting', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'SFTP 已连接',
      updatedAt: '',
    }
    await store.open(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })
    store.stateByServerId[7].status = 'connecting'
    await store.open(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })

    expect(window.go?.main?.App?.OpenSftp).not.toHaveBeenCalled()
  })

  it('reconnects an online SFTP runtime and ignores late entries from the old generation', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockResolvedValueOnce({
      connectionId: 7,
      contextId: 'server:7',
      generation: 2,
      requestId: 'fresh-request',
      path: '/home/demo',
      parentPath: '/home',
      entries: [entry({ name: 'server-b.txt', path: '/home/demo/server-b.txt' })],
    })
    const store = useSftpStore()
    const handleEntries = entriesHandler(store)
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'server-a.txt', path: '/home/demo/server-a.txt' })]

    await store.reconnect(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })
    handleEntries({
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      requestId: 'late-request',
      path: '/home/demo',
      parentPath: '/home',
      entries: [entry({ name: 'late-a.txt', path: '/home/demo/late-a.txt' })],
    })

    expect(app.ReconnectSftp).toHaveBeenCalledWith({
      connectionId: 7,
      contextId: 'server:7',
      terminalSessionId: '',
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
    expect(app.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'server:7',
      terminalSessionId: '',
      path: '/home/demo',
    }))
    expect(store.state(7, 'server:7')?.generation).toBe(2)
    expect(store.entries(7, 'server:7').map((item) => item.name)).toEqual(['server-b.txt'])
  })

  it('falls back to home when reconnect succeeds but the previous directory no longer exists', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockRejectedValueOnce(new Error('no such file'))
    vi.mocked(app.SftpGoHome).mockResolvedValueOnce({
      connectionId: 7,
      contextId: 'server:7',
      generation: 2,
      requestId: 'home-request',
      path: '/home/new',
      parentPath: '/home',
      entries: [entry({ name: 'server-b.txt', path: '/home/new/server-b.txt' })],
    })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/old/app',
      message: 'online',
      updatedAt: '',
    }

    await store.reconnect(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })

    expect(app.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({ path: '/old/app' }))
    expect(app.SftpGoHome).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'server:7',
    }))
    expect(store.state(7, 'server:7')?.currentPath).toBe('/home/new')
    expect(store.entries(7, 'server:7').map((item) => item.name)).toEqual(['server-b.txt'])
  })

  it('leaves reconnect loading state when reconnect fails before backend state events arrive', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.ReconnectSftp).mockRejectedValueOnce(new Error('saved credential rejected'))
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }

    await expect(store.reconnect(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })).rejects.toThrow('saved credential rejected')

    expect(store.state(7, 'server:7')?.status).toBe('error')
    expect(store.state(7, 'server:7')?.active).toBe(false)
    expect(store.state(7, 'server:7')?.message).toContain('saved credential rejected')
  })

  it('keeps SCP fallback open in limited mode without reading a fake directory', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.OpenSftp).mockResolvedValueOnce({
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
      currentPath: '.',
      message: 'SCP 兼容模式',
      updatedAt: '2026-06-16T00:00:00Z',
    })
    const store = useSftpStore()

    const state = await store.open(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })

    expect(state.mode).toBe('scp')
    expect(state.currentPath).toBe('/')
    expect(store.stateByServerId[7].currentPath).toBe('/')
    expect(store.stateByServerId[7].capabilities?.browse).toBe('none')
    expect(app.ReadSftpDir).not.toHaveBeenCalled()
  })

  it('marks SCP directory download unavailable when shell listing fails', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.OpenSftp).mockResolvedValueOnce({
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
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
      currentPath: '/root',
      message: 'SCP 兼容模式',
      updatedAt: '2026-06-16T00:00:00Z',
    })
    vi.mocked(app.ReadSftpDir).mockRejectedValueOnce(new Error('listing unsupported'))
    const store = useSftpStore()

    const state = await store.open(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false })

    expect(state.mode).toBe('scp')
    expect(state.capabilities?.browse).toBe('none')
    expect(state.capabilities?.uploadDirectory).toBe(true)
    expect(state.capabilities?.downloadDirectory).toBe(false)
    expect(state.message).toBe('当前服务器无法递归列出目录，暂不支持文件夹下载。')
  })

  it('calculates parent paths without escaping remote root', () => {
    const store = useSftpStore()

    expect(store.parentRemotePath('/home/demo')).toBe('/home')
    expect(store.parentRemotePath('/home')).toBe('/')
    expect(store.parentRemotePath('/')).toBe('/')
    expect(store.isRootRemotePath('/')).toBe(true)
  })

  it('returns the latest transfer for the active server and filters current/all scopes', () => {
    const store = useSftpStore()
    store.transfersById.a = transfer({ id: 'a', connectionId: 7, fileName: 'a.txt', startedAt: '2026-06-16T00:00:00Z' })
    store.transfersById.b = transfer({ id: 'b', connectionId: 8, fileName: 'b.txt', startedAt: '2026-06-16T00:00:01Z' })
    store.transfersById.c = transfer({ id: 'c', connectionId: 7, fileName: 'c.txt', startedAt: '2026-06-16T00:00:02Z' })

    expect(store.lastTransfer(7)?.fileName).toBe('c.txt')
    expect(store.transfersFor(7, 'current').map((item) => item.id)).toEqual(['a', 'c'])
    expect(store.transfersFor(7, 'all').map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('clears one server without leaking transfer records into another server', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.transfersById.a = transfer({ id: 'a', connectionId: 7 })
    store.transfersById.b = transfer({ id: 'b', connectionId: 8 })

    store.clearServer(7)

    expect(store.stateByServerId[7]).toBeUndefined()
    expect(store.transfersById.a).toBeUndefined()
    expect(store.transfersById.b).toBeDefined()
  })

  it('keeps completed transfer history when clearing a disconnected server runtime', () => {
    const store = useSftpStore()
    store.transfersById.done = transfer({ id: 'done', connectionId: 7, status: 'completed' })
    store.transfersById.running = transfer({ id: 'running', connectionId: 7, status: 'running' })
    store.transfersById.other = transfer({ id: 'other', connectionId: 8, status: 'completed' })

    store.clearServer(7)

    expect(store.transfersById.done).toBeDefined()
    expect(store.transfersById.running).toBeUndefined()
    expect(store.transfersById.other).toBeDefined()
  })

  it('drops running transfer progress from an older generation after reconnect', () => {
    const store = useSftpStore()
    const handleTransfer = transferHandler(store)
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 2,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }

    handleTransfer(transfer({
      id: 'old-running',
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'running',
      transferredBytes: 50,
    }))

    expect(store.transfersById['old-running']).toBeUndefined()
  })

  it('ignores late SFTP events after clearing a server until it is opened again', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.OpenSftp).mockImplementationOnce(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string }) => ({
      connectionId: request.connectionId,
      contextId: request.contextId,
      terminalSessionId: request.terminalSessionId,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'SFTP 已连接',
      updatedAt: '2026-06-16T00:00:00Z',
    }))
    const store = useSftpStore()
    const handleState = stateHandler(store)
    const handleEntries = entriesHandler(store)
    const handleTransfer = transferHandler(store)

    store.clearServer(7)
    handleState({
      connectionId: 7,
      contextId: 'term-1',
      status: 'online',
      active: true,
      currentPath: '/late',
      message: 'late',
      updatedAt: '',
    })
    handleEntries({
      connectionId: 7,
      contextId: 'term-1',
      path: '/late',
      parentPath: '/',
      entries: [entry({ name: 'late.txt', path: '/late/late.txt' })],
    })
    handleTransfer(transfer({ id: 'late-transfer', connectionId: 7, contextId: 'term-1', status: 'running' }))

    expect(store.stateByContextId['term-1']).toBeUndefined()
    expect(store.entries(7, 'term-1')).toEqual([])
    expect(store.transfersById['late-transfer']).toBeUndefined()

    await store.open(7, { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false }, 'term-1', 'term-1')

    expect(window.go?.main?.App?.OpenSftp).toHaveBeenCalledWith({
      connectionId: 7,
      contextId: 'term-1',
      terminalSessionId: 'term-1',
      auth: {
        password: '',
        passphrase: '',
        trustUnknownHost: false,
        rememberSecret: false,
      },
    })
    expect(store.state(7, 'term-1')?.status).toBe('online')
  })

  it('clears partial-failed recursive transfers as terminal transfer records', () => {
    const store = useSftpStore()
    store.transfersById.a = transfer({ id: 'a', connectionId: 7, status: 'partial_failed', recursive: true })
    store.transfersById.b = transfer({ id: 'b', connectionId: 7, status: 'running', recursive: true })

    store.clearCompleted(7)

    expect(store.transfersById.a).toBeUndefined()
    expect(store.transfersById.b).toBeDefined()
  })

  it('pauses and resumes transfers with the transfer context instead of the active UI context', async () => {
    const store = useSftpStore()
    store.activateContextForTerminal(7, 'term-active')
    store.transfersById.a = transfer({ id: 'a', connectionId: 7, contextId: 'term-a', status: 'running' })

    await store.pauseTransfer('a')
    await store.resumeTransfer('a')

    expect(window.go?.main?.App?.SftpPauseTransfer).toHaveBeenCalledWith({
      serverID: 7,
      contextID: 'term-a',
      transferID: 'a',
    })
    expect(window.go?.main?.App?.SftpResumeTransfer).toHaveBeenCalledWith({
      serverID: 7,
      contextID: 'term-a',
      transferID: 'a',
    })
  })

  it('refreshes the displayed directory once after upload completion and selects the uploaded file', async () => {
    vi.useFakeTimers()
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockResolvedValue({
      connectionId: 7,
      path: '/home/demo',
      parentPath: '/home',
      entries: [entry({ name: 'drop.txt', path: '/home/demo/drop.txt' })],
    })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    const handleTransfer = transferHandler(store)

    handleTransfer(transfer({ id: 'u1', status: 'completed', remotePath: '/home/demo/drop.txt', fileName: 'drop.txt' }))
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()

    expect(app.ReadSftpDir).toHaveBeenCalledTimes(1)
    expect(app.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'server:7',
      terminalSessionId: '',
      path: '/home/demo',
      requestId: expect.any(String),
    }))
    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/drop.txt'])
  })

  it('refreshes the displayed directory when a recursive upload finishes with partial failures', async () => {
    vi.useFakeTimers()
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockResolvedValue({
      connectionId: 7,
      path: '/home/demo',
      parentPath: '/home',
      entries: [entry({ name: 'site', path: '/home/demo/site', isDir: true })],
    })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    const handleTransfer = transferHandler(store)

    handleTransfer(transfer({
      id: 'recursive-upload',
      status: 'partial_failed',
      recursive: true,
      sourceType: 'directory',
      remotePath: '/home/demo/site',
      fileName: 'site',
      failedCount: 1,
    }))
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()

    expect(app.ReadSftpDir).toHaveBeenCalledTimes(1)
    expect(app.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'server:7',
      terminalSessionId: '',
      path: '/home/demo',
      requestId: expect.any(String),
    }))
    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/site'])
  })

  it('isolates SFTP directory state and transfers per terminal context', async () => {
    const store = useSftpStore()
    const firstContext = store.activateContextForTerminal(7, 'term-1')
    const secondContext = store.activateContextForTerminal(7, 'term-2')
    const handleEntries = entriesHandler(store)

    handleEntries({
      connectionId: 7,
      contextId: firstContext,
      path: '/root',
      parentPath: '/',
      entries: [entry({ name: 'root.txt', path: '/root/root.txt' })],
    })
    handleEntries({
      connectionId: 7,
      contextId: secondContext,
      path: '/var/www',
      parentPath: '/var',
      entries: [entry({ name: 'index.html', path: '/var/www/index.html' })],
    })
    store.transfersById.first = transfer({ id: 'first', connectionId: 7, contextId: firstContext ?? '', remotePath: '/root/root.txt' })
    store.transfersById.second = transfer({ id: 'second', connectionId: 7, contextId: secondContext ?? '', remotePath: '/var/www/index.html' })

    expect(store.state(7, firstContext)?.currentPath).toBe('/root')
    expect(store.state(7, secondContext)?.currentPath).toBe('/var/www')
    expect(store.entries(7, firstContext).map((item) => item.path)).toEqual(['/root/root.txt'])
    expect(store.entries(7, secondContext).map((item) => item.path)).toEqual(['/var/www/index.html'])
    expect(store.lastTransfer(7, firstContext)?.id).toBe('first')
    expect(store.lastTransfer(7, secondContext)?.id).toBe('second')

    await store.closeContextForTerminal(7, 'term-1')

    expect(window.go?.main?.App?.CloseSftpContext).toHaveBeenCalledWith({
      connectionId: 7,
      contextId: 'term-1',
      terminalSessionId: 'term-1',
    })
    expect(store.contextByTerminalSessionId['term-1']).toBeUndefined()
    expect(store.state(7, 'term-1')?.status).toBe('offline')
    expect(store.state(7, 'term-2')?.currentPath).toBe('/var/www')
    expect(store.transfersById.first).toBeUndefined()
    expect(store.transfersById.second).toBeDefined()
  })

  it('debounces multiple upload completions into one directory refresh', async () => {
    vi.useFakeTimers()
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockResolvedValue({
      connectionId: 7,
      path: '/home/demo',
      parentPath: '/home',
      entries: [
        entry({ name: 'a.txt', path: '/home/demo/a.txt' }),
        entry({ name: 'b.txt', path: '/home/demo/b.txt' }),
      ],
    })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    const handleTransfer = transferHandler(store)

    handleTransfer(transfer({ id: 'u1', status: 'completed', remotePath: '/home/demo/a.txt', fileName: 'a.txt' }))
    await vi.advanceTimersByTimeAsync(100)
    handleTransfer(transfer({ id: 'u2', status: 'completed', remotePath: '/home/demo/b.txt', fileName: 'b.txt' }))
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()

    expect(app.ReadSftpDir).toHaveBeenCalledTimes(1)
    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/b.txt'])
  })

  it('does not pull the user back when an upload finishes for a different remote directory', async () => {
    vi.useFakeTimers()
    const app = window.go!.main!.App!
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/var/log',
      message: 'online',
      updatedAt: '',
    }
    const handleTransfer = transferHandler(store)

    handleTransfer(transfer({ status: 'completed', remotePath: '/home/demo/a.txt' }))
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()

    expect(app.ReadSftpDir).not.toHaveBeenCalled()
    expect(store.stateByServerId[7].currentPath).toBe('/var/log')
  })
})
