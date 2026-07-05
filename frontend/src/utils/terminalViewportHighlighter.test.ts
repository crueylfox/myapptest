// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  TerminalViewportHighlighter,
  highlightTerminalViewportLine,
} from './terminalViewportHighlighter'
import type { TerminalViewportLike } from './terminalViewportHighlighter'
import type { TerminalFileEditorHighlightHint } from './terminalFileEditorHint'

type DecorationOptions = Parameters<NonNullable<TerminalViewportLike['registerDecoration']>>[0]

type FakeMarker = {
  id: number
  line: number
  isDisposed: boolean
  disposed: boolean
  onDispose: () => { dispose: () => void }
  dispose: () => void
}

type FakeDecoration = {
  options: DecorationOptions
  disposed: boolean
  dispose: () => void
}

type FakeCellAttributes = Partial<{
  fgPalette: boolean
  fgRGB: boolean
  bgPalette: boolean
  bgRGB: boolean
  inverse: boolean
  invisible: boolean
}>

function fakeLine(text: string, options: {
  wrapped?: boolean
  badCells?: number[]
  cellAttributes?: Record<number, FakeCellAttributes>
  requireCellMethodThis?: boolean
} = {}) {
  const cells: Array<{ chars: string; width: number }> = []
  for (const char of Array.from(text)) {
    const width = char.charCodeAt(0) > 0x7e ? 2 : 1
    cells.push({ chars: char, width })
    if (width === 2) cells.push({ chars: '', width: 0 })
  }
  return {
    isWrapped: options.wrapped ?? false,
    length: cells.length,
    translateToString(trimRight?: boolean) {
      return trimRight ? text.replace(/\s+$/g, '') : text
    },
    getCell(index: number) {
      if (options.badCells?.includes(index)) return undefined
      const cell = cells[index] ?? { chars: '', width: 1 }
      const attrs = options.cellAttributes?.[index] ?? {}
      const fakeCell = {
        getWidth() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('getWidth lost this')
          return cell.width
        },
        getChars() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('getChars lost this')
          return cell.chars
        },
        getCode() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('getCode lost this')
          return cell.chars.codePointAt(0) ?? 0
        },
        isFgDefault() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isFgDefault lost this')
          return !attrs.fgPalette && !attrs.fgRGB
        },
        isFgPalette() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isFgPalette lost this')
          return Boolean(attrs.fgPalette)
        },
        isFgRGB() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isFgRGB lost this')
          return Boolean(attrs.fgRGB)
        },
        isBgDefault() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isBgDefault lost this')
          return !attrs.bgPalette && !attrs.bgRGB
        },
        isBgPalette() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isBgPalette lost this')
          return Boolean(attrs.bgPalette)
        },
        isBgRGB() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isBgRGB lost this')
          return Boolean(attrs.bgRGB)
        },
        isAttributeDefault() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isAttributeDefault lost this')
          return !attrs.fgPalette && !attrs.fgRGB && !attrs.bgPalette && !attrs.bgRGB && !attrs.inverse && !attrs.invisible
        },
        isInverse() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isInverse lost this')
          return attrs.inverse ? 1 : 0
        },
        isInvisible() {
          if (options.requireCellMethodThis && this !== fakeCell) throw new Error('isInvisible lost this')
          return attrs.invisible ? 1 : 0
        },
      }
      return fakeCell
    },
  }
}

