<script setup lang="ts">
import { computed, type Component } from 'vue'

type SurfaceVariant = 'modal' | 'panel' | 'card' | 'toolbar' | 'control' | 'popover'

const props = withDefaults(defineProps<{
  as?: string | Component
  variant?: SurfaceVariant
}>(), {
  as: 'section',
  variant: 'card',
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
      return 'app-material-toolbar'
    case 'control':
      return 'app-material-control'
    default:
      return ''
  }
})
</script>

<template>
  <component
    :is="as"
    class="app-surface"
    :class="[`app-surface--${variant}`, materialClass]"
  >
    <slot />
  </component>
</template>
