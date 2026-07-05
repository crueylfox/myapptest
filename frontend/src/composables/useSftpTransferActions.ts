import type { SFTPConflictPolicy } from '../types'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'

export type SftpTransferContext = {
  connectionId: number | null
  contextId?: string | null
  terminalSessionId?: string
  online: boolean
  scpMode: boolean
  currentPath: string
  scpRemotePath: string
  conflictPolicy: SFTPConflictPolicy
  canUploadFile: boolean
  canUploadDirectory: boolean
  canDownloadFile: boolean
  canDownloadDirectory: boolean
}

type TransferRequestBase = {
  connectionId: number
  contextId?: string
  terminalSessionId?: string
}

export type UploadFilesRequest = TransferRequestBase & {
  localPaths: string[]
  conflictPolicy: SFTPConflictPolicy
}

export type UploadFilesToRequest = UploadFilesRequest & {
  remoteDirectory: string
}

export type UploadDirectoryRequest = TransferRequestBase & {
  localPath: string
  conflictPolicy: SFTPConflictPolicy
}

export type UploadDirectoryToRequest = UploadDirectoryRequest & {
  remoteDirectory: string
}

export type DownloadEntriesRequest = TransferRequestBase & {
  localDirectory: string
  conflictPolicy: SFTPConflictPolicy
}

export type DownloadPathRequest = DownloadEntriesRequest & {
  remotePath: string
}

export type SftpTransferConfirmOptions = {
  title: string
  message: string
  confirmText: string
  danger: boolean
}

export type UseSftpTransferActionsOptions = {
  getContext: () => SftpTransferContext
  getSelectedEntries: () => SftpDisplayEntry[]
  selectLocalUploadFiles: () => Promise<string[]>
  selectLocalUploadDirectory: () => Promise<string>
  selectLocalDownloadDirectory: () => Promise<string>
  uploadFiles: (request: UploadFilesRequest) => Promise<unknown>
  uploadFilesTo: (request: UploadFilesToRequest) => Promise<unknown>
  uploadDirectory: (request: UploadDirectoryRequest) => Promise<unknown>
  uploadDirectoryTo: (request: UploadDirectoryToRequest) => Promise<unknown>
  downloadEntries: (request: DownloadEntriesRequest) => Promise<unknown>
  downloadPath: (request: DownloadPathRequest) => Promise<unknown>
  downloadDirectoryPath: (request: DownloadPathRequest) => Promise<unknown>
  chooseRecursiveConflictPolicy: (title: string) => Promise<SFTPConflictPolicy | null>
  confirmOverwrite: (options: SftpTransferConfirmOptions) => Promise<boolean>
  restrictSelectionToVisible: () => void
  notify?: (message: string, type: 'success' | 'error' | 'info') => void
  run: (operation: () => Promise<unknown>, fallback: string) => Promise<unknown>
  formatError?: (reason: unknown, fallback: string) => string
}

