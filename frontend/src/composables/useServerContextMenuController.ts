import type { Ref } from 'vue'
import type { Connection } from '../types'
import { resolveServerMenuAction } from '../utils/serverActionModel'

export type ServerMenuState = { x: number; y: number; connectionId: number }

export interface ServerContextMenuControllerOptions {
  serverMenu: Ref<ServerMenuState | null>
  menuConnection: () => Connection | null
  retryWorkspace: (connection: Connection) => boolean
  selectConnection: (connectionId: number) => unknown
  openTerminalFromMenu: (connection: Connection) => unknown | Promise<unknown>
  newTerminal: (connectionId?: number) => unknown | Promise<unknown>
  openSftpForConnection: (connection: Connection) => unknown | Promise<unknown>
  openMonitor: (connection: Connection) => unknown | Promise<unknown>
  activateServer: (connection: Connection) => unknown | Promise<unknown>
  connectServer: (connection: Connection) => unknown | Promise<unknown>
  reconnectServer: (connection: Connection) => unknown | Promise<unknown>
  disconnectServer: (connection: Connection, closeWorkspace?: boolean) => unknown | Promise<unknown>
  openEdit: (connection: Connection) => unknown | Promise<unknown>
  duplicateConnection: (connection: Connection) => unknown | Promise<unknown>
  closeWorkspace: (connection: Connection) => unknown | Promise<unknown>
  resetHostTrust: (connection: Connection) => unknown | Promise<unknown>
  deleteConnection: (connection: Connection) => unknown | Promise<unknown>
}

export function useServerContextMenuController(options: ServerContextMenuControllerOptions) {
  function openServerMenu(event: MouseEvent, connection: Connection) {
    options.selectConnection(connection.id)
    options.serverMenu.value = { x: event.clientX, y: event.clientY, connectionId: connection.id }
  }

  async function selectServerMenu(id: string) {
    const connection = options.menuConnection()
    if (!connection) return
    const intent = resolveServerMenuAction(id, { retryWorkspace: options.retryWorkspace(connection) })
    if (!intent) return

    switch (intent.route) {
    case 'open-terminal':
      await options.openTerminalFromMenu(connection)
      break
    case 'new-terminal':
      await options.newTerminal(connection.id)
      break
    case 'sftp':
      await options.openSftpForConnection(connection)
      break
    case 'monitor':
      await options.openMonitor(connection)
      break
    case 'activate-server':
      await options.activateServer(connection)
      break
    case 'connect-server':
      await options.connectServer(connection)
      break
    case 'reconnect':
      await options.reconnectServer(connection)
      break
    case 'disconnect':
      await options.disconnectServer(connection, false)
      break
    case 'edit':
      await options.openEdit(connection)
      break
    case 'duplicate':
      await options.duplicateConnection(connection)
      break
    case 'close-workspace':
      await options.closeWorkspace(connection)
      break
    case 'trust-host':
    case 'retrust':
      await options.resetHostTrust(connection)
      break
    case 'delete':
      await options.deleteConnection(connection)
      break
    }
  }

  return {
    openServerMenu,
    selectServerMenu,
  }
}
