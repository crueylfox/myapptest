// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalMonitorSidebar from './LocalMonitorSidebar.vue'
import type { LocalResourceSnapshot, LocalTerminalState } from '../types'

const apiMock = vi.hoisted(() => ({
  getLocalResourceSnapshot: vi.fn(),
}))

vi.mock('../api/backend', () => ({ api: apiMock }))

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

function session(overrides: Partial<LocalTerminalState> = {}): LocalTerminalState {
  return {
    sessionId: 'local-fixture',
    shellKind: 'cmd',
    shell: 'cmd.exe',
    shellName: 'CMD',
    elevated: false,
    title: 'CMD',
    cwd: 'C:\\Fixture',
    status: 'running',
    exitCode: null,
    error: '',
    startedAt: '2026-07-04T00:00:00Z',
    endedAt: '',
    ...overrides,
  }
}

function snapshot(overrides: Partial<LocalResourceSnapshot> = {}): LocalResourceSnapshot {
  return {
    status: 'online',
    hostname: 'fixture-host',
    platform: 'windows',
    osName: 'Windows',
    osVersion: 'Windows 11',
    osBuild: '22631',
    architecture: 'amd64',
    cpuModel: 'Fixture CPU',
    cpuCores: 8,
    cpuLogicalProcessors: 16,
    timestamp: '2026-07-04T00:00:00Z',
    uptimeSeconds: 3600,
    cpuPercent: 12,
    memoryTotal: 16 * 1024 * 1024 * 1024,
    memoryAvailable: 10 * 1024 * 1024 * 1024,
    memoryUsedPercent: 37.5,
    swapTotal: 0,
    swapFree: 0,
    pagefileTotal: 4 * 1024 * 1024 * 1024,
    pagefileFree: 3 * 1024 * 1024 * 1024,
    gpus: [
      {
        name: 'Fixture GPU',
        available: true,
        usagePercent: 34,
        memoryUsedBytes: 2 * 1024 * 1024 * 1024,
        memoryTotalBytes: 8 * 1024 * 1024 * 1024,
        unavailableReason: '',
      },
    ],
    uploadBytesPerSecond: 1024,
    downloadBytesPerSecond: 4096,
    networkInterfaces: [
      { name: 'Ethernet', displayName: 'Ethernet', isDefaultRoute: true, uploadBytesPerSecond: 1024, downloadBytesPerSecond: 4096 },
      { name: 'Wi-Fi', displayName: 'Wi-Fi', uploadBytesPerSecond: 256, downloadBytesPerSecond: 2048 },
    ],
    disks: [
      { name: 'C:', mountPath: 'C:\\', total: 1000, used: 420, available: 580, usedPercent: 42 },
    ],
    processes: [
      { pid: 100, name: 'fixture.exe', cpuPercent: 2.5, memoryBytes: 64 * 1024 * 1024, memoryPercent: 1.2 },
    ],
    ...overrides,
  } as LocalResourceSnapshot
}

function mountSidebar(value: LocalResourceSnapshot = snapshot(), valueSession: LocalTerminalState = session()) {
  apiMock.getLocalResourceSnapshot.mockResolvedValue(value)
  return mount(LocalMonitorSidebar, {
    attachTo: document.body,
    props: { session: valueSession },
  })
}

