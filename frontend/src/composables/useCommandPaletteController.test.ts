// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  useCommandPaletteController,
  type CommandPaletteTab,
} from './useCommandPaletteController'

async function flushController() {
  await nextTick()
  await Promise.resolve()
}

describe('useCommandPaletteController', () => {
  it('opens with the requested tab and resets transient search and selection state', async () => {
    const open = ref(false)
    const initialTab = ref<CommandPaletteTab>('favorites')
    const controller = useCommandPaletteController({
      open,
      initialTab,
      serverId: ref(7),
      hasActiveTerminal: ref(true),
      initialScope: 'all',
    })

    controller.query.value = 'uptime'
    controller.selectedIndex.value = 4
    open.value = true
    await flushController()

    expect(controller.activeTab.value).toBe('favorites')
    expect(controller.query.value).toBe('')
    expect(controller.selectedIndex.value).toBe(0)

    controller.setTab('batch')
    controller.selectedIndex.value = 2
    expect(controller.activeTab.value).toBe('batch')

    open.value = false
    await flushController()
    expect(controller.selectedIndex.value).toBe(0)
  })

  it('keeps current-server scope disabled when there is no active server target', async () => {
    const serverId = ref(0)
    const open = ref(true)
    const controller = useCommandPaletteController({
      open,
      initialTab: ref<CommandPaletteTab>('history'),
      serverId,
      hasActiveTerminal: ref(true),
      initialScope: 'currentServer',
    })
    await flushController()

    expect(controller.scope.value).toBe('all')
    expect(controller.setScope('currentServer')).toBe(false)
    expect(controller.scope.value).toBe('all')

    serverId.value = 42
    expect(controller.setScope('currentServer')).toBe(true)
    expect(controller.scope.value).toBe('currentServer')
  })

  it('returns insert and execute intents only for writable active command targets', () => {
    const notify = vi.fn()
    const hasActiveTerminal = ref(true)
    const controller = useCommandPaletteController({
      open: ref(true),
      initialTab: ref<CommandPaletteTab>('history'),
      serverId: ref(7),
      hasActiveTerminal,
      initialScope: 'all',
      notify,
    })

    expect(controller.commandIntent('df -h', 'insert')).toEqual({
      enabled: true,
      action: 'insert',
      command: 'df -h',
    })
    expect(controller.commandIntent('uptime', 'execute')).toEqual({
      enabled: true,
      action: 'execute',
      command: 'uptime',
    })

    hasActiveTerminal.value = false
    expect(controller.commandIntent('whoami', 'insert')).toEqual({
      enabled: false,
      action: 'insert',
      command: 'whoami',
      reason: 'no-active-terminal',
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not write terminal input, call backend APIs, or persist command text', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = useCommandPaletteController({
      open: ref(true),
      initialTab: ref<CommandPaletteTab>('history'),
      serverId: ref(7),
      hasActiveTerminal: ref(true),
      initialScope: 'all',
    })

    controller.query.value = 'Authorization: Bearer token'
    const intent = controller.commandIntent('Authorization: Bearer token', 'execute')

    expect(intent.enabled).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
  })
})
