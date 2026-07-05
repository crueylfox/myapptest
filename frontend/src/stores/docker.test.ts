// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDockerStore } from './docker'
import type { DockerComposeService, DockerContainer, DockerContainerStats } from '../types'

const runtime = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn((name: string, callback: (event: unknown) => void) => runtime.callbacks.set(name, callback)),
  EventsOff: vi.fn((name: string) => runtime.callbacks.delete(name)),
}))

const container: DockerContainer = {
  id: 'abc123',
  shortID: 'abc123',
  name: 'web',
  image: 'nginx:latest',
  command: '"nginx"',
  createdAt: '2026-06-18 10:00:00 +0800 CST',
  status: 'Up 2 hours',
  state: 'running',
  ports: '0.0.0.0:80->80/tcp',
  labels: '',
  size: '0B',
  serverID: 7,
}

const stoppedContainer: DockerContainer = {
  ...container,
  id: 'def456',
  shortID: 'def456',
  name: 'cache',
  image: 'redis:7',
  status: 'Exited (0) 1 hour ago',
  state: 'exited',
}

const stats: DockerContainerStats = {
  serverID: 7,
  containerID: 'abc123',
  cpuPercent: 12.34,
  memoryUsage: 10,
  memoryLimit: 100,
  memoryPercent: 10,
  netInput: 1,
  netOutput: 2,
  blockInput: 3,
  blockOutput: 4,
  pids: 8,
  timestamp: '2026-06-18T00:00:00Z',
}

const composeService: DockerComposeService = {
  serverID: 7,
  id: 'svc1',
  name: 'edge-web-1',
  project: 'edge',
  service: 'web',
  image: 'nginx:alpine',
  command: '',
  state: 'running',
  status: 'Up 2 minutes',
  health: '',
  ports: '0.0.0.0:8080->80/tcp',
  exitCode: 0,
}

function batchResponse(containerID: string, action: string) {
  return {
    serverID: 7,
    results: [{
      containerID,
      name: '',
      action,
      status: 'success',
      success: true,
      error: '',
      reason: '',
    }],
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
  }
}

function app() {
  return window.go!.main!.App!
}

