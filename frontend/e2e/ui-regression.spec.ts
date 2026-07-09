import { expect, type Locator, type Page, test } from '@playwright/test'

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

async function openFixture(page: Page, fixture: string, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport)
  await page.goto(`/ui-regression.html?fixture=${fixture}`)
  await expect(page.locator(`[data-ui-fixture="${fixture}"]`)).toBeVisible()
}

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible()
  const value = await locator.boundingBox()
  expect(value, `Missing box for ${await locator.evaluate((node) => (node as HTMLElement).outerHTML.slice(0, 80))}`).not.toBeNull()
  return value!
}

function expectInside(parent: Box, child: Box, tolerance = 1) {
  expect(child.x).toBeGreaterThanOrEqual(parent.x - tolerance)
  expect(child.y).toBeGreaterThanOrEqual(parent.y - tolerance)
  expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width + tolerance)
  expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height + tolerance)
}

function expectNoOverlap(first: Box, second: Box) {
  const separated =
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  expect(separated).toBe(true)
}

async function dragLocator(page: Page, locator: Locator, deltaX: number, deltaY: number) {
  const bounds = await box(locator)
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 6 })
  await page.mouse.up()
}

function expectSubstantialOverlap(first: Box, second: Box) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x))
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y))
  expect(width).toBeGreaterThan(Math.min(first.width, second.width) * 0.8)
  expect(height).toBeGreaterThan(Math.min(first.height, second.height) * 0.8)
}

async function expectNoHorizontalShiftAfterScroll(row: Locator, scrollContainer: Locator) {
  const before = await box(row)
  await scrollContainer.evaluate((element) => {
    element.scrollTop = Math.min(220, element.scrollHeight - element.clientHeight)
  })
  const after = await box(row)
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
}

async function overflowY(locator: Locator) {
  return locator.evaluate((element) => window.getComputedStyle(element).overflowY)
}

async function expectBlurredTranslucentSurface(locator: Locator) {
  await expect(locator).toBeVisible()
  const styles = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
    }
  })
  expect(styles.backgroundColor).toMatch(/rgba\(/)
  const alpha = Number(styles.backgroundColor.match(/,\s*([.\d]+)\)$/)?.[1] ?? '1')
  expect(alpha).toBeLessThan(1)
  expect(styles.backdropFilter).toContain('blur(')
}

async function expectGlassBackdrop(locator: Locator) {
  await expect(locator).toBeVisible()
  const styles = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
    }
  })
  expect(styles.backgroundColor).toMatch(/rgba\(/)
  const alpha = Number(styles.backgroundColor.match(/,\s*([.\d]+)\)$/)?.[1] ?? '1')
  expect(alpha).toBeLessThanOrEqual(0.18)
}

async function expectAppBlurOverlay(page: Page, backdrop: Locator, surface: Locator) {
  await expectGlassBackdrop(backdrop)
  await expect(surface).toBeVisible()
  const visualRoot = page.locator('[data-testid="app-visual-root"]').first()
  await expect(visualRoot).toBeVisible()
  const overlayBox = await box(backdrop)
  const visualBox = await box(visualRoot)
  const surfaceBox = await box(surface)
  expectSubstantialOverlap(overlayBox, visualBox)
  expectSubstantialOverlap(overlayBox, surfaceBox)
  const styles = await visualRoot.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return { filter: style.filter }
  })
  expect(styles.filter).toContain('blur(')
  expect(styles.filter).toContain('brightness(')
  const surfaceState = await surface.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      filter: style.filter,
      insideVisualRoot: Boolean(element.closest('.app-visual-root')),
    }
  })
  expect(surfaceState.filter).toBe('none')
  expect(surfaceState.insideVisualRoot).toBe(false)
}

async function textRightGapToSeparator(control: Locator, separator: Locator) {
  const controlBox = await box(control)
  const separatorBox = await box(separator)
  const metrics = await control.evaluate((element) => {
    const select = element as HTMLSelectElement
    const style = window.getComputedStyle(select)
    const option = select.selectedOptions.item(0)
    const text = option?.textContent?.trim() || select.value
    const probe = document.createElement('span')
    probe.textContent = text
    probe.style.position = 'fixed'
    probe.style.left = '-10000px'
    probe.style.top = '0'
    probe.style.font = style.font
    probe.style.letterSpacing = style.letterSpacing
    probe.style.whiteSpace = 'nowrap'
    document.body.appendChild(probe)
    const textWidth = probe.getBoundingClientRect().width
    probe.remove()
    return {
      paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
      textWidth,
    }
  })
  return separatorBox.x - (controlBox.x + metrics.paddingLeft + metrics.textWidth)
}

test('ServerPicker search debian one result keeps the row complete without panel scrolling', async ({ page }) => {
  await openFixture(page, 'server-picker-search-debian')

  const panel = page.locator('.server-picker')
  const search = panel.locator('input')
  const actions = panel.locator('.server-picker-actions')
  const actionButtons = actions.locator('button')
  const actionSeparators = actions.locator('.action-separator')
  const dragHint = panel.locator('.server-picker-drag-hint')
  const groupTitle = panel.locator('.server-group header').first()
  const row = panel.locator('.server-row').filter({ hasText: 'debian-fixture' })
  const list = panel.locator('.server-picker-list')

  await expect(search).toBeVisible()
  await expect(actions).toBeVisible()
  await expect(actionButtons).toHaveCount(4)
  await expect(actions.locator('.app-icon')).toHaveCount(4)
  await expect(actionSeparators).toHaveCount(3)
  for (let index = 0; index < 3; index += 1) {
    await expect(actionSeparators.nth(index)).toHaveAttribute('aria-hidden', 'true')
    expect(await actionSeparators.nth(index).evaluate((element) => window.getComputedStyle(element).pointerEvents)).toBe('none')
  }
  await expect(dragHint).toBeVisible()
  await expect(groupTitle).toBeVisible()
  await expect(row).toBeVisible()

  const panelBox = await box(panel)
  const listBox = await box(list)
  const rowBox = await box(row)
  expectInside(panelBox, rowBox)
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1)
  expect(panelBox.y + panelBox.height - (rowBox.y + rowBox.height)).toBeLessThanOrEqual(20)
  expect(await list.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0)
  expect(Math.abs(rowBox.x - listBox.x)).toBeLessThanOrEqual(2)
  await expect(page).toHaveScreenshot('server-picker-search-debian.png')
})

test('ServerPicker many servers scrolls only the list and keeps rows aligned', async ({ page }) => {
  await openFixture(page, 'server-picker-many-servers')

  const panel = page.locator('.server-picker')
  const list = panel.locator('.server-picker-list')
  const actions = panel.locator('.server-picker-actions')
  const firstRow = panel.locator('.server-row').first()
  const lastRow = panel.locator('.server-row').last()

  await expect(actions).toBeVisible()
  expect(await panel.evaluate((element) => window.getComputedStyle(element).overflowY)).toBe('hidden')
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await overflowY(list)).toBe('auto')

  const listBox = await box(list)
  const viewportHeight = page.viewportSize()!.height
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(viewportHeight - 8)
  await expectNoHorizontalShiftAfterScroll(firstRow, list)
  await expect(lastRow).toBeVisible()
  await expect(actions).toBeVisible()
})

