import { describe, expect, it } from 'vitest'
import type { LocalTerminalState, TerminalSessionInfo } from '../types'
import {
  buildTerminalSelectorOptions,
  getWorkspacePanePositionLabel,
  localStatusClass,
  localStatusLabel,
  localTerminalBadge,
  paneActivityTitle,
} from './workspaceCommandModel'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

describe('workspaceCommandModel', () => {
  it('keeps split pane position labels stable', () => {
    expect(getWorkspacePanePositionLabel('single', 'pane-1')).toBe('当前')
    expect(getWorkspacePanePositionLabel('vertical', 'pane-1')).toBe('左')
    expect(getWorkspacePanePositionLabel('vertical', 'pane-2')).toBe('右')
    expect(getWorkspacePanePositionLabel('horizontal', 'pane-1')).toBe('上')
    expect(getWorkspacePanePositionLabel('horizontal', 'pane-2')).toBe('下')
    expect(getWorkspacePanePositionLabel('quad', 'pane-1')).toBe('左上')
    expect(getWorkspacePanePositionLabel('quad', 'pane-4')).toBe('右下')
  })

  it('keeps local terminal badges and status labels stable', () => {
    expect(localTerminalBadge('cmd', 'Command Prompt')).toBe('CMD')
    expect(localTerminalBadge('powershell', 'Windows PowerShell')).toBe('PowerShell')
    expect(localTerminalBadge('pwsh', 'PowerShell 7')).toBe('PowerShell')
    expect(localTerminalBadge('custom', 'fish')).toBe('Local')

    expect(localStatusLabel('starting')).toBe('启动中')
    expect(localStatusLabel('running')).toBe('运行中')
    expect(localStatusLabel('failed')).toBe('启动失败')
    expect(localStatusClass('running')).toBe('online')
    expect(localStatusClass('starting')).toBe('connecting')
    expect(localStatusClass('failed')).toBe('error')
    expect(localStatusClass('closed')).toBe('offline')
  })

  it('builds SSH and Local terminal selector options without exposing terminal output or secrets', () => {
    const sshTab: TerminalSessionInfo = {
      sessionId: 'ssh-session-1',
      connectionId: 1,
      title: 'Debian',
      status: 'online',
      code: '',
      message: '',
    }
    const localSession: LocalTerminalState = {
      sessionId: 'local-session-1',
      shellKind: 'powershell',
      shell: 'powershell.exe',
      shellName: 'Windows PowerShell',
      elevated: false,
      title: 'PowerShell',
      cwd: '',
      status: 'running',
      exitCode: null,
      error: '',
      startedAt: '',
      endedAt: '',
    }

    expect(buildTerminalSelectorOptions([sshTab], [localSession])).toEqual([
      {
        key: 'ssh:ssh-session-1',
        assignment: { kind: 'ssh', sessionId: 'ssh-session-1' },
        badge: 'SSH',
        title: 'Debian',
        statusClass: 'online',
        statusText: '已连接',
      },
      {
        key: 'local:local-session-1',
        assignment: { kind: 'local', sessionId: 'local-session-1' },
        badge: 'PowerShell',
        title: 'PowerShell',
        statusClass: 'online',
        statusText: '运行中',
      },
    ])
  })

  it('keeps pane activity title text stable', () => {
    expect(paneActivityTitle('3')).toBe('3 条新输出')
    expect(paneActivityTitle('')).toBe('有新输出')
  })

  it('stays pure and does not import backend, stores, persistence, or event bus code', () => {
    const source = readFileSync(new URL('./workspaceCommandModel.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"]\.\.\/api\/backend['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/stores\//)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('eventBus')
    expect(source).not.toContain('AppController')
    expect(source).not.toMatch(/password|privateKey|passphrase|terminal output|remote file content/i)
  })
})
