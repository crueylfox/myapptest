import { describe, expect, it } from 'vitest'
import {
  ALL_SPLIT_PANE_IDS,
  SPLIT_RATIO_DEFAULT,
  clampSplitRatio,
  defaultPaneAssignments,
  getPaneFillOrder,
  getPanePositionLabel,
  getVisiblePaneIds,
  normalizeSplitRatio,
  parsePaneAssignment,
} from './workspaceSplitTypes'

describe('workspace split types and pure helpers', () => {
  it('returns visible pane ids for every split mode', () => {
    expect(getVisiblePaneIds('single')).toEqual(['pane-1'])
    expect(getVisiblePaneIds('vertical')).toEqual(['pane-1', 'pane-2'])
    expect(getVisiblePaneIds('horizontal')).toEqual(['pane-1', 'pane-2'])
    expect(getVisiblePaneIds('quad')).toEqual(ALL_SPLIT_PANE_IDS)
  })

  it('returns visual fill order for quad, vertical, horizontal, and single modes', () => {
    expect(getPaneFillOrder('quad')).toEqual(['pane-1', 'pane-2', 'pane-3', 'pane-4'])
    expect(getPaneFillOrder('vertical')).toEqual(['pane-1', 'pane-2'])
    expect(getPaneFillOrder('horizontal')).toEqual(['pane-1', 'pane-2'])
    expect(getPaneFillOrder('single')).toEqual([])
  })

  it('keeps the existing Chinese position labels by split mode', () => {
    expect(getPanePositionLabel('vertical', 'pane-1')).toBe('左')
    expect(getPanePositionLabel('vertical', 'pane-2')).toBe('右')
    expect(getPanePositionLabel('horizontal', 'pane-1')).toBe('上')
    expect(getPanePositionLabel('horizontal', 'pane-2')).toBe('下')
    expect(getPanePositionLabel('quad', 'pane-1')).toBe('左上')
    expect(getPanePositionLabel('quad', 'pane-2')).toBe('右上')
    expect(getPanePositionLabel('quad', 'pane-3')).toBe('左下')
    expect(getPanePositionLabel('quad', 'pane-4')).toBe('右下')
    expect(getPanePositionLabel('single', 'pane-1')).toBe('当前')
  })

  it('clamps and normalizes ratios with the existing defaults', () => {
    expect(SPLIT_RATIO_DEFAULT).toBe(0.5)
    expect(clampSplitRatio(0)).toBe(0.25)
    expect(clampSplitRatio(1)).toBe(0.75)
    expect(normalizeSplitRatio('bad')).toBe(0.5)
    expect(normalizeSplitRatio(0.333333)).toBe(0.333)
  })

  it('creates fresh empty pane assignment records', () => {
    const first = defaultPaneAssignments()
    const second = defaultPaneAssignments()
    first['pane-1'] = { kind: 'ssh', sessionId: 'term-1' }

    expect(second).toEqual({
      'pane-1': null,
      'pane-2': null,
      'pane-3': null,
      'pane-4': null,
    })
  })

  it('normalizes old SSH string assignments and typed assignments', () => {
    expect(parsePaneAssignment(' term-1 ')).toEqual({ kind: 'ssh', sessionId: 'term-1' })
    expect(parsePaneAssignment({ kind: 'local', sessionId: ' local-1 ' })).toEqual({ kind: 'local', sessionId: 'local-1' })
    expect(parsePaneAssignment({ kind: 'ssh', sessionId: '' })).toBeNull()
    expect(parsePaneAssignment({ kind: 'docker', sessionId: 'x' })).toBeNull()
  })
})
