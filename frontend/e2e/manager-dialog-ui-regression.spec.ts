import { expect, type Locator, type Page, test } from '@playwright/test'

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

async function openManagerFixture(page: Page, fixture: string, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport)
  await page.goto(`/ui-regression.html?fixture=${fixture}`)
  await expect(page.locator(`[data-ui-fixture="${fixture}"]`)).toBeVisible()
}

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible()
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
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

async function expectNoDocumentHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth + 1)).toBe(true)
}

async function expectInternalScroll(locator: Locator) {
  expect(await locator.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await locator.evaluate((element) => window.getComputedStyle(element).overflowY)).toMatch(/auto|scroll/)
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

test('Docker Manager container list keeps toolbar, rows, actions, and details bounded', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-container-list')

  const dialog = page.locator('[data-testid="docker-manager-container-list"] .docker-dialog')
  await expectBlurredTranslucentSurface(page.locator('[data-testid="docker-manager-container-list"] .docker-dialog-backdrop'))
  const toolbar = dialog.locator('.docker-toolbar')
  const list = dialog.locator('.docker-list-panel')
  const rows = list.locator('.docker-container-card')
  const details = dialog.locator('.docker-detail-panel')
  const logActions = dialog.locator('[data-testid="docker-container-log-actions"]')
  const tailControl = dialog.locator('[data-testid="docker-container-tail-control"]')
  const actions = rows.first().locator('.container-actions')
  const connect = rows.first().locator('[data-testid="docker-connect-container"]')
  const inspect = rows.first().locator('[data-testid="docker-inspect"]')

  expectInside(await box(dialog), await box(toolbar))
  expectInside(await box(dialog), await box(list))
  expectInside(await box(dialog), await box(details))
  expectNoOverlap(await box(list), await box(details))
  await expect(rows).toHaveCount(8)
  expectInside(await box(list), await box(rows.first()))
  expectInside(await box(rows.first()), await box(actions))
  await expect(connect).toBeVisible()
  await expect(inspect).toBeVisible()
  expect((await box(connect)).x).toBeLessThan((await box(inspect)).x)
  await inspect.click()
  await expect(dialog.locator('[data-testid="docker-inspect-panel"]')).toBeVisible()
  await expect(logActions).toContainText('最近行数')
  await expect(logActions).toContainText('刷新日志')
  await expect(logActions).toContainText('实时追踪')
  await expect(logActions).toContainText('清空显示')
  await expect(dialog.locator('[data-testid="docker-container-tail-input"]')).toHaveValue('200')
  const logActionBox = await box(logActions)
  const tailBox = await box(tailControl)
  const refreshBox = await box(dialog.locator('[data-testid="docker-refresh-logs"]'))
  const followBox = await box(dialog.locator('[data-testid="docker-follow-logs"]'))
  expect(tailBox.x).toBeGreaterThan((await box(dialog.locator('[data-testid="docker-follow-logs"]'))).x)
  expect(Math.abs((tailBox.y + tailBox.height / 2) - (logActionBox.y + logActionBox.height / 2))).toBeLessThanOrEqual(2)
  expect(Math.abs((refreshBox.y + refreshBox.height / 2) - (logActionBox.y + logActionBox.height / 2))).toBeLessThanOrEqual(2)
  expect(Math.abs((followBox.y + followBox.height / 2) - (logActionBox.y + logActionBox.height / 2))).toBeLessThanOrEqual(2)
  await expectInternalScroll(list)
  await expectNoDocumentHorizontalScroll(page)
})

test('Docker Manager narrow logs and stats keep internal scroll and non-overlapping summary cards', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-logs-stats-narrow', { width: 820, height: 620 })

  const dialog = page.locator('[data-testid="docker-manager-logs-stats-narrow"] .docker-dialog')
  const body = dialog.locator('.docker-body')
  const log = dialog.locator('[data-testid="docker-log-view"]')
  const stats = dialog.locator('[data-testid="docker-stats-panel"]')
  const tabs = dialog.locator('.detail-tabs')

  expectInside(await box(dialog), await box(body))
  expectInside(await box(dialog), await box(tabs))
  expectInside(await box(dialog), await box(log))
  expectInside(await box(dialog), await box(stats))
  expectNoOverlap(await box(log), await box(stats))
  await expectInternalScroll(log)
  await expectNoDocumentHorizontalScroll(page)
})

