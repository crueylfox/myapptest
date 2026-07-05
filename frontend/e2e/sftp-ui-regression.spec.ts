import { expect, type Locator, type Page, test } from '@playwright/test'

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

async function openSftpFixture(page: Page, fixture: string, viewport = { width: 1366, height: 768 }) {
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

async function expectSftpShell(page: Page) {
  const shell = page.locator('.ui-fixture-sftp-shell')
  const panel = shell.locator('.sftp-panel')
  const toolbar = shell.locator('.sftp-toolbar').first()
  const content = shell.locator('[data-testid="sftp-fixture-content"]')
  const list = shell.locator('[data-testid="sftp-file-list"]')

  await expect(shell).toBeVisible()
  await expect(toolbar).toBeVisible()
  await expect(list).toBeVisible()
  expectInside(await box(shell), await box(panel))
  expectInside(await box(panel), await box(toolbar))
  expectInside(await box(panel), await box(content))
  expectInside(await box(content), await box(list))
  expect(await list.evaluate((element) => window.getComputedStyle(element).overflowY)).toBe('auto')
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0)
  await expectNoDocumentHorizontalScroll(page)
}

async function expectRowLeftStableAfterScroll(list: Locator) {
  const firstRow = list.locator('[data-testid="sftp-entry-row"]').first()
  const before = await box(firstRow)
  await list.evaluate((element) => {
    element.scrollTop = Math.min(180, element.scrollHeight - element.clientHeight)
  })
  const after = await box(firstRow)
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
}

test('SFTP file list standard keeps toolbar, rows, and details bounded', async ({ page }) => {
  await openSftpFixture(page, 'sftp-file-list-standard')
  await expectSftpShell(page)

  const shell = page.locator('.ui-fixture-sftp-shell')
  const list = shell.locator('[data-testid="sftp-file-list"]')
  const rows = list.locator('[data-testid="sftp-entry-row"]')
  const details = shell.locator('.sftp-details')

  await expect(rows).toHaveCount(12)
  expectInside(await box(list), await box(rows.first()))
  expectInside(await box(list), await box(rows.nth(5)))
  expectInside(await box(shell), await box(details))
  await expectRowLeftStableAfterScroll(list)
})

