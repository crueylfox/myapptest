import type { ContextMenuItem } from '../types'
import type { SftpDisplayEntry } from './sftpDisplayEntries'

export type SftpContextMenuTarget = 'entry' | 'blank'

export type SftpContextMenuModelInput = {
  target: SftpContextMenuTarget
  entry: SftpDisplayEntry | null
  selectedCount: number
  online?: boolean
  busy?: boolean
  canBrowse?: boolean
  canEditText?: boolean
}

export function buildSftpContextMenuItems(input: SftpContextMenuModelInput): ContextMenuItem[] {
  const entry = input.entry
  if (entry?.syntheticParent) return [{ id: 'parent', label: '返回上级' }]

  if (input.selectedCount > 1 && input.target === 'entry') {
    return [
      { id: 'download', label: '下载选中' },
      { id: 'delete', label: '删除选中', danger: true },
      { id: 'copy-paths', label: '复制路径' },
      { id: 'properties', label: '文件属性', disabled: true },
      { id: 'separator', label: '', separator: true },
      { id: 'refresh', label: '刷新目录' },
    ]
  }

  if (entry) {
    return entry.isDir ? directoryRowItems() : fileRowItems()
  }

  return [
    { id: 'refresh', label: '刷新' },
    { id: 'home', label: 'Home' },
    { id: 'mkdir', label: '新建文件夹' },
    {
      id: 'new-file',
      label: '新建文件',
      disabled: !input.online || input.busy || !input.canBrowse || !input.canEditText,
    },
    { id: 'upload', label: '上传文件' },
    { id: 'upload-directory', label: '上传文件夹' },
    { id: 'hidden', label: '显示隐藏文件 / 隐藏隐藏文件' },
    { id: 'copy-current-path', label: '复制当前路径' },
  ]
}

function directoryRowItems(): ContextMenuItem[] {
  return [
    { id: 'open', label: '打开' },
    { id: 'download', label: '下载目录' },
    { id: 'rename', label: '重命名' },
    { id: 'delete', label: '删除目录及内容...', danger: true },
    { id: 'separator-1', label: '', separator: true },
    { id: 'copy-path', label: '复制路径' },
    { id: 'copy-name', label: '复制目录名' },
    { id: 'refresh', label: '刷新目录' },
    { id: 'properties', label: '文件属性' },
  ]
}

function fileRowItems(): ContextMenuItem[] {
  return [
    { id: 'open', label: '打开' },
    { id: 'download', label: '下载' },
    { id: 'rename', label: '重命名' },
    { id: 'delete', label: '删除文件', danger: true },
    { id: 'separator-1', label: '', separator: true },
    { id: 'copy-path', label: '复制路径' },
    { id: 'copy-name', label: '复制文件名' },
    { id: 'refresh', label: '刷新目录' },
    { id: 'properties', label: '文件属性' },
  ]
}
