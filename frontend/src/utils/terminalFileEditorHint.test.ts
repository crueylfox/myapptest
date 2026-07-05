import { describe, expect, it } from 'vitest'
import { detectFileEditorHighlightHint, terminalLanguageFromFilePath } from './terminalFileEditorHint'

describe('terminal file editor highlight hints', () => {
  it('detects file-oriented alternate-screen editors and pagers', () => {
    for (const command of [
      'vi /etc/config/network',
      'vim /etc/config/network',
      'nano /etc/config/network',
      'less /etc/config/network',
      'more /etc/config/network',
      'sudo env TERM=xterm-256color vim /etc/config/network',
    ]) {
      expect(detectFileEditorHighlightHint(command, 'session-1')).toMatchObject({
        path: '/etc/config/network',
        detectedLanguage: 'uci',
        terminalSessionID: 'session-1',
      })
    }
  })

  it('does not create file hints for non-file TUI commands', () => {
    for (const command of ['top', 'htop', 'tmux', 'ssh root@example.test', 'aptitude']) {
      expect(detectFileEditorHighlightHint(command, 'session-1')).toBeNull()
    }
  })

  it('maps OpenWrt UCI and common text file paths to bounded languages', () => {
    expect(terminalLanguageFromFilePath('/etc/config/network')).toBe('uci')
    expect(terminalLanguageFromFilePath('/root/install.sh')).toBe('shell')
    expect(terminalLanguageFromFilePath('/tmp/config.json')).toBe('json')
    expect(terminalLanguageFromFilePath('/var/log/messages.log')).toBe('log')
  })
})
