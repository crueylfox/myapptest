import { describe, expect, it } from 'vitest'
import type { LocalTerminalCapabilities } from '../types'
import { buildLocalTerminalActions, localTerminalPaneAction } from './localTerminalActions'

function capabilities(overrides: Partial<LocalTerminalCapabilities> = {}): LocalTerminalCapabilities {
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

describe('localTerminalActions', () => {
  it('keeps Windows CMD and PowerShell actions in capability order', () => {
    expect(buildLocalTerminalActions(capabilities()).map((item) => item.label)).toEqual([
      'CMD',
      'PowerShell',
    ])
  })

  it('collapses macOS local shells into one local terminal action', () => {
    const actions = buildLocalTerminalActions(capabilities({
      platform: 'darwin',
      supportsElevation: false,
      conptyAvailable: false,
      shellOptions: [
        { id: 'local', label: '本地终端', description: '$SHELL' },
      ],
      defaultShellPreference: 'local',
      currentShellPreference: 'local',
    }))

    expect(actions).toEqual([
      { id: 'local', label: '本地终端', icon: 'terminal' },
    ])
    expect(actions.map((item) => item.label).join(' ')).not.toContain('CMD')
    expect(actions.map((item) => item.label).join(' ')).not.toContain('PowerShell')
  })

  it('maps local pane action identifiers without treating macOS local as PowerShell', () => {
    expect(localTerminalPaneAction('cmd')).toBe('new-cmd')
    expect(localTerminalPaneAction('powershell')).toBe('new-powershell')
    expect(localTerminalPaneAction('local')).toBe('new-local')
  })
})
