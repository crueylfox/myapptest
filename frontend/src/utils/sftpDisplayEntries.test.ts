import { describe, expect, it } from 'vitest'
import type { SFTPEntry } from '../types'
import {
  buildSftpDisplayEntries,
  isSftpHiddenEntry,
  sftpSelectedFileSize,
  sftpVisibleSelectedEntries,
  type SftpDisplayEntry,
} from './sftpDisplayEntries'

function entry(values: Partial<SFTPEntry>): SFTPEntry {
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
    modTime: '2026-06-16T00:00:00Z',
    ...values,
  }
}

describe('sftp display entry helpers', () => {
  it('prepends a synthetic parent row for non-root remote paths', () => {
    const rows = [entry({ name: 'app.conf', path: '/etc/app.conf', parentPath: '/etc' })]

    expect(buildSftpDisplayEntries(rows, '/etc/', false)).toEqual([
      {
        name: '..',
        path: '/etc/..',
        parentPath: '/etc/',
        size: 0,
        isDir: true,
        isSymlink: false,
        permissions: '',
        owner: '',
        group: '',
        modTime: '',
        syntheticParent: true,
      },
      rows[0],
    ])
  })

  it('does not prepend a synthetic parent row for empty or root paths', () => {
    const rows = [entry({ name: 'etc', path: '/etc', isDir: true })]

    expect(buildSftpDisplayEntries(rows, '', false)).toBe(rows)
    expect(buildSftpDisplayEntries(rows, '/', true)).toBe(rows)
  })

  it('keeps only selected entries that remain visible when a filter is active', () => {
    const visible = [
      entry({ name: 'a.txt', path: '/a.txt' }),
      entry({ name: 'c.txt', path: '/c.txt' }),
    ]
    const selected = [
      entry({ name: 'a.txt', path: '/a.txt' }),
      entry({ name: 'b.txt', path: '/b.txt' }),
    ] as SftpDisplayEntry[]

    expect(sftpVisibleSelectedEntries(selected, visible, false)).toBe(selected)
    expect(sftpVisibleSelectedEntries(selected, visible, true).map((item) => item.path)).toEqual(['/a.txt'])
  })

  it('sums only selected file sizes and ignores directories', () => {
    expect(sftpSelectedFileSize([
      entry({ name: 'a.txt', path: '/a.txt', size: 10 }),
      entry({ name: 'dir', path: '/dir', isDir: true, size: 999 }),
      entry({ name: 'b.txt', path: '/b.txt', size: 15 }),
    ])).toBe(25)
  })

  it('marks hidden files while excluding the synthetic parent row', () => {
    expect(isSftpHiddenEntry(entry({ name: '.env', path: '/.env' }))).toBe(true)
    expect(isSftpHiddenEntry(entry({ name: 'env', path: '/env' }))).toBe(false)
    expect(isSftpHiddenEntry({ ...entry({ name: '.parent', path: '/.parent' }), syntheticParent: true })).toBe(false)
  })
})
