// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentPublicInstance } from 'vue'
import { useServerStore } from '../stores/server'
import type { Connection, MonitorSnapshot, NetworkEndpointSnapshot, NetworkInterface } from '../types'
import NetworkDetailsDialog from './NetworkDetailsDialog.vue'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads the local CSS source.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: string, encoding: string) => string }
// @ts-expect-error The app tsconfig intentionally omits Node globals; this test resolves a local CSS source path.
const { resolve } = await import('node:path') as { resolve: (...parts: string[]) => string }
const styleSource = readFileSync(resolve('src/style.css'), 'utf8')

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

const connection: Connection = {
  id: 1,
  groupId: null,
  name: 'debian',
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
}

const snapshot: MonitorSnapshot = {
  connectionId: 1,
  status: 'online',
  timestamp: '2026-06-22T00:00:00Z',
  monitorActive: true,
  latencyAvailable: true,
  latencyMillis: 12,
  cpuPercent: 10,
  memoryUsedPercent: 20,
  memoryTotal: 100,
  memoryAvailable: 80,
  swapTotal: 0,
  swapFree: 0,
  diskTotal: 100,
  diskUsed: 30,
  diskUsedPercent: 30,
  uptimeSeconds: 100,
  osName: 'Debian',
  kernel: '6.1',
  architecture: 'x86_64',
  loadOne: 0.1,
  loadFive: 0.2,
  loadFifteen: 0.3,
  downloadBytesPerSecond: 1024,
  uploadBytesPerSecond: 2048,
  defaultInterface: 'eth0',
  effectiveNetworkInterface: 'eth0',
  networkInterfaceMode: 'interface',
  selectedNetworkInterface: 'eth0',
  networkInterfaceUserSelected: true,
  networkInterfaceFallback: false,
  networkInterfaceMessage: '',
  processes: [],
  processStatus: 'available',
  processMessage: '',
  mounts: [],
  errors: [],
  errorCode: '',
  message: '',
} as MonitorSnapshot

function networkInterface(values: Partial<NetworkInterface> = {}): NetworkInterface {
  return {
    serverID: 1,
    name: 'eth0',
    displayName: 'eth0',
    isUp: true,
    isLoopback: false,
    ipv4: ['192.0.2.10'],
    ipv6: [],
    rxBytes: 100,
    txBytes: 200,
    lastUpdatedAt: '2026-06-22T00:00:00Z',
    ...values,
  }
}

