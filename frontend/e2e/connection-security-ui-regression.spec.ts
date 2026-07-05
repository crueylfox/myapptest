import { expect, type Locator, type Page, test } from '@playwright/test'

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

async function openConnectionSecurityFixture(page: Page, fixture: string, viewport = { width: 1366, height: 768 }) {
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

async function expectAlertCenterTopmost(page: Page, panel: Locator) {
  const panelBox = await box(panel)
  const topmostIsAlertCenter = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    return Boolean(element?.closest('[data-testid="alert-center"]'))
  }, {
    x: panelBox.x + panelBox.width / 2,
    y: panelBox.y + panelBox.height / 2,
  })
  expect(topmostIsAlertCenter).toBe(true)
}

async function expectInternalScroll(locator: Locator) {
  expect(await locator.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await locator.evaluate((element) => window.getComputedStyle(element).overflowY)).toMatch(/auto|scroll/)
}

test('Connection dialog password state keeps fields, validation, and footer bounded in a narrow viewport', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'connection-dialog-password', { width: 560, height: 640 })

  const dialog = page.locator('[data-testid="connection-dialog-password"] .connection-modal')
  const form = dialog.locator('.connection-form')
  const host = dialog.locator('[data-testid="host"]')
  const user = dialog.locator('[data-testid="username"]')
  const error = dialog.locator('[data-testid="connection-validation-error"]')
  const footer = dialog.locator('.connection-dialog-footer')

  expectInside(await box(dialog), await box(form))
  expectInside(await box(dialog), await box(error))
  expectInside(await box(dialog), await box(footer))
  expectNoOverlap(await box(host), await box(user))
  await expect(dialog.getByTestId('save-connect')).toBeVisible()
  await expectNoDocumentHorizontalScroll(page)
})

test('Connection dialog Key Vault state keeps selected credential summary and actions visible', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'connection-dialog-keyvault', { width: 720, height: 640 })

  const dialog = page.locator('[data-testid="connection-dialog-keyvault"] .connection-modal')
  const keySelect = dialog.locator('[data-testid="key-vault-select"]')
  const summary = dialog.locator('[data-testid="selected-key-vault-summary"]')
  const footer = dialog.locator('.connection-dialog-footer')
  const addKey = dialog.locator('[data-testid="connection-add-key"]')

  expectInside(await box(dialog), await box(keySelect))
  expectInside(await box(dialog), await box(summary))
  expectInside(await box(dialog), await box(footer))
  expectInside(await box(dialog), await box(addKey))
  expect(await summary.locator('strong').evaluate((element) => window.getComputedStyle(element).textOverflow)).toBe('ellipsis')
  await expectNoDocumentHorizontalScroll(page)
})

test('Connection dialog advanced state keeps routing, profile, and warnings inside the dialog', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'connection-dialog-advanced', { width: 600, height: 620 })

  const dialog = page.locator('[data-testid="connection-dialog-advanced"] .connection-modal')
  const form = dialog.locator('.connection-form')
  const route = dialog.locator('[data-testid="connection-route-select"]')
  const profile = dialog.locator('[data-testid="terminal-profile-select"]')
  const warning = dialog.locator('[data-testid="jump-server-missing"]')
  const footer = dialog.locator('.connection-dialog-footer')

  expectInside(await box(dialog), await box(route))
  expectInside(await box(dialog), await box(profile))
  expectInside(await box(dialog), await box(warning))
  expectInside(await box(dialog), await box(footer))
  await expectInternalScroll(form)
})

test('Auth dialog password error keeps prompt, error, input, and actions visible', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'auth-dialog-password-error', { width: 520, height: 520 })

  const dialog = page.locator('[data-testid="auth-dialog-password-error"] .auth-modal')
  const target = dialog.locator('.target')
  const error = dialog.locator('.form-error')
  const input = dialog.locator('input[type="password"]')
  const footer = dialog.locator('footer')

  expectInside(await box(dialog), await box(target))
  expectInside(await box(dialog), await box(error))
  expectInside(await box(dialog), await box(input))
  expectInside(await box(dialog), await box(footer))
  expectNoOverlap(await box(error), await box(input))
  await expectNoDocumentHorizontalScroll(page)
})

