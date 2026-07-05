// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SftpFileTable from './SftpFileTable.vue'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'
import { FILE_COLUMNS, type FileColumn, type FileColumnId } from '../utils/sftpFileColumns'
import type { SftpHighlightSegment } from '../utils/sftpFileFilter'

function entry(values: Partial<SftpDisplayEntry> = {}): SftpDisplayEntry {
  return {
    name: 'app.log',
    path: '/var/log/app.log',
    parentPath: '/var/log',
    size: 128,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'root',
    modTime: '',
    ...values,
  }
}

function mountTable(options: {
  columns?: FileColumn[]
  entries?: SftpDisplayEntry[]
  selectedPaths?: string[]
  filterActive?: boolean
  filteredEntryCount?: number
  loading?: boolean
  highlightSegments?: (entry: SftpDisplayEntry, columnId: FileColumnId) => SftpHighlightSegment[]
  resizingColumnId?: FileColumnId | null
  draggingColumnId?: FileColumnId | null
  columnDropTargetIndex?: number | null
} = {}) {
  return mount(SftpFileTable, {
    props: {
      columns: options.columns ?? FILE_COLUMNS,
      entries: options.entries ?? [
        entry({ name: '..', path: '/var/log/..', isDir: true, syntheticParent: true }),
        entry(),
      ],
      selectedPaths: options.selectedPaths ?? [],
      tableGridStyle: {
        gridTemplateColumns: '260px 58px 84px 150px 92px 74px 74px',
        minWidth: '812px',
      },
      filterActive: options.filterActive ?? false,
      filteredEntryCount: options.filteredEntryCount ?? 1,
      currentSortKey: 'name',
      currentSortAsc: true,
      resizingColumnId: options.resizingColumnId ?? null,
      draggingColumnId: options.draggingColumnId ?? null,
      columnDropTargetIndex: options.columnDropTargetIndex ?? null,
      loading: options.loading ?? false,
      highlightSegments: options.highlightSegments ?? ((target, columnId) => {
        const text = columnId === 'name' ? target.name : columnId === 'permissions' ? target.permissions : ''
        return text ? [{ text, matched: false }] : []
      }),
    },
  })
}

