<script setup lang="ts">
import { computed, ref } from 'vue'
import AppSurface from './AppSurface.vue'

const props = withDefaults(defineProps<{
  viewport?: boolean
  scroll?: boolean
}>(), {
  viewport: true,
  scroll: true,
})

const surface = ref<{ element?: HTMLElement | null } | null>(null)
const element = computed(() => surface.value?.element ?? null)

defineExpose({ element })
</script>

<template>
  <AppSurface
    ref="surface"
    as="div"
    variant="popover"
    class="app-popover"
    :class="{
      'viewport-popover': props.viewport,
      'viewport-popover-menu': props.viewport,
      'viewport-popover-scroll': props.viewport && props.scroll,
    }"
  >
    <slot />
  </AppSurface>
</template>
