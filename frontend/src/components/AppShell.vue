<script setup lang="ts">
defineOptions({ name: 'AppShell' })

defineProps<{
  terminalLayout: boolean
}>()
</script>

<template>
  <div class="app-shell" :class="{ 'terminal-layout': terminalLayout }">
    <div class="app-visual-root" data-testid="app-visual-root">
      <slot name="topbar" />
      <main class="content" :class="{ 'terminal-mode': terminalLayout }">
        <slot />
      </main>
      <slot name="status" />
    </div>
    <slot name="overlays" />
  </div>
</template>
