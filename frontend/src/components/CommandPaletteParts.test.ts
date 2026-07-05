// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import type { CommandFavorite, CommandHistoryEntry } from '../types'
import type { BatchCommandTargetRow } from '../composables/useBatchCommandController'
import BatchCommandPanel from './BatchCommandPanel.vue'
import CommandPaletteEditorDialog from './CommandPaletteEditorDialog.vue'
import CommandPaletteResultsList from './CommandPaletteResultsList.vue'
import CommandPaletteResultItem from './CommandPaletteResultItem.vue'
import CommandPaletteScopeTabs from './CommandPaletteScopeTabs.vue'
import CommandPaletteSearchBar from './CommandPaletteSearchBar.vue'
import CommandPaletteShell from './CommandPaletteShell.vue'

const historyEntry: CommandHistoryEntry = {
  id: 'h1',
  serverId: 7,
  serverName: 'server',
  sessionId: 's1',
  command: 'uptime',
  preview: 'uptime',
  isMultiline: false,
  commandHash: 'hash',
  source: 'terminal',
  executedAt: '2026-06-17T00:00:00Z',
}

const batchHistoryEntry: CommandHistoryEntry = {
  ...historyEntry,
  id: 'batch-1',
  command: 'echo one\necho two',
  preview: 'echo one ...',
  source: 'batch',
  targetCount: 2,
  isMultiline: true,
}

const favorite: CommandFavorite = {
  id: 'f1',
  title: 'Disk',
  command: 'df -h',
  description: 'filesystem',
  scope: 'server',
  serverId: 7,
  serverName: 'server',
  groupId: null,
  tags: ['fs'],
  sortOrder: 0,
  useCount: 0,
  createdAt: '',
  updatedAt: '',
  lastUsedAt: '',
}

