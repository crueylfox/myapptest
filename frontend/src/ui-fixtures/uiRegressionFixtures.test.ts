import { describe, expect, it } from 'vitest'
import {
  getUiRegressionFixturesBySurface,
  uiRegressionFixtures,
  uiRegressionFixtureSurfaceIds,
} from './uiRegressionFixtures'

describe('UI regression fixtures', () => {
  it('covers the first batch of historical UI states with deterministic fixture data', () => {
    expect(uiRegressionFixtureSurfaceIds).toEqual([
      'server-picker-geometry',
      'split-pane-empty-state',
      'workspace-tabs-close',
      'settings-state-ui',
      'transfer-popover',
      'manager-dialogs',
      'sftp-real-render',
      'connection-security-modal',
    ])

    expect(getUiRegressionFixturesBySurface('server-picker-geometry').map((fixture) => fixture.state)).toEqual([
      'empty',
      'one-server',
      'many-servers',
      'search-debian-one-result',
      'search-no-result',
      'narrow-width',
      'long-list-internal-scroll',
    ])
    expect(getUiRegressionFixturesBySurface('split-pane-empty-state').map((fixture) => fixture.state)).toEqual([
      'single-empty',
      'two-pane-empty',
      'quad-empty',
      'active-pane-empty',
      'narrow-width',
    ])
    expect(getUiRegressionFixturesBySurface('workspace-tabs-close').map((fixture) => fixture.state)).toEqual([
      'short-title',
      'ip-port-title',
      'long-title',
      'dirty-error',
      'many-tabs',
      'close-x',
    ])
    expect(getUiRegressionFixturesBySurface('settings-state-ui').map((fixture) => fixture.state)).toEqual([
      'backup-import-five-options',
      'saved-false',
      'manual-uncheck',
      'native-notification-toggle',
      'native-notification-unavailable',
      'narrow-width',
    ])
    expect(getUiRegressionFixturesBySurface('transfer-popover').map((fixture) => fixture.state)).toEqual([
      'empty',
      'active-transfer',
      'failed-completed',
      'many-items',
      'narrow-width',
    ])
    expect(getUiRegressionFixturesBySurface('manager-dialogs').map((fixture) => fixture.state)).toEqual([
      'service-manager-journal-narrow',
      'service-manager-openwrt-logread',
      'service-manager-openwrt-logread-unavailable',
      'service-manager-openwrt-logread-long-lines',
      'docker-manager-container-list',
      'docker-manager-logs-stats-narrow',
      'docker-manager-batch-actions',
      'docker-manager-compose-supported',
      'docker-manager-compose-unavailable',
      'docker-manager-compose-narrow',
      'tunnel-manager-profile-list',
      'tunnel-manager-form-narrow',
      'process-manager-list-long-command',
      'process-manager-action-confirm',
      'network-diagnostics-summary',
    ])
    expect(getUiRegressionFixturesBySurface('sftp-real-render').map((fixture) => fixture.state)).toEqual([
      'file-list-standard',
      'file-list-long-names',
      'toolbar-narrow',
      'context-menu-edge',
      'empty-directory',
      'loading-error',
      'selection-actions',
      'transfer-entry',
    ])
    expect(getUiRegressionFixturesBySurface('connection-security-modal').map((fixture) => fixture.state)).toEqual([
      'connection-dialog-password',
      'connection-dialog-keyvault',
      'connection-dialog-advanced',
      'auth-dialog-password-error',
      'auth-dialog-key-passphrase',
      'host-key-trust-changed',
      'key-vault-list-empty-and-many',
      'key-vault-edit-form',
      'alert-center-list',
      'monitor-alert-center-entry',
      'dashboard-alert-center-layer',
      'app-logs-long-lines',
      'command-palette-search-disabled',
      'command-palette-no-results',
    ])
  })

  it('keeps fixtures test-only, synthetic, and free of sensitive runtime content', () => {
    const fixtureText = JSON.stringify(uiRegressionFixtures.map((fixture) => fixture.data)).toLowerCase()

    expect(fixtureText).not.toContain('real_password')
    expect(fixtureText).not.toContain('private key')
    expect(fixtureText).not.toContain('real_passphrase')
    expect(fixtureText).not.toContain('terminal output')
    expect(fixtureText).not.toContain('journal output')
    expect(fixtureText).not.toContain('remote file content')
    expect(fixtureText).not.toContain('-----begin')
  })
})
