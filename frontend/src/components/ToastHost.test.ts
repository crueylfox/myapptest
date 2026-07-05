// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToastMessage } from '../types'
import ToastHost from './ToastHost.vue'

function toast(values: Partial<ToastMessage> = {}): ToastMessage {
  return {
    id: 1,
    message: 'Remote file saved',
    type: 'success',
    detail: '',
    code: '',
    ...values,
  }
}

describe('ToastHost', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('teleports toast into the body top layer', () => {
    const wrapper = mount(ToastHost, {
      props: { toast: toast() },
      attachTo: document.body,
    })

    expect(wrapper.find('.toast-host').exists()).toBe(false)
    expect(document.body.querySelector('.toast-layer .toast-host')?.textContent).toContain('Remote file saved')
    wrapper.unmount()
  })

  it('allows manual close while keeping the global layer non-blocking', async () => {
    const wrapper = mount(ToastHost, {
      props: { toast: toast({ detail: 'technical detail', code: 'SFTP_OK' }) },
      attachTo: document.body,
    })

    const layer = document.body.querySelector<HTMLElement>('.toast-layer')!
    const host = document.body.querySelector<HTMLElement>('.toast-host')!
    expect(layer).not.toBeNull()
    expect(host).not.toBeNull()

    document.body.querySelector<HTMLButtonElement>('.toast-detail-toggle')!.click()
    await nextTick()
    expect(document.body.querySelector('.toast-detail')?.textContent).toContain('technical detail')
    document.body.querySelectorAll<HTMLButtonElement>('.toast-summary button')[1].click()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

})