test('Docker Manager batch actions stay visible without covering selected rows', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-batch-actions')

  const shell = page.locator('[data-testid="docker-manager-batch-actions"]')
  const list = shell.locator('.docker-list-panel')
  const batch = shell.locator('[data-testid="docker-batch-bar"]')
  const rows = list.locator('.docker-container-card')
  const remove = batch.locator('[data-testid="docker-batch-remove"]')

  await expect(rows.filter({ has: page.locator('input:checked') })).toHaveCount(3)
  expectInside(await box(list), await box(batch))
  expectInside(await box(batch), await box(remove))
  expectNoOverlap(await box(batch), await box(rows.first()))
  await expect(remove).toHaveClass(/danger/)
})

test('Docker Manager Compose supported fixture shows projects, services, and internally scrolling logs', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-compose-supported')

  const shell = page.locator('[data-testid="docker-manager-compose-supported"]')
  const panel = shell.locator('[data-testid="docker-compose-panel"]')
  const actionRow = shell.locator('[data-testid="docker-compose-action-row"]')
  const tailControl = shell.locator('[data-testid="docker-compose-tail-control"]')
  const tailSelect = shell.locator('[data-testid="docker-compose-tail-select"]')
  const serviceToolbar = shell.locator('[data-testid="docker-compose-service-toolbar"]')
  const serviceCount = shell.locator('[data-testid="docker-compose-service-count"]')
  const serviceFilter = shell.locator('[data-testid="docker-compose-service-filter"]')
  const projectFilterShell = shell.locator('.docker-compose-sidebar .docker-compose-filter').first()
  const projectFilter = shell.locator('[data-testid="docker-compose-filter"]')
  const projects = shell.locator('[data-testid="docker-compose-project-row"]')
  const services = shell.locator('[data-testid="docker-compose-service-row"]')
  const serviceDetail = shell.locator('[data-testid="docker-compose-service-detail"]')
  const logs = shell.locator('[data-testid="docker-compose-logs"]')

  expectInside(await box(shell.locator('.docker-dialog')), await box(panel))
  await expect(shell.locator('[data-testid="docker-containers-tab"]')).toHaveText('容器')
  await expect(shell.locator('.docker-status-line')).not.toContainText('Docker 可用')
  await expect(shell.locator('.docker-status-line')).not.toContainText('已检测到 Docker')
  await expect(actionRow).toContainText('刷新服务')
  await expect(actionRow).toContainText('刷新日志')
  await expect(actionRow).toContainText('跟随')
  await expect(actionRow).toContainText('暂停')
  await expect(actionRow).toContainText('复制')
  await expect(actionRow).toContainText('清空')
  await expect(tailControl).toContainText('最近行数')
  await expect(tailSelect).toHaveValue('200')
  const tailBox = await box(tailControl)
  const actionBox = await box(actionRow)
  expect(Math.abs((tailBox.y + tailBox.height / 2) - (actionBox.y + actionBox.height / 2))).toBeLessThanOrEqual(2)
  const followBox = await box(shell.locator('[data-testid="docker-compose-follow-logs"]'))
  expect(Math.abs((followBox.y + followBox.height / 2) - (actionBox.y + actionBox.height / 2))).toBeLessThanOrEqual(2)
  expect(await actionRow.evaluate((element) => element.scrollHeight <= element.clientHeight + 2)).toBe(true)
  const refreshServicesBox = await box(shell.locator('[data-testid="docker-compose-refresh-services"]'))
  const refreshLogsBox = await box(shell.locator('[data-testid="docker-compose-refresh-logs"]'))
  expect(Math.abs((refreshServicesBox.y + refreshServicesBox.height / 2) - (refreshLogsBox.y + refreshLogsBox.height / 2))).toBeLessThanOrEqual(2)
  await expect(serviceCount).toContainText('2 个服务')
  const projectFilterShellBox = await box(projectFilterShell)
  const projectFilterBox = await box(projectFilter)
  expect(Math.abs((projectFilterShellBox.y + projectFilterShellBox.height / 2) - (projectFilterBox.y + projectFilterBox.height / 2))).toBeLessThanOrEqual(3)
  expect(Math.abs(((await box(serviceCount)).y + (await box(serviceCount)).height / 2) - ((await box(serviceFilter)).y + (await box(serviceFilter)).height / 2))).toBeLessThanOrEqual(3)
  expectInside(await box(panel), await box(serviceToolbar))
  await expect(projects).toHaveCount(2)
  await expect(services).toHaveCount(2)
  const lastServiceBox = await box(services.last())
  const serviceDetailBox = await box(serviceDetail)
  expect(serviceDetailBox.y - (lastServiceBox.y + lastServiceBox.height)).toBeLessThanOrEqual(16)
  await serviceFilter.fill('web')
  await expect(services).toHaveCount(1)
  const filteredServiceBox = await box(services.first())
  const filteredDetailBox = await box(serviceDetail)
  expect(filteredDetailBox.y - (filteredServiceBox.y + filteredServiceBox.height)).toBeLessThanOrEqual(16)
  await expect(logs).toContainText('synthetic compose log')
  await expectInternalScroll(logs)
  await expectNoDocumentHorizontalScroll(page)
})

