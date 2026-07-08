import { describe, expect, it } from 'vitest'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads a repository script.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

describe('release automation scripts', () => {
  it('provides a dry-run/checkable version preparation script without triggering packaging or push', () => {
    const script = readFileSync(new URL('../../scripts/prepare-release.ps1', import.meta.url), 'utf8')

    expect(script).toContain('[string]$Version')
    expect(script).toContain('[switch]$Check')
    expect(script).toContain('[switch]$WhatIf')
    expect(script).toContain('VERSION')
    expect(script).toContain('internal/version/version.go')
    expect(script).toContain('app_test.go')
    expect(script).toContain('frontend/package.json')
    expect(script).toContain('frontend/package-lock.json')
    expect(script).toContain('frontend/package.json.md5')
    expect(script).toContain('frontend/src/AI_BRIEF.current-handoff.structure.test.ts')
    expect(script).toContain('AI_BRIEF.md')
    expect(script).toContain('System.Security.Cryptography.MD5')
    expect(script).toContain('git status --short')

    expect(script).not.toContain('git push')
    expect(script).not.toContain('wails build')
    expect(script).not.toContain('gh workflow run')
  })
})
