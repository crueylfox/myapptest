import { describe, expect, it } from 'vitest'
import { architectureGovernanceHistory } from '../test-support/architectureGovernanceHistory'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const terminalWorkspace = readFileSync(new URL('./TerminalWorkspace.vue', import.meta.url), 'utf8')
const workspaceCommandModel = readFileSync(new URL('../composables/workspaceCommandModel.ts', import.meta.url), 'utf8')
const workspaceCommandPaletteFlow = readFileSync(new URL('../composables/useWorkspaceCommandPaletteFlow.ts', import.meta.url), 'utf8')
const workspaceCommandActions = readFileSync(new URL('../composables/useWorkspaceCommandActions.ts', import.meta.url), 'utf8')

describe('TerminalWorkspace command orchestration structure', () => {
  it('delegates command palette execution and pane action orchestration to focused composables', () => {
    expect(terminalWorkspace).toContain('useWorkspaceCommandPaletteFlow')
    expect(terminalWorkspace).toContain('useWorkspaceCommandActions')
    expect(terminalWorkspace).not.toContain("from '../composables/useCommandExecutionFlow'")
    expect(terminalWorkspace).not.toContain('const commandPaletteOpen = ref(false)')
    expect(terminalWorkspace).not.toContain('function openCommandPalette')
    expect(terminalWorkspace).not.toContain('async function writeCommand')
    expect(terminalWorkspace).not.toContain('function assignToPane(')
    expect(terminalWorkspace).not.toContain('function togglePaneMenu(')
    expect(terminalWorkspace).not.toContain('function openPaneSwapMenu(')
    expect(terminalWorkspace).not.toContain('function movePaneAssignment(')
  })

  it('keeps TerminalWorkspace below the large-refactor line-count target', () => {
    const lineCount = terminalWorkspace.split(/\r?\n/).length
    expect(lineCount).toBeLessThanOrEqual(1507)
  })

  it('keeps new workspace command composables inside frontend orchestration boundaries', () => {
    for (const [name, source] of [
      ['workspaceCommandModel.ts', workspaceCommandModel],
      ['useWorkspaceCommandPaletteFlow.ts', workspaceCommandPaletteFlow],
      ['useWorkspaceCommandActions.ts', workspaceCommandActions],
    ] as const) {
      expect(source, name).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
      expect(source, name).not.toMatch(/from ['"]\.\.\/stores\//)
      expect(source, name).not.toContain('localStorage')
      expect(source, name).not.toContain('sessionStorage')
      expect(source, name).not.toContain('eventBus')
      expect(source, name).not.toContain('AppController')
    }
  })

  it('keeps this workspace command refactor round in architecture governance history', () => {
    const record = architectureGovernanceHistory.terminalWorkspaceCommandOrchestration
    expect(record.title).toContain('TerminalWorkspace / CommandPalette / workspace command orchestration large-refactor')
    expect(record.versionChange).toBe('0.4.0-beta.28 -> 0.4.0-beta.29')
    expect(record.lineCount).toContain('TerminalWorkspace.vue line count')
  })
})
