import type { SFTPInspectDeleteResponse } from '../types'
import { buildSftpDeleteConfirmMessage } from '../utils/sftpDeleteConfirmation'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'

export type SftpDeleteContext = {
  connectionId: number | null
  contextId?: string | null
  terminalSessionId?: string
  busy?: boolean
}

export type SftpInspectDeleteRequest = {
  connectionId: number
  entries: SftpDisplayEntry[]
  recursive: boolean
  contextId?: string
  terminalSessionId?: string
}

export type SftpDeleteItemsRequest = {
  connectionId: number
  paths: string[]
  recursive: boolean
  contextId?: string
  terminalSessionId?: string
}

export type SftpDeleteConfirmOptions = {
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

export type UseSftpDeleteFlowOptions = {
  getContext: () => SftpDeleteContext
  inspectDelete: (request: SftpInspectDeleteRequest) => Promise<SFTPInspectDeleteResponse>
  deleteItems: (request: SftpDeleteItemsRequest) => Promise<void>
  confirmDelete: (options: SftpDeleteConfirmOptions) => Promise<boolean>
  notify?: (message: string, type: 'success' | 'error' | 'info') => void
  setBusy?: (busy: boolean) => void
  formatError?: (reason: unknown, fallback: string) => string
}

export function useSftpDeleteFlow(options: UseSftpDeleteFlowOptions) {
  async function removeSelected(targets: SftpDisplayEntry[]) {
    const current = options.getContext()
    if (!current.connectionId || current.busy || targets.length === 0 || targets.some((entry) => entry.syntheticParent)) return false
    const entries = targets.slice()
    const paths = entries.map((entry) => entry.path)
    const recursive = entries.some((entry) => entry.isDir)

    let preview: SFTPInspectDeleteResponse
    options.setBusy?.(true)
    try {
      preview = await options.inspectDelete({
        connectionId: current.connectionId,
        entries,
        recursive,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
      })
    } catch (reason) {
      options.notify?.(formatError(reason, '删除预检查失败'), 'error')
      return false
    } finally {
      options.setBusy?.(false)
    }

    const confirmed = await options.confirmDelete({
      title: recursive ? '危险操作：删除目录及内容' : '删除远程文件',
      message: buildSftpDeleteConfirmMessage(entries, preview),
      confirmText: recursive || entries.length > 1 ? '删除选中内容' : '删除文件',
      cancelText: '取消',
      danger: true,
    })
    if (!confirmed) return false

    options.setBusy?.(true)
    try {
      await options.deleteItems({
        connectionId: current.connectionId,
        paths,
        recursive,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
      })
      options.notify?.(recursive ? '目录及内容已删除' : '远程文件已删除', 'success')
      return true
    } catch (reason) {
      options.notify?.(formatError(reason, '删除失败'), 'error')
      return false
    } finally {
      options.setBusy?.(false)
    }
  }

  function formatError(reason: unknown, fallback: string) {
    if (options.formatError) return options.formatError(reason, fallback)
    const message = String(reason).replace(/^Error:\s*/i, '').trim()
    return message || fallback
  }

  return { removeSelected }
}
