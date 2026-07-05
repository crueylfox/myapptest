export type CommandTokenType =
  | 'command'
  | 'subcommand'
  | 'argument'
  | 'option'
  | 'string'
  | 'variable'
  | 'path'
  | 'operator'
  | 'comment'
  | 'number'
  | 'ip'
  | 'port'
  | 'url'
  | 'danger'
  | 'whitespace'

export interface CommandToken {
  type: CommandTokenType
  value: string
}

const operatorPrefixes = ['&&', '||', '2>>', '>>', '2>', '|', '>', '<', ';', '(', ')']
const dangerCommands = new Set(['rm', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff'])
const commandResetOperators = new Set(['|', '&&', '||', ';'])

export function tokenizeCommand(command: string): CommandToken[] {
  const value = String(command ?? '')
  const tokens: CommandToken[] = []
  let index = 0
  let expectingCommand = true
  let previousBareWasCommand = false

  while (index < value.length) {
    const char = value[index]
    if (/\s/.test(char)) {
      const start = index
      while (index < value.length && /\s/.test(value[index])) index += 1
      tokens.push({ type: 'whitespace', value: value.slice(start, index) })
      continue
    }

    if (char === '#') {
      const start = index
      while (index < value.length && value[index] !== '\n') index += 1
      tokens.push({ type: 'comment', value: value.slice(start, index) })
      expectingCommand = true
      previousBareWasCommand = false
      continue
    }

    if (char === '<' && looksLikeHTMLTag(value, index)) {
      const end = value.indexOf('>', index + 1)
      tokens.push({ type: 'argument', value: value.slice(index, end + 1) })
      index = end + 1
      expectingCommand = false
      previousBareWasCommand = false
      continue
    }

    if (char === '\'' || char === '"') {
      const start = index
      const quote = char
      index += 1
      while (index < value.length) {
        if (value[index] === '\\' && quote === '"') {
          index += 2
          continue
        }
        if (value[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      tokens.push({ type: 'string', value: value.slice(start, index) })
      previousBareWasCommand = false
      expectingCommand = false
      continue
    }

    const operator = operatorPrefixes.find((candidate) => value.startsWith(candidate, index))
    if (operator) {
      tokens.push({ type: 'operator', value: operator })
      index += operator.length
      expectingCommand = commandResetOperators.has(operator)
      previousBareWasCommand = false
      continue
    }

    const start = index
    while (index < value.length && !/\s/.test(value[index]) && !isOperatorStart(value, index) && value[index] !== '#') {
      if ((value[index] === '\'' || value[index] === '"') && index > start) break
      index += 1
    }
    const text = value.slice(start, index)
    const type = classifyBareToken(text, expectingCommand, previousBareWasCommand)
    tokens.push({ type, value: text })
    expectingCommand = false
    previousBareWasCommand = type === 'command'
  }

  return tokens
}

export function escapeCommandTokenText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function classifyBareToken(value: string, expectingCommand: boolean, previousBareWasCommand: boolean): CommandTokenType {
  const lower = value.toLowerCase()
  if (dangerCommands.has(lower) || lower === 'dd' || lower.startsWith('of=')) return 'danger'
  if (/^https?:\/\/\S+$/i.test(value)) return 'url'
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(value)) return value.includes(':') ? 'port' : 'ip'
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value)) return 'variable'
  if (/^--?[\w][\w-]*(?:=.*)?$/.test(value)) return 'option'
  if (/^(?:\.{1,2}\/|\/|~\/|[\w.-]+\/)\S*$/.test(value)) return 'path'
  if (/^\d+(?:\.\d+)?$/.test(value)) return 'number'
  if (expectingCommand) return 'command'
  if (previousBareWasCommand && /^[A-Za-z][\w.-]*$/.test(value)) return 'subcommand'
  return 'argument'
}

function isOperatorStart(value: string, index: number): boolean {
  return operatorPrefixes.some((operator) => value.startsWith(operator, index))
}

function looksLikeHTMLTag(value: string, index: number): boolean {
  const end = value.indexOf('>', index + 1)
  if (end < 0) return false
  const candidate = value.slice(index + 1, end)
  return /^[A-Za-z][^>\n]*$/.test(candidate)
}
