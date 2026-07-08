<script setup lang="ts">
withDefaults(defineProps<{
  kind?: 'modal' | 'popover' | 'drawer'
  danger?: boolean
}>(), {
  kind: 'modal',
  danger: false,
})
</script>

<template>
  <div
    class="app-backdrop app-material-backdrop"
    :class="[`app-backdrop--${kind}`, { 'danger-modal': danger }]"
  >
    <slot />
  </div>
</template>
