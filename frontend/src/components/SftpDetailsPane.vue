<script lang="ts">
export type SftpDetailsRow = {
  label: string
  value: string
  title?: string
  code?: boolean
}
</script>

<script setup lang="ts">
defineProps<{
  collapsed: boolean
  selectedCount: number
  selectedSizeText: string
  detailRows: SftpDetailsRow[]
}>()

defineEmits<{
  toggleCollapsed: []
  resizeStart: [event: PointerEvent]
}>()
</script>

<template>
  <aside v-if="!collapsed" class="sftp-details">
    <button
      class="sftp-details-resizer"
      aria-label="调整详情区宽度"
      @pointerdown="$emit('resizeStart', $event)"
    ></button>
    <header>
      <strong>详情</strong>
      <button class="text-button" @click="$emit('toggleCollapsed')">折叠</button>
    </header>
    <div v-if="selectedCount === 0" class="sftp-detail-empty">未选择文件</div>
    <div v-else-if="selectedCount > 1" class="sftp-detail-grid">
      <span>选择</span><strong>已选择 {{ selectedCount }} 项</strong>
      <span>总大小</span><strong>{{ selectedSizeText }}</strong>
    </div>
    <div v-else class="sftp-detail-grid">
      <template v-for="row in detailRows" :key="row.label">
        <span>{{ row.label }}</span>
        <strong :title="row.title">
          <code v-if="row.code">{{ row.value }}</code>
          <template v-else>{{ row.value }}</template>
        </strong>
      </template>
    </div>
  </aside>
  <button v-else class="sftp-details-expand" @click="$emit('toggleCollapsed')">详情</button>
</template>
