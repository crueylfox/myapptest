<script setup lang="ts">
import type { ServiceJournalLine, ServiceJournalPriority } from '../../types'
import {
  journalLineClass,
  journalTimeText,
  type DetailTab,
} from '../../composables/serviceManagerModel'

withDefaults(defineProps<{
  activeDetailTab: DetailTab
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
}>(), {
  journalFollowDisabledReason: '',
  journalFollowSupported: true,
  journalRefreshSupported: true,
  journalSourceText: '',
})

const emit = defineEmits<{
  'update:activeDetailTab': [tab: DetailTab]
  'update:autoScroll': [value: boolean]
  'update:currentBootOnly': [value: boolean]
  'update:lineLimit': [value: number]
  'update:priority': [value: ServiceJournalPriority]
  'update:query': [value: string]
  'update:wordWrap': [value: boolean]
  clear: []
  copy: []
  refresh: []
  'journal-scroll': [event: Event]
  'toggle-follow': []
}>()

function updateLineLimit(event: Event) {
  emit('update:lineLimit', Number((event.target as HTMLSelectElement).value))
}

function updatePriority(event: Event) {
  emit('update:priority', (event.target as HTMLSelectElement).value as ServiceJournalPriority)
}

function updateChecked(event: Event, name: 'autoScroll' | 'currentBootOnly' | 'wordWrap') {
  const checked = (event.target as HTMLInputElement).checked
  if (name === 'autoScroll') emit('update:autoScroll', checked)
  if (name === 'currentBootOnly') emit('update:currentBootOnly', checked)
  if (name === 'wordWrap') emit('update:wordWrap', checked)
}
</script>

