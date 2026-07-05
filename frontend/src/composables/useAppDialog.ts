import { shallowRef } from 'vue'

export type AppDialogKind = 'confirm' | 'input'
export type AppDialogResult = boolean | string | null

export interface AppDialogRequest {
  id: number
  kind: AppDialogKind
  title: string
  message?: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  confirmValue?: AppDialogResult
  secondaryText?: string
  secondaryValue?: AppDialogResult
  danger?: boolean
  hideCloseButton?: boolean
  returnFocus?: HTMLElement | null
  validate?: (value: string) => string
  submit?: (value: string) => Promise<string | void>
}

const dialog = shallowRef<AppDialogRequest | null>(null)
let sequence = 0
let resolver: ((value: AppDialogResult) => void) | null = null

function open(
  request: Omit<AppDialogRequest, 'id'>,
): Promise<AppDialogResult> {
  resolver?.(request.kind === 'confirm' ? false : null)
  return new Promise((resolve) => {
    resolver = resolve
    dialog.value = { ...request, id: ++sequence }
  })
}

export function confirmDialog(
  request: Omit<AppDialogRequest, 'id' | 'kind'>,
): Promise<boolean> {
  return open({ ...request, kind: 'confirm' }) as Promise<boolean>
}

export function inputDialog(
  request: Omit<AppDialogRequest, 'id' | 'kind'>,
): Promise<string | null> {
  return open({ ...request, kind: 'input' }) as Promise<string | null>
}

export function choiceDialog(
  request: Omit<AppDialogRequest, 'id' | 'kind'>,
): Promise<string | null> {
  return open({ ...request, kind: 'confirm' }) as Promise<string | null>
}

export function resolveAppDialog(value: AppDialogResult) {
  const resolve = resolver
  resolver = null
  dialog.value = null
  resolve?.(value)
}

export function useAppDialog() {
  return { dialog }
}
