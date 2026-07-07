<script setup lang="ts">
import type { ServiceManagerCapability, SystemServiceSummary } from '../../types'
import { statusClass, startupClass } from '../../composables/serviceManagerModel'

defineProps<{
  capability: ServiceManagerCapability | null
  services: SystemServiceSummary[]
  rawCount: number
  selectedUnitName: string
}>()

const emit = defineEmits<{
  select: [service: SystemServiceSummary]
}>()
</script>

<template>
  <section class="service-list-panel">
    <div class="service-list-header">
      <strong>服务</strong>
      <span>{{ services.length }} / {{ rawCount }}</span>
    </div>
    <p v-if="capability && !capability.available" class="empty">
      {{ capability.error || '当前服务器不使用 systemd 或 OpenWrt procd，本阶段暂不支持该服务管理方式。' }}
    </p>
    <p v-else-if="services.length === 0" class="empty">暂无服务或没有匹配结果。</p>
    <button
      v-for="service in services"
      :key="`${service.serverID}:${service.initSystem}:${service.serviceID}`"
      class="service-row"
      :class="{ selected: service.unitName === selectedUnitName }"
      type="button"
      data-testid="service-row"
      @click="emit('select', service)"
    >
      <span class="service-dot" :class="statusClass(service)"></span>
      <span class="service-row-main">
        <strong :title="service.unitName">{{ service.displayName || service.unitName }}</strong>
        <small :title="service.description">{{ service.description || '—' }}</small>
      </span>
      <span class="service-badges">
        <span class="service-badge" :class="statusClass(service)">{{ service.activeStateLabel }}</span>
        <span class="service-badge" :class="startupClass(service)">{{ service.unitFileStateLabel }}</span>
      </span>
    </button>
  </section>
</template>

<style scoped>
.service-list-panel {
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-card-bg);
}

.service-list-header,
.service-badges {
  display: flex;
  align-items: center;
  gap: 10px;
}

.service-list-header {
  justify-content: space-between;
  padding: 2px 2px 6px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.service-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text, #e5edf8);
  text-align: left;
}

.service-row:hover {
  border-color: var(--state-selected-border);
  background: var(--state-hover-bg);
}

.service-row.selected {
  border-color: var(--state-selected-border);
  background: var(--state-selected-bg);
}

.service-row-main {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.service-row-main strong,
.service-row-main small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-row-main strong {
  font-size: 13px;
}

.service-row-main small {
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.service-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--state-neutral-text);
}

.service-dot.running,
.service-badge.running {
  background: var(--state-success-bg);
  color: var(--state-success-text);
}

.service-dot.failed,
.service-badge.failed {
  background: var(--state-danger-bg);
  color: var(--state-danger-text);
}

.service-dot.pending,
.service-badge.pending {
  background: var(--state-warning-bg);
  color: var(--state-warning-text);
}

.service-dot.stopped,
.service-badge.stopped,
.service-badge.disabled {
  background: var(--state-neutral-bg);
  color: var(--state-neutral-text);
}

.service-badges {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.service-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
}

.service-badge.enabled {
  background: var(--state-info-bg);
  color: var(--state-info-text);
}

.service-badge.other {
  background: var(--state-neutral-bg);
  color: var(--state-neutral-text);
}

.empty {
  margin: 0;
  color: var(--muted, #9aa8ba);
  font-size: 13px;
}

@media (max-width: 680px) {
  .service-row {
    grid-template-columns: 12px minmax(0, 1fr);
  }

  .service-badges {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
