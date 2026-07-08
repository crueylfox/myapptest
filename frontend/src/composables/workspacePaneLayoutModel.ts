import type { PaneAssignments, SplitPaneId } from '../utils/workspaceSplitTypes'

export type WorkspacePanelDragMode = 'sidebar' | 'sftp'

type MonitorSidebarStyleInput = {
  collapsed: boolean
  sidebarWidth: number
}

type WorkspaceRightStyleInput = {
  sftpExpanded: boolean
  sftpHeight: number
}

type MonitorSidebarBounds = Pick<DOMRect, 'left' | 'width'>
type SftpPanelBounds = Pick<DOMRect, 'bottom' | 'height'>

const MONITOR_SIDEBAR_AUTO_COLLAPSE_WIDTH = 180
const SFTP_PANEL_AUTO_COLLAPSE_HEIGHT = 96

export type VisibleOutputSessionInput = {
  visible: boolean
  splitEnabled: boolean
  renderedPaneIds: SplitPaneId[]
  paneAssignments: PaneAssignments
  activeSshSessionId: string | null | undefined
  activeLocalSessionId: string | null | undefined
  localTerminalActive: boolean
}

export function buildWorkspaceShellStyle(input: MonitorSidebarStyleInput) {
  return {
    gridTemplateColumns: input.collapsed
      ? '0 1px minmax(0, 1fr)'
      : `${input.sidebarWidth}px 0 minmax(0, 1fr)`,
  }
}

export function buildWorkspaceRightStyle(input: WorkspaceRightStyleInput) {
  return {
    gridTemplateRows: input.sftpExpanded
      ? `minmax(180px, 1fr) 0 ${input.sftpHeight}px 28px`
      : 'minmax(180px, 1fr) 0 0 28px',
  }
}

export function clampMonitorSidebarWidth(clientX: number, bounds: MonitorSidebarBounds) {
  return Math.min(Math.max(clientX - bounds.left, 230), bounds.width * 0.35)
}

export function clampSftpPanelHeight(clientY: number, bounds: SftpPanelBounds) {
  const next = bounds.bottom - clientY - 28
  return Math.min(Math.max(next, 140), bounds.height * 0.55)
}

export function monitorSidebarResizeIntent(clientX: number, bounds: MonitorSidebarBounds) {
  const rawWidth = clientX - bounds.left
  return rawWidth <= MONITOR_SIDEBAR_AUTO_COLLAPSE_WIDTH
    ? { collapsed: true as const }
    : { collapsed: false as const, width: clampMonitorSidebarWidth(clientX, bounds) }
}

export function sftpPanelResizeIntent(clientY: number, bounds: SftpPanelBounds) {
  const rawHeight = bounds.bottom - clientY - 28
  return rawHeight <= SFTP_PANEL_AUTO_COLLAPSE_HEIGHT
    ? { expanded: false as const }
    : { expanded: true as const, height: clampSftpPanelHeight(clientY, bounds) }
}

export function deriveVisibleOutputSessionIds(input: VisibleOutputSessionInput) {
  if (!input.visible) return { ssh: [], local: [] }
  if (input.splitEnabled) {
    return input.renderedPaneIds.reduce<{ ssh: string[]; local: string[] }>((result, paneId) => {
      const assignment = input.paneAssignments[paneId]
      if (assignment?.kind === 'ssh') result.ssh.push(assignment.sessionId)
      if (assignment?.kind === 'local') result.local.push(assignment.sessionId)
      return result
    }, { ssh: [], local: [] })
  }
  return {
    ssh: !input.localTerminalActive && input.activeSshSessionId ? [input.activeSshSessionId] : [],
    local: input.activeLocalSessionId ? [input.activeLocalSessionId] : [],
  }
}
