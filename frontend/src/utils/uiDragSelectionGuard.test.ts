// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installUiDragSelectionGuard,
  uiDragSelectionGuardClass,
} from './uiDragSelectionGuard'

function pointer(type: string, target: Element, options: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    ...options,
  }))
}

describe('ui drag selection guard', () => {
  let cleanupGuard: (() => void) | null = null

  afterEach(() => {
    cleanupGuard?.()
    cleanupGuard = null
    document.body.className = ''
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('leaves ordinary UI text selectable unless it opts into the drag guard', () => {
    cleanupGuard = installUiDragSelectionGuard()
    const note = document.createElement('p')
    note.textContent = 'copyable diagnostics'
    document.body.appendChild(note)

    pointer('pointerdown', note)

    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(false)
  })

  it('adds a global no-selection class while dragging opted-in UI text', () => {
    vi.useFakeTimers()
    cleanupGuard = installUiDragSelectionGuard()
    const row = document.createElement('button')
    row.className = 'sftp-row'
    row.dataset.uiNoTextSelect = 'true'
    row.textContent = 'srv'
    document.body.appendChild(row)

    pointer('pointerdown', row)

    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(true)

    pointer('pointerup', window.document.body)
    vi.runOnlyPendingTimers()

    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(false)
    vi.useRealTimers()
  })

  it('prevents native selection start and clears stale text selection during guarded drags', () => {
    cleanupGuard = installUiDragSelectionGuard()
    const row = document.createElement('button')
    row.className = 'sftp-row'
    row.dataset.uiNoTextSelect = 'true'
    row.textContent = 'drwxr-xr-x'
    document.body.appendChild(row)
    const removeAllRanges = vi.fn()
    vi.spyOn(window, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)

    pointer('pointerdown', row)
    const select = new Event('selectstart', { bubbles: true, cancelable: true })
    row.dispatchEvent(select)

    expect(select.defaultPrevented).toBe(true)
    expect(removeAllRanges).toHaveBeenCalled()
  })

  it('clears selectionchange updates that Chromium may emit during guarded drags', () => {
    cleanupGuard = installUiDragSelectionGuard()
    const row = document.createElement('button')
    row.className = 'sftp-row'
    row.dataset.uiNoTextSelect = 'true'
    row.textContent = '2026/6/30 01:44:51'
    document.body.appendChild(row)
    const removeAllRanges = vi.fn()
    vi.spyOn(window, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)

    pointer('pointerdown', row)
    removeAllRanges.mockClear()
    document.dispatchEvent(new Event('selectionchange'))

    expect(removeAllRanges).toHaveBeenCalledTimes(1)
  })

  it('clears native selection again when ordinary UI dragging ends', () => {
    vi.useFakeTimers()
    cleanupGuard = installUiDragSelectionGuard()
    const row = document.createElement('button')
    row.className = 'sftp-row'
    row.dataset.uiNoTextSelect = 'true'
    row.textContent = 'rw-r--r--'
    document.body.appendChild(row)
    const removeAllRanges = vi.fn()
    vi.spyOn(window, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection)

    pointer('pointerdown', row)
    removeAllRanges.mockClear()
    pointer('pointerup', document.body)
    vi.runOnlyPendingTimers()

    expect(removeAllRanges).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('keeps the no-selection class until the delayed final selection cleanup runs', () => {
    vi.useFakeTimers()
    cleanupGuard = installUiDragSelectionGuard()
    const row = document.createElement('button')
    row.className = 'sftp-row'
    row.dataset.uiNoTextSelect = 'true'
    row.textContent = '3.sh'
    document.body.appendChild(row)

    pointer('pointerdown', row)
    pointer('pointerup', document.body)

    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(true)

    vi.runOnlyPendingTimers()

    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(false)
    vi.useRealTimers()
  })

  it('allows text selection surfaces to keep their native selection behavior', () => {
    cleanupGuard = installUiDragSelectionGuard()
    const input = document.createElement('input')
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    const editor = document.createElement('div')
    editor.className = 'sftp-text-selection-surface'
    document.body.append(input, terminal, editor)

    pointer('pointerdown', input)
    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(false)

    pointer('pointerdown', terminal)
    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(false)

    pointer('pointerdown', editor)
    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(false)
  })

  it('guards nested text inside an opted-in UI region', () => {
    cleanupGuard = installUiDragSelectionGuard()
    const table = document.createElement('div')
    table.dataset.uiNoTextSelect = 'true'
    const label = document.createElement('span')
    label.textContent = '21.txt'
    table.appendChild(label)
    document.body.appendChild(table)

    pointer('pointerdown', label)

    expect(document.body.classList.contains(uiDragSelectionGuardClass)).toBe(true)
  })
})
