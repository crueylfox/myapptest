import { tokenizeCommand } from '../lib/commandHighlight'
import { terminalLanguageFromFilePath, type TerminalFileEditorHighlightHint } from './terminalFileEditorHint'

export type TerminalHighlightTokenType =
  | 'command'
  | 'subcommand'
  | 'argument'
  | 'option'
  | 'string'
  | 'variable'
  | 'path'
  | 'operator'
  | 'comment'
  | 'number'
  | 'ip'
  | 'mac'
  | 'port'
  | 'url'
  | 'danger'
  | 'key'
  | 'keyword'
  | 'date'
  | 'log-level'
  | 'function'

export type TerminalOutputLanguage = 'shell' | 'json' | 'yaml' | 'ini' | 'log' | 'uci' | 'generic'

export interface TerminalHighlightSpan {
  type: TerminalHighlightTokenType
  text: string
  start: number
  end: number
}

interface TerminalBufferLineLike {
  readonly isWrapped?: boolean
  readonly length?: number
  getCell?: (index: number) => TerminalBufferCellLike | undefined
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string
}

interface TerminalBufferCellLike {
  getWidth?: () => number
  getChars?: () => string
  isFgDefault?: () => boolean
  isFgPalette?: () => boolean
  isFgRGB?: () => boolean
  isBgDefault?: () => boolean
  isBgPalette?: () => boolean
  isBgRGB?: () => boolean
  isAttributeDefault?: () => boolean
  isInverse?: () => number | boolean
  isInvisible?: () => number | boolean
}

type TerminalBooleanCellMethod =
  | 'isFgDefault'
  | 'isFgPalette'
  | 'isFgRGB'
  | 'isBgDefault'
  | 'isBgPalette'
  | 'isBgRGB'
  | 'isAttributeDefault'

type TerminalFlagCellMethod = 'isInverse' | 'isInvisible'

interface TerminalBufferLike {
  baseY?: number
  cursorY?: number
  cursorX?: number
  viewportY?: number
  type?: string
  getLine?: (index: number) => TerminalBufferLineLike | undefined
}

interface TerminalDisposableLike {
  dispose: () => void
}

interface TerminalEventLike<T = void, U = void> {
  (listener: (arg1: T, arg2: U) => unknown): TerminalDisposableLike
}

interface TerminalMarkerLike extends TerminalDisposableLike {
  readonly id: number
  readonly line: number
  readonly onDispose: TerminalEventLike<void>
  readonly isDisposed: boolean
}

interface TerminalDecorationLike extends TerminalDisposableLike {
  readonly isDisposed?: boolean
}

interface TerminalDecorationOptionsLike {
  marker: TerminalMarkerLike
  x?: number
  width?: number
  height?: number
  foregroundColor?: string
  backgroundColor?: string
  layer?: 'bottom' | 'top'
}

interface TerminalCellSpan {
  start: number
  end: number
  x: number
  width: number
  invalid?: boolean
  remoteForeground?: boolean
  unsafeAttributes?: boolean
}

export interface TerminalViewportLike {
  rows: number
  cols: number
  buffer: { active: TerminalBufferLike }
  registerMarker?: (cursorYOffset?: number) => TerminalMarkerLike | undefined
  registerDecoration?: (decorationOptions: TerminalDecorationOptionsLike) => TerminalDecorationLike | undefined
  refresh?: (start: number, end: number) => void
}

export interface TerminalViewportHighlighterOptions {
  terminal: TerminalViewportLike
  root: HTMLElement
  isActive?: () => boolean
  isVisible?: () => boolean
  maxTokens?: number
  getAlternateScreenHighlightHint?: () => TerminalFileEditorHighlightHint | null
}

export interface TerminalViewportHighlighterDiagnostics {
  apiAvailable: boolean
  visibleRows: number
  tokensGenerated: number
  decorationsRegistered: number
  decorationsRejected: number
  markersRejected: number
  skippedRemoteColor: number
  preservedAnsiCells: number
  semanticDecorationsRegistered: number
  skipReason: string | null
  lastError: string | null
}

