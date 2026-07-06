import type { LocalTerminalCapabilities, LocalTerminalShellKind } from '../types'

export type LocalTerminalAction = {
  id: LocalTerminalShellKind | string
  label: string
  icon: 'terminal' | 'powershell'
}

const windowsFallbackActions: LocalTerminalAction[] = [
  { id: 'cmd', label: 'CMD', icon: 'terminal' },
  { id: 'powershell', label: 'PowerShell', icon: 'powershell' },
]

export function buildLocalTerminalActions(capabilities?: LocalTerminalCapabilities | null): LocalTerminalAction[] {
  if (capabilities?.platform === 'darwin') {
    const option = capabilities.shellOptions.find((item) => item.id === 'local') ?? capabilities.shellOptions[0]
    return [{
      id: option?.id ?? 'local',
      label: option?.label || '本地终端',
      icon: 'terminal',
    }]
  }
  const options = capabilities?.shellOptions ?? []
  if (!options.length) return windowsFallbackActions
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    icon: option.id === 'powershell' ? 'powershell' : 'terminal',
  }))
}

export function localTerminalPaneAction(shellKind: LocalTerminalShellKind | string) {
  if (shellKind === 'cmd') return 'new-cmd'
  if (shellKind === 'powershell') return 'new-powershell'
  return 'new-local'
}
