import { describe, expect, it, vi } from 'vitest'
import {
  useSftpRemoteText,
  type RemoteTextChoice,
  type RemoteTextConflictChoice,
  type RemoteTextReadRequest,
  type RemoteTextWriteRequest,
} from './useSftpRemoteText'
import type { SFTPEntry, SFTPReadTextFileResult, SFTPSaveError, SFTPWriteTextFileResult } from '../types'

function entry(values: Partial<SFTPEntry> = {}): SFTPEntry {
  return {
    name: 'notes.txt',
    path: '/root/notes.txt',
    parentPath: '/root',
    size: 5,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'root',
    modTime: '2026-06-01T08:00:00Z',
    ...values,
  }
}

function readResult(values: Partial<SFTPReadTextFileResult> = {}): SFTPReadTextFileResult {
  const item = values.entry ?? entry()
  return {
    connectionId: 7,
    contextId: 'ctx-1',
    generation: 3,
    requestId: 'server-request',
    path: item.path,
    name: item.name,
    size: item.size,
    encoding: 'utf-8',
    contentHash: 'hash-a',
    truncated: false,
    content: 'alpha',
    detectedLanguage: 'generic',
    textKind: 'plaintext',
    entry: item,
    ...values,
  }
}

function writeResult(values: Partial<SFTPWriteTextFileResult> = {}): SFTPWriteTextFileResult {
  const item = values.entry ?? entry({ size: 10, modTime: '2026-06-01T09:00:00Z' })
  return {
    connectionId: 7,
    contextId: 'ctx-1',
    generation: 4,
    requestId: 'save-server-request',
    path: item.path,
    name: item.name,
    size: item.size,
    encoding: 'utf-8',
    contentHash: 'hash-b',
    entry: item,
    ...values,
  }
}