const shellCommands = new Set([
  'awk', 'cat', 'cd', 'chmod', 'chown', 'cp', 'curl', 'docker', 'echo', 'egrep', 'env',
  'export', 'fgrep', 'find', 'for', 'grep', 'head', 'if', 'ip', 'journalctl', 'less',
  'ln', 'ls', 'mkdir', 'mv', 'nano', 'printf', 'ps', 'pwd', 'rm', 'rsync', 'scp', 'sed',
  'service', 'sh', 'sleep', 'ssh', 'sudo', 'systemctl', 'tail', 'tar', 'test', 'then',
  'touch', 'vim', 'while', 'opkg', 'apk', 'command', 'return',
])
const shellKeywords = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'case', 'esac', 'do', 'done', 'in'])
const shellOperators = ['&&', '||', '2>>', '>>', '2>', '+=', '=~', '==', '!=', '|', '>', '<', ';', '{', '}', '(', ')', '=']
const commandResetOperators = new Set(['&&', '||', '|', ';'])
const outputLanguages = new Set<TerminalOutputLanguage>(['shell', 'json', 'yaml', 'ini', 'log', 'uci', 'generic'])
const defaultMaxTokens = 420
const defaultDiagnostics: TerminalViewportHighlighterDiagnostics = {
  apiAvailable: false,
  visibleRows: 0,
  tokensGenerated: 0,
  decorationsRegistered: 0,
  decorationsRejected: 0,
  markersRejected: 0,
  skippedRemoteColor: 0,
  preservedAnsiCells: 0,
  semanticDecorationsRegistered: 0,
  skipReason: null,
  lastError: null,
}