test('ServerPicker empty search keeps the empty state and local actions visible', async ({ page }) => {
  await openFixture(page, 'server-picker-search-empty')

  const panel = page.locator('.server-picker')
  const empty = panel.locator('.empty-side')
  const actions = panel.locator('.server-picker-actions')
  const cmd = actions.getByRole('button', { name: 'CMD' })
  const powershell = actions.getByRole('button', { name: 'PowerShell' })

  await expect(empty).toBeVisible()
  await expect(cmd).toBeVisible()
  await expect(powershell).toBeVisible()
  expectInside(await box(panel), await box(empty))
  expect(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  expect((await box(panel)).height).toBeLessThan(260)
})

test('macOS ServerPicker shows only the local terminal action with a blurred menu surface', async ({ page }) => {
  await openFixture(page, 'server-picker-macos-local')

  const panel = page.locator('.server-picker')
  const actions = panel.locator('.server-picker-actions')
  await expectBlurredTranslucentSurface(panel)
  await expect(actions.getByRole('button', { name: '本地终端' })).toBeVisible()
  await expect(actions.getByRole('button', { name: 'CMD' })).toHaveCount(0)
  await expect(actions.getByRole('button', { name: 'PowerShell' })).toHaveCount(0)
  await expect(actions.locator('button')).toHaveCount(3)
})

test('split-pane 2 empty centers each selector without hint/action overlap', async ({ page }) => {
  await openFixture(page, 'split-pane-two-empty')

  const panes = page.locator('.ui-fixture-pane')
  await expect(panes).toHaveCount(2)

  for (let index = 0; index < 2; index += 1) {
    const pane = panes.nth(index)
    const paneBox = await box(pane)
    const body = pane.locator('.terminal-pane-empty-body')
    const empty = pane.locator('.terminal-pane-empty')
    const message = pane.locator('.terminal-pane-empty-message')
    const actions = pane.locator('.terminal-pane-empty-actions')
    const actionButtons = actions.locator('button')
    const actionSeparators = actions.locator('.action-separator')
    const bodyBox = await box(body)
    const emptyBox = await box(empty)
    const messageBox = await box(message)
    const actionsBox = await box(actions)
    const bodyCenterY = bodyBox.y + bodyBox.height / 2
    const actionsCenterY = actionsBox.y + actionsBox.height / 2

    expectInside(paneBox, emptyBox)
    expectInside(bodyBox, actionsBox)
    expect(Math.abs((paneBox.x + paneBox.width / 2) - (emptyBox.x + emptyBox.width / 2))).toBeLessThanOrEqual(3)
    expect(Math.abs((paneBox.y + paneBox.height / 2) - (emptyBox.y + emptyBox.height / 2))).toBeLessThanOrEqual(3)
    expect(Math.abs(actionsCenterY - bodyCenterY)).toBeLessThanOrEqual(8)
    expectNoOverlap(messageBox, actionsBox)
    await expect(actionButtons).toHaveCount(2)
    await expect(actions.locator('.app-icon')).toHaveCount(2)
    await expect(actionSeparators).toHaveCount(1)
    expect(await empty.evaluate((element) => window.getComputedStyle(element).borderStyle)).not.toMatch(/dashed|dotted/)
  }
})

test('split-pane 4 empty narrow keeps all selectors inside their panes', async ({ page }) => {
  await openFixture(page, 'split-pane-quad-empty-narrow', { width: 800, height: 600 })

  const panes = page.locator('.ui-fixture-pane')
  await expect(panes).toHaveCount(4)

  for (let index = 0; index < 4; index += 1) {
    const pane = panes.nth(index)
    const body = pane.locator('.terminal-pane-empty-body')
    const actions = pane.locator('.terminal-pane-empty-actions')
    const actionButtons = actions.locator('button')
    const paneBox = await box(pane)
    const bodyBox = await box(body)
    const actionsBox = await box(actions)
    const actionsCenterY = actionsBox.y + actionsBox.height / 2
    const bodyCenterY = bodyBox.y + bodyBox.height / 2
    expectInside(paneBox, actionsBox)
    expectInside(bodyBox, actionsBox)
    expect(Math.abs(actionsCenterY - bodyCenterY)).toBeLessThanOrEqual(8)
    expect(Math.abs((actionsBox.x + actionsBox.width / 2) - (bodyBox.x + bodyBox.width / 2))).toBeLessThanOrEqual(8)
    await expect(actions.locator('.action-separator')).toHaveCount(1)
    const xPositions = []
    for (let actionIndex = 0; actionIndex < 2; actionIndex += 1) {
      xPositions.push((await box(actionButtons.nth(actionIndex))).x)
    }
    expect(xPositions[0]).toBeLessThan(xPositions[1])
    expect(actionsBox.y).toBeGreaterThan(paneBox.y + 20)
    expect(await actions.evaluate((element) => window.getComputedStyle(element).borderStyle)).not.toMatch(/dashed|dotted/)
    expect(await actions.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true)
  }
  await expect(page).toHaveScreenshot('split-pane-quad-empty-narrow.png')
})

test('compact network card keeps max avg min values in a left gutter without visible labels above the chart', async ({ page }) => {
  await openFixture(page, 'compact-network-card-stats', { width: 520, height: 760 })

  const shell = page.locator('[data-testid="compact-network-card-stats"]')
  const titleCluster = shell.locator('.network-title-cluster')
  const title = titleCluster.locator('strong')
  const rateCluster = shell.locator('.network-rate-cluster')
  const download = rateCluster.locator('.network-current-rate.download')
  const upload = rateCluster.locator('.network-current-rate.upload')
  const controls = titleCluster.locator('.network-controls')
  const interfaceSelect = controls.locator('select')
  const controlsSeparator = controls.locator('.network-inline-separator')
  const refresh = controls.locator('.network-icon-button')
  const systemSummary = shell.locator('.system-info-summary')
  const systemSummaryText = systemSummary.locator('.system-info-summary-text')
  const systemChevron = systemSummary.locator('.system-info-summary-chevron')
  const trigger = shell.locator('.network-chart-trigger')
  const stats = trigger.locator('.network-stat-column')
  const statValues = stats.locator('.network-stat-value')
  const plot = trigger.locator('.network-chart-plot')
  const sparkline = plot.locator('.mini-sparkline')
  const baseline = sparkline.locator('line')
  const paths = plot.locator('.sparkline-path')
  const flowAnimations = plot.locator('animate[attributeName="stroke-dashoffset"]')

  await expect(titleCluster).toBeVisible()
  await expect(download).toBeVisible()
  await expect(upload).toBeVisible()
  await expect(controls).toBeVisible()
  await expect(titleCluster.locator('.network-inline-separator')).toBeVisible()
  await expect(rateCluster.locator('.network-inline-separator')).toBeVisible()
  await expect(systemSummaryText).toBeVisible()
  await expect(systemChevron).toBeVisible()
  await expect(systemChevron.locator('.app-icon')).toBeVisible()
  const systemSummaryBox = await box(systemSummary)
  const systemChevronBox = await box(systemChevron)
  const systemChevronIconBox = await box(systemChevron.locator('.app-icon'))
  expect(systemChevronBox.width).toBeGreaterThanOrEqual(24)
  expect(systemSummaryBox.x + systemSummaryBox.width - (systemChevronBox.x + systemChevronBox.width)).toBeGreaterThanOrEqual(7)
  expect(systemSummaryBox.x + systemSummaryBox.width - (systemChevronBox.x + systemChevronBox.width)).toBeLessThanOrEqual(12)
  expect(Math.abs((systemChevronBox.y + systemChevronBox.height / 2) - (systemSummaryBox.y + systemSummaryBox.height / 2))).toBeLessThanOrEqual(2)
  expect(Math.abs((systemChevronIconBox.y + systemChevronIconBox.height / 2) - (systemSummaryBox.y + systemSummaryBox.height / 2))).toBeLessThanOrEqual(1)
  expect((await box(systemSummaryText)).x + (await box(systemSummaryText)).width).toBeLessThanOrEqual(systemChevronBox.x - 4)
  const titleBox = await box(title)
  const controlsBox = await box(controls)
  const downloadBox = await box(download)
  const uploadBox = await box(upload)
  expect(Math.abs(titleBox.y - controlsBox.y)).toBeLessThanOrEqual(4)
  expect(Math.abs(uploadBox.y - downloadBox.y)).toBeLessThanOrEqual(2)
  expect(titleBox.x).toBeLessThan(controlsBox.x)
  expect(uploadBox.x).toBeLessThan(downloadBox.x)
  const selectBox = await box(interfaceSelect)
  const controlsSeparatorBox = await box(controlsSeparator)
  const refreshBox = await box(refresh)
  expect(controlsBox.width).toBeLessThanOrEqual(78)
  expect(await textRightGapToSeparator(interfaceSelect, controlsSeparator)).toBeLessThanOrEqual(8)
  expect(controlsSeparatorBox.x - (selectBox.x + selectBox.width)).toBeLessThanOrEqual(6)
  expect(refreshBox.x - (controlsSeparatorBox.x + controlsSeparatorBox.width)).toBeLessThanOrEqual(8)
  expect((await box(rateCluster)).x).toBeGreaterThan((await box(titleCluster)).x + (await box(titleCluster)).width)
  expect(await interfaceSelect.evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
  expect(await refresh.evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
  await expect(trigger).toBeVisible()
  await expect(trigger.locator('.network-rate-row')).toHaveCount(0)
  await expect(stats).toBeVisible()
  await expect(statValues).toHaveCount(3)
  await expect(statValues).toHaveText(['136.61 MB/s', '56.78 MB/s', '4.77 MB/s'])
  await expect(trigger.locator('.network-stat-row')).toHaveCount(0)
  await expect(trigger).not.toContainText(/最高|平均|最低/)

  const statsBox = await box(stats)
  const plotBox = await box(plot)
  const triggerBox = await box(trigger)
  const sparklineBox = await box(sparkline)
  const baselineY = await baseline.evaluate((element) => Number(element.getAttribute('y1')))
  expect(statsBox.width).toBeGreaterThanOrEqual(54)
  expect(statsBox.width).toBeLessThanOrEqual(88)
  const plotGap = plotBox.x - (statsBox.x + statsBox.width)
  expect(plotGap).toBeGreaterThanOrEqual(4)
  expect(plotGap).toBeLessThanOrEqual(8)
  expectInside(plotBox, sparklineBox)
  expect(sparklineBox.height).toBeGreaterThanOrEqual(98)
  expect(sparklineBox.height).toBeLessThanOrEqual(104)
  expect(triggerBox.y + triggerBox.height - (sparklineBox.y + sparklineBox.height)).toBeLessThanOrEqual(8)
  expect(baselineY).toBeLessThanOrEqual(25.5)
  for (let index = 0; index < 3; index += 1) {
    const valueBox = await box(statValues.nth(index))
    expectInside(statsBox, valueBox, 2)
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(plotBox.x - 2)
  }
  await expect(paths).toHaveCount(2)
  await expect(sparkline).toHaveClass(/is-flowing/)
  await expect(sparkline).toHaveClass(/is-visual-interpolated/)
  await expect(sparkline.locator('mask[id^="mini-sparkline-left-fade"]')).toHaveCount(1)
  await expect(flowAnimations).toHaveCount(0)
  for (let index = 0; index < 2; index += 1) {
    const path = paths.nth(index)
    expect(await path.evaluate((element) => window.getComputedStyle(element).strokeDasharray)).toBe('none')
    await expect(path).toHaveAttribute('stroke-linecap', 'round')
    await expect(path).toHaveAttribute('stroke-linejoin', 'round')
  }

  const resourceRows = shell.locator('.compact-resource .resource-line')
  const resourceProgresses = shell.locator('.compact-resource .metric-progress')
  await expect(resourceRows).toHaveCount(4)
  await expect(resourceProgresses).toHaveCount(4)
  for (let index = 0; index < 4; index += 1) {
    const row = resourceRows.nth(index)
    const label = row.locator('strong')
    const percent = row.locator('span')
    const capacity = row.locator('small')
    expect(await label.evaluate((element) => parseFloat(window.getComputedStyle(element).fontSize))).toBeLessThanOrEqual(14)
    expect(await percent.evaluate((element) => parseFloat(window.getComputedStyle(element).fontSize))).toBeLessThanOrEqual(16)
    if (await capacity.count()) {
      expect(await capacity.evaluate((element) => parseFloat(window.getComputedStyle(element).fontSize))).toBeLessThanOrEqual(13)
      expect((await box(capacity)).x + (await box(capacity)).width).toBeLessThanOrEqual((await box(row)).x + (await box(row)).width + 1)
    }
  }
  for (let index = 0; index < 4; index += 1) {
    await expect(resourceProgresses.nth(index)).toBeVisible()
  }
})

test('compact network card keeps longer interface names tight before the separator', async ({ page }) => {
  await openFixture(page, 'compact-network-card-stats-ens192', { width: 520, height: 760 })

  const shell = page.locator('[data-testid="compact-network-card-stats"]')
  const controls = shell.locator('.network-controls')
  const interfaceSelect = controls.locator('select')
  const controlsSeparator = controls.locator('.network-inline-separator')
  const refresh = controls.locator('.network-icon-button')
  const upload = shell.locator('.network-rate-cluster .network-current-rate.upload')
  const download = shell.locator('.network-rate-cluster .network-current-rate.download')

  await expect(interfaceSelect).toHaveValue('ens192')
  expect(await textRightGapToSeparator(interfaceSelect, controlsSeparator)).toBeLessThanOrEqual(8)
  expect((await box(refresh)).x - ((await box(controlsSeparator)).x + (await box(controlsSeparator)).width)).toBeLessThanOrEqual(8)
  expect((await box(upload)).x).toBeLessThan((await box(download)).x)
})

test('local CMD and PowerShell workspaces keep monitor and Local Explorer visible', async ({ page }) => {
  for (const fixture of ['local-terminal-cmd-workspace', 'local-terminal-powershell-workspace']) {
    await openFixture(page, fixture, { width: 1180, height: 720 })

    const shell = page.locator('[data-testid="local-terminal-workspace"]')
    const monitor = shell.locator('.local-monitor-sidebar')
    const monitorBody = monitor.locator('.compact-monitor')
    const explorer = shell.locator('.local-explorer-panel')
    const terminal = shell.locator('.local-terminal-view-stub')
    await expect(monitor).toBeVisible()
    await expect(explorer).toBeVisible()
    await expect(terminal).toBeVisible()
    await expect(shell.locator('.sftp-panel')).toHaveCount(0)
    await expect(explorer).not.toContainText('未连接服务器')
    await expect(explorer).not.toContainText('Windows 本地资源管理器')

    const shellBox = await box(shell)
    const monitorBox = await box(monitor)
    const explorerBox = await box(explorer)
    const terminalBox = await box(terminal)
    expectInside(shellBox, monitorBox)
    expectInside(shellBox, explorerBox)
    expectInside(shellBox, terminalBox)
    expect(monitorBox.width).toBeGreaterThanOrEqual(280)
    expect(monitorBox.height).toBeGreaterThanOrEqual(shellBox.height - 2)
    await expect(monitorBody).toBeVisible()
    expect(await overflowY(monitorBody)).toBe('auto')
    await expect(monitor.locator('.compact-server-header')).toBeVisible()
    const systemInfo = monitor.locator('.local-system-info')
    await expect(systemInfo).toBeVisible()
    await expect(systemInfo.locator('.system-info-summary')).toHaveAttribute('aria-expanded', 'false')
    await expect(systemInfo.locator('.local-system-detail')).toHaveCount(0)
    await expect(systemInfo).not.toContainText('Build 22631')
    await expect(systemInfo).not.toContainText('logical CPUs')
    await expect(monitor.locator('.compact-resource')).toHaveCount(3)
    await expect(monitor.locator('[data-testid="local-gpu-card"]')).toBeVisible()
    await expect(monitor).not.toContainText('Pagefile')
    await expect(monitor).not.toContainText('Swap')
    await expect(monitor.locator('.local-network-compact')).toBeVisible()
    await expect(monitor.locator('.local-network-compact .network-chart-body')).toBeVisible()
    await expect(shell.locator('.horizontal-splitter .sftp-toggle-handle')).toHaveCount(0)
    await expect(explorer.locator('.local-explorer-toolbar .sftp-toggle-handle')).toHaveCount(0)
    const bottomSplitter = shell.locator('.right-workspace > .horizontal-splitter')
    await expect(bottomSplitter).toBeVisible()
    await expect(bottomSplitter.locator('.bottom-panel-toggle-handle')).toHaveCount(0)
    await expect(bottomSplitter.locator('svg.splitter-chevron')).toHaveCount(0)
    const commandButton = shell.locator('.terminal-command-button')
    await expect(commandButton).toBeVisible()
    await commandButton.click()
    await expect(page.locator('[data-testid="local-command-palette"]')).toBeVisible()
    expect(explorerBox.y).toBeGreaterThan(terminalBox.y)
    expectNoOverlap(monitorBox, explorerBox)
    const toolbar = explorer.locator('.local-explorer-toolbar')
    const pathInput = toolbar.locator('.local-explorer-path')
    const pathControl = toolbar.locator('.local-explorer-path input')
    const filterInput = toolbar.locator('.local-explorer-filter')
    const navActions = toolbar.locator('.local-explorer-nav-actions')
    await expect(toolbar).toBeVisible()
    await expect(navActions).toBeVisible()
    await expect(pathControl).toHaveValue('C:\\Temp\\Fixture')
    expect((await box(pathInput)).x).toBeLessThan((await box(navActions)).x)
    expect((await box(filterInput)).x).toBeLessThan((await box(navActions)).x)
    expect((await box(pathInput)).width).toBeLessThanOrEqual((await box(toolbar)).width * 0.5)
    await expect(toolbar.locator('.local-explorer-nav-actions .sftp-toolbar-action-separator')).toHaveCount(4)
    await expect(toolbar.locator('.local-explorer-nav-actions .action-separator')).toHaveCount(0)
    const separatorHeights = []
    for (let index = 0; index < 4; index += 1) {
      separatorHeights.push((await box(toolbar.locator('.local-explorer-nav-actions .sftp-toolbar-action-separator').nth(index))).height)
    }
    expect(Math.max(...separatorHeights) - Math.min(...separatorHeights)).toBeLessThanOrEqual(2)
    await toolbar.getByRole('button', { name: 'Home' }).click()
    await expect(pathControl).toHaveValue('C:\\Users\\Fixture')
    for (const action of await navActions.locator('button').all()) {
      expect(await action.evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
    }

    const table = explorer.locator('[data-testid="local-explorer-table"]')
    await expect(table).toHaveClass(/sftp-table/)
    await expect(table.locator('.sftp-row')).toHaveCount(4)
    await expect(table.locator('[data-testid="sftp-column-sort-name"]')).toBeVisible()
    await expect(table.locator('[data-testid="sftp-column-sort-modTime"]')).toBeVisible()
    await expect(table.locator('[data-testid="sftp-column-resize-name"]')).toBeVisible()
    await table.locator('[data-testid="sftp-column-sort-modTime"]').click()
    await expect(table.locator('[data-testid="sftp-column-sort-modTime"]')).toHaveAttribute('aria-sort', 'ascending')

    const firstRow = table.locator('.sftp-row').first()
    const beforeGrid = await firstRow.getAttribute('style')
    const resizerBox = await box(table.locator('[data-testid="sftp-column-resize-name"]'))
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 36, resizerBox.y + resizerBox.height / 2)
    await page.mouse.up()
    expect(await firstRow.getAttribute('style')).not.toBe(beforeGrid)
  }
})

test('macOS local terminal workspace keeps monitor and local file manager visible without Windows shell labels', async ({ page }) => {
  await openFixture(page, 'local-terminal-macos-workspace', { width: 1180, height: 720 })

  const shell = page.locator('[data-testid="local-terminal-workspace"]')
  const monitor = shell.locator('.local-monitor-sidebar')
  const explorer = shell.locator('.local-explorer-panel')
  const terminal = shell.locator('.local-terminal-view-stub')
  await expect(monitor).toBeVisible()
  await expect(explorer).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(terminal).toContainText('本地终端')
  await expect(shell).not.toContainText('CMD')
  await expect(shell).not.toContainText('PowerShell')
  await expect(shell).not.toContainText('Windows')
  await expect(monitor).toContainText('macOS')
  await expect(monitor.locator('[data-testid="local-gpu-card"]')).toHaveCount(0)
  await expect(explorer.locator('.local-explorer-path input')).toHaveValue('/Users/fixture')
  await explorer.getByRole('button', { name: 'Home' }).click()
  await expect(explorer.locator('.local-explorer-path input')).toHaveValue('/Users/fixture')
})

test('local workspace monitor uses GPU, filtered default-route interfaces, filled cards, and taller network chart', async ({ page }) => {
  for (const fixture of ['local-terminal-cmd-workspace', 'local-terminal-powershell-workspace']) {
    await openFixture(page, fixture, { width: 1180, height: 720 })

    const shell = page.locator('[data-testid="local-terminal-workspace"]')
    const monitor = shell.locator('.local-monitor-sidebar')
    await expect(monitor).toBeVisible()
    await expect(monitor).toContainText('GPU')
    await expect(monitor).toContainText('Fixture GPU')
    await expect(monitor.locator('[data-testid="local-gpu-card"]')).toContainText('34.0%')
    await expect(monitor.locator('[data-testid="local-gpu-card"]')).not.toContainText('使用率不可用')
    await expect(monitor).not.toContainText('OrayIddDriver Device')
    await expect(monitor.locator('[data-testid="local-gpu-card"]')).not.toContainText('—')
    await expect(monitor).not.toContainText('Pagefile')
    await expect(monitor).not.toContainText('Swap')
    const diskCard = monitor.locator('[data-testid="local-disk-card"]')
    await expect(diskCard).toBeVisible()
    await expect(diskCard).toHaveClass(/mount-panel/)
    await expect(diskCard.locator('.mount-list article')).toHaveCount(2)
    await expect(diskCard.locator('.mount-list article').first()).toContainText('C:')
    await expect(diskCard.locator('.mount-list article').first()).toContainText('44.5%')
    await expect(diskCard.locator('.mount-list article').first()).toContainText('165.99 GB / 299.06 GB')
    await expect(diskCard.locator('.mount-list article').first().locator('.mount-progress i')).toHaveAttribute('style', /width:\s*44\.5%/)
    await expect(diskCard.locator('.mount-list article').first()).not.toContainText('133.07 GB / 299.06 GB')
    const processCard = monitor.locator('[data-testid="local-process-card"]')
    await expect(processCard).toBeVisible()
    await expect(processCard).toContainText('fixture.exe')
    await expect(processCard).toContainText('PID 100')
    await expect(processCard).toContainText('64.0 MB')
    await expect(processCard).not.toContainText('unavailable')

    const select = monitor.locator('[data-testid="local-network-interface-select"]')
    await expect(select).toBeVisible()
    await expect(select).toHaveValue('Wi-Fi')
    const optionLabels = await select.locator('option').allTextContents()
    expect(optionLabels).toEqual(['Wi-Fi', 'Ethernet'])
    expect(optionLabels.join(' ')).not.toContain('Packet Driver')
    expect(optionLabels.join(' ')).not.toContain('Teredo')
    await select.selectOption('Ethernet')
    await expect(monitor.locator('[data-testid="local-network-current"]')).toContainText('Ethernet')
    await select.selectOption('Wi-Fi')
    await expect(monitor.locator('[data-testid="local-network-current"]')).toContainText('Wi-Fi')

    const stats = monitor.locator('[data-testid="local-network-stats"] .network-stat-value')
    await expect(stats).toHaveCount(3)
    await expect(monitor.locator('[data-testid="local-network-stats"]')).not.toContainText('Local')
    const sparkline = monitor.locator('.network-chart-plot .mini-sparkline')
    expect((await box(sparkline)).height).toBeGreaterThanOrEqual(98)

    const systemInfo = monitor.locator('.local-system-info')
    const summary = systemInfo.locator('.system-info-summary')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    await expect(systemInfo.locator('.local-system-detail')).toHaveCount(0)
    await expect(systemInfo).not.toContainText('Build 22631')
    await summary.click()
    await expect(systemInfo.locator('.local-system-detail')).toBeVisible()
    await expect(systemInfo).toContainText('Build 22631')
    await expect(systemInfo).toContainText('amd64')
    await expect(systemInfo).toContainText('16 logical CPUs')
    await expect(systemInfo).toContainText('16.00 GB RAM')
    await expect(systemInfo).toContainText('Uptime')
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await summary.click()
    await expect(systemInfo.locator('.local-system-detail')).toHaveCount(0)
    await expect(systemInfo).not.toContainText('Build 22631')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')

    await shell.getByRole('tab', { name: 'SSH' }).click()
    await shell.getByRole('tab', { name: fixture === 'local-terminal-powershell-workspace' ? 'PowerShell' : 'CMD' }).click()
    await expect(systemInfo.locator('.local-system-detail')).toHaveCount(0)
    await expect(systemInfo).not.toContainText('Build 22631')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')

    await summary.click()
    await expect(systemInfo.locator('.local-system-detail')).toBeVisible()
    await shell.getByRole('tab', { name: 'SSH' }).click()
    await shell.getByRole('tab', { name: fixture === 'local-terminal-powershell-workspace' ? 'PowerShell' : 'CMD' }).click()
    await expect(systemInfo.locator('.local-system-detail')).toBeVisible()
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
  }
})

test('local workspace monitor labels unavailable GPU usage without showing virtual GPU names', async ({ page }) => {
  await openFixture(page, 'local-terminal-gpu-unavailable', { width: 1180, height: 720 })

  const monitor = page.locator('[data-testid="local-terminal-workspace"] .local-monitor-sidebar')
  const gpuCard = monitor.locator('[data-testid="local-gpu-card"]')
  await expect(gpuCard).toBeVisible()
  await expect(gpuCard).toContainText('Fixture GPU')
  await expect(gpuCard).toContainText('使用率不可用')
  await expect(gpuCard).not.toContainText('OrayIddDriver Device')
  await expect(gpuCard).not.toContainText('—')
})

test('monitor panels share process, disk, and network layout contracts across Windows and Linux', async ({ page }) => {
  await openFixture(page, 'local-terminal-cmd-workspace', { width: 1180, height: 720 })
  const localMonitor = page.locator('[data-testid="local-terminal-workspace"] .local-monitor-sidebar')
  const localProcessCard = localMonitor.locator('[data-testid="local-process-card"]')
  await expect(localMonitor.locator('[data-testid="local-gpu-card"]')).toBeVisible()
  await expect(localMonitor).not.toContainText('Swap')
  await expect(localProcessCard).toHaveClass(/process-panel/)
  await expect(localProcessCard.locator('.process-sort-options button').nth(1)).toHaveClass(/active/)
  await expect(localProcessCard.locator('.local-process-row').first()).toContainText('fixture.exe')
  const localDiskRow = localMonitor.locator('[data-testid="local-disk-card"] .mount-list article').first()
  await expect(localDiskRow.locator('.mount-progress span')).toContainText('165.99 GB / 299.06 GB')
  await expect(localMonitor.locator('.local-network-compact .network-stat-value')).toHaveCount(3)
  await expect(localMonitor.locator('.local-network-compact .network-chart-plot .mini-sparkline')).toBeVisible()
  const localDiskHeight = (await box(localDiskRow)).height

  await openFixture(page, 'compact-network-card-stats', { width: 520, height: 760 })
  const linuxMonitor = page.locator('[data-testid="compact-network-card-stats"]')
  await expect(linuxMonitor).toContainText('Swap')
  await expect(linuxMonitor).not.toContainText('GPU')
  const remoteProcessCard = linuxMonitor.locator('.process-panel')
  await expect(remoteProcessCard.locator('.process-sort-options button').nth(1)).toHaveClass(/active/)
  await expect(remoteProcessCard.locator('.process-row').first()).toContainText('memory-heavy')
  const remoteDiskRows = linuxMonitor.locator('.mount-list article')
  await expect(remoteDiskRows).toHaveCount(2)
  await expect(remoteDiskRows.first()).toContainText('/')
  await expect(remoteDiskRows.first().locator('.mount-progress span')).toContainText('45.00 GB / 100.00 GB')
  await expect(linuxMonitor.locator('.network-stat-value')).toHaveCount(3)
  await expect(linuxMonitor.locator('.network-chart-plot .mini-sparkline')).toBeVisible()
  expect(Math.abs((await box(remoteDiskRows.first())).height - localDiskHeight)).toBeLessThanOrEqual(4)
})

test('local CMD and PowerShell command history appears in the command palette and inserts into the current terminal', async ({ page }) => {
  for (const fixture of ['local-terminal-cmd-workspace', 'local-terminal-powershell-workspace']) {
    await openFixture(page, fixture, { width: 1180, height: 720 })

    const commands = fixture === 'local-terminal-powershell-workspace'
      ? [{ raw: '\x1b[IGet-ChildItem', expected: 'Get-ChildItem' }]
      : [
          { raw: '\x1b[Ipwd', expected: 'pwd' },
          { raw: '\x1b[Ils', expected: 'ls' },
        ]
    const shell = page.locator('[data-testid="local-terminal-workspace"]')
    const input = shell.locator('[data-testid="local-terminal-command-input"]')
    for (const command of commands) {
      await input.evaluate((element, value) => {
        const target = element as HTMLInputElement
        target.value = value
        target.dispatchEvent(new Event('input', { bubbles: true }))
      }, command.raw)
      await input.press('Enter')
      await expect(input).toHaveValue('')
    }

    await page.reload()
    const reloadedShell = page.locator('[data-testid="local-terminal-workspace"]')
    const reloadedInput = reloadedShell.locator('[data-testid="local-terminal-command-input"]')
    await expect(reloadedShell).toBeVisible()
    await expect(reloadedInput).toBeVisible()

    await reloadedShell.locator('.terminal-command-button').click()
    const palette = reloadedShell.locator('[data-testid="local-command-palette"]')
    const history = palette.locator('[data-testid="local-command-history-list"]')
    await expect(palette).toBeVisible()
    for (const command of commands) {
      await expect(history).toContainText(command.expected)
      await expect(history).not.toContainText(`[I${command.expected}`)
    }
    if (fixture === 'local-terminal-powershell-workspace') {
      await expect(history).not.toContainText('pwd')
      await expect(history).not.toContainText('ls')
    } else {
      await expect(history).not.toContainText('Get-ChildItem')
    }
    await history.getByRole('button', { name: commands[0].expected }).click()
    await expect(reloadedInput).toHaveValue(commands[0].expected)
  }
})

test('local and SSH workspaces share the bottom panel collapse state', async ({ page }) => {
  await openFixture(page, 'local-terminal-cmd-workspace', { width: 1180, height: 720 })

  const shell = page.locator('[data-testid="local-terminal-workspace"]')
  const splitter = shell.locator('.right-workspace > .horizontal-splitter')
  await expect(splitter).toBeVisible()
  await expect(splitter.locator('.bottom-panel-toggle-handle')).toHaveCount(0)
  await expect(shell.locator('.local-explorer-panel')).toBeVisible()
  await dragLocator(page, splitter, 0, 160)
  await expect(shell.locator('.local-explorer-panel')).toBeHidden()

  await shell.getByRole('tab', { name: 'SSH' }).click()
  await expect(shell.locator('.sftp-panel')).toBeHidden()

  await dragLocator(page, splitter, 0, -220)
  await expect(shell.locator('.sftp-panel')).toBeVisible()

  await shell.getByRole('tab', { name: 'CMD' }).click()
  await expect(shell.locator('.local-explorer-panel')).toBeVisible()
})

test('local explorer supports parent row, file open, and local-only context menus', async ({ page }) => {
  for (const fixture of ['local-terminal-cmd-workspace', 'local-terminal-powershell-workspace']) {
    await openFixture(page, fixture, { width: 1180, height: 720 })

    const explorer = page.locator('[data-testid="local-terminal-workspace"] .local-explorer-panel')
    const table = explorer.locator('[data-testid="local-explorer-table"]')
    const rows = table.locator('[data-testid="sftp-entry-row"]')
    await expect(rows.first()).toContainText('..')

    await rows.filter({ hasText: 'notes.txt' }).dblclick()
    await expect(page.locator('[data-testid="local-explorer-open-count"]')).toHaveText('1')

    await rows.filter({ hasText: 'notes.txt' }).click({ button: 'right' })
    const menu = page.locator('.context-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('打开')
    await expect(menu).toContainText('在资源管理器中显示')
    await expect(menu).toContainText('复制路径')
    await expect(menu).toContainText('复制名称')
    await expect(menu).toContainText('属性')
    await expect(menu).toContainText('刷新')
    await expect(menu).not.toContainText('上传')
    await expect(menu).not.toContainText('下载')
    await menu.getByRole('menuitem', { name: '打开' }).click()
    await expect(page.locator('[data-testid="local-explorer-open-count"]')).toHaveText('2')

    await rows.first().dblclick()
    await expect(explorer.locator('.local-explorer-path input')).toHaveValue('C:\\Temp')
  }
})

test('workspace tabs many keeps close gap compact and close click isolated', async ({ page }) => {
  await openFixture(page, 'workspace-tabs-many')

  const tabs = page.locator('.terminal-tab')
  const topbar = page.locator('.workspace-topbar')
  const add = page.locator('.topbar-add')
  const longTab = page.locator('[data-tab-id="tab-long"]')
  const ipTab = page.locator('[data-tab-id="tab-ip"]')
  const close = ipTab.locator('.terminal-close')

  await expect(tabs).toHaveCount(12)
  await expect(add).toBeVisible()
  expect((await box(topbar)).height).toBeLessThanOrEqual(36)
  expect((await box(ipTab)).height).toBeLessThanOrEqual(31)
  expect((await box(ipTab)).width).toBeLessThanOrEqual(210)
  expect(await longTab.locator('.terminal-tab-title').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)

  const ipBox = await box(ipTab)
  const closeBox = await box(close)
  expect(ipBox.x + ipBox.width - (closeBox.x + closeBox.width)).toBeLessThanOrEqual(10)
  await close.click()
  await expect(page.locator('[data-testid="tabs-close-count"]')).toHaveText('1')
  await expect(ipTab).not.toHaveClass(/active/)
})

test('topbar menu uses icon option items without dropdown separators', async ({ page }) => {
  await openFixture(page, 'workspace-tabs-many')

  await page.locator('.topbar-navigation > button').click()
  const splitButton = page.locator('.topbar-split .split-mode-button')
  const splitToggle = page.locator('[data-split-menu-toggle]')
  const menuButton = page.locator('.topbar-navigation > button')
  const menuInner = menuButton.locator('.topbar-action-inner')
  const topbarSeparator = page.locator('.topbar-action-separator')
  const menu = page.locator('.topbar-menu')
  const items = menu.locator('.topbar-menu-item')
  const centeredContent = menu.locator('.topbar-menu-content')
  const labels = menu.locator('.topbar-menu-label')
  const icons = menu.locator('.app-icon')
  const separators = menu.locator('.topbar-menu-separator')
  await expect(splitButton).toBeVisible()
  await expect(splitToggle).toHaveCount(0)
  await expect(menuButton.locator('.app-icon')).toHaveCount(1)
  await expect(menuInner).toBeVisible()
  await menuButton.hover()
  expect((await box(menuInner)).height).toBeLessThan((await box(menuButton)).height)
  expect((await box(menuInner)).width).toBeLessThan((await box(menuButton)).width)
  expect(await menuInner.evaluate((element) => window.getComputedStyle(element).borderRadius)).toBe('8px')
  await expect(topbarSeparator).toHaveCount(1)
  await expect(items).toHaveCount(9)
  await expect(icons).toHaveCount(9)
  await expect(centeredContent).toHaveCount(9)
  await expect(labels).toHaveText([
    'SSH 工作区',
    '端口转发',
    '容器管理',
    '进程管理',
    '系统服务',
    '网络详情',
    '告警中心',
    '监控面板',
    '设置',
  ])
  await expect(menu).not.toContainText('应用日志')
  await expect(separators).toHaveCount(0)
  await expect(menu.locator('.topbar-menu-badge')).toBeVisible()
  const menuBox = await box(menu)
  expect(menuBox.width).toBeGreaterThanOrEqual(176)
  expect(menuBox.width).toBeLessThanOrEqual(184)
  await expect(menu).toHaveCSS('min-width', '180px')
  await expect(menu).toHaveCSS('max-width', '180px')
  for (let index = 0; index < await items.count(); index += 1) {
    const itemBox = await box(items.nth(index))
    const contentBox = await box(centeredContent.nth(index))
    const label = labels.nth(index)
    expect(itemBox.x).toBeGreaterThanOrEqual(menuBox.x - 1)
    expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(menuBox.x + menuBox.width + 1)
    expect(Math.abs((itemBox.x + itemBox.width / 2) - (contentBox.x + contentBox.width / 2))).toBeLessThanOrEqual(2)
    expect(await label.evaluate((element) => window.getComputedStyle(element).textOverflow)).not.toBe('ellipsis')
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
  const alertItem = items.nth(6)
  const alertContent = alertItem.locator('.topbar-menu-content')
  const alertBadge = alertItem.locator('.topbar-menu-badge')
  expect((await box(alertBadge)).x).toBeGreaterThan((await box(alertContent)).x + (await box(alertContent)).width)

  const firstItemBorder = await items.first().evaluate((element) => window.getComputedStyle(element).borderStyle)
  expect(firstItemBorder).toBe('none')
})

test('macOS dark settings radios and overlay menus use visible checked state and blur surfaces', async ({ page }) => {
  await openFixture(page, 'settings-macos-dark-overlays', { width: 900, height: 640 })

  const checkedRadio = page.locator('[data-testid="macos-dark-radio-checked"]')
  await expect(checkedRadio).toBeChecked()
  const radioStyle = await checkedRadio.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
    }
  })
  expect(radioStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(radioStyle.backgroundImage).toContain('radial-gradient')
  expect(radioStyle.boxShadow).toContain('159, 195, 255')

  const checkedCheckbox = page.locator('[data-testid="macos-dark-checkbox-checked"]')
  await expect(checkedCheckbox).toBeChecked()
  const checkboxStyle = await checkedCheckbox.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
    }
  })
  expect(checkboxStyle.backgroundColor).toBe('rgb(47, 109, 242)')
  expect(checkboxStyle.backgroundImage).toContain('data:image/svg+xml')
  expect(checkboxStyle.boxShadow).toContain('159, 195, 255')

  for (const selector of [
    '.topbar-menu',
    '.settings-page-overlay',
    '.settings-page-overlay .settings-page-header',
    '.settings-page-overlay .settings-category-nav',
  ]) {
    await expectBlurredTranslucentSurface(page.locator(selector).first())
  }
  await expectAppBlurOverlay(
    page,
    page.locator('.settings-overlay-backdrop').first(),
    page.locator('.settings-page-overlay').first(),
  )
  await expectAppBlurOverlay(
    page,
    page.locator('.app-dialog-backdrop').first(),
    page.locator('.app-dialog').first(),
  )
})

