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
const panelWiringSource = source('./composables/useAppPanelControllerWiring.ts')
const serverRuntimeWiringSource = source('./composables/useAppServerRuntimeWiring.ts')
const runtimeViewModelSource = source('./composables/useAppRuntimeViewModel.ts')
const modelSource = source('./composables/appRuntimeControllerModel.ts')

describe('App runtime/controller wiring structure', () => {
  it('moves server context menu and manager panel controller wiring out of App.vue', () => {
    expect(appSource).toContain("import { useAppPanelControllerWiring } from './composables/useAppPanelControllerWiring'")
    expect(appSource).toContain("import { useAppRuntimeViewModel } from './composables/useAppRuntimeViewModel'")
    expect(appSource).toContain('useAppServerRuntimeWiring(')
    expect(appSource).toContain('useAppPanelControllerWiring(')
    expect(appSource).toContain('useAppRuntimeViewModel(')
    expect(appSource).not.toContain("import { useServerContextMenuController } from './composables/useServerContextMenuController'")
    expect(appSource).not.toContain("import { useManagerToolLaunchFlow } from './composables/useManagerToolLaunchFlow'")
    expect(appSource).not.toContain('useServerContextMenuController(')
    expect(appSource).not.toContain('useManagerToolLaunchFlow<Connection>(')
})

  it('keeps App.vue under this runtime/controller wiring refactor line-count target', () => {
    expect(nonBlankLineCount(appSource)).toBeLessThanOrEqual(680)
  })

  it('keeps runtime/controller wiring dependency-injected and free of forbidden coupling', () => {
    for (const moduleSource of [panelWiringSource, serverRuntimeWiringSource, runtimeViewModelSource, modelSource]) {
      expect(moduleSource).not.toBe('')
      expect(moduleSource).not.toMatch(/from ['"].*\/api\/backend['"]/)
      expect(moduleSource).not.toMatch(/from ['"].*\/stores\//)
      expect(moduleSource).not.toContain('localStorage')
      expect(moduleSource).not.toContain('sessionStorage')
      expect(moduleSource).not.toContain('new AppController')
      expect(moduleSource).not.toContain('mitt(')
      expect(moduleSource).not.toMatch(/password|passphrase|privateKey|terminal output|remote file content/i)
    }
  })

  it('keeps runtime/controller wiring line counts and version bump in architecture governance history', () => {
    const record = architectureGovernanceHistory.appRuntimeControllerWiring
    expect(record.title).toContain('App.vue runtime/controller wiring orchestration')
    expect(record.lineCount).toMatch(/App\.vue line count:[^\n]*737[^\n]*->\s*\d+/)
    expect(record.versionChange).toBe('0.4.0-beta.27 -> 0.4.0-beta.28')
  })
})