test('Auth dialog key passphrase state keeps private-key prompt and actions bounded', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'auth-dialog-key-passphrase', { width: 520, height: 520 })

  const dialog = page.locator('[data-testid="auth-dialog-key-passphrase"] .auth-modal')
  const saved = dialog.locator('.saved-credential')
  const input = dialog.locator('input[type="password"]')
  const checkbox = dialog.locator('.checkbox')
  const footer = dialog.locator('footer')

  expectInside(await box(dialog), await box(saved))
  expectInside(await box(dialog), await box(input))
  expectInside(await box(dialog), await box(checkbox))
  expectInside(await box(dialog), await box(footer))
  await expectNoDocumentHorizontalScroll(page)
})

test('Host-key trust changed warning keeps fingerprint and danger actions inside the dialog', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'host-key-trust-changed', { width: 640, height: 560 })

  const dialog = page.locator('[data-testid="host-key-trust-changed"] .host-key-trust-dialog')
  const warning = dialog.locator('[data-testid="host-key-warning"]')
  const fingerprints = dialog.locator('[data-testid="host-key-fingerprints"]')
  const actions = dialog.locator('.host-key-actions')
  const accept = actions.getByRole('button', { name: '信任并更新' })

  expectInside(await box(dialog), await box(warning))
  expectInside(await box(dialog), await box(fingerprints))
  expectInside(await box(dialog), await box(actions))
  await expect(accept).toHaveClass(/danger/)
  await expectNoDocumentHorizontalScroll(page)
})

test('Key Vault list fixture keeps empty state, many rows, long names, and actions bounded', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'key-vault-list-empty-and-many', { width: 900, height: 640 })

  const shell = page.locator('[data-testid="key-vault-list-empty-and-many"]')
  const card = shell.locator('.key-vault-card')
  const list = shell.locator('.key-vault-list')
  const rows = shell.locator('.key-vault-row')
  const firstRow = rows.first()
  const actions = firstRow.locator('.key-vault-actions')

  expectInside(await box(shell), await box(card))
  await expect(shell.locator('[data-testid="key-vault-empty"]')).toBeVisible()
  await expect(rows).toHaveCount(18)
  expectInside(await box(list), await box(firstRow))
  expectInside(await box(firstRow), await box(actions))
  await expectInternalScroll(list)
  await expectNoDocumentHorizontalScroll(page)
})

test('Key Vault edit form keeps metadata-only fields, validation, and footer visible', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'key-vault-edit-form', { width: 680, height: 620 })

  const dialog = page.locator('[data-testid="key-vault-edit-form"] .key-vault-modal')
  const grid = dialog.locator('.form-grid')
  const validation = dialog.locator('.validation-panel')
  const footer = dialog.locator('footer')

  expectInside(await box(dialog), await box(grid))
  expectInside(await box(dialog), await box(validation))
  expectInside(await box(dialog), await box(footer))
  expect(await dialog.textContent()).not.toContain('-----BEGIN')
  await expectNoDocumentHorizontalScroll(page)
})

test('Alert Center list keeps tabs, actions, rows, and internal scrolling bounded', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'alert-center-list', { width: 760, height: 640 })

  const shell = page.locator('[data-testid="alert-center-list"]')
  const panel = shell.locator('.alert-center-panel')
  const tabs = panel.locator('.alert-center-tabs')
  const list = panel.locator('.alert-center-list')
  const rows = panel.locator('.alert-row')
  const rowActions = rows.first().locator('.alert-row-actions')

  expectInside(await box(shell), await box(panel))
  expectInside(await box(panel), await box(tabs))
  expectInside(await box(panel), await box(list))
  await expect(rows).toHaveCount(12)
  expectInside(await box(rows.first()), await box(rowActions))
  await expectInternalScroll(list)
})

