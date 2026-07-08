// @vitest-environment jsdom

import { createPinia } from 'pinia'
import { DOMWrapper, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../stores/terminal'
import { useLocalTerminalStore } from '../stores/localTerminal'
import { useCommandStore } from '../stores/commands'
import { useSftpStore } from '../stores/sftp'
import { useTunnelStore } from '../stores/tunnels'
import { resolveAppDialog, useAppDialog } from '../composables/useAppDialog'
import type { Connection, ConnectionError, ConnectionRuntimeState, LocalTerminalState, TerminalProfile, TerminalSessionInfo, TunnelRuntime } from '../types'
import TerminalWorkspace from './TerminalWorkspace.vue'

const terminalRegistryMock = vi.hoisted(() => ({
  observeTerminalInstanceInput: vi.fn(() => true),
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
  OnFileDrop: vi.fn(),
  OnFileDropOff: vi.fn(),
}))
vi.mock('../utils/terminalInstanceRegistry', () => terminalRegistryMock)
vi.mock('./TerminalView.vue', () => ({
  default: {
    name: 'TerminalView',
    props: ['profile', 'connection', 'sessionId', 'layoutRevision'],
    template: '<div class="terminal-view-stub" :data-stub-session-id="sessionId" :data-layout-revision="layoutRevision" :layout-revision="layoutRevision" />',
  },
}))
vi.mock('./LocalTerminalView.vue', () => ({
  default: {
    name: 'LocalTerminalView',
    props: ['profile', 'sessionId', 'layoutRevision', 'active', 'visible'],
    emits: ['command'],
    template: '<div class="local-terminal-view-stub" :data-stub-local-session-id="sessionId" :data-layout-revision="layoutRevision" :layout-revision="layoutRevision" :data-active="active" :data-visible="visible" />',
  },
}))

const terminalViewStub = {
  name: 'TerminalView',
  props: ['profile', 'connection', 'sessionId', 'layoutRevision'],
  template: '<div class="terminal-view-stub" :data-stub-session-id="sessionId" :data-layout-revision="layoutRevision" :layout-revision="layoutRevision" />',
}

const localTerminalViewStub = {
  name: 'LocalTerminalView',
  props: ['profile', 'sessionId', 'layoutRevision', 'active', 'visible'],
  emits: ['command'],
  template: '<div class="local-terminal-view-stub" :data-stub-local-session-id="sessionId" :data-layout-revision="layoutRevision" :layout-revision="layoutRevision" :data-active="active" :data-visible="visible" />',
}

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
  hostKeyFingerprint: 'SHA256:test',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}
const defaultProfile: TerminalProfile = {
  id: 'default',
  name: '默认',
  fontFamily: 'Consolas',
  fontSize: 15,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  themeName: 'serverpilot-dark',
  foreground: '#eceff4',
  background: '#1f2023',
  selectionBackground: '#3f7dff66',
  cursorColor: '#f5f7fa',
  createdAt: '',
  updatedAt: '',
}
const customProfile: TerminalProfile = {
  ...defaultProfile,
  id: 'tp-ops',
  name: 'Ops',
  fontSize: 18,
}
const connectionError: ConnectionError = {
  code: 'AUTH_FAILED',
  userMessage: 'SSH authentication failed',
  technicalMessage: 'ssh: unable to authenticate, attempted methods [none password]',
  retryable: false,
  serverId: 7,
  operation: 'terminal.connect',
  timestamp: '2026-06-14T00:00:00Z',
}

