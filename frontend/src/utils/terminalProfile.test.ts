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
  foreground: '#eceff4',
  background: '#1f2023',
  selectionBackground: '#5b8cff66',
  cursorColor: '#f5f7fa',
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
    expect(options.theme?.foreground).toBe('#d7dde5')
    expect(options.theme?.background).toBe('#15171a')
    expect(options.theme?.selectionBackground).toBe('#5b8cff47')
    expect(options.theme?.blue).toBe('#6aa2ff')
    expect(options.theme?.red).toBe('#ff4d5e')
    expect(options.theme?.green).toBe('#55e078')
    expect(options.theme?.yellow).toBe('#ffb340')
    expect(options.theme?.cyan).toBe('#28f0e0')
    expect(options.theme?.brightRed).toBe('#ff6673')
    expect(options.theme?.brightYellow).toBe('#ffc65f')
    expect(options.theme?.brightWhite).toBe('#f0f3f6')
    expect(options.minimumContrastRatio).toBeLessThanOrEqual(1.2)
    expect(options.theme?.cursor).toBe('#dce6f2')
    expect(options.theme?.background).not.toBe('#07111f')
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
