import { formatBytes } from './format'
import type { SftpDisplayEntry } from './sftpDisplayEntries'
import type { FileColumnId } from './sftpFileColumns'

export type SftpEntryKind = 'parent' | 'symlink' | 'directory' | 'file'

export function sftpEntryTypeLabel(entry: SftpDisplayEntry) {
  if (entry.syntheticParent) return '上级'
  if (entry.isSymlink) return '链接'
  if (entry.isDir) return '文件夹'
  return '文件'
}

export function sftpEntryKind(entry: SftpDisplayEntry): SftpEntryKind {
  if (entry.syntheticParent) return 'parent'
  if (entry.isSymlink) return 'symlink'
  if (entry.isDir) return 'directory'
  return 'file'
}

export function sftpEntryIconLabel(entry: SftpDisplayEntry) {
  if (entry.syntheticParent) return '上级目录'
  if (entry.isSymlink) return '符号链接'
  if (entry.isDir) return '文件夹'
  return '文件'
}

export function formatSftpEntryTime(value: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export function sftpEntryColumnText(entry: SftpDisplayEntry, columnId: FileColumnId) {
  if (columnId === 'type') return sftpEntryTypeLabel(entry)
  if (columnId === 'size') return entry.isDir ? '—' : formatBytes(entry.size)
  if (columnId === 'modTime') return formatSftpEntryTime(entry.modTime)
  if (columnId === 'owner') return entry.owner || '—'
  if (columnId === 'group') return entry.group || '—'
  return ''
}

export function sftpEntryHighlightText(entry: SftpDisplayEntry, columnId: FileColumnId) {
  if (columnId === 'name') return entry.name
  if (columnId === 'permissions') return entry.permissions || '—'
  return sftpEntryColumnText(entry, columnId)
}
