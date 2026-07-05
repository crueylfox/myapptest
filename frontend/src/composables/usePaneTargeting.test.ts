import { describe, expect, it } from 'vitest'
import {
  resolveActiveCommandTarget,
  resolveActiveSftpContextTarget,
  resolvePaneTarget,
  resolveTopTabPaneIntent,
} from './usePaneTargeting'
import { defaultPaneAssignments, type PaneAssignment } from '../utils/workspaceSplitTypes'

const ssh = (sessionId: string): PaneAssignment => ({ kind: 'ssh', sessionId })
const local = (sessionId: string): PaneAssignment => ({ kind: 'local', sessionId })

describe('usePaneTargeting pure target resolution', () => {
  it('uses the active SSH pane as command target in split mode', () => {
    const tab = { sessionId: 'term-1', connectionId: 7, status: 'online' }

    expect(resolveActiveCommandTarget({
      splitEnabled: true,
      activePaneAssignment: ssh('term-1'),
      sshTabs: [tab],
      activeSshTab: null,
      localTerminalActive: false,
    })).toBe(tab)
  })

  it('does not route SSH-only insertion to the previous SSH when active pane is Local', () => {
    expect(resolveActiveCommandTarget({
      splitEnabled: true,
      activePaneAssignment: local('local-1'),
      sshTabs: [{ sessionId: 'term-1', connectionId: 7, status: 'online' }],
      activeSshTab: { sessionId: 'term-1', connectionId: 7, status: 'online' },
      localTerminalActive: true,
    })).toBeNull()
  })

  it('top tab click activates an already assigned pane', () => {
    expect(resolveTopTabPaneIntent({
      splitEnabled: true,
      visiblePaneIds: ['pane-1', 'pane-2'],
      paneAssignments: { ...defaultPaneAssignments(), 'pane-2': ssh('term-2') },
      activePaneId: 'pane-1',
      assignment: ssh('term-2'),
    })).toEqual({ type: 'activate-pane', paneId: 'pane-2' })
  })

  it('top tab click on an unassigned tab returns assignment intent for active pane', () => {
    expect(resolveTopTabPaneIntent({
      splitEnabled: true,
      visiblePaneIds: ['pane-1', 'pane-2'],
      paneAssignments: defaultPaneAssignments(),
      activePaneId: 'pane-2',
      assignment: ssh('term-3'),
    })).toEqual({ type: 'assign-to-pane', paneId: 'pane-2', assignment: ssh('term-3') })
  })

  it('specified target pane takes precedence over first-empty auto-fill', () => {
    expect(resolvePaneTarget({
      specifiedPaneId: 'pane-2',
      visiblePaneIds: ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
      paneAssignments: { ...defaultPaneAssignments(), 'pane-1': ssh('term-1') },
      fillOrder: ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
    })).toBe('pane-2')
  })

  it('falls back to first empty pane by fill order when no target pane is specified', () => {
    expect(resolvePaneTarget({
      specifiedPaneId: null,
      visiblePaneIds: ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
      paneAssignments: { ...defaultPaneAssignments(), 'pane-1': ssh('term-1'), 'pane-2': ssh('term-2') },
      fillOrder: ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
    })).toBe('pane-3')
  })

  it('returns SFTP context only for active SSH panes and never for Local panes', () => {
    expect(resolveActiveSftpContextTarget({ activePaneAssignment: ssh('term-1'), activeSshTab: { sessionId: 'term-1', connectionId: 7 } })).toEqual({
      connectionId: 7,
      sessionId: 'term-1',
    })
    expect(resolveActiveSftpContextTarget({ activePaneAssignment: local('local-1'), activeSshTab: null })).toBeNull()
  })
})
