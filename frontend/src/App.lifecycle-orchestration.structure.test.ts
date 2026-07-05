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
const lifecycleFiles = [
  './composables/useAppStartupFlow.ts',
  './composables/useAppEventSubscriptions.ts',
  './composables/useAppLifecycleWatchers.ts',
] as const

describe('App lifecycle orchestration structure', () => {
  it('uses dedicated startup, event subscription, and lifecycle watcher composables', () => {
    expect(appSource).toContain("import { useAppStartupFlow } from './composables/useAppStartupFlow'")
    expect(appSource).toContain("import { useAppEventSubscriptions } from './composables/useAppEventSubscriptions'")
    expect(appSource).toContain("import { useAppLifecycleWatchers } from './composables/useAppLifecycleWatchers'")
    expect(appSource).toContain('useAppStartupFlow(')
    expect(appSource).toContain('useAppEventSubscriptions(')
    expect(appSource).toContain('useAppLifecycleWatchers(')
  })

  it('removes lifecycle bodies from App.vue instead of keeping inline startup and watcher logic', () => {
    const removedBodies = [
      'store.subscribe()',
      'sftpStore.subscribe()',
      'window.addEventListener(\'resize\', schedulePersistWindowState)',
      'window.removeEventListener(\'resize\', schedulePersistWindowState)',
      'const [loadedSettings] = await Promise.all',
      'watch(() => terminalStore.lastStatus',
      'watch(() => store.states',
      'watch(() => store.snapshots',
    ]
    for (const body of removedBodies) {
      expect(appSource, body).not.toContain(body)
    }
  })

  it('keeps App.vue under this lifecycle refactor line-count target', () => {
    expect(nonBlankLineCount(appSource)).toBeLessThanOrEqual(847)
  })

  it('keeps lifecycle composables dependency-injected and free of backend/store/persistence/event-bus coupling', () => {
    for (const file of lifecycleFiles) {
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

  it('keeps lifecycle line counts and version bump in architecture governance history', () => {
    const record = architectureGovernanceHistory.appLifecycleOrchestration
    expect(record.title).toContain('App.vue startup / subscriptions / lifecycle orchestration')
    expect(record.lineCount).toMatch(/App\.vue line count:[^\n]*927[^\n]*->\s*\d+/)
    expect(record.versionChange).toBe('0.4.0-beta.25 -> 0.4.0-beta.26')
  })
})
