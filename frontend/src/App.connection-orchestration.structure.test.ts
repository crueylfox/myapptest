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
const extractedFiles = [
  './composables/useAuthDialogFlow.ts',
  './composables/useHostKeyTrustFlow.ts',
  './composables/useConnectionDialogFlow.ts',
  './composables/useAppServerRuntimeWiring.ts',
  './composables/useAppPanelControllerWiring.ts',
  './composables/useServerRuntimeActions.ts',
  './composables/useServerContextMenuController.ts',
  './composables/useLocalTerminalLaunchFlow.ts',
  './utils/serverActionModel.ts',
] as const
const serverRuntimeWiringSource = source('./composables/useAppServerRuntimeWiring.ts')
const panelControllerWiringSource = source('./composables/useAppPanelControllerWiring.ts')

describe('App connection orchestration structure', () => {
  it('uses dedicated connection, runtime, context-menu, and local-terminal orchestration modules', () => {
    expect(appSource).toContain("import { useConnectionDialogFlow } from './composables/useConnectionDialogFlow'")
    expect(appSource).toMatch(/import \{[^}]*useAppServerRuntimeWiring[^}]*\} from '\.\/composables\/useAppServerRuntimeWiring'/)
    expect(appSource).toContain("import { useAppPanelControllerWiring } from './composables/useAppPanelControllerWiring'")
    expect(appSource).toContain("import { useLocalTerminalLaunchFlow } from './composables/useLocalTerminalLaunchFlow'")
    expect(appSource).toContain('useConnectionDialogFlow(')
    expect(appSource).toContain('useAppServerRuntimeWiring(')
    expect(appSource).toContain('useAppPanelControllerWiring(')
    expect(appSource).toContain('useLocalTerminalLaunchFlow(')
    expect(serverRuntimeWiringSource).toContain('useServerRuntimeActions(')
    expect(panelControllerWiringSource).toContain('useServerContextMenuController(')
  })

  it('keeps auth, host-key trust, and connection-dialog orchestration out of App.vue', () => {
    const removedBodies = [
      'function requestAuth(',
      'async function submitAuth(',
      'function closeAuthDialog(',
      'async function trustHostKeyAndRun(',
      'async function trustWorkspaceHostKey(',
      'async function duplicateConnection(',
      'async function deleteConnection(',
    ]
    for (const body of removedBodies) {
      expect(appSource, body).not.toContain(body)
    }
    expect(appSource).toContain("import { useAuthDialogFlow } from './composables/useAuthDialogFlow'")
    expect(appSource).toContain("import { useHostKeyTrustFlow } from './composables/useHostKeyTrustFlow'")
    expect(appSource).toContain('useAuthDialogFlow(')
    expect(appSource).toContain('useHostKeyTrustFlow(')
  })

  it('removes large server and local-terminal flow bodies from App.vue', () => {
    expect(appSource).not.toContain('async function saveConnection(')
    expect(appSource).not.toContain('async function activateServer(')
    expect(appSource).not.toContain('async function ensureMonitorAndOpenTerminal(')
    expect(appSource).not.toContain('async function newTerminal(')
    expect(appSource).not.toContain('async function openLocalTerminal(')
    expect(appSource).not.toContain('async function reconnectTerminal(')
    expect(appSource).not.toContain('async function connectServer(')
    expect(appSource).not.toContain('async function testServer(')
    expect(appSource).not.toContain('async function reconnectServer(')
    expect(appSource).not.toContain('async function disconnectServer(')
    expect(appSource).not.toContain('async function selectServerMenu(')
  })

  it('keeps App.vue under the large-refactor reduction target for this round', () => {
    expect(nonBlankLineCount(appSource)).toBeLessThanOrEqual(927)
  })

  it('keeps extracted orchestration modules free of backend imports, stores, persistence, and app-controller/event-bus patterns', () => {
    for (const file of extractedFiles) {
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

  it('keeps the App.vue before and after line counts in architecture governance history', () => {
    const record = architectureGovernanceHistory.appConnectionOrchestration
    expect(record.title).toContain('App.vue auth / host-key trust / connection-dialog orchestration')
    expect(record.lineCount).toMatch(/App\.vue line count:[^\n]*1047[^\n]*->\s*927/)
    expect(record.versionChange).toBe('0.4.0-beta.24 -> 0.4.0-beta.25')
  })
})
