// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Connection, ConnectionRuntimeState, TerminalSessionInfo } from '../types'
import { useBatchCommandController } from './useBatchCommandController'

function connection(id: number, name: string, host = `192.0.2.${id}`): Connection {
  return {
    id,
    groupId: null,
    name,
    host,
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
}

function state(values: Partial<ConnectionRuntimeState>): ConnectionRuntimeState {
  return {
    connectionId: values.connectionId ?? 0,
    status: 'offline',
    monitorActive: false,
    terminalActive: false,
    terminalConnecting: false,
    sftpActive: false,
    connecting: false,
    hasActiveSession: false,
    updatedAt: '',
    ...values,
  }
}

function session(sessionId: string, connectionId: number, status: TerminalSessionInfo['status'] = 'online'): TerminalSessionInfo {
  return {
    sessionId,
    connectionId,
    title: sessionId,
    status,
    code: '',
    message: '',
  }
}

function mountController() {
  const connections = ref([
    connection(1, 'alpha-prod'),
    connection(2, 'offline-prod'),
    connection(3, 'monitor-only'),
    connection(4, 'starting-prod'),
    connection(5, 'beta-prod'),
  ])
  const connectionStates = ref<Record<number, ConnectionRuntimeState>>({
    1: state({ connectionId: 1, status: 'online', terminalActive: true, hasActiveSession: true }),
    2: state({ connectionId: 2, status: 'offline' }),
    3: state({ connectionId: 3, status: 'online', monitorActive: true, terminalActive: false, hasActiveSession: true }),
    4: state({ connectionId: 4, status: 'connecting', terminalConnecting: true, connecting: true }),
    5: state({ connectionId: 5, status: 'online', terminalActive: true, hasActiveSession: true }),
  })
  const sessionsByServerId = ref<Record<number, TerminalSessionInfo[]>>({
    1: [session('term-1-old', 1), session('term-1-recent', 1)],
    3: [session('term-monitor-only', 3)],
    4: [session('term-starting', 4, 'connecting')],
    5: [session('term-5', 5)],
  })
  const activeTab = ref<TerminalSessionInfo | null>(session('term-5', 5))
  const lastActiveTerminalByServer = ref<Record<number, string>>({ 1: 'term-1-recent' })
  const controller = useBatchCommandController({
    connections,
    connectionStates,
    sessionsByServerId,
    activeTab,
    lastActiveTerminalByServer,
  })
  return { controller, sessionsByServerId, activeTab }
}

describe('useBatchCommandController', () => {
  it('lists only online writable SSH terminal targets and exposes display-safe rows', () => {
    const { controller } = mountController()

    expect(controller.availableTargets.value).toEqual([
      { serverID: 1, name: 'alpha-prod', terminalSessionID: 'term-1-recent' },
      { serverID: 5, name: 'beta-prod', terminalSessionID: 'term-5' },
    ])
    expect(JSON.stringify(controller.availableTargets.value)).not.toContain('192.0.2.')
    expect(JSON.stringify(controller.availableTargets.value)).not.toContain('root')
  })

  it('selects, inverts, and clears only current online targets', () => {
    const { controller } = mountController()

    controller.toggleTarget(1)
    expect([...controller.selectedIds.value]).toEqual([1])

    controller.selectAllTargets()
    expect([...controller.selectedIds.value].sort()).toEqual([1, 5])

    controller.invertTargets()
    expect([...controller.selectedIds.value]).toEqual([])

    controller.selectAllTargets()
    controller.clearSelection()
    expect(controller.selectedIds.value.size).toBe(0)
  })

  it('builds execute intents from selected terminal sessions without writing to terminals', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { controller } = mountController()

    controller.selectAllTargets()
    controller.command.value = 'uptime\n'

    expect(controller.executeIntent.value).toEqual({
      enabled: true,
      command: 'uptime',
      targets: [
        { serverID: 1, terminalSessionID: 'term-1-recent' },
        { serverID: 5, terminalSessionID: 'term-5' },
      ],
    })
    expect(setItem).not.toHaveBeenCalled()

    controller.command.value = '   '
    expect(controller.executeIntent.value).toEqual({
      enabled: false,
      command: '',
      targets: [
        { serverID: 1, terminalSessionID: 'term-1-recent' },
        { serverID: 5, terminalSessionID: 'term-5' },
      ],
      reason: 'empty-command',
    })
  })

  it('prefers the active writable session, then the last active writable session for duplicate server terminals', () => {
    const { controller, activeTab } = mountController()

    expect(controller.resolveTarget(1)).toEqual({
      serverID: 1,
      terminalSessionID: 'term-1-recent',
      writable: true,
    })

    activeTab.value = session('term-1-old', 1)
    expect(controller.resolveTarget(1)).toEqual({
      serverID: 1,
      terminalSessionID: 'term-1-old',
      writable: true,
    })
  })

  it('prunes selected ids when targets disappear', () => {
    const { controller, sessionsByServerId } = mountController()

    controller.selectAllTargets()
    controller.command.value = 'uptime'
    sessionsByServerId.value = { 1: [] }
    controller.pruneSelection()

    expect([...controller.selectedIds.value]).toEqual([])
    const intent = controller.executeIntent.value
    expect(intent.enabled).toBe(false)
    if (!intent.enabled) expect(intent.reason).toBe('no-targets')
  })
})
