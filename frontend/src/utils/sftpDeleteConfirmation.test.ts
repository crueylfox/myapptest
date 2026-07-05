import { describe, expect, it } from 'vitest'
import type { SFTPInspectDeleteResponse } from '../types'
import type { SftpDisplayEntry } from './sftpDisplayEntries'
import { buildSftpDeleteConfirmMessage } from './sftpDeleteConfirmation'

function entry(values: Partial<SftpDisplayEntry> = {}): SftpDisplayEntry {
  return {
    name: 'app.log',
    path: '/var/log/app.log',
    parentPath: '/var/log',
    size: 128,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'root',
    modTime: '',
    ...values,
  }
}

function preview(values: Partial<SFTPInspectDeleteResponse> = {}): SFTPInspectDeleteResponse {
  return {
    connectionId: 7,
    paths: ['/var/log/app.log'],
    fileCount: 1,
    directoryCount: 0,
    symlinkCount: 0,
    totalBytes: 1024,
    warnings: [],
    requiresRecursive: false,
    ...values,
  }
}

describe('sftp delete confirmation presentation', () => {
  it('describes a single file target with preview counts and irreversible warning', () => {
    const message = buildSftpDeleteConfirmMessage([entry()], preview())

    expect(message).toContain('操作对象：/var/log/app.log')
    expect(message).toContain('预检统计：1 个文件、0 个目录、0 个符号链接，共 1.00 KB。')
    expect(message).toContain('此操作会删除选中的远程文件，无法撤销。')
  })

  it('describes mixed direct selections and directory recursive danger', () => {
    const message = buildSftpDeleteConfirmMessage([
      entry({ path: '/var/log/app.log', isDir: false }),
      entry({ name: 'nginx', path: '/var/log/nginx', isDir: true }),
    ], preview({
      paths: ['/var/log/app.log', '/var/log/nginx'],
      fileCount: 8,
      directoryCount: 2,
      symlinkCount: 1,
      totalBytes: 42,
      requiresRecursive: true,
    }))

    expect(message).toContain('将删除 2 个选中项，其中包含 1 个文件、1 个目录。')
    expect(message).toContain('预检统计：8 个文件、2 个目录、1 个符号链接，共 42 B。')
    expect(message).toContain('此操作会递归删除目录内所有文件和子目录，无法撤销。')
  })

  it('appends preview warnings without losing the base delete message', () => {
    const message = buildSftpDeleteConfirmMessage([entry()], preview({
      warnings: ['部分文件无权限访问', '符号链接目标不可读'],
    }))

    expect(message).toContain('预检警告：部分文件无权限访问；符号链接目标不可读')
    expect(message).toContain('此操作会删除选中的远程文件，无法撤销。')
  })
})
