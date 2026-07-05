import { describe, expect, it } from 'vitest'
import {
  assignPaneAssignment,
  autoFillPaneAssignment,
  clearPaneAssignment,
  dropStalePaneAssignments,
  movePaneAssignment,
  normalizePersistedPaneAssignments,
  removeSessionFromPaneAssignments,
  samePaneAssignment,
  swapPaneAssignments,
} from './usePaneAssignments'
import { defaultPaneAssignments, type PaneAssignment, type PaneAssignments } from '../utils/workspaceSplitTypes'

const ssh = (sessionId: string): PaneAssignment => ({ kind: 'ssh', sessionId })
const local = (sessionId: string): PaneAssignment => ({ kind: 'local', sessionId })

function assignments(values: Partial<PaneAssignments> = {}): PaneAssignments {
  return { ...defaultPaneAssignments(), ...values }
}

describe('usePaneAssignments pure operations', () => {
  it('assigns SSH and Local sessions to empty panes', () => {
    expect(assignPaneAssignment(assignments(), ssh('term-1'), 'pane-1').assignments['pane-1']).toEqual(ssh('term-1'))
    expect(assignPaneAssignment(assignments(), local('local-1'), 'pane-2').assignments['pane-2']).toEqual(local('local-1'))
  })

  it('removes an existing same-session assignment before assigning to the target pane', () => {
    const result = assignPaneAssignment(assignments({ 'pane-1': ssh('term-1') }), ssh('term-1'), 'pane-3')

    expect(result.assignments['pane-1']).toBeNull()
    expect(result.assignments['pane-3']).toEqual(ssh('term-1'))
    expect(result.activePaneId).toBe('pane-3')
  })

  it('clears a pane without closing or touching other assignments', () => {
    const result = clearPaneAssignment(assignments({ 'pane-1': ssh('term-1'), 'pane-2': local('local-1') }), 'pane-1', ['pane-1', 'pane-2'], 'pane-1')

    expect(result.assignments['pane-1']).toBeNull()
    expect(result.assignments['pane-2']).toEqual(local('local-1'))
    expect(result.activePaneId).toBe('pane-2')
  })

  it('removes all matching SSH or Local sessions', () => {
    const start = assignments({ 'pane-1': ssh('term-1'), 'pane-2': local('local-1'), 'pane-3': ssh('term-1') })

    expect(removeSessionFromPaneAssignments(start, ssh('term-1')).assignments).toEqual(assignments({ 'pane-2': local('local-1') }))
    expect(removeSessionFromPaneAssignments(start, local('local-1')).assignments).toEqual(assignments({ 'pane-1': ssh('term-1'), 'pane-3': ssh('term-1') }))
  })

  it('swaps SSH/SSH and SSH/Local assignments', () => {
    const start = assignments({ 'pane-1': ssh('a'), 'pane-2': ssh('b'), 'pane-3': local('c') })

    expect(swapPaneAssignments(start, 'pane-1', 'pane-2', ['pane-1', 'pane-2']).assignments).toMatchObject({ 'pane-1': ssh('b'), 'pane-2': ssh('a') })
    expect(swapPaneAssignments(start, 'pane-1', 'pane-3', ['pane-1', 'pane-3']).assignments).toMatchObject({ 'pane-1': local('c'), 'pane-3': ssh('a') })
  })

  it('moves an assignment to an empty pane and rejects moves to non-empty panes', () => {
    const start = assignments({ 'pane-1': ssh('a'), 'pane-2': local('b') })
    const moved = movePaneAssignment(start, 'pane-1', 'pane-3', ['pane-1', 'pane-2', 'pane-3'])
    const rejected = movePaneAssignment(start, 'pane-1', 'pane-2', ['pane-1', 'pane-2', 'pane-3'])

    expect(moved.assignments).toMatchObject({ 'pane-1': null, 'pane-3': ssh('a') })
    expect(moved.activePaneId).toBe('pane-3')
    expect(rejected.changed).toBe(false)
    expect(rejected.assignments).toEqual(start)
  })

  it('auto-fills the first empty pane in split visual order and leaves full panes unchanged', () => {
    const start = assignments({ 'pane-1': ssh('a'), 'pane-2': ssh('b') })
    const filled = autoFillPaneAssignment(start, local('c'), 'quad')
    const full = autoFillPaneAssignment(assignments({ 'pane-1': ssh('a'), 'pane-2': ssh('b') }), local('c'), 'vertical')

    expect(filled.assignments['pane-3']).toEqual(local('c'))
    expect(filled.activePaneId).toBe('pane-3')
    expect(full.changed).toBe(false)
    expect(full.assignments).toEqual(assignments({ 'pane-1': ssh('a'), 'pane-2': ssh('b') }))
  })

  it('returns the already assigned pane for duplicate auto-fill without duplicating the session', () => {
    const result = autoFillPaneAssignment(assignments({ 'pane-2': ssh('a') }), ssh('a'), 'quad')

    expect(result.assignments['pane-2']).toEqual(ssh('a'))
    expect(Object.values(result.assignments).filter((item) => samePaneAssignment(item, ssh('a')))).toHaveLength(1)
    expect(result.activePaneId).toBe('pane-2')
  })

  it('drops stale sessions and duplicate assignments by validator', () => {
    const result = dropStalePaneAssignments(assignments({
      'pane-1': ssh('alive'),
      'pane-2': ssh('missing'),
      'pane-3': ssh('alive'),
      'pane-4': local('local-alive'),
    }), (assignment) => assignment.sessionId.endsWith('alive'))

    expect(result.assignments).toEqual(assignments({ 'pane-1': ssh('alive'), 'pane-4': local('local-alive') }))
    expect(result.changed).toBe(true)
  })

  it('normalizes persisted old SSH strings and ignores stale pane ids', () => {
    expect(normalizePersistedPaneAssignments({
      'pane-1': 'term-1',
      'pane-2': { kind: 'local', sessionId: 'local-1' },
      'pane-9': { kind: 'ssh', sessionId: 'ignored' },
    })).toEqual(assignments({
      'pane-1': ssh('term-1'),
      'pane-2': local('local-1'),
    }))
  })
})
