import { describe, expect, it, vi } from 'vitest'
import { useSettingsBackupRestoreFlow } from './useSettingsBackupRestoreFlow'
import type { BackupExportResult, BackupImportOptions, BackupImportResult } from '../types'

function importResult(values: Partial<BackupImportResult> = {}): BackupImportResult {
  return {
    groupsAdded: 1,
    connectionsAdded: 2,
    keyVaultAdded: 1,
    hostTrustImported: 0,
    secretsRestored: 0,
    skipped: 0,
    renamed: 0,
    warnings: [],
    credentialsNotice: '凭据不会导入',
    ...values,
  }
}

function exportResult(values: Partial<BackupExportResult> = {}): BackupExportResult {
  return {
    path: 'C:/fake/hostdeck.spbackup',
    createdAt: '2026-07-03T00:00:00Z',
    mode: 'standard',
    groups: 1,
    connections: 2,
    keyVaultEntries: 1,
    hostTrustRecords: 1,
    secretEntries: 0,
    encryptedFileSize: 1024,
    ...values,
  }
}

function createFlow(initialImportOptions?: Partial<BackupImportOptions>) {
  const deps = {
    initialImportOptions,
    selectExportPath: vi.fn(async () => 'C:/fake/hostdeck.spbackup'),
    exportBackup: vi.fn(async () => exportResult()),
    selectImportFile: vi.fn(async () => 'C:/fake/hostdeck.spbackup'),
    importBackup: vi.fn(async () => importResult()),
    confirmImport: vi.fn(async () => true),
    confirmFullExport: vi.fn(async () => true),
    notify: vi.fn(),
    loadKeyVaultEntries: vi.fn(async () => undefined),
    afterBackupImported: vi.fn(),
    errorMessage: vi.fn((reason: unknown, fallback: string) => String(reason).replace(/^Error:\s*/i, '') || fallback),
  }
  return { deps, flow: useSettingsBackupRestoreFlow(deps) }
}

describe('useSettingsBackupRestoreFlow', () => {
  it('initializes import options from saved preferences and keeps manual unchecked values across file selections', async () => {
    const { flow } = createFlow({ importGroups: false, importKeyVault: false })

    expect({ ...flow.importOptions }).toEqual({
      importSettings: true,
      importGroups: false,
      importServers: true,
      importKeyVault: false,
      importHostTrust: true,
    })

    flow.setImportOption('importHostTrust', false)
    await flow.chooseImportFile()

    expect(flow.importPath.value).toBe('C:/fake/hostdeck.spbackup')
    expect(flow.importResult.value).toBeNull()
    expect(flow.importOptions.importGroups).toBe(false)
    expect(flow.importOptions.importKeyVault).toBe(false)
    expect(flow.importOptions.importHostTrust).toBe(false)
  })

  it('exports through injected callbacks, validates passwords, and clears passwords after success', async () => {
    const { deps, flow } = createFlow()

    await flow.exportBackup()
    expect(flow.exportError.value).toBe('请输入备份密码')
    expect(deps.exportBackup).not.toHaveBeenCalled()

    flow.exportPassword.value = '123456'
    flow.exportConfirmPassword.value = '654321'
    await flow.exportBackup()
    expect(flow.exportError.value).toBe('两次输入的备份密码不一致')

    flow.exportConfirmPassword.value = '123456'
    await flow.exportBackup()

    expect(deps.selectExportPath).toHaveBeenCalled()
    expect(deps.exportBackup).toHaveBeenCalledWith({
      path: 'C:/fake/hostdeck.spbackup',
      password: '123456',
      confirmPassword: '123456',
      mode: 'standard',
    })
    expect(flow.exportResult.value).toContain('导出完成：标准备份')
    expect(flow.exportPassword.value).toBe('')
    expect(flow.exportConfirmPassword.value).toBe('')
    expect(deps.notify).toHaveBeenCalledWith('备份导出成功', 'success')
  })

  it('confirms full exports before dispatching the injected export callback', async () => {
    const { deps, flow } = createFlow()
    deps.exportBackup.mockResolvedValueOnce(exportResult({ mode: 'full', secretEntries: 3 }))
    flow.exportMode.value = 'full'
    flow.exportPassword.value = '123456'
    flow.exportConfirmPassword.value = '123456'

    await flow.exportBackup()

    expect(deps.confirmFullExport).toHaveBeenCalledTimes(1)
    expect(deps.exportBackup).toHaveBeenCalledWith(expect.objectContaining({ mode: 'full' }))
    expect(flow.exportResult.value).toContain('完整备份，已加密 3 条凭据')
  })

  it('imports with the current options, refreshes key vault entries, and emits the imported callback', async () => {
    const { deps, flow } = createFlow()
    await flow.chooseImportFile()
    flow.importPassword.value = '123456'
    flow.setImportOption('importSettings', false)
    flow.setImportOption('importHostTrust', false)

    await flow.importBackup()

    expect(deps.confirmImport).toHaveBeenCalledTimes(1)
    expect(deps.importBackup).toHaveBeenCalledWith({
      path: 'C:/fake/hostdeck.spbackup',
      password: '123456',
      options: {
        importSettings: false,
        importGroups: true,
        importServers: true,
        importKeyVault: true,
        importHostTrust: false,
      },
    })
    expect(flow.importPassword.value).toBe('')
    expect(flow.importResult.value?.connectionsAdded).toBe(2)
    expect(deps.loadKeyVaultEntries).toHaveBeenCalledTimes(1)
    expect(deps.afterBackupImported).toHaveBeenCalledTimes(1)
  })

  it('surfaces existing import validation and rollback errors through injected helpers', async () => {
    const { deps, flow } = createFlow()

    await flow.importBackup()
    expect(flow.importError.value).toBe('请选择备份文件')
    expect(deps.notify).toHaveBeenLastCalledWith('请选择备份文件', 'error')

    await flow.chooseImportFile()
    await flow.importBackup()
    expect(flow.importError.value).toBe('请输入备份密码')

    flow.importPassword.value = '12345'
    await flow.importBackup()
    expect(flow.importError.value).toBe('备份密码至少需要 6 个字符')

    deps.importBackup.mockRejectedValueOnce(new Error('BACKUP_IMPORT_ROLLBACK: 导入失败，已回滚所有更改'))
    deps.errorMessage.mockReturnValueOnce('导入失败（已回滚）')
    flow.importPassword.value = '123456'
    await flow.importBackup()
    expect(flow.importError.value).toBe('导入失败（已回滚）')
    expect(deps.notify).toHaveBeenLastCalledWith('导入失败（已回滚）', 'error')
  })

  it('does not own backend, stores, persistence, event bus, or app controllers', async () => {
    // @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./useSettingsBackupRestoreFlow.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
    expect(source).not.toMatch(/privateKey|passphrase|terminal output|remote file content|local file content|transfer file content|docker logs/i)
  })
})
