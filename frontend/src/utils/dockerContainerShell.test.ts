import { describe, expect, it } from 'vitest'
import { buildDockerExecShellCommand } from './dockerContainerShell'

describe('dockerContainerShell', () => {
  it('builds a visible docker exec command that opens bash or sh inside the container', () => {
    expect(buildDockerExecShellCommand('abc123')).toBe(
      "docker exec -it abc123 sh -lc 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'\r",
    )
  })

  it('rejects unsafe container identifiers before writing to the terminal', () => {
    expect(() => buildDockerExecShellCommand('abc123;rm -rf /')).toThrow('Invalid Docker container id')
  })
})
