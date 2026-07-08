import { describe, expect, it } from 'vitest'
import type { LocalTerminalCapabilities } from '../types'
import { buildPlatformCapabilities } from './platformCapabilities'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local component source.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: string, encoding: string) => string }

function localCapabilities(overrides: Partial<LocalTerminalCapabilities> = {}): LocalTerminalCapabilities {
  return {
    platform: 'windows',
    enabled: true,
    supported: true,
    conptyAvailable: true,
    isProcessElevated: false,
    supportsElevation: true,
    shellOptions: [
      { id: 'cmd', label: 'CMD', description: 'cmd.exe' },
      { id: 'powershell', label: 'PowerShell', description: 'powershell.exe' },
    ],
    adminShellOptions: [],
    defaultShellPreference: 'powershell',
    currentShellPreference: 'powershell',
    unsupportedMessage: '',
    ...overrides,
  }
}

describe('platformCapabilities', () => {
  it('keeps the null fallback compatible with the existing Windows-first UI behavior', () => {
    const matrix = buildPlatformCapabilities(null)

    expect(matrix.platform).toBe('windows')
    expect(matrix.isWindows).toBe(true)
    expect(matrix.isMacOS).toBe(false)
    expect(matrix.supportsWindowsAdminTerminal).toBe(true)
    expect(matrix.supportsNativeNotifications).toBe(true)
    expect(matrix.localTerminalActionMode).toBe('shell-list')
    expect(matrix.localTerminalActions.map((item) => item.label)).toEqual(['CMD', 'PowerShell'])
  })

  it('exposes Windows shell-list capabilities without changing CMD and PowerShell order', () => {
    const matrix = buildPlatformCapabilities(localCapabilities())

    expect(matrix).toMatchObject({
      platform: 'windows',
      isWindows: true,
      isMacOS: false,
      isLinux: false,
      supportsWindowsAdminTerminal: true,
      supportsNativeNotifications: true,
      localTerminalActionMode: 'shell-list',
    })
    expect(matrix.localTerminalActions).toEqual([
      { id: 'cmd', label: 'CMD', icon: 'terminal' },
      { id: 'powershell', label: 'PowerShell', icon: 'powershell' },
    ])
  })

  it('collapses macOS local terminals to one local action and disables Windows-only capabilities', () => {
    const matrix = buildPlatformCapabilities(localCapabilities({
      platform: 'darwin',
      conptyAvailable: false,
      supportsElevation: false,
      shellOptions: [{ id: 'local', label: '\u672c\u5730\u7ec8\u7aef', description: '$SHELL' }],
      defaultShellPreference: 'local',
      currentShellPreference: 'local',
    }))

    expect(matrix).toMatchObject({
      platform: 'darwin',
      isWindows: false,
      isMacOS: true,
      isLinux: false,
      supportsWindowsAdminTerminal: false,
      supportsNativeNotifications: false,
      localTerminalActionMode: 'single-local',
    })
    expect(matrix.localTerminalActions).toEqual([
      { id: 'local', label: '\u672c\u5730\u7ec8\u7aef', icon: 'terminal' },
    ])
    expect(matrix.localTerminalActions.map((item) => item.label).join(' ')).not.toContain('CMD')
    expect(matrix.localTerminalActions.map((item) => item.label).join(' ')).not.toContain('PowerShell')
  })

  it('treats Linux as generic shell-list platform without exposing Windows admin terminal controls', () => {
    const matrix = buildPlatformCapabilities(localCapabilities({
      platform: 'linux',
      supportsElevation: false,
      shellOptions: [{ id: 'bash', label: 'Bash', description: '/bin/bash' }],
      defaultShellPreference: 'bash',
      currentShellPreference: 'bash',
    }))

    expect(matrix.platform).toBe('linux')
    expect(matrix.isLinux).toBe(true)
    expect(matrix.supportsWindowsAdminTerminal).toBe(false)
    expect(matrix.supportsNativeNotifications).toBe(true)
    expect(matrix.localTerminalActionMode).toBe('shell-list')
    expect(matrix.localTerminalActions).toEqual([
      { id: 'bash', label: 'Bash', icon: 'terminal' },
    ])
  })

  it('routes SettingsView platform decisions through the shared capability matrix', () => {
    const source = readFileSync('src/components/SettingsView.vue', 'utf8')
    expect(source).toContain('platformCapabilities')
    expect(source).toContain('platformCapabilities.value.platform')
    expect(source).toContain('platformCapabilities.value.isMacOS')
    expect(source).not.toContain("platform.value === 'darwin'")
  })
})
