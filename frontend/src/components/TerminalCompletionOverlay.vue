<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CommandSuggestion } from '../types'
import type { TerminalCompletionPosition } from '../composables/terminalCompletionPosition'
import CommandText from './CommandText.vue'

const props = defineProps<{
  open: boolean
  suggestions: CommandSuggestion[]
  selectedIndex: number
  prefix: string
  busy: boolean
  position?: TerminalCompletionPosition | null
  showDescriptions?: boolean
}>()
const emit = defineEmits<{
  select: [index: number]
  insert: [suggestion: CommandSuggestion]
  disable: []
}>()
const overlayRef = ref<HTMLElement | null>(null)

const overlayStyle = computed(() => props.position
  ? {
      left: `${props.position.left}px`,
      top: `${props.position.top}px`,
      width: `${props.position.width}px`,
      maxHeight: `${props.position.height}px`,
    }
  : undefined)

function sourceLabel(suggestion: CommandSuggestion) {
  if (suggestion.source === 'history') return '历史'
  if (suggestion.source === 'favorite') return '收藏'
  if (suggestion.source === 'common') return '常用'
  if (suggestion.source === 'builtin') return '内置'
  return '建议'
}
watch(() => [props.open, props.selectedIndex, props.suggestions.length] as const, async () => {
  if (!props.open || props.selectedIndex < 0 || props.selectedIndex >= props.suggestions.length) return
  await nextTick()
  const selected = overlayRef.value?.querySelector<HTMLElement>('[data-testid="completion-selected"]')
  selected?.scrollIntoView?.({ block: 'nearest' })
}, { flush: 'post' })
</script>

<template>
  <div v-if="open" ref="overlayRef" class="terminal-completion" data-testid="terminal-completion-overlay" :style="overlayStyle">
    <header>
      <strong>命令补全</strong>
      <span>{{ busy ? '加载中' : `${suggestions.length} 条` }}</span>
    </header>
    <div v-if="prefix" class="completion-prefix">当前输入：<CommandText :command="prefix" /></div>
    <div v-if="!suggestions.length && !busy" class="completion-empty">暂无匹配命令</div>
    <div v-else class="completion-list">
      <button
        v-for="(suggestion, index) in suggestions"
        :key="`${suggestion.source}:${suggestion.id}`"
        type="button"
        class="completion-row"
        :class="{ active: index === selectedIndex }"
        :data-testid="index === selectedIndex ? 'completion-selected' : undefined"
        @mouseenter="emit('select', index)"
        @click="emit('insert', suggestion)"
      >
        <span class="completion-main">
          <CommandText :command="suggestion.command" />
          <span v-if="showDescriptions && suggestion.description" class="completion-description">{{ suggestion.description }}</span>
        </span>
        <span class="completion-source">{{ sourceLabel(suggestion) }}</span>
      </button>
    </div>
    <footer>
      <span>↑/↓ 选择 · Tab 接受 · Esc 关闭</span>
      <button type="button" class="completion-disable" data-testid="completion-disable" @click="emit('disable')">关闭命令补全</button>
    </footer>
  </div>
</template>
