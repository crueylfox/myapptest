import { describe, expect, it } from 'vitest'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

function nonBlankLineCount(fileSource: string) {
  return fileSource.trimEnd().split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0).length
}

const aiBrief = readFileSync(new URL('../../AI_BRIEF.md', import.meta.url), 'utf8')

describe('AI_BRIEF current handoff summary contract', () => {
  it('keeps AI_BRIEF focused on the current handoff instead of historical large-refactor records', () => {
    expect(aiBrief).toContain('# AI_BRIEF - ServerPilot Current Handoff')
    expect(aiBrief).toContain('Previous delivery version: `0.5.0-beta.28` PASS')
    expect(aiBrief).toContain('Current VERSION: `0.5.0-beta.29`')
    expect(aiBrief).toContain('Recommended delivery version: `0.5.0-beta.29` user-smoke-required')
    expect(aiBrief).toContain('security / backup / key vault hardening')
    expect(aiBrief).toContain('Backup schema excluding terminal output')
    expect(aiBrief).toContain('Key Vault private-key validation errors not echoing passphrase input')
    expect(aiBrief).toContain('Settings security surfaces')
    expect(aiBrief).toContain('Backup / restore invalid-error visibility')
    expect(aiBrief).toContain('Key Vault list/edit entry points and masked secret UI')
    expect(aiBrief).toContain('No Docker destructive action')
    expect(aiBrief).toContain('No command completion enhancement')
    expect(aiBrief).toContain('No SSH/SFTP runtime change')
    expect(aiBrief).toContain('No DB schema change')
    expect(aiBrief).toContain('No Local Explorer write operation')
    expect(aiBrief).toContain('No SecretStore / Backup data format change')
    expect(aiBrief).not.toContain('App.vue auth / host-key trust / connection-dialog orchestration')
    expect(aiBrief).not.toContain('TerminalWorkspace split-pane layout / resize / pane shell orchestration large-refactor')
    expect(nonBlankLineCount(aiBrief)).toBeLessThanOrEqual(120)
  })
})
