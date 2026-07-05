import { describe, expect, it } from 'vitest'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local harness files.
const { existsSync, readFileSync } = await import('node:fs') as {
  existsSync: (path: URL) => boolean
  readFileSync: (path: URL, encoding: string) => string
}

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function exists(path: string) {
  return existsSync(new URL(path, import.meta.url))
}

describe('real-render UI regression harness contract', () => {
  it('wires the standard frontend verification gate through Vitest, Playwright, and build', () => {
    const packageJson = JSON.parse(read('../../package.json')) as {
      scripts: Record<string, string>
    }
    const verificationCommand = 'npm run type-check && npm run test -- --run && npm run test:ui && npm run build'
    const playwrightConfig = read('../../playwright.config.ts')

    expect(packageJson.scripts['verify:frontend']).toBe(verificationCommand)
    expect(packageJson.scripts['verify:frontend'].split(' && ')).toEqual([
      'npm run type-check',
      'npm run test -- --run',
      'npm run test:ui',
      'npm run build',
    ])
    expect(packageJson.scripts['test:ui']).toBe('playwright test')
    expect(playwrightConfig).toContain("testDir: './e2e'")
    expect(exists('../../e2e/ui-regression.spec.ts')).toBe(true)
    expect(exists('../../e2e/sftp-ui-regression.spec.ts')).toBe(true)
    expect(exists('../../e2e/manager-dialog-ui-regression.spec.ts')).toBe(true)
    expect(exists('../../e2e/connection-security-ui-regression.spec.ts')).toBe(true)
  })

  it('exposes a test-only Playwright host without importing the production app entry', () => {
    const packageJson = JSON.parse(read('../../package.json')) as {
      scripts: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.scripts['test:ui']).toBe('playwright test')
    expect(packageJson.devDependencies?.['@playwright/test']).toBeTruthy()
    expect(exists('../../playwright.config.ts')).toBe(true)
    expect(exists('../../ui-regression.html')).toBe(true)
    expect(exists('./UiRegressionFixtureHost.vue')).toBe(true)
    expect(exists('./uiRegressionFixtureHostMain.ts')).toBe(true)
    expect(exists('../../e2e/ui-regression.spec.ts')).toBe(true)
    expect(exists('../../e2e/manager-dialog-ui-regression.spec.ts')).toBe(true)
    expect(exists('../../e2e/connection-security-ui-regression.spec.ts')).toBe(true)

    const hostMain = read('./uiRegressionFixtureHostMain.ts')
    expect(hostMain).toContain("import './uiRegressionFixtureHost.css'")
    expect(hostMain).not.toContain('../main')
    expect(hostMain).not.toContain('/wailsjs/')
  })

  it('keeps the real-render test list aligned with first-batch historical UI surfaces', () => {
    const spec = read('../../e2e/ui-regression.spec.ts')

    expect(spec).toContain("openFixture(page, 'server-picker-search-debian')")
    expect(spec).toContain("openFixture(page, 'server-picker-many-servers')")
    expect(spec).toContain("openFixture(page, 'server-picker-search-empty')")
    expect(spec).toContain("openFixture(page, 'split-pane-two-empty')")
    expect(spec).toContain("openFixture(page, 'split-pane-quad-empty-narrow'")
    expect(spec).toContain("openFixture(page, 'workspace-tabs-many')")
    expect(spec).toContain("openFixture(page, 'settings-backup-restore-options')")
    expect(spec).toContain("openFixture(page, 'settings-native-notification'")
    expect(spec).toContain("openFixture(page, 'transfer-popover-many')")
    expect(spec).toContain("openFixture(page, 'service-manager-journal-narrow'")
    expect(spec).toContain("openFixture(page, 'service-manager-openwrt-logread'")
    expect(spec).toContain("openFixture(page, 'service-manager-openwrt-logread-unavailable'")
    expect(spec).toContain("openFixture(page, 'service-manager-openwrt-logread-long-lines'")
  })

  it('keeps the real-render test list aligned with second-batch SFTP surfaces', () => {
    const spec = read('../../e2e/sftp-ui-regression.spec.ts')

    expect(spec).toContain("openSftpFixture(page, 'sftp-file-list-standard')")
    expect(spec).toContain("openSftpFixture(page, 'sftp-file-list-long-names'")
    expect(spec).toContain("openSftpFixture(page, 'sftp-toolbar-narrow'")
    expect(spec).toContain("openSftpFixture(page, 'sftp-context-menu-edge'")
    expect(spec).toContain("openSftpFixture(page, 'sftp-empty-directory')")
    expect(spec).toContain("openSftpFixture(page, 'sftp-loading-error'")
    expect(spec).toContain("openSftpFixture(page, 'sftp-selection-actions')")
    expect(spec).toContain("openSftpFixture(page, 'sftp-transfer-entry')")
  })

  it('keeps the real-render test list aligned with third-batch manager dialog surfaces', () => {
    const spec = read('../../e2e/manager-dialog-ui-regression.spec.ts')

    expect(spec).toContain("openManagerFixture(page, 'docker-manager-container-list')")
    expect(spec).toContain("openManagerFixture(page, 'docker-manager-logs-stats-narrow'")
    expect(spec).toContain("openManagerFixture(page, 'docker-manager-batch-actions')")
    expect(spec).toContain("openManagerFixture(page, 'docker-manager-compose-supported')")
    expect(spec).toContain("openManagerFixture(page, 'docker-manager-compose-unavailable')")
    expect(spec).toContain("openManagerFixture(page, 'docker-manager-compose-narrow'")
    expect(spec).toContain("openManagerFixture(page, 'tunnel-manager-profile-list')")
    expect(spec).toContain("openManagerFixture(page, 'tunnel-manager-form-narrow'")
    expect(spec).toContain("openManagerFixture(page, 'process-manager-list-long-command')")
    expect(spec).toContain("openManagerFixture(page, 'process-manager-action-confirm'")
    expect(spec).toContain("openManagerFixture(page, 'network-diagnostics-summary'")
  })

  it('keeps manager dialog fixtures isolated from runtime stores and Wails APIs', () => {
    const host = read('./UiRegressionFixtureHost.vue')

    expect(host).toContain('docker-manager-container-list')
    expect(host).toContain('docker-manager-compose-supported')
    expect(host).toContain('tunnel-manager-profile-list')
    expect(host).toContain('process-manager-list-long-command')
    expect(host).toContain('network-diagnostics-summary')
    expect(host).not.toContain('../stores/docker')
    expect(host).not.toContain('../stores/tunnels')
    expect(host).not.toContain('../stores/processes')
    expect(host).not.toContain('../api/backend')
    expect(host).not.toContain('/wailsjs/')
  })

  it('keeps the real-render test list aligned with fourth-batch connection and security surfaces', () => {
    const spec = read('../../e2e/connection-security-ui-regression.spec.ts')

    expect(spec).toContain("openConnectionSecurityFixture(page, 'connection-dialog-password'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'connection-dialog-keyvault'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'connection-dialog-advanced'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'auth-dialog-password-error'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'auth-dialog-key-passphrase'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'host-key-trust-changed'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'key-vault-list-empty-and-many'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'key-vault-edit-form'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'alert-center-list'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'monitor-alert-center-entry'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'dashboard-alert-center-layer'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'app-logs-long-lines'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'command-palette-search-disabled'")
    expect(spec).toContain("openConnectionSecurityFixture(page, 'command-palette-no-results'")
  })

  it('keeps connection and security fixtures isolated from backend, stores, Wails APIs, and secret material', () => {
    const host = read('./UiRegressionFixtureHost.vue')

    expect(host).toContain('connection-dialog-password')
    expect(host).toContain('host-key-trust-changed')
    expect(host).toContain('key-vault-list-empty-and-many')
    expect(host).toContain('app-logs-long-lines')
    expect(host).toContain('command-palette-search-disabled')
    expect(host).not.toContain('../stores/commands')
    expect(host).not.toContain('../stores/terminal')
    expect(host).not.toContain('../api/backend')
    expect(host).not.toContain('/wailsjs/')
    expect(host.toLowerCase()).not.toContain('-----begin')
  })
})
