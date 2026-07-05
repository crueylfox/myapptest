import { describe, expect, it } from 'vitest'
import type {
  Connection,
  ConnectionRuntimeState,
  DockerContainer,
  MonitorSnapshot,
  SFTPState,
  SFTPTransferState,
  TunnelRuntime,
} from '../types'
import { buildDashboardSummaries } from './multiServerDashboard'

function connection(values: Partial<Connection>): Connection {
  return {
    id: 1,
    groupId: null,
    name: 'server',
    host: '192.0.2.1',
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
    ...values,
  }
}

function state(connectionId: number, values: Partial<ConnectionRuntimeState> = {}): ConnectionRuntimeState {
  return {
    connectionId,
    status: 'offline',
    monitorActive: false,
    terminalActive: false,
    terminalConnecting: false,
    sftpActive: false,
    connecting: false,
    hasActiveSession: false,
    updatedAt: '',
    ...values,
  }
}

function snapshot(connectionId: number): MonitorSnapshot {
  return {
    connectionId,
    status: 'online',
    timestamp: '',
    latencyMillis: 42,
    latencyAvailable: true,
    cpuPercent: 12.5,
    memoryTotal: 100,
    memoryAvailable: 50,
    memoryUsedPercent: 50,
    swapTotal: 0,
    swapFree: 0,
    diskTotal: 100,
    diskUsed: 65,
    diskUsedPercent: 65,
    mounts: [],
    processes: [],
    processStatus: 'empty',
    processMessage: '',
    loadOne: null,
    loadFive: null,
    loadFifteen: null,
    uptimeSeconds: null,
    defaultInterface: 'eth0',
    downloadBytesPerSecond: 2048,
    uploadBytesPerSecond: 1024,
    osName: '',
    kernel: '',
    architecture: '',
    errors: [],
    errorCode: '',
    message: '',
    monitorActive: true,
  }
}

function sftp(connectionId: number, contextId: string): SFTPState {
  return {
    connectionId,
    contextId,
    status: 'online',
    active: true,
    currentPath: '/srv',
    message: 'SFTP 已连接',
    updatedAt: '',
  }
}

function transfer(connectionId: number, id: string, status: SFTPTransferState['status']): SFTPTransferState {
  return {
    id,
    connectionId,
    direction: 'download',
    localPath: '',
    remotePath: '/srv/file',
    fileName: id,
    totalBytes: 100,
    transferredBytes: 50,
    percent: 50,
    speedBytesPerSecond: 1024,
    status,
    errorMessage: '',
    startedAt: '',
    finishedAt: '',
  }
}

function tunnel(serverID: number, status: TunnelRuntime['status']): TunnelRuntime {
  return {
    tunnelID: `${serverID}-${status}`,
    serverID,
    profileID: serverID,
    name: 'web',
    type: 'local',
    status,
    bindHost: '127.0.0.1',
    bindPort: 8080,
    targetHost: '127.0.0.1',
    targetPort: 80,
    remoteBindHost: '',
    remoteBindPort: 0,
    requestedListen: '',
    actualListen: '',
    effectiveRemoteBindHost: '',
    effectiveListenAddrs: [],
    remoteListenExposure: 'unknown',
    remoteListenCheckStatus: 'unchecked',
    remoteListenWarning: '',
    testCommand: '',
    activeConnections: 0,
    bytesIn: 0,
    bytesOut: 0,
    startedAt: '',
    updatedAt: '',
    error: '',
  }
}

function container(serverID: number, id: string, state: DockerContainer['state']): DockerContainer {
  return {
    id,
    shortID: id,
    name: id,
    image: 'nginx',
    command: '',
    createdAt: '',
    status: state,
    state,
    ports: '',
    labels: '',
    size: '',
    serverID,
  }
}

