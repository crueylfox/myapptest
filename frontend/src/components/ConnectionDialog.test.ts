// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionDialog from './ConnectionDialog.vue'
import type { AppSettings, Connection, KeyVaultEntry } from '../types'
import { defaultAlertSettings } from '../utils/alertSettings'
import { defaultShortcutSettings } from '../utils/shortcutSettings'

const apiMock = vi.hoisted(() => ({
  selectPrivateKeyFile: vi.fn(() => Promise.resolve('C:/Users/test/.ssh/id_ed25519')),
  validatePrivateKeyFile: vi.fn(() => Promise.resolve({
    algorithm: 'ssh-ed25519',
    fingerprintSHA256: 'SHA256:imported',
    keyBits: 256,
    encrypted: false,
    valid: true,
    errorCode: '',
    userMessage: '',
    technicalMessage: '',
  })),
  createKeyVaultEntry: vi.fn(() => Promise.resolve({
    id: 4,
    name: 'id_ed25519',
    privateKeyPath: '',
    storageMode: 'encrypted_database',
    sourceFileName: 'id_ed25519',
    algorithm: 'ssh-ed25519',
    keyBits: 256,
    publicKeyFingerprintSHA256: 'SHA256:imported',
    encrypted: false,
    requiresPassphrase: false,
    protectionVersion: 1,
    passphraseSaved: false,
    usageCount: 0,
    notes: '',
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
  })),
  listKeyVaultEntries: vi.fn<() => Promise<KeyVaultEntry[]>>(() => Promise.resolve([{
    id: 3,
    name: 'deploy',
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
    usageCount: 2,
    notes: '',
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
  } as KeyVaultEntry])),
}))

const dialogMock = vi.hoisted(() => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../api/backend', () => ({
  api: {
    ...apiMock,
  },
}))

vi.mock('../composables/useAppDialog', () => ({
  confirmDialog: dialogMock.confirmDialog,
}))

const settings: AppSettings = {
  defaultRememberPassword: false,
  defaultRememberPassphrase: false,
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
  onboardingCompleted: true,
  trustOnFirstUseAcknowledged: false,
}

