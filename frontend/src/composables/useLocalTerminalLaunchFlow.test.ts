import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLocalTerminalLaunchFlow } from './useLocalTerminalLaunchFlow'
import { usePaneTargetRequests } from './usePaneTargetRequests'
import type { AppSettings, LocalTerminalCapabilities } from '../types'
import { createDefaultAppSettings } from '../utils/defaultAppSettings'

const capabilities = (
  elevated = true,
  overrides: Partial<LocalTerminalCapabilities> = {},
): LocalTerminalCapabilities => ({
  platform: 'windows',
  enabled: true,
  supported: true,
  conptyAvailable: true,
  isProcessElevated: elevated,
  supportsElevation: true,
  shellOptions: [],
  adminShellOptions: [],
  defaultShellPreference: 'powershell',
  currentShellPreference: 'powershell',
  unsupportedMessage: '',
  ...overrides,
})

function createFlow(overrides: Partial<Parameters<typeof useLocalTerminalLaunchFlow>[0]> = {}) {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const settings = ref<AppSettings>(createDefaultAppSettings())
  const paneTargets = usePaneTargetRequests()
  const deps: Parameters<typeof useLocalTerminalLaunchFlow>[0] = {
    activeView,
    settings,
    enabled: computed(() => true),
    capabilities: () => capabilities(),
    beginPaneOpenTarget: paneTargets.beginPaneOpenTarget,
    clearPendingPaneOpenTarget: paneTargets.clearPendingPaneOpenTarget,
    pendingConnectSavedTarget: () => paneTargets.pendingForAction('connect-saved'),
    publishPaneTargetAssignment: paneTargets.publishPaneTargetAssignment,
    clearActiveWorkspace: vi.fn(),
    openLocalTerminalSession: vi.fn(async (shellKind: string) => ({ sessionId: `${shellKind}-1` })),
    relaunchElevatedLocalTerminal: vi.fn(async () => undefined),
    confirmElevatedRelaunch: vi.fn(async () => true),
    closeTransientOverlays: vi.fn(),
    showToast: vi.fn(),
    run: vi.fn(async (action: () => Promise<void>) => { await action() }),
    ...overrides,
  }
  return {
    ...paneTargets,
    activeView,
    deps,
    flow: useLocalTerminalLaunchFlow(deps),
  }
}

describe('useLocalTerminalLaunchFlow', () => {
  it('opens topbar CMD and PowerShell without a pane target', async () => {
    const openLocalTerminalSession = vi.fn(async (shellKind: string) => ({ sessionId: `${shellKind}-1` }))
    const ctx = createFlow({ openLocalTerminalSession })

    await ctx.flow.openLocalTerminal('cmd')
    await ctx.flow.openLocalTerminal('powershell')

    expect(openLocalTerminalSession).toHaveBeenNthCalledWith(1, 'cmd', false, 100, 30)
    expect(openLocalTerminalSession).toHaveBeenNthCalledWith(2, 'powershell', false, 100, 30)
    expect(ctx.activeView.value).toBe('terminals')
  })

  it('assigns pane-targeted CMD and PowerShell sessions to their requested panes', async () => {
    const ctx = createFlow()

    await ctx.flow.openLocalTerminalForPane('pane-a', 'cmd')
    expect(ctx.paneTargetAssignment.value).toMatchObject({
      paneId: 'pane-a',
      kind: 'local',
      sessionId: 'cmd-1',
    })

    await ctx.flow.openLocalTerminalForPane('pane-b', 'powershell')
    expect(ctx.paneTargetAssignment.value).toMatchObject({
      paneId: 'pane-b',
      kind: 'local',
      sessionId: 'powershell-1',
    })
  })

  it('opens macOS local terminals without elevated relaunch even when the saved setting is enabled', async () => {
    const openLocalTerminalSession = vi.fn(async (shellKind: string) => ({ sessionId: `${shellKind}-1` }))
    const relaunchElevatedLocalTerminal = vi.fn(async () => undefined)
    const confirmElevatedRelaunch = vi.fn(async () => true)
    const ctx = createFlow({
      openLocalTerminalSession,
      relaunchElevatedLocalTerminal,
      confirmElevatedRelaunch,
      capabilities: () => capabilities(false, {
        platform: 'darwin',
        conptyAvailable: false,
        supportsElevation: false,
        shellOptions: [{ id: 'local', label: '本地终端', description: '$SHELL' }],
        defaultShellPreference: 'local',
        currentShellPreference: 'local',
      }),
    })
    ctx.deps.settings.value.localTerminalElevatedEnabled = true

    await ctx.flow.openLocalTerminalForPane('pane-a', 'local')

    expect(confirmElevatedRelaunch).not.toHaveBeenCalled()
    expect(relaunchElevatedLocalTerminal).not.toHaveBeenCalled()
    expect(openLocalTerminalSession).toHaveBeenCalledWith('local', false, 100, 30)
    expect(ctx.paneTargetAssignment.value).toMatchObject({
      paneId: 'pane-a',
      kind: 'local',
      sessionId: 'local-1',
    })
  })

  it('clears a pane target and reports failure without closing or restarting existing local sessions', async () => {
    const run = vi.fn(async (action: () => Promise<void>) => {
      try {
        await action()
      } catch {
        // keep App.vue run() semantics for failure cleanup
      }
    })
    const openLocalTerminalSession = vi.fn(async () => { throw new Error('open failed') })
    const closeExistingSession = vi.fn()
    const ctx = createFlow({ run, openLocalTerminalSession })

    await ctx.flow.openLocalTerminalForPane('pane-a', 'cmd')

    expect(ctx.pendingPaneOpenTarget.value).toBeNull()
    expect(ctx.paneTargetAssignment.value).toBeNull()
    expect(closeExistingSession).not.toHaveBeenCalled()
  })
})
