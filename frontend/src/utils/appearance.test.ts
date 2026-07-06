// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { UIFontSize } from '../types'
import { applyUIFontSize, uiFontPixels } from './appearance'

describe('UI font size', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--ui-font-size')
    delete document.documentElement.dataset.uiFont
  })

  it('maps and applies all supported sizes from 12px through 18px', () => {
    const sizes: UIFontSize[] = ['tiny', 'small', 'standard', 'large', 'extra_large', 'huge', 'max']
    expect(sizes.map(uiFontPixels)).toEqual([12, 13, 14, 15, 16, 17, 18])
    expect(applyUIFontSize('max')).toBe(18)
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('18px')
    expect(document.documentElement.dataset.uiFont).toBe('max')
  })
})
