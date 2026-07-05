// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, MonitorSnapshot, NetworkInterface } from '../types'
import CompactMonitorSidebar from './CompactMonitorSidebar.vue'

vi.mock('./MiniSparkline.vue', () => ({
  default: {
    name: 'MiniSparkline',
    props: {
      flow: Boolean,
      timedSeries: Array,
      windowMs: Number,
      leftFade: Boolean,
    },
    template: '<svg class="mini-sparkline-stub" :class="{ \'is-flowing\': flow, \'is-visual-interpolated\': flow }" :data-window-ms="windowMs" :data-left-fade="String(leftFade)" :data-timed-series-count="timedSeries?.length ?? 0" />',
  },
}))

const connection: Connection = {
  id: 1, groupId: null, name: 'server', host: '192.0.2.1', port: 22,
  username: 'root', authType: 'password', privateKeySource: 'local_file', privateKeyPath: '', keyVaultId: null,
  hostKeyFingerprint: '', credentialSaved: false, refreshInterval: 2,
  createdAt: '', updatedAt: '',
}
const snapshot: MonitorSnapshot = {
  connectionId: 1, status: 'online', timestamp: '2026-06-15T00:00:00Z',
  latencyMillis: 10, latencyAvailable: true, cpuPercent: 25,
  memoryTotal: 1000, memoryAvailable: 400, memoryUsedPercent: 60,
  swapTotal: 100, swapFree: 75, diskTotal: 1000, diskUsed: 400,
  diskUsedPercent: 40, loadOne: 0.1, loadFive: 0.2, loadFifteen: 0.3,
  uptimeSeconds: 3600, defaultInterface: 'eth0',
  downloadBytesPerSecond: 1024, uploadBytesPerSecond: 512,
  osName: 'Linux', kernel: '6.6', architecture: 'x86_64',
  mounts: [
    { filesystem: '/dev/root', mountPath: '/', total: 1000, used: 400, available: 600, usedPercent: 40 },
    { filesystem: '/dev/data', mountPath: '/data', total: 2000, used: 500, available: 1500, usedPercent: 25 },
    { filesystem: 'overlay', mountPath: '/var/lib/docker/overlay2/a/merged', total: 1000, used: 400, available: 600, usedPercent: 40 },
  ],
  processes: [
    { pid: 1, cpuPercent: 2, memoryPercent: 9, command: 'memory-heavy' },
    { pid: 2, cpuPercent: 12, memoryPercent: 2, command: 'cpu-heavy' },
  ],
  processStatus: 'available',
  processMessage: '',
  errors: [], errorCode: '', message: '', monitorActive: true,
}
const interfaces: NetworkInterface[] = [
  {
    serverID: 1,
    name: 'eth0',
    displayName: 'eth0',
    isUp: true,
    isLoopback: false,
    ipv4: ['192.0.2.10'],
    ipv6: [],
    rxBytes: 1000,
    txBytes: 2000,
    lastUpdatedAt: '2026-06-19T00:00:00Z',
  },
  {
    serverID: 1,
    name: 'lo',
    displayName: 'lo',
    isUp: true,
    isLoopback: true,
    ipv4: ['127.0.0.1'],
    ipv6: ['::1'],
    rxBytes: 100,
    txBytes: 100,
    lastUpdatedAt: '2026-06-19T00:00:00Z',
  },
]

