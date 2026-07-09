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

test('smoke: topbar menu uses its real compact width with complete labels', async ({ page }) => {
  await openFixture(page, 'workspace-tabs-many')

  await page.locator('.topbar-navigation > button').click()
  const menu = page.locator('.topbar-menu')
  const labels = menu.locator('.topbar-menu-label')
  const items = menu.locator('.topbar-menu-item')
  await expect(items).toHaveCount(10)
  await expect(menu).not.toContainText('应用日志')

  const menuBox = await box(menu)
  expect(menuBox.width).toBeGreaterThanOrEqual(176)
  expect(menuBox.width).toBeLessThanOrEqual(184)
  await expect(menu).toHaveCSS('min-width', '180px')
  await expect(menu).toHaveCSS('max-width', '180px')
  await expect(menu.locator('.topbar-menu-badge')).toBeVisible()
  for (let index = 0; index < await labels.count(); index += 1) {
    const label = labels.nth(index)
    expect(await label.evaluate((element) => window.getComputedStyle(element).textOverflow)).not.toBe('ellipsis')
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
})

test('smoke: settings navigation typography and right content scroll remain stable', async ({ page }) => {
  await openFixture(page, 'settings-nav-final', { width: 760, height: 520 })
  const navButtons = page.locator('[data-testid="settings-nav-final"] .settings-category-nav button')
  await expect(navButtons).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) {
    const button = navButtons.nth(index)
    expect(await button.evaluate((element) => parseFloat(window.getComputedStyle(element).fontSize))).toBe(16)
    expect((await box(button)).height).toBe(42)
  }

  await openFixture(page, 'settings-content-scroll', { width: 900, height: 560 })
  const nav = page.locator('[data-testid="settings-scroll-nav"]')
  const content = page.locator('[data-testid="settings-scroll-content"]')
  const buttons = nav.locator('button')
  await expect(buttons).toHaveCount(6)
  const navBox = await box(nav)
  for (let index = 0; index < 6; index += 1) {
    await buttons.nth(index).click()
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(page.locator('[data-testid="settings-scroll-bottom"]')).toBeInViewport()
    const currentNavBox = await box(nav)
    expect(Math.abs(currentNavBox.x - navBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(currentNavBox.y - navBox.y)).toBeLessThanOrEqual(1)
  }
  await buttons.nth(0).click()
  await expect(page.locator('[data-testid="settings-command-history-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-host-key-policy-fixture"]')).toBeVisible()
  await buttons.nth(1).click()
  await expect(page.locator('[data-testid="settings-ssh-timeout-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-ssh-keepalive-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-terminal-profile-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-ssh-completion-fixture"]')).toBeVisible()
  await buttons.nth(4).click()
  await expect(page.locator('[data-testid="settings-backup-create-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-backup-restore-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-invalid-backup-error-fixture"]')).toBeVisible()
  await buttons.nth(5).click()
  await expect(page.locator('[data-testid="settings-keyvault-list-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-keyvault-edit-fixture"]')).toBeVisible()
  await expect(page.locator('[data-testid="settings-keyvault-masked-secret-fixture"]')).toHaveAttribute('type', 'password')
  await expect(page.locator('[data-testid="settings-content-scroll"]')).not.toContainText('fixture-passphrase')
})

test('smoke: SSH completion geometry stays 500px and local shells stay disabled', async ({ page }) => {
  await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
  const shell = page.locator('[data-testid="ssh-command-completion"]')
  const input = shell.locator('[data-testid="ssh-completion-input"]')
  await input.fill('sys')

  const overlay = shell.locator('[data-testid="terminal-completion-overlay"]')
  await expect(overlay).toBeVisible()
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
    probe.style.whiteSpace = 'pre'
    document.body.appendChild(probe)
    const textWidth = probe.getBoundingClientRect().width
    probe.remove()
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    return {
      cursor: { x: rect.left + paddingLeft + textWidth, y: rect.top, width: 1, height: rect.height },
      token: { x: rect.left + paddingLeft, y: rect.top, width: Math.max(1, textWidth), height: rect.height },
    }
  })
  expect(Math.abs(overlayBox.width - 500)).toBeLessThanOrEqual(8)
  expect(overlayBox.x).toBeGreaterThanOrEqual(caret.cursor.x + 8)
  expectNoOverlap(overlayBox, inputBox)
  expectNoOverlap(overlayBox, caret.cursor)
  expectNoOverlap(overlayBox, caret.token)
  expectInside(await box(shell.locator('.command-completion-fixture-host')), overlayBox)

  await openFixture(page, 'local-command-completion-disabled', { width: 980, height: 620 })
  const localShell = page.locator('[data-testid="local-command-completion-disabled"]')
  await localShell.locator('[data-testid="local-completion-input"]').fill('sys')
  await expect(localShell.locator('[data-testid="terminal-completion-overlay"]')).toHaveCount(0)
})

