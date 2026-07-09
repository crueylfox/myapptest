import { describe, expect, it, vi } from 'vitest'
import {
  applyTerminalFontSizeOption,
  applyTerminalZoomedProfileOptions,
  clearTerminalZoomDelta,
  clampTerminalFontSize,
  dispatchTerminalWheelZoom,
  effectiveTerminalFontSizeForSession,
  effectiveTerminalZoomedProfileOptions,
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

  it('zooms terminal profile metrics proportionally instead of changing font weight', () => {
    clearTerminalZoomDelta('ssh-proportional')
    nextTerminalZoomDeltaForSession('ssh-proportional', 16, -100)
    nextTerminalZoomDeltaForSession('ssh-proportional', 16, -100)

    const options = effectiveTerminalZoomedProfileOptions('ssh-proportional', {
      fontSize: 16,
      lineHeight: 1.25,
      letterSpacing: 0.8,
    })

    expect(options.fontSize).toBe(18)
    expect(options.lineHeight).toBeCloseTo(1.25, 3)
    expect(options.letterSpacing).toBeCloseTo(1.6, 3)
    expect(options.fontWeight).toBe('normal')
    expect(options.fontWeightBold).toBe('bold')

    const terminal = {
      options: { fontSize: 16, lineHeight: 1.25, letterSpacing: 0.8, fontWeight: 500 },
      refresh: vi.fn(),
      rows: 10,
    }
    applyTerminalZoomedProfileOptions(terminal, 'ssh-proportional', {
      fontSize: 16,
      lineHeight: 1.25,
      letterSpacing: 0.8,
    })
    expect(terminal.options).toMatchObject({
      fontSize: 18,
      lineHeight: options.lineHeight,
      letterSpacing: options.letterSpacing,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
    })
    expect(terminal.refresh).toHaveBeenCalledWith(0, 9)
    clearTerminalZoomDelta('ssh-proportional')
  })

  it('adds zoom tracking when the saved terminal letter spacing is zero', () => {
    clearTerminalZoomDelta('ssh-zero-tracking')
    nextTerminalZoomDeltaForSession('ssh-zero-tracking', 16, -100)
    nextTerminalZoomDeltaForSession('ssh-zero-tracking', 16, -100)

    const zoomedIn = effectiveTerminalZoomedProfileOptions('ssh-zero-tracking', {
      fontSize: 16,
      lineHeight: 1.25,
      letterSpacing: 0,
    })

    expect(zoomedIn.fontSize).toBe(18)
    expect(zoomedIn.lineHeight).toBeCloseTo(1.25, 3)
    expect(zoomedIn.letterSpacing).toBeCloseTo(0.7, 3)

    clearTerminalZoomDelta('ssh-zero-tracking')
    nextTerminalZoomDeltaForSession('ssh-zero-tracking', 16, 100)
    nextTerminalZoomDeltaForSession('ssh-zero-tracking', 16, 100)

    const zoomedOut = effectiveTerminalZoomedProfileOptions('ssh-zero-tracking', {
      fontSize: 16,
      lineHeight: 1.25,
      letterSpacing: 0,
    })

    expect(zoomedOut.fontSize).toBe(14)
    expect(zoomedOut.lineHeight).toBeCloseTo(1.25, 3)
    expect(zoomedOut.letterSpacing).toBeCloseTo(-0.7, 3)
    clearTerminalZoomDelta('ssh-zero-tracking')
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
