// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceSplitLayout } from './useWorkspaceSplitLayout'
import { defaultPaneAssignments } from '../utils/workspaceSplitTypes'

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    value: (key: string) => values.get(key) ?? null,
  }
}

const key = 'hostdeck.workspaceSplitLayout.v1'

describe('useWorkspaceSplitLayout', () => {
  it('loads valid layout with old SSH string assignments and typed Local assignments', () => {
    const layout = useWorkspaceSplitLayout({
      storage: storage({
        [key]: JSON.stringify({
          splitMode: 'quad',
          activePaneId: 'pane-2',
          columnRatio: 0.7,
          rowRatio: 0.3,
          paneAssignments: {
            'pane-1': 'term-1',
            'pane-2': { kind: 'local', sessionId: 'local-1' },
          },
        }),
      }),
    })

    expect(layout.splitMode.value).toBe('quad')
    expect(layout.activePaneId.value).toBe('pane-2')
    expect(layout.splitColumnRatio.value).toBe(0.7)
    expect(layout.splitRowRatio.value).toBe(0.3)
    expect(layout.paneAssignments.value).toMatchObject({
      'pane-1': { kind: 'ssh', sessionId: 'term-1' },
      'pane-2': { kind: 'local', sessionId: 'local-1' },
    })
  })

  it('falls back on corrupt layout and defaults missing ratios', () => {
    const corrupt = useWorkspaceSplitLayout({ storage: storage({ [key]: '{bad json' }) })
    const missingRatio = useWorkspaceSplitLayout({ storage: storage({ [key]: JSON.stringify({ splitMode: 'vertical' }) }) })

    expect(corrupt.splitMode.value).toBe('single')
    expect(corrupt.paneAssignments.value).toEqual(defaultPaneAssignments())
    expect(missingRatio.splitColumnRatio.value).toBe(0.5)
    expect(missingRatio.splitRowRatio.value).toBe(0.5)
  })

  it('clamps out-of-range ratios on load and reset', () => {
    const layout = useWorkspaceSplitLayout({
      storage: storage({ [key]: JSON.stringify({ splitMode: 'quad', columnRatio: 0.95, rowRatio: 0.1 }) }),
    })

    expect(layout.splitColumnRatio.value).toBe(0.75)
    expect(layout.splitRowRatio.value).toBe(0.25)
    layout.resetSplitRatios()
    expect(layout.splitColumnRatio.value).toBe(0.5)
    expect(layout.splitRowRatio.value).toBe(0.5)
  })

  it('changes split mode, clears maximize state, and persists only layout data', () => {
    const fakeStorage = storage()
    const layout = useWorkspaceSplitLayout({ storage: fakeStorage })

    layout.maximizedPaneId.value = 'pane-1'
    layout.setSplitMode('quad')

    const saved = JSON.parse(fakeStorage.value(key) ?? '{}')
    expect(layout.splitMode.value).toBe('quad')
    expect(layout.maximizedPaneId.value).toBeNull()
    expect(saved).toEqual(expect.objectContaining({ splitMode: 'quad', paneAssignments: layout.paneAssignments.value }))
    expect(saved.maximizedPaneId).toBeUndefined()
    expect(JSON.stringify(saved)).not.toContain('terminal output')
    expect(JSON.stringify(saved)).not.toContain('password')
    expect(JSON.stringify(saved)).not.toContain('privateKey')
    expect(JSON.stringify(saved)).not.toContain('passphrase')
  })

  it('maximizes and restores runtime state without adding it to persisted layout', () => {
    const fakeStorage = storage({ [key]: JSON.stringify({ splitMode: 'quad' }) })
    const layout = useWorkspaceSplitLayout({ storage: fakeStorage })

    layout.togglePaneMaximize('pane-2')
    expect(layout.maximizedPaneId.value).toBe('pane-2')
    layout.restoreMaximizedPane()
    expect(layout.maximizedPaneId.value).toBeNull()
    expect(fakeStorage.value(key)).not.toContain('maximizedPaneId')
  })

  it('clear all panes clears assignments and exits maximize without closing sessions', () => {
    const layout = useWorkspaceSplitLayout({ storage: storage({ [key]: JSON.stringify({
      splitMode: 'quad',
      activePaneId: 'pane-4',
      paneAssignments: { 'pane-1': 'term-1', 'pane-2': { kind: 'local', sessionId: 'local-1' } },
    }) }) })
    layout.maximizedPaneId.value = 'pane-1'

    layout.clearAllPanes()

    expect(layout.paneAssignments.value).toEqual(defaultPaneAssignments())
    expect(layout.activePaneId.value).toBe('pane-1')
    expect(layout.maximizedPaneId.value).toBeNull()
  })

  it('reports save failure without throwing', () => {
    const layout = useWorkspaceSplitLayout({
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota') },
      },
    })

    expect(layout.saveLayout()).toBe(false)
  })
})
