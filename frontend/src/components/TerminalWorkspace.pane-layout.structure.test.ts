import { describe, expect, it } from 'vitest'
import { architectureGovernanceHistory } from '../test-support/architectureGovernanceHistory'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const terminalWorkspace = readFileSync(new URL('./TerminalWorkspace.vue', import.meta.url), 'utf8')
const layoutModel = readFileSync(new URL('../composables/workspacePaneLayoutModel.ts', import.meta.url), 'utf8')
const resizeFlow = readFileSync(new URL('../composables/useWorkspacePaneResizeFlow.ts', import.meta.url), 'utf8')
const shellBindings = readFileSync(new URL('../composables/useWorkspacePaneShellBindings.ts', import.meta.url), 'utf8')

describe('TerminalWorkspace pane layout orchestration structure', () => {
  it('delegates pane layout styles, monitor/SFTP resize flow, and pane shell bindings', () => {
    expect(terminalWorkspace).toContain('buildWorkspaceShellStyle')
    expect(terminalWorkspace).toContain('buildWorkspaceRightStyle')
    expect(terminalWorkspace).toContain('useWorkspacePaneResizeFlow')
    expect(terminalWorkspace).toContain('useWorkspacePaneShellBindings')
    expect(terminalWorkspace).not.toContain("let dragMode: 'sidebar' | 'sftp' | null")
    expect(terminalWorkspace).not.toContain('function startDrag(')
    expect(terminalWorkspace).not.toContain('function moveDrag(')
    expect(terminalWorkspace).not.toContain('function stopDrag(')
    expect(terminalWorkspace).not.toContain('function paneTab(')
    expect(terminalWorkspace).not.toContain('function paneLocalSession(')
    expect(terminalWorkspace).not.toContain('function paneAssigned(')
    expect(terminalWorkspace).not.toContain('function paneKind(')
    expect(terminalWorkspace).not.toContain('function paneTitle(')
  })

  it('keeps split pane UI wiring and line count inside this large-refactor target', () => {
    expect(terminalWorkspace).toContain('<TerminalSplitWorkspace')
    expect(terminalWorkspace).toContain('@splitter-drag-start="paneResizeBridge.startSplitResize"')
    expect(terminalWorkspace).toContain(`@pointerdown="startDrag('sidebar', $event)"`)
    expect(terminalWorkspace).toContain(`@pointerdown="startDrag('sftp', $event)"`)
    expect(terminalWorkspace).not.toContain('bottom-panel-toggle-handle')
    expect(terminalWorkspace).not.toContain('sidebar-toggle')
    expect(terminalWorkspace).not.toMatch(/terminal-split-workspace[\s\S]{0,600}margin:\s*-/)
    expect(terminalWorkspace).not.toMatch(/terminal-split-workspace[\s\S]{0,600}!important/)

    const lineCount = terminalWorkspace.split(/\r?\n/).filter((line) => line.length > 0).length
    expect(lineCount).toBeLessThanOrEqual(1144)
  })

  it('keeps new pane orchestration files inside frontend-only boundaries', () => {
    for (const [name, source] of [
      ['workspacePaneLayoutModel.ts', layoutModel],
      ['useWorkspacePaneResizeFlow.ts', resizeFlow],
      ['useWorkspacePaneShellBindings.ts', shellBindings],
    ] as const) {
      expect(source, name).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
      expect(source, name).not.toMatch(/from ['"]\.\.\/stores\//)
      expect(source, name).not.toContain('localStorage')
      expect(source, name).not.toContain('sessionStorage')
      expect(source, name).not.toContain('eventBus')
      expect(source, name).not.toContain('AppController')
      expect(source, name).not.toContain('WriteTerminal')
      expect(source, name).not.toContain('DisconnectServer')
    }
  })

  it('keeps this pane layout refactor round in architecture governance history', () => {
    const record = architectureGovernanceHistory.terminalWorkspacePaneLayoutOrchestration
    expect(record.title).toContain('TerminalWorkspace split-pane layout / resize / pane shell orchestration large-refactor')
    expect(record.versionChange).toBe('0.4.0-beta.29 -> 0.4.0-beta.30')
    expect(record.lineCount).toContain('TerminalWorkspace.vue line count')
  })
})
