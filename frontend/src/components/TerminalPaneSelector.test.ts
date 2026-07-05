// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TerminalPaneSelector from './TerminalPaneSelector.vue'

describe('TerminalPaneSelector', () => {
  it('renders connected SSH and Local options and emits the selected assignment', async () => {
    const wrapper = mount(TerminalPaneSelector, {
      props: {
        options: [
          {
            key: 'ssh:ssh-1',
            assignment: { kind: 'ssh', sessionId: 'ssh-1' },
            badge: 'SSH',
            title: 'Debian',
            statusClass: 'online',
            statusText: '已连接',
          },
          {
            key: 'local:local-1',
            assignment: { kind: 'local', sessionId: 'local-1' },
            badge: 'PowerShell',
            title: 'PowerShell',
            statusClass: 'online',
            statusText: '运行中',
          },
        ],
        selectedAssignment: { kind: 'ssh', sessionId: 'ssh-1' },
      },
    })

    expect(wrapper.findAll('button')).toHaveLength(2)
    expect(wrapper.get('[data-assignment-key="ssh:ssh-1"]').classes()).toContain('selected')
    expect(wrapper.text()).toContain('Debian')
    expect(wrapper.text()).toContain('PowerShell')

    await wrapper.get('[data-assignment-key="local:local-1"]').trigger('click')
    expect(wrapper.emitted('select')?.[0][0]).toEqual({ kind: 'local', sessionId: 'local-1' })
  })
})
