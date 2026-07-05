import { describe, expect, it } from 'vitest'
import type { Connection, ConnectionRuntimeState, MonitorSnapshot } from '../types'
import { defaultAlertSettings } from './alertSettings'
import { AlertEvaluator } from './alertEvaluator'

const base = Date.parse('2026-06-23T00:00:00.000Z')

const connection: Connection = {
  id: 7,
  groupId: null,
  name: 'server-7',
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

function snapshot(at: number, values: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    connectionId: 7,
    status: 'online',
    timestamp: new Date(at).toISOString(),
    latencyMillis: 18,
    latencyAvailable: true,
    cpuPercent: 20,
    memoryTotal: 1024,
    memoryAvailable: 512,
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
    osName: 'Debian',
    kernel: '',
    architecture: '',
    errors: [],
    errorCode: '',
    message: '',
    monitorActive: true,
    ...values,
  }
}

function state(at: number, status: ConnectionRuntimeState['status']): ConnectionRuntimeState {
  return {
    connectionId: 7,
    status,
    monitorActive: status === 'online',
    terminalActive: status === 'online',
    terminalConnecting: false,
    sftpActive: false,
    connecting: false,
    hasActiveSession: status === 'online',
    updatedAt: new Date(at).toISOString(),
  }
}

describe('AlertEvaluator', () => {
  it('requires sustained CPU usage and recovers only below hysteresis for 20 seconds', () => {
    const settings = defaultAlertSettings()
    settings.cpu.durationSeconds = 15
    const evaluator = new AlertEvaluator(settings)

    expect(evaluator.ingestSnapshot(snapshot(base, { cpuPercent: 95 }), connection, base)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 5000, { cpuPercent: 95 }), connection, base + 5000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 10000, { cpuPercent: 95 }), connection, base + 10000)).toHaveLength(0)
    const firing = evaluator.ingestSnapshot(snapshot(base + 15000, { cpuPercent: 95 }), connection, base + 15000)
    expect(firing).toHaveLength(1)
    expect(firing[0].event.ruleType).toBe('cpu_high')
    expect(firing[0].kind).toBe('firing')

    expect(evaluator.ingestSnapshot(snapshot(base + 20000, { cpuPercent: 89 }), connection, base + 20000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 25000, { cpuPercent: 84 }), connection, base + 25000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 30000, { cpuPercent: 84 }), connection, base + 30000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 35000, { cpuPercent: 84 }), connection, base + 35000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 40000, { cpuPercent: 84 }), connection, base + 40000)).toHaveLength(0)
    const resolved = evaluator.ingestSnapshot(snapshot(base + 45000, { cpuPercent: 84 }), connection, base + 45000)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].kind).toBe('resolved')
    expect(resolved[0].event.state).toBe('resolved')
  })

  it('does not trigger from stale samples or missing root mount data', () => {
    const settings = defaultAlertSettings()
    settings.rootDisk.durationSeconds = 15
    const evaluator = new AlertEvaluator(settings)

    expect(evaluator.ingestSnapshot(snapshot(base, { cpuPercent: 99 }), connection, base + 30000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 1000, { mounts: [], diskUsedPercent: 99 }), connection, base + 1000)).toHaveLength(0)
    expect(evaluator.ingestSnapshot(snapshot(base + 20000, { mounts: [], diskUsedPercent: 99 }), connection, base + 20000)).toHaveLength(0)
  })

  it('keeps latency disabled by default and treats zero latency as valid', () => {
    const evaluator = new AlertEvaluator(defaultAlertSettings())
    expect(evaluator.ingestSnapshot(snapshot(base, { latencyMillis: 900, latencyAvailable: true }), connection, base)).toHaveLength(0)

    const settings = defaultAlertSettings()
    settings.latency.enabled = true
    settings.latency.durationSeconds = 15
    const enabled = new AlertEvaluator(settings)
    expect(enabled.ingestSnapshot(snapshot(base, { latencyMillis: 0, latencyAvailable: true }), connection, base)).toHaveLength(0)
  })

  it('fires offline only after an unexpected disconnect grace period and then recovers stably', () => {
    const settings = defaultAlertSettings()
    settings.offline.graceSeconds = 5
    const evaluator = new AlertEvaluator(settings)

    expect(evaluator.ingestConnectionState(state(base, 'offline'), connection, base)).toHaveLength(0)
    expect(evaluator.ingestConnectionState(state(base + 1000, 'online'), connection, base + 1000)).toHaveLength(0)
    expect(evaluator.ingestConnectionState(state(base + 2000, 'disconnected'), connection, base + 2000)).toHaveLength(0)
    const firing = evaluator.tick(base + 8000, { 7: state(base + 8000, 'disconnected') }, [connection])
    expect(firing).toHaveLength(1)
    expect(firing[0].event.ruleType).toBe('server_offline')

    expect(evaluator.ingestConnectionState(state(base + 9000, 'online'), connection, base + 9000)).toHaveLength(0)
    const resolved = evaluator.tick(base + 20000, { 7: state(base + 20000, 'online') }, [connection])
    expect(resolved).toHaveLength(1)
    expect(resolved[0].kind).toBe('resolved')
  })

  it('suppresses expected user disconnects', () => {
    const settings = defaultAlertSettings()
    settings.offline.graceSeconds = 5
    const evaluator = new AlertEvaluator(settings)

    evaluator.ingestConnectionState(state(base, 'online'), connection, base)
    evaluator.markExpectedDisconnect(7, base + 1000)
    evaluator.ingestConnectionState(state(base + 1000, 'disconnected'), connection, base + 1000)
    expect(evaluator.tick(base + 10000, { 7: state(base + 10000, 'disconnected') }, [connection])).toHaveLength(0)
    expect(evaluator.tick(base + 60000, { 7: state(base + 60000, 'disconnected') }, [connection])).toHaveLength(0)
  })

  it('does not resolve active alerts when the global alert switch is disabled', () => {
    const settings = defaultAlertSettings()
    settings.cpu.durationSeconds = 15
    const evaluator = new AlertEvaluator(settings)

    evaluator.ingestSnapshot(snapshot(base, { cpuPercent: 95 }), connection, base)
    evaluator.ingestSnapshot(snapshot(base + 5000, { cpuPercent: 95 }), connection, base + 5000)
    evaluator.ingestSnapshot(snapshot(base + 10000, { cpuPercent: 95 }), connection, base + 10000)
    const firing = evaluator.ingestSnapshot(snapshot(base + 15000, { cpuPercent: 95 }), connection, base + 15000)
    expect(firing).toHaveLength(1)

    evaluator.configure({ ...settings, enabled: false })
    expect(evaluator.ingestSnapshot(snapshot(base + 20000, { cpuPercent: 20 }), connection, base + 20000)).toHaveLength(0)
  })

  it('does not send offline recovery when alerts are disabled after firing', () => {
    const settings = defaultAlertSettings()
    settings.offline.graceSeconds = 5
    const evaluator = new AlertEvaluator(settings)

    evaluator.ingestConnectionState(state(base, 'online'), connection, base)
    evaluator.ingestConnectionState(state(base + 1000, 'disconnected'), connection, base + 1000)
    expect(evaluator.tick(base + 7000, { 7: state(base + 7000, 'disconnected') }, [connection])).toHaveLength(1)

    evaluator.configure({ ...settings, enabled: false })
    expect(evaluator.tick(base + 20000, { 7: state(base + 20000, 'online') }, [connection])).toHaveLength(0)
  })
})