test('Monitor panel alert center entry opens the Alert Center drawer', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'monitor-alert-center-entry', { width: 980, height: 640 })

  const shell = page.locator('[data-testid="monitor-alert-center-entry"]')
  const dashboard = shell.locator('.monitor-dashboard')
  const button = shell.locator('[data-testid="monitor-alert-center"]')

  expectInside(await box(shell), await box(dashboard))
  await expect(button).toBeVisible()
  await expect(button).toContainText('2')
  await expect(page.locator('[data-testid="alert-center"]')).toHaveCount(0)

  await button.click()

  const alertCenter = page.locator('[data-testid="alert-center"]')
  const panel = alertCenter.locator('.alert-center-panel')
  const rows = panel.locator('.alert-row')

  await expect(alertCenter).toBeVisible()
  await expect(panel).toBeVisible()
  await expect(rows).toHaveCount(3)
  await expect(panel.getByText('Synthetic CPU alert')).toBeVisible()
  await expectNoDocumentHorizontalScroll(page)
})

test('Dashboard alert center entry opens the Alert Center above the monitor dialog', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'dashboard-alert-center-layer', { width: 980, height: 640 })

  const shell = page.locator('[data-testid="dashboard-alert-center-layer"]')
  const dialog = shell.locator('.multi-server-dashboard')
  const button = shell.locator('[data-testid="dashboard-alert-center"]')

  await expect(dialog).toBeVisible()
  await expect(button).toBeVisible()
  await expect(button).toContainText('2')
  await expect(page.locator('[data-testid="alert-center"]')).toHaveCount(0)

  await button.click()

  const alertCenter = page.locator('[data-testid="alert-center"]')
  const panel = alertCenter.locator('.alert-center-panel')

  await expect(alertCenter).toBeVisible()
  await expect(panel).toBeVisible()
  await expectAlertCenterTopmost(page, panel)
  await expectNoDocumentHorizontalScroll(page)
})

test('App logs long-line fixture keeps filters, buttons, and log body internally scrollable', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'app-logs-long-lines', { width: 980, height: 640 })

  const panel = page.locator('[data-testid="app-logs-long-lines"].logs-panel')
  const filters = panel.locator('.log-filters')
  const table = panel.locator('.log-table')
  const rows = panel.locator('.log-row')
  const refresh = panel.locator('.app-log-refresh-button')

  expectInside(await box(panel), await box(filters))
  expectInside(await box(panel), await box(table))
  expectInside(await box(filters), await box(refresh))
  await expect(rows).toHaveCount(24)
  await expectInternalScroll(table)
  await expectNoDocumentHorizontalScroll(page)
})

test('Command palette search fixture keeps long disabled commands and actions inside the palette', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'command-palette-search-disabled', { width: 760, height: 620 })

  const palette = page.locator('[data-testid="command-palette-search-disabled"] .command-palette')
  const search = palette.locator('.command-search')
  const list = palette.locator('.command-list')
  const row = palette.locator('.command-row').first()
  const actions = row.locator('.command-row-actions')

  expectInside(await box(palette), await box(search))
  expectInside(await box(palette), await box(list))
  expectInside(await box(list), await box(row))
  expectInside(await box(row), await box(actions))
  await expect(row.getByRole('button', { name: '执行' })).toBeDisabled()
  await expectInternalScroll(list)
})

test('Command palette no-result fixture keeps empty state stable and bounded', async ({ page }) => {
  await openConnectionSecurityFixture(page, 'command-palette-no-results', { width: 560, height: 520 })

  const palette = page.locator('[data-testid="command-palette-no-results"] .command-palette')
  const search = palette.locator('.command-search')
  const empty = palette.locator('.empty-state')
  const tabs = palette.locator('.command-palette-tabs')

  expectInside(await box(palette), await box(tabs))
  expectInside(await box(palette), await box(search))
  expectInside(await box(palette), await box(empty))
  await expectNoDocumentHorizontalScroll(page)
})
