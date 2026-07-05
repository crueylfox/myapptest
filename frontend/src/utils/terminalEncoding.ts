export function encodeTerminalInputToBase64(input: string): string {
  return bytesToBase64(new TextEncoder().encode(input))
}

export function decodeTerminalBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index)
  }
  return result
}

export function isTerminalCompositionKeyEvent(event: KeyboardEvent, composing = false): boolean {
  return composing || event.isComposing || event.key === 'Process' || event.code === 'Process' || event.keyCode === 229
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    for (const byte of bytes.subarray(offset, offset + 8192)) {
      binary += String.fromCharCode(byte)
    }
  }
  return btoa(binary)
}
