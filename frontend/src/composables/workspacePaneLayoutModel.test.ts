import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceRightStyle,
  buildWorkspaceShellStyle,
  clampMonitorSidebarWidth,
  clampSftpPanelHeight,
  deriveVisibleOutputSessionIds,
  monitorSidebarResizeIntent,
  sftpPanelResizeIntent,
} from './workspacePaneLayoutModel'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const source = readFileSync(new URL('./workspacePaneLayoutModel.ts', import.meta.url), 'utf8')

describe('workspacePaneLayoutModel', () => {
  it('builds the existing monitor/sidebar and SFTP grid styles', () => {
    expect(buildWorkspaceShellStyle({ collapsed: true, sidebarWidth: 300 })).toEqual({
      gridTemplateColumns: '0 1px minmax(0, 1fr)',
    })
    expect(buildWorkspaceShellStyle({ collapsed: false, sidebarWidth: 312 })).toEqual({
      gridTemplateColumns: '312px 0 minmax(0, 1fr)',
    })
    expect(buildWorkspaceRightStyle({ sftpExpanded: true, sftpHeight: 244 })).toEqual({
      gridTemplateRows: 'minmax(180px, 1fr) 0 244px 28px',
    })
    expect(buildWorkspaceRightStyle({ sftpExpanded: false, sftpHeight: 244 })).toEqual({
      gridTemplateRows: 'minmax(180px, 1fr) 0 0 28px',
    })
  })

  it('keeps the existing monitor and SFTP resize clamp formulas', () => {
    expect(clampMonitorSidebarWidth(180, { left: 0, width: 1200 })).toBe(230)
    expect(clampMonitorSidebarWidth(900, { left: 100, width: 1000 })).toBe(350)
    expect(clampMonitorSidebarWidth(310, { left: 20, width: 1200 })).toBe(290)

    expect(clampSftpPanelHeight(900, { bottom: 1000, height: 1000 })).toBe(140)
    expect(clampSftpPanelHeight(200, { bottom: 1000, height: 600 })).toBe(330)
    expect(clampSftpPanelHeight(700, { bottom: 1000, height: 1000 })).toBe(272)
  })


  it('derives auto-hide resize intents before applying the existing clamp formulas', () => {
    expect(monitorSidebarResizeIntent(160, { left: 0, width: 1200 })).toEqual({ collapsed: true })
    expect(monitorSidebarResizeIntent(360, { left: 0, width: 1200 })).toEqual({ collapsed: false, width: 360 })
    expect(sftpPanelResizeIntent(900, { bottom: 1000, height: 800 })).toEqual({ expanded: false })
    expect(sftpPanelResizeIntent(600, { bottom: 1000, height: 600 })).toEqual({ expanded: true, height: 330 })
  })

  it('derives visible SSH and Local output sessions without mixing pane kinds', () => {
    const split = deriveVisibleOutputSessionIds({
      visible: true,
      splitEnabled: true,
      renderedPaneIds: ['pane-1', 'pane-2', 'pane-3'],
      paneAssignments: {
        'pane-1': { kind: 'ssh', sessionId: 'ssh-1' },
        'pane-2': { kind: 'local', sessionId: 'local-1' },
        'pane-3': { kind: 'ssh', sessionId: 'ssh-3' },
        'pane-4': null,
      },
      activeSshSessionId: 'ssh-active',
      activeLocalSessionId: 'local-active',
      localTerminalActive: false,
    })
    expect(split.ssh).toEqual(['ssh-1', 'ssh-3'])
    expect(split.local).toEqual(['local-1'])

    expect(deriveVisibleOutputSessionIds({
      visible: false,
      splitEnabled: true,
      renderedPaneIds: ['pane-1'],
      paneAssignments: {
        'pane-1': { kind: 'ssh', sessionId: 'ssh-1' },
        'pane-2': null,
        'pane-3': null,
        'pane-4': null,
      },
      activeSshSessionId: 'ssh-active',
      activeLocalSessionId: 'local-active',
      localTerminalActive: false,
    })).toEqual({ ssh: [], local: [] })

    expect(deriveVisibleOutputSessionIds({
      visible: true,
      splitEnabled: false,
      renderedPaneIds: ['pane-1'],
      paneAssignments: {
        'pane-1': null,
        'pane-2': null,
        'pane-3': null,
        'pane-4': null,
      },
      activeSshSessionId: 'ssh-active',
      activeLocalSessionId: 'local-active',
      localTerminalActive: true,
    })).toEqual({ ssh: [], local: ['local-active'] })
  })

  it('stays inside pure frontend layout boundaries', () => {
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
    expect(source).not.toMatch(/password|privateKey|passphrase|terminal output|remote file content/i)
  })
})
