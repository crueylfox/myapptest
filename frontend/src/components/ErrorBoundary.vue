<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const emit = defineEmits<{ error: [] }>()
const failed = ref(false)

onErrorCaptured(() => {
  failed.value = true
  emit('error')
  return false
})
</script>

<template>
  <section v-if="failed" class="panel-error">
    <h2>监控面板暂时不可用</h2>
    <p>监控组件发生错误，但服务器列表、连接操作和其他页面仍可继续使用。</p>
  </section>
  <slot v-else />
</template>
