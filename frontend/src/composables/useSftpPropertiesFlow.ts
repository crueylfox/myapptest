import { ref } from 'vue'
import type { SFTPItemProperties } from '../types'
import type { SftpDisplayEntry } from '../utils/sftpDisplayEntries'

export type SftpPropertiesContext = {
  connectionId: number | null
  contextId?: string | null
  terminalSessionId?: string
  generation?: number
  online?: boolean
  canBrowse?: boolean
}

export type SftpGetPropertiesRequest = {
  connectionId: number
  path: string
  contextId?: string
  terminalSessionId?: string
  generation: number
  requestId: string
}

export type SftpUpdatePermissionsRequest = {
  connectionId: number
  path: string
  mode: number
  preserveSpecialBits: boolean
  contextId?: string
  terminalSessionId?: string
  generation: number
  requestId: string
}

export type UseSftpPropertiesFlowOptions = {
  getContext: () => SftpPropertiesContext
  getProperties: (request: SftpGetPropertiesRequest) => Promise<SFTPItemProperties>
  updatePermissions: (request: SftpUpdatePermissionsRequest) => Promise<SFTPItemProperties>
  notify?: (message: string, type: 'success' | 'error' | 'info') => void
  upsertEntry?: (entry: SftpDisplayEntry) => void
  formatError?: (reason: unknown, fallback: string) => string
  createRequestId?: () => string
}

export function useSftpPropertiesFlow(options: UseSftpPropertiesFlowOptions) {
  const propertiesOpen = ref(false)
  const propertiesBusy = ref(false)
  const propertiesError = ref('')
  const propertiesItem = ref<SFTPItemProperties | null>(null)
  const latestPropertiesRequestId = ref('')

  async function openProperties(entry: SftpDisplayEntry) {
    const current = options.getContext()
    if (!current.connectionId || !current.online || !current.canBrowse || entry.syntheticParent) return
    const requestId = nextRequestId()
    latestPropertiesRequestId.value = requestId
    propertiesBusy.value = true
    propertiesError.value = ''
    try {
      const result = await options.getProperties({
        connectionId: current.connectionId,
        path: entry.path,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
        generation: current.generation || 0,
        requestId,
      })
      if (requestId !== latestPropertiesRequestId.value) return
      propertiesItem.value = result
      if (result.entry) options.upsertEntry?.(result.entry)
      propertiesOpen.value = true
    } catch (reason) {
      if (requestId === latestPropertiesRequestId.value) {
        options.notify?.(formatError(reason, '读取远程属性失败'), 'error')
      }
    } finally {
      if (requestId === latestPropertiesRequestId.value) propertiesBusy.value = false
    }
  }

  async function applyRemotePermissions(mode: number) {
    const current = options.getContext()
    if (!current.connectionId || !propertiesItem.value || propertiesBusy.value) return
    const item = propertiesItem.value
    const requestId = nextRequestId()
    latestPropertiesRequestId.value = requestId
    propertiesBusy.value = true
    propertiesError.value = ''
    try {
      const result = await options.updatePermissions({
        connectionId: current.connectionId,
        path: item.path,
        mode,
        preserveSpecialBits: true,
        contextId: current.contextId ?? undefined,
        terminalSessionId: current.terminalSessionId,
        generation: item.generation || current.generation || 0,
        requestId,
      })
      if (requestId !== latestPropertiesRequestId.value) return
      propertiesItem.value = result
      if (result.entry) options.upsertEntry?.(result.entry)
      options.notify?.('权限已更新', 'success')
    } catch (reason) {
      if (requestId === latestPropertiesRequestId.value) {
        propertiesError.value = formatError(reason, '更新远程权限失败')
      }
    } finally {
      if (requestId === latestPropertiesRequestId.value) propertiesBusy.value = false
    }
  }

  function closeProperties() {
    latestPropertiesRequestId.value = nextRequestId()
    propertiesOpen.value = false
    propertiesBusy.value = false
    propertiesError.value = ''
    propertiesItem.value = null
  }

  function nextRequestId() {
    if (options.createRequestId) return options.createRequestId()
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `properties-${crypto.randomUUID()}`
    return `properties-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function formatError(reason: unknown, fallback: string) {
    if (options.formatError) return options.formatError(reason, fallback)
    const message = String(reason).replace(/^Error:\s*/i, '').trim()
    return message || fallback
  }

  return {
    propertiesOpen,
    propertiesBusy,
    propertiesError,
    propertiesItem,
    openProperties,
    applyRemotePermissions,
    closeProperties,
  }
}
