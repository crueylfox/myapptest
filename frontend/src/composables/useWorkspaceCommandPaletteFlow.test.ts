import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { CommandExecutionTarget } from './useCommandExecutionFlow'
import { useWorkspaceCommandPaletteFlow } from './useWorkspaceCommandPaletteFlow'

describe('useWorkspaceCommandPaletteFlow', () => {
  it('opens and closes the command palette with the requested tab', () => {
    const flow = useWorkspaceCommandPaletteFlow(commandFlowHarness())

    flow.openCommandPalette('favorites')
    expect(flow.commandPaletteOpen.value).toBe(true)
    expect(flow.commandPaletteTab.value).toBe('favorites')

    flow.closeCommandPalette()
    expect(flow.commandPaletteOpen.value).toBe(false)
  })

  it('writes inserted and executed commands through the existing command execution path', async () => {
    const harness = commandFlowHarness()
    const flow = useWorkspaceCommandPaletteFlow(harness)

    await flow.writeCommand('hostname', false)
    await flow.writeCommand('uptime', true)

    expect(harness.observedPayloads).toEqual(['hostname', 'uptime\r'])
    expect(harness.recordedHistory).toEqual([{ kind: 'ssh', connectionId: 7, sessionId: 'ssh-1', command: 'uptime', localHistoryScope: undefined }])
    expect(harness.writeTerminal).toHaveBeenCalledTimes(2)
  })

  it('does not write when there is no active online SSH command target', async () => {
    const harness = commandFlowHarness({ target: null })
    const flow = useWorkspaceCommandPaletteFlow(harness)

    const result = await flow.writeCommand('whoami', true)

    expect(result.ok).toBe(false)
    expect(harness.writeTerminal).not.toHaveBeenCalled()
    expect(harness.notify).toHaveBeenCalledWith('当前没有可用的终端会话', 'error')
  })
})

function commandFlowHarness(options: { target?: CommandExecutionTarget | null } = {}) {
  const target = ref<CommandExecutionTarget | null>(options.target === undefined
    ? { sessionId: 'ssh-1', connectionId: 7, status: 'online' }
    : options.target)
  const observedPayloads: string[] = []
  const recordedHistory: Array<{ kind: 'ssh' | 'local'; connectionId: number; sessionId: string; command: string; localHistoryScope?: 'local:cmd' | 'local:powershell' }> = []
  return {
    getActiveCommandTarget: () => target.value,
    writeTerminal: vi.fn(async () => undefined),
    observeTerminalInput: vi.fn((_sessionId: string, payload: string) => {
      observedPayloads.push(payload)
      return false
    }),
    recordHistory: vi.fn(async (payload: { kind: 'ssh' | 'local'; connectionId: number; sessionId: string; command: string; localHistoryScope?: 'local:cmd' | 'local:powershell' }) => {
      recordedHistory.push(payload)
      return {}
    }),
    notify: vi.fn(),
    recordHistoryFailure: vi.fn(),
    observedPayloads,
    recordedHistory,
  }
}
