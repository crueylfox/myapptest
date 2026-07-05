// @vitest-environment jsdom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ErrorBoundary from './ErrorBoundary.vue'

const BrokenChild = defineComponent({
  render() {
    throw new Error('render failure')
  },
})

describe('ErrorBoundary', () => {
  it('keeps a visible fallback when a monitor child crashes', async () => {
    const wrapper = mount(ErrorBoundary, {
      slots: { default: () => h(BrokenChild) },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('监控面板暂时不可用')
  })
})
