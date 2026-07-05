import { describe, expect, it } from 'vitest'
import { hasVisibleTerminalOutput } from './terminalOutputActivity'

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe('terminal output activity visibility', () => {
  it('treats text after ANSI sequences as visible output', () => {
    expect(hasVisibleTerminalOutput(utf8Base64('\x1b[31mroot\x1b[0m text'))).toBe(true)
  })

  it('ignores pure control, cursor, OSC, and whitespace output', () => {
    expect(hasVisibleTerminalOutput(btoa('\x1b[?25l\x1b[2K\r\n\t\x1b]0;title\x07'))).toBe(false)
  })
})
