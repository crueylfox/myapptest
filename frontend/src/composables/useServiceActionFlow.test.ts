import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import sourceText from './useServiceActionFlow.ts?raw'
import { useServiceActionFlow } from './useServiceActionFlow'
import type { ServiceManagerCapability, SystemServiceSummary } from '../types'

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

function createFlow(overrides: Partial<Parameters<typeof useServiceActionFlow>[0]> = {}) {
  const selectedService = ref<SystemServiceSummary | null>(service())
  const selectedServerID = ref(7)
  const loading = ref(false)
  const confirm = vi.fn(async () => true)
  const notify = vi.fn()
  const actions = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
  }
  const flow = useServiceActionFlow({
    selectedServerID,
    selectedService,
    capability: ref(capability),
    canManage: ref(true),
    loading,
    confirm,
    notify,
    actions,
    ...overrides,
  })
  return { actions, confirm, flow, loading, notify, selectedServerID, selectedService }
}

describe('useServiceActionFlow', () => {
  it('confirms and dispatches the selected service action through injected callbacks only', async () => {
    const { actions, confirm, flow, notify } = createFlow()

    await flow.runServiceAction('stop')

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '停止服务',
      confirmText: '停止',
      cancelText: '取消',
      danger: true,
    }))
    expect(actions.stop).toHaveBeenCalledWith(7, 'nginx.service', 'nginx.service')
    expect(notify).toHaveBeenCalledWith('停止「nginx.service」完成。', 'success')
    expect(flow.actionBusy.value).toBe(null)
  })

  it('does not execute when confirm is canceled, action is disabled, busy, or missing a target', async () => {
    const { actions, confirm, flow, selectedService } = createFlow()
    confirm.mockResolvedValueOnce(false)
    await flow.runServiceAction('restart')
    expect(actions.restart).not.toHaveBeenCalled()

    selectedService.value = service({ protected: true })
    await flow.runServiceAction('stop')
    expect(actions.stop).not.toHaveBeenCalled()

    flow.actionBusy.value = 'restart'
    selectedService.value = service()
    await flow.runServiceAction('stop')
    expect(actions.stop).not.toHaveBeenCalled()

    flow.actionBusy.value = null
    selectedService.value = null
    await flow.runServiceAction('stop')
    expect(actions.stop).not.toHaveBeenCalled()
  })

  it('reports failures through the existing notify contract and clears busy state', async () => {
    const { actions, flow, notify } = createFlow()
    actions.disable.mockRejectedValueOnce(new Error('synthetic failure'))

    await flow.runServiceAction('disable')

    expect(notify).toHaveBeenCalledWith('synthetic failure', 'error')
    expect(flow.actionBusy.value).toBe(null)
  })

  it('exposes stable disabled and pending-label view helpers', () => {
    const { flow, loading, selectedService } = createFlow()

    expect(flow.actionDisabled('stop')).toBe(false)
    loading.value = true
    expect(flow.actionDisabled('stop')).toBe(true)
    loading.value = false
    selectedService.value = service({ canStop: false })
    expect(flow.actionDisabled('stop')).toBe(true)
    flow.actionBusy.value = 'restart'
    expect(flow.actionPendingLabel('restart')).toBe('重启中')
  })

  it('does not import backend wrappers, stores, persistence, or generic manager frameworks', () => {
    expect(sourceText).not.toMatch(/wailsjs|api\/backend|useServiceManagerStore|localStorage|sessionStorage/)
    expect(sourceText).not.toMatch(/event\s*bus|EventBus|ManagerDialogFramework|AppController/)
  })
})
