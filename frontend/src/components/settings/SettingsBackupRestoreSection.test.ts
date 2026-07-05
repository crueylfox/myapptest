// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsBackupRestoreSection from './SettingsBackupRestoreSection.vue'
import type { BackupImportOptions, BackupImportResult } from '../../types'

function importOptions(overrides: Partial<BackupImportOptions> = {}): BackupImportOptions {
  return {
    importSettings: true,
    importGroups: true,
    importServers: true,
    importKeyVault: true,
    importHostTrust: true,
    ...overrides,
  }
}

function importResult(): BackupImportResult {
  return {
    groupsAdded: 1,
    connectionsAdded: 2,
    keyVaultAdded: 1,
    hostTrustImported: 1,
    secretsRestored: 0,
    skipped: 3,
    renamed: 0,
    warnings: [{ code: 'fake', message: 'fake warning' }],
    credentialsNotice: '凭据不会导入',
  }
}

function mountSection(props = {}) {
  return mount(SettingsBackupRestoreSection, {
    props: {
      exportPath: '',
      exportPassword: '',
      exportConfirmPassword: '',
      exportMode: 'standard',
      exportPasswordStrength: '请输入备份密码',
      exportBusy: false,
      exportError: '',
      exportResult: '',
      importPath: '',
      importPassword: '',
      importBusy: false,
      importError: '',
      importResult: null,
      importOptions: importOptions(),
      ...props,
    },
  })
}

describe('SettingsBackupRestoreSection', () => {
  it('renders the existing backup export and import entries without native browser dialogs', () => {
    const wrapper = mountSection()

    expect(wrapper.text()).toContain('备份与恢复')
    expect(wrapper.text()).toContain('导出备份')
    expect(wrapper.text()).toContain('导入备份')
    expect(wrapper.text()).not.toContain('验证备份')
    expect(wrapper.get('[data-testid="backup-export-mode"]').text()).toContain('标准备份（安全）')
    expect(wrapper.get('[data-testid="backup-import-options"]').text()).toContain('重复服务器会按主机、端口和用户名更新现有记录')
  })

  it('renders five stable import options and emits option updates instead of mutating props directly', async () => {
    const wrapper = mountSection()
    const options = wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]')

    expect(options).toHaveLength(5)
    expect(options.map((box) => box.element.checked)).toEqual([true, true, true, true, true])
    expect(wrapper.get('[data-testid="backup-import-options"]').text()).toContain('导入密钥库数据')
    expect(wrapper.text()).not.toContain('导入 Key Vault 元数据')

    await options[3].setValue(false)

    expect(wrapper.emitted('update:importOption')?.at(-1)).toEqual(['importKeyVault', false])
  })

  it('emits file, password, mode, export, and import actions through the presentation boundary', async () => {
    const wrapper = mountSection()
    const browseButtons = wrapper.findAll('button').filter((button) => button.text() === '浏览…')
    await browseButtons[0].trigger('click')
    await browseButtons[1].trigger('click')

    const passwordInputs = wrapper.findAll<HTMLInputElement>('input[type="password"]')
    await passwordInputs[0].setValue('123456')
    await passwordInputs[1].setValue('123456')
    await passwordInputs[2].setValue('abcdef')
    await wrapper.get<HTMLInputElement>('input[value="full"]').setValue()
    await wrapper.findAll('button').find((button) => button.text() === '导出加密备份')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '导入备份')!.trigger('click')

    expect(wrapper.emitted('chooseExportPath')).toHaveLength(1)
    expect(wrapper.emitted('chooseImportFile')).toHaveLength(1)
    expect(wrapper.emitted('update:exportPassword')?.at(-1)).toEqual(['123456'])
    expect(wrapper.emitted('update:exportConfirmPassword')?.at(-1)).toEqual(['123456'])
    expect(wrapper.emitted('update:importPassword')?.at(-1)).toEqual(['abcdef'])
    expect(wrapper.emitted('update:exportMode')?.at(-1)).toEqual(['full'])
    expect(wrapper.emitted('exportBackup')).toHaveLength(1)
    expect(wrapper.emitted('importBackup')).toHaveLength(1)
  })

  it('keeps disabled/loading and result states visible with the existing copy', () => {
    const wrapper = mountSection({
      exportBusy: true,
      importBusy: true,
      exportError: '导出备份失败',
      importError: '导入失败（已回滚）',
      exportResult: '导出完成：标准备份；2 台服务器，1 个分组，1 个密钥库条目。',
      importResult: importResult(),
      importOptions: importOptions({ importHostTrust: false }),
    })

    expect((wrapper.findAll('button').find((button) => button.text() === '导出加密备份')!.element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.findAll('button').find((button) => button.text() === '导入备份')!.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.text()).toContain('导出备份失败')
    expect(wrapper.text()).toContain('导入失败（已回滚）')
    expect(wrapper.text()).toContain('导出完成：标准备份')
    expect(wrapper.get('[data-testid="backup-result"]').text()).toContain('新增服务器：2')
    expect(wrapper.get('[data-testid="backup-result"]').text()).not.toContain('重命名')
    expect(wrapper.findAll<HTMLInputElement>('[data-testid="backup-import-options"] input[type="checkbox"]').at(-1)!.element.checked).toBe(false)
  })
})
