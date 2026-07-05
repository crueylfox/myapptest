// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentPublicInstance } from 'vue'
import { useServerStore } from '../stores/server'
import type { Connection, NetworkInterface } from '../types'
import NetworkDiagnosticsDialog from './NetworkDiagnosticsDialog.vue'

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

const connection: Connection = {
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
}

type DiagnosticTaskFixture = {
  taskID: string
  serverID: number
  type: 'ping' | 'traceroute' | 'dns' | 'tcp'
  target: string
  port?: number
  status: 'running' | 'completed' | 'failed' | 'canceled'
  startedAt: string
}

function networkInterface(values: Partial<NetworkInterface>): NetworkInterface {
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
    lastUpdatedAt: '2026-06-19T00:00:00Z',
    ...values,
  }
}

function installBackend(options: { diagnosticTasks?: DiagnosticTaskFixture[], interfaces?: NetworkInterface[] } = {}) {
  window.go = {
    main: {
      App: {
        GetMonitorNetworkInterface: vi.fn(async (serverID: number) => ({
          serverID,
          mode: 'all',
          selectedNetworkInterface: '',
          userSelected: false,
          updatedAt: '2026-06-19T00:00:00Z',
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
          updatedAt: '2026-06-19T00:00:00Z',
        })),
        ListNetworkInterfaces: vi.fn(async (request: { serverID: number }) => ({
          serverID: request.serverID,
          interfaces: options.interfaces ?? [networkInterface({ serverID: request.serverID })],
          updatedAt: '2026-06-19T00:00:00Z',
          recommendedInterface: 'all',
          recommendedInterfaceReason: 'fallback_all',
        })),
        ListNetworkDiagnosticTasks: vi.fn(async () => options.diagnosticTasks ?? []),
        StartNetworkDiagnostic: vi.fn(async (request: {
          serverID: number
          type: 'ping' | 'traceroute' | 'dns' | 'tcp'
          target: string
          port?: number
        }) => ({
          taskID: 'task-1',
          serverID: request.serverID,
          type: request.type,
          target: request.target,
          port: request.port,
          status: 'running',
          startedAt: '2026-06-19T00:00:00Z',
        })),
        CancelNetworkDiagnostic: vi.fn(async () => undefined),
      } as never,
    },
  }
}

