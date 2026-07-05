import { describe, expect, it, vi } from 'vitest'
import {
  calculateSftpDetailsDragWidth,
  clampSftpDetailsWidth,
  loadSftpDetailsCollapsed,
  loadSftpDetailsWidth,
  persistSftpDetailsCollapsed,
  persistSftpDetailsWidth,
  SFTP_DETAILS_COLLAPSED_KEY,
  SFTP_DETAILS_DEFAULT_WIDTH,
  SFTP_DETAILS_WIDTH_KEY,
} from './sftpDetailsPanel'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial }
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value
    }),
  }
}

describe('sftp details panel helpers', () => {
  it('keeps the existing details width clamp semantics', () => {
    expect(clampSftpDetailsWidth(Number.NaN)).toBe(SFTP_DETAILS_DEFAULT_WIDTH)
    expect(clampSftpDetailsWidth(200)).toBe(SFTP_DETAILS_DEFAULT_WIDTH)
    expect(clampSftpDetailsWidth(240)).toBe(240)
    expect(clampSftpDetailsWidth(500)).toBe(320)
  })

  it('loads stored details width through the same clamp rules', () => {
    expect(loadSftpDetailsWidth(memoryStorage())).toBe(SFTP_DETAILS_DEFAULT_WIDTH)
    expect(loadSftpDetailsWidth(memoryStorage({ [SFTP_DETAILS_WIDTH_KEY]: '276' }))).toBe(276)
    expect(loadSftpDetailsWidth(memoryStorage({ [SFTP_DETAILS_WIDTH_KEY]: '10' }))).toBe(SFTP_DETAILS_DEFAULT_WIDTH)
    expect(loadSftpDetailsWidth(memoryStorage({ [SFTP_DETAILS_WIDTH_KEY]: 'bad' }))).toBe(SFTP_DETAILS_DEFAULT_WIDTH)
  })

  it('persists rounded clamped details width', () => {
    const storage = memoryStorage()

    persistSftpDetailsWidth(276.6, storage)
    expect(storage.setItem).toHaveBeenCalledWith(SFTP_DETAILS_WIDTH_KEY, '277')

    persistSftpDetailsWidth(500, storage)
    expect(storage.setItem).toHaveBeenLastCalledWith(SFTP_DETAILS_WIDTH_KEY, '320')
  })

  it('calculates details width from drag position before clamping', () => {
    expect(calculateSftpDetailsDragWidth(1000, 700)).toBe(276)
    expect(calculateSftpDetailsDragWidth(1000, 900)).toBe(SFTP_DETAILS_DEFAULT_WIDTH)
    expect(calculateSftpDetailsDragWidth(1000, 100, 24)).toBe(320)
  })

  it('loads and persists collapsed state with the existing boolean string format', () => {
    expect(loadSftpDetailsCollapsed(memoryStorage())).toBe(false)
    expect(loadSftpDetailsCollapsed(memoryStorage({ [SFTP_DETAILS_COLLAPSED_KEY]: 'true' }))).toBe(true)
    expect(loadSftpDetailsCollapsed(memoryStorage({ [SFTP_DETAILS_COLLAPSED_KEY]: 'false' }))).toBe(false)

    const storage = memoryStorage()
    persistSftpDetailsCollapsed(true, storage)
    expect(storage.setItem).toHaveBeenCalledWith(SFTP_DETAILS_COLLAPSED_KEY, 'true')
    persistSftpDetailsCollapsed(false, storage)
    expect(storage.setItem).toHaveBeenLastCalledWith(SFTP_DETAILS_COLLAPSED_KEY, 'false')
  })
})
