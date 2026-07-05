import { describe, expect, it } from 'vitest'

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
const shellComponentFiles = [
  './components/AppShell.vue',
  './components/AppTopBar.vue',
  './components/AppStatusBar.vue',
  './components/AppPanelHost.vue',
  './components/AppOverlayHost.vue',
  './utils/appPanelModel.ts',
  './composables/useAppShellBindings.ts',
] as const

describe('App shell structure', () => {
  it('composes the extracted top-level shell, panel, status, and overlay hosts', () => {
    expect(appSource).toContain("import AppShell from './components/AppShell.vue'")
    expect(appSource).toContain("import AppTopBar from './components/AppTopBar.vue'")
    expect(appSource).toContain("import AppStatusBar from './components/AppStatusBar.vue'")
    expect(appSource).toContain("import AppPanelHost from './components/AppPanelHost.vue'")
    expect(appSource).toContain("import AppOverlayHost from './components/AppOverlayHost.vue'")
    expect(appSource).toContain('<AppShell')
    expect(appSource).toContain('<AppTopBar')
    expect(appSource).toContain('<AppStatusBar')
    expect(appSource).toContain('<AppPanelHost')
    expect(appSource).toContain('<AppOverlayHost')
  })

  it('does not keep the large shell, panel switch, or overlay host markup inline', () => {
    expect(appSource).not.toContain('<div class="app-shell"')
    expect(appSource).not.toContain('<main class="content"')
    expect(appSource).not.toContain('<ServerPicker')
    expect(appSource).not.toContain('<ConnectionDialog')
    expect(appSource).not.toContain('<AuthDialog')
    expect(appSource).not.toContain('<AlertCenter')
    expect(appSource).not.toContain('<ToastHost')
    expect(appSource).not.toContain('<AppDialogHost')
    expect(appSource).not.toContain('<section v-if="activeView === \'logs\'" class="logs-panel"')
  })

  it('keeps App.vue under the large-refactor line-count target', () => {
    expect(appSource.split(/\r?\n/).length).toBeLessThanOrEqual(1819)
  })

  it('keeps extracted shell components free of backend APIs, stores, persistence, and app controllers', () => {
    for (const file of shellComponentFiles) {
      const componentSource = source(file)
      expect(componentSource, file).not.toBe('')
      expect(componentSource, file).not.toMatch(/from ['"].*\/api\/backend['"]/)
      expect(componentSource, file).not.toMatch(/from ['"].*\/stores\//)
      expect(componentSource, file).not.toContain('localStorage')
      expect(componentSource, file).not.toContain('new AppController')
      expect(componentSource, file).not.toContain('mitt(')
    }
  })
})
