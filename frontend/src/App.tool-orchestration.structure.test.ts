import { describe, expect, it } from 'vitest'
import { architectureGovernanceHistory } from './test-support/architectureGovernanceHistory'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { existsSync, readFileSync } = await import('node:fs') as {
  existsSync: (path: URL) => boolean
  readFileSync: (path: URL, encoding: string) => string
}

function source(relative: string) {
  const path = new URL(relative, import.meta.url)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

const appSource = source('./App.vue')
const newExtractionFiles = [
  './composables/useSettingsPanelFlow.ts',
  './composables/useBackupRestoreFlow.ts',
  './composables/useKeyVaultPanelFlow.ts',
  './composables/useAppPanelControllerWiring.ts',
  './composables/useManagerToolLaunchFlow.ts',
  './utils/appToolPanelModel.ts',
] as const
const panelControllerWiringSource = source('./composables/useAppPanelControllerWiring.ts')

describe('App tool orchestration structure', () => {
  it('uses focused tool, settings, backup, key vault, and manager orchestration modules', () => {
    expect(appSource).toContain("import { useSettingsPanelFlow } from './composables/useSettingsPanelFlow'")
    expect(appSource).toContain("import { useBackupRestoreFlow } from './composables/useBackupRestoreFlow'")
    expect(appSource).toContain("import { useKeyVaultPanelFlow } from './composables/useKeyVaultPanelFlow'")
    expect(appSource).toContain("import { useAppPanelControllerWiring } from './composables/useAppPanelControllerWiring'")
    expect(appSource).toContain('useSettingsPanelFlow(')
    expect(appSource).toContain('useBackupRestoreFlow(')
    expect(appSource).toContain('useKeyVaultPanelFlow(')
    expect(appSource).toContain('useAppPanelControllerWiring(')
    expect(panelControllerWiringSource).toMatch(/useManagerToolLaunchFlow(?:<[^>]+>)?\(/)
    expect(source('./composables/useManagerToolLaunchFlow.ts')).toContain("from '../utils/appToolPanelModel'")
  })

  it('removes remaining large settings, backup, and manager flow bodies from App.vue', () => {
    const removedBodies = [
      'function navigateMain(',
      'function openMonitorPanel(',
      'function openActiveMonitorPanel(',
      'function openTunnelDialog(',
      'function openDockerDialog(',
      'function openProcessManager(',
      'function openServiceManager(',
      'async function openNetworkDetails(',
      'async function openNetworkDiagnostics(',
      'function openDashboardToolDialog(',
      'function hasActiveNetworkServer(',
      'async function refreshActiveNetworkInterfaces(',
      'async function loadActiveNetworkInterfaces(',
      'async function setActiveNetworkInterface(',
      'function closeSettingsOverlay(',
      'function normalizeAppSettings(',
      'async function saveSettings(',
      'async function saveSettingsAndClose(',
      'async function saveDashboardLayout(',
      'async function reloadAfterBackupImport(',
      'function dashboardSummary(',
      'async function runWithConcurrency(',
      'async function connectDashboardServers(',
      'async function disconnectDashboardServers(',
    ]
    for (const body of removedBodies) {
      expect(appSource, body).not.toContain(body)
    }
  })

  it('keeps App.vue under the current large-refactor target', () => {
    expect(appSource.split(/\r?\n/).length).toBeLessThanOrEqual(1100)
  })

  it('keeps new orchestration modules dependency-injected and free of persistence, app-controller, and event-bus patterns', () => {
    for (const file of newExtractionFiles) {
      const moduleSource = source(file)
      expect(moduleSource, file).not.toBe('')
      expect(moduleSource, file).not.toMatch(/from ['"].*\/api\/backend['"]/)
      expect(moduleSource, file).not.toMatch(/from ['"].*\/stores\//)
      expect(moduleSource, file).not.toContain('localStorage')
      expect(moduleSource, file).not.toContain('sessionStorage')
      expect(moduleSource, file).not.toContain('new AppController')
      expect(moduleSource, file).not.toContain('mitt(')
    }
  })

  it('does not introduce sensitive secret state in the new orchestration modules', () => {
    for (const file of newExtractionFiles) {
      const moduleSource = source(file)
      expect(moduleSource, file).not.toMatch(/exportPassword|importPassword|backupPassword|privateKey|passphrase/i)
      expect(moduleSource, file).not.toMatch(/console\.(log|warn|error)/)
    }
  })

  it('keeps this round line counts and version bump in architecture governance history', () => {
    const record = architectureGovernanceHistory.appToolOrchestration
    expect(record.title).toContain('App.vue tools/settings/backup/keyvault/manager-panels')
    expect(record.lineCount).toMatch(/App\.vue line count:[^\n]*1344[^\n]*->\s*\d+/)
    expect(record.versionChange).toBe('0.4.0-beta.14 -> 0.4.0-beta.15')
  })
})
