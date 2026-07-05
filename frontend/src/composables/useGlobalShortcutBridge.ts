import type { ShortcutSettings } from '../types'
import { preventGlobalSelectAll } from '../utils/selectAllGuard'
import { shortcutMatches } from '../utils/shortcutSettings'
import {
  preventWebviewKeyboardZoom,
  preventWebviewWheelZoom,
  resetWebviewZoomModifierKeys,
  trackWebviewZoomModifierKeyDown,
  trackWebviewZoomModifierKeyUp,
} from '../utils/webviewZoomGuard'

export type CommandPaletteShortcutIntent =
  | { kind: 'command-palette'; tab: 'history' | 'favorites' }
  | { kind: 'none'; reason: 'outside-terminal' | 'editable-target' | 'terminal-completion' | 'unmatched' }

export interface CommandPaletteShortcutContext {
  terminalFocused: boolean
  target: EventTarget | null
}

export function useGlobalShortcutBridge(target: Window | null = typeof window === 'undefined' ? null : window) {
  let installed = false

  function install() {
    if (!target || installed) return
    installed = true
    target.addEventListener('keydown', preventGlobalSelectAll, true)
    target.addEventListener('keydown', trackWebviewZoomModifierKeyDown, true)
    target.addEventListener('keydown', preventWebviewKeyboardZoom, true)
    target.addEventListener('keyup', trackWebviewZoomModifierKeyUp, true)
    target.addEventListener('blur', resetWebviewZoomModifierKeys, true)
    target.addEventListener('wheel', preventWebviewWheelZoom, { capture: true, passive: false })
  }

  function uninstall() {
    if (!target || !installed) return
    installed = false
    target.removeEventListener('keydown', preventGlobalSelectAll, true)
    target.removeEventListener('keydown', trackWebviewZoomModifierKeyDown, true)
    target.removeEventListener('keydown', preventWebviewKeyboardZoom, true)
    target.removeEventListener('keyup', trackWebviewZoomModifierKeyUp, true)
    target.removeEventListener('blur', resetWebviewZoomModifierKeys, true)
    target.removeEventListener('wheel', preventWebviewWheelZoom, true)
  }

  return { install, uninstall }
}

export function commandPaletteShortcutIntentForEvent(
  event: KeyboardEvent,
  settings: ShortcutSettings,
  context: CommandPaletteShortcutContext,
): CommandPaletteShortcutIntent {
  if (!context.terminalFocused) return { kind: 'none', reason: 'outside-terminal' }
  if (isEditableNonTerminalTarget(context.target)) return { kind: 'none', reason: 'editable-target' }
  if (shortcutMatches(event, settings.terminalCompletion)) return { kind: 'none', reason: 'terminal-completion' }
  if (shortcutMatches(event, settings.openCommandHistory)) return { kind: 'command-palette', tab: 'history' }
  if (shortcutMatches(event, settings.openCommandFavorites)) return { kind: 'command-palette', tab: 'favorites' }
  return { kind: 'none', reason: 'unmatched' }
}

function isEditableNonTerminalTarget(target: EventTarget | null) {
  const element = elementFromEventTarget(target)
  if (!element) return false
  if (element.closest('.xterm, .xterm-helper-textarea, .terminal-view, [data-terminal-surface="true"]')) {
    return false
  }
  return Boolean(element.closest([
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '.cm-editor',
    '.cm-content',
    '.sftp-table',
  ].join(',')))
}

function elementFromEventTarget(target: EventTarget | null) {
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}
