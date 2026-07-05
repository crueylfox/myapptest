// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  COMMAND_BUTTON_DOCK_STORAGE_KEY,
  commandButtonMovedPastThreshold,
  dockedCommandButtonPosition,
  readCommandButtonDock,
  snapCommandButtonDock,
  writeCommandButtonDock,
} from './useDockedCommandButton'

const container = { left: 100, top: 50, width: 500, height: 300 }
const buttonSize = { width: 64, height: 32 }

describe('useDockedCommandButton', () => {
  it('distinguishes click from drag using a small movement threshold', () => {
    expect(commandButtonMovedPastThreshold({ x: 20, y: 20 }, { x: 23, y: 24 })).toBe(false)
    expect(commandButtonMovedPastThreshold({ x: 20, y: 20 }, { x: 27, y: 20 })).toBe(true)
  })

  it('snaps to the nearest edge and clamps the along-edge offset inside the terminal workspace', () => {
    expect(snapCommandButtonDock({ x: 112, y: 180 }, container, buttonSize)).toEqual({
      edge: 'left',
      offset: 114,
    })
    expect(snapCommandButtonDock({ x: 300, y: 54 }, container, buttonSize)).toEqual({
      edge: 'top',
      offset: 168,
    })
    expect(snapCommandButtonDock({ x: 580, y: 346 }, container, buttonSize)).toEqual({
      edge: 'bottom',
      offset: 424,
    })
  })

  it('resolves a persisted dock state to an absolute button position inside the container', () => {
    expect(dockedCommandButtonPosition({ edge: 'right', offset: 999 }, container, buttonSize)).toEqual({
      left: 524,
      top: 306,
    })
    expect(dockedCommandButtonPosition({ edge: 'bottom', offset: 18 }, container, buttonSize)).toEqual({
      left: 118,
      top: 306,
    })
  })

  it('reads and writes localStorage safely without throwing on invalid values', () => {
    const storage = window.localStorage
    storage.clear()
    expect(readCommandButtonDock(storage)).toEqual({ edge: 'bottom', offset: 18 })

    writeCommandButtonDock(storage, { edge: 'top', offset: 24 })
    expect(storage.getItem(COMMAND_BUTTON_DOCK_STORAGE_KEY)).toBe(JSON.stringify({ edge: 'top', offset: 24 }))
    expect(readCommandButtonDock(storage)).toEqual({ edge: 'top', offset: 24 })

    storage.setItem(COMMAND_BUTTON_DOCK_STORAGE_KEY, '{bad')
    expect(readCommandButtonDock(storage)).toEqual({ edge: 'bottom', offset: 18 })
  })

  it('swallows localStorage write failures', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('blocked') }),
    } as unknown as Storage

    expect(() => writeCommandButtonDock(storage, { edge: 'left', offset: 12 })).not.toThrow()
  })
})
