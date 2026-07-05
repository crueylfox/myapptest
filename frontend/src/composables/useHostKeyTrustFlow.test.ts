// @vitest-environment jsdom

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useHostKeyTrustFlow } from './useHostKeyTrustFlow'
import type { AuthenticationState, Connection } from '../types'

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

const authState = (values: Partial<AuthenticationState> = {}): AuthenticationState => ({
  connectionId: 7,
  canAuthenticate: true,
  credentialSaved: true,
  credentialUsable: true,
  privateKeyEncrypted: false,
  hostTrusted: true,
  reasonCode: '',
  message: '',
  ...values,
})

function createFlow(overrides: Partial<Parameters<typeof useHostKeyTrustFlow>[0]> = {}) {
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const savedConnection = connection()
  const deps: Parameters<typeof useHostKeyTrustFlow>[0] = {
    activeView,
    findConnection: (id) => id === savedConnection.id ? savedConnection : null,
    probeHostKey: vi.fn(async () => ({ fingerprint: 'SHA256:new-fingerprint' })),
    trustHostKey: vi.fn(async () => undefined),
    loadConnections: vi.fn(async () => undefined),
    confirmTrust: vi.fn(async () => true),
    showToast: vi.fn(),
    run: vi.fn(async (action: () => Promise<void>) => { await action() }),
    findTerminalByConnection: vi.fn(() => null),
    authenticationStateFor: vi.fn(async () => authState()),
    canConnectSilently: vi.fn(() => true),
    requestAuthForState: vi.fn(async () => true),
    reconnectTerminalAndSyncFiles: vi.fn(async () => undefined),
    ensureMonitorAndOpenTerminal: vi.fn(async () => ({ sessionId: 'ssh-1' })),
    emptyAuth: () => ({
      password: '',
      passphrase: '',
      trustUnknownHost: false,
      rememberSecret: false,
    }),
    ...overrides,
  }
  return {
    activeView,
    deps,
    flow: useHostKeyTrustFlow(deps),
  }
}

describe('useHostKeyTrustFlow', () => {
  it('opens a trust request and preserves host/fingerprint display data', async () => {
    const confirmTrust = vi.fn(async (request) => {
      expect(request.connection.name).toBe('server')
      expect(request.previousFingerprint).toBe('未保存')
      expect(request.observedFingerprint).toBe('SHA256:new-fingerprint')
      expect(request.hasExistingFingerprint).toBe(false)
      return true
    })
    const ctx = createFlow({ confirmTrust })

    await ctx.flow.trustHostKeyAndRun(connection())

    expect(confirmTrust).toHaveBeenCalled()
    expect(ctx.deps.trustHostKey).toHaveBeenCalledWith(7, 'SHA256:new-fingerprint')
    expect(ctx.deps.loadConnections).toHaveBeenCalled()
    expect(ctx.flow.trustRequest.value).toBeNull()
  })

  it('rejects a trust request without trusting or continuing', async () => {
    const afterTrust = vi.fn()
    const ctx = createFlow({ confirmTrust: vi.fn(async () => false) })

    await ctx.flow.trustHostKeyAndRun(connection(), afterTrust)

    expect(ctx.deps.trustHostKey).not.toHaveBeenCalled()
    expect(afterTrust).not.toHaveBeenCalled()
  })

  it('continues an accept-once/persist flow after trust succeeds', async () => {
    const afterTrust = vi.fn()
    const ctx = createFlow({ findConnection: () => null })

    await ctx.flow.trustHostKeyAndRun(connection(), afterTrust)

    expect(afterTrust).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      hostKeyFingerprint: 'SHA256:new-fingerprint',
    }))
  })

  it('workspace trust requests auth when the trusted connection cannot connect silently', async () => {
    const state = authState({ canAuthenticate: false, hostTrusted: true })
    const ctx = createFlow({
      authenticationStateFor: vi.fn(async () => state),
      canConnectSilently: vi.fn(() => false),
    })

    await ctx.flow.trustWorkspaceHostKey(7)

    expect(ctx.deps.requestAuthForState).toHaveBeenCalledWith('terminal', 7, state)
    expect(ctx.deps.ensureMonitorAndOpenTerminal).not.toHaveBeenCalled()
  })

  it('workspace trust reconnects an existing terminal after trust succeeds', async () => {
    const ctx = createFlow({
      findTerminalByConnection: vi.fn(() => ({ sessionId: 'term-1', connectionId: 7 })),
    })

    await ctx.flow.trustWorkspaceHostKey(7)

    expect(ctx.deps.reconnectTerminalAndSyncFiles).toHaveBeenCalledWith('term-1', 7, {
      password: '',
      passphrase: '',
      trustUnknownHost: false,
      rememberSecret: false,
    })
    expect(ctx.activeView.value).toBe('terminals')
  })
})
