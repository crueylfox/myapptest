import { describe, expect, it, vi } from 'vitest'
import { useSftpPropertiesFlow } from './useSftpPropertiesFlow'
import type { SFTPEntry, SFTPItemProperties } from '../types'

function entry(values: Partial<SFTPEntry> = {}): SFTPEntry {
  return {
    name: 'script.sh',
    path: '/root/script.sh',
    parentPath: '/root',
    size: 42,
    isDir: false,
    isSymlink: false,
    permissions: '-rwxr-xr-x',
    owner: 'root',
    group: 'root',
    modTime: '2026-06-01T00:00:00Z',
    ...values,
  }
}

function properties(values: Partial<SFTPItemProperties> = {}): SFTPItemProperties {
  const item = values.entry ?? entry()
  return {
    connectionId: 7,
    contextId: 'ctx-1',
    terminalSessionId: 'term-1',
    generation: 3,
    requestId: 'properties-result',
    path: item.path,
    name: item.name,
    type: item.isDir ? 'directory' : 'file',
    size: item.size,
    modTime: item.modTime,
    permissions: item.permissions,
    mode: 0o755,
    owner: item.owner,
    group: item.group,
    isDir: item.isDir,
    isSymlink: item.isSymlink,
    entry: item,
    ...values,
  }
}

describe('useSftpPropertiesFlow', () => {
  it('opens properties through injected API and upserts returned entry', async () => {
    const returned = properties()
    const getProperties = vi.fn(async () => returned)
    const upsertEntry = vi.fn()
    const flow = useSftpPropertiesFlow({
      getContext: () => ({ connectionId: 7, contextId: 'ctx-1', terminalSessionId: 'term-1', generation: 2, online: true, canBrowse: true }),
      getProperties,
      updatePermissions: vi.fn(),
      notify: vi.fn(),
      upsertEntry,
      createRequestId: () => 'request-1',
    })

    await flow.openProperties(entry())

    expect(getProperties).toHaveBeenCalledWith({
      connectionId: 7,
      path: '/root/script.sh',
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
      generation: 2,
      requestId: 'request-1',
    })
    expect(flow.propertiesOpen.value).toBe(true)
    expect(flow.propertiesItem.value).toStrictEqual(returned)
    expect(upsertEntry).toHaveBeenCalledWith(returned.entry)
  })

  it('guards parent rows and no-browse contexts without calling properties API', async () => {
    const getProperties = vi.fn()
    const flow = useSftpPropertiesFlow({
      getContext: () => ({ connectionId: 7, online: true, canBrowse: false }),
      getProperties,
      updatePermissions: vi.fn(),
      notify: vi.fn(),
    })

    await flow.openProperties(entry())
    await flow.openProperties({ ...entry({ name: '..' }), syntheticParent: true })

    expect(getProperties).not.toHaveBeenCalled()
    expect(flow.propertiesOpen.value).toBe(false)
  })

  it('applies chmod through injected API, updates dialog state, and reports errors without closing', async () => {
    const first = properties()
    const changed = properties({ permissions: '-rw-r-----', mode: 0o640, entry: entry({ permissions: '-rw-r-----' }) })
    const updatePermissions = vi.fn(async () => changed)
    const notify = vi.fn()
    const flow = useSftpPropertiesFlow({
      getContext: () => ({ connectionId: 7, contextId: 'ctx-1', terminalSessionId: 'term-1', generation: 9, online: true, canBrowse: true }),
      getProperties: vi.fn(async () => first),
      updatePermissions,
      notify,
      upsertEntry: vi.fn(),
      createRequestId: vi.fn()
        .mockReturnValueOnce('open-1')
        .mockReturnValueOnce('chmod-1')
        .mockReturnValueOnce('chmod-2'),
      formatError: (reason, fallback) => reason instanceof Error ? reason.message : fallback,
    })

    await flow.openProperties(entry())
    await flow.applyRemotePermissions(0o640)

    expect(updatePermissions).toHaveBeenCalledWith({
      connectionId: 7,
      path: '/root/script.sh',
      mode: 0o640,
      preserveSpecialBits: true,
      contextId: 'ctx-1',
      terminalSessionId: 'term-1',
      generation: 3,
      requestId: 'chmod-1',
    })
    expect(flow.propertiesItem.value).toStrictEqual(changed)
    expect(notify).toHaveBeenCalledWith('权限已更新', 'success')

    updatePermissions.mockRejectedValueOnce(new Error('permission denied'))
    await flow.applyRemotePermissions(0o600)

    expect(flow.propertiesOpen.value).toBe(true)
    expect(flow.propertiesError.value).toBe('permission denied')
  })
})
