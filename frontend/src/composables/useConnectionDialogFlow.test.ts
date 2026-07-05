// @vitest-environment jsdom

import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useConnectionDialogFlow } from './useConnectionDialogFlow'
import { usePaneTargetRequests } from './usePaneTargetRequests'
import type {
  AuthRequest,
  Connection,
  ConnectionRuntimeState,
  SaveConnectionConfigRequest,
  SaveConnectionRequest,
} from '../types'

const emptyAuth = (): AuthRequest => ({
  password: '',
  passphrase: '',
  trustUnknownHost: false,
  rememberSecret: false,
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

const runtimeState = (values: Partial<ConnectionRuntimeState> = {}): ConnectionRuntimeState => ({
  connectionId: 7,
  status: 'offline',
  monitorActive: false,
  terminalActive: false,
  terminalConnecting: false,
  sftpActive: false,
  connecting: false,
  hasActiveSession: false,
  updatedAt: '',
  ...values,
})

function saveRequest(values: Partial<SaveConnectionConfigRequest> = {}): SaveConnectionConfigRequest {
  return {
    connection: {
      id: 0,
      groupId: null,
      name: 'new server',
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
      refreshInterval: 2,
    },
    auth: emptyAuth(),
    connectAfterSave: true,
    ...values,
  }
}

function createFlow(overrides: Partial<Parameters<typeof useConnectionDialogFlow>[0]> = {}) {
  const dialogOpen = ref(false)
  const editing = ref<Connection | null>(null)
  const activeView = ref<'terminals' | 'monitor' | 'logs' | 'settings'>('monitor')
  const serverPickerAnchor = ref<HTMLElement | null>(null)
  const paneTargets = usePaneTargetRequests()
  const savedConnection = connection()
  const saveConnectionConfig = vi.fn(async () => ({ connection: savedConnection, connectAfterSave: true }))
  const deps: Parameters<typeof useConnectionDialogFlow>[0] = {
    connectionDialog: dialogOpen,
    editing,
    activeView,
    serverPickerAnchor,
    pendingPaneOpenTarget: paneTargets.pendingPaneOpenTarget,
    beginPaneOpenTarget: paneTargets.beginPaneOpenTarget,
    clearPendingPaneOpenTarget: paneTargets.clearPendingPaneOpenTarget,
    publishPaneTargetAssignment: paneTargets.publishPaneTargetAssignment,
    closeTransientOverlays: vi.fn(),
    nextTick,
    findConnection: (id) => id === savedConnection.id ? savedConnection : null,
    saveConnectionConfig,
    loadConnections: vi.fn(async () => undefined),
    selectConnection: vi.fn(),
    syncConnectionState: vi.fn(),
    connectionState: () => runtimeState(),
    hasWorkspace: () => false,
    sessionsByServerId: () => [],
    openTerminalForSavedConnection: vi.fn(async () => ({ sessionId: 'ssh-1' })),
    duplicateConnectionConfig: vi.fn(async () => undefined),
    deleteConnectionConfig: vi.fn(async () => undefined),
    removeWorkspaceLocal: vi.fn(),
    markExpectedDisconnect: vi.fn(),
    removeServerAlerts: vi.fn(),
    showToast: vi.fn(),
    run: vi.fn(async (action: () => Promise<void>) => { await action() }),
    ...overrides,
  }
  return {
    ...paneTargets,
    dialogOpen,
    editing,
    activeView,
    saveConnectionConfig,
    deps,
    flow: useConnectionDialogFlow(deps),
  }
}

describe('useConnectionDialogFlow', () => {
  it('assigns a SaveAndConnect-created SSH terminal to the pane that opened the dialog', async () => {
    const ctx = createFlow()
    await ctx.flow.openCreateForPane('pane-a')

    await ctx.flow.saveConnection(saveRequest())

    expect(ctx.paneTargetAssignment.value).toMatchObject({
      paneId: 'pane-a',
      kind: 'ssh',
      sessionId: 'ssh-1',
    })
    expect(ctx.activeView.value).toBe('terminals')
  })

  it('does not occupy a pane for save-only and clears the matching pending target', async () => {
    const ctx = createFlow({
      saveConnectionConfig: vi.fn(async () => ({ connection: connection({ id: 9 }), connectAfterSave: false })),
    })
    await ctx.flow.openCreateForPane('pane-a')

    await ctx.flow.saveConnection(saveRequest({ connectAfterSave: false }))

    expect(ctx.paneTargetAssignment.value).toBeNull()
    expect(ctx.pendingPaneOpenTarget.value).toBeNull()
  })

  it('cleans the pending add-server target on dialog close', async () => {
    const ctx = createFlow()
    await ctx.flow.openCreateForPane('pane-a')

    ctx.flow.closeConnectionDialog()

    expect(ctx.dialogOpen.value).toBe(false)
    expect(ctx.pendingPaneOpenTarget.value).toBeNull()
  })

  it('keeps the dialog open and clears only the matching pane target when save fails before creating a tab', async () => {
    const run = vi.fn(async (action: () => Promise<void>) => {
      try {
        await action()
      } catch {
        // keep existing App.vue run() semantics: surface toast and do not rethrow
      }
    })
    const ctx = createFlow({
      run,
      saveConnectionConfig: vi.fn(async () => { throw new Error('save failed') }),
    })
    await ctx.flow.openCreateForPane('pane-a')
    ctx.dialogOpen.value = true

    await ctx.flow.saveConnection(saveRequest())

    expect(ctx.dialogOpen.value).toBe(true)
    expect(ctx.paneTargetAssignment.value).toBeNull()
    expect(ctx.pendingPaneOpenTarget.value).toBeNull()
  })

  it('passes blank password, Key Vault id, and Jump Host fields through without changing credential semantics', async () => {
    const saveConnectionConfig = vi.fn(async (request: SaveConnectionConfigRequest) => ({
      connection: connection({ id: 11, keyVaultId: request.connection.keyVaultId, jumpServerId: request.connection.jumpServerId }),
      connectAfterSave: false,
    }))
    const ctx = createFlow({ saveConnectionConfig })
    const request = saveRequest({
      connectAfterSave: false,
      connection: {
        ...saveRequest().connection,
        id: 11,
        authType: 'private_key',
        privateKeySource: 'key_vault',
        keyVaultId: 23,
        connectionMode: 'jump',
        jumpServerId: 3,
      },
      auth: {
        ...emptyAuth(),
        secretUpdateMode: 'unchanged',
      },
    })

    await ctx.flow.saveConnection(request)

    expect(saveConnectionConfig).toHaveBeenCalledWith(request)
    expect(saveConnectionConfig.mock.calls[0][0].auth.password).toBe('')
    expect(saveConnectionConfig.mock.calls[0][0].connection.keyVaultId).toBe(23)
    expect(saveConnectionConfig.mock.calls[0][0].connection.jumpServerId).toBe(3)
  })

  it('duplicates a server profile without copying credentials or host trust', async () => {
    const duplicateConnectionConfig = vi.fn(async (_connection: SaveConnectionRequest) => undefined)
    const ctx = createFlow({ duplicateConnectionConfig })

    await ctx.flow.duplicateConnection(connection({
      id: 12,
      groupId: 2,
      name: 'source',
      host: '192.0.2.12',
      authType: 'private_key',
      privateKeySource: 'key_vault',
      privateKeyPath: '',
      keyVaultId: 9,
      terminalProfileId: 'profile-a',
      connectionMode: 'jump',
      jumpServerId: 3,
      hostKeyFingerprint: 'SHA256:old',
      credentialSaved: true,
    }))

    expect(duplicateConnectionConfig).toHaveBeenCalledWith(expect.objectContaining({
      id: 0,
      groupId: 2,
      name: 'source 副本',
      host: '192.0.2.12',
      authType: 'private_key',
      privateKeySource: 'key_vault',
      privateKeyPath: '',
      keyVaultId: 9,
      terminalProfileId: 'profile-a',
    }))
    const duplicated = duplicateConnectionConfig.mock.calls[0][0]
    expect(Object.prototype.hasOwnProperty.call(duplicated, 'connectionMode')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(duplicated, 'jumpServerId')).toBe(false)
    expect(JSON.stringify(duplicateConnectionConfig.mock.calls)).not.toContain('SHA256:old')
    expect(JSON.stringify(duplicateConnectionConfig.mock.calls)).not.toContain('credentialSaved')
  })

  it('confirms before deleting saved credentials and refreshes the editing connection', async () => {
    const deleteSavedCredentialById = vi.fn(async () => undefined)
    const confirmDialog = vi.fn(async () => true)
    const refreshed = connection({ id: 7, credentialSaved: false })
    const ctx = createFlow({
      deleteSavedCredentialById,
      confirmDeleteSavedCredential: undefined,
      confirmDialog,
      findConnection: (id) => id === 7 ? refreshed : null,
    })

    await ctx.flow.deleteSavedCredential(7)

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      danger: true,
    }))
    expect(deleteSavedCredentialById).toHaveBeenCalledWith(7)
    expect(ctx.editing.value).toEqual(refreshed)
  })

  it('deletes a server profile after warning about affected jump targets', async () => {
    const source = connection({ id: 7, name: 'jump-source' })
    const jumpTarget = connection({
      id: 8,
      name: 'jump-target',
      connectionMode: 'jump',
      jumpServerId: 7,
    })
    const deleteConnectionConfig = vi.fn(async () => undefined)
    const confirmDialog = vi.fn(async () => true)
    const ctx = createFlow({
      confirmDialog,
      deleteConnectionConfig,
      findConnection: (id) => id === 7 ? source : id === 8 ? jumpTarget : null,
      connections: () => [source, jumpTarget],
    })

    await ctx.flow.deleteConnection(source)

    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '删除服务器',
      danger: true,
      message: expect.stringContaining('jump-target'),
    }))
    expect(ctx.deps.markExpectedDisconnect).toHaveBeenCalledWith(7)
    expect(ctx.deps.removeServerAlerts).toHaveBeenCalledWith(7)
    expect(deleteConnectionConfig).toHaveBeenCalledWith(7)
    expect(ctx.deps.removeWorkspaceLocal).toHaveBeenCalledWith(7)
  })

  it('does not delete a server profile when confirmation is cancelled', async () => {
    const deleteConnectionConfig = vi.fn(async () => undefined)
    const ctx = createFlow({
      confirmDialog: vi.fn(async () => false),
      deleteConnectionConfig,
    })

    await ctx.flow.deleteConnection(connection())

    expect(deleteConnectionConfig).not.toHaveBeenCalled()
    expect(ctx.deps.markExpectedDisconnect).not.toHaveBeenCalled()
  })
})
