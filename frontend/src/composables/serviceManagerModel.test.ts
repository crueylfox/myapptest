import { describe, expect, it } from 'vitest'
import sourceText from './serviceManagerModel.ts?raw'
import {
  SERVICE_ACTIONS,
  actionConfirmMessage,
  actionConfirmText,
  actionDialogTitle,
  actionDisabled,
  actionDoneLabel,
  actionPendingLabel,
  criticalWarningText,
  detailPathText,
  filterJournalLines,
  filterServices,
  formatBytes,
  formatCPU,
  formatJournalCopyLine,
  journalCountText,
  journalFollowDisabledReason,
  journalFollowSupported,
  journalLineClass,
  journalRefreshSupported,
  journalSourceText,
  journalStatusText,
  journalSupported,
  serviceLabel,
  statusClass,
  startupClass,
} from './serviceManagerModel'
import type {
  ServiceJournalLine,
  ServiceManagerCapability,
  SystemServiceDetail,
  SystemServiceSummary,
} from '../types'

const baseCapability: ServiceManagerCapability = {
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
}

function service(overrides: Partial<SystemServiceSummary> = {}): SystemServiceSummary {
  return {
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
    ...overrides,
  }
}

function detail(overrides: Partial<SystemServiceDetail> = {}): SystemServiceDetail {
  return {
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
    mainPID: 123,
    fragmentPath: '/lib/systemd/system/nginx.service',
    result: 'success',
    partial: false,
    warnings: [],
    critical: false,
    protected: false,
    ...overrides,
  }
}

function line(overrides: Partial<ServiceJournalLine> = {}): ServiceJournalLine {
  return {
    sequence: 1,
    timestampText: '2026-07-03 10:00:00',
    priority: 6,
    priorityLabel: '信息',
    identifier: 'unit-test',
    pid: '123',
    message: 'synthetic service line',
    truncated: false,
    ...overrides,
  }
}

