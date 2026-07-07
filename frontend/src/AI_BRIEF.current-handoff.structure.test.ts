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
    expect(aiBrief).toContain('Current VERSION: `0.5.0-beta.32`')
    expect(aiBrief).toContain('Recommended delivery version: `0.5.0-beta.32` user-smoke-required')
    expect(aiBrief).toContain('beta31 cross-platform Key Vault backup')
    expect(aiBrief).toContain('macOS SecretStore uses Keychain')
    expect(aiBrief).toContain('macOS KeyVault protector stores the application master key in Keychain')
    expect(aiBrief).toContain('Windows backup restore keeps non-sensitive config')
    expect(aiBrief).toContain('macOS local terminal is a single `本地终端` entry')
    expect(aiBrief).toContain('Dark radio checked state and macOS WebView menu/settings blur surfaces')
    expect(aiBrief).toContain('ServerPilot-macos-unsigned')
    expect(aiBrief).toContain('No Windows DPAPI behavior change')
    expect(aiBrief).toContain('No Windows CMD/PowerShell behavior removal')
    expect(aiBrief).toContain('No command completion enhancement')
    expect(aiBrief).toContain('No SSH/SFTP remote runtime change')
    expect(aiBrief).toContain('No DB schema change')
    expect(aiBrief).toContain('No macOS signing or notarization')
    expect(aiBrief).not.toContain('App.vue auth / host-key trust / connection-dialog orchestration')
    expect(aiBrief).not.toContain('TerminalWorkspace split-pane layout / resize / pane shell orchestration large-refactor')
    expect(nonBlankLineCount(aiBrief)).toBeLessThanOrEqual(120)
  })
})