export function highlightTerminalViewportLine(
  line: string,
  maxTokens = defaultMaxTokens,
  language: TerminalOutputLanguage | null = null,
): TerminalHighlightSpan[] {
  const text = String(line ?? '')
  if (!text.trim()) return []
  if (language === 'shell') return cap(tokenizeShellLike(text), maxTokens)
  if (language === 'uci') return cap(tokenizeUciLine(text), maxTokens)
  if (language && language !== 'generic') return cap(tokenizeGenericLine(text), maxTokens)
  if (/^\s*#!.*\b(?:sh|bash|ash|zsh|ksh)\b/.test(text)) return [span('comment', text.trimStart(), text.search(/\S/))]
  if (/^\s*#/.test(text)) return [span('comment', text.trimStart(), text.search(/\S/))]
  if (looksLikeUciLine(text)) return cap(tokenizeUciLine(text), maxTokens)

  const prompt = promptCommandRange(text)
  if (prompt) return cap(tokenizeCommandWithPositions(prompt.command, prompt.start), maxTokens)

  if (looksLikeShellCode(text)) return cap(tokenizeShellLike(text), maxTokens)
  return cap(tokenizeGenericLine(text), maxTokens)
}

export class TerminalViewportHighlighter {
  private readonly terminal: TerminalViewportLike
  private readonly root: HTMLElement
  private readonly isActive: () => boolean
  private readonly isVisible: () => boolean
  private readonly getAlternateScreenHighlightHint: () => TerminalFileEditorHighlightHint | null
  private readonly maxTokens: number
  private readonly decorations: TerminalDecorationLike[] = []
  private readonly markers: TerminalMarkerLike[] = []
  private frame: number | null = null
  private paused = false
  private decorationRuntimeAvailable = true
  private diagnostics: TerminalViewportHighlighterDiagnostics = { ...defaultDiagnostics }

  constructor(options: TerminalViewportHighlighterOptions) {
    this.terminal = options.terminal
    this.root = options.root
    this.isActive = options.isActive ?? (() => true)
    this.isVisible = options.isVisible ?? (() => true)
    this.getAlternateScreenHighlightHint = options.getAlternateScreenHighlightHint ?? (() => null)
    this.maxTokens = Math.max(1, options.maxTokens ?? defaultMaxTokens)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    if (paused) this.clear()
    else this.schedule()
  }

  schedule() {
    if (this.frame !== null) return
    const raf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16)
    this.frame = raf(() => {
      this.frame = null
      this.renderNow()
    })
  }

  renderNow() {
    this.cancelScheduledFrame()
    this.clear()
    this.resetDiagnostics()
    if (this.paused) return this.skip('paused')
    if (!this.isActive()) return this.skip('inactive')
    if (!this.isVisible()) return this.skip('hidden')
    if (!this.root.isConnected) return this.skip('disconnected')
    this.diagnostics.apiAvailable = this.canDecorate()
    if (!this.diagnostics.apiAvailable) return this.skip('decoration_api_unavailable')
    const active = this.terminal.buffer.active
    const alternateScreen = active.type === 'alternate'
    const alternateHint = alternateScreen ? this.getAlternateScreenHighlightHint() : null
    if (alternateScreen && !alternateHint) return this.skip('alternate_screen')

    const viewportY = Math.max(0, active.viewportY ?? 0)
    const cursorBufferLine = Math.max(0, (active.baseY ?? 0) + (active.cursorY ?? 0))
    const statusRows = alternateScreen ? 1 : 0
    const rows = Math.max(0, Math.min(Math.max(0, this.terminal.rows - statusRows), 200))
    this.diagnostics.visibleRows = rows
    let rendered = 0
    let outputLanguage: TerminalOutputLanguage | null = alternateHint
      ? normalizeOutputLanguage(alternateHint.detectedLanguage) ?? terminalLanguageFromFilePath(alternateHint.path) ?? 'generic'
      : null
    for (let row = 0; row < rows; row += 1) {
      if (rendered >= this.maxTokens) break
      const bufferLine = viewportY + row
      const line = active.getLine?.(viewportY + row)
      if (!line) continue
      const text = line.translateToString(true)
      if (!text.trim()) continue
      if (line.isWrapped) continue
      const remaining = Math.max(0, this.maxTokens - rendered)
      const prompt = promptCommandRange(text)
      const shebangLanguage = languageFromShebang(text)
      const lineLanguage = prompt ? null : shebangLanguage ?? outputLanguage
      let spans = prompt
        ? tokenizeCommandWithPositions(prompt.command, prompt.start)
        : highlightTerminalViewportLine(text, Number.MAX_SAFE_INTEGER, lineLanguage)
      if (spans.length > remaining) spans = tokenizeGenericLine(text)
      spans = spans.slice(0, remaining)
      this.diagnostics.tokensGenerated += spans.length
      const cursorColumn = alternateScreen && row === (active.cursorY ?? -1) ? active.cursorX ?? 0 : null
      rendered += this.decorateLine(bufferLine - cursorBufferLine, spans, line, text, cursorColumn)
      if (prompt) outputLanguage = inferOutputLanguageFromCommand(prompt.command)
      else if (shebangLanguage) outputLanguage = shebangLanguage
    }
    if (rendered > 0) this.refresh()
  }

  dispose() {
    this.cancelScheduledFrame()
    this.clear()
  }

  getDiagnostics(): TerminalViewportHighlighterDiagnostics {
    return { ...this.diagnostics }
  }

  private cancelScheduledFrame() {
    if (this.frame === null || typeof window === 'undefined') {
      this.frame = null
      return
    }
    try {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.frame)
      } else {
        window.clearTimeout(this.frame)
      }
    } catch {
      window.clearTimeout(this.frame)
    } finally {
      this.frame = null
    }
  }

  private clear() {
    const decorations = this.decorations.splice(0)
    for (const decoration of decorations) safeDispose(decoration)
    const markers = this.markers.splice(0)
    for (const marker of markers) safeDispose(marker)
  }

  private canDecorate() {
    return this.decorationRuntimeAvailable &&
      typeof this.terminal.registerMarker === 'function' &&
      typeof this.terminal.registerDecoration === 'function'
  }

  private resetDiagnostics() {
    this.diagnostics = {
      ...defaultDiagnostics,
      apiAvailable: this.canDecorate(),
    }
  }

  private skip(reason: string) {
    this.diagnostics.skipReason = reason
  }

  private recordError(error: unknown) {
    this.diagnostics.lastError = String(error instanceof Error ? error.message : error)
  }

  private refresh() {
    try {
      this.terminal.refresh?.(0, Math.max(0, this.terminal.rows - 1))
    } catch (error) {
      this.recordError(error)
    }
  }

  private decorateLine(
    cursorYOffset: number,
    spans: TerminalHighlightSpan[],
    line: TerminalBufferLineLike,
    text: string,
    cursorColumn: number | null = null,
  ) {
    if (!this.terminal.registerMarker || !this.terminal.registerDecoration || spans.length === 0) return 0
    const cells = buildCellMap(line, text, this.terminal.cols)
    if (cells.length === 0) return 0
    if (cursorColumn !== null) {
      for (const cell of cells) {
        if (cell.x <= cursorColumn && cursorColumn < cell.x + cell.width) {
          cell.unsafeAttributes = true
        }
      }
    }
    let marker: TerminalMarkerLike | null = null
    let markerTracked = false
    let rendered = 0
    for (const item of spans) {
      if (rendered >= this.maxTokens) break
      const placement = cellDecorationPlacement(item, cells, this.terminal.cols)
      if (placement.preservedAnsiCells > 0) {
        this.diagnostics.preservedAnsiCells += placement.preservedAnsiCells
        this.diagnostics.skippedRemoteColor += placement.skippedRemoteColor
      }
      if (placement.segments.length === 0) continue
      if (!marker) {
        let nextMarker: TerminalMarkerLike | undefined
        try {
          nextMarker = this.terminal.registerMarker(cursorYOffset)
        } catch (error) {
          this.recordError(error)
          this.decorationRuntimeAvailable = false
          break
        }
        if (!nextMarker) {
          this.diagnostics.markersRejected += 1
          break
        }
        marker = nextMarker
      }
      for (const segment of placement.segments) {
        if (rendered >= this.maxTokens) break
        let decoration: TerminalDecorationLike | undefined
        try {
          decoration = this.terminal.registerDecoration({
            marker,
            x: segment.x,
            width: segment.width,
            height: 1,
            foregroundColor: terminalDecorationColor(item.type),
            layer: 'bottom',
          })
        } catch (error) {
          this.recordError(error)
          this.decorationRuntimeAvailable = false
          break
        }
        if (!decoration) {
          this.diagnostics.decorationsRejected += 1
          this.decorationRuntimeAvailable = false
          continue
        }
        if (!markerTracked) {
          this.markers.push(marker)
          markerTracked = true
        }
        this.decorations.push(decoration)
        rendered += 1
        this.diagnostics.decorationsRegistered += 1
        this.diagnostics.semanticDecorationsRegistered += 1
      }
      if (!this.decorationRuntimeAvailable) break
    }
    if (marker && !markerTracked) safeDispose(marker)
    return rendered
  }
}