describe('serviceManagerModel', () => {
  it('keeps service action order and labels stable', () => {
    expect(SERVICE_ACTIONS).toEqual(['start', 'stop', 'restart', 'enable', 'disable'])
    expect(SERVICE_ACTIONS.map(actionDialogTitle)).toEqual(['启动服务', '停止服务', '重启服务', '启用开机启动', '禁用开机启动'])
    expect(SERVICE_ACTIONS.map(actionConfirmText)).toEqual(['启动', '停止', '重启', '启用', '禁用'])
    expect(SERVICE_ACTIONS.map(actionDoneLabel)).toEqual(['启动', '停止', '重启', '启用开机启动', '禁用开机启动'])
    expect(actionPendingLabel('restart', 'restart')).toBe('重启中')
    expect(actionPendingLabel('restart', null)).toBe('重启')
  })

  it('builds stable status/startup classes and filters services like the dialog did', () => {
    const failed = service({
      unitName: 'broken.service',
      serviceID: 'broken.service',
      displayName: 'broken.service',
      description: 'Broken background job',
      activeState: 'failed',
      unitFileState: 'static',
      isActive: false,
      isFailed: true,
      isEnabled: false,
    })
    const stopped = service({
      unitName: 'sshd.service',
      serviceID: 'sshd.service',
      displayName: 'sshd.service',
      description: 'OpenSSH server daemon',
      activeState: 'inactive',
      activeStateLabel: '已停止',
      unitFileState: 'disabled',
      isActive: false,
      isEnabled: false,
    })

    expect(statusClass(service())).toBe('running')
    expect(statusClass(service({ activeState: 'activating', isActive: false }))).toBe('pending')
    expect(statusClass(failed)).toBe('failed')
    expect(statusClass(stopped)).toBe('stopped')
    expect(startupClass(service())).toBe('enabled')
    expect(startupClass(stopped)).toBe('disabled')
    expect(startupClass(failed)).toBe('other')

    const services = [service(), stopped, failed]
    expect(filterServices(services, { query: 'openssh', runningFilter: 'all', startupFilter: 'all' })).toEqual([stopped])
    expect(filterServices(services, { query: '', runningFilter: 'failed', startupFilter: 'all' })).toEqual([failed])
    expect(filterServices(services, { query: '', runningFilter: 'stopped', startupFilter: 'all' })).toEqual([stopped])
    expect(filterServices(services, { query: '', runningFilter: 'all', startupFilter: 'static' })).toEqual([failed])
  })

  it('preserves action disabled rules and critical confirm copy', () => {
    expect(actionDisabled('stop', {
      service: service(),
      capability: baseCapability,
      canManage: true,
      busyAction: null,
      loading: false,
    })).toBe(false)
    expect(actionDisabled('stop', {
      service: service({ protected: true }),
      capability: baseCapability,
      canManage: true,
      busyAction: null,
      loading: false,
    })).toBe(true)
    expect(actionDisabled('restart', {
      service: service(),
      capability: { ...baseCapability, supportsRestart: false },
      canManage: true,
      busyAction: null,
      loading: false,
    })).toBe(true)

    expect(actionConfirmMessage('restart', service({ critical: true }))).toContain('可能影响当前 SSH 连接')
    expect(actionConfirmMessage('restart', service({ initSystem: 'openwrt-procd', critical: true }))).toContain('网络、防火墙、DNS 或管理界面')
    expect(criticalWarningText(service({ critical: true }))).toContain('关键服务')
    expect(criticalWarningText(service({ initSystem: 'openwrt-procd', critical: true }))).toContain('DNS')
  })

  it('formats detail and journal view-model text without touching real output fixtures', () => {
    expect(serviceLabel(service({ displayName: '', serviceID: 'fallback.service' }))).toBe('fallback.service')
    expect(detailPathText(detail())).toBe('/lib/systemd/system/nginx.service')
    expect(detailPathText(detail({ fragmentPath: undefined, scriptPath: undefined }))).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatCPU(undefined)).toBe('—')
    expect(formatCPU(1_500_000)).toBe('1.5 ms')

    const lines = [
      line({ message: 'synthetic service line', priority: 6, priorityLabel: '信息' }),
      line({ sequence: 2, message: 'synthetic warning line', priority: 4, priorityLabel: '警告' }),
    ]
    expect(filterJournalLines(lines, 'warning')).toHaveLength(1)
    expect(journalLineClass(line({ priority: 3 }))).toBe('error')
    expect(journalLineClass(line({ priority: 4 }))).toBe('warning')
    expect(journalLineClass(line({ priority: 7 }))).toBe('debug')
    expect(formatJournalCopyLine(line())).toContain('synthetic service line')
    expect(journalStatusText({
      hasSelectedService: true,
      loading: false,
      following: false,
      status: 'error',
      error: 'fake error',
      overflow: false,
      visibleCount: 0,
      totalCount: 0,
    })).toBe('fake error')
    expect(journalCountText({ loading: true, status: 'idle', overflow: false, visibleCount: 0, totalCount: 0 })).toBe('读取中')
  })

  it('models systemd journal and OpenWrt logread source and follow support separately', () => {
    const openWrtLogread: ServiceManagerCapability = {
      ...baseCapability,
      initSystem: 'openwrt-procd',
      displayName: 'OpenWrt procd',
      systemdVersion: undefined,
      supportsJournal: true,
      supportsLiveLogs: false,
      supportsResourceMetrics: false,
    }
    const openWrtUnavailable: ServiceManagerCapability = {
      ...openWrtLogread,
      supportsJournal: false,
    }

    expect(journalSupported(baseCapability)).toBe(true)
    expect(journalRefreshSupported(baseCapability)).toBe(true)
    expect(journalFollowSupported(baseCapability)).toBe(true)
    expect(journalSourceText(baseCapability)).toBe('systemd journal')

    expect(journalSupported(openWrtLogread)).toBe(true)
    expect(journalRefreshSupported(openWrtLogread)).toBe(true)
    expect(journalFollowSupported(openWrtLogread)).toBe(false)
    expect(journalSourceText(openWrtLogread)).toBe('OpenWrt logread')
    expect(journalFollowDisabledReason(openWrtLogread)).toContain('OpenWrt logread')

    expect(journalSupported(openWrtUnavailable)).toBe(true)
    expect(journalRefreshSupported(openWrtUnavailable)).toBe(false)
    expect(journalFollowSupported(openWrtUnavailable)).toBe(false)
    expect(journalFollowDisabledReason(openWrtUnavailable)).toContain('not available')
  })

  it('stays pure and does not depend on backend, stores, persistence, or generic frameworks', () => {
    expect(sourceText).not.toMatch(/wailsjs|api\/backend|useServiceManagerStore|localStorage|sessionStorage/)
    expect(sourceText).not.toMatch(/event\s*bus|EventBus|ManagerDialogFramework|AppController/)
    expect(sourceText).not.toMatch(/private key|passphrase|password|terminal output|remote file content/i)
  })
})
