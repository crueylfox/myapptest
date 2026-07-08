import type { LocalTerminalCapabilities, LocalTerminalShellKind } from '../types'

export type AppPlatform = LocalTerminalCapabilities['platform']

export type LocalTerminalAction = {
  id: LocalTerminalShellKind | string
  label: string
  icon: 'terminal' | 'powershell'
}

export type LocalTerminalActionMode = 'shell-list' | 'single-local'

export interface PlatformCapabilityMatrix {
  platform: AppPlatform
  isWindows: boolean
  isMacOS: boolean
  isLinux: boolean
  supportsWindowsAdminTerminal: boolean
  supportsNativeNotifications: boolean
  localTerminalActionMode: LocalTerminalActionMode
  localTerminalActions: LocalTerminalAction[]
}

const windowsFallbackActions: LocalTerminalAction[] = [
  { id: 'cmd', label: 'CMD', icon: 'terminal' },
  { id: 'powershell', label: 'PowerShell', icon: 'powershell' },
]

function shellOptionIcon(id: string): LocalTerminalAction['icon'] {
  return id === 'powershell' ? 'powershell' : 'terminal'
}

function buildShellListActions(capabilities?: LocalTerminalCapabilities | null): LocalTerminalAction[] {
  const options = capabilities?.shellOptions ?? []
  if (!options.length) return windowsFallbackActions
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    icon: shellOptionIcon(option.id),
  }))
}

function buildMacOSLocalAction(capabilities?: LocalTerminalCapabilities | null): LocalTerminalAction {
  const option = capabilities?.shellOptions.find((item) => item.id === 'local') ?? capabilities?.shellOptions[0]
  return {
    id: option?.id ?? 'local',
    label: option?.label || '\u672c\u5730\u7ec8\u7aef',
    icon: 'terminal',
  }
}

export function buildPlatformCapabilities(capabilities?: LocalTerminalCapabilities | null): PlatformCapabilityMatrix {
  const platform = capabilities?.platform ?? 'windows'
  const isWindows = platform === 'windows'
  const isMacOS = platform === 'darwin'
  const isLinux = platform === 'linux'
  const localTerminalActionMode: LocalTerminalActionMode = isMacOS ? 'single-local' : 'shell-list'

  return {
    platform,
    isWindows,
    isMacOS,
    isLinux,
    supportsWindowsAdminTerminal: isWindows && (capabilities?.supportsElevation ?? true),
    supportsNativeNotifications: !isMacOS,
    localTerminalActionMode,
    localTerminalActions: isMacOS ? [buildMacOSLocalAction(capabilities)] : buildShellListActions(capabilities),
  }
}
