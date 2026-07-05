<script setup lang="ts">
import { computed } from 'vue'
import { tokenizeCommand } from '../lib/commandHighlight'

const props = defineProps<{
  command: string
  highlight?: string
}>()

const tokens = computed(() => tokenizeCommand(props.command))

function highlightedParts(value: string) {
  const query = props.highlight?.trim()
  if (!query) return [{ value, match: false }]
  const lower = value.toLowerCase()
  const needle = query.toLowerCase()
  const index = lower.indexOf(needle)
  if (index < 0) return [{ value, match: false }]
  return [
    { value: value.slice(0, index), match: false },
    { value: value.slice(index, index + query.length), match: true },
    { value: value.slice(index + query.length), match: false },
  ].filter((part) => part.value)
}
</script>

<template>
  <code class="command-text" :title="command">
    <span
      v-for="(token, index) in tokens"
      :key="`${index}:${token.type}`"
      class="command-token"
      :class="`command-token-${token.type}`"
    ><template
      v-for="(part, partIndex) in highlightedParts(token.value)"
      :key="`${index}:${partIndex}`"
    ><mark v-if="part.match">{{ part.value }}</mark><template v-else>{{ part.value }}</template></template></span>
  </code>
</template>