function endpointSnapshot(overrides: Partial<NetworkEndpointSnapshot> = {}): NetworkEndpointSnapshot {
  return {
    serverID: 1,
    contextID: 'ctx-1',
    strategy: 'ss',
    listenersAvailable: true,
    connectionsAvailable: true,
    processInfoAvailable: true,
    permissionLimited: false,
    byteCountersAvailable: false,
    byteCountersPartial: false,
    totalListeners: 3,
    totalConnections: 2,
    uniqueRemoteIPs: 2,
    socketConnectionCount: 2,
    socketRemoteIPCount: 2,
    dockerSocketConnectionCount: null,
    dockerRemoteIPCount: null,
    conntrackConnectionCount: null,
    conntrackRemoteIPCount: null,
    conntrackAvailable: false,
    conntrackSource: '',
    aggregated: false,
    rawConnectionCountBeforeLimit: 2,
    returnedRowCount: 3,
    rowLimit: 500,
    socketUploadBytesKnownCount: 2,
    socketUploadBytesEstimatedCount: 0,
    socketDownloadBytesKnownCount: 2,
    socketCounterMissingCount: 1,
    collectedAt: '2026-06-22T00:00:00Z',
    warnings: [],
    listeners: [
      {
        rowID: 'ssh',
        serverID: 1,
        protocol: 'tcp',
        family: 'ipv4',
        listenAddress: '0.0.0.0',
        listenPort: 22,
        pid: 10,
        pidLabel: '10',
        processName: 'sshd',
        uniqueRemoteIPCount: 1,
        connectionCount: 1,
        uploadedBytes: 100,
        uploadedBytesEstimate: null,
        uploadedBytesEstimated: false,
        downloadedBytes: 50,
        aggregatedProcessCount: null,
        connectionDataAvailable: true,
        byteCountersAvailable: true,
        byteCountersPartial: false,
        permissionLimited: false,
        aggregationApproximate: false,
        hasListener: true,
        hasActiveConnections: true,
        rowKind: 'listener-and-connection',
        state: 'connected',
        lastUpdatedAt: '2026-06-22T00:00:00Z',
      },
      {
        rowID: 'dns',
        serverID: 1,
        protocol: 'udp',
        family: 'ipv4',
        listenAddress: '127.0.0.53',
        listenPort: 53,
        pid: null,
        pidLabel: '',
        processName: '',
        uniqueRemoteIPCount: 0,
        connectionCount: 0,
        uploadedBytes: null,
        uploadedBytesEstimate: null,
        uploadedBytesEstimated: false,
        downloadedBytes: null,
        aggregatedProcessCount: null,
        connectionDataAvailable: true,
        byteCountersAvailable: false,
        byteCountersPartial: false,
        permissionLimited: true,
        aggregationApproximate: false,
        hasListener: true,
        hasActiveConnections: false,
        rowKind: 'listener',
        state: 'listening',
        lastUpdatedAt: '2026-06-22T00:00:00Z',
      },
      {
        rowID: 'nginx',
        serverID: 1,
        protocol: 'tcp6',
        family: 'ipv6',
        listenAddress: '::',
        listenPort: 443,
        pid: 20,
        pidLabel: '20',
        processName: 'nginx',
        uniqueRemoteIPCount: 1,
        connectionCount: 1,
        uploadedBytes: null,
        uploadedBytesEstimate: null,
        uploadedBytesEstimated: false,
        downloadedBytes: null,
        aggregatedProcessCount: null,
        connectionDataAvailable: true,
        byteCountersAvailable: false,
        byteCountersPartial: false,
        permissionLimited: false,
        aggregationApproximate: true,
        hasListener: true,
        hasActiveConnections: true,
        rowKind: 'listener-and-connection',
        state: 'connected',
        lastUpdatedAt: '2026-06-22T00:00:00Z',
      },
    ],
    ...overrides,
  }
}

function installBackend() {
  window.go = {
    main: {
      App: {
        GetMonitorNetworkInterface: vi.fn(async (serverID: number) => ({
          serverID,
          mode: 'interface',
          selectedNetworkInterface: 'eth0',
          userSelected: true,
          updatedAt: '2026-06-22T00:00:00Z',
        })),
        SetMonitorNetworkInterface: vi.fn(async (request: {
          serverID: number
          mode: 'all' | 'interface'
          selectedNetworkInterface: string
          userSelected: boolean
        }) => ({
          serverID: request.serverID,
          mode: request.mode,
          selectedNetworkInterface: request.selectedNetworkInterface,
          userSelected: request.userSelected,
          updatedAt: '2026-06-22T00:00:00Z',
        })),
        ListNetworkInterfaces: vi.fn(async (request: { serverID: number }) => ({
          serverID: request.serverID,
          interfaces: [networkInterface(), networkInterface({ name: 'ens18', displayName: 'ens18' })],
          updatedAt: '2026-06-22T00:00:00Z',
          recommendedInterface: 'eth0',
          recommendedInterfaceReason: 'default_route',
        })),
        OpenNetworkInspectionContext: vi.fn(async (request: { serverID: number }) => ({
          serverID: request.serverID,
          contextID: 'ctx-1',
          openedAt: '2026-06-22T00:00:00Z',
        })),
        GetNetworkEndpointSnapshot: vi.fn(async () => endpointSnapshot()),
        CloseNetworkInspectionContext: vi.fn(async () => undefined),
        ListNetworkDiagnosticTasks: vi.fn(async () => []),
        StartNetworkDiagnostic: vi.fn(async () => ({
          taskID: 'task-1',
          serverID: 1,
          type: 'ping',
          target: '8.8.8.8',
          status: 'running',
          startedAt: '2026-06-22T00:00:00Z',
        })),
        CancelNetworkDiagnostic: vi.fn(async () => undefined),
      } as never,
    },
  }
}

function setupStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useServerStore(pinia)
  store.connections = [connection]
  store.states[1] = {
    connectionId: 1,
    status: 'online',
    monitorActive: true,
    terminalActive: true,
    terminalConnecting: false,
    sftpActive: false,
    connecting: false,
    hasActiveSession: true,
    updatedAt: '2026-06-22T00:00:00Z',
  }
  store.snapshots[1] = snapshot
  store.histories[1] = [snapshot]
  return pinia
}

