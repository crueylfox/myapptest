<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './icons/AppIcon.vue'

defineProps<{
  showDropMessage?: boolean
}>()

defineEmits<{
  addServer: []
  connectSaved: []
}>()

const root = ref<HTMLElement | null>(null)
const orientation = ref<'vertical' | 'horizontal'>('vertical')
let resizeObserver: ResizeObserver | null = null

const separatorClass = computed(() => orientation.value === 'horizontal'
  ? 'action-separator--vertical-stack'
  : 'action-separator--horizontal-stack')

function updateOrientation() {
  const rect = root.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    orientation.value = 'vertical'
    return
  }
  orientation.value = rect.height < 190 && rect.width >= 320 ? 'horizontal' : 'vertical'
}

onMounted(() => {
  updateOrientation()
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  resizeObserver = new ResizeObserver(updateOrientation)
  resizeObserver.observe(root.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div ref="root" class="terminal-pane-empty">
    <span v-if="showDropMessage !== false" class="terminal-pane-empty-message">将标签拖到这里</span>
    <div
      class="terminal-pane-empty-actions terminal-empty-actions centered concept-c-action-stack"
      :class="`terminal-empty-actions--${orientation}`"
    >
      <button
        type="button"
        class="terminal-pane-add-server-trigger"
        @pointerdown.stop
        @click.stop="$emit('addServer')"
      ><AppIcon name="server-plus" :size="30" /><span>新建服务器</span></button>
      <span class="action-separator" :class="separatorClass" aria-hidden="true"></span>
      <button
        type="button"
        class="terminal-pane-connect-saved-trigger"
        @pointerdown.stop
        @click.stop="$emit('connectSaved')"
      ><AppIcon name="link" :size="30" /><span>连接已保存</span></button>
    </div>
  </div>
</template>
