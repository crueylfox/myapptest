// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { Connection, MonitorSnapshot } from '../types'
import type { DashboardServerSummary } from '../utils/multiServerDashboard'
import MultiServerDashboardDialog from './MultiServerDashboardDialog.vue'

const summaries: DashboardServerSummary[] = [
  {
    serverID: 1,
    name: 'prod-api',
    groupName: '生产',
    host: '10.0.0.1',
    port: 22,
    status: 'online',
    latencyMs: 42,
    cpuPercent: 12,
    memoryPercent: 41,
    networkRxRate: 1024,
    networkTxRate: 2048,
    diskUsagePercent: 65,
    terminalCount: 2,
    sftpConnectedCount: 1,
    transferActiveCount: 1,
    transferQueuedCount: 0,
    transferRunningCount: 1,
    transferFailedCount: 0,
    transferCompletedCount: 1,
    transferPreview: [
      { id: 'transfer-1', name: 'backup.tar', directionLabel: '下载', statusLabel: '传输中', percent: 50 },
    ],
    tunnelRunningCount: 3,
    tunnelStoppedOrFailedCount: 1,
    tunnelPreview: [
      { id: 'tunnel-1', name: 'web', endpoint: '本地 127.0.0.1:8080 → 127.0.0.1:80', statusLabel: '运行中' },
    ],
    dockerAvailable: true,
    dockerRunningContainers: 5,
    dockerStoppedContainers: 7,
    dockerTotalContainers: 12,
    dockerStatusLabel: '5/12',
    active: true,
  },
  {
    serverID: 2,
    name: 'staging-db',
    groupName: '测试',
    host: '10.0.0.2',
    port: 2222,
    status: 'offline',
    terminalCount: 0,
    sftpConnectedCount: 0,
    transferActiveCount: 0,
    transferQueuedCount: 0,
    transferRunningCount: 0,
    transferFailedCount: 0,
    transferCompletedCount: 0,
    transferPreview: [],
    tunnelRunningCount: 0,
    tunnelStoppedOrFailedCount: 0,
    tunnelPreview: [],
    dockerAvailable: null,
    dockerRunningContainers: null,
    dockerStoppedContainers: null,
    dockerTotalContainers: null,
    dockerStatusLabel: '未检测',
    active: false,
  },
  {
    serverID: 3,
    name: 'broken',
    groupName: '生产',
    host: '10.0.0.3',
    port: 22,
    status: 'error',
    terminalCount: 1,
    sftpConnectedCount: 0,
    transferActiveCount: 0,
    transferQueuedCount: 0,
    transferRunningCount: 0,
    transferFailedCount: 0,
    transferCompletedCount: 0,
    transferPreview: [],
    tunnelRunningCount: 0,
    tunnelStoppedOrFailedCount: 0,
    tunnelPreview: [],
    dockerAvailable: false,
    dockerRunningContainers: null,
    dockerStoppedContainers: null,
    dockerTotalContainers: null,
    dockerStatusLabel: '不可用',
    lastError: '连接超时',
    active: false,
  },
]

const connectionRemarks: Record<number, string> = {
  1: 'Zulu remark',
  3: 'Alpha remark',
}

const connections = summaries.map((summary) => ({
  id: summary.serverID,
  groupId: null,
  name: summary.name,
  host: summary.host,
  port: summary.port,
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
  description: connectionRemarks[summary.serverID] ?? '',
})) as Array<Connection & { description?: string }>

function snapshot(connectionId = 1): MonitorSnapshot {
  return {
    connectionId,
    status: 'online',
    timestamp: new Date('2026-06-20T00:00:00Z').toISOString(),
    latencyMillis: 42,
    latencyAvailable: true,
    cpuPercent: 12,
    memoryTotal: 8 * 1024 ** 3,
    memoryAvailable: 4 * 1024 ** 3,
    memoryUsedPercent: 50,
    swapTotal: 0,
    swapFree: 0,
    diskTotal: 80 * 1024 ** 3,
    diskUsed: 40 * 1024 ** 3,
    diskUsedPercent: 50,
    mounts: [],
    processes: [],
    processStatus: 'available',
    processMessage: '',
    loadOne: 0.1,
    loadFive: 0.2,
    loadFifteen: 0.3,
    uptimeSeconds: 3600,
    defaultInterface: 'eth0',
    downloadBytesPerSecond: 1024,
    uploadBytesPerSecond: 2048,
    osName: 'Ubuntu',
    kernel: '6.8.0',
    architecture: 'x86_64',
    errors: [],
    errorCode: '',
    message: '',
    monitorActive: true,
  }
}

