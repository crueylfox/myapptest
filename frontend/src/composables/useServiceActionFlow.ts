import { ref, type ComputedRef, type Ref } from 'vue'
import type { ServiceManagerCapability, SystemServiceSummary } from '../types'
import {
  actionConfirmMessage,
  actionConfirmText,
  actionDialogTitle,
  actionDisabled as isActionDisabled,
  actionDoneLabel,
  actionPendingLabel as serviceActionPendingLabel,
  serviceLabel,
  type ServiceAction,
} from './serviceManagerModel'

type NotifyKind = 'success' | 'error' | 'info'

export interface ServiceActionConfirmOptions {
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

export interface UseServiceActionFlowOptions {
  selectedServerID: Ref<number>
  selectedService: ComputedRef<SystemServiceSummary | null> | Ref<SystemServiceSummary | null>
  capability: ComputedRef<ServiceManagerCapability | null> | Ref<ServiceManagerCapability | null>
  canManage: ComputedRef<boolean> | Ref<boolean>
  loading: Ref<boolean>
  confirm: (options: ServiceActionConfirmOptions) => Promise<boolean>
  notify: (message: string, type: NotifyKind) => void
  actions: Record<ServiceAction, (serverID: number, unitName: string, serviceID: string) => Promise<unknown>>
}

export function useServiceActionFlow(options: UseServiceActionFlowOptions) {
  const actionBusy = ref<ServiceAction | null>(null)

  function actionDisabled(action: ServiceAction) {
    return isActionDisabled(action, {
      service: options.selectedService.value,
      capability: options.capability.value,
      canManage: options.canManage.value,
      busyAction: actionBusy.value,
      loading: options.loading.value,
    })
  }

  function actionPendingLabel(action: ServiceAction) {
    return serviceActionPendingLabel(action, actionBusy.value)
  }

  async function runServiceAction(action: ServiceAction) {
    const service = options.selectedService.value
    const serverID = options.selectedServerID.value
    if (!service || !serverID || actionBusy.value || actionDisabled(action)) return
    const confirmed = await options.confirm({
      title: actionDialogTitle(action),
      message: actionConfirmMessage(action, service),
      confirmText: actionConfirmText(action),
      cancelText: '取消',
      danger: action === 'stop' || action === 'restart' || action === 'disable' || service.critical,
    })
    if (!confirmed) return
    actionBusy.value = action
    try {
      await options.actions[action](serverID, service.unitName, service.serviceID)
      options.notify(`${actionDoneLabel(action)}「${serviceLabel(service)}」完成。`, 'success')
    } catch (reason) {
      options.notify(errorMessage(reason, `${actionDoneLabel(action)}失败。`), 'error')
    } finally {
      actionBusy.value = null
    }
  }

  return {
    actionBusy,
    actionDisabled,
    actionPendingLabel,
    runServiceAction,
  }
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

export type { ServiceAction }
