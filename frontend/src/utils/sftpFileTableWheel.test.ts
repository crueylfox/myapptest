import { describe, expect, it } from 'vitest'
import {
  resolveFileTableWheelScrollLeft,
  type FileTableWheelMetrics,
} from './sftpFileTableWheel'

function metrics(values: Partial<FileTableWheelMetrics> = {}): FileTableWheelMetrics {
  return {
    clientWidth: 320,
    scrollWidth: 900,
    scrollLeft: 0,
    clientHeight: 300,
    scrollHeight: 1200,
    scrollTop: 0,
    ...values,
  }
}

describe('sftp file table wheel utilities', () => {
  it('leaves vertical wheel scrolling alone while the file list can scroll vertically', () => {
    expect(resolveFileTableWheelScrollLeft({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    }, metrics({ scrollTop: 100 }))).toBeNull()
  })

  it('leaves vertical wheel scrolling alone at vertical scroll boundaries while the file list overflows vertically', () => {
    expect(resolveFileTableWheelScrollLeft({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    }, metrics({ scrollTop: 900 }))).toBeNull()

    expect(resolveFileTableWheelScrollLeft({
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
    }, metrics({ scrollTop: 0 }))).toBeNull()
  })

  it('uses horizontal fallback when vertical wheel scrolling is unavailable', () => {
    expect(resolveFileTableWheelScrollLeft({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    }, metrics({ clientHeight: 300, scrollHeight: 300 }))).toBe(120)
  })

  it('clamps horizontal fallback to the native horizontal scroll range', () => {
    expect(resolveFileTableWheelScrollLeft({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    }, metrics({ clientHeight: 300, scrollHeight: 300, scrollLeft: 560 }))).toBe(580)
  })

  it('does not intercept wheel events when the file list has no horizontal overflow', () => {
    expect(resolveFileTableWheelScrollLeft({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    }, metrics({ clientWidth: 900, scrollWidth: 900 }))).toBeNull()
  })
})
