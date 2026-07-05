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

function nonBlankLineCount(fileSource: string) {
  return fileSource.trimEnd().split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0).length
}

const appSource = source('./App.vue')
const menuActionsSource = source('./composables/useAppMenuActions.ts')

describe('App command/menu action orchestration structure', () => {
  it('keeps CommandPalette outside App.vue and extracts remaining menu/global action orchestration', () => {
    expect(appSource).not.toContain('CommandPalette')
    expect(appSource).toContain("import { useAppMenuActions } from './composables/useAppMenuActions'")
    expect(appSource).toContain('useAppMenuActions(')
  })

  it('removes global action bodies from App.vue', () => {
    const removedBodies = [
      'function toggleServerPicker(',
      'function openSavedServerPickerForPane(',
      'async function openOrActivateServer(',
      'async function openSftpForConnection(',
      'function openSftpById(',
      'async function reconnectSftpById(',
      'function openAlertCenter(',
      'function handleAlertNotifications(',
      'function handleAlertView(',
      'function createTestAlert(',
      'async function showLogs(',
      'function closeLogs(',
      'function setLogLevelFilter(',
      'function setLogQuery(',
      'async function copyLogDetail(',
      'function handleMonitorError(',
      'async function run(',
      'function errorMessage(',
    ]
    for (const body of removedBodies) {
      expect(appSource, body).not.toContain(body)
    }
  })

  it('keeps App.vue under this command/menu refactor line-count target', () => {
    expect(nonBlankLineCount(appSource)).toBeLessThanOrEqual(760)
  })

  it('keeps menu action composable dependency-injected and free of backend/store/persistence/event-bus coupling', () => {
    expect(menuActionsSource).not.toBe('')
    expect(menuActionsSource).not.toMatch(/from ['"].*\/api\/backend['"]/)
    expect(menuActionsSource).not.toMatch(/from ['"].*\/stores\//)
    expect(menuActionsSource).not.toContain('localStorage')
    expect(menuActionsSource).not.toContain('sessionStorage')
    expect(menuActionsSource).not.toContain('new AppController')
    expect(menuActionsSource).not.toContain('mitt(')
  })

  it('keeps command/menu line counts and version bump in architecture governance history', () => {
    const record = architectureGovernanceHistory.appCommandActionOrchestration
    expect(record.title).toContain('App.vue global command/menu action orchestration')
    expect(record.lineCount).toMatch(/App\.vue line count:[^\n]*834[^\n]*->\s*\d+/)
    expect(record.versionChange).toBe('0.4.0-beta.26 -> 0.4.0-beta.27')
  })
})
