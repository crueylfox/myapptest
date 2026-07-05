import type { CommandFavorite, CommandHistoryEntry, CommandSuggestion } from '../types'
import type { StaticCommandCompletion } from '../data/linuxCommandCompletions'

export interface BuildCommandCompletionOptions {
  prefix: string
  history: CommandHistoryEntry[]
  favorites: CommandFavorite[]
  commonCommands: StaticCommandCompletion[]
  builtinCommands: StaticCommandCompletion[]
  limit: number
}

type CompletionSource = 'history' | 'favorite' | 'common' | 'builtin'
type CompletionMatchKind = 'prefix' | 'fuzzy'
export const commandCompletionSuggestionLimit = 12

interface RankedCommandSuggestion extends CommandSuggestion {
  matchKind: CompletionMatchKind
  rank: number
}

export function buildCommandCompletionSuggestions(options: BuildCommandCompletionOptions): CommandSuggestion[] {
  const limit = Math.max(1, Math.trunc(options.limit || commandCompletionSuggestionLimit))
  const historyFrequency = commandFrequency(options.history.map((entry) => entry.command))
  const candidates = [
    ...options.history.map((entry, index) => fromHistory(entry, index, historyFrequency)),
    ...options.favorites.map((favorite, index) => fromFavorite(favorite, index)),
    ...options.commonCommands.map((command, index) => fromStatic(command, 'common', index)),
    ...options.builtinCommands.map((command, index) => fromStatic(command, 'builtin', index)),
  ]
  const byCommand = new Map<string, RankedCommandSuggestion>()

  for (const candidate of candidates) {
    const command = normalizeCommand(candidate.command)
    if (!command || commandLooksSensitive(command)) continue
    const matchKind = completionMatchKind(candidate, command, options.prefix)
    if (!matchKind) continue
    const key = command.toLowerCase()
    const ranked = { ...candidate, command, matchKind, rank: suggestionRank(candidate, matchKind) }
    const existing = byCommand.get(key)
    if (!existing || compareRankedSuggestions(ranked, existing) < 0) byCommand.set(key, ranked)
  }

  return [...byCommand.values()]
    .sort(compareRankedSuggestions)
    .slice(0, limit)
    .map(({ matchKind: _matchKind, rank: _rank, ...suggestion }) => suggestion)
}

export function completionInsertText(prefix: string, suggestionCommand: string) {
  const token = commandCompletionToken(prefix)
  const command = normalizeCommand(suggestionCommand)
  const trimmedPrefix = String(prefix ?? '').trim()
  const prefixLower = trimmedPrefix.toLowerCase()
  const commandLower = command.toLowerCase()
  const tokenLower = token.value.toLowerCase()
  const headLower = token.head.toLowerCase()

  if (!command) return ''
  if (!trimmedPrefix) return command
  if (prefixLower && commandLower.startsWith(prefixLower)) return command.slice(trimmedPrefix.length)
  if (headLower && commandLower.startsWith(headLower)) {
    const tail = command.slice(token.head.length)
    if (tail.toLowerCase().startsWith(tokenLower)) return tail.slice(token.value.length)
  }
  if (tokenLower && commandLower.startsWith(tokenLower)) return command.slice(token.value.length)
  return ''
}

export function commandCompletionToken(input: string) {
  const match = String(input ?? '').match(/^(.*?)([^\s]*)$/s)
  return { head: match?.[1] ?? '', value: match?.[2] ?? '' }
}

export function commandCompletionTriggerLength(input: string) {
  const token = commandCompletionToken(input)
  if (!token.value) return 0
  return token.head ? normalizeCommand(input).length : normalizeCommand(token.value).length
}

export function commandLooksSensitive(command: string) {
  const normalized = normalizeCommand(command)
  return [
    /\bpassword\b/i,
    /\bpasswd\b/i,
    /\btoken\b/i,
    /\bsecret\b/i,
    /private\s+key/i,
    /\bsshpass\b/i,
    /\bmysql\b.*(?:^|\s)-p(?:\S*)?/i,
    /\bexport\s+[A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|PRIVATE_KEY|API_KEY|ACCESS_KEY)[A-Za-z0-9_]*\s*=/i,
  ].some((pattern) => pattern.test(normalized))
}

