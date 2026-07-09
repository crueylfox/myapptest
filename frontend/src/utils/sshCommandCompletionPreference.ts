export const sshCommandCompletionEnabledKey = 'hostdeck.sshCommandCompletion.enabled'
export const sshCommandCompletionShowDescriptionsKey = 'hostdeck.sshCommandCompletion.showDescriptions'
export const sshCommandCompletionMaxSuggestionsKey = 'hostdeck.sshCommandCompletion.maxSuggestions'
export const sshCommandCompletionTriggerCharsKey = 'hostdeck.sshCommandCompletion.triggerChars'
export const sshCommandCompletionPreferenceEvent = 'hostdeck:ssh-command-completion-preference'

export interface SshCommandCompletionPreferences {
  enabled: boolean
  showDescriptions: boolean
  maxSuggestions: number
  triggerChars: number
}

export function isSshCommandCompletionEnabled(storage: Storage | null = safeLocalStorage()) {
  return storage?.getItem(sshCommandCompletionEnabledKey) !== 'false'
}

export function setSshCommandCompletionEnabled(enabled: boolean, storage: Storage | null = safeLocalStorage()) {
  storage?.setItem(sshCommandCompletionEnabledKey, enabled ? 'true' : 'false')
  emitSshCommandCompletionPreference(storage)
}

export function isSshCommandCompletionDescriptionVisible(storage: Storage | null = safeLocalStorage()) {
  return storage?.getItem(sshCommandCompletionShowDescriptionsKey) !== 'false'
}

export function setSshCommandCompletionShowDescriptions(showDescriptions: boolean, storage: Storage | null = safeLocalStorage()) {
  storage?.setItem(sshCommandCompletionShowDescriptionsKey, showDescriptions ? 'true' : 'false')
  emitSshCommandCompletionPreference(storage)
}

export function getSshCommandCompletionMaxSuggestions(storage: Storage | null = safeLocalStorage()) {
  return readBoundedInteger(storage?.getItem(sshCommandCompletionMaxSuggestionsKey), 12, 5, 20)
}

export function setSshCommandCompletionMaxSuggestions(maxSuggestions: number, storage: Storage | null = safeLocalStorage()) {
  storage?.setItem(sshCommandCompletionMaxSuggestionsKey, String(readBoundedInteger(maxSuggestions, 12, 5, 20)))
  emitSshCommandCompletionPreference(storage)
}

export function getSshCommandCompletionTriggerChars(storage: Storage | null = safeLocalStorage()) {
  return readBoundedInteger(storage?.getItem(sshCommandCompletionTriggerCharsKey), 2, 1, 4)
}

export function setSshCommandCompletionTriggerChars(triggerChars: number, storage: Storage | null = safeLocalStorage()) {
  storage?.setItem(sshCommandCompletionTriggerCharsKey, String(readBoundedInteger(triggerChars, 2, 1, 4)))
  emitSshCommandCompletionPreference(storage)
}

export function getSshCommandCompletionPreferences(storage: Storage | null = safeLocalStorage()): SshCommandCompletionPreferences {
  return {
    enabled: isSshCommandCompletionEnabled(storage),
    showDescriptions: isSshCommandCompletionDescriptionVisible(storage),
    maxSuggestions: getSshCommandCompletionMaxSuggestions(storage),
    triggerChars: getSshCommandCompletionTriggerChars(storage),
  }
}

function emitSshCommandCompletionPreference(storage: Storage | null) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(sshCommandCompletionPreferenceEvent, {
      detail: getSshCommandCompletionPreferences(storage),
    }))
  }
}

function readBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function safeLocalStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
