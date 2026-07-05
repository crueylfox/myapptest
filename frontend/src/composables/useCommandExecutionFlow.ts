import { encodeTerminalInputToBase64 } from '../utils/terminalEncoding'

export interface CommandExecutionTarget {
  kind?: 'ssh' | 'local'
  sessionId: string
  connectionId: number
  status?: string
  localHistoryScope?: 'local:cmd' | 'local:powershell'
}

export interface CommandHistoryResult {
  recorded?: boolean
  skipped?: boolean
  reasonCode?: string
  message?: string
}

export type CommandExecutionAction = 'insert' | 'execute'

export type CommandExecutionResult =
  | { ok: true; action: CommandExecutionAction; sessionId: string }
  | { ok: false; action: CommandExecutionAction; reason: 'no-active-terminal'; sessionId?: string }
  | { ok: false; action: CommandExecutionAction; reason: 'write-failed'; sessionId: string }

export interface UseCommandExecutionFlowOptions {
  getActiveCommandTarget: () => CommandExecutionTarget | null | undefined
  writeTerminal: (sessionId: string, dataBase64: string, target: CommandExecutionTarget) => Promise<void>
  observeTerminalInput: (sessionId: string, payload: string) => boolean
  recordHistory: (payload: {
    kind: 'ssh' | 'local'
    connectionId: number
    sessionId: string
    command: string
    localHistoryScope?: 'local:cmd' | 'local:powershell'
  }) => Promise<CommandHistoryResult>
  notify: (message: string, type: 'success' | 'error' | 'info') => void
  recordHistoryFailure: (command: string, reason: unknown) => void
  noActiveTerminalMessage?: string
}

export function useCommandExecutionFlow(options: UseCommandExecutionFlowOptions) {
  async function insertCommand(command: string): Promise<CommandExecutionResult> {
    return writeCommand(command, false)
  }

  async function executeCommand(command: string): Promise<CommandExecutionResult> {
    return writeCommand(command, true)
  }

  async function writeCommand(command: string, execute: boolean): Promise<CommandExecutionResult> {
    const action: CommandExecutionAction = execute ? 'execute' : 'insert'
    const target = options.getActiveCommandTarget()
    if (!target || target.status !== 'online') {
      options.notify(options.noActiveTerminalMessage ?? '当前没有可用的终端会话', 'error')
      return { ok: false, action, reason: 'no-active-terminal' }
    }
    const payload = execute ? `${command}\r` : command
    try {
      const observed = options.observeTerminalInput(target.sessionId, payload)
      await options.writeTerminal(target.sessionId, encodeTerminalInputToBase64(payload), target)
      if (execute && !observed) {
        void options.recordHistory({
          kind: target.kind ?? 'ssh',
          connectionId: target.connectionId,
          sessionId: target.sessionId,
          command,
          localHistoryScope: target.localHistoryScope,
        }).then((result) => {
          if (result.skipped && result.reasonCode === 'SENSITIVE') {
            options.notify(result.message || '该命令可能包含敏感信息，已跳过历史记录', 'info')
          }
        }).catch((reason) => options.recordHistoryFailure(command, reason))
      }
      return { ok: true, action, sessionId: target.sessionId }
    } catch (reason) {
      options.notify(errorMessage(reason, '写入终端失败'), 'error')
      return { ok: false, action, reason: 'write-failed', sessionId: target.sessionId }
    }
  }

  return {
    insertCommand,
    executeCommand,
    writeCommand,
  }
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}