async function render(props: Partial<InstanceType<typeof NetworkDetailsDialog>['$props']> = {}) {
  const pinia = setupStore()
  const wrapper = mount(NetworkDetailsDialog, {
    props: {
      open: true,
      connections: [connection],
      activeServerId: 1,
      initialTab: 'endpoints',
      ...props,
    },
    global: {
      plugins: [pinia],
      stubs: {
        MiniSparkline: { template: '<div class="mini-sparkline-stub" />' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

function buttonByText(wrapper: VueWrapper<ComponentPublicInstance>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('NetworkDetailsDialog', () => {
  beforeEach(() => {
    installBackend()
  })

  it('opens endpoint inspection by default and renders endpoint connection rows', async () => {
    const wrapper = await render()

    const dialogText = wrapper.get('[data-testid="network-details-dialog"]').text()
    expect(dialogText).toContain('端口与连接')
    expect(dialogText).toContain('当前接口')
    expect(dialogText).toContain('当前连接')
    expect(dialogText).toContain('远程 IP')
    expect(dialogText).toContain('Docker 连接')
    expect(dialogText).not.toContain('宿主Socket')
    expect(dialogText).not.toContain('Conntrack')
    expect(wrapper.find('[data-testid="network-diagnostics-panel"]').exists()).toBe(false)
    expect(window.go?.main?.App?.OpenNetworkInspectionContext).toHaveBeenCalledWith({ serverID: 1 })
    const snapshotCalls = vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mock.calls
    expect(snapshotCalls[0][0]).toEqual({
      serverID: 1,
      contextID: 'ctx-1',
      interfaceName: '',
      scope: 'host',
    })
    expect(snapshotCalls[1][0]).toEqual({
      serverID: 1,
      contextID: 'ctx-1',
      interfaceName: '',
      scope: 'full',
    })
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('sshd')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('nginx')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('宿主机')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('权限受限')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('IP 数')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('连接数')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('累计上传')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('累计下载')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('100 B')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('50 B')
  })

  it('renders host rows before the docker namespace follow-up resolves', async () => {
    const fullSnapshot = deferred<NetworkEndpointSnapshot>()
    const dockerRow = {
      rowID: 'docker-speedtest',
      serverID: 1,
      protocol: 'tcp',
      family: 'ipv4',
      listenAddress: '0.0.0.0',
      listenPort: 8080,
      pid: 31,
      pidLabel: '31',
      processName: 'speedtest',
      sourceType: 'docker',
      sourceName: 'speedtest-box',
      containerID: 'abc123456789',
      containerName: 'speedtest-box',
      uniqueRemoteIPCount: 5,
      connectionCount: 8,
      uploadedBytes: 2048,
      uploadedBytesEstimate: null,
      uploadedBytesEstimated: false,
      downloadedBytes: 4096,
      aggregatedProcessCount: null,
      connectionDataAvailable: true,
      byteCountersAvailable: true,
      byteCountersPartial: false,
      permissionLimited: false,
      aggregationApproximate: false,
      hasListener: true,
      hasActiveConnections: true,
      rowKind: 'listener-and-connection',
      state: 'connected',
      lastUpdatedAt: '2026-06-22T00:00:00Z',
    } as NetworkEndpointSnapshot['listeners'][number]
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockImplementation(async (request: { scope?: string }) => {
      if (request.scope === 'host') {
        return endpointSnapshot({
          dockerAvailable: false,
          dockerSocketConnectionCount: null,
          listeners: [endpointSnapshot().listeners[0]],
          returnedRowCount: 1,
        })
      }
      return fullSnapshot.promise
    })

    const wrapper = await render()

    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('sshd')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).not.toContain('speedtest-box')
    expect(wrapper.get('[data-testid="network-details-warning"]').text()).toContain('Docker')
    expect(vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mock.calls.map((call) => call[0].scope)).toEqual(['host', 'full'])

    fullSnapshot.resolve(endpointSnapshot({
      dockerAvailable: true,
      dockerNamespaceAvailable: true,
      dockerSocketConnectionCount: 8,
      listeners: [endpointSnapshot().listeners[0], dockerRow],
      returnedRowCount: 2,
    }))
    await flushPromises()

    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('Docker: speedtest-box')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('8080')
  })

  it('renders network details controls in a single commandbar', async () => {
    const wrapper = await render()
    const commandbar = wrapper.get('.network-details-commandbar')
    const tabs = commandbar.get('.network-details-tabs')

    expect(commandbar.text()).toContain('网络详情')
    expect(commandbar.text()).toContain('服务器')
    expect(commandbar.text()).toContain('接口')
    expect(commandbar.text()).toContain('端口与连接')
    expect(commandbar.text()).toContain('网络诊断')
    expect(commandbar.text()).toContain('刷新')
    expect(commandbar.text()).toContain('实时刷新')
    expect(commandbar.text()).toContain('关闭')
    expect(commandbar.find('.network-details-server-select').exists()).toBe(true)
    expect(commandbar.find('.network-details-interface-select').exists()).toBe(true)
    expect(commandbar.find('.network-details-tabs').exists()).toBe(true)
    expect(tabs.findAll('.command-light-action')).toHaveLength(2)
    expect(tabs.findAll('.command-action-separator').map((item) => item.text())).toEqual(['|'])
    expect(styleSource).toContain('.network-details-tabs .command-light-action { min-height: 30px; font-size: 14px;')
    expect(wrapper.find('.network-details-header').exists()).toBe(false)
    expect(wrapper.find('.network-details-toolbar').exists()).toBe(false)
  })

  it('renders endpoint table headers with only the active sort arrow, one separator source, and column resize handles', async () => {
    const wrapper = await render()
    const table = wrapper.get('[data-testid="network-endpoint-table"]')
    const headers = table.findAll('.network-endpoint-head-cell')
    const headerButtons = table.find('.network-endpoint-head').findAll('button')

    expect(headers.length).toBeGreaterThan(0)
    expect(headers[0].text()).toContain('PID')
    expect(headers[0].find('.table-sort-arrow').text()).toBe('')
    expect(headers[5].find('.table-sort-arrow').text()).toBe('↑')
    expect(headers[7].text()).toContain('连接数')
    expect(headerButtons[7].text()).toBe('连接数')
    expect((table.find('.network-endpoint-head').element as HTMLElement).style.gridTemplateColumns.split(' ')[7]).toBe('88px')
    expect(table.findAll('[data-testid^="network-endpoint-column-resizer-"]')).toHaveLength(headers.length - 1)
    expect(styleSource).not.toContain('border-left: 1px solid rgba(148, 163, 184, .18)')
    expect(styleSource).toContain('.table-column-resizer::before')
    expect(styleSource).toContain('justify-content: center')
    expect(styleSource).toContain('text-align: center')

    const before = (table.find('.network-endpoint-row').element as HTMLElement).style.gridTemplateColumns
    await table.get('[data-testid="network-endpoint-column-resizer-0"]').trigger('mousedown', { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 132 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()
    const after = (table.find('.network-endpoint-row').element as HTMLElement).style.gridTemplateColumns
    expect(after).not.toBe(before)
  })

  it('renders docker listener source rows and source filters', async () => {
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockResolvedValue(endpointSnapshot({
      dockerAvailable: true,
      dockerNamespaceAvailable: true,
      listenerCount: 1,
      listeners: [
        {
          rowID: 'docker-speedtest',
          serverID: 1,
          protocol: 'tcp',
          family: 'ipv4',
          listenAddress: '0.0.0.0',
          listenPort: 8080,
          pid: 31,
          pidLabel: '31',
          processName: 'speedtest',
          sourceType: 'docker',
          sourceName: 'speedtest-box',
          containerID: 'abc123456789',
          containerName: 'speedtest-box',
          uniqueRemoteIPCount: null,
          connectionCount: null,
          uploadedBytes: null,
          uploadedBytesEstimate: null,
          uploadedBytesEstimated: false,
          downloadedBytes: null,
          aggregatedProcessCount: null,
          connectionDataAvailable: false,
          byteCountersAvailable: false,
          byteCountersPartial: false,
          permissionLimited: false,
          aggregationApproximate: false,
          hasListener: true,
          hasActiveConnections: false,
          rowKind: 'listener',
          state: 'listening',
          lastUpdatedAt: '2026-06-22T00:00:00Z',
        },
      ],
    }))

    const wrapper = await render()
    const dialogText = wrapper.get('[data-testid="network-details-dialog"]').text()
    expect(dialogText).toContain('Docker 连接')
    expect(dialogText).toContain('远程 IP')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('Docker: speedtest-box')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('8080')

    await wrapper.get('.network-details-filters input').setValue('speedtest-box')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('speedtest')
    await wrapper.get('.network-details-filters input').setValue('')
    await wrapper.findAll('.network-details-filters select')[2].setValue('host')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).not.toContain('speedtest')
    await wrapper.findAll('.network-details-filters select')[2].setValue('docker')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('speedtest')
  })

  it('filters endpoint rows without issuing a remote request', async () => {
    const wrapper = await render()
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockClear()

    await wrapper.get('.network-details-filters input').setValue('nginx')

    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('nginx')
    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).not.toContain('sshd')
    expect(window.go?.main?.App?.GetNetworkEndpointSnapshot).not.toHaveBeenCalled()
  })

  it('renders active connection metric columns', async () => {
    const wrapper = await render()

    const table = wrapper.get('[data-testid="network-endpoint-table"]')
    const headerButtons = table.find('.network-endpoint-head').findAll('button').map((item) => item.text())
    expect(headerButtons).toEqual(['PID', '程序', '来源', '协议', '监听 IP', '端口↑', 'IP 数', '连接数', '累计上传', '累计下载'])
    expect(table.text()).toContain('IP 数')
    expect(table.text()).toContain('连接数')
    expect(table.text()).toContain('累计上传')
    expect(table.text()).toContain('累计下载')
  })

  it('renders unavailable active metrics as dashes without Conntrack', async () => {
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockResolvedValue(endpointSnapshot({
      connectionsAvailable: false,
      byteCountersAvailable: false,
      totalConnections: null,
      uniqueRemoteIPs: null,
      socketConnectionCount: null,
      socketRemoteIPCount: null,
      conntrackAvailable: false,
      conntrackConnectionCount: null,
      conntrackRemoteIPCount: null,
      warnings: ['已读取监听端口，但活动连接读取失败。'],
      listeners: [
        {
          ...endpointSnapshot().listeners[0],
          uniqueRemoteIPCount: null,
          connectionCount: null,
          uploadedBytes: null,
          uploadedBytesEstimate: null,
          uploadedBytesEstimated: false,
          downloadedBytes: null,
          connectionDataAvailable: false,
          byteCountersAvailable: false,
          hasActiveConnections: false,
          rowKind: 'listener',
          state: 'listening',
        },
      ],
    }))

    const wrapper = await render()
    const dialogText = wrapper.get('[data-testid="network-details-dialog"]').text()

    expect(dialogText).not.toContain('宿主Socket')
    expect(dialogText).toContain('Docker 连接—')
    expect(dialogText).toContain('远程 IP—')
    expect(dialogText).not.toContain('Conntrack')
    expect(wrapper.find('[data-testid="network-details-warning"]').text()).toContain('活动连接读取失败')
  })

  it('renders dash when cumulative upload or download bytes are unavailable', async () => {
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockResolvedValue(endpointSnapshot({
      returnedRowCount: 1,
      rowLimit: 500,
      warnings: [],
      listeners: [
        {
          rowID: 'listener',
          serverID: 1,
          protocol: 'tcp',
          family: 'ipv4',
          listenAddress: '0.0.0.0',
          listenPort: 9100,
          pid: null,
          pidLabel: '—',
          processName: 'th_ecmanager',
          uniqueRemoteIPCount: null,
          connectionCount: null,
          uploadedBytes: null,
          uploadedBytesEstimate: null,
          uploadedBytesEstimated: false,
          downloadedBytes: null,
          aggregatedProcessCount: null,
          connectionDataAvailable: false,
          byteCountersAvailable: false,
          byteCountersPartial: false,
          permissionLimited: false,
          aggregationApproximate: false,
          hasListener: true,
          hasActiveConnections: false,
          rowKind: 'listener',
          state: 'listening',
          lastUpdatedAt: '2026-06-22T00:00:00Z',
        },
      ],
    }))
    const wrapper = await render()
    const row = wrapper.get('.row-kind-listener')

    expect(row.text()).toContain('th_ecmanager')
    expect(row.text()).toContain('9100')
    expect(row.text()).not.toContain('bytes_acked')
    expect(row.find('.upload').text()).toBe('—')
    expect(row.find('.download').text()).toBe('—')
  })

  it('renders estimated cumulative upload when only bytes_acked is available', async () => {
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockResolvedValue(endpointSnapshot({
      returnedRowCount: 1,
      rowLimit: 500,
      warnings: ['部分累计上传使用 bytes_acked 近似值。'],
      listeners: [
        {
          ...endpointSnapshot().listeners[0],
          uploadedBytes: null,
          uploadedBytesEstimate: 2048,
          uploadedBytesEstimated: true,
          downloadedBytes: 4096,
          byteCountersAvailable: true,
          byteCountersPartial: false,
        },
      ],
    }))
    const wrapper = await render()
    const row = wrapper.get('.row-kind-listener-and-connection')

    expect(row.find('.upload').text()).toBe('≈ 2.00 KB')
    expect(row.find('.upload').attributes('title')).toContain('bytes_acked')
    expect(row.find('.download').text()).toBe('4.00 KB')
    expect(wrapper.get('[data-testid="network-details-warning"]').text()).toContain('近似值')
  })

  it('keeps the last successful table when a full refresh fails', async () => {
    const wrapper = await render()
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockRejectedValue(new Error('读取网络信息失败'))

    await buttonByText(wrapper, '刷新').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="network-endpoint-table"]').text()).toContain('sshd')
    expect(wrapper.get('[data-testid="network-details-warning"]').text()).toContain('当前显示的是上次成功数据')
  })

  it('does not refresh endpoint inspection when the interface changes', async () => {
    const wrapper = await render()
    vi.mocked(window.go!.main!.App!.GetNetworkEndpointSnapshot).mockClear()

    await wrapper.get('.network-details-interface-field select').setValue('ens18')
    await flushPromises()

    expect(window.go?.main?.App?.SetMonitorNetworkInterface).toHaveBeenCalledWith({
      serverID: 1,
      mode: 'interface',
      selectedNetworkInterface: 'ens18',
      userSelected: true,
    })
    expect(window.go?.main?.App?.GetNetworkEndpointSnapshot).not.toHaveBeenCalled()
  })

  it('embeds network diagnostics as an internal tab', async () => {
    const wrapper = await render()

    await buttonByText(wrapper, '网络诊断').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="network-diagnostics-panel"]').exists()).toBe(true)
    expect(window.go?.main?.App?.ListNetworkDiagnosticTasks).toHaveBeenCalledWith(1)
  })

  it('uses a compact diagnostics commandbar and only shows port for TCP', async () => {
    const wrapper = await render()

    await buttonByText(wrapper, '网络诊断').trigger('click')
    await flushPromises()

    const panel = wrapper.get('[data-testid="network-diagnostics-panel"]')
    const commandbar = panel.get('.network-diagnostics-commandbar')
    const types = commandbar.get('.network-diagnostics-types')
    expect(commandbar.text()).toContain('Ping')
    expect(commandbar.text()).toContain('Traceroute')
    expect(commandbar.text()).toContain('DNS')
    expect(commandbar.text()).toContain('TCP')
    expect(commandbar.text()).toContain('目标')
    expect(commandbar.text()).toContain('开始')
    expect(commandbar.text()).toContain('取消')
    expect(commandbar.text()).toContain('清空')
    expect(commandbar.text()).toContain('复制')
    expect(commandbar.text()).toContain('暂无任务')
    expect(types.findAll('.command-light-action')).toHaveLength(4)
    expect(types.findAll('.command-action-separator').map((item) => item.text())).toEqual(['|', '|', '|'])
    expect(styleSource).toContain('.network-diagnostics-commandbar .network-diagnostics-types .command-light-action {')
    expect(styleSource).toContain('border: 0;')
    expect(styleSource).toContain('.network-diagnostics-commandbar .network-diagnostics-types .command-light-action.active {')
    expect(styleSource).toContain('border-color: transparent;')
    expect(panel.find('.network-diagnostics-port').exists()).toBe(false)

    await buttonByText(wrapper, 'TCP').trigger('click')

    expect(panel.find('.network-diagnostics-port').exists()).toBe(true)
  })

  it('closes the network inspection context', async () => {
    const wrapper = await render()

    await buttonByText(wrapper, '关闭').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('close')).toEqual([[]])
    expect(window.go?.main?.App?.CloseNetworkInspectionContext).toHaveBeenCalledWith({
      serverID: 1,
      contextID: 'ctx-1',
    })
  })
})
