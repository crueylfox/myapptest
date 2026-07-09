import type { ComputedRef, Ref } from 'vue'
import type { AppSettings, LocalTerminalCapabilities, LocalTerminalShellKind } from '../types'
import type { PendingPaneOpenTarget, PaneTargetAssignment } from './usePaneTargetRequests'
import { localTerminalPaneAction } from '../utils/localTerminalActions'

type AppView = 'terminals' | 'monitor' | 'logs' | 'settings'
type ToastType = 'success' | 'error' | 'info'

export interface LocalTerminalLaunchFlowOptions {
  activeView: Ref<AppView>
  settings: Ref<AppSettings>
  enabled: Ref<boolean> | ComputedRef<boolean>
  capabilities: () => LocalTerminalCapabilities | null | undefined
  beginPaneOpenTarget: (
    paneId: string,
    action: 'new-cmd' | 'new-powershell' | 'new-local',
  ) => PendingPaneOpenTarget
  clearPendingPaneOpenTarget: (target?: PendingPaneOpenTarget | null) => void
  pendingConnectSavedTarget: () => PendingPaneOpenTarget | null
  publishPaneTargetAssignment: (
    target: PendingPaneOpenTarget | null | undefined,
    kind: 'local',
    sessionId: string,
  ) => PaneTargetAssignment | null
  clearActiveWorkspace: () => void
  openLocalTerminalSession: (
    shellKind: LocalTerminalShellKind | string,
    elevated: boolean,
    rows: number,
    cols: number,
  ) => Promise<{ sessionId: string }>
  relaunchElevatedLocalTerminal: (shellKind: LocalTerminalShellKind | string) => Promise<void>
  confirmElevatedRelaunch: () => Promise<boolean>
  closeTransientOverlays: () => void
  showToast: (message: string, type: ToastType, detail?: string, code?: string) => void
  run: (action: () => Promise<void>, fallback: string) => Promise<void>
}

export function useLocalTerminalLaunchFlow(options: LocalTerminalLaunchFlowOptions) {
  let opening = false

  async function openLocalTerminal(
    shellKind: LocalTerminalShellKind | string,
    paneTarget: PendingPaneOpenTarget | null = null,
  ) {
    if (!options.enabled.value) {
      options.showToast('本地终端暂未启用', 'info')
      options.clearPendingPaneOpenTarget(paneTarget)
      return
    }
    const capabilities = options.capabilities()
    const elevated = Boolean(options.settings.value.localTerminalElevatedEnabled && capabilities?.supportsElevation)
    if (elevated && !capabilities?.isProcessElevated) {
      const ok = await options.confirmElevatedRelaunch()
      if (!ok) {
        options.clearPendingPaneOpenTarget(paneTarget)
        return
      }
      await options.run(async () => {
        await options.relaunchElevatedLocalTerminal(shellKind)
      }, '重新启动 HostDeck 失败')
      options.clearPendingPaneOpenTarget(paneTarget)
      return
    }
    if (opening) {
      options.showToast('本地终端正在启动，请稍候', 'info')
      options.clearPendingPaneOpenTarget(paneTarget)
      return
    }
    opening = true
    options.closeTransientOverlays()
    let paneTargetHandled = false
    try {
      await options.run(async () => {
        options.clearActiveWorkspace()
        const terminal = await options.openLocalTerminalSession(shellKind, elevated, 100, 30)
        options.publishPaneTargetAssignment(paneTarget, 'local', terminal.sessionId)
        paneTargetHandled = true
        options.activeView.value = 'terminals'
      }, '打开本地终端失败')
      if (paneTarget && !paneTargetHandled) options.clearPendingPaneOpenTarget(paneTarget)
    } finally {
      opening = false
    }
  }

  async function openLocalTerminalForPane(paneId: string, shellKind: LocalTerminalShellKind | string) {
    const target = options.beginPaneOpenTarget(
      paneId,
      localTerminalPaneAction(shellKind),
    )
    await openLocalTerminal(shellKind, target)
  }

  async function openLocalTerminalFromPicker(shellKind: LocalTerminalShellKind | string) {
    await openLocalTerminal(shellKind, options.pendingConnectSavedTarget())
  }

  return {
    openLocalTerminal,
    openLocalTerminalForPane,
    openLocalTerminalFromPicker,
  }
}
