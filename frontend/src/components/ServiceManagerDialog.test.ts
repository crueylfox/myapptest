// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ServiceManagerDialog from './ServiceManagerDialog.vue'
import componentSourceText from './ServiceManagerDialog.vue?raw'
import actionBarSourceText from './service-manager/ServiceActionBar.vue?raw'
import detailsSourceText from './service-manager/ServiceManagerDetails.vue?raw'
import journalSourceText from './service-manager/ServiceJournalPanel.vue?raw'
import type { Connection, ConnectionRuntimeState, ServiceManagerCapability, SystemServiceDetail, SystemServiceSummary } from '../types'

const dialog = vi.hoisted(() => ({
  confirmDialog: vi.fn(async () => true),
}))

const runtime = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
  eventsOn: vi.fn((name: string, callback: (event: unknown) => void) => {
    runtime.callbacks.set(name, callback)
  }),
  eventsOff: vi.fn((name: string) => {
    runtime.callbacks.delete(name)
  }),
}))

vi.mock('../composables/useAppDialog', () => ({
  confirmDialog: dialog.confirmDialog,
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: runtime.eventsOn,
  EventsOff: runtime.eventsOff,
}))

const online: Connection = {
  id: 7,
  groupId: null,
  name: 'debian',
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
const offline = { ...online, id: 8, name: 'offline', host: '192.0.2.8' }

const nginx: SystemServiceSummary = {
  serverID: 7,
  initSystem: 'systemd',
  serviceID: 'nginx.service',
  unitName: 'nginx.service',
  displayName: 'nginx.service',
  description: 'A high performance web server',
  loadState: 'loaded',
  activeState: 'active',
  subState: 'running',
  unitFileState: 'enabled',
  activeStateLabel: '运行中',
  unitFileStateLabel: '已启用',
  isActive: true,
  isFailed: false,
  isEnabled: true,
  canStart: false,
  canStop: true,
  canRestart: true,
  canEnable: false,
  canDisable: true,
  critical: false,
  protected: false,
}
const sshd: SystemServiceSummary = {
  ...nginx,
  serviceID: 'sshd.service',
  unitName: 'sshd.service',
  displayName: 'sshd.service',
  description: 'OpenSSH server daemon',
  activeState: 'active',
  subState: 'running',
  unitFileState: 'disabled',
  activeStateLabel: '运行中',
  unitFileStateLabel: '已禁用',
  isActive: true,
  isEnabled: false,
  canStart: false,
  canStop: true,
  canRestart: true,
  canEnable: true,
  canDisable: false,
  critical: true,
}
const docker: SystemServiceSummary = {
  ...nginx,
  serviceID: 'docker.service',
  unitName: 'docker.service',
  displayName: 'docker.service',
  description: 'Docker Application Container Engine',
  critical: true,
}
const failed: SystemServiceSummary = {
  ...nginx,
  serviceID: 'broken.service',
  unitName: 'broken.service',
  displayName: 'broken.service',
  description: 'Broken background job',
  activeState: 'failed',
  subState: 'failed',
  unitFileState: 'static',
  activeStateLabel: '失败',
  unitFileStateLabel: '静态',
  isActive: false,
  isFailed: true,
  isEnabled: false,
  canRestart: true,
  canDisable: false,
}
const dropbear: SystemServiceSummary = {
  serverID: 7,
  initSystem: 'openwrt-procd',
  serviceID: 'dropbear',
  unitName: 'dropbear',
  displayName: 'dropbear',
  description: 'OpenWrt init.d 服务',
  startupState: 'enabled',
  loadState: 'loaded',
  activeState: 'active',
  subState: 'running',
  unitFileState: 'enabled',
  activeStateLabel: '运行中',
  unitFileStateLabel: '已启用',
  isActive: true,
  isFailed: false,
  isEnabled: true,
  canStart: false,
  canStop: true,
  canRestart: true,
  canEnable: false,
  canDisable: true,
  critical: true,
  protected: false,
}
const network: SystemServiceSummary = {
  ...dropbear,
  serviceID: 'network',
  unitName: 'network',
  displayName: 'network',
}
const procdCore: SystemServiceSummary = {
  ...dropbear,
  serviceID: 'procd',
  unitName: 'procd',
  displayName: 'procd',
  protected: true,
  canStart: false,
  canStop: false,
  canRestart: false,
  canEnable: false,
  canDisable: false,
}

function runtimeState(connectionId: number, overrides: Partial<ConnectionRuntimeState> = {}): ConnectionRuntimeState {
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
    ...overrides,
  }
}

function capability(overrides: Partial<ServiceManagerCapability> = {}): ServiceManagerCapability {
  return {
    serverID: 7,
    available: true,
    initSystem: 'systemd',
    displayName: 'systemd 252',
    systemdVersion: '252',
    supportsJournal: true,
    supportsLiveLogs: true,
    supportsResourceMetrics: true,
    supportsStart: true,
    supportsStop: true,
    supportsRestart: true,
    supportsEnable: true,
    supportsDisable: true,
    canManage: true,
    requiresPrivilege: false,
    ...overrides,
  }
}

