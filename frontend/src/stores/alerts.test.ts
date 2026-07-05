import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, MonitorSnapshot } from '../types'
import { defaultAlertSettings } from '../utils/alertSettings'
import { useAlertStore } from './alerts'

const apiMock = vi.hoisted(() => ({
  beginAlertSession: vi.fn(),
  listAlertHistory: vi.fn(),
  persistAlertHistoryEvent: vi.fn(),
  markAlertHistoryRead: vi.fn(),
  markAllAlertHistoryRead: vi.fn(),
  clearResolvedAlertHistory: vi.fn(),
}))

vi.mock('../api/backend', () => ({
  api: apiMock,
}))

const base = Date.parse('2026-06-23T01:00:00.000Z')

const connection: Connection = {
  id: 3,
  groupId: null,
  name: 'alert-server',
  host: '192.0.2.3',
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

function snapshot(at: number, cpuPercent: number): MonitorSnapshot {
  return {
    connectionId: 3,
    status: 'online',
    timestamp: new Date(at).toISOString(),
    latencyMillis: 0,
    latencyAvailable: true,
    cpuPercent,
    memoryTotal: 100,
    memoryAvailable: 50,
    memoryUsedPercent: 50,
    swapTotal: 0,
    swapFree: 0,
    diskTotal: 100,
    diskUsed: 50,
    diskUsedPercent: 50,
    mounts: [{ filesystem: '/dev/sda1', mountPath: '/', total: 100, used: 50, available: 50, usedPercent: 50 }],
    processes: [],
    processStatus: 'empty',
    processMessage: '',
    loadOne: null,
    loadFive: null,
    loadFifteen: null,
    uptimeSeconds: null,
    defaultInterface: 'eth0',
    downloadBytesPerSecond: null,
    uploadBytesPerSecond: null,
    osName: '',
    kernel: '',
    architecture: '',
    errors: [],
    errorCode: '',
    message: '',
    monitorActive: true,
  }
}

describe('alert store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const mock of Object.values(apiMock)) mock.mockReset()
    apiMock.beginAlertSession.mockResolvedValue(undefined)
    apiMock.listAlertHistory.mockResolvedValue([])
    apiMock.persistAlertHistoryEvent.mockResolvedValue({ prunedCount: 0 })
    apiMock.markAlertHistoryRead.mockResolvedValue(undefined)
    apiMock.markAllAlertHistoryRead.mockResolvedValue(undefined)
    apiMock.clearResolvedAlertHistory.mockResolvedValue(undefined)
  })

  it('loads persisted alert history during initialization', async () => {
    const store = useAlertStore()
    apiMock.listAlertHistory.mockResolvedValueOnce([{
      eventID: 'persisted-1',
      serverID: 3,
      serverName: 'alert-server',
      ruleType: 'cpu_high',
      severity: 'warning',
      state: 'resolved',
      title: 'CPU 使用率已恢复',
      message: 'CPU 已恢复。',
      startedAt: new Date(base).toISOString(),
      resolvedAt: new Date(base + 1000).toISOString(),
      read: true,
      muted: false,
      source: 'monitor',
      sessionID: 'old-session',
    }])

    await store.initialize(defaultAlertSettings())

    expect(apiMock.beginAlertSession).toHaveBeenCalledWith(store.sessionID, 500)
    expect(apiMock.listAlertHistory).toHaveBeenCalledWith(500)
    expect(store.resolvedEvents).toHaveLength(1)
    expect(store.resolvedEvents[0].eventID).toBe('persisted-1')
    expect(store.persistenceWarning).toBe('')
  })

  it('stores active alerts and counts unread notifications by server', async () => {
    const settings = defaultAlertSettings()
    settings.cpu.durationSeconds = 15
    const store = useAlertStore()
    store.configure(settings)

    expect(store.ingestSnapshot(snapshot(base, 95), connection, base)).toHaveLength(0)
    store.ingestSnapshot(snapshot(base + 5000, 95), connection, base + 5000)
    store.ingestSnapshot(snapshot(base + 10000, 95), connection, base + 10000)
    const notifications = store.ingestSnapshot(snapshot(base + 15000, 95), connection, base + 15000)
    expect(notifications).toHaveLength(1)
    expect(store.activeEvents).toHaveLength(1)
    expect(store.unreadCount).toBe(1)
    expect(store.activeCountsByServerId[3]).toBe(1)
    expect(apiMock.persistAlertHistoryEvent).toHaveBeenCalledTimes(1)
    expect(apiMock.persistAlertHistoryEvent.mock.calls[0][0].serverID).toBe(3)
    expect(apiMock.persistAlertHistoryEvent.mock.calls[0][1]).toBe(500)

    store.markRead(store.activeEvents[0].eventID)
    await Promise.resolve()
    expect(store.unreadCount).toBe(0)
    expect(apiMock.markAlertHistoryRead).toHaveBeenCalledWith(store.activeEvents[0].eventID)
  })

  it('mutes future notifications without hiding events', () => {
    const settings = defaultAlertSettings()
    settings.cpu.durationSeconds = 15
    const store = useAlertStore()
    store.configure(settings)
    store.muteServer(3, '30m', base)

    store.ingestSnapshot(snapshot(base, 95), connection, base)
    store.ingestSnapshot(snapshot(base + 5000, 95), connection, base + 5000)
    store.ingestSnapshot(snapshot(base + 10000, 95), connection, base + 10000)
    const notifications = store.ingestSnapshot(snapshot(base + 15000, 95), connection, base + 15000)
    expect(notifications).toHaveLength(0)
    expect(store.activeEvents).toHaveLength(1)
    expect(store.activeEvents[0].muted).toBe(true)
    expect(store.unreadCount).toBe(0)
  })

  it('creates a test alert and resolves it on tick', () => {
    const store = useAlertStore()
    const created = store.createTestAlert(base)
    expect(created).toHaveLength(1)
    expect(store.activeEvents[0].ruleType).toBe('test')

    const resolved = store.tick(base + 5001, {}, [])
    expect(resolved).toHaveLength(1)
    expect(store.activeEvents).toHaveLength(0)
    expect(store.resolvedEvents[0].ruleType).toBe('test')
    expect(apiMock.persistAlertHistoryEvent).not.toHaveBeenCalled()
  })

  it('marks all read and clears resolved history through persistence API', async () => {
    const store = useAlertStore()
    store.events.push({
      eventID: 'resolved-1',
      serverID: 3,
      serverName: 'alert-server',
      ruleType: 'memory_high',
      severity: 'warning',
      state: 'resolved',
      title: '内存使用率已恢复',
      message: '内存已恢复。',
      startedAt: new Date(base).toISOString(),
      resolvedAt: new Date(base + 1000).toISOString(),
      read: false,
      muted: false,
      source: 'monitor',
      sessionID: store.sessionID,
    })

    store.markAllRead()
    await Promise.resolve()
    expect(store.unreadCount).toBe(0)
    expect(apiMock.markAllAlertHistoryRead).toHaveBeenCalledTimes(1)

    store.clearResolved()
    await Promise.resolve()
    expect(store.resolvedEvents).toHaveLength(0)
    expect(apiMock.clearResolvedAlertHistory).toHaveBeenCalledTimes(1)
  })
})
