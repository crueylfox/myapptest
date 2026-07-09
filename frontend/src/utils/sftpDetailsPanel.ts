export const SFTP_DETAILS_WIDTH_KEY = 'hostdeck.sftpDetailsWidth'
export const SFTP_DETAILS_COLLAPSED_KEY = 'hostdeck.sftpDetailsCollapsed'
export const SFTP_DETAILS_DEFAULT_WIDTH = 280
export const SFTP_DETAILS_MIN_WIDTH = 240
export const SFTP_DETAILS_MAX_WIDTH = 320
export const SFTP_DETAILS_DRAG_EDGE_OFFSET = 24

export type SftpDetailsPanelStorage = Pick<Storage, 'getItem' | 'setItem'>

export function clampSftpDetailsWidth(value: number) {
  if (!Number.isFinite(value) || value < SFTP_DETAILS_MIN_WIDTH) return SFTP_DETAILS_DEFAULT_WIDTH
  return Math.min(Math.max(value, SFTP_DETAILS_MIN_WIDTH), SFTP_DETAILS_MAX_WIDTH)
}

export function loadSftpDetailsWidth(storage: SftpDetailsPanelStorage = localStorage) {
  const stored = storage.getItem(SFTP_DETAILS_WIDTH_KEY)
  return clampSftpDetailsWidth(stored === null ? Number.NaN : Number(stored))
}

export function persistSftpDetailsWidth(width: number, storage: SftpDetailsPanelStorage = localStorage) {
  storage.setItem(SFTP_DETAILS_WIDTH_KEY, String(Math.round(clampSftpDetailsWidth(width))))
}

export function calculateSftpDetailsDragWidth(
  viewportWidth: number,
  clientX: number,
  edgeOffset = SFTP_DETAILS_DRAG_EDGE_OFFSET,
) {
  return clampSftpDetailsWidth(viewportWidth - clientX - edgeOffset)
}

export function loadSftpDetailsCollapsed(storage: SftpDetailsPanelStorage = localStorage) {
  return storage.getItem(SFTP_DETAILS_COLLAPSED_KEY) === 'true'
}

export function persistSftpDetailsCollapsed(collapsed: boolean, storage: SftpDetailsPanelStorage = localStorage) {
  storage.setItem(SFTP_DETAILS_COLLAPSED_KEY, String(collapsed))
}