function openwrtCapability(overrides: Partial<ServiceManagerCapability> = {}): ServiceManagerCapability {
  return capability({
    initSystem: 'openwrt-procd',
    displayName: 'OpenWrt procd 23.05',
    systemdVersion: undefined,
    distributionName: 'OpenWrt',
    distributionVersion: '23.05',
    supportsJournal: true,
    supportsLiveLogs: false,
    supportsResourceMetrics: false,
    ...overrides,
  })
}

function detail(unitName = 'nginx.service'): SystemServiceDetail {
  return {
    serverID: 7,
    initSystem: 'systemd',
    serviceID: unitName,
    unitName,
    displayName: unitName,
    description: unitName === 'nginx.service' ? nginx.description : sshd.description,
    loadState: 'loaded',
    activeState: unitName === 'nginx.service' ? 'active' : 'inactive',
    subState: unitName === 'nginx.service' ? 'running' : 'dead',
    unitFileState: unitName === 'nginx.service' ? 'enabled' : 'disabled',
    activeStateLabel: unitName === 'nginx.service' ? '运行中' : '已停止',
    unitFileStateLabel: unitName === 'nginx.service' ? '已启用' : '已禁用',
    mainPID: unitName === 'nginx.service' ? 123 : 0,
    memoryCurrentBytes: 1024,
    cpuUsageNSec: 1000000,
    tasksCurrent: 8,
    restartCount: 1,
    fragmentPath: `/lib/systemd/system/${unitName}`,
    result: 'success',
    partial: false,
    warnings: [],
    critical: unitName === 'sshd.service',
    protected: false,
  }
}

function partialDetail(unitName = 'docker.service'): SystemServiceDetail {
  return {
    serverID: 7,
    initSystem: 'systemd',
    serviceID: unitName,
    unitName,
    displayName: unitName,
    description: 'Docker Application Container Engine',
    loadState: 'loaded',
    activeState: 'active',
    subState: 'running',
    unitFileState: 'enabled',
    activeStateLabel: '运行中',
    unitFileStateLabel: '已启用',
    mainPID: 1234,
    fragmentPath: `/usr/lib/systemd/system/${unitName}`,
    result: 'success',
    partial: true,
    warnings: ['当前 systemd 版本未提供部分资源字段。'],
    critical: unitName === 'docker.service',
    protected: false,
  }
}

function procdDetail(unitName = 'dropbear'): SystemServiceDetail {
  return {
    serverID: 7,
    initSystem: 'openwrt-procd',
    serviceID: unitName,
    unitName,
    displayName: unitName,
    description: 'OpenWrt init.d 服务',
    startupState: 'enabled',
    loadState: 'loaded',
    activeState: 'active',
    subState: 'running',
    unitFileState: 'enabled',
    activeStateLabel: '运行中',
    unitFileStateLabel: '已启用',
    mainPID: 0,
    scriptPath: `/etc/init.d/${unitName}`,
    distributionName: 'OpenWrt',
    distributionVersion: '23.05',
    lastUpdatedAt: '2026-06-21T10:00:00Z',
    partial: true,
    warnings: ['OpenWrt procd 不提供 systemd 资源字段，具体 PID 与资源占用请使用进程管理。'],
    critical: ['dropbear', 'network', 'firewall'].includes(unitName),
    protected: unitName === 'procd',
  }
}

function app() {
  return window.go!.main!.App!
}

function mountDialog(props: Partial<InstanceType<typeof ServiceManagerDialog>['$props']> = {}) {
  setActivePinia(createPinia())
  return mount(ServiceManagerDialog, {
    props: {
      open: true,
      connections: [online, offline],
      activeServerId: 7,
      connectionStates: {
        7: runtimeState(7, { status: 'online', terminalActive: true, hasActiveSession: true }),
        8: runtimeState(8),
      },
      ...props,
    },
  })
}