export function useSftpTransferActions(options: UseSftpTransferActionsOptions) {
  async function upload() {
    const current = options.getContext()
    if (!current.connectionId || !current.online || !current.canUploadFile) return
    const files = await options.selectLocalUploadFiles()
    if (!files.length) return
    await uploadLocalPaths(files)
  }

  async function uploadDirectory() {
    const current = options.getContext()
    if (!current.connectionId || !current.online || !current.canUploadDirectory) return
    const directory = await options.selectLocalUploadDirectory()
    if (!directory) return
    const policy = await options.chooseRecursiveConflictPolicy('上传文件夹')
    if (!policy) return
    await options.run(async () => {
      if (current.scpMode) {
        await options.uploadDirectoryTo({
          connectionId: current.connectionId!,
          localPath: directory,
          remoteDirectory: current.scpRemotePath,
          conflictPolicy: policy,
          contextId: current.contextId ?? undefined,
          terminalSessionId: current.terminalSessionId,
        })
      } else {
        await options.uploadDirectory({
          connectionId: current.connectionId!,
          localPath: directory,
          conflictPolicy: policy,
          contextId: current.contextId ?? undefined,
          terminalSessionId: current.terminalSessionId,
        })
      }
      options.notify?.('文件夹上传任务已加入队列', 'success')
    }, '上传文件夹失败')
  }

  async function uploadLocalPaths(files: string[]) {
    const current = options.getContext()
    if (!current.connectionId || !current.online || files.length === 0) return
    await options.run(async () => {
      try {
        await uploadFilesWithPolicy(files, current.conflictPolicy)
        options.notify?.('上传任务已加入队列', 'success')
      } catch (reason) {
        if (current.conflictPolicy === 'ask' && formatError(reason, '').includes('已存在')) {
          const confirmed = await options.confirmOverwrite({
            title: '上传冲突',
            message: '远程存在同名文件。是否覆盖本次选择的同名文件？',
            confirmText: '覆盖',
            danger: true,
          })
          if (confirmed) await uploadFilesWithPolicy(files, 'overwrite')
          return
        }
        throw reason
      }
    }, '上传失败')
  }

  async function download() {
    const current = options.getContext()
    const selected = options.getSelectedEntries()
    if (!current.connectionId || !current.online || selected.length === 0 || (!current.canDownloadFile && !current.canDownloadDirectory)) return
    const directory = await options.selectLocalDownloadDirectory()
    if (!directory) return
    const hasDirectory = selected.some((entry) => entry.isDir)
    const policy = hasDirectory ? await options.chooseRecursiveConflictPolicy('下载目录') : current.conflictPolicy
    if (!policy) return
    await options.run(async () => {
      try {
        options.restrictSelectionToVisible()
        await options.downloadEntries({
          connectionId: current.connectionId!,
          localDirectory: directory,
          conflictPolicy: policy,
          contextId: current.contextId ?? undefined,
          terminalSessionId: current.terminalSessionId,
        })
      } catch (reason) {
        if (!hasDirectory && current.conflictPolicy === 'ask' && formatError(reason, '').includes('已存在')) {
          const confirmed = await options.confirmOverwrite({
            title: '下载冲突',
            message: '本地存在同名文件。是否覆盖本次选择的同名文件？',
            confirmText: '覆盖',
            danger: true,
          })
          if (confirmed) {
            options.restrictSelectionToVisible()
            await options.downloadEntries({
              connectionId: current.connectionId!,
              localDirectory: directory,
              conflictPolicy: 'overwrite',
              contextId: current.contextId ?? undefined,
              terminalSessionId: current.terminalSessionId,
            })
          }
          return
        }
        throw reason
      }
    }, '下载失败')
  }

  async function downloadScpFile() {
    const current = options.getContext()
    if (!current.connectionId || !current.online || !current.canDownloadFile || !current.scpRemotePath) return
    const directory = await options.selectLocalDownloadDirectory()
    if (!directory) return
    await options.run(async () => {
      await options.downloadPath({
        connectionId: current.connectionId!,
        remotePath: current.scpRemotePath,
        localDirectory: directory,
        conflictPolicy: current.conflictPolicy,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
      })
      options.notify?.('SCP 下载任务已加入队列', 'success')
    }, 'SCP 下载失败')
  }

  async function downloadScpDirectory() {
    const current = options.getContext()
    if (!current.connectionId || !current.online || !current.scpRemotePath) return
    if (!current.canDownloadDirectory) {
      options.notify?.('当前服务器无法递归列出目录，暂不支持文件夹下载。', 'info')
      return
    }
    const directory = await options.selectLocalDownloadDirectory()
    if (!directory) return
    const policy = await options.chooseRecursiveConflictPolicy('下载目录')
    if (!policy) return
    await options.run(async () => {
      await options.downloadDirectoryPath({
        connectionId: current.connectionId!,
        remotePath: current.scpRemotePath,
        localDirectory: directory,
        conflictPolicy: policy,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
      })
      options.notify?.('SCP 目录下载任务已加入队列', 'success')
    }, 'SCP 目录下载失败')
  }

  async function uploadFilesWithPolicy(files: string[], policy: SFTPConflictPolicy) {
    const current = options.getContext()
    if (!current.connectionId) return
    if (current.scpMode) {
      await options.uploadFilesTo({
        connectionId: current.connectionId,
        localPaths: files,
        remoteDirectory: current.scpRemotePath,
        conflictPolicy: policy,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
      })
    } else {
      await options.uploadFiles({
        connectionId: current.connectionId,
        localPaths: files,
        conflictPolicy: policy,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
      })
    }
  }

  function formatError(reason: unknown, fallback: string) {
    if (options.formatError) return options.formatError(reason, fallback)
    const message = String(reason).replace(/^Error:\s*/i, '').trim()
    return message || fallback
  }

  return {
    upload,
    uploadDirectory,
    uploadLocalPaths,
    download,
    downloadScpFile,
    downloadScpDirectory,
  }
}
