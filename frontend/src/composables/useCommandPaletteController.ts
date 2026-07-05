import { ref, watch, type Ref } from 'vue'

export type CommandPaletteTab = 'history' | 'favorites' | 'batch'
export type CommandPaletteScope = 'all' | 'currentServer'
export type CommandPaletteAction = 'insert' | 'execute'

export type CommandPaletteIntent =
  | { enabled: true; action: CommandPaletteAction; command: string }
  | { enabled: false; action: CommandPaletteAction; command: string; reason: 'no-active-terminal' }

export interface UseCommandPaletteControllerOptions {
  open: Ref<boolean>
  initialTab: Ref<CommandPaletteTab>
  serverId: Ref<number>
  hasActiveTerminal: Ref<boolean>
  initialScope?: CommandPaletteScope
  notify?: (message: string, type: 'success' | 'error' | 'info') => void
  onClose?: () => void
  noActiveTerminalMessage?: string
}

export function useCommandPaletteController(options: UseCommandPaletteControllerOptions) {
  const activeTab = ref<CommandPaletteTab>(options.initialTab.value)
  const query = ref('')
  const selectedIndex = ref(0)
  const scope = ref<CommandPaletteScope>(normalizeScope(options.initialScope ?? 'all', options.serverId.value))
  const busy = ref(false)

  watch(options.open, (open) => {
    if (!open) {
      selectedIndex.value = 0
      return
    }
    activeTab.value = options.initialTab.value
    query.value = ''
    selectedIndex.value = 0
    scope.value = normalizeScope(scope.value, options.serverId.value)
  }, { immediate: true })

  watch(options.serverId, (serverId) => {
    scope.value = normalizeScope(scope.value, serverId)
  })

  function setTab(next: CommandPaletteTab) {
    activeTab.value = next
    selectedIndex.value = 0
  }

  function setScope(next: CommandPaletteScope) {
    const normalized = normalizeScope(next, options.serverId.value)
    scope.value = normalized
    return normalized === next
  }

  function setBusy(next: boolean) {
    busy.value = next
  }

  function closePalette() {
    selectedIndex.value = 0
    options.onClose?.()
  }

  function commandIntent(command: string, action: CommandPaletteAction): CommandPaletteIntent {
    if (options.hasActiveTerminal.value) {
      return { enabled: true, action, command }
    }
    options.notify?.(options.noActiveTerminalMessage ?? '当前没有可用的终端会话', 'error')
    return { enabled: false, action, command, reason: 'no-active-terminal' }
  }

  return {
    activeTab,
    query,
    selectedIndex,
    scope,
    busy,
    setTab,
    setScope,
    setBusy,
    closePalette,
    commandIntent,
  }
}

function normalizeScope(scope: CommandPaletteScope, serverId: number) {
  return serverId ? scope : 'all'
}
