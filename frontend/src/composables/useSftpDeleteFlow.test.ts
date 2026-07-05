import { describe, expect, it, vi } from 'vitest'
import { useSftpDeleteFlow } from './useSftpDeleteFlow'
import type { SFTPEntry, SFTPInspectDeleteResponse } from '../types'

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

function preview(values: Partial<SFTPInspectDeleteResponse> = {}): SFTPInspectDeleteResponse {
  return {
    connectionId: 7,
    contextId: 'ctx-1',
    paths: ['/home/demo/file.txt'],
    fileCount: 1,
    directoryCount: 0,
    symlinkCount: 0,
    totalBytes: 10,
    warnings: [],
    requiresRecursive: false,
    ...values,
  }
}

describe('useSftpDeleteFlow', () => {
  it('inspects, confirms, deletes, and emits the existing success toast', async () => {
    const inspectDelete = vi.fn(async () => preview())
    const deleteItems = vi.fn(async () => undefined)
    const confirmDelete = vi.fn(async () => true)
    const notify = vi.fn()
    const setBusy = vi.fn()
    const flow = useSftpDeleteFlow({
      getContext: () => ({ connectionId: 7, contextId: 'ctx-1', terminalSessionId: 'term-1', busy: false }),
      inspectDelete,
      deleteItems,
      confirmDelete,
      notify,
      setBusy,
    })

    await flow.removeSelected([entry()])

    expect(inspectDelete).toHaveBeenCalledWith({
      connectionId: 7,
      entries: [expect.objectContaining({ path: '/home/demo/file.txt' })],
      recursive: false,
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
    })
    expect(confirmDelete).toHaveBeenCalledWith(expect.objectContaining({
      title: '删除远程文件',
      confirmText: '删除文件',
      danger: true,
    }))
    expect(deleteItems).toHaveBeenCalledWith({
      connectionId: 7,
      paths: ['/home/demo/file.txt'],
      recursive: false,
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
    })
    expect(notify).toHaveBeenCalledWith('远程文件已删除', 'success')
    expect(setBusy).toHaveBeenNthCalledWith(1, true)
    expect(setBusy).toHaveBeenLastCalledWith(false)
  })

  it('uses recursive danger confirmation for directories and does not delete when canceled', async () => {
    const inspectDelete = vi.fn(async () => preview({ directoryCount: 1, requiresRecursive: true }))
    const deleteItems = vi.fn()
    const confirmDelete = vi.fn(async () => false)
    const flow = useSftpDeleteFlow({
      getContext: () => ({ connectionId: 7, contextId: 'ctx-1', terminalSessionId: 'term-1', busy: false }),
      inspectDelete,
      deleteItems,
      confirmDelete,
      notify: vi.fn(),
      setBusy: vi.fn(),
    })

    await flow.removeSelected([entry({ name: 'logs', path: '/home/demo/logs', isDir: true })])

    expect(inspectDelete).toHaveBeenCalledWith(expect.objectContaining({ recursive: true }))
    expect(confirmDelete).toHaveBeenCalledWith(expect.objectContaining({
      title: '危险操作：删除目录及内容',
      confirmText: '删除选中内容',
    }))
    expect(deleteItems).not.toHaveBeenCalled()
  })

  it('rejects empty, busy, and synthetic-parent deletion without using window.confirm', async () => {
    const inspectDelete = vi.fn()
    const deleteItems = vi.fn()
    const windowConfirm = vi.fn()
    vi.stubGlobal('window', { confirm: windowConfirm })
    const flow = useSftpDeleteFlow({
      getContext: () => ({ connectionId: 7, busy: true }),
      inspectDelete,
      deleteItems,
      confirmDelete: vi.fn(),
      notify: vi.fn(),
      setBusy: vi.fn(),
    })

    await flow.removeSelected([])
    await flow.removeSelected([{ ...entry({ name: '..' }), syntheticParent: true }])

    expect(inspectDelete).not.toHaveBeenCalled()
    expect(deleteItems).not.toHaveBeenCalled()
    expect(windowConfirm).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
