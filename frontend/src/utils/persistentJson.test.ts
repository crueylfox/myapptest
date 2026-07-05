import { describe, expect, it, vi } from 'vitest'
import {
  removePersistentJson,
  safeReadJson,
  safeWriteJson,
  type PersistentJsonStorage,
} from './persistentJson'

function memoryStorage(initial: Record<string, string> = {}): PersistentJsonStorage & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
    removeItem: (key: string) => {
      delete values[key]
    },
  }
}

describe('persistent JSON helper', () => {
  it('reads valid JSON and falls back for missing or corrupt JSON', () => {
    const storage = memoryStorage({
      ok: JSON.stringify({ version: 1, enabled: true }),
      broken: '{bad json',
    })

    expect(safeReadJson('ok', { version: 1, enabled: false }, undefined, storage)).toEqual({ version: 1, enabled: true })
    expect(safeReadJson('missing', { fallback: true }, undefined, storage)).toEqual({ fallback: true })
    expect(safeReadJson('broken', { fallback: true }, undefined, storage)).toEqual({ fallback: true })
  })

  it('uses the fallback when the validator rejects the parsed value', () => {
    const storage = memoryStorage({ layout: JSON.stringify({ version: 2 }) })

    expect(safeReadJson('layout', { version: 1 }, (value): value is { version: 1 } =>
      typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1,
    storage)).toEqual({ version: 1 })
  })

  it('returns false for write failures without logging stored values', () => {
    const storage: PersistentJsonStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('quota') },
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const value = { marker: 'DO_NOT_LOG_VALUE_CONTENTS' }

    expect(safeWriteJson('key', value, storage)).toBe(false)
    expect(removePersistentJson('key', storage)).toBe(false)
    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})
