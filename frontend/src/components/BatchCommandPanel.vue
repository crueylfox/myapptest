<script setup lang="ts">
import type { BatchCommandTargetRow } from '../composables/useBatchCommandController'
import CommandText from './CommandText.vue'

defineProps<{
  targets: BatchCommandTargetRow[]
  selectedIds: Set<number>
  selectedCount: number
  command: string
  sending: boolean
}>()

const emit = defineEmits<{
  'toggle-target': [serverID: number]
  'select-all': []
  invert: []
  'update:command': [value: string]
  'clear-command': []
  'save-favorite': []
  start: []
}>()

function updateCommand(event: Event) {
  emit('update:command', String((event.target as HTMLTextAreaElement).value ?? ''))
}
</script>

<template>
  <div class="command-list command-batch-panel" data-testid="command-batch-panel">
    <div class="command-list-toolbar">
      <strong>批量命令</strong>
      <span>已选 {{ selectedCount }} 台</span>
    </div>
    <section class="command-batch-section">
      <div class="command-batch-section-title">
        <span>在线设备</span>
        <div class="command-batch-actions-inline">
          <button type="button" class="text-button" data-testid="batch-select-all" @click="emit('select-all')">全选</button>
          <button type="button" class="text-button" data-testid="batch-invert" @click="emit('invert')">反选</button>
        </div>
      </div>
      <div class="batch-server-chip-list" data-testid="batch-server-list">
        <button
          v-for="target in targets"
          :key="target.serverID"
          type="button"
          class="batch-server-chip"
          :class="{ selected: selectedIds.has(target.serverID) }"
          :aria-pressed="selectedIds.has(target.serverID)"
          :title="target.name"
          @click="emit('toggle-target', target.serverID)"
        >
          <span v-if="selectedIds.has(target.serverID)" aria-hidden="true">✓</span>
          <span>{{ target.name }}</span>
        </button>
      </div>
      <p v-if="targets.length === 0" class="empty-state">暂无在线 SSH 终端</p>
    </section>
    <label class="command-batch-field">
      <span>命令</span>
      <textarea :value="command" data-testid="batch-command-input" rows="4" placeholder="uname -a" @input="updateCommand" />
    </label>
    <CommandText v-if="command.trim()" class="command-batch-preview" :command="command" />
    <div class="command-batch-actions">
      <button type="button" class="secondary" data-testid="batch-clear-command" @click="emit('clear-command')">清空</button>
      <button type="button" class="secondary" data-testid="batch-save-favorite" @click="emit('save-favorite')">保存到常用命令</button>
      <button
        type="button"
        class="primary"
        data-testid="batch-start"
        :disabled="sending"
        @click="emit('start')"
      >{{ sending ? '发送中…' : '开始执行' }}</button>
    </div>
    <p class="command-batch-note">命令将在所选服务器现有 SSH 终端中执行，输出请在对应终端查看。</p>
  </div>
</template>
