import { describe, expect, it } from 'vitest'
import {
  appPanelControllerHandlerKeys,
  resolveRuntimeTarget,
  hasRuntimeTarget,
} from './appRuntimeControllerModel'

describe('appRuntimeControllerModel', () => {
  it('keeps runtime/controller handler keys stable and explicit', () => {
    expect(appPanelControllerHandlerKeys).toEqual([
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
    ])
  })

  it('resolves active runtime target without storing sensitive or output payloads', () => {
    expect(resolveRuntimeTarget({ activeWorkspaceServerId: 7, selectedServerId: 8 })).toBe(7)
    expect(resolveRuntimeTarget({ activeWorkspaceServerId: null, selectedServerId: 8 })).toBe(8)
    expect(resolveRuntimeTarget({ activeWorkspaceServerId: null, selectedServerId: null })).toBeNull()
    expect(hasRuntimeTarget({ activeWorkspaceServerId: null, selectedServerId: 8 })).toBe(true)
    expect(JSON.stringify(appPanelControllerHandlerKeys)).not.toMatch(/password|passphrase|privateKey|terminal output|remote file content/i)
  })
})