function promptCommandRange(line: string): { start: number; command: string } | null {
  if (/^\s*#/.test(line)) return null
  const match = line.match(/^([^\n\r;&|<>]{1,120}[$#>]\s+)(.+)$/)
  if (!match) return null
  const prompt = match[1]
  if (!/[~/:@\\\]]/.test(prompt) && !/^\s*[$#>]\s+$/.test(prompt)) return null
  return { start: prompt.length, command: match[2] }
}

function tokenizeCommandWithPositions(command: string, offset = 0): TerminalHighlightSpan[] {
  const spans: TerminalHighlightSpan[] = []
  let cursor = 0
  for (const token of tokenizeCommand(command)) {
    const start = cursor
    cursor += token.value.length
    if (token.type === 'whitespace') continue
    spans.push({
      type: token.type,
      text: token.value,
      start: offset + start,
      end: offset + cursor,
    })
  }
  return spans
}

function looksLikeShellCode(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{?/.test(trimmed)) return true
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\+?=)/.test(trimmed)) return true
  const first = trimmed.match(/^([A-Za-z_][\w.-]*)/)?.[1] ?? ''
  return shellCommands.has(first) || /(?:&&|\|\||[;|<>])/.test(trimmed)
}

function tokenizeShellLike(line: string): TerminalHighlightSpan[] {
  const spans: TerminalHighlightSpan[] = []
  let index = 0
  let expectingCommand = true
  while (index < line.length) {
    const char = line[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '#') {
      spans.push({ type: 'comment', text: line.slice(index), start: index, end: line.length })
      break
    }
    if (char === '\'' || char === '"') {
      const start = index
      const quote = char
      index += 1
      while (index < line.length) {
        if (line[index] === '\\' && quote === '"') {
          index += 2
          continue
        }
        if (line[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      spans.push({ type: 'string', text: line.slice(start, index), start, end: index })
      if (quote === '"') spans.push(...tokenizeShellStringContent(line, start + 1, Math.max(start + 1, index - 1)))
      expectingCommand = false
      continue
    }
    const variable = matchShellVariable(line.slice(index))
    if (variable) {
      spans.push({ type: 'variable', text: variable, start: index, end: index + variable.length })
      index += variable.length
      expectingCommand = false
      continue
    }
    const operator = shellOperators.find((candidate) => line.startsWith(candidate, index))
    if (operator) {
      spans.push({ type: 'operator', text: operator, start: index, end: index + operator.length })
      index += operator.length
      if (commandResetOperators.has(operator)) expectingCommand = true
      continue
    }
    const start = index
    while (
      index < line.length &&
      !/\s/.test(line[index]) &&
      line[index] !== '\'' &&
      line[index] !== '"' &&
      line[index] !== '#' &&
      !shellOperators.some((operator) => line.startsWith(operator, index))
    ) {
      index += 1
    }
    const text = line.slice(start, index)
    if (!text) {
      index += 1
      continue
    }
    const nextNonSpace = line.slice(index).match(/^\s*(\(\)|=|\+=)/)?.[1] ?? ''
    const type = classifyShellWord(text, expectingCommand, nextNonSpace)
    spans.push({ type, text, start, end: index })
    expectingCommand = false
  }
  return spans
}

function classifyShellWord(text: string, expectingCommand: boolean, next: string): TerminalHighlightTokenType {
  if (next === '()') return 'function'
  if (next === '=' || next === '+=') return 'variable'
  if (shellKeywords.has(text)) return 'keyword'
  const commandType = classifyGenericValue(text)
  if (commandType) return commandType
  if (/^--?[\w][\w-]*(?:=.*)?$/.test(text)) return 'option'
  if (expectingCommand || shellCommands.has(text)) return text === 'rm' ? 'danger' : 'command'
  return 'argument'
}

function tokenizeShellStringContent(line: string, start: number, end: number): TerminalHighlightSpan[] {
  const spans: TerminalHighlightSpan[] = []
  const slice = line.slice(start, end)
  addMatches(slice, /\$\{[A-Za-z_][A-Za-z0-9_]*(?::[-=?+][^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
    spans.push({ type: 'variable', text: match[0], start: start + match.index, end: start + match.index + match[0].length })
  })
  addMatches(slice, /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)[^\s"'<>;|]+/g, (match) => {
    spans.push({ type: 'path', text: match[0], start: start + match.index, end: start + match.index + match[0].length })
  })
  return spans
}

function matchShellVariable(value: string) {
  return value.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*(?::[-=?+][^}]*)?\}/)?.[0] ??
    value.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)?.[0] ??
    null
}

function languageFromShebang(line: string): TerminalOutputLanguage | null {
  return /^\s*#!.*\b(?:sh|bash|ash|zsh|ksh)\b/.test(line) ? 'shell' : null
}

function normalizeOutputLanguage(value: unknown): TerminalOutputLanguage | null {
  const normalized = String(value ?? '').toLowerCase()
  return outputLanguages.has(normalized as TerminalOutputLanguage) ? normalized as TerminalOutputLanguage : null
}

function inferOutputLanguageFromCommand(command: string): TerminalOutputLanguage | null {
  const words = shellWords(command)
  if (words.length === 0) return null
  let commandIndex = 0
  while (commandIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[commandIndex])) commandIndex += 1
  if (['sudo', 'doas', 'env', 'busybox'].includes(baseCommandName(words[commandIndex] ?? ''))) commandIndex += 1
  const executable = baseCommandName(words[commandIndex] ?? '')
  if (!['cat', 'head', 'tail', 'sed'].includes(executable)) return null
  const file = [...words.slice(commandIndex + 1)]
    .reverse()
    .map((word) => unquoteShellWord(word))
    .find((word) => isLikelyReadFileArgument(word))
  return file ? languageFromFileName(file) : null
}

function shellWords(command: string) {
  return tokenizeCommand(command)
    .filter((token) => token.type !== 'whitespace' && token.type !== 'comment' && token.type !== 'operator')
    .map((token) => token.value)
}

function baseCommandName(value: string) {
  const word = unquoteShellWord(value).toLowerCase()
  return word.split(/[\\/]/).pop() ?? word
}

function unquoteShellWord(value: string) {
  const word = String(value ?? '')
  if (word.length >= 2 && ((word.startsWith('"') && word.endsWith('"')) || (word.startsWith("'") && word.endsWith("'")))) {
    return word.slice(1, -1)
  }
  return word
}

function isLikelyReadFileArgument(value: string) {
  if (!value || value.startsWith('-')) return false
  if (/^\d+$/.test(value)) return false
  if (/^[\d,$+\-]+p$/.test(value)) return false
  return Boolean(languageFromFileName(value))
}

function languageFromFileName(value: string): TerminalOutputLanguage | null {
  const explicit = normalizeOutputLanguage(terminalLanguageFromFilePath(value))
  if (explicit) return explicit
  const lower = value.toLowerCase().split(/[?#]/)[0]
  if (/\.(?:sh|bash|zsh|ash|ksh)$/.test(lower)) return 'shell'
  if (/\.json$/.test(lower)) return 'json'
  if (/\.(?:ya?ml)$/.test(lower)) return 'yaml'
  if (/\.(?:conf|ini|env|service)$/.test(lower)) return 'ini'
  if (/\.log$/.test(lower)) return 'log'
  return null
}

function looksLikeUciLine(line: string) {
  return /^\s*(?:config|option|list|package)\b/.test(line)
}

function tokenizeUciLine(line: string): TerminalHighlightSpan[] {
  const spans: TerminalHighlightSpan[] = []
  const commentStart = findUnquotedHash(line)
  const contentEnd = commentStart >= 0 ? commentStart : line.length
  const content = line.slice(0, contentEnd)
  const keyword = content.match(/^(\s*)(config|option|list|package)\b/)
  if (keyword) {
    const keywordStart = keyword[1].length
    spans.push({ type: 'keyword', text: keyword[2], start: keywordStart, end: keywordStart + keyword[2].length })
    const restStart = keywordStart + keyword[2].length
    const rest = content.slice(restStart)
    const firstWord = rest.match(/^(\s+)([A-Za-z0-9_.:-]+)/)
    if (firstWord) {
      const start = restStart + firstWord[1].length
      const type: TerminalHighlightTokenType = keyword[2] === 'option' || keyword[2] === 'list' ? 'key' : 'argument'
      spans.push({ type, text: firstWord[2], start, end: start + firstWord[2].length })
    }
  }

  addQuotedSpans(content, spans)
  addUnquotedUciValueSpans(content, spans)
  if (commentStart >= 0) {
    spans.push({ type: 'comment', text: line.slice(commentStart), start: commentStart, end: line.length })
  }
  return spans.sort((left, right) => left.start - right.start || left.end - right.end)
}

function findUnquotedHash(line: string) {
  let quote = ''
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '\\' && quote === '"') {
      index += 1
      continue
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char
      continue
    }
    if (quote && char === quote) {
      quote = ''
      continue
    }
    if (!quote && char === '#') return index
  }
  return -1
}

function addQuotedSpans(line: string, spans: TerminalHighlightSpan[]) {
  addMatches(line, /'[^']*'|"(?:\\.|[^"\\])*"/g, (match) => {
    const start = match.index
    const end = start + match[0].length
    spans.push({ type: 'string', text: match[0], start, end })
    const innerStart = start + 1
    const inner = match[0].slice(1, -1)
    addValueSpans(inner, innerStart, spans, true)
  })
}

