<script setup lang="ts">
defineOptions({ name: 'AppShell' })

defineProps<{
  terminalLayout: boolean
}>()
</script>

<template>
  <div class="app-shell" :class="{ 'terminal-layout': terminalLayout }">
    <slot name="topbar" />
    <main class="content" :class="{ 'terminal-mode': terminalLayout }">
      <slot />
    </main>
    <slot name="status" />
    <slot name="overlays" />
  </div>
</template>