function matchesCompletionPrefix(command: string, prefix: string) {
  const token = commandCompletionToken(prefix)
  const value = normalizeCommand(token.value).toLowerCase()
  if (value.length < 1) return false

  const trimmedPrefix = normalizeCommand(prefix).toLowerCase()
  const commandLower = command.toLowerCase()
  if (trimmedPrefix && commandLower.startsWith(trimmedPrefix)) return true
  if (token.head && commandLower.startsWith(token.head.toLowerCase())) {
    return commandLower.slice(token.head.length).startsWith(value)
  }
  if (!token.head && commandLower.startsWith(value)) return true
  return false
}

function fuzzyMatchesCompletion(command: string, prefix: string) {
  const token = commandCompletionToken(prefix)
  const needle = normalizeCommand(token.value || prefix).toLowerCase().replace(/\s+/g, '')
  const haystack = command.toLowerCase().replace(/\s+/g, '')
  if (needle.length < 2) return false
  let cursor = 0
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1
    if (cursor >= needle.length) return true
  }
  return false
}

function completionMatchKind(candidate: CommandSuggestion, command: string, prefix: string): CompletionMatchKind | null {
  if (matchesCompletionPrefix(command, prefix)) return 'prefix'
  if (candidate.source === 'history' && fuzzyMatchesCompletion(command, prefix)) return 'fuzzy'
  return null
}

function fromHistory(entry: CommandHistoryEntry, index: number, frequency: Map<string, number>): CommandSuggestion {
  const command = normalizeCommand(entry.command)
  const useCount = frequency.get(command.toLowerCase()) || 1
  return {
    id: `history:${entry.id || index}:${command}`,
    source: 'history',
    kind: 'command',
    title: command,
    command,
    description: entry.preview || '',
    scope: 'server',
    serverId: entry.serverId,
    groupId: null,
    score: 400000 + useCount * 1000 - index,
    useCount,
    lastUsedAt: entry.executedAt || '',
  }
}

function fromFavorite(favorite: CommandFavorite, index: number): CommandSuggestion {
  const command = normalizeCommand(favorite.command)
  return {
    id: `favorite:${favorite.id || index}:${command}`,
    source: 'favorite',
    kind: 'command',
    title: favorite.title || command,
    command,
    description: favorite.description || '',
    scope: favorite.scope,
    serverId: favorite.serverId,
    groupId: favorite.groupId,
    score: 300000 + Math.max(0, favorite.useCount || 0) - index,
    useCount: favorite.useCount || 0,
    lastUsedAt: favorite.lastUsedAt || '',
  }
}

function fromStatic(command: StaticCommandCompletion, source: CompletionSource, index: number): CommandSuggestion {
  const normalized = normalizeCommand(command.command)
  const isArgument = source === 'builtin' && command.kind === 'argument'
  return {
    id: `${source}:${index}:${normalized}`,
    source,
    kind: command.kind || 'command',
    title: normalized,
    command: normalized,
    description: command.description || '',
    scope: 'builtin',
    serverId: null,
    groupId: null,
    score: (source === 'common' ? 200000 : isArgument ? 50000 : 100000) - index,
    useCount: 0,
    lastUsedAt: '',
  }
}

function suggestionRank(suggestion: CommandSuggestion, matchKind: CompletionMatchKind) {
  if (suggestion.source === 'history' && matchKind === 'prefix') return 1
  if (suggestion.source === 'history' && matchKind === 'fuzzy') return 2
  if (suggestion.source === 'favorite') return 3
  if (suggestion.source === 'common') return 4
  if (suggestion.source === 'builtin' && suggestion.kind !== 'argument') return 5
  if (suggestion.source === 'builtin' && suggestion.kind === 'argument') return 6
  return 7
}

function compareRankedSuggestions(left: RankedCommandSuggestion, right: RankedCommandSuggestion) {
  if (left.rank !== right.rank) return left.rank - right.rank
  if (left.score !== right.score) return right.score - left.score
  if (left.useCount !== right.useCount) return right.useCount - left.useCount
  if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt.localeCompare(left.lastUsedAt)
  return left.command.localeCompare(right.command)
}

function commandFrequency(commands: string[]) {
  const frequency = new Map<string, number>()
  for (const value of commands) {
    const command = normalizeCommand(value).toLowerCase()
    if (!command) continue
    frequency.set(command, (frequency.get(command) || 0) + 1)
  }
  return frequency
}

function normalizeCommand(value: string) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}
