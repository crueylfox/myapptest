import { computed, type Ref } from 'vue'
import {
  buildSftpDisplayEntries,
  type SftpDisplayEntry,
} from '../utils/sftpDisplayEntries'
import {
  sftpEntryColumnText,
  sftpEntryHighlightText,
  sftpEntryKind,
  sftpEntryTypeLabel,
} from '../utils/sftpEntryPresentation'
import {
  buildSftpHighlightSegments,
  hasSftpHighlightMatch,
  sftpEntryMatchesFilter,
  sftpFilterTermsMatchCanonicalType,
  splitSftpFilterTerms,
  type SftpHighlightSegment,
} from '../utils/sftpFileFilter'
import type { FileColumnId } from '../utils/sftpFileColumns'

export type UseSftpFileFilterOptions<T extends SftpDisplayEntry> = {
  query: Readonly<Ref<string>>
  entries: Readonly<Ref<T[]>>
  currentPath: Readonly<Ref<string>>
  isRootRemotePath: (path: string) => boolean
}

export function useSftpFileFilter<T extends SftpDisplayEntry>(options: UseSftpFileFilterOptions<T>) {
  const filterTerms = computed(() => splitSftpFilterTerms(options.query.value))
  const filterActive = computed(() => filterTerms.value.length > 0)

  function matchesFilter(entry: T, terms = filterTerms.value) {
    return sftpEntryMatchesFilter(entry, terms, [
      sftpEntryTypeLabel(entry),
      sftpEntryKind(entry),
      sftpEntryColumnText(entry, 'size'),
      sftpEntryColumnText(entry, 'modTime'),
    ])
  }

  const filteredEntries = computed<T[]>(() => {
    if (!filterActive.value) return options.entries.value
    return options.entries.value.filter((entry) => matchesFilter(entry))
  })

  const displayEntries = computed(() =>
    buildSftpDisplayEntries(filteredEntries.value, options.currentPath.value, options.isRootRemotePath(options.currentPath.value)))

  const filterStatus = computed(() =>
    filterActive.value ? `已过滤：${filteredEntries.value.length} / ${options.entries.value.length}` : '')

  const noMatch = computed(() => filterActive.value && filteredEntries.value.length === 0)

  function highlightSegments(entry: SftpDisplayEntry, columnId: FileColumnId): SftpHighlightSegment[] {
    const text = sftpEntryHighlightText(entry, columnId)
    if (entry.syntheticParent || !filterActive.value) return text ? [{ text, matched: false }] : []
    const segments = buildSftpHighlightSegments(text, filterTerms.value)
    if (columnId === 'type' && !hasSftpHighlightMatch(segments) && sftpFilterTermsMatchCanonicalType(filterTerms.value, entry)) {
      return text ? [{ text, matched: true }] : []
    }
    return segments
  }

  return {
    filterTerms,
    filterActive,
    filteredEntries,
    displayEntries,
    filterStatus,
    noMatch,
    matchesFilter,
    highlightSegments,
  }
}
