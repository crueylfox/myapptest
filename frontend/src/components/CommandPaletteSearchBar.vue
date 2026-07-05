<script setup lang="ts">
defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  clear: []
  keydown: [event: KeyboardEvent]
  focus: [event: FocusEvent]
}>()

function updateQuery(event: Event) {
  emit('update:modelValue', String((event.target as HTMLInputElement).value ?? '').trim())
}

function clearQuery() {
  emit('update:modelValue', '')
  emit('clear')
}
</script>

<template>
  <div class="command-search-row">
    <input
      class="command-search"
      :value="modelValue"
      :placeholder="placeholder"
      @input="updateQuery"
      @keydown="emit('keydown', $event)"
      @focus="emit('focus', $event)"
    />
    <button
      v-if="modelValue"
      type="button"
      class="text-button command-search-clear"
      data-testid="command-search-clear"
      @click="clearQuery"
    >清除</button>
  </div>
</template>
