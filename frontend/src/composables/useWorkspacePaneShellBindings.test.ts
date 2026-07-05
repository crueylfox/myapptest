import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { LocalTerminalState, TerminalSessionInfo } from '../types'
import { defaultPaneAssignments, type PaneAssignments, type SplitPaneId } from '../utils/workspaceSplitTypes'
import { useWorkspacePaneShellBindings } from './useWorkspacePaneShellBindings'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const source = readFileSync(new URL('./useWorkspacePaneShellBindings.ts', import.meta.url), 'utf8')

describe('useWorkspacePaneShellBindings', () => {
  it('builds SSH and Local pane shell bindings without mixing session kinds', () => {
    const paneAssignments = ref<PaneAssignments>({
      ...defaultPaneAssignments(),
      'pane-1': { kind: 'ssh', sessionId: 'ssh-1' },
      'pane-2': { kind: 'local', sessionId: 'local-1' },
      'pane-3': { kind: 'ssh', sessionId: 'missing-ssh' },
    })
    const bindings = useWorkspacePaneShellBindings({
      paneAssignments,
      activePaneId: ref<SplitPaneId>('pane-1'),
      maximizedPaneId: ref<SplitPaneId | null>('pane-2'),
      paneDropTargetId: ref<SplitPaneId | null>('pane-3'),
      menuPaneId: ref<SplitPaneId | null>('pane-2'),
      paneMenuMode: ref('main'),
      sshTabs: computed(() => [sshTab('ssh-1', 'Debian', 'online')]),
      localSessions: computed(() => [localSession('local-1', 'PowerShell', 'running')]),
      assignmentActivityState: (assignment) =>
        assignment?.sessionId === 'ssh-1' ? { hasActivity: true } : undefined,
      assignmentActivityLabel: (assignment) => assignment?.sessionId === 'ssh-1' ? '2' : '',
      assignmentActivityTitle: (assignment) => assignment?.sessionId === 'ssh-1' ? '2 条新输出' : '有新输出',
      occupiedPaneOptions: (paneId) => [{ paneId, label: `occupied:${paneId}` }],
      emptyPaneOptions: (paneId) => [{ paneId, label: `empty:${paneId}` }],
      terminalView: {
        visible: ref(true),
        layoutRevision: ref(7),
        copyOnSelectEnabled: ref(true),
        rightClickPasteEnabled: ref(false),
        shortcutSettings: ref(undefined),
        profileRevision: ref(3),
        defaultLocalProfile: ref({ fontFamily: 'monospace' } as never),
        resolveConnection: (connectionId) => ({ id: connectionId, name: 'Debian' } as never),
        resolveProfile: () => ({ fontFamily: 'JetBrains Mono' } as never),
      },
    })

    expect(bindings.paneTab('pane-1')?.title).toBe('Debian')
    expect(bindings.paneLocalSession('pane-2')?.title).toBe('PowerShell')
    expect(bindings.paneAssigned('pane-3')).toBe(false)
    expect(bindings.paneKind('pane-2')).toBe('local')
    expect(bindings.paneTitle('pane-3')).toBe('Local Terminal')

    expect(bindings.paneShellBinding('pane-1', { gridColumn: '1' })).toMatchObject({
      paneId: 'pane-1',
      active: true,
      maximized: false,
      dropTarget: false,
      kind: 'ssh',
      title: 'Debian',
      statusClass: 'online',
      statusText: '已连接',
      sessionId: 'ssh-1',
      hasActivity: true,
      activityLabel: '2',
      activityTitle: '2 条新输出',
      paneStyle: { gridColumn: '1' },
    })

    expect(bindings.paneShellBinding('pane-2')).toMatchObject({
      active: false,
      maximized: true,
      dropTarget: false,
      kind: 'local',
      title: 'PowerShell',
      statusClass: 'online',
      statusText: '运行中',
      localSessionId: 'local-1',
      menuOpen: true,
    })

    expect(bindings.sshTerminalViewProps(sshTab('ssh-1', 'Debian', 'online'), true)).toMatchObject({
      sessionId: 'ssh-1',
      active: true,
      visible: true,
      layoutRevision: 7,
      copyOnSelectEnabled: true,
      rightClickPasteEnabled: false,
      profileRevision: 3,
      connection: { id: 1, name: 'Debian' },
      profile: { fontFamily: 'JetBrains Mono' },
    })
    expect(bindings.localTerminalViewProps(localSession('local-1', 'PowerShell', 'running'), false)).toMatchObject({
      sessionId: 'local-1',
      active: false,
      visible: true,
      layoutRevision: 7,
      copyOnSelectEnabled: true,
      rightClickPasteEnabled: false,
      profileRevision: 3,
      profile: { fontFamily: 'monospace' },
    })
  })

  it('keeps pane shell binding inside frontend dependency boundaries', () => {
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
  })
})

function sshTab(sessionId: string, title: string, status: TerminalSessionInfo['status']): TerminalSessionInfo {
  return {
    sessionId,
    connectionId: 1,
    title,
    status,
    code: '',
    message: '',
  }
}

function localSession(sessionId: string, title: string, status: LocalTerminalState['status']): LocalTerminalState {
  return {
    sessionId,
    shellKind: 'powershell',
    shell: 'powershell.exe',
    shellName: 'Windows PowerShell',
    elevated: false,
    title,
    cwd: '',
    status,
    exitCode: null,
    error: '',
    startedAt: '',
    endedAt: '',
  }
}
