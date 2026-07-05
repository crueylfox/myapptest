import { describe, expect, it } from 'vitest'
import { buildServerContextMenuItems, resolveServerMenuAction } from './serverActionModel'

describe('serverActionModel', () => {
  it('builds the server row context menu labels, disabled states, and danger state without executing actions', () => {
    const items = buildServerContextMenuItems({
      connecting: false,
      active: true,
      retryWorkspace: false,
      hasWorkspace: true,
      hasHostKeyFingerprint: true,
    })

    expect(items.map((item) => item.id)).toEqual([
      'open-terminal',
      'new-terminal',
      'sftp',
      'monitor',
      'separator-1',
      'connect',
      'reconnect',
      'disconnect',
      'separator-2',
      'edit',
      'duplicate',
      'close-workspace',
      'trust-host',
      'retrust',
      'delete',
    ])
    expect(items.find((item) => item.id === 'connect')?.disabled).toBe(true)
    expect(items.find((item) => item.id === 'reconnect')?.disabled).toBe(false)
    expect(items.find((item) => item.id === 'delete')?.danger).toBe(true)
    expect(items.find((item) => item.id === 'trust-host')?.disabled).toBe(true)
  })

  it('marks connect as a retry label when the workspace is failed or disconnected', () => {
    const items = buildServerContextMenuItems({
      connecting: false,
      active: false,
      retryWorkspace: true,
      hasWorkspace: false,
      hasHostKeyFingerprint: false,
    })

    expect(items.find((item) => item.id === 'connect')).toMatchObject({
      label: '重新连接',
      disabled: false,
    })
  })

  it('normalizes the connect action intent without deciding backend behavior in App.vue', () => {
    expect(resolveServerMenuAction('connect', { retryWorkspace: true })).toEqual({
      id: 'connect',
      route: 'activate-server',
    })
    expect(resolveServerMenuAction('connect', { retryWorkspace: false })).toEqual({
      id: 'connect',
      route: 'connect-server',
    })
    expect(resolveServerMenuAction('delete', { retryWorkspace: false })).toEqual({
      id: 'delete',
      route: 'delete',
    })
    expect(resolveServerMenuAction('separator-1', { retryWorkspace: false })).toBeNull()
  })
})
