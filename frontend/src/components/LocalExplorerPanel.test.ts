// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalExplorerPanel from './LocalExplorerPanel.vue'

const apiMock = vi.hoisted(() => ({
  getLocalExplorerHome: vi.fn(),
  getLocalDrives: vi.fn(),
  listLocalDirectory: vi.fn(),
  openLocalPath: vi.fn(),
  revealLocalPath: vi.fn(),
  showLocalPathProperties: vi.fn(),
}))

vi.mock('../api/backend', () => ({ api: apiMock }))

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

function listing(path = 'C:\\Fixture', entries = [
  { name: 'zeta.log', path: 'C:\\Fixture\\zeta.log', size: 2048, isDir: false, modTime: '2026-07-04T12:00:00Z', displayType: 'file' },
  { name: 'Alpha', path: 'C:\\Fixture\\Alpha', size: 0, isDir: true, modTime: '2026-07-03T12:00:00Z', displayType: 'folder' },
]) {
  return {
    path,
    parent: 'C:\\',
    entries,
  }
}

function mountPanel(options: {
  initialPath?: string
  homePath?: string
} = {}) {
  const initialPath = options.initialPath ?? 'C:\\Fixture'
  const homePath = options.homePath ?? 'C:\\Fixture'
  apiMock.getLocalExplorerHome.mockResolvedValue({ path: homePath })
  apiMock.getLocalDrives.mockResolvedValue([
    { name: 'C:', path: 'C:\\' },
    { name: 'D:', path: 'D:\\' },
  ])
  apiMock.listLocalDirectory.mockImplementation(async (path: string) => listing(path))
  apiMock.openLocalPath.mockResolvedValue(undefined)
  apiMock.revealLocalPath.mockResolvedValue(undefined)
  apiMock.showLocalPathProperties.mockResolvedValue(undefined)
  return mount(LocalExplorerPanel, {
    attachTo: document.body,
    props: {
      expanded: true,
      initialPath,
    },
  })
}

