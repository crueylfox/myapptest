import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import sourceText from './useServiceJournalFlow.ts?raw'
import { useServiceJournalFlow } from './useServiceJournalFlow'
import type { ServiceJournalLine } from '../types'

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

function createFlow(options: {
  journalRefreshSupported?: boolean
  journalFollowSupported?: boolean
  journalFollowDisabledReason?: string
} = {}) {
  const open = ref(true)
  const selectedServerID = ref(7)
  const selectedUnitName = ref('nginx.service')
  const journalLines = ref<ServiceJournalLine[]>([line(), line({ sequence: 2, message: 'synthetic warning line', priority: 4, priorityLabel: '警告' })])
  const journalStatus = ref('idle')
  const journalError = ref('')
  const journalOverflow = ref(false)
  const journalFollowing = ref(false)
  const notify = vi.fn()
  const loadJournal = vi.fn(async () => undefined)
  const startFollow = vi.fn(async () => {
    journalFollowing.value = true
  })
  const stopFollow = vi.fn(async () => {
    journalFollowing.value = false
  })
  const stopServerRuntime = vi.fn(async () => undefined)
  const clearJournal = vi.fn(() => {
    journalLines.value = []
  })
  const writeClipboard = vi.fn(async () => undefined)
  const flow = useServiceJournalFlow({
    open,
    selectedServerID,
    selectedUnitName,
    journalLines: computed(() => journalLines.value),
    journalStatus: computed(() => journalStatus.value),
    journalError: computed(() => journalError.value),
    journalOverflow: computed(() => journalOverflow.value),
    journalFollowing: computed(() => journalFollowing.value),
    journalRefreshSupported: computed(() => options.journalRefreshSupported ?? true),
    journalFollowSupported: computed(() => options.journalFollowSupported ?? true),
    journalFollowDisabledReason: computed(() => options.journalFollowDisabledReason ?? ''),
    loadJournal,
    startFollow,
    stopFollow,
    stopServerRuntime,
    clearJournal,
    notify,
    writeClipboard,
    afterDomUpdate: async () => undefined,
  })
  return {
    clearJournal,
    flow,
    journalError,
    journalFollowing,
    journalLines,
    journalOverflow,
    journalStatus,
    loadJournal,
    notify,
    open,
    selectedServerID,
    selectedUnitName,
    startFollow,
    stopFollow,
    stopServerRuntime,
    writeClipboard,
  }
}

describe('useServiceJournalFlow', () => {
  it('loads and refreshes journal snapshots through injected callbacks', async () => {
    const { flow, loadJournal, notify } = createFlow()

    await flow.loadJournalSnapshot(true)

    expect(loadJournal).toHaveBeenCalledWith({
      serverID: 7,
      unitName: 'nginx.service',
      lineLimit: 200,
      priority: 'all',
      currentBootOnly: true,
    })
    expect(notify).toHaveBeenCalledWith('系统服务日志已刷新。', 'success')
    expect(flow.journalLoading.value).toBe(false)
  })

  it('starts and stops follow through injected callbacks without leaking state', async () => {
    const { flow, startFollow, stopFollow } = createFlow()

    await flow.toggleJournalFollow()
    expect(startFollow).toHaveBeenCalledWith(expect.objectContaining({
      serverID: 7,
      unitName: 'nginx.service',
      lineLimit: 200,
    }))
    expect(flow.journalAutoScroll.value).toBe(true)

    await flow.toggleJournalFollow()
    expect(stopFollow).toHaveBeenCalledWith(7, 'nginx.service')
    expect(flow.journalFollowBusy.value).toBe(false)
  })

  it('does not start follow when the current log source only supports snapshots', async () => {
    const { flow, startFollow, notify } = createFlow({
      journalFollowSupported: false,
      journalFollowDisabledReason: 'OpenWrt logread snapshot refresh only',
    })

    await flow.toggleJournalFollow()

    expect(startFollow).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('OpenWrt logread snapshot refresh only', 'info')
    expect(flow.journalFollowBusy.value).toBe(false)
  })

  it('cleans up selected and server journal runtime through injected callbacks', async () => {
    const { flow, stopFollow, stopServerRuntime } = createFlow()

    await flow.stopSelectedJournalFollow()
    await flow.stopServerJournalRuntime(7)
    flow.cancelPendingJournalWork()

    expect(stopFollow).toHaveBeenCalledWith(7, 'nginx.service')
    expect(stopServerRuntime).toHaveBeenCalledWith(7)
  })

  it('filters, copies, and clears visible fake journal lines only', async () => {
    const { clearJournal, flow, writeClipboard } = createFlow()
    flow.journalQuery.value = 'warning'

    expect(flow.visibleJournalLines.value).toHaveLength(1)
    await flow.copyVisibleJournal()
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining('synthetic warning line'))

    flow.clearJournalDisplay()
    expect(clearJournal).toHaveBeenCalledWith(7, 'nginx.service')
  })

  it('no-ops when dialog, server, or selected unit is unavailable and reports failures through notify', async () => {
    const { flow, loadJournal, notify, open, selectedUnitName } = createFlow()
    open.value = false
    await flow.loadJournalSnapshot(true)
    expect(loadJournal).not.toHaveBeenCalled()

    open.value = true
    selectedUnitName.value = ''
    await flow.toggleJournalFollow()
    expect(notify).not.toHaveBeenCalled()

    selectedUnitName.value = 'nginx.service'
    loadJournal.mockRejectedValueOnce(new Error('synthetic journal failure'))
    await flow.loadJournalSnapshot(false)
    expect(notify).toHaveBeenCalledWith('synthetic journal failure', 'error')
  })

  it('does not import backend wrappers, stores, persistence, or generic manager frameworks', () => {
    expect(sourceText).not.toMatch(/wailsjs|api\/backend|useServiceManagerStore|localStorage|sessionStorage/)
    expect(sourceText).not.toMatch(/event\s*bus|EventBus|ManagerDialogFramework|AppController/)
  })
})
