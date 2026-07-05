import { describe, expect, it } from 'vitest'
import {
  appendSftpHistoryPath,
  applySftpBackNavigation,
  applySftpForwardNavigation,
  createSftpPathBookmarkId,
  emptySftpPathBookmarkStorage,
  normalizeSftpPathBookmarkStorage,
  recordSftpSuccessfulNavigation,
  resolveSftpNavigationKey,
  sftpPathBookmarkDefaultLabel,
  syncSftpNavigationCurrentPath,
  type SftpPathBookmark,
  type SftpPathNavigationState,
} from './sftpPathState'

describe('sftp path state helpers', () => {
  it('prefers context navigation keys before server fallback keys', () => {
    expect(resolveSftpNavigationKey('pane:one', 7)).toBe('pane:one')
    expect(resolveSftpNavigationKey('', 7)).toBe('server:7')
    expect(resolveSftpNavigationKey(null, null)).toBe('__unbound__')
  })

  it('syncs the current path without clearing existing history stacks', () => {
    const existing: SftpPathNavigationState = {
      backStack: ['/var'],
      forwardStack: ['/tmp'],
      currentPath: '/old',
    }

    expect(syncSftpNavigationCurrentPath(undefined, '/home/demo/')).toEqual({
      backStack: [],
      forwardStack: [],
      currentPath: '/home/demo',
    })
    expect(syncSftpNavigationCurrentPath(existing, '/srv/app')).toEqual({
      backStack: ['/var'],
      forwardStack: ['/tmp'],
      currentPath: '/srv/app',
    })
    expect(syncSftpNavigationCurrentPath(existing, '')).toEqual(existing)
  })

  it('appends history paths without duplicates and trims to the configured limit', () => {
    expect(appendSftpHistoryPath(['/one'], '/one', 3)).toEqual(['/one'])
    expect(appendSftpHistoryPath(['/one'], '/two', 3)).toEqual(['/one', '/two'])
    expect(appendSftpHistoryPath(['/one', '/two', '/three'], '/four', 3)).toEqual(['/two', '/three', '/four'])
  })

  it('records successful direct navigation by pushing the old path and clearing forward history', () => {
    const navigation: SftpPathNavigationState = {
      backStack: ['/'],
      forwardStack: ['/future'],
      currentPath: '/home',
    }

    expect(recordSftpSuccessfulNavigation(navigation, '/home', '/var/log/')).toEqual({
      backStack: ['/', '/home'],
      forwardStack: [],
      currentPath: '/var/log',
    })
  })

  it('applies back and forward navigation stack transitions', () => {
    const navigation: SftpPathNavigationState = {
      backStack: ['/', '/var'],
      forwardStack: ['/tmp'],
      currentPath: '/home',
    }

    expect(applySftpBackNavigation(navigation, '/home', '/var/')).toEqual({
      backStack: ['/'],
      forwardStack: ['/tmp', '/home'],
      currentPath: '/var',
    })
    expect(applySftpForwardNavigation(navigation, '/home', '/tmp/')).toEqual({
      backStack: ['/', '/var', '/home'],
      forwardStack: [],
      currentPath: '/tmp',
    })
  })

  it('normalizes bookmark storage by keeping only valid numeric server buckets', () => {
    const valid: SftpPathBookmark = { id: 'logs', path: '/var/log', label: 'log', createdAt: 1, updatedAt: 2 }

    expect(emptySftpPathBookmarkStorage()).toEqual({ version: 1, byServerId: {} })
    expect(normalizeSftpPathBookmarkStorage({
      version: 1,
      byServerId: {
        7: [valid, { id: 'bad', path: '/bad', label: 'bad', createdAt: Number.NaN, updatedAt: 2 }],
        'server:8': [valid],
        9: 'not-list',
      },
    })).toEqual({
      version: 1,
      byServerId: {
        7: [valid],
      },
    })
  })

  it('derives bookmark labels and deterministic ids from normalized paths', () => {
    expect(sftpPathBookmarkDefaultLabel('/')).toBe('/')
    expect(sftpPathBookmarkDefaultLabel('/var/log/')).toBe('log')
    expect(sftpPathBookmarkDefaultLabel('/---/')).toBe('---')
    expect(createSftpPathBookmarkId('/var/log', 123456, () => 0.5)).toBe('2n9c-log-i')
    expect(createSftpPathBookmarkId('/---', 123456, () => 0.5)).toBe('2n9c-path-i')
  })
})
