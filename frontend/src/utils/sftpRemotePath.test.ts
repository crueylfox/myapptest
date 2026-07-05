import { describe, expect, it } from 'vitest'
import {
  hasRemotePathTraversal,
  joinRemoteTextPath,
  normalizeRemoteInputPath,
  remoteBasename,
  remoteParentPath,
  validateRemoteTextPathInput,
} from './sftpRemotePath'

describe('sftp remote path utilities', () => {
  it('normalizes remote path input without accepting empty or control-character paths', () => {
    expect(normalizeRemoteInputPath('  /root//apps/  ')).toBe('/root/apps')
    expect(normalizeRemoteInputPath('root\\apps\\file.sh')).toBe('root/apps/file.sh')
    expect(normalizeRemoteInputPath('')).toBe('')
    expect(normalizeRemoteInputPath('/tmp/a\nb')).toBe('')
  })

  it('rejects traversal in remote text file paths', () => {
    expect(hasRemotePathTraversal('/root/../secret')).toBe(true)
    expect(validateRemoteTextPathInput('../secret.txt', true)).not.toBe('')
    expect(validateRemoteTextPathInput('/root/new.txt', false)).not.toBe('')
    expect(validateRemoteTextPathInput('scripts/new.sh', false)).toBe('')
  })

  it('joins relative and absolute remote text paths predictably', () => {
    expect(joinRemoteTextPath('/root', 'new.sh', false)).toBe('/root/new.sh')
    expect(joinRemoteTextPath('/', 'new.sh', false)).toBe('/new.sh')
    expect(joinRemoteTextPath('/root', '/tmp/new.sh', true)).toBe('/tmp/new.sh')
    expect(joinRemoteTextPath('/root', '../new.sh', true)).toBe('')
  })

  it('derives basename and parent path for absolute and relative remote paths', () => {
    expect(remoteBasename('/root/scripts/install.sh')).toBe('install.sh')
    expect(remoteParentPath('/root/scripts/install.sh')).toBe('/root/scripts')
    expect(remoteParentPath('/install.sh')).toBe('/')
    expect(remoteParentPath('install.sh')).toBe('.')
  })
})
