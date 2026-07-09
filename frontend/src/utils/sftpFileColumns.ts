import { safeReadJson, safeWriteJson, type PersistentJsonStorage } from './persistentJson'

export type FileColumnId = 'name' | 'type' | 'size' | 'modTime' | 'permissions' | 'owner' | 'group'
export type FileSortableColumnId = 'name' | 'type' | 'size' | 'modTime' | 'permissions'

export type FileColumn = {
  id: FileColumnId
  label: string
  minWidth: number
  defaultWidth: number
  sortable?: FileSortableColumnId
}

export type FileColumnLayout = {
  columnOrder: FileColumnId[]
  columnWidths: Record<FileColumnId, number>
}

export type FileColumnLayoutStorage = PersistentJsonStorage

export const FILE_COLUMN_LAYOUT_KEY = 'hostdeck.sftpColumnLayout.v1'

export const FILE_COLUMNS: FileColumn[] = [
  { id: 'name', label: '名称', minWidth: 120, defaultWidth: 260, sortable: 'name' },
  { id: 'type', label: '类型', minWidth: 48, defaultWidth: 58, sortable: 'type' },
  { id: 'size', label: '大小', minWidth: 64, defaultWidth: 84, sortable: 'size' },
  { id: 'modTime', label: '修改时间', minWidth: 112, defaultWidth: 150, sortable: 'modTime' },
  { id: 'permissions', label: '权限', minWidth: 72, defaultWidth: 92, sortable: 'permissions' },
  { id: 'owner', label: '所有者', minWidth: 52, defaultWidth: 74 },
  { id: 'group', label: '用户组', minWidth: 52, defaultWidth: 74 },
]

export const FILE_COLUMN_BY_ID = new Map(FILE_COLUMNS.map((column) => [column.id, column]))

export function defaultFileColumnLayout(): FileColumnLayout {
  return {
    columnOrder: FILE_COLUMNS.map((column) => column.id),
    columnWidths: FILE_COLUMNS.reduce((widths, column) => {
      widths[column.id] = column.defaultWidth
      return widths
    }, {} as Record<FileColumnId, number>),
  }
}

export function isFileColumnId(value: unknown): value is FileColumnId {
  return typeof value === 'string' && FILE_COLUMN_BY_ID.has(value as FileColumnId)
}

export function clampFileColumnWidth(columnId: FileColumnId, value: number) {
  const column = FILE_COLUMN_BY_ID.get(columnId)
  if (!column || !Number.isFinite(value)) return column?.defaultWidth ?? 80
  return Math.max(column.minWidth, Math.round(value))
}

export function normalizeFileColumnLayout(value: unknown): FileColumnLayout {
  const source = value && typeof value === 'object' ? value as Partial<FileColumnLayout> : {}
  const order: FileColumnId[] = []
  if (Array.isArray(source.columnOrder)) {
    for (const columnId of source.columnOrder) {
      if (isFileColumnId(columnId) && !order.includes(columnId)) order.push(columnId)
    }
  }
  for (const column of FILE_COLUMNS) {
    if (!order.includes(column.id)) order.push(column.id)
  }
  const rawWidths = source.columnWidths && typeof source.columnWidths === 'object'
    ? source.columnWidths as Partial<Record<FileColumnId, number>>
    : {}
  const columnWidths = FILE_COLUMNS.reduce((widths, column) => {
    widths[column.id] = clampFileColumnWidth(column.id, Number(rawWidths[column.id] ?? column.defaultWidth))
    return widths
  }, {} as Record<FileColumnId, number>)
  return { columnOrder: order, columnWidths }
}

export function loadFileColumnLayout(storage: FileColumnLayoutStorage = localStorage): FileColumnLayout {
  return normalizeFileColumnLayout(safeReadJson(FILE_COLUMN_LAYOUT_KEY, defaultFileColumnLayout(), undefined, storage))
}

export function persistFileColumnLayout(layout: FileColumnLayout, storage: FileColumnLayoutStorage = localStorage) {
  return safeWriteJson(FILE_COLUMN_LAYOUT_KEY, layout, storage)
}
