import { describe, expect, it } from 'vitest'
import { uiRegressionCatalog } from './ui-fixtures/uiRegressionCatalog'
import { uiRegressionFixtures } from './ui-fixtures/uiRegressionFixtures'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const serverPickerSource = readFileSync(new URL('./components/ServerPicker.vue', import.meta.url), 'utf8')
const terminalEmptyPaneSource = readFileSync(new URL('./components/TerminalEmptyPane.vue', import.meta.url), 'utf8')
const workspaceTabsSource = readFileSync(new URL('./components/WorkspaceTabs.vue', import.meta.url), 'utf8')
const settingsViewSource = readFileSync(new URL('./components/SettingsView.vue', import.meta.url), 'utf8')
const settingsBackupSource = readFileSync(new URL('./components/settings/SettingsBackupRestoreSection.vue', import.meta.url), 'utf8')
const settingsAlertSource = readFileSync(new URL('./components/settings/AlertNotificationSettingsSection.vue', import.meta.url), 'utf8')
const terminalWorkspaceSource = readFileSync(new URL('./components/TerminalWorkspace.vue', import.meta.url), 'utf8')
const compactMonitorSource = readFileSync(new URL('./components/CompactMonitorSidebar.vue', import.meta.url), 'utf8')

function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`Missing CSS block: ${selector}`)
  return match[1]
}

function declaration(cssBlock: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = cssBlock.match(new RegExp(`${escaped}:\\s*([^;]+);`))
  if (!match) throw new Error(`Missing CSS declaration: ${property}`)
  return match[1].trim()
}

function rgbaAlpha(value: string) {
  const match = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([.\d]+)\)$/)
  if (!match) throw new Error(`Expected rgba() value, got ${value}`)
  return Number(match[1])
}

function backdropAlpha(cssBlock: string) {
  const background = declaration(cssBlock, 'background')
  return background === 'var(--material-backdrop-bg)'
    ? rgbaAlpha(declaration(block(':root'), '--material-backdrop-bg'))
    : rgbaAlpha(background)
}

