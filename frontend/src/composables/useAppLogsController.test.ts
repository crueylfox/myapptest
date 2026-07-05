// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  filterAppLogs,
  useAppLogsController,
} from './useAppLogsController'
import type { LogEntry } from '../types'

const log = (values: Partial<LogEntry>): LogEntry => ({
  time: '2026-07-01T00:00:00Z',
  level: 'info',
  message: '',
  summary: '',
  ...values,
})

describe('useAppLogsController', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('starts with the current App Logs filter defaults', () => {
    const controller = useAppLogsController()

    expect(controller.levelFilter.value).toBe('all')
    expect(controller.query.value).toBe('')
    expect(controller.refreshing.value).toBe(false)
  })

  it('filters by level using the existing App.vue semantics', () => {
    const entries = [
      log({ level: 'info', summary: 'started' }),
      log({ level: 'error', summary: 'failed' }),
    ]

    expect(filterAppLogs(entries, 'error', '')).toEqual([entries[1]])
  })

  it('searches summary message server operation error code and technical message', () => {
    const entries = [
      log({ summary: 'summary hit' }),
      log({ message: 'message hit' }),
      log({ serverName: 'server hit' }),
      log({ operation: 'operation hit' }),
      log({ errorCode: 'ERR_HIT' }),
      log({ technicalMessage: 'technical hit' }),
      log({ summary: 'other' }),
    ]

    expect(filterAppLogs(entries, 'all', 'hit')).toEqual(entries.slice(0, 6))
    expect(filterAppLogs(entries, 'all', 'err_hit')).toEqual([entries[4]])
  })

  it('refresh delegates to the injected loader and always clears busy state', async () => {
    const controller = useAppLogsController()
    const loadLogs = vi.fn(async () => undefined)

    const pending = controller.refresh(loadLogs)
    expect(controller.refreshing.value).toBe(true)
    await pending

    expect(loadLogs).toHaveBeenCalledTimes(1)
    expect(controller.refreshing.value).toBe(false)
  })

  it('clears busy state after refresh failure without swallowing the error', async () => {
    const controller = useAppLogsController()
    const error = new Error('load failed')

    await expect(controller.refresh(async () => {
      throw error
    })).rejects.toBe(error)

    expect(controller.refreshing.value).toBe(false)
  })

  it('does not persist log output, terminal output, remote content, or credentials', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = useAppLogsController()

    controller.levelFilter.value = 'error'
    controller.query.value = 'server'
    controller.filteredLogs([
      log({ message: 'terminal output placeholder' }),
      log({ message: 'remote file content placeholder' }),
    ])

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(controller)).not.toContain('password')
    expect(JSON.stringify(controller)).not.toContain('privateKey')
    expect(JSON.stringify(controller)).not.toContain('passphrase')
  })
})
