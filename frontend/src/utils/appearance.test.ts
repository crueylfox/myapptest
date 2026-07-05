// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { UIFontSize } from '../types'
import { applyUIFontSize, uiFontPixels } from './appearance'

describe('UI font size', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--ui-font-size')
    delete document.documentElement.dataset.uiFont
  })

  it('maps and applies all four supported sizes', () => {
    const sizes: UIFontSize[] = ['small', 'standard', 'large', 'extra_large']
    expect(sizes.map(uiFontPixels)).toEqual([13, 14, 15, 16])
    expect(applyUIFontSize('extra_large')).toBe(16)
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('16px')
    expect(document.documentElement.dataset.uiFont).toBe('extra_large')
  })
})