function addUnquotedUciValueSpans(line: string, spans: TerminalHighlightSpan[]) {
  let segmentStart = 0
  addMatches(line, /'[^']*'|"(?:\\.|[^"\\])*"/g, (match) => {
    addValueSpans(line.slice(segmentStart, match.index), segmentStart, spans, false)
    segmentStart = match.index + match[0].length
  })
  addValueSpans(line.slice(segmentStart), segmentStart, spans, false)
}

function addValueSpans(
  text: string,
  offset: number,
  spans: TerminalHighlightSpan[],
  allowOverlap = false,
) {
  const occupied: Array<[number, number]> = []
  const add = (type: TerminalHighlightTokenType, start: number, end: number) => {
    const absoluteStart = offset + start
    const absoluteEnd = offset + end
    if (
      absoluteEnd <= absoluteStart ||
      occupied.some(([left, right]) => start < right && end > left) ||
      (!allowOverlap && spans.some((span) => absoluteStart < span.end && absoluteEnd > span.start))
    ) return
    spans.push({ type, text: text.slice(start, end), start: absoluteStart, end: absoluteEnd })
    occupied.push([start, end])
  }
  addMatches(text, /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, (match) => add('mac', match.index, match.index + match[0].length))
  addMatches(text, /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}\b/gi, (match) => add('ip', match.index, match.index + match[0].length))
  addMatches(text, /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, (match) => add(match[0].includes(':') ? 'port' : 'ip', match.index, match.index + match[0].length))
  addMatches(text, /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)[^\s"'<>;|]+/g, (match) => add('path', match.index, match.index + match[0].length))
  addMatches(text, /\b\d+(?:\.\d+)?\b/g, (match) => add('number', match.index, match.index + match[0].length))
}

