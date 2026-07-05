function decodeBase64Text(dataBase64: string) {
  try {
    const binary = atob(dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function hasVisibleTerminalOutput(dataBase64: string) {
  const text = decodeBase64Text(dataBase64)
  if (text === null) return true
  const withoutOsc = text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
  const withoutCsi = withoutOsc.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  const withoutEsc = withoutCsi.replace(/\x1b[ -/]*[@-~]/g, '')
  const withoutControls = withoutEsc.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
  return /[^\s]/u.test(withoutControls)
}
