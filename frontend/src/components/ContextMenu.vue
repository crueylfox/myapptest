<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ContextMenuItem } from '../types'
import { getViewportPopoverPosition } from '../utils/viewportPopover'

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
  interactionScope?: string
}>()
const emit = defineEmits<{ close: []; select: [id: string] }>()
const menu = ref<HTMLDivElement>()
const menuStyle = ref<Record<string, string>>({
  left: `${props.x}px`,
  top: `${props.y}px`,
})

async function updatePosition() {
  await nextTick()
  const bounds = menu.value?.getBoundingClientRect()
  const width = bounds && bounds.width > 0 ? bounds.width : 190
  const height = bounds && bounds.height > 0 ? bounds.height : 260
  const position = getViewportPopoverPosition({
    anchorRect: {
      left: props.x,
      top: props.y,
      right: props.x,
      bottom: props.y,
      width: 0,
      height: 0,
    },
    popoverSize: { width, height },
    viewport: {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    },
    placement: 'bottom-start',
    margin: 6,
    gap: 0,
  })
  menuStyle.value = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    width: `${position.width}px`,
    maxHeight: `${position.maxHeight}px`,
    transformOrigin: position.transformOrigin,
  }
}

function closeOnPointer(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node)) emit('close')
}

function closeOnKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

function select(item: ContextMenuItem) {
  if (item.disabled || item.separator) return
  emit('select', item.id)
  emit('close')
}

onMounted(async () => {
  window.addEventListener('pointerdown', closeOnPointer, true)
  window.addEventListener('keydown', closeOnKey, true)
  window.addEventListener('blur', emitClose)
  window.addEventListener('resize', updatePosition)
  document.addEventListener('scroll', updatePosition, true)
  await updatePosition()
  menu.value?.focus()
})

watch(() => [props.x, props.y, props.items.length] as const, updatePosition, { flush: 'post' })

function emitClose() {
  emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeOnPointer, true)
  window.removeEventListener('keydown', closeOnKey, true)
  window.removeEventListener('blur', emitClose)
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="viewport-popover viewport-popover-menu viewport-popover-scroll context-menu"
      role="menu"
      tabindex="-1"
      :data-interaction-scope="interactionScope || undefined"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" class="context-separator"></div>
        <button
          v-else
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          :class="{ danger: item.danger }"
          @click="select(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>