function tokenizeGenericLine(line: string): TerminalHighlightSpan[] {
  const spans: TerminalHighlightSpan[] = []
  const occupied: Array<[number, number]> = []
  const add = (type: TerminalHighlightTokenType, start: number, end: number) => {
    if (start < 0 || end <= start || occupied.some(([left, right]) => start < right && end > left)) return
    spans.push({ type, text: line.slice(start, end), start, end })
    occupied.push([start, end])
  }
  addMatches(line, /\bhttps?:\/\/[^\s"'<>]+/gi, (match) => add('url', match.index, match.index + match[0].length))
  addMatches(line, /\b\d{4}-\d{2}-\d{2}\b/g, (match) => add('date', match.index, match.index + match[0].length))
  addMatches(line, /\b(?:ERROR|WARN|INFO|DEBUG|TRACE)\b/g, (match) => add('log-level', match.index, match.index + match[0].length))
  addMatches(line, /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, (match) => add('mac', match.index, match.index + match[0].length))
  addMatches(line, /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}\b/gi, (match) => add('ip', match.index, match.index + match[0].length))
  addMatches(line, /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, (match) => add(match[0].includes(':') ? 'port' : 'ip', match.index, match.index + match[0].length))
  addMatches(line, /\b[A-Za-z_][\w.-]*=/g, (match) => add('key', match.index, match.index + match[0].length))
  addMatches(line, /(?:^|[\s=])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)[^\s"'<>;|]+)/g, (match) => {
    const start = match.index + match[0].length - match[1].length
    add('path', start, start + match[1].length)
  })
  addMatches(line, /\b\d+(?:\.\d+)?\b/g, (match) => add('number', match.index, match.index + match[0].length))
  return spans.sort((left, right) => left.start - right.start)
}

