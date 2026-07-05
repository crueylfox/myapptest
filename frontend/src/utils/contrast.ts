export function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(parseHexColor(foreground))
  const bg = relativeLuminance(parseHexColor(background))
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

function parseHexColor(value: string): [number, number, number] {
  const normalized = value.trim().replace(/^#/, '')
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    throw new Error(`Unsupported color: ${value}`)
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
