// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.vue'
import type { AppSettings, Connection, KeyVaultEntry, LocalTerminalCapabilities, ShortcutConflictCheckResponse, TerminalProfile } from '../types'
import { choiceDialog, confirmDialog } from '../composables/useAppDialog'
import { registerTerminalInstance, unregisterTerminalInstance } from '../utils/terminalInstanceRegistry'
import { defaultAlertSettings } from '../utils/alertSettings'
import { defaultShortcutSettings } from '../utils/shortcutSettings'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: string, encoding: string) => string }
// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { cwd } = await import('node:process') as { cwd: () => string }
const appCss = readFileSync(`${cwd()}/src/style.css`, 'utf8')

function cssBlock(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = appCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`Missing CSS block: ${selector}`)
  return match[1]
}

const apiMock = vi.hoisted(() => ({
  listKeyVaultEntries: vi.fn<() => Promise<KeyVaultEntry[]>>(() => Promise.resolve([])),
  selectPrivateKeyFile: vi.fn(() => Promise.resolve('/home/user/.ssh/id_ed25519')),
  validatePrivateKeyFile: vi.fn(() => Promise.resolve({
    algorithm: 'ssh-ed25519',
    fingerprintSHA256: 'SHA256:test',
    encrypted: true,
    valid: true,
    errorCode: '',
    userMessage: '',
    technicalMessage: '',
  })),
  createKeyVaultEntry: vi.fn(() => Promise.resolve({
    id: 1,
    name: 'id_ed25519',
    privateKeyPath: '',
    storageMode: 'encrypted_database',
    sourceFileName: 'id_ed25519',
    algorithm: 'ssh-ed25519',
    keyBits: 256,
    publicKeyFingerprintSHA256: 'SHA256:test',
    encrypted: true,
    requiresPassphrase: true,
    protectionVersion: 1,
    passphraseSaved: true,
    usageCount: 0,
    notes: '',
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
  })),
  updateKeyVaultEntry: vi.fn(),
  migrateLegacyPrivateKey: vi.fn(),
  deleteKeyVaultEntry: vi.fn(),
  deleteKeyVaultPassphrase: vi.fn(),
  getLocalTerminalCapabilities: vi.fn(() => Promise.resolve({
    platform: 'windows',
    enabled: false,
    supported: false,
    conptyAvailable: false,
    isProcessElevated: false,
    supportsElevation: true,
    shellOptions: [] as Array<{ id: string; label: string; description: string }>,
    adminShellOptions: [] as Array<{ id: string; label: string; description: string }>,
    defaultShellPreference: 'auto',
    currentShellPreference: 'auto',
    unsupportedMessage: 'LOCAL_TERMINAL_DISABLED: 本地终端暂未启用',
  })),
  selectBackupExportPath: vi.fn(() => Promise.resolve('C:/tmp/serverpilot.spbackup')),
  selectBackupImportFile: vi.fn(() => Promise.resolve('C:/tmp/serverpilot.spbackup')),
  exportBackup: vi.fn(() => Promise.resolve({
    path: 'C:/tmp/serverpilot.spbackup',
    createdAt: '2026-06-17T00:00:00Z',
    mode: 'standard',
    groups: 1,
    connections: 2,
    keyVaultEntries: 1,
    hostTrustRecords: 1,
    secretEntries: 0,
    encryptedFileSize: 1024,
  })),
  importBackup: vi.fn(() => Promise.resolve({
    groupsAdded: 1,
    connectionsAdded: 2,
    keyVaultAdded: 1,
    hostTrustImported: 0,
    secretsRestored: 0,
    skipped: 0,
    renamed: 0,
    warnings: [],
    credentialsNotice: '凭据不会导入',
  })),
  listTerminalProfiles: vi.fn(() => Promise.resolve([{
    id: 'default',
    name: '默认',
    fontFamily: 'Consolas, Cascadia Mono, monospace',
    fontSize: 15,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    themeName: 'serverpilot-dark',
    foreground: '#eceff4',
    background: '#1f2023',
    selectionBackground: '#5b8cff66',
    cursorColor: '#f5f7fa',
    createdAt: '',
    updatedAt: '',
  }])),
  createTerminalProfile: vi.fn((request) => Promise.resolve({
    ...request,
    id: 'tp-new',
    createdAt: '',
    updatedAt: '',
  })),
  updateTerminalProfile: vi.fn((request) => Promise.resolve({
    ...request,
    createdAt: '',
    updatedAt: '',
  })),
  duplicateTerminalProfile: vi.fn(() => Promise.resolve({
    id: 'tp-copy',
    name: '默认 副本',
    fontFamily: 'Consolas',
    fontSize: 16,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    themeName: 'serverpilot-dark',
    foreground: '#eceff4',
    background: '#1f2023',
    selectionBackground: '#5b8cff66',
    cursorColor: '#f5f7fa',
    createdAt: '',
    updatedAt: '',
  })),
  deleteTerminalProfile: vi.fn((request: { id: string; forceDetachServers: boolean }) => Promise.resolve({
    id: request.id,
    detachedServers: request.forceDetachServers ? 1 : 0,
  })),
  setDefaultTerminalProfile: vi.fn(() => Promise.resolve({
    defaultTerminalProfileId: 'tp-copy',
  })),
  appVersion: vi.fn(() => Promise.resolve({
    version: '0.5.0-beta.28',
  })),
  defaultSettings: vi.fn(() => Promise.resolve({})),
  checkShortcutConflicts: vi.fn((): Promise<ShortcutConflictCheckResponse> => Promise.resolve({ entries: [] })),
}))

vi.mock('../api/backend', () => ({ api: apiMock }))
vi.mock('../composables/useAppDialog', () => ({
  choiceDialog: vi.fn(() => Promise.resolve('cancel')),
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}))

const consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => undefined)

const settings: AppSettings = {
  defaultRememberPassword: false,
  defaultRememberPassphrase: true,
  terminalCopyOnSelectEnabled: true,
  terminalRightClickPasteEnabled: true,
  shortcutSettings: defaultShortcutSettings(),
  hostKeyPolicy: 'auto_update',
  themeMode: 'dark',
  uiFontSize: 'large',
  localTerminalShellPreference: 'auto',
  localTerminalElevatedEnabled: false,
  defaultTerminalProfileId: 'default',
  commandHistoryMaxEntries: 2000,
  sshKeepaliveEnabled: true,
  sshKeepaliveIntervalSeconds: 30,
  sshKeepaliveTimeoutSeconds: 10,
  sshKeepaliveMaxFailures: 3,
  connectionTimeoutSeconds: 15,
  dashboardSortMode: 'manual',
  dashboardManualServerOrder: [],
  alerts: defaultAlertSettings(),
  backupImportOptions: {
    importSettings: true,
    importGroups: true,
    importServers: true,
    importKeyVault: true,
    importHostTrust: true,
  },
  windowWidth: 1360,
  windowHeight: 1500,
  windowMaximized: false,
  settingsVersion: 13,
  onboardingCompleted: false,
  trustOnFirstUseAcknowledged: false,
}

async function flushSettingsView() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}

function connectionWithProfile(id: string): Connection {
  return {
    id: 99,
    groupId: null,
    name: 'profile-user',
    host: '192.0.2.99',
    port: 22,
    username: 'root',
    authType: 'password',
    privateKeySource: 'local_file',
    privateKeyPath: '',
    keyVaultId: null,
    terminalProfileId: id,
    hostKeyFingerprint: '',
    credentialSaved: false,
    refreshInterval: 2,
    createdAt: '',
    updatedAt: '',
  }
}

function terminalProfile(id: string, name: string): TerminalProfile {
  return {
    id,
    name,
    fontFamily: 'Consolas, monospace',
    fontSize: 15,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    themeName: 'serverpilot-dark',
    foreground: '#eceff4',
    background: '#1f2023',
    selectionBackground: '#5b8cff66',
    cursorColor: '#f5f7fa',
    createdAt: '',
    updatedAt: '',
  }
}

function localTerminalCapabilities(overrides: Partial<LocalTerminalCapabilities> = {}): LocalTerminalCapabilities {
  return {
    platform: 'windows',
    enabled: false,
    supported: false,
    conptyAvailable: false,
    isProcessElevated: false,
    supportsElevation: true,
    shellOptions: [] as Array<{ id: string; label: string; description: string }>,
    adminShellOptions: [] as Array<{ id: string; label: string; description: string }>,
    defaultShellPreference: 'auto',
    currentShellPreference: 'auto',
    unsupportedMessage: 'LOCAL_TERMINAL_DISABLED: 本地终端暂未启用',
    ...overrides,
  }
}

function darwinLocalTerminalCapabilities(overrides: Partial<LocalTerminalCapabilities> = {}): LocalTerminalCapabilities {
  return localTerminalCapabilities({
    platform: 'darwin',
    enabled: true,
    supported: true,
    supportsElevation: false,
    shellOptions: [{ id: 'local', label: '本地终端', description: '$SHELL' }],
    defaultShellPreference: 'local',
    currentShellPreference: 'local',
    unsupportedMessage: '',
    ...overrides,
  })
}

function keyVaultEntry(overrides: Partial<KeyVaultEntry> = {}): KeyVaultEntry {
  return {
    id: 9,
    name: 'shared-key',
    privateKeyPath: '',
    storageMode: 'encrypted_database',
    sourceFileName: 'id_ed25519',
    algorithm: 'ssh-ed25519',
    keyBits: 256,
    publicKeyFingerprintSHA256: 'SHA256:shared',
    encrypted: true,
    requiresPassphrase: true,
    protectionVersion: 1,
    passphraseSaved: false,
    usageCount: 0,
    notes: '',
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
    ...overrides,
  }
}

