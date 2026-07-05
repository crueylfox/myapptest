<script setup lang="ts">
import type { CommandPaletteScope, CommandPaletteTab } from '../composables/useCommandPaletteController'

defineProps<{
  activeTab: CommandPaletteTab
  scope: CommandPaletteScope
  hasServer: boolean
  showAddFavorite: boolean
}>()

const emit = defineEmits<{
  'tab-change': [tab: CommandPaletteTab]
  'scope-change': [scope: CommandPaletteScope]
  'add-favorite': []
}>()
</script>

<template>
  <div class="command-palette-tabs">
    <button
      type="button"
      data-testid="command-tab-history"
      class="command-light-action"
      :class="{ active: activeTab === 'history' }"
      @click="emit('tab-change', 'history')"
    >历史命令</button>
    <span class="command-action-separator" aria-hidden="true">|</span>
    <button
      type="button"
      data-testid="command-tab-favorites"
      class="command-light-action"
      :class="{ active: activeTab === 'favorites' }"
      @click="emit('tab-change', 'favorites')"
    >常用命令</button>
    <span class="command-action-separator" aria-hidden="true">|</span>
    <button
      type="button"
      data-testid="command-open-batch"
      class="command-light-action"
      :class="{ active: activeTab === 'batch' }"
      @click="emit('tab-change', 'batch')"
    >批量命令</button>
    <span v-if="showAddFavorite" class="command-action-separator command-action-separator-spacer" aria-hidden="true">|</span>
    <button
      v-if="showAddFavorite"
      type="button"
      class="command-light-action command-add-favorite-button"
      data-testid="command-add-favorite"
      @click="emit('add-favorite')"
    >新增收藏</button>
  </div>
  <slot name="search" />
  <div v-if="activeTab !== 'batch'" class="command-scope-filter" role="tablist" aria-label="命令范围">
    <button
      type="button"
      data-testid="command-scope-all"
      class="command-light-action"
      :class="{ active: scope === 'all' }"
      @click="emit('scope-change', 'all')"
    >全部命令</button>
    <span class="command-action-separator" aria-hidden="true">|</span>
    <button
      type="button"
      data-testid="command-scope-current-server"
      class="command-light-action"
      :class="{ active: scope === 'currentServer' }"
      :disabled="!hasServer"
      @click="emit('scope-change', 'currentServer')"
    >当前服务器</button>
  </div>
</template>
