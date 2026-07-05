<script setup lang="ts">
const emit = defineEmits<{
  open: []
}>()
</script>

<template>
  <article class="settings-card settings-app-log-entry-card" data-testid="settings-app-log-entry">
    <div>
      <h2>应用日志</h2>
      <p class="settings-note">查看应用运行日志、筛选级别并复制错误详情。</p>
    </div>
    <button type="button" class="secondary" data-testid="settings-open-app-logs" @click="emit('open')">
      打开应用日志
    </button>
  </article>
</template>
