<script setup lang="ts">
import type { CommandPaletteScope, CommandPaletteTab } from '../composables/useCommandPaletteController'
import type { CommandPanelCommonCommand } from '../data/commandPanelCommonCommands'
import type { CommandFavorite, CommandHistoryEntry } from '../types'
import CommandText from './CommandText.vue'
import CommandPaletteResultItem from './CommandPaletteResultItem.vue'

withDefaults(defineProps<{
  tab: CommandPaletteTab
  history: CommandHistoryEntry[]
  commonCommands: CommandPanelCommonCommand[]
  query: string
  groupedFavorites: Record<'global' | 'group' | 'server', CommandFavorite[]>
  favoriteCount: number
  busy: boolean
  scope: CommandPaletteScope
  selectedIndex?: number
}>(), {
  selectedIndex: -1,
})

const emit = defineEmits<{
  insert: [command: string]
  execute: [command: string]
  'edit-history': [entry: CommandHistoryEntry]
  'copy-history': [entry: CommandHistoryEntry]
  'favorite-history': [command: string]
  'delete-history': [entry: CommandHistoryEntry]
  'clear-history': []
  'history-context-menu': [entry: CommandHistoryEntry, event: MouseEvent]
  'favorite-insert': [payload: { command: string; favorite: CommandFavorite }]
  'favorite-execute': [payload: { command: string; favorite: CommandFavorite }]
  'edit-favorite': [favorite: CommandFavorite]
  'delete-favorite': [favorite: CommandFavorite]
}>()

function scopeTitle(scope: 'global' | 'group' | 'server', currentScope: CommandPaletteScope) {
  if (scope === 'server') return currentScope === 'all' ? '服务器收藏' : '当前服务器收藏'
  if (scope === 'group') return currentScope === 'all' ? '分组收藏' : '当前分组收藏'
  return '全局收藏'
}
</script>

<template>
  <div v-if="tab === 'history'" class="command-list" data-testid="command-history-list">
    <div class="command-list-toolbar">
      <span>{{ busy ? '加载中…' : `历史记录 ${history.length}` }}</span>
      <button type="button" class="text-button" :disabled="scope === 'all' || !history.length" @click="emit('clear-history')">清空当前服务器历史</button>
    </div>
    <CommandPaletteResultItem
      v-for="(entry, index) in history"
      :key="entry.id"
      kind="history"
      :entry="entry"
      :scope="scope"
      :selected="index === selectedIndex"
      :query="query"
      @insert="emit('insert', $event)"
      @execute="emit('execute', $event)"
      @edit-history="emit('edit-history', $event)"
      @copy-history="emit('copy-history', $event)"
      @favorite-history="emit('favorite-history', $event)"
      @delete-history="emit('delete-history', $event)"
      @history-context-menu="(entry, event) => emit('history-context-menu', entry, event)"
    />
    <p v-if="!history.length" class="empty-state">暂无命令历史。</p>
  </div>

  <div v-else-if="tab === 'favorites'" class="command-list" data-testid="command-favorites-list">
    <template v-for="favoriteScope in (['server', 'group', 'global'] as const)" :key="favoriteScope">
      <section v-if="groupedFavorites[favoriteScope].length" class="command-favorite-group">
        <h3>{{ scopeTitle(favoriteScope, scope) }}</h3>
        <CommandPaletteResultItem
          v-for="favorite in groupedFavorites[favoriteScope]"
          :key="favorite.id"
          kind="favorite"
          :favorite="favorite"
          :scope="scope"
          :query="query"
          @favorite-insert="emit('favorite-insert', $event)"
          @favorite-execute="emit('favorite-execute', $event)"
          @edit-favorite="emit('edit-favorite', $event)"
          @delete-favorite="emit('delete-favorite', $event)"
        />
      </section>
    </template>
    <section v-if="commonCommands.length" class="command-favorite-group" data-testid="command-common-list">
      <h3>常用命令</h3>
      <article
        v-for="command in commonCommands"
        :key="command.id"
        class="command-row command-row-compact command-common-row"
      >
        <strong>{{ command.title }}</strong>
        <CommandText :command="command.command" :highlight="query" />
        <span class="command-source-badge">{{ command.description }}</span>
        <div class="command-row-actions">
          <button type="button" class="text-button" data-testid="common-insert" @click="emit('insert', command.command)">插入</button>
          <button type="button" class="text-button" data-testid="common-execute" @click="emit('execute', command.command)">执行</button>
        </div>
      </article>
    </section>
    <p v-if="!favoriteCount && !commonCommands.length" class="empty-state">暂无常用命令。</p>
  </div>
</template>
