import type { AppPanelView } from './appPanelModel'

export type ToolPanelActionId =
  | 'settings'
  | 'backup'
  | 'keyvault'
  | 'logs'
  | 'monitor'
  | 'tunnels'
  | 'docker'
  | 'processes'
  | 'services'
  | 'network'

export type DashboardToolKind = 'tunnels' | 'docker' | 'processes' | 'network'

export interface ToolPanelAction {
  id: ToolPanelActionId
  label: string
  targetView?: AppPanelView
  targetDialog?: DashboardToolKind
  disabled: boolean
  tooltip: string
}

export interface ToolPanelActionContext {
  hasActiveServer: boolean
  hasActiveNetworkServer: boolean
  localTerminalEnabled: boolean
}

const activeServerTooltip = '请先连接并选择一个服务器'
const actionIds: ToolPanelActionId[] = [
  'settings',
  'backup',
  'keyvault',
  'logs',
  'monitor',
  'tunnels',
  'docker',
  'processes',
  'services',
  'network',
]

export function isToolPanelActionId(value: unknown): value is ToolPanelActionId {
  return actionIds.includes(value as ToolPanelActionId)
}

export function dashboardToolToAction(tool: DashboardToolKind): ToolPanelActionId {
  return tool
}

export function buildToolPanelActions(context: ToolPanelActionContext): ToolPanelAction[] {
  const networkDisabled = !context.hasActiveNetworkServer
  const activeServerDisabled = !context.hasActiveServer
  return [
    {
      id: 'settings',
      label: '设置',
      targetView: 'settings',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'backup',
      label: '备份 / 恢复',
      targetView: 'settings',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'keyvault',
      label: 'Key Vault',
      targetView: 'settings',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'logs',
      label: '应用日志',
      targetView: 'logs',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'monitor',
      label: '监控',
      targetView: 'monitor',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'tunnels',
      label: '端口转发',
      targetDialog: 'tunnels',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'docker',
      label: 'Docker',
      targetDialog: 'docker',
      disabled: false,
      tooltip: '',
    },
    {
      id: 'processes',
      label: '进程',
      targetDialog: 'processes',
      disabled: activeServerDisabled,
      tooltip: activeServerDisabled ? activeServerTooltip : '',
    },
    {
      id: 'services',
      label: '服务',
      disabled: networkDisabled,
      tooltip: networkDisabled ? activeServerTooltip : '',
    },
    {
      id: 'network',
      label: '网络',
      targetDialog: 'network',
      disabled: networkDisabled,
      tooltip: networkDisabled ? activeServerTooltip : '',
    },
  ]
}
