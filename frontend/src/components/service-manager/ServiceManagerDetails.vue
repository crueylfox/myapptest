<script setup lang="ts">
import type {
  ServiceJournalLine,
  ServiceJournalPriority,
  ServiceManagerCapability,
  SystemServiceDetail,
  SystemServiceSummary,
} from '../../types'
import ServiceActionBar from './ServiceActionBar.vue'
import ServiceJournalPanel from './ServiceJournalPanel.vue'
import {
  countText,
  detailPathText,
  detailPathTitle,
  formatBytes,
  formatCPU,
  pidText,
  resourceTitle,
  serviceLabel,
  type DetailTab,
  type ServiceAction,
} from '../../composables/serviceManagerModel'

export interface ServiceJournalPanelProps {
  autoScroll: boolean
  currentBootOnly: boolean
  journalCountText: string
  journalFollowBusy: boolean
  journalFollowDisabledReason?: string
  journalFollowSupported?: boolean
  journalFollowing: boolean
  journalLoading: boolean
  journalRefreshSupported?: boolean
  journalSourceText?: string
  journalStatus: string
  journalStatusText: string
  journalSupported: boolean
  lineLimit: number
  priority: ServiceJournalPriority
  query: string
  selectedUnitName: string
  visibleLines: ServiceJournalLine[]
  wordWrap: boolean
}

defineProps<{
  actionBusy: ServiceAction | null
  actionDisabled: Record<ServiceAction, boolean>
  activeDetailTab: DetailTab
  capability: ServiceManagerCapability | null
  criticalWarningText: string
  detail: SystemServiceDetail | null
  detailError: string
  detailLoading: boolean
  journalProps: ServiceJournalPanelProps
  partialWarningText: string
  resourceMetricsSupported: boolean
  selectedService: SystemServiceSummary | null
  showCriticalWarning: boolean
  showPartialWarning: boolean
}>()

const emit = defineEmits<{
  action: [action: ServiceAction]
  clear: []
  copy: []
  refresh: []
  'journal-scroll': [event: Event]
  'toggle-follow': []
  'update:activeDetailTab': [tab: DetailTab]
  'update:autoScroll': [value: boolean]
  'update:currentBootOnly': [value: boolean]
  'update:lineLimit': [value: number]
  'update:priority': [value: ServiceJournalPriority]
  'update:query': [value: string]
  'update:wordWrap': [value: boolean]
}>()
</script>

