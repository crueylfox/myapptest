import { computed, ref } from 'vue'
import {
  createSftpPathBookmarkId,
  emptySftpPathBookmarkStorage,
  normalizeSftpPathBookmarkStorage,
  sftpPathBookmarkDefaultLabel,
  type SftpPathBookmark,
  type SftpPathBookmarkStorage,
} from '../utils/sftpPathState'
import { normalizeRemoteInputPath } from '../utils/sftpRemotePath'
import { safeReadJson, safeWriteJson, type PersistentJsonStorage } from '../utils/persistentJson'

export const PATH_BOOKMARKS_KEY = 'hostdeck.sftpPathBookmarks.v1'

export type SftpPathBookmarkAddResult =
  | { status: 'added'; bookmark: SftpPathBookmark; saved: boolean }
  | { status: 'duplicate'; bookmark: SftpPathBookmark; saved: boolean }
  | { status: 'invalid'; bookmark: null; saved: false }

export type UseSftpPathBookmarksOptions = {
  storage?: PersistentJsonStorage
  now?: () => number
  random?: () => number
}

export function useSftpPathBookmarks(options: UseSftpPathBookmarksOptions = {}) {
  const storage = options.storage ?? localStorage
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const bookmarks = ref<SftpPathBookmarkStorage>(loadSftpPathBookmarks(storage))

  function bookmarksForServer(serverId: number | string | null | undefined) {
    return computed(() => {
      if (serverId === null || serverId === undefined || serverId === '') return []
      return bookmarks.value.byServerId[String(serverId)] ?? []
    })
  }

  function setServerBookmarks(serverKey: string, nextBookmarks: SftpPathBookmark[]) {
    bookmarks.value = {
      version: 1,
      byServerId: {
        ...bookmarks.value.byServerId,
        [serverKey]: nextBookmarks,
      },
    }
  }

  function persistBookmarks() {
    return safeWriteJson(PATH_BOOKMARKS_KEY, bookmarks.value, storage)
  }

  function addBookmark(serverId: number | string | null | undefined, rawPath: string): SftpPathBookmarkAddResult {
    if (serverId === null || serverId === undefined || serverId === '') return { status: 'invalid', bookmark: null, saved: false }
    const path = normalizeRemoteInputPath(rawPath)
    if (!path) return { status: 'invalid', bookmark: null, saved: false }

    const serverKey = String(serverId)
    const current = bookmarks.value.byServerId[serverKey] ?? []
    const duplicate = current.find((bookmark) => bookmark.path === path)
    const timestamp = now()
    if (duplicate) {
      const updated = { ...duplicate, updatedAt: timestamp }
      setServerBookmarks(serverKey, current.map((bookmark) => bookmark.id === duplicate.id ? updated : bookmark))
      return { status: 'duplicate', bookmark: updated, saved: persistBookmarks() }
    }

    const bookmark: SftpPathBookmark = {
      id: createSftpPathBookmarkId(path, timestamp, random),
      path,
      label: sftpPathBookmarkDefaultLabel(path),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    setServerBookmarks(serverKey, [...current, bookmark])
    return { status: 'added', bookmark, saved: persistBookmarks() }
  }

  function deleteBookmark(serverId: number | string | null | undefined, bookmarkId: string) {
    if (serverId === null || serverId === undefined || serverId === '') return true
    const serverKey = String(serverId)
    setServerBookmarks(serverKey, (bookmarks.value.byServerId[serverKey] ?? [])
      .filter((bookmark) => bookmark.id !== bookmarkId))
    return persistBookmarks()
  }

  return {
    bookmarks,
    bookmarksForServer,
    addBookmark,
    deleteBookmark,
    persistBookmarks,
  }
}

export function loadSftpPathBookmarks(storage: PersistentJsonStorage = localStorage) {
  return normalizeSftpPathBookmarkStorage(safeReadJson(
    PATH_BOOKMARKS_KEY,
    emptySftpPathBookmarkStorage(),
    undefined,
    storage,
  ))
}