async function flush() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('ServiceManagerDialog', () => {
  it('uses shared glass tokens for the dialog shell and service surfaces', () => {
    expect(componentSourceText).toContain('background: var(--material-backdrop-bg)')
    expect(componentSourceText).toContain('background: var(--material-surface-bg)')
    expect(componentSourceText).toContain('border: 1px solid var(--material-border')
    expect(componentSourceText).toContain('box-shadow: var(--material-shadow)')
    expect(componentSourceText).toContain('backdrop-filter: var(--material-blur)')
    expect(componentSourceText).toContain('-webkit-backdrop-filter: var(--material-blur)')
    expect(componentSourceText).toContain('background: var(--material-toolbar-bg)')
    expect(componentSourceText).toContain('background: var(--material-panel-bg)')
    expect(componentSourceText).toContain('background: var(--material-card-bg)')
    expect(componentSourceText).not.toContain('background: var(--panel, #101827)')
  })

  beforeEach(() => {
    dialog.confirmDialog.mockReset()
    dialog.confirmDialog.mockResolvedValue(true)
    window.go = {
      main: {
        App: {
          CheckServiceManager: vi.fn(async () => capability()),
          ListSystemServices: vi.fn(async () => ({
            serverID: 7,
            services: [nginx, sshd, failed],
            timestamp: '',
          })),
          GetSystemServiceDetail: vi.fn(async (request: { unitName: string }) => detail(request.unitName)),
          StartSystemService: vi.fn(async () => ({ serverID: 7, unitName: 'sshd.service', action: 'start', success: true, message: '', timestamp: '' })),
          StopSystemService: vi.fn(async () => ({ serverID: 7, unitName: 'nginx.service', action: 'stop', success: true, message: '', timestamp: '' })),
          RestartSystemService: vi.fn(async () => ({ serverID: 7, unitName: 'nginx.service', action: 'restart', success: true, message: '', timestamp: '' })),
          EnableSystemService: vi.fn(async () => ({ serverID: 7, unitName: 'sshd.service', action: 'enable', success: true, message: '', timestamp: '' })),
          DisableSystemService: vi.fn(async () => ({ serverID: 7, unitName: 'nginx.service', action: 'disable', success: true, message: '', timestamp: '' })),
          CancelSystemServiceRequests: vi.fn(async () => undefined),
          GetSystemServiceJournal: vi.fn(async () => ({
            serverID: 7,
            unitName: 'nginx.service',
            lines: [{
              sequence: 1,
              timestamp: '2026-06-21T10:00:00Z',
              priority: 6,
              priorityLabel: '信息',
              identifier: 'nginx',
              pid: '123',
              message: 'ready',
              truncated: false,
            }],
            fallback: false,
            timestamp: '',
          })),
          StartSystemServiceJournalFollow: vi.fn(async () => ({
            watchID: 'watch-1',
            serverID: 7,
            unitName: 'nginx.service',
            startedAt: '',
          })),
          StopSystemServiceJournalFollow: vi.fn(async () => undefined),
        } as never,
      },
    }
    runtime.callbacks.clear()
    runtime.eventsOn.mockClear()
    runtime.eventsOff.mockClear()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
  })

  it('opens on the active online server and only lists online servers by name', async () => {
    const wrapper = mountDialog()
    await flush()
    expect(app().CheckServiceManager).toHaveBeenCalledWith({ serverID: 7 })
    expect(app().ListSystemServices).toHaveBeenCalledWith({ serverID: 7 })
    const options = wrapper.findAll('[data-testid="service-server-select"] option').map((option) => option.text())
    expect(options).toEqual(['debian'])
    expect(wrapper.text()).toContain('nginx.service')
    expect(wrapper.text()).toContain('OpenSSH server daemon')
  })

  it('shows a Chinese unsupported message for non-systemd servers', async () => {
    vi.mocked(app().CheckServiceManager).mockResolvedValueOnce(capability({
      available: false,
      initSystem: 'unsupported',
      canManage: false,
      error: '当前服务器不使用 systemd，本阶段暂不支持该服务管理方式。',
    }))
    const wrapper = mountDialog()
    await flush()
    expect(app().ListSystemServices).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前服务器不使用 systemd，本阶段暂不支持该服务管理方式。')
  })

  it('shows OpenWrt procd capability, service names, detail fields, and logread tab', async () => {
    vi.mocked(app().CheckServiceManager).mockResolvedValueOnce(openwrtCapability())
    vi.mocked(app().ListSystemServices).mockResolvedValueOnce({
      serverID: 7,
      services: [dropbear, network, procdCore],
      timestamp: '',
    })
    vi.mocked(app().GetSystemServiceDetail).mockResolvedValueOnce(procdDetail('dropbear'))
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.get('[data-testid="service-systemd-capability"]').text()).toContain('OpenWrt procd 23.05')
    expect(wrapper.text()).toContain('dropbear')
    expect(wrapper.text()).not.toContain('dropbear.service')
    expect(wrapper.find('[data-testid="service-journal-tab"]').exists()).toBe(true)
    expect(app().GetSystemServiceJournal).not.toHaveBeenCalled()
    const detailText = wrapper.get('[data-testid="service-detail"]').text()
    expect(detailText).toContain('Init 系统OpenWrt procd 23.05')
    expect(detailText).toContain('发行版OpenWrt 23.05')
    expect(detailText).toContain('脚本路径/etc/init.d/dropbear')
    expect(detailText).toContain('MainPID—')
    expect(detailText).toContain('内存—')
    expect(wrapper.get('[data-testid="service-compact-notice"]').text()).toContain('OpenWrt procd 不提供 systemd 资源字段')

    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    expect(wrapper.get('[data-testid="service-journal-source-badge"]').text()).toBe('OpenWrt logread')
    expect(wrapper.get('[data-testid="service-journal-follow"]').attributes('disabled')).toBeDefined()
    expect(app().GetSystemServiceJournal).toHaveBeenCalledWith(expect.objectContaining({
      serverID: 7,
      unitName: 'dropbear',
    }))
  })

  it('filters OpenWrt procd services by serviceID, runtime state, and startup state', async () => {
    vi.mocked(app().CheckServiceManager).mockResolvedValueOnce(openwrtCapability())
    vi.mocked(app().ListSystemServices).mockResolvedValueOnce({
      serverID: 7,
      services: [
        dropbear,
        { ...network, activeState: 'inactive', subState: 'dead', activeStateLabel: '已停止', isActive: false },
        { ...procdCore, unitFileState: 'unknown', unitFileStateLabel: '未知', isEnabled: false },
      ],
      timestamp: '',
    })
    vi.mocked(app().GetSystemServiceDetail).mockResolvedValueOnce(procdDetail('dropbear'))
    const wrapper = mountDialog()
    await flush()

    await wrapper.get('[data-testid="service-search"]').setValue('network')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('network')
    await wrapper.get('[data-testid="service-search"]').setValue('')
    await wrapper.get('[data-testid="service-running-filter"]').setValue('stopped')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('network')
    await wrapper.get('[data-testid="service-running-filter"]').setValue('all')
    await wrapper.get('[data-testid="service-startup-filter"]').setValue('other')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('procd')
  })

  it('uses procd serviceID for actions, stronger OpenWrt warnings, and disables core services', async () => {
    vi.mocked(app().CheckServiceManager).mockResolvedValueOnce(openwrtCapability())
    vi.mocked(app().ListSystemServices).mockResolvedValue({
      serverID: 7,
      services: [dropbear, procdCore],
      timestamp: '',
    })
    vi.mocked(app().GetSystemServiceDetail).mockResolvedValue(procdDetail('dropbear'))
    vi.mocked(app().RestartSystemService).mockResolvedValueOnce({ serverID: 7, serviceID: 'dropbear', unitName: 'dropbear', action: 'restart', success: true, message: '', timestamp: '' })
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-restart"]').trigger('click')
    await flush()

    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('网络、防火墙、DNS 或管理界面'),
    }))
    expect(app().RestartSystemService).toHaveBeenCalledWith({ serverID: 7, unitName: 'dropbear', serviceID: 'dropbear' })

    await wrapper.findAll('[data-testid="service-row"]')[1].trigger('click')
    await flush()
    expect(wrapper.get('[data-testid="service-start"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="service-stop"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="service-restart"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="service-enable"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="service-disable"]').attributes('disabled')).toBeDefined()
  })

  it('filters by service name, description, runtime state, and startup state', async () => {
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(3)
    await wrapper.get('[data-testid="service-search"]').setValue('OpenSSH')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('sshd.service')
    await wrapper.get('[data-testid="service-search"]').setValue('')
    await wrapper.get('[data-testid="service-running-filter"]').setValue('failed')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('broken.service')
    await wrapper.get('[data-testid="service-running-filter"]').setValue('stopped')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('broken.service')
    await wrapper.get('[data-testid="service-running-filter"]').setValue('all')
    await wrapper.get('[data-testid="service-startup-filter"]').setValue('static')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('broken.service')
  })

  it('keeps the service filters, refresh action, and systemd status in one toolbar', async () => {
    const wrapper = mountDialog()
    await flush()

    const toolbar = wrapper.get('.service-filter-toolbar')
    const serverField = toolbar.get('.service-filter-server')
    const searchField = toolbar.get('.service-filter-search')
    const runningField = toolbar.get('.service-filter-status')
    const startupField = toolbar.get('.service-filter-startup')
    const refresh = toolbar.get('[data-testid="service-refresh"]')
    const status = toolbar.get('[data-testid="service-systemd-capability"]')

    expect(serverField.element.contains(wrapper.get('[data-testid="service-server-select"]').element)).toBe(true)
    expect(searchField.element.contains(wrapper.get('[data-testid="service-search"]').element)).toBe(true)
    expect(runningField.element.contains(wrapper.get('[data-testid="service-running-filter"]').element)).toBe(true)
    expect(startupField.element.contains(wrapper.get('[data-testid="service-startup-filter"]').element)).toBe(true)
    expect(status.text()).toContain('systemd 252')
    expect(status.attributes('data-short-label')).toBe('systemd 252')
    expect(wrapper.find('.service-status-line').exists()).toBe(false)

    expect(toolbar.element.children[0]).toBe(serverField.element)
    expect(toolbar.element.children[1]).toBe(searchField.element)
    expect(toolbar.element.children[2]).toBe(runningField.element)
    expect(toolbar.element.children[3]).toBe(startupField.element)
    expect(toolbar.element.children[4]).toBe(refresh.element)
    expect(toolbar.element.children[5]).toBe(status.element)

    const source = componentSourceText
    const dialogBlock = source.match(/^\.service-dialog\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const toolbarBlock = source.match(/^\.service-filter-toolbar\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const inlineFieldBlock = source.match(/^\.service-filter-inline\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const controlBlock = source.match(/^\.service-filter-toolbar input,\n\.service-filter-toolbar select,\n\.service-filter-refresh\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const capabilityBlock = source.match(/^\.service-systemd-capability\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''

    expect(dialogBlock).toContain('grid-template-rows: auto auto minmax(0, 1fr)')
    expect(toolbarBlock).toContain('display: flex')
    expect(toolbarBlock).toContain('align-items: center')
    expect(toolbarBlock).toContain('flex-wrap: nowrap')
    expect(inlineFieldBlock).toContain('display: inline-flex')
    expect(inlineFieldBlock).toContain('flex-direction: row')
    expect(controlBlock).toContain('height: 34px')
    expect(controlBlock).toContain('min-height: 34px')
    expect(capabilityBlock).toContain('margin-left: auto')
    expect(capabilityBlock).toContain('white-space: nowrap')
    expect(source).not.toContain('service-status-line')
    expect(source).not.toContain('service-toolbar')
    expect(source).not.toContain('service-server-field')
    expect(source).not.toContain('service-search-field')
  })

  it('loads detail when selecting a service and keeps detail fields compact', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('[data-testid="service-row"]')[1].trigger('click')
    await flush()
    expect(app().GetSystemServiceDetail).toHaveBeenCalledWith({ serverID: 7, unitName: 'sshd.service', serviceID: 'sshd.service' })
    expect(wrapper.get('[data-testid="service-detail"]').text()).toContain('MainPID')
    expect(wrapper.get('[data-testid="service-detail"]').text()).toContain('/lib/systemd/system/sshd.service')
  })

  it('keeps service actions in the detail header and preserves their order', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('[data-testid="service-row"]')[1].trigger('click')
    await flush()

    const heading = wrapper.get('.service-detail-heading')
    const title = heading.get('.service-detail-title')
    const unitName = title.get('.service-detail-unit-name')
    const description = title.get('.service-detail-description')
    const actions = heading.get('.service-actions')
    expect(heading.element.children[0]).toBe(title.element)
    expect(heading.element.children[1]).toBe(actions.element)
    expect(title.element.children[0]).toBe(unitName.element)
    expect(title.element.children[1]).toBe(description.element)
    expect(unitName.text()).toBe('sshd.service')
    expect(description.text()).toBe('OpenSSH server daemon')
    expect(title.find('p').exists()).toBe(false)
    expect(actions.findAll('button').map((button) => button.text())).toEqual(['启动', '停止', '重启', '启用', '禁用'])

    const panelHtml = wrapper.get('.service-detail-panel').html()
    expect(panelHtml.indexOf('service-detail-heading')).toBeLessThan(panelHtml.indexOf('service-compact-notice'))
    expect(panelHtml.indexOf('service-compact-notice')).toBeLessThan(panelHtml.indexOf('service-journal-commandbar'))
  })

  it('uses a left-narrow right-wide service layout with bounded detail scrolling', () => {
    const source = componentSourceText
    const bodyBlock = source.match(/^\.service-body\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const panelBlock = detailsSourceText.match(/^\.service-detail-panel\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const headingBlock = detailsSourceText.match(/^\.service-detail-heading\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const titleBlock = detailsSourceText.match(/^\.service-detail-title\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const unitBlock = detailsSourceText.match(/^\.service-detail-unit-name\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const descriptionBlock = detailsSourceText.match(/^\.service-detail-description\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const ellipsisBlock = detailsSourceText.match(/^\.service-detail-unit-name,[\s\S]*?\.service-detail-grid dd\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const actionsBlock = actionBarSourceText.match(/^\.service-actions\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const tabContentBlock = journalSourceText.match(/^\.service-detail-tab-content\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const commandbarBlock = journalSourceText.match(/^\.service-journal-commandbar\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const commandbarRowBlock = journalSourceText.match(/^\.service-journal-commandbar__row\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const journalPanelBlock = journalSourceText.match(/^\.service-journal-panel\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const journalOutputBlock = journalSourceText.match(/^\.service-journal-output\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const narrowMediaBlock = journalSourceText.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/m)?.[0] ?? ''

    expect(bodyBlock).toContain('grid-template-columns: minmax(300px, 380px) minmax(0, 1fr)')
    expect(bodyBlock).toContain('gap: 12px')
    expect(panelBlock).toContain('display: flex')
    expect(panelBlock).toContain('flex-direction: column')
    expect(panelBlock).toContain('overflow: hidden')
    expect(headingBlock).toContain('display: flex')
    expect(headingBlock).toContain('align-items: center')
    expect(headingBlock).toContain('justify-content: space-between')
    expect(titleBlock).toContain('display: flex')
    expect(titleBlock).toContain('align-items: baseline')
    expect(unitBlock).toContain('max-width: 240px')
    expect(descriptionBlock).toContain('flex: 1 1 auto')
    expect(ellipsisBlock).toContain('text-overflow: ellipsis')
    expect(detailsSourceText).not.toContain('service-detail-title h3')
    expect(detailsSourceText).not.toContain('service-detail-title p')
    expect(actionsBlock).toContain('flex: 0 0 auto')
    expect(actionsBlock).toContain('justify-content: flex-end')
    expect(tabContentBlock).toContain('flex: 1 1 auto')
    expect(tabContentBlock).toContain('overflow: hidden')
    expect(commandbarBlock).toContain('flex: 0 0 auto')
    expect(commandbarBlock).toContain('display: grid')
    expect(commandbarRowBlock).toContain('flex-wrap: nowrap')
    expect(journalPanelBlock).toContain('height: 100%')
    expect(journalPanelBlock).toContain('display: flex')
    expect(journalPanelBlock).toContain('flex-direction: column')
    expect(journalOutputBlock).toContain('flex: 1 1 0')
    expect(journalOutputBlock).toContain('min-height: 0')
    expect(journalOutputBlock).toContain('max-height: none')
    expect(journalOutputBlock).toContain('overflow: auto')
    expect(narrowMediaBlock).toContain('overflow-x: auto')
    expect(narrowMediaBlock).toContain('width: 160px')
  })

  it('shows partial legacy detail without an error toast when optional resource fields are unavailable', async () => {
    vi.mocked(app().CheckServiceManager).mockResolvedValueOnce(capability({ systemdVersion: '219' }))
    vi.mocked(app().ListSystemServices).mockResolvedValueOnce({
      serverID: 7,
      services: [docker, sshd],
      timestamp: '',
    })
    vi.mocked(app().GetSystemServiceDetail).mockResolvedValueOnce(partialDetail('docker.service'))
    const wrapper = mountDialog()
    await flush()
    expect(app().GetSystemServiceDetail).toHaveBeenCalledWith({ serverID: 7, unitName: 'docker.service', serviceID: 'docker.service' })
    expect(wrapper.text()).toContain('当前 systemd 版本未提供部分资源字段。')
    expect(wrapper.findAll('[data-testid="service-compact-notice"]')).toHaveLength(1)
    expect(wrapper.findAll('.service-warning')).toHaveLength(0)
    expect(wrapper.get('[data-testid="service-compact-notice"]').text()).toContain('关键服务：停止或重启前请确认不会影响当前连接。')
    expect(wrapper.get('[data-testid="service-compact-notice"]').text()).toContain('当前 systemd 版本未提供部分资源字段。')
    const detailText = wrapper.get('[data-testid="service-detail"]').text()
    expect(detailText).toContain('MainPID1234')
    expect(detailText).toContain('内存—')
    expect(detailText).toContain('CPU—')
    expect(wrapper.get('[data-testid="service-stop"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.emitted('notify')).toBeUndefined()
  })

  it('keeps detail failures inline and does not duplicate the same error as a toast', async () => {
    vi.mocked(app().GetSystemServiceDetail).mockRejectedValueOnce(new Error('读取服务详情失败。'))
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.text()).toContain('读取服务详情失败。')
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(3)
    expect(wrapper.emitted('notify')).toBeUndefined()
  })

  it('confirms stop and refreshes list and detail after success', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-stop"]').trigger('click')
    await flush()
    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '停止服务',
      danger: true,
    }))
    expect(app().StopSystemService).toHaveBeenCalledWith({ serverID: 7, unitName: 'nginx.service', serviceID: 'nginx.service' })
    expect(app().ListSystemServices).toHaveBeenCalledTimes(2)
  })

  it('shows stronger warning for critical service restart and does not execute on cancel', async () => {
    dialog.confirmDialog.mockResolvedValueOnce(false)
    const wrapper = mountDialog()
    await flush()
    await wrapper.findAll('[data-testid="service-row"]')[1].trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-restart"]').trigger('click')
    await flush()
    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('可能影响当前 SSH 连接'),
    }))
    expect(app().RestartSystemService).not.toHaveBeenCalled()
  })

  it('disables management actions when current user can only view services', async () => {
    vi.mocked(app().CheckServiceManager).mockResolvedValueOnce(capability({
      canManage: false,
      requiresPrivilege: true,
      error: '当前用户没有管理系统服务的权限，请使用 root 或配置免密 sudo。',
    }))
    const wrapper = mountDialog()
    await flush()
    expect(wrapper.text()).toContain('当前用户没有管理系统服务的权限')
    expect(wrapper.get('[data-testid="service-stop"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="service-restart"]').attributes('disabled')).toBeDefined()
  })

  it('keeps the old list when an operation fails', async () => {
    vi.mocked(app().StopSystemService).mockRejectedValueOnce(new Error('服务停止失败。'))
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-stop"]').trigger('click')
    await flush()
    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(3)
    expect(app().ListSystemServices).toHaveBeenCalledTimes(1)
  })

  it('cancels pending reads on close and uses the shared bordered close button', async () => {
    const wrapper = mountDialog()
    await flush()
    const close = wrapper.get('.dialog-close-button')
    expect(close.text()).toBe('关闭')
    await close.trigger('click')
    await flush()
    expect(app().CancelSystemServiceRequests).toHaveBeenCalledWith({ serverID: 7 })
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('adds a journal tab and loads a default snapshot for the selected service', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    expect(app().GetSystemServiceJournal).toHaveBeenCalledWith({
      serverID: 7,
      unitName: 'nginx.service',
      lineLimit: 200,
      priority: 'all',
      currentBootOnly: true,
    })
    expect(wrapper.get('[data-testid="service-journal-panel"]').text()).toContain('ready')
  })

  it('does not render journal controls or count placeholders while the detail tab is active', async () => {
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.findAll('.service-journal-commandbar__row')).toHaveLength(1)
    expect(wrapper.find('[data-testid="service-journal-limit"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="service-journal-priority"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="service-journal-search"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="service-journal-count"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="service-journal-output"]').exists()).toBe(false)
  })

  it('renders journal controls as a strict two-row commandbar without an independent count row', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()

    const rows = wrapper.findAll('.service-journal-commandbar__row')
    expect(rows).toHaveLength(2)
    expect(rows[0].classes()).toContain('is-primary')
    expect(rows[1].classes()).toContain('is-secondary')
    expect(rows[0].find('[data-testid="service-detail-tab"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="service-journal-tab"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="service-journal-limit"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="service-journal-priority"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="service-journal-refresh"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="service-journal-follow"]').exists()).toBe(true)
    expect(rows[1].find('[data-testid="service-journal-search"]').exists()).toBe(true)
    expect(rows[1].find('[data-testid="service-journal-wrap"]').exists()).toBe(true)
    expect(rows[1].find('[data-testid="service-journal-clear"]').text()).toBe('清空')
    expect(rows[1].find('[data-testid="service-journal-copy"]').text()).toBe('复制')
    expect(rows[1].find('[data-testid="service-journal-count"]').text()).toBe('1/1 行')
    expect(wrapper.find('.service-journal-status').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('当前显示')

    const lineField = wrapper.get('[data-testid="service-journal-limit"]').element.parentElement
    const priorityField = wrapper.get('[data-testid="service-journal-priority"]').element.parentElement
    expect(lineField?.classList.contains('service-journal-inline-field')).toBe(true)
    expect(priorityField?.classList.contains('service-journal-inline-field')).toBe(true)
    expect(lineField?.textContent).toContain('行数')
    expect(priorityField?.textContent).toContain('级别')
    expect(wrapper.get('[data-testid="service-journal-limit"]').classes()).toContain('service-journal-line-select')
    expect(wrapper.get('[data-testid="service-journal-priority"]').classes()).toContain('service-journal-level-select')

    const source = journalSourceText
    const inlineFieldBlock = source.match(/^\.service-journal-inline-field\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const selectBlock = source.match(/^\.service-journal-line-select,\n\.service-journal-level-select\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const lineLimitBlock = source.match(/^\.service-journal-line-select\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const priorityBlock = [...source.matchAll(/^\.service-journal-level-select\s*\{[\s\S]*?\n\}/gm)].at(-1)?.[0] ?? ''
    const checkBlock = source.match(/^\.service-journal-check\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const buttonBlock = source.match(/^\.service-journal-small-button\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const countBlock = source.match(/^\.service-journal-count\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''

    expect(inlineFieldBlock).toContain('display: inline-flex')
    expect(inlineFieldBlock).toContain('flex-direction: row')
    expect(selectBlock).toContain('height: 34px')
    expect(selectBlock).toContain('min-height: 34px')
    expect(selectBlock).toContain('padding: 0 42px 0 9px')
    expect(lineLimitBlock).toContain('width: 76px')
    expect(priorityBlock).toContain('width: 92px')
    expect(checkBlock).toContain('height: 34px')
    expect(buttonBlock).toContain('height: 34px')
    expect(countBlock).toContain('margin-left: auto')
    expect(source).not.toContain('service-journal-controls')
    expect(source).not.toContain('service-journal-tools')
    expect(source).not.toContain('service-journal-status')
    expect(source).not.toContain('service-journal-line-limit')
    expect(source).not.toContain('service-journal-priority-select')
    expect(source).not.toContain('service-warning')
    expect(source).not.toContain('service-warning-soft')
  })

  it('renders journal rows as a compact meta line plus full-width left-aligned message', async () => {
    vi.mocked(app().GetSystemServiceJournal).mockResolvedValueOnce({
      serverID: 7,
      unitName: 'nginx.service',
      lines: [{
        sequence: 1,
        timestamp: '2026-06-21T10:00:00Z',
        priority: 6,
        priorityLabel: '信息',
        identifier: 'containerd',
        pid: '321',
        message: 'time="2026-06-21T17:23:06" level=info msg="starting containerd" revision=5b46e404f6b970a8a4f0fd7c8fb0d98fdd28f0f0',
        truncated: false,
      }],
      fallback: false,
      timestamp: '',
    })
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()

    const row = wrapper.get('[data-testid="service-journal-line"]')
    expect(row.find('.service-journal-meta').exists()).toBe(true)
    expect(row.find('[data-testid="service-journal-message"]').text()).toContain('starting containerd')
    expect(row.find('[data-testid="service-journal-source"]').text()).toBe('containerd')
    expect(row.find('[data-testid="service-journal-pid"]').text()).toBe('PID 321')
    expect(row.find('.journal-meta').exists()).toBe(false)
    expect(row.find('.journal-message').exists()).toBe(false)
  })

  it('does not render empty source or PID placeholders for journal lines', async () => {
    vi.mocked(app().GetSystemServiceJournal).mockResolvedValueOnce({
      serverID: 7,
      unitName: 'nginx.service',
      lines: [{
        sequence: 1,
        priority: 6,
        priorityLabel: '信息',
        message: 'plain message without source or pid',
        truncated: false,
      }],
      fallback: false,
      timestamp: '',
    })
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()

    const row = wrapper.get('[data-testid="service-journal-line"]')
    expect(row.find('[data-testid="service-journal-source"]').exists()).toBe(false)
    expect(row.find('[data-testid="service-journal-pid"]').exists()).toBe(false)
    expect(row.get('[data-testid="service-journal-message"]').text()).toContain('plain message')
  })

  it('keeps journal message layout full-width and out of the fixed grid column path', () => {
    const source = journalSourceText
    const rowBlock = source.match(/^\.service-journal-row\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const messageBlock = source.match(/^\.service-journal-message\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''
    const nowrapBlock = source.match(/^\.service-journal-message\.is-nowrap\s*\{[\s\S]*?\n\}/m)?.[0] ?? ''

    expect(rowBlock).toContain('flex-direction: column')
    expect(rowBlock).not.toContain('grid-template-columns')
    expect(source).not.toContain('grid-template-columns: 138px 104px minmax(0, 1fr)')
    expect(source).not.toContain('width: max-content')
    expect(messageBlock).toContain('width: 100%')
    expect(messageBlock).toContain('text-align: left')
    expect(messageBlock).toContain('white-space: pre-wrap')
    expect(messageBlock).toContain('overflow-wrap: anywhere')
    expect(messageBlock).toContain('word-break: normal')
    expect(messageBlock).not.toContain('margin-left: auto')
    expect(source).not.toContain('word-break: break-all')
    expect(nowrapBlock).toContain('white-space: pre')
    expect(nowrapBlock).toContain('overflow-x: auto')
  })

  it('uses nowrap message mode without changing copied journal content', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-journal-wrap"]').setValue(false)
    await flush()

    expect(wrapper.get('[data-testid="service-journal-message"]').classes()).toContain('is-nowrap')
    await wrapper.get('[data-testid="service-journal-copy"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('ready'))
  })

  it('passes line limit, priority, and current boot filters to journal refresh', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    vi.mocked(app().GetSystemServiceJournal).mockClear()
    await wrapper.get('[data-testid="service-journal-limit"]').setValue('500')
    await flush()
    expect(app().GetSystemServiceJournal).toHaveBeenLastCalledWith(expect.objectContaining({
      serverID: 7,
      unitName: 'nginx.service',
      lineLimit: 500,
      priority: 'all',
      currentBootOnly: true,
    }))
    await wrapper.get('[data-testid="service-journal-priority"]').setValue('warning')
    await flush()
    expect(app().GetSystemServiceJournal).toHaveBeenLastCalledWith(expect.objectContaining({
      lineLimit: 500,
      priority: 'warning',
    }))
  })

  it('starts realtime journal follow, accepts matching events, and ignores late events', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-journal-follow"]').trigger('click')
    await flush()
    expect(app().StartSystemServiceJournalFollow).toHaveBeenCalledWith({
      serverID: 7,
      unitName: 'nginx.service',
      lineLimit: 200,
      priority: 'all',
      currentBootOnly: true,
    })
    runtime.callbacks.get('servicejournal:line')?.({
      watchID: 'old-watch',
      serverID: 7,
      unitName: 'nginx.service',
      sequence: 2,
      line: { sequence: 2, priority: 6, priorityLabel: '信息', message: 'late line', truncated: false },
      timestamp: '',
    })
    runtime.callbacks.get('servicejournal:line')?.({
      watchID: 'watch-1',
      serverID: 7,
      unitName: 'nginx.service',
      sequence: 3,
      line: { sequence: 3, priority: 4, priorityLabel: '警告', identifier: 'nginx', message: 'followed line', truncated: false },
      timestamp: '',
    })
    await flush()
    expect(wrapper.text()).toContain('followed line')
    expect(wrapper.text()).not.toContain('late line')
  })

  it('stops systemd journal follow and switches to OpenWrt logread tab support', async () => {
    vi.mocked(app().CheckServiceManager)
      .mockResolvedValueOnce(capability())
      .mockResolvedValueOnce(openwrtCapability({ serverID: 8 }))
    vi.mocked(app().ListSystemServices)
      .mockResolvedValueOnce({ serverID: 7, services: [nginx], timestamp: '' })
      .mockResolvedValueOnce({ serverID: 8, services: [{ ...dropbear, serverID: 8 }], timestamp: '' })
    vi.mocked(app().GetSystemServiceDetail)
      .mockResolvedValueOnce(detail('nginx.service'))
      .mockResolvedValueOnce({ ...procdDetail('dropbear'), serverID: 8 })
    const wrapper = mountDialog({
      connectionStates: {
        7: runtimeState(7, { status: 'online', terminalActive: true, hasActiveSession: true }),
        8: runtimeState(8, { status: 'online', terminalActive: true, hasActiveSession: true }),
      },
    })
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-journal-follow"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-server-select"]').setValue('8')
    await flush()

    expect(app().StopSystemServiceJournalFollow).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })
    expect(wrapper.find('[data-testid="service-journal-tab"]').exists()).toBe(true)
    expect(app().GetSystemServiceJournal).toHaveBeenCalledTimes(1)
  })

  it('filters, copies, and clears the visible journal buffer without calling backend persistence', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-journal-search"]').setValue('missing')
    expect(wrapper.findAll('[data-testid="service-journal-line"]')).toHaveLength(0)
    await wrapper.get('[data-testid="service-journal-search"]').setValue('ready')
    expect(wrapper.findAll('[data-testid="service-journal-line"]')).toHaveLength(1)
    await wrapper.get('[data-testid="service-journal-copy"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('ready'))
    await wrapper.get('[data-testid="service-journal-clear"]').trigger('click')
    await flush()
    expect(wrapper.findAll('[data-testid="service-journal-line"]')).toHaveLength(0)
  })

  it('stops realtime journal follow when switching back to detail or closing', async () => {
    const wrapper = mountDialog()
    await flush()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-journal-follow"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-detail-tab"]').trigger('click')
    await flush()
    expect(app().StopSystemServiceJournalFollow).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })

    vi.mocked(app().StopSystemServiceJournalFollow).mockClear()
    await wrapper.get('[data-testid="service-journal-tab"]').trigger('click')
    await flush()
    await wrapper.get('[data-testid="service-journal-follow"]').trigger('click')
    await flush()
    await wrapper.get('.dialog-close-button').trigger('click')
    await flush()
    expect(app().StopSystemServiceJournalFollow).toHaveBeenCalledWith({ serverID: 7, watchID: 'watch-1' })
  })
})