function classifyGenericValue(text: string): TerminalHighlightTokenType | null {
  if (/^https?:\/\/\S+$/i.test(text)) return 'url'
  if (/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i.test(text)) return 'mac'
  if (/^(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}$/i.test(text)) return 'ip'
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(text)) return text.includes(':') ? 'port' : 'ip'
  if (/^(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)\S+$/.test(text)) return 'path'
  if (/^\d+(?:\.\d+)?$/.test(text)) return 'number'
  return null
}

function addMatches(
  line: string,
  expression: RegExp,
  handle: (match: RegExpExecArray) => void,
) {
  expression.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = expression.exec(line)) !== null) {
    handle(match)
    if (match[0].length === 0) expression.lastIndex += 1
  }
}

function cap(spans: TerminalHighlightSpan[], maxTokens: number) {
  return spans.slice(0, Math.max(0, maxTokens))
}

function span(type: TerminalHighlightTokenType, text: string, start: number): TerminalHighlightSpan {
  const safeStart = Math.max(0, start)
  return { type, text, start: safeStart, end: safeStart + text.length }
}

function buildCellMap(line: TerminalBufferLineLike, text: string, cols: number): TerminalCellSpan[] {
  const limit = Math.max(0, cols)
  if (!line.getCell) return buildFallbackCellMap(text, limit, true)
  const cells: TerminalCellSpan[] = []
  let offset = 0
  for (let column = 0; column < limit && offset < text.length; column += 1) {
    const cell = line.getCell(column)
    const width = cell?.getWidth?.() ?? guessedCellWidthAt(text, offset)
    if (width === 0) continue
    const chars = cell?.getChars?.() ?? ''
    const fallback = nextStringCell(text, offset)
    const value = chars || fallback.value
    const length = Math.max(1, value.length)
    cells.push({
      start: offset,
      end: Math.min(text.length, offset + length),
      x: column,
      width: Math.max(1, width),
      invalid: !cell,
      ...readCellAttributes(cell),
    })
    offset += length
  }
  return cells
}

function buildFallbackCellMap(text: string, cols: number, unsafeAttributes = false): TerminalCellSpan[] {
  const cells: TerminalCellSpan[] = []
  let offset = 0
  let column = 0
  while (offset < text.length && column < cols) {
    const next = nextStringCell(text, offset)
    cells.push({
      start: offset,
      end: offset + next.value.length,
      x: column,
      width: next.width,
      unsafeAttributes,
    })
    offset += next.value.length
    column += next.width
  }
  return cells
}

