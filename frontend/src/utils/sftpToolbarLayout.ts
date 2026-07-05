export type ToolbarFitAction<TId extends string> = {
  id: TId
}

export type ToolbarActionWidthOptions<TId extends string> = {
  actionWidths: Partial<Record<TId, number>>
  fallbackActionWidths: Record<TId, number>
  gap: number
}

export type ToolbarActionBudgetOptions = {
  availableWidth: number
  horizontalPadding: number
  pathMinWidth: number
  gap: number
  filterMinWidth: number
  showFilter: boolean
  inlineTransferReserve: number
  hasTransfer: boolean
}

export type ToolbarFitOptions<TId extends string> =
  ToolbarActionWidthOptions<TId>
  & ToolbarActionBudgetOptions
  & {
    moreWidth: number
  }

function toolbarActionWidth<TId extends string>(id: TId, options: ToolbarActionWidthOptions<TId>) {
  return options.actionWidths[id] || options.fallbackActionWidths[id]
}

export function measureToolbarActionListWidth<TId extends string>(
  actions: ToolbarFitAction<TId>[],
  options: ToolbarActionWidthOptions<TId>,
) {
  return actions.reduce((total, action, index) =>
    total + toolbarActionWidth(action.id, options) + (index > 0 ? options.gap : 0), 0)
}

export function calculateToolbarActionBudget(options: ToolbarActionBudgetOptions) {
  const width = options.availableWidth
  if (!Number.isFinite(width) || width <= 0) return Number.POSITIVE_INFINITY
  const transferReserve = options.hasTransfer ? options.inlineTransferReserve + options.gap : 0
  const filterReserve = options.showFilter ? options.filterMinWidth + options.gap : 0
  return Math.max(0, width - options.horizontalPadding - options.pathMinWidth - options.gap - filterReserve - transferReserve)
}

export function fitToolbarActionIds<TId extends string>(
  actions: ToolbarFitAction<TId>[],
  options: ToolbarFitOptions<TId>,
) {
  const budget = calculateToolbarActionBudget(options)
  if (!Number.isFinite(budget)) return actions.map((action) => action.id)
  if (measureToolbarActionListWidth(actions, options) <= budget) return actions.map((action) => action.id)

  const visible: TId[] = []
  const visibleBudget = Math.max(0, budget - options.moreWidth - options.gap)
  let used = 0
  for (const action of actions) {
    const next = used + toolbarActionWidth(action.id, options) + (visible.length > 0 ? options.gap : 0)
    if (next > visibleBudget) break
    visible.push(action.id)
    used = next
  }
  return visible
}