describe('connection settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    apiMock.listKeyVaultEntries.mockResolvedValue([])
    apiMock.getLocalTerminalCapabilities.mockResolvedValue(localTerminalCapabilities())
    apiMock.selectBackupExportPath.mockResolvedValue('C:/tmp/serverpilot.spbackup')
    apiMock.selectBackupImportFile.mockResolvedValue('C:/tmp/serverpilot.spbackup')
    apiMock.createTerminalProfile.mockImplementation((request) => Promise.resolve({
      ...request,
      id: 'tp-new',
      createdAt: '',
      updatedAt: '',
    }))
    apiMock.deleteTerminalProfile.mockImplementation((request: { id: string; forceDetachServers: boolean }) => Promise.resolve({
      id: request.id,
      detachedServers: request.forceDetachServers ? 1 : 0,
    }))
    apiMock.appVersion.mockResolvedValue({ version: '0.5.0-beta.28' })
    apiMock.defaultSettings.mockResolvedValue({ ...settings })
    apiMock.checkShortcutConflicts.mockResolvedValue({ entries: [] })
    apiMock.listTerminalProfiles.mockResolvedValue([{
      id: 'default',
      name: '默认',
      fontFamily: 'Consolas, Cascadia Mono, monospace',
      fontSize: 15,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 10000,
      themeName: 'serverpilot-dark',
      foreground: '#eceff4',
      background: '#1f2023',
      selectionBackground: '#5b8cff66',
      cursorColor: '#f5f7fa',
      createdAt: '',
      updatedAt: '',
    }])
  })

  it('renders backup and restore settings without native browser dialogs', () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    const alertSpy = vi.spyOn(window, 'alert')
    const confirmSpy = vi.spyOn(window, 'confirm')
    const wrapper = mount(SettingsView, { props: { settings } })

    expect(wrapper.text()).toContain('备份与恢复')
    expect(wrapper.text()).toContain('导出备份')
    expect(wrapper.text()).toContain('导入备份')
    expect(wrapper.text()).not.toContain('验证备份')
    expect(wrapper.text()).toContain('不会导出已保存密码、私钥口令、私钥文件正文或系统凭据引用')
    expect(promptSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    promptSpy.mockRestore()
    alertSpy.mockRestore()
    confirmSpy.mockRestore()
  })

  it('shows the current app version in the settings header', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })

    await flushSettingsView()

    expect(apiMock.appVersion).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="settings-app-version"]').text()).toBe('ServerPilot v0.5.0-beta.28')
  })

  it('keeps the save settings action in the sticky top action area and preserves save behavior', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const actionBar = wrapper.get('[data-testid="settings-action-bar"]')
    const saveButton = actionBar.get('button.settings-save-button')

    expect(actionBar.classes()).toContain('settings-header-actions')
    expect(actionBar.classes()).not.toContain('settings-header-action-row')
    expect(actionBar.findAll('.settings-header-action-separator')).toHaveLength(0)
    expect(saveButton.classes()).toContain('secondary')
    expect(saveButton.classes()).not.toContain('primary')
    expect(saveButton.text()).toBe('保存')
    expect(saveButton.attributes('type')).toBe('button')
    expect(saveButton.attributes('disabled')).toBeUndefined()

    await wrapper.get<HTMLInputElement>('input[value="light"]').setValue()
    await saveButton.trigger('click')

    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.themeMode).toBe('light')
    expect(wrapper.find('[data-testid="local-terminal-admin-setting"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('备份与恢复')
  })

  it('hides the Windows administrator local terminal setting on macOS', async () => {
    apiMock.getLocalTerminalCapabilities.mockResolvedValue(darwinLocalTerminalCapabilities())
    const wrapper = mount(SettingsView, { props: { settings } })

    await flushSettingsView()

    expect(wrapper.find('[data-testid="local-terminal-admin-setting"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('以管理员模式打开本地终端')
  })

  it('disables unavailable macOS system notification controls without Windows copy', async () => {
    apiMock.getLocalTerminalCapabilities.mockResolvedValue(darwinLocalTerminalCapabilities())
    const wrapper = mount(SettingsView, {
      props: {
        settings: {
          ...settings,
          alerts: {
            ...settings.alerts,
            nativeNotifications: { enabled: true },
          },
        },
        nativeNotificationStatus: {
          initialized: true,
          available: false,
          message: 'Windows 原生通知不可用。',
        },
      },
    })
    await flushSettingsView()
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '告警')!
      .trigger('click')

    const panel = wrapper.get('[data-testid="alert-native-notifications"]')
    expect(panel.text()).not.toContain('Windows 原生通知')
    expect(panel.text()).toContain('macOS 系统通知暂不可用')
    expect(wrapper.get<HTMLInputElement>('[data-testid="alert-native-notifications-enabled"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="alert-native-notification-test-button"]').element.disabled).toBe(true)
    await wrapper.get('[data-testid="alert-native-notification-test-button"]').trigger('click')
    expect(wrapper.emitted('testNativeNotification')).toBeUndefined()
  })

  it('keeps settings header actions visible and supports save-and-close plus shortcuts', async () => {
    const wrapper = mount(SettingsView, { props: { settings, overlay: true } })
    const actionBar = wrapper.get('[data-testid="settings-action-bar"]')

    expect(actionBar.text()).toContain('保存')
    expect(actionBar.text()).toContain('保存并关闭')
    expect(actionBar.find('.settings-close-button').exists()).toBe(true)
    expect(actionBar.get('.settings-close-button').text()).toBe('关闭')
    expect(actionBar.get('.settings-close-button').classes()).toContain('dialog-close-button')
    const saveAndCloseButton = actionBar.findAll('button').find((button) => button.text() === '保存并关闭')!
    expect(saveAndCloseButton.classes()).toContain('primary')
    expect(actionBar.get('.settings-reset-defaults-button').classes()).toContain('secondary')
    expect(actionBar.get('.settings-save-button').classes()).toContain('secondary')
    expect(actionBar.findAll('.settings-header-action-separator')).toHaveLength(0)

    await wrapper.get<HTMLInputElement>('input[value="light"]').setValue()
    expect(actionBar.text()).toContain('有未保存修改')
    await saveAndCloseButton.trigger('click')
    await flushSettingsView()
    expect(wrapper.emitted('saveAndClose')?.at(-1)?.[0]).toMatchObject({ themeMode: 'light' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await flushSettingsView()
    expect(wrapper.emitted('save')?.at(-1)?.[0]).toMatchObject({ themeMode: 'light' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await Promise.resolve()
    expect(choiceDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '关闭设置',
      confirmText: '保存并关闭',
      secondaryText: '放弃修改',
    }))
  })

  it('renders overlay settings actions as original button styles without separators', () => {
    const wrapper = mount(SettingsView, { props: { settings, overlay: true } })
    const actionBar = wrapper.get('[data-testid="settings-action-bar"]')
    const buttons = actionBar.findAll('button')
    const separators = actionBar.findAll('.settings-header-action-separator')

    expect(actionBar.classes()).not.toContain('settings-header-action-row')
    expect(buttons).toHaveLength(4)
    expect(buttons.map((button) => button.classes().find((name) => name.startsWith('settings-') && name.endsWith('-button')))).toEqual([
      'settings-reset-defaults-button',
      'settings-save-button',
      'settings-close-button',
      'settings-save-close-button',
    ])
    expect(separators).toHaveLength(0)
    expect(actionBar.get('.settings-reset-defaults-button').classes()).toContain('secondary')
    expect(actionBar.get('.settings-save-button').classes()).toContain('secondary')
    expect(actionBar.get('.settings-save-close-button').classes()).toContain('primary')
    expect(actionBar.get('.settings-close-button').classes()).toContain('dialog-close-button')
    const settingsCloseCss = cssBlock('.settings-close-button')
    expect(settingsCloseCss).toContain('font-size: inherit')
    expect(settingsCloseCss).toContain('font-weight: 600')
    expect(settingsCloseCss).toContain('height: auto')
    expect(settingsCloseCss).toContain('padding: 8px 13px')
  })

  it('shows the application log entry at the bottom of general settings and emits openLogs', async () => {
    const wrapper = mount(SettingsView, { props: { settings, overlay: true } })
    const entry = wrapper.get('[data-testid="settings-app-log-entry"]')

    expect(entry.text()).toContain('应用日志')
    expect(entry.text()).toContain('查看应用运行日志')
    await entry.get('[data-testid="settings-open-app-logs"]').trigger('click')
    expect(wrapper.emitted('openLogs')).toEqual([[]])
  })

  it('keeps settings save actions disabled while saving', () => {
    const wrapper = mount(SettingsView, { props: { settings, overlay: true, saving: true } })
    const actionBar = wrapper.get('[data-testid="settings-action-bar"]')

    expect(actionBar.get('button.settings-save-button').text()).toBe('保存中...')
    expect(actionBar.get('button.settings-save-button').attributes('disabled')).toBeDefined()
    expect(actionBar.findAll('button').find((button) => button.text() === '保存并关闭')?.attributes('disabled')).toBeDefined()
  })

  it('renders settings as an overlay with categorized content and a close action', async () => {
    const wrapper = mount(SettingsView, { props: { settings, overlay: true } })
    const shell = wrapper.get('[data-testid="settings-category-shell"]')
    const buttons = shell.findAll('.settings-category-nav button')
    const navButtonCss = cssBlock('.settings-category-nav button')

    expect(wrapper.classes()).toContain('settings-page-overlay')
    expect(buttons).toHaveLength(6)
    expect(buttons.map((button) => button.text())).toEqual([
      '常规',
      '终端',
      '告警',
      '快捷键',
      '密钥库',
      '备份/恢复',
    ])
    expect(buttons.map((button) => button.text()).join(' ')).not.toMatch(/[閸閺锟鎴]/)
    expect(buttons.map((button) => button.text())).not.toContain('SFTP / 文件')
    expect(buttons.map((button) => button.text())).not.toContain('命令')
    expect(buttons.map((button) => button.text())).not.toContain('安全')
    expect(buttons.map((button) => button.text())).not.toContain('高级')
    for (const button of buttons) {
      expect(button.classes()).toContain('settings-category-nav-button')
      expect(button.find('.settings-category-nav-label').exists()).toBe(true)
      expect(button.find('.app-icon').exists()).toBe(true)
      expect(button.find('.app-icon').attributes('aria-hidden')).toBe('true')
    }
    expect(navButtonCss).toContain('font-size: 16px')
    expect(navButtonCss).toContain('height: 42px')
    expect(navButtonCss).toContain('min-height: 42px')
    expect(cssBlock('.settings-category-nav')).toContain('gap: 10px')
    expect(cssBlock('.settings-category-nav button.active')).toContain('background:')
    expect(cssBlock('.settings-category-nav button.active')).toContain('border-radius:')
    expect(cssBlock('.settings-category-nav button.active')).not.toContain('inset 3px 0 0')
    expect(cssBlock('.settings-page-overlay .settings-category-shell')).toContain('align-items: stretch')
    expect(cssBlock('.settings-page-overlay .settings-category-content')).toContain('flex: 1 1 auto')
    expect(cssBlock('.settings-page-overlay .settings-category-content')).toContain('min-height: 0')
    expect(cssBlock('.settings-page-overlay .settings-category-content')).toContain('overflow-y: auto')
    expect(shell.findAll('.settings-category-nav .action-separator')).toHaveLength(0)
    expect(shell.find('.settings-category-separator').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-sftp-category"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-commands-category"]').exists()).toBe(false)

    const visibleCards = wrapper.findAll('.settings-card')
      .filter((card) => !(card.attributes('style') ?? '').includes('display: none'))
    const generalText = visibleCards.map((card) => card.text()).join('\n')
    expect(generalText).toContain('命令历史最大条数')
    expect(generalText).toContain('SSH 主机指纹策略')

    await wrapper.get('.settings-close-button').trigger('click')
    expect(wrapper.emitted('closeRequest')).toHaveLength(1)
    expect(choiceDialog).not.toHaveBeenCalled()
  })

  it('keeps security backup and key vault settings in the six-tab settings layout', async () => {
    const wrapper = mount(SettingsView, { props: { settings, overlay: true } })
    const navButtons = wrapper.findAll('.settings-category-nav button')

    expect(navButtons).toHaveLength(6)
    expect(wrapper.find('[data-testid="settings-sftp-category"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-commands-category"]').exists()).toBe(false)

    await navButtons[0].trigger('click')
    expect(wrapper.find('[data-testid="command-history-max-entries"]').exists()).toBe(true)
    const hostKeyPolicyValues = wrapper.findAll<HTMLInputElement>('input[type="radio"]')
      .map((input) => input.element.value)
      .filter((value) => ['auto_update', 'strict'].includes(value))
    expect(hostKeyPolicyValues).toEqual(['auto_update', 'strict'])

    await navButtons[1].trigger('click')
    expect(wrapper.get('[data-testid="terminal-settings"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="ssh-keepalive-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="terminal-profile-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ssh-command-completion-setting"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ssh-command-completion-max-setting"]').exists()).toBe(true)

    await navButtons[4].trigger('click')
    expect(wrapper.find('[data-testid="add-key-vault-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="key-vault-search"]').exists()).toBe(true)

    await navButtons[5].trigger('click')
    expect(wrapper.getComponent({ name: 'SettingsBackupRestoreSection' }).isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="backup-export-mode"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="backup-import-options"]').exists()).toBe(true)
    expect(wrapper.text()).not.toMatch(/private key body|terminal output|remote file content|local file content|docker logs/i)
  })

  it('renders terminal profile heading with one separator and without subheading chrome', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '终端')!
      .trigger('click')

    const profile = wrapper.get('[data-testid="terminal-profile-settings"]')
    expect(profile.find('hr').exists()).toBe(false)
    expect(profile.classes()).not.toContain('settings-subheading')
    expect(profile.find('.settings-subheading').exists()).toBe(false)
    expect(profile.classes()).toContain('terminal-profile-section')
    expect(profile.get('[data-testid="terminal-profile-title"]').classes()).toContain('terminal-profile-title')
  })

  it('renders and saves command history max entries with validation', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })

    const input = wrapper.get<HTMLInputElement>('[data-testid="command-history-max-entries"]')
    expect(input.element.value).toBe('2000')

    await input.setValue('500')
    await wrapper.get('button.settings-save-button').trigger('click')
    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.commandHistoryMaxEntries).toBe(500)

    await input.setValue('50')
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['命令历史最大条数必须在 100 到 20000 之间', 'error'])
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('renders and saves alert settings and emits test alerts', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '告警')!
      .trigger('click')

    expect(wrapper.get('[data-testid="settings-alerts-category"]').text()).toContain('告警仅在 ServerPilot 运行')
    expect((wrapper.get<HTMLInputElement>('[data-testid="alert-enabled"]').element).checked).toBe(true)
    expect((wrapper.get<HTMLInputElement>('[data-testid="alert-latency-enabled"]').element).checked).toBe(false)
    expect((wrapper.get<HTMLInputElement>('[data-testid="alert-native-notifications-enabled"]').element).checked).toBe(false)
    expect(wrapper.get('[data-testid="alert-native-notifications"]').text()).toContain('系统原生通知')
    expect(wrapper.get('[data-testid="alert-native-notifications"]').text()).not.toContain('Windows 原生通知')
    expect(wrapper.get('[data-testid="alert-native-notifications-status"]').text()).toContain('默认关闭')
    await wrapper.get('[data-testid="alert-test-button"]').trigger('click')
    expect(wrapper.emitted('testAlert')).toEqual([[]])
    await wrapper.get('[data-testid="alert-native-notification-test-button"]').trigger('click')
    expect(wrapper.emitted('testNativeNotification')).toBeUndefined()

    await wrapper.get<HTMLInputElement>('[data-testid="alert-cpu-threshold"]').setValue(80)
    await wrapper.get<HTMLInputElement>('[data-testid="alert-offline-grace"]').setValue(25)
    await wrapper.get<HTMLInputElement>('[data-testid="alert-history-limit"]').setValue(50)
    await wrapper.get('[data-testid="alert-latency-enabled"]').setValue(true)
    await wrapper.get('[data-testid="alert-native-notifications-enabled"]').setValue(true)
    await wrapper.get('[data-testid="alert-native-notification-test-button"]').trigger('click')
    expect(wrapper.emitted('testNativeNotification')).toEqual([[]])
    await wrapper.get('button.settings-save-button').trigger('click')

    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.alerts.cpu.threshold).toBe(80)
    expect(saved.alerts.offline.graceSeconds).toBe(25)
    expect(saved.alerts.historyLimit).toBe(50)
    expect(saved.alerts.latency.enabled).toBe(true)
    expect(saved.alerts.nativeNotifications.enabled).toBe(true)
  })

  it('persists Windows native notification alert settings through save and reopen', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '告警')!
      .trigger('click')

    await wrapper.get('[data-testid="alert-native-notifications-enabled"]').setValue(true)
    await wrapper.get('button.settings-save-button').trigger('click')
    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.alerts.nativeNotifications.enabled).toBe(true)

    const reopened = mount(SettingsView, {
      props: {
        settings: {
          ...settings,
          alerts: saved.alerts,
        },
      },
    })
    await reopened.findAll('.settings-category-nav button')
      .find((button) => button.text() === '告警')!
      .trigger('click')
    expect((reopened.get<HTMLInputElement>('[data-testid="alert-native-notifications-enabled"]').element).checked).toBe(true)

    await reopened.get('[data-testid="alert-native-notifications-enabled"]').setValue(false)
    await reopened.get('button.settings-save-button').trigger('click')
    const resaved = reopened.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(resaved.alerts.nativeNotifications.enabled).toBe(false)
  })

  it('keeps alert history limit compact and validates the configured range', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '告警')!
      .trigger('click')

    const input = wrapper.get<HTMLInputElement>('[data-testid="alert-history-limit"]')
    expect(input.element.value).toBe('500')
    expect(wrapper.get('.alert-history-limit-control').text()).toContain('条')

    await input.setValue(49)
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['告警历史记录上限必须在 50 到 5000 条之间', 'error'])
    expect(wrapper.emitted('save')).toBeUndefined()

    await input.setValue(5001)
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['告警历史记录上限必须在 50 到 5000 条之间', 'error'])
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('renders alert settings as an aligned compact rule table', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '告警')!
      .trigger('click')

    const card = wrapper.get('[data-testid="settings-alerts-category"]')
    const header = card.get('.alert-settings-header')
    expect(header.text()).toContain('告警仅在 ServerPilot 运行')
    expect(header.find('[data-testid="alert-test-button"]').exists()).toBe(true)

    expect(card.find('.alert-global-options').exists()).toBe(false)
    expect(card.find('.alert-global-option').exists()).toBe(false)
    expect(card.find('.alert-global-bar').exists()).toBe(false)
    expect(card.find('.alert-global-toggle').exists()).toBe(false)
    const controlbar = card.get('.alert-global-controlbar')
    const controls = controlbar.findAll('.alert-global-control')
    expect(controls).toHaveLength(2)
    expect(controls[0].find('[data-testid="alert-enabled"]').exists()).toBe(true)
    expect(controls[0].get('[data-testid="alert-enabled"]').element.tagName).toBe('INPUT')
    expect(controls[0].get<HTMLInputElement>('[data-testid="alert-enabled"]').element.type).toBe('checkbox')
    expect(controls[0].get('.alert-global-control__text strong').text()).toBe('服务器告警')
    expect(controls[0].get('.alert-global-control__text small').text()).toBe('关闭后不再创建新的告警事件。')
    expect(controls[1].find('[data-testid="alert-recovery-enabled"]').exists()).toBe(true)
    expect(controls[1].get<HTMLInputElement>('[data-testid="alert-recovery-enabled"]').element.type).toBe('checkbox')
    expect(controls[1].get('.alert-global-control__text strong').text()).toBe('恢复时通知')
    expect(controls[1].get('.alert-global-control__text small').text()).toBe('指标恢复后生成恢复状态。')
    expect(controlbar.find('.alert-global-controlbar__divider').exists()).toBe(true)

    expect(card.get('[data-testid="alert-rule-table-header"]').text()).toContain('规则')
    expect(card.get('[data-testid="alert-rule-table-header"]').text()).toContain('启用')
    expect(card.get('[data-testid="alert-rule-table-header"]').text()).toContain('阈值')
    expect(card.get('[data-testid="alert-rule-table-header"]').text()).toContain('持续')

    const rows = [
      ['alert-rule-row-offline', 'alert-offline-enabled', '', 'alert-offline-grace'],
      ['alert-rule-row-cpu', 'alert-cpu-enabled', 'alert-cpu-threshold', 'alert-cpu-duration'],
      ['alert-rule-row-memory', 'alert-memory-enabled', 'alert-memory-threshold', 'alert-memory-duration'],
      ['alert-rule-row-root-disk', 'alert-root-disk-enabled', 'alert-root-disk-threshold', 'alert-root-disk-duration'],
      ['alert-rule-row-latency', 'alert-latency-enabled', 'alert-latency-threshold', 'alert-latency-duration'],
    ] as const

    for (const [rowID, enabledID, thresholdID, durationID] of rows) {
      const row = card.get(`[data-testid="${rowID}"]`)
      expect(row.find('.alert-rule-info').exists()).toBe(true)
      expect(row.find('.alert-rule-enabled').find(`[data-testid="${enabledID}"]`).exists()).toBe(true)
      expect(row.find('.alert-rule-threshold').exists()).toBe(true)
      expect(row.find('.alert-rule-duration').find(`[data-testid="${durationID}"]`).exists()).toBe(true)
      if (thresholdID) {
        expect(row.find('.alert-rule-threshold').find(`[data-testid="${thresholdID}"]`).exists()).toBe(true)
      }
    }

    expect(card.get('[data-testid="alert-rule-row-offline"] .alert-rule-threshold').text()).toBe('—')
    expect(card.get('[data-testid="alert-rule-row-cpu"] .alert-rule-threshold').text()).toContain('%')
    expect(card.get('[data-testid="alert-rule-row-latency"] .alert-rule-threshold').text()).toContain('ms')
    expect(card.get('[data-testid="alert-rule-row-cpu"] .alert-rule-duration').text()).toContain('秒')
    expect(card.get('[data-testid="alert-cpu-threshold"]').classes()).toContain('alert-threshold-input')
    expect(card.get('[data-testid="alert-latency-threshold"]').classes()).toContain('alert-latency-input')
    expect(card.get('[data-testid="alert-cpu-duration"]').classes()).toContain('alert-duration-input')
  })

  it('renders and saves SSH keepalive settings with validation', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '终端')!
      .trigger('click')

    const section = wrapper.get('[data-testid="ssh-keepalive-settings"]')
    expect(section.text()).toContain('SSH 保活')
    expect(section.text()).toContain('保活失败会关闭对应 SSH 连接')

    const enabled = section.get<HTMLInputElement>('[data-testid="ssh-keepalive-enabled"]')
    const interval = section.get<HTMLInputElement>('[data-testid="ssh-keepalive-interval"]')
    const timeout = section.get<HTMLInputElement>('[data-testid="ssh-keepalive-timeout"]')
    const failures = section.get<HTMLInputElement>('[data-testid="ssh-keepalive-max-failures"]')
    expect(enabled.element.checked).toBe(true)
    expect(interval.element.value).toBe('30')
    expect(timeout.element.value).toBe('10')
    expect(failures.element.value).toBe('3')

    await enabled.setValue(false)
    await interval.setValue('60')
    await timeout.setValue('15')
    await failures.setValue('5')
    await wrapper.get('button.settings-save-button').trigger('click')
    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.sshKeepaliveEnabled).toBe(false)
    expect(saved.sshKeepaliveIntervalSeconds).toBe(60)
    expect(saved.sshKeepaliveTimeoutSeconds).toBe(15)
    expect(saved.sshKeepaliveMaxFailures).toBe(5)

    await interval.setValue('5')
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['SSH 保活间隔必须在 10 到 300 秒之间', 'error'])
  })

  it('validates SSH keepalive timeout and failure count with Chinese errors', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '终端')!
      .trigger('click')

    await wrapper.get('[data-testid="ssh-keepalive-timeout"]').setValue('2')
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['SSH 保活超时必须在 3 到 60 秒之间', 'error'])

    await wrapper.get('[data-testid="ssh-keepalive-timeout"]').setValue('10')
    await wrapper.get('[data-testid="ssh-keepalive-max-failures"]').setValue('0')
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['SSH 保活失败次数必须在 1 到 10 之间', 'error'])
  })

  it('renders only the local terminal admin mode setting and not the removed shell preference', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(apiMock.getLocalTerminalCapabilities).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="local-terminal-settings"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="local-terminal-admin-setting"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('以管理员模式打开本地终端')
    expect(wrapper.text()).not.toContain('本地终端默认 Shell')
  })

  it('moves terminal clipboard preferences into shortcut settings and saves them', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await Promise.resolve()
    await Promise.resolve()

    const terminalSettings = wrapper.get('[data-testid="terminal-settings"]')
    expect(terminalSettings.text()).toContain('连接超时')
    expect(terminalSettings.text()).toContain('SSH 保活')
    expect(terminalSettings.text()).toContain('终端配置 Profile')
    expect(terminalSettings.text()).not.toContain('粘贴仍通过 xterm 输入路径发送到远端')
    expect(terminalSettings.text()).not.toContain('终端选中即复制')
    expect(terminalSettings.text()).not.toContain('终端右键粘贴')
    expect(wrapper.find('[data-testid="local-terminal-admin-setting"]').exists()).toBe(true)

    const adminToggle = terminalSettings.get<HTMLInputElement>('[data-testid="local-terminal-admin-setting"] input')
    expect(adminToggle.element.checked).toBe(false)

    const shortcutSettings = wrapper.get('[data-testid="shortcut-settings"]')
    const copyOnSelect = shortcutSettings.get<HTMLInputElement>('[data-testid="shortcut-copy-on-select"] input')
    expect(copyOnSelect.element.checked).toBe(true)
    expect(shortcutSettings.get('[data-testid="terminal-right-click-action"]').element).toBeInstanceOf(HTMLSelectElement)

    await copyOnSelect.setValue(false)
    await shortcutSettings.get<HTMLSelectElement>('[data-testid="terminal-right-click-action"]').setValue('menu')
    await adminToggle.setValue(true)
    await wrapper.get('.settings-save-button').trigger('click')

    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.terminalCopyOnSelectEnabled).toBe(false)
    expect(saved.terminalRightClickPasteEnabled).toBe(false)
    expect(saved.shortcutSettings.terminalCopyOnSelectEnabled).toBe(false)
    expect(saved.shortcutSettings.terminalRightClickAction).toBe('menu')
    expect(saved.localTerminalElevatedEnabled).toBe(true)
  })

  it('warns when right click paste takes over the terminal menu', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await Promise.resolve()
    await Promise.resolve()

    const shortcutSettings = wrapper.get('[data-testid="shortcut-settings"]')
    expect(shortcutSettings.get('[data-testid="right-click-paste-warning"]').text()).toContain('右键粘贴会占用终端右键菜单')

    await shortcutSettings.get<HTMLSelectElement>('[data-testid="terminal-context-menu-trigger"]').setValue('disabled')
    expect(shortcutSettings.get('[data-testid="right-click-menu-disabled-warning"]').text()).toContain('禁用终端右键菜单入口')
  })

  it('rejects duplicate keyboard shortcuts before saving', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await Promise.resolve()
    await Promise.resolve()

    const shortcutSettings = wrapper.get('[data-testid="shortcut-settings"]')
    await shortcutSettings.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalPaste"] select').setValue('ctrl+shift+c')
    expect(shortcutSettings.get('[data-testid="shortcut-conflict-warning"]').text()).toContain('Ctrl+Shift+C')

    await wrapper.get('.settings-save-button').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('notify')?.at(-1)?.[0]).toContain('快捷键冲突')
  })

  it('uses Ctrl+Shift+A as the default completion shortcut and does not recommend Ctrl+Space', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '快捷键')!
      .trigger('click')

    const completionSelect = wrapper.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalCompletion"] select')
    const options = Array.from(completionSelect.element.options).map((option) => option.value)
    expect(completionSelect.element.value).toBe('ctrl+shift+a')
    expect(options).toContain('ctrl+shift+a')
    expect(options).not.toContain('ctrl+space')
  })

  it('lets terminal settings re-enable SSH command completion after the overlay disables it', async () => {
    localStorage.setItem('serverpilot.sshCommandCompletion.enabled', 'false')
    const wrapper = mount(SettingsView, { props: { settings } })

    const toggle = wrapper.get<HTMLInputElement>('[data-testid="ssh-command-completion-enabled"]')
    expect(toggle.element.checked).toBe(false)

    await toggle.setValue(true)
    expect(localStorage.getItem('serverpilot.sshCommandCompletion.enabled')).toBe('true')
  })

  it('persists SSH command completion description, limit, and trigger settings', async () => {
    localStorage.clear()
    const wrapper = mount(SettingsView, { props: { settings } })

    const showDescriptions = wrapper.get<HTMLInputElement>('[data-testid="ssh-command-completion-show-descriptions"]')
    const maxSuggestions = wrapper.get<HTMLInputElement>('[data-testid="ssh-command-completion-max-suggestions"]')
    const triggerChars = wrapper.get<HTMLInputElement>('[data-testid="ssh-command-completion-trigger-chars"]')

    expect(showDescriptions.element.checked).toBe(true)
    expect(maxSuggestions.element.value).toBe('12')
    expect(triggerChars.element.value).toBe('2')

    await showDescriptions.setValue(false)
    await maxSuggestions.setValue(18)
    await triggerChars.setValue(3)

    expect(localStorage.getItem('serverpilot.sshCommandCompletion.showDescriptions')).toBe('false')
    expect(localStorage.getItem('serverpilot.sshCommandCompletion.maxSuggestions')).toBe('18')
    expect(localStorage.getItem('serverpilot.sshCommandCompletion.triggerChars')).toBe('3')
  })

  it('cancels resetting settings defaults without changing the draft', async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    const wrapper = mount(SettingsView, { props: { settings: { ...settings, themeMode: 'light' }, overlay: true } })

    await wrapper.get<HTMLInputElement>('input[value="system"]').setValue()
    await wrapper.get('[data-testid="settings-reset-defaults"]').trigger('click')
    await flushSettingsView()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('默认'),
      message: expect.stringContaining('保存'),
      confirmText: expect.stringContaining('默认'),
    }))
    expect(wrapper.get<HTMLInputElement>('input[value="system"]').element.checked).toBe(true)
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('resets the settings draft to defaults without persisting until save', async () => {
    const defaults = {
      ...settings,
      themeMode: 'dark',
      uiFontSize: 'large',
      shortcutSettings: defaultShortcutSettings(),
      terminalCopyOnSelectEnabled: true,
      terminalRightClickPasteEnabled: true,
    }
    apiMock.defaultSettings.mockResolvedValueOnce(defaults)
    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    const wrapper = mount(SettingsView, { props: { settings: { ...settings, themeMode: 'light' }, overlay: true } })

    await wrapper.get<HTMLInputElement>('input[value="system"]').setValue()
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text().includes('蹇嵎') || button.text() === '快捷键')!
      .trigger('click')
    await flushSettingsView()
    await wrapper.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalPaste"] select').setValue('ctrl+alt+v')
    await wrapper.get('[data-testid="settings-reset-defaults"]').trigger('click')
    await flushSettingsView()

    expect(apiMock.defaultSettings).toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('input[value="dark"]').element.checked).toBe(true)
    expect(wrapper.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalPaste"] select').element.value).toBe('ctrl+shift+v')
    expect(wrapper.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalCompletion"] select').element.value).toBe('ctrl+shift+a')
    expect(wrapper.get('[data-testid="settings-action-bar"]').text()).toContain('未保存')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('notify')?.at(-1)?.[1]).toBe('info')

    await wrapper.get('button.settings-save-button').trigger('click')
    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.themeMode).toBe('dark')
    expect(saved.shortcutSettings.terminalPaste).toBe('ctrl+shift+v')
    expect(saved.shortcutSettings.terminalCompletion).toBe('ctrl+shift+a')
    expect(saved.terminalRightClickPasteEnabled).toBe(true)
  })

  it('warns about external shortcut conflicts without blocking save', async () => {
    apiMock.checkShortcutConflicts.mockResolvedValue({
      entries: [{
        shortcut: 'ctrl+space',
        status: 'unknown',
        message: 'Ctrl+Space 可能已被 Windows、输入法或其他应用注册，ServerPilot 可能无法收到该按键。仍可保存。',
      }],
    })
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text().includes('蹇嵎') || button.text() === '快捷键')!
      .trigger('click')
    await flushSettingsView()

    expect(apiMock.checkShortcutConflicts).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="external-shortcut-conflict-warning"]').text()).toContain('仍可保存')
    await wrapper.get('button.settings-save-button').trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('ignores stale asynchronous shortcut conflict results after a newer selection', async () => {
    let resolveFirst: (value: ShortcutConflictCheckResponse) => void = () => undefined
    let resolveSecond: (value: ShortcutConflictCheckResponse) => void = () => undefined
    apiMock.checkShortcutConflicts
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text().includes('蹇嵎') || button.text() === '快捷键')!
      .trigger('click')
    await flushSettingsView()
    await wrapper.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalPaste"] select').setValue('ctrl+alt+v')
    await flushSettingsView()

    resolveSecond({ entries: [] })
    await flushSettingsView()
    resolveFirst({
      entries: [{
        shortcut: 'ctrl+shift+v',
        status: 'occupied',
        message: '旧结果不应覆盖新选择',
      }],
    })
    await flushSettingsView()

    expect(wrapper.find('[data-testid="external-shortcut-conflict-warning"]').exists()).toBe(false)
  })

  it('renders create immediately after the default profile when no custom profiles exist', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    const list = wrapper.get('[data-testid="terminal-profile-settings"] .terminal-profile-list')
    const orderedItems = Array.from(list.element.querySelectorAll('.terminal-profile-item, .terminal-profile-create-item'))
      .map((item) => (item as HTMLElement).dataset.testid)

    expect(orderedItems).toEqual([
      'terminal-profile-row-default',
      'terminal-profile-create-item',
    ])
  })

  it('keeps create as the last profile list item and moves it down after saved new profiles', async () => {
    let profiles = [
      terminalProfile('tp-1', 'Profile 1'),
      terminalProfile('default', '默认'),
      terminalProfile('tp-2', 'Profile 2'),
      terminalProfile('tp-3', 'Profile 3'),
    ]
    apiMock.listTerminalProfiles.mockImplementation(() => Promise.resolve([...profiles]))
    apiMock.createTerminalProfile.mockImplementation(async (request) => {
      const saved = {
        ...request,
        id: 'tp-new',
        name: request.name || 'New Profile',
        createdAt: '',
        updatedAt: '',
      }
      profiles = [...profiles, saved]
      return saved
    })
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    const profileSection = wrapper.get('[data-testid="terminal-profile-settings"]')
    expect(profileSection.get('.settings-card-header').find('[data-testid="terminal-profile-new"]').exists()).toBe(false)
    expect(profileSection.find('.terminal-profile-list-header').exists()).toBe(false)
    expect(profileSection.find('[data-testid="terminal-profile-list-footer"]').exists()).toBe(false)
    const list = profileSection.get('.terminal-profile-list')
    const orderedItems = () => Array.from(list.element.querySelectorAll('.terminal-profile-item, .terminal-profile-create-item'))
      .map((item) => (item as HTMLElement).dataset.testid)

    expect(orderedItems()).toEqual([
      'terminal-profile-row-default',
      'terminal-profile-row-tp-1',
      'terminal-profile-row-tp-2',
      'terminal-profile-row-tp-3',
      'terminal-profile-create-item',
    ])
    const newButton = list.get('[data-testid="terminal-profile-new"]')

    expect(newButton.classes()).toContain('profile-action-button')
    for (const deleteButton of list.findAll('[data-testid="terminal-profile-row-delete"]')) {
      expect(deleteButton.classes()).toContain('profile-action-button')
    }
    expect(list.findAll('.terminal-profile-item')[0].text()).toContain('默认')
    expect(newButton.text()).toBe('新建')
    await newButton.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get<HTMLInputElement>('[data-testid="terminal-profile-name"]').element.value).toBe('默认 副本')
    await wrapper.get('[data-testid="terminal-profile-save"]').trigger('click')
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    expect(orderedItems()).toEqual([
      'terminal-profile-row-default',
      'terminal-profile-row-tp-1',
      'terminal-profile-row-tp-2',
      'terminal-profile-row-tp-3',
      'terminal-profile-row-tp-new',
      'terminal-profile-create-item',
    ])
    expect(wrapper.get<HTMLInputElement>('[data-testid="terminal-profile-name"]').element.value).toBe('默认 副本')
  })

  it('manages terminal profiles and applies them to open terminals', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const terminalSettings = wrapper.get('[data-testid="terminal-settings"]')
    expect(terminalSettings.text()).toContain('终端配置 Profile')
    expect(wrapper.get<HTMLInputElement>('[data-testid="terminal-profile-name"]').element.value).toBe('默认')
    expect(wrapper.find('[data-testid="terminal-profile-font"]').exists()).toBe(false)
    expect(wrapper.get('.terminal-profile-actions').findAll('button').map((button) => button.text())).toEqual([
      '复制',
      '设为全局默认',
      '应用到已打开终端',
      '保存 Profile',
    ])

    await wrapper.get('[data-testid="terminal-profile-font-preset"]').setValue('consolas')

    await wrapper.get('[data-testid="terminal-profile-font-size"]').setValue('18')
    await wrapper.get('[data-testid="terminal-profile-theme"]').setValue('custom')
    await wrapper.get('[data-testid="terminal-profile-selection-color"]').setValue('#93c5fd88')
    await wrapper.get('[data-testid="terminal-profile-save"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(apiMock.updateTerminalProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 'default',
      fontFamily: 'Consolas, monospace',
      themeName: 'custom',
      selectionBackground: '#93c5fd88',
    }))

    const applySpy = vi.fn()
    registerTerminalInstance({
      id: 'settings-profile-terminal',
      kind: 'ssh',
      serverID: 7,
      resolvedProfileID: 'default',
      inheritsDefaultProfile: true,
      applyProfile: applySpy,
    })
    await wrapper.get('[data-testid="terminal-profile-apply"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(applySpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'default', fontSize: 18 }))
    expect(wrapper.emitted('notify')?.some((entry) => entry[0] === '已应用到 1 个已打开终端')).toBe(true)
    unregisterTerminalInstance('settings-profile-terminal')

    await wrapper.get('[data-testid="terminal-profile-duplicate"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(apiMock.duplicateTerminalProfile).toHaveBeenCalledWith('default')

    await wrapper.get('[data-testid="terminal-profile-default"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    expect(apiMock.setDefaultTerminalProfile).toHaveBeenCalled()
  })

  it('keeps delete only in the terminal profile list and allows in-use custom profiles to ask for confirmation', async () => {
    apiMock.listTerminalProfiles.mockResolvedValue([
      terminalProfile('default', '默认'),
      terminalProfile('tp-used', 'Ops Used'),
      terminalProfile('tp-free', 'Ops Free'),
    ])
    const wrapper = mount(SettingsView, {
      props: {
        settings,
        connections: [connectionWithProfile('tp-used')],
      },
    })
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    const defaultDelete = wrapper.get('[data-testid="terminal-profile-row-delete"][data-profile-id="default"]')
    const usedDelete = wrapper.get('[data-testid="terminal-profile-row-delete"][data-profile-id="tp-used"]')
    const freeDelete = wrapper.get('[data-testid="terminal-profile-row-delete"][data-profile-id="tp-free"]')

    expect(defaultDelete.text()).toBe('删除')
    expect(defaultDelete.attributes('disabled')).toBeDefined()
    expect(defaultDelete.attributes('title')).toBe('全局默认终端配置不能删除')
    expect(usedDelete.attributes('disabled')).toBeUndefined()
    expect(usedDelete.attributes('title')).toContain('删除后相关服务器将继承全局默认配置')
    expect(freeDelete.text()).toBe('删除')
    expect(freeDelete.classes()).toContain('terminal-profile-row-delete')
    expect(freeDelete.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="terminal-profile-delete"]').exists()).toBe(false)
  })

  it('deletes a custom terminal profile only after confirmation without selecting the row', async () => {
    let profiles = [
      terminalProfile('default', '默认'),
      terminalProfile('tp-free', 'Ops Free'),
    ]
    apiMock.listTerminalProfiles.mockImplementation(() => Promise.resolve([...profiles]))
    apiMock.deleteTerminalProfile.mockImplementation(async (request: { id: string; forceDetachServers: boolean }) => {
      profiles = profiles.filter((profile) => profile.id !== request.id)
      return { id: request.id, detachedServers: 0 }
    })
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    await wrapper.get('[data-testid="terminal-profile-row-delete"][data-profile-id="tp-free"]').trigger('click')
    await flushSettingsView()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: '确定删除终端配置「Ops Free」吗？',
      danger: true,
    }))
    expect(apiMock.deleteTerminalProfile).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('[data-testid="terminal-profile-name"]').element.value).toBe('默认')

    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    await wrapper.get('[data-testid="terminal-profile-row-delete"][data-profile-id="tp-free"]').trigger('click')
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    expect(apiMock.deleteTerminalProfile).toHaveBeenCalledWith({ id: 'tp-free', forceDetachServers: false })
    expect(wrapper.find('[data-testid="terminal-profile-row-tp-free"]').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('[data-testid="terminal-profile-name"]').element.value).toBe('默认')
    expect(wrapper.emitted('notify')?.some((entry) =>
      entry[0] === '终端配置已删除' && entry[1] === 'success')).toBe(true)
  })

  it('force deletes an in-use custom terminal profile after warning and asks the app to refresh servers', async () => {
    let profiles = [
      terminalProfile('default', '默认'),
      terminalProfile('tp-used', 'Ops Used'),
    ]
    apiMock.listTerminalProfiles.mockImplementation(() => Promise.resolve([...profiles]))
    apiMock.deleteTerminalProfile.mockImplementation(async (request: { id: string; forceDetachServers: boolean }) => {
      profiles = profiles.filter((profile) => profile.id !== request.id)
      return { id: request.id, detachedServers: request.forceDetachServers ? 1 : 0 }
    })
    const wrapper = mount(SettingsView, {
      props: {
        settings,
        connections: [connectionWithProfile('tp-used')],
      },
    })
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    await wrapper.get('[data-testid="terminal-profile-row-delete"][data-profile-id="tp-used"]').trigger('click')
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('有 1 台服务器正在使用终端配置「Ops Used」'),
      confirmText: '删除并改为继承默认',
      danger: true,
    }))
    expect(apiMock.deleteTerminalProfile).toHaveBeenCalledWith({ id: 'tp-used', forceDetachServers: true })
    expect(wrapper.emitted('terminalProfileDeleted')).toHaveLength(1)
    expect(wrapper.emitted('notify')?.some((entry) =>
      entry[0] === '终端配置已删除，相关服务器已改为继承全局默认配置' && entry[1] === 'success')).toBe(true)
  })

  it('shows custom font input only for custom font preset and validates unsafe names', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="terminal-profile-font"]').exists()).toBe(false)
    await wrapper.get('[data-testid="terminal-profile-font-preset"]').setValue('custom')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-profile-font"]').exists()).toBe(true)

    await wrapper.get('[data-testid="terminal-profile-font"]').setValue('Bad; Font')
    await wrapper.get('[data-testid="terminal-profile-save"]').trigger('click')
    await Promise.resolve()

    expect(apiMock.updateTerminalProfile).not.toHaveBeenCalledWith(expect.objectContaining({
      fontFamily: 'Bad; Font',
    }))
    expect(wrapper.get('[data-testid="terminal-profile-error"]').text()).toContain('字体名称包含不允许的字符')
  })

  it('validates backup export passwords and clears them after success', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const exportButton = wrapper.findAll('button').find((button) => button.text() === '导出加密备份')!

    await exportButton.trigger('click')
    expect(wrapper.text()).toContain('请输入备份密码')

    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[0].setValue('correct horse battery')
    await passwordInputs[1].setValue('different password')
    await exportButton.trigger('click')
    expect(wrapper.text()).toContain('两次输入的备份密码不一致')

    await passwordInputs[1].setValue('correct horse battery')
    await exportButton.trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(apiMock.selectBackupExportPath).toHaveBeenCalled()
    expect(apiMock.exportBackup).toHaveBeenCalledWith({
      path: 'C:/tmp/serverpilot.spbackup',
      password: 'correct horse battery',
      confirmPassword: 'correct horse battery',
      mode: 'standard',
    })
    expect((passwordInputs[0].element as HTMLInputElement).value).toBe('')
    expect((passwordInputs[1].element as HTMLInputElement).value).toBe('')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['备份导出成功', 'success'])
  })

  it('accepts simple six-character backup passwords without trimming or complexity rules', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const exportButton = wrapper.findAll('button').find((button) => button.text() === '导出加密备份')!
    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')

    await passwordInputs[0].setValue('12345')
    await passwordInputs[1].setValue('12345')
    expect(wrapper.text()).toContain('备份密码至少需要 6 个字符')
    await exportButton.trigger('click')
    expect(apiMock.exportBackup).not.toHaveBeenCalled()

    for (const password of ['123456', 'abcdef', '密码密码密码', '!!!!!!', ' 1234 ']) {
      apiMock.exportBackup.mockClear()
      apiMock.selectBackupExportPath.mockClear()
      await passwordInputs[0].setValue(password)
      await passwordInputs[1].setValue(password)
      expect(wrapper.text()).toContain('已满足最短长度；格式不限')
      await exportButton.trigger('click')
      await Promise.resolve()
      await Promise.resolve()
      expect(apiMock.exportBackup).toHaveBeenCalledWith({
        path: 'C:/tmp/serverpilot.spbackup',
        password,
        confirmPassword: password,
        mode: 'standard',
      })
    }
  })

  it('requires confirmation before exporting a full backup with saved secrets', async () => {
    apiMock.exportBackup.mockResolvedValueOnce({
      path: 'C:/tmp/serverpilot.spbackup',
      createdAt: '2026-06-17T00:00:00Z',
      mode: 'full',
      groups: 1,
      connections: 2,
      keyVaultEntries: 1,
      hostTrustRecords: 1,
      secretEntries: 3,
      encryptedFileSize: 2048,
    })
    const wrapper = mount(SettingsView, { props: { settings } })

    await wrapper.get<HTMLInputElement>('input[value="full"]').setValue()
    expect(wrapper.get('[data-testid="backup-export-mode"]').text()).toContain('完整备份（高风险）')
    expect(wrapper.text()).toContain('此备份包含所有敏感信息，存在安全风险')

    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[0].setValue('correct horse battery')
    await passwordInputs[1].setValue('correct horse battery')
    await wrapper.findAll('button').find((button) => button.text() === '导出加密备份')!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认完整备份',
      danger: true,
    }))
    expect(apiMock.exportBackup).toHaveBeenCalledWith({
      path: 'C:/tmp/serverpilot.spbackup',
      password: 'correct horse battery',
      confirmPassword: 'correct horse battery',
      mode: 'full',
    })
    expect(wrapper.text()).toContain('完整备份，已加密 3 条凭据')
  })

  it('imports directly after selecting a file without requiring prior verification', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const browseButtons = wrapper.findAll('button').filter((button) => button.text() === '浏览…')
    await browseButtons[1].trigger('click')
    await Promise.resolve()
    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[2].setValue('correct horse battery')
    apiMock.listKeyVaultEntries.mockClear()

    const importButton = wrapper.findAll('button').find((button) => button.text() === '导入备份')!
    await importButton.trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(consoleLogMock.mock.calls.some((call) => String(call[0]).includes('[ServerPilot backup]'))).toBe(false)
    expect(apiMock.importBackup).toHaveBeenCalledWith({
      path: 'C:/tmp/serverpilot.spbackup',
      password: 'correct horse battery',
      options: {
        importSettings: true,
        importGroups: true,
        importServers: true,
        importKeyVault: true,
        importHostTrust: true,
      },
    })
    expect(wrapper.emitted('backupImported')).toHaveLength(1)
    expect(wrapper.emitted('notify')).toBeUndefined()
    expect((importButton.element as HTMLButtonElement).disabled).toBe(false)
    expect(apiMock.listKeyVaultEntries).toHaveBeenCalledTimes(1)
  })

  it('defaults every backup import option on and preserves manual unchecked choices across file selections', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const browseButtons = wrapper.findAll('button').filter((button) => button.text().startsWith('浏览'))
    await browseButtons[1].trigger('click')
    await Promise.resolve()

    const checkboxes = wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]')
    expect(checkboxes).toHaveLength(5)
    expect(checkboxes.every((box) => box.element.checked)).toBe(true)

    await checkboxes[4].setValue(false)
    await Promise.resolve()
    expect(checkboxes[4].element.checked).toBe(false)

    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[2].setValue('correct horse battery')
    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(apiMock.importBackup).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ importHostTrust: false }),
    }))

    apiMock.selectBackupImportFile.mockResolvedValueOnce('C:/tmp/second.spbackup')
    await browseButtons[1].trigger('click')
    await Promise.resolve()
    expect(checkboxes[4].element.checked).toBe(false)
  })

  it('keeps manually unchecked backup import options when the first file is selected after editing options', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const importBrowseButton = wrapper.findAll('.file-input button.secondary')[1]
    const checkboxes = wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]')

    await checkboxes[1].setValue(false)
    await checkboxes[3].setValue(false)
    await wrapper.vm.$nextTick()
    await importBrowseButton.trigger('click')
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(checkboxes[1].element.checked).toBe(false)
    expect(checkboxes[3].element.checked).toBe(false)
  })

  it('does not restore manually unchecked backup import options when reselecting the same file', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const importBrowseButton = wrapper.findAll('.file-input button.secondary')[1]
    await importBrowseButton.trigger('click')
    await Promise.resolve()

    const checkboxes = wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]')
    expect(checkboxes).toHaveLength(5)
    expect(checkboxes.every((box) => box.element.checked)).toBe(true)

    await checkboxes[0].setValue(false)
    await checkboxes[4].setValue(false)
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    apiMock.selectBackupImportFile.mockResolvedValueOnce('C:/tmp/serverpilot.spbackup')
    await importBrowseButton.trigger('click')
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(checkboxes[0].element.checked).toBe(false)
    expect(checkboxes[4].element.checked).toBe(false)

    apiMock.importBackup.mockClear()
    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[2].setValue('correct horse battery')
    await wrapper.get('[data-testid="backup-import-options"] + .backup-actions button').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(apiMock.importBackup).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        importSettings: false,
        importHostTrust: false,
      }),
    }))
  })

  it('persists backup import checkbox choices through settings save and reopen', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const checkboxes = wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]')

    expect(wrapper.text()).toContain('导入密钥库数据')
    expect(wrapper.text()).not.toContain('导入 Key Vault 元数据')
    await checkboxes[1].setValue(false)
    await checkboxes[3].setValue(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="settings-action-bar"]').text()).toContain('有未保存修改')

    await wrapper.get('button.settings-save-button').trigger('click')
    await flushSettingsView()
    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.backupImportOptions).toEqual({
      importSettings: true,
      importGroups: false,
      importServers: true,
      importKeyVault: false,
      importHostTrust: true,
    })

    const reopened = mount(SettingsView, {
      props: {
        settings: {
          ...settings,
          backupImportOptions: saved.backupImportOptions,
        },
      },
    })
    const reopenedBoxes = reopened.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]')
    expect(reopenedBoxes.map((box) => box.element.checked)).toEqual([true, false, true, false, true])

    await reopenedBoxes[1].setValue(true)
    await reopenedBoxes[3].setValue(true)
    await reopened.get('button.settings-save-button').trigger('click')
    await flushSettingsView()
    const resaved = reopened.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(resaved.backupImportOptions).toEqual({
      importSettings: true,
      importGroups: true,
      importServers: true,
      importKeyVault: true,
      importHostTrust: true,
    })
  })

  it('shows visible errors instead of silently ignoring import clicks', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')
    expect(apiMock.importBackup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择备份文件')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['请选择备份文件', 'error'])

    const browseButtons = wrapper.findAll('button').filter((button) => button.text() === '浏览…')
    await browseButtons[1].trigger('click')
    await Promise.resolve()
    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')
    expect(apiMock.importBackup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请输入备份密码')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['请输入备份密码', 'error'])

    apiMock.importBackup.mockClear()
    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[2].setValue('12345')
    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')
    expect(apiMock.importBackup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('备份密码至少需要 6 个字符')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['备份密码至少需要 6 个字符', 'error'])
  })

  it('translates import failures into visible Chinese errors', async () => {
    apiMock.importBackup.mockRejectedValueOnce(new Error('BACKUP_IMPORT_ROLLBACK: 导入失败，已回滚所有更改'))
    const wrapper = mount(SettingsView, { props: { settings } })
    const browseButtons = wrapper.findAll('button').filter((button) => button.text() === '浏览…')
    await browseButtons[1].trigger('click')
    await Promise.resolve()
    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[2].setValue('correct horse battery')

    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(apiMock.importBackup).toHaveBeenCalled()
    expect(wrapper.text()).toContain('导入失败（已回滚）')
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['导入失败（已回滚）', 'error'])
    expect((wrapper.findAll('button').find((button) => button.text() === '导入备份')!.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows import options without verification and imports with result statistics', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const browseButtons = wrapper.findAll('button').filter((button) => button.text() === '浏览…')
    await browseButtons[1].trigger('click')
    await Promise.resolve()
    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[2].setValue('correct horse battery')

    expect(wrapper.findAll('button').some((button) => button.text() === '验证备份')).toBe(false)
    expect(wrapper.get('[data-testid="backup-import-options"]').text()).toContain('重复服务器会按主机、端口和用户名更新现有记录')

    const hostTrustToggle = wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]').at(-1)!
    await hostTrustToggle.setValue(true)
    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(apiMock.importBackup).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:/tmp/serverpilot.spbackup',
      password: 'correct horse battery',
      options: expect.objectContaining({ importHostTrust: true }),
    }))
    expect(wrapper.get('[data-testid="backup-result"]').text()).toContain('新增服务器：2')
    expect(wrapper.get('[data-testid="backup-result"]').text()).not.toContain('重命名')
    expect(wrapper.emitted('backupImported')).toHaveLength(1)
  })

  it('renders key vault empty state and validates a new key without showing passphrases', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const testValue = 'test-value-keyvault'
    await Promise.resolve()
    expect(wrapper.find('[data-testid="key-vault-empty"]').exists()).toBe(true)
    await wrapper.get('[data-testid="add-key-vault-entry"]').trigger('click')
    expect(wrapper.find('.key-vault-modal header .dialog-close-button').exists()).toBe(false)
    expect(wrapper.findAll('.key-vault-modal footer button').map((button) => button.text())).toEqual(['取消', '导入密钥'])
    await wrapper.find('.key-vault-modal input[type="password"]').setValue(testValue)
    await wrapper.find('.file-input button').trigger('click')
    await Promise.resolve()
    await wrapper.find('.validation-panel button').trigger('click')
    await Promise.resolve()
    expect(wrapper.text()).toContain('SHA256:test')
    await wrapper.find('.key-vault-modal').trigger('submit')
    await Promise.resolve()
    expect(apiMock.createKeyVaultEntry).toHaveBeenCalledWith(expect.objectContaining({
      passphrase: testValue,
    }))
    expect(wrapper.find<HTMLInputElement>('.key-vault-modal input[type="password"]').exists()).toBe(false)
  })

  it('uses the shared textarea styling for key import notes', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const addButton = wrapper.get('[data-testid="add-key-vault-entry"]')

    expect(addButton.text()).toBe('新增密钥')
    expect(addButton.classes()).toContain('key-vault-add-button')
    await wrapper.get('[data-testid="add-key-vault-entry"]').trigger('click')
    const textarea = wrapper.get<HTMLTextAreaElement>('.key-vault-modal textarea.key-import-remark')

    expect(textarea.classes()).toContain('app-textarea')
    expect(textarea.classes()).toContain('key-import-remark')
    expect(textarea.attributes('rows')).toBe('3')
    expect(textarea.attributes('placeholder')).toBe('可选')
  })

  it('renders compact encrypted key cards without storage, source file, or passphrase metadata', async () => {
    const encryptedEntry = keyVaultEntry({
      name: '我',
      algorithm: 'ssh-rsa',
      keyBits: 2048,
      sourceFileName: 'id_rsa',
      publicKeyFingerprintSHA256: 'SHA256:+RwDYMtlEU4qOnTmey41Qg7IP5OopdpRbmHDfr1PTDQ',
      passphraseSaved: false,
      usageCount: 0,
      lastUsedAt: '2026-06-24T04:00:00Z',
    })
    apiMock.listKeyVaultEntries.mockResolvedValue([encryptedEntry])
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()

    const row = wrapper.get('.key-vault-row')
    const rowText = row.text()
    expect(rowText).toContain('我')
    expect(rowText).toContain('ssh-rsa 2048')
    expect(rowText).toContain('使用中 0 台')
    expect(rowText).toContain('SHA256:+RwDYMtlEU4qOnTmey41Qg7IP5OopdpRbmHDfr1PTDQ')
    expect(rowText).toContain('最后使用')
    expect(rowText).not.toContain('存储方式')
    expect(rowText).not.toContain('已加密存入本地密钥库')
    expect(rowText).not.toContain('不依赖原文件')
    expect(rowText).not.toContain('原文件名')
    expect(rowText).not.toContain('id_rsa')
    expect(rowText).not.toContain('口令')
    expect(rowText).not.toContain('未保存')
    const fingerprint = row.get<HTMLButtonElement>('.fingerprint')
    expect(fingerprint.attributes('title')).toBe('SHA256:+RwDYMtlEU4qOnTmey41Qg7IP5OopdpRbmHDfr1PTDQ')
    expect(row.find('.key-vault-usage-note').exists()).toBe(false)
    expect(row.find('.key-vault-actions').text()).toContain('编辑')
    expect(row.find('.key-vault-actions').text()).toContain('删除')
    expect(row.find('.key-vault-actions').text()).not.toContain('删除口令')
  })

  it('keeps the legacy key migration entry while using compact key card metadata', async () => {
    const legacyEntry = keyVaultEntry({
      name: 'legacy-key',
      storageMode: 'legacy_file_path',
      privateKeyPath: 'C:/Users/test/.ssh/id_rsa',
      sourceFileName: 'id_rsa',
    })
    apiMock.listKeyVaultEntries.mockResolvedValue([legacyEntry])
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()

    const row = wrapper.get('.key-vault-row')
    expect(row.text()).toContain('旧版密钥')
    expect(row.findAll('button').some((button) => button.text() === '导入到密钥库')).toBe(true)
    expect(row.text()).not.toContain('C:/Users/test/.ssh/id_rsa')
  })

  it('edits encrypted key metadata and passphrase without validating a local file path', async () => {
    const encryptedEntry = keyVaultEntry({ usageCount: 2, notes: 'prod' })
    ;(apiMock.listKeyVaultEntries as unknown as { mockResolvedValue(value: KeyVaultEntry[]): void })
      .mockResolvedValue([encryptedEntry])
    apiMock.updateKeyVaultEntry.mockResolvedValue({ ...encryptedEntry, passphraseSaved: true })
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()

    const row = wrapper.get('.key-vault-row')
    expect(row.text()).not.toContain('已加密存入本地密钥库')
    expect(row.text()).not.toContain('id_ed25519')
    expect(wrapper.text()).not.toContain('/home/user/.ssh')
    await wrapper.find('.key-vault-row .key-vault-actions button').trigger('click')
    await wrapper.find('.key-vault-modal input[type="password"]').setValue('correct-passphrase')
    await wrapper.find('.key-vault-modal').trigger('submit')
    await Promise.resolve()

    expect(apiMock.validatePrivateKeyFile).not.toHaveBeenCalled()
    expect(apiMock.updateKeyVaultEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: 9,
      name: 'shared-key',
      privateKeyPath: '',
      passphrase: 'correct-passphrase',
      rememberPassphrase: true,
      updatePassphrase: true,
    }))
  })

  it('clears key vault passphrases after edit errors without rendering the secret', async () => {
    const encryptedEntry = keyVaultEntry({ usageCount: 1, passphraseSaved: true })
    apiMock.listKeyVaultEntries.mockResolvedValue([encryptedEntry])
    apiMock.updateKeyVaultEntry.mockRejectedValueOnce(new Error('KEY_VAULT_UPDATE_FAILED'))
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()

    await wrapper.find('.key-vault-row .key-vault-actions button').trigger('click')
    const secret = 'fixture-passphrase-never-render'
    await wrapper.find<HTMLInputElement>('.key-vault-modal input[type="password"]').setValue(secret)
    await wrapper.find('.key-vault-modal').trigger('submit')
    await flushSettingsView()

    expect(apiMock.updateKeyVaultEntry).toHaveBeenCalledWith(expect.objectContaining({
      passphrase: secret,
      updatePassphrase: true,
    }))
    expect(wrapper.text()).not.toContain(secret)
    expect(wrapper.find<HTMLInputElement>('.key-vault-modal input[type="password"]').element.value).toBe('')
  })

  it('previews and force deletes an in-use key-vault entry while refreshing servers', async () => {
    const usedEntry = keyVaultEntry({ id: 22, name: 'prod-key', usageCount: 2, passphraseSaved: true })
    let entries = [usedEntry]
    apiMock.listKeyVaultEntries.mockImplementation(() => Promise.resolve([...entries]))
    apiMock.deleteKeyVaultEntry.mockImplementation(async (request: { id: number; forceUnbind: boolean }) => {
      if (!request.forceUnbind) {
        return {
          deleted: false,
          requiresConfirmation: true,
          unboundServerCount: 2,
          unboundServerNames: ['203', 'debian'],
          secretCleanupWarning: '',
        }
      }
      entries = []
      return {
        deleted: true,
        requiresConfirmation: false,
        unboundServerCount: 2,
        unboundServerNames: ['203', 'debian'],
        secretCleanupWarning: '',
      }
    })
    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    const wrapper = mount(SettingsView, {
      props: {
        settings,
        connections: [
          { ...connectionWithProfile(''), id: 1, name: '203', authType: 'private_key', privateKeySource: 'key_vault', keyVaultId: 22 },
          { ...connectionWithProfile(''), id: 2, name: 'debian', authType: 'private_key', privateKeySource: 'key_vault', keyVaultId: 22 },
        ],
      },
    })
    await flushSettingsView()

    const deleteButton = wrapper.get<HTMLButtonElement>('.key-vault-row .danger-button')
    expect(deleteButton.attributes('disabled')).toBeUndefined()
    await deleteButton.trigger('click')
    await flushSettingsView()
    await wrapper.vm.$nextTick()

    expect(apiMock.deleteKeyVaultEntry).toHaveBeenNthCalledWith(1, { id: 22, forceUnbind: false })
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '删除密钥',
      message: expect.stringContaining('该密钥正在被 2 台服务器使用'),
      confirmText: '删除密钥并解除绑定',
      danger: true,
    }))
    expect(vi.mocked(confirmDialog).mock.calls.at(-1)?.[0].message).toContain('203、debian')
    expect(apiMock.deleteKeyVaultEntry).toHaveBeenNthCalledWith(2, { id: 22, forceUnbind: true })
    expect(wrapper.find('.key-vault-row').exists()).toBe(false)
    expect(wrapper.emitted('keyVaultDeleted')).toHaveLength(1)
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['密钥已删除，并已解除 2 台服务器的密钥绑定。', 'success'])
  })

  it('does not force delete an in-use key when the confirmation is cancelled', async () => {
    const usedEntry = keyVaultEntry({ id: 23, name: 'cancel-key', usageCount: 1 })
    apiMock.listKeyVaultEntries.mockResolvedValue([usedEntry])
    apiMock.deleteKeyVaultEntry.mockResolvedValue({
      deleted: false,
      requiresConfirmation: true,
      unboundServerCount: 1,
      unboundServerNames: ['server-a'],
      secretCleanupWarning: '',
    })
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()

    await wrapper.get('.key-vault-row .danger-button').trigger('click')
    await flushSettingsView()

    expect(apiMock.deleteKeyVaultEntry).toHaveBeenCalledTimes(1)
    expect(apiMock.deleteKeyVaultEntry).toHaveBeenCalledWith({ id: 23, forceUnbind: false })
    expect(wrapper.find('.key-vault-row').exists()).toBe(true)
    expect(wrapper.emitted('keyVaultDeleted')).toBeUndefined()
  })

  it('shows secret cleanup warnings and legacy source-file deletion boundaries', async () => {
    const legacyEntry = keyVaultEntry({
      id: 24,
      name: 'legacy-key',
      storageMode: 'legacy_file_path',
      privateKeyPath: 'C:/Users/test/.ssh/id_rsa',
      sourceFileName: 'id_rsa',
      usageCount: 0,
    })
    let entries = [legacyEntry]
    apiMock.listKeyVaultEntries.mockImplementation(() => Promise.resolve([...entries]))
    apiMock.deleteKeyVaultEntry.mockImplementation(async () => {
      entries = []
      return {
        deleted: true,
        requiresConfirmation: false,
        unboundServerCount: 0,
        unboundServerNames: [],
        secretCleanupWarning: '密钥已删除，但系统凭据中的私钥口令清理失败。',
      }
    })
    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()

    await wrapper.get('.key-vault-row .danger-button').trigger('click')
    await flushSettingsView()

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('不会删除本地原始私钥文件'),
    }))
    expect(apiMock.deleteKeyVaultEntry).toHaveBeenCalledWith({ id: 24, forceUnbind: false })
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['密钥已删除，但系统凭据中的私钥口令清理失败。', 'error'])
  })

  it('renders and saves host-key policies', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const visibleCards = wrapper.findAll('.settings-card')
      .filter((card) => !(card.attributes('style') ?? '').includes('display: none'))
    const generalText = visibleCards.map((card) => card.text()).join('\n')
    expect(generalText).toContain('SSH 主机指纹策略')
    expect(generalText).toContain('降低对中间人攻击的检测能力')
    const values = wrapper.findAll<HTMLInputElement>('input[type="radio"]')
      .map((item) => item.element.value)
      .filter((value) => ['auto_update', 'strict'].includes(value))
    expect(values).toEqual(['auto_update', 'strict'])
    await wrapper.find<HTMLInputElement>('input[value="strict"]').setValue()
    await wrapper.get('button.settings-save-button').trigger('click')
    await flushSettingsView()
    const saved = wrapper.emitted('save')?.[0]?.[0] as AppSettings
    expect(saved.hostKeyPolicy).toBe('strict')
    expect(saved.defaultRememberPassphrase).toBe(true)
  })

  it('previews and saves dark, light, and system theme modes', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const appearanceOptions = wrapper.get('[data-testid="settings-appearance-options"]')
    expect(appearanceOptions.findAll('.policy-option')).toHaveLength(3)
    expect(cssBlock('.settings-horizontal-options')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(appearanceOptions.text()).not.toContain('Windows')
    expect(appearanceOptions.text()).not.toContain('预览')
    const system = wrapper.get<HTMLInputElement>('input[value="system"]')
    await system.setValue()
    expect(wrapper.emitted('previewTheme')?.at(-1)).toEqual(['system'])
    await wrapper.get('button.settings-save-button').trigger('click')
    const saved = wrapper.emitted('save')?.[0]?.[0] as AppSettings
    expect(saved.themeMode).toBe('system')
    expect(wrapper.text()).toContain('深色')
    expect(wrapper.text()).toContain('浅色')
    expect(wrapper.text()).toContain('跟随系统')
  })

  it('previews and saves UI font sizes with the 12-18px slider bounds', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    const value = wrapper.get('[data-testid="ui-font-size-value"]')
    const slider = wrapper.get<HTMLInputElement>('[data-testid="ui-font-size-slider"]')
    const ticks = wrapper.get('[data-testid="ui-font-size-ticks"]')

    expect(value.text()).toBe('15px')
    expect(slider.attributes('min')).toBe('12')
    expect(slider.attributes('max')).toBe('18')
    expect(slider.attributes('step')).toBe('1')
    expect(ticks.findAll('.settings-font-tick')).toHaveLength(7)
    expect(ticks.text()).toContain('小')
    expect(ticks.text()).toContain('正常')
    expect(ticks.text()).toContain('最大')
    await slider.setValue('12')
    expect(value.text()).toBe('12px')
    await slider.setValue('18')
    expect(value.text()).toBe('18px')
    expect(wrapper.emitted('previewFontSize')?.at(-1)).toEqual(['max'])
    await wrapper.get('button.settings-save-button').trigger('click')
    const saved = wrapper.emitted('save')?.at(-1)?.[0] as AppSettings
    expect(saved.uiFontSize).toBe('max')
  })

  it('uses macOS shortcut defaults and labels when the platform capability is darwin', async () => {
    apiMock.getLocalTerminalCapabilities.mockResolvedValue(darwinLocalTerminalCapabilities())
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()
    await wrapper.findAll('.settings-category-nav button')
      .find((button) => button.text() === '快捷键')!
      .trigger('click')

    const shortcutPanel = wrapper.get('[data-testid="shortcut-settings"]')
    const completionSelect = shortcutPanel.get<HTMLSelectElement>('[data-testid="shortcut-row-terminalCompletion"] select')
    expect(completionSelect.element.value).toBe('meta+k')
    expect(shortcutPanel.text()).toContain('⌘K')
    expect(shortcutPanel.text()).toContain('⌘V')
    expect(shortcutPanel.text()).not.toContain('Ctrl+Shift+A')
    expect(shortcutPanel.text()).not.toContain('Windows')
  })

  it('does not show user-facing Key Vault copy in settings surfaces', async () => {
    const wrapper = mount(SettingsView, { props: { settings } })
    await flushSettingsView()
    expect(wrapper.text()).not.toContain('Key Vault')
    expect(wrapper.text()).toContain('密钥库')
  })

})
