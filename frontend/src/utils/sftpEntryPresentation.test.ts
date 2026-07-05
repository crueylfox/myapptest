import { describe, expect, it } from 'vitest'
import type { SftpDisplayEntry } from './sftpDisplayEntries'
import {
  formatSftpEntryTime,
  sftpEntryColumnText,
  sftpEntryHighlightText,
  sftpEntryIconLabel,
  sftpEntryKind,
  sftpEntryTypeLabel,
} from './sftpEntryPresentation'

function entry(values: Partial<SftpDisplayEntry> = {}): SftpDisplayEntry {
  return {
    name: 'app.log',
    path: '/var/log/app.log',
    parentPath: '/var/log',
    size: 1536,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'wheel',
    modTime: '2026-06-30T01:44:51Z',
    ...values,
  }
}

describe('sftp entry presentation helpers', () => {
  it('classifies entries for icon and row presentation without component state', () => {
    expect(sftpEntryKind(entry({ syntheticParent: true, isDir: true }))).toBe('parent')
    expect(sftpEntryKind(entry({ isDir: true }))).toBe('directory')
    expect(sftpEntryKind(entry({ isSymlink: true }))).toBe('symlink')
    expect(sftpEntryKind(entry())).toBe('file')
  })

  it('returns the localized type and icon labels used by the file table', () => {
    expect(sftpEntryTypeLabel(entry({ syntheticParent: true, isDir: true }))).toBe('上级')
    expect(sftpEntryTypeLabel(entry({ isDir: true }))).toBe('文件夹')
    expect(sftpEntryTypeLabel(entry({ isSymlink: true }))).toBe('链接')
    expect(sftpEntryTypeLabel(entry())).toBe('文件')

    expect(sftpEntryIconLabel(entry({ syntheticParent: true, isDir: true }))).toBe('上级目录')
    expect(sftpEntryIconLabel(entry({ isDir: true }))).toBe('文件夹')
    expect(sftpEntryIconLabel(entry({ isSymlink: true }))).toBe('符号链接')
    expect(sftpEntryIconLabel(entry())).toBe('文件')
  })

  it('formats table column text with existing fallbacks', () => {
    const file = entry()
    const dir = entry({ isDir: true, size: 4096, owner: '', group: '', modTime: '' })

    expect(sftpEntryColumnText(file, 'type')).toBe('文件')
    expect(sftpEntryColumnText(file, 'size')).toBe('1.50 KB')
    expect(sftpEntryColumnText(file, 'modTime')).toBe(new Date(file.modTime).toLocaleString())
    expect(sftpEntryColumnText(file, 'owner')).toBe('root')
    expect(sftpEntryColumnText(file, 'group')).toBe('wheel')

    expect(sftpEntryColumnText(dir, 'size')).toBe('—')
    expect(sftpEntryColumnText(dir, 'modTime')).toBe('—')
    expect(sftpEntryColumnText(dir, 'owner')).toBe('—')
    expect(sftpEntryColumnText(dir, 'group')).toBe('—')
    expect(sftpEntryColumnText(file, 'name')).toBe('')
  })

  it('returns highlight source text for name, permissions, and derived columns', () => {
    const file = entry({ name: 'install.sh', permissions: '' })

    expect(sftpEntryHighlightText(file, 'name')).toBe('install.sh')
    expect(sftpEntryHighlightText(file, 'permissions')).toBe('—')
    expect(sftpEntryHighlightText(file, 'size')).toBe('1.50 KB')
    expect(sftpEntryHighlightText(file, 'type')).toBe('文件')
  })

  it('keeps date formatting isolated for empty and valid timestamps', () => {
    const value = '2026-06-30T01:44:51Z'
    expect(formatSftpEntryTime('')).toBe('—')
    expect(formatSftpEntryTime(value)).toBe(new Date(value).toLocaleString())
  })
})
