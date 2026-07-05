import type { SFTPInspectDeleteResponse } from '../types'
import { formatBytes } from './format'
import type { SftpDisplayEntry } from './sftpDisplayEntries'

export function buildSftpDeleteConfirmMessage(
  targets: Pick<SftpDisplayEntry, 'path' | 'isDir'>[],
  preview: SFTPInspectDeleteResponse,
) {
  const directFileCount = targets.filter((entry) => !entry.isDir).length
  const directDirCount = targets.filter((entry) => entry.isDir).length
  const targetText = targets.length === 1
    ? `操作对象：${targets[0].path}`
    : `将删除 ${targets.length} 个选中项，其中包含 ${directFileCount} 个文件、${directDirCount} 个目录。`
  const counts = `预检统计：${preview.fileCount} 个文件、${preview.directoryCount} 个目录、${preview.symlinkCount} 个符号链接，共 ${formatBytes(preview.totalBytes || 0)}。`
  const danger = preview.directoryCount > 0
    ? '此操作会递归删除目录内所有文件和子目录，无法撤销。'
    : '此操作会删除选中的远程文件，无法撤销。'
  const warnings = preview.warnings?.length ? ` 预检警告：${preview.warnings.join('；')}` : ''
  return `${targetText} ${counts} ${danger}${warnings}`
}
