// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RemoteFilePropertiesDialog from './RemoteFilePropertiesDialog.vue'

const confirmDialogMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../composables/useAppDialog', () => ({
  confirmDialog: confirmDialogMock,
}))

const fileItem = {
  connectionId: 7,
  contextId: 'server:7',
  generation: 4,
  requestId: 'props-1',
  path: '/home/demo/scripts/install.sh',
  name: 'install.sh',
  type: 'file',
  size: 128,
  modTime: '2026-06-16T00:00:00Z',
  permissions: '-rwxr-xr-x',
  mode: 0o755,
  owner: '1000',
  group: '1001',
  isDir: false,
  isSymlink: false,
  symlinkTarget: '',
  entry: {
    name: 'install.sh',
    path: '/home/demo/scripts/install.sh',
    parentPath: '/home/demo/scripts',
    size: 128,
    isDir: false,
    isSymlink: false,
    permissions: '-rwxr-xr-x',
    owner: '1000',
    group: '1001',
    modTime: '2026-06-16T00:00:00Z',
  },
}

function mountDialog(props = {}) {
  return mount(RemoteFilePropertiesDialog, {
    props: {
      item: fileItem,
      busy: false,
      error: '',
      connectionName: 'demo',
      ...props,
    },
  })
}

describe('RemoteFilePropertiesDialog', () => {
  beforeEach(() => {
    confirmDialogMock.mockReset()
    confirmDialogMock.mockResolvedValue(true)
  })

  it('shows remote item metadata and copyable long path', () => {
    const wrapper = mountDialog()

    expect(wrapper.get('[data-testid="remote-properties-dialog"]').text()).toContain('install.sh')
    expect(wrapper.get('[data-testid="remote-properties-dialog"]').text()).toContain('/home/demo/scripts/install.sh')
    expect(wrapper.get('[data-testid="remote-properties-dialog"]').text()).toContain('-rwxr-xr-x')
    expect(wrapper.get('[data-testid="remote-properties-dialog"]').text()).toContain('0755')
    expect(wrapper.find('[data-testid="remote-properties-copy-path"]').exists()).toBe(true)
  })

  it('keeps octal input and rwx checkboxes synchronized', async () => {
    const wrapper = mountDialog()
    const input = wrapper.get<HTMLInputElement>('[data-testid="properties-mode-input"]')

    await input.setValue('0644')

    expect(wrapper.get<HTMLInputElement>('[data-testid="properties-owner-read"]').element.checked).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-testid="properties-owner-write"]').element.checked).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-testid="properties-owner-execute"]').element.checked).toBe(false)
    expect(wrapper.get<HTMLInputElement>('[data-testid="properties-group-read"]').element.checked).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-testid="properties-other-read"]').element.checked).toBe(true)

    await wrapper.get('[data-testid="properties-other-write"]').setValue(true)

    expect(input.element.value).toBe('0646')
  })

  it('rejects invalid octal input and keeps apply disabled', async () => {
    const wrapper = mountDialog()

    await wrapper.get<HTMLInputElement>('[data-testid="properties-mode-input"]').setValue('0999')

    expect(wrapper.get('[data-testid="properties-mode-error"]').text()).toContain('权限')
    expect(wrapper.get<HTMLButtonElement>('[data-testid="properties-apply"]').element.disabled).toBe(true)
  })

  it('confirms before applying chmod and emits only after confirmation', async () => {
    const wrapper = mountDialog()

    await wrapper.get<HTMLInputElement>('[data-testid="properties-mode-input"]').setValue('0640')
    await wrapper.get('[data-testid="properties-apply"]').trigger('click')

    expect(confirmDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      message: '这会修改远程项目的 Unix 权限，不会修改所有者或用户组。',
    }))
    expect(wrapper.emitted('applyPermissions')?.[0]).toEqual([0o640])
  })

  it('does not emit chmod when confirmation is canceled', async () => {
    confirmDialogMock.mockResolvedValueOnce(false)
    const wrapper = mountDialog()

    await wrapper.get<HTMLInputElement>('[data-testid="properties-mode-input"]').setValue('0640')
    await wrapper.get('[data-testid="properties-apply"]').trigger('click')

    expect(wrapper.emitted('apply-permissions')).toBeUndefined()
  })

  it('keeps symlink permissions read-only', () => {
    const wrapper = mountDialog({
      item: {
        ...fileItem,
        type: 'symlink',
        isSymlink: true,
        symlinkTarget: '',
      },
    })

    expect(wrapper.get('[data-testid="properties-symlink-note"]').text()).toContain('符号链接')
    expect(wrapper.get<HTMLButtonElement>('[data-testid="properties-apply"]').element.disabled).toBe(true)
  })

  it('asks before closing dirty permission edits', async () => {
    const wrapper = mountDialog()

    await wrapper.get<HTMLInputElement>('[data-testid="properties-mode-input"]').setValue('0640')
    await wrapper.get('[data-testid="properties-close"]').trigger('click')

    expect(confirmDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '放弃权限修改',
    }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
