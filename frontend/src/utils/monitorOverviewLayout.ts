export type MonitorOverviewLayoutMode = 'overview-fit' | 'compact-fit' | 'scroll'

export interface MonitorOverviewLayoutOptions {
  hasNotice?: boolean
}

export interface MonitorOverviewLayout {
  mode: MonitorOverviewLayoutMode
  metricColumns: number
  chartColumns: number
  chartHeight: number
  estimatedContentHeight: number
}

const chartCount = 3
const metricCount = 10

function columnCount(width: number, thresholds: Array<[number, number]>) {
  for (const [minWidth, columns] of thresholds) {
    if (width >= minWidth) return columns
  }
  return 1
}

function scaleForFont(uiFontSize: number) {
  if (!Number.isFinite(uiFontSize) || uiFontSize <= 0) return 1
  return Math.max(1, Math.min(1.35, uiFontSize / 15))
}

function estimateHeight(
  metricColumns: number,
  chartColumns: number,
  chartHeight: number,
  scale: number,
  hasNotice: boolean,
) {
  const metricRows = Math.ceil(metricCount / metricColumns)
  const chartRows = Math.ceil(chartCount / chartColumns)
  const metricCardHeight = Math.round(88 * scale)
  const metricGap = 6
  const metricPadding = 16
  const noticeHeight = hasNotice ? Math.round(32 * scale) : 0
  const chartHeaderHeight = Math.round(32 * scale)
  const chartGap = 6
  const chartPaddingBottom = 14

  return (
    noticeHeight +
    metricRows * metricCardHeight +
    Math.max(0, metricRows - 1) * metricGap +
    metricPadding +
    chartRows * (chartHeaderHeight + chartHeight) +
    Math.max(0, chartRows - 1) * chartGap +
    chartPaddingBottom
  )
}

export function resolveMonitorOverviewLayout(
  width: number,
  height: number,
  uiFontSize = 15,
  options: MonitorOverviewLayoutOptions = {},
): MonitorOverviewLayout {
  const safeWidth = Math.max(0, Math.floor(width || 0))
  const safeHeight = Math.max(0, Math.floor(height || 0))
  const scale = scaleForFont(uiFontSize)
  const hasNotice = options.hasNotice ?? false
  const metricColumns = columnCount(safeWidth, [
    [1180, 5],
    [920, 4],
    [720, 3],
    [520, 2],
  ])
  const chartColumns = columnCount(safeWidth, [
    [1180, 3],
    [840, 2],
  ])
  const chartRows = Math.ceil(chartCount / chartColumns)
  const metricRows = Math.ceil(metricCount / metricColumns)
  const metricCardHeight = Math.round(88 * scale)
  const metricGap = 6
  const metricPadding = 16
  const noticeHeight = hasNotice ? Math.round(32 * scale) : 0
  const chartHeaderHeight = Math.round(32 * scale)
  const chartGap = 6
  const chartPaddingBottom = 14
  const nonChartHeight = (
    noticeHeight +
    metricRows * metricCardHeight +
    Math.max(0, metricRows - 1) * metricGap +
    metricPadding +
    chartRows * chartHeaderHeight +
    Math.max(0, chartRows - 1) * chartGap +
    chartPaddingBottom
  )
  const availableChartHeight = Math.floor((safeHeight - nonChartHeight) / chartRows)
  const preferredChartHeight = Math.round(210 * scale)
  const readableChartHeight = Math.round(160 * scale)

  if (safeWidth >= 1180 && availableChartHeight >= preferredChartHeight) {
    const estimatedContentHeight = estimateHeight(metricColumns, chartColumns, preferredChartHeight, scale, hasNotice)
    return {
      mode: 'overview-fit',
      metricColumns,
      chartColumns,
      chartHeight: preferredChartHeight,
      estimatedContentHeight,
    }
  }

  if (availableChartHeight >= readableChartHeight) {
    const chartHeight = Math.min(preferredChartHeight, availableChartHeight)
    const estimatedContentHeight = estimateHeight(metricColumns, chartColumns, chartHeight, scale, hasNotice)
    return {
      mode: 'compact-fit',
      metricColumns,
      chartColumns,
      chartHeight,
      estimatedContentHeight,
    }
  }

  const scrollChartHeight = Math.round(210 * scale)
  const estimatedContentHeight = estimateHeight(metricColumns, chartColumns, scrollChartHeight, scale, hasNotice)
  return {
    mode: 'scroll',
    metricColumns,
    chartColumns,
    chartHeight: scrollChartHeight,
    estimatedContentHeight,
  }
}
