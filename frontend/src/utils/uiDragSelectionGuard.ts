export const uiDragSelectionGuardClass = 'app-ui-dragging'
export const uiNoTextSelectSelector = '[data-ui-no-text-select]'

const textSelectionAllowSelector = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.xterm',
  '[data-terminal-surface="true"]',
  '.sftp-text-selection-surface',
  '.cm-editor',
].join(',')

function targetElement(target: EventTarget | null) {
  return target instanceof Element ? target : null
}

function isPrimaryPointer(event: PointerEvent) {
  return event.button === 0 || event.button === undefined
}

export function allowsUiTextSelection(target: EventTarget | null) {
  const element = targetElement(target)
  if (!element) return false
  return Boolean(element.closest(textSelectionAllowSelector))
}

function shouldGuardUiTextSelection(target: EventTarget | null) {
  const element = targetElement(target)
  if (!element || allowsUiTextSelection(element)) return false
  return Boolean(element.closest(uiNoTextSelectSelector))
}

function clearNativeSelection() {
  window.getSelection()?.removeAllRanges()
}

export function installUiDragSelectionGuard() {
  let guarding = false
  let finalClearTimer: number | null = null

  const cancelFinalClear = () => {
    if (finalClearTimer === null) return
    window.clearTimeout(finalClearTimer)
    finalClearTimer = null
  }

  const scheduleFinalClear = () => {
    cancelFinalClear()
    finalClearTimer = window.setTimeout(() => {
      finalClearTimer = null
      clearNativeSelection()
      document.body.classList.remove(uiDragSelectionGuardClass)
    }, 0)
  }

  const stopGuarding = () => {
    if (!guarding) return
    clearNativeSelection()
    scheduleFinalClear()
    guarding = false
  }

  const startGuarding = (event: PointerEvent) => {
    if (!isPrimaryPointer(event) || !shouldGuardUiTextSelection(event.target)) return
    cancelFinalClear()
    guarding = true
    document.body.classList.add(uiDragSelectionGuardClass)
    clearNativeSelection()
  }

  const preventSelection = (event: Event) => {
    if (!guarding || allowsUiTextSelection(event.target)) return
    event.preventDefault()
    clearNativeSelection()
  }

  const clearSelectionChange = () => {
    if (guarding) clearNativeSelection()
  }

  window.addEventListener('pointerdown', startGuarding, true)
  window.addEventListener('pointerup', stopGuarding, true)
  window.addEventListener('pointercancel', stopGuarding, true)
  window.addEventListener('blur', stopGuarding, true)
  document.addEventListener('selectstart', preventSelection, true)
  document.addEventListener('selectionchange', clearSelectionChange, true)

  return () => {
    window.removeEventListener('pointerdown', startGuarding, true)
    window.removeEventListener('pointerup', stopGuarding, true)
    window.removeEventListener('pointercancel', stopGuarding, true)
    window.removeEventListener('blur', stopGuarding, true)
    document.removeEventListener('selectstart', preventSelection, true)
    document.removeEventListener('selectionchange', clearSelectionChange, true)
    cancelFinalClear()
    guarding = false
    document.body.classList.remove(uiDragSelectionGuardClass)
  }
}
