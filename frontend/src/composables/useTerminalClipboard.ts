import type { Terminal } from '@xterm/xterm'
import { ClipboardGetText } from '../../wailsjs/runtime/runtime'

type Notify = (message: string) => void

export function useTerminalClipboard(notify: Notify) {
  let lastCopiedSelection = ''
  let lastCopiedAt = 0
  let suppressCopyUntil = 0

  function suppressCopyOnSelect(durationMs = 180) {
    suppressCopyUntil = Date.now() + durationMs
  }

  function clearSelectionAndFocus(terminal: Terminal | null) {
    ;(terminal as (Terminal & { clearSelection?: () => void }) | null)?.clearSelection?.()
    terminal?.focus()
  }

  function nextFrame(): Promise<void> {
    if (typeof window.requestAnimationFrame === 'function') {
      return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
    }
    return new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  async function copySelection(terminal: Terminal | null, showError = true) {
    if (Date.now() < suppressCopyUntil) return
    if (!terminal?.hasSelection()) return
    const selection = terminal.getSelection()
    if (!selection) return
    const now = Date.now()
    if (selection === lastCopiedSelection && now - lastCopiedAt < 200) return
    try {
      await navigator.clipboard.writeText(selection)
      lastCopiedSelection = selection
      lastCopiedAt = now
    } catch {
      if (showError) notify('复制终端选区失败')
    }
  }

  async function pasteFromClipboard(
    writeText: (text: string) => void | Promise<void>,
    showError = true,
    terminal: Terminal | null = null,
  ) {
    suppressCopyOnSelect()
    try {
      let text = ''
      try {
        text = await navigator.clipboard.readText()
      } catch {
        text = await ClipboardGetText()
      }
      clearSelectionAndFocus(terminal)
      if (text) await writeText(text)
      await nextFrame()
      clearSelectionAndFocus(terminal)
    } catch {
      clearSelectionAndFocus(terminal)
      if (showError) notify('读取剪贴板失败，无法粘贴到终端')
    }
  }

  return {
    clearSelectionAndFocus,
    copySelection,
    pasteFromClipboard,
  }
}
