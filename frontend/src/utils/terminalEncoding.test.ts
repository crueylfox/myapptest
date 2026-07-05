import { describe, expect, it } from 'vitest'
import { decodeTerminalBase64ToBytes, encodeTerminalInputToBase64 } from './terminalEncoding'

describe('terminal encoding', () => {
  it('encodes Chinese terminal input as UTF-8 bytes before base64', () => {
    const encoded = encodeTerminalInputToBase64('啊')
    expect([...decodeTerminalBase64ToBytes(encoded)]).toEqual([0xe5, 0x95, 0x8a])
    expect([...decodeTerminalBase64ToBytes(encoded)]).not.toContain(0xff)
  })

  it('keeps mixed shell input as UTF-8 without Latin-1 truncation', () => {
    const encoded = encodeTerminalInputToBase64('echo 中文测试\r')
    const decoded = new TextDecoder().decode(decodeTerminalBase64ToBytes(encoded))
    expect(decoded).toBe('echo 中文测试\r')
  })
})
