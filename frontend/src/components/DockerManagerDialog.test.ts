// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DockerManagerDialog from './DockerManagerDialog.vue'
import componentSource from './DockerManagerDialog.vue?raw'
import { useDockerStore } from '../stores/docker'
import dockerStoreSource from '../stores/docker?raw'
import backendSource from '../api/backend?raw'
import type { Connection, DockerComposeProject, DockerComposeService, DockerContainer } from '../types'

const dialog = vi.hoisted(() => ({
  confirmDialog: vi.fn(async () => true),
}))

vi.mock('../composables/useAppDialog', () => ({
  confirmDialog: dialog.confirmDialog,
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

const runningContainer: DockerContainer = {
  id: 'abc123',
  shortID: 'abc123',
  name: 'web',
  image: 'nginx:latest',
  command: '"nginx"',
  createdAt: '',
  status: 'Up 2 hours',
  state: 'running',
  ports: '0.0.0.0:80->80/tcp',
  labels: '',
  size: '0B',
  serverID: 7,
}

const stoppedContainer: DockerContainer = {
  ...runningContainer,
  id: 'def456',
  shortID: 'def456',
  name: 'cache',
  image: 'redis:7',
  status: 'Exited (0) 1 hour ago',
  state: 'exited',
  ports: '',
}

const longContainer: DockerContainer = {
  ...runningContainer,
  id: 'long999',
  shortID: 'long999',
  name: 'very-long-container-name-that-should-never-push-actions-out-of-view',
  image: 'registry.example.com/namespace/very-long-image-name-with-many-segments/serverpilot-test-image:2026.06.19-long-tag',
  status: 'Up 12 days (healthy) with a deliberately long status string',
  ports: '0.0.0.0:12345->12345/tcp, [::]:12345->12345/tcp',
}

const composeProjects: DockerComposeProject[] = [
  {
    serverID: 7,
    name: 'edge',
    status: 'running(2)',
    configFiles: '/srv/edge/compose.yml',
    workingDir: '/srv/edge',
  },
  {
    serverID: 7,
    name: 'ops',
    status: 'exited(1)',
    configFiles: '/srv/ops/compose.yml',
    workingDir: '/srv/ops',
  },
]

const composeServices: DockerComposeService[] = [
  {
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
  },
  {
    serverID: 7,
    id: 'svc2',
    name: 'edge-db-1',
    project: 'edge',
    service: 'db',
    image: 'postgres:16',
    command: '',
    state: 'exited',
    status: 'Exit 0',
    health: '',
    ports: '',
    exitCode: 0,
  },
]

function batchResponse(containerID: string, action: string, skippedCount = 0) {
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
    skippedCount,
  }
}

function app() {
  return window.go!.main!.App!
}

function mountDialog() {
  setActivePinia(createPinia())
  return mount(DockerManagerDialog, {
    props: {
      open: true,
      connections: [connection],
      activeServerId: 7,
    },
  })
}

function installClipboardMock() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined),
    },
  })
}

