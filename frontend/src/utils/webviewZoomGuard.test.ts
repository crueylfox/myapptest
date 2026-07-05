// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerTerminalWheelZoomHandler, unregisterTerminalWheelZoomHandler } from './terminalZoom'
import {
  preventWebviewKeyboardZoom,
  preventWebviewWheelZoom,
  resetWebviewZoomModifierKeys,
  shouldPreventWebviewKeyboardZoom,
  shouldPreventWebviewWheelZoom,
  shouldStopWebviewWheelZoomPropagation,
  terminalSurfaceFromTarget,
  trackWebviewZoomModifierKeyDown,
  trackWebviewZoomModifierKeyUp,
} from './webviewZoomGuard'

function keyboard(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

describe('webview zoom guard', () => {
  afterEach(() => {
    resetWebviewZoomModifierKeys()
  })

  it('prevents Ctrl+wheel outside terminal surfaces', () => {
    const target = document.createElement('div')
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })
    target.dispatchEvent(event)
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    const zoom = vi.fn()
    registerTerminalWheelZoomHandler('ssh-no-hit', zoom)

    expect(shouldPreventWebviewWheelZoom(event)).toBe(true)
    expect(shouldStopWebviewWheelZoomPropagation(event)).toBe(true)
    preventWebviewWheelZoom(event)
    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(zoom).not.toHaveBeenCalled()
    unregisterTerminalWheelZoomHandler('ssh-no-hit')
  })

  it('prevents browser zoom on terminal surfaces and dispatches terminal font zoom', () => {
    const terminal = document.createElement('div')
    terminal.setAttribute('data-terminal-surface', 'true')
    terminal.dataset.terminalKind = 'ssh'
    terminal.dataset.terminalSessionId = 'ssh-zoom'
    const child = document.createElement('div')
    terminal.appendChild(child)
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })
    child.dispatchEvent(event)
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    const zoom = vi.fn()
    registerTerminalWheelZoomHandler('ssh-zoom', zoom)

    expect(shouldPreventWebviewWheelZoom(event)).toBe(true)
    expect(shouldStopWebviewWheelZoomPropagation(event)).toBe(true)
    preventWebviewWheelZoom(event)
    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(zoom).toHaveBeenCalledWith(-100)
    unregisterTerminalWheelZoomHandler('ssh-zoom')
  })

  it('dispatches terminal zoom when WebView wheel events omit ctrlKey after Control keydown', () => {
    const terminal = document.createElement('div')
    terminal.setAttribute('data-terminal-surface', 'true')
    terminal.dataset.terminalKind = 'ssh'
    terminal.dataset.terminalSessionId = 'ssh-tracked-control'
    const child = document.createElement('div')
    terminal.appendChild(child)
    trackWebviewZoomModifierKeyDown(keyboard({ key: 'Control' }))
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
      deltaY: -100,
    })
    child.dispatchEvent(event)
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    const zoom = vi.fn()
    registerTerminalWheelZoomHandler('ssh-tracked-control', zoom)

    expect(shouldPreventWebviewWheelZoom(event)).toBe(true)
    preventWebviewWheelZoom(event)
    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(zoom).toHaveBeenCalledWith(-100)
    unregisterTerminalWheelZoomHandler('ssh-tracked-control')
  })

  it('stops treating wheel events as zoom after Control keyup or focus reset', () => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
      deltaY: -100,
    })

    trackWebviewZoomModifierKeyDown(keyboard({ key: 'Control' }))
    expect(shouldPreventWebviewWheelZoom(event)).toBe(true)

    trackWebviewZoomModifierKeyUp(new KeyboardEvent('keyup', { key: 'Control' }))
    expect(shouldPreventWebviewWheelZoom(event)).toBe(false)

    trackWebviewZoomModifierKeyDown(keyboard({ key: 'Control' }))
    resetWebviewZoomModifierKeys()
    expect(shouldPreventWebviewWheelZoom(event)).toBe(false)
  })

  it('recognizes modifier state even when ctrlKey and metaKey are false', () => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
      metaKey: false,
      deltaY: -100,
    })
    vi.spyOn(event, 'getModifierState').mockImplementation((key) => key === 'Control')

    expect(shouldPreventWebviewWheelZoom(event)).toBe(true)
  })

  it('finds terminal surfaces from xterm viewport and non-HTMLElement children', () => {
    const terminal = document.createElement('div')
    terminal.setAttribute('data-terminal-surface', 'true')
    terminal.dataset.terminalKind = 'ssh'
    terminal.dataset.terminalSessionId = 'ssh-viewport'
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    viewport.appendChild(icon)
    terminal.appendChild(viewport)
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    })
    icon.dispatchEvent(event)
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    const zoom = vi.fn()
    registerTerminalWheelZoomHandler('ssh-viewport', zoom)

    expect(terminalSurfaceFromTarget(event.target)).toBe(terminal)
    expect(shouldPreventWebviewWheelZoom(event)).toBe(true)
    preventWebviewWheelZoom(event)
    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(zoom).toHaveBeenCalledWith(-100)
    unregisterTerminalWheelZoomHandler('ssh-viewport')
  })

  it('does not affect ordinary wheel scrolling', () => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    })

    expect(shouldPreventWebviewWheelZoom(event)).toBe(false)
    preventWebviewWheelZoom(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('prevents WebView keyboard zoom shortcuts only', () => {
    for (const event of [
      keyboard({ key: '+', ctrlKey: true }),
      keyboard({ key: '=', ctrlKey: true }),
      keyboard({ key: '-', ctrlKey: true }),
      keyboard({ key: '0', ctrlKey: true }),
      keyboard({ key: '+', metaKey: true }),
      keyboard({ code: 'NumpadAdd', ctrlKey: true }),
    ]) {
      expect(shouldPreventWebviewKeyboardZoom(event)).toBe(true)
      preventWebviewKeyboardZoom(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it('does not block existing Ctrl shortcuts such as Ctrl+S/C/V/A/F', () => {
    for (const key of ['s', 'c', 'v', 'a', 'f']) {
      const event = keyboard({ key, ctrlKey: true })
      expect(shouldPreventWebviewKeyboardZoom(event)).toBe(false)
      preventWebviewKeyboardZoom(event)
      expect(event.defaultPrevented).toBe(false)
    }
  })
})
