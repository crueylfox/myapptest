import { normalizeRemoteInputPath } from './sftpRemotePath'

export const SFTP_PATH_HISTORY_LIMIT = 100

export type SftpPathNavigationState = {
  backStack: string[]
  forwardStack: string[]
  currentPath: string
}

export type SftpPathBookmark = {
  id: string
  path: string
  label: string
  createdAt: number
  updatedAt: number
}

export type SftpPathBookmarkStorage = {
  version: 1
  byServerId: Record<string, SftpPathBookmark[]>
}

export function resolveSftpNavigationKey(contextId: string | null | undefined, serverId: number | string | null | undefined) {
  return contextId || (serverId ? `server:${serverId}` : '__unbound__')
}

export function syncSftpNavigationCurrentPath(
  navigation: SftpPathNavigationState | undefined,
  currentPath: string,
): SftpPathNavigationState {
  const current = normalizeRemoteInputPath(currentPath || '')
  if (!navigation) {
    return { backStack: [], forwardStack: [], currentPath: current }
  }
  if (!current || navigation.currentPath === current) return navigation
  return { ...navigation, currentPath: current }
}

export function appendSftpHistoryPath(stack: string[], path: string, limit = SFTP_PATH_HISTORY_LIMIT) {
  if (!path || stack[stack.length - 1] === path) return stack.slice()
  const next = [...stack, path]
  if (next.length <= limit) return next
  return next.slice(next.length - limit)
}

export function recordSftpSuccessfulNavigation(
  navigation: SftpPathNavigationState | undefined,
  previousPath: string,
  nextPath: string,
  limit = SFTP_PATH_HISTORY_LIMIT,
) {
  const normalizedPrevious = normalizeRemoteInputPath(previousPath)
  const normalizedNext = normalizeRemoteInputPath(nextPath)
  if (!normalizedNext) return navigation ?? null

  const base = navigation ?? {
    backStack: [],
    forwardStack: [],
    currentPath: normalizedPrevious,
  }
  const current = normalizedPrevious || base.currentPath
  const backStack = current && current !== normalizedNext
    ? appendSftpHistoryPath(base.backStack, current, limit)
    : base.backStack.slice()
  return {
    backStack,
    forwardStack: current && current !== normalizedNext ? [] : base.forwardStack.slice(),
    currentPath: normalizedNext,
  }
}

export function applySftpBackNavigation(
  navigation: SftpPathNavigationState,
  previousPath: string,
  loadedPath: string,
  limit = SFTP_PATH_HISTORY_LIMIT,
): SftpPathNavigationState {
  const backStack = navigation.backStack.slice(0, -1)
  const normalizedPrevious = normalizeRemoteInputPath(previousPath)
  const normalizedLoaded = normalizeRemoteInputPath(loadedPath)
  const forwardStack = normalizedPrevious && normalizedPrevious !== normalizedLoaded
    ? appendSftpHistoryPath(navigation.forwardStack, normalizedPrevious, limit)
    : navigation.forwardStack.slice()
  return {
    backStack,
    forwardStack,
    currentPath: normalizedLoaded,
  }
}

export function applySftpForwardNavigation(
  navigation: SftpPathNavigationState,
  previousPath: string,
  loadedPath: string,
  limit = SFTP_PATH_HISTORY_LIMIT,
): SftpPathNavigationState {
  const forwardStack = navigation.forwardStack.slice(0, -1)
  const normalizedPrevious = normalizeRemoteInputPath(previousPath)
  const normalizedLoaded = normalizeRemoteInputPath(loadedPath)
  const backStack = normalizedPrevious && normalizedPrevious !== normalizedLoaded
    ? appendSftpHistoryPath(navigation.backStack, normalizedPrevious, limit)
    : navigation.backStack.slice()
  return {
    backStack,
    forwardStack,
    currentPath: normalizedLoaded,
  }
}

export function emptySftpPathBookmarkStorage(): SftpPathBookmarkStorage {
  return { version: 1, byServerId: {} }
}

export function isSftpPathBookmark(value: unknown): value is SftpPathBookmark {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SftpPathBookmark>
  return typeof item.id === 'string' &&
    typeof item.path === 'string' &&
    typeof item.label === 'string' &&
    Number.isFinite(item.createdAt) &&
    Number.isFinite(item.updatedAt)
}

export function normalizeSftpPathBookmarkStorage(value: unknown): SftpPathBookmarkStorage {
  if (!value || typeof value !== 'object') return emptySftpPathBookmarkStorage()
  const source = value as Partial<SftpPathBookmarkStorage>
  const byServerId: Record<string, SftpPathBookmark[]> = {}
  if (source.byServerId && typeof source.byServerId === 'object') {
    for (const [rawServerId, rawBookmarks] of Object.entries(source.byServerId)) {
      if (!/^\d+$/.test(rawServerId) || !Array.isArray(rawBookmarks)) continue
      const bookmarks = rawBookmarks.filter(isSftpPathBookmark)
      if (bookmarks.length > 0) byServerId[rawServerId] = bookmarks
    }
  }
  return { version: 1, byServerId }
}

export function sftpPathBookmarkDefaultLabel(path: string) {
  const normalized = normalizeRemoteInputPath(path)
  if (normalized === '/') return '/'
  return normalized.split('/').filter(Boolean).pop() || normalized || '/'
}

export function createSftpPathBookmarkId(path: string, now = Date.now(), random = Math.random) {
  const slug = sftpPathBookmarkDefaultLabel(path).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'path'
  return `${now.toString(36)}-${slug}-${random().toString(36).slice(2, 8)}`
}
