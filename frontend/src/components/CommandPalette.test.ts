// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { CommandFavorite, CommandHistoryEntry, Connection, ConnectionRuntimeState, TerminalSessionInfo } from '../types'
import { useTerminalStore } from '../stores/terminal'
import { encodeTerminalInputToBase64 } from '../utils/terminalEncoding'
import { confirmDialog, inputDialog } from '../composables/useAppDialog'
import CommandPalette from './CommandPalette.vue'

const apiMock = vi.hoisted(() => ({
  listCommandHistory: vi.fn(),
  listCommandFavorites: vi.fn(),
  updateCommandHistory: vi.fn(),
  deleteCommandHistory: vi.fn(async () => undefined),
  clearCommandHistory: vi.fn(async () => undefined),
  createCommandFavorite: vi.fn(),
  updateCommandFavorite: vi.fn(),
  deleteCommandFavorite: vi.fn(async () => undefined),
  incrementCommandFavoriteUse: vi.fn(),
  recordCommandHistory: vi.fn(),
  recordBatchCommandHistory: vi.fn(),
  writeTerminal: vi.fn(async () => undefined),
  startBatchCommand: vi.fn(),
}))

const dialogMock = vi.hoisted(() => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
  inputDialog: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../api/backend', () => ({ api: apiMock }))
vi.mock('../composables/useAppDialog', () => dialogMock)

const connection: Connection = connectionRow(7, 'server', '192.0.2.7')
const connections: Connection[] = [
  connectionRow(1, 'alpha-prod', '192.0.2.1'),
  connectionRow(2, 'offline-prod', '192.0.2.2'),
  connectionRow(3, 'monitor-only', '192.0.2.3'),
  connectionRow(4, 'connecting-prod', '192.0.2.4'),
  connectionRow(5, 'alpha-prod', '192.0.2.5'),
]

const history: CommandHistoryEntry[] = [{
  id: 'h1',
  serverId: 7,
  serverName: 'server',
  sessionId: 's1',
  command: 'uptime',
  commandHash: 'hash',
  source: 'terminal',
  executedAt: '2026-06-17T00:00:00Z',
}]

const favorite: CommandFavorite = {
  id: 'f1',
  title: 'Disk',
  command: 'df -h',
  description: '',
  scope: 'server',
  serverId: 7,
  groupId: null,
  tags: ['fs'],
  sortOrder: 0,
  useCount: 0,
  createdAt: '',
  updatedAt: '',
  lastUsedAt: '',
}

function connectionRow(id: number, name: string, host: string): Connection {
  return {
    id,
    groupId: 3,
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

function runtimeState(
  connectionId: number,
  values: Partial<ConnectionRuntimeState> = {},
): ConnectionRuntimeState {
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
    ...values,
  }
}

function terminalSession(
  sessionId: string,
  connectionId: number,
  status: TerminalSessionInfo['status'] = 'online',
): TerminalSessionInfo {
  return {
    sessionId,
    connectionId,
    title: `server-${connectionId}`,
    status,
    code: '',
    message: '',
  }
}

function states(): Record<number, ConnectionRuntimeState> {
  return {
    1: runtimeState(1, { status: 'online', terminalActive: true, hasActiveSession: true }),
    2: runtimeState(2, { status: 'offline' }),
    3: runtimeState(3, { status: 'online', monitorActive: true, terminalActive: false, hasActiveSession: true }),
    4: runtimeState(4, { status: 'connecting', terminalConnecting: true, connecting: true, hasActiveSession: true }),
    5: runtimeState(5, { status: 'online', terminalActive: true, hasActiveSession: true }),
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function mountPalette(options: {
  initialTab?: 'history' | 'favorites' | 'batch'
  hasActiveTerminal?: boolean
  pinia?: Pinia
  sessions?: TerminalSessionInfo[]
  activeSessionId?: string
  connections?: Connection[]
  connectionStates?: Record<number, ConnectionRuntimeState>
  connection?: Connection
} = {}) {
  const pinia = options.pinia ?? createPinia()
  const terminalStore = useTerminalStore(pinia)
  terminalStore.tabs.push(...(options.sessions ?? []))
  if (options.activeSessionId) terminalStore.activate(options.activeSessionId)
  const wrapper = mount(CommandPalette, {
    props: {
      open: true,
      initialTab: options.initialTab ?? 'history',
      connection: options.connection ?? connection,
      hasActiveTerminal: options.hasActiveTerminal ?? true,
      connections: options.connections ?? [],
      connectionStates: options.connectionStates ?? {},
    },
    global: { plugins: [pinia] },
  })
  return { wrapper, terminalStore }
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    apiMock.listCommandHistory.mockResolvedValue(history)
    apiMock.listCommandFavorites.mockResolvedValue([favorite])
    apiMock.incrementCommandFavoriteUse.mockResolvedValue({ ...favorite, useCount: 1 })
    apiMock.updateCommandHistory.mockResolvedValue({
      entry: { ...history[0], command: 'uptime -p', commandHash: 'hash-updated' },
    })
    apiMock.createCommandFavorite.mockResolvedValue({
      ...favorite,
      id: 'created',
      title: 'Echo',
      command: 'echo ok',
      scope: 'server',
      tags: ['test'],
    })
    apiMock.recordCommandHistory.mockResolvedValue({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
    })
    apiMock.recordBatchCommandHistory.mockResolvedValue({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
      historyId: 'batch-history-1',
      targetCount: 2,
    })
    apiMock.writeTerminal.mockResolvedValue(undefined)
    dialogMock.confirmDialog.mockResolvedValue(true)
    dialogMock.inputDialog.mockResolvedValue(null)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    })
  })

  it('searches history and inserts or executes without auto-connecting', async () => {
    const { wrapper } = mountPalette()
    await flush()

    expect(apiMock.listCommandHistory).toHaveBeenCalledWith({ serverId: 0, scope: 'all', query: '', limit: 2000 })
    expect(wrapper.get('[data-testid="command-history-list"]').text()).toContain('uptime')

    await wrapper.get('[data-testid="history-insert"]').trigger('click')
    expect(wrapper.emitted('insert')?.[0]).toEqual(['uptime'])

    await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="history-execute"]').trigger('click')
    expect(wrapper.emitted('execute')?.[0]).toEqual(['uptime'])
    expect(apiMock.writeTerminal).not.toHaveBeenCalled()
  })

  it('shows the same batch history badge in the current-server scope', async () => {
    apiMock.listCommandHistory.mockResolvedValue([{
      ...history[0],
      id: 'batch-shared',
      serverId: 0,
      serverName: '',
      sessionId: '',
      command: 'uname -a',
      source: 'batch',
      sourceLabel: '批量',
      targetServerIds: [7, 8],
      targetCount: 2,
    }])
    const { wrapper } = mountPalette()
    await flush()

    const scopeButtons = wrapper.findAll('.command-scope-filter button')
    await scopeButtons[1].trigger('click')
    await flush()

    expect(apiMock.listCommandHistory).toHaveBeenCalledWith({ serverId: 7, scope: 'currentServer', query: '', limit: 2000 })
    expect(wrapper.findAll('.command-history-row')).toHaveLength(1)
    expect(wrapper.get('[data-testid="command-history-list"]').text()).toContain('批量 · 2台')
  })

  it('renders multiline history as one preview row while actions use the full command', async () => {
    const fullCommand = ['echo \\', '1 \\', '2 \\', '你好'].join('\n')
    apiMock.listCommandHistory.mockResolvedValue([{
      ...history[0],
      id: 'multi-1',
      command: fullCommand,
      preview: 'echo \\ ...',
      isMultiline: true,
    }])
    const { wrapper } = mountPalette()
    await flush()

    let row = wrapper.get('.command-history-row')
    expect(wrapper.findAll('.command-history-row')).toHaveLength(1)
    expect(row.get('.command-history-preview').text()).toBe('echo \\ ...')
    expect(row.text()).toContain('多行')
    expect(row.text()).not.toContain('你好')

    await wrapper.get('.command-search').setValue('你好')
    await flush()
    expect(apiMock.listCommandHistory).toHaveBeenCalledWith({ serverId: 0, scope: 'all', query: '你好', limit: 2000 })
    row = wrapper.get('.command-history-row')

    await row.trigger('dblclick')
    expect(wrapper.emitted('insert')?.at(-1)).toEqual([fullCommand])

    await wrapper.setProps({ open: true })
    await flush()
    await wrapper.get('[data-testid="history-edit"]').trigger('click')
    expect((wrapper.get<HTMLTextAreaElement>('.command-history-editor textarea').element).value).toBe(fullCommand)

    await wrapper.get('.command-history-editor .dialog-close-button').trigger('click')
    await wrapper.get('[data-testid="history-copy"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullCommand)

    await wrapper.get('[data-testid="history-favorite"]').trigger('click')
    expect((wrapper.get<HTMLTextAreaElement>('[data-testid="command-favorite-editor"] textarea').element).value).toBe(fullCommand)
  })

  it('shows batch and multiline badges together for batch multiline history', async () => {
    apiMock.listCommandHistory.mockResolvedValue([{
      ...history[0],
      id: 'batch-multi',
      serverId: 0,
      serverName: '',
      sessionId: '',
      command: 'docker ps\ndocker images',
      preview: 'docker ps ...',
      source: 'batch',
      sourceLabel: '批量',
      targetServerIds: [7, 8],
      targetCount: 2,
      isMultiline: true,
    }])
    const { wrapper } = mountPalette()
    await flush()

    const row = wrapper.get('.command-history-row')
    expect(row.text()).toContain('批量 · 2台')
    expect(row.text()).toContain('多行')
    expect(row.get('.command-history-preview').text()).toBe('docker ps ...')
  })

  it('keeps favorites and history insertion behavior intact', async () => {
    const { wrapper } = mountPalette({ initialTab: 'favorites' })
    await flush()

    await wrapper.get('[data-testid="command-favorites-list"] .command-favorite-row').trigger('dblclick')
    await flush()
    expect(apiMock.incrementCommandFavoriteUse).toHaveBeenCalledWith('f1')
    expect(wrapper.emitted('insert')?.at(-1)).toEqual(['df -h'])
    expect(wrapper.emitted('execute')).toBeUndefined()
  })

  it('shows a toast instead of creating a terminal when no active terminal exists', async () => {
    const { wrapper } = mountPalette({ initialTab: 'favorites', hasActiveTerminal: false })
    await flush()

    await wrapper.get('[data-testid="favorite-execute"]').trigger('click')
    await flush()
    expect(wrapper.emitted('execute')).toBeUndefined()
    expect(apiMock.incrementCommandFavoriteUse).not.toHaveBeenCalled()
    expect(wrapper.emitted('notify')?.at(-1)?.[1]).toBe('error')
  })

  it('creates a server-scoped favorite from the editor', async () => {
    const { wrapper } = mountPalette({ initialTab: 'favorites' })
    await flush()

    await wrapper.get('[data-testid="command-add-favorite"]').trigger('click')
    const editor = wrapper.get('[data-testid="command-favorite-editor"]')
    const inputs = editor.findAll('input')
    await inputs[0].setValue('Echo')
    await editor.find('textarea').setValue('echo ok')
    await inputs[2].setValue('test')
    await editor.trigger('submit')
    await flush()

    expect(apiMock.createCommandFavorite).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Echo',
      command: 'echo ok',
      scope: 'server',
      serverId: 7,
      groupId: null,
      tags: ['test', 'shell:ssh'],
      allowSensitive: false,
    }))
  })

  it('confirms before deleting one history entry', async () => {
    const { wrapper } = mountPalette()
    await flush()

    await wrapper.get('.command-history-row .danger-link').trigger('click')
    await flush()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      danger: true,
      hideCloseButton: true,
    }))
    expect(apiMock.deleteCommandHistory).toHaveBeenCalledWith('h1')
  })

  it('filters favorites and common commands by the local shell type', async () => {
    const localCmd = { ...connection, id: -1001, name: 'CMD' }
    localStorage.setItem('serverpilot.commandFavorites.local', JSON.stringify([
      { id: 'fav-cmd', title: 'CMD dir', command: 'dir', description: '', scope: 'server', serverId: -1001, groupId: null, tags: ['shell:cmd'], sortOrder: 0, useCount: 0, createdAt: '', updatedAt: '', lastUsedAt: '' },
      { id: 'fav-ssh', title: 'SSH uptime', command: 'uptime', description: '', scope: 'global', serverId: null, groupId: null, tags: ['shell:ssh'], sortOrder: 0, useCount: 0, createdAt: '', updatedAt: '', lastUsedAt: '' },
    ]))

    const { wrapper } = mountPalette({ initialTab: 'favorites', connection: localCmd })
    await flush()

    expect(wrapper.text()).toContain('CMD dir')
    expect(wrapper.text()).toContain('dir')
    expect(wrapper.text()).not.toContain('SSH uptime')
    expect(wrapper.text()).not.toContain('systemctl')
    expect(apiMock.listCommandFavorites).not.toHaveBeenCalled()
  })

  it('renders batch tab with only online writable SSH terminal servers by name', async () => {
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections,
      connectionStates: states(),
      sessions: [
        terminalSession('term-1', 1),
        terminalSession('term-monitor-only', 3),
        terminalSession('term-connecting', 4, 'connecting'),
        terminalSession('term-5', 5),
      ],
      activeSessionId: 'term-1',
    })
    await flush()

    const list = wrapper.get('[data-testid="batch-server-list"]')
    expect(list.text()).toContain('alpha-prod')
    expect(list.text()).not.toContain('offline-prod')
    expect(list.text()).not.toContain('monitor-only')
    expect(list.text()).not.toContain('connecting-prod')
    expect(wrapper.text()).not.toContain('192.0.2.')
    expect(wrapper.text()).not.toContain('root@')
    expect(wrapper.find('[data-testid="batch-results"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('stdout')
    expect(wrapper.text()).not.toContain('stderr')

    const firstChip = wrapper.findAll('.batch-server-chip')[0]
    expect(firstChip.attributes('aria-pressed')).toBe('false')
    await firstChip.trigger('click')
    expect(firstChip.attributes('aria-pressed')).toBe('true')
    await firstChip.trigger('click')
    expect(firstChip.attributes('aria-pressed')).toBe('false')
  })

  it('selects and inverts only current online SSH terminal targets', async () => {
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections,
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1), terminalSession('term-5', 5)],
    })
    await flush()

    await wrapper.get('[data-testid="batch-select-all"]').trigger('click')
    expect(wrapper.findAll('.batch-server-chip[aria-pressed="true"]')).toHaveLength(2)

    await wrapper.get('[data-testid="batch-invert"]').trigger('click')
    expect(wrapper.findAll('.batch-server-chip[aria-pressed="true"]')).toHaveLength(0)
  })

  it('confirms and sends the normalized command through existing terminal sessions only once per server', async () => {
    const { wrapper, terminalStore } = mountPalette({
      initialTab: 'batch',
      connections,
      connectionStates: states(),
      sessions: [
        terminalSession('term-1-old', 1),
        terminalSession('term-1-recent', 1),
        terminalSession('term-5', 5),
      ],
    })
    terminalStore.activate('term-1-recent')
    terminalStore.activate('term-5')
    await flush()

    await wrapper.get('[data-testid="batch-select-all"]').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('uptime\n')
    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认执行',
      confirmText: '确认执行',
    }))
    expect(apiMock.writeTerminal).toHaveBeenCalledTimes(2)
    expect(apiMock.writeTerminal).toHaveBeenCalledWith('term-1-recent', encodeTerminalInputToBase64('uptime\r'))
    expect(apiMock.writeTerminal).toHaveBeenCalledWith('term-5', encodeTerminalInputToBase64('uptime\r'))
    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledTimes(1)
    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledWith({
      command: 'uptime',
      successfulServerIds: [1, 5],
      submissionId: expect.stringMatching(/^batch-/),
    })
    expect(apiMock.recordCommandHistory).not.toHaveBeenCalled()
    expect(apiMock.startBatchCommand).not.toHaveBeenCalled()
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['已将命令发送到 2 台在线服务器，并写入历史记录。', 'success'])
    expect(apiMock.listCommandHistory).toHaveBeenCalledWith({ serverId: 0, scope: 'all', query: '', limit: 2000 })
    expect(apiMock.listCommandHistory).toHaveBeenCalledWith({ serverId: 7, scope: 'currentServer', query: '', limit: 2000 })
  })

  it('re-resolves targets after confirmation and reports partial failures', async () => {
    const { wrapper, terminalStore } = mountPalette({
      initialTab: 'batch',
      connections,
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1), terminalSession('term-5', 5)],
    })
    await flush()
    await wrapper.get('[data-testid="batch-select-all"]').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('date')
    dialogMock.confirmDialog.mockImplementationOnce(async () => {
      terminalStore.tabs.find((tab) => tab.sessionId === 'term-1')!.status = 'offline'
      return true
    })

    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(apiMock.writeTerminal).toHaveBeenCalledTimes(1)
    expect(apiMock.writeTerminal).toHaveBeenCalledWith('term-5', encodeTerminalInputToBase64('date\r'))
    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledTimes(1)
    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledWith({
      command: 'date',
      successfulServerIds: [5],
      submissionId: expect.stringMatching(/^batch-/),
    })
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['已发送到 1 台并写入历史记录，1 台发送失败或终端已关闭。', 'error'])
  })

  it('requires typed confirmation for dangerous batch commands', async () => {
    dialogMock.inputDialog.mockResolvedValueOnce(null)
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections: [connections[0]],
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1)],
    })
    await flush()

    await wrapper.get('.batch-server-chip').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('rm -rf /tmp/demo')
    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(inputDialog).toHaveBeenCalled()
    expect(apiMock.writeTerminal).not.toHaveBeenCalled()
  })

  it('records multiline batch commands as one batch history request', async () => {
    apiMock.recordBatchCommandHistory.mockResolvedValue({
      recorded: true,
      skipped: false,
      reasonCode: '',
      message: '',
      historyId: 'batch-multiline-1',
      targetCount: 1,
    })
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections: [connections[0]],
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1)],
    })
    await flush()

    await wrapper.get('.batch-server-chip').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('echo one\necho two')
    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(apiMock.writeTerminal).toHaveBeenCalledWith('term-1', encodeTerminalInputToBase64('echo one\necho two\r'))
    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledWith({
      command: 'echo one\necho two',
      successfulServerIds: [1],
      submissionId: expect.stringMatching(/^batch-/),
    })
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['已将命令发送到 1 台在线服务器，并写入历史记录。', 'success'])
  })

  it('relies on the command history service to skip sensitive batch commands', async () => {
    apiMock.recordBatchCommandHistory.mockResolvedValue({
      recorded: false,
      skipped: true,
      reasonCode: 'SENSITIVE',
      message: '该命令可能包含敏感信息，已跳过历史记录',
    })
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections: [connections[0]],
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1)],
    })
    await flush()

    await wrapper.get('.batch-server-chip').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue("curl -H 'Authorization: Bearer secret' https://example.invalid")
    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(apiMock.writeTerminal).toHaveBeenCalledTimes(1)
    expect(apiMock.recordBatchCommandHistory).toHaveBeenCalledWith(expect.objectContaining({
      command: "curl -H 'Authorization: Bearer secret' https://example.invalid",
      successfulServerIds: [1],
    }))
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['命令已发送；根据历史记录安全规则，本次命令未保存。', 'success'])
  })

  it('keeps terminal sends when batch history recording fails', async () => {
    apiMock.recordBatchCommandHistory.mockRejectedValue(new Error('COMMAND_HISTORY_WRITE_FAILED: 写入历史失败'))
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections: [connections[0]],
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1)],
    })
    await flush()

    await wrapper.get('.batch-server-chip').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('hostname')
    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(apiMock.writeTerminal).toHaveBeenCalledWith('term-1', encodeTerminalInputToBase64('hostname\r'))
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['命令已发送到 1 台服务器，但有 1 条历史记录保存失败。', 'error'])
  })

  it('refreshes command history after a successful batch send so the history tab shows new entries', async () => {
    const batchHistory = [
      { ...history[0], id: 'batch-1', serverId: 0, serverName: '', sessionId: '', command: 'uname -a', source: 'batch', sourceLabel: '批量', targetServerIds: [1, 5], targetCount: 2 },
    ]
    apiMock.listCommandHistory.mockResolvedValue(batchHistory)
    const { wrapper } = mountPalette({
      initialTab: 'batch',
      connections,
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1), terminalSession('term-5', 5)],
    })
    await flush()

    await wrapper.get('[data-testid="batch-select-all"]').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('uname -a')
    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()
    await wrapper.get('.command-palette-tabs button').trigger('click')
    await flush()

    expect(apiMock.listCommandHistory).toHaveBeenCalledWith({ serverId: 0, scope: 'all', query: '', limit: 2000 })
    expect(wrapper.get('[data-testid="command-history-list"]').text()).toContain('uname -a')
    expect(wrapper.get('[data-testid="command-history-list"]').text()).toContain('批量 · 2台')
  })

  it('shows an all-failed toast when no selected terminal remains writable after confirmation', async () => {
    const { wrapper, terminalStore } = mountPalette({
      initialTab: 'batch',
      connections: [connections[0]],
      connectionStates: states(),
      sessions: [terminalSession('term-1', 1)],
    })
    await flush()
    await wrapper.get('.batch-server-chip').trigger('click')
    await wrapper.get('[data-testid="batch-command-input"]').setValue('hostname')
    dialogMock.confirmDialog.mockImplementationOnce(async () => {
      terminalStore.tabs[0].status = 'offline'
      return true
    })

    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    await flush()

    expect(apiMock.writeTerminal).not.toHaveBeenCalled()
    expect(apiMock.recordCommandHistory).not.toHaveBeenCalled()
    expect(apiMock.recordBatchCommandHistory).not.toHaveBeenCalled()
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['命令发送失败，没有可用的 SSH 终端。', 'error'])
  })
})
