import { computed, ref } from 'vue'
import {
  defaultPaneAssignments,
  defaultSplitLayoutState,
  getVisiblePaneIds,
  isSplitMode,
  isSplitPaneId,
  normalizeSplitRatio,
  WORKSPACE_SPLIT_LAYOUT_STORAGE_KEY,
  SPLIT_RATIO_DEFAULT,
  type PaneAssignments,
  type SplitMode,
  type SplitPaneId,
} from '../utils/workspaceSplitTypes'
import { normalizePersistedPaneAssignments } from './usePaneAssignments'

type SplitLayoutStorage = Pick<Storage, 'getItem' | 'setItem'>

export type UseWorkspaceSplitLayoutOptions = {
  storage?: SplitLayoutStorage
}

export function useWorkspaceSplitLayout(options: UseWorkspaceSplitLayoutOptions = {}) {
  const storage = options.storage ?? localStorage
  const stored = loadSplitLayout(storage)
  const splitMode = ref<SplitMode>(stored.splitMode)
  const paneAssignments = ref<PaneAssignments>(stored.paneAssignments)
  const activePaneId = ref<SplitPaneId>(stored.activePaneId)
  const splitColumnRatio = ref(stored.columnRatio)
  const splitRowRatio = ref(stored.rowRatio)
  const maximizedPaneId = ref<SplitPaneId | null>(null)
  const layoutRevision = ref(0)

  const visibleSplitPaneIds = computed(() => getVisiblePaneIds(splitMode.value))
  const splitEnabled = computed(() => splitMode.value !== 'single')
  const renderedSplitPaneIds = computed<SplitPaneId[]>(() =>
    splitEnabled.value && maximizedPaneId.value && visibleSplitPaneIds.value.includes(maximizedPaneId.value)
      ? [maximizedPaneId.value]
      : visibleSplitPaneIds.value)
  const showColumnSplitter = computed(() => splitMode.value === 'vertical' || splitMode.value === 'quad')
  const showRowSplitter = computed(() => splitMode.value === 'horizontal' || splitMode.value === 'quad')

  function saveLayout() {
    try {
      storage.setItem(WORKSPACE_SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify({
        splitMode: splitMode.value,
        paneAssignments: paneAssignments.value,
        activePaneId: activePaneId.value,
        columnRatio: splitColumnRatio.value,
        rowRatio: splitRowRatio.value,
      }))
      return true
    } catch {
      return false
    }
  }

  function bumpLayoutRevision() {
    layoutRevision.value += 1
  }

  function setSplitMode(mode: SplitMode) {
    maximizedPaneId.value = null
    splitMode.value = mode
    if (!visibleSplitPaneIds.value.includes(activePaneId.value)) activePaneId.value = 'pane-1'
    saveLayout()
    bumpLayoutRevision()
  }

  function resetSplitRatios() {
    if (splitMode.value === 'single') return
    if (splitMode.value === 'vertical' || splitMode.value === 'quad') splitColumnRatio.value = SPLIT_RATIO_DEFAULT
    if (splitMode.value === 'horizontal' || splitMode.value === 'quad') splitRowRatio.value = SPLIT_RATIO_DEFAULT
    saveLayout()
    bumpLayoutRevision()
  }

  function clearAllPanes() {
    paneAssignments.value = defaultPaneAssignments()
    activePaneId.value = visibleSplitPaneIds.value[0] ?? 'pane-1'
    maximizedPaneId.value = null
    saveLayout()
    bumpLayoutRevision()
  }

  function togglePaneMaximize(paneId: SplitPaneId) {
    if (!splitEnabled.value || !visibleSplitPaneIds.value.includes(paneId)) return
    if (maximizedPaneId.value === paneId) {
      maximizedPaneId.value = null
      bumpLayoutRevision()
      return
    }
    maximizedPaneId.value = paneId
    activePaneId.value = paneId
    saveLayout()
    bumpLayoutRevision()
  }

  function restoreMaximizedPane() {
    if (!maximizedPaneId.value) return
    maximizedPaneId.value = null
    bumpLayoutRevision()
  }

  return {
    splitMode,
    paneAssignments,
    activePaneId,
    splitColumnRatio,
    splitRowRatio,
    maximizedPaneId,
    layoutRevision,
    visibleSplitPaneIds,
    splitEnabled,
    renderedSplitPaneIds,
    showColumnSplitter,
    showRowSplitter,
    saveLayout,
    setSplitMode,
    resetSplitRatios,
    clearAllPanes,
    togglePaneMaximize,
    restoreMaximizedPane,
    bumpLayoutRevision,
  }
}

function loadSplitLayout(storage: SplitLayoutStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(WORKSPACE_SPLIT_LAYOUT_STORAGE_KEY) ?? '{}') as {
      splitMode?: unknown
      paneAssignments?: Record<string, unknown>
      activePaneId?: unknown
      columnRatio?: unknown
      rowRatio?: unknown
    }
    return {
      splitMode: isSplitMode(parsed.splitMode) ? parsed.splitMode : 'single',
      paneAssignments: normalizePersistedPaneAssignments(parsed.paneAssignments),
      activePaneId: isSplitPaneId(parsed.activePaneId) ? parsed.activePaneId : 'pane-1',
      columnRatio: normalizeSplitRatio(parsed.columnRatio ?? SPLIT_RATIO_DEFAULT),
      rowRatio: normalizeSplitRatio(parsed.rowRatio ?? SPLIT_RATIO_DEFAULT),
    }
  } catch {
    return defaultSplitLayoutState()
  }
}
