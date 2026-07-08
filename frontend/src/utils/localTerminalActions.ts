import type { LocalTerminalCapabilities, LocalTerminalShellKind } from '../types'
import { buildPlatformCapabilities, type LocalTerminalAction } from './platformCapabilities'

export type { LocalTerminalAction }

export function buildLocalTerminalActions(capabilities?: LocalTerminalCapabilities | null): LocalTerminalAction[] {
  return buildPlatformCapabilities(capabilities).localTerminalActions
}

export function localTerminalPaneAction(shellKind: LocalTerminalShellKind | string) {
  if (shellKind === 'cmd') return 'new-cmd'
  if (shellKind === 'powershell') return 'new-powershell'
  return 'new-local'
}
