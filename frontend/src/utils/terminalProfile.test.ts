import { describe, expect, it } from 'vitest'
import type { TerminalProfile } from '../types'
import { defaultTerminalProfile } from '../stores/terminalProfiles'
import {
  normalizeTerminalProfileTheme,
  terminalProfileToXtermOptions,
  terminalThemePresets,
} from './terminalProfile'

const ansiKeys = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

const profile: TerminalProfile = {
  id: 'default',
  name: 'Default',
  fontFamily: 'Consolas, Cascadia Mono, monospace',
  fontSize: 15,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  themeName: 'serverpilot-dark',
  foreground: '#dbeafe',
  background: '#07111f',
  selectionBackground: '#2563eb66',
  cursorColor: '#ffffff',
  createdAt: '',
  updatedAt: '',
}

describe('terminal profile ANSI colors', () => {
  it('uses 13px as the default xterm font size without changing custom profiles', () => {
    expect(defaultTerminalProfile.fontSize).toBe(13)
    expect(terminalProfileToXtermOptions(defaultTerminalProfile).fontSize).toBe(13)
    expect(terminalProfileToXtermOptions({ ...defaultTerminalProfile, fontSize: 18 }).fontSize).toBe(18)
  })

  it('keeps every built-in terminal theme backed by a full ANSI palette', () => {
    for (const [name, preset] of Object.entries(terminalThemePresets)) {
      for (const key of ansiKeys) {
        expect(preset[key], `${name}.${key}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('passes the ANSI palette through to xterm options', () => {
    const options = terminalProfileToXtermOptions(profile)

    for (const key of ansiKeys) {
      expect(options.theme?.[key]).toBe(normalizeTerminalProfileTheme(profile)[key])
    }
    expect(options.theme?.foreground).toBe('#dbeafe')
    expect(options.theme?.background).toBe('#07111f')
    expect(options.theme?.cursor).toBe('#ffffff')
  })

  it('keeps custom foreground and background without dropping the base ANSI palette', () => {
    const custom = normalizeTerminalProfileTheme({
      ...profile,
      themeName: 'custom',
      foreground: '#ffffff',
      background: '#000000',
      selectionBackground: '#123456',
      cursorColor: '#fedcba',
    })

    expect(custom.foreground).toBe('#ffffff')
    expect(custom.background).toBe('#000000')
    for (const key of ansiKeys) {
      expect(custom[key]).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})
