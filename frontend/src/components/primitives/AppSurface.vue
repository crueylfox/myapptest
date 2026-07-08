<script setup lang="ts">
import { computed, ref, type Component } from 'vue'

type SurfaceVariant = 'modal' | 'panel' | 'card' | 'toolbar' | 'actionbar' | 'control' | 'popover'
type SurfaceMaterial = 'standard' | 'liquid'

const props = withDefaults(defineProps<{
  as?: string | Component
  variant?: SurfaceVariant
  material?: SurfaceMaterial
}>(), {
  as: 'section',
  variant: 'card',
  material: 'standard',
})

const materialClass = computed(() => {
  switch (props.variant) {
    case 'modal':
      return 'app-material-surface'
    case 'panel':
      return 'app-material-panel'
    case 'card':
    case 'popover':
      return 'app-material-card'
    case 'toolbar':
    case 'actionbar':
      return 'app-material-toolbar'
    case 'control':
      return 'app-material-control'
    default:
      return ''
  }
})

const element = ref<HTMLElement | null>(null)

defineExpose({ element })
</script>

<template>
  <component
    ref="element"
    :is="as"
    class="app-surface"
    :class="[`app-surface--${variant}`, materialClass, { 'app-surface--liquid': material === 'liquid' }]"
  >
    <slot />
  </component>
</template>
