import type { SFTPEntry } from '../types'

export type SftpDisplayEntry = SFTPEntry & { syntheticParent?: boolean }

export function createSftpParentEntry(currentPath: string): SftpDisplayEntry {
  return {
    name: '..',
    path: `${currentPath.replace(/\/+$/, '')}/..`,
    parentPath: currentPath,
    size: 0,
    isDir: true,
    isSymlink: false,
    permissions: '',
    owner: '',
    group: '',
    modTime: '',
    syntheticParent: true,
  }
}

export function buildSftpDisplayEntries(
  entries: SftpDisplayEntry[],
  currentPath: string,
  isRootRemotePath: boolean,
) {
  if (!currentPath || isRootRemotePath) return entries
  return [createSftpParentEntry(currentPath), ...entries]
}

export function sftpVisibleSelectedEntries(
  selected: SftpDisplayEntry[],
  visibleEntries: SftpDisplayEntry[],
  filterActive: boolean,
) {
  if (!filterActive) return selected
  const visiblePaths = new Set(visibleEntries.map((entry) => entry.path))
  return selected.filter((entry) => visiblePaths.has(entry.path))
}

export function sftpSelectedFileSize(entries: SftpDisplayEntry[]) {
  return entries.reduce((total, entry) => total + (entry.isDir ? 0 : entry.size), 0)
}

export function isSftpHiddenEntry(entry: SftpDisplayEntry) {
  return !entry.syntheticParent && entry.name.startsWith('.')
}
