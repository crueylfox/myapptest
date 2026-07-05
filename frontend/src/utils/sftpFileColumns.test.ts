import { describe, expect, it } from 'vitest'
import {
  FILE_COLUMNS,
  defaultFileColumnLayout,
  loadFileColumnLayout,
  normalizeFileColumnLayout,
  persistFileColumnLayout,
} from './sftpFileColumns'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial }
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
  }
}

describe('sftp file column layout utilities', () => {
  it('creates the default column order and widths from the column model', () => {
    const layout = defaultFileColumnLayout()

    expect(layout.columnOrder).toEqual(FILE_COLUMNS.map((column) => column.id))
    expect(layout.columnWidths.name).toBe(260)
    expect(layout.columnWidths.type).toBe(58)
    expect(layout.columnWidths.permissions).toBe(92)
  })

  it('normalizes damaged persisted layouts without duplicate, missing, or deprecated columns', () => {
    const layout = normalizeFileColumnLayout({
      columnOrder: ['permissions', 'missing-column', 'name', 'permissions'],
      columnWidths: {
        name: 20,
        type: 4,
        owner: 12,
        group: 100,
      },
    })

    expect(layout.columnOrder).toEqual([
      'permissions',
      'name',
      'type',
      'size',
      'modTime',
      'owner',
      'group',
    ])
    expect(layout.columnWidths.name).toBe(120)
    expect(layout.columnWidths.type).toBe(48)
    expect(layout.columnWidths.owner).toBe(52)
    expect(layout.columnWidths.group).toBe(100)
  })

  it('loads corrupt storage as the default layout and persists valid layout JSON', () => {
    const storage = memoryStorage({ 'serverpilot.sftpColumnLayout.v1': '{bad json' })

    expect(loadFileColumnLayout(storage)).toEqual(defaultFileColumnLayout())

    const layout = normalizeFileColumnLayout({
      columnOrder: ['type', 'name'],
      columnWidths: { type: 70, name: 180 },
    })
    expect(persistFileColumnLayout(layout, storage)).toBe(true)
    expect(JSON.parse(storage.values['serverpilot.sftpColumnLayout.v1'])).toEqual(layout)
  })
})
