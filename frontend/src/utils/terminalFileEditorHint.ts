export type TerminalFileEditorLanguage = 'shell' | 'json' | 'yaml' | 'ini' | 'log' | 'uci' | 'generic'

export interface TerminalFileEditorHighlightHint {
  command: string
  path: string
  detectedLanguage: TerminalFileEditorLanguage
  terminalSessionID: string
  startedAt: number
}

const fileEditorCommands = new Set(['vi', 'vim', 'view', 'nvim', 'nano', 'less', 'more'])
const commandPrefixes = new Set(['sudo', 'doas', 'busybox', 'env'])

export function detectFileEditorHighlightHint(
  command: string,
  terminalSessionID: string,
  now = Date.now(),
): TerminalFileEditorHighlightHint | null {
  const normalized = String(command ?? '').trim()
  if (!normalized || normalized.includes('\n')) return null
  const words = shellWords(normalized)
  if (!words.length) return null
  let commandIndex = 0
  while (commandIndex < words.length) {
    while (commandIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[commandIndex])) commandIndex += 1
    if (!commandPrefixes.has(baseCommandName(words[commandIndex] ?? ''))) break
    commandIndex += 1
  }
  const executable = baseCommandName(words[commandIndex] ?? '')
  if (!fileEditorCommands.has(executable)) return null
  const path = findFileArgument(words.slice(commandIndex + 1))
  if (!path) return null
  return {
    command: normalized,
    path,
    detectedLanguage: terminalLanguageFromFilePath(path) ?? 'generic',
    terminalSessionID,
    startedAt: now,
  }
}

export function terminalLanguageFromFilePath(value: string): TerminalFileEditorLanguage | null {
  const lower = String(value ?? '').toLowerCase().split(/[?#]/)[0]
  if (/^\/etc\/config\/[^/]+$/.test(lower)) return 'uci'
  if (/\.(?:sh|bash|zsh|ash|ksh)$/.test(lower)) return 'shell'
  if (/\.json$/.test(lower)) return 'json'
  if (/\.(?:ya?ml)$/.test(lower)) return 'yaml'
  if (/\.(?:conf|ini|env|service)$/.test(lower)) return 'ini'
  if (/\.log$/.test(lower)) return 'log'
  return null
}

function findFileArgument(words: string[]) {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = unquoteShellWord(words[index])
    if (isLikelyFileArgument(word)) return word
  }
  return ''
}

function isLikelyFileArgument(value: string) {
  if (!value || value === '--' || value.startsWith('-')) return false
  if (/^\+\d+$/.test(value)) return false
  if (/^\d+$/.test(value)) return false
  return /^(?:\/|\.{1,2}\/|~\/|[A-Za-z0-9_.-]+(?:\/|$))/.test(value)
}

function shellWords(command: string) {
  const words: string[] = []
  let index = 0
  while (index < command.length) {
    while (/\s/.test(command[index] ?? '')) index += 1
    if (index >= command.length) break
    const quote = command[index] === '\'' || command[index] === '"' ? command[index] : ''
    const start = index
    if (quote) {
      index += 1
      while (index < command.length) {
        if (command[index] === '\\' && quote === '"') {
          index += 2
          continue
        }
        if (command[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      words.push(command.slice(start, index))
      continue
    }
    while (index < command.length && !/\s/.test(command[index])) index += 1
    words.push(command.slice(start, index))
  }
  return words
}

function baseCommandName(value: string) {
  const word = unquoteShellWord(value).toLowerCase()
  return word.split(/[\\/]/).pop() ?? word
}

function unquoteShellWord(value: string) {
  const word = String(value ?? '')
  if (word.length >= 2 && ((word.startsWith('"') && word.endsWith('"')) || (word.startsWith("'") && word.endsWith("'")))) {
    return word.slice(1, -1)
  }
  return word
}