function mountDialog(rows = summaries, propOverrides: Record<string, unknown> = {}) {
  return mount(MultiServerDashboardDialog, {
    props: {
      open: true,
      summaries: rows,
      connections: connections as Connection[],
      selectedServerId: 1,
      activeWorkspaceServerId: 1,
      snapshots: {
        1: snapshot(1),
        2: snapshot(2),
      },
      histories: {
        1: [snapshot(1)],
        2: [snapshot(2)],
      },
      initialTab: 'overview',
      initialServerId: null,
      batchOperation: null,
      dashboardSortMode: 'manual',
      dashboardManualServerOrder: [],
      ...propOverrides,
    },
    global: {
      stubs: {
        MonitorDashboard: {
          props: ['snapshot', 'history'],
          template: `
            <div class="monitor-dashboard-stub">
              <span data-testid="detail-snapshot">{{ snapshot ? snapshot.connectionId + ':' + snapshot.cpuPercent : 'empty' }}</span>
              <span data-testid="detail-history">{{ history.length }}</span>
            </div>
          `,
        },
      },
    },
  })
}

function buttonByText(wrapper: ReturnType<typeof mountDialog>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  if (!button) throw new Error(`Missing button: ${text}`)
  return button
}

function cardTexts(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.findAll('[data-testid="dashboard-server-card"]').map((card) => card.text())
}

async function dispatchCardClick(wrapper: ReturnType<typeof mountDialog>, index: number, detail = 1) {
  wrapper.findAll('[data-testid="dashboard-server-card"]')[index].element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail }),
  )
  await nextTick()
}