test('macOS app dialogs use glass backdrops without full-screen gray wash', async ({ page }) => {
  for (const fixture of ['connection-dialog-password', 'connection-dialog-advanced', 'connection-dialog-keyvault'] as const) {
    await openFixture(page, fixture, { width: 900, height: 640 })
    await expectAppBlurOverlay(
      page,
      page.locator('.modal-backdrop').first(),
      page.locator('.connection-modal').first(),
    )
  }
})

test('command floating button drags inside workspace and snaps to nearest edge', async ({ page }) => {
  await openFixture(page, 'command-button-dock', { width: 900, height: 620 })

  const stage = page.locator('[data-testid="command-button-dock-stage"]')
  const button = stage.locator('.terminal-command-button')
  await expect(button).toBeVisible()
  expectInside(await box(stage), await box(button))

  const start = await box(button)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move((await box(stage)).x + 18, start.y + 20, { steps: 6 })
  await page.mouse.up()
  const leftDocked = await box(button)
  const stageBox = await box(stage)
  expect(leftDocked.x - stageBox.x).toBeLessThanOrEqual(16)
  expectInside(stageBox, leftDocked)

  await page.mouse.move(leftDocked.x + leftDocked.width / 2, leftDocked.y + leftDocked.height / 2)
  await page.mouse.down()
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 12, { steps: 6 })
  await page.mouse.up()
  const topDocked = await box(button)
  expect(topDocked.y - stageBox.y).toBeLessThanOrEqual(16)
  expectInside(stageBox, topDocked)
})