function buttonByText(wrapper: VueWrapper<ComponentPublicInstance>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

async function render(options: { connections?: Connection[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(NetworkDiagnosticsDialog, {
    props: {
      open: true,
      connections: options.connections ?? [connection],
      activeServerId: 1,
    },
    global: { plugins: [pinia] },
  })
  await flushPromises()
  return { wrapper, store: useServerStore(pinia) }
}

describe('NetworkDiagnosticsDialog', () => {
  beforeEach(() => {
    installBackend()
  })

  it('renders Ping, Traceroute, DNS, and TCP forms', async () => {
    const { wrapper } = await render()

    expect(wrapper.text()).toContain('Ping')
    expect(wrapper.text()).toContain('Traceroute')
    expect(wrapper.text()).toContain('DNS')
    expect(wrapper.text()).toContain('TCP')

    await buttonByText(wrapper, 'TCP').trigger('click')
    expect(wrapper.find('input[placeholder="80"]').exists()).toBe(true)
  })

  it('rejects an invalid TCP port before calling the backend', async () => {
    const { wrapper } = await render()

    await buttonByText(wrapper, 'TCP').trigger('click')
    await wrapper.find('input[placeholder="80"]').setValue('70000')
    await buttonByText(wrapper, '开始').trigger('click')

    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['TCP 端口必须是 1-65535 的整数', 'error'])
    expect(window.go?.main?.App?.StartNetworkDiagnostic).not.toHaveBeenCalled()
  })

  it('starts a ping diagnostic through the typed API wrapper', async () => {
    const { wrapper } = await render()

    await buttonByText(wrapper, '开始').trigger('click')
    await flushPromises()

    expect(window.go?.main?.App?.StartNetworkDiagnostic).toHaveBeenCalledWith({
      serverID: 1,
      type: 'ping',
      target: '8.8.8.8',
    })
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['网络诊断已启动', 'success'])
  })

  it('cancels the active diagnostic task', async () => {
    const { wrapper } = await render()

    await buttonByText(wrapper, '开始').trigger('click')
    await flushPromises()
    await buttonByText(wrapper, '取消').trigger('click')

    expect(window.go?.main?.App?.CancelNetworkDiagnostic).toHaveBeenCalledWith({
      serverID: 1,
      taskID: 'task-1',
    })
  })

  it('clears output and ignores late output after close', async () => {
    const { wrapper, store } = await render()

    await buttonByText(wrapper, '开始').trigger('click')
    await flushPromises()
    store.acceptNetworkDiagnosticOutput({
      serverID: 1,
      taskID: 'task-1',
      timestamp: '2026-06-19T00:00:00Z',
      line: 'reply from 8.8.8.8',
      stream: 'stdout',
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.network-diagnostics-output').text()).toContain('reply from 8.8.8.8')

    await buttonByText(wrapper, '清空').trigger('click')
    expect(store.diagnosticOutput['task-1']).toEqual([])

    await buttonByText(wrapper, '关闭').trigger('click')
    store.acceptNetworkDiagnosticOutput({
      serverID: 1,
      taskID: 'task-1',
      timestamp: '2026-06-19T00:00:00Z',
      line: 'late line',
      stream: 'stdout',
    })

    expect(wrapper.emitted('close')).toEqual([[]])
    expect(store.diagnosticOutput['task-1']).toEqual([])
    await flushPromises()
    expect(window.go?.main?.App?.CancelNetworkDiagnostic).toHaveBeenCalledWith({
      serverID: 1,
      taskID: 'task-1',
    })
  })

  it('uses compact refresh button text', async () => {
    const { wrapper } = await render()
    expect(wrapper.get('.network-diag-refresh-button').text()).toBe('刷新')
    expect(wrapper.get('.network-diag-refresh-button').attributes('title')).toBe('刷新接口列表')
  })

  it('adds compact select classes and full text titles', async () => {
    installBackend({
      interfaces: [
        networkInterface({ name: 'ens18', displayName: 'ens18' }),
        networkInterface({ name: 'lo', displayName: 'lo', isLoopback: true }),
      ],
    })
    const { wrapper } = await render({
      connections: [{ ...connection, name: '880' }],
    })

    expect(wrapper.find('.network-diag-server-select-field').exists()).toBe(true)
    expect(wrapper.find('.network-diag-interface-select-field').exists()).toBe(true)
    expect(wrapper.get('.network-diag-server-select').attributes('title')).toContain('root@192.0.2.1:22')
    expect(wrapper.get('.network-diag-server-select').text()).toContain('880')
    expect(wrapper.get('.network-diag-interface-select').text()).toContain('全部接口')
    expect(wrapper.get('.network-diag-interface-select').text()).toContain('全部物理')
    expect(wrapper.get('.network-diag-interface-select').text()).toContain('Docker 网络')
    expect(wrapper.get('.network-diag-interface-select').text()).toContain('ens18')
    expect(wrapper.get('.network-diag-interface-select').text()).toContain('lo')
    expect(wrapper.get('.network-diag-interface-select').attributes('title')).toBe('全部接口')
    expect(wrapper.get('.network-diag-interface-select option[value="all"]').attributes('title')).toContain('全部非 lo')
    expect(wrapper.get('.network-diag-interface-select option[value="ens18"]').attributes('title')).toBe('ens18')
  })

  it('keeps target input short and actions in one run row', async () => {
    const { wrapper } = await render()

    expect(wrapper.get('.network-diag-run-row').classes()).not.toContain('with-port')
    expect(wrapper.find('.network-diag-target-field').exists()).toBe(true)
    expect(wrapper.get('.network-diag-target-input').attributes('placeholder')).toBe('8.8.8.8')
    expect(wrapper.get('.network-diag-actions').classes()).toContain('network-diagnostics-actions')
    expect(wrapper.get('.network-diag-actions').text()).toContain('开始')
    expect(wrapper.get('.network-diag-actions').text()).toContain('取消')
    expect(wrapper.get('.network-diag-actions').text()).toContain('清空')
    expect(wrapper.get('.network-diag-actions').text()).toContain('复制')

    await buttonByText(wrapper, 'TCP').trigger('click')
    expect(wrapper.get('.network-diag-run-row').classes()).toContain('with-port')
    expect(wrapper.find('.network-diag-port-field').exists()).toBe(true)
  })

  it('removes the visible diagnostic task history select', async () => {
    installBackend({
      diagnosticTasks: [{
        taskID: 'task-done',
        serverID: 1,
        type: 'ping',
        target: '8.8.8.8',
        status: 'completed',
        startedAt: '2026-06-19T00:00:00Z',
      }],
    })
    const { wrapper } = await render()

    expect(wrapper.find('select[aria-label="诊断任务"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Ping · 8.8.8.8 · 已完成')
    expect(wrapper.get('.network-diag-status-badge').text()).toBe('已完成')
    expect(wrapper.get('.network-diag-status-badge').classes()).toContain('is-completed')
  })

  it('renders aligned colored status badges for every diagnostic status', async () => {
    const cases: Array<[DiagnosticTaskFixture['status'] | 'idle', string]> = [
      ['idle', '暂无任务'],
      ['running', '运行中'],
      ['completed', '已完成'],
      ['canceled', '已取消'],
      ['failed', '失败'],
    ]

    for (const [status, label] of cases) {
      installBackend({
        diagnosticTasks: status === 'idle'
          ? []
          : [{
              taskID: `task-${status}`,
              serverID: 1,
              type: 'ping',
              target: '8.8.8.8',
              status,
              startedAt: '2026-06-19T00:00:00Z',
            }],
      })
      const { wrapper } = await render()
      const badge = wrapper.get('.network-diag-status-badge')
      expect(badge.text()).toBe(label)
      expect(badge.classes()).toContain(`is-${status}`)
      expect(badge.attributes('aria-label')).toBe('诊断状态')
      wrapper.unmount()
    }
  })

  it('cancels all running diagnostics for the selected server on close', async () => {
    const { wrapper, store } = await render()
    store.diagnosticTasks[1] = [
      {
        taskID: 'task-a',
        serverID: 1,
        type: 'ping',
        target: '8.8.8.8',
        status: 'running',
        startedAt: '2026-06-19T00:00:00Z',
      },
      {
        taskID: 'task-b',
        serverID: 1,
        type: 'traceroute',
        target: 'baidu.com',
        status: 'running',
        startedAt: '2026-06-19T00:00:01Z',
      },
      {
        taskID: 'task-done',
        serverID: 1,
        type: 'dns',
        target: 'baidu.com',
        status: 'completed',
        startedAt: '2026-06-19T00:00:02Z',
      },
    ]

    await buttonByText(wrapper, '关闭').trigger('click')
    await flushPromises()

    expect(window.go?.main?.App?.CancelNetworkDiagnostic).toHaveBeenCalledWith({
      serverID: 1,
      taskID: 'task-a',
    })
    expect(window.go?.main?.App?.CancelNetworkDiagnostic).toHaveBeenCalledWith({
      serverID: 1,
      taskID: 'task-b',
    })
    expect(window.go?.main?.App?.CancelNetworkDiagnostic).not.toHaveBeenCalledWith({
      serverID: 1,
      taskID: 'task-done',
    })
  })
})
