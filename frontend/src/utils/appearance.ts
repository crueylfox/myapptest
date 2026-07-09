import type { UIFontSize } from '../types'

export const uiFontSizeSteps: UIFontSize[] = ['tiny', 'small', 'standard', 'large', 'extra_large', 'huge', 'max']

const fontPixels: Record<UIFontSize, number> = {
  tiny: 12,
  small: 13,
  standard: 14,
  large: 15,
  extra_large: 16,
  huge: 17,
  max: 18,
}

export function uiFontPixels(size: UIFontSize): number {
  return fontPixels[size]
}

export function applyUIFontSize(size: UIFontSize): number {
  const pixels = uiFontPixels(size)
  document.documentElement.dataset.uiFont = size
  document.documentElement.style.setProperty('--ui-font-size', `${pixels}px`)
  window.dispatchEvent(new Event('hostdeck:appearance'))
  return pixels
}
