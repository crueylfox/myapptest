import { describe, expect, it } from 'vitest'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local Vue source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }
const source = readFileSync(new URL('./CommandPalette.vue', import.meta.url), 'utf8')
const terminalWorkspaceSource = readFileSync(new URL('./TerminalWorkspace.vue', import.meta.url), 'utf8')
const uiComponentFiles = [
  'CommandPaletteShell.vue',
  'CommandPaletteSearchBar.vue',
  'CommandPaletteScopeTabs.vue',
  'CommandPaletteResultsList.vue',
  'CommandPaletteResultItem.vue',
  'CommandPaletteEditorDialog.vue',
  'BatchCommandPanel.vue',
] as const
const uiComponentSources = uiComponentFiles.map((file) => ({
  file,
  source: readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'),
}))

describe('CommandPalette structure', () => {
  it('does not own terminal write or batch history execution orchestration', () => {
    expect(source).not.toContain("../api/backend")
    expect(source).not.toContain('api.writeTerminal')
    expect(source).not.toContain('encodeTerminalInputToBase64')
    expect(source).not.toMatch(/recordBatchHistory\s*\(/)
    expect(source).not.toMatch(/Promise\.allSettled\s*\(\s*attempts/)
  })

  it('delegates command and batch execution to flow composables while retaining UI composition', () => {
    expect(source).toContain('useBatchCommandExecutionFlow')
    expect(source).toContain('confirmDialog')
    expect(source).toContain('CommandFavoriteEditor')
    expect(terminalWorkspaceSource).toContain('useWorkspaceCommandPaletteFlow')
    expect(terminalWorkspaceSource).not.toContain("from '../composables/useCommandExecutionFlow'")
  })

  it('does not own command history or favorite CRUD orchestration', () => {
    expect(source).toContain('useCommandLibraryDataFlow')
    expect(source).not.toMatch(/store\.loadHistory\s*\(/)
    expect(source).not.toMatch(/store\.loadFavorites\s*\(/)
    expect(source).not.toMatch(/store\.updateHistory\s*\(/)
    expect(source).not.toMatch(/store\.deleteHistory\s*\(/)
    expect(source).not.toMatch(/store\.clearHistory\s*\(/)
    expect(source).not.toMatch(/store\.saveFavorite\s*\(/)
    expect(source).not.toMatch(/store\.deleteFavorite\s*\(/)
    expect(source).not.toMatch(/store\.markFavoriteUsed\s*\(/)
    expect(source).toContain('CommandFavoriteEditor')
  })

  it('composes the extracted command palette UI shell components', () => {
    expect(source).toContain("import CommandPaletteShell from './CommandPaletteShell.vue'")
    expect(source).toContain("import CommandPaletteSearchBar from './CommandPaletteSearchBar.vue'")
    expect(source).toContain("import CommandPaletteScopeTabs from './CommandPaletteScopeTabs.vue'")
    expect(source).toContain("import CommandPaletteResultsList from './CommandPaletteResultsList.vue'")
    expect(source).toContain("import CommandPaletteEditorDialog from './CommandPaletteEditorDialog.vue'")
    expect(source).toContain("import BatchCommandPanel from './BatchCommandPanel.vue'")
  })

  it('does not inline result rows, editor form, search input, scope tabs, or batch target markup', () => {
    expect(source).not.toContain('class="command-row command-row-compact command-history-row"')
    expect(source).not.toContain('class="command-row command-row-compact command-favorite-row"')
    expect(source).not.toContain('class="batch-server-chip-list"')
    expect(source).not.toContain('class="batch-server-chip"')
    expect(source).not.toContain('data-testid="command-history-editor"')
    expect(source).not.toContain('class="command-search"')
    expect(source).not.toContain('class="command-scope-filter"')
    expect(source).not.toContain('data-testid="batch-command-input"')
  })

  it('keeps extracted UI components free of stores, backend API, terminal writes, and persistence', () => {
    for (const component of uiComponentSources) {
      expect(component.source, component.file).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
      expect(component.source, component.file).not.toMatch(/from ['"]\.\.\/stores\//)
      expect(component.source, component.file).not.toContain('writeTerminal')
      expect(component.source, component.file).not.toContain('recordBatchHistory')
      expect(component.source, component.file).not.toContain('localStorage')
    }
  })
})
