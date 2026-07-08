// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TerminalPane from './TerminalPane.vue'

function mountPane(options: {
  kind?: 'ssh' | 'local' | null
  active?: boolean
  maximized?: boolean
  dropTarget?: boolean
} = {}) {
  return mount(TerminalPane, {
    props: {
      paneId: 'pane-1',
      active: options.active ?? false,
      maximized: options.maximized ?? false,
      dropTarget: options.dropTarget ?? false,
      kind: options.kind ?? null,
      title: options.kind === 'local' ? 'PowerShell' : 'server #1',
      statusClass: 'online',
      statusText: '已连接',
      sessionId: options.kind === 'ssh' ? 'term-1' : '',
      localSessionId: options.kind === 'local' ? 'local-1' : '',
      hasActivity: false,
      activityLabel: '',
      activityTitle: '',
      menuOpen: false,
      menuMode: 'main',
      occupiedPaneOptions: [],
      emptyPaneOptions: [],
    },
    slots: {
      ssh: '<div class="ssh-slot">ssh terminal</div>',
      local: '<div class="local-slot">local terminal</div>',
      selector: '<div class="selector-slot">selector</div>',
    },
  })
}

describe('TerminalPane', () => {
  it('renders SSH assignment in the pane body with active/drop classes and session metadata', async () => {
    const wrapper = mountPane({ kind: 'ssh', active: true, dropTarget: true })

    expect(wrapper.get('.terminal-pane').classes()).toEqual(expect.arrayContaining(['active', 'drop-target']))
    expect(wrapper.get('.terminal-pane-body').classes()).toContain('terminal-pane-assigned')
    expect(wrapper.get('.terminal-pane-body').attributes('data-session-id')).toBe('term-1')
    expect(wrapper.get('.ssh-slot').text()).toBe('ssh terminal')

    await wrapper.get('.terminal-pane').trigger('click')
    expect(wrapper.emitted('paneClick')).toEqual([['pane-1']])
  })

  it('renders Local assignment, empty state, and forwards empty actions', async () => {
    const local = mountPane({ kind: 'local' })
    expect(local.get('.terminal-pane-body').attributes('data-local-session-id')).toBe('local-1')
    expect(local.get('.local-slot').text()).toBe('local terminal')

    const empty = mountPane({ kind: null })
    expect(empty.get('.terminal-pane-empty-message').text()).toBe('将标签拖到这里')
    await empty.get('.terminal-pane-add-server-trigger').trigger('click')
    await empty.get('.terminal-pane-connect-saved-trigger').trigger('click')

    expect(empty.emitted('addServer')).toEqual([['pane-1']])
    expect(empty.emitted('connectSaved')).toEqual([['pane-1']])
    expect(empty.emitted('selectConnected')).toBeUndefined()
  })

  it('marks empty pane bodies as full-height centered content instead of the top grid row', () => {
    const empty = mountPane({ kind: null, active: true })
    const body = empty.get('.terminal-pane-body')

    expect(empty.get('.terminal-pane').classes()).toContain('active')
    expect(body.classes()).toContain('terminal-pane-empty-body')
    expect(body.classes()).not.toContain('terminal-pane-assigned')
    expect(empty.find('.terminal-pane-header').exists()).toBe(false)
    expect(empty.get('.terminal-pane-empty-message').text()).toBe('将标签拖到这里')
    expect(empty.findAll('.terminal-pane-empty-actions button').map((button) => button.text())).toEqual([
      '新建服务器',
      '连接已保存',
    ])
  })
})