function state(values: Partial<ConnectionRuntimeState> = {}): ConnectionRuntimeState {
  return {
    connectionId: 7,
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

function tunnel(values: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    tunnelID: 'tun-1',
    serverID: 7,
    profileID: 1,
    name: 'web',
    type: 'local',
    status: 'running',
    bindHost: '127.0.0.1',
    bindPort: 8080,
    targetHost: '127.0.0.1',
    targetPort: 80,
    remoteBindHost: '',
    remoteBindPort: 0,
    requestedListen: '',
    actualListen: '',
    effectiveRemoteBindHost: '',
    effectiveListenAddrs: [],
    remoteListenExposure: 'unknown',
    remoteListenCheckStatus: 'unchecked',
    remoteListenWarning: '',
    testCommand: '',
    activeConnections: 0,
    bytesIn: 0,
    bytesOut: 0,
    startedAt: '2026-06-18T00:00:00Z',
    updatedAt: '2026-06-18T00:00:00Z',
    error: '',
    ...values,
  }
}

function localState(sessionId: string, overrides: Partial<LocalTerminalState> = {}): LocalTerminalState {
  return {
    sessionId,
    shellKind: 'powershell',
    shell: 'PowerShell',
    shellName: 'powershell.exe',
    elevated: false,
    title: 'PowerShell',
    cwd: 'C:\\Users\\Administrator',
    status: 'running',
    exitCode: null,
    error: '',
    startedAt: '2026-06-17T00:00:00Z',
    endedAt: '',
    ...overrides,
  }
}

function mountWorkspace(runtimeState: ConnectionRuntimeState) {
  const pinia = createPinia()
  const store = useTerminalStore(pinia)
  const localStore = useLocalTerminalStore(pinia)
  const commandStore = useCommandStore(pinia)
  store.navigateToServer(connection)
  store.syncConnectionState(connection, runtimeState)
  const wrapper = mount(TerminalWorkspace, {
    props: {
      connection,
      state: runtimeState,
      snapshot: null,
      history: [],
      layoutRevision: 0,
      connections: [connection],
      terminalProfiles: [defaultProfile, customProfile],
      defaultTerminalProfile: defaultProfile,
    },
    global: {
      plugins: [pinia],
      stubs: {
        TerminalView: terminalViewStub,
        LocalTerminalView: localTerminalViewStub,
        CompactMonitorSidebar: true,
        ContextMenu: true,
      },
    },
    slots: {
      tabs: '<div class="tabs-slot">tabs</div>',
    },
  })
  return { wrapper, store, localStore, commandStore }
}

async function setSplitMode(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  mode: 'single' | 'vertical' | 'horizontal' | 'quad',
) {
  window.dispatchEvent(new CustomEvent('serverpilot:workspace-split-mode-change', {
    detail: { mode },
  }))
  await wrapper.vm.$nextTick()
}

function splitLayout() {
  return JSON.parse(localStorage.getItem('serverpilot.workspaceSplitLayout.v1') ?? '{}') as {
    splitMode?: string
    activePaneId?: string
    paneAssignments?: Record<string, string | { kind?: string; sessionId?: string } | null>
    columnRatio?: number
    rowRatio?: number
  }
}

async function addSshTab(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  store: ReturnType<typeof useTerminalStore>,
  sessionId: string,
  title = sessionId,
) {
  store.tabs.push({ sessionId, connectionId: 7, title, status: 'online', code: '', message: '' })
  store.workspaces[7].status = 'connected'
  store.activate(sessionId)
  await wrapper.vm.$nextTick()
}

function paneSessionIds(wrapper: ReturnType<typeof mountWorkspace>['wrapper']) {
  return ['pane-1', 'pane-2', 'pane-3', 'pane-4'].map((paneId) => {
    const assigned = wrapper.find(`[data-pane-id="${paneId}"] .terminal-pane-assigned`)
    return assigned.exists() ? assigned.attributes('data-session-id') ?? null : null
  })
}

function paneLocalSessionIds(wrapper: ReturnType<typeof mountWorkspace>['wrapper']) {
  return ['pane-1', 'pane-2', 'pane-3', 'pane-4'].map((paneId) => {
    const assigned = wrapper.find(`[data-pane-id="${paneId}"] .terminal-pane-assigned`)
    return assigned.exists() ? assigned.attributes('data-local-session-id') ?? null : null
  })
}

function paneLayoutRevisions(wrapper: ReturnType<typeof mountWorkspace>['wrapper']) {
  return [
    ...wrapper.findAllComponents({ name: 'TerminalView' }),
    ...wrapper.findAllComponents({ name: 'LocalTerminalView' }),
  ].map((view) => Number(view.attributes('layout-revision')))
}

function getTeleportedPaneMenu(selector = '.terminal-pane-menu') {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Unable to get ${selector} from document.body`)
  return new DOMWrapper(element)
}

function findAllTeleportedPaneMenu(selector: string) {
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
    .map((element) => new DOMWrapper(element))
}

function hasTeleportedPaneMenu() {
  return Boolean(document.body.querySelector('.terminal-pane-menu'))
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

function mockTransferButtonRect(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  rect: Partial<DOMRect>,
) {
  const button = wrapper.get('.status-transfer').element as HTMLElement
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    width: rect.width ?? 96,
    height: rect.height ?? 24,
    top: rect.top ?? rect.y ?? 0,
    right: rect.right ?? (rect.left ?? rect.x ?? 0) + (rect.width ?? 96),
    bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + (rect.height ?? 24),
    left: rect.left ?? rect.x ?? 0,
    toJSON: () => undefined,
  } as DOMRect)
}

function mockSftpPanelRect(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  rect: Partial<DOMRect>,
) {
  const panel = wrapper.get('.sftp-panel').element as HTMLElement
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    width: rect.width ?? 1200,
    height: rect.height ?? 320,
    top: rect.top ?? rect.y ?? 0,
    right: rect.right ?? (rect.left ?? rect.x ?? 0) + (rect.width ?? 1200),
    bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + (rect.height ?? 320),
    left: rect.left ?? rect.x ?? 0,
    toJSON: () => undefined,
  } as DOMRect)
}

function mockWorkspaceShellRect(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  rect: Partial<DOMRect>,
) {
  const shell = wrapper.get('.workspace-shell').element as HTMLElement
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    width: rect.width ?? 1200,
    height: rect.height ?? 800,
    top: rect.top ?? rect.y ?? 0,
    right: rect.right ?? (rect.left ?? rect.x ?? 0) + (rect.width ?? 1200),
    bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + (rect.height ?? 800),
    left: rect.left ?? rect.x ?? 0,
    toJSON: () => undefined,
  } as DOMRect)
}

async function openTransferPopoverWithTransfer(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  options: {
    viewport?: { width: number; height: number }
    rect?: Partial<DOMRect>
    workspaceRect?: Partial<DOMRect>
  } = {},
) {
  const sftpStore = useSftpStore()
  sftpStore.transfersById.visible = {
    id: 'visible',
    connectionId: 7,
    direction: 'upload',
    localPath: 'C:/tmp/visible.txt',
    remotePath: '/home/demo/visible.txt',
    fileName: 'visible.txt',
    currentFile: 'visible.txt',
    totalBytes: 100,
    transferredBytes: 20,
    percent: 20,
    speedBytesPerSecond: 1024,
    status: 'running',
    errorMessage: '',
    cancelable: true,
    startedAt: '2026-06-16T00:00:02Z',
    finishedAt: '',
  }
  setViewportSize(options.viewport?.width ?? 360, options.viewport?.height ?? 240)
  mockWorkspaceShellRect(wrapper, options.workspaceRect ?? {
    left: 0,
    top: 0,
    right: options.viewport?.width ?? 360,
    bottom: options.viewport?.height ?? 240,
    width: options.viewport?.width ?? 360,
    height: options.viewport?.height ?? 240,
  })
  mockTransferButtonRect(wrapper, options.rect ?? {
    left: 318,
    top: 214,
    right: 354,
    bottom: 236,
    width: 36,
    height: 22,
  })
  await wrapper.vm.$nextTick()
  await wrapper.get('.status-transfer').trigger('click')
  await wrapper.vm.$nextTick()
  await Promise.resolve()
  await wrapper.vm.$nextTick()
  return document.body.querySelector('.transfer-popover') as HTMLElement | null
}

async function addLocalTab(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  localStore: ReturnType<typeof useLocalTerminalStore>,
  sessionId: string,
  overrides: Partial<LocalTerminalState> = {},
) {
  localStore.sessions.push(localState(sessionId, overrides))
  localStore.activate(sessionId)
  await wrapper.vm.$nextTick()
}

function mockSplitWorkspaceRect(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  rect: Partial<DOMRect> = {},
) {
  const element = wrapper.get('.terminal-split-workspace').element as HTMLElement
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 1000,
    height: rect.height ?? 800,
    top: rect.top ?? rect.y ?? 0,
    right: rect.right ?? (rect.x ?? 0) + (rect.width ?? 1000),
    bottom: rect.bottom ?? (rect.y ?? 0) + (rect.height ?? 800),
    left: rect.left ?? rect.x ?? 0,
    toJSON: () => undefined,
  } as DOMRect)
}

async function dragSplitter(
  wrapper: ReturnType<typeof mountWorkspace>['wrapper'],
  selector: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  wrapper.get(selector).element.dispatchEvent(new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: start.x,
    clientY: start.y,
  }))
  window.dispatchEvent(new MouseEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    clientX: end.x,
    clientY: end.y,
  }))
  window.dispatchEvent(new MouseEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX: end.x,
    clientY: end.y,
  }))
  await wrapper.vm.$nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
}

describe('TerminalWorkspace server states', () => {
  beforeEach(() => {
    resolveAppDialog(null)
    localStorage.clear()
    window.go = {
      main: {
        App: {
          SftpCancelTransfer: vi.fn(async () => undefined),
          SftpPauseTransfer: vi.fn(async (request: { transferID: string }) => ({ transferID: request.transferID, status: 'pausing' })),
          SftpResumeTransfer: vi.fn(async (request: { transferID: string }) => ({ transferID: request.transferID, status: 'resuming' })),
          CloseSftpContext: vi.fn(async () => undefined),
          CloseTerminal: vi.fn(async () => undefined),
          OpenTerminal: vi.fn(async () => undefined),
          ReconnectTerminal: vi.fn(async () => undefined),
          DisconnectServer: vi.fn(async () => undefined),
          WriteTerminal: vi.fn(async () => undefined),
          OpenLocalTerminal: vi.fn(async () => undefined),
          WriteLocalTerminal: vi.fn(async () => undefined),
          ResizeLocalTerminal: vi.fn(async () => undefined),
          CloseLocalTerminal: vi.fn(async () => undefined),
          RecordCommandHistory: vi.fn(async () => ({ recorded: true, skipped: false, reasonCode: '', message: '' })),
        } as never,
      },
    }
    terminalRegistryMock.observeTerminalInstanceInput.mockReset()
    terminalRegistryMock.observeTerminalInstanceInput.mockReturnValue(true)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('confirm', vi.fn())
  })

  it('renders the failed server, Chinese summary, technical detail, and actions', () => {
    const { wrapper } = mountWorkspace(state({
      status: 'auth_failed',
      lastError: connectionError,
    }))

    expect(wrapper.text()).toContain('server')
    expect(wrapper.text()).toContain('连接失败')
    expect(wrapper.text()).toContain('SSH authentication failed')
    expect(wrapper.text()).toContain('unable to authenticate')
    expect(wrapper.text()).toContain('重新连接')
    expect(wrapper.text()).toContain('编辑凭据')
    expect(wrapper.text()).toContain('断开此服务器')
  })

  it('shows a host-key trust action instead of credential editing for strict fingerprint failures', async () => {
    const { wrapper } = mountWorkspace(state({
      lastError: {
        ...connectionError,
        code: 'HOST_KEY_MISMATCH',
        userMessage: '服务器主机指纹与已保存记录不一致',
        technicalMessage: 'saved SHA256:old observed SHA256:new',
      },
    }))

    expect(wrapper.text()).toContain('信任并更新后连接')
    expect(wrapper.text()).not.toContain('编辑凭据')

    await wrapper.get('.workspace-actions .secondary').trigger('click')

    expect(wrapper.emitted('trustHostKey')).toEqual([[7]])
    expect(wrapper.emitted('editWorkspace')).toBeUndefined()
  })

  it('renders an offline workspace without starting a connection', () => {
    const { wrapper, store } = mountWorkspace(state())
    expect(wrapper.text()).toContain('尚未连接')
    expect(wrapper.text()).toContain('连接')
    expect(store.tabs).toHaveLength(0)
  })

  it('keeps the sidebar separate from the right terminal, SFTP, and status regions', () => {
    const { wrapper } = mountWorkspace(state())
    const shell = wrapper.find('.workspace-shell')
    expect(shell.attributes('style')).toContain('300px')
    expect(shell.element.children[0].tagName.toLowerCase()).toContain('compact')
    const right = wrapper.find('.right-workspace')
    expect(right.attributes('style')).toContain('minmax(180px, 1fr) 10px 0 28px')
    expect(right.find('.terminal-stage').exists()).toBe(true)
    expect(right.find('.terminal-stage .terminal-command-button').exists()).toBe(true)
    expect(right.find('.terminal-statusbar .terminal-command-button').exists()).toBe(false)
    expect(right.find('.horizontal-splitter .bottom-panel-toggle-handle').exists()).toBe(false)
    expect(right.find('.horizontal-splitter svg.splitter-chevron').exists()).toBe(false)
    expect(right.find('.sftp-panel').exists()).toBe(true)
    expect(right.find('.sftp-panel').text()).not.toContain('SFTP')
    expect(right.find('.terminal-statusbar').exists()).toBe(true)
    expect(shell.find('.sftp-rail').exists()).toBe(false)
    expect(shell.find('.tabs-slot').exists()).toBe(true)
    expect(shell.element.children[0].tagName.toLowerCase()).toBe('compact-monitor-sidebar-stub')
  })

  it('does not render the old split menu inside the terminal stage', () => {
    const { wrapper } = mountWorkspace(state())

    expect(wrapper.find('.terminal-stage .terminal-split-controls').exists()).toBe(false)
    expect(wrapper.find('.terminal-stage .split-mode-button').exists()).toBe(false)
  })

  it('auto-expands and auto-hides SFTP from the plain horizontal splitter', async () => {
    const { wrapper } = mountWorkspace(state())
    const root = wrapper.get('.workspace-shell').element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1200, height: 700, top: 0, right: 1200,
      bottom: 700, left: 0, toJSON: () => undefined,
    })
    expect(wrapper.find('.horizontal-splitter .bottom-panel-toggle-handle').exists()).toBe(false)
    expect(wrapper.find('.horizontal-splitter svg.splitter-chevron').exists()).toBe(false)
    expect(wrapper.find('.sftp-panel').classes()).not.toContain('expanded')

    await dragSplitter(wrapper, '.horizontal-splitter', { x: 500, y: 670 }, { x: 500, y: 420 })
    expect(wrapper.find('.sftp-panel').classes()).toContain('expanded')
    expect(wrapper.find('.right-workspace').attributes('style')).toContain('10px 252px 28px')
    expect(localStorage.getItem('serverpilot.sftpExpanded')).toBe('true')
    expect(localStorage.getItem('serverpilot.sftpHeight')).toBe('252')

    await dragSplitter(wrapper, '.horizontal-splitter', { x: 500, y: 420 }, { x: 500, y: 620 })
    expect(wrapper.find('.sftp-panel').classes()).not.toContain('expanded')
    expect(localStorage.getItem('serverpilot.sftpExpanded')).toBe('false')
  })

  it('auto-collapses and restores the monitor sidebar from the plain vertical splitter', async () => {
    const { wrapper } = mountWorkspace(state())
    const root = wrapper.get('.workspace-shell').element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1200, height: 700, top: 0, right: 1200,
      bottom: 700, left: 0, toJSON: () => undefined,
    })
    expect(wrapper.find('.vertical-splitter .sidebar-toggle').exists()).toBe(false)
    expect(wrapper.find('.vertical-splitter svg.splitter-chevron').exists()).toBe(false)

    await dragSplitter(wrapper, '.vertical-splitter', { x: 300, y: 300 }, { x: 120, y: 300 })
    expect(wrapper.find('.workspace-shell').classes()).toContain('sidebar-collapsed')
    expect(localStorage.getItem('serverpilot.monitorSidebarCollapsed')).toBe('true')
    expect(wrapper.find('.right-workspace').exists()).toBe(true)

    await dragSplitter(wrapper, '.vertical-splitter', { x: 12, y: 300 }, { x: 360, y: 300 })
    expect(wrapper.find('.workspace-shell').classes()).not.toContain('sidebar-collapsed')
    expect(localStorage.getItem('serverpilot.monitorSidebarCollapsed')).toBe('false')
    expect(localStorage.getItem('serverpilot.monitorSidebarWidth')).toBe('360')
  })

  it('does not collapse after dragging the sidebar splitter', async () => {
    const { wrapper } = mountWorkspace(state())
    const root = wrapper.get('.workspace-shell').element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1200, height: 700, top: 0, right: 1200,
      bottom: 700, left: 0, toJSON: () => undefined,
    })
    const down = new Event('pointerdown', { bubbles: true })
    Object.defineProperties(down, {
      pointerId: { value: 1 },
      clientX: { value: 300 },
    })
    wrapper.get('.vertical-splitter').element.dispatchEvent(down)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 360 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(wrapper.find('.workspace-shell').classes()).not.toContain('sidebar-collapsed')
    expect(localStorage.getItem('serverpilot.monitorSidebarWidth')).toBe('360')
  })

  it('uses Chinese status text and omits terminal rows and columns', () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.workspaces[connection.id].status = 'connected'
    expect(wrapper.get('.terminal-statusbar').text()).toContain('已连接')
    expect(wrapper.get('.terminal-statusbar').text()).not.toMatch(/\d+\s*脳\s*\d+/)
  })

  it('seeds the active TerminalView draft before executing command palette commands', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'uptime')
    await Promise.resolve()

    expect(terminalRegistryMock.observeTerminalInstanceInput).toHaveBeenCalledWith('term-1', 'uptime\r')
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'term-1',
      dataBase64: btoa('uptime\r'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()
  })

  it('falls back to direct history recording only when no TerminalView draft observer is registered', async () => {
    terminalRegistryMock.observeTerminalInstanceInput.mockReturnValue(false)
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'uptime')
    await Promise.resolve()
    await Promise.resolve()

    expect(terminalRegistryMock.observeTerminalInstanceInput).toHaveBeenCalledWith('term-1', 'uptime\r')
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'term-1',
      command: 'uptime',
      source: 'terminal',
    })
  })

  it('switches to vertical SSH split panes and keeps sessions owned by the terminal store', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'vertical')

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('split-vertical')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(wrapper.findAllComponents({ name: 'TerminalView' })).toHaveLength(2)
    expect(wrapper.find('[data-pane-id="pane-1"]').text()).toContain('server #1')
    expect(store.activeSessionId).toBe('term-1')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
  })

  it('switches to horizontal and quad split layouts without closing sessions', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
      { sessionId: 'term-3', connectionId: 7, title: 'server #3', status: 'online', code: '', message: '' },
      { sessionId: 'term-4', connectionId: 7, title: 'server #4', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'horizontal')
    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('split-horizontal')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)

    await setSplitMode(wrapper, 'quad')
    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('split-quad')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(4)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2', 'term-3', 'term-4'])
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('renders splitters only for split layouts and persists default ratios', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
      { sessionId: 'term-3', connectionId: 7, title: 'server #3', status: 'online', code: '', message: '' },
      { sessionId: 'term-4', connectionId: 7, title: 'server #4', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'vertical')
    expect(wrapper.findAll('.terminal-pane-splitter.column')).toHaveLength(1)
    expect(wrapper.findAll('.terminal-pane-splitter.row')).toHaveLength(0)
    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-column-ratio: 0.5')
    expect(splitLayout()).toMatchObject({ splitMode: 'vertical', columnRatio: 0.5, rowRatio: 0.5 })

    await setSplitMode(wrapper, 'horizontal')
    expect(wrapper.findAll('.terminal-pane-splitter.column')).toHaveLength(0)
    expect(wrapper.findAll('.terminal-pane-splitter.row')).toHaveLength(1)
    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-row-ratio: 0.5')
    expect(splitLayout()).toMatchObject({ splitMode: 'horizontal', columnRatio: 0.5, rowRatio: 0.5 })

    await setSplitMode(wrapper, 'quad')
    expect(wrapper.findAll('.terminal-pane-splitter.column')).toHaveLength(1)
    expect(wrapper.findAll('.terminal-pane-splitter.row')).toHaveLength(1)
    expect(splitLayout()).toMatchObject({ splitMode: 'quad', columnRatio: 0.5, rowRatio: 0.5 })

    await setSplitMode(wrapper, 'single')
    expect(wrapper.find('.terminal-split-workspace').exists()).toBe(false)
    expect(wrapper.find('.terminal-pane-splitter').exists()).toBe(false)
  })

  it('drags vertical and horizontal splitters, clamps ratios, and persists them without terminal side effects', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'vertical')
    mockSplitWorkspaceRect(wrapper, { width: 1000, height: 800 })
    wrapper.get('.terminal-pane-splitter.column').element.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 500,
      clientY: 300,
    }))
    expect(document.body.classList.contains('workspace-pane-resizing')).toBe(true)
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 900, clientY: 300 }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 900, clientY: 300 }))
    await wrapper.vm.$nextTick()
    expect(document.body.classList.contains('workspace-pane-resizing')).toBe(false)
    expect(splitLayout().columnRatio).toBe(0.75)
    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-column-ratio: 0.75')

    await setSplitMode(wrapper, 'horizontal')
    mockSplitWorkspaceRect(wrapper, { width: 1000, height: 800 })
    await dragSplitter(wrapper, '.terminal-pane-splitter.row', { x: 500, y: 400 }, { x: 500, y: 80 })
    expect(splitLayout().rowRatio).toBe(0.25)
    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-row-ratio: 0.25')
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
  })

  it('updates only the dragged quad ratio and bumps visible terminal layout revisions', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
      { sessionId: 'term-3', connectionId: 7, title: 'server #3', status: 'online', code: '', message: '' },
      { sessionId: 'term-4', connectionId: 7, title: 'server #4', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'quad')
    mockSplitWorkspaceRect(wrapper, { width: 1000, height: 800 })
    const before = wrapper.findAllComponents({ name: 'TerminalView' })
      .map((view) => Number(view.attributes('layout-revision')))

    await dragSplitter(wrapper, '.terminal-pane-splitter.column', { x: 500, y: 300 }, { x: 640, y: 300 })
    expect(splitLayout()).toMatchObject({ columnRatio: 0.64, rowRatio: 0.5 })

    await dragSplitter(wrapper, '.terminal-pane-splitter.row', { x: 500, y: 400 }, { x: 500, y: 560 })
    expect(splitLayout()).toMatchObject({ columnRatio: 0.64, rowRatio: 0.7 })
    const after = wrapper.findAllComponents({ name: 'TerminalView' })
      .map((view) => Number(view.attributes('layout-revision')))
    expect(after.every((revision, index) => revision > before[index])).toBe(true)
  })

  it('restores missing, corrupt, and persisted split ratios safely from localStorage', async () => {
    localStorage.setItem('serverpilot.workspaceSplitLayout.v1', JSON.stringify({
      splitMode: 'quad',
      columnRatio: 'bad',
      rowRatio: 2,
      paneAssignments: {
        'pane-1': 'term-1',
        'pane-2': 'term-2',
      },
    }))
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-column-ratio: 0.5')
    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-row-ratio: 0.75')
    expect(splitLayout()).toMatchObject({ columnRatio: 0.5, rowRatio: 0.75 })

    await dragSplitter(wrapper, '.terminal-pane-splitter.column', { x: 500, y: 300 }, { x: 330, y: 300 })
    const persisted = splitLayout()
    wrapper.unmount()

    const remount = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    remount.store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    remount.store.workspaces[7].status = 'connected'
    remount.store.activate('term-1')
    await remount.wrapper.vm.$nextTick()

    expect(remount.wrapper.get('.terminal-split-workspace').attributes('style')).toContain(`--split-column-ratio: ${persisted.columnRatio}`)
    expect(remount.wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-row-ratio: 0.75')
  })

  it('resets split ratios from the topbar split menu event without changing pane assignments', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    await setSplitMode(wrapper, 'quad')
    mockSplitWorkspaceRect(wrapper, { width: 1000, height: 800 })
    await dragSplitter(wrapper, '.terminal-pane-splitter.column', { x: 500, y: 300 }, { x: 680, y: 300 })
    await dragSplitter(wrapper, '.terminal-pane-splitter.row', { x: 500, y: 400 }, { x: 500, y: 560 })
    const beforeAssignments = splitLayout().paneAssignments
    const beforeRevisions = paneLayoutRevisions(wrapper)

    window.dispatchEvent(new CustomEvent('serverpilot:workspace-split-ratio-reset'))
    await wrapper.vm.$nextTick()

    expect(splitLayout()).toMatchObject({ columnRatio: 0.5, rowRatio: 0.5 })
    expect(splitLayout().paneAssignments).toEqual(beforeAssignments)
    expect(paneLayoutRevisions(wrapper).every((revision, index) => revision > beforeRevisions[index])).toBe(true)
  })

  it('clears all panes only after AppDialogHost confirmation without closing SSH or Local sessions', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    localStore.setEnabled(true)
    await addLocalTab(wrapper, localStore, 'local-ps', { title: 'PowerShell' })
    await setSplitMode(wrapper, 'vertical')
    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()
    const before = splitLayout().paneAssignments

    window.dispatchEvent(new CustomEvent('serverpilot:workspace-split-clear-panes'))
    await wrapper.vm.$nextTick()
    expect(useAppDialog().dialog.value).toMatchObject({
      title: '清空所有窗格',
      message: '这只会清空窗格布局，不会关闭 SSH 或本地终端。',
      confirmText: '清空窗格',
    })
    resolveAppDialog(false)
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(splitLayout().paneAssignments).toEqual(before)
    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('pane-maximized')

    window.dispatchEvent(new CustomEvent('serverpilot:workspace-split-clear-panes'))
    await wrapper.vm.$nextTick()
    resolveAppDialog(true)
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(paneSessionIds(wrapper)).toEqual([null, null, null, null])
    expect(paneLocalSessionIds(wrapper)).toEqual([null, null, null, null])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1'])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-ps'])
    expect(splitLayout().activePaneId).toBe('pane-1')
    expect(splitLayout().paneAssignments).toMatchObject({
      'pane-1': null,
      'pane-2': null,
    })
    expect(wrapper.get('.terminal-split-workspace').classes()).not.toContain('pane-maximized')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
  })

  it('maximizes and restores split panes without changing assignments, ratios, or terminal lifecycles', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-1', { title: 'PowerShell' }))
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'quad')
    await addLocalTab(wrapper, localStore, 'local-2', { title: 'CMD' })
    const before = paneLayoutRevisions(wrapper)

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('pane-maximized')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.get('[data-pane-id="pane-2"]').text()).toContain('server #2')
    expect(paneSessionIds(wrapper)).toEqual([null, 'term-2', null, null])
    expect(splitLayout()).toMatchObject({
      splitMode: 'quad',
      columnRatio: 0.5,
      rowRatio: 0.5,
    })
    expect(splitLayout()).not.toHaveProperty('maximizedPaneId')
    expect(store.activeSessionId).toBe('term-2')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('split-quad')
    expect(wrapper.get('.terminal-split-workspace').classes()).not.toContain('pane-maximized')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(4)
    expect(paneSessionIds(wrapper)).toEqual(['term-1', 'term-2', null, null])
    expect(paneLocalSessionIds(wrapper)).toEqual([null, null, 'local-1', 'local-2'])
    expect(paneLayoutRevisions(wrapper).every((revision, index) => revision > before[index])).toBe(true)
  })

  it('toggles pane maximize from the header double-click and restores with Escape outside terminal inputs', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-header').trigger('dblclick')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.get('[data-pane-id="pane-1"]').text()).toContain('server #1')

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    input.remove()

    document.body.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
  })

  it('maximizes a horizontal Local Terminal pane without restarting the local process', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    await setSplitMode(wrapper, 'horizontal')
    await addLocalTab(wrapper, localStore, 'local-top', { title: 'PowerShell' })
    await addLocalTab(wrapper, localStore, 'local-bottom', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    })

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('pane-maximized')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.get('[data-pane-id="pane-2"]').text()).toContain('CMD')
    expect(paneLocalSessionIds(wrapper)).toEqual([null, 'local-bottom', null, null])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-top', 'local-bottom'])
    expect(localStore.activeSessionId).toBe('local-bottom')
    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
  })

  it('uses the pane menu to maximize and lets Escape close the menu before restoring the pane', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="toggle-maximize"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(hasTeleportedPaneMenu()).toBe(false)
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(document.body.classList.contains('workspace-tab-dragging-active')).toBe(false)
  })

  it('exits maximized mode when the maximized pane is cleared or its tab closes', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(paneSessionIds(wrapper)).toEqual([null, 'term-2', null, null])
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.findComponent({ name: 'TerminalView' }).vm.$emit('close')
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(paneSessionIds(wrapper)).toEqual([null, null, null, null])
  })

  it('selects SSH and Local terminals from empty panes without duplicating or restarting sessions', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'quad')
    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-clear').trigger('click')
    await wrapper.get('[data-pane-id="pane-3"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()

    const emptyPane = wrapper.get('[data-pane-id="pane-3"]')
    expect(emptyPane.text()).toContain('将标签拖到这里')
    await emptyPane.get('.terminal-pane-select-trigger').trigger('click')
    expect(wrapper.get('.terminal-pane-selector').text()).toContain('SSH')
    expect(wrapper.get('.terminal-pane-selector').text()).toContain('server #2')
    expect(wrapper.get('.terminal-pane-selector').text()).toContain('CMD')

    await wrapper.get('.terminal-pane-selector [data-assignment-key="ssh:term-2"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(paneSessionIds(wrapper)).toEqual(['term-1', null, 'term-2', null])
    expect(store.activeSessionId).toBe('term-2')

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-select-trigger').trigger('click')
    await wrapper.get('.terminal-pane-selector [data-assignment-key="local:local-cmd"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(paneLocalSessionIds(wrapper)).toEqual([null, 'local-cmd', null, null])
    expect(localStore.activeSessionId).toBe('local-cmd')
    expect(store.activeSessionId).toBeNull()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
  })

  it('shows pane-targeted actions in empty panes and emits target pane requests', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await setSplitMode(wrapper, 'quad')
    await wrapper.vm.$nextTick()

    const emptyPane = wrapper.get('[data-pane-id="pane-2"]')
    expect(emptyPane.text()).toContain('新建服务器')
    expect(emptyPane.text()).toContain('连接已保存')
    expect(emptyPane.text()).toContain('选择已连接')
    expect(emptyPane.find('.terminal-pane-empty-message').text()).toBe('将标签拖到这里')
    expect(emptyPane.find('.terminal-pane-empty-actions').classes()).toContain('centered')
    expect(emptyPane.find('.terminal-pane-empty-actions').classes()).not.toContain('inline')
    expect(emptyPane.find('.terminal-pane-empty-body').exists()).toBe(true)
    expect(wrapper.findAll('.terminal-pane-empty-body')).toHaveLength(3)
    expect(emptyPane.find('.terminal-pane-local-cmd-trigger').exists()).toBe(false)
    expect(emptyPane.find('.terminal-pane-local-powershell-trigger').exists()).toBe(false)
    expect(emptyPane.findAll('.terminal-pane-empty-actions button').map((button) => button.text())).toEqual([
      '新建服务器',
      '连接已保存',
      '选择已连接',
    ])

    await emptyPane.get('.terminal-pane-add-server-trigger').trigger('click')
    await emptyPane.get('.terminal-pane-connect-saved-trigger').trigger('click')
    await emptyPane.get('.terminal-pane-select-trigger').trigger('click')

    expect(wrapper.emitted('paneAddServer')).toEqual([['pane-2']])
    expect(wrapper.emitted('paneConnectSaved')).toEqual([['pane-2']])
    expect(wrapper.emitted('paneOpenLocalTerminal')).toBeUndefined()
    expect(wrapper.find('.terminal-pane-selector').exists()).toBe(true)
  })

  it('uses a toast instead of an empty selector when no connected terminals are available for a split pane', async () => {
    const { wrapper } = mountWorkspace(state())
    await setSplitMode(wrapper, 'quad')
    await wrapper.vm.$nextTick()

    const emptyPane = wrapper.get('[data-pane-id="pane-2"]')
    const beforeAssignments = paneSessionIds(wrapper)
    await emptyPane.get('.terminal-pane-select-trigger').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('notify')).toEqual([['没有可用终端。', 'info']])
    expect(wrapper.find('.terminal-pane-selector').exists()).toBe(false)
    expect(wrapper.find('.terminal-pane-selector-empty').exists()).toBe(false)
    expect(paneSessionIds(wrapper)).toEqual(beforeAssignments)
  })

  it('shows single-pane empty actions without split-only local buttons', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state())
    store.clearActiveWorkspace()
    store.tabs = [
      { sessionId: 'term-available', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-available', {
      shellKind: 'powershell',
      shell: 'PowerShell',
      shellName: 'powershell.exe',
      title: 'PowerShell',
    }))
    await wrapper.vm.$nextTick()

    const empty = wrapper.get('.terminal-empty-actions')
    expect(wrapper.find('.terminal-empty h2').exists()).toBe(false)
    expect(empty.classes()).toContain('centered')
    expect(empty.classes()).not.toContain('inline')
    expect(empty.text()).toContain('新建服务器')
    expect(empty.text()).toContain('连接已保存')
    expect(empty.text()).toContain('选择已连接')
    expect(empty.text()).not.toContain('CMD')
    expect(empty.text()).not.toContain('PowerShell')

    await empty.get('.terminal-pane-add-server-trigger').trigger('click')
    await empty.get('.terminal-pane-connect-saved-trigger').trigger('click')
    await empty.get('.terminal-pane-select-trigger').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('paneAddServer')).toEqual([['pane-1']])
    expect(wrapper.emitted('paneConnectSaved')).toEqual([['pane-1']])
    expect(wrapper.find('.terminal-pane-selector').exists()).toBe(true)
    expect(wrapper.get('.terminal-pane-selector').text()).toContain('server #1')
    expect(wrapper.get('.terminal-pane-selector').text()).toContain('PowerShell')
  })

  it('uses a toast instead of an empty selector from the single-pane empty state', async () => {
    const { wrapper, store } = mountWorkspace(state())
    store.clearActiveWorkspace()
    await wrapper.vm.$nextTick()
    const beforeLayout = splitLayout()

    await wrapper.get('.terminal-empty .terminal-pane-select-trigger').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('notify')).toEqual([['没有可用终端。', 'info']])
    expect(wrapper.find('.terminal-pane-selector').exists()).toBe(false)
    expect(wrapper.find('.terminal-pane-selector-empty').exists()).toBe(false)
    expect(splitLayout().activePaneId).toBe(beforeLayout.activePaneId)
  })

  it('replaces and clears occupied panes from the header menu without writing terminal input', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-ps', { title: 'PowerShell' }))
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    const menuButton = wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger')
    await menuButton.trigger('click')
    expect(getTeleportedPaneMenu().text()).toContain('更换终端')
    expect(getTeleportedPaneMenu().text()).toContain('清空窗格')
    expect(getTeleportedPaneMenu().text()).toContain('最大化窗格')

    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="replace-terminal"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.get('.terminal-pane-selector [data-assignment-key="local:local-ps"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(paneSessionIds(wrapper)).toEqual([null, 'term-2', null, null])
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-ps', null, null, null])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2'])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-ps'])
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="clear-pane"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(paneLocalSessionIds(wrapper)).toEqual([null, null, null, null])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-ps'])
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
  })

  it('offers pane-targeted server and local actions from the occupied pane menu', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    const openMenu = async () => {
      await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
      await wrapper.vm.$nextTick()
    }

    await openMenu()
    const menuText = getTeleportedPaneMenu().text()
    expect(menuText).toContain('新建服务器到此窗格')
    expect(menuText).toContain('连接已保存到此窗格')
    expect(menuText).toContain('选择已连接到此窗格')
    expect(menuText).toContain('新建 CMD 到此窗格')
    expect(menuText).toContain('新建 PowerShell 到此窗格')
    expect(menuText).toContain('更换终端')
    expect(menuText).toContain('清空窗格')

    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="add-server-pane"]').trigger('click')
    await openMenu()
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="connect-saved-pane"]').trigger('click')
    await openMenu()
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="new-cmd-pane"]').trigger('click')
    await openMenu()
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="new-powershell-pane"]').trigger('click')
    await openMenu()
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="select-connected-pane"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('paneAddServer')).toEqual([['pane-1']])
    expect(wrapper.emitted('paneConnectSaved')).toEqual([['pane-1']])
    expect(wrapper.emitted('paneOpenLocalTerminal')).toEqual([
      ['pane-1', 'cmd'],
      ['pane-1', 'powershell'],
    ])
    expect(wrapper.find('.terminal-pane-selector').exists()).toBe(true)
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
  })

  it('swaps occupied SSH panes from the pane menu without reconnecting or duplicating sessions', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    expect(getTeleportedPaneMenu().text()).toContain('与其它窗格交换')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="swap-pane"]').trigger('click')
    await wrapper.vm.$nextTick()
    const targets = findAllTeleportedPaneMenu('.terminal-pane-menu [data-swap-target]')
    expect(targets.map((button) => button.text())).toEqual(['右：server #2'])

    await targets[0].trigger('click')
    await wrapper.vm.$nextTick()

    expect(paneSessionIds(wrapper)).toEqual(['term-2', 'term-1', null, null])
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-1"]')).toHaveLength(1)
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-2"]')).toHaveLength(1)
    expect(wrapper.get('[data-pane-id="pane-1"]').classes()).toContain('active')
    expect(store.activeSessionId).toBe('term-2')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
  })

  it('shows SSH output activity on inactive pane headers and clears it when the pane is activated', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(wrapper, 'vertical')
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    await wrapper.get('[data-pane-id="pane-1"]').trigger('click')
    store.outputActivityBySession['term-2'] = {
      hasActivity: true,
      unreadCount: 3,
      lastActivityAt: 100,
    }
    await wrapper.vm.$nextTick()

    const pane2 = wrapper.get('[data-pane-id="pane-2"]')
    expect(pane2.get('[data-terminal-activity-badge]').text()).toBe('3')
    expect(pane2.get('[data-terminal-activity-badge]').attributes('title')).toContain('新输出')

    await pane2.trigger('click')
    await wrapper.vm.$nextTick()

    expect(store.activeSessionId).toBe('term-2')
    expect(store.outputActivityBySession['term-2']).toBeUndefined()
    expect(wrapper.find('[data-pane-id="pane-2"] [data-terminal-activity-badge]').exists()).toBe(false)
  })

  it('shows Local Terminal output activity on inactive pane headers and clears it when activated', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    await setSplitMode(wrapper, 'vertical')
    await addLocalTab(wrapper, localStore, 'local-1', { title: 'CMD' })
    await addLocalTab(wrapper, localStore, 'local-2', { title: 'PowerShell' })
    await wrapper.get('[data-pane-id="pane-1"]').trigger('click')
    localStore.outputActivityBySession['local-2'] = {
      hasActivity: true,
      unreadCount: 5,
      lastActivityAt: 200,
    }
    await wrapper.vm.$nextTick()

    const pane2 = wrapper.get('[data-pane-id="pane-2"]')
    expect(pane2.get('[data-terminal-activity-badge]').text()).toBe('5')

    await pane2.trigger('click')
    await wrapper.vm.$nextTick()

    expect(localStore.activeSessionId).toBe('local-2')
    expect(localStore.outputActivityBySession['local-2']).toBeUndefined()
    expect(wrapper.find('[data-pane-id="pane-2"] [data-terminal-activity-badge]').exists()).toBe(false)
  })

  it('marks rendered split-pane SSH and Local sessions as visible for output activity filtering', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    await addLocalTab(wrapper, localStore, 'local-1', { title: 'PowerShell' })
    await setSplitMode(wrapper, 'quad')
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(store.isOutputSessionVisible('term-1')).toBe(true)
    expect(store.isOutputSessionVisible('term-2')).toBe(true)
    expect(localStore.isOutputSessionVisible('local-1')).toBe(true)

    const term1Pane = wrapper
      .get('.terminal-pane-assigned[data-session-id="term-1"]')
      .element
      .closest<HTMLElement>('[data-pane-id]')
    expect(term1Pane?.dataset.paneId).toBeTruthy()

    await wrapper.get(`[data-pane-id="${term1Pane!.dataset.paneId}"] .terminal-pane-maximize`).trigger('click')
    await wrapper.vm.$nextTick()

    expect(store.isOutputSessionVisible('term-1')).toBe(true)
    expect(store.isOutputSessionVisible('term-2')).toBe(false)
    expect(localStore.isOutputSessionVisible('local-1')).toBe(false)
  })

  it('keeps hidden maximized pane activity runtime-only and clears it once visible again', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(wrapper, 'vertical')
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    await wrapper.get('[data-pane-id="pane-1"]').trigger('click')
    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-maximize').trigger('click')
    store.outputActivityBySession['term-2'] = {
      hasActivity: true,
      unreadCount: 9,
      lastActivityAt: 300,
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.find('[data-pane-id="pane-2"] [data-terminal-activity-badge]').exists()).toBe(false)
    expect(localStorage.getItem('serverpilot.terminalActivity')).toBeNull()

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(store.outputActivityBySession['term-2']).toBeUndefined()
    expect(wrapper.find('[data-pane-id="pane-2"] [data-terminal-activity-badge]').exists()).toBe(false)
  })

  it('keeps session activity with the session across swap and preserves tab activity when a pane is cleared', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(wrapper, 'vertical')
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    await wrapper.get('[data-pane-id="pane-1"]').trigger('click')
    store.outputActivityBySession['term-2'] = {
      hasActivity: true,
      unreadCount: 6,
      lastActivityAt: 400,
    }
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="swap-pane"]').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-swap-target="pane-2"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(store.activeSessionId).toBe('term-2')
    expect(store.outputActivityBySession['term-2']).toBeUndefined()

    store.outputActivityBySession['term-1'] = {
      hasActivity: true,
      unreadCount: 8,
      lastActivityAt: 500,
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-pane-id="pane-2"] [data-terminal-activity-badge]').text()).toBe('8')

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()

    expect(paneSessionIds(wrapper)).toEqual(['term-2', null, null, null])
    expect(store.outputActivityBySession['term-1']?.unreadCount).toBe(8)
  })

  it('swaps SSH and Local panes without rebuilding either session', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    localStore.setEnabled(true)
    await addLocalTab(wrapper, localStore, 'local-ps', { title: 'PowerShell' })
    await setSplitMode(wrapper, 'vertical')

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="swap-pane"]').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-swap-target="pane-2"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(paneSessionIds(wrapper)).toEqual([null, 'term-1', null, null])
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-ps', null, null, null])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1'])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-ps'])
    expect(localStore.activeSessionId).toBe('local-ps')
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
  })

  it('keeps the maximized pane position while swapping assignments', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="swap-pane"]').trigger('click')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-swap-target="pane-2"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('pane-maximized')
    expect(wrapper.get('[data-pane-id="pane-1"]').text()).toContain('server #2')
    expect(paneSessionIds(wrapper)).toEqual(['term-2', null, null, null])
    expect(store.activeSessionId).toBe('term-2')
  })

  it('moves an occupied pane to an empty pane and activates the target without closing sessions', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'quad')
    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-maximize').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    expect(getTeleportedPaneMenu().text()).toContain('移动到空窗格')
    await getTeleportedPaneMenu('.terminal-pane-menu [data-action="move-pane"]').trigger('click')
    await wrapper.vm.$nextTick()
    const targets = findAllTeleportedPaneMenu('.terminal-pane-menu [data-move-target]')
    expect(targets.map((button) => button.text())).toEqual(['左下', '右下'])

    await getTeleportedPaneMenu('.terminal-pane-menu [data-move-target="pane-3"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.terminal-pane')).toHaveLength(4)
    expect(wrapper.get('.terminal-split-workspace').classes()).not.toContain('pane-maximized')
    expect(paneSessionIds(wrapper)).toEqual([null, 'term-2', 'term-1', null])
    expect(wrapper.get('[data-pane-id="pane-3"]').classes()).toContain('active')
    expect(store.activeSessionId).toBe('term-1')
    expect(splitLayout().activePaneId).toBe('pane-3')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
  })

  it('disables moving when there is no empty pane', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(wrapper, 'quad')
    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    await addSshTab(wrapper, store, 'term-3', 'server #3')
    await addSshTab(wrapper, store, 'term-4', 'server #4')

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-menu-trigger').trigger('click')
    const move = getTeleportedPaneMenu('.terminal-pane-menu [data-action="move-pane"]')
    expect(move.attributes('disabled')).toBeDefined()
  })

  it('applies pane-targeted SSH and Local session assignments without closing replaced sessions', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
      { sessionId: 'term-3', connectionId: 7, title: 'server #3', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-new', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    expect(paneSessionIds(wrapper)).toEqual(['term-1', 'term-2', null, null])

    await wrapper.setProps({
      paneTargetAssignment: { paneId: 'pane-1', kind: 'ssh', sessionId: 'term-3', requestId: 1 },
    })
    await wrapper.vm.$nextTick()
    expect(paneSessionIds(wrapper)).toEqual(['term-3', 'term-2', null, null])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2', 'term-3'])
    expect(store.activeSessionId).toBe('term-3')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()

    await wrapper.setProps({
      paneTargetAssignment: { paneId: 'pane-2', kind: 'local', sessionId: 'local-new', requestId: 2 },
    })
    await wrapper.vm.$nextTick()
    expect(paneSessionIds(wrapper)).toEqual(['term-3', null, null, null])
    expect(paneLocalSessionIds(wrapper)).toEqual([null, 'local-new', null, null])
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2', 'term-3'])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-new'])
    expect(localStore.activeSessionId).toBe('local-new')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
  })

  it('auto-fills newly opened SSH tabs into empty quad panes in visual order without replacing the fifth tab', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(wrapper, 'quad')

    await addSshTab(wrapper, store, 'term-1', 'server #1')
    expect(paneSessionIds(wrapper)).toEqual(['term-1', null, null, null])
    expect(wrapper.get('[data-pane-id="pane-1"]').classes()).toContain('active')
    expect(store.activeSessionId).toBe('term-1')

    await addSshTab(wrapper, store, 'term-2', 'server #2')
    expect(paneSessionIds(wrapper)).toEqual(['term-1', 'term-2', null, null])
    expect(wrapper.get('[data-pane-id="pane-2"]').classes()).toContain('active')

    await addSshTab(wrapper, store, 'term-3', 'server #3')
    expect(paneSessionIds(wrapper)).toEqual(['term-1', 'term-2', 'term-3', null])
    expect(wrapper.get('[data-pane-id="pane-3"]').classes()).toContain('active')

    await addSshTab(wrapper, store, 'term-4', 'server #4')
    expect(paneSessionIds(wrapper)).toEqual(['term-1', 'term-2', 'term-3', 'term-4'])
    expect(wrapper.get('[data-pane-id="pane-4"]').classes()).toContain('active')
    expect(splitLayout().paneAssignments).toMatchObject({
      'pane-1': { kind: 'ssh', sessionId: 'term-1' },
      'pane-2': { kind: 'ssh', sessionId: 'term-2' },
      'pane-3': { kind: 'ssh', sessionId: 'term-3' },
      'pane-4': { kind: 'ssh', sessionId: 'term-4' },
    })

    await addSshTab(wrapper, store, 'term-5', 'server #5')

    expect(paneSessionIds(wrapper)).toEqual(['term-1', 'term-2', 'term-3', 'term-4'])
    expect(store.activeSessionId).toBe('term-5')
    expect(wrapper.get('[data-pane-id="pane-4"]').classes()).toContain('active')
    expect(window.go?.main?.App?.ReconnectTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.DisconnectServer).not.toHaveBeenCalled()
  })

  it('auto-fills vertical and horizontal split panes in their visual order and leaves full panes unchanged', async () => {
    const vertical = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(vertical.wrapper, 'vertical')
    await addSshTab(vertical.wrapper, vertical.store, 'left', 'left')
    await addSshTab(vertical.wrapper, vertical.store, 'right', 'right')
    expect(paneSessionIds(vertical.wrapper)).toEqual(['left', 'right', null, null])
    await addSshTab(vertical.wrapper, vertical.store, 'extra', 'extra')
    expect(paneSessionIds(vertical.wrapper)).toEqual(['left', 'right', null, null])

    const horizontal = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(horizontal.wrapper, 'horizontal')
    await addSshTab(horizontal.wrapper, horizontal.store, 'top', 'top')
    await addSshTab(horizontal.wrapper, horizontal.store, 'bottom', 'bottom')
    expect(paneSessionIds(horizontal.wrapper)).toEqual(['top', 'bottom', null, null])
    await addSshTab(horizontal.wrapper, horizontal.store, 'extra', 'extra')
    expect(paneSessionIds(horizontal.wrapper)).toEqual(['top', 'bottom', null, null])
  })

  it('does not assign panes in single mode and does not fill an empty pane when switching to an existing tab', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))

    await addSshTab(wrapper, store, 'term-1', 'server #1')
    expect(wrapper.find('.terminal-split-workspace').exists()).toBe(false)
    expect(splitLayout().paneAssignments?.['pane-1']).toBeNull()

    await addSshTab(wrapper, store, 'term-2', 'server #2')
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()
    expect(paneSessionIds(wrapper)).toEqual(['term-1', null, null, null])

    store.activate('term-2')
    await wrapper.vm.$nextTick()

    expect(paneSessionIds(wrapper)).toEqual(['term-1', null, null, null])
    expect(store.activeSessionId).toBe('term-2')
  })

  it('uses the auto-filled pane as the command palette target', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await setSplitMode(wrapper, 'vertical')

    await addSshTab(wrapper, store, 'term-1', 'server #1')
    await addSshTab(wrapper, store, 'term-2', 'server #2')
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('insert', 'hostname')
    await Promise.resolve()
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'uptime')
    await Promise.resolve()

    expect(wrapper.get('[data-pane-id="pane-2"]').classes()).toContain('active')
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenNthCalledWith(1, {
      sessionId: 'term-2',
      dataBase64: btoa('hostname'),
    })
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenNthCalledWith(2, {
      sessionId: 'term-2',
      dataBase64: btoa('uptime\r'),
    })
  })

  it('accepts a top SSH tab drop into a pane without reconnecting or duplicating the session', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'vertical')
    const pane2 = wrapper.get('[data-pane-id="pane-2"]').element
    vi.spyOn(pane2, 'getBoundingClientRect').mockReturnValue({
      x: 400, y: 40, width: 360, height: 300, top: 40, right: 760,
      bottom: 340, left: 400, toJSON: () => undefined,
    })

    const drop = new CustomEvent('serverpilot:workspace-tab-external-drop', {
      cancelable: true,
      detail: { kind: 'terminal', key: 'terminal-term-2', sessionId: 'term-2', clientX: 520, clientY: 120 },
    })
    window.dispatchEvent(drop)
    await wrapper.vm.$nextTick()

    expect(drop.defaultPrevented).toBe(true)
    expect(wrapper.find('[data-pane-id="pane-2"]').text()).toContain('server #2')
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-2"]')).toHaveLength(1)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2'])
    expect(store.activeSessionId).toBe('term-2')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('accepts a top Local Terminal tab drop into a pane without restarting the local process', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    const pane2 = wrapper.get('[data-pane-id="pane-2"]').element
    vi.spyOn(pane2, 'getBoundingClientRect').mockReturnValue({
      x: 400, y: 40, width: 360, height: 300, top: 40, right: 760,
      bottom: 340, left: 400, toJSON: () => undefined,
    })

    const drop = new CustomEvent('serverpilot:workspace-tab-external-drop', {
      cancelable: true,
      detail: { kind: 'local', key: 'local-local-cmd', localSessionId: 'local-cmd', clientX: 520, clientY: 120 },
    })
    window.dispatchEvent(drop)
    await wrapper.vm.$nextTick()

    expect(drop.defaultPrevented).toBe(true)
    expect(wrapper.find('[data-pane-id="pane-2"]').text()).toContain('CMD')
    expect(wrapper.findAll('.terminal-pane-assigned[data-local-session-id="local-cmd"]')).toHaveLength(1)
    expect(localStore.activeSessionId).toBe('local-cmd')
    expect(store.activeSessionId).toBeNull()
    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.OpenTerminal).not.toHaveBeenCalled()
  })

  it('drags a Local Terminal pane assignment to another pane without duplicating or closing it', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    await setSplitMode(wrapper, 'vertical')
    await addLocalTab(wrapper, localStore, 'local-ps', { title: 'PowerShell' })
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-ps', null, null, null])
    const pane1 = wrapper.get('[data-pane-id="pane-1"]').element
    const pane2 = wrapper.get('[data-pane-id="pane-2"]').element
    vi.spyOn(pane1, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 40, width: 360, height: 300, top: 40, right: 360,
      bottom: 340, left: 0, toJSON: () => undefined,
    })
    vi.spyOn(pane2, 'getBoundingClientRect').mockReturnValue({
      x: 400, y: 40, width: 360, height: 300, top: 40, right: 760,
      bottom: 340, left: 400, toJSON: () => undefined,
    })

    wrapper.get('[data-pane-id="pane-1"] .terminal-pane-header').element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 60 }),
    )
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 520, clientY: 90 }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 520, clientY: 90 }))
    await wrapper.vm.$nextTick()

    expect(paneLocalSessionIds(wrapper)).toEqual([null, 'local-ps', null, null])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-ps'])
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()
  })

  it('clears a Local Terminal pane without closing it and removes stale assignments when the tab closes', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    await setSplitMode(wrapper, 'vertical')
    await addLocalTab(wrapper, localStore, 'local-clear', { title: 'CMD' })
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-clear', null, null, null])

    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()

    expect(paneLocalSessionIds(wrapper)).toEqual([null, null, null, null])
    expect(localStore.sessions.map((session) => session.sessionId)).toEqual(['local-clear'])
    expect(window.go?.main?.App?.CloseLocalTerminal).not.toHaveBeenCalled()

    const pane1 = wrapper.get('[data-pane-id="pane-1"]').element
    vi.spyOn(pane1, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 40, width: 360, height: 300, top: 40, right: 360,
      bottom: 340, left: 0, toJSON: () => undefined,
    })
    window.dispatchEvent(new CustomEvent('serverpilot:workspace-tab-external-drop', {
      cancelable: true,
      detail: { kind: 'local', key: 'local-local-clear', localSessionId: 'local-clear', clientX: 100, clientY: 120 },
    }))
    await wrapper.vm.$nextTick()
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-clear', null, null, null])

    await localStore.close('local-clear')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseLocalTerminal).toHaveBeenCalledWith('local-clear')
    expect(paneLocalSessionIds(wrapper)).toEqual([null, null, null, null])
  })

  it('auto-fills newly opened Local Terminal tabs into empty panes in the same visual order as SSH', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    await setSplitMode(wrapper, 'quad')

    await addLocalTab(wrapper, localStore, 'local-1', { title: 'CMD 1' })
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-1', null, null, null])
    expect(wrapper.get('[data-pane-id="pane-1"]').classes()).toContain('active')

    await addLocalTab(wrapper, localStore, 'local-2', { title: 'PowerShell 2' })
    await addLocalTab(wrapper, localStore, 'local-3', { title: 'CMD 3' })
    await addLocalTab(wrapper, localStore, 'local-4', { title: 'PowerShell 4' })
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-1', 'local-2', 'local-3', 'local-4'])
    expect(wrapper.get('[data-pane-id="pane-4"]').classes()).toContain('active')

    await addLocalTab(wrapper, localStore, 'local-5', { title: 'CMD 5' })
    expect(paneLocalSessionIds(wrapper)).toEqual(['local-1', 'local-2', 'local-3', 'local-4'])
    expect(localStore.activeSessionId).toBe('local-5')
    expect(window.go?.main?.App?.OpenLocalTerminal).not.toHaveBeenCalled()
  })

  it('keeps SSH command insertion disabled while a Local Terminal pane is active', async () => {
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    await addLocalTab(wrapper, localStore, 'local-active', { title: 'CMD' })

    await wrapper.get('[data-pane-id="pane-2"]').trigger('click')
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'whoami')
    await Promise.resolve()

    expect(localStore.activeSessionId).toBe('local-active')
    expect(store.activeSessionId).toBeNull()
    expect(window.go?.main?.App?.WriteTerminal).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'SftpPanel' }).exists()).toBe(false)
    expect(wrapper.find('.local-explorer-panel').exists()).toBe(true)
  })

  it('keeps a local monitor visible and replaces SFTP with Local Explorer for active local terminals', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent({ name: 'CompactMonitorSidebar' }).exists()).toBe(false)
    expect(wrapper.find('.local-monitor-sidebar').exists()).toBe(true)
    expect(wrapper.find('.local-explorer-panel').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SftpPanel' }).exists()).toBe(false)
  })

  it('renders no bottom-panel chevron for active local terminals', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent({ name: 'SftpPanel' }).exists()).toBe(false)
    expect(wrapper.find('.local-explorer-panel').exists()).toBe(true)
    expect(wrapper.find('.horizontal-splitter .sftp-toggle-handle').exists()).toBe(false)
    expect(wrapper.find('.local-explorer-toolbar .sftp-toggle-handle').exists()).toBe(false)
    expect(wrapper.find('.horizontal-splitter .bottom-panel-toggle-handle').exists()).toBe(false)
    expect(wrapper.find('.horizontal-splitter svg.splitter-chevron').exists()).toBe(false)
  })

  it('shares the bottom panel expanded state between local Explorer and remote SFTP', async () => {
    localStorage.setItem('serverpilot.sftpExpanded', 'true')
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      sessionId: 'local-cmd',
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()
    const root = wrapper.get('.workspace-shell').element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1200, height: 700, top: 0, right: 1200,
      bottom: 700, left: 0, toJSON: () => undefined,
    })

    expect(wrapper.find('.local-explorer-panel').classes()).toContain('expanded')
    await dragSplitter(wrapper, '.horizontal-splitter', { x: 500, y: 420 }, { x: 500, y: 620 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.local-explorer-panel').classes()).not.toContain('expanded')

    localStore.activeSessionId = null
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sftp-panel').classes()).not.toContain('expanded')

    await dragSplitter(wrapper, '.horizontal-splitter', { x: 500, y: 620 }, { x: 500, y: 420 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sftp-panel').classes()).toContain('expanded')

    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.local-explorer-panel').classes()).toContain('expanded')
  })

  it('shows a local command history floating button and opens the local command palette scope', async () => {
    const { wrapper, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      sessionId: 'local-cmd',
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()

    const commandButton = wrapper.get('.terminal-stage .terminal-command-button')
    expect(commandButton.attributes('disabled')).toBeUndefined()
    await commandButton.trigger('click')
    await wrapper.vm.$nextTick()

    const palette = wrapper.getComponent({ name: 'CommandPalette' })
    expect(palette.props('open')).toBe(true)
    expect(palette.props('connection')?.id).toBeLessThan(0)
    expect(palette.props('connection')?.name).toContain('CMD')
    expect(palette.props('hasActiveTerminal')).toBe(true)
  })

  it('keeps local CMD and PowerShell command history scopes separate from remote SSH history', async () => {
    terminalRegistryMock.observeTerminalInstanceInput.mockReturnValue(false)
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      sessionId: 'local-cmd',
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    localStore.sessions.push(localState('local-ps', {
      sessionId: 'local-ps',
      shellKind: 'powershell',
      shell: 'PowerShell',
      shellName: 'powershell.exe',
      title: 'PowerShell',
    }))
    await wrapper.vm.$nextTick()

    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'dir')
    await Promise.resolve()
    expect(window.go?.main?.App?.WriteLocalTerminal).toHaveBeenLastCalledWith({
      sessionId: 'local-cmd',
      dataBase64: btoa('dir\r'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalledWith(expect.objectContaining({
      serverId: 7,
      command: 'dir',
    }))

    localStore.activate('local-ps')
    await wrapper.vm.$nextTick()
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'Get-Date')
    await Promise.resolve()
    expect(window.go?.main?.App?.WriteLocalTerminal).toHaveBeenLastCalledWith({
      sessionId: 'local-ps',
      dataBase64: btoa('Get-Date\r'),
    })

    localStore.activeSessionId = null
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'uptime')
    await Promise.resolve()
    await Promise.resolve()
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'term-1',
      dataBase64: btoa('uptime\r'),
    })
    expect(window.go?.main?.App?.RecordCommandHistory).toHaveBeenCalledWith({
      serverId: 7,
      sessionId: 'term-1',
      command: 'uptime',
      source: 'terminal',
    })
  })

  it('records typed CMD and PowerShell terminal submissions into separate local command history scopes', async () => {
    const { wrapper, commandStore, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-cmd', {
      sessionId: 'local-cmd',
      shellKind: 'cmd',
      shell: 'CMD',
      shellName: 'cmd.exe',
      title: 'CMD',
    }))
    localStore.sessions.push(localState('local-ps', {
      sessionId: 'local-ps',
      shellKind: 'powershell',
      shell: 'PowerShell',
      shellName: 'powershell.exe',
      title: 'PowerShell',
    }))

    localStore.activate('local-cmd')
    await wrapper.vm.$nextTick()
    wrapper.getComponent({ name: 'LocalTerminalView' }).vm.$emit('command', 'local-cmd', 'dir')
    await Promise.resolve()

    localStore.activate('local-ps')
    await wrapper.vm.$nextTick()
    wrapper.getComponent({ name: 'LocalTerminalView' }).vm.$emit('command', 'local-ps', 'Get-ChildItem')
    await Promise.resolve()
    wrapper.getComponent({ name: 'LocalTerminalView' }).vm.$emit('command', 'local-ps', 'set TOKEN=secret-value')
    await Promise.resolve()

    expect(commandStore.historyByServer[-1001].map((item) => item.command)).toEqual(['dir'])
    expect(commandStore.historyByServer[-1002].map((item) => item.command)).toEqual(['Get-ChildItem'])
    expect(commandStore.historyByServer[-1002].map((item) => item.command)).not.toContain('set TOKEN=secret-value')
    expect(localStorage.getItem('serverpilot.commandHistory.local.cmd')).toContain('dir')
    expect(localStorage.getItem('serverpilot.commandHistory.local.powershell')).toContain('Get-ChildItem')
    expect(localStorage.getItem('serverpilot.commandHistory.local.powershell') ?? '').not.toContain('TOKEN')
    expect(window.go?.main?.App?.RecordCommandHistory).not.toHaveBeenCalledWith(expect.objectContaining({
      command: 'dir',
    }))
  })

  it('restores old SSH-only layout and typed Local assignments while discarding stale sessions', async () => {
    localStorage.setItem('serverpilot.workspaceSplitLayout.v1', JSON.stringify({
      splitMode: 'quad',
      activePaneId: 'pane-2',
      paneAssignments: {
        'pane-1': 'term-1',
        'pane-2': { kind: 'local', sessionId: 'local-1' },
        'pane-3': { kind: 'local', sessionId: 'missing-local' },
        'pane-4': { kind: 'ssh', sessionId: 'missing-ssh' },
      },
    }))
    const { wrapper, store, localStore } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    localStore.setEnabled(true)
    localStore.sessions.push(localState('local-1', { title: 'PowerShell' }))
    store.workspaces[7].status = 'connected'
    await wrapper.vm.$nextTick()

    expect(paneSessionIds(wrapper)).toEqual(['term-1', null, null, null])
    expect(paneLocalSessionIds(wrapper)).toEqual([null, 'local-1', null, null])
    expect(wrapper.findAll('.terminal-pane-assigned[data-local-session-id="missing-local"]')).toHaveLength(0)
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="missing-ssh"]')).toHaveLength(0)
  })

  it('uses the active pane as the command palette write target', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'vertical')
    const pane2 = wrapper.get('[data-pane-id="pane-2"]').element
    vi.spyOn(pane2, 'getBoundingClientRect').mockReturnValue({
      x: 400, y: 40, width: 360, height: 300, top: 40, right: 760,
      bottom: 340, left: 400, toJSON: () => undefined,
    })
    window.dispatchEvent(new CustomEvent('serverpilot:workspace-tab-external-drop', {
      cancelable: true,
      detail: { kind: 'terminal', key: 'terminal-term-2', sessionId: 'term-2', clientX: 520, clientY: 120 },
    }))
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-pane-id="pane-1"]').trigger('click')
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('insert', 'hostname')
    await Promise.resolve()
    await wrapper.get('[data-pane-id="pane-2"]').trigger('click')
    wrapper.findComponent({ name: 'CommandPalette' }).vm.$emit('execute', 'uptime')
    await Promise.resolve()

    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenNthCalledWith(1, {
      sessionId: 'term-1',
      dataBase64: btoa('hostname'),
    })
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenNthCalledWith(2, {
      sessionId: 'term-2',
      dataBase64: btoa('uptime\r'),
    })
  })

  it('top tab activation follows assigned panes without filling existing unassigned tabs', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
      { sessionId: 'term-3', connectionId: 7, title: 'server #3', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')

    store.activate('term-2')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-pane-id="pane-2"]').classes()).toContain('active')

    await wrapper.get('[data-pane-id="pane-2"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-pane-id="pane-2"]').text()).toContain('将标签拖到这里')

    await wrapper.get('[data-pane-id="pane-1"]').trigger('click')
    store.activate('term-3')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-pane-id="pane-1"]').text()).toContain('server #1')
    expect(wrapper.get('[data-pane-id="pane-2"]').text()).toContain('将标签拖到这里')
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-3"]')).toHaveLength(0)
  })

  it('drags a pane assignment to another pane without closing the terminal session', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    const pane1 = wrapper.get('[data-pane-id="pane-1"]').element
    const pane2 = wrapper.get('[data-pane-id="pane-2"]').element
    vi.spyOn(pane1, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 40, width: 360, height: 300, top: 40, right: 360,
      bottom: 340, left: 0, toJSON: () => undefined,
    })
    vi.spyOn(pane2, 'getBoundingClientRect').mockReturnValue({
      x: 400, y: 40, width: 360, height: 300, top: 40, right: 760,
      bottom: 340, left: 400, toJSON: () => undefined,
    })

    wrapper.get('[data-pane-id="pane-1"] .terminal-pane-header').element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 60 }),
    )
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 520, clientY: 90 }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 520, clientY: 90 }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-pane-id="pane-2"]').text()).toContain('server #1')
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-1"]')).toHaveLength(1)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2'])
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('layout changes bump visible terminal layout revisions for fit/resize', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    const initialRevision = Number(wrapper.getComponent({ name: 'TerminalView' }).attributes('layout-revision'))

    await setSplitMode(wrapper, 'vertical')

    const revisions = wrapper.findAllComponents({ name: 'TerminalView' })
      .map((view) => Number(view.attributes('layout-revision')))
    expect(revisions.every((revision) => revision > initialRevision)).toBe(true)
  })

  it('switching back to single pane keeps sessions and activates the previous active pane tab', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()
    await setSplitMode(wrapper, 'vertical')
    await wrapper.get('[data-pane-id="pane-2"]').trigger('click')
    expect(store.activeSessionId).toBe('term-2')

    await setSplitMode(wrapper, 'single')

    expect(wrapper.find('.terminal-split-workspace').exists()).toBe(false)
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2'])
    expect(store.activeSessionId).toBe('term-2')
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
  })

  it('restores split layout from localStorage and discards stale sessions', async () => {
    localStorage.setItem('serverpilot.workspaceSplitLayout.v1', JSON.stringify({
      splitMode: 'vertical',
      activePaneId: 'pane-2',
      paneAssignments: {
        'pane-1': 'stale-session',
        'pane-2': 'term-2',
      },
    }))
    const pinia = createPinia()
    const store = useTerminalStore(pinia)
    store.navigateToServer(connection)
    store.syncConnectionState(connection, state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.activate('term-2')
    const wrapper = mount(TerminalWorkspace, {
      props: {
        connection,
        state: state({ status: 'online', terminalActive: true, hasActiveSession: true }),
        snapshot: null,
        history: [],
        layoutRevision: 0,
        connections: [connection],
        terminalProfiles: [defaultProfile],
        defaultTerminalProfile: defaultProfile,
      },
      global: {
        plugins: [pinia],
        stubs: {
          TerminalView: terminalViewStub,
          LocalTerminalView: localTerminalViewStub,
          CompactMonitorSidebar: true,
          ContextMenu: true,
        },
      },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('split-vertical')
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="stale-session"]')).toHaveLength(0)
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-2"]')).toHaveLength(1)
  })

  it('clears a pane without closing its terminal session and clears assignments when the tab closes', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await setSplitMode(wrapper, 'quad')
    await wrapper.get('[data-pane-id="pane-1"] .terminal-pane-clear').trigger('click')
    await wrapper.vm.$nextTick()

    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2'])
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(wrapper.get('[data-pane-id="pane-1"]').text()).toContain('将标签拖到这里')

    store.closeSession('term-2')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith('term-2')
    expect(wrapper.findAll('.terminal-pane-assigned[data-session-id="term-2"]')).toHaveLength(0)
  })

  it('shows the latest SFTP transfer in the right-side status bar and opens the queue popover', async () => {
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))
    const sftpStore = useSftpStore()
    sftpStore.transfersById.first = {
      id: 'first',
      connectionId: 7,
      direction: 'upload',
      localPath: 'C:/tmp/old.txt',
      remotePath: '/home/demo/old.txt',
      fileName: 'old.txt',
      totalBytes: 100,
      transferredBytes: 100,
      percent: 100,
      speedBytesPerSecond: 0,
      status: 'completed',
      errorMessage: '',
      startedAt: '2026-06-16T00:00:00Z',
      finishedAt: '2026-06-16T00:00:01Z',
    }
    sftpStore.transfersById.second = {
      id: 'second',
      connectionId: 7,
      mode: 'scp',
      direction: 'download',
      recursive: true,
      sourceType: 'directory',
      localPath: 'C:/tmp/new.txt',
      remotePath: '/home/demo/new.txt',
      fileName: 'new.txt',
      currentFile: 'nested/new.txt',
      totalBytes: 200,
      transferredBytes: 100,
      filesTotal: 3,
      filesDone: 1,
      failedCount: 0,
      skippedCount: 1,
      percent: 50,
      speedBytesPerSecond: 2048,
      status: 'running',
      errorMessage: '',
      cancelable: true,
      startedAt: '2026-06-16T00:00:02Z',
      finishedAt: '',
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.status-transfer').text()).toContain('SCP 下载目录：nested/new.txt')
    expect(wrapper.get('.status-transfer').text()).toContain('1/3 项')
    await wrapper.get('.status-transfer').trigger('click')
    await wrapper.vm.$nextTick()
    const popover = document.body.querySelector('.transfer-popover') as HTMLElement
    expect(popover.textContent).toContain('old.txt')
    expect(popover.textContent).toContain('nested/new.txt')
    expect(popover.textContent).toContain('失败 0')
    expect(popover.textContent).toContain('跳过 1')
    const tabButtons = Array.from(popover.querySelectorAll<HTMLButtonElement>('.transfer-popover-tabs button'))
    const tabSeparator = popover.querySelector<HTMLElement>('.transfer-popover-tabs .transfer-popover-action-separator')
    expect(tabButtons).toHaveLength(2)
    expect(tabSeparator?.textContent).toBe('|')
    expect(tabSeparator?.previousElementSibling).toBe(tabButtons[0])
    expect(tabSeparator?.nextElementSibling).toBe(tabButtons[1])
    const activeRow = document.body.querySelectorAll('.transfer-popover-row')[0] as HTMLElement
    expect(activeRow.textContent).toContain('暂停')
    const activeRowButtons = Array.from(activeRow.querySelectorAll('.text-button')) as HTMLButtonElement[]
    activeRowButtons.find((button) => button.textContent === '暂停')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(window.go?.main?.App?.SftpPauseTransfer).toHaveBeenCalledWith({
      serverID: 7,
      contextID: 'server:7',
      transferID: 'second',
    })
    activeRowButtons.find((button) => button.textContent === '取消')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(window.go?.main?.App?.SftpCancelTransfer).toHaveBeenCalledWith({ transferId: 'second' })
    const footerButtons = Array.from(document.body.querySelectorAll('.transfer-popover footer .text-button')) as HTMLButtonElement[]
    footerButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(sftpStore.transfersById.first).toBeUndefined()
    expect(sftpStore.transfersById.second).toBeDefined()
    footerButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
  })

  it('renders the transfer queue popover outside the status bar and clamps it to the viewport', async () => {
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))

    const popover = await openTransferPopoverWithTransfer(wrapper, {
      viewport: { width: 360, height: 240 },
      rect: { left: 320, top: 216, right: 354, bottom: 236, width: 34, height: 20 },
    })

    expect(popover).not.toBeNull()
    expect(popover?.parentElement).toBe(document.body)
    expect(popover?.classList.contains('viewport-popover')).toBe(true)
    expect(wrapper.find('.status-transfer-wrap .transfer-popover').exists()).toBe(false)
    expect(popover?.style.position).toBe('fixed')
    const left = Number.parseInt(popover?.style.left ?? '', 10)
    const bottom = Number.parseInt(popover?.style.bottom ?? '', 10)
    const width = Number.parseInt(popover?.style.width ?? '', 10)
    const maxHeight = Number.parseInt(popover?.style.maxHeight ?? '', 10)
    expect(left).toBeGreaterThanOrEqual(12)
    expect(bottom).toBe(36)
    expect(popover?.style.top).toBe('')
    expect(left + width).toBeLessThanOrEqual(348)
    expect(bottom + maxHeight).toBeLessThanOrEqual(228)
    expect(width).toBeLessThanOrEqual(336)
    expect(maxHeight).toBeLessThanOrEqual(144)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
  })

  it('repositions the open transfer queue popover after window resize and preserves outside-click semantics', async () => {
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))
    const popover = await openTransferPopoverWithTransfer(wrapper, {
      viewport: { width: 620, height: 420 },
      rect: { left: 560, top: 390, right: 608, bottom: 414, width: 48, height: 24 },
    })
    expect(popover).not.toBeNull()
    const originalWidth = popover?.style.width
    const originalMaxHeight = popover?.style.maxHeight

    setViewportSize(330, 210)
    mockTransferButtonRect(wrapper, {
      left: 260,
      top: 174,
      right: 318,
      bottom: 198,
      width: 58,
      height: 24,
    })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    const resizedPopover = document.body.querySelector('.transfer-popover') as HTMLElement
    const left = Number.parseInt(resizedPopover.style.left, 10)
    const bottom = Number.parseInt(resizedPopover.style.bottom, 10)
    const width = Number.parseInt(resizedPopover.style.width, 10)
    const maxHeight = Number.parseInt(resizedPopover.style.maxHeight, 10)
    expect(resizedPopover.style.width).not.toBe(originalWidth)
    expect(resizedPopover.style.maxHeight).not.toBe(originalMaxHeight)
    expect(left + width).toBeLessThanOrEqual(318)
    expect(bottom).toBe(48)
    expect(bottom + maxHeight).toBeLessThanOrEqual(198)

    resizedPopover.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.transfer-popover')).not.toBeNull()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.transfer-popover')).toBeNull()
  })

  it('keeps the transfer queue popover anchored to the workspace bottom-right when SFTP is expanded', async () => {
    localStorage.setItem('serverpilot.sftpExpanded', 'true')
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))
    mockSftpPanelRect(wrapper, {
      top: 840,
      bottom: 1170,
      left: 0,
      right: 1200,
      width: 1200,
      height: 330,
    })

    const popover = await openTransferPopoverWithTransfer(wrapper, {
      viewport: { width: 1200, height: 1200 },
      rect: { left: 860, top: 1164, right: 1088, bottom: 1188, width: 228, height: 24 },
      workspaceRect: { left: 0, top: 0, right: 1200, bottom: 1200, width: 1200, height: 1200 },
    })

    expect(popover).not.toBeNull()
    const left = Number.parseInt(popover?.style.left ?? '', 10)
    const bottom = Number.parseInt(popover?.style.bottom ?? '', 10)
    const width = Number.parseInt(popover?.style.width ?? '', 10)
    expect(left + width).toBeLessThanOrEqual(1188)
    expect(1188 - (left + width)).toBeLessThanOrEqual(24)
    expect(bottom).toBe(48)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
  })

  it('emits Chinese toast messages when recursive transfers finish or cancel', async () => {
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))
    const sftpStore = useSftpStore()

    sftpStore.transfersById.partial = {
      id: 'partial',
      connectionId: 7,
      direction: 'upload',
      recursive: true,
      sourceType: 'directory',
      localPath: 'C:/tmp/site',
      remotePath: '/home/demo/site',
      fileName: 'site',
      currentFile: 'assets/app.js',
      totalBytes: 200,
      transferredBytes: 150,
      filesTotal: 3,
      filesDone: 2,
      failedCount: 1,
      skippedCount: 1,
      percent: 75,
      speedBytesPerSecond: 0,
      status: 'partial_failed',
      errorMessage: '部分文件传输失败',
      startedAt: '2026-06-16T00:00:02Z',
      finishedAt: '2026-06-16T00:00:03Z',
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('notify')).toContainEqual(['上传目录完成，但有 1 个失败、1 个跳过。', 'error'])

    sftpStore.transfersById.canceled = {
      id: 'canceled',
      connectionId: 7,
      direction: 'download',
      recursive: true,
      sourceType: 'directory',
      localPath: 'C:/tmp/site',
      remotePath: '/home/demo/site',
      fileName: 'site',
      currentFile: 'assets/app.js',
      totalBytes: 200,
      transferredBytes: 50,
      filesTotal: 3,
      filesDone: 1,
      failedCount: 0,
      skippedCount: 0,
      percent: 25,
      speedBytesPerSecond: 0,
      status: 'canceled',
      errorMessage: '传输已取消',
      startedAt: '2026-06-16T00:00:04Z',
      finishedAt: '2026-06-16T00:00:05Z',
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('notify')).toContainEqual(['传输已取消', 'info'])
  })

  it('places tunnel status to the right of transfer status and keeps the tunnel click action', async () => {
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))
    await wrapper.setProps({ alertActiveCount: 2 })
    const tunnelStore = useTunnelStore()
    tunnelStore.runtimesById['tun-1'] = tunnel()
    await wrapper.vm.$nextTick()

    const rightGroup = wrapper.get('.status-transfer-wrap')
    const controls = rightGroup.findAll('button')
    const rightText = rightGroup.element.textContent ?? ''

    expect(rightGroup.text()).toContain('无传输')
    expect(rightGroup.text()).toContain('告警 2')
    expect(rightGroup.text()).toContain('隧道 1')
    expect(controls[0].classes()).toContain('status-transfer')
    expect(controls.at(-2)!.classes()).toContain('status-tunnel')
    expect(controls.at(-1)!.classes()).toContain('status-alert')
    expect(rightText.indexOf('隧道 1')).toBeLessThan(rightText.indexOf('告警 2'))
    expect(rightText.indexOf('无传输')).toBeLessThan(rightText.indexOf('隧道 1'))

    await controls.at(-2)!.trigger('click')
    expect(wrapper.emitted('openTunnels')).toEqual([[]])
    await controls.at(-1)!.trigger('click')
    expect(wrapper.emitted('alerts')).toEqual([[]])
  })

  it('shows a resume action for the paused active transfer in the status bar', async () => {
    const { wrapper } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      sftpActive: true,
      hasActiveSession: true,
    }))
    const sftpStore = useSftpStore()
    sftpStore.transfersById.paused = {
      id: 'paused',
      connectionId: 7,
      direction: 'upload',
      localPath: 'C:/tmp/big.bin',
      remotePath: '/home/demo/big.bin',
      fileName: 'big.bin',
      totalBytes: 1000,
      transferredBytes: 500,
      resumeOffset: 500,
      percent: 50,
      speedBytesPerSecond: 0,
      status: 'paused',
      errorMessage: '',
      canResume: true,
      canCancel: true,
      startedAt: '2026-06-16T00:00:03Z',
      finishedAt: '',
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.status-transfer').text()).toContain('已暂停')
    await wrapper.get('.status-transfer-action').trigger('click')
    expect(window.go?.main?.App?.SftpResumeTransfer).toHaveBeenCalledWith({
      serverID: 7,
      contextID: 'server:7',
      transferID: 'paused',
    })
  })

  it('switches SFTP context with same-server terminal tabs and closes only the active tab context', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    const sessions: TerminalSessionInfo[] = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
      { sessionId: 'term-2', connectionId: 7, title: 'server #2', status: 'online', code: '', message: '' },
    ]
    store.tabs = sessions
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    const panel = () => wrapper.findComponent({ name: 'SftpPanel' })
    expect(panel().props('contextId')).toBe('term-1')
    expect(panel().props('terminalSessionId')).toBe('term-1')

    store.activate('term-2')
    await wrapper.vm.$nextTick()
    expect(panel().props('contextId')).toBe('term-2')
    expect(panel().props('terminalSessionId')).toBe('term-2')

    await wrapper.findAllComponents({ name: 'TerminalView' }).at(1)!.vm.$emit('close')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseSftpContext).toHaveBeenCalledWith({
      connectionId: 7,
      contextId: 'term-2',
      terminalSessionId: 'term-2',
    })
    expect(window.go?.main?.App?.CloseTerminal).toHaveBeenCalledWith('term-2')
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(['term-1'])
    expect(store.activeSessionId).toBe('term-1')
  })

  it('passes the server terminal profile override to the active terminal tab', async () => {
    const connectionWithProfile: Connection = {
      ...connection,
      terminalProfileId: 'tp-ops',
    }
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    await wrapper.setProps({
      connection: connectionWithProfile,
      connections: [connectionWithProfile],
      terminalProfiles: [defaultProfile, customProfile],
      defaultTerminalProfile: defaultProfile,
    })
    store.tabs = [
      { sessionId: 'term-profile', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-profile')
    await wrapper.vm.$nextTick()

    const terminalView = wrapper.findComponent({ name: 'TerminalView' })
    expect(terminalView.props('profile')).toMatchObject({ id: 'tp-ops', fontSize: 18 })
    expect(terminalView.props('connection')).toMatchObject({ id: 7, terminalProfileId: 'tp-ops' })
  })

  it('disconnects the server when the terminal workspace closes the final terminal tab', async () => {
    const { wrapper, store } = mountWorkspace(state({
      status: 'online',
      terminalActive: true,
      hasActiveSession: true,
    }))
    store.tabs = [
      { sessionId: 'term-1', connectionId: 7, title: 'server #1', status: 'online', code: '', message: '' },
    ]
    store.workspaces[7].status = 'connected'
    store.activate('term-1')
    await wrapper.vm.$nextTick()

    await wrapper.findComponent({ name: 'TerminalView' }).vm.$emit('close')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.CloseSftpContext).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.CloseTerminal).not.toHaveBeenCalled()
    expect(wrapper.emitted('finalTerminalDisconnect')).toEqual([[7]])
    expect(store.tabs).toHaveLength(0)
    expect(store.activeSessionId).toBeNull()
    expect(store.activeWorkspaceServerId).toBeNull()
    expect(store.hasWorkspace(7)).toBe(false)
  })
})
