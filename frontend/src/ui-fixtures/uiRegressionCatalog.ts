export type UiRegressionSurfaceId =
  | 'server-picker-geometry'
  | 'split-pane-empty-state'
  | 'workspace-tabs-close'
  | 'settings-state-ui'
  | 'transfer-popover'
  | 'manager-dialogs'
  | 'sftp-future-risk'
  | 'connection-security-modal'

export type UiRegressionGuardKind = 'css-contract' | 'dom-behavior' | 'fixture-state' | 'catalog-only' | 'screenshot'

export interface UiRegressionGuard {
  kind: UiRegressionGuardKind
  target: string
  coverage: string[]
}

export interface UiRegressionSurface {
  id: UiRegressionSurfaceId
  surface: string
  historicalIssues: string[]
  fixtureIds: string[]
  guards: UiRegressionGuard[]
  productionBehaviorChange: false
}

export const uiRegressionSurfaceIds = [
  'server-picker-geometry',
  'split-pane-empty-state',
  'workspace-tabs-close',
  'settings-state-ui',
  'transfer-popover',
  'manager-dialogs',
  'sftp-future-risk',
  'connection-security-modal',
] as const satisfies readonly UiRegressionSurfaceId[]

export const uiRegressionCatalog: readonly UiRegressionSurface[] = [
  {
    id: 'server-picker-geometry',
    surface: 'ServerPicker geometry',
    historicalIssues: [
      'Long saved-server lists needed internal scrolling without moving the panel.',
      'A search with one matching server could clip the row or leave excessive bottom gap.',
      'Rows could visually indent after list scrolling when scrollbar contracts changed.',
    ],
    fixtureIds: [
      'server-picker.empty',
      'server-picker.one-server',
      'server-picker.many-servers',
      'server-picker.search-debian-one-result',
      'server-picker.search-no-result',
      'server-picker.narrow-width',
      'server-picker.long-list-internal-scroll',
    ],
    guards: [
      {
        kind: 'css-contract',
        target: 'frontend/src/style.tokens.test.ts',
        coverage: ['fixed popover layer', 'list-only scrolling', 'no stable both-edges row indent'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/ServerPicker.test.ts',
        coverage: ['search result visibility', 'wheel containment', 'actions remain visible'],
      },
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['empty', 'search', 'narrow', 'long list'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'split-pane-empty-state',
    surface: 'Split pane empty state',
    historicalIssues: [
      'Empty pane hint could be visually offset instead of centered.',
      'The pane action buttons could stack or overlap in compact split layouts.',
      'Active pane chrome could bias the empty state alignment.',
    ],
    fixtureIds: [
      'split-pane.single-empty',
      'split-pane.two-pane-empty',
      'split-pane.quad-empty',
      'split-pane.active-pane-empty',
      'split-pane.narrow-width',
    ],
    guards: [
      {
        kind: 'css-contract',
        target: 'frontend/src/style.tokens.test.ts',
        coverage: ['centered flex actions', 'single-row actions', 'no transform or negative-margin layout'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/TerminalEmptyPane.test.ts',
        coverage: ['three actions visible', 'single-mode empty actions', 'split modes unchanged'],
      },
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['single', 'two-pane', 'quad', 'active pane', 'narrow'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'workspace-tabs-close',
    surface: 'Workspace tabs and close control',
    historicalIssues: [
      'Close control spacing could leave too much or too little trailing gap.',
      'Long tab titles needed ellipsis without pushing the close control out.',
      'Clicking close must not activate, drag, or reorder a tab.',
    ],
    fixtureIds: [
      'tabs.short-title',
      'tabs.ip-port-title',
      'tabs.long-title',
      'tabs.dirty-error',
      'tabs.many-tabs',
      'tabs.close-x',
    ],
    guards: [
      {
        kind: 'css-contract',
        target: 'frontend/src/style.tokens.test.ts',
        coverage: ['fit-content tab sizing', 'title ellipsis', 'close gap and no margin hack'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/WorkspaceTabs.test.ts',
        coverage: ['close stopPropagation', 'keyboard navigation', 'scrollIntoView'],
      },
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['short title', 'IP title', 'long title', 'many tabs', 'close'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'settings-state-ui',
    surface: 'Settings state UI',
    historicalIssues: [
      'Backup import checkboxes could reset manually unchecked options after save and reopen.',
      'Settings action rows could wrap or hide controls in narrow layouts.',
      'Native notification settings needed disabled and unavailable states without changing internal alerts.',
    ],
    fixtureIds: [
      'settings.backup-import-five-options',
      'settings.saved-false',
      'settings.manual-uncheck',
      'settings.native-notification-toggle',
      'settings.native-notification-unavailable',
      'settings.narrow-width',
    ],
    guards: [
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/settings/SettingsBackupRestoreSection.test.ts',
        coverage: ['manual unchecked persistence', 'save state emit', 'import option count'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/SettingsView.test.ts',
        coverage: ['native notification toggle', 'unavailable state', 'version display'],
      },
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['backup options', 'saved false', 'manual uncheck', 'native notifications', 'narrow'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'transfer-popover',
    surface: 'Transfer and bottom overlay popover',
    historicalIssues: [
      'Transfer queue popover could cover the SSH terminal area instead of staying in bounds.',
      'Long transfer lists needed internal scrolling without moving the bottom overlay.',
      'Escape and outside-click behavior must close the popover without changing transfers.',
    ],
    fixtureIds: [
      'transfer.empty',
      'transfer.active-transfer',
      'transfer.failed-completed',
      'transfer.many-items',
      'transfer.narrow-width',
    ],
    guards: [
      {
        kind: 'css-contract',
        target: 'frontend/src/style.tokens.test.ts',
        coverage: ['fixed popover layer', 'internal list scroll', 'bounded width'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/TerminalWorkspace.test.ts',
        coverage: ['bounds clamp', 'outside-click', 'expanded SFTP bounds'],
      },
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['empty', 'active', 'failed', 'many items', 'narrow'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'manager-dialogs',
    surface: 'Manager dialogs',
    historicalIssues: [
      'Service Manager list, detail, and log areas needed independent scroll behavior.',
      'Dialog action states needed to remain visible in narrow layouts.',
      'Docker, Tunnel, Process, and Network manager dialogs contain dense toolbars, details, warnings, and long text that jsdom cannot verify geometrically.',
    ],
    fixtureIds: [
      'manager-dialogs.service-manager-journal-narrow',
      'manager-dialogs.service-manager-openwrt-logread',
      'manager-dialogs.service-manager-openwrt-logread-unavailable',
      'manager-dialogs.service-manager-openwrt-logread-long-lines',
      'manager-dialogs.docker-manager-container-list',
      'manager-dialogs.docker-manager-logs-stats-narrow',
      'manager-dialogs.docker-manager-batch-actions',
      'manager-dialogs.tunnel-manager-profile-list',
      'manager-dialogs.tunnel-manager-form-narrow',
      'manager-dialogs.process-manager-list-long-command',
      'manager-dialogs.process-manager-action-confirm',
      'manager-dialogs.network-diagnostics-summary',
    ],
    guards: [
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/ServiceManagerDialog.test.ts',
        coverage: ['list and detail states', 'action states', 'log area', 'OpenWrt logread source'],
      },
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['OpenWrt logread', 'Docker', 'Tunnel', 'Process', 'Network Diagnostics'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/e2e/manager-dialog-ui-regression.spec.ts',
        coverage: ['real-render geometry', 'internal scroll', 'bounded dialogs', 'action visibility'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'sftp-future-risk',
    surface: 'SFTP panel high-risk future area',
    historicalIssues: [
      'File list width, column resize, sort, and scroll behavior have had repeated UI regressions.',
      'Toolbar, context menu, remote editor, properties, and transfer entries are high-risk UI surfaces.',
    ],
    fixtureIds: ['sftp.catalog-only'],
    guards: [
      {
        kind: 'dom-behavior',
        target: 'frontend/src/components/SftpFileTable.test.ts',
        coverage: ['file table columns', 'wheel handling', 'resize hit area'],
      },
      {
        kind: 'catalog-only',
        target: 'frontend/src/ui-fixtures/uiRegressionCatalog.ts',
        coverage: ['future fixture candidate recorded without changing SFTP runtime'],
      },
    ],
    productionBehaviorChange: false,
  },
  {
    id: 'connection-security-modal',
    surface: 'Connection, security, modal, and form UI',
    historicalIssues: [
      'Connection and authentication dialogs combine long labels, validation states, credential status, and compact footer actions that jsdom cannot verify geometrically.',
      'Host-key trust, Key Vault, Alert Center, App Logs, and Command Palette surfaces contain dense modal/list layouts that can clip or overflow in narrow viewports.',
    ],
    fixtureIds: [
      'connection-security.connection-dialog-password',
      'connection-security.connection-dialog-keyvault',
      'connection-security.connection-dialog-advanced',
      'connection-security.auth-dialog-password-error',
      'connection-security.auth-dialog-key-passphrase',
      'connection-security.host-key-trust-changed',
      'connection-security.key-vault-list-empty-and-many',
      'connection-security.key-vault-edit-form',
      'connection-security.alert-center-list',
      'connection-security.monitor-alert-center-entry',
      'connection-security.dashboard-alert-center-layer',
      'connection-security.app-logs-long-lines',
      'connection-security.command-palette-search-disabled',
      'connection-security.command-palette-no-results',
    ],
    guards: [
      {
        kind: 'fixture-state',
        target: 'frontend/src/ui-fixtures/uiRegressionFixtures.ts',
        coverage: ['ConnectionDialog', 'AuthDialog', 'HostKeyTrust', 'Key Vault', 'Alert Center', 'Monitor alert entry', 'Dashboard alert layer', 'App Logs', 'CommandPalette'],
      },
      {
        kind: 'dom-behavior',
        target: 'frontend/e2e/connection-security-ui-regression.spec.ts',
        coverage: ['real-render geometry', 'internal scroll', 'bounded modal footers', 'long text containment', 'no document horizontal scroll'],
      },
    ],
    productionBehaviorChange: false,
  },
]
