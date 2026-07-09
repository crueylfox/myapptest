export type SplitMode = 'single' | 'vertical' | 'horizontal' | 'quad'
export type SplitPaneId = 'pane-1' | 'pane-2' | 'pane-3' | 'pane-4'
export type SplitResizeAxis = 'column' | 'row'
export type PaneAssignmentKind = 'ssh' | 'local'
export type PaneAssignment = { kind: PaneAssignmentKind; sessionId: string }
export type PaneAssignments = Record<SplitPaneId, PaneAssignment | null>

export type SplitLayoutState = {
  splitMode: SplitMode
  paneAssignments: PaneAssignments
  activePaneId: SplitPaneId
  columnRatio: number
  rowRatio: number
}

export type SplitRatios = Pick<SplitLayoutState, 'columnRatio' | 'rowRatio'>

export const WORKSPACE_SPLIT_LAYOUT_STORAGE_KEY = 'hostdeck.workspaceSplitLayout.v1'
export const SPLIT_RATIO_DEFAULT = 0.5
export const SPLIT_RATIO_MIN = 0.25
export const SPLIT_RATIO_MAX = 0.75
export const ALL_SPLIT_PANE_IDS: SplitPaneId[] = ['pane-1', 'pane-2', 'pane-3', 'pane-4']

export function defaultPaneAssignments(): PaneAssignments {
  return {
    'pane-1': null,
    'pane-2': null,
    'pane-3': null,
    'pane-4': null,
  }
}

export function defaultSplitLayoutState(): SplitLayoutState {
  return {
    splitMode: 'single',
    paneAssignments: defaultPaneAssignments(),
    activePaneId: 'pane-1',
    columnRatio: SPLIT_RATIO_DEFAULT,
    rowRatio: SPLIT_RATIO_DEFAULT,
  }
}

export function isSplitMode(value: unknown): value is SplitMode {
  return value === 'single' || value === 'vertical' || value === 'horizontal' || value === 'quad'
}

export function isSplitPaneId(value: unknown): value is SplitPaneId {
  return typeof value === 'string' && (ALL_SPLIT_PANE_IDS as string[]).includes(value)
}

export function parsePaneAssignment(value: unknown): PaneAssignment | null {
  if (typeof value === 'string') {
    const sessionId = value.trim()
    return sessionId ? { kind: 'ssh', sessionId } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as { kind?: unknown; sessionId?: unknown }
  if ((record.kind !== 'ssh' && record.kind !== 'local') || typeof record.sessionId !== 'string') return null
  const sessionId = record.sessionId.trim()
  return sessionId ? { kind: record.kind, sessionId } : null
}

export function clampSplitRatio(value: number) {
  return Math.min(Math.max(value, SPLIT_RATIO_MIN), SPLIT_RATIO_MAX)
}

export function normalizeSplitRatio(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return SPLIT_RATIO_DEFAULT
  return Math.round(clampSplitRatio(numeric) * 1000) / 1000
}

export function getVisiblePaneIds(mode: SplitMode): SplitPaneId[] {
  if (mode === 'single') return ['pane-1']
  if (mode === 'quad') return ALL_SPLIT_PANE_IDS
  return ['pane-1', 'pane-2']
}

export function getPaneFillOrder(mode: SplitMode): SplitPaneId[] {
  if (mode === 'vertical' || mode === 'horizontal') return ['pane-1', 'pane-2']
  if (mode === 'quad') return ['pane-1', 'pane-2', 'pane-3', 'pane-4']
  return []
}

export function getPanePositionLabel(mode: SplitMode, paneId: SplitPaneId) {
  if (mode === 'vertical') return paneId === 'pane-1' ? '左' : '右'
  if (mode === 'horizontal') return paneId === 'pane-1' ? '上' : '下'
  if (mode === 'quad') {
    const labels: Record<SplitPaneId, string> = {
      'pane-1': '左上',
      'pane-2': '右上',
      'pane-3': '左下',
      'pane-4': '右下',
    }
    return labels[paneId]
  }
  return '当前'
}
