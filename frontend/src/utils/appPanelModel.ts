export type AppPanelView = 'terminals' | 'monitor' | 'logs' | 'settings'

export function isTerminalView(value: unknown): value is 'terminals' {
  return value === 'terminals'
}

export function isMonitorView(value: unknown): value is 'monitor' {
  return value === 'monitor'
}

export function isAppLogsView(value: unknown): value is 'logs' {
  return value === 'logs'
}

export function isSettingsView(value: unknown): value is 'settings' {
  return value === 'settings'
}

export function normalizeAppPanelView(value: unknown): AppPanelView {
  if (isTerminalView(value) || isMonitorView(value) || isAppLogsView(value) || isSettingsView(value)) {
    return value
  }
  return 'terminals'
}

export function getPanelLabel(view: AppPanelView) {
  return {
    terminals: '终端',
    monitor: '监控',
    logs: '应用日志',
    settings: '设置',
  }[view]
}

export function getPanelTestId(view: AppPanelView) {
  return `app-panel-${view}`
}
