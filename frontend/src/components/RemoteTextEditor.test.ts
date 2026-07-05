// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SFTPEntry } from '../types'
import RemoteTextEditor from './RemoteTextEditor.vue'

function entry(values: Partial<SFTPEntry> = {}): SFTPEntry {
  return {
    name: 'app.conf',
    path: '/etc/app.conf',
    parentPath: '/etc',
    size: 22,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: '0',
    group: '0',
    modTime: '2026-06-16T00:00:00Z',
    ...values,
  }
}

function mountEditor(values: Partial<SFTPEntry> = {}, content = 'alpha\nbeta\nalpha', extraProps = {}) {
  return mount(RemoteTextEditor, {
    props: {
      entry: entry(values),
      content,
      dirty: false,
      busy: false,
      ...extraProps,
    },
    attachTo: document.body,
  })
}

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

function mockElementRect(element: Element, values: {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: values.left,
      y: values.top,
      ...values,
      toJSON: () => ({}),
    }),
  })
}

async function forceNarrowToolbar(wrapper: VueWrapper, width = 460) {
  const toolbarElement = wrapper.get('.sftp-editor-toolbar-main').element as HTMLElement
  Object.defineProperty(toolbarElement, 'clientWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
  await wrapper.vm.$nextTick()
}

describe('RemoteTextEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.documentElement.dataset.theme = 'dark'
    vi.stubGlobal('MutationObserver', class {
      observe() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    document.createRange = () => ({
      setStart: vi.fn(),
      setEnd: vi.fn(),
      getClientRects: () => [],
      getBoundingClientRect: () => ({
        x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
        toJSON: () => undefined,
      }),
      commonAncestorContainer: document.body,
    }) as unknown as Range
  })

  it('mounts CodeMirror with a visible close button and no textarea fallback', () => {
    const wrapper = mountEditor()

    expect(wrapper.find('.cm-editor').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.get('.sftp-editor-close').classes()).toContain('dialog-close-button')
    expect(wrapper.get('.sftp-editor-close').attributes('title')).toBe('关闭')
    expect(wrapper.get('.sftp-editor-close').text()).toBe('关闭')
  })

  it('opens search with Ctrl+F, counts matches, moves between matches, and closes with Escape', async () => {
    const wrapper = mountEditor()
    await wrapper.get('.cm-content').trigger('keydown', { key: 'f', ctrlKey: true })

    expect(wrapper.find('.sftp-editor-search').exists()).toBe(true)
    await wrapper.get('.sftp-editor-search input[type="search"]').setValue('alpha')
    expect(wrapper.get('.sftp-editor-search').text()).toContain('1 / 2')

    await wrapper.get('[data-testid="editor-search-next"]').trigger('click')
    expect(wrapper.get('.sftp-editor-search').text()).toContain('2 / 2')

    await wrapper.get('.sftp-editor-search input[type="search"]').setValue('missing')
    expect(wrapper.get('.sftp-editor-search').text()).toContain('无匹配')

    await wrapper.get('.sftp-editor-search input[type="search"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.sftp-editor-search').exists()).toBe(true)
    expect(wrapper.get<HTMLInputElement>('[data-testid="editor-search-input"]').element.value).toBe('')
  })

  it('emits save on Ctrl+S and follows the selected language mode', async () => {
    const wrapper = mountEditor({ name: 'script.sh', path: '/tmp/script.sh' })

    await wrapper.get('.cm-content').trigger('keydown', { key: 's', ctrlKey: true })

    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.text()).toContain('Shell')
  })

  it('shows read-write mode in the footer and emits readonly when it is clicked', async () => {
    const wrapper = mountEditor()

    await wrapper.get('[data-testid="editor-mode-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="editor-mode-toggle"]').text()).toBe('读写')
    expect(wrapper.emitted('readonly')).toHaveLength(1)
  })

  it('shows editor toolbar actions directly on wide layouts and hides More', async () => {
    const wrapper = mountEditor()

    const toolbar = wrapper.get('.sftp-editor-toolbar-main')
    expect(toolbar.classes()).toContain('sftp-editor-toolbar-nowrap')
    expect(toolbar.find('[data-testid="editor-search-input"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-search-prev"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-search-next"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-save"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-replace-toggle"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-save-as"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-copy-selection"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-reload"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="editor-more"]').exists()).toBe(false)
    expect(toolbar.findAll('.sftp-editor-toolbar-separator')).toHaveLength(6)
    expect(wrapper.find('.sftp-editor-search .text-button').exists()).toBe(false)
    expect(wrapper.find('.sftp-editor-close').exists()).toBe(true)

  })

  it('moves editor secondary actions into More only when the toolbar is narrow', async () => {
    setViewportSize(240, 150)
    const wrapper = mountEditor()
    const toolbarElement = wrapper.get('.sftp-editor-toolbar-main').element as HTMLElement
    Object.defineProperty(toolbarElement, 'clientWidth', { configurable: true, value: 460 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()

    const toolbar = wrapper.get('.sftp-editor-toolbar-main')
    expect(toolbar.find('[data-testid="editor-replace-toggle"]').exists()).toBe(false)
    expect(toolbar.find('[data-testid="editor-copy-selection"]').exists()).toBe(false)
    expect(toolbar.find('[data-testid="editor-reload"]').exists()).toBe(false)
    expect(toolbar.find('[data-testid="editor-more"]').exists()).toBe(true)

    await wrapper.get('[data-testid="editor-more"]').trigger('click')
    const menu = document.body.querySelector<HTMLElement>('[data-testid="editor-more-menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.parentElement).toBe(document.body)
    expect(menu?.classList.contains('viewport-popover')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-menu')).toBe(true)
    expect(Array.from(menu!.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      '替换',
      '另存为',
      '不换行',
      '复制选中',
      '复制全部',
      '重新载入',
    ])

    menu!.querySelector<HTMLButtonElement>('[data-testid="editor-replace-toggle"]')!.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('.sftp-editor-replace-row').exists()).toBe(true)
    expect(wrapper.find('.sftp-editor-toolbar-main [data-testid="editor-replace-input"]').exists()).toBe(false)
  })

  it('closes editor More with outside click or Escape without closing the editor', async () => {
    const wrapper = mountEditor()
    await forceNarrowToolbar(wrapper)

    await wrapper.get('[data-testid="editor-more"]').trigger('click')
    expect(document.body.querySelector('[data-testid="editor-more-menu"]')).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="editor-more-menu"]')).toBeNull()

    await wrapper.get('[data-testid="editor-more"]').trigger('click')
    expect(document.body.querySelector('[data-testid="editor-more-menu"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('[data-testid="editor-more-menu"]')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('emits saveAs from the editor More menu and closes the menu', async () => {
    const wrapper = mountEditor()
    await forceNarrowToolbar(wrapper)

    await wrapper.get('[data-testid="editor-more"]').trigger('click')
    document.body.querySelector<HTMLButtonElement>('[data-testid="editor-save-as"]')?.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('saveAs')).toHaveLength(1)
    expect(document.body.querySelector('[data-testid="editor-more-menu"]')).toBeNull()
  })

  it('clamps the editor More menu to the viewport with internal scroll sizing', async () => {
    setViewportSize(240, 150)
    const wrapper = mountEditor()
    await forceNarrowToolbar(wrapper)
    mockElementRect(wrapper.get('[data-testid="editor-more"]').element, {
      left: 206,
      top: 12,
      right: 232,
      bottom: 40,
      width: 26,
      height: 28,
    })

    await wrapper.get('[data-testid="editor-more"]').trigger('click')
    const menu = document.body.querySelector<HTMLElement>('[data-testid="editor-more-menu"]')

    expect(menu).not.toBeNull()
    expect(menu?.classList.contains('viewport-popover-scroll')).toBe(true)
    expect(Number.parseInt(menu?.style.left ?? '', 10)).toBeGreaterThanOrEqual(12)
    expect(Number.parseInt(menu?.style.maxHeight ?? '', 10)).toBeLessThanOrEqual(102)
    expect(menu?.style.right).toBe('')
    wrapper.unmount()
  })

  it('uses plain text for unknown extensions and remains readable in light theme', () => {
    document.documentElement.dataset.theme = 'light'
    const wrapper = mountEditor({ name: 'unknown.zzz', path: '/tmp/unknown.zzz' })

    expect(wrapper.text()).toContain('Plain Text')
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
  })

  it('shows staged save errors with expandable technical details', () => {
    const wrapper = mountEditor({}, 'alpha', {
      saveError: {
        code: 'SFTP_SAVE_PERMISSION_DENIED',
        stage: 'create_temp_file',
        userMessage: '保存失败：没有写入权限。',
        technicalMessage: 'permission denied',
        remotePath: '/etc/app.conf',
        operation: 'sftp.write_text',
        retryable: false,
      },
    })

    expect(wrapper.get('.sftp-editor-error').text()).toContain('保存失败：没有写入权限。')
    expect(wrapper.get('.sftp-editor-error').text()).toContain('create_temp_file')
    expect(wrapper.get('.sftp-editor-error').text()).toContain('SFTP_SAVE_PERMISSION_DENIED')
  })

  it('injects the ServerPilot CodeMirror theme and search match styles', () => {
    mountEditor({ name: 'script.sh', path: '/tmp/script.sh' })
    const styleText = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n')

    expect(styleText).toContain('#f8fbff')
    expect(styleText).toContain('#c084fc')
    expect(styleText).toContain('#34d399')
    expect(styleText).toContain('#94a3b8')
    expect(styleText).toContain('#67e8f9')
    expect(styleText).toContain('cm-searchMatch')
    expect(styleText).toContain('#f59e0bcc')
  })

  it('styles the real CodeMirror selection layer more strongly than search highlights', () => {
    mountEditor({ name: 'script.sh', path: '/tmp/script.sh' })
    const styleText = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n')

    expect(styleText).toContain('.cm-selectionLayer .cm-selectionBackground')
    expect(styleText).toContain('.cm-editor .cm-content ::selection')
    expect(styleText).toContain('.cm-editor.cm-focused .cm-selectionBackground')
    expect(styleText).toContain('#2563ebcc')
    expect(styleText).toContain('#3b82f6e6')
    expect(styleText.indexOf('.cm-selectionLayer .cm-selectionBackground')).toBeLessThan(styleText.indexOf('.cm-searchMatch'))
  })

  it('shows the read-write toolbar immediately without requiring a second mode click', () => {
    const wrapper = mountEditor()

    expect(wrapper.find('.sftp-editor-search').exists()).toBe(true)
    expect(wrapper.find('[data-testid="editor-search-input"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="editor-save"]').text()).toBe('保存')
    expect(wrapper.find('[data-testid="editor-save-as"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="editor-more"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="editor-mode-toggle"]').text()).toBe('读写')
  })

  it('opens replace with Ctrl+H and replaces the current match without losing editor focus', async () => {
    const wrapper = mountEditor({}, 'alpha beta alpha')

    await wrapper.get('.cm-content').trigger('keydown', { key: 'h', ctrlKey: true })
    expect(wrapper.find('.sftp-editor-replace').exists()).toBe(true)

    await wrapper.get('[data-testid="editor-search-input"]').setValue('alpha')
    await wrapper.get('[data-testid="editor-replace-input"]').setValue('gamma')
    await wrapper.get('[data-testid="editor-replace-one"]').trigger('click')

    expect(wrapper.emitted('update:content')?.at(-1)).toEqual(['gamma beta alpha'])
    expect(wrapper.find('.cm-focused').exists()).toBe(true)
  })

  it('replaces all matches, shows the replacement count, and leaves Ctrl+S on the save path', async () => {
    const wrapper = mountEditor({}, 'alpha beta alpha')

    await wrapper.get('.cm-content').trigger('keydown', { key: 'h', ctrlKey: true })
    await wrapper.get('[data-testid="editor-search-input"]').setValue('alpha')
    await wrapper.get('[data-testid="editor-replace-input"]').setValue('gamma')
    await wrapper.get('[data-testid="editor-replace-all"]').trigger('click')

    expect(wrapper.emitted('update:content')?.at(-1)).toEqual(['gamma beta gamma'])
    expect(wrapper.get('.sftp-editor-replace-row').text()).toContain('已替换 2 处')

    await wrapper.get('.cm-content').trigger('keydown', { key: 's', ctrlKey: true })
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('deletes and overwrites the selected range through CodeMirror editing commands', async () => {
    const wrapper = mountEditor({}, 'alpha beta')
    await wrapper.get('.cm-content').trigger('keydown', { key: 'h', ctrlKey: true })
    await wrapper.get('[data-testid="editor-search-input"]').setValue('alpha')
    await wrapper.get('[data-testid="editor-replace-input"]').setValue('omega')
    await wrapper.get('[data-testid="editor-replace-one"]').trigger('click')

    await wrapper.get('[data-testid="editor-search-input"]').setValue('omega')
    await wrapper.get('[data-testid="editor-replace-input"]').setValue('')
    await wrapper.get('[data-testid="editor-replace-one"]').trigger('click')

    expect(wrapper.emitted('update:content')?.at(-1)).toEqual([' beta'])
  })

  it('marks editable UNKNOWN selections with a visible in-buffer selection decoration', async () => {
    const wrapper = mountEditor({ name: 'status.conf', path: '/tmp/status.conf' }, [
      'OS_VERSION_STATUS="UNKNOWN"',
      'HARDWARE_ARCH_SUPPORT="UNKNOWN"',
      'STORAGE_SUPPORT="UNKNOWN"',
    ].join('\n'))

    expect(wrapper.find('.sp-visible-selection').exists()).toBe(false)

    await wrapper.get('[data-testid="editor-search-input"]').setValue('UNKNOWN')

    const selection = wrapper.get('.sp-visible-selection')
    expect(selection.text()).toBe('UNKNOWN')
    expect(wrapper.find('.sftp-codemirror-host .sp-visible-selection').exists()).toBe(true)
    expect(wrapper.find('.sp-visible-selection-overlay').exists()).toBe(false)
  })

  it('keeps the visible selection decoration while replacing selected text', async () => {
    const wrapper = mountEditor({}, 'alpha beta')

    await wrapper.get('[data-testid="editor-search-input"]').setValue('alpha')
    expect(wrapper.get('.sp-visible-selection').text()).toBe('alpha')

    await wrapper.get('.cm-content').trigger('keydown', { key: 'Backspace' })

    expect(wrapper.emitted('update:content')?.at(-1)).toEqual([' beta'])
  })

  it('reconfigures the editor theme without losing edited content or search state', async () => {
    const wrapper = mountEditor({}, 'alpha\nbeta')
    await wrapper.get('.cm-content').trigger('keydown', { key: 'f', ctrlKey: true })
    await wrapper.get('.sftp-editor-search input[type="search"]').setValue('alpha')

    document.documentElement.dataset.theme = 'light'
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.sftp-editor-search input[type="search"]').element).toHaveProperty('value', 'alpha')
    expect(wrapper.get('.sftp-editor-search').text()).toContain('1 / 1')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('reload')).toBeUndefined()
  })
})
