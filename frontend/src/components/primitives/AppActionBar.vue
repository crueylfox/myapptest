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
    variant="actionbar"
    class="app-action-bar"
    v-bind="attrs"
    :role="attrs.role ?? 'group'"
  >
    <slot />
  </AppSurface>
</template>