describe('MultiServerDashboardDialog', () => {
  it('opens as a monitor panel with overview and detail tabs and defaults to overview', () => {
    const wrapper = mountDialog()

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('监控面板')
    expect(wrapper.text()).toContain('监控面板')
    expect(wrapper.find('.dashboard-panel-header-actions .dashboard-panel-tabs').exists()).toBe(true)
    expect(wrapper.get('.dashboard-panel-header-actions .dashboard-panel-tabs').findAll('.command-light-action').map((button) => button.text())).toEqual(['服务器总览', '详细监控'])
    expect(wrapper.get('.dashboard-panel-header-actions .dashboard-panel-tabs').findAll('.command-action-separator')).toHaveLength(1)
    expect(wrapper.get('.dashboard-panel-header-actions .dialog-close-button').text()).toBe('关闭')
    expect(wrapper.get('[data-testid="dashboard-tab-overview"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="dashboard-tab-detail"]').attributes('aria-selected')).toBe('false')
    expect(wrapper.find('[data-testid="dashboard-overview-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)
  })

  it('shows the alert center entry in the monitor panel header and emits a global open event', async () => {
    const wrapper = mountDialog(summaries, { alertUnreadCount: 3 })
    const button = wrapper.get('[data-testid="dashboard-alert-center"]')

    expect(button.text()).toContain('告警中心')
    expect(button.classes()).toContain('command-light-action')
    expect(button.get('.dashboard-alert-center-count').text()).toBe('3')
    await button.trigger('click')
    expect(wrapper.emitted('alerts')).toEqual([[]])

    await wrapper.setProps({ alertUnreadCount: 0 })
    expect(wrapper.get('[data-testid="dashboard-alert-center"]').text()).toBe('告警中心')
    expect(wrapper.find('.dashboard-alert-center-count').exists()).toBe(false)
  })

  it('renders overview filters as a grid with refresh sharing the control row', () => {
    const wrapper = mountDialog()
    const toolbar = wrapper.get('.multi-server-dashboard-toolbar')
    const filterGrid = toolbar.get('[data-testid="monitor-dashboard-filter-grid"]')
    const fields = Array.from(filterGrid.element.children)

    expect(filterGrid.classes()).toContain('monitor-dashboard-filter-grid')
    expect(fields).toHaveLength(5)
    expect(fields.every((field) => field.classList.contains('monitor-dashboard-field'))).toBe(true)
    expect(fields.map((field) => Array.from(field.classList))).toEqual([
      ['monitor-dashboard-field', 'monitor-dashboard-search-field'],
      ['monitor-dashboard-field', 'monitor-dashboard-status-field'],
      ['monitor-dashboard-field', 'monitor-dashboard-group-field'],
      ['monitor-dashboard-field', 'monitor-dashboard-sort-field'],
      ['monitor-dashboard-field', 'monitor-dashboard-refresh-field'],
    ])
    expect(filterGrid.find('.dashboard-field').exists()).toBe(false)

    expect(wrapper.get('[data-testid="dashboard-search"]').classes()).toContain('monitor-dashboard-control')
    expect(wrapper.get('[data-testid="dashboard-status-filter"]').classes()).toContain('monitor-dashboard-control')
    expect(wrapper.get('[data-testid="dashboard-group-filter"]').classes()).toContain('monitor-dashboard-control')
    expect(wrapper.get('[data-testid="dashboard-sort-mode"]').classes()).toContain('monitor-dashboard-control')
    expect(wrapper.get('[data-testid="dashboard-sort-mode"]').element).toHaveProperty('value', 'manual')

    const refreshField = filterGrid.get('.monitor-dashboard-refresh-field')
    expect(refreshField.find('.monitor-dashboard-label-placeholder').exists()).toBe(true)
    const refreshButton = refreshField.get('.monitor-dashboard-refresh-button')
    expect(refreshButton.classes()).toContain('monitor-dashboard-control')
    expect(refreshButton.text()).toBe('刷新视图')
  })

  it('renders all saved servers with status, metrics, runtime counts, and missing-data dashes', () => {
    const wrapper = mountDialog()
    const cards = wrapper.findAll('[data-testid="dashboard-server-card"]')

    expect(cards).toHaveLength(3)
    expect(wrapper.text()).toContain('服务器 3 / 在线 1')
    expect(cards[0].text()).toContain('prod-api')
    expect(cards[0].text()).toContain('在线')
    expect(cards[0].text()).toContain('延迟42 ms')
    const topLine = cards[0].get('.dashboard-card-top')
    expect(Array.from(topLine.element.children).map((element) => element.className)).toEqual([
      'dashboard-card-select',
      'dashboard-card-identity',
      'dashboard-card-status is-online',
    ])
    const identity = topLine.get('.dashboard-card-identity')
    expect(Array.from(identity.element.children).map((element) => element.className)).toEqual([
      'dashboard-card-name-line',
      'dashboard-card-host',
    ])
    expect(identity.get('.dashboard-card-name-line').text()).toBe('prod-api')
    expect(identity.get('.dashboard-card-host').text()).toBe('10.0.0.1:22')
    expect(cards[0].text()).toContain('CPU')
    expect(cards[0].text()).toContain('12.0%')
    expect(cards[0].get('[data-testid="dashboard-card-metric-grid"]').text()).toContain('DISK')
    expect(cards[0].find('.dashboard-card-metric-left').exists()).toBe(true)
    expect(cards[0].find('.dashboard-card-metric-right').exists()).toBe(true)
    expect(cards[0].findAll('.dashboard-card-metric-left .dashboard-card-metric-item').map((item) => item.text())).toEqual([
      'CPU12.0%',
      '内存41.0%',
      'DISK65.0%',
    ])
    expect(cards[0].findAll('.dashboard-card-metric-right .dashboard-card-metric-item').map((item) => item.text())).toEqual([
      '延迟42 ms',
      '上传2.00 KB/s',
      '下载1.00 KB/s',
    ])
    expect(cards[0].get('.dashboard-card-download').text()).toContain('1.00 KB/s')
    expect(cards[0].get('.dashboard-card-upload').text()).toContain('2.00 KB/s')
    expect(cards[0].text()).toContain('传输 1')
    expect(cards[0].text()).toContain('Docker 5/12')
    expect(cards[1].text()).toContain('离线')
    expect(cards[1].text()).toContain('Docker 未检测')
    expect(cards[1].text()).toContain('CPU')
    expect(cards[1].text()).toContain('—')
    expect(cards[2].text()).toContain('错误')
    expect(cards[2].text()).toContain('连接超时')
  })

  it('keeps Docker zero counts, missing state, and unavailable state distinct', () => {
    const zeroDocker: DashboardServerSummary = {
      ...summaries[1],
      serverID: 4,
      name: 'empty-docker',
      host: '10.0.0.4',
      dockerAvailable: true,
      dockerRunningContainers: 0,
      dockerStoppedContainers: 0,
      dockerTotalContainers: 0,
      dockerStatusLabel: '0/0',
    }
    const wrapper = mountDialog([...summaries, zeroDocker])

    expect(wrapper.text()).toContain('Docker 5/12')
    expect(wrapper.text()).toContain('Docker 0/0')
    expect(wrapper.text()).toContain('Docker 未检测')
    expect(wrapper.text()).toContain('Docker 不可用')
  })

  it('keeps long card identity on one ellipsis-safe top line', () => {
    const wrapper = mountDialog([{
      ...summaries[0],
      name: 'very-long-production-api-server-name',
      host: 'very-long-host-name-that-should-ellipsis.internal.example.com',
    }])
    const topLine = wrapper.get('.dashboard-card-top')
    const identity = topLine.get('.dashboard-card-identity')

    expect(topLine.find('.dashboard-card-select').exists()).toBe(true)
    expect(topLine.find('.dashboard-card-status').exists()).toBe(true)
    expect(identity.find('.dashboard-card-name-line').exists()).toBe(true)
    expect(identity.find('.dashboard-card-host').exists()).toBe(true)
    expect(wrapper.find('.dashboard-card-title').exists()).toBe(false)
    expect(identity.get('.dashboard-card-name-line').attributes('title')).toBe('very-long-production-api-server-name')
    expect(identity.get('.dashboard-card-host').attributes('title')).toBe('very-long-host-name-that-should-ellipsis.internal.example.com:22')
  })

  it('filters by server name, host, group, and status without mutating summaries', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-search"]').setValue('10.0.0.2')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('staging-db')

    await wrapper.get('[data-testid="dashboard-search"]').setValue('')
    await wrapper.get('[data-testid="dashboard-group-filter"]').setValue('生产')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('staging-db')

    await wrapper.get('[data-testid="dashboard-status-filter"]').setValue('error')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('broken')
  })

  it('hides offline servers as a session-only filter layered with status filters', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-hide-offline"]').trigger('click')

    expect(wrapper.get('[data-testid="dashboard-hide-offline"]').classes()).toContain('active')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('prod-api')
    expect(wrapper.text()).toContain('broken')
    expect(wrapper.text()).not.toContain('staging-db')

    await wrapper.get('[data-testid="dashboard-status-filter"]').setValue('offline')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前状态筛选与隐藏离线组合没有结果')

    await wrapper.get('[data-testid="dashboard-hide-offline"]').trigger('click')
    expect(wrapper.text()).toContain('staging-db')
  })

  it('sorts by group, remark, CPU, memory, and network usage without changing selection', async () => {
    const rows: DashboardServerSummary[] = [
      {
        ...summaries[0],
        serverID: 1,
        name: 'alpha',
        groupName: 'B',
        cpuPercent: 10,
        memoryPercent: 20,
        networkRxRate: 100,
        networkTxRate: 100,
      },
      {
        ...summaries[1],
        serverID: 2,
        name: 'beta',
        groupName: 'A',
        cpuPercent: 30,
        memoryPercent: 5,
        networkRxRate: undefined,
        networkTxRate: undefined,
      },
      {
        ...summaries[2],
        serverID: 3,
        name: 'gamma',
        groupName: 'B',
        cpuPercent: undefined,
        memoryPercent: 50,
        networkRxRate: 1024,
        networkTxRate: 2048,
      },
    ]
    const wrapper = mountDialog(rows)

    await wrapper.findAll('[data-testid="dashboard-server-card"]')[1].trigger('click')
    expect(wrapper.text()).toContain('已选 1 个')

    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('group')
    expect(cardTexts(wrapper)[0]).toContain('beta')

    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('remark')
    expect(cardTexts(wrapper).map((text) =>
      ['alpha', 'beta', 'gamma'].find((name) => text.includes(name)))).toEqual(['gamma', 'alpha', 'beta'])

    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('cpu')
    expect(cardTexts(wrapper).map((text) =>
      ['alpha', 'beta', 'gamma'].find((name) => text.includes(name)))).toEqual(['beta', 'alpha', 'gamma'])

    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('memory')
    expect(cardTexts(wrapper).map((text) =>
      ['alpha', 'beta', 'gamma'].find((name) => text.includes(name)))).toEqual(['gamma', 'alpha', 'beta'])

    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('network')
    expect(cardTexts(wrapper).map((text) =>
      ['alpha', 'beta', 'gamma'].find((name) => text.includes(name)))).toEqual(['gamma', 'alpha', 'beta'])
    expect(wrapper.text()).toContain('已选 1 个')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]').some((card) =>
      card.text().includes('beta') && card.classes().includes('selected'))).toBe(true)
  })

  it('supports manual drag sorting without opening detail or switching workspace', async () => {
    const wrapper = mountDialog()
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    }

    await wrapper.findAll('[data-testid="dashboard-server-card"]')[2].trigger('dragstart', { dataTransfer })
    await wrapper.findAll('[data-testid="dashboard-server-card"]')[0].trigger('dragover', { dataTransfer })
    await wrapper.findAll('[data-testid="dashboard-server-card"]')[0].trigger('drop', { dataTransfer })
    await wrapper.vm.$nextTick()

    expect(cardTexts(wrapper)[0]).toContain('broken')
    expect(cardTexts(wrapper)[1]).toContain('prod-api')
    expect(cardTexts(wrapper)[2]).toContain('staging-db')
    expect(wrapper.text()).toContain('已选 0 个')
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('switchServer')).toBeUndefined()
    expect(wrapper.emitted('dashboardLayoutChange')).toEqual([[
      { sortMode: 'manual', manualServerOrder: ['3', '1', '2'] },
    ]])
  })

  it('selects on single click and opens detail only on double click without switching SSH workspace', async () => {
    const wrapper = mountDialog()
    const firstCard = () => wrapper.findAll('[data-testid="dashboard-server-card"]')[0]

    await dispatchCardClick(wrapper, 0, 1)
    expect(wrapper.text()).toContain('已选 1 个')
    expect(firstCard().classes()).toContain('selected')
    expect(firstCard().get('[data-testid="dashboard-card-checkbox"]').element).toHaveProperty('checked', true)
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('switchServer')).toBeUndefined()

    await dispatchCardClick(wrapper, 0, 1)
    expect(wrapper.text()).toContain('已选 0 个')
    expect(firstCard().classes()).not.toContain('selected')
    expect(firstCard().get('[data-testid="dashboard-card-checkbox"]').element).toHaveProperty('checked', false)

    await dispatchCardClick(wrapper, 0, 1)
    await dispatchCardClick(wrapper, 0, 2)
    await firstCard().trigger('dblclick')
    expect(wrapper.get('[data-testid="dashboard-tab-detail"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="dashboard-detail-server-select"]').element).toHaveProperty('value', '1')
    await wrapper.get('[data-testid="dashboard-tab-overview"]').trigger('click')
    expect(wrapper.text()).toContain('已选 1 个')
    expect(firstCard().classes()).toContain('selected')
    expect(wrapper.emitted('switchServer')).toBeUndefined()
  })

  it('shows active alert badges without changing card click or double-click behavior', async () => {
    const wrapper = mountDialog(summaries, {
      activeAlertCountsByServerId: { 1: 2 },
    })
    const firstCard = () => wrapper.findAll('[data-testid="dashboard-server-card"]')[0]
    expect(firstCard().text()).toContain('告警 2')

    await dispatchCardClick(wrapper, 0, 1)
    expect(firstCard().classes()).toContain('selected')
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)

    await dispatchCardClick(wrapper, 0, 2)
    await firstCard().trigger('dblclick')
    expect(wrapper.get('[data-testid="dashboard-tab-detail"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.emitted('switchServer')).toBeUndefined()
  })

  it('toggles selection from the card checkbox without opening detail', async () => {
    const wrapper = mountDialog()
    const checkbox = wrapper.findAll('[data-testid="dashboard-card-checkbox"]')[0]

    await checkbox.setValue(true)
    expect(wrapper.text()).toContain('已选 1 个')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')[0].classes()).toContain('selected')
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)

    await checkbox.setValue(false)
    expect(wrapper.text()).toContain('已选 0 个')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')[0].classes()).not.toContain('selected')
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)
  })

  it('allows a card click to deselect one server after select all', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-select-all"]').trigger('click')
    expect(wrapper.text()).toContain('已选 3 个')

    await dispatchCardClick(wrapper, 0, 1)
    expect(wrapper.text()).toContain('已选 2 个')
    expect(wrapper.findAll('[data-testid="dashboard-server-card"]')[0].classes()).not.toContain('selected')
  })

  it('restores manual order from settings and keeps it when switching sort modes', async () => {
    const wrapper = mountDialog(summaries, {
      dashboardManualServerOrder: ['3', '1', '2'],
    })

    expect(cardTexts(wrapper).map((text) =>
      ['prod-api', 'staging-db', 'broken'].find((name) => text.includes(name)))).toEqual(['broken', 'prod-api', 'staging-db'])

    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('cpu')
    expect(wrapper.emitted('dashboardLayoutChange')?.at(-1)).toEqual([
      { sortMode: 'cpu', manualServerOrder: ['3', '1', '2'] },
    ])

    await wrapper.setProps({ dashboardSortMode: 'cpu' })
    await wrapper.get('[data-testid="dashboard-sort-mode"]').setValue('manual')
    expect(cardTexts(wrapper).map((text) =>
      ['prod-api', 'staging-db', 'broken'].find((name) => text.includes(name)))).toEqual(['broken', 'prod-api', 'staging-db'])
    expect(wrapper.emitted('dashboardLayoutChange')?.at(-1)).toEqual([
      { sortMode: 'manual', manualServerOrder: ['3', '1', '2'] },
    ])
  })

  it('filters missing manual-order ids and appends new servers to the persisted order', async () => {
    const extra: DashboardServerSummary = {
      ...summaries[1],
      serverID: 4,
      name: 'new-server',
      host: '10.0.0.4',
    }
    const wrapper = mountDialog([...summaries, extra], {
      dashboardManualServerOrder: ['3', '999', '1'],
    })

    expect(cardTexts(wrapper).map((text) =>
      ['prod-api', 'staging-db', 'broken', 'new-server'].find((name) => text.includes(name)))).toEqual([
      'broken',
      'prod-api',
      'staging-db',
      'new-server',
    ])
    expect(wrapper.emitted('dashboardLayoutChange')).toEqual([[
      { sortMode: 'manual', manualServerOrder: ['3', '1', '2', '4'] },
    ]])
  })

  it('falls back invalid dashboard sort mode to manual', () => {
    const wrapper = mountDialog(summaries, {
      dashboardSortMode: 'unsupported',
      dashboardManualServerOrder: ['2', '1', '3'],
    })

    expect(wrapper.get('[data-testid="dashboard-sort-mode"]').element).toHaveProperty('value', 'manual')
    expect(cardTexts(wrapper)[0]).toContain('staging-db')
  })

  it('removes per-card action buttons and emits selected toolbar actions', async () => {
    const wrapper = mountDialog()
    const firstCard = wrapper.findAll('[data-testid="dashboard-server-card"]')[0]
    const bulkActions = wrapper.get('[data-testid="dashboard-bulk-actions"]')

    expect(firstCard.find('.dashboard-card-actions').exists()).toBe(false)
    expect(firstCard.findAll('button')).toHaveLength(0)
    expect(bulkActions.findAll('.command-light-action').map((button) => button.text())).toEqual([
      '全选',
      '反选',
      '切换',
      '连接',
      '自动重连',
      '断开',
      '编辑',
      '隐藏离线',
    ])
    expect(bulkActions.findAll('.command-action-separator')).toHaveLength(7)
    expect(buttonByText(wrapper, '切换').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, '编辑').attributes('disabled')).toBeDefined()

    await firstCard.trigger('click')

    expect(buttonByText(wrapper, '切换').attributes('disabled')).toBeUndefined()
    expect(buttonByText(wrapper, '编辑').attributes('disabled')).toBeUndefined()
    await buttonByText(wrapper, '切换').trigger('click')
    await buttonByText(wrapper, '编辑').trigger('click')
    expect(wrapper.emitted('switchServer')).toEqual([[1]])
    expect(wrapper.emitted('editServer')).toEqual([[1]])
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)
  })

  it('selects, inverts, and emits batch actions for the current visible or selected servers', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-search"]').setValue('10.0.0.2')
    await wrapper.get('[data-testid="dashboard-select-all"]').trigger('click')
    expect(wrapper.text()).toContain('已选 1 个')

    await wrapper.get('[data-testid="dashboard-connect-all"]').trigger('click')
    expect(wrapper.emitted('connectServers')).toEqual([[[2]]])

    await wrapper.get('[data-testid="dashboard-invert-selection"]').trigger('click')
    expect(wrapper.text()).toContain('已选 0 个')

    await wrapper.get('[data-testid="dashboard-search"]').setValue('')
    await wrapper.get('[data-testid="dashboard-disconnect-all"]').trigger('click')
    expect(wrapper.emitted('disconnectServers')).toEqual([[[1, 2, 3], 'filtered']])
  })

  it('keeps bulk connect disabled and no-op when no server is selected', async () => {
    const wrapper = mountDialog()
    const connectButton = wrapper.get('[data-testid="dashboard-connect-all"]')

    expect(wrapper.text()).toContain('已选 0 个')
    expect(connectButton.attributes('disabled')).toBeDefined()

    await connectButton.trigger('click')

    expect(wrapper.emitted('connectServers')).toBeUndefined()
  })

  it('emits on-demand reconnect for the current filtered range or selected range', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-search"]').setValue('10.0.0.2')
    await wrapper.get('[data-testid="dashboard-reconnect-offline"]').trigger('click')
    expect(wrapper.emitted('reconnectServers')).toEqual([[[2]]])

    await wrapper.get('[data-testid="dashboard-search"]').setValue('')
    await wrapper.findAll('[data-testid="dashboard-card-checkbox"]')[1].setValue(true)
    await wrapper.findAll('[data-testid="dashboard-card-checkbox"]')[2].setValue(true)
    await wrapper.get('[data-testid="dashboard-reconnect-offline"]').trigger('click')
    expect(wrapper.emitted('reconnectServers')).toEqual([[[2]], [[2, 3]]])
  })

  it('card checkboxes do not open detail', async () => {
    const wrapper = mountDialog()
    const checkbox = wrapper.findAll('[data-testid="dashboard-card-checkbox"]')[0]

    await checkbox.setValue(true)

    expect(wrapper.text()).toContain('已选 1 个')
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(false)
  })

  it('shows existing monitor data in the detail tab without reviving stale offline snapshots', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-tab-detail"]').trigger('click')

    expect(wrapper.find('[data-testid="dashboard-overview-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="dashboard-detail-panel"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="dashboard-detail-server-select"]').element).toHaveProperty('value', '1')
    expect(wrapper.get('[data-testid="detail-snapshot"]').text()).toBe('1:12')
    expect(wrapper.get('[data-testid="detail-history"]').text()).toBe('1')

    await wrapper.get('[data-testid="dashboard-detail-server-select"]').setValue('2')

    expect(wrapper.get('[data-testid="detail-snapshot"]').text()).toBe('empty')
    expect(wrapper.text()).toContain('离线')
  })

  it('fills the detail tab with runtime summaries and shortcut emits', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="dashboard-tab-detail"]').trigger('click')

    expect(wrapper.find('[data-testid="dashboard-runtime-summary"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="dashboard-tunnel-summary"]').text()).toContain('运行中隧道：3')
    expect(wrapper.get('[data-testid="dashboard-tunnel-summary"]').text()).toContain('已停止/失败：1')
    expect(wrapper.get('[data-testid="dashboard-transfer-summary"]').text()).toContain('传输中：1')
    expect(wrapper.get('[data-testid="dashboard-transfer-summary"]').text()).toContain('已完成：1')
    expect(wrapper.get('[data-testid="dashboard-docker-summary"]').text()).toContain('容器：运行中 5 / 总数 12')
    expect(wrapper.get('[data-testid="dashboard-shortcut-summary"]').text()).toContain('进程管理')
    expect(wrapper.get('[data-testid="dashboard-shortcut-summary"]').text()).toContain('网络诊断')

    await wrapper.get('[data-testid="dashboard-tunnel-summary"] button').trigger('click')
    await wrapper.get('[data-testid="dashboard-docker-summary"] button').trigger('click')
    await buttonByText(wrapper, '进程管理').trigger('click')
    await buttonByText(wrapper, '网络诊断').trigger('click')

    expect(wrapper.emitted('openTunnels')).toEqual([[1]])
    expect(wrapper.emitted('openDocker')).toEqual([[1]])
    expect(wrapper.emitted('openProcesses')).toEqual([[1]])
    expect(wrapper.emitted('openNetworkDiagnostics')).toEqual([[1]])
  })

  it('does not render secret-like fields supplied outside the summary contract', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).not.toContain('password')
    expect(wrapper.text()).not.toContain('privateKeyPath')
    expect(wrapper.text()).not.toContain('passphrase')
  })
})
