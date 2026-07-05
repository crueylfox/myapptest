<script setup lang="ts">
import type { PaneAssignment } from '../utils/workspaceSplitTypes'
import { samePaneAssignment } from '../composables/usePaneAssignments'
import type { TerminalSelectorOption } from '../composables/workspaceCommandModel'

defineProps<{
  options: TerminalSelectorOption[]
  selectedAssignment: PaneAssignment | null
}>()

defineEmits<{
  select: [assignment: PaneAssignment]
}>()
</script>

<template>
  <div
    class="terminal-pane-selector"
    role="menu"
    @pointerdown.stop
    @click.stop
  >
    <button
      v-for="option in options"
      :key="option.key"
      type="button"
      :data-assignment-key="option.key"
      :class="{ selected: samePaneAssignment(selectedAssignment, option.assignment) }"
      @click="$emit('select', option.assignment)"
    >
      <span class="terminal-pane-selector-badge">{{ option.badge }}</span>
      <strong>{{ option.title }}</strong>
      <span class="status-dot" :class="option.statusClass"></span>
      <small>{{ option.statusText }}</small>
    </button>
  </div>
</template>
