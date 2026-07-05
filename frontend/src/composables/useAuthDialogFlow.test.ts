// @vitest-environment jsdom

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAuthDialogFlow } from './useAuthDialogFlow'
import { usePaneTargetRequests } from './usePaneTargetRequests'
import type { AuthRequest, Connection, ConnectionError } from '../types'

const auth = (values: Partial<AuthRequest> = {}): AuthRequest => ({
  password: '',
  passphrase: '',
  trustUnknownHost: false,
  rememberSecret: false,
  ...values,
})

const connection = (values: Partial<Connection> = {}): Connection => ({
  id: 7,
  groupId: null,
  name: 'server',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  terminalProfileId: null,
  connectionMode: 'direct',
  jumpServerId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
  ...values,
})

function createFlow(overrides: Partial<Parameters<typeof useAuthDialogFlow>[0]> = {}) {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const sftpOpenRevision = ref(0)
  const paneTargets = usePaneTargetRequests()
  const savedConnection = connection()
  const showToast = vi.fn()
  const deps: Parameters<typeof useAuthDialogFlow>[0] = {
    activeView,
    sftpOpenRevision,
    pendingPaneOpenTarget: paneTargets.pendingPaneOpenTarget,
    clearPendingPaneOpenTarget: paneTargets.clearPendingPaneOpenTarget,
    publishPaneTargetAssignment: paneTargets.publishPaneTargetAssignment,
    findConnection: (id) => id === savedConnection.id ? savedConnection : null,
    testConnection: vi.fn(async () => ({
      success: true,
      latencyMillis: 12,
      errorCode: '',
      message: '',
    })),
    connectServer: vi.fn(async () => undefined),
    ensureMonitorAndOpenTerminal: vi.fn(async () => ({ sessionId: 'ssh-1' })),
    reconnectTerminalAndSyncFiles: vi.fn(async () => undefined),
    reconnectServerWithAuth: vi.fn(async () => undefined),
    sftpOpen: vi.fn(async () => undefined),
    sftpReconnect: vi.fn(async () => undefined),
    showConnectionError: vi.fn(),
    showToast,
    run: vi.fn(async (action: () => Promise<void>) => { await action() }),
    ...overrides,
  }
  return {
    ...paneTargets,
    activeView,
    sftpOpenRevision,
    deps,
    showToast,
    flow: useAuthDialogFlow(deps),
  }
}

describe('useAuthDialogFlow', () => {
  it('opens an auth challenge with the current mode, connection, and issue', () => {
    const ctx = createFlow()

    ctx.flow.requestAuth('terminal', 7, 'auth required')

    expect(ctx.flow.authDialog.value).toBe(true)
    expect(ctx.flow.authMode.value).toBe('terminal')
    expect(ctx.flow.authConnectionId.value).toBe(7)
    expect(ctx.flow.authConnection.value?.name).toBe('server')
    expect(ctx.flow.authIssue.value).toBe('auth required')
  })

  it('submits terminal credentials to the injected terminal opener and assigns the pending pane', async () => {
    const ctx = createFlow()
    ctx.beginPaneOpenTarget('pane-a', 'connect-saved')
    ctx.flow.requestAuth('terminal', 7, 'auth required')

    await ctx.flow.submitAuth(auth({ password: '__user_input__' }))

    expect(ctx.deps.ensureMonitorAndOpenTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.objectContaining({ password: '__user_input__' }),
    )
    expect(ctx.paneTargetAssignment.value).toMatchObject({
      paneId: 'pane-a',
      kind: 'ssh',
      sessionId: 'ssh-1',
    })
    expect(ctx.activeView.value).toBe('terminals')
    expect(ctx.flow.authDialog.value).toBe(false)
  })

  it('keeps the dialog open and updates issue when a test credential retry is required', async () => {
    const ctx = createFlow({
      testConnection: vi.fn(async () => ({
        success: false,
        latencyMillis: 0,
        errorCode: 'PASSWORD_REQUIRED',
        message: 'retry',
        connectionError: {
          code: 'PASSWORD_REQUIRED',
          userMessage: 'retry auth',
          technicalMessage: '',
          retryable: true,
          serverId: 7,
          operation: 'test',
          timestamp: '',
        } satisfies ConnectionError,
      })),
    })
    ctx.flow.requestAuth('test', 7, 'auth required')

    await ctx.flow.submitAuth(auth({ password: '__retry_input__' }))

    expect(ctx.flow.authDialog.value).toBe(true)
    expect(ctx.flow.authIssue.value).toBe('retry auth')
    expect(ctx.deps.showConnectionError).not.toHaveBeenCalled()
  })

  it('submits SFTP reconnect credentials to the injected SFTP reconnect callback', async () => {
    const ctx = createFlow()
    ctx.flow.requestAuth('sftp', 7, 'auth required', 'ctx-1', 'term-1', true)

    await ctx.flow.submitAuth(auth({ passphrase: '__user_input__' }))

    expect(ctx.deps.sftpReconnect).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ passphrase: '__user_input__' }),
      'ctx-1',
      'term-1',
    )
    expect(ctx.sftpOpenRevision.value).toBe(1)
    expect(ctx.activeView.value).toBe('terminals')
  })

  it('cancels a terminal auth prompt and clears only the matching pending pane target', () => {
    const ctx = createFlow()
    const target = ctx.beginPaneOpenTarget('pane-a', 'connect-saved')
    ctx.flow.requestAuth('terminal', 7, 'auth required')

    ctx.flow.closeAuthDialog()

    expect(ctx.flow.authDialog.value).toBe(false)
    expect(ctx.pendingPaneOpenTarget.value).not.toEqual(target)
  })

  it('does not write submitted auth material to storage or toast calls', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const ctx = createFlow()
    ctx.flow.requestAuth('connect', 7, 'auth required')

    await ctx.flow.submitAuth(auth({ password: '__user_input__', passphrase: '__user_input__' }))

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(ctx.showToast.mock.calls)).not.toContain('__user_input__')
  })
})
