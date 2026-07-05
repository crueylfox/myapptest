// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthDialog from './AuthDialog.vue'
import type { Connection } from '../types'

const connection: Connection = {
  id: 1,
  groupId: null,
  name: 'server-1',
  host: '192.0.2.1',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: 'SHA256:test',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

describe('AuthDialog', () => {
  it('defaults remember password on when credentials are required', async () => {
    const wrapper = mount(AuthDialog, {
      props: {
        open: true,
        connection,
        mode: 'terminal-reconnect',
        issue: '需要输入认证信息',
      },
    })

    expect(wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)
    await wrapper.get('form').trigger('submit')
    const auth = wrapper.emitted('submit')?.[0]?.[0] as { rememberSecret: boolean }
    expect(auth.rememberSecret).toBe(true)
  })

  it('defaults remember private-key passphrase on when a passphrase prompt is shown', () => {
    const wrapper = mount(AuthDialog, {
      props: {
        open: true,
        connection: { ...connection, authType: 'private_key' },
        mode: 'terminal-reconnect',
        issue: '需要输入认证信息',
      },
    })

    expect(wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('uses a neutral authentication title for terminal reconnect credential prompts', () => {
    const wrapper = mount(AuthDialog, {
      props: {
        open: true,
        connection,
        mode: 'terminal-reconnect',
        issue: 'saved credential rejected',
      },
    })

    expect(wrapper.find('h2').text()).toBe('输入认证信息')
    expect(wrapper.text()).not.toContain('打开 SSH 终端')
  })
})
