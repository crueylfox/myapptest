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

  it('keeps the macOS workflow on GitHub Actions with the expected unsigned artifact contract', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/build-macos.yml', import.meta.url), 'utf8')

    expect(workflow).toContain('runs-on: macos-14')
    expect(workflow).toContain('wails build -platform darwin/universal')
    expect(workflow).toContain('name: HostDeck-macos-unsigned')
    expect(workflow).toContain('HostDeck-macos-universal-unsigned.zip')
    expect(workflow).toContain('HostDeck-macos-universal-unsigned.dmg')
    expect(workflow).toContain('HostDeck-macos-universal-unsigned.zip.sha256')
    expect(workflow).toContain('HostDeck-macos-universal-unsigned.dmg.sha256')
    expect(workflow).not.toContain('codesign')
    expect(workflow).not.toContain('notarytool')
  })

  it('provides an offline artifact verifier without downloading or triggering builds', () => {
    const script = readFileSync(new URL('../../scripts/verify-release-artifacts.ps1', import.meta.url), 'utf8')

    expect(script).toContain('[string]$ArtifactDirectory')
    expect(script).toContain('HostDeck-macos-unsigned')
    expect(script).toContain('HostDeck-macos-universal-unsigned.zip')
    expect(script).toContain('HostDeck-macos-universal-unsigned.dmg')
    expect(script).toContain('Get-FileHash')
    expect(script).toContain('SHA256')
    expect(script).toContain('if-no-files-found')

    expect(script).not.toContain('Invoke-WebRequest')
    expect(script).not.toContain('gh run download')
    expect(script).not.toContain('gh workflow run')
    expect(script).not.toContain('wails build')
    expect(script).not.toContain('git push')
  })
})