function fakeTerminal(lines: string[], options: Partial<{
  rows: number
  cols: number
  viewportY: number
  baseY: number
  cursorY: number
  cursorX: number
  type: string
  wrappedRows: number[]
  badCellsByRow: Record<number, number[]>
  cellAttributesByRow: Record<number, Record<number, FakeCellAttributes>>
  requireCellMethodThis: boolean
  decorationApi: boolean
  decorationThrows: boolean
  decorationUndefined: boolean
  requireTerminalMethodThis: boolean
}> = {}) {
  const calls: number[] = []
  const markers: FakeMarker[] = []
  const decorations: FakeDecoration[] = []
  const baseY = options.baseY ?? 10
  const cursorY = options.cursorY ?? 2
  const active = {
    baseY,
    cursorY,
    cursorX: options.cursorX ?? 0,
    viewportY: options.viewportY ?? 0,
    type: options.type ?? 'normal',
    getLine(index: number) {
      calls.push(index)
      const text = lines[index]
      return text == null
        ? undefined
        : fakeLine(text, {
          wrapped: (options.wrappedRows ?? []).includes(index),
          badCells: options.badCellsByRow?.[index],
          cellAttributes: options.cellAttributesByRow?.[index],
          requireCellMethodThis: options.requireCellMethodThis,
        })
    },
  }
  let markerID = 0
  const terminal = {
    rows: options.rows ?? lines.length,
    cols: options.cols ?? 100,
    buffer: { active },
    refresh: vi.fn(),
  } as {
    rows: number
    cols: number
    buffer: { active: typeof active }
    registerMarker?: (cursorYOffset?: number) => FakeMarker | undefined
    registerDecoration?: (options: FakeDecoration['options']) => FakeDecoration | undefined
    refresh: (start: number, end: number) => void
  }
  if (options.decorationApi !== false) {
    terminal.registerMarker = vi.fn(function (this: typeof terminal, cursorYOffset = 0) {
      if (options.requireTerminalMethodThis && this !== terminal) throw new Error('registerMarker lost this')
      const marker: FakeMarker = {
        id: markerID += 1,
        line: baseY + cursorY + cursorYOffset,
        isDisposed: false,
        disposed: false,
        onDispose: () => ({ dispose: () => undefined }),
        dispose() {
          marker.disposed = true
          marker.isDisposed = true
        },
      }
      markers.push(marker)
      return marker
    })
    terminal.registerDecoration = vi.fn(function (this: typeof terminal, decorationOptions) {
      if (options.requireTerminalMethodThis && this !== terminal) throw new Error('registerDecoration lost this')
      if (options.decorationThrows) throw new Error('proposed API disabled')
      if (options.decorationUndefined) return undefined
      const decoration: FakeDecoration = {
        options: decorationOptions,
        disposed: false,
        dispose() {
          decoration.disposed = true
        },
      }
      decorations.push(decoration)
      return decoration
    })
  }
  return { terminal, calls, markers, decorations }
}

function mountHighlighter(lines: string[], options: Partial<{
  rows: number
  cols: number
  viewportY: number
  baseY: number
  cursorY: number
  cursorX: number
  type: string
  alternateHint: TerminalFileEditorHighlightHint | null
  visible: boolean
  active: boolean
  wrappedRows: number[]
  badCellsByRow: Record<number, number[]>
  cellAttributesByRow: Record<number, Record<number, FakeCellAttributes>>
  requireCellMethodThis: boolean
  decorationApi: boolean
  decorationThrows: boolean
  decorationUndefined: boolean
  requireTerminalMethodThis: boolean
  maxTokens: number
}> = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const { terminal, calls, markers, decorations } = fakeTerminal(lines, options)
  const highlighter = new TerminalViewportHighlighter({
    terminal,
    root,
    isActive: () => options.active ?? true,
    isVisible: () => options.visible ?? true,
    maxTokens: options.maxTokens ?? 80,
    getAlternateScreenHighlightHint: () => options.alternateHint ?? null,
  })
  return { highlighter, root, terminal, calls, markers, decorations }
}

function decorationAt(decorations: FakeDecoration[], x: number, width: number) {
  return decorations.find((decoration) => decoration.options.x === x && decoration.options.width === width)
}

function cellPlacementForText(line: string, token: string) {
  const start = line.indexOf(token)
  if (start < 0) throw new Error(`Token not found: ${token}`)
  return cellPlacementForRange(line, start, start + token.length)
}

