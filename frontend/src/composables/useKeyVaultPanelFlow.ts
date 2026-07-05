export interface KeyVaultPanelFlowOptions {
  refreshConnections: () => Promise<void>
}

export function useKeyVaultPanelFlow(options: KeyVaultPanelFlowOptions) {
  async function handleKeyVaultDeleted() {
    await options.refreshConnections()
  }

  async function handleTerminalProfileDeleted() {
    await options.refreshConnections()
  }

  return {
    handleKeyVaultDeleted,
    handleTerminalProfileDeleted,
  }
}