async function flush() {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('DockerManagerDialog', () => {
  beforeEach(() => {
    vi.useRealTimers()
    dialog.confirmDialog.mockReset()
    dialog.confirmDialog.mockResolvedValue(true)
    installClipboardMock()
    window.go = {
      main: {
        App: {
          DockerCheck: vi.fn(async () => ({
            serverID: 7,
            available: true,
            version: '27.3.1',
            error: '',
            lastRefreshAt: '',
            containers: [],
          })),
          DockerCheckWithOptions: vi.fn(async () => ({
            serverID: 7,
            available: true,
            version: '27.3.1',
            error: '',
            lastRefreshAt: '',
            containers: [],
          })),
          DockerListContainers: vi.fn(async () => [runningContainer, stoppedContainer]),
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
          DockerGetContainerStats: vi.fn(async () => ({
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
          })),
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
          DockerComposeCheckWithOptions: vi.fn(async () => ({
            serverID: 7,
            available: true,
            command: 'docker compose',
            version: 'v2.27.1',
            error: '',
            lastRefreshAt: '',
          })),
          DockerComposeListProjects: vi.fn(async () => composeProjects),
          DockerComposeGetServices: vi.fn(async () => ({
            serverID: 7,
            projectName: 'edge',
            services: composeServices,
            timestamp: '2026-07-03T00:00:00Z',
          })),
          DockerComposeGetServiceDetail: vi.fn(async () => composeServices[0]),
          DockerComposeGetLogs: vi.fn(async (request: { serviceName?: string }) => ({
            serverID: 7,
            projectName: 'edge',
            serviceName: request.serviceName ?? '',
            output: request.serviceName
              ? 'edge-web-1  selected service synthetic log\n'
              : 'edge-web-1  synthetic compose log\nedge-db-1  synthetic compose log\n',
            truncated: false,
            timestamp: '2026-07-03T00:00:00Z',
          })),
        } as never,
      },
    }
  })

  it('opens from the active server and renders the container list', async () => {
    const wrapper = mountDialog()
    await flush()
    expect(app().DockerCheck).toHaveBeenCalledWith(7)
    expect(app().DockerListContainers).toHaveBeenCalledWith({ serverID: 7 })
    expect(wrapper.findAll('[data-testid="docker-container-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('nginx:latest')
    expect(wrapper.text()).toContain('redis:7')
  })

  it('uses compact container cards and exposes row connect and inspect shortcuts', async () => {
    const wrapper = mountDialog()
    await flush()
    const rows = wrapper.findAll('[data-testid="docker-container-row"]')
    expect(rows[0].classes()).toContain('docker-container-card')
    expect(rows[0].find('[data-testid="docker-row-checkbox"]').exists()).toBe(true)
    for (const row of rows) {
      expect(row.find('.container-main').exists()).toBe(true)
      expect(row.find('.container-meta').exists()).toBe(true)
      expect(row.find('.container-stats').exists()).toBe(true)
      expect(row.find('.container-actions').exists()).toBe(true)
      expect(row.find('.container-name').exists()).toBe(true)
      expect(row.find('.container-image').exists()).toBe(true)
      expect(row.find('.container-id').exists()).toBe(true)
      expect(row.findAll('.container-stats span')).toHaveLength(2)
    }
    expect(rows[0].find('[data-testid="docker-logs"]').exists()).toBe(false)
    expect(rows[0].find('[data-testid="docker-stats"]').exists()).toBe(false)
    expect(rows[0].findAll('.container-actions button').map((button) => button.attributes('data-testid'))).toEqual([
      'docker-stop',
      'docker-restart',
      'docker-connect-container',
      'docker-inspect',
    ])
    await rows[0].find('[data-testid="docker-connect-container"]').trigger('click')
    expect(wrapper.emitted('connectContainer')).toEqual([[
      { serverID: 7, containerID: 'abc123', containerName: 'web' },
    ]])
    expect(rows[0].find('[data-testid="docker-inspect"]').exists()).toBe(true)
    await rows[0].find('[data-testid="docker-inspect"]').trigger('click')
    await flush()
    expect(app().DockerGetContainerInspectSummary).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
    expect(wrapper.find('[data-testid="docker-inspect-panel"]').exists()).toBe(true)
    await wrapper.findAll('.detail-tabs button')[1].trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="docker-refresh-stats"]').exists()).toBe(true)
    await wrapper.findAll('.detail-tabs button')[2].trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="docker-refresh-inspect"]').exists()).toBe(true)
  })

  it('uses a compact current-server field and aligned toolbar controls', async () => {
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.get('.docker-server-select-field').find('[data-testid="docker-server-select"]').exists()).toBe(true)
    expect(wrapper.get('.docker-search-field').find('[data-testid="docker-search"]').exists()).toBe(true)
    expect(wrapper.get('.docker-filter-field').find('[data-testid="docker-filter"]').exists()).toBe(true)
    expect(componentSource).toContain('.docker-server-select-field')
    expect(componentSource).toContain('flex: 0 1 420px;')
    expect(componentSource).toContain('max-width: 520px;')
    expect(componentSource).toContain('align-items: end;')
  })

  it('keeps single and multi-container action areas complete', async () => {
    const wrapper = mountDialog()
    await flush()
    const rows = wrapper.findAll('[data-testid="docker-container-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.container-actions').exists()).toBe(true)
    expect(rows[0].find('[data-testid="docker-stop"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="docker-restart"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="docker-connect-container"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="docker-inspect"]').exists()).toBe(true)
    expect(rows[1].find('.container-actions').exists()).toBe(true)
    expect(rows[1].find('[data-testid="docker-start"]').exists()).toBe(true)
    expect(rows[1].find('[data-testid="docker-remove"]').exists()).toBe(true)
    expect(rows[1].find('[data-testid="docker-connect-container"]').exists()).toBe(false)
    expect(rows[1].find('[data-testid="docker-inspect"]').exists()).toBe(true)

    await wrapper.get('[data-testid="docker-search"]').setValue('web')
    await flush()
    const singleRow = wrapper.get('[data-testid="docker-container-row"]')
    expect(singleRow.find('.container-actions').exists()).toBe(true)
    expect(singleRow.find('[data-testid="docker-stop"]').exists()).toBe(true)
    expect(singleRow.find('[data-testid="docker-restart"]').exists()).toBe(true)
    expect(singleRow.find('[data-testid="docker-connect-container"]').exists()).toBe(true)
    expect(singleRow.find('[data-testid="docker-inspect"]').exists()).toBe(true)
  })

  it('keeps long names and images in ellipsis-safe columns instead of pushing actions away', async () => {
    app().DockerListContainers = vi.fn(async () => [longContainer, stoppedContainer]) as never
    const wrapper = mountDialog()
    await flush()
    const row = wrapper.findAll('[data-testid="docker-container-row"]')[0]
    expect(row.find('.container-name').attributes('title')).toBe(longContainer.name)
    expect(row.find('.container-image').attributes('title')).toBe(longContainer.image)
    expect(row.find('.container-id').text()).toBe(longContainer.shortID)
    expect(row.find('.container-stats').text()).toContain('CPU —')
    expect(row.find('.container-stats').text()).toContain('MEM —')
    expect(row.find('.container-actions').exists()).toBe(true)
    expect(row.find('[data-testid="docker-stop"]').exists()).toBe(true)
    expect(row.find('[data-testid="docker-restart"]').exists()).toBe(true)
    expect(row.find('[data-testid="docker-connect-container"]').exists()).toBe(true)
    expect(row.find('[data-testid="docker-inspect"]').exists()).toBe(true)
  })

  it('locks the container list CSS against horizontal clipping regressions', () => {
    expect(componentSource).toContain('grid-template-columns: minmax(460px, 0.88fr) minmax(520px, 1.12fr);')
    expect(componentSource).toContain('overflow-x: hidden;')
    expect(componentSource).toContain('grid-template-columns: 28px minmax(160px, 1fr) minmax(104px, 112px) minmax(92px, 104px) minmax(154px, 164px);')
    expect(componentSource).toContain('.container-actions {\n  min-width: 0;\n  overflow: visible;')
    expect(componentSource).toContain('@media (max-width: 1120px)')
    expect(componentSource).toContain('@media (max-width: 620px)')
  })

  it('shows a Chinese Docker unavailable message', async () => {
    app().DockerCheck = vi.fn(async () => ({
      serverID: 7,
      available: false,
      version: '',
      error: '服务器未检测到 Docker。',
      lastRefreshAt: '',
      containers: [],
    })) as never
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.text()).toContain('服务器未检测到 Docker。')
    expect(wrapper.emitted('notify')?.[0]).toEqual(['服务器未检测到 Docker。', 'error'])
  })

  it('shows Docker Compose unavailable state without rendering container management in the Compose view', async () => {
    app().DockerComposeCheck = vi.fn(async () => ({
      serverID: 7,
      available: false,
      command: '',
      version: '',
      error: '服务器未检测到 Docker Compose。',
      lastRefreshAt: '',
    })) as never
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()

    expect(app().DockerComposeCheck).toHaveBeenCalledWith(7)
    expect(wrapper.get('[data-testid="docker-compose-unavailable"]').text()).toContain('服务器未检测到 Docker Compose。')
    expect(wrapper.findAll('[data-testid="docker-container-row"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="docker-log-view"]').exists()).toBe(false)

    await wrapper.get('[data-testid="docker-containers-tab"]').trigger('click')
    await flush()
    expect(wrapper.findAll('[data-testid="docker-container-row"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="docker-log-view"]').exists()).toBe(true)
  })

  it('lists Docker Compose projects and selected project services', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()

    expect(app().DockerComposeCheck).toHaveBeenCalledWith(7)
    expect(app().DockerComposeListProjects).toHaveBeenCalledWith({ serverID: 7 })
    expect(app().DockerComposeGetServices).toHaveBeenCalledWith({ serverID: 7, projectName: 'edge' })
    expect(wrapper.findAll('[data-testid="docker-compose-project-row"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="docker-compose-service-row"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="docker-compose-services"]').text()).toContain('nginx:alpine')
    expect(wrapper.findAll('[data-testid="docker-container-row"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="docker-log-view"]').exists()).toBe(false)
  })

  it('keeps the Compose empty-project state visually quiet without the placeholder sentence', async () => {
    app().DockerComposeListProjects = vi.fn(async () => [])
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()

    expect(wrapper.find('[data-testid="docker-compose-panel"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无 Compose 项目。')
  })

  it('refreshes Docker Compose logs as a bounded snapshot', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="docker-compose-refresh-logs"]').trigger('click')
    await flush()

    expect(app().DockerComposeGetLogs).toHaveBeenCalledWith({ serverID: 7, projectName: 'edge', tailLines: 200, serviceName: 'web' })
    expect(wrapper.get('[data-testid="docker-compose-logs"]').text()).toContain('selected service synthetic log')
  })

  it('renders read-only Compose refresh, filter, detail, logs, copy, and clear controls without destructive actions', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()

    expect(wrapper.text()).not.toContain('Docker 可用')
    expect(wrapper.text()).not.toContain('已检测到 Docker')
    expect(wrapper.text()).not.toContain('Refresh Services')
    expect(wrapper.text()).not.toContain('Follow')
    expect(wrapper.text()).not.toContain('Pause')
    expect(wrapper.text()).not.toContain('Copy')
    expect(wrapper.text()).not.toContain('Clear')
    expect(wrapper.find('[data-testid="docker-compose-refresh"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-refresh-services"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-filter"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-service-filter"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-service-toolbar"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="docker-compose-service-count"]').text()).toBe('2 个服务')
    expect(wrapper.find('[data-testid="docker-compose-service-detail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-follow-logs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-pause-logs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-tail-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-copy-logs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="docker-compose-clear-logs"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="docker-compose-refresh-services"]').text()).toBe('刷新服务')
    expect(wrapper.get('[data-testid="docker-compose-follow-logs"]').text()).toBe('跟随')
    expect(wrapper.get('[data-testid="docker-compose-pause-logs"]').text()).toBe('暂停')
    expect(wrapper.get('[data-testid="docker-compose-copy-logs"]').text()).toBe('复制')
    expect(wrapper.get('[data-testid="docker-compose-clear-logs"]').text()).toBe('清空')

    const composeActions = wrapper.get('[data-testid="docker-compose-action-row"]')
    expect(composeActions.findAll('.command-light-action').map((button) => button.text())).toEqual([
      '刷新服务',
      '刷新日志',
      '跟随',
      '暂停',
      '复制',
      '清空',
    ])
    expect(composeActions.get('[data-testid="docker-compose-tail-control"]').text()).toContain('最近行数')
    expect(composeActions.get('[data-testid="docker-compose-tail-control"]').text()).toContain('200')
    expect(composeActions.findAll('.command-action-separator').map((separator) => separator.text())).toEqual(['|', '|', '|', '|', '|', '|'])
    expect(componentSource).toContain('.docker-compose-action-row {')
    expect(componentSource).toContain('flex-wrap: nowrap;')
    expect(componentSource).toContain('.docker-compose-section-header > div:not(.docker-compose-action-row)')
    expect(componentSource).toContain('.docker-compose-service-toolbar {')
    expect(componentSource).toContain('grid-template-rows: auto auto auto auto minmax(120px, 1fr) auto;')
    expect(componentSource).not.toContain('grid-template-rows: auto auto minmax(72px, auto) auto minmax(120px, 1fr) auto;')
    expect(componentSource).not.toContain('min-height: 72px;')
    expect(componentSource).toContain('max-height: 118px;')
    expect(componentSource).not.toContain('grid-template-rows: auto auto minmax(88px, 0.9fr) auto minmax(0, 1fr) auto;')
    expect(componentSource).toContain('.docker-compose-tail {')
    expect(componentSource).toContain('white-space: nowrap;')
    expect(componentSource).toContain('.docker-compose-project-filter {')
    expect(componentSource).toContain('grid-template-columns: auto minmax(0, 1fr);')

    const logActions = wrapper.get('[data-testid="docker-compose-log-actions"]')
    expect(logActions.findAll('.command-light-action').map((button) => button.text())).toEqual(['跟随', '暂停', '复制', '清空'])
    expect(logActions.findAll('.command-action-separator')).toHaveLength(3)

    await wrapper.get('[data-testid="docker-compose-filter"]').setValue('ops')
    await flush()
    expect(wrapper.findAll('[data-testid="docker-compose-project-row"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="docker-compose-project-row"]').text()).toContain('ops')

    await wrapper.get('[data-testid="docker-compose-filter"]').setValue('')
    await wrapper.get('[data-testid="docker-compose-service-filter"]').setValue('db')
    await flush()
    expect(wrapper.findAll('[data-testid="docker-compose-service-row"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="docker-compose-service-row"]').text()).toContain('postgres:16')

    const composeButtonLabels = wrapper.find('[data-testid="docker-compose-panel"]').findAll('button')
      .map((button) => button.text().trim().toLowerCase())
    for (const label of ['up', 'down', 'restart', 'stop', 'start', 'remove', 'build', 'pull', 'exec']) {
      expect(composeButtonLabels).not.toContain(label)
    }
  })

  it('uses lightweight tabs and keeps Compose detail content scrollable instead of clipped', async () => {
    const wrapper = mountDialog()
    await flush()
    const modeTabs = wrapper.get('.docker-mode-tabs')
    expect(modeTabs.findAll('.command-light-action').map((button) => button.text())).toEqual(['容器', 'Compose'])
    expect(modeTabs.findAll('.command-action-separator')).toHaveLength(1)
    expect(componentSource).toContain('.docker-mode-tabs .command-light-action { min-height: 30px; font-size: 14px;')

    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()
    expect(componentSource).toContain('.docker-compose-panel')
    expect(componentSource).toContain('grid-template-rows: minmax(0, 1fr);')
    expect(componentSource).toContain('padding-bottom: 16px;')
    expect(wrapper.find('.detail-tabs').exists()).toBe(false)

    await wrapper.get('[data-testid="docker-containers-tab"]').trigger('click')
    await flush()
    const detailTabs = wrapper.get('.detail-tabs')
    expect(detailTabs.findAll('.command-light-action').map((button) => button.text())).toEqual(['日志', '资源', '信息'])
    expect(detailTabs.findAll('.command-action-separator')).toHaveLength(2)
  })

  it('keeps container log actions Chinese, lightweight, and on one compact row', async () => {
    const wrapper = mountDialog()
    await flush()

    const actions = wrapper.get('[data-testid="docker-container-log-actions"]')
    expect(actions.findAll('.command-light-action').map((button) => button.text())).toEqual(['刷新日志', '实时追踪', '清空显示'])
    expect(actions.findAll('.command-action-separator').map((separator) => separator.text())).toEqual(['|', '|', '|'])
    expect(actions.get('[data-testid="docker-container-tail-control"]').text()).toContain('最近行数')
    expect(actions.get<HTMLInputElement>('[data-testid="docker-container-tail-input"]').element.value).toBe('200')
    expect(actions.element.lastElementChild).toBe(actions.get('[data-testid="docker-container-tail-control"]').element)
    expect(componentSource).toContain('.detail-actions {')
    expect(componentSource).toContain('flex-wrap: nowrap;')
    expect(componentSource).toContain('.detail-tail-control {')
    expect(componentSource).toContain('white-space: nowrap;')
  })

  it('follows, pauses, resumes, clears, and copies bounded Compose service logs', async () => {
    vi.useFakeTimers()
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-compose-tab"]').trigger('click')
    await flush()
    await wrapper.findAll('[data-testid="docker-compose-service-row"]')[0].trigger('click')
    await flush()
    await wrapper.get('[data-testid="docker-compose-tail-select"]').setValue('1000')
    await wrapper.get('[data-testid="docker-compose-follow-logs"]').trigger('click')
    await vi.advanceTimersByTimeAsync(3000)
    await flush()

    expect(app().DockerComposeGetServiceDetail).toHaveBeenCalledWith({ serverID: 7, projectName: 'edge', serviceName: 'web' })
    expect(app().DockerComposeGetLogs).toHaveBeenCalledWith({ serverID: 7, projectName: 'edge', tailLines: 1000, serviceName: 'web' })
    const callsAfterFollow = vi.mocked(app().DockerComposeGetLogs).mock.calls.length

    await wrapper.get('[data-testid="docker-compose-pause-logs"]').trigger('click')
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(vi.mocked(app().DockerComposeGetLogs).mock.calls).toHaveLength(callsAfterFollow)

    await wrapper.get('[data-testid="docker-compose-pause-logs"]').trigger('click')
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(vi.mocked(app().DockerComposeGetLogs).mock.calls.length).toBeGreaterThan(callsAfterFollow)

    await wrapper.get('[data-testid="docker-compose-copy-logs"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('selected service synthetic log'))
    await wrapper.get('[data-testid="docker-compose-clear-logs"]').trigger('click')
    await flush()
    expect(wrapper.get('[data-testid="docker-compose-logs"]').text()).not.toContain('selected service synthetic log')

    wrapper.unmount()
    const callsAfterClose = vi.mocked(app().DockerComposeGetLogs).mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(vi.mocked(app().DockerComposeGetLogs).mock.calls).toHaveLength(callsAfterClose)
    vi.useRealTimers()
  })

  it('keeps Docker Compose API access injected through the Wails app boundary', () => {
    expect(componentSource).not.toContain('../api/backend')
    expect(componentSource).not.toContain('wailsjs/go/main/App')
    expect(dockerStoreSource).toContain('composeCheck')
    expect(backendSource).toContain('DockerComposeCheck')
  })

  it('offers current-user and sudo retry execution modes for Docker permission failures', async () => {
    app().DockerCheck = vi.fn(async () => ({
      serverID: 7,
      available: false,
      version: '',
      error: 'Docker Manager 使用独立 SSH 执行，不会继承终端中 su/root 状态。当前用户无权限访问 Docker，可使用 sudo 重试。',
      lastRefreshAt: '',
      containers: [],
    }))
    app().DockerCheckWithOptions = vi.fn(async () => ({
      serverID: 7,
      available: true,
      version: '27.3.1',
      error: '',
      lastRefreshAt: '',
      containers: [],
    }))
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.get('[data-testid="docker-permission-help"]').text()).toContain('独立 SSH 执行')
    expect(wrapper.get('[data-testid="docker-execution-current"]').classes()).toContain('active')
    await wrapper.get('[data-testid="docker-execution-sudo"]').trigger('click')
    await flush()

    expect(wrapper.get('[data-testid="docker-execution-sudo"]').classes()).toContain('active')
    expect(app().DockerCheckWithOptions).toHaveBeenLastCalledWith({ serverID: 7, executionMode: 'sudo' })
    expect(app().DockerListContainers).toHaveBeenLastCalledWith({ serverID: 7, executionMode: 'sudo' })
  })

  it('uses theme tokens for Docker dialog and Compose surfaces in light mode', () => {
    for (const forbidden of ['#0f172a', '#111827', '#020617', 'rgba(15, 23, 42', 'rgba(2, 6, 23']) {
      expect(componentSource).not.toContain(forbidden)
    }
    expect(componentSource).toContain('var(--docker-dialog-backdrop)')
    expect(componentSource).toContain('var(--docker-panel-bg)')
    expect(componentSource).toContain('var(--docker-console-bg)')
  })

  it('searches and filters containers', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-search"]').setValue('redis')
    expect(wrapper.findAll('[data-testid="docker-container-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('cache')
    await wrapper.get('[data-testid="docker-filter"]').setValue('running')
    expect(wrapper.findAll('[data-testid="docker-container-row"]')).toHaveLength(0)
  })

  it('supports checkbox selection, select-all, and does not switch detail from checkbox clicks', async () => {
    const wrapper = mountDialog()
    await flush()
    let rows = wrapper.findAll('[data-testid="docker-container-row"]')
    await rows[1].trigger('click')
    await flush()
    expect(wrapper.findAll('[data-testid="docker-container-row"]')[1].classes()).toContain('selected')

    await rows[0].find('[data-testid="docker-row-checkbox"]').setValue(true)
    await flush()
    rows = wrapper.findAll('[data-testid="docker-container-row"]')
    expect(rows[1].classes()).toContain('selected')
    expect(wrapper.get('[data-testid="docker-batch-bar"]').text()).toContain('已选 1 个')
    expect((wrapper.get('[data-testid="docker-select-all"]').element as HTMLInputElement).indeterminate).toBe(true)

    await wrapper.get('[data-testid="docker-select-all"]').setValue(true)
    await flush()
    expect(wrapper.get('[data-testid="docker-batch-bar"]').text()).toContain('已选 2 个')
    rows = wrapper.findAll('[data-testid="docker-container-row"]')
    expect(rows.every((row) =>
      row.find('.container-main').exists() &&
      row.find('.container-meta').exists() &&
      row.find('.container-stats').exists() &&
      row.find('.container-actions').exists(),
    )).toBe(true)
    await wrapper.get('[data-testid="docker-select-all"]').setValue(false)
    await flush()
    expect(wrapper.find('[data-testid="docker-batch-bar"]').exists()).toBe(false)
  })

  it('starts a stopped container and refreshes the list', async () => {
    const wrapper = mountDialog()
    await flush()
    const rows = wrapper.findAll('[data-testid="docker-container-row"]')
    await rows[1].find('[data-testid="docker-start"]').trigger('click')
    await flush()
    expect(app().DockerStartContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'def456' })
    expect(wrapper.emitted('notify')?.some((event) => String(event[0]).includes('已启动'))).toBe(true)
  })

  it('confirms stop, restart, and stopped-container delete operations', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('[data-testid="docker-container-row"]')[0].find('[data-testid="docker-stop"]').trigger('click')
    await flush()
    await wrapper.findAll('[data-testid="docker-container-row"]')[0].find('[data-testid="docker-restart"]').trigger('click')
    await flush()
    await wrapper.findAll('[data-testid="docker-container-row"]')[1].find('[data-testid="docker-remove"]').trigger('click')
    await flush()
    expect(dialog.confirmDialog).toHaveBeenCalledTimes(3)
    expect(app().DockerStopContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
    expect(app().DockerRestartContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
    expect(app().DockerRemoveContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'def456' })
  })

  it('shows a toast instead of calling batch delete when no selected container is removable', async () => {
    const wrapper = mountDialog()
    await flush()
    const row = wrapper.findAll('[data-testid="docker-container-row"]')[0]
    expect(row.find('[data-testid="docker-remove"]').exists()).toBe(false)
    await row.find('[data-testid="docker-row-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="docker-batch-remove"]').trigger('click')
    await flush()
    expect(app().DockerBatchRemoveContainers).not.toHaveBeenCalled()
    expect(wrapper.emitted('notify')?.some((event) => event[0] === '没有可删除的已停止容器，请先停止容器。')).toBe(true)
  })

  it('runs batch actions only for eligible selected containers and reports skipped rows', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="docker-select-all"]').setValue(true)
    await flush()
    expect(wrapper.get('[data-testid="docker-batch-bar"]').text()).toContain('已选 2 个')

    await wrapper.get('[data-testid="docker-batch-start"]').trigger('click')
    await flush()
    expect(app().DockerBatchStartContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['def456'] })
    expect(wrapper.emitted('notify')?.some((event) => String(event[0]).includes('跳过 1 个'))).toBe(true)

    await wrapper.get('[data-testid="docker-batch-stop"]').trigger('click')
    await flush()
    expect(app().DockerBatchStopContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['abc123'] })

    await wrapper.get('[data-testid="docker-batch-restart"]').trigger('click')
    await flush()
    expect(app().DockerBatchRestartContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['abc123'] })

    await wrapper.get('[data-testid="docker-batch-remove"]').trigger('click')
    await flush()
    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: '将删除 1 个已停止容器，跳过 1 个运行中或不可删除容器。此操作无法撤销。',
      confirmText: '删除容器',
      danger: true,
    }))
    expect(app().DockerBatchRemoveContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['def456'] })
    expect(wrapper.emitted('notify')?.some((event) => String(event[0]).includes('批量删除完成：成功 1 个，失败 0 个，跳过 1 个。'))).toBe(true)
  })

  it('shows no-eligible toasts for batch start, stop, and restart', async () => {
    const wrapper = mountDialog()
    await flush()
    const store = useDockerStore()

    await wrapper.findAll('[data-testid="docker-container-row"]')[0].find('[data-testid="docker-row-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="docker-batch-start"]').trigger('click')
    await flush()
    expect(app().DockerBatchStartContainers).not.toHaveBeenCalled()
    expect(wrapper.emitted('notify')?.some((event) => event[0] === '没有可启动的已停止容器。')).toBe(true)

    store.clearSelection(7)
    await flush()
    await wrapper.findAll('[data-testid="docker-container-row"]')[1].find('[data-testid="docker-row-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="docker-batch-stop"]').trigger('click')
    await wrapper.get('[data-testid="docker-batch-restart"]').trigger('click')
    await flush()
    expect(app().DockerBatchStopContainers).not.toHaveBeenCalled()
    expect(app().DockerBatchRestartContainers).not.toHaveBeenCalled()
    expect(wrapper.emitted('notify')?.some((event) => event[0] === '没有可停止的运行中容器。')).toBe(true)
    expect(wrapper.emitted('notify')?.some((event) => event[0] === '没有可重启的运行中容器。')).toBe(true)
  })

  it('does not call batch delete API when the danger confirmation is cancelled', async () => {
    dialog.confirmDialog.mockResolvedValue(false)
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('[data-testid="docker-container-row"]')[1].find('[data-testid="docker-row-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="docker-batch-remove"]').trigger('click')
    await flush()
    expect(app().DockerBatchRemoveContainers).not.toHaveBeenCalled()
  })

  it('loads logs and toggles log follow without persisting logs elsewhere', async () => {
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.get('[data-testid="docker-log-view"]').text()).toContain('one')
    await wrapper.get('[data-testid="docker-follow-logs"]').trigger('click')
    await flush()
    expect(app().DockerStartLogStream).toHaveBeenCalledWith({
      serverID: 7,
      containerID: 'abc123',
      tailLines: 200,
      streamID: '',
    })
    await wrapper.get('[data-testid="docker-follow-logs"]').trigger('click')
    await flush()
    expect(app().DockerStopLogStream).toHaveBeenCalledWith({ serverID: 7, streamID: 'stream-1' })
  })

  it('shows stats and inspect summary panels', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('.detail-tabs button')[1].trigger('click')
    await flush()
    await wrapper.get('[data-testid="docker-refresh-stats"]').trigger('click')
    await flush()
    expect(wrapper.get('[data-testid="docker-stats-panel"]').text()).toContain('12.34%')
    await wrapper.findAll('.detail-tabs button')[2].trigger('click')
    await flush()
    await wrapper.get('[data-testid="docker-refresh-inspect"]').trigger('click')
    await flush()
    expect(wrapper.get('[data-testid="docker-inspect-panel"]').text()).toContain('unless-stopped')
    expect(wrapper.text()).toContain('不会展示 Env 或完整 inspect 输出')
  })

  it('keeps container card stat placeholders stable after refreshing stats', async () => {
    const wrapper = mountDialog()
    await flush()
    let rows = wrapper.findAll('[data-testid="docker-container-row"]')
    expect(rows[0].findAll('.container-stats span')).toHaveLength(2)
    expect(rows[0].find('.container-stats').text()).toContain('CPU —')
    expect(rows[0].find('.container-stats').text()).toContain('MEM —')

    await wrapper.findAll('.detail-tabs button')[1].trigger('click')
    await flush()
    await wrapper.get('[data-testid="docker-refresh-stats"]').trigger('click')
    await flush()

    rows = wrapper.findAll('[data-testid="docker-container-row"]')
    expect(rows[0].findAll('.container-stats span')).toHaveLength(2)
    expect(rows[0].find('.container-stats').text()).toContain('CPU 12.34%')
    expect(rows[0].find('.container-stats').text()).toContain('MEM 10.00%')
    expect(rows[1].findAll('.container-stats span')).toHaveLength(2)
  })

  it('shows pending state while stopping a single container', async () => {
    let resolveStop: (() => void) | undefined
    app().DockerStopContainer = vi.fn(() => new Promise<void>((resolve) => {
      resolveStop = resolve
    })) as never
    const wrapper = mountDialog()
    await flush()

    const click = wrapper.findAll('[data-testid="docker-container-row"]')[0].find('[data-testid="docker-stop"]').trigger('click')
    await flush()
    const row = wrapper.findAll('[data-testid="docker-container-row"]')[0]
    expect(row.text()).toContain('停止中...')
    expect(row.find('[data-testid="docker-stop"]').text()).toBe('停止中')
    expect((row.find('[data-testid="docker-stop"]').element as HTMLButtonElement).disabled).toBe(true)

    resolveStop?.()
    await click
    await flush()
    expect(app().DockerStopContainer).toHaveBeenCalledWith({ serverID: 7, containerID: 'abc123' })
  })

  it('shows batch pending state while stopping eligible containers', async () => {
    let resolveBatchStop: ((value: ReturnType<typeof batchResponse>) => void) | undefined
    app().DockerBatchStopContainers = vi.fn(() => new Promise<ReturnType<typeof batchResponse>>((resolve) => {
      resolveBatchStop = resolve
    })) as never
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('[data-testid="docker-container-row"]')[0].find('[data-testid="docker-row-checkbox"]').setValue(true)

    const click = wrapper.get('[data-testid="docker-batch-stop"]').trigger('click')
    await flush()
    expect(wrapper.get('[data-testid="docker-batch-bar"]').text()).toContain('正在停止 1 个容器...')
    expect(wrapper.findAll('[data-testid="docker-container-row"]')[0].text()).toContain('停止中...')
    expect((wrapper.get('[data-testid="docker-batch-stop"]').element as HTMLButtonElement).disabled).toBe(true)

    resolveBatchStop?.(batchResponse('abc123', 'stop'))
    await click
    await flush()
    expect(app().DockerBatchStopContainers).toHaveBeenCalledWith({ serverID: 7, containerIDs: ['abc123'] })
  })

  it('stops active watchers when the dialog closes', async () => {
    const wrapper = mountDialog()
    await flush()
    const store = useDockerStore()
    store.activeLogStreams = { '7:abc123': 'stream-1' }
    store.activeStatsWatchers = { '7:abc123': 'watch-1' }
    await wrapper.get('.dialog-close-button').trigger('click')
    await flush()
    expect(app().DockerStopLogStream).toHaveBeenCalledWith({ serverID: 7, streamID: 'stream-1' })
    expect(app().DockerStopStatsWatch).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})
