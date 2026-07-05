import { describe, expect, it, vi } from 'vitest'
import { useSftpTransferActions } from './useSftpTransferActions'
import type { SFTPConflictPolicy, SFTPEntry } from '../types'

function entry(values: Partial<SFTPEntry> = {}): SFTPEntry {
  return {
    name: 'file.txt',
    path: '/home/demo/file.txt',
    parentPath: '/home/demo',
    size: 10,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'root',
    modTime: '2026-06-01T00:00:00Z',
    ...values,
  }
}

function createActions(overrides: Partial<Parameters<typeof useSftpTransferActions>[0]> = {}) {
  const run = vi.fn(async (operation: () => Promise<unknown>, _fallback: string) => { await operation() })
  return {
    run,
    actions: useSftpTransferActions({
      getContext: () => ({
        connectionId: 7,
        contextId: 'ctx-1',
        terminalSessionId: 'term-1',
        online: true,
        scpMode: false,
        currentPath: '/home/demo',
        scpRemotePath: '/tmp/upload-target',
        conflictPolicy: 'ask' as SFTPConflictPolicy,
        canUploadFile: true,
        canUploadDirectory: true,
        canDownloadFile: true,
        canDownloadDirectory: true,
      }),
      getSelectedEntries: () => [entry()],
      selectLocalUploadFiles: vi.fn(async () => ['C:\\tmp\\a.txt']),
      selectLocalUploadDirectory: vi.fn(async () => 'C:\\tmp\\folder'),
      selectLocalDownloadDirectory: vi.fn(async () => 'C:\\downloads'),
      uploadFiles: vi.fn(async () => undefined),
      uploadFilesTo: vi.fn(async () => undefined),
      uploadDirectory: vi.fn(async () => undefined),
      uploadDirectoryTo: vi.fn(async () => undefined),
      downloadEntries: vi.fn(async () => undefined),
      downloadPath: vi.fn(async () => undefined),
      downloadDirectoryPath: vi.fn(async () => undefined),
      chooseRecursiveConflictPolicy: vi.fn(async (): Promise<SFTPConflictPolicy> => 'overwrite'),
      confirmOverwrite: vi.fn(async () => true),
      restrictSelectionToVisible: vi.fn(),
      notify: vi.fn(),
      run,
      formatError: (reason, fallback) => reason instanceof Error ? reason.message : fallback,
      ...overrides,
    }),
  }
}

describe('useSftpTransferActions', () => {
  it('uploads selected files through injected picker and SFTP upload callback', async () => {
    const uploadFiles = vi.fn(async () => undefined)
    const { actions } = createActions({ uploadFiles })

    await actions.upload()

    expect(uploadFiles).toHaveBeenCalledWith({
      connectionId: 7,
      localPaths: ['C:\\tmp\\a.txt'],
      conflictPolicy: 'ask',
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
    })
  })

  it('routes upload folder to SCP target path when in SCP compatibility mode', async () => {
    const uploadDirectoryTo = vi.fn(async () => undefined)
    const { actions } = createActions({
      getContext: () => ({
        connectionId: 7,
        contextId: 'ctx-1',
        terminalSessionId: 'term-1',
        online: true,
        scpMode: true,
        currentPath: '/',
        scpRemotePath: '/tmp/scp-target',
        conflictPolicy: 'ask',
        canUploadFile: true,
        canUploadDirectory: true,
        canDownloadFile: true,
        canDownloadDirectory: true,
      }),
      uploadDirectoryTo,
    })

    await actions.uploadDirectory()

    expect(uploadDirectoryTo).toHaveBeenCalledWith({
      connectionId: 7,
      localPath: 'C:\\tmp\\folder',
      remoteDirectory: '/tmp/scp-target',
      conflictPolicy: 'overwrite',
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
    })
  })

  it('downloads selected entries and restricts selection before transfer callbacks', async () => {
    const restrictSelectionToVisible = vi.fn()
    const downloadEntries = vi.fn(async () => undefined)
    const { actions } = createActions({
      getSelectedEntries: () => [entry({ name: 'dir', path: '/home/demo/dir', isDir: true })],
      restrictSelectionToVisible,
      downloadEntries,
    })

    await actions.download()

    expect(restrictSelectionToVisible).toHaveBeenCalled()
    expect(downloadEntries).toHaveBeenCalledWith({
      connectionId: 7,
      localDirectory: 'C:\\downloads',
      conflictPolicy: 'overwrite',
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
    })
  })

  it('confirms overwrite once for ask-policy single-file upload conflict and then retries with overwrite', async () => {
    const uploadFiles = vi.fn()
      .mockRejectedValueOnce(new Error('remote already 已存在'))
      .mockResolvedValueOnce(undefined)
    const confirmOverwrite = vi.fn(async () => true)
    const { actions } = createActions({ uploadFiles, confirmOverwrite })

    await actions.uploadLocalPaths(['C:\\tmp\\a.txt'])

    expect(confirmOverwrite).toHaveBeenCalledWith(expect.objectContaining({ title: '上传冲突' }))
    expect(uploadFiles).toHaveBeenNthCalledWith(2, expect.objectContaining({ conflictPolicy: 'overwrite' }))
  })

  it('does not call callbacks for disabled or canceled actions', async () => {
    const uploadFiles = vi.fn()
    const downloadEntries = vi.fn()
    const { actions } = createActions({
      getContext: () => ({
        connectionId: 7,
        online: false,
        scpMode: false,
        currentPath: '/home/demo',
        scpRemotePath: '/tmp/target',
        conflictPolicy: 'ask',
        canUploadFile: true,
        canUploadDirectory: true,
        canDownloadFile: true,
        canDownloadDirectory: true,
      }),
      uploadFiles,
      downloadEntries,
    })

    await actions.upload()
    await actions.download()

    expect(uploadFiles).not.toHaveBeenCalled()
    expect(downloadEntries).not.toHaveBeenCalled()
  })
})