function cellPlacementForRange(line: string, start: number, end: number) {
  let offset = 0
  let column = 0
  let x: number | null = null
  let right: number | null = null
  for (const char of Array.from(line)) {
    if (offset === start) x = column
    const width = char.charCodeAt(0) > 0x7e ? 2 : 1
    offset += char.length
    column += width
    if (offset === end) right = column
  }
  if (offset === start) x = column
  if (offset === end) right = column
  if (x === null || right === null) throw new Error(`Token does not align to cells: ${line.slice(start, end)}`)
  return { x, width: right - x }
}

function decorationForLineText(decorations: FakeDecoration[], line: string, bufferLine: number, token: string) {
  const placement = cellPlacementForText(line, token)
  return decorations.find((decoration) =>
    decoration.options.marker.line === bufferLine &&
    decoration.options.x === placement.x &&
    decoration.options.width === placement.width)
}

function attributesForToken(line: string, token: string, attrs: FakeCellAttributes) {
  const placement = cellPlacementForText(line, token)
  return attributesForCellRange(placement.x, placement.width, attrs)
}

function attributesForCellRange(x: number, width: number, attrs: FakeCellAttributes) {
  const result: Record<number, FakeCellAttributes> = {}
  for (let column = x; column < x + width; column += 1) result[column] = attrs
  return result
}