describe('LocalMonitorSidebar', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('renders collapsed Windows system summary, GPU, disks, and top process data without Pagefile or Swap cards', async () => {
    const wrapper = mountSidebar(snapshot(), session({ sessionId: 'local-summary-default' }))
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Windows 11')
    expect(wrapper.find('.local-system-detail').exists()).toBe(false)
    expect(wrapper.get('.local-system-info').text()).not.toContain('Build 22631')
    expect(wrapper.get('.local-system-info').text()).not.toContain('16 logical CPUs')
    expect(wrapper.text()).toContain('GPU')
    expect(wrapper.text()).toContain('Fixture GPU')
    expect(wrapper.text()).toContain('34.0%')
    expect(wrapper.text()).not.toContain('Pagefile')
    expect(wrapper.text()).not.toContain('Swap')
    expect(wrapper.find('.system-info-summary-chevron').exists()).toBe(true)
    expect(wrapper.get('[data-testid="local-disk-card"]').text()).toContain('C:')
    expect(wrapper.get('[data-testid="local-process-card"]').text()).toContain('fixture.exe')
  })

  it('renders Windows disks with Linux mount row structure and free over total capacity', async () => {
    const wrapper = mountSidebar(snapshot({
      disks: [
        { name: 'C:', mountPath: 'C:\\', total: 1000, used: 420, available: 580, usedPercent: 42 },
        { name: 'D:', mountPath: 'D:\\', total: 2048, used: 1024, available: 1024, usedPercent: 50 },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const diskCard = wrapper.get('[data-testid="local-disk-card"]')
    expect(diskCard.classes()).toContain('mount-panel')
    expect(diskCard.find('.mount-list').exists()).toBe(true)
    const rows = diskCard.findAll('.mount-list article')
    expect(rows).toHaveLength(2)
    expect(rows[0].get('strong').text()).toBe('C:')
    expect(rows[0].get('.mount-progress span').text()).toContain('42.0%')
    expect(rows[0].get('.mount-progress span').text()).toContain('580 B / 1000 B')
    expect(rows[0].get('.mount-progress i').attributes('style')).toContain('width: 42%')
    expect(rows[1].get('strong').text()).toBe('D:')
    expect(rows[1].get('.mount-progress span').text()).toContain('1.00 KB / 2.00 KB')
    expect(diskCard.text()).not.toContain('420 B / 1000 B')
  })

  it('renders top processes with PID and memory when CPU percent is unavailable', async () => {
    const wrapper = mountSidebar(snapshot({
      processes: [
        { pid: 4242, name: 'memory-heavy.exe', cpuPercent: -1, memoryBytes: 512 * 1024 * 1024, memoryPercent: 3.1 },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const processCard = wrapper.get('[data-testid="local-process-card"]')
    expect(processCard.text()).toContain('memory-heavy.exe')
    expect(processCard.text()).toContain('PID 4242')
    expect(processCard.text()).toContain('512.00 MB')
    expect(processCard.text()).toContain('—')
    expect(processCard.text()).not.toContain('-1.0%')
    expect(processCard.text()).not.toContain('unavailable')
  })

  it('uses the shared process panel with Memory sorting by default and supports CPU sorting', async () => {
    const wrapper = mountSidebar(snapshot({
      processes: [
        { pid: 100, name: 'cpu-heavy.exe', cpuPercent: 42, memoryBytes: 64 * 1024 * 1024, memoryPercent: 1.1 },
        { pid: 200, name: 'memory-heavy.exe', cpuPercent: 2, memoryBytes: 512 * 1024 * 1024, memoryPercent: 8.4 },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const processCard = wrapper.get('[data-testid="local-process-card"]')
    expect(processCard.classes()).toContain('process-panel')
    const sortButtons = processCard.findAll('.process-sort-options button')
    expect(sortButtons).toHaveLength(2)
    expect(sortButtons[1].classes()).toContain('active')
    expect(processCard.findAll('.local-process-row')[0].text()).toContain('memory-heavy.exe')

    await sortButtons[0].trigger('click')
    await wrapper.vm.$nextTick()

    expect(processCard.findAll('.local-process-row')[0].text()).toContain('cpu-heavy.exe')
    expect(sortButtons[0].classes()).toContain('active')
  })

  it('shows CPU unavailable on the CPU tab without hiding Memory process rows', async () => {
    const wrapper = mountSidebar(snapshot({
      processes: [
        { pid: 4242, name: 'memory-heavy.exe', cpuPercent: -1, memoryBytes: 512 * 1024 * 1024, memoryPercent: 3.1 },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const processCard = wrapper.get('[data-testid="local-process-card"]')
    expect(processCard.findAll('.local-process-row')).toHaveLength(1)
    expect(processCard.text()).toContain('memory-heavy.exe')

    await processCard.findAll('.process-sort-options button')[0].trigger('click')
    await wrapper.vm.$nextTick()

    expect(processCard.findAll('.local-process-row')).toHaveLength(0)
    expect(processCard.text()).toContain('CPU 数据不可用')
    expect(processCard.text()).not.toContain('unavailable')
  })

  it('shows process unavailable only when no process rows are present', async () => {
    const wrapper = mountSidebar(snapshot({ processes: [] } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="local-process-card"]').text()).toContain('unavailable')
  })

  it('toggles Windows system details between one-line summary and expanded facts', async () => {
    const wrapper = mountSidebar(snapshot(), session({ sessionId: 'local-system-toggle' }))
    await flush()
    await wrapper.vm.$nextTick()

    const summary = wrapper.get('.local-system-info .system-info-summary')
    expect(wrapper.find('.local-system-detail').exists()).toBe(false)
    expect(wrapper.get('.local-system-info').text()).toContain('Windows 11')
    expect(wrapper.get('.local-system-info').text()).not.toContain('Build 22631')
    expect(summary.attributes('aria-expanded')).toBe('false')
    expect(summary.find('svg.app-icon--chevron-down').exists()).toBe(true)
    expect(summary.element.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))).toBe(true)

    await summary.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.local-system-detail').exists()).toBe(true)
    expect(wrapper.get('.local-system-info').text()).toContain('Build 22631')
    expect(wrapper.get('.local-system-info').text()).toContain('amd64')
    expect(wrapper.get('.local-system-info').text()).toContain('16 logical CPUs')
    expect(wrapper.get('.local-system-info').text()).toContain('GB RAM')
    expect(wrapper.get('.local-system-info').text()).toContain('Uptime')
    expect(summary.attributes('aria-expanded')).toBe('true')
    expect(summary.find('svg.app-icon--chevron-up').exists()).toBe(true)

    await summary.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.local-system-detail').exists()).toBe(false)
    expect(wrapper.get('.local-system-info').text()).not.toContain('Build 22631')
    expect(summary.attributes('aria-expanded')).toBe('false')
    expect(summary.find('svg.app-icon--chevron-down').exists()).toBe(true)
  })

  it('persists Windows system detail expansion across local monitor remounts for the same local session', async () => {
    const localSession = session({ sessionId: 'local-system-persist' })
    const wrapper = mountSidebar(snapshot(), localSession)
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.local-system-detail').exists()).toBe(false)
    await wrapper.get('.local-system-info .system-info-summary').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.local-system-detail').exists()).toBe(true)

    wrapper.unmount()
    const expandedRemount = mountSidebar(snapshot(), localSession)
    await flush()
    await expandedRemount.vm.$nextTick()

    expect(expandedRemount.find('.local-system-detail').exists()).toBe(true)
    expect(expandedRemount.get('.local-system-info').text()).toContain('Build 22631')

    await expandedRemount.get('.local-system-info .system-info-summary').trigger('click')
    await expandedRemount.vm.$nextTick()
    expect(expandedRemount.find('.local-system-detail').exists()).toBe(false)

    expandedRemount.unmount()
    const collapsedRemount = mountSidebar(snapshot(), localSession)
    await flush()
    await collapsedRemount.vm.$nextTick()

    expect(collapsedRemount.find('.local-system-detail').exists()).toBe(false)
    expect(collapsedRemount.get('.local-system-info').text()).not.toContain('Build 22631')
  })

  it('shows GPU unavailable honestly when local GPU counters are missing', async () => {
    const wrapper = mountSidebar(snapshot({ gpus: [] } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('GPU')
    expect(wrapper.get('[data-testid="local-gpu-card"]').text()).toContain('使用率不可用')
    expect(wrapper.get('[data-testid="local-gpu-card"]').text()).not.toMatch(/(^|[\s·])—($|[\s·])/)
    expect(wrapper.text()).not.toContain('Pagefile')
  })

  it('shows the physical GPU name and memory while labeling unavailable usage explicitly', async () => {
    const wrapper = mountSidebar(snapshot({
      gpus: [
        {
          name: 'NVIDIA GeForce RTX Fixture',
          available: true,
          usagePercent: -1,
          memoryUsedBytes: 0,
          memoryTotalBytes: 8 * 1024 * 1024 * 1024,
          unavailableReason: '',
        },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const gpuCard = wrapper.get('[data-testid="local-gpu-card"]')
    expect(gpuCard.text()).toContain('NVIDIA GeForce RTX Fixture')
    expect(gpuCard.text()).toContain('使用率不可用')
    expect(gpuCard.text()).toContain('8.00 GB')
    expect(gpuCard.text()).not.toMatch(/(^|[\s·])—($|[\s·])/)
  })

  it('does not show virtual display driver names as the local GPU', async () => {
    const wrapper = mountSidebar(snapshot({
      gpus: [
        {
          name: 'OrayIddDriver Device',
          available: false,
          usagePercent: -1,
          memoryUsedBytes: 0,
          memoryTotalBytes: 0,
          unavailableReason: 'virtual display driver',
        },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('GPU')
    expect(wrapper.text()).not.toContain('OrayIddDriver Device')
    expect(wrapper.get('[data-testid="local-gpu-card"]').text()).toContain('使用率不可用')
  })

  it('defaults local network to the default route and filters hidden pseudo interfaces', async () => {
    const wrapper = mountSidebar(snapshot({
      networkInterfaces: [
        { name: 'Packet Driver Miniport', displayName: 'Packet Driver Miniport', isHiddenByDefault: true },
        { name: 'Wi-Fi', displayName: 'Wi-Fi', isDefaultRoute: true, uploadBytesPerSecond: 256, downloadBytesPerSecond: 2048 },
        { name: 'Teredo Tunneling Pseudo-Interface', displayName: 'Teredo', isHiddenByDefault: true },
        { name: 'Ethernet', displayName: 'Ethernet', uploadBytesPerSecond: 1024, downloadBytesPerSecond: 4096 },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const select = wrapper.get<HTMLSelectElement>('[data-testid="local-network-interface-select"]')
    expect(select.element.value).toBe('Wi-Fi')
    const optionLabels = Array.from(select.element.options).map((option) => option.textContent ?? '')
    expect(optionLabels).toEqual(['Wi-Fi', 'Ethernet'])
    expect(optionLabels.join(' ')).not.toContain('Packet Driver')
    expect(optionLabels.join(' ')).not.toContain('Teredo')
    expect(wrapper.get('[data-testid="local-network-stats"]').text()).not.toContain('Local')
    expect(wrapper.get('[data-testid="local-network-stats"]').text()).not.toContain('C:\\Fixture')
  })

  it('prefers a physical local network interface over a hidden virtual default route', async () => {
    const wrapper = mountSidebar(snapshot({
      networkInterfaces: [
        {
          name: 'Meta Virtual Adapter',
          displayName: 'Meta Virtual Adapter',
          description: 'Wintun Userspace Tunnel',
          isDefaultRoute: true,
          isHiddenByDefault: true,
          isVirtual: true,
          uploadBytesPerSecond: 8192,
          downloadBytesPerSecond: 16384,
        },
        {
          name: 'Wi-Fi',
          displayName: 'Wi-Fi',
          description: 'Intel Wi-Fi',
          isPhysicalLike: true,
          uploadBytesPerSecond: 256,
          downloadBytesPerSecond: 2048,
        },
      ],
    } as Partial<LocalResourceSnapshot>))
    await flush()
    await wrapper.vm.$nextTick()

    const select = wrapper.get<HTMLSelectElement>('[data-testid="local-network-interface-select"]')
    expect(select.element.value).toBe('Wi-Fi')
    const optionLabels = Array.from(select.element.options).map((option) => option.textContent ?? '')
    expect(optionLabels).toEqual(['Wi-Fi'])
    expect(wrapper.get('[data-testid="local-network-current"]').text()).not.toContain('Meta Virtual Adapter')
  })

  it('persists manual local network selection across monitor remounts for the same local session', async () => {
    const localSession = session({ sessionId: 'local-persist' })
    const wrapper = mountSidebar(snapshot(), localSession)
    await flush()
    await wrapper.vm.$nextTick()

    const select = wrapper.get<HTMLSelectElement>('[data-testid="local-network-interface-select"]')
    expect(select.element.value).toBe('Ethernet')

    await select.setValue('Wi-Fi')
    await wrapper.vm.$nextTick()

    expect(select.element.value).toBe('Wi-Fi')
    expect(wrapper.get('[data-testid="local-network-current"]').text()).toContain('Wi-Fi')

    wrapper.unmount()
    const remounted = mountSidebar(snapshot(), localSession)
    await flush()
    await remounted.vm.$nextTick()

    expect(remounted.get<HTMLSelectElement>('[data-testid="local-network-interface-select"]').element.value).toBe('Wi-Fi')
  })

  it('falls back to the default route once when the saved local interface is no longer available', async () => {
    const localSession = session({ sessionId: 'local-missing-interface' })
    const wrapper = mountSidebar(snapshot(), localSession)
    await flush()
    await wrapper.vm.$nextTick()
    await wrapper.get<HTMLSelectElement>('[data-testid="local-network-interface-select"]').setValue('Wi-Fi')
    wrapper.unmount()

    const remounted = mountSidebar(snapshot({
      networkInterfaces: [
        { name: 'Ethernet', displayName: 'Ethernet', isDefaultRoute: true, uploadBytesPerSecond: 1024, downloadBytesPerSecond: 4096 },
      ],
    } as Partial<LocalResourceSnapshot>), localSession)
    await flush()
    await remounted.vm.$nextTick()

    expect(remounted.get<HTMLSelectElement>('[data-testid="local-network-interface-select"]').element.value).toBe('Ethernet')
  })
})
