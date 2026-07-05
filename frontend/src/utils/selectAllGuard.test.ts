// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { preventGlobalSelectAll, shouldAllowNativeSelectAll } from './selectAllGuard'

function keydown(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

describe('selectAllGuard', () => {
  it('prevents Ctrl+A from selecting page chrome', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    target.addEventListener('keydown', (event) => preventGlobalSelectAll(event as KeyboardEvent), true)

    const event = keydown(target, { key: 'a', ctrlKey: true })

    expect(event.defaultPrevented).toBe(true)
    target.remove()
  })

  it('allows native Ctrl+A inside form controls and editors', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const terminal = document.createElement('div')
    terminal.className = 'terminal-view'
    const fileList = document.createElement('div')
    fileList.className = 'sftp-table'

    for (const target of [input, textarea, editor, terminal, fileList]) {
      document.body.appendChild(target)
      expect(shouldAllowNativeSelectAll(target)).toBe(true)
      target.addEventListener('keydown', (event) => preventGlobalSelectAll(event as KeyboardEvent), true)
      expect(keydown(target, { key: 'a', ctrlKey: true }).defaultPrevented).toBe(false)
      target.remove()
    }
  })
})
