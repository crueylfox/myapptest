import { ref } from 'vue'
import type { ToastMessage } from '../types'

export function useToast() {
  const toast = ref<ToastMessage | null>(null)
  let timer: number | null = null
  let nextID = 0

  function close() {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    toast.value = null
  }

  function show(message: string, type: ToastMessage['type'], detail = '', code = '') {
    if (timer !== null) window.clearTimeout(timer)
    toast.value = {
      id: ++nextID,
      message,
      type,
      detail: detail || undefined,
      code: code || undefined,
    }
    const duration = type === 'success' ? 2000 : type === 'info' ? 3500 : 8000
    timer = window.setTimeout(() => {
      toast.value = null
      timer = null
    }, duration)
  }

  return { toast, show, close, dispose: close }
}
