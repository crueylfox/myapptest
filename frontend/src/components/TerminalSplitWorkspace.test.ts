// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TerminalSplitWorkspace from './TerminalSplitWorkspace.vue'

describe('TerminalSplitWorkspace', () => {
  it('renders visible panes, layout class, grid ratios, and splitters for quad mode', async () => {
    const wrapper = mount(TerminalSplitWorkspace, {
      props: {
        splitMode: 'quad',
        renderedPaneIds: ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
        maximizedPaneId: null,
        columnRatio: 0.4,
        rowRatio: 0.6,
        showColumnSplitter: true,
        showRowSplitter: true,
      },
      slots: {
        pane: '<template #pane="{ paneId, paneStyle }"><section class="pane-slot" :data-pane-id="paneId" :style="paneStyle">{{ paneId }}</section></template>',
      },
    })

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('split-quad')
    expect(wrapper.get('.terminal-split-workspace').attributes('style')).toContain('--split-column-ratio: 0.4')
    expect(wrapper.findAll('.pane-slot')).toHaveLength(4)
    expect(wrapper.findAll('.terminal-pane-splitter')).toHaveLength(2)

    await wrapper.get('.terminal-pane-splitter.column').trigger('pointerdown')
    await wrapper.get('.terminal-pane-splitter.row').trigger('pointerdown')

    expect(wrapper.emitted('splitterDragStart')?.[0][0]).toBe('column')
    expect(wrapper.emitted('splitterDragStart')?.[1][0]).toBe('row')
  })

  it('renders only the maximized pane without splitters', () => {
    const wrapper = mount(TerminalSplitWorkspace, {
      props: {
        splitMode: 'vertical',
        renderedPaneIds: ['pane-2'],
        maximizedPaneId: 'pane-2',
        columnRatio: 0.5,
        rowRatio: 0.5,
        showColumnSplitter: true,
        showRowSplitter: false,
      },
      slots: {
        pane: '<template #pane="{ paneId, paneStyle }"><section class="pane-slot" :data-pane-id="paneId" :style="paneStyle">{{ paneId }}</section></template>',
      },
    })

    expect(wrapper.get('.terminal-split-workspace').classes()).toContain('pane-maximized')
    expect(wrapper.findAll('.pane-slot')).toHaveLength(1)
    expect(wrapper.get('.pane-slot').attributes('data-pane-id')).toBe('pane-2')
    expect(wrapper.find('.terminal-pane-splitter').exists()).toBe(false)
  })
})
