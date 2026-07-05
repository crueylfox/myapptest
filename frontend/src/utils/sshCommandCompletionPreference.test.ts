// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getSshCommandCompletionMaxSuggestions,
  getSshCommandCompletionPreferences,
  getSshCommandCompletionTriggerChars,
  isSshCommandCompletionDescriptionVisible,
  isSshCommandCompletionEnabled,
  setSshCommandCompletionMaxSuggestions,
  setSshCommandCompletionShowDescriptions,
  setSshCommandCompletionTriggerChars,
} from './sshCommandCompletionPreference'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ssh command completion preferences', () => {
  it('uses beta22 defaults for SSH/Linux completion only settings', () => {
    expect(isSshCommandCompletionEnabled()).toBe(true)
    expect(isSshCommandCompletionDescriptionVisible()).toBe(true)
    expect(getSshCommandCompletionMaxSuggestions()).toBe(12)
    expect(getSshCommandCompletionTriggerChars()).toBe(2)
    expect(getSshCommandCompletionPreferences()).toMatchObject({
      enabled: true,
      showDescriptions: true,
      maxSuggestions: 12,
      triggerChars: 2,
    })
  })

  it('persists display and numeric settings with bounds', () => {
    setSshCommandCompletionShowDescriptions(false)
    setSshCommandCompletionMaxSuggestions(99)
    setSshCommandCompletionTriggerChars(0)

    expect(isSshCommandCompletionDescriptionVisible()).toBe(false)
    expect(getSshCommandCompletionMaxSuggestions()).toBe(20)
    expect(getSshCommandCompletionTriggerChars()).toBe(1)

    setSshCommandCompletionMaxSuggestions(4)
    setSshCommandCompletionTriggerChars(8)
    expect(getSshCommandCompletionMaxSuggestions()).toBe(5)
    expect(getSshCommandCompletionTriggerChars()).toBe(4)
  })

  it('emits a shared preference event when beta22 settings change', () => {
    const listener = vi.fn()
    window.addEventListener('serverpilot:ssh-command-completion-preference', listener)

    setSshCommandCompletionShowDescriptions(false)
    setSshCommandCompletionMaxSuggestions(16)
    setSshCommandCompletionTriggerChars(3)

    expect(listener).toHaveBeenCalledTimes(3)
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({
      detail: expect.objectContaining({ triggerChars: 3 }),
    })
    window.removeEventListener('serverpilot:ssh-command-completion-preference', listener)
  })
})
