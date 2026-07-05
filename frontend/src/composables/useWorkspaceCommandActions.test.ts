import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { LocalTerminalState, TerminalSessionInfo } from '../types'
import type { PaneAssignment, PaneAssignments, SplitMode, SplitPaneId } from '../utils/workspaceSplitTypes'
import { defaultPaneAssignments } from '../utils/workspaceSplitTypes'
import { useWorkspaceCommandActions } from './useWorkspaceCommandActions'

describe('useWorkspaceCommandActions', () => {
  it('assigns a selected SSH terminal to the target pane and removes duplicate display from old pane', async () => {
    const harness = actionHarness({
      paneAssignments: {
        ...defaultPaneAssignments(),
        'pane-1': { kind: 'ssh', sessionId: 'ssh-1' },
      },
    })
    const actions = useWorkspaceCommandActions(harness.options)

    expect(actions.assignToPane({ kind: 'ssh', sessionId: 'ssh-1' }, 'pane-2')).toBe(true)
    await harness.flush()

    expect(harness.paneAssignments.value['pane-1']).toBeNull()
    expect(harness.paneAssignments.value['pane-2']).toEqual({ kind: 'ssh', sessionId: 'ssh-1' })
    expect(harness.activePaneId.value).toBe('pane-2')
    expect(harness.activateSshSession).toHaveBeenCalledWith('ssh-1')
    expect(harness.activateLocalSession).not.toHaveBeenCalled()
  })

  it('clears pane assignment without invoking any terminal close lifecycle', async () => {
    const harness = actionHarness({
      paneAssignments: {
        ...defaultPaneAssignments(),
        'pane-1': { kind: 'ssh', sessionId: 'ssh-1' },
        'pane-2': { kind: 'local', sessionId: 'local-1' },
      },
      activePaneId: 'pane-1',
    })
    const actions = useWorkspaceCommandActions(harness.options)

    actions.clearPane('pane-1')
    await harness.flush()

    expect(harness.paneAssignments.value['pane-1']).toBeNull()
    expect(harness.paneAssignments.value['pane-2']).toEqual({ kind: 'local', sessionId: 'local-1' })
    expect(harness.closeSession).not.toHaveBeenCalled()
    expect(harness.activePaneId.value).toBe('pane-2')
  })

  it('notifies and closes selector/menu overlays when selecting connected terminals with no options', () => {
    const harness = actionHarness({ sshTabs: [], localSessions: [] })
    const actions = useWorkspaceCommandActions(harness.options)
    actions.menuPaneId.value = 'pane-1'
    actions.selectorPaneId.value = 'pane-1'

    actions.openTerminalSelector('pane-1')

    expect(actions.menuPaneId.value).toBeNull()
    expect(actions.selectorPaneId.value).toBeNull()
    expect(harness.notify).toHaveBeenCalledWith('没有可用终端。', 'info')
  })

  it('routes pane-targeted add/connect/local actions through injected callbacks after activating the pane', async () => {
    const harness = actionHarness()
    const actions = useWorkspaceCommandActions(harness.options)

    actions.addServerToPane('pane-2')
    actions.connectSavedToPane('pane-2')
    actions.openLocalTerminalToPane('pane-2', 'powershell')
    await harness.flush()

    expect(harness.activePaneId.value).toBe('pane-2')
    expect(harness.emitPaneAddServer).toHaveBeenCalledWith('pane-2')
    expect(harness.emitPaneConnectSaved).toHaveBeenCalledWith('pane-2')
    expect(harness.emitPaneOpenLocalTerminal).toHaveBeenCalledWith('pane-2', 'powershell')
  })

  it('keeps pane swap and move actions inside assignment orchestration only', async () => {
    const harness = actionHarness({
      splitMode: 'quad',
      visiblePaneIds: ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
      paneAssignments: {
        ...defaultPaneAssignments(),
        'pane-1': { kind: 'ssh', sessionId: 'ssh-1' },
        'pane-2': { kind: 'local', sessionId: 'local-1' },
      },
    })
    const actions = useWorkspaceCommandActions(harness.options)

    actions.swapPaneAssignments('pane-1', 'pane-2')
    await harness.flush()
    expect(harness.paneAssignments.value['pane-1']).toEqual({ kind: 'local', sessionId: 'local-1' })
    expect(harness.paneAssignments.value['pane-2']).toEqual({ kind: 'ssh', sessionId: 'ssh-1' })

    actions.movePaneAssignment('pane-2', 'pane-3')
    await harness.flush()
    expect(harness.paneAssignments.value['pane-2']).toBeNull()
    expect(harness.paneAssignments.value['pane-3']).toEqual({ kind: 'ssh', sessionId: 'ssh-1' })
    expect(harness.closeSession).not.toHaveBeenCalled()
  })
})