const savedConnection: Connection = {
  id: 7,
  groupId: null,
  name: 'server',
  host: 'example.test',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  terminalProfileId: null,
  hostKeyFingerprint: '',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

function keyVaultEntry(overrides: Partial<KeyVaultEntry> = {}): KeyVaultEntry {
  return {
    id: 3,
    name: 'deploy',
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
    usageCount: 2,
    notes: '',
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
    ...overrides,
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ConnectionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listKeyVaultEntries.mockResolvedValue([keyVaultEntry()])
    dialogMock.confirmDialog.mockResolvedValue(true)
  })

  it('marks the server name optional and submits blank names for backend normalization', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: {
        open: true,
        connection: null,
        groups: [{ id: 1, name: '生产', createdAt: '', updatedAt: '' }],
        settings,
      },
    })

    const name = wrapper.get<HTMLInputElement>('[data-testid="name"]')
    expect(wrapper.text()).toContain('名称（可选）')
    expect(name.attributes('required')).toBeUndefined()
    expect(name.attributes('placeholder')).toContain('留空时使用')
    expect(wrapper.text()).toContain('未填写名称时')

    const rows = wrapper.findAll('.connection-form-row')
    const rail = wrapper.get('.connection-dialog-rail')
    expect(rail.element.contains(wrapper.get('.connection-dialog-header').element)).toBe(true)
    expect(rail.element.contains(wrapper.get('.connection-form').element)).toBe(true)
    expect(rail.element.contains(wrapper.get('.connection-dialog-footer').element)).toBe(true)
    expect(wrapper.find('.connection-dialog-header .connection-dialog-close').exists()).toBe(false)
    expect(rows[0].classes()).toEqual(expect.arrayContaining(['is-long-short']))
    expect(rows[0].find('[data-testid="name"]').exists()).toBe(true)
    expect(rows[0].find('[data-testid="group"]').exists()).toBe(true)
    expect(rows[0].get('[data-testid="name"]').element.closest('.connection-field')?.classList.contains('is-long')).toBe(true)
    expect(rows[0].get('[data-testid="group"]').element.closest('.connection-field')?.classList.contains('is-short')).toBe(true)
    expect(rows[1].classes()).toEqual(expect.arrayContaining(['is-long-short']))
    expect(rows[1].find('[data-testid="host"]').exists()).toBe(true)
    expect(rows[1].find('[data-testid="port"]').exists()).toBe(true)
    expect(rows[2].find('[data-testid="username"]').exists()).toBe(true)
    expect(rows[2].find('[data-testid="auth-type"]').exists()).toBe(true)

    await wrapper.get('[data-testid="host"]').setValue('192.168.0.88')
    await wrapper.get('form').trigger('submit')
    const request = wrapper.emitted('save')?.[0]?.[0] as {
      connection: { name: string; host: string; port: number }
    }
    expect(request.connection.name).toBe('')
    expect(request.connection.host).toBe('192.168.0.88')
    expect(request.connection.port).toBe(22)
  })

  it('defaults new monitor refresh to one second without overwriting edited connections', () => {
    const fresh = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    expect(fresh.get<HTMLSelectElement>('[data-testid="refresh-interval"]').element.value).toBe('1')

    const edited = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })
    expect(edited.get<HTMLSelectElement>('[data-testid="refresh-interval"]').element.value).toBe('2')
  })

  it('keeps the backdrop from closing and places terminal profile after auth fields', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })

    await wrapper.get('.modal-backdrop').trigger('pointerdown')
    expect(wrapper.emitted('close')).toBeUndefined()

    let fields = Array.from(wrapper.get('form').element.querySelectorAll<HTMLElement>('[data-testid]'))
      .map((element) => element.dataset.testid)
    expect(fields.indexOf('auth-type')).toBeLessThan(fields.indexOf('password'))
    expect(fields.indexOf('password')).toBeLessThan(fields.indexOf('terminal-profile-select'))

    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    fields = Array.from(wrapper.get('form').element.querySelectorAll<HTMLElement>('[data-testid]'))
      .map((element) => element.dataset.testid)
    expect(fields.indexOf('auth-type')).toBeLessThan(fields.indexOf('private-key-source'))
    expect(fields.indexOf('private-key-source')).toBeLessThan(fields.indexOf('key-vault-select'))
    expect(fields.indexOf('key-vault-select')).toBeLessThan(fields.indexOf('terminal-profile-select'))
    expect(wrapper.find('[data-testid="passphrase"]').exists()).toBe(false)
  })

  it('defaults remember password on and switches password/private-key fields', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    const rail = wrapper.get('.connection-dialog-rail')
    const footer = wrapper.get('.connection-dialog-footer')
    expect(wrapper.get<HTMLInputElement>('[data-testid="remember-secret"]').element.checked).toBe(true)
    expect(wrapper.find('[data-testid="password"]').exists()).toBe(true)
    expect(rail.element.contains(footer.element)).toBe(true)

    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    expect(wrapper.find('[data-testid="password"]').exists()).toBe(false)
    await flushPromises()
    expect(wrapper.find('[data-testid="passphrase"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="key-vault-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="remember-secret"]').exists()).toBe(false)
    expect(wrapper.get('.connection-dialog-rail').element.contains(wrapper.get('.connection-dialog-footer').element)).toBe(true)
  })

  it('switches saved password servers to key auth without a credential deletion confirmation', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })

    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    await flushPromises()

    expect(dialogMock.confirmDialog).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="password"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="key-vault-select"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('凭据状态：已保存')
  })

  it('switches back from key auth to password with a masked unchanged saved password', async () => {
    const keyConnection: Connection = {
      ...savedConnection,
      authType: 'private_key',
      privateKeySource: 'key_vault',
      keyVaultId: 3,
      credentialSaved: false,
      passwordCredentialSaved: true,
    }
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: keyConnection, groups: [], settings },
    })
    await flushPromises()

    await wrapper.get('[data-testid="auth-type"]').setValue('password')
    await flushPromises()
    await wrapper.get('form').trigger('submit')

    expect(dialogMock.confirmDialog).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('[data-testid="password"]').element.value).toBe('********')
    expect(wrapper.text()).toContain('凭据状态：已保存')
    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string; secretUpdateMode: string }
      connection: { authType: string }
    }
    expect(request.connection.authType).toBe('password')
    expect(request.auth.password).toBe('')
    expect(request.auth.secretUpdateMode).toBe('unchanged')
  })

  it('shows a fixed saved-password mask and preserves it as unchanged', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })
    expect(wrapper.get<HTMLInputElement>('[data-testid="password"]').element.value).toBe('********')
    expect(wrapper.text()).toContain('凭据状态：已保存')
    await wrapper.get('form').trigger('submit')
    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string; rememberSecret: boolean; secretUpdateMode: string }
      connectAfterSave: boolean
    }
    expect(request.auth.password).toBe('')
    expect(request.auth.rememberSecret).toBe(true)
    expect(request.auth.secretUpdateMode).toBe('unchanged')
    expect(request.connectAfterSave).toBe(false)
  })

  it('clears the saved-password mask when the user enters a replacement password', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })

    await wrapper.get('[data-testid="password"]').setValue('replacement-password')
    await wrapper.get('form').trigger('submit')

    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string; rememberSecret: boolean; secretUpdateMode: string }
    }
    expect(request.auth.password).toBe('replacement-password')
    expect(request.auth.rememberSecret).toBe(true)
    expect(request.auth.secretUpdateMode).toBe('set')
  })

  it('clearing the saved-password mask without explicit delete keeps the saved password unchanged', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })

    await wrapper.get('[data-testid="password"]').trigger('focus')
    expect(wrapper.get<HTMLInputElement>('[data-testid="password"]').element.value).toBe('')
    await wrapper.get('form').trigger('submit')

    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string; rememberSecret: boolean; secretUpdateMode: string }
    }
    expect(request.auth.password).toBe('')
    expect(request.auth.rememberSecret).toBe(true)
    expect(request.auth.secretUpdateMode).toBe('unchanged')
  })

  it('emits an explicit unchanged secret update mode when a saved password stays blank', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })

    await wrapper.get('[data-testid="host"]').setValue('198.51.100.77')
    await wrapper.get('form').trigger('submit')

    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string; rememberSecret: boolean; secretUpdateMode: string }
      connection: { host: string }
    }
    expect(request.connection.host).toBe('198.51.100.77')
    expect(request.auth.password).toBe('')
    expect(request.auth.rememberSecret).toBe(true)
    expect(request.auth.secretUpdateMode).toBe('unchanged')
  })

  it('emits set secret update mode only when the user enters a replacement password', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: savedConnection, groups: [], settings },
    })

    await wrapper.get('[data-testid="password"]').setValue('replacement-password')
    await wrapper.get('[data-testid="remember-secret"]').setValue(true)
    await wrapper.get('form').trigger('submit')

    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string; rememberSecret: boolean; secretUpdateMode: string }
    }
    expect(request.auth.password).toBe('replacement-password')
    expect(request.auth.rememberSecret).toBe(true)
    expect(request.auth.secretUpdateMode).toBe('set')
  })

  it('emits current credentials once for save-and-connect', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    await wrapper.get('[data-testid="name"]').setValue('server')
    await wrapper.get('[data-testid="host"]').setValue('example.test')
    await wrapper.get('[data-testid="password"]').setValue('runtime-only-value')
    await wrapper.get('[data-testid="save-connect"]').trigger('click')
    const request = wrapper.emitted('save')?.[0]?.[0] as {
      auth: { password: string }
      connectAfterSave: boolean
    }
    expect(request.connectAfterSave).toBe(true)
    expect(request.auth.password).toBe('runtime-only-value')
    expect(wrapper.get<HTMLInputElement>('[data-testid="password"]').element.value).toBe('')
  })

  it('emits the selected terminal profile override with the server config', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: {
        open: true,
        connection: null,
        groups: [],
        settings,
        terminalProfiles: [{
          id: 'tp-ops',
          name: 'Ops',
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
          selectionBackground: '#3f7dff66',
          cursorColor: '#f5f7fa',
          createdAt: '',
          updatedAt: '',
        }],
      },
    })
    await wrapper.get('[data-testid="name"]').setValue('server')
    await wrapper.get('[data-testid="host"]').setValue('example.test')
    await wrapper.get('[data-testid="terminal-profile-select"]').setValue('tp-ops')
    await wrapper.get('form').trigger('submit')

    const request = wrapper.emitted('save')?.[0]?.[0] as {
      connection: { terminalProfileId: string | null }
    }
    expect(request.connection.terminalProfileId).toBe('tp-ops')
  })

  it('renders connection route after auth and before terminal profile', async () => {
    const jump: Connection = {
      ...savedConnection,
      id: 8,
      name: '堡垒机A',
      host: '198.51.100.8',
      connectionMode: 'direct',
      jumpServerId: null,
    }
    const nested: Connection = {
      ...savedConnection,
      id: 9,
      name: '已经走跳板',
      connectionMode: 'jump',
      jumpServerId: 8,
    }
    const wrapper = mount(ConnectionDialog, {
      props: {
        open: true,
        connection: savedConnection,
        groups: [],
        settings,
        connections: [savedConnection, jump, nested],
      },
    })

    const fields = Array.from(wrapper.get('form').element.querySelectorAll<HTMLElement>('[data-testid]'))
      .map((element) => element.dataset.testid)
    expect(fields.indexOf('password')).toBeLessThan(fields.indexOf('connection-route-select'))
    expect(fields.indexOf('connection-route-select')).toBeLessThan(fields.indexOf('terminal-profile-select'))

    const options = Array.from(wrapper.get<HTMLSelectElement>('[data-testid="connection-route-select"]').element.options)
      .map((option) => option.textContent?.trim())
    expect(options).toEqual(['直接连接', '通过：堡垒机A'])
    expect(options).not.toContain('通过：server')
    expect(options).not.toContain('通过：已经走跳板')
  })

  it('submits selected jump route and clears stale jump reference for direct route', async () => {
    const jump: Connection = {
      ...savedConnection,
      id: 8,
      name: '堡垒机A',
      host: '198.51.100.8',
      connectionMode: 'direct',
      jumpServerId: null,
    }
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings, connections: [jump] },
    })
    await wrapper.get('[data-testid="name"]').setValue('target')
    await wrapper.get('[data-testid="host"]').setValue('10.0.0.8')
    await wrapper.get('[data-testid="connection-route-select"]').setValue('jump:8')
    await wrapper.get('form').trigger('submit')

    let request = wrapper.emitted('save')?.[0]?.[0] as {
      connection: { connectionMode: string; jumpServerId: number | null }
    }
    expect(request.connection.connectionMode).toBe('jump')
    expect(request.connection.jumpServerId).toBe(8)

    await wrapper.get('[data-testid="connection-route-select"]').setValue('direct')
    await wrapper.get('form').trigger('submit')
    request = wrapper.emitted('save')?.[1]?.[0] as {
      connection: { connectionMode: string; jumpServerId: number | null }
    }
    expect(request.connection.connectionMode).toBe('direct')
    expect(request.connection.jumpServerId).toBeNull()
  })

  it('keeps missing jump route visible and requires reselection before save', async () => {
    const missingJumpConnection: Connection = {
      ...savedConnection,
      connectionMode: 'jump',
      jumpServerId: null,
    }
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: missingJumpConnection, groups: [], settings, connections: [] },
    })

    expect(wrapper.get('[data-testid="jump-server-missing"]').text()).toContain('跳板机已不存在')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('请选择跳板机')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('uses key-vault private keys for new private-key auth submissions', async () => {
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    await wrapper.get('[data-testid="name"]').setValue('server')
    await wrapper.get('[data-testid="host"]').setValue('example.test')
    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    await flushPromises()
    expect(wrapper.find('[data-testid="passphrase"]').exists()).toBe(false)
    expect(wrapper.find('.connection-key-control input').exists()).toBe(false)
    expect(wrapper.find('[data-testid="key-vault-select"]').exists()).toBe(true)
    await wrapper.get('[data-testid="save-connect"]').trigger('click')
    const request = wrapper.emitted('save')?.[0]?.[0] as {
      connection: { privateKeySource: string; keyVaultId: number | null; privateKeyPath: string }
    }
    expect(request.connection.privateKeySource).toBe('key_vault')
    expect(request.connection.keyVaultId).toBe(3)
    expect(request.connection.privateKeyPath).toBe('')
  })

  it('renders selected key-vault details as a compact two-line preview', async () => {
    apiMock.listKeyVaultEntries.mockResolvedValue([keyVaultEntry({
      id: 3,
      name: '我',
      algorithm: 'ssh-rsa',
      keyBits: 2048,
      publicKeyFingerprintSHA256: 'SHA256:+RwDYMtlEU4qOnTmey41Qg7IP5OopdpRbmHDfr1PTDQ',
      storageMode: 'encrypted_database',
      passphraseSaved: false,
    })])
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    await flushPromises()

    const optionText = wrapper.get<HTMLSelectElement>('[data-testid="key-vault-select"]').element.options[1]?.textContent ?? ''
    expect(optionText).toBe('我 · ssh-rsa 2048')
    expect(optionText).not.toContain('SHA256:')
    const summary = wrapper.get('[data-testid="selected-key-vault-summary"]')
    expect(summary.get('strong').text()).toBe('我·ssh-rsa 2048')
    expect(summary.get('small').text()).toBe('SHA256:+RwDYMtlEU4qOnTmey41Qg7IP5OopdpRbmHDfr1PTDQ')
    expect(summary.text()).not.toContain('已加密存入本地密钥库')
    expect(summary.text()).not.toContain('连接时输入口令')
    expect(summary.text()).not.toContain('不依赖原文件')
    expect(summary.text()).not.toContain('已保存口令')
  })

  it('does not show deleted-key state for a new server with no selected key', async () => {
    apiMock.listKeyVaultEntries.mockResolvedValue([keyVaultEntry({ id: 9, name: 'other-key' })])
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    await flushPromises()
    await wrapper.get('[data-testid="key-vault-select"]').setValue('')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="connection-key-vault-missing"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('所选密钥已被删除')
  })

  it('opens inline key import and auto-selects the imported key without clearing the server form', async () => {
    apiMock.listKeyVaultEntries
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 4,
        name: 'id_ed25519',
        privateKeyPath: '',
        storageMode: 'encrypted_database',
        sourceFileName: 'id_ed25519',
        algorithm: 'ssh-ed25519',
        keyBits: 256,
        publicKeyFingerprintSHA256: 'SHA256:imported',
        encrypted: false,
        requiresPassphrase: false,
        protectionVersion: 1,
        passphraseSaved: false,
        usageCount: 0,
        notes: '',
        createdAt: '',
        updatedAt: '',
        lastUsedAt: '',
      }])
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    await wrapper.get('[data-testid="host"]').setValue('example.test')
    await wrapper.get('[data-testid="username"]').setValue('deploy')
    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    await flushPromises()

    expect(wrapper.get('[data-testid="connection-key-vault-empty"]').text()).toContain('密钥库中还没有私钥')
    await wrapper.get('[data-testid="connection-add-key"]').trigger('click')
    expect(wrapper.find('.connection-key-import-modal .dialog-close-button').exists()).toBe(false)
    await wrapper.get('.connection-key-import-modal .file-input button').trigger('click')
    await flushPromises()
    await wrapper.get('.connection-key-import-modal .validation-panel button').trigger('click')
    await flushPromises()
    await wrapper.get('.connection-key-import-modal').trigger('submit')
    await flushPromises()

    expect(apiMock.createKeyVaultEntry).toHaveBeenCalledWith(expect.objectContaining({
      privateKeyPath: 'C:/Users/test/.ssh/id_ed25519',
      rememberPassphrase: true,
    }))
    expect(wrapper.find('[data-testid="connection-key-import-modal"]').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('[data-testid="host"]').element.value).toBe('example.test')
    expect(wrapper.get<HTMLInputElement>('[data-testid="username"]').element.value).toBe('deploy')
    expect(wrapper.get<HTMLSelectElement>('[data-testid="key-vault-select"]').element.value).toBe('4')
  })

  it('does not auto-select another key for an edited server whose key was deleted', async () => {
    const missingKeyConnection: Connection = {
      ...savedConnection,
      authType: 'private_key',
      privateKeySource: 'key_vault',
      keyVaultId: null,
      credentialSaved: false,
    }
    apiMock.listKeyVaultEntries.mockResolvedValue([keyVaultEntry({ id: 9, name: 'other-key' })])
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: missingKeyConnection, groups: [], settings },
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    const select = wrapper.get<HTMLSelectElement>('[data-testid="key-vault-select"]').element
    expect(select.value).not.toBe('9')
    expect(select.selectedOptions[0]?.textContent).toContain('未选择')
    expect(wrapper.get('[data-testid="connection-key-vault-missing"]').text()).toContain('所选密钥已被删除')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('所选密钥已被删除，请重新选择或添加密钥。')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('uses the shared textarea styling for inline key import notes', async () => {
    apiMock.listKeyVaultEntries.mockResolvedValue([])
    const wrapper = mount(ConnectionDialog, {
      props: { open: true, connection: null, groups: [], settings },
    })
    await wrapper.get('[data-testid="auth-type"]').setValue('private_key')
    await flushPromises()
    await wrapper.get('[data-testid="connection-add-key"]').trigger('click')
    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="connection-key-import-modal"] textarea.key-import-remark')

    expect(textarea.classes()).toContain('app-textarea')
    expect(textarea.classes()).toContain('key-import-remark')
    expect(textarea.attributes('rows')).toBe('3')
    expect(textarea.attributes('placeholder')).toBe('可选')
  })
})
