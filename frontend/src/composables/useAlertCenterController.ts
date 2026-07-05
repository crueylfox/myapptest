import { ref } from 'vue'
import type { AlertEvent } from '../types'

export type AlertCenterViewIntent =
  | { type: 'open-monitor-detail'; eventID: string; serverID: number }
  | { type: 'none'; eventID: string }

export function useAlertCenterController() {
  const isOpen = ref(false)

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function closeFromOutside() {
    close()
  }

  function closeFromEscape() {
    close()
  }

  function ignoreInsideInteraction() {
    return isOpen.value
  }

  function viewAlert(event: AlertEvent): AlertCenterViewIntent {
    if (event.serverID <= 0) {
      close()
      return { type: 'none', eventID: event.eventID }
    }
    return {
      type: 'open-monitor-detail',
      eventID: event.eventID,
      serverID: event.serverID,
    }
  }

  return {
    isOpen,
    open,
    close,
    closeFromOutside,
    closeFromEscape,
    ignoreInsideInteraction,
    viewAlert,
  }
}
