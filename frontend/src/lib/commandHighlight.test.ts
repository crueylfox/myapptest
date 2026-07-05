import { describe, expect, it } from 'vitest'
import { escapeCommandTokenText, tokenizeCommand } from './commandHighlight'

function tokenTypes(command: string) {
  return tokenizeCommand(command).map((token) => token.type)
}

describe('commandHighlight tokenizer', () => {
  it('classifies common shell tokens without changing the original text', () => {
    const command = 'sudo rm -rf /tmp/demo | grep "$HOME" > out.log # 清理'
    const tokens = tokenizeCommand(command)

    expect(tokens.map((token) => token.value).join('')).toBe(command)
    expect(tokenTypes(command)).toEqual(expect.arrayContaining([
      'command',
      'danger',
      'option',
      'path',
      'operator',
      'string',
      'comment',
    ]))
    expect(tokens.find((token) => token.value === 'rm')?.type).toBe('danger')
    expect(tokens.find((token) => token.value === '-rf')?.type).toBe('option')
  })

  it('keeps multiline commands, Chinese text, variables, URLs, IPs, and continued lines intact', () => {
    const command = [
      'echo 你好 \\',
      '  && curl https://example.com/api?x=1',
      'ping 192.0.2.10 && echo ${USER} $HOME',
    ].join('\n')
    const tokens = tokenizeCommand(command)

    expect(tokens.map((token) => token.value).join('')).toBe(command)
    expect(tokens.some((token) => token.type === 'url')).toBe(true)
    expect(tokens.some((token) => token.type === 'ip')).toBe(true)
    expect(tokens.filter((token) => token.type === 'variable').map((token) => token.value)).toEqual(['${USER}', '$HOME'])
  })

  it('escapes token text before HTML rendering', () => {
    expect(escapeCommandTokenText('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(escapeCommandTokenText('echo "a&b"')).toBe('echo &quot;a&amp;b&quot;')
  })
})
