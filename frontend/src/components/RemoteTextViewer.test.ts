// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SFTPReadTextFileResult } from '../types'
import RemoteTextViewer from './RemoteTextViewer.vue'

function file(values: Partial<SFTPReadTextFileResult> = {}): SFTPReadTextFileResult {
  return {
    connectionId: 7,
    contextId: 'server:7',
    generation: 2,
    requestId: 'open-1',
    entry: {
      name: 'unknown.zzz',
      path: '/etc/unknown.zzz',
      parentPath: '/etc',
      size: 32,
      isDir: false,
      isSymlink: false,
      permissions: '-rw-r--r--',
      owner: '0',
      group: '0',
      modTime: '',
    },
    content: 'INFO boot\nERROR failed\nINFO recovered',
    encoding: 'utf-8',
    truncated: false,
    detectedLanguage: 'generic',
    textKind: 'plaintext',
    ...values,
  }
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

async function forceNarrowToolbar(wrapper: VueWrapper, width = 420) {
  const toolbarElement = wrapper.get('.sftp-editor-toolbar-main').element as HTMLElement
  Object.defineProperty(toolbarElement, 'clientWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
  await wrapper.vm.$nextTick()
}

describe('RemoteTextViewer', () => {
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

  it('opens a read-only CodeMirror viewer with metadata and a bordered close button', () => {
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file({ truncated: true }), busy: false },
      attachTo: document.body,
    })

    expect(wrapper.find('.cm-editor').exists()).toBe(true)
    expect(wrapper.text()).toContain('/etc/unknown.zzz')
    expect(wrapper.text()).toContain('utf-8')
    expect(wrapper.text()).toContain('generic')
    expect(wrapper.text()).toContain('truncated')
    expect(wrapper.get('.sftp-viewer-close').text()).toBe('关闭')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('button.primary').exists()).toBe(false)
    expect(wrapper.get('[data-testid="viewer-mode-toggle"]').text()).toBe('只读')
  })

  it('emits unlock from the readonly footer state button', async () => {
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false, unlockDisabled: false },
      attachTo: document.body,
    })

    await wrapper.get('[data-testid="viewer-mode-toggle"]').trigger('click')

    expect(wrapper.emitted('unlock')).toHaveLength(1)
  })

  it('disables unlock for partial or unsupported previews', async () => {
    const wrapper = mount(RemoteTextViewer, {
      props: {
        file: file({ truncated: true }),
        busy: false,
        unlockDisabled: true,
        unlockReason: '当前仅预览部分内容，不能直接编辑保存。',
      },
      attachTo: document.body,
    })

    const button = wrapper.get('[data-testid="viewer-mode-toggle"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe('当前仅预览部分内容，不能直接编辑保存。')
    await button.trigger('click')
    expect(wrapper.emitted('unlock')).toBeUndefined()
  })

  it('shows readonly toolbar actions directly on wide layouts and hides More', async () => {
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })

    const toolbar = wrapper.get('.sftp-editor-toolbar-main')
    expect(toolbar.classes()).toContain('sftp-editor-toolbar-nowrap')
    expect(toolbar.find('[data-testid="viewer-search"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-search-prev"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-search-next"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-replace-disabled"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-copy-selection"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-copy-all"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-reload"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="viewer-more"]').exists()).toBe(false)
    expect(toolbar.findAll('.sftp-editor-toolbar-separator')).toHaveLength(5)
    expect(wrapper.get('.sftp-viewer-close').text()).toBe('关闭')

  })

  it('moves readonly secondary actions into More only when the toolbar is narrow', async () => {
    setViewportSize(240, 150)
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })
    const toolbarElement = wrapper.get('.sftp-editor-toolbar-main').element as HTMLElement
    Object.defineProperty(toolbarElement, 'clientWidth', { configurable: true, value: 420 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()

    const toolbar = wrapper.get('.sftp-editor-toolbar-main')
    expect(toolbar.find('[data-testid="viewer-copy-selection"]').exists()).toBe(false)
    expect(toolbar.find('[data-testid="viewer-copy-all"]').exists()).toBe(false)
    expect(toolbar.find('[data-testid="viewer-reload"]').exists()).toBe(false)
    expect(toolbar.find('[data-testid="viewer-more"]').exists()).toBe(true)

    await wrapper.get('[data-testid="viewer-more"]').trigger('click')
    const menu = document.body.querySelector<HTMLElement>('[data-testid="viewer-more-menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.parentElement).toBe(document.body)
    expect(menu?.classList.contains('viewport-popover')).toBe(true)
    expect(menu?.classList.contains('viewport-popover-menu')).toBe(true)
    expect(Array.from(menu!.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      '替换',
      '不换行',
      '复制选中',
      '复制全部',
      '重新加载',
    ])
    expect(menu!.querySelector<HTMLButtonElement>('[data-testid="viewer-replace-disabled"]')?.disabled).toBe(true)

    menu!.querySelector<HTMLButtonElement>('[data-testid="viewer-reload"]')!.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('reload')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('searches, copies, reloads, and closes without exposing a save action', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })

    await wrapper.get('[data-testid="viewer-search"]').setValue('INFO')
    expect(wrapper.text()).toContain('1 / 2')
    await wrapper.get('[data-testid="viewer-copy-all"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="viewer-reload"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.get('.sftp-viewer-close').trigger('click')

    expect(writeText).toHaveBeenCalledWith('INFO boot\nERROR failed\nINFO recovered')
    expect(wrapper.emitted('reload')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('clamps the readonly More menu to the viewport with internal scroll sizing', async () => {
    setViewportSize(240, 150)
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })
    await forceNarrowToolbar(wrapper)
    mockElementRect(wrapper.get('[data-testid="viewer-more"]').element, {
      left: 206,
      top: 12,
      right: 232,
      bottom: 40,
      width: 26,
      height: 28,
    })

    await wrapper.get('[data-testid="viewer-more"]').trigger('click')
    const menu = document.body.querySelector<HTMLElement>('[data-testid="viewer-more-menu"]')

    expect(menu).not.toBeNull()
    expect(menu?.classList.contains('viewport-popover-scroll')).toBe(true)
    expect(Number.parseInt(menu?.style.left ?? '', 10)).toBeGreaterThanOrEqual(12)
    expect(Number.parseInt(menu?.style.maxHeight ?? '', 10)).toBeLessThanOrEqual(102)
    expect(menu?.style.right).toBe('')
    wrapper.unmount()
  })

  it('keeps read-only selection/copy available but exposes replace only as an unlock hint', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })
    await forceNarrowToolbar(wrapper)

    await wrapper.get('[data-testid="viewer-more"]').trigger('click')
    const replace = document.body.querySelector<HTMLButtonElement>('[data-testid="viewer-replace-disabled"]')!
    expect(replace.hasAttribute('disabled')).toBe(true)
    expect(replace.getAttribute('title')).toContain('解锁')

    await wrapper.get('[data-testid="viewer-search"]').setValue('ERROR')
    document.body.querySelector<HTMLButtonElement>('[data-testid="viewer-copy-selection"]')!.click()
    await wrapper.vm.$nextTick()

    expect(writeText).toHaveBeenCalledWith('ERROR')
    expect(wrapper.find('button.primary').exists()).toBe(false)
  })

  it('closes readonly More with outside click or Escape without closing the viewer', async () => {
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })
    await forceNarrowToolbar(wrapper)

    await wrapper.get('[data-testid="viewer-more"]').trigger('click')
    expect(document.body.querySelector('[data-testid="viewer-more-menu"]')).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="viewer-more-menu"]')).toBeNull()

    await wrapper.get('[data-testid="viewer-more"]').trigger('click')
    expect(document.body.querySelector('[data-testid="viewer-more-menu"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('[data-testid="viewer-more-menu"]')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('keeps the readonly CodeMirror surface selectable instead of disabling content editing at the DOM layer', () => {
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })

    expect(wrapper.get('.cm-content').attributes('contenteditable')).not.toBe('false')
    expect(wrapper.get('.sftp-codemirror-host').classes()).toContain('sftp-text-selection-surface')
  })

  it('selects all readonly text with Ctrl+A and copies the selected range', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })
    await forceNarrowToolbar(wrapper)

    await wrapper.get('.cm-content').trigger('keydown', { key: 'a', ctrlKey: true })
    await wrapper.get('[data-testid="viewer-more"]').trigger('click')
    document.body.querySelector<HTMLButtonElement>('[data-testid="viewer-copy-selection"]')!.click()
    await wrapper.vm.$nextTick()

    expect(writeText).toHaveBeenCalledWith('INFO boot\nERROR failed\nINFO recovered')
    expect(wrapper.find('.sp-visible-selection').exists()).toBe(true)
  })

  it('marks readonly UNKNOWN selections with a visible in-buffer selection decoration', async () => {
    const wrapper = mount(RemoteTextViewer, {
      props: {
        file: file({
          name: 'status.conf',
          path: '/tmp/status.conf',
          content: [
            'OS_VERSION_STATUS="UNKNOWN"',
            'HARDWARE_ARCH_SUPPORT="UNKNOWN"',
            'STORAGE_SUPPORT="UNKNOWN"',
          ].join('\n'),
          detectedLanguage: 'generic',
        }),
        busy: false,
      },
      attachTo: document.body,
    })

    expect(wrapper.find('.sp-visible-selection').exists()).toBe(false)

    await wrapper.get('[data-testid="viewer-search"]').setValue('UNKNOWN')

    const selection = wrapper.get('.sp-visible-selection')
    expect(selection.text()).toBe('UNKNOWN')
    expect(wrapper.find('.sftp-codemirror-host .sp-visible-selection').exists()).toBe(true)
    expect(wrapper.find('.sp-visible-selection-overlay').exists()).toBe(false)
  })

  it('opens a readonly replace row with Ctrl+H while keeping replacement actions disabled', async () => {
    const wrapper = mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })

    await wrapper.get('.cm-content').trigger('keydown', { key: 'h', ctrlKey: true })

    expect(wrapper.find('.sftp-editor-replace').exists()).toBe(true)
    expect(wrapper.get('[data-testid="viewer-replace-input"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="viewer-replace-one"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="viewer-replace-all"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.sftp-editor-replace-row').text()).toContain('解锁为读写后可替换')
  })

  it('uses explicit focused, unfocused, and native selection styles for the readonly viewer', () => {
    mount(RemoteTextViewer, {
      props: { file: file(), busy: false },
      attachTo: document.body,
    })
    const styleText = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n')

    expect(styleText).toContain('.cm-editor .cm-selectionBackground')
    expect(styleText).toContain('.cm-editor.cm-focused .cm-selectionBackground')
    expect(styleText).toContain('.cm-editor .cm-content ::selection')
    expect(styleText).toContain('#2563ebcc')
    expect(styleText).toContain('#3b82f6e6')
  })
})
