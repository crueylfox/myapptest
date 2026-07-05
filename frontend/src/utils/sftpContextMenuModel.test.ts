import { describe, expect, it } from 'vitest'
import type { SFTPEntry } from '../types'
import { buildSftpContextMenuItems } from './sftpContextMenuModel'
import type { SftpDisplayEntry } from './sftpDisplayEntries'

function entry(values: Partial<SFTPEntry & { syntheticParent: boolean }> = {}): SftpDisplayEntry {
  return {
    name: 'file.txt',
    path: '/home/demo/file.txt',
    parentPath: '/home/demo',
    size: 10,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'root',
    modTime: '2026-06-01T00:00:00Z',
    ...values,
  }
}

describe('sftp context menu model', () => {
  it('builds the existing single-file row menu without executing actions', () => {
    const items = buildSftpContextMenuItems({
      target: 'entry',
      entry: entry(),
      selectedCount: 1,
      online: true,
      busy: false,
      canBrowse: true,
      canEditText: true,
    })

    expect(items.map((item) => item.id)).toEqual([
      'open',
      'download',
      'rename',
      'delete',
      'separator-1',
      'copy-path',
      'copy-name',
      'refresh',
      'properties',
    ])
    expect(items.find((item) => item.id === 'delete')).toEqual(expect.objectContaining({ danger: true }))
    expect(items.find((item) => item.id === 'copy-path')?.label).toBe('复制路径')
  })

  it('keeps recursive directory delete wording separate from file delete wording', () => {
    const directoryItems = buildSftpContextMenuItems({
      target: 'entry',
      entry: entry({ name: 'logs', path: '/home/demo/logs', isDir: true }),
      selectedCount: 1,
    })

    expect(directoryItems.find((item) => item.id === 'download')?.label).toBe('下载目录')
    expect(directoryItems.find((item) => item.id === 'delete')?.label).toBe('删除目录及内容...')
    expect(directoryItems.find((item) => item.id === 'copy-name')?.label).toBe('复制目录名')
  })

  it('builds the multi-selection menu with disabled properties and no action callbacks', () => {
    const items = buildSftpContextMenuItems({
      target: 'entry',
      entry: entry({ name: 'a.txt', path: '/home/demo/a.txt' }),
      selectedCount: 2,
    })

    expect(items.map((item) => item.id)).toEqual([
      'download',
      'delete',
      'copy-paths',
      'properties',
      'separator',
      'refresh',
    ])
    expect(items.find((item) => item.id === 'properties')).toEqual(expect.objectContaining({ disabled: true }))
    expect(items.find((item) => item.id === 'delete')).toEqual(expect.objectContaining({ danger: true }))
  })

  it('builds the blank-area menu and keeps current-path copy wording distinct', () => {
    const items = buildSftpContextMenuItems({
      target: 'blank',
      entry: null,
      selectedCount: 0,
      online: true,
      busy: false,
      canBrowse: true,
      canEditText: true,
    })

    expect(items.map((item) => item.id)).toEqual([
      'refresh',
      'home',
      'mkdir',
      'new-file',
      'upload',
      'upload-directory',
      'hidden',
      'copy-current-path',
    ])
    expect(items.find((item) => item.id === 'copy-current-path')?.label).toBe('复制当前路径')
    expect(items.find((item) => item.id === 'copy-current-path')?.label).not.toBe('复制路径')
  })

  it('disables only the blank new-file action when text editing is unavailable', () => {
    const items = buildSftpContextMenuItems({
      target: 'blank',
      entry: null,
      selectedCount: 0,
      online: true,
      busy: false,
      canBrowse: true,
      canEditText: false,
    })

    expect(items.find((item) => item.id === 'new-file')).toEqual(expect.objectContaining({ disabled: true }))
    expect(items.find((item) => item.id === 'upload')?.disabled).toBeUndefined()
  })

  it('shows only parent navigation for the synthetic parent row', () => {
    expect(buildSftpContextMenuItems({
      target: 'entry',
      entry: entry({ name: '..', path: '/home', syntheticParent: true }),
      selectedCount: 1,
    })).toEqual([{ id: 'parent', label: '返回上级' }])
  })
})
