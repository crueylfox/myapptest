import { describe, expect, it } from 'vitest'
import {
  buildToolPanelActions,
  dashboardToolToAction,
  isToolPanelActionId,
  type ToolPanelActionId,
} from './appToolPanelModel'

describe('appToolPanelModel', () => {
  it('defines stable top-level tool actions without executing them', () => {
    const actions = buildToolPanelActions({
      hasActiveServer: true,
      hasActiveNetworkServer: true,
      localTerminalEnabled: true,
    })
    const ids = actions.map((action) => action.id)

    expect(ids).toEqual([
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
    ])
    expect(actions.find((action) => action.id === 'settings')).toMatchObject({
      targetView: 'settings',
      disabled: false,
    })
    expect(actions.find((action) => action.id === 'network')).toMatchObject({
      targetDialog: 'network',
      disabled: false,
    })
  })

  it('marks active-server tools disabled with a stable tooltip when no server is available', () => {
    const actions = buildToolPanelActions({
      hasActiveServer: false,
      hasActiveNetworkServer: false,
      localTerminalEnabled: true,
    })

    for (const id of ['processes', 'services', 'network'] satisfies ToolPanelActionId[]) {
      expect(actions.find((action) => action.id === id)).toMatchObject({
        disabled: true,
        tooltip: '请先连接并选择一个服务器',
      })
    }
    expect(actions.find((action) => action.id === 'docker')?.disabled).toBe(false)
  })

  it('normalizes dashboard tool ids to tool action ids', () => {
    expect(dashboardToolToAction('tunnels')).toBe('tunnels')
    expect(dashboardToolToAction('docker')).toBe('docker')
    expect(dashboardToolToAction('processes')).toBe('processes')
    expect(dashboardToolToAction('network')).toBe('network')
  })

  it('guards unknown tool action ids', () => {
    expect(isToolPanelActionId('keyvault')).toBe(true)
    expect(isToolPanelActionId('unknown')).toBe(false)
  })
})
