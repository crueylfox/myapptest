import type { LocalTerminalCapabilities, LocalTerminalShellKind } from '../types'

export type AppPlatform = LocalTerminalCapabilities['platform']

export type LocalTerminalAction = {
  id: LocalTerminalShellKind | string
  label: string
  icon: 'terminal' | 'powershell'
}

export type LocalTerminalActionMode = 'shell-list' | 'single-local'

export interface NativeNotificationPlatformCapability {
  supported: boolean
  defaultOffStatus: string
  availableStatus: string
  unavailableStatus: string
  initFailedStatus: string
  enabledBody: string
  sentMessage: string
  failedMessage: string
}

export interface PlatformCapabilityMatrix {
  platform: AppPlatform
  isWindows: boolean
  isMacOS: boolean
  isLinux: boolean
  supportsWindowsAdminTerminal: boolean
  supportsNativeNotifications: boolean
  nativeNotifications: NativeNotificationPlatformCapability
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

export function buildNativeNotificationPlatformCapability(platform: AppPlatform | string = 'windows'): NativeNotificationPlatformCapability {
  if (platform === 'darwin') {
    return {
      supported: false,
      defaultOffStatus: 'macOS 系统通知暂不可用。',
      availableStatus: 'macOS 系统通知可用。',
      unavailableStatus: 'macOS 系统通知暂不可用。',
      initFailedStatus: 'macOS 系统通知初始化失败。',
      enabledBody: 'macOS 系统通知已启用。',
      sentMessage: 'macOS 系统通知测试已发送',
      failedMessage: 'macOS 系统通知发送失败',
    }
  }
  if (platform === 'windows') {
    return {
      supported: true,
      defaultOffStatus: '默认关闭，开启后会发送已有告警事件到系统原生通知。',
      availableStatus: 'Windows 原生通知可用。',
      unavailableStatus: 'Windows 原生通知不可用。',
      initFailedStatus: 'Windows 原生通知初始化失败。',
      enabledBody: 'Windows 原生通知已启用。',
      sentMessage: 'Windows 原生通知测试已发送',
      failedMessage: 'Windows 原生通知发送失败',
    }
  }
  return {
    supported: true,
    defaultOffStatus: '默认关闭，开启后会发送已有告警事件到系统原生通知。',
    availableStatus: '系统通知可用。',
    unavailableStatus: '系统通知不可用。',
    initFailedStatus: '系统通知初始化失败。',
    enabledBody: '系统通知已启用。',
    sentMessage: '系统通知测试已发送',
    failedMessage: '系统通知发送失败',
  }
}

export function buildPlatformCapabilities(capabilities?: LocalTerminalCapabilities | null): PlatformCapabilityMatrix {
  const platform = capabilities?.platform ?? 'windows'
  const isWindows = platform === 'windows'
  const isMacOS = platform === 'darwin'
  const isLinux = platform === 'linux'
  const localTerminalActionMode: LocalTerminalActionMode = isMacOS ? 'single-local' : 'shell-list'
  const nativeNotifications = buildNativeNotificationPlatformCapability(platform)

  return {
    platform,
    isWindows,
    isMacOS,
    isLinux,
    supportsWindowsAdminTerminal: isWindows && (capabilities?.supportsElevation ?? true),
    supportsNativeNotifications: nativeNotifications.supported,
    nativeNotifications,
    localTerminalActionMode,
    localTerminalActions: isMacOS ? [buildMacOSLocalAction(capabilities)] : buildShellListActions(capabilities),
  }
}
