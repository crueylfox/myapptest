import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useSftpFileFilter } from './useSftpFileFilter'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'

function entry(values: Partial<SftpDisplayEntry> = {}): SftpDisplayEntry {
  return {
    name: 'app.conf',
    path: '/etc/app.conf',
    parentPath: '/etc',
    size: 2048,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'wheel',
    modTime: '2026-06-01T08:00:00Z',
    ...values,
  }
}

describe('useSftpFileFilter', () => {
  it('returns all entries for empty filter and excludes parent rows from filtering', () => {
    const query = ref('')
    const entries = ref([entry(), entry({ name: '..', path: '/etc/..', syntheticParent: true, isDir: true })])
    const filter = useSftpFileFilter({ query, entries, currentPath: ref('/etc'), isRootRemotePath: () => false })

    expect(filter.filterActive.value).toBe(false)
    expect(filter.filteredEntries.value).toEqual(entries.value)
    query.value = 'parent'
    expect(filter.filteredEntries.value).toEqual([])
  })

  it('matches case-insensitive Chinese, multi-term AND, metadata, size, time, and canonical type text', () => {
    const query = ref('FILE ROOT 2.00 2026')
    const entries = ref([
      entry({ name: '检测.log', owner: 'root', group: 'opkg' }),
      entry({ name: 'other.txt', owner: 'deploy', group: 'wheel' }),
    ])
    const filter = useSftpFileFilter({ query, entries, currentPath: ref('/etc'), isRootRemotePath: () => true })

    expect(filter.filteredEntries.value.map((item) => item.name)).toEqual(['检测.log'])

    query.value = '检测 opkg'
    expect(filter.filteredEntries.value.map((item) => item.name)).toEqual(['检测.log'])

    query.value = 'directory'
    entries.value = [entry({ name: 'conf.d', path: '/etc/conf.d', isDir: true })]
    expect(filter.filteredEntries.value.map((item) => item.name)).toEqual(['conf.d'])
  })

  it('reports no-match state and builds safe highlight segments without HTML injection', () => {
    const query = ref('<img APP app')
    const entries = ref([entry({ name: '<img-app.conf' })])
    const filter = useSftpFileFilter({ query, entries, currentPath: ref('/etc'), isRootRemotePath: () => false })

    expect(filter.noMatch.value).toBe(false)
    expect(filter.highlightSegments(entries.value[0], 'name')).toEqual([
      { text: '<img', matched: true },
      { text: '-', matched: false },
      { text: 'app', matched: true },
      { text: '.conf', matched: false },
    ])

    query.value = 'missing'
    expect(filter.noMatch.value).toBe(true)
  })

  it('highlights whole type cell for canonical type-only matches and keeps parent unhighlighted', () => {
    const query = ref('folder')
    const directory = entry({ name: 'conf.d', isDir: true })
    const parent = entry({ name: '..', syntheticParent: true, isDir: true })
    const filter = useSftpFileFilter({ query, entries: ref([directory, parent]), currentPath: ref('/etc'), isRootRemotePath: () => true })

    expect(filter.highlightSegments(directory, 'type')).toEqual([{ text: expect.any(String), matched: true }])
    expect(filter.highlightSegments(parent, 'name')).toEqual([{ text: '..', matched: false }])
  })
})
