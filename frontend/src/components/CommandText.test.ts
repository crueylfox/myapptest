// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CommandText from './CommandText.vue'

describe('CommandText', () => {
  it('renders highlighted spans with escaped text instead of raw HTML', () => {
    const wrapper = mount(CommandText, {
      props: {
        command: 'cat <img src=x onerror=alert(1)> && rm -rf /tmp/demo',
      },
    })

    expect(wrapper.findAll('.command-token').length).toBeGreaterThan(1)
    expect(wrapper.find('.command-token-danger').exists()).toBe(true)
    expect(wrapper.html()).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
