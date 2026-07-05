export type SftpFilterEntry = {
  name: string
  isDir: boolean
  isSymlink: boolean
  permissions: string
  owner: string
  group: string
  syntheticParent?: boolean
}

export type SftpHighlightSegment = {
  text: string
  matched: boolean
}

export function normalizeSftpFilterText(value: string) {
  return value.toLocaleLowerCase()
}

export function splitSftpFilterTerms(query: string) {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const rawTerm of query.trim().split(/\s+/)) {
    const term = normalizeSftpFilterText(rawTerm)
    if (!term || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }
  return terms
}

export function canonicalSftpEntryTypeTerms(entry: SftpFilterEntry) {
  if (entry.syntheticParent) return []
  if (entry.isSymlink) return ['symlink', 'link']
  if (entry.isDir) return ['directory', 'dir', 'folder']
  return ['file']
}

export function sftpEntryMatchesFilter(entry: SftpFilterEntry, terms: string[], extraText: string[] = []) {
  if (entry.syntheticParent) return false
  const haystack = [
    entry.name,
    ...canonicalSftpEntryTypeTerms(entry),
    entry.permissions,
    entry.owner,
    entry.group,
    ...extraText,
  ].join(' ').toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function buildSftpHighlightSegments(text: string, terms: string[]): SftpHighlightSegment[] {
  if (!text) return []
  const uniqueTerms = Array.from(new Set(terms.filter(Boolean)))
  if (uniqueTerms.length === 0) return [{ text, matched: false }]
  const normalizedText = normalizeSftpFilterText(text)
  const segments: SftpHighlightSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    let bestStart = -1
    let bestTerm = ''
    for (const term of uniqueTerms) {
      const start = normalizedText.indexOf(term, cursor)
      if (start < 0) continue
      if (bestStart < 0 || start < bestStart || (start === bestStart && term.length > bestTerm.length)) {
        bestStart = start
        bestTerm = term
      }
    }
    if (bestStart < 0) {
      segments.push({ text: text.slice(cursor), matched: false })
      break
    }
    if (bestStart > cursor) segments.push({ text: text.slice(cursor, bestStart), matched: false })
    segments.push({ text: text.slice(bestStart, bestStart + bestTerm.length), matched: true })
    cursor = bestStart + bestTerm.length
  }
  return segments
}

export function hasSftpHighlightMatch(segments: SftpHighlightSegment[]) {
  return segments.some((segment) => segment.matched)
}

export function sftpFilterTermsMatchCanonicalType(terms: string[], entry: SftpFilterEntry) {
  const canonical = canonicalSftpEntryTypeTerms(entry)
  return terms.some((term) => canonical.some((value) => value.includes(term)))
}
