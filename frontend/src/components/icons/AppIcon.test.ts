// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppIcon from './AppIcon.vue'

describe('AppIcon', () => {
  it('renders concept C line icons as decorative by default', () => {
    const wrapper = mount(AppIcon, {
      props: {
        name: 'server-plus',
        size: 24,
      },
    })

    const svg = wrapper.get('svg')
    expect(svg.classes()).toContain('app-icon')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
    expect(svg.attributes('width')).toBe('24')
    expect(svg.attributes('height')).toBe('24')
    expect(svg.attributes('stroke-width')).toBe('1.4')
    expect(svg.attributes('stroke-linecap')).toBe('round')
    expect(svg.attributes('stroke-linejoin')).toBe('round')
  })

  it('uses an accessible label when an icon carries meaning alone', () => {
    const wrapper = mount(AppIcon, {
      props: {
        name: 'refresh',
        decorative: false,
        ariaLabel: 'Refresh',
      },
    })

    const svg = wrapper.get('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('Refresh')
    expect(svg.attributes('aria-hidden')).toBeUndefined()
  })
})