function cellDecorationPlacement(item: TerminalHighlightSpan, cells: TerminalCellSpan[], cols: number) {
  const empty = { segments: [] as Array<{ x: number; width: number }>, preservedAnsiCells: 0, skippedRemoteColor: 0 }
  if (item.start < 0 || item.end <= item.start) return empty
  const covered = cells.filter((cell) => item.start < cell.end && item.end > cell.start)
  if (covered.length === 0 || covered.some((cell) => cell.invalid)) return empty
  const first = covered[0]
  const last = covered[covered.length - 1]
  if (first.start !== item.start || last.end !== item.end) return empty
  const segments: Array<{ x: number; width: number }> = []
  let current: { x: number; right: number } | null = null
  let preservedAnsiCells = 0
  let skippedRemoteColor = 0
  for (const cell of covered) {
    const x = Math.max(0, Math.min(Math.max(0, cols), cell.x))
    const right = Math.max(x, Math.min(Math.max(0, cols), cell.x + cell.width))
    const width = right - x
    if (width <= 0) continue
    if (cell.remoteForeground) {
      preservedAnsiCells += width
      skippedRemoteColor += 1
    }
    const canDecorate = !cell.remoteForeground && !cell.unsafeAttributes
    if (!canDecorate) {
      if (current) {
        const currentWidth = current.right - current.x
        if (currentWidth > 0) segments.push({ x: current.x, width: currentWidth })
        current = null
      }
      continue
    }
    if (!current) {
      current = { x, right }
      continue
    }
    if (x === current.right) {
      current.right = right
      continue
    }
    const currentWidth = current.right - current.x
    if (currentWidth > 0) segments.push({ x: current.x, width: currentWidth })
    current = { x, right }
  }
  if (current) {
    const width = current.right - current.x
    if (width > 0) segments.push({ x: current.x, width })
  }
  return { segments, preservedAnsiCells, skippedRemoteColor }
}

function readCellAttributes(cell: TerminalBufferCellLike | undefined): Pick<TerminalCellSpan, 'remoteForeground' | 'unsafeAttributes'> {
  if (!cell) return { remoteForeground: false, unsafeAttributes: true }
  const fgDefault = callBoolean(cell, 'isFgDefault')
  const bgDefault = callBoolean(cell, 'isBgDefault')
  const attributeDefault = callBoolean(cell, 'isAttributeDefault')
  const inverse = callFlag(cell, 'isInverse')
  const invisible = callFlag(cell, 'isInvisible')
  if (fgDefault === null || bgDefault === null || attributeDefault === null || inverse === null || invisible === null) {
    return { remoteForeground: false, unsafeAttributes: true }
  }
  const remoteForeground = !fgDefault || callBoolean(cell, 'isFgPalette') === true || callBoolean(cell, 'isFgRGB') === true
  const remoteBackground = !bgDefault || callBoolean(cell, 'isBgPalette') === true || callBoolean(cell, 'isBgRGB') === true
  const complexAttributes = !attributeDefault && !remoteForeground && !remoteBackground
  return {
    remoteForeground,
    unsafeAttributes: remoteBackground || inverse || invisible || complexAttributes,
  }
}

function callBoolean(cell: TerminalBufferCellLike, method: TerminalBooleanCellMethod): boolean | null {
  const value = cell[method]
  if (typeof value !== 'function') return null
  try {
    return Boolean(value.call(cell))
  } catch {
    return null
  }
}

function callFlag(cell: TerminalBufferCellLike, method: TerminalFlagCellMethod): boolean | null {
  const value = cell[method]
  if (typeof value !== 'function') return null
  try {
    return Boolean(value.call(cell))
  } catch {
    return null
  }
}

function nextStringCell(text: string, offset: number) {
  const value = Array.from(text.slice(offset))[0] ?? ' '
  return { value, width: guessedCellWidth(value) }
}

function guessedCellWidthAt(text: string, offset: number) {
  return guessedCellWidth(nextStringCell(text, offset).value)
}

function guessedCellWidth(value: string) {
  return value.charCodeAt(0) > 0x7e ? 2 : 1
}

function terminalDecorationColor(type: TerminalHighlightTokenType) {
  switch (type) {
    case 'command':
      return '#93c5fd'
    case 'subcommand':
    case 'function':
      return '#67e8f9'
    case 'option':
      return '#fde047'
    case 'string':
      return '#34d399'
    case 'variable':
    case 'key':
      return '#f9a8d4'
    case 'keyword':
      return '#c4b5fd'
    case 'path':
      return '#a7f3d0'
    case 'operator':
      return '#f0abfc'
    case 'comment':
      return '#94a3b8'
    case 'number':
    case 'ip':
    case 'mac':
    case 'port':
    case 'url':
    case 'date':
      return '#fb923c'
    case 'log-level':
      return '#f97316'
    case 'danger':
      return '#f87171'
    default:
      return '#dbeafe'
  }
}

function safeDispose(value: { dispose: () => void }) {
  try {
    value.dispose()
  } catch {
    // Decorations are best-effort visual state; stale disposal must not affect terminal I/O.
  }
}