test('Docker Manager Compose read-only controls filter, follow, copy, clear, and stop on close', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-compose-supported')

  const shell = page.locator('[data-testid="docker-manager-compose-supported"]')
  const panel = shell.locator('[data-testid="docker-compose-panel"]')
  const projects = shell.locator('[data-testid="docker-compose-project-row"]')
  const services = shell.locator('[data-testid="docker-compose-service-row"]')
  const logs = shell.locator('[data-testid="docker-compose-logs"]')
  const followCount = shell.locator('[data-testid="docker-compose-follow-count"]')

  await expect(shell.locator('[data-testid="docker-compose-refresh"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-refresh-services"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-service-detail"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-follow-logs"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-pause-logs"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-tail-select"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-copy-logs"]')).toBeVisible()
  await expect(shell.locator('[data-testid="docker-compose-clear-logs"]')).toBeVisible()
  await expect(panel).toContainText('跟随')
  await expect(panel).toContainText('暂停')
  await expect(panel).toContainText('复制')
  await expect(panel).toContainText('清空')
  await expect(panel).not.toContainText('Refresh Services')
  await expect(panel).not.toContainText('Follow')
  await expect(panel).not.toContainText('Pause')
  await expect(panel).not.toContainText('Copy')
  await expect(panel).not.toContainText('Clear')
  await expect(panel.locator('.command-action-separator')).toHaveCount(6)

  const composeButtonLabels = await panel.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => (button.textContent ?? '').trim().toLowerCase()))
  for (const label of ['up', 'down', 'restart', 'stop', 'start', 'remove', 'build', 'pull', 'exec']) {
    expect(composeButtonLabels).not.toContain(label)
  }

  await shell.locator('[data-testid="docker-compose-filter"]').fill('ops')
  await expect(projects).toHaveCount(1)
  await expect(projects.first()).toContainText('ops')
  await shell.locator('[data-testid="docker-compose-filter"]').fill('')
  await shell.locator('[data-testid="docker-compose-service-filter"]').fill('db')
  await expect(services).toHaveCount(1)
  await expect(services.first()).toContainText('postgres:16')

  await shell.locator('[data-testid="docker-compose-follow-logs"]').click()
  await expect(followCount).toHaveText('1')
  await shell.locator('[data-testid="docker-compose-pause-logs"]').click()
  const pausedCount = Number(await followCount.textContent())
  await page.waitForTimeout(700)
  expect(Number(await followCount.textContent())).toBe(pausedCount)
  await shell.locator('[data-testid="docker-compose-pause-logs"]').click()
  await expect.poll(async () => Number(await followCount.textContent())).toBeGreaterThan(pausedCount)

  await shell.locator('[data-testid="docker-compose-copy-logs"]').click()
  await expect(shell.locator('[data-testid="docker-compose-copy-state"]')).toHaveText('copied')
  await shell.locator('[data-testid="docker-compose-clear-logs"]').click()
  await expect(logs).toHaveText('')

  const beforeClose = Number(await followCount.textContent())
  await shell.locator('.dialog-close-button').click()
  await page.waitForTimeout(700)
  expect(Number(await followCount.textContent())).toBe(beforeClose)
  await expectNoDocumentHorizontalScroll(page)
})

test('Docker Manager Compose unavailable fixture keeps status bounded', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-compose-unavailable')

  const shell = page.locator('[data-testid="docker-manager-compose-unavailable"]')
  const dialog = shell.locator('.docker-dialog')
  const unavailable = shell.locator('[data-testid="docker-compose-unavailable"]')

  await expect(unavailable).toContainText('服务器未检测到 Docker Compose')
  expectInside(await box(dialog), await box(unavailable))
  await expectNoDocumentHorizontalScroll(page)
})