describe('buildDashboardSummaries', () => {
  it('aggregates existing frontend state without exposing secrets', () => {
    const rows = buildDashboardSummaries({
      connections: [
        connection({ id: 1, groupId: 10, name: 'prod', host: '10.0.0.1', privateKeyPath: 'C:/secret/key' }),
        connection({ id: 2, name: 'idle', host: '10.0.0.2' }),
      ],
      groups: [{ id: 10, name: '生产' }],
      connectionState: (serverID) => serverID === 1
        ? state(serverID, { status: 'online', monitorActive: true, terminalActive: true, hasActiveSession: true })
        : state(serverID),
      snapshots: { 1: snapshot(1), 2: snapshot(2) },
      terminalSessionsByServerId: {
        1: [
          { sessionId: 'a', connectionId: 1, title: 'prod', status: 'online', code: '', message: '' },
          { sessionId: 'b', connectionId: 1, title: 'prod', status: 'online', code: '', message: '' },
        ],
      },
      sftpStatesByServerId: { 1: sftp(1, 'server:1') },
      sftpStatesByContextId: { 'session:a': sftp(1, 'session:a') },
      sftpTransfersByServerId: {
        1: [transfer(1, 'running', 'running'), transfer(1, 'done', 'completed')],
      },
      tunnelRuntimes: [tunnel(1, 'running'), tunnel(1, 'stopped')],
      dockerAvailabilityByServerId: {},
      dockerContainersByServerId: {
        1: [container(1, 'a', 'running'), container(1, 'b', 'exited')],
      },
      activeWorkspaceServerId: 1,
    })

    expect(rows[0]).toMatchObject({
      serverID: 1,
      name: 'prod',
      groupName: '生产',
      status: 'online',
      latencyMs: 42,
      cpuPercent: 12.5,
      memoryPercent: 50,
      networkRxRate: 2048,
      networkTxRate: 1024,
      diskUsagePercent: 65,
      terminalCount: 2,
      sftpConnectedCount: 2,
      transferActiveCount: 1,
      transferQueuedCount: 0,
      transferRunningCount: 1,
      transferCompletedCount: 1,
      tunnelRunningCount: 1,
      tunnelStoppedOrFailedCount: 1,
      dockerRunningContainers: 1,
      dockerStoppedContainers: 1,
      dockerTotalContainers: 2,
      dockerStatusLabel: '1/2',
      active: true,
    })
    expect(rows[0].transferPreview).toEqual([
      {
        id: 'running',
        name: 'running',
        directionLabel: '下载',
        statusLabel: '传输中',
        percent: 50,
      },
    ])
    expect(rows[0].tunnelPreview).toEqual([
      {
        id: '1-running',
        name: 'web',
        endpoint: '本地 127.0.0.1:8080 → 127.0.0.1:80',
        statusLabel: '运行中',
      },
      {
        id: '1-stopped',
        name: 'web',
        endpoint: '本地 127.0.0.1:8080 → 127.0.0.1:80',
        statusLabel: '已停止',
      },
    ])
    expect(JSON.stringify(rows)).not.toContain('C:/secret/key')
    expect(rows[1]).toMatchObject({
      serverID: 2,
      status: 'offline',
      cpuPercent: undefined,
      memoryPercent: undefined,
      networkRxRate: undefined,
      networkTxRate: undefined,
      diskUsagePercent: undefined,
      dockerAvailable: null,
      dockerRunningContainers: null,
      dockerStoppedContainers: null,
      dockerTotalContainers: null,
      dockerStatusLabel: '未检测',
    })
  })

  it('distinguishes Docker not detected, empty detected state, and unavailable state', () => {
    const rows = buildDashboardSummaries({
      connections: [
        connection({ id: 1, name: 'empty-docker' }),
        connection({ id: 2, name: 'unavailable-docker' }),
        connection({ id: 3, name: 'unknown-docker' }),
      ],
      groups: [],
      connectionState: (serverID) => state(serverID),
      snapshots: {},
      terminalSessionsByServerId: {},
      sftpStatesByServerId: {},
      sftpStatesByContextId: {},
      sftpTransfersByServerId: {},
      tunnelRuntimes: [],
      dockerAvailabilityByServerId: {
        2: {
          serverID: 2,
          available: false,
          version: '',
          error: 'docker not found',
          lastRefreshAt: '',
          containers: [],
        },
      },
      dockerContainersByServerId: {
        1: [],
      },
      activeWorkspaceServerId: null,
    })

    expect(rows[0]).toMatchObject({
      dockerAvailable: true,
      dockerRunningContainers: 0,
      dockerStoppedContainers: 0,
      dockerTotalContainers: 0,
      dockerStatusLabel: '0/0',
    })
    expect(rows[1]).toMatchObject({
      dockerAvailable: false,
      dockerRunningContainers: null,
      dockerStoppedContainers: null,
      dockerTotalContainers: null,
      dockerStatusLabel: '不可用',
    })
    expect(rows[2]).toMatchObject({
      dockerAvailable: null,
      dockerRunningContainers: null,
      dockerStoppedContainers: null,
      dockerTotalContainers: null,
      dockerStatusLabel: '未检测',
    })
  })

  it('uses connection state for errors and ignores stale online monitor snapshots', () => {
    const rows = buildDashboardSummaries({
      connections: [connection({ id: 3, name: 'bad' })],
      groups: [],
      connectionState: (serverID) => state(serverID, {
        status: 'timeout',
        lastError: {
          code: 'TIMEOUT',
          userMessage: '连接超时',
          technicalMessage: 'dial timeout',
          retryable: true,
          serverId: serverID,
          operation: 'connect',
          timestamp: '',
        },
      }),
      snapshots: { 3: snapshot(3) },
      terminalSessionsByServerId: {},
      sftpStatesByServerId: {},
      sftpStatesByContextId: {},
      sftpTransfersByServerId: {},
      tunnelRuntimes: [],
      dockerAvailabilityByServerId: {},
      dockerContainersByServerId: {},
      activeWorkspaceServerId: null,
    })

    expect(rows[0]).toMatchObject({
      status: 'error',
      lastError: '连接超时',
      cpuPercent: undefined,
      memoryPercent: undefined,
    })
  })

  it('does not let stale runtime flags revive an explicitly disconnected server', () => {
    const rows = buildDashboardSummaries({
      connections: [connection({ id: 4, name: 'stopped' })],
      groups: [],
      connectionState: (serverID) => state(serverID, {
        status: 'disconnected',
        monitorActive: true,
        terminalActive: true,
        sftpActive: true,
        hasActiveSession: true,
      }),
      snapshots: { 4: snapshot(4) },
      terminalSessionsByServerId: {},
      sftpStatesByServerId: {},
      sftpStatesByContextId: {},
      sftpTransfersByServerId: {},
      tunnelRuntimes: [],
      dockerAvailabilityByServerId: {},
      dockerContainersByServerId: {},
      activeWorkspaceServerId: null,
    })

    expect(rows[0]).toMatchObject({
      status: 'offline',
      latencyMs: undefined,
      cpuPercent: undefined,
      memoryPercent: undefined,
      networkRxRate: undefined,
      networkTxRate: undefined,
      diskUsagePercent: undefined,
    })
  })
})
