import type { UIFontSize } from '../types'

const fontPixels: Record<UIFontSize, number> = {
  small: 13,
  standard: 14,
  large: 15,
  extra_large: 16,
}

export function uiFontPixels(size: UIFontSize): number {
  return fontPixels[size]
}

export function applyUIFontSize(size: UIFontSize): number {
  const pixels = uiFontPixels(size)
  document.documentElement.dataset.uiFont = size
  document.documentElement.style.setProperty('--ui-font-size', `${pixels}px`)
  window.dispatchEvent(new Event('serverpilot:appearance'))
  return pixels
}
