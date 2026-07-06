import { describe, expect, it } from 'vitest'
import { architectureGovernanceHistory } from '../test-support/architectureGovernanceHistory'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const terminalWorkspace = readFileSync(new URL('./TerminalWorkspace.vue', import.meta.url), 'utf8')
const transferModel = readFileSync(new URL('../composables/workspaceTransferOverlayModel.ts', import.meta.url), 'utf8')
const transferFlow = readFileSync(new URL('../composables/useWorkspaceTransferOverlayFlow.ts', import.meta.url), 'utf8')
const transferActions = readFileSync(new URL('../composables/useWorkspaceTransferActions.ts', import.meta.url), 'utf8')

describe('TerminalWorkspace transfer overlay orchestration structure', () => {
  it('delegates transfer model, popover flow, and action dispatch to focused composables', () => {
    expect(terminalWorkspace).toContain('workspaceTransferOverlayModel')
    expect(terminalWorkspace).toContain('useWorkspaceTransferOverlayFlow')
    expect(terminalWorkspace).toContain('useWorkspaceTransferActions')
    for (const forbidden of [
      'function transferStatusLabel',
      'function transferDirectionLabel',
      'function transferSummary',
      'function isTerminalTransferStatus',
      'function transferTerminalMessage',
      'function canCancelTransfer',
      'function canPauseTransfer',
      'function canResumeTransfer',
      'async function cancelTransfer',
      'async function pauseTransfer',
      'async function resumeTransfer',
      'function toggleTransferPause',
      'function transferPopoverBounds',
      'function updateTransferPopoverPosition',
      'function openTransferPopover',
    ]) {
      expect(terminalWorkspace).not.toContain(forbidden)
    }
  })

  it('keeps TerminalWorkspace below this large-refactor line-count target', () => {
    const nonEmptyLineCount = terminalWorkspace.split(/\r?\n/).filter((line) => line.length > 0).length
    expect(nonEmptyLineCount).toBeLessThanOrEqual(1048)
  })

  it('keeps new transfer orchestration files inside frontend-only boundaries', () => {
    for (const [name, source] of [
      ['workspaceTransferOverlayModel.ts', transferModel],
      ['useWorkspaceTransferOverlayFlow.ts', transferFlow],
      ['useWorkspaceTransferActions.ts', transferActions],
    ] as const) {
      expect(source, name).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
      expect(source, name).not.toMatch(/from ['"]\.\.\/stores\//)
      expect(source, name).not.toContain('localStorage')
      expect(source, name).not.toContain('sessionStorage')
      expect(source, name).not.toContain('eventBus')
      expect(source, name).not.toContain('AppController')
      expect(source, name).not.toContain('WriteTerminal')
      expect(source, name).not.toContain('DisconnectServer')
      expect(source, name).not.toMatch(/password|privateKey|passphrase|terminal output|remote file content/i)
    }
  })

  it('keeps this transfer overlay refactor round in architecture governance history', () => {
    const record = architectureGovernanceHistory.terminalWorkspaceTransferOverlayOrchestration
    expect(record.title).toContain('TerminalWorkspace transfer/status overlay orchestration large-refactor')
    expect(record.versionChange).toBe('0.4.0-beta.32 -> 0.4.0-beta.33')
    expect(record.lineCount).toContain('TerminalWorkspace.vue line count')
  })
})
