<script setup lang="ts">
defineProps<{
  direction: 'up' | 'down' | 'left' | 'right'
}>()
</script>

<template>
  <svg
    class="splitter-chevron"
    :class="`chevron-${direction}`"
    viewBox="0 0 12 12"
    width="12"
    height="12"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M3 4.25 6 7.25 9 4.25" />
  </svg>
</template>