describe('terminal viewport highlighter', () => {
  it('tokenizes prompt command lines with command, option, path, and safe visual danger tokens', () => {
    const spans = highlightTerminalViewportLine('root@box:~# ls -la /etc && rm -rf /tmp/demo')

    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'command', text: 'ls' }),
      expect.objectContaining({ type: 'option', text: '-la' }),
      expect.objectContaining({ type: 'path', text: '/etc' }),
      expect.objectContaining({ type: 'danger', text: 'rm' }),
      expect.objectContaining({ type: 'operator', text: '&&' }),
    ]))
    expect(spans.find((span) => span.text === 'ls')?.start).toBe('root@box:~# '.length)
  })

  it('tokenizes shell script output with shebang, comments, variables, strings, paths, commands, and operators', () => {
    expect(highlightTerminalViewportLine('#!/bin/sh')).toEqual([
      expect.objectContaining({ type: 'comment', text: '#!/bin/sh', start: 0 }),
    ])

    const comment = highlightTerminalViewportLine('# run cleanup')
    expect(comment[0]).toEqual(expect.objectContaining({ type: 'comment', text: '# run cleanup' }))

    const assignment = highlightTerminalViewportLine('LOG_PATH="/var/log/app.log" && echo "$LOG_PATH" > /tmp/out')
    expect(assignment).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'variable', text: 'LOG_PATH' }),
      expect.objectContaining({ type: 'operator', text: '=' }),
      expect.objectContaining({ type: 'string', text: '"/var/log/app.log"' }),
      expect.objectContaining({ type: 'operator', text: '&&' }),
      expect.objectContaining({ type: 'command', text: 'echo' }),
      expect.objectContaining({ type: 'string', text: '"$LOG_PATH"' }),
      expect.objectContaining({ type: 'operator', text: '>' }),
      expect.objectContaining({ type: 'path', text: '/tmp/out' }),
    ]))
  })

  it('tokenizes generic output without requiring a shell prompt', () => {
    const spans = highlightTerminalViewportLine('2026-06-26 10:11:12 WARN host=192.168.1.5 url=https://example.test/a path=/var/log/app.log count=42')

    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'date', text: '2026-06-26' }),
      expect.objectContaining({ type: 'log-level', text: 'WARN' }),
      expect.objectContaining({ type: 'key', text: 'host=' }),
      expect.objectContaining({ type: 'ip', text: '192.168.1.5' }),
      expect.objectContaining({ type: 'url', text: 'https://example.test/a' }),
      expect.objectContaining({ type: 'path', text: '/var/log/app.log' }),
      expect.objectContaining({ type: 'number', text: '42' }),
    ]))
  })

  it('renders active viewport tokens as xterm cell decorations without overlay text', () => {
    const lines = [
      'outside-before ls -la',
      'root@box:~# ls -la /etc',
      '#!/bin/sh',
      'echo "hello" > /tmp/out',
      'outside-after ERROR',
    ]
    const { highlighter, terminal, calls, decorations, markers } = mountHighlighter(lines, {
      rows: 3,
      viewportY: 1,
      baseY: 1,
      cursorY: 2,
      cols: 80,
    })

    highlighter.renderNow()

    const promptWidth = 'root@box:~# '.length
    expect(calls).toEqual([1, 2, 3])
    expect(document.querySelector('.terminal-highlight-overlay')).toBeNull()
    expect(document.body.textContent).not.toContain('ls')
    expect(decorationAt(decorations, promptWidth, 2)?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationAt(decorations, promptWidth + 3, 3)?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationAt(decorations, promptWidth + 7, 4)?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationAt(decorations, 0, '#!/bin/sh'.length)?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationAt(decorations, 'echo "hello" > '.length, '/tmp/out'.length)?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(markers.every((marker) => marker.line >= 1 && marker.line <= 3)).toBe(true)
    expect(lines[1]).toBe('root@box:~# ls -la /etc')
    expect(terminal.refresh).toHaveBeenCalledWith(0, terminal.rows - 1)
    expect(highlighter.getDiagnostics()).toMatchObject({
      apiAvailable: true,
      decorationsRegistered: expect.any(Number),
      decorationsRejected: 0,
      skipReason: null,
    })
    expect(highlighter.getDiagnostics().decorationsRegistered).toBeGreaterThan(0)
  })

  it('calls xterm marker and decoration methods with the terminal receiver intact', () => {
    const { highlighter, decorations } = mountHighlighter([
      'root@box:~# cat 3.sh',
      'IPK="/tmp/a.ipk"',
    ], {
      rows: 2,
      baseY: 0,
      cursorY: 1,
      requireTerminalMethodThis: true,
    })

    highlighter.renderNow()

    expect(decorations.length).toBeGreaterThan(0)
    expect(highlighter.getDiagnostics().lastError).toBeNull()
  })

  it('calls xterm cell attribute methods with the cell receiver intact', () => {
    const line = 'IPK="/tmp/a.ipk"'
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      requireCellMethodThis: true,
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, line, 0, 'IPK')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationForLineText(decorations, line, 0, '/tmp/a.ipk')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(highlighter.getDiagnostics()).toMatchObject({
      decorationsRegistered: expect.any(Number),
      lastError: null,
    })
  })

  it('does not override remote ANSI palette foreground cells', () => {
    const line = 'ERROR plain'
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: {
        0: attributesForToken(line, 'ERROR', { fgPalette: true }),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, line, 0, 'ERROR')).toBeUndefined()
    expect(highlighter.getDiagnostics()).toMatchObject({
      preservedAnsiCells: expect.any(Number),
      skippedRemoteColor: expect.any(Number),
      semanticDecorationsRegistered: 0,
    })
  })

  it('does not override remote RGB foreground cells', () => {
    const line = 'https://example.test plain'
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: {
        0: attributesForToken(line, 'https://example.test', { fgRGB: true }),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, line, 0, 'https://example.test')).toBeUndefined()
    expect(highlighter.getDiagnostics()).toMatchObject({
      preservedAnsiCells: expect.any(Number),
      skippedRemoteColor: expect.any(Number),
    })
  })

  it('skips tokens with non-default background, inverse, or invisible attributes', () => {
    const lines = ['WARN /etc/nginx.conf', 'ERROR hidden']
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: 1,
      cellAttributesByRow: {
        0: attributesForToken(lines[0], 'WARN', { bgPalette: true }),
        1: {
          ...attributesForToken(lines[1], 'ERROR', { inverse: true }),
          ...attributesForToken(lines[1], 'hidden', { invisible: true }),
        },
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[0], 0, 'WARN')).toBeUndefined()
    expect(decorationForLineText(decorations, lines[1], 1, 'ERROR')).toBeUndefined()
    expect(decorationForLineText(decorations, lines[1], 1, 'hidden')).toBeUndefined()
    expect(decorations.every((decoration) => !decoration.options.backgroundColor)).toBe(true)
  })

  it('splits tokens across remote ANSI and default foreground segments', () => {
    const line = '/etc/nginx.conf'
    const remotePrefix = attributesForCellRange(0, '/etc'.length, { fgPalette: true })
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: { 0: remotePrefix },
    })

    highlighter.renderNow()

    expect(decorationAt(decorations, 0, line.length)).toBeUndefined()
    expect(decorationAt(decorations, '/etc'.length, line.length - '/etc'.length)?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(highlighter.getDiagnostics()).toMatchObject({
      preservedAnsiCells: expect.any(Number),
      semanticDecorationsRegistered: expect.any(Number),
    })
  })

  it('preserves a colored prompt while still highlighting a default-color command line', () => {
    const line = 'root@box:~# ls -la /etc'
    const prompt = 'root@box:~# '
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: {
        0: attributesForCellRange(0, prompt.length, { fgPalette: true }),
      },
    })

    highlighter.renderNow()

    expect(decorations.every((decoration) => (decoration.options.x ?? 0) >= prompt.length)).toBe(true)
    expect(decorationForLineText(decorations, line, 0, 'ls')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationForLineText(decorations, line, 0, '-la')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationForLineText(decorations, line, 0, '/etc')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('preserves ANSI-colored printf output while highlighting plain shell tokens', () => {
    const line = 'ERROR plain IPK=/tmp/a.ipk'
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: {
        0: attributesForToken(line, 'ERROR', { fgPalette: true }),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, line, 0, 'ERROR')).toBeUndefined()
    expect(decorationForLineText(decorations, line, 0, 'IPK=')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationForLineText(decorations, line, 0, '/tmp/a.ipk')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('preserves simulated ls --color path cells while highlighting adjacent default-color paths', () => {
    const line = '/etc /tmp/a.ipk'
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: {
        0: attributesForToken(line, '/etc', { fgPalette: true }),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, line, 0, '/etc')).toBeUndefined()
    expect(decorationForLineText(decorations, line, 0, '/tmp/a.ipk')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('preserves simulated grep --color match cells while highlighting default-color output tokens', () => {
    const line = 'match 192.168.1.5 /etc/hosts'
    const { highlighter, decorations } = mountHighlighter([line], {
      rows: 1,
      baseY: 0,
      cursorY: 0,
      cellAttributesByRow: {
        0: attributesForToken(line, '192.168.1.5', { fgPalette: true }),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, line, 0, '192.168.1.5')).toBeUndefined()
    expect(decorationForLineText(decorations, line, 0, '/etc/hosts')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('does not inject token HTML or duplicate glyph text while highlighting unsafe-looking text', () => {
    const { highlighter, decorations } = mountHighlighter(['root@box:~# cat <img src=x onerror=alert(1)>'], { rows: 1 })

    highlighter.renderNow()

    expect(decorations.length).toBeGreaterThan(0)
    expect(document.body.querySelector('img')).toBeNull()
    expect(document.body.textContent).not.toContain('<img')
  })

  it('disposes old decorations and rebuilds them after scroll, resize, or render events', () => {
    const { highlighter, terminal, decorations, markers } = mountHighlighter([
      'root@box:~# ls -la',
      'root@box:~# cat /etc/hosts',
    ], { rows: 1, cols: 80, baseY: 0, cursorY: 0 })

    highlighter.renderNow()
    const firstDecorations = [...decorations]
    const firstMarkers = [...markers]
    terminal.buffer.active.viewportY = 1
    highlighter.schedule()
    highlighter.renderNow()

    expect(firstDecorations.length).toBeGreaterThan(0)
    expect(firstDecorations.every((decoration) => decoration.disposed)).toBe(true)
    expect(firstMarkers.every((marker) => marker.disposed)).toBe(true)
    expect(decorations.some((decoration) => decoration.options.marker.line === 1)).toBe(true)
  })

  it('pauses and clears decorations for inactive tabs, hidden terminals, and alternate screen buffers', () => {
    const inactive = mountHighlighter(['root@box:~# ls -la'], { rows: 1, active: false })
    inactive.highlighter.renderNow()
    expect(inactive.decorations).toHaveLength(0)

    const hidden = mountHighlighter(['root@box:~# ls -la'], { rows: 1, visible: false })
    hidden.highlighter.renderNow()
    expect(hidden.decorations).toHaveLength(0)

    const alternate = mountHighlighter(['root@box:~# ls -la'], { rows: 1, type: 'alternate' })
    alternate.highlighter.renderNow()
    expect(alternate.decorations).toHaveLength(0)

    const active = mountHighlighter(['root@box:~# ls -la'], { rows: 1 })
    active.highlighter.renderNow()
    expect(active.decorations.length).toBeGreaterThan(0)
    active.highlighter.setPaused(true)
    expect(active.decorations.every((decoration) => decoration.disposed)).toBe(true)
  })

  it('allows file editor alternate screen highlighting only when a file hint is active', () => {
    const lines = [
      "config interface 'lan'",
      "  option ipaddr '192.168.100.1'",
      "  option macaddr 'aa:bb:cc:dd:ee:ff'",
      '"/etc/config/network" 12L, 300B',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: 1,
      cursorX: 0,
      type: 'alternate',
      alternateHint: {
        command: 'vi /etc/config/network',
        path: '/etc/config/network',
        detectedLanguage: 'uci',
        terminalSessionID: 'session-uci',
        startedAt: Date.now(),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[0], 0, 'config')).toBeTruthy()
    expect(decorationForLineText(decorations, lines[0], 0, "'lan'")).toBeTruthy()
    expect(decorationForLineText(decorations, lines[1], 1, 'option')).toBeTruthy()
    expect(decorationForLineText(decorations, lines[1], 1, '192.168.100.1')).toBeTruthy()
    expect(decorationForLineText(decorations, lines[2], 2, 'aa:bb:cc:dd:ee:ff')).toBeTruthy()
    expect(decorations.some((decoration) => decoration.options.marker.line === 3)).toBe(false)
    expect(document.querySelector('.terminal-highlight-overlay')).toBeNull()
  })

  it('does not override colored editor cells while applying alternate screen file highlights', () => {
    const lines = [
      "config interface 'lan'",
      "  option ipaddr '192.168.100.1'",
      'status line',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: 0,
      cursorX: lines[0].indexOf('interface'),
      type: 'alternate',
      alternateHint: {
        command: 'vim /etc/config/network',
        path: '/etc/config/network',
        detectedLanguage: 'uci',
        terminalSessionID: 'session-uci',
        startedAt: Date.now(),
      },
      cellAttributesByRow: {
        0: attributesForToken(lines[0], 'config', { fgPalette: true }),
        1: attributesForToken(lines[1], '192.168.100.1', { bgPalette: true }),
      },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[0], 0, 'config')).toBeUndefined()
    expect(decorationForLineText(decorations, lines[0], 0, 'interface')).toBeUndefined()
    expect(decorationForLineText(decorations, lines[1], 1, '192.168.100.1')).toBeUndefined()
    expect(decorationForLineText(decorations, lines[1], 1, 'option')).toBeTruthy()
  })

  it('tokenizes OpenWrt UCI config files with comments, keywords, options, quoted values, IPs, MACs, and numbers', () => {
    const spans = highlightTerminalViewportLine("  option ipaddr '192.168.100.1' # lan address", 80, 'uci')

    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'keyword', text: 'option' }),
      expect.objectContaining({ type: 'key', text: 'ipaddr' }),
      expect.objectContaining({ type: 'string', text: "'192.168.100.1'" }),
      expect.objectContaining({ type: 'ip', text: '192.168.100.1' }),
      expect.objectContaining({ type: 'comment', text: '# lan address' }),
    ]))

    const mac = highlightTerminalViewportLine("  option macaddr 'aa:bb:cc:dd:ee:ff'", 80, 'uci')
    expect(mac).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'mac', text: 'aa:bb:cc:dd:ee:ff' }),
    ]))
  })

  it('caps large visible output to a bounded number of cell decorations', () => {
    const noisyLine = Array.from({ length: 400 }, (_, index) => `key${index}=192.168.1.${index % 255}`).join(' ')
    const { highlighter, decorations, calls } = mountHighlighter([
      'outside-before ERROR',
      noisyLine,
      'outside-after ERROR',
    ], { rows: 1, viewportY: 1, cols: 240, maxTokens: 80 })

    highlighter.renderNow()

    expect(calls).toEqual([1])
    expect(decorations.length).toBeLessThanOrEqual(80)
  })

  it('treats cat output after an OpenWrt prompt as shell even when output commands are custom functions', () => {
    const lines = [
      'root@OpenWrt:~# cat 3.sh',
      'log "检测到opkg系统"',
      'root@OpenWrt:~# echo done',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[1], 1, 'log')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(decorationForLineText(decorations, lines[1], 1, '"检测到opkg系统"')?.options.foregroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('infers shell output blocks for cat, head, tail, and sed script reads', () => {
    const commands = [
      'cat /root/3.sh',
      'cat ./3.sh',
      'head -n 50 3.sh',
      'tail -n 50 3.sh',
      "sed -n '1,80p' 3.sh",
    ]

    for (const command of commands) {
      const lines = [
        `root@debian:~# ${command}`,
        'log "plain shell output"',
      ]
      const { highlighter, decorations } = mountHighlighter(lines, {
        rows: lines.length,
        baseY: 0,
        cursorY: lines.length - 1,
      })

      highlighter.renderNow()

      expect(decorationForLineText(decorations, lines[1], 1, 'log'), command).toBeTruthy()
    }
  })

  it('continues shell highlighting from a visible shebang even when the cat command is above the viewport', () => {
    const lines = [
      '#!/bin/sh',
      'log "plain shell output"',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[1], 1, 'log')).toBeTruthy()
  })

  it('decorates Chinese shell comments instead of skipping the entire non-ASCII line', () => {
    const lines = [
      'root@OpenWrt:~# cat 3.sh',
      '# 核心安装文件路径',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[1], 1, '# 核心安装文件路径')).toBeTruthy()
  })

  it('decorates variables, strings, and paths inside shell assignments read through cat', () => {
    const lines = [
      'root@OpenWrt:~# cat 3.sh',
      'IPK="/tmp/app-meta-net-identity_1.0.1_all.release.ipk"',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[1], 1, 'IPK')).toBeTruthy()
    expect(decorationForLineText(decorations, lines[1], 1, '"/tmp/app-meta-net-identity_1.0.1_all.release.ipk"')).toBeTruthy()
    expect(decorationForLineText(decorations, lines[1], 1, '/tmp/app-meta-net-identity_1.0.1_all.release.ipk')).toBeTruthy()
  })

  it('tokenizes shell keywords, variables, commands, operators, and numbers in if blocks', () => {
    const spans = highlightTerminalViewportLine('if [ -f "$IPK" ] && opkg install "$IPK"; then return 0; fi')

    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'keyword', text: 'if' }),
      expect.objectContaining({ type: 'variable', text: '$IPK' }),
      expect.objectContaining({ type: 'operator', text: '&&' }),
      expect.objectContaining({ type: 'command', text: 'opkg' }),
      expect.objectContaining({ type: 'keyword', text: 'then' }),
      expect.objectContaining({ type: 'command', text: 'return' }),
      expect.objectContaining({ type: 'number', text: '0' }),
      expect.objectContaining({ type: 'keyword', text: 'fi' }),
    ]))
  })

  it('uses xterm cell mapping for mixed Chinese shell strings without JS-length cell drift', () => {
    const lines = [
      'root@OpenWrt:~# cat 3.sh',
      'log "检测到opkg系统"',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
    })

    highlighter.renderNow()

    const stringPlacement = cellPlacementForText(lines[1], '"检测到opkg系统"')
    expect(stringPlacement.width).toBeGreaterThan('"检测到opkg系统"'.length)
    expect(decorationAt(decorations, stringPlacement.x, stringPlacement.width)?.options.marker.line).toBe(1)
  })

  it('skips only tokens with invalid cell mapping while keeping other decorations on the same line', () => {
    const lines = [
      'root@OpenWrt:~# cat 3.sh',
      'log "$BROKEN" && echo ok',
    ]
    const badVariableColumn = cellPlacementForText(lines[1], '$BROKEN').x
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
      badCellsByRow: { 1: [badVariableColumn] },
    })

    highlighter.renderNow()

    expect(decorationForLineText(decorations, lines[1], 1, 'log')).toBeTruthy()
    expect(decorationForLineText(decorations, lines[1], 1, '$BROKEN')).toBeUndefined()
    expect(decorationForLineText(decorations, lines[1], 1, 'echo')).toBeTruthy()
  })

  it('surfaces ServerPilot decoration on plain cat output instead of relying on remote ANSI ls colors', () => {
    const lines = [
      'root@centos:~# cat 3.sh',
      'MANUAL_TAR="/root/3.gz"',
    ]
    const { highlighter, decorations } = mountHighlighter(lines, {
      rows: lines.length,
      baseY: 0,
      cursorY: lines.length - 1,
    })

    highlighter.renderNow()

    const assignmentDecorations = decorations.filter((decoration) => decoration.options.marker.line === 1)
    expect(assignmentDecorations.length).toBeGreaterThanOrEqual(3)
    expect(document.body.textContent).not.toContain('MANUAL_TAR')
  })

  it('disables decoration gracefully if the xterm proposed API was not enabled', () => {
    const { highlighter, decorations } = mountHighlighter(['root@box:~# cat 3.sh'], {
      rows: 1,
      decorationThrows: true,
    })

    expect(() => highlighter.renderNow()).not.toThrow()
    expect(decorations).toHaveLength(0)
    expect(highlighter.getDiagnostics()).toMatchObject({
      apiAvailable: true,
      decorationsRegistered: 0,
      lastError: 'proposed API disabled',
    })
  })

  it('disables decoration and records diagnostics when xterm rejects a decoration request', () => {
    const { highlighter, decorations } = mountHighlighter(['root@box:~# ls -la'], {
      rows: 1,
      decorationUndefined: true,
    })

    highlighter.renderNow()

    expect(decorations).toHaveLength(0)
    expect(highlighter.getDiagnostics()).toMatchObject({
      apiAvailable: true,
      decorationsRegistered: 0,
      decorationsRejected: expect.any(Number),
    })
    expect(highlighter.getDiagnostics().decorationsRejected).toBeGreaterThan(0)
  })

  it('skips wrapped lines but no longer skips ordinary Chinese lines', () => {
    const { highlighter, decorations } = mountHighlighter([
      'root@box:~# ls -la',
      '# 中文注释',
      '用户@box:~# ls -la',
    ], { rows: 2, wrappedRows: [0] })

    highlighter.renderNow()

    expect(decorations.some((decoration) => decoration.options.marker.line === 0)).toBe(false)
    expect(decorations.some((decoration) => decoration.options.marker.line === 1)).toBe(true)
  })

  it('leaves real terminal viewport highlighting disabled when xterm decoration API is unavailable', () => {
    const { highlighter, root, terminal } = mountHighlighter(['root@box:~# ls -la'], {
      rows: 1,
      decorationApi: false,
    })

    highlighter.renderNow()

    expect('registerDecoration' in terminal).toBe(false)
    expect(root.children).toHaveLength(0)
    expect(document.querySelector('.terminal-highlight-overlay')).toBeNull()
  })
})
