// @vitest-environment jsdom

import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Connection, ProcessEntry } from '../types'
import ProcessManagerDialog from './ProcessManagerDialog.vue'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads the local SFC source.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: string, encoding: string) => string }
// @ts-expect-error The app tsconfig intentionally omits Node globals; this test resolves a local SFC source path.
const { resolve } = await import('node:path') as { resolve: (...parts: string[]) => string }
const processDialogSource = readFileSync(resolve('src/components/ProcessManagerDialog.vue'), 'utf8')

const confirmDialogMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../composables/useAppDialog', () => ({
  confirmDialog: confirmDialogMock,
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

const connection: Connection = {
  id: 7,
  groupId: null,
  name: 'server',
  host: '192.0.2.7',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: '',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

const pidOne: ProcessEntry = {
  serverID: 7,
  pid: 1,
  ppid: 0,
  user: 'root',
  state: 'S',
  stateLabel: '睡眠',
  cpuPercent: 0.1,
  memoryPercent: 0.2,
  rssBytes: 1024,
  vszBytes: 2048,
  command: 'init',
  argsPreview: '/sbin/init',
  startedOrElapsed: '01:00',
  isKernelThread: false,
  canSignal: false,
}

const bash: ProcessEntry = {
  ...pidOne,
  pid: 42,
  ppid: 1,
  state: 'R',
  stateLabel: '运行',
  cpuPercent: 12.5,
  memoryPercent: 3.1,
  command: 'bash',
  argsPreview: 'bash -lc sleep 30',
  canSignal: true,
}

const cpuHeavy: ProcessEntry = {
  ...bash,
  pid: 88,
  user: 'deploy',
  cpuPercent: 20.5,
  memoryPercent: 1.2,
  command: 'python',
  argsPreview: 'python worker.py',
}

const memoryHeavy: ProcessEntry = {
  ...bash,
  pid: 108,
  ppid: 42,
  user: 'www-data',
  cpuPercent: 3.1,
  memoryPercent: 12.5,
  command: 'nginx',
  argsPreview: 'nginx: worker process',
}

const kworker: ProcessEntry = {
  ...bash,
  pid: 77,
  ppid: 2,
  user: 'root',
  state: 'I',
  stateLabel: '空闲',
  cpuPercent: 0,
  memoryPercent: 0,
  rssBytes: 0,
  vszBytes: 0,
  command: 'kworker/1:2-mm_percpu_wq',
  argsPreview: '[kworker/1:2-mm_percpu_wq]',
  isKernelThread: true,
  canSignal: false,
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function mountDialog(initialPid: number | null = null) {
  const pinia = createPinia()
  return mount(ProcessManagerDialog, {
    props: {
      open: true,
      connections: [connection],
      activeServerId: 7,
      initialPid,
    },
    global: { plugins: [pinia] },
  })
}

function app() {
  return window.go!.main!.App!
}

describe('ProcessManagerDialog', () => {
  it('uses shared glass tokens for the dialog shell and process surfaces', () => {
    expect(processDialogSource).toContain('background: var(--glass-backdrop-bg)')
    expect(processDialogSource).toContain('background: var(--glass-surface-bg)')
    expect(processDialogSource).toContain('border: 1px solid var(--glass-border')
    expect(processDialogSource).toContain('box-shadow: var(--glass-shadow)')
    expect(processDialogSource).toContain('backdrop-filter: var(--glass-blur)')
    expect(processDialogSource).toContain('-webkit-backdrop-filter: var(--glass-blur)')
    expect(processDialogSource).toContain('background: var(--glass-header-bg)')
    expect(processDialogSource).toContain('background: var(--glass-panel-bg)')
    expect(processDialogSource).toContain('background: var(--glass-card-bg)')
    expect(processDialogSource).not.toContain('background: var(--panel, #101827)')
  })

  beforeEach(() => {
    confirmDialogMock.mockClear()
    window.go = {
      main: {
        App: {
          ListProcesses: vi.fn(async (request: { query?: string }) => ({
            serverID: 7,
            processes: request.query === 'bash' ? [bash] : [pidOne, bash, cpuHeavy, memoryHeavy],
            warnings: ['部分进程无法读取。'],
            timestamp: '',
          })),
          GetProcessDetail: vi.fn(async (request: { pid: number }) => ({
            serverID: 7,
            pid: request.pid,
            ppid: request.pid === 42 ? 1 : 0,
            user: 'root',
            state: request.pid === 42 ? 'R' : 'S',
            stateLabel: request.pid === 42 ? '运行' : '睡眠',
            command: request.pid === 42 ? 'bash' : 'init',
            cmdline: request.pid === 42 ? 'bash -lc sleep 30' : '/sbin/init',
            rssBytes: 1024,
            vszBytes: 2048,
            memoryPercent: request.pid === 42 ? 3.1 : 0.2,
            cpuPercent: request.pid === 42 ? 12.5 : 0.1,
            environmentRedacted: true,
            children: request.pid === 1 ? [bash] : [],
            lastUpdatedAt: '',
            warnings: [],
            isKernelThread: false,
            canSignal: request.pid !== 1,
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders process table and opens the initially selected process detail', async () => {
    const wrapper = mountDialog(42)
    await settle()
    expect(wrapper.text()).toContain('进程管理')
    expect(wrapper.text()).toContain('bash')
    expect(app().GetProcessDetail).toHaveBeenCalledWith({ serverID: 7, pid: 42 })
    expect(wrapper.text()).toContain('环境变量')
    expect(wrapper.text()).toContain('已隐藏')
  })

  it('opens from TOP initialPid without writing a hidden query', async () => {
    const wrapper = mountDialog(42)
    await settle()
    expect((wrapper.find('.process-search input').element as HTMLInputElement).value).toBe('')
    expect(app().ListProcesses).toHaveBeenCalledWith({
      serverID: 7,
      query: '',
      sortBy: 'cpu',
      sortDir: 'desc',
      limit: 500,
    })
    expect(app().GetProcessDetail).toHaveBeenCalledWith({ serverID: 7, pid: 42 })
  })

  it('searches by command and keeps command line collapsed until expanded', async () => {
    const wrapper = mountDialog()
    await settle()
    await wrapper.find('.process-search input').setValue('bash')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await settle()
    expect(app().ListProcesses).toHaveBeenLastCalledWith({
      serverID: 7,
      query: 'bash',
      sortBy: 'cpu',
      sortDir: 'desc',
      limit: 500,
    })
    await wrapper.find('.process-table-row').trigger('click')
    await settle()
    expect(wrapper.find('.process-cmdline pre').exists()).toBe(false)
    await wrapper.find('.process-cmdline .text-button').trigger('click')
    expect(wrapper.find('.process-cmdline pre').text()).toContain('bash -lc sleep 30')
  })

  it('removes top sort controls and relies on sortable table headers', async () => {
    const wrapper = mountDialog()
    await settle()
    expect(wrapper.find('[aria-label="进程排序字段"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="进程排序方向"]').exists()).toBe(false)
    expect(wrapper.findAll('.process-table-head button').map((button) => button.text())).toEqual([
      'PID',
      '用户',
      'CPU↓',
      '内存',
      '命令',
    ])
    expect(wrapper.findAll('.process-table-head-cell')).toHaveLength(6)
    expect(wrapper.findAll('.table-sort-arrow')).toHaveLength(5)
    expect(wrapper.findAll('.table-sort-arrow').map((arrow) => arrow.text())).toEqual(['', '', '↓', '', ''])
    expect(wrapper.findAll('[data-testid^="process-column-resizer-"]')).toHaveLength(5)
    expect(processDialogSource).not.toContain('border-left: 1px solid rgba(148, 163, 184, 0.18)')
    expect(processDialogSource).toContain('.table-column-resizer::before')
    expect(processDialogSource).toContain('const processColumnWidths = ref([72, 96, 80, 88, 96, 150])')
    expect(wrapper.find('.process-table-head-shell').exists()).toBe(true)
    expect(processDialogSource).toContain('.process-table-head-shell {')
    expect(processDialogSource).not.toContain('margin-right: 18px;')
    expect(processDialogSource).not.toContain('max-width: calc(100% - 18px);')
    expect(processDialogSource).toContain('width: 100%;')
    expect(processDialogSource).toContain('overflow: hidden;')
    expect(processDialogSource).toContain('background: var(--glass-card-bg);')
    expect(processDialogSource).toContain('.process-table-head button {')
    expect(processDialogSource).toContain('justify-content: center;')
    expect(processDialogSource).toContain('text-align: center;')
    expect(processDialogSource).toContain('.process-table-row .numeric {')
    expect(processDialogSource).toContain('text-align: left;')
  })

  it('resizes process table columns by dragging header separators', async () => {
    const wrapper = mountDialog()
    await settle()
    const firstRow = wrapper.get('.process-table-row')
    const before = (firstRow.element as HTMLElement).style.gridTemplateColumns

    await wrapper.get('[data-testid="process-column-resizer-0"]').trigger('mousedown', { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 136 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await settle()

    expect((firstRow.element as HTMLElement).style.gridTemplateColumns).not.toBe(before)
  })

  it('sorts CPU and memory numerically from table headers', async () => {
    const wrapper = mountDialog()
    await settle()
    const rows = () => wrapper.findAll('.process-table-row').map((row) => row.text())

    expect(rows()[0]).toContain('python')

    await wrapper.findAll('.process-table-head button')[2].trigger('click')
    await settle()
    expect(rows()[0]).toContain('init')

    await wrapper.findAll('.process-table-head button')[3].trigger('click')
    await settle()
    expect(rows()[0]).toContain('nginx')
  })

  it('keeps numeric sorting after search, refresh, and realtime updates', async () => {
    const wrapper = mountDialog()
    await settle()
    await wrapper.findAll('.process-table-head button')[3].trigger('click')
    await settle()
    expect(wrapper.findAll('.process-table-row')[0].text()).toContain('nginx')

    await wrapper.find('.process-search input').setValue('n')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await settle()
    expect(wrapper.findAll('.process-table-row')[0].text()).toContain('nginx')

    await wrapper.findAll('.process-toolbar .secondary')[0].trigger('click')
    await settle()
    expect(wrapper.findAll('.process-table-row')[0].text()).toContain('nginx')

    await wrapper.findAll('.process-toolbar .secondary')[1].trigger('click')
    await settle()
    expect(app().StartProcessWatch).toHaveBeenLastCalledWith({
      serverID: 7,
      query: 'n',
      sortBy: 'memory',
      sortDir: 'desc',
      limit: 500,
      intervalMs: 2000,
    })
  })

  it('keeps the old list visible while refresh is pending', async () => {
    const wrapper = mountDialog()
    await settle()
    let resolveRefresh: (value: unknown) => void = () => undefined
    vi.mocked(app().ListProcesses).mockReturnValueOnce(new Promise((resolve) => {
      resolveRefresh = resolve
    }) as never)
    await wrapper.findAll('.process-toolbar .secondary')[0].trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('刷新中')
    expect(wrapper.text()).toContain('python')
    resolveRefresh({
      serverID: 7,
      processes: [memoryHeavy],
      warnings: [],
      timestamp: '',
    })
    await settle()
    expect(wrapper.text()).toContain('上次刷新')
    expect(wrapper.findAll('.process-table-row')).toHaveLength(1)
  })

  it('keeps old rows visible and shows list error when refresh fails', async () => {
    const wrapper = mountDialog()
    await settle()
    vi.mocked(app().ListProcesses).mockRejectedValueOnce(new Error('parser failed'))

    await wrapper.findAll('.process-toolbar .secondary')[0].trigger('click')
    await settle()

    expect(wrapper.findAll('.process-table-row')).toHaveLength(4)
    expect(wrapper.text()).toContain('读取进程列表失败')
    expect(wrapper.text()).not.toContain('未找到匹配进程')
    const notifications = wrapper.emitted('notify') ?? []
    expect(notifications[notifications.length - 1]).toEqual(['读取进程列表失败', 'error'])
  })

  it('shows quick detail immediately while supplemental detail is loading', async () => {
    let resolveDetail: (value: unknown) => void = () => undefined
    vi.mocked(app().ListProcesses).mockResolvedValueOnce({
      serverID: 7,
      processes: [bash],
      warnings: [],
      timestamp: '',
    } as never)
    vi.mocked(app().GetProcessDetail).mockImplementation(() => new Promise((resolve) => {
      resolveDetail = resolve
    }) as never)
    const wrapper = mountDialog()
    await settle()
    const row = wrapper.find('.process-table-row')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('bash')
    expect(wrapper.text()).toContain('正在补充详情')
    resolveDetail({
      serverID: 7,
      pid: 42,
      command: 'bash',
      cmdline: 'bash -lc sleep 30',
      environmentRedacted: true,
      children: [],
      warnings: [],
      canSignal: true,
    })
    await settle()
    expect(wrapper.text()).not.toContain('正在补充详情')
  })

  it('does not crash on null list or missing process resource fields', async () => {
    vi.mocked(app().ListProcesses).mockResolvedValueOnce({
      serverID: 7,
      processes: [
        { serverID: 7, pid: 200, command: 'weird', cpuPercent: '12.5%', memoryPercent: undefined },
        null,
      ],
      warnings: null,
      timestamp: '',
    } as never)
    const wrapper = mountDialog()
    await settle()
    expect(wrapper.find('[data-testid="process-manager-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('weird')
    expect(wrapper.text()).toContain('12.5%')
    expect(wrapper.text()).toContain('0.0%')
  })

  it('does not crash on nullable process detail fields', async () => {
    vi.mocked(app().GetProcessDetail).mockResolvedValueOnce({
      serverID: 7,
      pid: 42,
      command: 'bash',
      cmdline: null,
      children: null,
      warnings: null,
      cpuPercent: undefined,
      memoryPercent: '12.5%',
      rssBytes: undefined,
      vszBytes: undefined,
      environmentRedacted: true,
      canSignal: true,
    } as never)
    const wrapper = mountDialog(42)
    await settle()
    expect(wrapper.find('[data-testid="process-manager-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('bash')
    expect(wrapper.text()).toContain('12.5%')
    expect(wrapper.text()).toContain('子进程')
  })

  it('shows retryable list error instead of empty state on first load failure', async () => {
    vi.mocked(app().ListProcesses).mockRejectedValueOnce(new Error('刷新进程列表失败'))
    const wrapper = mountDialog()
    await settle()
    expect(wrapper.find('[data-testid="process-manager-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('读取进程列表失败，请点击刷新重试')
    expect(wrapper.text()).not.toContain('未找到匹配进程')
    expect(wrapper.emitted('notify')?.[0]).toEqual(['读取进程列表失败', 'error'])
  })

  it('does not display cached detail for a pid missing from the current list', async () => {
    vi.mocked(app().ListProcesses).mockResolvedValueOnce({
      serverID: 7,
      processes: [bash],
      warnings: [],
      timestamp: '',
    } as never)
    const wrapper = mountDialog(42)
    await settle()
    await wrapper.find('.process-cmdline .text-button').trigger('click')
    expect(wrapper.text()).toContain('bash -lc sleep 30')

    vi.mocked(app().ListProcesses).mockResolvedValueOnce({
      serverID: 7,
      processes: [memoryHeavy],
      warnings: [],
      timestamp: '',
    } as never)
    await wrapper.findAll('.process-toolbar .secondary')[0].trigger('click')
    await settle()

    expect(wrapper.text()).toContain('进程已退出或无法读取')
    expect(wrapper.text()).not.toContain('环境变量')
    expect(wrapper.text()).not.toContain('bash -lc sleep 30')
  })

  it('shows kernel threads in the list but disables signal actions', async () => {
    vi.mocked(app().ListProcesses).mockResolvedValueOnce({
      serverID: 7,
      processes: [kworker],
      warnings: [],
      timestamp: '',
    } as never)
    const wrapper = mountDialog(77)
    await settle()
    expect(wrapper.text()).toContain('kworker/1:2-mm_percpu_wq')
    expect(wrapper.text()).toContain('内核线程不能发送信号')
    const buttons = wrapper.findAll('.process-actions button')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()
  })

  it('shortens the search input and keeps toolbar controls aligned', () => {
    expect(processDialogSource).toContain('placeholder="搜索 PID / 用户 / 命令"')
    expect(processDialogSource).toContain('class="process-toolbar-actions"')
    expect(processDialogSource).toContain('flex: 0 1 300px')
    expect(processDialogSource).toContain('max-width: 340px')
    expect(processDialogSource).toContain('min-width: 220px')
    expect(processDialogSource).toContain('align-items: flex-end')
    expect(processDialogSource).toContain('align-items: center')
    expect(processDialogSource).toContain('flex-wrap: wrap')
  })

  it('starts realtime watcher and stops it when closing', async () => {
    const wrapper = mountDialog()
    await settle()
    await wrapper.findAll('.process-toolbar .secondary')[1].trigger('click')
    expect(app().StartProcessWatch).toHaveBeenCalledWith({
      serverID: 7,
      query: '',
      sortBy: 'cpu',
      sortDir: 'desc',
      limit: 500,
      intervalMs: 2000,
    })
    await wrapper.find('.dialog-close-button').trigger('click')
    expect(app().StopProcessWatch).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })
  })

  it('guards against concurrent realtime refresh pile-up', () => {
    expect(processDialogSource).toContain('if (loading.value) return')
  })

  it('disables protected pid 1 signal actions', async () => {
    const wrapper = mountDialog(1)
    await settle()
    expect(wrapper.text()).toContain('PID 1 是系统 init 进程，禁止操作')
    const buttons = wrapper.findAll('.process-actions button')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()
  })

  it('renders a compact detail title row with state badge before name and actions on the right', async () => {
    const wrapper = mountDialog(42)
    await settle()
    const panel = wrapper.get('.process-detail-panel')
    const header = panel.get('.process-detail-header')
    const title = header.get('.process-detail-title')
    const state = title.get('.process-state')
    const name = title.get('h3')
    const actions = header.get('.process-detail-actions')
    const facts = panel.get('.process-facts')

    expect(state.text()).toBe('运行')
    expect(name.text()).toBe('bash')
    expect(state.element.compareDocumentPosition(name.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.findAll('button').map((button) => button.text())).toEqual(['终止进程', '强制结束'])
    expect(panel.findAll('.process-actions')).toHaveLength(1)
    expect(actions.element.compareDocumentPosition(facts.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses compact detail cards and avoids large blank spacing', () => {
    expect(processDialogSource).toContain('class="process-detail-header"')
    expect(processDialogSource).toContain('process-detail-actions')
    expect(processDialogSource).not.toContain('process-actions-top')
    expect(processDialogSource).toContain('.process-detail-panel {\n  border-left: 1px solid var(--glass-border);\n  padding: 12px;')
    expect(processDialogSource).toContain('gap: 6px')
    expect(processDialogSource).toContain('margin: 10px 0')
    expect(processDialogSource).toContain('padding: 8px 10px')
    expect(processDialogSource).toContain('max-height: 120px')
  })

  it('confirms SIGTERM and SIGKILL before calling the backend', async () => {
    const wrapper = mountDialog(42)
    await settle()
    const buttons = wrapper.findAll('.process-actions button')
    await buttons[0].trigger('click')
    await settle()
    await buttons[1].trigger('click')
    await settle()
    expect(confirmDialogMock).toHaveBeenCalledTimes(2)
    expect(app().SignalProcess).toHaveBeenCalledWith({
      serverID: 7,
      pid: 42,
      signal: 'term',
      expectedCommand: 'bash',
    })
    expect(app().SignalProcess).toHaveBeenCalledWith({
      serverID: 7,
      pid: 42,
      signal: 'kill',
      expectedCommand: 'bash',
    })
  })
})