describe('CompactMonitorSidebar', () => {
  beforeEach(() => localStorage.clear())

  function render() {
    return mount(CompactMonitorSidebar, {
      props: {
        connection,
        snapshot,
        history: [snapshot],
        state: null,
        workspaceStatus: 'connected',
      },
    })
  }

  function renderWith(nextSnapshot: MonitorSnapshot) {
    return mount(CompactMonitorSidebar, {
      props: {
        connection,
        snapshot: nextSnapshot,
        history: [nextSnapshot],
        state: null,
        workspaceStatus: 'connected',
      },
    })
  }

  it('renders separate monitor and multiple-mount regions', () => {
    const wrapper = render()
    expect(wrapper.find('.compact-monitor').exists()).toBe(true)
    expect(wrapper.find('.mount-panel').exists()).toBe(true)
    expect(wrapper.findAll('.mount-list article')).toHaveLength(2)
    expect(wrapper.attributes('style')).toContain('430px')
    expect(wrapper.findAll('.mini-sparkline-stub')).toHaveLength(1)
    expect(wrapper.find('.system-info-summary').exists()).toBe(true)
  })

  it('keeps the system info summary text separate from a right-aligned chevron', () => {
    const wrapper = render()
    const summary = wrapper.get('.system-info-summary')

    expect(summary.find('.system-info-summary-text').exists()).toBe(true)
    expect(summary.find('.system-info-summary-chevron').exists()).toBe(true)
    expect(summary.find('.system-info-summary-text strong').exists()).toBe(true)
    expect(summary.find('.system-info-summary-text span').exists()).toBe(true)
    expect(summary.find('.system-info-summary-chevron').attributes('aria-hidden')).toBe('true')
    expect(summary.find('.system-info-summary-chevron .app-icon--chevron-down').exists()).toBe(true)
  })

  it('treats a zero persisted split height as missing instead of collapsing the monitor pane', () => {
    localStorage.setItem('serverpilot.monitorPaneHeight', '0')
    const wrapper = render()
    expect(wrapper.attributes('style')).toContain('430px')
    expect(wrapper.attributes('style')).not.toContain('grid-template-rows: 0px')
  })

  it('reveals Docker overlay mounts with the show-all control', async () => {
    const wrapper = render()
    await wrapper.find('.mount-panel input').setValue(true)
    expect(wrapper.findAll('.mount-list article')).toHaveLength(3)
  })

  it('hides pseudo filesystem mounts until show all is enabled', async () => {
    const wrapper = renderWith({
      ...snapshot,
      mounts: [
        ...snapshot.mounts,
        { filesystem: 'tmpfs', mountPath: '/run', total: 10, used: 1, available: 9, usedPercent: 10 },
      ],
    })
    expect(wrapper.text()).not.toContain('/run')
    await wrapper.find('.mount-panel input').setValue(true)
    expect(wrapper.text()).toContain('/run')
  })

  it('maps a connected workspace to the online monitor state', () => {
    const wrapper = render()
    expect(wrapper.get('.compact-state').text()).toContain('在线')
    expect(wrapper.get('.compact-state .status-dot').classes()).toContain('online')
  })

  it('defaults to Memory process order and supports CPU sorting', async () => {
    const wrapper = render()
    expect(wrapper.findAll('.process-row')[0].text()).toContain('memory-heavy')
    expect(wrapper.findAll('.process-sort-options button')[1].classes()).toContain('active')

    await wrapper.findAll('.process-sort-options button')[0].trigger('click')

    expect(wrapper.findAll('.process-row')[0].text()).toContain('cpu-heavy')
    expect(wrapper.findAll('.process-sort-options button')[0].classes()).toContain('active')
  })

  it('shows CPU unavailable on the CPU tab without hiding Memory process rows', async () => {
    const wrapper = renderWith({
      ...snapshot,
      processes: [
        { pid: 1, cpuPercent: -1, memoryPercent: 9, command: 'memory-heavy' },
        { pid: 2, cpuPercent: Number.NaN, memoryPercent: 2, command: 'worker' },
      ],
      processStatus: 'available',
      processMessage: '',
    })

    expect(wrapper.findAll('.process-row')).toHaveLength(2)
    expect(wrapper.findAll('.process-row')[0].text()).toContain('memory-heavy')

    await wrapper.findAll('.process-sort-options button')[0].trigger('click')

    expect(wrapper.findAll('.process-row')).toHaveLength(0)
    expect(wrapper.get('.compact-empty').text()).toBe('CPU 数据不可用')
  })

  it('emits the selected TOP process pid when a process row is clicked', async () => {
    const wrapper = render()
    await wrapper.findAll('.process-row')[0].trigger('click')
    expect(wrapper.emitted('process')).toEqual([[1]])
  })

  it('renders clamped CPU, memory, and Swap progress bars without trend lines', () => {
    const wrapper = renderWith({
      ...snapshot,
      cpuPercent: 120,
      memoryUsedPercent: -5,
      swapTotal: 100,
      swapFree: 25,
    })
    const resources = wrapper.findAll('.compact-resource')
    expect(resources).toHaveLength(3)
    expect(resources[0].get('.metric-progress i').attributes('style')).toContain('100%')
    expect(resources[1].get('.metric-progress i').attributes('style')).toContain('0%')
    expect(resources[2].get('.metric-progress i').attributes('style')).toContain('75%')
    expect(wrapper.findAll('.mini-sparkline-stub')).toHaveLength(1)
    expect(wrapper.text()).toContain('Swap')
    expect(wrapper.text()).not.toContain('GPU')
  })

  it('renders network interface selection and emits interface changes', async () => {
    const wrapper = mount(CompactMonitorSidebar, {
      props: {
        connection,
        snapshot: { ...snapshot, effectiveNetworkInterface: 'all' },
        history: [snapshot],
        state: null,
        workspaceStatus: 'connected',
        networkInterfaces: interfaces,
      },
    })

    expect(wrapper.find('.network-source-label').exists()).toBe(false)
    expect(wrapper.get('.monitor-network-interface-select option[value="all"]').text()).toBe('全部')
    expect(wrapper.get('.monitor-network-interface-select option[value="physical"]').text()).toBe('物理')
    expect(wrapper.get('.monitor-network-interface-select option[value="docker"]').text()).toBe('Docker')
    expect(wrapper.get('.monitor-network-interface-select').attributes('title')).toBe('全部接口')
    expect(wrapper.get('.monitor-network-interface-select option[value="all"]').attributes('title')).toContain('全部非 lo')
    await wrapper.get('.network-controls select').setValue('eth0')
    expect(wrapper.emitted('networkInterface')).toEqual([['interface', 'eth0']])
    expect(wrapper.emitted('networkDiagnostics')).toBeUndefined()

    await wrapper.get('.network-controls select').setValue('all')
    expect(wrapper.emitted('networkInterface')?.at(-1)).toEqual(['all', ''])
    await wrapper.get('.network-controls select').setValue('docker')
    expect(wrapper.emitted('networkInterface')?.at(-1)).toEqual(['docker', ''])
  })

  it('shows latest three-minute upload/download individual-sample stats and keeps upload before download in the right rate cluster', () => {
    const wrapper = mount(CompactMonitorSidebar, {
      props: {
        connection,
        snapshot: { ...snapshot, timestamp: '2026-06-15T00:03:20Z', effectiveNetworkInterface: 'eth0', downloadBytesPerSecond: 3072, uploadBytesPerSecond: 2048 },
        history: [
          { ...snapshot, timestamp: '2026-06-14T23:59:00Z', downloadBytesPerSecond: 900 * 1024, uploadBytesPerSecond: 900 * 1024 },
          { ...snapshot, timestamp: '2026-06-15T00:00:40Z', downloadBytesPerSecond: 1024, uploadBytesPerSecond: 512 },
          { ...snapshot, timestamp: '2026-06-15T00:02:20Z', downloadBytesPerSecond: 2048, uploadBytesPerSecond: 1024 },
          { ...snapshot, timestamp: '2026-06-15T00:03:20Z', downloadBytesPerSecond: 3072, uploadBytesPerSecond: 2048 },
        ],
        state: null,
        workspaceStatus: 'connected',
        networkInterfaces: interfaces,
      },
    })

    const titleCluster = wrapper.get('.network-title-cluster')
    const rateCluster = wrapper.get('.network-rate-cluster')
    expect(titleCluster.text()).toContain('网络')
    expect(titleCluster.text()).toContain('eth0')
    expect(titleCluster.find('.network-controls').exists()).toBe(true)
    expect(titleCluster.find('.network-controls').classes()).toContain('network-controls-compact')
    expect(titleCluster.find('.network-inline-separator').attributes('aria-hidden')).toBe('true')
    expect(rateCluster.find('.network-current-rate.upload').text()).toContain('2.00 KB/s')
    expect(rateCluster.find('.network-current-rate.download').text()).toContain('3.00 KB/s')
    const orderedRateClasses = Array.from(rateCluster.element.querySelectorAll('.network-current-rate'))
      .map((item) => Array.from(item.classList))
    expect(orderedRateClasses[0]).toContain('upload')
    expect(orderedRateClasses[1]).toContain('download')
    expect(rateCluster.find('.network-inline-separator').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.network-controls select').exists()).toBe(true)
    expect(wrapper.find('.network-controls .network-icon-button').exists()).toBe(true)

    const chart = wrapper.get('.network-chart-trigger')
    expect(chart.find('.network-rate-row').exists()).toBe(false)
    expect(chart.text()).not.toContain('最高')
    expect(chart.text()).not.toContain('平均')
    expect(chart.text()).not.toContain('最低')
    expect(chart.find('.network-stat-row').exists()).toBe(false)
    expect(chart.find('.network-stat-column').exists()).toBe(true)
    expect(chart.find('.mini-sparkline-stub').classes()).toContain('is-flowing')
    expect(chart.find('.mini-sparkline-stub').classes()).toContain('is-visual-interpolated')
    expect(chart.find('.mini-sparkline-stub').attributes('data-window-ms')).toBe('180000')
    expect(chart.find('.mini-sparkline-stub').attributes('data-left-fade')).toBe('true')
    expect(chart.find('.mini-sparkline-stub').attributes('data-timed-series-count')).toBe('2')
    expect(chart.findAll('.network-stat-value')).toHaveLength(3)
    expect(chart.findAll('.network-stat-value').map((item) => item.text())).toEqual([
      '3.00 KB/s',
      '1.58 KB/s',
      '512 B/s',
    ])
    expect(chart.findAll('.network-stat-value').map((item) => item.attributes('aria-label'))).toEqual([
      expect.stringContaining('3.00 KB/s'),
      expect.stringContaining('1.58 KB/s'),
      expect.stringContaining('512 B/s'),
    ])
    expect(chart.findAll('.network-stat-value').map((item) => item.text())).not.toEqual([
      '5.00 KB/s',
      '3.50 KB/s',
      '1.00 KB/s',
    ])
    expect(chart.text()).not.toContain('eth0')
    expect(wrapper.find('.network-source-label').exists()).toBe(false)
  })

  it('opens network details from the chart area without a large diagnostics button', async () => {
    const wrapper = render()
    expect(wrapper.find('.network-diagnostics-button').exists()).toBe(false)
    expect(wrapper.get('.network-chart-trigger').attributes('title')).toBe('打开网络详情')
    await wrapper.get('.network-chart-trigger').trigger('click')

    expect(wrapper.emitted('networkDiagnostics')).toEqual([[]])
  })

  it('emits interface refresh without opening diagnostics', async () => {
    const wrapper = render()
    await wrapper.get('.network-icon-button').trigger('click')

    expect(wrapper.emitted('networkDiagnostics')).toBeUndefined()
    expect(wrapper.emitted('networkInterfacesRefresh')).toEqual([[]])
  })

  it('shows unavailable text when live interface data is empty', () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('接口数据不可用')
  })

  it('limits TOP to five compact process rows', () => {
    const wrapper = renderWith({
      ...snapshot,
      processes: Array.from({ length: 7 }, (_, index) => ({
        pid: index + 1,
        cpuPercent: 20 - index,
        memoryPercent: index,
        command: `process-${index}`,
      })),
    })
    expect(wrapper.text()).toContain('TOP')
    expect(wrapper.findAll('.process-row')).toHaveLength(5)
    expect(wrapper.find('.process-head').exists()).toBe(false)
  })

  it.each([
    ['loading', '正在加载进程数据'],
    ['empty', '暂无进程数据'],
    ['unsupported', '当前系统不支持进程采集'],
    ['failed', '进程采集失败，请查看应用日志'],
  ] as const)('renders the %s TOP state', (processStatus, text) => {
    const wrapper = renderWith({
      ...snapshot,
      processes: [],
      processStatus,
      processMessage: '',
    })
    expect(wrapper.get('.compact-empty').attributes('data-process-status')).toBe(processStatus)
    expect(wrapper.get('.compact-empty').text()).toBe(text)
  })

  it('renders each mount as one row with text over its progress bar', () => {
    const wrapper = render()
    const mount = wrapper.get('.mount-list article')
    expect(mount.findAll(':scope > *')).toHaveLength(2)
    expect(mount.get('.mount-progress span').text()).toContain('40%')
    expect(mount.get('.mount-progress span').text()).toContain('/')
  })

  it('persists the monitor-to-disk split after dragging', async () => {
    const wrapper = render()
    const root = wrapper.element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 300, bottom: 700, width: 300, height: 700,
      x: 0, y: 0, toJSON: () => ({}),
    })
    const down = new MouseEvent('pointerdown', { bubbles: true, clientY: 350 })
    Object.defineProperty(down, 'pointerId', { value: 1 })
    wrapper.find('.horizontal-splitter').element.dispatchEvent(down)
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 350 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(Number(localStorage.getItem('serverpilot.monitorPaneHeight'))).toBe(350)
  })

  it('shows inline controls for collapsing either monitor or mounts pane', () => {
    const wrapper = render()
    expect(wrapper.find('.monitor-pane-splitter .collapse-monitor').exists()).toBe(true)
    expect(wrapper.find('.monitor-pane-splitter .collapse-mounts').exists()).toBe(true)
    expect(wrapper.find('.monitor-pane-splitter .restore-split').exists()).toBe(false)
    expect(wrapper.findAll('.monitor-pane-splitter svg.splitter-chevron')).toHaveLength(2)
    expect(wrapper.get('.collapse-monitor svg').attributes('viewBox')).toBe('0 0 12 12')
    expect(wrapper.get('.collapse-mounts svg').attributes('viewBox')).toBe('0 0 12 12')
    expect(wrapper.get('.collapse-monitor').text()).toBe('')
    expect(wrapper.get('.collapse-mounts').text()).toBe('')
  })

  it('keeps monitor splitter SVG controls centered on the splitter', () => {
    const wrapper = render()
    const splitter = wrapper.get('.monitor-pane-splitter').element as HTMLElement
    const upChevron = wrapper.get('.collapse-monitor svg').element as SVGElement
    const downChevron = wrapper.get('.collapse-mounts svg').element as SVGElement
    vi.spyOn(splitter, 'getBoundingClientRect').mockReturnValue({
      top: 430, left: 0, right: 300, bottom: 440, width: 300, height: 10,
      x: 0, y: 430, toJSON: () => ({}),
    })
    vi.spyOn(upChevron, 'getBoundingClientRect').mockReturnValue({
      top: 429, left: 118, right: 130, bottom: 441, width: 12, height: 12,
      x: 118, y: 429, toJSON: () => ({}),
    })
    vi.spyOn(downChevron, 'getBoundingClientRect').mockReturnValue({
      top: 429, left: 170, right: 182, bottom: 441, width: 12, height: 12,
      x: 170, y: 429, toJSON: () => ({}),
    })

    const splitterCenterY = splitter.getBoundingClientRect().top + splitter.getBoundingClientRect().height / 2
    for (const chevron of [upChevron, downChevron]) {
      const bounds = chevron.getBoundingClientRect()
      expect(Math.abs((bounds.top + bounds.height / 2) - splitterCenterY)).toBeLessThanOrEqual(1)
    }
  })

  it('collapses the monitor pane and restores the previous split height', async () => {
    localStorage.setItem('serverpilot.monitorPaneHeight', '360')
    const wrapper = render()

    await wrapper.get('.collapse-monitor').trigger('click')
    expect(localStorage.getItem('serverpilot.monitorSidebarSplitMode')).toBe('monitorCollapsed')
    expect(wrapper.attributes('style')).toContain('10px minmax(0, 1fr)')
    expect(wrapper.find('.compact-monitor').exists()).toBe(false)
    expect(wrapper.find('.monitor-pane-splitter').exists()).toBe(true)
    expect(wrapper.find('.monitor-pane-splitter').classes()).toContain('restore-splitter')
    expect(wrapper.find('.monitor-pane-splitter .restore-split').exists()).toBe(true)
    expect(wrapper.find('.monitor-pane-splitter .restore-split svg.splitter-chevron').classes()).toContain('chevron-down')
    expect(wrapper.find('.mount-panel').isVisible()).toBe(true)
    expect(wrapper.classes()).toContain('split-monitorCollapsed')

    await wrapper.get('.monitor-pane-splitter .restore-split').trigger('click')
    expect(localStorage.getItem('serverpilot.monitorSidebarSplitMode')).toBe('split')
    expect(wrapper.attributes('style')).toContain('360px')
  })

  it('collapses the mounts pane without overwriting the stored split height', async () => {
    localStorage.setItem('serverpilot.monitorPaneHeight', '390')
    const wrapper = render()

    await wrapper.get('.collapse-mounts').trigger('click')
    expect(localStorage.getItem('serverpilot.monitorSidebarSplitMode')).toBe('mountsCollapsed')
    expect(localStorage.getItem('serverpilot.monitorPaneHeight')).toBe('390')
    expect(wrapper.attributes('style')).toContain('minmax(0, 1fr) 10px')
    expect(wrapper.find('.mount-panel').exists()).toBe(false)
    expect(wrapper.find('.monitor-pane-splitter').exists()).toBe(true)
    expect(wrapper.find('.monitor-pane-splitter').classes()).toContain('restore-splitter')
    expect(wrapper.find('.monitor-pane-splitter .restore-split').exists()).toBe(true)
    expect(wrapper.find('.monitor-pane-splitter .restore-split svg.splitter-chevron').classes()).toContain('chevron-up')
    expect(wrapper.classes()).toContain('split-mountsCollapsed')

    await wrapper.get('.monitor-pane-splitter .restore-split').trigger('click')
    expect(wrapper.attributes('style')).toContain('390px')
  })

  it('does not resize the panes when clicking a splitter chevron', async () => {
    const wrapper = render()
    const root = wrapper.element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 300, bottom: 700, width: 300, height: 700,
      x: 0, y: 0, toJSON: () => ({}),
    })

    await wrapper.get('.collapse-monitor').trigger('pointerdown')
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 300 }))
    window.dispatchEvent(new MouseEvent('pointerup'))

    expect(localStorage.getItem('serverpilot.monitorPaneHeight')).toBeNull()
  })
})