test.describe('smoke: SSH completion high-DPI geometry', () => {
  test.use({ deviceScaleFactor: 1.5 })

  test('keeps completion overlay near 500 physical pixels on scaled Windows displays', async ({ page }) => {
    await openFixture(page, 'ssh-command-completion', { width: 980, height: 620 })
    const shell = page.locator('[data-testid="ssh-command-completion"]')
    await shell.locator('[data-testid="ssh-completion-input"]').fill('sys')

    const overlay = shell.locator('[data-testid="terminal-completion-overlay"]')
    await expect(overlay).toBeVisible()
    const overlayBox = await box(overlay)
    const dpr = await page.evaluate(() => window.devicePixelRatio)
    expect(dpr).toBe(1.5)
    expect(overlayBox.width).toBeGreaterThanOrEqual(325)
    expect(overlayBox.width).toBeLessThanOrEqual(341)
    expect(Math.abs(overlayBox.width * dpr - 500)).toBeLessThanOrEqual(10)
  })
})

test('smoke: local monitor state, GPU, processes, network chart, and local history persist', async ({ page }) => {
  await openFixture(page, 'local-terminal-cmd-workspace', { width: 1180, height: 720 })
  const shell = page.locator('[data-testid="local-terminal-workspace"]')
  const monitor = shell.locator('.local-monitor-sidebar')
  const systemInfo = monitor.locator('.local-system-info')
  const summary = systemInfo.locator('.system-info-summary')
  const networkChart = monitor.locator('.local-network-compact .network-chart-plot .mini-sparkline')

  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await expect(systemInfo.locator('.local-system-detail')).toHaveCount(0)
  await summary.click()
  await expect(systemInfo.locator('.local-system-detail')).toBeVisible()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await summary.click()
  await expect(systemInfo.locator('.local-system-detail')).toHaveCount(0)
  await shell.getByRole('tab', { name: 'SSH' }).click()
  await shell.getByRole('tab', { name: 'CMD' }).click()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')

  await expect(monitor.locator('[data-testid="local-gpu-card"]')).toContainText('Fixture GPU')
  await expect(monitor.locator('[data-testid="local-gpu-card"]')).toContainText('34.0%')
  await expect(monitor).not.toContainText('OrayIddDriver Device')
  const processCard = monitor.locator('[data-testid="local-process-card"]')
  await expect(processCard).toContainText('fixture.exe')
  await expect(processCard).not.toContainText('unavailable')
  await expect(networkChart).toBeVisible()
  const chartHeight = (await box(networkChart)).height
  await shell.getByRole('tab', { name: 'SSH' }).click()
  await shell.getByRole('tab', { name: 'CMD' }).click()
  await expect(networkChart).toBeVisible()
  expect((await box(networkChart)).height).toBe(chartHeight)

  const input = shell.locator('[data-testid="local-terminal-command-input"]')
  await input.fill('pwd')
  await input.press('Enter')
  await page.reload()
  const reloadedShell = page.locator('[data-testid="local-terminal-workspace"]')
  await reloadedShell.locator('.terminal-command-button').click()
  const history = reloadedShell.locator('[data-testid="local-command-history-list"]')
  await expect(history).toContainText('pwd')
  await expect(history).not.toContainText('[Ipwd')
})

test('smoke: SFTP More and Local Explorer table controls do not regress', async ({ page }) => {
  await openFixture(page, 'sftp-toolbar-narrow', { width: 760, height: 600 })
  const toolbar = page.locator('.sftp-toolbar')
  const more = page.locator('[data-testid="sftp-toolbar-more"]')
  const separators = toolbar.locator('.sftp-toolbar-action-separator:visible')
  await expect(more).toBeVisible()
  await expect(more).toHaveText('更多')
  expect((await box(separators.last())).x).toBeLessThan((await box(more)).x)
  await more.click()
  const menu = page.locator('.sftp-more-menu')
  await expect(menu).toBeVisible()
  expect((await box(menu)).width).toBeLessThanOrEqual(136)

  await openFixture(page, 'local-terminal-cmd-workspace', { width: 1180, height: 720 })
  const table = page.locator('[data-testid="local-explorer-table"]')
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
  await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 32, resizerBox.y + resizerBox.height / 2)
  await page.mouse.up()
  expect(await firstRow.getAttribute('style')).not.toBe(beforeGrid)
})
