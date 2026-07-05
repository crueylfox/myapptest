import { describe, expect, it } from 'vitest'
import {
  calculateToolbarActionBudget,
  fitToolbarActionIds,
  measureToolbarActionListWidth,
  type ToolbarFitAction,
} from './sftpToolbarLayout'

type ActionId = 'refresh' | 'upload' | 'download' | 'delete'

const actions: ToolbarFitAction<ActionId>[] = [
  { id: 'refresh' },
  { id: 'upload' },
  { id: 'download' },
  { id: 'delete' },
]

const fallbackWidths: Record<ActionId, number> = {
  refresh: 54,
  upload: 54,
  download: 54,
  delete: 54,
}

describe('sftp toolbar layout utilities', () => {
  it('measures action lists with gaps and measured widths overriding fallbacks', () => {
    expect(measureToolbarActionListWidth(actions.slice(0, 3), {
      actionWidths: { upload: 70 },
      fallbackActionWidths: fallbackWidths,
      gap: 6,
    })).toBe(54 + 6 + 70 + 6 + 54)
  })

  it('reserves path filter and transfer space from the available toolbar width', () => {
    expect(calculateToolbarActionBudget({
      availableWidth: 600,
      horizontalPadding: 16,
      pathMinWidth: 180,
      gap: 6,
      filterMinWidth: 160,
      showFilter: true,
      inlineTransferReserve: 96,
      hasTransfer: true,
    })).toBe(130)
  })

  it('keeps all actions visible when they fit in the available budget', () => {
    expect(fitToolbarActionIds(actions.slice(0, 3), {
      availableWidth: 380,
      actionWidths: {},
      fallbackActionWidths: fallbackWidths,
      moreWidth: 58,
      gap: 6,
      horizontalPadding: 16,
      pathMinWidth: 180,
      filterMinWidth: 160,
      showFilter: false,
      inlineTransferReserve: 96,
      hasTransfer: false,
    })).toEqual(['refresh', 'upload', 'download'])
  })

  it('reserves space for the more button before fitting overflow actions', () => {
    expect(fitToolbarActionIds(actions, {
      availableWidth: 350,
      actionWidths: {},
      fallbackActionWidths: fallbackWidths,
      moreWidth: 68,
      gap: 6,
      horizontalPadding: 16,
      pathMinWidth: 180,
      filterMinWidth: 160,
      showFilter: false,
      inlineTransferReserve: 96,
      hasTransfer: false,
    })).toEqual(['refresh'])
  })

  it('keeps the More button reserve from shrinking below the full label width', () => {
    expect(fitToolbarActionIds(actions, {
      availableWidth: 374,
      actionWidths: {},
      fallbackActionWidths: fallbackWidths,
      moreWidth: 68,
      gap: 6,
      horizontalPadding: 16,
      pathMinWidth: 180,
      filterMinWidth: 160,
      showFilter: false,
      inlineTransferReserve: 96,
      hasTransfer: false,
    })).toEqual(['refresh'])
  })

  it('returns every action when available width is unknown', () => {
    expect(fitToolbarActionIds(actions, {
      availableWidth: Number.POSITIVE_INFINITY,
      actionWidths: {},
      fallbackActionWidths: fallbackWidths,
      moreWidth: 58,
      gap: 6,
      horizontalPadding: 16,
      pathMinWidth: 180,
      filterMinWidth: 160,
      showFilter: true,
      inlineTransferReserve: 96,
      hasTransfer: true,
    })).toEqual(['refresh', 'upload', 'download', 'delete'])
  })
})
