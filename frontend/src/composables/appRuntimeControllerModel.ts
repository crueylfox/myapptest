export const appPanelControllerHandlerKeys = [
  'openServerMenu',
  'selectServerMenu',
  'navigateMain',
  'openMonitorPanel',
  'openActiveMonitorPanel',
  'openTunnelDialog',
  'openDockerDialog',
  'openProcessManager',
  'openServiceManager',
  'openNetworkDiagnostics',
  'openDashboardToolDialog',
  'switchDashboardServer',
  'connectDashboardServer',
  'disconnectDashboardServer',
] as const

export type AppPanelControllerHandlerKey = typeof appPanelControllerHandlerKeys[number]

export type RuntimeTargetState = {
  activeWorkspaceServerId: number | null
  selectedServerId: number | null
}

export function resolveRuntimeTarget(state: RuntimeTargetState) {
  return state.activeWorkspaceServerId ?? state.selectedServerId
}

export function hasRuntimeTarget(state: RuntimeTargetState) {
  return resolveRuntimeTarget(state) !== null
}