<template>
  <div class="service-journal-commandbar" :class="{ 'is-logs': activeDetailTab === 'logs' }">
    <div class="service-journal-commandbar__row is-primary">
      <div class="service-detail-tabs" role="tablist" aria-label="服务信息">
        <button
          type="button"
          role="tab"
          class="command-light-action"
          data-testid="service-detail-tab"
          :class="{ active: activeDetailTab === 'detail' }"
          @click="emit('update:activeDetailTab', 'detail')"
        >
          详情
        </button>
        <span v-if="journalSupported" class="command-action-separator" aria-hidden="true">|</span>
        <button
          v-if="journalSupported"
          type="button"
          role="tab"
          class="command-light-action"
          data-testid="service-journal-tab"
          :class="{ active: activeDetailTab === 'logs' }"
          @click="emit('update:activeDetailTab', 'logs')"
        >
          日志
        </button>
      </div>
      <template v-if="activeDetailTab === 'logs'">
        <label class="service-journal-inline-field">
          <span>行数</span>
          <select
            :value="lineLimit"
            class="service-journal-line-select"
            data-testid="service-journal-limit"
            :disabled="journalLoading || journalFollowing"
            @change="updateLineLimit"
          >
            <option :value="100">100</option>
            <option :value="200">200</option>
            <option :value="500">500</option>
            <option :value="1000">1000</option>
          </select>
        </label>
        <label class="service-journal-inline-field">
          <span>级别</span>
          <select
            :value="priority"
            class="service-journal-level-select"
            data-testid="service-journal-priority"
            :disabled="journalLoading || journalFollowing"
            @change="updatePriority"
          >
            <option value="all">全部</option>
            <option value="error">错误</option>
            <option value="warning">警告</option>
            <option value="info">信息</option>
            <option value="debug">调试</option>
          </select>
        </label>
        <label class="service-journal-check">
          <input
            :checked="currentBootOnly"
            type="checkbox"
            :disabled="journalLoading || journalFollowing"
            @change="updateChecked($event, 'currentBootOnly')"
          />
          <span>当前启动</span>
        </label>
        <span
          v-if="journalSourceText"
          class="service-journal-source-badge"
          data-testid="service-journal-source-badge"
        >
          {{ journalSourceText }}
        </span>
        <button
          type="button"
          class="service-journal-small-button"
          data-testid="service-journal-refresh"
          :title="journalRefreshSupported ? '刷新当前日志' : journalFollowDisabledReason"
          :disabled="journalLoading || !selectedUnitName || !journalRefreshSupported"
          @click="emit('refresh')"
        >
          {{ journalLoading ? '刷新中' : '刷新' }}
        </button>
        <button
          type="button"
          class="service-journal-small-button"
          :class="{ 'is-active': journalFollowing }"
          data-testid="service-journal-follow"
          :title="journalFollowSupported ? '开启或停止实时日志' : journalFollowDisabledReason"
          :disabled="journalFollowBusy || journalLoading || !selectedUnitName || !journalFollowSupported"
          @click="emit('toggle-follow')"
        >
          {{ journalFollowing ? '停止实时' : '开启实时' }}
        </button>
      </template>
    </div>
    <div v-if="activeDetailTab === 'logs'" class="service-journal-commandbar__row is-secondary">
      <input
        :value="query"
        class="service-journal-search"
        data-testid="service-journal-search"
        placeholder="搜索当前日志"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      />
      <label class="service-journal-check">
        <input
          :checked="autoScroll"
          type="checkbox"
          data-testid="service-journal-auto-scroll"
          @change="updateChecked($event, 'autoScroll')"
        />
        <span>自动滚动</span>
      </label>
      <label class="service-journal-check">
        <input
          :checked="wordWrap"
          type="checkbox"
          data-testid="service-journal-wrap"
          @change="updateChecked($event, 'wordWrap')"
        />
        <span>自动换行</span>
      </label>
      <button
        type="button"
        class="service-journal-small-button"
        data-testid="service-journal-clear"
        title="清空当前显示"
        @click="emit('clear')"
      >
        清空
      </button>
      <button
        type="button"
        class="service-journal-small-button"
        data-testid="service-journal-copy"
        title="复制可见日志"
        @click="emit('copy')"
      >
        复制
      </button>
      <span
        v-if="!journalFollowSupported && journalFollowDisabledReason"
        class="service-journal-follow-reason"
        data-testid="service-journal-follow-reason"
      >
        {{ journalFollowDisabledReason }}
      </span>
      <span
        class="service-journal-count"
        :class="{ error: journalStatus === 'error' }"
        data-testid="service-journal-count"
        :title="journalStatusText"
      >
        {{ journalCountText }}
      </span>
    </div>
  </div>
  <div class="service-detail-tab-content">
    <slot v-if="activeDetailTab === 'detail'" name="detail"></slot>
    <section v-else class="service-journal-panel" data-testid="service-journal-panel">
      <div
        class="service-journal-output"
        :class="{ wrap: wordWrap }"
        data-testid="service-journal-output"
        @scroll="emit('journal-scroll', $event)"
      >
        <p
          v-if="!journalRefreshSupported && journalFollowDisabledReason"
          class="empty"
          data-testid="service-journal-unavailable"
        >
          {{ journalFollowDisabledReason }}
        </p>
        <p v-else-if="visibleLines.length === 0" class="empty">暂无日志。</p>
        <div
          v-for="line in visibleLines"
          :key="`${line.sequence}-${line.timestamp || line.timestampText || ''}`"
          class="service-journal-row"
          :class="journalLineClass(line)"
          data-testid="service-journal-line"
        >
          <div class="service-journal-meta">
            <time class="service-journal-time">{{ journalTimeText(line) }}</time>
            <span class="service-journal-level">{{ line.priorityLabel }}</span>
            <span
              v-if="line.identifier"
              class="service-journal-source"
              :title="line.identifier"
              data-testid="service-journal-source"
            >
              {{ line.identifier }}
            </span>
            <span v-if="line.pid" class="service-journal-pid" data-testid="service-journal-pid">PID {{ line.pid }}</span>
            <span v-if="line.truncated" class="service-journal-truncated">已截断</span>
          </div>
          <div
            class="service-journal-message"
            :class="{ 'is-nowrap': !wordWrap }"
            data-testid="service-journal-message"
          >
            {{ line.message }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.service-detail-tabs {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.service-detail-tabs button {
  min-height: 28px;
  border-color: transparent;
  font-size: 12px;
}

.service-detail-tabs button.active {
  background: rgba(37, 99, 235, 0.18);
  color: #bfdbfe;
  box-shadow: inset 0 -2px 0 var(--primary, #60a5fa);
}

.service-detail-tab-content {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.service-journal-commandbar {
  flex: 0 0 auto;
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.34);
}

.service-journal-commandbar__row {
  min-width: 0;
  min-height: 34px;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px 10px;
}

.service-journal-inline-field {
  flex: 0 0 auto;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.service-journal-line-select,
.service-journal-level-select {
  height: 34px;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 42px 0 9px;
  font-size: 13px;
  line-height: normal;
}

.service-journal-line-select {
  width: 76px;
  min-width: 76px;
}

.service-journal-level-select {
  width: 92px;
  min-width: 92px;
}

.service-journal-search {
  flex: 0 1 220px;
  width: 220px;
  min-width: 150px;
  max-width: 240px;
  height: 34px;
  box-sizing: border-box;
  padding: 0 10px;
}

.service-journal-check {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  min-height: 34px;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.service-journal-check input {
  width: 14px;
  height: 14px;
}

.service-journal-small-button {
  flex: 0 0 auto;
  height: 34px;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 9px;
  font-size: 12px;
  white-space: nowrap;
}

.service-journal-small-button.is-active {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(37, 99, 235, 0.18);
  color: #bfdbfe;
}

.service-journal-source-badge,
.service-journal-follow-reason {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
}

.service-journal-source-badge {
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border: 1px solid rgba(96, 165, 250, 0.24);
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #bfdbfe;
}

.service-journal-follow-reason {
  max-width: 260px;
}

.service-journal-count {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--muted, #9aa8ba);
  font-size: 12px;
  white-space: nowrap;
}

.service-journal-count.error {
  color: #fca5a5;
}

.service-journal-panel {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.service-journal-output {
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: auto;
  max-height: none;
  overflow: auto;
  padding: 9px;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.16));
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.36);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
}

.service-journal-row {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  color: #dbeafe;
}

.service-journal-row:last-child {
  border-bottom: 0;
}

.service-journal-meta {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 4px 8px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.4;
}

.service-journal-time,
.service-journal-level,
.service-journal-source,
.service-journal-pid,
.service-journal-truncated {
  min-width: 0;
}

.service-journal-time,
.service-journal-level,
.service-journal-pid,
.service-journal-truncated {
  flex: 0 0 auto;
  white-space: nowrap;
}

.service-journal-level {
  min-height: 19px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: #bfdbfe;
}

.service-journal-source {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-journal-pid,
.service-journal-truncated {
  color: #cbd5e1;
}

.service-journal-message {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: normal;
  line-height: 1.55;
  color: #dbeafe;
}

.service-journal-message.is-nowrap {
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  overflow-x: auto;
}

.service-journal-output:not(.wrap) .service-journal-message {
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
}

.service-journal-row.error .service-journal-level {
  background: rgba(239, 68, 68, 0.16);
  color: #fecaca;
}

.service-journal-row.error .service-journal-message {
  color: #fca5a5;
}

.service-journal-row.warning .service-journal-level {
  background: rgba(245, 158, 11, 0.16);
  color: #fde68a;
}

.service-journal-row.warning .service-journal-message {
  color: #fde68a;
}

.service-journal-row.notice .service-journal-level {
  background: rgba(139, 92, 246, 0.16);
  color: #c4b5fd;
}

.service-journal-row.debug .service-journal-level {
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
}

.service-journal-row.debug .service-journal-message {
  color: #93c5fd;
}

.empty {
  margin: 0;
  color: var(--muted, #9aa8ba);
  font-size: 13px;
}

@media (max-width: 900px) {
  .service-journal-commandbar {
    gap: 5px;
    padding: 5px 7px;
  }

  .service-journal-commandbar__row {
    overflow-x: auto;
    overflow-y: hidden;
    gap: 6px;
  }

  .service-journal-search {
    flex: 0 0 160px;
    width: 160px;
    min-width: 160px;
  }

  .service-journal-source {
    max-width: 140px;
  }
}

@media (max-width: 700px) {
  .service-journal-meta {
    gap: 4px 8px;
  }

  .service-journal-source {
    max-width: 100%;
  }
}
</style>