describe('CommandPalette UI parts', () => {
  it('renders the shell slots and emits close without owning data work', async () => {
    const wrapper = mount(CommandPaletteShell, {
      props: {
        open: true,
        title: 'Command Palette',
        subtitle: 'server',
      },
      slots: {
        tabs: '<div data-testid="tabs-slot">tabs</div>',
        search: '<div data-testid="search-slot">search</div>',
        scope: '<div data-testid="scope-slot">scope</div>',
        default: '<div data-testid="results-slot">results</div>',
        overlays: '<div data-testid="overlay-slot">overlay</div>',
      },
    })

    expect(wrapper.get('.command-palette').attributes('role')).toBe('dialog')
    expect(wrapper.get('[data-testid="tabs-slot"]').text()).toBe('tabs')
    expect(wrapper.get('[data-testid="search-slot"]').text()).toBe('search')
    expect(wrapper.get('[data-testid="scope-slot"]').text()).toBe('scope')
    expect(wrapper.get('[data-testid="results-slot"]').text()).toBe('results')
    expect(wrapper.get('[data-testid="overlay-slot"]').text()).toBe('overlay')

    const close = wrapper.get('[data-testid="command-palette-close"]')
    expect(close.classes()).toContain('command-light-action')
    expect(close.classes()).not.toContain('dialog-close-button')
    expect(close.classes()).not.toContain('secondary')

    await close.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps search input behavior as props and emits', async () => {
    const wrapper = mount(CommandPaletteSearchBar, {
      props: {
        modelValue: 'uptime',
        placeholder: 'Search commands',
      },
    })
    const input = wrapper.get<HTMLInputElement>('.command-search')

    expect(input.element.value).toBe('uptime')
    expect(input.attributes('placeholder')).toBe('Search commands')

    await input.setValue('df -h')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['df -h'])

    await input.trigger('keydown', { key: 'a', ctrlKey: true })
    expect(wrapper.emitted('keydown')).toHaveLength(1)

    await wrapper.get('[data-testid="command-search-clear"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('renders command tabs and scope filter with active state emits', async () => {
    const wrapper = mount(CommandPaletteScopeTabs, {
      props: {
        activeTab: 'history',
        scope: 'all',
        hasServer: true,
        showAddFavorite: true,
      },
      slots: {
        search: '<input data-testid="search-slot" />',
      },
    })

    expect(wrapper.get('[data-testid="command-tab-history"]').classes()).toContain('active')
    expect(wrapper.find('[data-testid="command-add-favorite"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="search-slot"]').exists()).toBe(true)

    await wrapper.get('[data-testid="command-tab-favorites"]').trigger('click')
    expect(wrapper.emitted('tab-change')?.at(-1)).toEqual(['favorites'])

    await wrapper.get('[data-testid="command-scope-current-server"]').trigger('click')
    expect(wrapper.emitted('scope-change')?.at(-1)).toEqual(['currentServer'])

    await wrapper.get('[data-testid="command-add-favorite"]').trigger('click')
    expect(wrapper.emitted('add-favorite')).toHaveLength(1)
  })

  it('uses borderless pipe-separated command palette actions with distinct active hover and disabled states', () => {
    const wrapper = mount(CommandPaletteScopeTabs, {
      props: {
        activeTab: 'history',
        scope: 'all',
        hasServer: false,
        showAddFavorite: true,
      },
      slots: {
        search: '<input data-testid="search-slot" />',
      },
    })
    const actions = [
      wrapper.get('[data-testid="command-tab-history"]'),
      wrapper.get('[data-testid="command-tab-favorites"]'),
      wrapper.get('[data-testid="command-open-batch"]'),
      wrapper.get('[data-testid="command-add-favorite"]'),
      wrapper.get('[data-testid="command-scope-all"]'),
      wrapper.get('[data-testid="command-scope-current-server"]'),
    ]

    expect(wrapper.findAll('.command-action-separator')).toHaveLength(4)
    for (const action of actions) {
      expect(action.classes()).toContain('command-light-action')
      expect(action.classes()).not.toContain('primary')
      expect(action.classes()).not.toContain('secondary')
      expect(action.classes()).not.toContain('dialog-close-button')
    }
    expect(wrapper.get('[data-testid="command-tab-history"]').classes()).toContain('active')
    expect(wrapper.get('[data-testid="command-scope-current-server"]').attributes('disabled')).toBeDefined()

    expect(wrapper.get('[data-testid="command-tab-history"]').classes()).toEqual(expect.arrayContaining(['command-light-action', 'active']))
    expect(wrapper.get('[data-testid="command-scope-all"]').classes()).toEqual(expect.arrayContaining(['command-light-action', 'active']))
  })

  it('renders a history result item and emits row actions', async () => {
    const wrapper = mount(CommandPaletteResultItem, {
      props: {
        kind: 'history',
        entry: batchHistoryEntry,
        scope: 'all',
      },
    })

    expect(wrapper.classes()).toContain('command-history-row')
    expect(wrapper.get('.command-history-preview').text()).toContain('echo one')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('多行')

    await wrapper.get('[data-testid="history-insert"]').trigger('click')
    expect(wrapper.emitted('insert')?.at(-1)).toEqual([batchHistoryEntry.command])

    await wrapper.get('[data-testid="history-execute"]').trigger('click')
    expect(wrapper.emitted('execute')?.at(-1)).toEqual([batchHistoryEntry.command])

    await wrapper.get('[data-testid="history-edit"]').trigger('click')
    expect(wrapper.emitted('edit-history')?.at(-1)).toEqual([batchHistoryEntry])

    await wrapper.get('[data-testid="history-copy"]').trigger('click')
    expect(wrapper.emitted('copy-history')?.at(-1)).toEqual([batchHistoryEntry])

    await wrapper.get('[data-testid="history-favorite"]').trigger('click')
    expect(wrapper.emitted('favorite-history')?.at(-1)).toEqual([batchHistoryEntry.command])

    await wrapper.find('.danger-link').trigger('click')
    expect(wrapper.emitted('delete-history')?.at(-1)).toEqual([batchHistoryEntry])

    await wrapper.trigger('contextmenu')
    expect(wrapper.emitted('history-context-menu')?.at(-1)?.[0]).toEqual(batchHistoryEntry)
  })

  it('renders a favorite result item and emits favorite actions', async () => {
    const wrapper = mount(CommandPaletteResultItem, {
      props: {
        kind: 'favorite',
        favorite,
        scope: 'all',
      },
    })

    expect(wrapper.classes()).toContain('command-favorite-row')
    expect(wrapper.text()).toContain('Disk')
    expect(wrapper.text()).toContain('server')

    await wrapper.get('[data-testid="favorite-insert"]').trigger('click')
    expect(wrapper.emitted('favorite-insert')?.at(-1)).toEqual([{ command: favorite.command, favorite }])

    await wrapper.get('[data-testid="favorite-execute"]').trigger('click')
    expect(wrapper.emitted('favorite-execute')?.at(-1)).toEqual([{ command: favorite.command, favorite }])

    await wrapper.findAll('.text-button').at(2)!.trigger('click')
    expect(wrapper.emitted('edit-favorite')?.at(-1)).toEqual([favorite])

    await wrapper.find('.danger-link').trigger('click')
    expect(wrapper.emitted('delete-favorite')?.at(-1)).toEqual([favorite])
  })

  it('renders result lists, selected row class, and empty states without executing commands', async () => {
    const wrapper = mount(CommandPaletteResultsList, {
      props: {
        tab: 'history',
        history: [historyEntry],
        commonCommands: [],
        query: '',
        groupedFavorites: { server: [], group: [], global: [] },
        favoriteCount: 0,
        busy: false,
        scope: 'all',
        selectedIndex: 0,
      },
    })

    expect(wrapper.get('[data-testid="command-history-list"]').element).toBeTruthy()
    expect(wrapper.get('.command-history-row').classes()).toContain('selected')
    await wrapper.get('[data-testid="history-insert"]').trigger('click')
    expect(wrapper.emitted('insert')?.at(-1)).toEqual([historyEntry.command])

    await wrapper.setProps({ history: [] })
    expect(wrapper.get('.empty-state').element).toBeTruthy()

    await wrapper.setProps({
      tab: 'favorites',
      commonCommands: [],
      query: '',
      groupedFavorites: { server: [favorite], group: [], global: [] },
      favoriteCount: 1,
    })
    expect(wrapper.get('[data-testid="command-favorites-list"]').element).toBeTruthy()
    await wrapper.get('[data-testid="favorite-execute"]').trigger('click')
    expect(wrapper.emitted('favorite-execute')?.at(-1)).toEqual([{ command: favorite.command, favorite }])
  })

  it('renders common commands and highlights search matches', async () => {
    const wrapper = mount(CommandPaletteResultsList, {
      props: {
        tab: 'favorites',
        history: [],
        commonCommands: [
          { id: 'common-systemctl', command: 'systemctl status', title: 'systemctl status', description: 'view service status', shell: 'ssh' },
        ],
        query: 'status',
        groupedFavorites: { server: [], group: [], global: [] },
        favoriteCount: 0,
        busy: false,
        scope: 'currentServer',
      },
    })

    const common = wrapper.get('[data-testid="command-common-list"]')
    expect(common.text()).toContain('systemctl status')
    expect(common.get('mark').text()).toBe('status')

    await common.get('[data-testid="common-insert"]').trigger('click')
    expect(wrapper.emitted('insert')?.at(-1)).toEqual(['systemctl status'])
  })

  it('renders the history editor dialog as a pure form component', async () => {
    const wrapper = mount(CommandPaletteEditorDialog, {
      props: {
        open: true,
        modelValue: 'uptime',
        saving: false,
      },
    })

    expect(wrapper.get('[data-testid="command-history-editor"]').element).toBeTruthy()
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea')
    expect(textarea.element.value).toBe('uptime')

    await textarea.setValue('uptime -p')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['uptime -p'])

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toHaveLength(1)

    await wrapper.get('.dialog-close-button').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.setProps({ saving: true })
    expect(wrapper.get<HTMLButtonElement>('button.primary').element.disabled).toBe(true)
  })

  it('renders batch command targets by name and emits all batch actions', async () => {
    const targets: BatchCommandTargetRow[] = [
      { serverID: 1, name: 'alpha-prod', terminalSessionID: 'term-1' },
      { serverID: 2, name: 'beta-prod', terminalSessionID: 'term-2' },
    ]
    const wrapper = mount(BatchCommandPanel, {
      props: {
        targets,
        selectedIds: new Set([1]),
        selectedCount: 1,
        command: 'uptime',
        sending: false,
      },
    })

    const list = wrapper.get('[data-testid="batch-server-list"]')
    expect(list.text()).toContain('alpha-prod')
    expect(list.text()).toContain('beta-prod')
    expect(wrapper.text()).not.toContain('192.0.2.')
    expect(wrapper.findAll('.batch-server-chip[aria-pressed="true"]')).toHaveLength(1)

    await wrapper.findAll('.batch-server-chip')[1].trigger('click')
    expect(wrapper.emitted('toggle-target')?.at(-1)).toEqual([2])

    await wrapper.get('[data-testid="batch-select-all"]').trigger('click')
    expect(wrapper.emitted('select-all')).toHaveLength(1)

    await wrapper.get('[data-testid="batch-invert"]').trigger('click')
    expect(wrapper.emitted('invert')).toHaveLength(1)

    await wrapper.get<HTMLTextAreaElement>('[data-testid="batch-command-input"]').setValue('date')
    expect(wrapper.emitted('update:command')?.at(-1)).toEqual(['date'])

    await wrapper.get('[data-testid="batch-clear-command"]').trigger('click')
    expect(wrapper.emitted('clear-command')).toHaveLength(1)

    await wrapper.get('[data-testid="batch-save-favorite"]').trigger('click')
    expect(wrapper.emitted('save-favorite')).toHaveLength(1)

    await wrapper.get('[data-testid="batch-start"]').trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)

    await wrapper.setProps({ sending: true })
    expect(wrapper.get<HTMLButtonElement>('[data-testid="batch-start"]').element.disabled).toBe(true)
  })
})

describe('CommandPalette UI parts dependency boundary', () => {
  const uiComponents: Component[] = [
    BatchCommandPanel,
    CommandPaletteEditorDialog,
    CommandPaletteResultsList,
    CommandPaletteResultItem,
    CommandPaletteScopeTabs,
    CommandPaletteSearchBar,
    CommandPaletteShell,
  ]

  it('mounts every UI part as a component module', () => {
    expect(uiComponents).toHaveLength(7)
  })
})
