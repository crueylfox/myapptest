// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { defaultShortcutSettings } from '../utils/shortcutSettings'
import {
  commandPaletteShortcutIntentForEvent,
  useGlobalShortcutBridge,
} from './useGlobalShortcutBridge'

describe('useGlobalShortcutBridge', () => {
  it('installs and removes the existing App-level keyboard and wheel guards', () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window
    const bridge = useGlobalShortcutBridge(target)

    bridge.install()
    bridge.install()
    expect((target.addEventListener as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6)
    expect(target.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(target.addEventListener).toHaveBeenCalledWith('keyup', expect.any(Function), true)
    expect(target.addEventListener).toHaveBeenCalledWith('blur', expect.any(Function), true)
    expect(target.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { capture: true, passive: false })

    bridge.uninstall()
    bridge.uninstall()
    expect((target.removeEventListener as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6)
    expect(target.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(target.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), true)
  })

  it('maps command palette shortcuts to history and favorites intents only in terminal shortcut context', () => {
    const settings = defaultShortcutSettings()
    const terminalTarget = document.createElement('div')
    terminalTarget.className = 'xterm'

    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true, shiftKey: true }),
      settings,
      { terminalFocused: true, target: terminalTarget },
    )).toEqual({ kind: 'command-palette', tab: 'history' })
    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }),
      settings,
      { terminalFocused: true, target: terminalTarget },
    )).toEqual({ kind: 'command-palette', tab: 'favorites' })
    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true, shiftKey: true }),
      settings,
      { terminalFocused: false, target: terminalTarget },
    )).toEqual({ kind: 'none', reason: 'outside-terminal' })
  })

  it('does not steal editor, SFTP, completion, or Windows IME shortcuts', () => {
    const settings = defaultShortcutSettings()
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const fileList = document.createElement('div')
    fileList.className = 'sftp-table'

    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true, shiftKey: true }),
      settings,
      { terminalFocused: true, target: input },
    )).toEqual({ kind: 'none', reason: 'editable-target' })
    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true }),
      settings,
      { terminalFocused: false, target: editor },
    )).toEqual({ kind: 'none', reason: 'outside-terminal' })
    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete' }),
      settings,
      { terminalFocused: false, target: fileList },
    )).toEqual({ kind: 'none', reason: 'outside-terminal' })
    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, shiftKey: true }),
      settings,
      { terminalFocused: true, target: document.createElement('div') },
    )).toEqual({ kind: 'none', reason: 'terminal-completion' })
    expect(commandPaletteShortcutIntentForEvent(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true }),
      settings,
      { terminalFocused: true, target: document.createElement('div') },
    )).toEqual({ kind: 'none', reason: 'unmatched' })
  })
})
