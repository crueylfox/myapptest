<script setup lang="ts">
import type { CommandPaletteScope } from '../composables/useCommandPaletteController'
import type { CommandFavorite, CommandHistoryEntry } from '../types'
import CommandText from './CommandText.vue'

const props = withDefaults(defineProps<{
  kind: 'history' | 'favorite'
  entry?: CommandHistoryEntry
  favorite?: CommandFavorite
  scope?: CommandPaletteScope
  selected?: boolean
  query?: string
}>(), {
  scope: 'all',
  selected: false,
  query: '',
})

const emit = defineEmits<{
  insert: [command: string]
  execute: [command: string]
  'edit-history': [entry: CommandHistoryEntry]
  'copy-history': [entry: CommandHistoryEntry]
  'favorite-history': [command: string]
  'delete-history': [entry: CommandHistoryEntry]
  'history-context-menu': [entry: CommandHistoryEntry, event: MouseEvent]
  'favorite-insert': [payload: { command: string; favorite: CommandFavorite }]
  'favorite-execute': [payload: { command: string; favorite: CommandFavorite }]
  'edit-favorite': [favorite: CommandFavorite]
  'delete-favorite': [favorite: CommandFavorite]
}>()

function sourceBadge(entry: CommandHistoryEntry) {
  if (entry.source === 'batch') {
    const count = entry.targetCount ?? entry.targetServerIds?.length ?? 0
    return count > 0 ? `批量 · ${count}台` : '批量'
  }
  return entry.serverName || (entry.serverId ? `#${entry.serverId}` : '未知服务器')
}

function historyPreview(entry: CommandHistoryEntry) {
  return entry.preview || buildCommandPreview(entry.command)
}

function favoriteBadge(favorite: CommandFavorite) {
  if (favorite.scope === 'server') return favorite.serverName || (favorite.serverId ? `#${favorite.serverId}` : 'server')
  if (favorite.scope === 'group') return favorite.groupName || (favorite.groupId ? `group #${favorite.groupId}` : 'group')
  return 'global'
}

function favoriteTitle(favorite: CommandFavorite) {
  return [favorite.title, favorite.command, favorite.description].filter(Boolean).join(' / ')
}

function showHistorySource(entry: CommandHistoryEntry) {
  return props.scope === 'all' || entry.source === 'batch'
}

function openHistoryMenu(entry: CommandHistoryEntry, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  emit('history-context-menu', entry, event)
}

function normalizeHistoryCommand(value: string) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function buildCommandPreview(value: string) {
  const lines = normalizeHistoryCommand(value).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const preview = lines[index].trim().replace(/\s+/g, ' ')
    if (!preview) continue
    const hasMore = lines.slice(index + 1).some((line) => line.trim())
    return hasMore ? `${preview} ...` : preview
  }
  return ''
}
</script>

<template>
  <article
    v-if="kind === 'history' && entry"
    class="command-row command-row-compact command-history-row"
    :class="{ selected }"
    @dblclick="emit('insert', entry.command)"
    @contextmenu="openHistoryMenu(entry, $event)"
  >
    <CommandText class="command-history-preview" :command="historyPreview(entry)" :highlight="query" />
    <span v-if="showHistorySource(entry) || entry.isMultiline" class="command-history-badges">
      <span v-if="showHistorySource(entry)" class="command-source-badge" :title="sourceBadge(entry)">{{ sourceBadge(entry) }}</span>
      <span v-if="entry.isMultiline" class="command-source-badge command-multiline-badge" title="多行命令">多行</span>
    </span>
    <small :title="new Date(entry.executedAt).toLocaleString()">{{ new Date(entry.executedAt).toLocaleString() }}</small>
    <div class="command-row-actions">
      <button type="button" class="text-button" data-testid="history-edit" @click="emit('edit-history', entry)">编辑</button>
      <button type="button" class="text-button" data-testid="history-copy" @click="emit('copy-history', entry)">复制</button>
      <button type="button" class="text-button" data-testid="history-insert" @click="emit('insert', entry.command)">插入</button>
      <button type="button" class="text-button" data-testid="history-execute" @click="emit('execute', entry.command)">执行</button>
      <button type="button" class="text-button" data-testid="history-favorite" @click="emit('favorite-history', entry.command)">收藏</button>
      <button type="button" class="danger-link" @click="emit('delete-history', entry)">删除</button>
    </div>
  </article>
  <article
    v-else-if="kind === 'favorite' && favorite"
    class="command-row command-row-compact command-favorite-row"
    :class="{ selected }"
    :title="favoriteTitle(favorite)"
    @dblclick="emit('favorite-insert', { command: favorite.command, favorite })"
  >
    <strong>{{ favorite.title }}</strong>
    <CommandText :command="favorite.command" :highlight="query" />
    <span v-if="scope === 'all'" class="command-source-badge" :title="favoriteBadge(favorite)">{{ favoriteBadge(favorite) }}</span>
    <div class="command-row-actions">
      <button type="button" class="text-button" data-testid="favorite-insert" @click="emit('favorite-insert', { command: favorite.command, favorite })">插入</button>
      <button type="button" class="text-button" data-testid="favorite-execute" @click="emit('favorite-execute', { command: favorite.command, favorite })">执行</button>
      <button type="button" class="text-button" data-testid="favorite-edit" @click="emit('edit-favorite', favorite)">编辑</button>
      <button type="button" class="danger-link" @click="emit('delete-favorite', favorite)">删除</button>
    </div>
  </article>
</template>
