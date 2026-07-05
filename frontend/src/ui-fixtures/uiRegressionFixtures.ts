export type UiRegressionFixtureSurfaceId =
  | 'server-picker-geometry'
  | 'split-pane-empty-state'
  | 'workspace-tabs-close'
  | 'settings-state-ui'
  | 'transfer-popover'
  | 'manager-dialogs'
  | 'sftp-real-render'
  | 'connection-security-modal'

export type UiRegressionAssertionType = 'css-contract' | 'dom-behavior' | 'state-matrix'

export interface UiRegressionViewport {
  width: number
  height: number
  paneWidth?: number
}

export interface UiRegressionFixture<TData = unknown> {
  id: string
  surface: UiRegressionFixtureSurfaceId
  state: string
  viewport: UiRegressionViewport
  assertionTypes: UiRegressionAssertionType[]
  data: TData
}

interface ServerPickerFixtureData {
  query: string
  selectedGroupId: string | null
  servers: Array<{
    id: number
    name: string
    host: string
    port: number
    groupId: string | null
    connected: boolean
  }>
}

interface SplitPaneFixtureData {
  splitMode: 'single' | 'vertical' | 'horizontal' | 'quad'
  activePaneId: string
  panes: Array<{
    id: string
    assigned: boolean
  }>
}

interface WorkspaceTabFixtureData {
  activeTabId: string
  tabs: Array<{
    id: string
    title: string
    status: 'connected' | 'dirty' | 'error'
    closable: boolean
  }>
}

interface SettingsFixtureData {
  importOptions?: Array<{
    id: string
    checked: boolean
  }>
  saved: boolean
  nativeNotifications?: {
    enabled: boolean
    available: boolean
  }
}

interface TransferFixtureData {
  items: Array<{
    id: string
    name: string
    direction: 'upload' | 'download'
    status: 'active' | 'completed' | 'failed'
    percent: number
  }>
}

interface ServiceManagerFixtureData {
  initSystem?: 'systemd' | 'openwrt-procd'
  journalSourceText?: string
  journalRefreshSupported?: boolean
  journalFollowSupported?: boolean
  journalFollowDisabledReason?: string
  services: Array<{
    id: string
    name: string
    description: string
    status: 'running' | 'failed' | 'stopped'
  }>
  selectedServiceId: string
  lines: Array<{
    id: string
    level: 'info' | 'warning' | 'error'
    message: string
  }>
}

export interface SftpFixtureEntry {
  name: string
  path: string
  parentPath: string
  size: number
  isDir: boolean
  isSymlink: boolean
  permissions: string
  owner: string
  group: string
  modTime: string
}

interface SftpTransferFixtureItem {
  id: string
  name: string
  direction: 'upload' | 'download'
  status: 'active' | 'completed' | 'failed'
  percent: number
}

export interface SftpFixtureData {
  path: string
  entries: SftpFixtureEntry[]
  selectedPaths: string[]
  status: 'online' | 'empty' | 'loading-error'
  narrow?: boolean
  contextMenu?: boolean
  loading?: boolean
  error?: string
  transfers?: SftpTransferFixtureItem[]
}

interface ConnectionSecurityFixtureData {
  variant: string
}

export const uiRegressionFixtureSurfaceIds = [
  'server-picker-geometry',
  'split-pane-empty-state',
  'workspace-tabs-close',
  'settings-state-ui',
  'transfer-popover',
  'manager-dialogs',
  'sftp-real-render',
  'connection-security-modal',
] as const satisfies readonly UiRegressionFixtureSurfaceId[]

const standardViewport = { width: 1366, height: 768 } as const
const narrowViewport = { width: 800, height: 600, paneWidth: 280 } as const

function server(id: number, name: string, connected = false) {
  return {
    id,
    name,
    host: `fixture-${id}.example.invalid`,
    port: 22,
    groupId: id % 2 === 0 ? 'group-linux' : null,
    connected,
  }
}

