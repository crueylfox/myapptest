import { computed, nextTick, reactive, ref } from 'vue'
import type {
  BackupExportRequest,
  BackupExportResult,
  BackupImportOptions,
  BackupImportRequest,
  BackupImportResult,
} from '../types'
import {
  backupPasswordLength,
  backupPasswordStrength as getBackupPasswordStrength,
  buildBackupImportPayloadOptions,
  cloneBackupImportOptions,
  type BackupImportOptionId,
} from './settingsBackupRestoreModel'

type ToastType = 'success' | 'error' | 'info'

export interface SettingsBackupRestoreFlowOptions {
  initialImportOptions?: Partial<BackupImportOptions> | null
  selectExportPath: () => Promise<string>
  exportBackup: (request: BackupExportRequest) => Promise<BackupExportResult>
  selectImportFile: () => Promise<string>
  importBackup: (request: BackupImportRequest) => Promise<BackupImportResult>
  confirmImport: () => Promise<boolean>
  confirmFullExport: () => Promise<boolean>
  notify: (message: string, type: ToastType) => void
  loadKeyVaultEntries: () => Promise<void>
  afterBackupImported: () => void
  errorMessage: (reason: unknown, fallback: string) => string
}

export function useSettingsBackupRestoreFlow(options: SettingsBackupRestoreFlowOptions) {
  const exportPath = ref('')
  const exportPassword = ref('')
  const exportConfirmPassword = ref('')
  const exportMode = ref<'standard' | 'full'>('standard')
  const exportBusy = ref(false)
  const exportError = ref('')
  const exportResult = ref('')
  const importPath = ref('')
  const importPassword = ref('')
  const importBusy = ref(false)
  const importError = ref('')
  const importResult = ref<BackupImportResult | null>(null)
  const importOptions = reactive<BackupImportOptions>(
    cloneBackupImportOptions(options.initialImportOptions),
  )
  const exportPasswordStrength = computed(() => getBackupPasswordStrength(exportPassword.value))

  function applyImportOptions(value?: Partial<BackupImportOptions> | null) {
    Object.assign(importOptions, cloneBackupImportOptions(value))
  }

  function snapshotImportOptions() {
    return cloneBackupImportOptions(importOptions)
  }

  function setImportOption(id: BackupImportOptionId, checked: boolean) {
    importOptions[id] = checked
  }

  async function chooseExportPath() {
    exportError.value = ''
    const path = await options.selectExportPath()
    if (path) exportPath.value = path
  }

  async function exportBackup() {
    exportError.value = ''
    exportResult.value = ''
    if (!exportPassword.value) {
      exportError.value = '请输入备份密码'
      return
    }
    if (exportPassword.value !== exportConfirmPassword.value) {
      exportError.value = '两次输入的备份密码不一致'
      return
    }
    if (backupPasswordLength(exportPassword.value) < 6) {
      exportError.value = '备份密码至少需要 6 个字符'
      return
    }
    if (!exportPath.value) {
      await chooseExportPath()
      if (!exportPath.value) return
    }
    if (exportMode.value === 'full' && !await options.confirmFullExport()) return
    exportBusy.value = true
    try {
      const result = await options.exportBackup({
        path: exportPath.value,
        password: exportPassword.value,
        confirmPassword: exportConfirmPassword.value,
        mode: exportMode.value,
      })
      const modeLabel = result.mode === 'full' ? `完整备份，已加密 ${result.secretEntries} 条凭据` : '标准备份'
      exportResult.value = `导出完成：${modeLabel}；${result.connections} 台服务器，${result.groups} 个分组，${result.keyVaultEntries} 个密钥库条目。`
      options.notify('备份导出成功', 'success')
      exportPassword.value = ''
      exportConfirmPassword.value = ''
    } catch (reason) {
      exportError.value = options.errorMessage(reason, '导出备份失败')
      options.notify(exportError.value, 'error')
    } finally {
      exportBusy.value = false
    }
  }

  async function chooseImportFile() {
    importError.value = ''
    const path = await options.selectImportFile()
    if (path) {
      importPath.value = path
      importResult.value = null
    }
  }

  async function importBackup() {
    importError.value = ''
    const path = importPath.value.trim()
    if (!path) {
      importError.value = '请选择备份文件'
      options.notify(importError.value, 'error')
      return
    }
    if (!importPassword.value) {
      importError.value = '请输入备份密码'
      options.notify(importError.value, 'error')
      return
    }
    if (backupPasswordLength(importPassword.value) < 6) {
      importError.value = '备份密码至少需要 6 个字符'
      options.notify(importError.value, 'error')
      return
    }
    if (!await options.confirmImport()) return
    importBusy.value = true
    try {
      importResult.value = await options.importBackup({
        path,
        password: importPassword.value,
        options: buildBackupImportPayloadOptions(importOptions),
      })
      importPassword.value = ''
      await options.loadKeyVaultEntries()
      importBusy.value = false
      await nextTick()
      options.afterBackupImported()
    } catch (reason) {
      importError.value = options.errorMessage(reason, '导入备份失败')
      options.notify(importError.value, 'error')
    } finally {
      importBusy.value = false
    }
  }

  return {
    exportPath,
    exportPassword,
    exportConfirmPassword,
    exportMode,
    exportBusy,
    exportError,
    exportResult,
    exportPasswordStrength,
    importPath,
    importPassword,
    importBusy,
    importError,
    importResult,
    importOptions,
    applyImportOptions,
    snapshotImportOptions,
    setImportOption,
    chooseExportPath,
    exportBackup,
    chooseImportFile,
    importBackup,
  }
}
