import type { BackupImportOptions, BackupImportResult } from '../types'

export type BackupImportOptionId = keyof BackupImportOptions

export const backupImportOptionItems: Array<{ id: BackupImportOptionId; label: string }> = [
  { id: 'importSettings', label: '导入设置' },
  { id: 'importGroups', label: '导入分组' },
  { id: 'importServers', label: '导入服务器' },
  { id: 'importKeyVault', label: '导入密钥库数据' },
  { id: 'importHostTrust', label: '导入主机指纹信任记录' },
]

export function defaultBackupImportOptions(): BackupImportOptions {
  return {
    importSettings: true,
    importGroups: true,
    importServers: true,
    importKeyVault: true,
    importHostTrust: true,
  }
}

export function cloneBackupImportOptions(value?: Partial<BackupImportOptions> | null): BackupImportOptions {
  return { ...defaultBackupImportOptions(), ...(value ?? {}) }
}

export function backupImportOptionsEqual(
  left?: Partial<BackupImportOptions> | null,
  right?: Partial<BackupImportOptions> | null,
) {
  const normalizedLeft = cloneBackupImportOptions(left)
  const normalizedRight = cloneBackupImportOptions(right)
  return backupImportOptionItems.every((item) => normalizedLeft[item.id] === normalizedRight[item.id])
}

export function buildBackupImportPayloadOptions(value: Partial<BackupImportOptions>): BackupImportOptions {
  return cloneBackupImportOptions(value)
}

export function backupPasswordLength(value: string) {
  return [...value].length
}

export function backupPasswordStrength(value: string) {
  const length = backupPasswordLength(value)
  if (!length) return '请输入备份密码'
  if (length < 6) return '备份密码至少需要 6 个字符'
  return '已满足最短长度；格式不限'
}

export function summarizeBackupImportResult(result: BackupImportResult) {
  const summary = [
    `新增分组：${result.groupsAdded}`,
    `新增服务器：${result.connectionsAdded}`,
    `新增 Key Vault：${result.keyVaultAdded}`,
    `导入主机指纹：${result.hostTrustImported}`,
  ]
  if (result.secretsRestored) summary.push(`恢复凭据：${result.secretsRestored}`)
  summary.push(`跳过：${result.skipped}`)
  summary.push(`警告：${result.warnings.length}`)
  for (const message of uniqueWarningMessages(result)) {
    summary.push(`警告：${message}`)
  }
  return summary
}

function uniqueWarningMessages(result: BackupImportResult) {
  const seen = new Set<string>()
  const messages: string[] = []
  for (const warning of result.warnings) {
    const message = warning.message?.trim()
    if (!message || seen.has(message)) continue
    seen.add(message)
    messages.push(message)
  }
  return messages
}
