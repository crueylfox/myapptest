<script setup lang="ts">
export interface AppStatusBarItem {
  id: string
  label: string
  count?: number
  disabled?: boolean
}

defineOptions({ name: 'AppStatusBar' })

withDefaults(defineProps<{
  items?: AppStatusBarItem[]
}>(), {
  items: () => [],
})

const emit = defineEmits<{
  action: [id: string]
}>()
</script>

<template>
  <footer v-if="items.length || $slots.default" class="app-status-bar">
    <slot>
      <button
        v-for="item in items"
        :key="item.id"
        class="app-status-item"
        type="button"
        :data-status-action="item.id"
        :disabled="item.disabled"
        @click="emit('action', item.id)"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.count !== undefined" class="app-status-count">{{ item.count }}</span>
      </button>
    </slot>
  </footer>
</template>
