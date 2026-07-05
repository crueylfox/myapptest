import { describe, expect, it } from 'vitest'
import {
  getPanelLabel,
  getPanelTestId,
  isAppLogsView,
  isMonitorView,
  isSettingsView,
  isTerminalView,
  normalizeAppPanelView,
  type AppPanelView,
} from './appPanelModel'

describe('appPanelModel', () => {
  it('recognizes the top-level application panel views', () => {
    expect(isTerminalView('terminals')).toBe(true)
    expect(isMonitorView('monitor')).toBe(true)
    expect(isAppLogsView('logs')).toBe(true)
    expect(isSettingsView('settings')).toBe(true)
  })

  it('normalizes unknown panel names to terminals without throwing', () => {
    expect(normalizeAppPanelView('unknown')).toBe('terminals')
    expect(normalizeAppPanelView(null)).toBe('terminals')
  })

  it('returns stable labels and test ids for structure guards', () => {
    const views: AppPanelView[] = ['terminals', 'monitor', 'logs', 'settings']
    expect(views.map((view) => getPanelTestId(view))).toEqual([
      'app-panel-terminals',
      'app-panel-monitor',
      'app-panel-logs',
      'app-panel-settings',
    ])
    expect(getPanelLabel('logs')).toBe('应用日志')
  })
})
