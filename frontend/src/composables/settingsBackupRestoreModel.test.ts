import { describe, expect, it } from 'vitest'
import type { BackupImportOptions, BackupImportResult } from '../types'
import {
  backupImportOptionItems,
  backupImportOptionsEqual,
  backupPasswordLength,
  backupPasswordStrength,
  buildBackupImportPayloadOptions,
  cloneBackupImportOptions,
  defaultBackupImportOptions,
  summarizeBackupImportResult,
} from './settingsBackupRestoreModel'

describe('settingsBackupRestoreModel', () => {
  it('keeps backup import option ids, order, and Chinese labels stable', () => {
    expect(backupImportOptionItems.map((item) => item.id)).toEqual([
      'importSettings',
      'importGroups',
      'importServers',
      'importKeyVault',
      'importHostTrust',
    ])
    expect(backupImportOptionItems.map((item) => item.label)).toEqual([
      '导入设置',
      '导入分组',
      '导入服务器',
      '导入密钥库数据',
      '导入主机指纹信任记录',
    ])
  })

  it('defaults legacy or missing options to all checked while preserving saved false values', () => {
    expect(defaultBackupImportOptions()).toEqual({
      importSettings: true,
      importGroups: true,
      importServers: true,
      importKeyVault: true,
      importHostTrust: true,
    })
    expect(cloneBackupImportOptions(null)).toEqual(defaultBackupImportOptions())
    expect(cloneBackupImportOptions({
      importGroups: false,
      importKeyVault: false,
    })).toEqual({
      importSettings: true,
      importGroups: false,
      importServers: true,
      importKeyVault: false,
      importHostTrust: true,
    })
  })

  it('compares and builds import payloads from the current checked state', () => {
    const saved: BackupImportOptions = {
      importSettings: true,
      importGroups: false,
      importServers: true,
      importKeyVault: false,
      importHostTrust: true,
    }
    const current: BackupImportOptions = {
      ...saved,
      importGroups: true,
    }

    expect(backupImportOptionsEqual(saved, cloneBackupImportOptions(saved))).toBe(true)
    expect(backupImportOptionsEqual(saved, current)).toBe(false)
    expect(buildBackupImportPayloadOptions(current)).toEqual(current)
    expect(buildBackupImportPayloadOptions(current)).not.toBe(current)
  })

  it('uses existing backup password length and strength semantics', () => {
    expect(backupPasswordLength('密码密码密码')).toBe(6)
    expect(backupPasswordStrength('')).toBe('请输入备份密码')
    expect(backupPasswordStrength('12345')).toBe('备份密码至少需要 6 个字符')
    expect(backupPasswordStrength('123456')).toBe('已满足最短长度；格式不限')
  })

  it('formats import result summaries without including conflict rename text', () => {
    const result: BackupImportResult = {
      groupsAdded: 1,
      connectionsAdded: 2,
      keyVaultAdded: 3,
      hostTrustImported: 4,
      secretsRestored: 0,
      skipped: 5,
      renamed: 9,
      warnings: [{ code: 'fake-warning', message: 'fake warning' }],
      credentialsNotice: '凭据不会导入',
    }

    expect(summarizeBackupImportResult(result)).toEqual([
      '新增分组：1',
      '新增服务器：2',
      '新增密钥库：3',
      '导入主机指纹：4',
      '跳过：5',
      '警告：1',
      '警告：fake warning',
    ])
    expect(summarizeBackupImportResult(result).join('\n')).not.toContain('重命名')
  })

  it('stays pure and avoids backend, store, persistence, event-bus, and secret-material boundaries', async () => {
    // @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./settingsBackupRestoreModel.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
    expect(source).not.toMatch(/privateKey|passphrase|terminal output|remote file content|transfer file content/i)
  })
})
