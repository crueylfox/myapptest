<script setup lang="ts">
import { computed, ref, useAttrs, type Component } from 'vue'
import AppSurface from './AppSurface.vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  as?: string | Component
}>(), {
  as: 'div',
})

const attrs = useAttrs()
const surface = ref<{ element?: HTMLElement | null } | null>(null)
const element = computed(() => surface.value?.element ?? null)

defineExpose({ element })
</script>

<template>
  <AppSurface
    ref="surface"
    :as="as"
    variant="toolbar"
    class="app-toolbar"
    v-bind="attrs"
    :role="attrs.role ?? 'toolbar'"
  >
    <slot />
  </AppSurface>
</template>