test('command palette actions use borderless pipe-separated controls', async ({ page }) => {
  await openFixture(page, 'command-palette-search-disabled', { width: 1180, height: 720 })

  const palette = page.locator('.command-palette')
  const actions = palette.locator('.command-light-action')
  const separators = palette.locator('.command-action-separator')
  await expect(actions).toHaveCount(7)
  await expect(separators).toHaveCount(4)
  await expect(palette.locator('[data-testid="command-palette-close"]')).toBeVisible()
  await expect(palette.locator('[data-testid="command-tab-history"]')).toHaveClass(/active/)
  for (const action of await actions.all()) {
    expect(await action.evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
    expect(await action.evaluate((element) => window.getComputedStyle(element).backgroundColor)).not.toBe('rgb(79, 140, 255)')
  }
  const firstSeparatorText = await separators.first().textContent()
  expect(firstSeparatorText?.trim()).toBe('|')
})

test('command palette management keeps CMD PowerShell and SSH history scopes isolated', async ({ page }) => {
  await openFixture(page, 'command-palette-management', { width: 1180, height: 720 })

  const palette = page.locator('.command-palette')
  const history = palette.locator('[data-testid="command-management-history-list"]')
  await expect(history).toContainText('cmd-fixture-list')
  await expect(history).not.toContainText('ps-fixture-list')
  await expect(history).not.toContainText('ssh-fixture-health')

  let deleteMessage = ''
  page.once('dialog', async (dialog) => {
    deleteMessage = dialog.message()
    await dialog.accept()
  })
  await history.locator('[data-testid="command-management-delete-history"]').first().click()
  expect(deleteMessage).toContain('delete history')
  await expect(history).not.toContainText('cmd-fixture-list')

  let clearMessage = ''
  page.once('dialog', async (dialog) => {
    clearMessage = dialog.message()
    await dialog.accept()
  })
  await palette.locator('[data-testid="command-management-clear-history"]').click()
  expect(clearMessage).toContain('clear history')
  await expect(history).toContainText('暂无命令历史')

  await palette.locator('[data-testid="command-shell-powershell"]').click()
  await expect(history).toContainText('ps-fixture-list')
  await expect(history).not.toContainText('cmd-fixture-network')

  await palette.locator('[data-testid="command-shell-ssh"]').click()
  await expect(history).toContainText('ssh-fixture-health')
  await expect(history).not.toContainText('cmd-fixture-network')
})

test('command palette management filters favorites common commands and supports editing', async ({ page }) => {
  await openFixture(page, 'command-palette-management', { width: 1180, height: 720 })

  const palette = page.locator('.command-palette')
  const history = palette.locator('[data-testid="command-management-history-list"]')
  await history.locator('[data-testid="command-management-favorite-history"]').first().click()
  await palette.locator('[data-testid="command-tab-favorites"]').click()

  const favorites = palette.locator('[data-testid="command-management-favorites-list"]')
  await expect(favorites).toContainText('CMD fixture list')
  await expect(favorites).toContainText('Any fixture echo')
  await expect(favorites.locator('[data-testid="command-management-common-list"]')).toContainText('cmd-common-fixture')
  await expect(favorites).not.toContainText('SSH fixture status')
  await expect(favorites).not.toContainText('ps-common-fixture')

  await palette.locator('[data-testid="command-management-search"]').fill('list')
  await expect(favorites.locator('mark').first()).toContainText('list')

  await favorites.locator('[data-testid="command-management-edit-favorite"]').first().click()
  await palette.locator('[data-testid="command-management-edit-title"]').fill('CMD renamed favorite')
  await palette.locator('[data-testid="command-management-edit-command"]').fill('cmd-fixture-renamed')
  await palette.locator('[data-testid="command-management-favorite-editor"] button[type="submit"]').click()
  await palette.locator('[data-testid="command-management-search"]').fill('renamed')
  await expect(favorites).toContainText('CMD renamed favorite')
  await expect(favorites).toContainText('cmd-fixture-renamed')

  await palette.locator('[data-testid="command-shell-ssh"]').click()
  await palette.locator('[data-testid="command-management-search"]').fill('')
  await expect(favorites).toContainText('SSH fixture status')
  await expect(favorites.locator('[data-testid="command-management-common-list"]')).toContainText('ssh-common-fixture')
  await expect(favorites).not.toContainText('CMD renamed favorite')
})

test('SSH command completion appears after two characters and accepts Tab without executing', async ({ page }) => {
  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })

  const shell = page.locator('[data-testid="ssh-command-completion"]')
  const input = shell.locator('[data-testid="ssh-completion-input"]')
  await input.fill('do')

  const overlay = shell.locator('[data-testid="terminal-completion-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('docker compose ps')
  await expect(overlay).toContainText('历史')
  expectInside(await box(shell.locator('.command-completion-fixture-host')), await box(overlay))

  await input.press('ArrowDown')
  await expect(shell.locator('[data-testid="completion-selected"]')).toContainText('docker logs api')
  await input.press('Tab')
  await expect(input).toHaveValue('docker logs api')
  await expect(overlay).toHaveCount(0)
  await expect(shell.locator('[data-testid="ssh-completion-executed"]')).toContainText('executed 0')

  await input.press('Enter')
  await expect(shell.locator('[data-testid="ssh-completion-executed"]')).toContainText('executed 1')
})

