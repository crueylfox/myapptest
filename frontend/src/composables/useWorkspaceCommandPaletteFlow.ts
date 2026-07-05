import { ref } from 'vue'
import {
  useCommandExecutionFlow,
  type CommandExecutionResult,
  type UseCommandExecutionFlowOptions,
} from './useCommandExecutionFlow'
import type { CommandPaletteTab } from './useCommandPaletteController'

export function useWorkspaceCommandPaletteFlow(options: UseCommandExecutionFlowOptions) {
  const commandPaletteOpen = ref(false)
  const commandPaletteTab = ref<CommandPaletteTab>('history')
  const commandExecutionFlow = useCommandExecutionFlow(options)

  function openCommandPalette(tab: CommandPaletteTab) {
    commandPaletteTab.value = tab
    commandPaletteOpen.value = true
  }

  function closeCommandPalette() {
    commandPaletteOpen.value = false
  }

  async function writeCommand(command: string, execute = false): Promise<CommandExecutionResult> {
    if (execute) return commandExecutionFlow.executeCommand(command)
    return commandExecutionFlow.insertCommand(command)
  }

  return {
    commandPaletteOpen,
    commandPaletteTab,
    openCommandPalette,
    closeCommandPalette,
    writeCommand,
  }
}
