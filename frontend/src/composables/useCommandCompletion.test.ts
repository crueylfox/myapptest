import { describe, expect, it } from 'vitest'
import type { CommandFavorite, CommandHistoryEntry } from '../types'
import {
  buildCommandCompletionSuggestions,
  completionInsertText,
  commandCompletionToken,
  commandCompletionTriggerLength,
  commandLooksSensitive,
} from './useCommandCompletion'
import {
  builtinLinuxCommandCompletions,
  commonLinuxCommandCompletions,
} from '../data/linuxCommandCompletions'

function history(command: string, index = 0): CommandHistoryEntry {
  return {
    id: `history-${index}`,
    serverId: 7,
    serverName: 'server',
    sessionId: 'ssh-1',
    command,
    preview: command,
    isMultiline: false,
    commandHash: `hash-${index}`,
    source: 'terminal',
    sourceLabel: 'Terminal',
    executedAt: `2026-07-04T10:00:0${index}Z`,
    targetServerIds: [],
    targetCount: 0,
    batchSubmissionId: '',
  }
}

function favorite(command: string, index = 0): CommandFavorite {
  return {
    id: `favorite-${index}`,
    title: command,
    command,
    description: 'favorite command',
    scope: 'server',
    serverId: 7,
    groupId: 3,
    tags: [],
    sortOrder: index,
    useCount: 3 - index,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
  }
}

describe('command completion model', () => {
  it('orders current server history before favorites, common commands, and built-in Linux commands', () => {
    const suggestions = buildCommandCompletionSuggestions({
      prefix: 'do',
      history: [history('docker compose ps')],
      favorites: [favorite('docker logs api')],
      commonCommands: [{ command: 'docker ps', description: 'List containers' }],
      builtinCommands: [{ command: 'docker', description: 'Docker CLI' }],
      limit: 8,
    })

    expect(suggestions.map((item) => `${item.source}:${item.command}`)).toEqual([
      'history:docker compose ps',
      'favorite:docker logs api',
      'common:docker ps',
      'builtin:docker',
    ])
  })

  it('filters sensitive commands from every source before showing suggestions', () => {
    const suggestions = buildCommandCompletionSuggestions({
      prefix: 'e',
      history: [history('export TOKEN=secret-value'), history('echo ready')],
      favorites: [favorite('sshpass -p secret ssh root@example.invalid')],
      commonCommands: [{ command: 'export APP_ENV=prod', description: 'Safe export' }],
      builtinCommands: [{ command: 'exit', description: 'Exit shell' }],
      limit: 8,
    })

    expect(suggestions.map((item) => item.command)).toEqual(['echo ready', 'export APP_ENV=prod', 'exit'])
    expect(commandLooksSensitive('mysql -psecret')).toBe(true)
    expect(commandLooksSensitive('private key upload')).toBe(true)
  })

  it('builds insert text that replaces only the current token prefix', () => {
    expect(commandCompletionToken('do')).toEqual({ head: '', value: 'do' })
    expect(commandCompletionToken('sudo do')).toEqual({ head: 'sudo ', value: 'do' })
    expect(commandCompletionTriggerLength('do')).toBe(2)
    expect(commandCompletionTriggerLength('docker c')).toBe(8)
    expect(commandCompletionTriggerLength('docker ')).toBe(0)
    expect(completionInsertText('do', 'docker compose ps')).toBe('cker compose ps')
    expect(completionInsertText('sudo do', 'sudo docker ps')).toBe('cker ps')
    expect(completionInsertText('sudo do', 'docker ps')).toBe('cker ps')
  })

  it('offers richer sys completions while respecting the 12 item cap', () => {
    const suggestions = buildCommandCompletionSuggestions({
      prefix: 'sys',
      history: [],
      favorites: [],
      commonCommands: commonLinuxCommandCompletions,
      builtinCommands: builtinLinuxCommandCompletions,
      limit: 12,
    })

    expect(suggestions.length).toBeGreaterThan(2)
    expect(suggestions.length).toBeLessThanOrEqual(12)
    expect(suggestions.map((item) => item.command)).toEqual(expect.arrayContaining([
      'systemctl',
      'systemctl status',
      'systemctl restart',
      'systemctl enable',
      'systemctl list-units',
      'sysctl',
      'sysctl -a',
      'systemd-analyze',
    ]))
  })

  it('includes descriptions for built-in command and subcommand suggestions', () => {
    const suggestions = buildCommandCompletionSuggestions({
      prefix: 'systemctl st',
      history: [],
      favorites: [],
      commonCommands: commonLinuxCommandCompletions,
      builtinCommands: builtinLinuxCommandCompletions,
      limit: 12,
    })

    const status = suggestions.find((item) => item.command === 'systemctl status')
    expect(status).toMatchObject({
      source: 'builtin',
      kind: 'argument',
      description: '查看 systemd 服务状态',
    })
  })

  it('offers static subcommand and argument completions for journalctl and docker compose', () => {
    const journalSuggestions = buildCommandCompletionSuggestions({
      prefix: 'journalctl -',
      history: [],
      favorites: [],
      commonCommands: commonLinuxCommandCompletions,
      builtinCommands: builtinLinuxCommandCompletions,
      limit: 12,
    }).map((item) => item.command)
    expect(journalSuggestions).toEqual(expect.arrayContaining([
      'journalctl -xe',
      'journalctl -u',
      'journalctl --since',
      'journalctl --no-pager',
    ]))

    const composeSuggestions = buildCommandCompletionSuggestions({
      prefix: 'docker c',
      history: [],
      favorites: [],
      commonCommands: commonLinuxCommandCompletions,
      builtinCommands: builtinLinuxCommandCompletions,
      limit: 12,
    }).map((item) => item.command)
    expect(composeSuggestions).toEqual(expect.arrayContaining([
      'docker compose',
      'docker compose ps',
      'docker compose logs',
      'docker compose up',
      'docker compose down',
      'docker compose restart',
      'docker compose pull',
    ]))
  })

  it('ranks history prefix matches before history fuzzy matches and other sources', () => {
    const suggestions = buildCommandCompletionSuggestions({
      prefix: 'ds',
      history: [
        history('docker stats', 0),
        history('ds status', 1),
      ],
      favorites: [favorite('ds favorite')],
      commonCommands: [{ command: 'ds common', description: 'common command' }],
      builtinCommands: [{ command: 'ds builtin', description: 'built-in command' }],
      limit: 8,
    })

    expect(suggestions.map((item) => `${item.source}:${item.command}`)).toEqual([
      'history:ds status',
      'history:docker stats',
      'favorite:ds favorite',
      'common:ds common',
      'builtin:ds builtin',
    ])
  })
})