test('SSH command completion closes with Escape and stays on the focused split pane', async ({ page }) => {
  await openFixture(page, 'ssh-command-completion-split', { width: 1180, height: 620 })

  const shell = page.locator('[data-testid="ssh-command-completion-split"]')
  const left = shell.locator('[data-testid="ssh-completion-pane-left"]')
  const right = shell.locator('[data-testid="ssh-completion-pane-right"]')
  const input = left.locator('[data-testid="ssh-completion-split-input-left"]')
  await input.fill('do')

  await expect(left.locator('[data-testid="terminal-completion-overlay"]')).toBeVisible()
  await expect(right.locator('[data-testid="terminal-completion-overlay"]')).toHaveCount(0)

  await input.press('Escape')
  await expect(shell.locator('[data-testid="terminal-completion-overlay"]')).toHaveCount(0)
})

test('SSH command completion offers richer sys suggestions near the cursor', async ({ page }) => {
  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
  await page.evaluate(() => localStorage.removeItem('hostdeck.sshCommandCompletion.enabled'))

  const shell = page.locator('[data-testid="ssh-command-completion"]')
  const input = shell.locator('[data-testid="ssh-completion-input"]')
  await input.fill('sys')

  const overlay = shell.locator('[data-testid="terminal-completion-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('systemctl')
  await expect(overlay).toContainText('systemctl status')
  await expect(overlay).toContainText('查看 systemd 服务状态')
  await expect(overlay).toContainText('sysctl')
  await expect(overlay.locator('.completion-row')).toHaveCount(12)

  const inputBox = await box(input)
  const overlayBox = await box(overlay)
  const caret = await input.evaluate((element) => {
    const input = element as HTMLInputElement
    const rect = input.getBoundingClientRect()
    const style = window.getComputedStyle(input)
    const probe = document.createElement('span')
    probe.textContent = input.value
    probe.style.position = 'fixed'
    probe.style.left = '-10000px'
    probe.style.top = '0'
    probe.style.font = style.font
    probe.style.letterSpacing = style.letterSpacing
    probe.style.whiteSpace = 'pre'
    document.body.appendChild(probe)
    const textWidth = probe.getBoundingClientRect().width
    probe.remove()
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    const x = rect.left + paddingLeft + textWidth
    return {
      cursor: { x, y: rect.top, width: 1, height: rect.height },
      token: { x: rect.left + paddingLeft, y: rect.top, width: Math.max(1, textWidth), height: rect.height },
    }
  })
  expect(Math.abs(overlayBox.width - 500)).toBeLessThanOrEqual(8)
  expect(overlayBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height + 8)
  expect(overlayBox.x).toBeGreaterThanOrEqual(caret.cursor.x + 8)
  expectNoOverlap(overlayBox, inputBox)
  expectNoOverlap(overlayBox, caret.cursor)
  expectNoOverlap(overlayBox, caret.token)
  expectInside(await box(shell.locator('.command-completion-fixture-host')), overlayBox)
})

test('SSH command completion offers docker compose subcommands without executing them', async ({ page }) => {
  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
  await page.evaluate(() => {
    localStorage.removeItem('hostdeck.sshCommandCompletion.enabled')
    localStorage.removeItem('hostdeck.sshCommandCompletion.maxSuggestions')
    localStorage.removeItem('hostdeck.sshCommandCompletion.showDescriptions')
  })

  const input = page.locator('[data-testid="ssh-completion-input"]')
  await input.fill('docker c')

  const overlay = page.locator('[data-testid="terminal-completion-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('docker compose')
  await expect(overlay).toContainText('docker compose ps')
  await expect(overlay).toContainText('docker compose up')
  await expect(overlay).toContainText('docker compose down')

  await input.press('Tab')
  await expect(input).toHaveValue(/docker compose/)
  await expect(page.locator('[data-testid="ssh-completion-executed"]')).toContainText('executed 0')
})

test('SSH command completion can be disabled from overlay and re-enabled in terminal settings', async ({ page }) => {
  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
  await page.evaluate(() => localStorage.removeItem('hostdeck.sshCommandCompletion.enabled'))

  const input = page.locator('[data-testid="ssh-completion-input"]')
  await input.fill('sys')
  await expect(page.locator('[data-testid="terminal-completion-overlay"]')).toBeVisible()
  await page.locator('[data-testid="completion-disable"]').click()
  await expect(page.locator('[data-testid="terminal-completion-overlay"]')).toHaveCount(0)

  await input.fill('')
  await input.fill('sys')
  await expect(page.locator('[data-testid="terminal-completion-overlay"]')).toHaveCount(0)
  await input.press('Tab')
  await expect(input).toHaveValue('sys')

  await openFixture(page, 'settings-terminal-profile-spacing', { width: 900, height: 640 })
  const toggle = page.locator('[data-testid="ssh-command-completion-enabled"]')
  await expect(toggle).not.toBeChecked()
  await toggle.check()

  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
  await page.locator('[data-testid="ssh-completion-input"]').fill('sys')
  await expect(page.locator('[data-testid="terminal-completion-overlay"]')).toBeVisible()
})

test('SSH command completion settings control descriptions and suggestion count', async ({ page }) => {
  await openFixture(page, 'settings-terminal-profile-spacing', { width: 900, height: 640 })

  await page.locator('[data-testid="ssh-command-completion-show-descriptions"]').uncheck()
  await page.locator('[data-testid="ssh-command-completion-max-suggestions"]').fill('5')
  await page.locator('[data-testid="ssh-command-completion-trigger-chars"]').fill('1')

  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
  const input = page.locator('[data-testid="ssh-completion-input"]')
  await input.fill('s')

  const overlay = page.locator('[data-testid="terminal-completion-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('.completion-row')).toHaveCount(5)
  await expect(overlay).not.toContainText('查看 systemd 服务状态')
})

test('CMD and PowerShell local fixtures do not show Linux command completion', async ({ page }) => {
  await openFixture(page, 'local-command-completion-disabled', { width: 980, height: 620 })

  const shell = page.locator('[data-testid="local-command-completion-disabled"]')
  await shell.locator('[data-testid="local-completion-input"]').fill('do')
  await expect(shell.locator('[data-testid="terminal-completion-overlay"]')).toHaveCount(0)
})

test('Settings Backup/Restore options preserve unchecked state and visible actions', async ({ page }) => {
  await openFixture(page, 'settings-backup-restore-options')

  const panel = page.locator('[data-testid="settings-backup-restore-options"]')
  const defaultOptions = panel.locator('[data-testid="backup-default-import-options"] label')
  const options = panel.locator('[data-testid="backup-import-options"] label')
  const savedFalse = panel.locator('[data-testid="settings-saved-false"] input')
  const actions = panel.locator('.backup-actions')

  await expect(defaultOptions).toHaveCount(5)
  for (let index = 0; index < 5; index += 1) {
    await expect(defaultOptions.nth(index).locator('input')).toBeChecked()
  }
  await expect(options).toHaveCount(5)
  await expect(panel.locator('[data-testid="backup-import-options"] [data-option-id="command-history"] input')).not.toBeChecked()
  await expect(panel.locator('[data-testid="backup-import-options"] [data-option-id="key-vault-metadata"] input')).not.toBeChecked()
  await expect(savedFalse).not.toBeChecked()
  expectNoOverlap(await box(options.first()), await box(actions))
})

test('Settings native notification controls stay visible in narrow layout', async ({ page }) => {
  await openFixture(page, 'settings-native-notification', { width: 800, height: 600 })

  const panel = page.locator('[data-testid="alert-native-notifications"]')
  const toggleLabel = panel.locator('.alert-global-control__text strong')
  const status = panel.locator('[data-testid="alert-native-notifications-status"]')
  const sendButton = panel.getByRole('button', { name: '发送系统通知' })

  await expect(toggleLabel).toBeVisible()
  await expect(panel).not.toContainText('Windows 原生通知')
  await expect(status).toContainText('macOS 系统通知暂不可用')
  await expect(panel.locator('[data-testid="alert-native-notifications-enabled"]')).toBeDisabled()
  await expect(sendButton).toBeDisabled()
  await expect(status).toBeVisible()
  await expect(sendButton).toBeVisible()
  expectInside(await box(panel), await box(sendButton))
  expectNoOverlap(await box(toggleLabel), await box(sendButton))
})

test('Settings final navigation labels are centered and readable', async ({ page }) => {
  await openFixture(page, 'settings-nav-final', { width: 800, height: 600 })

  const nav = page.locator('[data-testid="settings-nav-final"] .settings-category-nav')
  const buttons = nav.locator('button')
  const separators = nav.locator('.action-separator')
  await expect(buttons).toHaveCount(6)
  await expect(nav.locator('.app-icon')).toHaveCount(6)
  await expect(separators).toHaveCount(0)
  const active = buttons.first()
  const inactive = buttons.nth(1)
  const activeBackground = await active.evaluate((element) => window.getComputedStyle(element).backgroundColor)
  const inactiveBackground = await inactive.evaluate((element) => window.getComputedStyle(element).backgroundColor)
  expect(activeBackground).not.toBe('rgba(0, 0, 0, 0)')
  expect(activeBackground).not.toBe(inactiveBackground)
  await inactive.hover()
  const hoverBackground = await inactive.evaluate((element) => window.getComputedStyle(element).backgroundColor)
  expect(hoverBackground).not.toBe(activeBackground)

  for (let index = 0; index < 6; index += 1) {
    const button = buttons.nth(index)
    const label = button.locator('.settings-category-nav-label')
    const buttonBox = await box(button)
    const labelBox = await box(label)
    const fontSize = await button.evaluate((element) => parseFloat(window.getComputedStyle(element).fontSize))

    expect(Math.abs((buttonBox.x + buttonBox.width / 2) - (labelBox.x + labelBox.width / 2))).toBeLessThanOrEqual(2)
    expect(Math.abs((buttonBox.y + buttonBox.height / 2) - (labelBox.y + labelBox.height / 2))).toBeLessThanOrEqual(2)
    expect(fontSize).toBe(16)
    expect(buttonBox.height).toBe(42)
  }
})

test('Settings overlay content scrolls per category while keeping navigation visible', async ({ page }) => {
  await openFixture(page, 'settings-content-scroll', { width: 900, height: 560 })

  const nav = page.locator('[data-testid="settings-scroll-nav"]')
  const content = page.locator('[data-testid="settings-scroll-content"]')
  const buttons = nav.locator('button')
  await expect(buttons).toHaveCount(6)

  const initialNavBox = await box(nav)
  for (let index = 0; index < 6; index += 1) {
    await buttons.nth(index).click()
    await expect(buttons.nth(index)).toHaveClass(/active/)
    await expect(page.locator('[data-testid="settings-scroll-bottom"]')).toBeVisible()
    await content.evaluate((element) => { element.scrollTop = 0 })
    const before = await content.evaluate((element) => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: window.getComputedStyle(element).overflowY,
    }))
    expect(before.overflowY).toBe('auto')
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight + 20)
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    const after = await content.evaluate((element) => element.scrollTop)
    expect(after).toBeGreaterThan(before.scrollTop)
    await expect(page.locator('[data-testid="settings-scroll-bottom"]')).toBeInViewport()
    const navBox = await box(nav)
    expect(Math.abs(navBox.x - initialNavBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(navBox.y - initialNavBox.y)).toBeLessThanOrEqual(1)
  }
})

test('Settings general page exposes the app logs entry after topbar menu removal', async ({ page }) => {
  await openFixture(page, 'settings-content-scroll', { width: 900, height: 560 })

  const entry = page.locator('[data-testid="settings-app-log-entry"]')
  const button = page.locator('[data-testid="settings-open-app-logs"]')
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('应用日志')
  await expect(button).toBeVisible()
})

test('Settings font-size slider aligns tick markers with the track and current thumb center', async ({ page }) => {
  await openFixture(page, 'settings-font-slider-alignment', { width: 520, height: 220 })

  const line = page.locator('[data-testid="ui-font-size-track-line"]')
  const thumb = page.locator('[data-testid="ui-font-size-thumb"]')
  const currentTick = page.locator('[data-testid="ui-font-size-current-tick"]')
  const currentMarker = currentTick.locator('.settings-font-tick-marker')
  const allMarkers = page.locator('.settings-font-tick-marker')
  const labels = page.locator('.settings-font-tick-label')

  const lineBox = await box(line)
  const thumbBox = await box(thumb)
  const tickBox = await box(currentTick)
  const markerBox = await box(currentMarker)
  const thumbCenterX = thumbBox.x + thumbBox.width / 2
  const tickCenterX = tickBox.x + tickBox.width / 2
  const markerCenterX = markerBox.x + markerBox.width / 2
  const lineTop = lineBox.y

  expect(Math.abs(thumbCenterX - tickCenterX)).toBeLessThanOrEqual(1)
  expect(Math.abs(thumbCenterX - markerCenterX)).toBeLessThanOrEqual(1)
  expect(markerBox.y).toBeLessThan(lineTop)
  expect(Math.abs((markerBox.y + markerBox.height) - lineTop)).toBeLessThanOrEqual(1)

  for (let index = 0; index < await allMarkers.count(); index += 1) {
    const itemBox = await box(allMarkers.nth(index))
    expect(itemBox.y).toBeLessThan(lineTop)
    expect(Math.abs((itemBox.y + itemBox.height) - lineTop)).toBeLessThanOrEqual(1)
  }
  for (let index = 0; index < await labels.count(); index += 1) {
    expect((await box(labels.nth(index))).y).toBeGreaterThan(lineTop)
  }
})

test('Settings terminal profile section has normal spacing without stacked horizontal rules', async ({ page }) => {
  await openFixture(page, 'settings-terminal-profile-spacing', { width: 900, height: 640 })

  const keepalive = page.locator('[data-testid="ssh-keepalive-settings"]')
  const profile = page.locator('[data-testid="terminal-profile-settings"]')
  const profileHeading = profile.locator('.terminal-profile-title')

  await expect(keepalive).toBeVisible()
  await expect(profile).toBeVisible()
  await expect(profileHeading).toBeVisible()

  const keepaliveBox = await box(keepalive)
  const profileBox = await box(profile)
  const gap = profileBox.y - (keepaliveBox.y + keepaliveBox.height)
  expect(gap).toBeGreaterThanOrEqual(12)
  expect(gap).toBeLessThanOrEqual(32)
  await expect(page.locator('[data-testid="settings-terminal-profile-spacing"] hr')).toHaveCount(0)
  expect(await profile.evaluate((element) => window.getComputedStyle(element).borderTopWidth)).toBe('1px')
  expect(await profileHeading.evaluate((element) => window.getComputedStyle(element).borderTopWidth)).toBe('0px')
})

test('Settings header actions render as original button styles without pipe separators', async ({ page }) => {
  await openFixture(page, 'settings-header-actions', { width: 900, height: 360 })

  const row = page.locator('[data-testid="settings-action-bar"]')
  const buttons = row.locator('button')
  const separators = row.locator('.settings-header-action-separator')
  const reset = row.locator('.settings-reset-defaults-button')
  const save = row.locator('.settings-save-button')
  const primary = row.locator('.settings-save-close-button')
  const close = row.locator('.settings-close-button')

  await expect(row).toBeVisible()
  await expect(buttons).toHaveCount(4)
  await expect(separators).toHaveCount(0)
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index)
    expect(await button.evaluate((element) => window.getComputedStyle(element).whiteSpace)).toBe('nowrap')
  }
  await expect(reset).toHaveClass(/secondary/)
  await expect(save).toHaveClass(/secondary/)
  await expect(primary).toHaveClass(/primary/)
  await expect(close).toHaveClass(/dialog-close-button/)
  expect(await reset.evaluate((element) => window.getComputedStyle(element).borderStyle)).not.toBe('none')
  expect(await save.evaluate((element) => window.getComputedStyle(element).borderStyle)).not.toBe('none')
  expect(await close.evaluate((element) => window.getComputedStyle(element).borderStyle)).not.toBe('none')
  expect(await close.evaluate((element) => window.getComputedStyle(element).fontSize)).toBe(await save.evaluate((element) => window.getComputedStyle(element).fontSize))
  expect(await close.evaluate((element) => window.getComputedStyle(element).fontWeight)).toBe(await save.evaluate((element) => window.getComputedStyle(element).fontWeight))
  expect(await close.evaluate((element) => window.getComputedStyle(element).borderTopWidth)).toBe(await save.evaluate((element) => window.getComputedStyle(element).borderTopWidth))
  const saveBox = await box(save)
  const closeBox = await box(close)
  expect(Math.abs(saveBox.height - closeBox.height)).toBeLessThanOrEqual(1)
  expect(Math.abs((saveBox.y + saveBox.height / 2) - (closeBox.y + closeBox.height / 2))).toBeLessThanOrEqual(1)
  expect(await primary.evaluate((element) => window.getComputedStyle(element).backgroundColor)).toBe('rgb(47, 109, 242)')
  await primary.hover()
  expect(await primary.evaluate((element) => window.getComputedStyle(element).backgroundColor)).toBe('rgb(47, 109, 242)')
})

