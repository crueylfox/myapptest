// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ServiceActionBar from './ServiceActionBar.vue'
import ServiceJournalPanel from './ServiceJournalPanel.vue'
import ServiceManagerDetails from './ServiceManagerDetails.vue'
import ServiceManagerList from './ServiceManagerList.vue'
import listSource from './ServiceManagerList.vue?raw'
import detailsSource from './ServiceManagerDetails.vue?raw'
import journalSource from './ServiceJournalPanel.vue?raw'
import actionBarSource from './ServiceActionBar.vue?raw'
import type {
  ServiceJournalLine,
  ServiceManagerCapability,
  SystemServiceDetail,
  SystemServiceSummary,
} from '../../types'

const capability: ServiceManagerCapability = {
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
    memoryCurrentBytes: 1024,
    cpuUsageNSec: 1000000,
    tasksCurrent: 8,
    restartCount: 1,
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

describe('service manager extracted sections', () => {
  it('ServiceManagerList renders rows, selection, empty states, and emits selection', async () => {
    const wrapper = mount(ServiceManagerList, {
      props: {
        capability,
        services: [service(), service({ unitName: 'broken.service', serviceID: 'broken.service', displayName: 'broken.service', isActive: false, isFailed: true, activeState: 'failed', activeStateLabel: '失败' })],
        rawCount: 2,
        selectedUnitName: 'nginx.service',
      },
    })

    expect(wrapper.findAll('[data-testid="service-row"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="service-row"]').classes()).toContain('selected')
    expect(wrapper.get('.service-badge.running').text()).toBe('运行中')
    await wrapper.findAll('[data-testid="service-row"]')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ unitName: 'broken.service' })
  })

  it('ServiceActionBar keeps action order, disabled state, and emits action ids', async () => {
    const wrapper = mount(ServiceActionBar, {
      props: {
        actionBusy: 'restart',
        disabledActions: { start: true, stop: false, restart: false, enable: true, disable: false },
      },
    })

    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['启动', '停止', '重启中', '启用', '禁用'])
    expect(wrapper.findAll('button').every((button) => button.classes().includes('command-light-action'))).toBe(true)
    expect(wrapper.findAll('.command-action-separator').map((separator) => separator.text())).toEqual(['|', '|', '|', '|'])
    expect(wrapper.get('[data-testid="service-start"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="service-stop"]').trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['stop'])
  })

  it('ServiceManagerDetails renders selected detail, warnings, action bar, and no-selected state', async () => {
    const wrapper = mount(ServiceManagerDetails, {
      props: {
        activeDetailTab: 'detail',
        actionBusy: null,
        actionDisabled: { start: true, stop: false, restart: false, enable: true, disable: false },
        capability,
        detail: detail({ partial: true, warnings: ['当前 systemd 版本未提供部分资源字段。'] }),
        detailError: '',
        detailLoading: false,
        journalProps: {
          currentBootOnly: true,
          journalCountText: '0/0 行',
          journalFollowBusy: false,
          journalFollowing: false,
          journalLoading: false,
          journalStatus: 'idle',
          journalStatusText: '当前显示 0 / 0 行。',
          journalSupported: true,
          lineLimit: 200,
          priority: 'all',
          query: '',
          selectedUnitName: 'nginx.service',
          visibleLines: [],
          wordWrap: true,
          autoScroll: true,
        },
        partialWarningText: '当前 systemd 版本未提供部分资源字段。',
        resourceMetricsSupported: true,
        selectedService: service({ critical: true }),
        showCriticalWarning: true,
        showPartialWarning: true,
        criticalWarningText: '关键服务：停止或重启前请确认不会影响当前连接。',
      },
    })

    expect(wrapper.get('[data-testid="service-detail"]').text()).toContain('MainPID123')
    expect(wrapper.get('[data-testid="service-compact-notice"]').text()).toContain('关键服务')
    await wrapper.get('[data-testid="service-stop"]').trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['stop'])

    await wrapper.setProps({ selectedService: null, detail: null })
    expect(wrapper.text()).toContain('请选择一个服务。')
  })

  it('ServiceJournalPanel renders controls, fake log lines, and emits UI events', async () => {
    const wrapper = mount(ServiceJournalPanel, {
      props: {
        activeDetailTab: 'logs',
        autoScroll: true,
        currentBootOnly: true,
        journalCountText: '1/1 行',
        journalFollowBusy: false,
        journalFollowing: false,
        journalLoading: false,
        journalStatus: 'idle',
        journalStatusText: '当前显示 1 / 1 行。',
        journalSupported: true,
        lineLimit: 200,
        priority: 'all',
        query: '',
        selectedUnitName: 'nginx.service',
        visibleLines: [line()],
        wordWrap: true,
      },
    })

    expect(wrapper.get('[data-testid="service-journal-line"]').text()).toContain('synthetic service line')
    const tabs = wrapper.get('.service-detail-tabs')
    expect(tabs.findAll('.command-light-action').map((button) => button.text())).toEqual(['详情', '日志'])
    expect(tabs.findAll('.command-action-separator').map((separator) => separator.text())).toEqual(['|'])
    await wrapper.get('[data-testid="service-journal-refresh"]').trigger('click')
    await wrapper.get('[data-testid="service-journal-follow"]').trigger('click')
    await wrapper.get('[data-testid="service-journal-clear"]').trigger('click')
    await wrapper.get('[data-testid="service-journal-copy"]').trigger('click')
    await wrapper.get('[data-testid="service-journal-search"]').setValue('synthetic')
    expect(wrapper.emitted('refresh')).toBeTruthy()
    expect(wrapper.emitted('toggle-follow')).toBeTruthy()
    expect(wrapper.emitted('clear')).toBeTruthy()
    expect(wrapper.emitted('copy')).toBeTruthy()
    expect(wrapper.emitted('update:query')?.[0]).toEqual(['synthetic'])
  })

  it('ServiceJournalPanel shows OpenWrt logread source and disables unsupported follow', async () => {
    const wrapper = mount(ServiceJournalPanel, {
      props: {
        activeDetailTab: 'logs',
        autoScroll: true,
        currentBootOnly: true,
        journalCountText: '1/1 lines',
        journalFollowBusy: false,
        journalFollowing: false,
        journalLoading: false,
        journalStatus: 'idle',
        journalStatusText: 'OpenWrt logread fixture',
        journalSupported: true,
        journalRefreshSupported: true,
        journalFollowSupported: false,
        journalFollowDisabledReason: 'OpenWrt logread snapshot refresh only',
        journalSourceText: 'OpenWrt logread',
        lineLimit: 200,
        priority: 'all',
        query: '',
        selectedUnitName: 'dropbear',
        visibleLines: [line({ identifier: 'dropbear', message: 'synthetic OpenWrt logread line' })],
        wordWrap: true,
      },
    })

    expect(wrapper.get('[data-testid="service-journal-source-badge"]').text()).toBe('OpenWrt logread')
    expect(wrapper.get('[data-testid="service-journal-follow"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="service-journal-follow"]').attributes('title')).toContain('OpenWrt logread')
    await wrapper.get('[data-testid="service-journal-refresh"]').trigger('click')
    expect(wrapper.emitted('refresh')).toBeTruthy()
  })

  it('sections are presentation-only and keep bounded layout contracts', () => {
    for (const source of [listSource, detailsSource, journalSource, actionBarSource]) {
      expect(source).not.toMatch(/wailsjs|api\/backend|useServiceManagerStore|localStorage|sessionStorage/)
      expect(source).not.toMatch(/event\s*bus|EventBus|ManagerDialogFramework|AppController/)
      expect(source).not.toMatch(/private key|passphrase|password|terminal output|remote file content/i)
      expect(source).not.toMatch(/margin-left:\s*-\d|transform:\s*translate|!important/)
    }
    expect(listSource).toContain('overflow-y: auto')
    expect(detailsSource).toContain('overflow: hidden')
    expect(journalSource).toContain('overflow: auto')
    expect(actionBarSource).toContain('white-space: nowrap')
  })
})