test('SFTP long names ellipsize without pushing the table outside the panel', async ({ page }) => {
  await openSftpFixture(page, 'sftp-file-list-long-names', { width: 1024, height: 640 })
  await expectSftpShell(page)

  const shell = page.locator('.ui-fixture-sftp-shell')
  const list = shell.locator('[data-testid="sftp-file-list"]')
  const firstRow = list.locator('[data-testid="sftp-entry-row"]').first()
  const nameCell = firstRow.locator('[data-column-id="name"]').first()
  const label = firstRow.locator('.sftp-entry-label')

  expectInside(await box(list), await box(firstRow))
  expectInside(await box(firstRow), await box(nameCell))
  expect(await label.evaluate((element) => window.getComputedStyle(element).textOverflow)).toBe('ellipsis')
  expect(await list.evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true)
  expect(await shell.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})

test('SFTP toolbar narrow keeps controls visible without overlap', async ({ page }) => {
  await openSftpFixture(page, 'sftp-toolbar-narrow', { width: 980, height: 600 })
  await expectSftpShell(page)

  const toolbar = page.locator('.ui-fixture-sftp-shell .sftp-toolbar').first()
  const path = toolbar.locator('.sftp-pathbar')
  const more = toolbar.locator('[data-testid="sftp-toolbar-more"]')
  const filter = toolbar.locator('[data-testid="sftp-file-filter"]')
  const visibleActions = toolbar.locator('[data-toolbar-action-id]')
  const visibleButtons = toolbar.locator('button[data-toolbar-action-id]')
  const separators = toolbar.locator('.sftp-toolbar-action-separator')

  expectInside(await box(toolbar), await box(path))
  expectInside(await box(toolbar), await box(filter))
  await expect(more).toBeVisible()
  await expect(more).toHaveText('更多')
  expectInside(await box(toolbar), await box(more))
  expectNoOverlap(await box(path), await box(more))
  expect(await more.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect(separators).toHaveCount(await visibleActions.count())
  const lastSeparator = separators.last()
  expect((await box(lastSeparator)).x).toBeLessThan((await box(more)).x)
  for (let index = 0; index < await separators.count(); index += 1) {
    const separatorBox = await box(separators.nth(index))
    expect(separatorBox.height).toBeGreaterThan(separatorBox.width)
  }
  for (let index = 0; index < await visibleButtons.count(); index += 1) {
    expect(await visibleButtons.nth(index).evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
  }
  expect(await more.evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
  expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true)
})

test('SFTP toolbar More dropdown stays compact while preserving nowrap content', async ({ page }) => {
  await openSftpFixture(page, 'sftp-toolbar-narrow', { width: 760, height: 600 })

  const more = page.locator('[data-testid="sftp-toolbar-more"]')
  await more.click()

  const menu = page.locator('.sftp-more-menu')
  const items = menu.locator('.sftp-toolbar-more-item')
  const conflict = menu.locator('[data-testid="sftp-more-conflict-policy"]')
  await expect(menu).toBeVisible()
  await expect(conflict).toBeVisible()

  const menuBox = await box(menu)
  expect(menuBox.width).toBeGreaterThanOrEqual(124)
  expect(menuBox.width).toBeLessThanOrEqual(136)
  for (let index = 0; index < await items.count(); index += 1) {
    const item = items.nth(index)
    expect(await item.evaluate((element) => window.getComputedStyle(element).whiteSpace)).toBe('nowrap')
    expect(await item.evaluate((element) => window.getComputedStyle(element).textOverflow)).not.toBe('ellipsis')
    expect(await item.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
  expect(await conflict.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect((await box(conflict)).x + (await box(conflict)).width).toBeLessThanOrEqual(menuBox.x + menuBox.width - 6)

  await page.setViewportSize({ width: 620, height: 600 })
  await expect(more).toBeVisible()
  await expect(more).toHaveText('更多')
  expect(await more.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})

test('remote text viewer toolbar expands actions on wide layouts and keeps More for narrow layouts', async ({ page }) => {
  await openSftpFixture(page, 'remote-text-viewer-toolbar', { width: 1180, height: 720 })

  const wideToolbar = page.locator('[data-testid="remote-text-viewer-toolbar"] .sftp-editor-toolbar-main')
  await expect(wideToolbar.locator('[data-testid="viewer-more"]')).toHaveCount(0)
  await expect(wideToolbar.locator('[data-testid="viewer-copy-selection"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="viewer-copy-all"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="viewer-reload"]')).toBeVisible()
  await expect(wideToolbar.locator('.sftp-editor-toolbar-separator')).toHaveCount(5)

  for (let index = 0; index < await wideToolbar.locator('.sftp-editor-toolbar-separator').count(); index += 1) {
    const separatorBox = await box(wideToolbar.locator('.sftp-editor-toolbar-separator').nth(index))
    expect(separatorBox.height).toBeGreaterThan(separatorBox.width)
  }
  expect(await wideToolbar.locator('[data-testid="viewer-copy-all"]').evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')

  await page.setViewportSize({ width: 620, height: 620 })
  await expect(wideToolbar.locator('[data-testid="viewer-more"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="viewer-copy-all"]')).toHaveCount(0)
})

test('remote text editor toolbar expands actions on wide layouts and keeps More for narrow layouts', async ({ page }) => {
  await openSftpFixture(page, 'remote-text-editor-toolbar', { width: 1260, height: 720 })

  const wideToolbar = page.locator('[data-testid="remote-text-editor-toolbar"] .sftp-editor-toolbar-main')
  await expect(wideToolbar.locator('[data-testid="editor-more"]')).toHaveCount(0)
  await expect(wideToolbar.locator('[data-testid="editor-save"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="editor-save-as"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="editor-copy-selection"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="editor-reload"]')).toBeVisible()
  await expect(wideToolbar.locator('.sftp-editor-toolbar-separator')).toHaveCount(6)
  expect(await wideToolbar.locator('[data-testid="editor-copy-selection"]').evaluate((element) => window.getComputedStyle(element).borderStyle)).toBe('none')
  await expect(wideToolbar.locator('[data-testid="editor-save"]')).toHaveClass(/primary/)

  await page.setViewportSize({ width: 700, height: 620 })
  await expect(wideToolbar.locator('[data-testid="editor-more"]')).toBeVisible()
  await expect(wideToolbar.locator('[data-testid="editor-save-as"]')).toHaveCount(0)
})

test('SFTP context menu at viewport edge clamps into view', async ({ page }) => {
  await openSftpFixture(page, 'sftp-context-menu-edge', { width: 820, height: 620 })
  await expectSftpShell(page)

  const menu = page.locator('.context-menu')
  await expect(menu).toBeVisible()
  const menuBox = await box(menu)
  const viewport = page.viewportSize()!
  expect(menuBox.x).toBeGreaterThanOrEqual(6)
  expect(menuBox.y).toBeGreaterThanOrEqual(6)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 6 + 1)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 6 + 1)
  await expect(menu.getByRole('menuitem')).toHaveCount(6)
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()
})

test('SFTP empty directory keeps path, toolbar, and compact empty state visible', async ({ page }) => {
  await openSftpFixture(page, 'sftp-empty-directory')
  await expectSftpShell(page)

  const shell = page.locator('.ui-fixture-sftp-shell')
  const empty = shell.locator('[data-testid="sftp-table-empty"]')
  const toolbar = shell.locator('.sftp-toolbar').first()
  const list = shell.locator('[data-testid="sftp-file-list"]')

  await expect(empty).toBeVisible()
  expectInside(await box(list), await box(empty))
  expectInside(await box(shell), await box(toolbar))
  expectInside(await box(shell), await box(list))
  expect((await box(empty)).y).toBeGreaterThan((await box(toolbar)).y + (await box(toolbar)).height)
})

test('SFTP loading and error state keeps retry action visible without clipping', async ({ page }) => {
  await openSftpFixture(page, 'sftp-loading-error', { width: 820, height: 620 })
  await expectSftpShell(page)

  const shell = page.locator('.ui-fixture-sftp-shell')
  const error = shell.locator('[data-testid="sftp-fixture-error"]')
  const loading = shell.locator('[data-testid="sftp-table-loading"]')
  const retry = error.getByRole('button', { name: 'Retry' })

  await expect(error).toBeVisible()
  await expect(loading).toBeVisible()
  await expect(retry).toBeVisible()
  expectInside(await box(shell), await box(error))
  expectInside(await box(error), await box(retry))
})

test('SFTP selection actions stay below rows and inside panel', async ({ page }) => {
  await openSftpFixture(page, 'sftp-selection-actions')
  await expectSftpShell(page)

  const shell = page.locator('.ui-fixture-sftp-shell')
  const list = shell.locator('[data-testid="sftp-file-list"]')
  const actions = shell.locator('[data-testid="sftp-selection-actions"]')
  const deleteButton = actions.getByRole('button', { name: 'Delete' })

  await expect(actions).toBeVisible()
  await expect(deleteButton).toBeVisible()
  expectInside(await box(shell), await box(actions))
  expectNoOverlap(await box(list), await box(actions))
  await expect(list.locator('.sftp-row.selected')).toHaveCount(3)
})

test('SFTP transfer entry shows progress without covering the file table', async ({ page }) => {
  await openSftpFixture(page, 'sftp-transfer-entry')
  await expectSftpShell(page)

  const shell = page.locator('.ui-fixture-sftp-shell')
  const list = shell.locator('[data-testid="sftp-file-list"]')
  const transfers = shell.locator('[data-testid="sftp-transfer-entry-list"]')
  const firstProgress = transfers.locator('progress').first()

  await expect(transfers).toBeVisible()
  await expect(firstProgress).toBeVisible()
  expectInside(await box(shell), await box(transfers))
  expectInside(await box(transfers), await box(firstProgress))
  expectNoOverlap(await box(list), await box(transfers))
  expect(await transfers.evaluate((element) => window.getComputedStyle(element).overflowY)).toBe('auto')
})