test('transfer popover many items stays bounded with internal scrolling', async ({ page }) => {
  await openFixture(page, 'transfer-popover-many')

  const popover = page.locator('[data-testid="transfer-popover-many"]')
  const list = popover.locator('.transfer-popover-list')
  const reservedInput = page.locator('[data-testid="terminal-input-reserved"]')

  expectInside(await box(page.locator('.ui-fixture-stage')), await box(popover))
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await overflowY(list)).toBe('auto')
  expect((await box(popover)).y + (await box(popover)).height).toBeLessThan((await box(reservedInput)).y)
  await expect(page).toHaveScreenshot('transfer-popover-many.png')
})

test('Service Manager journal narrow keeps list, detail, action bar, and log area separated', async ({ page }) => {
  await openFixture(page, 'service-manager-journal-narrow', { width: 800, height: 600 })

  const shell = page.locator('[data-testid="service-manager-journal-narrow"]')
  const list = shell.locator('.service-list-panel')
  const detail = shell.locator('.service-detail-panel')
  const actions = shell.locator('.service-actions')
  const output = shell.locator('[data-testid="service-journal-output"]')
  const firstLine = output.locator('[data-testid="service-journal-line"]').first()
  const count = shell.locator('[data-testid="service-journal-count"]')
  const actionButtons = actions.locator('.command-light-action')
  const detailTabs = shell.locator('.service-detail-tabs .command-light-action')

  expectInside(await box(shell), await box(list))
  expectInside(await box(shell), await box(detail))
  expectNoOverlap(await box(list), await box(detail))
  await expect(actions).toBeVisible()
  await expect(actionButtons).toHaveCount(5)
  await expect(actions.locator('.command-action-separator')).toHaveCount(4)
  await expect(detailTabs).toHaveCount(2)
  await expect(shell.locator('.service-detail-tabs .command-action-separator')).toHaveCount(1)
  await expect(count).toBeVisible()
  expect(await output.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expectInside(await box(output), await box(firstLine))
})

test('Service Manager OpenWrt logread shows source and disables realtime follow', async ({ page }) => {
  await openFixture(page, 'service-manager-openwrt-logread', { width: 900, height: 640 })

  const shell = page.locator('[data-testid="service-manager-openwrt-logread"]')
  const output = shell.locator('[data-testid="service-journal-output"]')
  const sourceBadge = shell.locator('[data-testid="service-journal-source-badge"]')
  const refresh = shell.locator('[data-testid="service-journal-refresh"]')
  const follow = shell.locator('[data-testid="service-journal-follow"]')
  const reason = shell.locator('[data-testid="service-journal-follow-reason"]')
  const firstLine = output.locator('[data-testid="service-journal-line"]').first()

  await expect(sourceBadge).toHaveText('OpenWrt logread')
  await expect(refresh).toBeEnabled()
  await expect(follow).toBeDisabled()
  await expect(reason).toContainText('OpenWrt logread')
  expect(await output.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expectInside(await box(shell), await box(sourceBadge))
  expectInside(await box(output), await box(firstLine))
})

test('Service Manager OpenWrt logread unavailable state remains bounded', async ({ page }) => {
  await openFixture(page, 'service-manager-openwrt-logread-unavailable', { width: 820, height: 620 })

  const shell = page.locator('[data-testid="service-manager-openwrt-logread-unavailable"]')
  const output = shell.locator('[data-testid="service-journal-output"]')
  const unavailable = shell.locator('[data-testid="service-journal-unavailable"]')
  const refresh = shell.locator('[data-testid="service-journal-refresh"]')
  const follow = shell.locator('[data-testid="service-journal-follow"]')

  await expect(shell.locator('[data-testid="service-journal-source-badge"]')).toHaveText('OpenWrt logread')
  await expect(unavailable).toContainText('logread')
  await expect(refresh).toBeDisabled()
  await expect(follow).toBeDisabled()
  expectInside(await box(shell), await box(output))
  expectInside(await box(output), await box(unavailable))
})

test('Service Manager OpenWrt logread long lines stay inside the dialog', async ({ page }) => {
  await openFixture(page, 'service-manager-openwrt-logread-long-lines', { width: 820, height: 620 })

  const shell = page.locator('[data-testid="service-manager-openwrt-logread-long-lines"]')
  const output = shell.locator('[data-testid="service-journal-output"]')
  const line = output.locator('[data-testid="service-journal-line"]').first()

  await expect(shell.locator('[data-testid="service-journal-source-badge"]')).toHaveText('OpenWrt logread')
  await expect(line).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  expect(await output.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true)
  expectInside(await box(shell), await box(output))
  expectInside(await box(output), await box(line), 2)
})

test('monitor dashboard center actions use lightweight separators', async ({ page }) => {
  await openFixture(page, 'dashboard-alert-center-layer', { width: 1100, height: 720 })

  const shell = page.locator('[data-testid="dashboard-alert-center-layer"]')
  const headerActions = shell.locator('.dashboard-panel-header-actions')
  const tabs = shell.locator('.dashboard-panel-tabs')
  const bulkActions = shell.locator('[data-testid="dashboard-bulk-actions"]')
  const filterGrid = shell.locator('[data-testid="monitor-dashboard-filter-grid"]')
  const connectButton = bulkActions.locator('[data-testid="dashboard-connect-all"]')
  const connectEventCount = shell.locator('[data-testid="dashboard-connect-event-count"]')

  await expect(tabs.locator('.command-light-action')).toHaveCount(2)
  await expect(tabs.locator('.command-action-separator')).toHaveCount(1)
  await expect(shell.locator('[data-testid="dashboard-alert-center"]')).toHaveClass(/command-light-action/)
  await expect(headerActions.locator('.dashboard-alert-center-count')).toHaveText('2')
  await expect(filterGrid.locator('[data-testid="dashboard-search"]')).toBeVisible()
  await expect(filterGrid.locator('[data-testid="dashboard-status-filter"]')).toBeVisible()
  await expect(filterGrid.locator('[data-testid="dashboard-group-filter"]')).toBeVisible()
  await expect(filterGrid.locator('[data-testid="dashboard-sort-mode"]')).toBeVisible()
  await expect(filterGrid.locator('.monitor-dashboard-refresh-button')).toBeVisible()
  await expect(bulkActions.locator('.command-light-action')).toHaveCount(8)
  await expect(bulkActions.locator('.command-action-separator')).toHaveCount(7)
  await expect(connectButton).toBeDisabled()
  await connectButton.dispatchEvent('click')
  await expect(connectEventCount).toHaveText('0')
  await bulkActions.locator('[data-testid="dashboard-hide-offline"]').click()
  await expect(bulkActions.locator('[data-testid="dashboard-hide-offline"]')).toHaveClass(/active/)
})