function conflictError(values: Partial<SFTPSaveError> = {}) {
  return new Error(JSON.stringify({
    code: 'SFTP_SAVE_CONFLICT',
    stage: 'conflict_check',
    userMessage: 'remote changed',
    technicalMessage: '',
    remotePath: '/root/notes.txt',
    operation: 'sftp.write_text',
    retryable: false,
    ...values,
  }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness(options: {
  dirtyChoice?: RemoteTextChoice
  conflictChoice?: RemoteTextConflictChoice
  readTextFile?: (request: RemoteTextReadRequest) => Promise<SFTPReadTextFileResult>
  writeTextFile?: (request: RemoteTextWriteRequest) => Promise<SFTPWriteTextFileResult>
  reconnect?: () => Promise<void>
} = {}) {
  const notify = vi.fn()
  const upsertEntry = vi.fn()
  const readTextFile = options.readTextFile ?? vi.fn(async (_request: RemoteTextReadRequest) => readResult())
  const writeTextFile = options.writeTextFile ?? vi.fn(async (_request: RemoteTextWriteRequest) => writeResult())
  const reconnect = options.reconnect ?? vi.fn(async () => undefined)
  let openIndex = 0
  let saveIndex = 0
  const remoteText = useSftpRemoteText({
    getContext: () => ({
      connectionId: 7,
      contextId: 'ctx-1',
      terminalSessionId: 'terminal-1',
      generation: 3,
    }),
    readTextFile,
    writeTextFile,
    reconnect,
    chooseDirtyAction: vi.fn(async () => options.dirtyChoice ?? false),
    chooseConflictAction: vi.fn(async () => options.conflictChoice ?? false),
    notify,
    upsertEntry,
    formatError: (reason, fallback) => reason instanceof Error ? reason.message : fallback,
    createOpenRequestId: () => `open-${++openIndex}`,
    createSaveRequestId: () => `save-${++saveIndex}`,
  })
  return { remoteText, notify, upsertEntry, readTextFile, writeTextFile, reconnect }
}

describe('useSftpRemoteText', () => {
  it('opens a text file into readonly viewer state and ignores stale open results', async () => {
    const first = deferred<SFTPReadTextFileResult>()
    const second = deferred<SFTPReadTextFileResult>()
    const { remoteText, readTextFile } = createHarness({
      readTextFile: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    })

    const firstOpen = remoteText.openTextFile(entry({ path: '/root/first.txt', name: 'first.txt' }))
    const secondOpen = remoteText.openTextFile(entry({ path: '/root/second.txt', name: 'second.txt' }))

    second.resolve(readResult({ entry: entry({ path: '/root/second.txt', name: 'second.txt' }), content: 'second' }))
    await secondOpen
    expect(remoteText.viewerOpen.value).toBe(true)
    expect(remoteText.viewerMode.value).toBe('readonly')
    expect(remoteText.viewerDraft.value).toBe('second')
    expect(remoteText.viewerDirty.value).toBe(false)

    first.resolve(readResult({ entry: entry({ path: '/root/first.txt', name: 'first.txt' }), content: 'first' }))
    await firstOpen
    expect(remoteText.viewerFile.value?.path).toBe('/root/second.txt')
    expect(readTextFile).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      path: '/root/first.txt',
      maxBytes: 2 * 1024 * 1024,
      contextId: 'ctx-1',
      terminalSessionId: 'terminal-1',
      requestId: 'open-1',
    }))
  })

  it('reports open failures without writing draft content', async () => {
    const { remoteText, notify } = createHarness({
      readTextFile: vi.fn(async () => { throw new Error('binary or unsupported') }),
    })

    await remoteText.openTextFile(entry())

    expect(remoteText.viewerOpen.value).toBe(false)
    expect(remoteText.viewerDraft.value).toBe('')
    expect(notify).toHaveBeenCalledWith('binary or unsupported', 'error')
  })

  it('reloads the current file and discards stale reload results', async () => {
    const first = deferred<SFTPReadTextFileResult>()
    const second = deferred<SFTPReadTextFileResult>()
    const { remoteText } = createHarness({
      readTextFile: vi.fn()
        .mockResolvedValueOnce(readResult({ content: 'base' }))
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    })
    await remoteText.openTextFile(entry())

    const firstReload = remoteText.reloadTextFile(true)
    const secondReload = remoteText.reloadTextFile(true)
    second.resolve(readResult({ content: 'fresh' }))
    await secondReload
    first.resolve(readResult({ content: 'stale' }))
    await firstReload

    expect(remoteText.viewerBaseline.value).toBe('fresh')
    expect(remoteText.viewerDraft.value).toBe('fresh')
  })

  it('guards unlock by truncated preview or unsupported encoding', async () => {
    const { remoteText, notify } = createHarness({
      readTextFile: vi.fn(async () => readResult({ truncated: true })),
    })
    await remoteText.openTextFile(entry())

    remoteText.unlockReadWrite()

    expect(remoteText.viewerMode.value).toBe('readonly')
    expect(remoteText.viewerUnlockDisabled.value).toBe(true)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('不能'), 'info')

    const unsupported = createHarness({
      readTextFile: vi.fn(async () => readResult({ encoding: 'utf-32' })),
    })
    await unsupported.remoteText.openTextFile(entry())
    unsupported.remoteText.unlockReadWrite()
    expect(unsupported.remoteText.viewerMode.value).toBe('readonly')
    expect(unsupported.notify).toHaveBeenCalledWith(expect.stringContaining('编码'), 'info')
  })

  it('tracks dirty state and honors dirty close choices', async () => {
    const canceled = createHarness({ dirtyChoice: false })
    await canceled.remoteText.openTextFile(entry())
    canceled.remoteText.unlockReadWrite()
    canceled.remoteText.setDraft('changed')
    await canceled.remoteText.closeTextFile()
    expect(canceled.remoteText.viewerOpen.value).toBe(true)
    expect(canceled.remoteText.viewerDraft.value).toBe('changed')

    const discarded = createHarness({ dirtyChoice: 'discard' })
    await discarded.remoteText.openTextFile(entry())
    discarded.remoteText.unlockReadWrite()
    discarded.remoteText.setDraft('changed')
    await discarded.remoteText.closeTextFile()
    expect(discarded.remoteText.viewerOpen.value).toBe(false)
  })

  it('saves existing files with fail-if-changed metadata and updates baseline on success', async () => {
    const { remoteText, writeTextFile, upsertEntry } = createHarness()
    await remoteText.openTextFile(entry())
    remoteText.unlockReadWrite()
    remoteText.setDraft('changed')

    await remoteText.saveTextFile(false)

    expect(writeTextFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '/root/notes.txt',
      content: 'changed',
      expectedSize: 5,
      expectedMTime: '2026-06-01T08:00:00Z',
      forceOverwrite: false,
      encoding: 'utf-8',
      generation: 3,
      requestId: 'save-1',
      expectedHash: 'hash-a',
      mode: 'save_existing',
      conflictPolicy: 'fail_if_changed',
    }))
    expect(remoteText.viewerDirty.value).toBe(false)
    expect(remoteText.viewerBaseline.value).toBe('changed')
    expect(upsertEntry).toHaveBeenCalledWith(expect.objectContaining({ path: '/root/notes.txt' }))
  })

  it('keeps draft on save failure and retries overwrite only after confirmation', async () => {
    const { remoteText, writeTextFile } = createHarness({
      conflictChoice: 'overwrite',
      writeTextFile: vi.fn()
        .mockRejectedValueOnce(conflictError())
        .mockResolvedValueOnce(writeResult()),
    })
    await remoteText.openTextFile(entry())
    remoteText.unlockReadWrite()
    remoteText.setDraft('changed')

    await remoteText.saveTextFile(false)

    expect(writeTextFile).toHaveBeenNthCalledWith(1, expect.objectContaining({ conflictPolicy: 'fail_if_changed' }))
    expect(writeTextFile).toHaveBeenNthCalledWith(2, expect.objectContaining({ conflictPolicy: 'overwrite', forceOverwrite: true }))
    expect(remoteText.viewerDirty.value).toBe(false)

    const canceled = createHarness({
      conflictChoice: false,
      writeTextFile: vi.fn(async () => { throw conflictError() }),
    })
    await canceled.remoteText.openTextFile(entry())
    canceled.remoteText.unlockReadWrite()
    canceled.remoteText.setDraft('kept')
    await canceled.remoteText.saveTextFile(false)
    expect(canceled.remoteText.viewerDraft.value).toBe('kept')
    expect(canceled.remoteText.viewerDirty.value).toBe(true)
  })

  it('creates a new UTF-8 draft and saves it with fail-if-exists semantics', async () => {
    const { remoteText, writeTextFile } = createHarness()

    remoteText.createNewTextFileDraft('/root/new.txt')
    expect(remoteText.viewerMode.value).toBe('readwrite')
    expect(remoteText.viewerDirty.value).toBe(false)
    expect(remoteText.viewerFile.value?.encoding).toBe('utf-8')

    remoteText.setDraft('new text')
    await remoteText.saveTextFile(false)

    expect(writeTextFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '/root/new.txt',
      expectedSize: -1,
      expectedMTime: '',
      mode: 'create_new',
      conflictPolicy: 'fail_if_exists',
    }))
    expect(remoteText.viewerSaveMode.value).toBe('save_existing')
    expect(remoteText.viewerDirty.value).toBe(false)
  })

  it('saves as another path and updates path, name, baseline, and dirty state', async () => {
    const target = entry({ path: '/root/copy.txt', name: 'copy.txt', parentPath: '/root', size: 9 })
    const { remoteText, writeTextFile } = createHarness({
      writeTextFile: vi.fn(async () => writeResult({ entry: target, path: target.path, name: target.name })),
    })
    await remoteText.openTextFile(entry())
    remoteText.unlockReadWrite()
    remoteText.setDraft('copy text')

    await remoteText.saveTextFileAs('/root/copy.txt')

    expect(writeTextFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '/root/copy.txt',
      mode: 'save_as',
      conflictPolicy: 'fail_if_exists',
    }))
    expect(remoteText.viewerFile.value?.path).toBe('/root/copy.txt')
    expect(remoteText.viewerFile.value?.name).toBe('copy.txt')
    expect(remoteText.viewerBaseline.value).toBe('copy text')
    expect(remoteText.viewerDirty.value).toBe(false)
  })

  it('rejects invalid draft and save-as paths without using localStorage or logging content', async () => {
    const localStorageSetItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: localStorageSetItem,
      removeItem: vi.fn(),
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { remoteText, notify, writeTextFile } = createHarness()

    remoteText.createNewTextFileDraft('/bad\u0000path')
    expect(remoteText.viewerOpen.value).toBe(false)

    await remoteText.openTextFile(entry())
    remoteText.unlockReadWrite()
    remoteText.setDraft('not logged')
    await remoteText.saveTextFileAs('/bad\rpath')

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('路径'), 'error')
    expect(localStorageSetItem).not.toHaveBeenCalled()
    expect(consoleSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    consoleSpy.mockRestore()
  })
})
