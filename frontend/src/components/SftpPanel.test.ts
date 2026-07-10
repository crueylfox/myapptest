// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime'
import { resolveAppDialog, useAppDialog } from '../composables/useAppDialog'
import { useSftpStore } from '../stores/sftp'
import type { Connection, SFTPEntry, SFTPTransferState } from '../types'
import SftpPanel from './SftpPanel.vue'

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
  OnFileDrop: vi.fn(),
  OnFileDropOff: vi.fn(),
}))

vi.mock('./RemoteTextViewer.vue', () => ({
  default: {
    name: 'RemoteTextViewer',
    props: ['file', 'busy', 'unlockDisabled', 'unlockReason'],
    emits: ['reload', 'close', 'unlock'],
    template: `
      <div class="sftp-viewer">
        <button class="dialog-close-button sftp-viewer-close" title="关闭" @click="$emit('close')">关闭</button>
        <pre class="mock-viewer-content">{{ file.content }}</pre>
        <span class="mock-viewer-meta">{{ file.encoding }} {{ file.detectedLanguage }} {{ file.truncated ? 'truncated' : '' }}</span>
        <button class="mock-viewer-unlock" :disabled="unlockDisabled" :title="unlockReason" @click="$emit('unlock')">只读</button>
        <button class="mock-viewer-reload" @click="$emit('reload')">重新载入</button>
      </div>
    `,
  },
}))

vi.mock('./RemoteTextEditor.vue', () => ({
  default: {
    name: 'RemoteTextEditor',
    props: ['entry', 'content', 'dirty', 'busy', 'saveError'],
    emits: ['update:content', 'save', 'saveAs', 'reload', 'close', 'readonly'],
    template: `
      <div class="sftp-editor">
        <button class="dialog-close-button sftp-editor-close" title="关闭" @click="$emit('close')">关闭</button>
        <button class="mock-editor-readonly" @click="$emit('readonly')">读写</button>
        <textarea class="mock-editor-content" :value="content" @input="$emit('update:content', $event.target.value)"></textarea>
        <span class="mock-editor-dirty">{{ dirty ? '有未保存修改' : '已保存' }}</span>
        <span v-if="saveError" class="mock-editor-error">{{ saveError.userMessage }}</span>
        <button class="mock-editor-reload" @click="$emit('reload')">重新载入</button>
        <button class="mock-editor-save" :disabled="busy || !dirty" @click="$emit('save')">保存</button>
        <button class="mock-editor-save-as" :disabled="busy" @click="$emit('saveAs')">Save As</button>
      </div>
    `,
  },
}))

const connection: Connection = {
  id: 7,
  groupId: null,
  name: 'demo',
  host: '192.0.2.7',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: 'SHA256:test',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

const defaultSftpContext = {
  contextId: 'server:7',
  terminalSessionId: '',
}

function entry(values: Partial<SFTPEntry>): SFTPEntry {
  return {
    name: 'file.txt',
    path: '/home/demo/file.txt',
    parentPath: '/home/demo',
    size: 10,
    isDir: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
    owner: '1000',
    group: '1000',
    modTime: '2026-06-16T00:00:00Z',
    ...values,
  }
}

function transfer(values: Partial<SFTPTransferState>): SFTPTransferState {
  return {
    id: 'transfer-1',
    connectionId: 7,
    contextId: 'server:7',
    direction: 'upload',
    recursive: false,
    sourceType: 'file',
    localPath: 'C:\\tmp\\file.txt',
    remotePath: '/home/demo/file.txt',
    fileName: 'file.txt',
    currentFile: 'file.txt',
    totalBytes: 10,
    transferredBytes: 0,
    percent: 0,
    speedBytesPerSecond: 0,
    status: 'running',
    errorMessage: '',
    startedAt: '',
    finishedAt: '',
    ...values,
  }
}

const mountedWrappers: ReturnType<typeof mount>[] = []

type SftpPanelMountProps = {
  connection?: Connection | null
  expanded?: boolean
  contextId?: string | null
  terminalSessionId?: string | null
}

function mountPanelWithProps(props: SftpPanelMountProps = {}) {
  const wrapper = mount(SftpPanel, {
    props: { connection, expanded: true, ...props },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

function mountPanel(expanded = true) {
  return mountPanelWithProps({ expanded })
}

async function flushPromises(times = 3) {
  for (let index = 0; index < times; index++) await Promise.resolve()
}

async function flushAsyncUi() {
  await flushPromises(5)
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}

const fileColumnIds = ['name', 'type', 'size', 'modTime', 'permissions', 'owner', 'group']
const fileColumnLayoutKey = 'hostdeck.sftpColumnLayout.v1'
const pathBookmarksKey = 'hostdeck.sftpPathBookmarks.v1'

function setBrowsableSftpState(rows: SFTPEntry[] = [
  entry({ name: 'b.txt', path: '/home/demo/b.txt', size: 2 }),
  entry({ name: 'adir', path: '/home/demo/adir', isDir: true, size: 0 }),
], currentPath = '/home/demo') {
  const store = useSftpStore()
  store.stateByServerId[7] = {
    connectionId: 7,
    status: 'online',
    active: true,
    currentPath,
    message: 'online',
    updatedAt: '',
  }
  store.entriesByServerId[7] = rows
  return store
}

function setBrowsableSftpContextState(
  contextId = 'pane:one',
  terminalSessionId = 'terminal-one',
  rows: SFTPEntry[] = [
    entry({ name: 'context.txt', path: '/srv/app/context.txt', parentPath: '/srv/app' }),
  ],
  currentPath = '/srv/app',
) {
  const store = useSftpStore()
  store.stateByServerId[7] = {
    connectionId: 7,
    contextId: 'server:7',
    terminalSessionId: '',
    generation: 1,
    status: 'online',
    active: true,
    currentPath: '/wrong',
    message: 'default online',
    updatedAt: '',
  }
  store.entriesByServerId[7] = [entry({ name: 'wrong.txt', path: '/wrong/wrong.txt', parentPath: '/wrong' })]
  store.stateByContextId[contextId] = {
    connectionId: 7,
    contextId,
    terminalSessionId,
    generation: 9,
    status: 'online',
    active: true,
    currentPath,
    message: 'context online',
    updatedAt: '',
  }
  store.entriesByContextId[contextId] = rows
  return store
}

function columnHeaderIds(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('[data-testid^="sftp-column-header-"]')
    .map((header) => header.attributes('data-column-id'))
}

function rowColumnIds(wrapper: ReturnType<typeof mountPanel>, rowIndex = 0) {
  return wrapper.findAll('[data-testid="sftp-entry-row"]')
    .at(rowIndex)!
    .findAll('[data-column-id]')
    .map((cell) => cell.attributes('data-column-id'))
}

function stubColumnHeaderRects(wrapper: ReturnType<typeof mountPanel>, width = 100) {
  wrapper.findAll('[data-testid^="sftp-column-header-"]').forEach((header, index) => {
    const left = index * width
    Object.defineProperty(header.element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: left,
        y: 0,
        left,
        right: left + width,
        top: 0,
        bottom: 24,
        width,
        height: 24,
        toJSON: () => ({}),
      }),
    })
  })
}

async function dragResizeColumn(wrapper: ReturnType<typeof mountPanel>, columnId: string, startX: number, endX: number) {
  wrapper.get(`[data-testid="sftp-column-resize-${columnId}"]`).element
    .dispatchEvent(new MouseEvent('pointerdown', { clientX: startX, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: endX, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: endX, bubbles: true }))
  await wrapper.vm.$nextTick()
}

async function dragReorderColumn(wrapper: ReturnType<typeof mountPanel>, columnId: string, startX: number, endX: number) {
  wrapper.get(`[data-testid="sftp-column-header-${columnId}"]`).element
    .dispatchEvent(new MouseEvent('pointerdown', { clientX: startX, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: endX, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: endX, bubbles: true }))
  await wrapper.vm.$nextTick()
}

function tableGridTemplate(wrapper: ReturnType<typeof mountPanel>) {
  return (wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns
}

async function relayoutToolbar(wrapper: ReturnType<typeof mountPanel>, width: number) {
  const toolbar = wrapper.get('.sftp-toolbar').element as HTMLElement
  Object.defineProperty(toolbar, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(toolbar, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      right: width,
      top: 0,
      bottom: 38,
      width,
      height: 38,
      toJSON: () => ({}),
    }),
  })
  window.dispatchEvent(new Event('resize'))
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await wrapper.vm.$nextTick()
  await flushAsyncUi()
}

function toolbarActionIds(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('[data-toolbar-action-id]')
    .map((action) => action.attributes('data-toolbar-action-id'))
}

function moreMenu() {
  return document.body.querySelector<HTMLElement>('.sftp-more-menu')
}

function bookmarkMenu() {
  return document.body.querySelector<HTMLElement>('.sftp-bookmarks-menu')
}

function visibleEntryNames(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('[data-testid="sftp-entry-row"] [data-column-id="name"] strong')
    .map((item) => item.text())
}

function entryRows(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('[data-testid="sftp-entry-row"]')
}

function rowByName(wrapper: ReturnType<typeof mountPanel>, name: string) {
  const row = entryRows(wrapper).find((item) => item.find('[data-column-id="name"]').text().includes(name))
  if (!row) throw new Error(`Missing row ${name}`)
  return row
}

function cellByColumn(wrapper: ReturnType<typeof mountPanel>, name: string, columnId: string) {
  return rowByName(wrapper, name).get(`[data-column-id="${columnId}"]`)
}

function matchTexts(wrapper: ReturnType<typeof mountPanel>, name: string, columnId: string) {
  return cellByColumn(wrapper, name, columnId)
    .findAll('.sftp-filter-match')
    .map((item) => item.text())
}

function fileFilterInput(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.get<HTMLInputElement>('[data-testid="sftp-file-filter"]')
}

async function setFileFilter(wrapper: ReturnType<typeof mountPanel>, value: string) {
  await fileFilterInput(wrapper).setValue(value)
  await wrapper.vm.$nextTick()
}

