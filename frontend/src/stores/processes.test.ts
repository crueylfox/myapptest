// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProcessStore } from './processes'
import type { ProcessEntry } from '../types'

const runtime = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => runtime.callbacks.set(name, callback)),
  EventsOff: vi.fn((name: string) => runtime.callbacks.delete(name)),
}))

const bash: ProcessEntry = {
  serverID: 7,
  pid: 42,
  ppid: 1,
  user: 'root',
  state: 'R',
  stateLabel: '运行',
  cpuPercent: 12.5,
  memoryPercent: 3.1,
  rssBytes: 1024,
  vszBytes: 2048,
  command: 'bash',
  argsPreview: 'bash -lc sleep 30',
  startedOrElapsed: '00:02',
  isKernelThread: false,
  canSignal: true,
}

const nginx: ProcessEntry = {
  ...bash,
  pid: 108,
  ppid: 42,
  user: 'www-data',
  cpuPercent: 1.5,
  memoryPercent: 9.8,
  command: 'nginx',
  argsPreview: 'nginx: worker process',
}

function app() {
  return window.go!.main!.App!
}

describe('process store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtime.callbacks.clear()
    window.go = {
      main: {
        App: {
          ListProcesses: vi.fn(async () => ({
            serverID: 7,
            processes: [bash, nginx],
            warnings: ['部分进程无法读取。'],
            timestamp: '',
          })),
          GetProcessDetail: vi.fn(async () => ({
            serverID: 7,
            pid: 42,
            ppid: 1,
            user: 'root',
            state: 'R',
            stateLabel: '运行',
            command: 'bash',
            cmdline: 'bash -lc sleep 30',
            rssBytes: 1024,
            vszBytes: 2048,
            memoryPercent: 3.1,
            cpuPercent: 12.5,
            environmentRedacted: true,
            children: [nginx],
            lastUpdatedAt: '',
            warnings: [],
            isKernelThread: false,
            canSignal: true,
          })),
          SignalProcess: vi.fn(async () => ({
            serverID: 7,
            pid: 42,
            success: true,
            message: '已发送 SIGTERM',
          })),
          StartProcessWatch: vi.fn(async () => 'watch-1'),
          StopProcessWatch: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  it('refreshes process list through a typed backend request', async () => {
    const store = useProcessStore()
    const response = await store.refresh({ serverID: 7, query: 'nginx', sortBy: 'memory', sortDir: 'desc' })
    expect(app().ListProcesses).toHaveBeenCalledWith({
      serverID: 7,
      query: 'nginx',
      sortBy: 'memory',
      sortDir: 'desc',
      limit: 500,
    })
    expect(response.processes).toHaveLength(2)
    expect(store.list(7)[1].command).toBe('nginx')
    expect(store.warnings(7)).toEqual(['部分进程无法读取。'])
    expect(store.hasLoadedList(7)).toBe(true)
    expect(store.listError(7)).toBe('')
  })

  it('preserves the old list and records list error when refresh fails', async () => {
    const store = useProcessStore()
    await store.refresh({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    vi.mocked(app().ListProcesses).mockRejectedValueOnce(new Error('parser failed'))

    await expect(store.refresh({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })).rejects.toThrow('parser failed')

    expect(store.list(7)).toEqual([bash, nginx])
    expect(store.hasLoadedList(7)).toBe(true)
    expect(store.listError(7)).toBe('parser failed')
  })

  it('loads detail without environment data and sends guarded signals', async () => {
    const store = useProcessStore()
    const detail = await store.loadDetail(7, 42)
    expect(app().GetProcessDetail).toHaveBeenCalledWith({ serverID: 7, pid: 42 })
    expect(detail.environmentRedacted).toBe(true)
    await store.signal(7, 42, 'term', 'bash')
    expect(app().SignalProcess).toHaveBeenCalledWith({
      serverID: 7,
      pid: 42,
      signal: 'term',
      expectedCommand: 'bash',
    })
  })

  it('accepts active watcher events and ignores mismatched late events', async () => {
    const store = useProcessStore()
    store.subscribe()
    await store.startWatch({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    runtime.callbacks.get('process:list')?.({
      serverID: 7,
      watchID: 'late-watch',
      processes: [nginx],
      warnings: [],
      timestamp: '',
    })
    expect(store.list(7)).toEqual([])
    runtime.callbacks.get('process:list')?.({
      serverID: 7,
      watchID: 'watch-1',
      processes: [bash],
      warnings: [],
      timestamp: '',
    })
    expect(store.list(7)).toEqual([bash])
  })

  it('keeps watcher list errors server and watch scoped without clearing old rows', async () => {
    const store = useProcessStore()
    store.subscribe()
    await store.refresh({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    await store.startWatch({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })

    runtime.callbacks.get('process:error')?.({
      serverID: 7,
      watchID: 'late-watch',
      code: 'PROCESS_WATCH_FAILED',
      message: '读取进程列表失败',
      timestamp: '',
    })
    runtime.callbacks.get('process:error')?.({
      serverID: 8,
      watchID: 'watch-1',
      code: 'PROCESS_WATCH_FAILED',
      message: 'server 8 failed',
      timestamp: '',
    })
    expect(store.listError(7)).toBe('')
    expect(store.listError(8)).toBe('')

    runtime.callbacks.get('process:error')?.({
      serverID: 7,
      watchID: 'watch-1',
      code: 'PROCESS_WATCH_FAILED',
      message: '读取进程列表失败',
      timestamp: '',
    })
    expect(store.list(7)).toEqual([bash, nginx])
    expect(store.listError(7)).toBe('读取进程列表失败')

    runtime.callbacks.get('process:list')?.({
      serverID: 7,
      watchID: 'watch-1',
      processes: [bash],
      warnings: [],
      timestamp: '',
    })
    expect(store.listError(7)).toBe('')
  })

  it('normalizes nullable list and detail payloads without crashing', async () => {
    vi.mocked(app().ListProcesses).mockResolvedValueOnce({
      serverID: 7,
      processes: [
        { serverID: 7, pid: 300, command: 'percent', cpuPercent: '12.5%', memoryPercent: null },
        null,
      ],
      warnings: null,
      timestamp: '',
    } as never)
    vi.mocked(app().GetProcessDetail).mockResolvedValueOnce({
      serverID: 7,
      pid: 300,
      command: 'percent',
      cmdline: null,
      children: null,
      warnings: null,
      cpuPercent: '12.5%',
      memoryPercent: undefined,
      environmentRedacted: true,
      canSignal: true,
    } as never)
    const store = useProcessStore()
    await store.refresh({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    expect(store.list(7)).toHaveLength(1)
    expect(store.list(7)[0].cpuPercent).toBe(12.5)
    expect(store.list(7)[0].memoryPercent).toBe(0)
    expect(store.warnings(7)).toEqual([])

    const detail = await store.loadDetail(7, 300)
    expect(detail.cmdline).toBe('')
    expect(detail.children).toEqual([])
    expect(detail.warnings).toEqual([])
  })

  it('ignores null and late watcher events after the watch is closed', async () => {
    const store = useProcessStore()
    store.subscribe()
    await store.startWatch({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    await store.stopWatch(7)
    runtime.callbacks.get('process:list')?.({
      serverID: 7,
      watchID: 'watch-1',
      processes: [nginx],
      warnings: [],
      timestamp: '',
    })
    expect(store.list(7)).toEqual([])

    runtime.callbacks.get('process:list')?.({
      serverID: 7,
      watchID: 'late-watch',
      processes: null,
      warnings: null,
      timestamp: '',
    })
    expect(store.list(7)).toEqual([])
  })

  it('stops active watcher and clears server runtime state', async () => {
    const store = useProcessStore()
    await store.startWatch({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    await store.refresh({ serverID: 7, sortBy: 'cpu', sortDir: 'desc' })
    await store.stopServerRuntime(7)
    expect(app().StopProcessWatch).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })
    expect(store.list(7)).toEqual([])
    expect(store.activeWatchByServerId[7]).toBeUndefined()
  })
})
