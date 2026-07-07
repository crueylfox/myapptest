import type { CSSProperties } from 'vue'
import type { ITerminalOptions, ITheme } from '@xterm/xterm'
import type { TerminalProfile, TerminalThemeName } from '../types'

type ThemePreset = Pick<TerminalProfile,
  'foreground' | 'background' | 'selectionBackground' | 'cursorColor'
> & Required<Pick<ITheme,
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow'
  | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite'
>>

const fallbackTheme: ThemePreset = {
  foreground: '#d7dde5',
  background: '#15171a',
  selectionBackground: '#5b8cff47',
  cursorColor: '#dce6f2',
  black: '#1f2328',
  red: '#ff5f6d',
  green: '#70d787',
  yellow: '#f6c177',
  blue: '#6aa2ff',
  magenta: '#c792ea',
  cyan: '#5eead4',
  white: '#d7dde5',
  brightBlack: '#777d88',
  brightRed: '#ff7b86',
  brightGreen: '#8be99f',
  brightYellow: '#ffd28a',
  brightBlue: '#82b4ff',
  brightMagenta: '#d7a3ff',
  brightCyan: '#78f2e3',
  brightWhite: '#f0f3f6',
}

export const terminalThemePresets: Record<TerminalThemeName, ThemePreset> = {
  'serverpilot-dark': fallbackTheme,
  'classic-dark': {
    foreground: '#e5e7eb',
    background: '#050505',
    selectionBackground: '#3b82f666',
    cursorColor: '#f8fafc',
    black: '#0a0a0a',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
  light: {
    foreground: '#111827',
    background: '#f8fafc',
    selectionBackground: '#93c5fd88',
    cursorColor: '#1d4ed8',
    black: '#1f2937',
    red: '#dc2626',
    green: '#15803d',
    yellow: '#a16207',
    blue: '#2563eb',
    magenta: '#a21caf',
    cyan: '#0e7490',
    white: '#d1d5db',
    brightBlack: '#6b7280',
    brightRed: '#ef4444',
    brightGreen: '#16a34a',
    brightYellow: '#ca8a04',
    brightBlue: '#3b82f6',
    brightMagenta: '#c026d3',
    brightCyan: '#0891b2',
    brightWhite: '#f9fafb',
  },
  custom: fallbackTheme,
}

const hexColorPattern = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const unsafeFontFamilyPattern = /[;{}]|<\s*script/i

export interface TerminalFontPreset {
  value: string
  label: string
  family: string
}

export const terminalFontPresets: TerminalFontPreset[] = [
  { value: 'system', label: '跟随系统等宽字体', family: 'Consolas, Cascadia Mono, monospace' },
  { value: 'cascadia', label: 'Cascadia Mono', family: 'Cascadia Mono, Consolas, monospace' },
  { value: 'consolas', label: 'Consolas', family: 'Consolas, monospace' },
  { value: 'jetbrains', label: 'JetBrains Mono', family: 'JetBrains Mono, Consolas, monospace' },
  { value: 'fira', label: 'Fira Code', family: 'Fira Code, Consolas, monospace' },
  { value: 'source-code', label: 'Source Code Pro', family: 'Source Code Pro, Consolas, monospace' },
  { value: 'dejavu', label: 'DejaVu Sans Mono', family: 'DejaVu Sans Mono, Consolas, monospace' },
  { value: 'menlo', label: 'Menlo', family: 'Menlo, Consolas, monospace' },
  { value: 'monaco', label: 'Monaco', family: 'Monaco, Consolas, monospace' },
  { value: 'courier', label: 'Courier New', family: 'Courier New, monospace' },
  { value: 'custom', label: '自定义...', family: '' },
]

function safeColor(value: string, fallback: string) {
  const color = value.trim()
  return hexColorPattern.test(color) ? color : fallback
}

export function sanitizeTerminalFontFamily(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function validateTerminalFontFamily(value: string) {
  const family = sanitizeTerminalFontFamily(value)
  if (!family) return '字体名称不能为空'
  if ([...family].length > 120) return '字体名称最大 120 个字符'
  if (unsafeFontFamilyPattern.test(family)) return '字体名称包含不允许的字符'
  return ''
}

export function terminalFontPresetForFamily(value: string) {
  const family = sanitizeTerminalFontFamily(value).toLowerCase()
  const preset = terminalFontPresets.find((item) =>
    item.value !== 'custom' && item.family.toLowerCase() === family)
  return preset?.value ?? 'custom'
}

export function terminalFontFamilyForPreset(value: string) {
  return terminalFontPresets.find((item) => item.value === value)?.family ?? ''
}

export function normalizeTerminalProfileTheme(profile: TerminalProfile): ThemePreset {
  const preset = terminalThemePresets[profile.themeName] ?? fallbackTheme
  if (profile.themeName !== 'custom') return { ...preset }
  return {
    ...preset,
    foreground: safeColor(profile.foreground, preset.foreground),
    background: safeColor(profile.background, preset.background),
    selectionBackground: safeColor(profile.selectionBackground, preset.selectionBackground),
    cursorColor: safeColor(profile.cursorColor, preset.cursorColor),
  }
}

export function terminalProfileToXtermOptions(profile: TerminalProfile): ITerminalOptions {
  const colors = normalizeTerminalProfileTheme(profile)
  const fontFamily = sanitizeTerminalFontFamily(profile.fontFamily)
  const { cursorColor, ...themeColors } = colors
  const theme: ITheme = {
    ...themeColors,
    cursor: cursorColor,
  }
  return {
    cursorBlink: profile.cursorBlink,
    cursorStyle: profile.cursorStyle,
    convertEol: false,
    scrollback: profile.scrollback,
    fontFamily,
    fontSize: profile.fontSize,
    lineHeight: profile.lineHeight,
    letterSpacing: profile.letterSpacing,
    minimumContrastRatio: 1,
    theme,
  }
}

export function terminalProfileHostStyle(profile: TerminalProfile): CSSProperties {
  const colors = normalizeTerminalProfileTheme(profile)
  return {
    '--terminal-bg': colors.background,
  } as CSSProperties
}

export function terminalProfilePreviewStyle(profile: TerminalProfile): CSSProperties {
  const colors = normalizeTerminalProfileTheme(profile)
  const fontFamily = sanitizeTerminalFontFamily(profile.fontFamily)
  return {
    color: colors.foreground,
    backgroundColor: colors.background,
    fontFamily,
    fontSize: `${profile.fontSize}px`,
    lineHeight: String(profile.lineHeight),
    letterSpacing: `${profile.letterSpacing}px`,
    borderColor: colors.selectionBackground,
  }
}

export function applyTerminalProfileOptions(
  terminal: { options?: ITerminalOptions },
  profile: TerminalProfile,
) {
  const next = terminalProfileToXtermOptions(profile)
  const target = terminal.options ?? {}
  target.cursorBlink = next.cursorBlink
  target.cursorStyle = next.cursorStyle
  target.scrollback = next.scrollback
  target.fontFamily = next.fontFamily
  target.fontSize = next.fontSize
  target.lineHeight = next.lineHeight
  target.letterSpacing = next.letterSpacing
  target.theme = { ...(next.theme ?? {}) }
  terminal.options = { ...target }
}
