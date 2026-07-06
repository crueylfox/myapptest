import type {
  ShortcutBinding,
  ShortcutSettings,
  TerminalContextMenuTrigger,
  TerminalRightClickAction,
} from '../types'

export type TerminalShortcutAction = 'copy' | 'paste' | 'completion' | 'history' | 'favorites' | 'suppress_native_paste'

export type ShortcutPlatform = 'windows' | 'darwin' | 'linux' | 'unknown' | string

export const windowsShortcutBindingOptions: Array<{ value: ShortcutBinding; label: string }> = [
  { value: 'ctrl+shift+a', label: 'Ctrl+Shift+A' },
  { value: 'ctrl+shift+c', label: 'Ctrl+Shift+C' },
  { value: 'ctrl+shift+v', label: 'Ctrl+Shift+V' },
  { value: 'ctrl+shift+h', label: 'Ctrl+Shift+H' },
  { value: 'ctrl+shift+p', label: 'Ctrl+Shift+P' },
  { value: 'ctrl+alt+c', label: 'Ctrl+Alt+C' },
  { value: 'ctrl+alt+v', label: 'Ctrl+Alt+V' },
  { value: 'ctrl+alt+h', label: 'Ctrl+Alt+H' },
  { value: 'ctrl+alt+p', label: 'Ctrl+Alt+P' },
  { value: 'disabled', label: '禁用' },
]
export const macosShortcutBindingOptions: Array<{ value: ShortcutBinding; label: string }> = [
  { value: 'meta+c', label: '⌘C' },
  { value: 'meta+v', label: '⌘V' },
  { value: 'meta+k', label: '⌘K' },
  { value: 'shift+meta+h', label: '⇧⌘H' },
  { value: 'shift+meta+p', label: '⇧⌘P' },
  { value: 'disabled', label: '禁用' },
]
export const shortcutBindingOptions = windowsShortcutBindingOptions

const bindingLabels = new Map([...windowsShortcutBindingOptions, ...macosShortcutBindingOptions].map((item) => [item.value, item.label]))

export function shortcutBindingOptionsForPlatform(platform: ShortcutPlatform) {
  return platform === 'darwin' ? macosShortcutBindingOptions : windowsShortcutBindingOptions
}

export function defaultShortcutSettings(platform: ShortcutPlatform = 'windows'): ShortcutSettings {
  if (platform === 'darwin') {
    return {
      terminalCopyOnSelectEnabled: true,
      terminalRightClickAction: 'paste',
      terminalContextMenuTrigger: 'shift_right_click',
      terminalCopy: 'meta+c',
      terminalPaste: 'meta+v',
      terminalCompletion: 'meta+k',
      openCommandHistory: 'shift+meta+h',
      openCommandFavorites: 'shift+meta+p',
    }
  }
  return {
    terminalCopyOnSelectEnabled: true,
    terminalRightClickAction: 'paste',
    terminalContextMenuTrigger: 'shift_right_click',
    terminalCopy: 'ctrl+shift+c',
    terminalPaste: 'ctrl+shift+v',
    terminalCompletion: 'ctrl+shift+a',
    openCommandHistory: 'ctrl+shift+h',
    openCommandFavorites: 'ctrl+shift+p',
  }
}

export function normalizeShortcutSettings(
  value: ShortcutSettings | null | undefined,
  legacyCopyOnSelect = true,
  legacyRightClickPaste = true,
  platform: ShortcutPlatform = 'windows',
): ShortcutSettings {
  const defaults = defaultShortcutSettings(platform)
  if (!value || shortcutSettingsEmpty(value)) {
    return {
      ...defaults,
      terminalCopyOnSelectEnabled: legacyCopyOnSelect,
      terminalRightClickAction: legacyRightClickPaste ? 'paste' : 'menu',
    }
  }
  const normalized = {
    terminalCopyOnSelectEnabled: Boolean(value.terminalCopyOnSelectEnabled),
    terminalRightClickAction: validRightClickAction(value.terminalRightClickAction)
      ? value.terminalRightClickAction
      : defaults.terminalRightClickAction,
    terminalContextMenuTrigger: validContextMenuTrigger(value.terminalContextMenuTrigger)
      ? value.terminalContextMenuTrigger
      : defaults.terminalContextMenuTrigger,
    terminalCopy: validShortcutBinding(value.terminalCopy) ? value.terminalCopy : defaults.terminalCopy,
    terminalPaste: validShortcutBinding(value.terminalPaste) ? value.terminalPaste : defaults.terminalPaste,
    terminalCompletion: validShortcutBinding(value.terminalCompletion) ? value.terminalCompletion : defaults.terminalCompletion,
    openCommandHistory: validShortcutBinding(value.openCommandHistory) ? value.openCommandHistory : defaults.openCommandHistory,
    openCommandFavorites: validShortcutBinding(value.openCommandFavorites) ? value.openCommandFavorites : defaults.openCommandFavorites,
  }
  if (platform === 'darwin' && shortcutBindingsEqual(normalized, defaultShortcutSettings('windows'))) {
    return {
      ...defaults,
      terminalCopyOnSelectEnabled: normalized.terminalCopyOnSelectEnabled,
      terminalRightClickAction: normalized.terminalRightClickAction,
      terminalContextMenuTrigger: normalized.terminalContextMenuTrigger,
    }
  }
  return normalized
}

