<script setup lang="ts">
defineOptions({ name: 'AppShell' })

withDefaults(defineProps<{
  terminalLayout: boolean
  platform?: string
}>(), {
  platform: 'windows',
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'terminal-layout': terminalLayout,
      'platform-macos': platform === 'darwin',
      'platform-windows': platform === 'windows',
    }"
    :data-platform="platform"
  >
    <div class="app-visual-root" data-testid="app-visual-root" :data-platform="platform">
      <slot name="topbar" />
      <main class="content" :class="{ 'terminal-mode': terminalLayout }">
        <slot />
      </main>
      <slot name="status" />
    </div>
    <slot name="overlays" />
  </div>
</template>
