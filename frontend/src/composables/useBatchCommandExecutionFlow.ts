import { api } from '../api/backend'
import { useCommandStore } from '../stores/commands'
import { encodeTerminalInputToBase64 } from '../utils/terminalEncoding'
import { normalizeBatchCommand, type BatchTargetSession } from './useBatchCommandController'

export interface BatchCommandSelectedTarget {
  serverID: number
}

export interface BatchCommandSendResult {
  ok: boolean
  serverID: number
  terminalSessionID: string
}

export interface BatchCommandHistoryResult {
  recorded: number
  skipped: number
  failed: number
  targetCount: number
}

export type BatchCommandToast = {
  message: string
  type: 'success' | 'error' | 'info'
}

export type BatchCommandExecutionResult =
  | {
      ok: true
      command: string
      successfulTargets: BatchCommandSendResult[]
      failed: number
      historyResult: BatchCommandHistoryResult
      toast: BatchCommandToast
    }
  | { ok: false; reason: 'empty-command' | 'no-targets' | 'all-failed'; toast: BatchCommandToast }

export interface UseBatchCommandExecutionFlowOptions {
  resolveTarget: (serverID: number) => BatchTargetSession
  writeTerminal?: (sessionId: string, dataBase64: string) => Promise<void>
  recordBatchHistory?: (payload: {
    command: string
    successfulServerIds: number[]
    submissionId: string
  }) => Promise<{ recorded?: boolean; skipped?: boolean; reasonCode?: string; message?: string; targetCount?: number }>
  reloadHistory?: () => Promise<void>
  createSubmissionID?: () => string
}

export function useBatchCommandExecutionFlow(options: UseBatchCommandExecutionFlowOptions) {
  const commandStore = options.recordBatchHistory ? null : useCommandStore()
  const writeTerminal = options.writeTerminal ?? api.writeTerminal
  const recordBatchHistory = options.recordBatchHistory ?? ((payload) => commandStore!.recordBatchHistory(
    payload.command,
    payload.successfulServerIds,
    payload.submissionId,
  ))
  const reloadHistory = options.reloadHistory ?? (async () => undefined)
  const createSubmissionID = options.createSubmissionID ?? createBatchSubmissionID

  async function executeBatchCommand(input: {
    command: string
    selectedTargets: BatchCommandSelectedTarget[]
  }): Promise<BatchCommandExecutionResult> {
    const command = normalizeBatchCommand(input.command)
    if (!command) {
      return { ok: false, reason: 'empty-command', toast: { message: '请输入要执行的命令。', type: 'error' } }
    }
    if (!input.selectedTargets.length) {
      return { ok: false, reason: 'no-targets', toast: { message: '请选择至少一台在线 SSH 终端。', type: 'error' } }
    }

    const dataBase64 = encodeTerminalInputToBase64(`${command}\r`)
    const submissionID = createSubmissionID()
    const attempts = input.selectedTargets.map(async (target): Promise<BatchCommandSendResult> => {
      const resolved = options.resolveTarget(target.serverID)
      if (!resolved.writable || !resolved.terminalSessionID) {
        return { ok: false, serverID: target.serverID, terminalSessionID: '' }
      }
      await writeTerminal(resolved.terminalSessionID, dataBase64)
      return { ok: true, serverID: target.serverID, terminalSessionID: resolved.terminalSessionID }
    })

    const results = await Promise.allSettled(attempts)
    const successfulTargets = results
      .filter((result): result is PromiseFulfilledResult<BatchCommandSendResult> =>
        result.status === 'fulfilled' && result.value.ok)
      .map((result) => result.value)
    const success = successfulTargets.length
    const failed = results.length - success
    if (success === 0) {
      return {
        ok: false,
        reason: 'all-failed',
        toast: { message: '命令发送失败，没有可用的 SSH 终端。', type: 'error' },
      }
    }

    const historyResult = await recordBatchCommandHistoryResult(
      recordBatchHistory,
      successfulTargets,
      command,
      submissionID,
    )
    await reloadHistory()
    return {
      ok: true,
      command,
      successfulTargets,
      failed,
      historyResult,
      toast: {
        message: batchSendToast(success, failed, historyResult),
        type: failed > 0 || historyResult.failed > 0 ? 'error' : 'success',
      },
    }
  }

  return {
    executeBatchCommand,
  }
}

async function recordBatchCommandHistoryResult(
  recordBatchHistory: NonNullable<UseBatchCommandExecutionFlowOptions['recordBatchHistory']>,
  targets: BatchCommandSendResult[],
  command: string,
  submissionID: string,
): Promise<BatchCommandHistoryResult> {
  const uniqueTargets = dedupeBatchTargets(targets)
  if (!uniqueTargets.length) return { recorded: 0, skipped: 0, failed: 0, targetCount: 0 }
  try {
    const result = await recordBatchHistory({
      command,
      successfulServerIds: uniqueTargets.map((target) => target.serverID),
      submissionId: submissionID,
    })
    return {
      recorded: result.recorded ? 1 : 0,
      skipped: result.skipped ? 1 : 0,
      failed: 0,
      targetCount: result.targetCount || uniqueTargets.length,
    }
  } catch {
    return { recorded: 0, skipped: 0, failed: 1, targetCount: uniqueTargets.length }
  }
}

function dedupeBatchTargets(targets: BatchCommandSendResult[]) {
  const seen = new Set<number>()
  const unique: BatchCommandSendResult[] = []
  for (const target of targets) {
    if (seen.has(target.serverID)) continue
    seen.add(target.serverID)
    unique.push(target)
  }
  return unique
}

function createBatchSubmissionID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `batch-${crypto.randomUUID()}`
  }
  return `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function batchSendToast(success: number, failed: number, historyResult: BatchCommandHistoryResult) {
  if (historyResult.failed > 0) {
    if (failed > 0) {
      return `命令已发送到 ${success} 台服务器，${failed} 台发送失败；另有 ${historyResult.failed} 条历史记录保存失败。`
    }
    return `命令已发送到 ${success} 台服务器，但有 ${historyResult.failed} 条历史记录保存失败。`
  }
  if (historyResult.recorded === 0 && historyResult.skipped > 0) {
    if (failed > 0) return `已发送到 ${success} 台，${failed} 台发送失败；根据历史记录安全规则，本次命令未保存。`
    return '命令已发送；根据历史记录安全规则，本次命令未保存。'
  }
  if (failed > 0) return `已发送到 ${success} 台并写入历史记录，${failed} 台发送失败或终端已关闭。`
  return `已将命令发送到 ${success} 台在线服务器，并写入历史记录。`
}