export function shortcutLabel(value: ShortcutBinding | string | null | undefined) {
  return bindingLabels.get(value as ShortcutBinding) ?? '禁用'
}

export function shortcutMatches(event: KeyboardEvent, binding: ShortcutBinding | string | null | undefined) {
  if (!binding || binding === 'disabled') return false
  const parts = String(binding).toLowerCase().split('+')
  const key = parts.at(-1) ?? ''
  const wantsCtrl = parts.includes('ctrl')
  const wantsShift = parts.includes('shift')
  const wantsAlt = parts.includes('alt')
  const wantsMeta = parts.includes('meta')
  if (event.ctrlKey !== wantsCtrl || event.shiftKey !== wantsShift || event.altKey !== wantsAlt || event.metaKey !== wantsMeta) return false
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  const eventCode = event.code.toLowerCase()
  return eventKey === key || eventCode === `key${key}`
}

export function terminalContextMenuTriggerMatches(event: MouseEvent, trigger: TerminalContextMenuTrigger) {
  if (trigger === 'shift_right_click') return event.shiftKey
  if (trigger === 'ctrl_right_click') return event.ctrlKey
  return false
}

export function terminalShortcutActionForEvent(
  event: KeyboardEvent,
  settings: ShortcutSettings,
  options: {
    hasSelection?: boolean
    completionEnabled?: boolean
    commandPaletteEnabled?: boolean
  } = {},
): TerminalShortcutAction | null {
  if (options.completionEnabled && shortcutMatches(event, settings.terminalCompletion)) return 'completion'
  if (shortcutMatches(event, settings.terminalCopy) && options.hasSelection) return 'copy'
  if (shortcutMatches(event, settings.terminalPaste)) return 'paste'
  if (options.commandPaletteEnabled && shortcutMatches(event, settings.openCommandHistory)) return 'history'
  if (options.commandPaletteEnabled && shortcutMatches(event, settings.openCommandFavorites)) return 'favorites'
  if (isNativePasteShortcut(event)) return 'suppress_native_paste'
  return null
}

export function isNativePasteShortcut(event: KeyboardEvent) {
  return event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key.toLowerCase() === 'v' || event.code === 'KeyV')
}

export function consumeTerminalShortcutEvent(event: KeyboardEvent | ClipboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
}

export function findShortcutConflicts(settings: ShortcutSettings): string[] {
  const rows: Array<[string, ShortcutBinding]> = [
    ['复制终端选区', settings.terminalCopy],
    ['粘贴到终端', settings.terminalPaste],
    ['命令补全', settings.terminalCompletion],
    ['历史命令', settings.openCommandHistory],
    ['常用命令', settings.openCommandFavorites],
  ]
  const seen = new Map<string, string>()
  const conflicts: string[] = []
  for (const [label, binding] of rows) {
    if (binding === 'disabled') continue
    const previous = seen.get(binding)
    if (previous) conflicts.push(`${shortcutLabel(binding)}：${previous} / ${label}`)
    else seen.set(binding, label)
  }
  return conflicts
}

export function rightClickActionLabel(value: TerminalRightClickAction) {
  return value === 'paste' ? '粘贴剪贴板' : '显示终端菜单'
}

function shortcutSettingsEmpty(value: ShortcutSettings) {
  return !value.terminalRightClickAction &&
    !value.terminalContextMenuTrigger &&
    !value.terminalCopy &&
    !value.terminalPaste &&
    !value.terminalCompletion &&
    !value.openCommandHistory &&
    !value.openCommandFavorites
}

function validShortcutBinding(value: unknown): value is ShortcutBinding {
  return bindingLabels.has(value as ShortcutBinding)
}

function validRightClickAction(value: unknown): value is TerminalRightClickAction {
  return value === 'paste' || value === 'menu'
}

function shortcutBindingsEqual(left: ShortcutSettings, right: ShortcutSettings) {
  return left.terminalCopy === right.terminalCopy &&
    left.terminalPaste === right.terminalPaste &&
    left.terminalCompletion === right.terminalCompletion &&
    left.openCommandHistory === right.openCommandHistory &&
    left.openCommandFavorites === right.openCommandFavorites
}

function validContextMenuTrigger(value: unknown): value is TerminalContextMenuTrigger {
  return value === 'shift_right_click' || value === 'ctrl_right_click' || value === 'disabled'
}