describe('LocalExplorerPanel', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('uses SFTP-like toolbar order without a title row or remote-only actions', async () => {
    const wrapper = mountPanel()
    await flush()
    await wrapper.vm.$nextTick()

    const toolbar = wrapper.get('.local-explorer-toolbar')
    expect(toolbar.text()).not.toContain('Windows')
    expect(toolbar.find('.local-explorer-path').exists()).toBe(true)
    expect(toolbar.find('.local-explorer-nav-actions').exists()).toBe(true)
    expect(toolbar.find('.local-explorer-path').element.compareDocumentPosition(toolbar.get('.local-explorer-nav-actions').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toolbar.findAll('.local-explorer-nav-actions .sftp-toolbar-action-separator')).toHaveLength(4)
    expect(toolbar.findAll('.local-explorer-nav-actions .action-separator')).toHaveLength(0)
    expect(toolbar.text()).not.toContain('Upload')
    expect(toolbar.text()).not.toContain('Download')
  })

  it('navigates Home to the local user home path and refreshes the path input', async () => {
    const wrapper = mountPanel({
      initialPath: 'C:\\Other',
      homePath: 'C:\\Users\\Fixture',
    })
    await flush()
    await wrapper.vm.$nextTick()

    const pathInput = wrapper.get<HTMLInputElement>('.local-explorer-path input')
    expect(pathInput.element.value).toBe('C:\\Other')

    await wrapper.get('[data-testid="local-explorer-home"]').trigger('click')
    await flush()
    await wrapper.vm.$nextTick()

    expect(apiMock.getLocalExplorerHome).toHaveBeenCalled()
    expect(apiMock.listLocalDirectory).toHaveBeenLastCalledWith('C:\\Users\\Fixture')
    expect(pathInput.element.value).toBe('C:\\Users\\Fixture')
  })

  it('renders local entries through the shared SFTP table classes with sortable and resizable columns', async () => {
    const wrapper = mountPanel()
    await flush()
    await wrapper.vm.$nextTick()

    const table = wrapper.get('[data-testid="local-explorer-table"]')
    expect(table.classes()).toContain('sftp-table')
    expect(table.findAll('.sftp-row')).toHaveLength(4)
    expect(table.find('[data-testid="sftp-column-sort-name"]').exists()).toBe(true)
    expect(table.find('[data-testid="sftp-column-sort-modTime"]').exists()).toBe(true)
    expect(table.find('[data-testid="sftp-column-resize-name"]').exists()).toBe(true)
    expect(table.find('[data-column-id="permissions"]').exists()).toBe(false)
    expect(table.find('[data-column-id="owner"]').exists()).toBe(false)
    expect(table.find('[data-column-id="group"]').exists()).toBe(false)

    await table.get('[data-testid="sftp-column-sort-modTime"]').trigger('click')
    const sortedNames = table.findAll('[data-testid="sftp-entry-row"] .sftp-entry-name-cell strong')
      .map((item) => item.text())
    expect(sortedNames).toEqual(['..', 'Alpha', 'zeta.log'])

    const before = table.get('.sftp-row').attributes('style') ?? ''
    table.get('[data-testid="sftp-column-resize-name"]').element
      .dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(table.get('.sftp-row').attributes('style')).not.toBe(before)
  })

  it('keeps the parent directory shortcut first and navigates it without sorting it away', async () => {
    const wrapper = mountPanel()
    await flush()
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('[data-testid="sftp-entry-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('..')

    await wrapper.get('[data-testid="sftp-column-sort-modTime"]').trigger('click')
    await wrapper.vm.$nextTick()
    const sortedRows = wrapper.findAll('[data-testid="sftp-entry-row"]')
    expect(sortedRows[0].text()).toContain('..')

    await sortedRows[0].trigger('dblclick')
    await flush()
    expect(apiMock.listLocalDirectory).toHaveBeenLastCalledWith('C:\\')
  })

  it('opens files through the local shell API while folders still navigate inside the panel', async () => {
    const wrapper = mountPanel()
    await flush()
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('[data-testid="sftp-entry-row"]')
    const folderRow = rows.find((row) => row.text().includes('Alpha'))
    const fileRow = rows.find((row) => row.text().includes('zeta.log'))
    expect(folderRow).toBeTruthy()
    expect(fileRow).toBeTruthy()

    await fileRow!.trigger('dblclick')
    await flush()
    expect(apiMock.openLocalPath).toHaveBeenCalledWith('C:\\Fixture\\zeta.log')

    await folderRow!.trigger('dblclick')
    await flush()
    expect(apiMock.listLocalDirectory).toHaveBeenLastCalledWith('C:\\Fixture\\Alpha')
  })

  it('shows local-only context menus for file rows and blank table space', async () => {
    const clipboard = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboard },
    })
    const wrapper = mountPanel()
    await flush()
    await wrapper.vm.$nextTick()

    const fileRow = wrapper.findAll('[data-testid="sftp-entry-row"]')
      .find((row) => row.text().includes('zeta.log'))
    expect(fileRow).toBeTruthy()
    await fileRow!.trigger('contextmenu', { clientX: 120, clientY: 140 })
    await flush()
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('打开')
    expect(document.body.textContent).toContain('在文件管理器中显示')
    expect(document.body.textContent).not.toContain('资源管理器')
    expect(document.body.textContent).toContain('复制路径')
    expect(document.body.textContent).toContain('复制名称')
    expect(document.body.textContent).toContain('属性')
    expect(document.body.textContent).toContain('刷新')
    expect(document.body.textContent).not.toContain('上传')
    expect(document.body.textContent).not.toContain('下载')

    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('.context-menu button')]
    buttons.find((button) => button.textContent === '打开')?.click()
    await flush()
    expect(apiMock.openLocalPath).toHaveBeenCalledWith('C:\\Fixture\\zeta.log')

    await fileRow!.trigger('contextmenu', { clientX: 120, clientY: 140 })
    await flush()
    ;[...document.body.querySelectorAll<HTMLButtonElement>('.context-menu button')]
      .find((button) => button.textContent === '复制路径')?.click()
    await flush()
    expect(clipboard).toHaveBeenCalledWith('C:\\Fixture\\zeta.log')

    await wrapper.get('[data-testid="local-explorer-table"]').trigger('contextmenu', { clientX: 160, clientY: 220 })
    await flush()
    expect(document.body.textContent).toContain('上一级')
    expect(document.body.textContent).toContain('Home')
    expect(document.body.textContent).toContain('复制当前路径')
  })

  it('does not render an internal SFTP-style collapse control in the local explorer toolbar', async () => {
    const wrapper = mountPanel()
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.local-explorer-toolbar .sftp-toggle-handle').exists()).toBe(false)
    expect(wrapper.find('.local-explorer-toolbar .splitter-handle-inline').exists()).toBe(false)
  })
})
