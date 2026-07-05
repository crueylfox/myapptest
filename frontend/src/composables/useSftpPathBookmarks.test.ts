import { describe, expect, it } from 'vitest'
import {
  PATH_BOOKMARKS_KEY,
  useSftpPathBookmarks,
} from './useSftpPathBookmarks'
import type { PersistentJsonStorage } from '../utils/persistentJson'

function memoryStorage(initial: Record<string, string> = {}): PersistentJsonStorage & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
    removeItem: (key: string) => {
      delete values[key]
    },
  }
}

describe('useSftpPathBookmarks', () => {
  it('adds bookmarks with default root and last-segment labels', () => {
    let now = 100
    const storage = memoryStorage()
    const bookmarks = useSftpPathBookmarks({ storage, now: () => now++, random: () => 0.5 })

    expect(bookmarks.addBookmark(7, '/').status).toBe('added')
    expect(bookmarks.addBookmark(7, '/var/log/').status).toBe('added')

    expect(bookmarks.bookmarksForServer(7).value.map((bookmark) => bookmark.label)).toEqual(['/', 'log'])
    expect(JSON.parse(storage.values[PATH_BOOKMARKS_KEY]).byServerId['7']).toHaveLength(2)
  })

  it('dedupes by serverID and path and updates updatedAt on duplicate', () => {
    let now = 200
    const bookmarks = useSftpPathBookmarks({ storage: memoryStorage(), now: () => now++, random: () => 0.5 })

    const first = bookmarks.addBookmark(7, '/etc')
    const duplicate = bookmarks.addBookmark(7, '/etc/')
    bookmarks.addBookmark(8, '/etc')

    expect(first.status).toBe('added')
    expect(duplicate.status).toBe('duplicate')
    expect(bookmarks.bookmarksForServer(7).value).toHaveLength(1)
    expect(bookmarks.bookmarksForServer(8).value).toHaveLength(1)
    expect(bookmarks.bookmarksForServer(7).value[0].createdAt).toBe(200)
    expect(bookmarks.bookmarksForServer(7).value[0].updatedAt).toBe(201)
  })

  it('deletes bookmarks by server without crossing server buckets', () => {
    const storage = memoryStorage()
    const bookmarks = useSftpPathBookmarks({ storage, now: () => 300, random: () => 0.5 })
    const first = bookmarks.addBookmark(7, '/root')
    bookmarks.addBookmark(8, '/root')

    bookmarks.deleteBookmark(7, first.bookmark!.id)

    expect(bookmarks.bookmarksForServer(7).value).toEqual([])
    expect(bookmarks.bookmarksForServer(8).value).toHaveLength(1)
  })

  it('falls back from damaged storage and stores no session or credential fields', () => {
    const storage = memoryStorage({ [PATH_BOOKMARKS_KEY]: '{broken' })
    const bookmarks = useSftpPathBookmarks({ storage, now: () => 400, random: () => 0.5 })

    bookmarks.addBookmark(7, '/opt/app')
    const serialized = storage.values[PATH_BOOKMARKS_KEY]

    expect(bookmarks.bookmarksForServer(7).value[0].path).toBe('/opt/app')
    expect(serialized).not.toContain('session')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('passphrase')
  })
})