const manyServers = Array.from({ length: 48 }, (_, index) => server(index + 1, `fixture-server-${index + 1}`))
const sftpStandardEntries: SftpFixtureEntry[] = [
  sftpEntry('config', true, 0, 'drwxr-xr-x', 'root', 'root'),
  sftpEntry('logs', true, 0, 'drwxr-x---', 'app', 'adm'),
  sftpEntry('public', true, 0, 'drwxr-xr-x', 'deploy', 'deploy'),
  sftpEntry('app.service', false, 1680, '-rw-r--r--', 'root', 'root'),
  sftpEntry('deploy.sh', false, 3200, '-rwxr-xr-x', 'deploy', 'deploy'),
  sftpEntry('release.tar.gz', false, 42_991_616, '-rw-r--r--', 'deploy', 'deploy'),
  sftpEntry('current', false, 0, 'lrwxrwxrwx', 'deploy', 'deploy', true),
  sftpEntry('README.md', false, 4096, '-rw-r--r--', 'deploy', 'deploy'),
  sftpEntry('metrics.json', false, 8192, '-rw-r-----', 'app', 'app'),
  sftpEntry('archive-2026-07.zip', false, 16_777_216, '-rw-r--r--', 'backup', 'backup'),
  sftpEntry('tmp', true, 0, 'drwxrwxrwt', 'root', 'root'),
  sftpEntry('web.conf', false, 2048, '-rw-r--r--', 'root', 'root'),
]
const sftpLongNameEntries = [
  sftpEntry('this-is-a-very-long-configuration-file-name-that-must-ellipsis-without-moving-actions.conf', false, 4096, '-rw-r-----', 'long-owner-name', 'long-group-name'),
  sftpEntry('another-extremely-long-directory-name-used-for-real-render-overflow-protection', true, 0, 'drwxr-xr-x', 'deploy-user-with-long-name', 'service-group-with-long-name'),
  sftpEntry('artifact-with-long-build-id-20260703-abcdef1234567890abcdef1234567890.tar.gz', false, 88_555_520, '-rw-r--r--', 'buildbot', 'artifacts'),
  sftpEntry('symlink-to-a-very-long-target-name-that-should-not-expand-the-row', false, 0, 'lrwxrwxrwx', 'deploy', 'deploy', true),
]
const backupImportOptions = [
  'servers',
  'groups',
  'settings',
  'command-history',
  'key-vault-metadata',
].map((id) => ({ id, checked: true }))

function sftpEntry(
  name: string,
  isDir: boolean,
  size: number,
  permissions: string,
  owner: string,
  group: string,
  isSymlink = false,
): SftpFixtureEntry {
  return {
    name,
    path: `/var/www/fixture/${name}`,
    parentPath: '/var/www/fixture',
    size,
    isDir,
    isSymlink,
    permissions,
    owner,
    group,
    modTime: '2026-07-03 10:00',
  }
}

