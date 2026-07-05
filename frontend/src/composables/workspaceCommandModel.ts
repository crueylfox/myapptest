import type { LocalTerminalState, TerminalSessionInfo } from '../types'
import {
  getPanePositionLabel,
  type PaneAssignment,
  type PaneAssignments,
  type SplitMode,
  type SplitPaneId,
} from '../utils/workspaceSplitTypes'

export type PaneMenuMode = 'main' | 'swap' | 'move'

export type TerminalSelectorOption = {
  key: string
  assignment: PaneAssignment
  badge: string
  title: string
  statusClass: string
  statusText: string
}

export type PaneOption = {
  paneId: SplitPaneId
  label: string
}

export function getWorkspacePanePositionLabel(mode: SplitMode, paneId: SplitPaneId) {
  return getPanePositionLabel(mode, paneId)
}

export function buildTerminalSelectorOptions(
  sshTabs: TerminalSessionInfo[],
  localSessions: LocalTerminalState[],
): TerminalSelectorOption[] {
  return [
    ...sshTabs.map((tab) => ({
      key: `ssh:${tab.sessionId}`,
      assignment: { kind: 'ssh' as const, sessionId: tab.sessionId },
      badge: 'SSH',
      title: tab.title,
      statusClass: tab.status,
      statusText: statusLabel(tab.status),
    })),
    ...localSessions.map((session) => ({
      key: `local:${session.sessionId}`,
      assignment: { kind: 'local' as const, sessionId: session.sessionId },
      badge: localTerminalBadge(session.shellKind, session.shellName || session.shell),
      title: session.title || session.shell || 'Local Terminal',
      statusClass: localStatusClass(session.status),
      statusText: localStatusLabel(session.status),
    })),
  ]
}

export function buildOccupiedPaneOptions(input: {
  sourcePaneId: SplitPaneId
  visiblePaneIds: SplitPaneId[]
  paneAssignments: PaneAssignments
  splitMode: SplitMode
  assignmentAvailable: (assignment: PaneAssignment) => boolean
  assignmentTitle: (assignment: PaneAssignment) => string
}): PaneOption[] {
  return input.visiblePaneIds
    .filter((paneId) => paneId !== input.sourcePaneId)
    .map((paneId) => ({ paneId, assignment: input.paneAssignments[paneId] }))
    .filter((item): item is { paneId: SplitPaneId; assignment: PaneAssignment } =>
      Boolean(item.assignment && input.assignmentAvailable(item.assignment)))
    .map((item) => ({
      paneId: item.paneId,
      label: `${getWorkspacePanePositionLabel(input.splitMode, item.paneId)}：${input.assignmentTitle(item.assignment)}`,
    }))
}

export function buildEmptyPaneOptions(input: {
  sourcePaneId: SplitPaneId
  visiblePaneIds: SplitPaneId[]
  paneAssignments: PaneAssignments
  splitMode: SplitMode
}): PaneOption[] {
  return input.visiblePaneIds
    .filter((paneId) => paneId !== input.sourcePaneId && !input.paneAssignments[paneId])
    .map((paneId) => ({ paneId, label: getWorkspacePanePositionLabel(input.splitMode, paneId) }))
}

export function paneAssignmentTitle(
  assignment: PaneAssignment,
  sshTabs: TerminalSessionInfo[],
  localSessions: LocalTerminalState[],
) {
  if (assignment.kind === 'ssh') {
    return sshTabs.find((tab) => tab.sessionId === assignment.sessionId)?.title ?? 'SSH'
  }
  const session = localSessions.find((item) => item.sessionId === assignment.sessionId)
  return session?.title || session?.shell || 'Local Terminal'
}

export function paneActivityTitle(label: string) {
  return label ? `${label} 条新输出` : '有新输出'
}

export function statusLabel(status = 'offline') {
  const labels: Record<string, string> = {
    connected: '已连接',
    online: '已连接',
    connecting: '正在连接',
    reconnecting: '重连中',
    disconnected: '已断开',
    failed: '连接失败',
    error: '连接失败',
    auth_failed: '连接失败',
    offline: '离线',
  }
  return labels[status] ?? '离线'
}

export function localTerminalBadge(shellKind?: string, shellName?: string) {
  const value = `${shellKind ?? ''} ${shellName ?? ''}`.toLowerCase()
  if (value.includes('cmd')) return 'CMD'
  if (value.includes('powershell') || value.includes('pwsh')) return 'PowerShell'
  return 'Local'
}

export function localStatusLabel(status = '') {
  const labels: Record<string, string> = {
    starting: '启动中',
    running: '运行中',
    exited: '已退出',
    failed: '启动失败',
    closed: '已关闭',
  }
  return labels[status] ?? status
}

export function localStatusClass(status = '') {
  if (status === 'running') return 'online'
  if (status === 'starting') return 'connecting'
  if (status === 'failed') return 'error'
  return 'offline'
}
