import { describe, expect, it, vi } from 'vitest'
import {
  applyTerminalFontSizeOption,
  clearTerminalZoomDelta,
  clampTerminalFontSize,
  dispatchTerminalWheelZoom,
  effectiveTerminalFontSizeForSession,
  nextTerminalZoomDelta,
  nextTerminalZoomDeltaForSession,
  registerTerminalWheelZoomHandler,
  terminalZoomDeltaForSession,
  terminalZoomMaxFontSize,
  terminalZoomMinFontSize,
  unregisterTerminalWheelZoomHandler,
} from './terminalZoom'

describe('terminal zoom', () => {
  it('clamps terminal font size to the supported range', () => {
    expect(clampTerminalFontSize(1)).toBe(terminalZoomMinFontSize)
    expect(clampTerminalFontSize(99)).toBe(terminalZoomMaxFontSize)
    expect(clampTerminalFontSize(15.4)).toBe(15)
  })

  it('calculates per-session zoom deltas without mutating the profile size', () => {
    const baseFontSize = 15
    let firstSessionDelta = nextTerminalZoomDelta(baseFontSize, 0, -100)
    let secondSessionDelta = nextTerminalZoomDelta(baseFontSize, 0, 100)

    expect(baseFontSize).toBe(15)
    expect(baseFontSize + firstSessionDelta).toBe(16)
    expect(baseFontSize + secondSessionDelta).toBe(14)

    firstSessionDelta = nextTerminalZoomDelta(baseFontSize, firstSessionDelta, -100)
    secondSessionDelta = nextTerminalZoomDelta(baseFontSize, secondSessionDelta, 100)
    expect(baseFontSize + firstSessionDelta).toBe(17)
    expect(baseFontSize + secondSessionDelta).toBe(13)
  })

  it('keeps repeated wheel zoom inside 10 to 28', () => {
    let delta = 0
    for (let index = 0; index < 100; index += 1) {
      delta = nextTerminalZoomDelta(15, delta, -100)
    }
    expect(15 + delta).toBe(28)

    for (let index = 0; index < 100; index += 1) {
      delta = nextTerminalZoomDelta(15, delta, 100)
    }
    expect(15 + delta).toBe(10)
  })

  it('keeps zoom deltas isolated by terminal session id', () => {
    clearTerminalZoomDelta('ssh-a')
    clearTerminalZoomDelta('ssh-b')

    expect(nextTerminalZoomDeltaForSession('ssh-a', 15, -100)).toBe(1)
    expect(nextTerminalZoomDeltaForSession('ssh-a', 15, -100)).toBe(2)
    expect(nextTerminalZoomDeltaForSession('ssh-b', 15, 100)).toBe(-1)

    expect(terminalZoomDeltaForSession('ssh-a')).toBe(2)
    expect(terminalZoomDeltaForSession('ssh-b')).toBe(-1)
    expect(effectiveTerminalFontSizeForSession('ssh-a', 20)).toBe(22)
    expect(effectiveTerminalFontSizeForSession('ssh-b', 20)).toBe(19)

    clearTerminalZoomDelta('ssh-a')
    expect(terminalZoomDeltaForSession('ssh-a')).toBe(0)
    expect(terminalZoomDeltaForSession('ssh-b')).toBe(-1)
    clearTerminalZoomDelta('ssh-b')
  })

  it('writes xterm 6 font size through options and refreshes visible rows', () => {
    const terminal = {
      options: { fontSize: 15 },
      setOption: vi.fn(),
      refresh: vi.fn(),
      rows: 24,
    }
    applyTerminalFontSizeOption(terminal, 18)
    expect(terminal.options.fontSize).toBe(18)
    expect(terminal.setOption).not.toHaveBeenCalled()
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23)

    const terminalWithExistingOptions = {
      options: { fontSize: 15, fontFamily: 'Consolas' },
    }
    applyTerminalFontSizeOption(terminalWithExistingOptions, 19)
    expect(terminalWithExistingOptions.options).toMatchObject({ fontSize: 19, fontFamily: 'Consolas' })

    const terminalWithoutOptions: { options?: unknown } = {}
    applyTerminalFontSizeOption(terminalWithoutOptions, 20)
    expect(terminalWithoutOptions.options).toEqual({ fontSize: 20 })
  })

  it('dispatches wheel zoom to the registered session handler only', () => {
    const sshZoom = vi.fn()
    const otherZoom = vi.fn()
    registerTerminalWheelZoomHandler('ssh-active', sshZoom)
    registerTerminalWheelZoomHandler('ssh-other', otherZoom)

    expect(dispatchTerminalWheelZoom('ssh-active', -100)).toBe(true)
    expect(sshZoom).toHaveBeenCalledWith(-100)
    expect(otherZoom).not.toHaveBeenCalled()

    unregisterTerminalWheelZoomHandler('ssh-active')
    expect(dispatchTerminalWheelZoom('ssh-active', -100)).toBe(false)
    unregisterTerminalWheelZoomHandler('ssh-other')
  })
})