export const uiRegressionFixtures: readonly UiRegressionFixture[] = [
  {
    id: 'server-picker.empty',
    surface: 'server-picker-geometry',
    state: 'empty',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { query: '', selectedGroupId: null, servers: [] } satisfies ServerPickerFixtureData,
  },
  {
    id: 'server-picker.one-server',
    surface: 'server-picker-geometry',
    state: 'one-server',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { query: '', selectedGroupId: null, servers: [server(1, 'debian-fixture', true)] } satisfies ServerPickerFixtureData,
  },
  {
    id: 'server-picker.many-servers',
    surface: 'server-picker-geometry',
    state: 'many-servers',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { query: '', selectedGroupId: null, servers: manyServers } satisfies ServerPickerFixtureData,
  },
  {
    id: 'server-picker.search-debian-one-result',
    surface: 'server-picker-geometry',
    state: 'search-debian-one-result',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { query: 'debian', selectedGroupId: null, servers: [server(101, 'debian-fixture')] } satisfies ServerPickerFixtureData,
  },
  {
    id: 'server-picker.search-no-result',
    surface: 'server-picker-geometry',
    state: 'search-no-result',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { query: 'missing', selectedGroupId: null, servers: [] } satisfies ServerPickerFixtureData,
  },
  {
    id: 'server-picker.narrow-width',
    surface: 'server-picker-geometry',
    state: 'narrow-width',
    viewport: narrowViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { query: '', selectedGroupId: 'group-linux', servers: manyServers.slice(0, 8) } satisfies ServerPickerFixtureData,
  },
  {
    id: 'server-picker.long-list-internal-scroll',
    surface: 'server-picker-geometry',
    state: 'long-list-internal-scroll',
    viewport: { width: 1024, height: 768 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { query: '', selectedGroupId: null, servers: manyServers } satisfies ServerPickerFixtureData,
  },
  {
    id: 'split-pane.single-empty',
    surface: 'split-pane-empty-state',
    state: 'single-empty',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { splitMode: 'single', activePaneId: 'pane-1', panes: [{ id: 'pane-1', assigned: false }] } satisfies SplitPaneFixtureData,
  },
  {
    id: 'split-pane.two-pane-empty',
    surface: 'split-pane-empty-state',
    state: 'two-pane-empty',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      splitMode: 'vertical',
      activePaneId: 'pane-1',
      panes: [{ id: 'pane-1', assigned: false }, { id: 'pane-2', assigned: false }],
    } satisfies SplitPaneFixtureData,
  },
  {
    id: 'split-pane.quad-empty',
    surface: 'split-pane-empty-state',
    state: 'quad-empty',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      splitMode: 'quad',
      activePaneId: 'pane-1',
      panes: ['pane-1', 'pane-2', 'pane-3', 'pane-4'].map((id) => ({ id, assigned: false })),
    } satisfies SplitPaneFixtureData,
  },
  {
    id: 'split-pane.active-pane-empty',
    surface: 'split-pane-empty-state',
    state: 'active-pane-empty',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      splitMode: 'horizontal',
      activePaneId: 'pane-2',
      panes: [{ id: 'pane-1', assigned: true }, { id: 'pane-2', assigned: false }],
    } satisfies SplitPaneFixtureData,
  },
  {
    id: 'split-pane.narrow-width',
    surface: 'split-pane-empty-state',
    state: 'narrow-width',
    viewport: narrowViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      splitMode: 'quad',
      activePaneId: 'pane-3',
      panes: ['pane-1', 'pane-2', 'pane-3', 'pane-4'].map((id) => ({ id, assigned: id === 'pane-1' })),
    } satisfies SplitPaneFixtureData,
  },
  {
    id: 'tabs.short-title',
    surface: 'workspace-tabs-close',
    state: 'short-title',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: 'debian', status: 'connected', closable: true }] } satisfies WorkspaceTabFixtureData,
  },
  {
    id: 'tabs.ip-port-title',
    surface: 'workspace-tabs-close',
    state: 'ip-port-title',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: '192.0.2.10:22', status: 'connected', closable: true }] } satisfies WorkspaceTabFixtureData,
  },
  {
    id: 'tabs.long-title',
    surface: 'workspace-tabs-close',
    state: 'long-title',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', title: 'very-long-fixture-server-name-for-ellipsis.example.invalid', status: 'connected', closable: true }],
    } satisfies WorkspaceTabFixtureData,
  },
  {
    id: 'tabs.dirty-error',
    surface: 'workspace-tabs-close',
    state: 'dirty-error',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: {
      activeTabId: 'tab-2',
      tabs: [
        { id: 'tab-1', title: 'saved-state', status: 'dirty', closable: true },
        { id: 'tab-2', title: 'error-state', status: 'error', closable: true },
      ],
    } satisfies WorkspaceTabFixtureData,
  },
  {
    id: 'tabs.many-tabs',
    surface: 'workspace-tabs-close',
    state: 'many-tabs',
    viewport: { width: 1024, height: 768 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      activeTabId: 'tab-8',
      tabs: Array.from({ length: 12 }, (_, index) => ({
        id: `tab-${index + 1}`,
        title: `server-${index + 1}`,
        status: 'connected' as const,
        closable: true,
      })),
    } satisfies WorkspaceTabFixtureData,
  },
  {
    id: 'tabs.close-x',
    surface: 'workspace-tabs-close',
    state: 'close-x',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: 'close-target', status: 'connected', closable: true }] } satisfies WorkspaceTabFixtureData,
  },
  {
    id: 'settings.backup-import-five-options',
    surface: 'settings-state-ui',
    state: 'backup-import-five-options',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { importOptions: backupImportOptions, saved: true } satisfies SettingsFixtureData,
  },
  {
    id: 'settings.saved-false',
    surface: 'settings-state-ui',
    state: 'saved-false',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { importOptions: backupImportOptions, saved: false } satisfies SettingsFixtureData,
  },
  {
    id: 'settings.manual-uncheck',
    surface: 'settings-state-ui',
    state: 'manual-uncheck',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: {
      importOptions: backupImportOptions.map((option) => ({
        ...option,
        checked: option.id !== 'command-history' && option.id !== 'key-vault-metadata',
      })),
      saved: false,
    } satisfies SettingsFixtureData,
  },
  {
    id: 'settings.native-notification-toggle',
    surface: 'settings-state-ui',
    state: 'native-notification-toggle',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { saved: true, nativeNotifications: { enabled: true, available: true } } satisfies SettingsFixtureData,
  },
  {
    id: 'settings.native-notification-unavailable',
    surface: 'settings-state-ui',
    state: 'native-notification-unavailable',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { saved: true, nativeNotifications: { enabled: false, available: false } } satisfies SettingsFixtureData,
  },
  {
    id: 'settings.narrow-width',
    surface: 'settings-state-ui',
    state: 'narrow-width',
    viewport: narrowViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { importOptions: backupImportOptions, saved: true, nativeNotifications: { enabled: false, available: true } } satisfies SettingsFixtureData,
  },
  {
    id: 'transfer.empty',
    surface: 'transfer-popover',
    state: 'empty',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: { items: [] } satisfies TransferFixtureData,
  },
  {
    id: 'transfer.active-transfer',
    surface: 'transfer-popover',
    state: 'active-transfer',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { items: [{ id: 'transfer-1', name: 'artifact-01.bin', direction: 'download', status: 'active', percent: 42 }] } satisfies TransferFixtureData,
  },
  {
    id: 'transfer.failed-completed',
    surface: 'transfer-popover',
    state: 'failed-completed',
    viewport: standardViewport,
    assertionTypes: ['dom-behavior', 'state-matrix'],
    data: {
      items: [
        { id: 'transfer-1', name: 'artifact-ok.bin', direction: 'upload', status: 'completed', percent: 100 },
        { id: 'transfer-2', name: 'artifact-failed.bin', direction: 'download', status: 'failed', percent: 17 },
      ],
    } satisfies TransferFixtureData,
  },
  {
    id: 'transfer.many-items',
    surface: 'transfer-popover',
    state: 'many-items',
    viewport: { width: 1024, height: 768 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `transfer-${index + 1}`,
        name: `artifact-${index + 1}.bin`,
        direction: index % 2 === 0 ? 'upload' : 'download',
        status: index % 3 === 0 ? 'completed' : 'active',
        percent: index % 3 === 0 ? 100 : 35,
      })),
    } satisfies TransferFixtureData,
  },
  {
    id: 'transfer.narrow-width',
    surface: 'transfer-popover',
    state: 'narrow-width',
    viewport: narrowViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { items: [{ id: 'transfer-1', name: 'narrow-artifact.bin', direction: 'upload', status: 'active', percent: 64 }] } satisfies TransferFixtureData,
  },
  {
    id: 'manager-dialogs.service-manager-journal-narrow',
    surface: 'manager-dialogs',
    state: 'service-manager-journal-narrow',
    viewport: narrowViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      services: [
        { id: 'service-a', name: 'fixture-daemon.service', description: 'Synthetic daemon fixture', status: 'running' },
        { id: 'service-b', name: 'fixture-worker.service', description: 'Synthetic worker fixture with long text', status: 'failed' },
        { id: 'service-c', name: 'fixture-timer.timer', description: 'Synthetic timer fixture', status: 'stopped' },
      ],
      selectedServiceId: 'service-b',
      lines: Array.from({ length: 18 }, (_, index) => ({
        id: `line-${index + 1}`,
        level: index % 7 === 0 ? 'warning' : index % 11 === 0 ? 'error' : 'info',
        message: `Synthetic service event ${index + 1} for layout regression checks`,
      })),
    } satisfies ServiceManagerFixtureData,
  },
  {
    id: 'manager-dialogs.service-manager-openwrt-logread',
    surface: 'manager-dialogs',
    state: 'service-manager-openwrt-logread',
    viewport: { width: 900, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      initSystem: 'openwrt-procd',
      journalSourceText: 'OpenWrt logread',
      journalRefreshSupported: true,
      journalFollowSupported: false,
      journalFollowDisabledReason: 'OpenWrt logread supports refresh snapshots only; realtime follow is not supported.',
      services: [
        { id: 'dropbear', name: 'dropbear', description: 'Synthetic OpenWrt SSH service', status: 'running' },
        { id: 'dnsmasq', name: 'dnsmasq', description: 'Synthetic OpenWrt DNS service', status: 'running' },
        { id: 'uhttpd', name: 'uhttpd', description: 'Synthetic OpenWrt web service', status: 'stopped' },
      ],
      selectedServiceId: 'dropbear',
      lines: Array.from({ length: 24 }, (_, index) => ({
        id: `openwrt-line-${index + 1}`,
        level: index % 9 === 0 ? 'warning' : index % 13 === 0 ? 'error' : 'info',
        message: `Synthetic OpenWrt logread event ${index + 1} for dropbear layout checks`,
      })),
    } satisfies ServiceManagerFixtureData,
  },
  {
    id: 'manager-dialogs.service-manager-openwrt-logread-unavailable',
    surface: 'manager-dialogs',
    state: 'service-manager-openwrt-logread-unavailable',
    viewport: { width: 820, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      initSystem: 'openwrt-procd',
      journalSourceText: 'OpenWrt logread',
      journalRefreshSupported: false,
      journalFollowSupported: false,
      journalFollowDisabledReason: 'OpenWrt logread is not available on this server.',
      services: [
        { id: 'dropbear', name: 'dropbear', description: 'Synthetic OpenWrt SSH service', status: 'running' },
      ],
      selectedServiceId: 'dropbear',
      lines: [],
    } satisfies ServiceManagerFixtureData,
  },
  {
    id: 'manager-dialogs.service-manager-openwrt-logread-long-lines',
    surface: 'manager-dialogs',
    state: 'service-manager-openwrt-logread-long-lines',
    viewport: { width: 820, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      initSystem: 'openwrt-procd',
      journalSourceText: 'OpenWrt logread',
      journalRefreshSupported: true,
      journalFollowSupported: false,
      journalFollowDisabledReason: 'OpenWrt logread supports refresh snapshots only; realtime follow is not supported.',
      services: [
        { id: 'dropbear', name: 'dropbear', description: 'Synthetic OpenWrt SSH service', status: 'running' },
      ],
      selectedServiceId: 'dropbear',
      lines: Array.from({ length: 12 }, (_, index) => ({
        id: `openwrt-long-${index + 1}`,
        level: 'info',
        message: `Synthetic OpenWrt logread long line ${index + 1} ${'segment-'.repeat(40)}`,
      })),
    } satisfies ServiceManagerFixtureData,
  },
  {
    id: 'manager-dialogs.docker-manager-container-list',
    surface: 'manager-dialogs',
    state: 'docker-manager-container-list',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'docker', variant: 'container-list' },
  },
  {
    id: 'manager-dialogs.docker-manager-logs-stats-narrow',
    surface: 'manager-dialogs',
    state: 'docker-manager-logs-stats-narrow',
    viewport: { width: 820, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'docker', variant: 'logs-stats-narrow' },
  },
  {
    id: 'manager-dialogs.docker-manager-batch-actions',
    surface: 'manager-dialogs',
    state: 'docker-manager-batch-actions',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'docker', variant: 'batch-actions' },
  },
  {
    id: 'manager-dialogs.docker-manager-compose-supported',
    surface: 'manager-dialogs',
    state: 'docker-manager-compose-supported',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'docker', variant: 'compose-supported' },
  },
  {
    id: 'manager-dialogs.docker-manager-compose-unavailable',
    surface: 'manager-dialogs',
    state: 'docker-manager-compose-unavailable',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'docker', variant: 'compose-unavailable' },
  },
  {
    id: 'manager-dialogs.docker-manager-compose-narrow',
    surface: 'manager-dialogs',
    state: 'docker-manager-compose-narrow',
    viewport: { width: 760, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'docker', variant: 'compose-narrow' },
  },
  {
    id: 'manager-dialogs.tunnel-manager-profile-list',
    surface: 'manager-dialogs',
    state: 'tunnel-manager-profile-list',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'tunnel', variant: 'profile-list' },
  },
  {
    id: 'manager-dialogs.tunnel-manager-form-narrow',
    surface: 'manager-dialogs',
    state: 'tunnel-manager-form-narrow',
    viewport: { width: 760, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'tunnel', variant: 'form-narrow' },
  },
  {
    id: 'manager-dialogs.process-manager-list-long-command',
    surface: 'manager-dialogs',
    state: 'process-manager-list-long-command',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'process', variant: 'long-command' },
  },
  {
    id: 'manager-dialogs.process-manager-action-confirm',
    surface: 'manager-dialogs',
    state: 'process-manager-action-confirm',
    viewport: { width: 900, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'process', variant: 'action-confirm' },
  },
  {
    id: 'manager-dialogs.network-diagnostics-summary',
    surface: 'manager-dialogs',
    state: 'network-diagnostics-summary',
    viewport: { width: 820, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { manager: 'network', variant: 'diagnostics-summary' },
  },
  {
    id: 'sftp.file-list-standard',
    surface: 'sftp-real-render',
    state: 'file-list-standard',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture',
      entries: sftpStandardEntries,
      selectedPaths: ['/var/www/fixture/deploy.sh'],
      status: 'online',
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.file-list-long-names',
    surface: 'sftp-real-render',
    state: 'file-list-long-names',
    viewport: { width: 1024, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture/releases/2026/07/very-long-remote-path-segment-for-layout-checks',
      entries: sftpLongNameEntries,
      selectedPaths: [sftpLongNameEntries[0].path],
      status: 'online',
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.toolbar-narrow',
    surface: 'sftp-real-render',
    state: 'toolbar-narrow',
    viewport: { width: 760, height: 600, paneWidth: 320 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture/narrow',
      entries: sftpStandardEntries.slice(0, 6),
      selectedPaths: [],
      status: 'online',
      narrow: true,
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.context-menu-edge',
    surface: 'sftp-real-render',
    state: 'context-menu-edge',
    viewport: { width: 820, height: 620, paneWidth: 360 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture',
      entries: sftpStandardEntries.slice(0, 8),
      selectedPaths: ['/var/www/fixture/app.service'],
      status: 'online',
      contextMenu: true,
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.empty-directory',
    surface: 'sftp-real-render',
    state: 'empty-directory',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture/empty',
      entries: [],
      selectedPaths: [],
      status: 'empty',
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.loading-error',
    surface: 'sftp-real-render',
    state: 'loading-error',
    viewport: { width: 820, height: 620, paneWidth: 360 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture/error',
      entries: [],
      selectedPaths: [],
      status: 'loading-error',
      loading: true,
      error: 'Synthetic directory refresh failed',
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.selection-actions',
    surface: 'sftp-real-render',
    state: 'selection-actions',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture',
      entries: sftpStandardEntries,
      selectedPaths: ['/var/www/fixture/deploy.sh', '/var/www/fixture/release.tar.gz', '/var/www/fixture/README.md'],
      status: 'online',
    } satisfies SftpFixtureData,
  },
  {
    id: 'sftp.transfer-entry',
    surface: 'sftp-real-render',
    state: 'transfer-entry',
    viewport: standardViewport,
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: {
      path: '/var/www/fixture',
      entries: sftpStandardEntries.slice(0, 8),
      selectedPaths: [],
      status: 'online',
      transfers: [
        { id: 'sftp-transfer-1', name: 'release.tar.gz', direction: 'upload', status: 'active', percent: 67 },
        { id: 'sftp-transfer-2', name: 'archive-2026-07.zip', direction: 'download', status: 'completed', percent: 100 },
        { id: 'sftp-transfer-3', name: 'failed-artifact.bin', direction: 'upload', status: 'failed', percent: 18 },
      ],
    } satisfies SftpFixtureData,
  },
  {
    id: 'connection-security.connection-dialog-password',
    surface: 'connection-security-modal',
    state: 'connection-dialog-password',
    viewport: { width: 560, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'credential-entry' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.connection-dialog-keyvault',
    surface: 'connection-security-modal',
    state: 'connection-dialog-keyvault',
    viewport: { width: 720, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'vault-entry' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.connection-dialog-advanced',
    surface: 'connection-security-modal',
    state: 'connection-dialog-advanced',
    viewport: { width: 600, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'advanced-route' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.auth-dialog-password-error',
    surface: 'connection-security-modal',
    state: 'auth-dialog-password-error',
    viewport: { width: 520, height: 520 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'auth-error' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.auth-dialog-key-passphrase',
    surface: 'connection-security-modal',
    state: 'auth-dialog-key-passphrase',
    viewport: { width: 520, height: 520 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'key-auth' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.host-key-trust-changed',
    surface: 'connection-security-modal',
    state: 'host-key-trust-changed',
    viewport: { width: 640, height: 560 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'host-trust' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.key-vault-list-empty-and-many',
    surface: 'connection-security-modal',
    state: 'key-vault-list-empty-and-many',
    viewport: { width: 900, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'vault-list' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.key-vault-edit-form',
    surface: 'connection-security-modal',
    state: 'key-vault-edit-form',
    viewport: { width: 680, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'vault-form' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.alert-center-list',
    surface: 'connection-security-modal',
    state: 'alert-center-list',
    viewport: { width: 760, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'alert-list' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.monitor-alert-center-entry',
    surface: 'connection-security-modal',
    state: 'monitor-alert-center-entry',
    viewport: { width: 980, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'monitor-alert-entry' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.dashboard-alert-center-layer',
    surface: 'connection-security-modal',
    state: 'dashboard-alert-center-layer',
    viewport: { width: 980, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'dashboard-alert-layer' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.app-logs-long-lines',
    surface: 'connection-security-modal',
    state: 'app-logs-long-lines',
    viewport: { width: 980, height: 640 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'app-log-list' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.command-palette-search-disabled',
    surface: 'connection-security-modal',
    state: 'command-palette-search-disabled',
    viewport: { width: 760, height: 620 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'command-disabled' } satisfies ConnectionSecurityFixtureData,
  },
  {
    id: 'connection-security.command-palette-no-results',
    surface: 'connection-security-modal',
    state: 'command-palette-no-results',
    viewport: { width: 560, height: 520 },
    assertionTypes: ['css-contract', 'dom-behavior', 'state-matrix'],
    data: { variant: 'command-empty' } satisfies ConnectionSecurityFixtureData,
  },
]

export function getUiRegressionFixturesBySurface(surface: UiRegressionFixtureSurfaceId) {
  return uiRegressionFixtures.filter((fixture) => fixture.surface === surface)
}
