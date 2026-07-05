import { describe, expect, it, vi } from 'vitest'
import { useKeyVaultPanelFlow } from './useKeyVaultPanelFlow'

describe('useKeyVaultPanelFlow', () => {
  it('refreshes server records after Key Vault deletion without disconnecting sessions', async () => {
    const refreshConnections = vi.fn(async () => undefined)
    const disconnectServer = vi.fn()
    const flow = useKeyVaultPanelFlow({ refreshConnections })

    await flow.handleKeyVaultDeleted()

    expect(refreshConnections).toHaveBeenCalledTimes(1)
    expect(disconnectServer).not.toHaveBeenCalled()
  })

  it('refreshes server records after terminal profile deletion', async () => {
    const refreshConnections = vi.fn(async () => undefined)
    const flow = useKeyVaultPanelFlow({ refreshConnections })

    await flow.handleTerminalProfileDeleted()

    expect(refreshConnections).toHaveBeenCalledTimes(1)
  })
})
