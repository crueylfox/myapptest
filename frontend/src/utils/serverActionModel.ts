import type { ContextMenuItem } from '../types'

export type ServerMenuActionRoute =
  | 'open-terminal'
  | 'new-terminal'
  | 'sftp'
  | 'monitor'
  | 'activate-server'
  | 'connect-server'
  | 'reconnect'
  | 'disconnect'
  | 'edit'
  | 'duplicate'
  | 'close-workspace'
  | 'trust-host'
  | 'retrust'
  | 'delete'

export interface ServerContextMenuState {
  connecting: boolean
  active: boolean
  retryWorkspace: boolean
  hasWorkspace: boolean
  hasHostKeyFingerprint: boolean
}

export interface ServerMenuActionIntent {
  id: string
  route: ServerMenuActionRoute
}

export function buildServerContextMenuItems(state: ServerContextMenuState): ContextMenuItem[] {
  return [
    { id: 'open-terminal', label: '打开终端', disabled: state.connecting },
    { id: 'new-terminal', label: '新建终端', disabled: state.connecting },
    { id: 'sftp', label: '打开 SFTP' },
    { id: 'monitor', label: '查看监控' },
    { id: 'separator-1', label: '', separator: true },
    {
      id: 'connect',
      label: state.connecting ? '正在连接' : state.retryWorkspace ? '重新连接' : '连接',
      disabled: state.active || state.connecting,
    },
    { id: 'reconnect', label: '重新连接', disabled: !state.active || state.connecting },
    { id: 'disconnect', label: '断开', disabled: !state.active },
    { id: 'separator-2', label: '', separator: true },
    { id: 'edit', label: '编辑' },
    { id: 'duplicate', label: '复制服务器' },
    { id: 'close-workspace', label: '断开此服务器', disabled: !state.hasWorkspace },
    { id: 'trust-host', label: '信任当前主机指纹', disabled: state.hasHostKeyFingerprint },
    { id: 'retrust', label: '重新信任主机', disabled: !state.hasHostKeyFingerprint },
    { id: 'delete', label: '删除服务器', danger: true },
  ]
}

export function resolveServerMenuAction(
  id: string,
  context: Pick<ServerContextMenuState, 'retryWorkspace'>,
): ServerMenuActionIntent | null {
  switch (id) {
  case 'open-terminal':
  case 'new-terminal':
  case 'sftp':
  case 'monitor':
  case 'reconnect':
  case 'disconnect':
  case 'edit':
  case 'duplicate':
  case 'close-workspace':
  case 'trust-host':
  case 'retrust':
  case 'delete':
    return { id, route: id }
  case 'connect':
    return { id, route: context.retryWorkspace ? 'activate-server' : 'connect-server' }
  default:
    return null
  }
}
