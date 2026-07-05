import { describe, expect, it } from 'vitest'
import {
  buildSftpHighlightSegments,
  canonicalSftpEntryTypeTerms,
  sftpEntryMatchesFilter,
  sftpFilterTermsMatchCanonicalType,
  splitSftpFilterTerms,
  type SftpFilterEntry,
} from './sftpFileFilter'

function entry(values: Partial<SftpFilterEntry> = {}): SftpFilterEntry {
  return {
    name: 'app.conf',
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'wheel',
    ...values,
  }
}

describe('sftp file filter utilities', () => {
  it('splits filter text into lowercase unique terms', () => {
    expect(splitSftpFilterTerms('  App app ROOT  ')).toEqual(['app', 'root'])
  })

  it('matches AND terms across entry fields, canonical type terms, and extra display text', () => {
    const row = entry({
      name: 'package.ipk',
      permissions: '-rw-r-----',
      owner: 'deploy',
      group: 'opkg',
    })

    expect(sftpEntryMatchesFilter(row, ['file', 'deploy', '2.00'], ['2.00 KB'])).toBe(true)
    expect(sftpEntryMatchesFilter(row, ['file', 'missing'], ['2.00 KB'])).toBe(false)
  })

  it('never matches the synthetic parent row', () => {
    expect(sftpEntryMatchesFilter(entry({ name: '..', syntheticParent: true }), ['dir'], ['parent'])).toBe(false)
  })

  it('returns canonical type aliases for directories files and symlinks', () => {
    expect(canonicalSftpEntryTypeTerms(entry({ isDir: true }))).toEqual(['directory', 'dir', 'folder'])
    expect(canonicalSftpEntryTypeTerms(entry({ isSymlink: true }))).toEqual(['symlink', 'link'])
    expect(canonicalSftpEntryTypeTerms(entry())).toEqual(['file'])
  })

  it('checks whether filter terms match canonical type aliases', () => {
    expect(sftpFilterTermsMatchCanonicalType(['directory'], entry({ isDir: true }))).toBe(true)
    expect(sftpFilterTermsMatchCanonicalType(['folder'], entry({ isDir: true }))).toBe(true)
    expect(sftpFilterTermsMatchCanonicalType(['folder'], entry())).toBe(false)
  })

  it('builds stable non-overlapping highlight segments with the longest term first', () => {
    expect(buildSftpHighlightSegments('foobar.txt', ['foo', 'foobar'])).toEqual([
      { text: 'foobar', matched: true },
      { text: '.txt', matched: false },
    ])
  })
})
