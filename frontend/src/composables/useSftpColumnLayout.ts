import { computed, ref } from 'vue'
import {
  FILE_COLUMN_BY_ID,
  FILE_COLUMN_LAYOUT_KEY,
  FILE_COLUMNS,
  clampFileColumnWidth,
  loadFileColumnLayout,
  persistFileColumnLayout,
  type FileColumn,
  type FileColumnId,
  type FileColumnLayout,
} from '../utils/sftpFileColumns'
import type { PersistentJsonStorage } from '../utils/persistentJson'

export {
  FILE_COLUMN_LAYOUT_KEY,
  FILE_COLUMNS,
}

export type UseSftpColumnLayoutOptions = {
  storage?: PersistentJsonStorage
}

export function useSftpColumnLayout(options: UseSftpColumnLayoutOptions = {}) {
  const storage = options.storage ?? localStorage
  const fileColumnLayout = ref<FileColumnLayout>(loadFileColumnLayout(storage))
  const visibleFileColumns = computed(() =>
    fileColumnLayout.value.columnOrder
      .map((columnId) => FILE_COLUMN_BY_ID.get(columnId))
      .filter((column): column is FileColumn => Boolean(column)))
  const tableGridColumns = computed(() =>
    visibleFileColumns.value.map((column) => `${fileColumnLayout.value.columnWidths[column.id]}px`).join(' '))
  const tableMinWidth = computed(() => {
    const widths = visibleFileColumns.value.reduce((total, column) => total + fileColumnLayout.value.columnWidths[column.id], 0)
    const gaps = Math.max(visibleFileColumns.value.length - 1, 0) * 8
    return widths + gaps + 20
  })
  const tableGridStyle = computed(() => ({
    gridTemplateColumns: tableGridColumns.value,
    minWidth: `${tableMinWidth.value}px`,
  }))

  function setColumnWidth(columnId: FileColumnId, width: number) {
    fileColumnLayout.value = {
      columnOrder: fileColumnLayout.value.columnOrder,
      columnWidths: {
        ...fileColumnLayout.value.columnWidths,
        [columnId]: clampFileColumnWidth(columnId, width),
      },
    }
  }

  function moveColumn(columnId: FileColumnId, targetIndex: number) {
    const currentOrder = fileColumnLayout.value.columnOrder
    const withoutColumn = currentOrder.filter((id) => id !== columnId)
    const nextIndex = Math.max(0, Math.min(targetIndex, withoutColumn.length))
    const nextOrder = withoutColumn.slice()
    nextOrder.splice(nextIndex, 0, columnId)
    if (nextOrder.join('|') === currentOrder.join('|')) return
    fileColumnLayout.value = {
      columnOrder: nextOrder,
      columnWidths: fileColumnLayout.value.columnWidths,
    }
  }

  function persistLayout() {
    return persistFileColumnLayout(fileColumnLayout.value, storage)
  }

  return {
    fileColumnLayout,
    visibleFileColumns,
    tableGridColumns,
    tableMinWidth,
    tableGridStyle,
    setColumnWidth,
    moveColumn,
    persistLayout,
  }
}
