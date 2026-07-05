<script setup lang="ts">
withDefaults(defineProps<{
  open: boolean
  title?: string
  subtitle?: string
}>(), {
  title: '命令面板',
  subtitle: '',
})

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div v-if="open" class="command-palette-backdrop" @click.self="emit('close')" @keydown.esc.prevent="emit('close')">
    <section class="command-palette" role="dialog" :aria-label="title">
      <header>
        <div>
          <h2>{{ title }}</h2>
          <small>{{ subtitle }}</small>
        </div>
        <button
          type="button"
          class="command-light-action command-palette-close-button"
          data-testid="command-palette-close"
          @click="emit('close')"
        >关闭</button>
      </header>
      <slot name="tabs" />
      <slot name="search" />
      <slot name="scope" />
      <slot />
    </section>
    <slot name="overlays" />
  </div>
</template>