test('Docker Manager Compose narrow fixture keeps services and logs inside the dialog', async ({ page }) => {
  await openManagerFixture(page, 'docker-manager-compose-narrow', { width: 760, height: 640 })

  const dialog = page.locator('[data-testid="docker-manager-compose-narrow"] .docker-dialog')
  const panel = dialog.locator('[data-testid="docker-compose-panel"]')
  const services = dialog.locator('.docker-compose-services')
  const logs = dialog.locator('[data-testid="docker-compose-logs"]')

  expectInside(await box(dialog), await box(panel))
  const servicesBox = await box(services)
  expectInside(await box(dialog), servicesBox)
  expect(servicesBox.height).toBeGreaterThanOrEqual(68)
  await logs.scrollIntoViewIfNeeded()
  expectInside(await box(dialog), await box(logs))
  await expectInternalScroll(logs)
  await expectNoDocumentHorizontalScroll(page)
})

test('Tunnel Manager profile list keeps runtime status and actions separate from the form', async ({ page }) => {
  await openManagerFixture(page, 'tunnel-manager-profile-list')

  const dialog = page.locator('[data-testid="tunnel-manager-profile-list"] .tunnel-dialog')
  const list = dialog.locator('.tunnel-profile-list')
  const form = dialog.locator('.tunnel-profile-form')
  const runtime = list.locator('.tunnel-runtime-line').first()
  const actions = list.locator('.tunnel-card-actions').first()

  expectInside(await box(dialog), await box(list))
  expectInside(await box(dialog), await box(form))
  expectNoOverlap(await box(list), await box(form))
  expectInside(await box(list), await box(runtime))
  expectInside(await box(list), await box(actions))
})

test('Tunnel Manager narrow form keeps validation warning and form actions inside the dialog', async ({ page }) => {
  await openManagerFixture(page, 'tunnel-manager-form-narrow', { width: 760, height: 640 })

  const dialog = page.locator('[data-testid="tunnel-manager-form-narrow"] .tunnel-dialog')
  const body = dialog.locator('.tunnel-dialog-body')
  const warning = dialog.locator('[data-testid="remote-listen-diagnostics"]').first()
  const actions = dialog.locator('.tunnel-form-actions')
  const typeCards = dialog.locator('.tunnel-type-cards')
  const endpointRows = dialog.locator('[data-testid="tunnel-endpoint-row"]')

  expectInside(await box(dialog), await box(body))
  expectInside(await box(dialog), await box(warning))
  expectInside(await box(dialog), await box(actions))
  expectNoOverlap(await box(typeCards), await box(actions))
  await expect(endpointRows).toHaveCount(2)
  await expect(endpointRows.nth(0)).toContainText('我的电脑地址')
  await expect(endpointRows.nth(0)).toContainText('我的电脑端口')
  await expect(endpointRows.nth(1)).toContainText('服务器地址')
  await expect(endpointRows.nth(1)).toContainText('服务器端口')
  const firstInput = await box(endpointRows.nth(0).locator('input').nth(0))
  const secondInput = await box(endpointRows.nth(0).locator('input').nth(1))
  expect(Math.abs(firstInput.y - secondInput.y)).toBeLessThanOrEqual(2)
  await expectNoDocumentHorizontalScroll(page)
})

