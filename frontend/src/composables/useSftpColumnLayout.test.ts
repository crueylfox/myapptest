import { describe, expect, it } from 'vitest'
import {
  FILE_COLUMN_LAYOUT_KEY,
  FILE_COLUMNS,
  useSftpColumnLayout,
} from './useSftpColumnLayout'
import type { PersistentJsonStorage } from '../utils/persistentJson'

function memoryStorage(initial: Record<string, string> = {}): PersistentJsonStorage & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
    removeItem: (key: string) => {
      delete values[key]
    },
  }
}

describe('useSftpColumnLayout', () => {
  it('loads default columns, widths, and shared grid template style', () => {
    const layout = useSftpColumnLayout({ storage: memoryStorage() })

    expect(layout.fileColumnLayout.value.columnOrder).toEqual(FILE_COLUMNS.map((column) => column.id))
    expect(layout.fileColumnLayout.value.columnWidths.name).toBe(260)
    expect(layout.visibleFileColumns.value.map((column) => column.id)).toEqual(FILE_COLUMNS.map((column) => column.id))
    expect(layout.tableGridColumns.value).toContain('260px')
    expect(layout.tableGridStyle.value.gridTemplateColumns).toBe(layout.tableGridColumns.value)
    expect(layout.tableGridStyle.value.minWidth).toMatch(/px$/)
  })

  it('falls back from corrupt layout and normalizes unknown, duplicate, and missing columns', () => {
    const corrupt = useSftpColumnLayout({ storage: memoryStorage({ [FILE_COLUMN_LAYOUT_KEY]: '{broken' }) })
    expect(corrupt.fileColumnLayout.value.columnOrder).toEqual(FILE_COLUMNS.map((column) => column.id))

    const storage = memoryStorage({
      [FILE_COLUMN_LAYOUT_KEY]: JSON.stringify({
        columnOrder: ['permissions', 'removed', 'name', 'permissions'],
        columnWidths: { name: 20, type: 4, group: 100 },
      }),
    })
    const layout = useSftpColumnLayout({ storage })

    expect(layout.fileColumnLayout.value.columnOrder).toEqual(['permissions', 'name', 'type', 'size', 'modTime', 'owner', 'group'])
    expect(layout.fileColumnLayout.value.columnWidths.name).toBe(120)
    expect(layout.fileColumnLayout.value.columnWidths.type).toBe(48)
    expect(layout.fileColumnLayout.value.columnWidths.group).toBe(100)
  })

  it('updates widths, moves columns, persists layout, and handles save failure non-blockingly', () => {
    const storage = memoryStorage()
    const layout = useSftpColumnLayout({ storage })

    layout.setColumnWidth('type', 10)
    layout.moveColumn('permissions', 1)
    expect(layout.fileColumnLayout.value.columnWidths.type).toBe(48)
    expect(layout.fileColumnLayout.value.columnOrder.slice(0, 3)).toEqual(['name', 'permissions', 'type'])
    expect(layout.persistLayout()).toBe(true)
    expect(JSON.parse(storage.values[FILE_COLUMN_LAYOUT_KEY]).columnOrder.slice(0, 3)).toEqual(['name', 'permissions', 'type'])

    const failing = useSftpColumnLayout({
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota') },
        removeItem: () => undefined,
      },
    })
    expect(failing.persistLayout()).toBe(false)
  })
})