describe('docker store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtime.callbacks.clear()
    window.go = {
      main: {
        App: {
          DockerCheck: vi.fn(async () => ({
            serverID: 7,
            available: true,
            version: '27.3.1',
            error: '',
            lastRefreshAt: '2026-06-18T00:00:00Z',
            containers: [],
          })),
          DockerListContainers: vi.fn(async () => [container, stoppedContainer]),
          DockerStartContainer: vi.fn(async () => undefined),
          DockerStopContainer: vi.fn(async () => undefined),
          DockerRestartContainer: vi.fn(async () => undefined),
          DockerRemoveContainer: vi.fn(async () => undefined),
          DockerBatchStartContainers: vi.fn(async () => batchResponse('def456', 'start')),
          DockerBatchStopContainers: vi.fn(async () => batchResponse('abc123', 'stop')),
          DockerBatchRestartContainers: vi.fn(async () => batchResponse('abc123', 'restart')),
          DockerBatchRemoveContainers: vi.fn(async () => batchResponse('def456', 'remove')),
          DockerGetContainerLogs: vi.fn(async () => 'one\ntwo\n'),
          DockerStartLogStream: vi.fn(async () => 'stream-1'),
          DockerStopLogStream: vi.fn(async () => undefined),
          DockerGetContainerInspectSummary: vi.fn(async () => ({
            serverID: 7,
            id: 'abc123',
            name: 'web',
            image: 'nginx:latest',
            created: '2026-06-18T00:00:00Z',
            state: 'running',
            status: 'running',
            ports: '0.0.0.0:80->80/tcp',
            mountCount: 1,
            networkNames: ['bridge'],
            restartPolicy: 'unless-stopped',
          })),
          DockerGetContainerStats: vi.fn(async () => stats),
          DockerStartStatsWatch: vi.fn(async () => 'watch-1'),
          DockerStopStatsWatch: vi.fn(async () => undefined),
          DockerComposeCheck: vi.fn(async () => ({
            serverID: 7,
            available: true,
            command: 'docker compose',
            version: 'v2.27.1',
            error: '',
            lastRefreshAt: '',
          })),
          DockerComposeListProjects: vi.fn(async () => [{
            serverID: 7,
            name: 'edge',
            status: 'running(1)',
            configFiles: '',
            workingDir: '',
          }]),
          DockerComposeGetServices: vi.fn(async () => ({
            serverID: 7,
            projectName: 'edge',
            services: [composeService],
            timestamp: '2026-07-05T00:00:00Z',
          })),
          DockerComposeGetServiceDetail: vi.fn(async () => composeService),
          DockerComposeGetLogs: vi.fn(async (request: { serviceName?: string }) => ({
            serverID: 7,
            projectName: 'edge',
            serviceName: request.serviceName ?? '',
            output: request.serviceName ? 'web log\n' : 'project log\n',
            truncated: false,
            timestamp: '2026-07-05T00:00:00Z',
          })),
        } as never,
      },
    }
  })

  it('checks docker and refreshes container list through typed backend calls', async () => {
    const store = useDockerStore()
    await store.check(7)
    const rows = await store.refresh(7)
    expect(app().DockerCheck).toHaveBeenCalledWith(7)
    expect(app().DockerListContainers).toHaveBeenCalledWith({ serverID: 7 })
    expect(rows).toHaveLength(2)
    expect(store.containers(7)[0].name).toBe('web')
  })

  it('starts, stops, restarts, and removes containers through typed backend requests', async () => {
    const store = useDockerStore()
    await store.start(7, 'abc123')
    await store.stop(7, 'abc123')
    await store.restart(7, 'abc123')
    await store.remove(7, 'def456')
    expect(app().DockerStartContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
    expect(app().DockerStopContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
    expect(app().DockerRestartContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
    expect(app().DockerRemoveContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'def456' })
  })

  it('keeps selected container ids isolated by server and prunes missing containers', async () => {
    const store = useDockerStore()
    store.toggleSelected(7, 'abc123')
    store.toggleSelected(7, 'missing')
    store.toggleSelected(8, 'xyz789')
    expect(store.selectedIDs(7)).toEqual(['abc123', 'missing'])
    expect(store.selectedCount(8)).toBe(1)
    store.pruneSelection(7, ['abc123'])
    expect(store.selectedIDs(7)).toEqual(['abc123'])
    expect(store.selectedIDs(8)).toEqual(['xyz789'])
    store.toggleAllVisible(7, ['abc123', 'def456'])
    expect(store.selectedIDs(7)).toEqual(['abc123', 'def456'])
    store.toggleAllVisible(7, ['abc123', 'def456'])
    expect(store.selectedIDs(7)).toEqual([])
  })

  it('runs batch container operations and refreshes the list', async () => {
    const store = useDockerStore()
    await store.batchStart(7, ['def456'])
    await store.batchStop(7, ['abc123'])
    await store.batchRestart(7, ['abc123'])
    await store.batchRemove(7, ['def456'])
    expect(app().DockerBatchStartContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['def456'] })
    expect(app().DockerBatchStopContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['abc123'] })
    expect(app().DockerBatchRestartContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['abc123'] })
    expect(app().DockerBatchRemoveContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['def456'] })
    expect(app().DockerListContainers).toHaveBeenCalledTimes(4)
  })

  it('loads logs, follows logs, ignores mismatched late events, and caps logs at 5000 lines', async () => {
    const store = useDockerStore()
    store.subscribe()
    await store.loadLogs(7, 'abc123')
    expect(store.containerLogs(7, 'abc123')).toEqual(['one', 'two'])
    await store.startLogStream(7, 'abc123')
    runtime.callbacks.get('docker:logs')?.({
      serverID: 7,
      containerID: 'abc123',
      streamID: 'other-stream',
      line: 'late',
      timestamp: '',
    })
    expect(store.containerLogs(7, 'abc123')).not.toContain('late')
    for (let index = 0; index < 5002; index += 1) {
      runtime.callbacks.get('docker:logs')?.({
        serverID: 7,
        containerID: 'abc123',
        streamID: 'stream-1',
        line: `line-${index}`,
        timestamp: '',
      })
    }
    expect(store.containerLogs(7, 'abc123')).toHaveLength(5000)
    expect(store.containerLogs(7, 'abc123')[0]).toBe('line-2')
  })

  it('applies stats events only for the active watcher', async () => {
    const store = useDockerStore()
    store.subscribe()
    await store.startStatsWatch(7, 'abc123')
    runtime.callbacks.get('docker:stats')?.({
      serverID: 7,
      containerID: 'abc123',
      watchID: 'other-watch',
      stats: { ...stats, cpuPercent: 1 },
      timestamp: '',
    })
    expect(store.containerStats(7, 'abc123')).toBeNull()
    runtime.callbacks.get('docker:stats')?.({
      serverID: 7,
      containerID: 'abc123',
      watchID: 'watch-1',
      stats,
      timestamp: '',
    })
    expect(store.containerStats(7, 'abc123')?.cpuPercent).toBe(12.34)
  })

  it('stops log and stats watchers for only the selected server', async () => {
    const store = useDockerStore()
    store.activeLogStreams = {
      '7:abc123': 'stream-1',
      '8:xyz789': 'stream-2',
    }
    store.activeStatsWatchers = {
      '7:abc123': 'watch-1',
      '8:xyz789': 'watch-2',
    }
    await store.stopServerRuntime(7)
    expect(app().DockerStopLogStream).toHaveBeenCalledWith({ serverID: 7, streamID: 'stream-1' })
    expect(app().DockerStopStatsWatch).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })
    expect(store.activeLogStreams['7:abc123']).toBeUndefined()
    expect(store.activeLogStreams['8:xyz789']).toBe('stream-2')
    expect(store.activeStatsWatchers['7:abc123']).toBeUndefined()
    expect(store.activeStatsWatchers['8:xyz789']).toBe('watch-2')
  })

  it('accepts docker availability, container, and error events by server id', () => {
    const store = useDockerStore()
    store.subscribe()
    runtime.callbacks.get('docker:state')?.({
      serverID: 7,
      state: { serverID: 7, available: true, version: '27.3.1', error: '', lastRefreshAt: '', containers: [container] },
      timestamp: '',
    })
    runtime.callbacks.get('docker:containers')?.({
      serverID: 7,
      containers: [stoppedContainer],
      timestamp: '',
    })
    runtime.callbacks.get('docker:error')?.({
      serverID: 7,
      containerID: '',
      streamID: '',
      code: 'DOCKER_LIST_FAILED',
      message: 'Docker 操作失败。',
      timestamp: '',
    })
    expect(store.availability(7)?.available).toBe(true)
    expect(store.containers(7)[0].name).toBe('cache')
    expect(store.lastError?.message).toBe('Docker 操作失败。')
  })
  it('loads compose service detail through the typed backend boundary', async () => {
    const store = useDockerStore()
    const detail = await store.composeLoadServiceDetail(7, 'edge', 'web')
    expect(app().DockerComposeGetServiceDetail).toHaveBeenCalledWith({
      serverID: 7,
      projectName: 'edge',
      serviceName: 'web',
    })
    expect(detail.service).toBe('web')
    expect(store.composeServiceDetail(7, 'edge', 'web')?.image).toBe('nginx:alpine')
  })

  it('loads compose logs scoped by service and keeps project logs separate', async () => {
    const store = useDockerStore()
    const projectLogs = await store.composeLoadLogs(7, 'edge', 200)
    const serviceLogs = await store.composeLoadLogs(7, 'edge', 1000, 'web')
    expect(app().DockerComposeGetLogs).toHaveBeenCalledWith({
      serverID: 7,
      projectName: 'edge',
      tailLines: 200,
      serviceName: '',
    })
    expect(app().DockerComposeGetLogs).toHaveBeenCalledWith({
      serverID: 7,
      projectName: 'edge',
      tailLines: 1000,
      serviceName: 'web',
    })
    expect(projectLogs.output).toBe('project log\n')
    expect(serviceLogs.output).toBe('web log\n')
    expect(store.composeLogs(7, 'edge')?.output).toBe('project log\n')
    expect(store.composeLogs(7, 'edge', 'web')?.output).toBe('web log\n')
  })
})
