import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useServerContextMenuController } from './useServerContextMenuController'
import type { Connection } from '../types'

const connection = (id = 7): Connection => ({
  id,
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
})

function createController(retryWorkspace = false) {
  const menu = ref<{ x: number; y: number; connectionId: number } | null>(null)
  const item = connection()
  const actions = {
    openTerminalFromMenu: vi.fn(),
    newTerminal: vi.fn(),
    openSftpForConnection: vi.fn(),
    openMonitor: vi.fn(),
    activateServer: vi.fn(),
    connectServer: vi.fn(),
    reconnectServer: vi.fn(),
    disconnectServer: vi.fn(),
    openEdit: vi.fn(),
    duplicateConnection: vi.fn(),
    closeWorkspace: vi.fn(),
    resetHostTrust: vi.fn(),
    deleteConnection: vi.fn(),
  }
  return {
    menu,
    item,
    actions,
    controller: useServerContextMenuController({
      serverMenu: menu,
      menuConnection: () => item,
      selectConnection: vi.fn(),
      retryWorkspace: () => retryWorkspace,
      ...actions,
    }),
  }
}

describe('useServerContextMenuController', () => {
  it('opens the server row context menu without closing ServerPicker', () => {
    const ctx = createController()
    const event = { clientX: 10, clientY: 20 } as MouseEvent

    ctx.controller.openServerMenu(event, ctx.item)

    expect(ctx.menu.value).toEqual({ x: 10, y: 20, connectionId: 7 })
  })

  it('dispatches menu action intents to injected callbacks', async () => {
    const ctx = createController()

    await ctx.controller.selectServerMenu('open-terminal')
    await ctx.controller.selectServerMenu('new-terminal')
    await ctx.controller.selectServerMenu('sftp')
    await ctx.controller.selectServerMenu('delete')

    expect(ctx.actions.openTerminalFromMenu).toHaveBeenCalledWith(ctx.item)
    expect(ctx.actions.newTerminal).toHaveBeenCalledWith(ctx.item.id)
    expect(ctx.actions.openSftpForConnection).toHaveBeenCalledWith(ctx.item)
    expect(ctx.actions.deleteConnection).toHaveBeenCalledWith(ctx.item)
  })

  it('routes a retry connect menu item through activateServer while normal connect uses connectServer', async () => {
    const retry = createController(true)
    await retry.controller.selectServerMenu('connect')
    expect(retry.actions.activateServer).toHaveBeenCalledWith(retry.item)
    expect(retry.actions.connectServer).not.toHaveBeenCalled()

    const normal = createController(false)
    await normal.controller.selectServerMenu('connect')
    expect(normal.actions.connectServer).toHaveBeenCalledWith(normal.item)
    expect(normal.actions.activateServer).not.toHaveBeenCalled()
  })
})
