// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalEmptyPane from './TerminalEmptyPane.vue'

describe('TerminalEmptyPane', () => {
  let resizeCallback: ResizeObserverCallback | null = null

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resizeCallback = null
  })

  it('renders split empty pane drop prompt and the three pane actions only', async () => {
    const wrapper = mount(TerminalEmptyPane, {
      props: { showDropMessage: true },
    })

    expect(wrapper.get('.terminal-pane-empty-message').text()).toBe('将标签拖到这里')
    expect(wrapper.get('.terminal-pane-empty-actions').classes()).toContain('centered')
    expect(wrapper.get('.terminal-pane-empty-actions').classes()).not.toContain('inline')
    expect(wrapper.get('.terminal-pane-empty-actions').classes()).toContain('concept-c-action-stack')
    expect(wrapper.get('.terminal-pane-empty-actions').classes()).toContain('terminal-empty-actions--vertical')
    expect(wrapper.text()).toContain('新建服务器')
    expect(wrapper.text()).toContain('连接已保存')
    expect(wrapper.text()).toContain('选择已连接')
    expect(wrapper.text()).not.toContain('CMD')
    expect(wrapper.text()).not.toContain('PowerShell')
    expect(wrapper.findAll('.terminal-pane-empty-actions .app-icon')).toHaveLength(3)
    const separators = wrapper.findAll('.terminal-pane-empty-actions .action-separator')
    expect(separators).toHaveLength(2)
    for (const separator of separators) {
      expect(separator.attributes('aria-hidden')).toBe('true')
      expect(separator.classes()).toContain('action-separator--horizontal-stack')
      expect(separator.classes()).not.toContain('action-separator--vertical-stack')
    }
    expect(wrapper.find('.terminal-pane-empty-actions .action-separator:first-child').exists()).toBe(false)
    expect(wrapper.find('.terminal-pane-empty-actions .action-separator:last-child').exists()).toBe(false)
    for (const action of wrapper.findAll('.terminal-pane-empty-actions button')) {
      expect(action.classes()).not.toContain('primary')
      expect(action.classes()).not.toContain('secondary')
      expect(action.classes()).not.toContain('danger')
    }
    expect(wrapper.findAll('.terminal-pane-empty-actions button').map((button) => button.text())).toEqual([
      '新建服务器',
      '连接已保存',
      '选择已连接',
    ])

    await wrapper.get('.terminal-pane-add-server-trigger').trigger('click')
    await wrapper.get('.terminal-pane-connect-saved-trigger').trigger('click')
    await wrapper.get('.terminal-pane-select-trigger').trigger('click')

    expect(wrapper.emitted('addServer')).toHaveLength(1)
    expect(wrapper.emitted('connectSaved')).toHaveLength(1)
    expect(wrapper.emitted('selectConnected')).toHaveLength(1)
  })

  it('renders single empty state without the split-only drop prompt', () => {
    const wrapper = mount(TerminalEmptyPane, {
      props: { showDropMessage: false },
    })

    expect(wrapper.find('.terminal-pane-empty-message').exists()).toBe(false)
    expect(wrapper.text()).toContain('新建服务器')
    expect(wrapper.text()).toContain('连接已保存')
    expect(wrapper.text()).toContain('选择已连接')
  })

  it('switches to horizontal actions with vertical separators when pane height is tight', async () => {
    const wrapper = mount(TerminalEmptyPane, {
      props: { showDropMessage: true },
    })
    const root = wrapper.get('.terminal-pane-empty').element as HTMLElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 150,
      width: 420,
      height: 150,
      toJSON: () => ({}),
    })

    resizeCallback?.([], {} as ResizeObserver)
    await wrapper.vm.$nextTick()

    const actions = wrapper.get('.terminal-pane-empty-actions')
    expect(actions.classes()).toContain('terminal-empty-actions--horizontal')
    expect(actions.classes()).not.toContain('terminal-empty-actions--vertical')
    expect(actions.findAll('button')).toHaveLength(3)
    const separators = actions.findAll('.action-separator')
    expect(separators).toHaveLength(2)
    for (const separator of separators) {
      expect(separator.classes()).toContain('action-separator--vertical-stack')
      expect(separator.classes()).not.toContain('action-separator--horizontal-stack')
    }
  })
})
