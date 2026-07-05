// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { choiceDialog, confirmDialog, inputDialog, resolveAppDialog } from '../composables/useAppDialog'
import AppDialogHost from './AppDialogHost.vue'

describe('AppDialogHost', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  afterEach(async () => {
    resolveAppDialog(null)
    await nextTick()
    wrapper?.unmount()
    wrapper = null
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('validates empty and duplicate group names without native prompt', async () => {
    const nativePrompt = vi.spyOn(window, 'prompt')
    wrapper = mount(AppDialogHost, { attachTo: document.body })
    void inputDialog({
      title: '添加分组',
      label: '分组名称',
      validate: (value) => !value ? '请输入分组名称' : value === '生产' ? '分组名称已存在' : '',
    })
    await nextTick()
    const form = document.body.querySelector<HTMLFormElement>('.app-dialog')!
    expect(document.body.querySelector<HTMLButtonElement>('.app-dialog .dialog-close-button')?.textContent).toBe('关闭')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(document.body.textContent).toContain('请输入分组名称')

    const input = document.body.querySelector<HTMLInputElement>('.app-dialog input')!
    input.value = '生产'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(document.body.textContent).toContain('分组名称已存在')
    expect(nativePrompt).not.toHaveBeenCalled()
  })

  it('disables duplicate submission while an input action is pending', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const submit = vi.fn(async () => pending)
    wrapper = mount(AppDialogHost, { attachTo: document.body })
    void inputDialog({
      title: '添加分组',
      validate: () => '',
      submit,
    })
    await nextTick()
    const input = document.body.querySelector<HTMLInputElement>('.app-dialog input')!
    input.value = '生产'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const form = document.body.querySelector<HTMLFormElement>('.app-dialog')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector<HTMLButtonElement>('.app-dialog button[type="submit"]')?.disabled).toBe(true)
    release()
    await pending
    await nextTick()
  })

  it('supports Escape cancellation and a higher danger modal class', async () => {
    wrapper = mount(AppDialogHost, { attachTo: document.body })
    const result = confirmDialog({
      title: '删除服务器',
      danger: true,
    })
    await nextTick()
    expect(document.body.querySelector('.app-dialog-backdrop')?.classList.contains('danger-modal')).toBe(true)
    document.body.querySelector('.app-dialog-backdrop')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await expect(result).resolves.toBe(false)
  })

  it('can hide the redundant header close button for destructive confirmations', async () => {
    wrapper = mount(AppDialogHost, { attachTo: document.body })
    void confirmDialog({
      title: '删除命令历史',
      message: '确定删除这条命令历史吗？',
      confirmText: '删除',
      danger: true,
      hideCloseButton: true,
    })
    await nextTick()

    expect(document.body.querySelector('.app-dialog header .dialog-close-button')).toBeNull()
    expect([...document.body.querySelectorAll<HTMLButtonElement>('.app-dialog footer button')].map((button) => button.textContent)).toEqual(['取消', '删除'])
  })

  it('supports a three-action choice dialog without native confirm', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm')
    wrapper = mount(AppDialogHost, { attachTo: document.body })
    const result = choiceDialog({
      title: '关闭远程编辑器',
      message: '当前文件有未保存内容。',
      confirmText: '保存',
      confirmValue: 'save',
      secondaryText: '不保存',
      secondaryValue: 'discard',
      cancelText: '取消',
    })
    await nextTick()

    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('.app-dialog footer button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['取消', '不保存', '保存'])
    buttons[1].click()

    await expect(result).resolves.toBe('discard')
    expect(nativeConfirm).not.toHaveBeenCalled()
  })
})
