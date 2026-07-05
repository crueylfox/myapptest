// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { usePaneTargetRequests } from './usePaneTargetRequests'

describe('usePaneTargetRequests', () => {
  it('creates pending pane targets with increasing request ids', () => {
    const requests = usePaneTargetRequests()

    const first = requests.beginPaneOpenTarget('pane-2', 'connect-saved')
    const second = requests.beginPaneOpenTarget('pane-3', 'add-server')

    expect(first).toMatchObject({ paneId: 'pane-2', action: 'connect-saved', requestId: 1 })
    expect(second).toMatchObject({ paneId: 'pane-3', action: 'add-server', requestId: 2 })
    expect(requests.pendingPaneOpenTarget.value).toBe(second)
  })

  it('cancel and close clear only the matching pending target', () => {
    const requests = usePaneTargetRequests()
    const first = requests.beginPaneOpenTarget('pane-2', 'connect-saved')
    const second = requests.beginPaneOpenTarget('pane-3', 'add-server')

    requests.clearPendingPaneOpenTarget(first)
    expect(requests.pendingPaneOpenTarget.value).toBe(second)

    requests.clearPendingPaneOpenTarget(second)
    expect(requests.pendingPaneOpenTarget.value).toBeNull()
  })

  it('publishes a one-shot assignment payload and clears the pending target', () => {
    const requests = usePaneTargetRequests()
    const target = requests.beginPaneOpenTarget('pane-4', 'connect-saved')

    const assignment = requests.publishPaneTargetAssignment(target, 'ssh', 'term-1')

    expect(assignment).toEqual({ paneId: 'pane-4', kind: 'ssh', sessionId: 'term-1', requestId: 1 })
    expect(requests.paneTargetAssignment.value).toEqual(assignment)
    expect(requests.pendingPaneOpenTarget.value).toBeNull()
  })

  it('does not let stale requests overwrite a newer request assignment', () => {
    const requests = usePaneTargetRequests()
    const stale = requests.beginPaneOpenTarget('pane-2', 'connect-saved')
    const current = requests.beginPaneOpenTarget('pane-3', 'add-server')

    expect(requests.publishPaneTargetAssignment(stale, 'ssh', 'old-term')).toBeNull()
    expect(requests.paneTargetAssignment.value).toBeNull()
    expect(requests.pendingPaneOpenTarget.value).toBe(current)
  })

  it('keeps specified pane targets available ahead of first-empty auto-fill', () => {
    const requests = usePaneTargetRequests()
    const target = requests.beginPaneOpenTarget('pane-2', 'new-cmd')

    expect(requests.pendingForAction('new-cmd')).toBe(target)
    expect(requests.pendingForAction('connect-saved')).toBeNull()
  })

  it('does not write pending targets or sensitive values to localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const requests = usePaneTargetRequests()
    const target = requests.beginPaneOpenTarget('pane-1', 'add-server')

    requests.publishPaneTargetAssignment(target, 'local', 'local-1')

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(requests.pendingPaneOpenTarget.value)).not.toContain('password')
    expect(JSON.stringify(requests.paneTargetAssignment.value)).not.toContain('private')
  })
})