<template>
  <section class="service-detail-panel">
    <p v-if="!selectedService" class="empty">请选择一个服务。</p>
    <template v-else>
      <div class="service-detail-heading">
        <div class="service-detail-title">
          <strong class="service-detail-unit-name" :title="selectedService.unitName">{{ serviceLabel(selectedService) }}</strong>
          <span class="service-detail-description" :title="selectedService.description">{{ selectedService.description || '—' }}</span>
        </div>
        <ServiceActionBar
          :action-busy="actionBusy"
          :disabled-actions="actionDisabled"
          @action="emit('action', $event)"
        />
      </div>
      <div
        v-if="showCriticalWarning || showPartialWarning"
        class="service-compact-notice"
        data-testid="service-compact-notice"
      >
        <span v-if="showCriticalWarning" class="service-compact-notice__warning">
          {{ criticalWarningText }}
        </span>
        <span
          v-if="showCriticalWarning && showPartialWarning"
          class="service-compact-notice__divider"
          aria-hidden="true"
        >
          |
        </span>
        <span v-if="showPartialWarning" class="service-compact-notice__info">
          {{ partialWarningText }}
        </span>
      </div>
      <ServiceJournalPanel
        :active-detail-tab="activeDetailTab"
        :auto-scroll="journalProps.autoScroll"
        :current-boot-only="journalProps.currentBootOnly"
        :journal-count-text="journalProps.journalCountText"
        :journal-follow-busy="journalProps.journalFollowBusy"
        :journal-follow-disabled-reason="journalProps.journalFollowDisabledReason || ''"
        :journal-follow-supported="journalProps.journalFollowSupported !== false"
        :journal-following="journalProps.journalFollowing"
        :journal-loading="journalProps.journalLoading"
        :journal-refresh-supported="journalProps.journalRefreshSupported !== false"
        :journal-source-text="journalProps.journalSourceText || ''"
        :journal-status="journalProps.journalStatus"
        :journal-status-text="journalProps.journalStatusText"
        :journal-supported="journalProps.journalSupported"
        :line-limit="journalProps.lineLimit"
        :priority="journalProps.priority"
        :query="journalProps.query"
        :selected-unit-name="journalProps.selectedUnitName"
        :visible-lines="journalProps.visibleLines"
        :word-wrap="journalProps.wordWrap"
        @clear="emit('clear')"
        @copy="emit('copy')"
        @journal-scroll="emit('journal-scroll', $event)"
        @refresh="emit('refresh')"
        @toggle-follow="emit('toggle-follow')"
        @update:active-detail-tab="emit('update:activeDetailTab', $event)"
        @update:auto-scroll="emit('update:autoScroll', $event)"
        @update:current-boot-only="emit('update:currentBootOnly', $event)"
        @update:line-limit="emit('update:lineLimit', $event)"
        @update:priority="emit('update:priority', $event)"
        @update:query="emit('update:query', $event)"
        @update:word-wrap="emit('update:wordWrap', $event)"
      >
        <template #detail>
          <p v-if="detailLoading" class="empty">正在读取服务详情...</p>
          <p v-else-if="detailError" class="empty">{{ detailError }}</p>
          <dl v-else class="service-detail-grid" data-testid="service-detail">
            <dt>运行状态</dt><dd>{{ detail?.activeStateLabel || selectedService.activeStateLabel }}</dd>
            <dt>开机启动</dt><dd>{{ detail?.unitFileStateLabel || selectedService.unitFileStateLabel }}</dd>
            <template v-if="detail?.initSystem === 'openwrt-procd'">
              <dt>Init 系统</dt><dd>{{ capability?.displayName || 'OpenWrt procd' }}</dd>
              <dt>发行版</dt><dd>{{ [detail?.distributionName, detail?.distributionVersion].filter(Boolean).join(' ') || '—' }}</dd>
            </template>
            <dt>MainPID</dt><dd>{{ pidText(detail?.mainPID) }}</dd>
            <dt>内存</dt><dd :title="detail?.memoryCurrentBytes === undefined ? resourceTitle(resourceMetricsSupported) : ''">{{ formatBytes(detail?.memoryCurrentBytes) }}</dd>
            <dt>CPU</dt><dd :title="detail?.cpuUsageNSec === undefined ? resourceTitle(resourceMetricsSupported) : ''">{{ formatCPU(detail?.cpuUsageNSec) }}</dd>
            <dt>任务数</dt><dd :title="detail?.tasksCurrent === undefined ? resourceTitle(resourceMetricsSupported) : ''">{{ countText(detail?.tasksCurrent) }}</dd>
            <dt>重启次数</dt><dd :title="detail?.restartCount === undefined ? resourceTitle(resourceMetricsSupported) : ''">{{ countText(detail?.restartCount) }}</dd>
            <dt>Result</dt><dd>{{ detail?.result || '未知' }}</dd>
            <dt>{{ detail?.initSystem === 'openwrt-procd' ? '脚本路径' : 'Unit 文件' }}</dt><dd :title="detailPathTitle(detail)">{{ detailPathText(detail) }}</dd>
            <dt>启动时间</dt><dd>{{ detail?.startedAt || '—' }}</dd>
            <dt>退出时间</dt><dd>{{ detail?.exitedAt || '—' }}</dd>
            <template v-if="detail?.lastUpdatedAt">
              <dt>刷新时间</dt><dd>{{ detail.lastUpdatedAt }}</dd>
            </template>
          </dl>
        </template>
      </ServiceJournalPanel>
    </template>
  </section>
</template>

<style scoped>
.service-detail-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  overflow: hidden;
  padding: 12px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-card-bg);
}

.service-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.service-detail-title {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.service-detail-unit-name {
  flex: 0 1 auto;
  max-width: 240px;
  font-size: 17px;
}

.service-detail-description {
  flex: 1 1 auto;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.service-detail-unit-name,
.service-detail-description,
.service-detail-grid dd {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-detail-unit-name,
.service-detail-description {
  line-height: 1.35;
}

.service-compact-notice {
  flex: 0 0 auto;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 9px;
  overflow: hidden;
  padding: 5px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-panel-bg);
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
}

.service-compact-notice__warning,
.service-compact-notice__info {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.service-compact-notice__warning {
  color: var(--state-warning-text);
}

.service-compact-notice__divider {
  flex: 0 0 auto;
  color: var(--state-neutral-text);
}

.service-compact-notice__info {
  color: var(--state-info-text);
}

.service-detail-grid {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px 10px;
  margin: 0;
  max-height: 100%;
  overflow: auto;
  font-size: 13px;
}

.service-detail-grid dt {
  color: var(--muted, #9aa8ba);
}

.service-detail-grid dd {
  margin: 0;
}

.empty {
  margin: 0;
  color: var(--muted, #9aa8ba);
  font-size: 13px;
}

@media (max-width: 900px) {
  .service-compact-notice {
    flex-wrap: wrap;
    white-space: normal;
  }
}

@media (max-width: 780px) {
  .service-detail-heading {
    flex-wrap: wrap;
  }
}
</style>