describe('SftpPanel', () => {
  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
    document.body.replaceChildren()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.replaceChildren()
    setActivePinia(createPinia())
    window.go = {
      main: {
        App: {
          ReadSftpDir: vi.fn(async (request: { connectionId: number; path: string }) => ({
            connectionId: request.connectionId,
            path: request.path,
            parentPath: '/home',
            entries: [entry({ name: 'nested', path: `${request.path}/nested`, isDir: true })],
          })),
          SftpGoHome: vi.fn(async (request: { connectionId: number }) => ({
            connectionId: request.connectionId,
            path: '/root',
            parentPath: '/',
            entries: [entry({ name: 'profile', path: '/root/profile' })],
          })),
          SftpReadTextFile: vi.fn(async (request: { connectionId: number; path: string }) => ({
            connectionId: request.connectionId,
            contextId: 'server:7',
            generation: 1,
            requestId: 'open-test',
            entry: entry({ name: 'file.txt', path: request.path, size: 5 }),
            path: request.path,
            name: 'file.txt',
            size: 5,
            content: 'hello',
            encoding: 'utf-8',
            contentHash: 'sha256:openhash',
            truncated: false,
            detectedLanguage: 'generic',
            textKind: 'plaintext',
          })),
          ReconnectSftp: vi.fn(async (request: { connectionId: number; contextId?: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId || 'server:7',
            generation: 2,
            status: 'online',
            active: true,
            mode: 'sftp',
            capabilities: {
              browse: 'full',
              uploadFile: true,
              downloadFile: true,
              uploadDirectory: true,
              downloadDirectory: true,
              mkdir: true,
              rename: true,
              delete: true,
              editText: true,
            },
            currentPath: '/home/demo',
            message: 'SFTP 已连接',
            updatedAt: '',
          })),
          SftpUpload: vi.fn(async (request: unknown) => ({
            id: 'upload-1',
            connectionId: 7,
            direction: 'upload',
            recursive: false,
            sourceType: 'file',
            localPath: (request as { localPath: string }).localPath,
            remotePath: (request as { remotePath: string }).remotePath,
            fileName: 'drop.txt',
            currentFile: 'drop.txt',
            totalBytes: 5,
            transferredBytes: 0,
            filesTotal: 1,
            filesDone: 0,
            failedCount: 0,
            skippedCount: 0,
            percent: 0,
            speedBytesPerSecond: 0,
            status: 'queued',
            errorMessage: '',
            cancelable: true,
            startedAt: '',
            finishedAt: '',
          })),
          SftpUploadDirectory: vi.fn(async (request: unknown) => ({
            id: 'upload-dir-1',
            connectionId: 7,
            direction: 'upload',
            recursive: true,
            sourceType: 'directory',
            localPath: (request as { localPath: string }).localPath,
            remotePath: '/home/demo/folder',
            fileName: 'folder',
            currentFile: 'nested/a.txt',
            totalBytes: 20,
            transferredBytes: 10,
            filesTotal: 2,
            filesDone: 1,
            failedCount: 0,
            skippedCount: 0,
            percent: 50,
            speedBytesPerSecond: 1024,
            status: 'running',
            errorMessage: '',
            cancelable: true,
            startedAt: '',
            finishedAt: '',
          })),
          SftpDownload: vi.fn(async (request: unknown) => ({
            id: 'download-1',
            connectionId: 7,
            direction: 'download',
            recursive: false,
            sourceType: 'file',
            localPath: (request as { localPath: string }).localPath,
            remotePath: (request as { remotePath: string }).remotePath,
            fileName: 'file.txt',
            currentFile: 'file.txt',
            totalBytes: 10,
            transferredBytes: 0,
            filesTotal: 1,
            filesDone: 0,
            failedCount: 0,
            skippedCount: 0,
            percent: 0,
            speedBytesPerSecond: 0,
            status: 'queued',
            errorMessage: '',
            cancelable: true,
            startedAt: '',
            finishedAt: '',
          })),
          SftpDownloadDirectory: vi.fn(async (request: unknown) => ({
            id: 'download-dir-1',
            connectionId: 7,
            direction: 'download',
            recursive: true,
            sourceType: 'directory',
            localPath: 'C:/downloads/dir',
            remotePath: (request as { remotePath: string }).remotePath,
            fileName: 'dir',
            currentFile: 'dir/a.txt',
            totalBytes: 10,
            transferredBytes: 0,
            filesTotal: 1,
            filesDone: 0,
            failedCount: 0,
            skippedCount: 0,
            percent: 0,
            speedBytesPerSecond: 0,
            status: 'queued',
            errorMessage: '',
            cancelable: true,
            startedAt: '',
            finishedAt: '',
          })),
          SelectLocalUploadFiles: vi.fn(async () => ['C:\\tmp\\drop.txt']),
          SelectLocalUploadDirectory: vi.fn(async () => 'C:\\tmp\\folder'),
          SelectLocalDownloadDirectory: vi.fn(async () => 'C:\\downloads'),
          SftpInspectDelete: vi.fn(async (request: { connectionId: number; paths: string[] }) => ({
            connectionId: request.connectionId,
            paths: request.paths,
            fileCount: request.paths.some((path) => path.endsWith('/dir')) ? 2 : request.paths.length,
            directoryCount: request.paths.some((path) => path.endsWith('/dir')) ? 1 : 0,
            symlinkCount: request.paths.some((path) => path.includes('link')) ? 1 : 0,
            totalBytes: 42,
            warnings: [],
            requiresRecursive: request.paths.some((path) => path.endsWith('/dir')),
          })),
          SftpDelete: vi.fn(async () => undefined),
          SftpGetRemoteItemProperties: vi.fn(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string; requestId?: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId || 'server:7',
            terminalSessionId: request.terminalSessionId || '',
            generation: 1,
            requestId: request.requestId || 'props-test',
            path: request.path,
            name: request.path.split('/').pop() || request.path,
            type: request.path.endsWith('/logs') ? 'directory' : 'file',
            size: request.path.endsWith('/logs') ? 0 : 128,
            modTime: '2026-06-16T00:00:00Z',
            permissions: request.path.endsWith('/logs') ? 'drwxr-xr-x' : '-rw-r--r--',
            mode: request.path.endsWith('/logs') ? 0o755 : 0o644,
            owner: '1000',
            group: '1001',
            isDir: request.path.endsWith('/logs'),
            isSymlink: false,
            symlinkTarget: '',
            entry: entry({
              name: request.path.split('/').pop() || request.path,
              path: request.path,
              parentPath: request.path.includes('/') ? request.path.slice(0, request.path.lastIndexOf('/')) || '/' : '.',
              size: request.path.endsWith('/logs') ? 0 : 128,
              isDir: request.path.endsWith('/logs'),
              permissions: request.path.endsWith('/logs') ? 'drwxr-xr-x' : '-rw-r--r--',
              owner: '1000',
              group: '1001',
            }),
          })),
          SftpUpdateRemoteItemPermissions: vi.fn(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string; mode: number; requestId?: string }) => ({
            connectionId: request.connectionId,
            contextId: request.contextId || 'server:7',
            terminalSessionId: request.terminalSessionId || '',
            generation: 1,
            requestId: request.requestId || 'chmod-test',
            path: request.path,
            name: request.path.split('/').pop() || request.path,
            type: 'file',
            size: 128,
            modTime: '2026-06-16T00:00:00Z',
            permissions: request.mode === 0o640 ? '-rw-r-----' : '-rw-r--r--',
            mode: request.mode,
            owner: '1000',
            group: '1001',
            isDir: false,
            isSymlink: false,
            symlinkTarget: '',
            entry: entry({
              name: request.path.split('/').pop() || request.path,
              path: request.path,
              permissions: request.mode === 0o640 ? '-rw-r-----' : '-rw-r--r--',
              owner: '1000',
              group: '1001',
            }),
          })),
          SftpWriteTextFile: vi.fn(async (request: { connectionId: number; path: string; content: string }) => ({
            connectionId: request.connectionId,
            entry: entry({ name: 'file.txt', path: request.path, size: request.content.length }),
          })),
        } as never,
      },
    }
  })

  it('renders no SFTP title, header, or status text when collapsed', () => {
    const wrapper = mountPanel(false)
    expect(wrapper.text()).not.toContain('SFTP')
    expect(wrapper.text()).not.toContain('demo')
    expect(wrapper.text()).not.toContain('未绑定服务器')
    expect(wrapper.find('.sftp-collapsed-header').exists()).toBe(false)
    expect(wrapper.find('.sftp-table').exists()).toBe(false)
  })

  it('shows SCP compatibility mode without rendering a fake file list', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
      currentPath: '.',
      message: 'SCP compatibility mode',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'fake.txt', path: '/fake.txt' })]

    const wrapper = mountPanel(true)

    expect(wrapper.text()).toContain('SCP 兼容模式')
    expect(wrapper.text()).toContain('当前服务器无法递归列出目录，暂不支持文件夹下载。')
    expect(wrapper.text()).not.toContain('fake.txt')
    expect(wrapper.find('.sftp-table').exists()).toBe(false)
    expect(wrapper.find('.sftp-toolbar').text()).not.toContain('SFTP')
    expect((wrapper.get<HTMLInputElement>('.sftp-pathbar input').element).value).toBe('/')
    const downloadDirectory = wrapper.findAll('.sftp-compat-actions button').find((button) => button.text() === '下载目录')!
    expect(downloadDirectory.attributes('disabled')).toBeDefined()
  })

  it('uses the typed upload API with the entered remote path in SCP mode', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
      currentPath: '.',
      message: 'SCP compatibility mode',
      updatedAt: '',
    }
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-pathbar input').setValue('/tmp')
    await wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '上传')!.trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpUpload).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\tmp\\drop.txt',
      remotePath: '/tmp/drop.txt',
      conflictPolicy: 'ask',
    })
  })

  it('downloads an explicit remote path in SCP mode', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
      currentPath: '.',
      message: 'SCP compatibility mode',
      updatedAt: '',
    }
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-pathbar input').setValue('/etc/config/system')
    await wrapper.findAll('.sftp-compat-actions button').find((button) => button.text() === '下载文件')!.trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpDownload).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\downloads',
      remotePath: '/etc/config/system',
      conflictPolicy: 'ask',
    })
  })

  it('keeps upload-folder and download-folder available in browsable SCP mode', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
      currentPath: '/root',
      message: 'SCP 兼容模式：已使用 SCP + Shell 兼容文件管理。',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'site', path: '/root/site', isDir: true })]
    store.selectedPathsByServerId[7] = ['/root/site']
    const wrapper = mountPanel(true)

    expect(wrapper.text()).toContain('SCP 远程路径')
    expect(wrapper.find('.sftp-table').exists()).toBe(true)
    expect(wrapper.find('.sftp-entry-icon-directory .folder-icon').exists()).toBe(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-upload-directory"]').trigger('click')
    await Promise.resolve()
    resolveAppDialog('rename')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpUploadDirectory).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\tmp\\folder',
      remoteDirectory: '/root',
      conflictPolicy: 'rename',
    })

    await wrapper.find('select').setValue('overwrite')
    await wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '下载')!.trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpDownloadDirectory).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      remotePath: '/root/site',
      localDirectory: 'C:\\downloads',
      conflictPolicy: 'overwrite',
    })
  })

  it('renders the default file column order and widths', () => {
    setBrowsableSftpState()

    const wrapper = mountPanel(true)

    expect(columnHeaderIds(wrapper)).toEqual(fileColumnIds)
    expect(rowColumnIds(wrapper, 0)).toEqual(fileColumnIds)
    expect((wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns)
      .toBe('260px 58px 84px 150px 92px 74px 74px')
  })

  it('resizes the name column and persists the new width', async () => {
    const store = setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await dragResizeColumn(wrapper, 'name', 260, 340)

    expect((wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns)
      .toContain('340px')
    expect(JSON.parse(localStorage.getItem(fileColumnLayoutKey) || '{}').columnWidths.name).toBe(340)
    expect(columnHeaderIds(wrapper)).toEqual(fileColumnIds)
    expect(store.selectedPathsByServerId[7] ?? []).toEqual([])
  })

  it('clamps resized file columns to their minimum width', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await dragResizeColumn(wrapper, 'name', 260, 0)

    expect((wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns)
      .toContain('120px')
    expect(JSON.parse(localStorage.getItem(fileColumnLayoutKey) || '{}').columnWidths.name).toBe(120)
  })

  it('reorders file columns without losing header or body cells', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)
    stubColumnHeaderRects(wrapper)

    await dragReorderColumn(wrapper, 'name', 50, 275)

    const expected = ['type', 'size', 'name', 'modTime', 'permissions', 'owner', 'group']
    expect(columnHeaderIds(wrapper)).toEqual(expected)
    expect(rowColumnIds(wrapper, 1)).toEqual(expected)
    expect(new Set(columnHeaderIds(wrapper))).toEqual(new Set(fileColumnIds))
    expect(JSON.parse(localStorage.getItem(fileColumnLayoutKey) || '{}').columnOrder).toEqual(expected)
  })

  it('moves the file icon label and parent entry with the name column', async () => {
    setBrowsableSftpState([entry({ name: 'adir', path: '/home/demo/adir', isDir: true })])
    const wrapper = mountPanel(true)
    stubColumnHeaderRects(wrapper)

    await dragReorderColumn(wrapper, 'name', 50, 275)

    const parentNameCell = wrapper.findAll('[data-testid="sftp-entry-row"]').at(0)!.find('[data-column-id="name"]')
    const entryNameCell = wrapper.findAll('[data-testid="sftp-entry-row"]').at(1)!.find('[data-column-id="name"]')
    expect(parentNameCell.text()).toContain('..')
    expect(parentNameCell.find('.sftp-entry-icon-parent').exists()).toBe(true)
    expect(entryNameCell.text()).toContain('adir')
    expect(entryNameCell.find('.sftp-entry-icon-directory').exists()).toBe(true)
    expect(rowColumnIds(wrapper, 0).at(2)).toBe('name')
    expect(rowColumnIds(wrapper, 1).at(2)).toBe('name')
  })

  it('restores a saved column layout and appends missing known columns', () => {
    localStorage.setItem(fileColumnLayoutKey, JSON.stringify({
      columnOrder: ['size', 'name', 'obsolete', 'type'],
      columnWidths: { name: 333, type: 10 },
    }))
    setBrowsableSftpState()

    const wrapper = mountPanel(true)

    expect(columnHeaderIds(wrapper)).toEqual(['size', 'name', 'type', 'modTime', 'permissions', 'owner', 'group'])
    expect((wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns)
      .toBe('84px 333px 48px 150px 92px 74px 74px')
  })

  it('falls back to the default file column layout when persisted data is corrupt', () => {
    localStorage.setItem(fileColumnLayoutKey, '{broken')
    setBrowsableSftpState()

    const wrapper = mountPanel(true)

    expect(columnHeaderIds(wrapper)).toEqual(fileColumnIds)
    expect((wrapper.get('[data-testid="sftp-table-head"]').element as HTMLElement).style.gridTemplateColumns)
      .toBe('260px 58px 84px 150px 92px 74px 74px')
  })

  it('keeps mouse wheel events available for vertical file-list scrolling first', () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)
    const table = wrapper.get('[data-testid="sftp-file-list"]').element as HTMLElement
    let scrollLeft = 0
    Object.defineProperty(table, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(table, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(table, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(table, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(table, 'scrollTop', { configurable: true, writable: true, value: 100 })
    Object.defineProperty(table, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value) => { scrollLeft = value },
    })

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    table.dispatchEvent(event)

    expect(scrollLeft).toBe(0)
    expect(preventSpy).not.toHaveBeenCalled()
  })

  it('opts the file table into the UI drag selection guard without making the whole app non-selectable', () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)
    const table = wrapper.get('[data-testid="sftp-file-list"]')

    expect(table.attributes('data-ui-no-text-select')).toBe('true')
  })

  it('scrolls the file table horizontally when vertical wheel scrolling is unavailable', () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)
    const table = wrapper.get('[data-testid="sftp-file-list"]').element as HTMLElement
    let scrollLeft = 0
    Object.defineProperty(table, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(table, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(table, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value) => { scrollLeft = value },
    })

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    table.dispatchEvent(event)

    expect(scrollLeft).toBe(120)
    expect(preventSpy).toHaveBeenCalled()
  })

  it('keeps normal header clicks available for sorting', async () => {
    setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/a.txt', size: 2 }),
      entry({ name: 'b.txt', path: '/b.txt', size: 1 }),
    ], '/')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-column-sort-size"]').trigger('click')

    expect(wrapper.findAll('[data-testid="sftp-entry-row"] [data-column-id="name"] strong').map((item) => item.text()))
      .toEqual(['b.txt', 'a.txt'])
  })

  it('does not sort or reorder when dragging the resize handle', async () => {
    setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/a.txt', size: 1 }),
      entry({ name: 'b.txt', path: '/b.txt', size: 2 }),
    ], '/')
    const wrapper = mountPanel(true)

    await dragResizeColumn(wrapper, 'name', 260, 300)

    expect(columnHeaderIds(wrapper)).toEqual(fileColumnIds)
    expect(wrapper.findAll('[data-testid="sftp-entry-row"] [data-column-id="name"] strong').map((item) => item.text()))
      .toEqual(['a.txt', 'b.txt'])
  })

  it('cleans up column drag listeners when the panel unmounts', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    wrapper.get('[data-testid="sftp-column-resize-name"]').element
      .dispatchEvent(new MouseEvent('pointerdown', { clientX: 260, bubbles: true }))
    wrapper.unmount()

    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('uses narrower minimum widths for short file columns and clamps restored layouts', async () => {
    localStorage.setItem(fileColumnLayoutKey, JSON.stringify({
      columnOrder: fileColumnIds,
      columnWidths: { type: 1, permissions: 1, owner: 1, group: 1 },
    }))
    setBrowsableSftpState([entry({ name: 'file.txt', path: '/file.txt', owner: 'very-long-owner', group: 'very-long-group' })], '/')
    const wrapper = mountPanel(true)

    expect(tableGridTemplate(wrapper)).toBe('260px 48px 84px 150px 72px 52px 52px')
    await dragResizeColumn(wrapper, 'permissions', 72, 0)
    await dragResizeColumn(wrapper, 'owner', 52, 0)

    expect(tableGridTemplate(wrapper)).toContain('72px')
    expect(tableGridTemplate(wrapper)).toContain('52px')
    const ownerCell = wrapper.get('[data-testid="sftp-entry-row"] [data-column-id="owner"]')
    expect(ownerCell.classes()).toContain('sftp-entry-cell')
  })

  it('keeps visible header separators inside the resize hit area', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    const nameHeader = wrapper.get('[data-testid="sftp-column-header-name"]')
    const separator = nameHeader.get('[data-testid="sftp-column-separator-name"]')
    const resizeHandle = nameHeader.get('[data-testid="sftp-column-resize-name"]')
    expect(nameHeader.find('[data-testid="sftp-column-separator-name"]').exists()).toBe(true)
    expect(nameHeader.find('[data-testid="sftp-column-resize-name"]').exists()).toBe(true)
    expect(separator.element.closest('.sftp-column-resizer')).toBe(resizeHandle.element)

    await separator.element
      .dispatchEvent(new MouseEvent('pointerdown', { clientX: 260, bubbles: true }))
    expect(wrapper.get('[data-testid="sftp-column-header-name"]').classes()).toContain('sftp-column-resizing')
    expect(wrapper.get('[data-testid="sftp-column-separator-name"]').classes()).toContain('sftp-column-separator-active')
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 260, bubbles: true }))
  })

  it('sorts by canonical type in both directions with name tie-breakers', async () => {
    setBrowsableSftpState([
      entry({ name: 'z-file.txt', path: '/z-file.txt' }),
      entry({ name: 'b-dir', path: '/b-dir', isDir: true }),
      entry({ name: 'a-dir', path: '/a-dir', isDir: true }),
      entry({ name: 'm-link', path: '/m-link', isSymlink: true }),
    ], '/')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-column-sort-type"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['a-dir', 'b-dir', 'z-file.txt', 'm-link'])

    await wrapper.get('[data-testid="sftp-column-sort-type"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['m-link', 'z-file.txt', 'b-dir', 'a-dir'])
  })

  it('sorts permissions by parsed numeric mode and keeps unknown permissions last', async () => {
    setBrowsableSftpState([
      entry({ name: 'unknown.txt', path: '/unknown.txt', permissions: '' }),
      entry({ name: 'exec.sh', path: '/exec.sh', permissions: '-rwxr-xr-x' }),
      entry({ name: 'readme.txt', path: '/readme.txt', permissions: '-rw-r--r--' }),
      entry({ name: 'config', path: '/config', permissions: 'invalid' }),
      entry({ name: 'private.txt', path: '/private.txt', permissions: '-rw-------' }),
    ], '/')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-column-sort-permissions"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['private.txt', 'readme.txt', 'exec.sh', 'config', 'unknown.txt'])

    await wrapper.get('[data-testid="sftp-column-sort-permissions"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['exec.sh', 'readme.txt', 'private.txt', 'config', 'unknown.txt'])
  })

  it('keeps type and permissions sorting after column reorder', async () => {
    setBrowsableSftpState([
      entry({ name: 'file.txt', path: '/file.txt', permissions: '-rw-------' }),
      entry({ name: 'link.txt', path: '/link.txt', isSymlink: true, permissions: 'lrwxrwxrwx' }),
      entry({ name: 'dir', path: '/dir', isDir: true, permissions: 'drwxr-xr-x' }),
    ], '/')
    const wrapper = mountPanel(true)
    stubColumnHeaderRects(wrapper)

    await dragReorderColumn(wrapper, 'permissions', 450, 25)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.get('[data-testid="sftp-column-sort-permissions"]').trigger('click')

    expect(columnHeaderIds(wrapper).at(0)).toBe('permissions')
    expect(rowColumnIds(wrapper, 0).at(0)).toBe('permissions')
    expect(visibleEntryNames(wrapper)).toEqual(['file.txt', 'dir', 'link.txt'])
    expect(wrapper.findAll('[data-testid="sftp-entry-row"]').at(0)!.find('.sftp-entry-icon-file').exists()).toBe(true)

    await wrapper.get('[data-testid="sftp-column-sort-type"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['dir', 'file.txt', 'link.txt'])
  })

  it('shares the narrower layout and sortable file columns in SCP-compatible browse mode', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'file.txt', path: '/root/file.txt' }),
      entry({ name: 'dir', path: '/root/dir', isDir: true }),
    ], '/root')
    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      mode: 'scp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
    }
    const wrapper = mountPanel(true)

    await dragResizeColumn(wrapper, 'type', 54, 0)
    await wrapper.get('[data-testid="sftp-column-sort-type"]').trigger('click')

    expect(tableGridTemplate(wrapper)).toContain('48px')
    expect(visibleEntryNames(wrapper)).toEqual(['..', 'dir', 'file.txt'])
  })

  it('renders the current-directory filter for browsable SFTP and SCP but hides it in SCP no-browse mode', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    expect(fileFilterInput(wrapper).attributes('placeholder')).toBe('过滤当前目录')

    const store = useSftpStore()
    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      mode: 'scp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="sftp-file-filter"]').exists()).toBe(true)

    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="sftp-file-filter"]').exists()).toBe(false)
  })

  it('filters names case-insensitively with AND terms while keeping the parent row visible', async () => {
    setBrowsableSftpState([
      entry({ name: 'apple.conf', path: '/home/demo/apple.conf' }),
      entry({ name: 'APP.log', path: '/home/demo/APP.log' }),
      entry({ name: '中文 配置.txt', path: '/home/demo/中文 配置.txt' }),
      entry({ name: 'notes.md', path: '/home/demo/notes.md' }),
    ])
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'app')
    let names = visibleEntryNames(wrapper)
    expect(names.at(0)).toBe('..')
    expect(names.slice(1).sort()).toEqual(['APP.log', 'apple.conf'].sort())

    await setFileFilter(wrapper, 'app conf')
    expect(visibleEntryNames(wrapper)).toEqual(['..', 'apple.conf'])

    await setFileFilter(wrapper, '配置')
    expect(visibleEntryNames(wrapper)).toEqual(['..', '中文 配置.txt'])
  })

  it('filters type permissions owner group size and modification time display text', async () => {
    setBrowsableSftpState([
      entry({ name: 'etc', path: '/etc', isDir: true, permissions: 'drwxr-xr-x', owner: 'root', group: 'wheel' }),
      entry({
        name: 'pkg.ipk',
        path: '/pkg.ipk',
        size: 2048,
        permissions: '-rw-r-----',
        owner: 'deploy',
        group: 'opkg',
        modTime: '2031-01-02T03:04:05Z',
      }),
      entry({ name: 'shortcut', path: '/shortcut', isSymlink: true, permissions: 'lrwxrwxrwx', owner: 'linker', group: 'links' }),
    ], '/')
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'directory')
    expect(visibleEntryNames(wrapper)).toEqual(['etc'])

    await setFileFilter(wrapper, 'rw-r----- deploy opkg')
    expect(visibleEntryNames(wrapper)).toEqual(['pkg.ipk'])

    await setFileFilter(wrapper, '2.00 KB 2031')
    expect(visibleEntryNames(wrapper)).toEqual(['pkg.ipk'])

    await setFileFilter(wrapper, 'symlink linker')
    expect(visibleEntryNames(wrapper)).toEqual(['shortcut'])
  })

  it('shows filter status no-match state and clear button without restoring old selection', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'alpha.txt', path: '/home/demo/alpha.txt' }),
      entry({ name: 'beta.txt', path: '/home/demo/beta.txt' }),
    ])
    const wrapper = mountPanel(true)

    await wrapper.findAll('[data-testid="sftp-entry-row"]').at(1)!.trigger('click')
    expect(store.selectedEntries(7).map((item) => item.name)).toEqual(['alpha.txt'])

    await setFileFilter(wrapper, 'missing')
    expect(store.selectedEntries(7)).toEqual([])
    expect(visibleEntryNames(wrapper)).toEqual(['..'])
    expect(wrapper.get('[data-testid="sftp-filter-status"]').text()).toContain('0 / 2')
    expect(wrapper.get('[data-testid="sftp-filter-empty"]').text()).toContain('没有匹配的文件')

    await wrapper.get('[data-testid="sftp-file-filter-clear"]').trigger('click')

    expect((fileFilterInput(wrapper).element as HTMLInputElement).value).toBe('')
    expect(visibleEntryNames(wrapper)).toEqual(['..', 'alpha.txt', 'beta.txt'])
    expect(store.selectedEntries(7)).toEqual([])
  })

  it('selects and deletes only visible filtered entries from the focused file list', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'app.log', path: '/home/demo/app.log' }),
      entry({ name: 'app.conf', path: '/home/demo/app.conf' }),
      entry({ name: 'secret.key', path: '/home/demo/secret.key' }),
    ])
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'app')
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'a', ctrlKey: true })

    expect(store.selectedEntries(7).map((item) => item.name).sort()).toEqual(['app.conf', 'app.log'])
    store.selectedPathsByContextId['server:7'] = ['/home/demo/app.log', '/home/demo/secret.key']

    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'Delete' })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.SftpInspectDelete).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      paths: ['/home/demo/app.log'],
      recursive: false,
    })
  })

  it('keeps sorting and column order aligned after filtering', async () => {
    setBrowsableSftpState([
      entry({ name: 'z.conf', path: '/z.conf', size: 9, permissions: '-rwxr-xr-x' }),
      entry({ name: 'a.conf', path: '/a.conf', size: 1, permissions: '-rw-------' }),
      entry({ name: 'notes.txt', path: '/notes.txt', size: 2, permissions: '-rw-r--r--' }),
    ], '/')
    const wrapper = mountPanel(true)
    stubColumnHeaderRects(wrapper)

    await setFileFilter(wrapper, '.conf')
    await wrapper.get('[data-testid="sftp-column-sort-size"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['a.conf', 'z.conf'])

    await dragReorderColumn(wrapper, 'name', 50, 275)

    expect(columnHeaderIds(wrapper)).toEqual(['type', 'size', 'name', 'modTime', 'permissions', 'owner', 'group'])
    expect(rowColumnIds(wrapper, 0)).toEqual(['type', 'size', 'name', 'modTime', 'permissions', 'owner', 'group'])
    expect(wrapper.findAll('[data-testid="sftp-entry-row"]').at(0)!.find('.sftp-entry-icon-file').exists()).toBe(true)

    await wrapper.get('[data-testid="sftp-column-sort-permissions"]').trigger('click')
    expect(visibleEntryNames(wrapper)).toEqual(['a.conf', 'z.conf'])
  })

  it('focuses and clears the filter with file-list shortcuts without triggering path navigation', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'file.txt', path: '/home/demo/file.txt' }),
    ])
    const wrapper = mountPanel(true)
    const app = window.go!.main!.App!

    const focusSpy = vi.spyOn(fileFilterInput(wrapper).element, 'focus')
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'f', ctrlKey: true })
    expect(focusSpy).toHaveBeenCalled()

    await setFileFilter(wrapper, 'file')
    await fileFilterInput(wrapper).trigger('keydown', { key: 'a', ctrlKey: true })
    expect(store.selectedEntries(7)).toEqual([])
    expect((fileFilterInput(wrapper).element as HTMLInputElement).selectionStart).toBe(0)
    expect((fileFilterInput(wrapper).element as HTMLInputElement).selectionEnd).toBe(4)

    await fileFilterInput(wrapper).trigger('keydown', { key: 'Enter' })
    expect(app.ReadSftpDir).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'Escape' })
    expect((fileFilterInput(wrapper).element as HTMLInputElement).value).toBe('')

    await setFileFilter(wrapper, 'file')
    await fileFilterInput(wrapper).trigger('keydown', { key: 'Escape' })
    expect((fileFilterInput(wrapper).element as HTMLInputElement).value).toBe('')
  })

  it('keeps filters out of path history, preserves them on refresh, and clears them after bookmark navigation', async () => {
    localStorage.setItem(pathBookmarksKey, JSON.stringify({
      version: 1,
      byServerId: {
        7: [{ id: 'logs', path: '/var/log', label: 'log', createdAt: 1, updatedAt: 1 }],
      },
    }))
    const store = setBrowsableSftpState([
      entry({ name: 'file.txt', path: '/home/demo/file.txt' }),
    ], '/home/demo')
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'file')
    expect(wrapper.get('[data-testid="sftp-toolbar-action-back"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="sftp-toolbar-action-refresh"]').trigger('click')
    await flushAsyncUi()
    expect((fileFilterInput(wrapper).element as HTMLInputElement).value).toBe('file')

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()
    bookmarkMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-bookmark-jump-logs"]')?.click()
    await flushAsyncUi()

    expect(store.stateByServerId[7].currentPath).toBe('/var/log')
    expect((fileFilterInput(wrapper).element as HTMLInputElement).value).toBe('')
    expect(localStorage.getItem('hostdeck.sftpFileFilter.v1')).toBeNull()
  })

  it('highlights matched name text case-insensitively without changing the original filename text', async () => {
    setBrowsableSftpState([
      entry({ name: 'AppConfig.conf', path: '/home/demo/AppConfig.conf' }),
      entry({ name: 'notes.txt', path: '/home/demo/notes.txt' }),
    ])
    const wrapper = mountPanel(true)

    expect(wrapper.find('.sftp-filter-match').exists()).toBe(false)

    await setFileFilter(wrapper, 'app')

    expect(visibleEntryNames(wrapper)).toEqual(['..', 'AppConfig.conf'])
    expect(cellByColumn(wrapper, 'AppConfig.conf', 'name').text()).toBe('AppConfig.conf')
    expect(matchTexts(wrapper, 'AppConfig.conf', 'name')).toEqual(['App'])
  })

  it('highlights Chinese and multiple AND terms in the name column without highlighting the parent row', async () => {
    setBrowsableSftpState([
      entry({ name: '中文 配置.conf', path: '/home/demo/中文 配置.conf' }),
      entry({ name: '中文 日志.log', path: '/home/demo/中文 日志.log' }),
    ])
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, '中文 配置')

    expect(visibleEntryNames(wrapper)).toEqual(['..', '中文 配置.conf'])
    expect(matchTexts(wrapper, '中文 配置.conf', 'name')).toEqual(['中文', '配置'])
    expect(entryRows(wrapper).at(0)!.find('.sftp-filter-match').exists()).toBe(false)
  })

  it('deduplicates repeated and overlapping terms into stable non-overlapping highlight segments', async () => {
    setBrowsableSftpState([
      entry({ name: 'foobar.txt', path: '/home/demo/foobar.txt' }),
    ])
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'foo foo foobar')

    expect(visibleEntryNames(wrapper)).toEqual(['..', 'foobar.txt'])
    expect(matchTexts(wrapper, 'foobar.txt', 'name')).toEqual(['foobar'])
    expect(cellByColumn(wrapper, 'foobar.txt', 'name').text()).toBe('foobar.txt')
  })

  it('highlights visible type permissions owner group size and modTime cell matches', async () => {
    setBrowsableSftpState([
      entry({
        name: 'pkg.ipk',
        path: '/pkg.ipk',
        size: 2048,
        permissions: '-rw-r-----',
        owner: 'deploy',
        group: 'opkg',
        modTime: '2031-01-02T03:04:05Z',
      }),
    ], '/')
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, '文件 rw-r deploy opkg 2.00 2031')

    expect(matchTexts(wrapper, 'pkg.ipk', 'type')).toEqual(['文件'])
    expect(matchTexts(wrapper, 'pkg.ipk', 'permissions')).toEqual(['rw-r'])
    expect(matchTexts(wrapper, 'pkg.ipk', 'owner')).toEqual(['deploy'])
    expect(matchTexts(wrapper, 'pkg.ipk', 'group')).toEqual(['opkg'])
    expect(matchTexts(wrapper, 'pkg.ipk', 'size')).toEqual(['2.00'])
    expect(matchTexts(wrapper, 'pkg.ipk', 'modTime')).toEqual(['2031'])
  })

  it('highlights the whole type cell when only canonical type text matched the row', async () => {
    setBrowsableSftpState([
      entry({ name: 'etc', path: '/etc', isDir: true }),
    ], '/')
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'directory')

    expect(visibleEntryNames(wrapper)).toEqual(['etc'])
    expect(matchTexts(wrapper, 'etc', 'type')).toEqual([cellByColumn(wrapper, 'etc', 'type').text()])
  })

  it('supports match highlighting in SCP-compatible browse mode and hides it in SCP no-browse mode', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'scp-app.conf', path: '/root/scp-app.conf' }),
    ], '/root')
    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      mode: 'scp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
    }
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'app')
    expect(matchTexts(wrapper, 'scp-app.conf', 'name')).toEqual(['app'])

    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sftp-filter-match').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sftp-file-filter"]').exists()).toBe(false)
  })

  it('renders highlighted filenames as safe text and does not inject HTML', async () => {
    setBrowsableSftpState([
      entry({ name: '<script>alert(1)</script>.conf', path: '/home/demo/script.conf' }),
    ])
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'script')

    const nameCell = cellByColumn(wrapper, '<script>alert(1)</script>.conf', 'name')
    expect(nameCell.text()).toBe('<script>alert(1)</script>.conf')
    expect(matchTexts(wrapper, '<script>alert(1)</script>.conf', 'name')).toEqual(['script', 'script'])
    expect(nameCell.element.querySelector('script')).toBeNull()
    expect(nameCell.html()).toContain('&lt;')
    expect(nameCell.html()).toContain('&gt;')
  })

  it('keeps highlight in the correct cells after column reorder and with selected row styling', async () => {
    setBrowsableSftpState([
      entry({ name: 'app.conf', path: '/app.conf', permissions: '-rw-r--r--', owner: 'root' }),
    ], '/')
    const wrapper = mountPanel(true)
    stubColumnHeaderRects(wrapper)

    await setFileFilter(wrapper, 'app root')
    await dragReorderColumn(wrapper, 'owner', 550, 25)
    await rowByName(wrapper, 'app.conf').trigger('click')

    expect(columnHeaderIds(wrapper).at(0)).toBe('owner')
    expect(rowColumnIds(wrapper, 0).at(0)).toBe('owner')
    expect(matchTexts(wrapper, 'app.conf', 'owner')).toEqual(['root'])
    expect(matchTexts(wrapper, 'app.conf', 'name')).toEqual(['app'])
    expect(rowByName(wrapper, 'app.conf').classes()).toContain('selected')
    expect(rowByName(wrapper, 'app.conf').find('.sftp-filter-match').exists()).toBe(true)
  })

  it('does not change double-click or context-menu behavior when highlighted text is rendered', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'appdir', path: '/home/demo/appdir', isDir: true }),
      entry({ name: 'app.txt', path: '/home/demo/app.txt' }),
    ])
    const wrapper = mountPanel(true)

    await setFileFilter(wrapper, 'app')
    await rowByName(wrapper, 'appdir').trigger('dblclick')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo/appdir')

    store.stateByServerId[7].currentPath = '/home/demo'
    store.entriesByContextId['server:7'] = [entry({ name: 'app.txt', path: '/home/demo/app.txt' })]
    await wrapper.vm.$nextTick()
    await setFileFilter(wrapper, 'app')
    await rowByName(wrapper, 'app.txt').trigger('contextmenu')

    expect(store.selectedEntries(7).map((item) => item.path)).toEqual(['/home/demo/app.txt'])
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(true)
  })

  it('renders real entries for the active server only', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'z.txt', path: '/home/demo/z.txt', size: 2 }),
      entry({ name: 'adir', path: '/home/demo/adir', isDir: true, size: 0 }),
    ]
    store.entriesByServerId[8] = [entry({ name: 'wrong.txt', path: '/wrong.txt' })]

    const wrapper = mountPanel(true)

    expect(wrapper.text()).toContain('adir')
    expect(wrapper.text()).toContain('z.txt')
    expect(wrapper.text()).not.toContain('wrong.txt')
    const names = wrapper.findAll('.sftp-row strong').map((item) => item.text())
    expect(names[0]).toBe('..')
    expect(names[1]).toBe('adir')
  })

  it('renders explicit SFTP context entries instead of default server entries', () => {
    setBrowsableSftpContextState()

    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    expect(wrapper.text()).toContain('context.txt')
    expect(wrapper.text()).not.toContain('wrong.txt')
    expect((wrapper.get<HTMLInputElement>('.sftp-pathbar input').element).value).toBe('/srv/app')
  })

  it('keeps row selection scoped to the explicit SFTP context', async () => {
    const store = setBrowsableSftpContextState()
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await rowByName(wrapper, 'context.txt').trigger('click')

    expect(store.selectedPathsByContextId['pane:one']).toEqual(['/srv/app/context.txt'])
    expect(store.selectedPathsByServerId[7]).toBeUndefined()
  })

  it('keeps sorting and hidden-file toggles scoped to the explicit SFTP context', async () => {
    const store = setBrowsableSftpContextState('pane:one', 'terminal-one', [
      entry({ name: '.env', path: '/srv/app/.env', parentPath: '/srv/app' }),
      entry({ name: 'small.txt', path: '/srv/app/small.txt', parentPath: '/srv/app', size: 1 }),
      entry({ name: 'large.txt', path: '/srv/app/large.txt', parentPath: '/srv/app', size: 100 }),
    ])
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    expect(visibleEntryNames(wrapper)).toEqual(['..', 'large.txt', 'small.txt'])
    await wrapper.get('[data-testid="sftp-column-sort-size"]').trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-hidden"]').trigger('click')

    expect(visibleEntryNames(wrapper)).toEqual(['..', 'small.txt', '.env', 'large.txt'])
    expect(store.sortKey(7, 'pane:one')).toBe('size')
    expect(store.sortKey(7, 'server:7')).toBe('name')
    expect(store.showHidden(7, 'pane:one')).toBe(true)
    expect(store.showHidden(7, 'server:7')).toBe(false)
  })

  it('sends explicit SFTP context and terminal session when jumping to a path', async () => {
    const store = setBrowsableSftpContextState()
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockImplementationOnce(async (request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string }) => ({
      connectionId: request.connectionId,
      contextId: request.contextId,
      terminalSessionId: request.terminalSessionId,
      generation: 10,
      path: request.path,
      parentPath: '/srv',
      entries: [entry({ name: 'next.txt', path: `${request.path}/next.txt`, parentPath: request.path })],
    }))
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await wrapper.get('.sftp-pathbar input').setValue('/srv/next')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await flushAsyncUi()

    expect(app.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      path: '/srv/next',
      requestId: expect.any(String),
    }))
    expect(store.stateByContextId['pane:one'].currentPath).toBe('/srv/next')
    expect(store.stateByServerId[7].currentPath).toBe('/wrong')
  })

  it('sends explicit SFTP context and terminal session for Home and parent navigation', async () => {
    setBrowsableSftpContextState()
    const app = window.go!.main!.App!
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await wrapper.get('[data-testid="sftp-toolbar-action-home"]').trigger('click')
    await flushAsyncUi()
    await wrapper.get('[data-testid="sftp-toolbar-action-parent"]').trigger('click')
    await flushAsyncUi()

    expect(app.SftpGoHome).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      requestId: expect.any(String),
    }))
    expect(app.ReadSftpDir).toHaveBeenLastCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      path: '/srv',
      requestId: expect.any(String),
    }))
  })

  it('uses explicit SFTP context and terminal session for file upload', async () => {
    setBrowsableSftpContextState()
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await wrapper.get('[data-testid="sftp-toolbar-action-upload"]').trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpUpload).toHaveBeenCalledWith({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      localPath: 'C:\\tmp\\drop.txt',
      remotePath: '/srv/app/drop.txt',
      conflictPolicy: 'ask',
    })
  })

  it('uses explicit SFTP context and terminal session for selected downloads', async () => {
    setBrowsableSftpContextState()
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await rowByName(wrapper, 'context.txt').trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-download"]').trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpDownload).toHaveBeenCalledWith({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      remotePath: '/srv/app/context.txt',
      localPath: 'C:\\downloads',
      conflictPolicy: 'ask',
    })
  })

  it('uses explicit SFTP context and terminal session for properties requests', async () => {
    setBrowsableSftpContextState()
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await rowByName(wrapper, 'context.txt').trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'properties')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpGetRemoteItemProperties).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      generation: 9,
      path: '/srv/app/context.txt',
      requestId: expect.any(String),
    }))
  })

  it('uses explicit SFTP context and terminal session for readonly text open', async () => {
    setBrowsableSftpContextState()
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })

    await rowByName(wrapper, 'context.txt').trigger('dblclick')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpReadTextFile).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      contextId: 'pane:one',
      terminalSessionId: 'terminal-one',
      path: '/srv/app/context.txt',
      requestId: expect.any(String),
    }))
    expect(wrapper.find('.mock-viewer-content').exists()).toBe(true)
  })

  it('shows distinct icons for parent folders files and symlinks', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'dir', path: '/home/demo/dir', isDir: true }),
      entry({ name: 'file.txt', path: '/home/demo/file.txt' }),
      entry({ name: 'link.txt', path: '/home/demo/link.txt', isSymlink: true }),
    ]

    const wrapper = mountPanel(true)

    expect(wrapper.find('.sftp-entry-icon-parent').exists()).toBe(true)
    expect(wrapper.find('.sftp-entry-icon-directory').exists()).toBe(true)
    expect(wrapper.find('.sftp-entry-icon-directory .folder-icon').exists()).toBe(true)
    expect(wrapper.find('.sftp-entry-icon-file').exists()).toBe(true)
    expect(wrapper.find('.sftp-entry-icon-file .folder-icon').exists()).toBe(false)
    expect(wrapper.find('.sftp-entry-icon-parent .folder-icon').exists()).toBe(false)
    expect(wrapper.find('.sftp-entry-icon-symlink').exists()).toBe(true)
    expect(wrapper.text()).toContain('文件夹')
    expect(wrapper.text()).toContain('文件')
    expect(wrapper.text()).toContain('链接')
  })

  it('filters hidden files and can reveal them', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: '.env', path: '/home/demo/.env' }),
      entry({ name: 'visible.txt', path: '/home/demo/visible.txt' }),
    ]
    const wrapper = mountPanel(true)
    expect(wrapper.text()).not.toContain('.env')

    await wrapper.findAll('button').find((button) => button.text() === '显示隐藏文件')!.trigger('click')
    expect(wrapper.text()).toContain('.env')
  })

  it('double-clicking a directory loads that directory', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'adir', path: '/home/demo/adir', isDir: true, size: 0 }),
    ]
    const wrapper = mountPanel(true)
    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')

    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home/demo/adir',
      requestId: expect.any(String),
    }))
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo/adir')
  })

  it('renders the remote path input, refresh, Up and Home in one compact toolbar row', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }

    const wrapper = mountPanel(true)
    const toolbar = wrapper.get('.sftp-toolbar')
    expect(toolbar.text()).not.toContain('SFTP')
    expect(toolbar.text()).not.toContain('demo')
    expect(toolbar.text()).not.toContain('已连接')
    expect(toolbar.text()).not.toContain('未绑定服务器')
    expect(toolbar.text()).not.toContain('连接 SFTP')
    expect(toolbar.text()).not.toContain('断开')
    expect(wrapper.findAll('.sftp-pathbar')).toHaveLength(1)
    expect(toolbar.find('.sftp-pathbar').exists()).toBe(true)
    expect(toolbar.get('.sftp-pathbar').classes()).toContain('sftp-toolbar-path')
    expect((toolbar.get<HTMLInputElement>('.sftp-pathbar input').element).value).toBe('/home/demo')
    const buttons = toolbar.findAll('button')
    const labels = buttons.map((button) => button.text())
    const refreshIndex = labels.indexOf('刷新')
    const upIndex = labels.indexOf('向上')
    const homeIndex = labels.indexOf('Home')
    expect(refreshIndex).toBeGreaterThanOrEqual(0)
    expect(upIndex).toBeGreaterThan(refreshIndex)
    expect(homeIndex).toBeGreaterThan(upIndex)
    expect(buttons[upIndex].attributes('disabled')).toBeUndefined()
  })

  it('hides the More button when every file toolbar action fits', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await relayoutToolbar(wrapper, 1800)

    expect(wrapper.find('[data-testid="sftp-toolbar-more"]').exists()).toBe(false)
    expect(toolbarActionIds(wrapper)).toEqual(expect.arrayContaining([
      'reconnect',
      'refresh',
      'parent',
      'home',
      'open',
      'mkdir',
      'upload',
      'upload-directory',
      'download',
      'delete',
      'rename',
      'hidden',
      'conflict-policy',
    ]))
  })

  it('moves overflowed file toolbar actions into More on narrow widths', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await relayoutToolbar(wrapper, 540)

    expect(wrapper.find('[data-testid="sftp-toolbar-more"]').exists()).toBe(true)
    expect(toolbarActionIds(wrapper)).not.toContain('upload-directory')
    expect(toolbarActionIds(wrapper)).not.toContain('delete')

    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    await wrapper.vm.$nextTick()

    const menu = moreMenu()
    expect(menu).not.toBeNull()
    expect(menu?.closest('.sftp-toolbar')).toBeNull()
    expect(menu?.querySelector('[data-testid="sftp-more-action-upload-directory"]')).not.toBeNull()
    expect(menu?.querySelector('[data-testid="sftp-more-action-delete"]')).not.toBeNull()
    expect(menu?.querySelector('[data-testid="sftp-more-action-rename"]')).not.toBeNull()
    expect(menu?.querySelector('[data-testid="sftp-more-conflict-policy"]')).not.toBeNull()
  })

  it('closes the toolbar More menu on outside pointerdown', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await relayoutToolbar(wrapper, 540)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    expect(moreMenu()).not.toBeNull()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(moreMenu()).toBeNull()
  })

  it('keeps the toolbar More menu open for pointerdown inside the menu', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await relayoutToolbar(wrapper, 540)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    moreMenu()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(moreMenu()).not.toBeNull()
  })

  it('applies conflict policy selected from toolbar More to later uploads', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await relayoutToolbar(wrapper, 520)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    const conflict = moreMenu()?.querySelector<HTMLSelectElement>('[data-testid="sftp-more-conflict-policy"]')
    expect(conflict).not.toBeNull()
    conflict!.value = 'overwrite'
    conflict!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushAsyncUi()

    expect(moreMenu()).toBeNull()
    const callback = vi.mocked(OnFileDrop).mock.calls[0][0]
    callback(10, 20, ['C:\\tmp\\drop.txt'])
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpUpload).toHaveBeenCalledWith(expect.objectContaining({
      conflictPolicy: 'overwrite',
      remotePath: '/home/demo/drop.txt',
    }))
  })

  it('closes the bookmark menu on outside pointerdown without closing the toolbar', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(bookmarkMenu()).not.toBeNull()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(bookmarkMenu()).toBeNull()
    expect(wrapper.find('.sftp-toolbar').exists()).toBe(true)
  })

  it('records successful directory navigation and supports Back and Forward', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'adir', path: '/home/demo/adir', isDir: true, size: 0 }),
    ])
    const wrapper = mountPanel(true)
    const back = () => wrapper.get('[data-testid="sftp-toolbar-action-back"]')
    const forward = () => wrapper.get('[data-testid="sftp-toolbar-action-forward"]')

    expect(back().attributes('disabled')).toBeDefined()
    expect(forward().attributes('disabled')).toBeDefined()

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo/adir')
    expect(back().attributes('disabled')).toBeUndefined()

    await back().trigger('click')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo')
    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/home/demo' }))
    expect(forward().attributes('disabled')).toBeUndefined()

    await forward().trigger('click')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo/adir')
    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/home/demo/adir' }))
  })

  it('adds manual path, Home, and Up navigation to history while refresh and reconnect do not', async () => {
    const store = setBrowsableSftpState([], '/home/demo')
    const wrapper = mountPanel(true)
    const app = window.go!.main!.App!
    const back = () => wrapper.get('[data-testid="sftp-toolbar-action-back"]')

    await wrapper.get('.sftp-pathbar input').setValue('/var/log')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/var/log')
    expect(back().attributes('disabled')).toBeUndefined()

    await wrapper.findAll('button').find((button) => button.text() === '刷新')!.trigger('click')
    await flushAsyncUi()
    await back().trigger('click')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo')
    expect(back().attributes('disabled')).toBeDefined()

    await wrapper.findAll('button').find((button) => button.text() === 'Home')!.trigger('click')
    await flushAsyncUi()
    expect(app.SftpGoHome).toHaveBeenCalledWith(expect.objectContaining(defaultSftpContext))
    expect(store.stateByServerId[7].currentPath).toBe('/root')
    expect(back().attributes('disabled')).toBeUndefined()

    await wrapper.findAll('button').find((button) => button.text() === '向上')!.trigger('click')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/')
    expect(back().attributes('disabled')).toBeUndefined()

    const backDisabledBeforeReconnect = back().attributes('disabled')
    await wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '重新连接')!.trigger('click')
    expect(wrapper.emitted('reconnect')?.at(-1)).toEqual([7, 'server:7', ''])
    expect(back().attributes('disabled')).toBe(backDisabledBeforeReconnect)
  })

  it('clears Forward on a new successful navigation and avoids duplicate same-path history entries', async () => {
    const store = setBrowsableSftpState([], '/home/demo')
    const wrapper = mountPanel(true)
    const back = () => wrapper.get('[data-testid="sftp-toolbar-action-back"]')
    const forward = () => wrapper.get('[data-testid="sftp-toolbar-action-forward"]')

    await wrapper.get('.sftp-pathbar input').setValue('/var/log')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await flushAsyncUi()
    await back().trigger('click')
    await flushAsyncUi()
    expect(forward().attributes('disabled')).toBeUndefined()

    await wrapper.get('.sftp-pathbar input').setValue('/etc')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/etc')
    expect(forward().attributes('disabled')).toBeDefined()

    await wrapper.get('.sftp-pathbar input').setValue('/etc')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await flushAsyncUi()
    await back().trigger('click')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo')
  })

  it('does not mutate history when directory loading fails', async () => {
    setBrowsableSftpState([], '/home/demo')
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockRejectedValueOnce(new Error('no such file'))
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-pathbar input').setValue('/missing')
    await wrapper.get('.sftp-pathbar').trigger('submit')
    await flushAsyncUi()

    expect(wrapper.get('[data-testid="sftp-toolbar-action-back"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['no such file', 'error'])
  })

  it('keeps path history bounded to the latest 100 entries', async () => {
    const store = setBrowsableSftpState([], '/p0')
    const wrapper = mountPanel(true)
    const back = () => wrapper.get('[data-testid="sftp-toolbar-action-back"]')

    for (let index = 1; index <= 102; index++) {
      await wrapper.get('.sftp-pathbar input').setValue(`/p${index}`)
      await wrapper.get('.sftp-pathbar').trigger('submit')
      await flushPromises(2)
    }

    for (let index = 0; index < 100; index++) {
      await back().trigger('click')
      await flushPromises(2)
    }
    await flushAsyncUi()

    expect(store.stateByServerId[7].currentPath).toBe('/p2')
    expect(back().attributes('disabled')).toBeDefined()
  })

  it('stores current path bookmarks in localStorage without duplicating server/path entries', async () => {
    setBrowsableSftpState([], '/home/demo')
    const wrapper = mountPanel(true)
    const bookmark = () => wrapper.get('[data-testid="sftp-toolbar-action-bookmark"]')

    await bookmark().trigger('click')
    await bookmark().trigger('click')

    const stored = JSON.parse(localStorage.getItem(pathBookmarksKey) || '{}')
    expect(stored.byServerId['7']).toHaveLength(1)
    expect(stored.byServerId['7'][0]).toEqual(expect.objectContaining({
      path: '/home/demo',
      label: 'demo',
    }))
    expect(stored.byServerId['7'][0]).not.toHaveProperty('content')
    expect(wrapper.emitted('notify')?.at(-1)?.[0]).toContain('已在收藏夹')
  })

  it('uses / as the default label when bookmarking remote root', async () => {
    setBrowsableSftpState([], '/')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmark"]').trigger('click')

    const stored = JSON.parse(localStorage.getItem(pathBookmarksKey) || '{}')
    expect(stored.byServerId['7'][0]).toEqual(expect.objectContaining({
      path: '/',
      label: '/',
    }))
  })

  it('lists only the current server bookmarks and jumps through the bookmark menu', async () => {
    localStorage.setItem(pathBookmarksKey, JSON.stringify({
      version: 1,
      byServerId: {
        7: [{ id: 'logs', path: '/var/log', label: 'log', createdAt: 1, updatedAt: 1 }],
        8: [{ id: 'other', path: '/srv/other', label: 'other', createdAt: 1, updatedAt: 1 }],
      },
    }))
    const store = setBrowsableSftpState([], '/home/demo')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(bookmarkMenu()?.closest('.sftp-toolbar')).toBeNull()
    expect(bookmarkMenu()?.textContent).toContain('log')
    expect(bookmarkMenu()?.textContent).not.toContain('other')
    bookmarkMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-bookmark-jump-logs"]')?.click()
    await flushAsyncUi()

    expect(store.stateByServerId[7].currentPath).toBe('/var/log')
    await wrapper.get('[data-testid="sftp-toolbar-action-back"]').trigger('click')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/home/demo')
  })

  it('keeps failed bookmark jumps in the menu and allows deletion to update storage', async () => {
    localStorage.setItem(pathBookmarksKey, JSON.stringify({
      version: 1,
      byServerId: {
        7: [{ id: 'missing', path: '/missing', label: 'missing', createdAt: 1, updatedAt: 1 }],
      },
    }))
    const app = window.go!.main!.App!
    vi.mocked(app.ReadSftpDir).mockRejectedValueOnce(new Error('not found'))
    setBrowsableSftpState([], '/home/demo')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()
    const jump = bookmarkMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-bookmark-jump-missing"]')
    expect(jump).not.toBeNull()
    jump?.click()
    await flushAsyncUi()

    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['not found', 'error'])
    let stored = JSON.parse(localStorage.getItem(pathBookmarksKey) || '{}')
    expect(stored.byServerId['7']).toHaveLength(1)

    bookmarkMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-bookmark-delete-missing"]')
      ?.click()
    await flushAsyncUi()

    stored = JSON.parse(localStorage.getItem(pathBookmarksKey) || '{}')
    expect(stored.byServerId['7']).toEqual([])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
  })

  it('falls back to an empty bookmark list on damaged localStorage and closes the menu with Escape', async () => {
    localStorage.setItem(pathBookmarksKey, '{broken')
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(bookmarkMenu()?.textContent).toContain('暂无收藏路径')

    bookmarkMenu()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(bookmarkMenu()).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(bookmarkMenu()).toBeNull()
  })

  it('keeps bookmark actions usable from toolbar More on narrow widths', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await relayoutToolbar(wrapper, 520)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')

    expect(moreMenu()?.querySelector('[data-testid="sftp-more-action-bookmark"]')).not.toBeNull()
    expect(moreMenu()?.querySelector('[data-testid="sftp-more-action-bookmarks"]')).not.toBeNull()
  })

  it('shares path history and bookmarks in browsable SCP mode and disables them in no-browse SCP mode', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'dir', path: '/root/dir', isDir: true }),
    ], '/root')
    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      mode: 'scp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
    }
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await flushAsyncUi()
    expect(store.stateByServerId[7].currentPath).toBe('/root/dir')
    await wrapper.get('[data-testid="sftp-toolbar-action-bookmark"]').trigger('click')
    expect(JSON.parse(localStorage.getItem(pathBookmarksKey) || '{}').byServerId['7'][0].path).toBe('/root/dir')

    const limitedState = {
      ...store.stateByServerId[7],
      capabilities: {
        browse: 'none' as const,
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
    }
    store.stateByServerId[7] = limitedState
    store.stateByContextId['server:7'] = limitedState
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="sftp-toolbar-action-back"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-forward"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-bookmark"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="sftp-toolbar-action-bookmarks"]').attributes('disabled')).toBeDefined()
  })

  it('adds a reconnect action to the borderless SFTP toolbar', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }

    const wrapper = mountPanel(true)
    const reconnect = wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '重新连接')!

    expect(reconnect.exists()).toBe(true)
    expect(reconnect.classes()).toContain('sftp-toolbar-menu-action')
    await reconnect.trigger('click')

    expect(wrapper.emitted('reconnect')?.at(-1)).toEqual([7, 'server:7', ''])
  })

  it('confirms before reconnecting while file transfers are active', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.transfersById.active = transfer({ id: 'active', status: 'running' })
    const wrapper = mountPanel(true)
    const reconnect = () => wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '重新连接')!

    await reconnect().trigger('click')
    expect(useAppDialog().dialog.value).toEqual(expect.objectContaining({
      title: '重新连接文件传输',
      confirmText: '终止传输并重连',
    }))
    resolveAppDialog(false)
    await flushAsyncUi()
    expect(wrapper.emitted('reconnect')).toBeUndefined()

    await reconnect().trigger('click')
    resolveAppDialog(true)
    await flushAsyncUi()
    expect(wrapper.emitted('reconnect')?.at(-1)).toEqual([7, 'server:7', ''])
  })

  it('disables the Up button at remote root', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/',
      message: 'online',
      updatedAt: '',
    }

    const wrapper = mountPanel(true)
    const up = wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '向上')!
    expect(up.text()).toBe('向上')
    expect(up.attributes('disabled')).toBeDefined()
  })

  it('highlights the hidden-file toggle while active', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }

    const wrapper = mountPanel(true)
    const hidden = () => wrapper.findAll('button').find((button) => button.text() === '显示隐藏文件')!
    expect(hidden().classes()).not.toContain('active')
    await hidden().trigger('click')
    expect(hidden().classes()).toContain('active')
    await hidden().trigger('click')
    expect(hidden().classes()).not.toContain('active')
  })

  it('hides the remote path toolbar until SFTP is online', () => {
    const unbound = mount(SftpPanel, { props: { connection: null, expanded: true } })
    expect(unbound.find('.sftp-toolbar').exists()).toBe(false)
    expect(unbound.text()).toContain('没有活动服务器工作区')
    expect(unbound.text()).not.toContain('远程路径')
    expect(unbound.text()).not.toContain('重新连接')
    expect(unbound.text()).not.toContain('后退')
    expect(unbound.text()).not.toContain('前进')
    expect(unbound.text()).not.toContain('刷新')
    expect(unbound.text()).not.toContain('向上')
    expect(unbound.text()).not.toContain('Home')
    expect(unbound.text()).not.toContain('收藏')
    expect(unbound.text()).not.toContain('收藏夹')
    expect(unbound.text()).not.toContain('打开')
    expect(unbound.text()).not.toContain('更多')
    unbound.unmount()

    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'error',
      active: false,
      currentPath: '',
      message: 'SFTP subsystem unavailable',
      updatedAt: '',
    }
    const failed = mountPanel(true)
    expect(failed.find('.sftp-toolbar').exists()).toBe(false)
    expect(failed.text()).toContain('没有活动服务器工作区')
    expect(failed.text()).not.toContain('SFTP subsystem unavailable')
  })

  it('double-clicking parent entry returns to parent without selecting it', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(1)!.trigger('click')
    expect(store.selectedPathsByServerId[7] ?? []).toHaveLength(0)
    await wrapper.findAll('.sftp-row').at(1)!.trigger('dblclick')

    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home',
      requestId: expect.any(String),
    }))
  })

  it('clicking the parent entry arrow returns to parent without selecting it', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-entry-icon-parent').trigger('click')

    expect(store.selectedPathsByServerId[7] ?? []).toHaveLength(0)
    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home',
      requestId: expect.any(String),
    }))
  })

  it('does not show an actionable parent row at the remote root', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'etc', path: '/etc', isDir: true })]

    const wrapper = mountPanel(true)

    expect(wrapper.findAll('.sftp-row strong').map((item) => item.text())).not.toContain('..')
  })

  it('shows selected file details in the right details panel', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 128 })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('click')

    expect(wrapper.get('.sftp-details').text()).toContain('file.txt')
    expect(wrapper.get('.sftp-details').text()).toContain('/home/demo/file.txt')
  })

  it('clears file selection only when clicking the blank table background', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/home/demo/a.txt' }),
      entry({ name: 'b.txt', path: '/home/demo/b.txt' }),
    ])
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'a.txt').trigger('click')
    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/a.txt'])
    await wrapper.get('[data-testid="sftp-file-list"]').trigger('click')

    expect(store.selectedPathsByServerId[7]).toEqual([])
  })

  it('right-clicking an unselected row replaces the previous selection', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/home/demo/a.txt' }),
      entry({ name: 'b.txt', path: '/home/demo/b.txt' }),
    ])
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'a.txt').trigger('click')
    await rowByName(wrapper, 'b.txt').trigger('contextmenu')

    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/b.txt'])
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(true)
  })

  it('right-clicking an already selected row keeps multi-selection menu semantics', async () => {
    const store = setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/home/demo/a.txt' }),
      entry({ name: 'b.txt', path: '/home/demo/b.txt' }),
    ])
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'a.txt').trigger('click')
    await rowByName(wrapper, 'b.txt').trigger('click', { ctrlKey: true })
    await rowByName(wrapper, 'b.txt').trigger('contextmenu')

    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/a.txt', '/home/demo/b.txt'])
    const items = wrapper.findComponent({ name: 'ContextMenu' }).props('items') as { id: string; disabled?: boolean }[]
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining(['download', 'delete', 'copy-paths', 'properties']))
    expect(items.find((item) => item.id === 'properties')?.disabled).toBe(true)
  })

  it('opens a parent-only context menu for the synthetic parent row', async () => {
    setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt' })])
    const wrapper = mountPanel(true)

    await wrapper.findAll('[data-testid="sftp-entry-row"]').at(0)!.trigger('contextmenu')

    const items = wrapper.findComponent({ name: 'ContextMenu' }).props('items') as { id: string }[]
    expect(items).toEqual([{ id: 'parent', label: '返回上级' }])
  })

  it('copies only the entry name from the row context menu', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt' })])
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'file.txt').trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'copy-name')
    await flushAsyncUi()

    expect(writeText).toHaveBeenCalledWith('file.txt')
  })

  it('copies selected paths as newline text from the multi-selection context menu', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/home/demo/a.txt' }),
      entry({ name: 'b.txt', path: '/home/demo/b.txt' }),
    ])
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'a.txt').trigger('click')
    await rowByName(wrapper, 'b.txt').trigger('click', { ctrlKey: true })
    await rowByName(wrapper, 'a.txt').trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'copy-paths')
    await flushAsyncUi()

    expect(writeText).toHaveBeenCalledWith('/home/demo/a.txt\n/home/demo/b.txt')
  })

  it('copies the current path from the blank table context menu', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    setBrowsableSftpState([], '/home/demo')
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-file-list"]').trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'copy-current-path')
    await flushAsyncUi()

    expect(writeText).toHaveBeenCalledWith('/home/demo')
  })

  it('shows aggregate details for multi-selection without selecting the parent row', async () => {
    setBrowsableSftpState([
      entry({ name: 'a.txt', path: '/home/demo/a.txt', size: 100 }),
      entry({ name: 'b.txt', path: '/home/demo/b.txt', size: 200 }),
      entry({ name: 'dir', path: '/home/demo/dir', isDir: true, size: 999 }),
    ])
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'a.txt').trigger('click')
    await rowByName(wrapper, 'b.txt').trigger('click', { ctrlKey: true })
    await wrapper.findAll('[data-testid="sftp-entry-row"]').at(0)!.trigger('click', { ctrlKey: true })

    expect(wrapper.get('.sftp-details').text()).toContain('已选择 2 项')
    expect(wrapper.get('.sftp-details').text()).not.toContain('999')
  })

  it('persists details panel collapsed state and restores it on remount', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-details header .text-button').trigger('click')
    expect(localStorage.getItem('hostdeck.sftpDetailsCollapsed')).toBe('true')
    expect(wrapper.find('.sftp-details').exists()).toBe(false)
    wrapper.unmount()

    const restored = mountPanel(true)
    expect(restored.find('.sftp-details').exists()).toBe(false)
    expect(restored.find('.sftp-details-expand').exists()).toBe(true)
  })

  it('keeps a visible details restore entry that expands without covering the file table', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-details header .text-button').trigger('click')
    const content = wrapper.get<HTMLElement>('.sftp-content')
    const restore = wrapper.get<HTMLButtonElement>('.sftp-details-expand')

    expect(content.element.style.gridTemplateColumns).toContain('28px')
    expect(restore.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.sftp-details').exists()).toBe(false)

    await restore.trigger('click')
    expect(wrapper.find('.sftp-details').exists()).toBe(true)
    expect(wrapper.find('.sftp-details-expand').exists()).toBe(false)
  })

  it('persists details panel width after dragging the details resizer', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    })

    wrapper.get('.sftp-details-resizer').element
      .dispatchEvent(new MouseEvent('pointerdown', { clientX: 720, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 700, bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(localStorage.getItem('hostdeck.sftpDetailsWidth')).toBe('276')
  })

  it('opens file properties from the context menu without reading file content', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 3,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'properties')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpGetRemoteItemProperties).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      ...defaultSftpContext,
      generation: 3,
      path: '/home/demo/file.txt',
      requestId: expect.any(String),
    }))
    expect(document.body.querySelector('[data-testid="remote-properties-dialog"]')?.textContent).toContain('file.txt')
    expect(document.body.querySelector('[data-testid="remote-properties-dialog"]')?.textContent).toContain('0644')
    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/file.txt'])
    expect(window.go?.main?.App?.SftpReadTextFile).not.toHaveBeenCalled()
    expect(window.go?.main?.App?.ReadSftpDir).not.toHaveBeenCalled()
  })

  it('shows copy path wording while still copying the remote path', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    const menuText = document.body.querySelector('.context-menu')?.textContent ?? ''
    expect(menuText).toContain('复制路径')
    expect(menuText).not.toContain('复制远程路径')

    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'copy-path')
    await flushAsyncUi()

    expect(writeText).toHaveBeenCalledWith('/home/demo/file.txt')
  })

  it('opens directory properties without entering the directory', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'logs', path: '/home/demo/logs', isDir: true, size: 0 })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'properties')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpGetRemoteItemProperties).toHaveBeenCalledWith(expect.objectContaining({
      path: '/home/demo/logs',
    }))
    expect(document.body.querySelector('[data-testid="remote-properties-dialog"]')?.textContent).toContain('logs')
    expect(document.body.querySelector('[data-testid="remote-properties-dialog"]')?.textContent).toContain('0755')
    expect(window.go?.main?.App?.ReadSftpDir).not.toHaveBeenCalled()
  })

  it('disables file properties for a multi-selection', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'a.txt', path: '/home/demo/a.txt', size: 100 }),
      entry({ name: 'b.txt', path: '/home/demo/b.txt', size: 200 }),
    ]
    const wrapper = mountPanel(true)
    const rows = wrapper.findAll('.sftp-row')

    await rows.at(2)!.trigger('click')
    await rows.at(3)!.trigger('click', { ctrlKey: true })
    await rows.at(2)!.trigger('contextmenu')
    const context = wrapper.findComponent({ name: 'ContextMenu' })
    const items = context.props('items') as { id: string; disabled?: boolean }[]
    const properties = items.find((item) => item.id === 'properties')

    expect(properties).toEqual(expect.objectContaining({ disabled: true }))
    await context.vm.$emit('select', 'properties')
    await flushAsyncUi()
    expect(window.go?.main?.App?.SftpGetRemoteItemProperties).not.toHaveBeenCalled()
  })

  it('disables toolbar properties without one selected browseable item', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    const button = wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-properties"]')

    expect(button.element.disabled).toBe(true)
    expect(button.attributes('title')).toContain('请选择一个项目')
  })

  it('opens properties from the toolbar for one selected item', async () => {
    const store = setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt' })])
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-properties"]').trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpGetRemoteItemProperties).toHaveBeenCalledWith(expect.objectContaining({
      path: '/home/demo/file.txt',
    }))
    expect(store.selectedPathsByServerId[7]).toEqual(['/home/demo/file.txt'])
  })

  it('keeps properties disabled in SCP limited no-browse mode', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'none',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
      currentPath: '/tmp/file.txt',
      message: 'scp limited',
      updatedAt: '',
    }
    const wrapper = mountPanel(true)

    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-properties"]').element.disabled).toBe(true)
  })

  it('applies chmod from the properties dialog and updates the visible entry', async () => {
    const store = setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt', permissions: '-rw-r--r--' })])
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-properties"]').trigger('click')
    await flushAsyncUi()
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="properties-mode-input"]')!
    input.value = '0640'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAsyncUi()
    const apply = document.body.querySelector<HTMLButtonElement>('[data-testid="properties-apply"]')!
    expect(apply.disabled).toBe(false)
    apply.click()
    await flushPromises()
    resolveAppDialog(true)
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpUpdateRemoteItemPermissions).toHaveBeenCalledWith(expect.objectContaining({
      path: '/home/demo/file.txt',
      mode: 0o640,
      preserveSpecialBits: true,
    }))
    expect(store.entriesByServerId[7][0].permissions).toBe('-rw-r-----')
  })

  it('keeps the properties dialog open and user input intact when chmod fails', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.SftpUpdateRemoteItemPermissions).mockRejectedValueOnce(new Error('permission denied'))
    setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt', permissions: '-rw-r--r--' })])
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('click')
    await wrapper.get('[data-testid="sftp-toolbar-action-properties"]').trigger('click')
    await flushAsyncUi()
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="properties-mode-input"]')!
    input.value = '0640'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAsyncUi()
    const apply = document.body.querySelector<HTMLButtonElement>('[data-testid="properties-apply"]')!
    expect(apply.disabled).toBe(false)
    apply.click()
    await flushPromises()
    resolveAppDialog(true)
    await flushAsyncUi()

    expect(document.body.querySelector('[data-testid="remote-properties-error"]')?.textContent).toContain('permission denied')
    expect(document.body.querySelector<HTMLInputElement>('[data-testid="properties-mode-input"]')?.value).toBe('0640')
  })

  it('does not offer file properties for the parent entry', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(1)!.trigger('contextmenu')

    expect(wrapper.findComponent({ name: 'ContextMenu' }).props('items')).toEqual([
      { id: 'parent', label: '返回上级' },
    ])
  })

  it('uses recursive delete wording for directories instead of empty-directory wording', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'dir', path: '/home/demo/dir', isDir: true })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    const text = document.body.querySelector('.context-menu')?.textContent ?? ''

    expect(text).toContain('删除目录及内容')
    expect(text).not.toContain('删除空目录')
  })

  it('inspects directory delete and does not delete when the danger dialog is canceled', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'dir', path: '/home/demo/dir', isDir: true })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'delete')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.SftpInspectDelete).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      paths: ['/home/demo/dir'],
      recursive: true,
    })
    expect(useAppDialog().dialog.value).toEqual(expect.objectContaining({
      title: '危险操作：删除目录及内容',
      danger: true,
      message: expect.stringContaining('2 个文件'),
    }))

    resolveAppDialog(false)
    await flushPromises()

    expect(window.go?.main?.App?.SftpDelete).not.toHaveBeenCalled()
  })

  it('uses Ctrl+A in the focused file list to select all non-parent entries', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'file.txt', path: '/home/demo/file.txt' }),
      entry({ name: 'dir', path: '/home/demo/dir', isDir: true }),
    ]
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'a', ctrlKey: true })

    expect(store.selectedEntries(7).map((item) => item.path)).toEqual(['/home/demo/file.txt', '/home/demo/dir'])
    expect(store.selectedEntries(7).map((item) => item.name)).not.toContain('..')
  })

  it('uses Delete in the focused file list to trigger the existing delete confirmation', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    store.selectedPathsByServerId[7] = ['/home/demo/file.txt']
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-file-list"]').trigger('keydown', { key: 'Delete' })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.go?.main?.App?.SftpInspectDelete).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      paths: ['/home/demo/file.txt'],
      recursive: false,
    })
    expect(useAppDialog().dialog.value?.title).toBe('删除远程文件')
    expect(window.go?.main?.App?.SftpDelete).not.toHaveBeenCalled()
  })

  it('does not let path input Ctrl+A select file list rows', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.get('.sftp-pathbar input').trigger('keydown', { key: 'a', ctrlKey: true })

    expect(store.selectedEntries(7)).toEqual([])
  })

  it('confirms recursive directory delete and refreshes the current path', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'dir', path: '/home/demo/dir', isDir: true })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'delete')
    await flushPromises()
    expect(useAppDialog().dialog.value?.confirmText).toBe('删除选中内容')
    resolveAppDialog(true)
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpDelete).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      paths: ['/home/demo/dir'],
      recursive: true,
    })
    expect(window.go?.main?.App?.ReadSftpDir).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home/demo',
      requestId: expect.any(String),
    }))
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['目录及内容已删除', 'success'])
  })

  it('confirms mixed file and directory delete with one recursive request', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'file.txt', path: '/home/demo/file.txt' }),
      entry({ name: 'dir', path: '/home/demo/dir', isDir: true }),
    ]
    store.selectedPathsByServerId[7] = ['/home/demo/file.txt', '/home/demo/dir']
    const wrapper = mountPanel(true)
    expect(store.selectedEntries(7).map((item) => item.path)).toEqual(['/home/demo/file.txt', '/home/demo/dir'])

    await wrapper.get('[data-testid="sftp-toolbar-action-delete"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(useAppDialog().dialog.value?.message).toContain('将删除 2 个选中项')
    resolveAppDialog(true)
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpDelete).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      paths: ['/home/demo/file.txt', '/home/demo/dir'],
      recursive: true,
    })
  })

  it('double-clicking a regular file opens the readonly remote text viewer', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')

    expect(window.go?.main?.App?.SftpReadTextFile).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home/demo/file.txt',
      maxBytes: 2 * 1024 * 1024,
      requestId: expect.any(String),
    })
    expect(wrapper.find('.sftp-viewer').exists()).toBe(true)
    expect(wrapper.get('.mock-viewer-content').text()).toBe('hello')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('reloads the readonly viewer without invoking the write API', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-reload').trigger('click')

    expect(window.go?.main?.App?.SftpReadTextFile).toHaveBeenCalledTimes(2)
    expect(window.go?.main?.App?.SftpWriteTextFile).not.toHaveBeenCalled()
  })

  it('unlocks a readonly text file into read-write mode from the footer state button', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sftp-viewer').exists()).toBe(false)
    expect(wrapper.find('.sftp-editor').exists()).toBe(true)
    expect((wrapper.get('.mock-editor-content').element as HTMLTextAreaElement).value).toBe('hello')
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')
  })

  it('saves edited text with generation, request identity, encoding, and conflict metadata', async () => {
    const write = vi.fn(async (request: { connectionId: number; path: string; content: string }) => ({
      connectionId: request.connectionId,
      contextId: 'server:7',
      generation: 1,
      requestId: 'save-result',
      path: request.path,
      name: 'file.txt',
      size: request.content.length,
      encoding: 'utf-8',
      contentHash: 'sha256:savedhash',
      entry: entry({ name: 'file.txt', path: request.path, size: request.content.length, modTime: '2026-06-17T00:00:00Z' }),
    }))
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 5 })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('hello world')
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('有未保存修改')
    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home/demo/file.txt',
      content: 'hello world',
      encoding: 'utf-8',
      expectedSize: 5,
      expectedMTime: '2026-06-16T00:00:00Z',
      expectedHash: 'sha256:openhash',
      generation: 1,
      requestId: expect.stringMatching(/^save-/),
      forceOverwrite: false,
      mode: 'save_existing',
      conflictPolicy: 'fail_if_changed',
    })
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')
    expect(store.entriesByServerId[7][0].size).toBe(11)
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['文件已保存。', 'success'])
  })

  it('preserves edited content when saving fails', async () => {
    window.go!.main!.App!.SftpWriteTextFile = vi.fn(async () => {
      throw new Error(JSON.stringify({
        code: 'SFTP_SAVE_PERMISSION_DENIED',
        stage: 'create_temp_file',
        userMessage: '保存失败：没有写入权限。',
        technicalMessage: 'permission denied',
        remotePath: '/home/demo/file.txt',
        operation: 'sftp.write_text',
        retryable: false,
      }))
    }) as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()

    expect((wrapper.get('.mock-editor-content').element as HTMLTextAreaElement).value).toBe('draft')
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('有未保存修改')
    expect(wrapper.get('.mock-editor-error').text()).toContain('保存失败：没有写入权限。')
  })

  it('reconnects once before saving when the file runtime is closed before write starts', async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error(JSON.stringify({
        code: 'SFTP_SAVE_CONNECTION_CLOSED',
        stage: 'stat_before_save',
        userMessage: '保存失败：连接已断开。',
        technicalMessage: 'connection closed',
        remotePath: '/home/demo/file.txt',
        operation: 'sftp.write_text',
        retryable: true,
      })))
      .mockResolvedValueOnce({
        connectionId: 7,
        contextId: 'server:7',
        generation: 2,
        requestId: 'save-after-reconnect',
        path: '/home/demo/file.txt',
        name: 'file.txt',
        size: 5,
        encoding: 'utf-8',
        contentHash: 'sha256:after',
        entry: entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 5 }),
      })
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()

    expect(window.go?.main?.App?.ReconnectSftp).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      auth: { password: '', passphrase: '', trustUnknownHost: false, rememberSecret: false },
    })
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0].generation).toBe(2)
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')
  })

  it('asks before closing or reloading dirty editor content without using browser confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.sftp-editor-close').trigger('click')
    await wrapper.vm.$nextTick()

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(useAppDialog().dialog.value?.title).toContain('未保存修改')
    resolveAppDialog(null)
    await flushAsyncUi()
    expect(wrapper.find('.sftp-editor').exists()).toBe(true)

    await wrapper.get('.mock-editor-reload').trigger('click')
    await wrapper.vm.$nextTick()
    expect(useAppDialog().dialog.value?.message).toContain('重新加载')
    resolveAppDialog('discard')
    await flushAsyncUi()
    expect(window.go?.main?.App?.SftpReadTextFile).toHaveBeenCalledTimes(2)
    confirmSpy.mockRestore()
  })

  it('keeps dirty content when switching back to readonly is canceled', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.mock-editor-readonly').trigger('click')
    await wrapper.vm.$nextTick()

    expect(useAppDialog().dialog.value?.message).toContain('切回只读')
    resolveAppDialog(null)
    await flushAsyncUi()
    expect(wrapper.find('.sftp-editor').exists()).toBe(true)
    expect((wrapper.get('.mock-editor-content').element as HTMLTextAreaElement).value).toBe('draft')
  })

  it('handles save conflicts without overwriting until the user confirms', async () => {
    const conflictError = new Error(JSON.stringify({
      code: 'SFTP_SAVE_CONFLICT',
      stage: 'conflict_check',
      userMessage: '远程文件似乎已被修改，是否覆盖？',
      technicalMessage: 'mtime changed',
      remotePath: '/home/demo/file.txt',
      operation: 'sftp.write_text',
      retryable: false,
    }))
    const write = vi.fn()
      .mockRejectedValueOnce(conflictError)
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({
        connectionId: 7,
        contextId: 'server:7',
        generation: 1,
        requestId: 'save-forced',
        path: '/home/demo/file.txt',
        name: 'file.txt',
        size: 5,
        encoding: 'utf-8',
        contentHash: 'sha256:forced',
        entry: entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 5 }),
      })
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()

    expect(useAppDialog().dialog.value?.title).toContain('远程文件已被修改')
    expect(write).toHaveBeenCalledTimes(1)
    resolveAppDialog(null)
    await flushAsyncUi()
    expect(write).toHaveBeenCalledTimes(1)

    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()
    resolveAppDialog('overwrite')
    await flushAsyncUi()
    expect(write).toHaveBeenCalledTimes(3)
    expect(write.mock.calls[2][0].forceOverwrite).toBe(true)
  })

  it('opens a new remote text draft from the toolbar and saves it with fail-if-exists semantics', async () => {
    const write = vi.fn(async (request: { connectionId: number; path: string; content: string; requestId: string }) => ({
      connectionId: request.connectionId,
      contextId: 'server:7',
      generation: 1,
      requestId: request.requestId,
      path: request.path,
      name: 'new.txt',
      size: request.content.length,
      encoding: 'utf-8',
      contentHash: 'sha256:new',
      entry: entry({ name: 'new.txt', path: request.path, parentPath: '/home/demo/sub', size: request.content.length }),
    }))
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = []
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-new-file"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(useAppDialog().dialog.value?.kind).toBe('input')
    resolveAppDialog('sub/new.txt')
    await flushAsyncUi()

    expect(wrapper.find('.sftp-editor').exists()).toBe(true)
    expect((wrapper.get('.mock-editor-content').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')

    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home/demo/sub/new.txt',
      content: 'draft',
      encoding: 'utf-8',
      expectedSize: -1,
      expectedMTime: '',
      expectedHash: '',
      generation: 1,
      requestId: expect.stringMatching(/^save-/),
      forceOverwrite: false,
      mode: 'create_new',
      conflictPolicy: 'fail_if_exists',
    })
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')
  })

  it('opens new remote text from the blank file-list menu', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = []
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-file-list"]').trigger('contextmenu')
    await wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('select', 'new-file')
    await wrapper.vm.$nextTick()

    expect(useAppDialog().dialog.value?.kind).toBe('input')
  })

  it('asks before overwriting an existing target while creating a new text file', async () => {
    const conflictError = new Error(JSON.stringify({
      code: 'SFTP_SAVE_CONFLICT',
      stage: 'conflict_check',
      userMessage: '目标文件已存在，是否覆盖？',
      technicalMessage: 'target exists',
      remotePath: '/home/demo/new.txt',
      operation: 'sftp.write_text',
      retryable: false,
    }))
    const write = vi.fn()
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({
        connectionId: 7,
        contextId: 'server:7',
        generation: 1,
        requestId: 'save-forced-new',
        path: '/home/demo/new.txt',
        name: 'new.txt',
        size: 5,
        encoding: 'utf-8',
        contentHash: 'sha256:new',
        entry: entry({ name: 'new.txt', path: '/home/demo/new.txt', size: 5 }),
      })
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = []
    const wrapper = mountPanel(true)

    await wrapper.get('[data-testid="sftp-toolbar-action-new-file"]').trigger('click')
    await wrapper.vm.$nextTick()
    resolveAppDialog('new.txt')
    await flushAsyncUi()
    await wrapper.get('.mock-editor-content').setValue('draft')
    await wrapper.get('.mock-editor-save').trigger('click')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledTimes(1)
    expect(useAppDialog().dialog.value?.title).toContain('目标文件已存在')
    resolveAppDialog('overwrite')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toMatchObject({
      path: '/home/demo/new.txt',
      mode: 'create_new',
      conflictPolicy: 'overwrite',
      forceOverwrite: true,
    })
  })

  it('saves a read-write remote text editor draft to another path', async () => {
    const write = vi.fn(async (request: { connectionId: number; path: string; content: string; requestId: string }) => ({
      connectionId: request.connectionId,
      contextId: 'server:7',
      generation: 1,
      requestId: request.requestId,
      path: request.path,
      name: 'copy.txt',
      size: request.content.length,
      encoding: 'utf-8',
      contentHash: 'sha256:copy',
      entry: entry({ name: 'copy.txt', path: request.path, size: request.content.length }),
    }))
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 5 })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('copy draft')
    await wrapper.get('.mock-editor-save-as').trigger('click')
    await wrapper.vm.$nextTick()
    expect(useAppDialog().dialog.value?.kind).toBe('input')
    resolveAppDialog('copy.txt')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      path: '/home/demo/copy.txt',
      content: 'copy draft',
      encoding: 'utf-8',
      expectedSize: -1,
      expectedMTime: '',
      expectedHash: '',
      generation: 1,
      requestId: expect.stringMatching(/^save-/),
      forceOverwrite: false,
      mode: 'save_as',
      conflictPolicy: 'fail_if_exists',
    })
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')
    expect(store.entriesByServerId[7].some((item) => item.path === '/home/demo/copy.txt')).toBe(true)
  })

  it('asks before overwriting an existing target while saving a remote text file as another path', async () => {
    const conflictError = new Error(JSON.stringify({
      code: 'SFTP_SAVE_CONFLICT',
      stage: 'conflict_check',
      userMessage: '目标文件已存在，是否覆盖？',
      technicalMessage: 'target exists',
      remotePath: '/home/demo/copy.txt',
      operation: 'sftp.write_text',
      retryable: false,
    }))
    const write = vi.fn()
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({
        connectionId: 7,
        contextId: 'server:7',
        generation: 1,
        requestId: 'save-as-forced',
        path: '/home/demo/copy.txt',
        name: 'copy.txt',
        size: 10,
        encoding: 'utf-8',
        contentHash: 'sha256:copy',
        entry: entry({ name: 'copy.txt', path: '/home/demo/copy.txt', size: 10 }),
      })
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      contextId: 'server:7',
      generation: 1,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 5 })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    await wrapper.get('.mock-editor-content').setValue('copy draft')
    await wrapper.get('.mock-editor-save-as').trigger('click')
    await wrapper.vm.$nextTick()
    resolveAppDialog('copy.txt')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledTimes(1)
    expect(useAppDialog().dialog.value?.title).toContain('目标文件已存在')
    resolveAppDialog('overwrite')
    await flushAsyncUi()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toMatchObject({
      path: '/home/demo/copy.txt',
      mode: 'save_as',
      conflictPolicy: 'overwrite',
      forceOverwrite: true,
    })
    expect(wrapper.get('.mock-editor-dirty').text()).toBe('已保存')
  })

  it('does not unlock truncated previews or unsupported encodings', async () => {
    window.go!.main!.App!.SftpReadTextFile = vi.fn(async (request: { connectionId: number; path: string }) => ({
      connectionId: request.connectionId,
      contextId: 'server:7',
      generation: 1,
      requestId: 'open-test',
      entry: entry({ name: 'large.log', path: request.path, size: 3 * 1024 * 1024 }),
      path: request.path,
      name: 'large.log',
      size: 3 * 1024 * 1024,
      content: 'partial',
      encoding: 'utf-8',
      contentHash: '',
      truncated: true,
      detectedLanguage: 'log',
      textKind: 'plaintext',
    })) as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'large.log', path: '/home/demo/large.log', size: 3 * 1024 * 1024 })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')

    expect(wrapper.get('.mock-viewer-unlock').attributes('disabled')).toBeDefined()
    await wrapper.get('.mock-viewer-unlock').trigger('click')
    expect(wrapper.find('.sftp-editor').exists()).toBe(false)
  })

  it('shows an error and restores controls when readonly open fails', async () => {
    window.go!.main!.App!.SftpWriteTextFile = vi.fn(async () => {
      throw new Error(JSON.stringify({
        code: 'SFTP_SAVE_PERMISSION_DENIED',
        stage: 'create_temp_file',
        userMessage: '保存失败：没有写入权限。',
        technicalMessage: 'permission denied',
        remotePath: '/home/demo/file.txt',
        operation: 'sftp.write_text',
        retryable: false,
      }))
    }) as never
    window.go!.main!.App!.SftpReadTextFile = vi.fn(async () => {
      throw new Error('该文件不是明文或包含二进制内容')
    }) as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sftp-viewer').exists()).toBe(false)
    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['该文件不是明文或包含二进制内容', 'error'])
    expect(wrapper.findAll('.sftp-toolbar button').find((button) => button.text() === '刷新')?.attributes('disabled')).toBeUndefined()
  })

  it('closes the readonly viewer without saving or prompting for overwrite', async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error(JSON.stringify({
        code: 'SFTP_SAVE_CONFLICT',
        stage: 'conflict_check',
        userMessage: '远程文件似乎已被修改，是否覆盖？',
        technicalMessage: 'mtime changed',
        remotePath: '/home/demo/file.txt',
        operation: 'sftp.write_text',
        retryable: false,
      })))
      .mockResolvedValueOnce({
        connectionId: 7,
        entry: entry({ name: 'file.txt', path: '/home/demo/file.txt', size: 11 }),
      })
    window.go!.main!.App!.SftpWriteTextFile = write as never
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'file.txt', path: '/home/demo/file.txt' })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('dblclick')
    await wrapper.get('.sftp-viewer-close').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sftp-viewer').exists()).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('does not open remote text when the current SFTP context cannot edit text', async () => {
    const store = setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt' })])
    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: false,
      },
    }
    const wrapper = mountPanel(true)

    await rowByName(wrapper, 'file.txt').trigger('dblclick')
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpReadTextFile).not.toHaveBeenCalled()
    expect(wrapper.find('.mock-viewer-content').exists()).toBe(false)
  })

  it('reflects disabled capability flags in toolbar actions', () => {
    const store = setBrowsableSftpState([entry({ name: 'file.txt', path: '/home/demo/file.txt' })])
    store.stateByServerId[7] = {
      ...store.stateByServerId[7],
      capabilities: {
        browse: 'full',
        uploadFile: false,
        downloadFile: false,
        uploadDirectory: false,
        downloadDirectory: false,
        mkdir: false,
        rename: false,
        delete: false,
        editText: false,
      },
    }
    store.selectedPathsByServerId[7] = ['/home/demo/file.txt']

    const wrapper = mountPanel(true)

    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-open"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-mkdir"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-new-file"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-upload"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-upload-directory"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-download"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-delete"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sftp-toolbar-action-rename"]').element.disabled).toBe(true)
  })

  it('emits and clears upload refresh errors for the active SFTP context only', async () => {
    const store = setBrowsableSftpContextState()
    const wrapper = mountPanelWithProps({ contextId: 'pane:one', terminalSessionId: 'terminal-one' })
    store.uploadRefreshErrorsByServerId[7] = 'server refresh failed'
    store.uploadRefreshErrorsByContextId['pane:one'] = 'context refresh failed'
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('notify')?.at(-1)).toEqual(['context refresh failed', 'error'])
    expect(store.uploadRefreshErrorsByContextId['pane:one']).toBeUndefined()
    expect(store.uploadRefreshErrorsByServerId[7]).toBe('server refresh failed')
  })

  it('toggles the drop overlay class during drag enter and leave', async () => {
    setBrowsableSftpState()
    const wrapper = mountPanel(true)
    const content = wrapper.get('.sftp-content')

    await content.trigger('dragenter')
    expect(content.classes()).toContain('drop-active')
    await content.trigger('dragleave')
    expect(content.classes()).not.toContain('drop-active')
  })

  it('cleans up file drop and global panel listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    setBrowsableSftpState()
    const wrapper = mountPanel(true)

    wrapper.unmount()

    expect(OnFileDropOff).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    removeSpy.mockRestore()
  })

  it('uploads dropped Wails file paths through the transfer queue', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    mountPanel(true)
    const callback = vi.mocked(OnFileDrop).mock.calls[0][0]

    callback(10, 20, ['C:\\tmp\\drop.txt'])
    await Promise.resolve()

    expect(window.go?.main?.App?.SftpUpload).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\tmp\\drop.txt',
      remotePath: '/home/demo/drop.txt',
      conflictPolicy: 'ask',
    })
  })

  it('accepts a dropped folder path as a recursive upload transfer from the backend', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.SftpUpload).mockResolvedValueOnce({
      id: 'upload-folder-drop',
      connectionId: 7,
      direction: 'upload',
      recursive: true,
      sourceType: 'directory',
      localPath: 'C:\\tmp\\folder',
      remotePath: '/home/demo/folder',
      fileName: 'folder',
      currentFile: 'folder/a.txt',
      totalBytes: 10,
      transferredBytes: 0,
      filesTotal: 1,
      filesDone: 0,
      failedCount: 0,
      skippedCount: 0,
      percent: 0,
      speedBytesPerSecond: 0,
      status: 'queued',
      errorMessage: '',
      cancelable: true,
      startedAt: '',
      finishedAt: '',
    })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    mountPanel(true)
    const callback = vi.mocked(OnFileDrop).mock.calls[0][0]

    callback(10, 20, ['C:\\tmp\\folder'])
    await Promise.resolve()
    await Promise.resolve()

    expect(window.go?.main?.App?.SftpUpload).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\tmp\\folder',
      remotePath: '/home/demo/folder',
      conflictPolicy: 'ask',
    })
    expect(store.transfersById['upload-folder-drop'].recursive).toBe(true)
    expect(store.transfersById['upload-folder-drop'].sourceType).toBe('directory')
  })

  it('uploads a dropped folder path in SCP compatibility mode', async () => {
    const app = window.go!.main!.App!
    vi.mocked(app.SftpUpload).mockResolvedValueOnce({
      id: 'scp-upload-folder-drop',
      connectionId: 7,
      mode: 'scp',
      direction: 'upload',
      recursive: true,
      sourceType: 'directory',
      localPath: 'C:\\tmp\\folder',
      remotePath: '/root/folder',
      fileName: 'folder',
      currentFile: 'folder/a.txt',
      totalBytes: 10,
      transferredBytes: 0,
      filesTotal: 1,
      filesDone: 0,
      failedCount: 0,
      skippedCount: 0,
      percent: 0,
      speedBytesPerSecond: 0,
      status: 'queued',
      errorMessage: '',
      cancelable: true,
      startedAt: '',
      finishedAt: '',
    })
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      mode: 'scp',
      capabilities: {
        browse: 'full',
        uploadFile: true,
        downloadFile: true,
        uploadDirectory: true,
        downloadDirectory: true,
        mkdir: true,
        rename: true,
        delete: true,
        editText: true,
      },
      currentPath: '/root',
      message: 'SCP 兼容模式',
      updatedAt: '',
    }
    mountPanel(true)
    const callback = vi.mocked(OnFileDrop).mock.calls[0][0]

    callback(10, 20, ['C:\\tmp\\folder'])
    await flushAsyncUi()

    expect(window.go?.main?.App?.SftpUpload).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\tmp\\folder',
      remotePath: '/root/folder',
      conflictPolicy: 'ask',
    })
    expect(store.transfersById['scp-upload-folder-drop'].mode).toBe('scp')
    expect(store.transfersById['scp-upload-folder-drop'].recursive).toBe(true)
  })

  it('shows directory download and upload-folder entry points', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [entry({ name: 'dir', path: '/home/demo/dir', isDir: true })]
    const wrapper = mountPanel(true)

    await wrapper.findAll('.sftp-row').at(2)!.trigger('contextmenu')
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.context-menu')?.textContent).toContain('下载目录')

    await relayoutToolbar(wrapper, 540)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    expect(moreMenu()?.querySelector('[data-testid="sftp-more-action-upload-directory"]')).not.toBeNull()
  })

  it('uploads a selected local folder through the directory transfer API', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    const wrapper = mountPanel(true)
    await relayoutToolbar(wrapper, 540)
    await wrapper.get('[data-testid="sftp-toolbar-more"]').trigger('click')
    moreMenu()?.querySelector<HTMLButtonElement>('[data-testid="sftp-more-action-upload-directory"]')?.click()
    await Promise.resolve()
    resolveAppDialog('overwrite')
    await Promise.resolve()
    await Promise.resolve()

    expect(window.go?.main?.App?.SftpUploadDirectory).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\tmp\\folder',
      remoteDirectory: '/home/demo',
      conflictPolicy: 'overwrite',
    })
  })

  it('downloads mixed file and directory selections recursively for directories', async () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.entriesByServerId[7] = [
      entry({ name: 'file.txt', path: '/home/demo/file.txt' }),
      entry({ name: 'dir', path: '/home/demo/dir', isDir: true }),
    ]
    store.selectedPathsByServerId[7] = ['/home/demo/file.txt', '/home/demo/dir']
    const wrapper = mountPanel(true)
    await wrapper.find('select').setValue('overwrite')
    await wrapper.findAll('button').find((button) => button.text() === '下载')!.trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(window.go?.main?.App?.SftpDownload).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      localPath: 'C:\\downloads',
      remotePath: '/home/demo/file.txt',
      conflictPolicy: 'overwrite',
    })
    expect(window.go?.main?.App?.SftpDownloadDirectory).toHaveBeenCalledWith({
      connectionId: 7,
      ...defaultSftpContext,
      remotePath: '/home/demo/dir',
      localDirectory: 'C:\\downloads',
      conflictPolicy: 'overwrite',
    })
  })

  it('keeps the transfer queue out of the SFTP panel body', () => {
    const store = useSftpStore()
    store.stateByServerId[7] = {
      connectionId: 7,
      status: 'online',
      active: true,
      currentPath: '/home/demo',
      message: 'online',
      updatedAt: '',
    }
    store.transfersById.transfer1 = {
      id: 'transfer1',
      connectionId: 7,
      direction: 'upload',
      recursive: true,
      sourceType: 'directory',
      localPath: 'C:/tmp/a.txt',
      remotePath: '/home/demo/a.txt',
      fileName: 'a.txt',
      currentFile: 'nested/a.txt',
      totalBytes: 100,
      transferredBytes: 50,
      filesTotal: 2,
      filesDone: 1,
      failedCount: 0,
      skippedCount: 0,
      percent: 50,
      speedBytesPerSecond: 1024,
      status: 'running',
      errorMessage: '',
      cancelable: true,
      startedAt: '2026-06-16T00:00:00Z',
      finishedAt: '',
    }

    const wrapper = mountPanel(true)

    expect(wrapper.find('.sftp-transfers').exists()).toBe(false)
    expect(wrapper.text()).toContain('上传目录：nested/a.txt')
    expect(wrapper.text()).toContain('1/2 项')
  })
})
