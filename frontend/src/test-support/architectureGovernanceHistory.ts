export type ArchitectureGovernanceRecord = {
  readonly title: string
  readonly versionChange: string
  readonly lineCount: string
}

export const architectureGovernanceHistory = {
  appToolOrchestration: {
    title: 'App.vue tools/settings/backup/keyvault/manager-panels',
    versionChange: '0.4.0-beta.14 -> 0.4.0-beta.15',
    lineCount: 'App.vue line count: 1344 -> 1095',
  },
  appConnectionOrchestration: {
    title: 'App.vue auth / host-key trust / connection-dialog orchestration',
    versionChange: '0.4.0-beta.24 -> 0.4.0-beta.25',
    lineCount: 'App.vue line count: 1047 -> 927',
  },
  appLifecycleOrchestration: {
    title: 'App.vue startup / subscriptions / lifecycle orchestration',
    versionChange: '0.4.0-beta.25 -> 0.4.0-beta.26',
    lineCount: 'App.vue line count: 927 -> 834',
  },
  appCommandActionOrchestration: {
    title: 'App.vue global command/menu action orchestration',
    versionChange: '0.4.0-beta.26 -> 0.4.0-beta.27',
    lineCount: 'App.vue line count: 834 -> 737',
  },
  appRuntimeControllerWiring: {
    title: 'App.vue runtime/controller wiring orchestration',
    versionChange: '0.4.0-beta.27 -> 0.4.0-beta.28',
    lineCount: 'App.vue line count: 737 -> 641',
  },
  terminalWorkspaceCommandOrchestration: {
    title: 'TerminalWorkspace / CommandPalette / workspace command orchestration large-refactor',
    versionChange: '0.4.0-beta.28 -> 0.4.0-beta.29',
    lineCount: 'TerminalWorkspace.vue line count: 1687 -> 1293',
  },
  terminalWorkspacePaneLayoutOrchestration: {
    title: 'TerminalWorkspace split-pane layout / resize / pane shell orchestration large-refactor',
    versionChange: '0.4.0-beta.29 -> 0.4.0-beta.30',
    lineCount: 'TerminalWorkspace.vue line count: 1294 -> 1138',
  },
  terminalWorkspaceTransferOverlayOrchestration: {
    title: 'TerminalWorkspace transfer/status overlay orchestration large-refactor',
    versionChange: '0.4.0-beta.32 -> 0.4.0-beta.33',
    lineCount: 'TerminalWorkspace.vue line count: 1137 -> 976',
  },
  settingsBackupRestoreOrchestration: {
    title: 'SettingsView Backup / Restore import-export orchestration large-refactor',
    versionChange: '0.4.0-beta.33 -> 0.4.0-beta.34',
    lineCount: 'SettingsView.vue line count: 1693 -> 1498',
  },
  serviceManagerDialogTargetedRefactor: {
    title: 'ServiceManagerDialog targeted large-refactor',
    versionChange: '0.4.0-beta.34 -> 0.4.0-beta.35',
    lineCount: 'ServiceManagerDialog.vue line count: 1552 -> 594',
  },
} satisfies Record<string, ArchitectureGovernanceRecord>
