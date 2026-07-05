// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './backend'

describe('backend API wrapper', () => {
  beforeEach(() => {
    window.go = {
      main: {
        App: {
          WriteTerminal: vi.fn(async () => undefined),
        } as never,
      },
    }
  })

  it('writes terminal input through the dataBase64 Wails field', async () => {
    await api.writeTerminal('terminal-1', '5ZWK')
    expect(window.go?.main?.App?.WriteTerminal).toHaveBeenCalledWith({
      sessionId: 'terminal-1',
      dataBase64: '5ZWK',
    })
    const request = vi.mocked(window.go!.main!.App!.WriteTerminal).mock.calls[0][0] as Record<string, unknown>
    expect(request).not.toHaveProperty('data')
  })
})