test('Process Manager long command list keeps action columns and detail actions visible', async ({ page }) => {
  await openManagerFixture(page, 'process-manager-list-long-command')

  const dialog = page.locator('[data-testid="process-manager-list-long-command"] .process-dialog')
  const list = dialog.locator('.process-list-panel')
  const detail = dialog.locator('.process-detail-panel')
  const row = list.locator('.process-table-row').first()
  const command = row.locator('strong')
  const actions = detail.locator('.process-detail-actions')
  const headers = list.locator('.process-table-head-cell')
  const arrows = list.locator('.table-sort-arrow')
  const resizer = list.locator('[data-testid="process-column-resizer-0"]')
  const head = list.locator('.process-table-head')
  const headShell = list.locator('.process-table-head-shell')

  expectInside(await box(dialog), await box(list))
  expectInside(await box(dialog), await box(detail))
  expectNoOverlap(await box(list), await box(detail))
  await expect(headers).toHaveCount(6)
  await expect(arrows).toHaveCount(5)
  await expect(arrows).toHaveText(['', '', '↓', '', ''])
  await expect(headers.nth(1)).toHaveCSS('border-left-width', '0px')
  await expect(headShell).toHaveCSS('border-top-right-radius', '10px')
  expect(await headShell.evaluate((element) => window.getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  expectInside(await box(headShell), await box(head))
  const headShellBox = await box(headShell)
  const rowBox = await box(row)
  expect(Math.abs((headShellBox.x + headShellBox.width) - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(2)
  expect(await headers.nth(2).locator('button').evaluate((element) => {
    const style = window.getComputedStyle(element)
    return style.justifyContent === 'center' && style.textAlign === 'center'
  })).toBe(true)
  expect(await row.locator('span, strong').evaluateAll((cells) =>
    cells.every((cell) => window.getComputedStyle(cell).textAlign === 'left'))).toBe(true)
  await expect(resizer).toBeVisible()
  await headers.nth(2).locator('button').hover()
  await expect(headers.nth(2).locator('button')).toHaveCSS('cursor', 'pointer')
  const beforeGrid = await row.getAttribute('style')
  const resizerBox = await box(resizer)
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 32, resizerBox.y + resizerBox.height / 2)
  await page.mouse.up()
  expect(await row.getAttribute('style')).not.toBe(beforeGrid)
  expectInside(await box(row), await box(command))
  expect(await command.evaluate((element) => window.getComputedStyle(element).textOverflow)).toBe('ellipsis')
  expectInside(await box(detail), await box(actions))
  await expectInternalScroll(list)
})

test('Process Manager action confirm is bounded and does not cover the process action row', async ({ page }) => {
  await openManagerFixture(page, 'process-manager-action-confirm', { width: 900, height: 620 })

  const shell = page.locator('[data-testid="process-manager-action-confirm"]')
  const dialog = shell.locator('.process-dialog')
  const actions = shell.locator('.process-detail-actions')
  const confirm = shell.locator('[data-testid="process-confirm-dialog"]')

  expectInside(await box(dialog), await box(actions))
  expectInside(await box(shell), await box(confirm))
  expectNoOverlap(await box(actions), await box(confirm))
  await expect(confirm.getByRole('button', { name: 'Confirm' })).toHaveClass(/danger/)
})

test('Network diagnostics summary keeps sections, status, and output bounded in a narrow viewport', async ({ page }) => {
  await openManagerFixture(page, 'network-diagnostics-summary', { width: 820, height: 620 })

  const dialog = page.locator('[data-testid="network-diagnostics-summary"] .network-diagnostics-modal')
  const toolbar = dialog.locator('.network-diagnostics-toolbar')
  const types = dialog.locator('.network-diagnostics-types')
  const actions = dialog.locator('.network-diagnostics-actions')
  const output = dialog.locator('.network-diagnostics-output')
  const status = dialog.locator('.network-diag-status-badge')
  const typeButtons = types.locator('.command-light-action')
  const endpointTable = dialog.locator('[data-testid="network-endpoint-table"]')
  const endpointRow = endpointTable.locator('.network-endpoint-row').nth(1)
  const endpointHeaders = endpointTable.locator('.network-endpoint-head-cell')
  const endpointArrows = endpointTable.locator('.table-sort-arrow')
  const endpointResizer = endpointTable.locator('[data-testid="network-endpoint-column-resizer-0"]')

  expectInside(await box(dialog), await box(toolbar))
  expectInside(await box(dialog), await box(types))
  expectInside(await box(dialog), await box(actions))
  expectInside(await box(dialog), await box(output))
  expectInside(await box(dialog), await box(status))
  await expect(typeButtons).toHaveText(['Ping', 'Traceroute', 'DNS', 'TCP'])
  await expect(types.locator('.command-action-separator')).toHaveCount(3)
  await expect(typeButtons.first()).toHaveClass(/active/)
  await typeButtons.nth(1).hover()
  expect(await typeButtons.nth(1).evaluate((element) => window.getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  const activeType = typeButtons.first()
  await expect(activeType).toHaveCSS('border-top-width', '0px')
  await expect(activeType).toHaveCSS('border-left-width', '0px')
  await expect(endpointHeaders).toHaveCount(10)
  await expect(endpointArrows).toHaveCount(10)
  await expect(endpointArrows).toHaveText(['', '', '', '', '', '↑', '', '', '', ''])
  await expect(endpointHeaders.nth(7)).toContainText('连接数')
  await expect(endpointHeaders.nth(1)).toHaveCSS('border-left-width', '0px')
  expect(await endpointHeaders.nth(7).locator('button').evaluate((element) => {
    const style = window.getComputedStyle(element)
    return style.justifyContent === 'center' && style.textAlign === 'center'
  })).toBe(true)
  expect(await endpointHeaders.nth(7).locator('button').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect(endpointResizer).toBeVisible()
  const beforeGrid = await endpointRow.getAttribute('style')
  const resizerBox = await box(endpointResizer)
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 28, resizerBox.y + resizerBox.height / 2)
  await page.mouse.up()
  expect(await endpointRow.getAttribute('style')).not.toBe(beforeGrid)
  await expectInternalScroll(output)
  await expectNoDocumentHorizontalScroll(page)
})