describe('first-batch UI regression contracts', () => {
  it('keeps catalog and fixture surfaces aligned for the current fallback test layer', () => {
    const catalogIds = uiRegressionCatalog.map((surface) => surface.id)
    const fixtureSurfaces = new Set(uiRegressionFixtures.map((fixture) => fixture.surface))

    expect(catalogIds).toEqual(expect.arrayContaining([
      'server-picker-geometry',
      'split-pane-empty-state',
      'workspace-tabs-close',
      'settings-state-ui',
      'transfer-popover',
      'manager-dialogs',
      'sftp-future-risk',
      'connection-security-modal',
    ]))
    expect([...fixtureSurfaces].sort()).toEqual([
      'connection-security-modal',
      'manager-dialogs',
      'server-picker-geometry',
      'settings-state-ui',
      'sftp-real-render',
      'split-pane-empty-state',
      'transfer-popover',
      'workspace-tabs-close',
    ])
    expect(uiRegressionFixtures.every((fixture) => fixture.assertionTypes.length > 0)).toBe(true)
  })

  it('keeps ServerPicker fixed, bounded, and list-scrolled instead of panel-scrolled', () => {
    const picker = block('.server-picker')
    const actions = block('.server-picker-actions')
    const pickerList = block('.server-picker-list')
    const pickerContent = block('.server-picker-list-content')

    expect(serverPickerSource).toContain('class="viewport-popover viewport-popover-scroll server-picker"')
    expect(serverPickerSource).toContain('@wheel.capture="handlePickerWheel"')
    expect(picker).toContain('position: fixed')
    expect(picker).toContain('overflow: hidden')
    expect(picker).toContain('max-height: var(--server-picker-panel-max-height, calc(100vh - 16px))')
    expect(picker).toContain('grid-template-rows: auto auto auto var(--server-picker-list-row-size, auto)')
    expect(actions).toContain('display: flex')
    expect(actions).toContain('justify-content: center')
    expect(actions).not.toContain('grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr) 1px minmax(0, 1fr) 1px minmax(0, 1fr)')
    expect(pickerList).toContain('height: var(--server-picker-list-height, auto)')
    expect(pickerList).toContain('overflow-y: var(--server-picker-list-overflow-y, hidden)')
    expect(pickerList).toContain('overscroll-behavior: contain')
    expect(pickerList).not.toContain('scrollbar-gutter: stable')
    expect(pickerList).not.toContain('stable both-edges')
    expect(pickerContent).not.toContain('height: 100%')
  })

  it('keeps split-pane empty actions vertically centered without dashed chrome', () => {
    const empty = block('.terminal-pane-empty')
    const actions = block('.terminal-pane-empty-actions, .terminal-empty-actions')
    const centered = block('.terminal-pane-empty-actions.centered, .terminal-empty-actions.centered')
    const actionButtons = block('.terminal-pane-empty-actions button, .terminal-empty-actions button')

    expect(terminalEmptyPaneSource).toContain('terminal-pane-empty-actions terminal-empty-actions centered')
    expect(empty).toContain('border: 0')
    expect(empty).toContain('grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr)')
    expect(empty).not.toContain('dashed')
    expect(empty).not.toContain('dotted')
    expect(actions).toContain('display: flex')
    expect(actions).toContain('flex-direction: column')
    expect(actions).toContain('align-items: center')
    expect(actions).toContain('justify-content: center')
    expect(actions).toContain('gap: 3px')
    expect(css).toContain('.terminal-empty-actions--horizontal')
    expect(css).toContain('.terminal-empty-actions--vertical')
    expect(centered).toContain('grid-row: 2')
    expect(centered).toContain('justify-self: center')
    expect(centered).toContain('align-self: center')
    expect(actionButtons).toContain('white-space: nowrap')
    expect(terminalEmptyPaneSource).toContain('action-separator--horizontal-stack')
    expect(terminalEmptyPaneSource).toContain('action-separator--vertical-stack')
    expect(terminalEmptyPaneSource).toContain('terminal-empty-actions--${orientation}')
    expect(block('.action-separator--horizontal-stack')).toContain('height: 1px')
    expect(block('.action-separator--horizontal-stack')).toContain('width: min(220px, calc(100% - 20px))')
    expect(block('.action-separator--vertical-stack')).toContain('height: 28px')
    expect(terminalEmptyPaneSource).toContain('AppIcon')
    expect(actions).not.toContain('margin-left: -')
    expect(actions).not.toContain('transform:')
  })

  it('keeps beta smoke UI cleanup contracts explicit', () => {
    expect(block('.network-chart-body')).toContain('grid-template-columns: minmax(54px, max-content) minmax(0, 1fr)')
    expect(block('.network-chart-body')).toContain('gap: 6px')
    expect(block('.network-chart-plot')).toContain('overflow: hidden')
    expect(block('.network-chart-plot .mini-sparkline')).toContain('height: 100px')
    expect(block('.network-chart-plot .mini-sparkline')).toContain('overflow: hidden')
    expect(block('.mini-sparkline .sparkline-path')).not.toContain('stroke-dasharray')
    expect(css).not.toContain('stroke-dasharray')
    expect(block('.network-stat-value')).not.toContain('text-overflow: ellipsis')
    expect(block('.settings-category-nav button')).toContain('justify-content: center')
    expect(block('.settings-category-nav button')).toContain('grid-template-columns: 18px minmax(0, 1fr) 18px')
    expect(block('.settings-category-nav button')).toContain('gap:')
    expect(block('.settings-category-nav button')).toContain('font-size: 16px')
    expect(block('.settings-page-overlay .settings-category-shell')).toContain('align-items: stretch')
    expect(block('.settings-page-overlay .settings-category-content')).toContain('flex: 1 1 auto')
    expect(block('.settings-page-overlay .settings-category-content')).toContain('overflow-y: auto')
    expect(block('.settings-page-overlay .settings-category-content')).toContain('min-height: 0')
    expect(block('.settings-page-overlay .settings-category-nav')).toContain('align-self: start')
    expect(block('.settings-page-overlay .settings-category-nav')).toContain('max-height: max-content')
    expect(css).not.toContain('.settings-category-separator')
    expect(block('.topbar-menu button')).toContain('font-size: 13px')
    expect(block('.topbar-menu button')).toContain('border: 0')
    expect(workspaceTabsSource).toContain('topbar-action-inner')
    expect(block('.topbar-split .split-mode-button')).not.toContain('background: var(--panel-2)')
    expect(block('.topbar-navigation > button')).not.toContain('background: var(--panel-2)')
    expect(block('.topbar-action-inner')).toContain('border-radius: 8px')
    expect(block('.topbar-action-inner')).toContain('padding: 6px 10px')
    expect(block('.topbar-split .split-mode-button:hover .topbar-action-inner, .topbar-split .split-mode-button[aria-expanded="true"] .topbar-action-inner, .topbar-navigation > button:hover .topbar-action-inner, .topbar-navigation > button[aria-expanded="true"] .topbar-action-inner')).toContain('background: var(--panel-2)')
    expect(block('.topbar-menu')).toContain('width: 145px')
    expect(block('.topbar-menu')).toContain('min-width: 145px')
    expect(block('.topbar-menu')).toContain('max-width: 145px')
    expect(block('.topbar-menu')).toContain('overflow: hidden')
    expect(block('.topbar-menu button')).toContain('grid-template-columns: 18px minmax(0, 1fr) 18px')
    expect(block('.topbar-menu button')).toContain('gap: 3px')
    expect(block('.topbar-menu button')).toContain('width: 100%')
    expect(block('.topbar-menu button')).toContain('min-width: 0')
    expect(block('.topbar-menu button')).toContain('max-width: 100%')
    expect(block('.topbar-menu-content')).toContain('justify-self: center')
    expect(block('.topbar-menu-trailing')).toContain('justify-content: flex-end')
    expect(block('.topbar-menu-label')).not.toContain('text-overflow: ellipsis')
    expect(block('.topbar-menu-label')).not.toContain('overflow: hidden')
    expect(css).not.toContain('.topbar-menu-separator')
    expect(block('.topbar-action-separator')).toContain('height: 24px')
    expect(block('.system-info')).not.toContain('border: 1px solid')
    expect(block('.system-info-summary')).toContain('grid-template-columns: minmax(0, 1fr) 24px')
    expect(block('.system-info-summary-text')).toContain('min-width: 0')
    expect(block('.system-info-summary-chevron')).toContain('width: 24px')
    expect(block('.process-panel > header strong, .network-compact header strong')).toContain('font-size: 15px')
    expect(block('.process-sort-options')).not.toContain('border: 1px solid')
    expect(compactMonitorSource).toContain('class="process-option-separator"')
    expect(compactMonitorSource).toContain('class="network-rate-cluster"')
    expect(compactMonitorSource).toContain('class="network-inline-separator"')
    expect(compactMonitorSource).toContain('<AppIcon :name="systemExpanded ? \'chevron-up\' : \'chevron-down\'"')
    expect(block('.resource-line strong')).toContain('font-size: 13px')
    expect(block('.resource-line span')).toContain('font-size: 15px')
    expect(block('.resource-line small')).toContain('font-size: 12px')
    expect(block('.settings-header-actions')).toContain('gap: 8px')
    expect(block('.settings-close-button')).toContain('font-size: inherit')
    expect(block('.settings-close-button')).toContain('font-weight: 600')
    expect(block('.settings-close-button')).toContain('padding: 8px 13px')
    expect(block('.settings-close-button')).toContain('border-radius: 7px')
    expect(settingsViewSource).not.toContain('settings-header-action-separator')
    expect(css).not.toContain('.settings-header-action-separator')
    expect(block('.terminal-profile-section')).toContain('border-top: 1px solid var(--border)')
    expect(css).not.toContain('.network-stat-row {')
  })

  it('keeps modal, menu, settings, and radio styles visible in macOS WebView dark mode', () => {
    const visualBlurRule = block('body:has(.modal-backdrop) .app-visual-root,\nbody:has(.settings-overlay-backdrop) .app-visual-root,\nbody:has(.multi-server-dashboard-backdrop) .app-visual-root,\nbody:has(.alert-center-backdrop) .app-visual-root,\nbody:has(.docker-dialog-backdrop) .app-visual-root,\nbody:has(.tunnel-dialog-backdrop) .app-visual-root,\nbody:has(.process-dialog-backdrop) .app-visual-root,\nbody:has(.service-dialog-backdrop) .app-visual-root')
    expect(visualBlurRule).toContain('filter: blur(10px) brightness(.72)')

    for (const selector of ['.settings-page-overlay', '.topbar-menu', '.server-picker']) {
      const source = block(selector)
      expect(source).toContain('background: rgba(')
      expect(source).toContain('backdrop-filter: blur(')
      expect(source).toContain('-webkit-backdrop-filter: blur(')
    }

    const radioChecked = block('input[type="radio"]:checked')
    const radioDarkChecked = block(':root:not([data-theme="light"]) input[type="radio"]:checked')
    const checkboxChecked = block('input[type="checkbox"]:checked')
    const checkboxDarkChecked = block(':root:not([data-theme="light"]) input[type="checkbox"]:checked')
    expect(backdropAlpha(block('.modal-backdrop'))).toBeLessThanOrEqual(0.18)
    expect(backdropAlpha(block('.settings-overlay-backdrop'))).toBeLessThanOrEqual(0.18)
    expect(backdropAlpha(block('.multi-server-dashboard-backdrop'))).toBeLessThanOrEqual(0.18)
    expect(backdropAlpha(block('.alert-center-backdrop'))).toBeLessThanOrEqual(0.18)
    expect(block('.modal-backdrop')).not.toContain('backdrop-filter')
    expect(block('.settings-overlay-backdrop')).not.toContain('backdrop-filter')
    expect(block('.multi-server-dashboard-backdrop')).not.toContain('backdrop-filter')
    expect(block('.alert-center-backdrop')).not.toContain('backdrop-filter')
    expect(radioChecked).toContain('background-image: radial-gradient')
    expect(radioChecked).toContain('background-color: var(--primary)')
    expect(radioDarkChecked).toContain('border-color: #9fc3ff')
    expect(radioDarkChecked).toContain('background-color: #3f7dff')
    expect(checkboxChecked).toContain('background-image: url("data:image/svg+xml')
    expect(checkboxChecked).toContain('background-color: var(--primary)')
    expect(checkboxDarkChecked).toContain('border-color: #9fc3ff')
    expect(checkboxDarkChecked).toContain('background-color: #3f7dff')
  })

  it('keeps workspace tab titles ellipsized and close clicks isolated', () => {
    const tab = block('.terminal-tab')
    const title = block('.terminal-tab-title')
    const close = block('.terminal-close')

    expect(workspaceTabsSource).toContain('@click.stop.prevent="closeTab(item)"')
    expect(workspaceTabsSource).toContain('@pointerdown.stop.prevent')
    expect(tab).toContain('display: inline-flex')
    expect(tab).toContain('width: fit-content')
    expect(title).toContain('text-overflow: ellipsis')
    expect(title).toContain('white-space: nowrap')
    expect(close).toContain('flex: 0 0 auto')
    expect(close).toContain('white-space: nowrap')
    expect(close).not.toContain('margin-left: auto')
  })

  it('keeps Settings state controls visible without changing save semantics', () => {
    const headerActions = block('.settings-header-actions')
    const headerButtons = block('.settings-header-actions button')
    const backupPreview = block('.backup-preview')
    const backupPreviewLabel = block('.backup-preview label')
    const nativeControlbar = block('.alert-native-controlbar')
    const nativeStatus = block('.alert-native-controlbar__status')

    expect(settingsBackupSource).toContain('data-testid="backup-import-options"')
    expect(settingsAlertSource).toContain('data-testid="alert-native-notifications"')
    expect(headerActions).toContain('flex-wrap: nowrap')
    expect(headerActions).toContain('overflow-x: auto')
    expect(headerButtons).toContain('white-space: nowrap')
    expect(backupPreview).toContain('display: grid')
    expect(backupPreviewLabel).toContain('align-items: center')
    expect(nativeControlbar).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(nativeStatus).toContain('justify-content: flex-end')
  })

  it('keeps transfer popover bounded with internal scrolling and no runtime backend dependency', () => {
    const popover = block('.transfer-popover')
    const list = block('.transfer-popover-list')
    const row = block('.transfer-popover-row')
    const rowName = block('.transfer-popover-row strong')

    expect(terminalWorkspaceSource).toContain('class="viewport-popover transfer-popover"')
    expect(popover).toContain('position: fixed')
    expect(popover).toContain('overflow: hidden')
    expect(popover).toContain('grid-template-rows: auto minmax(0, 1fr) auto')
    expect(list).toContain('overflow: auto')
    expect(row).toContain('display: grid')
    expect(rowName).toContain('text-overflow: ellipsis')
    expect(rowName).toContain('white-space: nowrap')
  })
})
