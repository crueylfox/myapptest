import { describe, expect, it } from 'vitest'
import { uiRegressionCatalog, uiRegressionSurfaceIds } from './uiRegressionCatalog'

const requiredSurfaces = [
  'server-picker-geometry',
  'split-pane-empty-state',
  'workspace-tabs-close',
  'settings-state-ui',
  'transfer-popover',
  'manager-dialogs',
  'sftp-future-risk',
  'connection-security-modal',
] as const

describe('UI regression catalog', () => {
  it('tracks each historical high-risk UI surface with issues and guards', () => {
    expect(uiRegressionSurfaceIds).toEqual(requiredSurfaces)

    for (const surface of uiRegressionCatalog) {
      expect(surface.historicalIssues.length, surface.id).toBeGreaterThanOrEqual(2)
      expect(surface.guards.length, surface.id).toBeGreaterThanOrEqual(1)
      expect(surface.productionBehaviorChange).toBe(false)
      expect(surface.fixtureIds.length, surface.id).toBeGreaterThanOrEqual(1)
    }
  })

  it('records the current fallback tooling without claiming screenshot coverage', () => {
    const guardKinds = new Set(uiRegressionCatalog.flatMap((surface) => surface.guards.map((guard) => guard.kind)))

    expect(guardKinds.has('css-contract')).toBe(true)
    expect(guardKinds.has('dom-behavior')).toBe(true)
    expect(guardKinds.has('fixture-state')).toBe(true)
    expect(guardKinds.has('screenshot')).toBe(false)
  })
})
