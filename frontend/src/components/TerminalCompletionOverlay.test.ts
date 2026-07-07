// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandSuggestion } from '../types'
import TerminalCompletionOverlay from './TerminalCompletionOverlay.vue'

function suggestion(index: number): CommandSuggestion {
  return {
    id: `s-${index}`,
    source: 'builtin',
    kind: 'command',
    title: `docker command ${index}`,
    command: `docker command ${index}`,
    description: `Command ${index}`,
    scope: 'builtin',
    serverId: null,
    groupId: null,
    score: 100 - index,
    useCount: 0,
    lastUsedAt: '',
  }
}

describe('TerminalCompletionOverlay', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scrolls the active completion row into view when keyboard selection changes', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const wrapper = mount(TerminalCompletionOverlay, {
      props: {
        open: true,
        suggestions: Array.from({ length: 18 }, (_, index) => suggestion(index)),
        selectedIndex: 0,
        prefix: 'docker',
        busy: false,
        showDescriptions: true,
      },
    })
    await wrapper.vm.$nextTick()
    scrollIntoView.mockClear()

    await wrapper.setProps({ selectedIndex: 14 })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="completion-selected"]').text()).toContain('docker command 14')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
