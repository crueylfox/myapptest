import { ref } from 'vue'
import {
  applySftpBackNavigation,
  applySftpForwardNavigation,
  recordSftpSuccessfulNavigation,
  resolveSftpNavigationKey,
  syncSftpNavigationCurrentPath,
  type SftpPathNavigationState,
} from '../utils/sftpPathState'

export type UseSftpPathNavigationOptions = {
  historyLimit?: number
}

export function useSftpPathNavigation(options: UseSftpPathNavigationOptions = {}) {
  const historyLimit = options.historyLimit
  const navigationByContextId = ref<Record<string, SftpPathNavigationState>>({})

  function activeNavigationKey(contextId: string | null | undefined, serverId: number | string | null | undefined) {
    return resolveSftpNavigationKey(contextId, serverId)
  }

  function setNavigationState(key: string, navigation: SftpPathNavigationState) {
    navigationByContextId.value = {
      ...navigationByContextId.value,
      [key]: navigation,
    }
  }

  function navigationFor(
    contextId: string | null | undefined,
    serverId: number | string | null | undefined,
    currentPath: string,
  ) {
    const key = activeNavigationKey(contextId, serverId)
    const next = syncSftpNavigationCurrentPath(navigationByContextId.value[key], currentPath || '')
    if (next !== navigationByContextId.value[key]) setNavigationState(key, next)
    return next
  }

  function recordSuccessfulNavigation(
    contextId: string | null | undefined,
    serverId: number | string | null | undefined,
    previousPath: string,
    nextPath: string,
  ) {
    const key = activeNavigationKey(contextId, serverId)
    const next = recordSftpSuccessfulNavigation(navigationByContextId.value[key], previousPath, nextPath, historyLimit)
    if (next) setNavigationState(key, next)
  }

  function applyBackNavigation(
    contextId: string | null | undefined,
    serverId: number | string | null | undefined,
    navigation: SftpPathNavigationState,
    previousPath: string,
    loadedPath: string,
  ) {
    setNavigationState(activeNavigationKey(contextId, serverId), applySftpBackNavigation(navigation, previousPath, loadedPath, historyLimit))
  }

  function applyForwardNavigation(
    contextId: string | null | undefined,
    serverId: number | string | null | undefined,
    navigation: SftpPathNavigationState,
    previousPath: string,
    loadedPath: string,
  ) {
    setNavigationState(activeNavigationKey(contextId, serverId), applySftpForwardNavigation(navigation, previousPath, loadedPath, historyLimit))
  }

  function isValidPath(path: string) {
    return !/[\0\r\n]/.test(path)
  }

  return {
    navigationByContextId,
    activeNavigationKey,
    navigationFor,
    recordSuccessfulNavigation,
    applyBackNavigation,
    applyForwardNavigation,
    isValidPath,
  }
}
