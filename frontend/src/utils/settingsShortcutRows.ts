import type { ShortcutSettings } from '../types'

export type ShortcutRowKey = keyof Pick<
  ShortcutSettings,
  'terminalCopy' | 'terminalPaste' | 'terminalCompletion' | 'openCommandHistory' | 'openCommandFavorites'
>

export interface SettingsShortcutRow {
  key: ShortcutRowKey
  label: string
  detail: string
}

export function keyboardShortcutRowsForPlatform(platform: string): readonly SettingsShortcutRow[] {
  if (platform === 'darwin') {
    return [
      { key: 'terminalCopy', label: '复制终端选区', detail: '默认 ⌘C，只在终端存在选区时拦截；终端中断仍用 Ctrl+C 发送给远端。' },
      { key: 'terminalPaste', label: '粘贴到终端', detail: '默认 ⌘V，写入当前 SSH / 本地终端。' },
      { key: 'terminalCompletion', label: '命令补全', detail: '默认 ⌘K，SSH 终端中打开历史、收藏和内置命令候选。' },
      { key: 'openCommandHistory', label: '历史命令', detail: '默认 ⇧⌘H，避免占用 macOS 隐藏应用快捷键。' },
      { key: 'openCommandFavorites', label: '常用命令', detail: '默认 ⇧⌘P，打开命令面板的常用命令。' },
    ]
  }
  return [
    { key: 'terminalCopy', label: '复制终端选区', detail: '默认 Ctrl+Shift+C，只在终端存在选区时拦截。' },
    { key: 'terminalPaste', label: '粘贴到终端', detail: '默认 Ctrl+Shift+V，写入当前 SSH / 本地终端。' },
    { key: 'terminalCompletion', label: '命令补全', detail: '默认 Ctrl+Shift+A，SSH 终端中打开历史、收藏和内置命令候选。' },
    { key: 'openCommandHistory', label: '历史命令', detail: '默认 Ctrl+Shift+H，打开命令面板的历史命令。' },
    { key: 'openCommandFavorites', label: '常用命令', detail: '默认 Ctrl+Shift+P，打开命令面板的常用命令。' },
  ]
}