describe('SftpFileTable', () => {
  it('renders default headers and keeps header/body grid styles aligned', () => {
    const wrapper = mountTable()

    expect(wrapper.get('[data-testid="sftp-file-list"]').attributes('data-ui-no-text-select')).toBe('true')
    expect(wrapper.findAll('.sftp-column-head').map((item) => item.attributes('data-column-id')))
      .toEqual(FILE_COLUMNS.map((column) => column.id))
    expect((wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns)
      .toBe('260px 58px 84px 150px 92px 74px 74px')
    expect((wrapper.get('[data-testid="sftp-entry-row"]').element as HTMLElement).style.gridTemplateColumns)
      .toBe('260px 58px 84px 150px 92px 74px 74px')
  })

  it('renders the parent row at the top and keeps icon plus filename in the name cell', () => {
    const wrapper = mountTable()
    const rows = wrapper.findAll('[data-testid="sftp-entry-row"]')

    expect(rows[0].classes()).toContain('parent')
    expect(rows[0].find('[data-column-id="name"] .sftp-entry-icon').exists()).toBe(true)
    expect(rows[0].find('[data-column-id="name"] .sftp-entry-label').text()).toBe('..')
  })

  it('moves the name cell, icon, and filename together when column order changes', () => {
    const columns = [
      FILE_COLUMNS.find((column) => column.id === 'type')!,
      FILE_COLUMNS.find((column) => column.id === 'name')!,
      FILE_COLUMNS.find((column) => column.id === 'size')!,
    ]
    const wrapper = mountTable({
      columns,
      entries: [entry({ name: 'install.sh', path: '/install.sh' })],
      highlightSegments: (target, columnId) => columnId === 'name' ? [{ text: target.name, matched: false }] : [],
    })

    const cells = wrapper.get('[data-testid="sftp-entry-row"]').findAll('[data-column-id]')
    expect(cells.map((cell) => cell.attributes('data-column-id'))).toEqual(['type', 'name', 'size'])
    expect(cells[1].find('.sftp-entry-icon').exists()).toBe(true)
    expect(cells[1].text()).toContain('install.sh')
  })

  it('renders selected rows and safe filter highlight spans without v-html', () => {
    const wrapper = mountTable({
      entries: [entry({ name: '<b>app</b>.log', path: '/var/log/app.log' })],
      selectedPaths: ['/var/log/app.log'],
      filterActive: true,
      highlightSegments: () => [{ text: '<b>app</b>', matched: true }, { text: '.log', matched: false }],
    })

    const row = wrapper.get('[data-testid="sftp-entry-row"]')
    expect(row.classes()).toContain('selected')
    expect(row.find('.sftp-filter-match').text()).toBe('<b>app</b>')
    expect(row.find('b').exists()).toBe(false)
  })

  it('shows no-match while keeping the parent row visible, plus loading and empty states', () => {
    const parent = entry({ name: '..', path: '/var/log/..', isDir: true, syntheticParent: true })
    const noMatch = mountTable({ entries: [parent], filterActive: true, filteredEntryCount: 0 })
    expect(noMatch.findAll('[data-testid="sftp-entry-row"]')).toHaveLength(1)
    expect(noMatch.find('[data-testid="sftp-filter-empty"]').exists()).toBe(true)

    expect(mountTable({ entries: [], loading: true }).find('[data-testid="sftp-table-loading"]').exists()).toBe(true)
    expect(mountTable({ entries: [] }).find('[data-testid="sftp-table-empty"]').exists()).toBe(true)
  })

  it('emits row, blank-area, header, resize, reorder, keydown, and wheel events', async () => {
    const wrapper = mountTable({ entries: [entry({ path: '/var/log/app.log' })] })

    await wrapper.get('[data-testid="sftp-entry-row"]').trigger('click', { ctrlKey: true })
    await wrapper.get('[data-testid="sftp-entry-row"]').trigger('dblclick')
    await wrapper.get('[data-testid="sftp-entry-row"]').trigger('contextmenu')
    await wrapper.get('[data-testid="sftp-column-sort-size"]').trigger('click')
    await wrapper.get('[data-testid="sftp-column-resize-name"]').trigger('pointerdown')
    await wrapper.get('[data-testid="sftp-column-header-name"]').trigger('pointerdown')
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('click')
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('contextmenu')
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'Delete' })
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('wheel')

    expect(wrapper.emitted('row-click')?.[0][0]).toMatchObject({ path: '/var/log/app.log' })
    expect(wrapper.emitted('row-dblclick')?.[0][0]).toMatchObject({ path: '/var/log/app.log' })
    expect(wrapper.emitted('row-contextmenu')?.[0][0]).toMatchObject({ path: '/var/log/app.log' })
    expect(wrapper.emitted('header-sort')?.[0][0]).toMatchObject({ id: 'size' })
    expect(wrapper.emitted('column-resize-start')?.[0][0]).toBe('name')
    expect(wrapper.emitted('column-reorder-start')?.[0][0]).toBe('name')
    expect(wrapper.emitted('blank-click')).toHaveLength(1)
    expect(wrapper.emitted('blank-contextmenu')).toBeTruthy()
    expect(wrapper.emitted('keydown')).toBeTruthy()
    expect(wrapper.emitted('wheel')).toBeTruthy()
  })

  it('emits parent-click when the parent entry icon is clicked', async () => {
    const wrapper = mountTable()
    const stopPropagation = vi.fn()
    const preventDefault = vi.fn()

    await wrapper.get('.sftp-entry-icon-parent').trigger('click', { stopPropagation, preventDefault })

    expect(wrapper.emitted('parent-click')?.[0][0]).toMatchObject({ syntheticParent: true })
  })
})
