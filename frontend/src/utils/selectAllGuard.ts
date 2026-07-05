export function shouldAllowNativeSelectAll(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const editableSelector = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '.cm-editor',
    '.cm-content',
    '.xterm',
    '.xterm-helper-textarea',
    '.terminal-view',
    '.terminal-view-host',
    '.sftp-table',
  ].join(',')
  return Boolean(target.closest(editableSelector))
}

export function preventGlobalSelectAll(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'a') return
  if (shouldAllowNativeSelectAll(event.target)) return
  event.preventDefault()
}