function actionHarness(options: {
  splitMode?: SplitMode
  visiblePaneIds?: SplitPaneId[]
  paneAssignments?: PaneAssignments
  activePaneId?: SplitPaneId
  sshTabs?: TerminalSessionInfo[]
  localSessions?: LocalTerminalState[]
} = {}) {
  const splitMode = ref<SplitMode>(options.splitMode ?? 'vertical')
  const paneAssignments = ref<PaneAssignments>(options.paneAssignments ?? defaultPaneAssignments())
  const activePaneId = ref<SplitPaneId>(options.activePaneId ?? 'pane-1')
  const maximizedPaneId = ref<SplitPaneId | null>(null)
  const visiblePaneIds = ref<SplitPaneId[]>(options.visiblePaneIds ?? ['pane-1', 'pane-2'])
  const sshTabs = ref<TerminalSessionInfo[]>(options.sshTabs ?? [sshTab('ssh-1')])
  const localSessions = ref<LocalTerminalState[]>(options.localSessions ?? [localSession('local-1')])
  const closeSession = vi.fn()
  const pendingLayoutTicks: Array<() => void> = []
  const harness = {
    splitMode,
    paneAssignments,
    activePaneId,
    maximizedPaneId,
    visiblePaneIds,
    activateSshSession: vi.fn(),
    activateLocalSession: vi.fn(),
    clearActiveWorkspace: vi.fn(),
    closeSession,
    notify: vi.fn(),
    emitPaneAddServer: vi.fn(),
    emitPaneConnectSaved: vi.fn(),
    emitPaneOpenLocalTerminal: vi.fn(),
    flush: async () => {
      while (pendingLayoutTicks.length) pendingLayoutTicks.shift()?.()
    },
    options: {
      splitMode,
      splitEnabled: computed(() => splitMode.value !== 'single'),
      paneAssignments,
      activePaneId,
      maximizedPaneId,
      visibleSplitPaneIds: computed(() => visiblePaneIds.value),
      sshTabs: computed(() => sshTabs.value),
      activeSshSessionId: ref('ssh-1'),
      localSessions: computed(() => localSessions.value),
      activeLocalSessionId: ref<string | null>(null),
      sshOutputActivityBySession: computed(() => ({})),
      localOutputActivityBySession: computed(() => ({})),
      sshOutputActivityLabel: () => '',
      localOutputActivityLabel: () => '',
      setSplitMode: (mode: SplitMode) => { splitMode.value = mode },
      clearAllPanes: () => { paneAssignments.value = defaultPaneAssignments() },
      togglePaneMaximize: (paneId: SplitPaneId) => { maximizedPaneId.value = maximizedPaneId.value === paneId ? null : paneId },
      restoreMaximizedPane: () => { maximizedPaneId.value = null },
      saveLayout: vi.fn(),
      refreshVisibleOutputSessions: vi.fn(),
      bumpLayout: vi.fn(() => undefined),
      scheduleLayoutBump: (callback: () => void) => { pendingLayoutTicks.push(callback) },
      activateSshSession: (sessionId: string) => harness.activateSshSession(sessionId),
      activateLocalSession: (sessionId: string) => harness.activateLocalSession(sessionId),
      clearActiveWorkspace: () => harness.clearActiveWorkspace(),
      clearSshOutputActivity: vi.fn(),
      clearLocalOutputActivity: vi.fn(),
      notify: (message: string, type: 'success' | 'error' | 'info') => harness.notify(message, type),
      emitPaneAddServer: (paneId: SplitPaneId) => harness.emitPaneAddServer(paneId),
      emitPaneConnectSaved: (paneId: SplitPaneId) => harness.emitPaneConnectSaved(paneId),
      emitPaneOpenLocalTerminal: (paneId: SplitPaneId, shellKind: 'cmd' | 'powershell') =>
        harness.emitPaneOpenLocalTerminal(paneId, shellKind),
    },
  }
  return harness
}

function sshTab(sessionId: string): TerminalSessionInfo {
  return {
    sessionId,
    connectionId: 1,
    title: sessionId,
    status: 'online',
    code: '',
    message: '',
  }
}

function localSession(sessionId: string): LocalTerminalState {
  return {
    sessionId,
    shellKind: 'powershell',
    shell: 'powershell.exe',
    shellName: 'Windows PowerShell',
    elevated: false,
    title: sessionId,
    cwd: '',
    status: 'running',
    exitCode: null,
    error: '',
    startedAt: '',
    endedAt: '',
  }
}
