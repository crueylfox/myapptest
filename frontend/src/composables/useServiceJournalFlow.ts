import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { ServiceJournalLine, ServiceJournalPriority, SystemServiceJournalRequest } from '../types'
import {
  errorMessage,
  filterJournalLines,
  formatJournalCopyLine,
  journalCountText as buildJournalCountText,
  journalStatusText as buildJournalStatusText,
} from './serviceManagerModel'

type NotifyKind = 'success' | 'error' | 'info'

export interface UseServiceJournalFlowOptions {
  open: Ref<boolean>
  selectedServerID: Ref<number>
  selectedUnitName: Ref<string>
  journalLines: ComputedRef<ServiceJournalLine[]>
  journalStatus: ComputedRef<string>
  journalError: ComputedRef<string>
  journalOverflow: ComputedRef<boolean>
  journalFollowing: ComputedRef<boolean>
  journalRefreshSupported?: ComputedRef<boolean>
  journalFollowSupported?: ComputedRef<boolean>
  journalFollowDisabledReason?: ComputedRef<string>
  loadJournal: (request: SystemServiceJournalRequest) => Promise<unknown>
  startFollow: (request: SystemServiceJournalRequest) => Promise<unknown>
  stopFollow: (serverID: number, unitName: string) => Promise<unknown>
  stopServerRuntime: (serverID: number) => Promise<unknown>
  clearJournal: (serverID: number, unitName: string) => void
  notify: (message: string, type: NotifyKind) => void
  writeClipboard?: (text: string) => Promise<unknown>
  afterDomUpdate?: () => Promise<void>
}

export function useServiceJournalFlow(options: UseServiceJournalFlowOptions) {
  const journalLineLimit = ref(200)
  const journalPriority = ref<ServiceJournalPriority>('all')
  const journalCurrentBootOnly = ref(true)
  const journalQuery = ref('')
  const journalAutoScroll = ref(true)
  const journalWordWrap = ref(true)
  const journalLoading = ref(false)
  const journalFollowBusy = ref(false)
  const journalViewport = ref<HTMLElement | null>(null)
  let journalSerial = 0

  const journalRefreshSupported = computed(() => options.journalRefreshSupported?.value !== false)
  const journalFollowSupported = computed(() => options.journalFollowSupported?.value !== false)
  const journalDisabledReason = computed(() => options.journalFollowDisabledReason?.value || 'Service log action is not supported.')

  const visibleJournalLines = computed(() =>
    filterJournalLines(options.journalLines.value, journalQuery.value))

  const journalStatusText = computed(() => buildJournalStatusText({
    hasSelectedService: Boolean(options.selectedUnitName.value),
    loading: journalLoading.value,
    following: options.journalFollowing.value,
    status: options.journalStatus.value,
    error: options.journalError.value,
    overflow: options.journalOverflow.value,
    visibleCount: visibleJournalLines.value.length,
    totalCount: options.journalLines.value.length,
  }))

  const journalCountText = computed(() => buildJournalCountText({
    loading: journalLoading.value,
    status: options.journalStatus.value,
    overflow: options.journalOverflow.value,
    visibleCount: visibleJournalLines.value.length,
    totalCount: options.journalLines.value.length,
  }))

  function journalRequest(): SystemServiceJournalRequest {
    return {
      serverID: options.selectedServerID.value,
      unitName: options.selectedUnitName.value,
      lineLimit: journalLineLimit.value,
      priority: journalPriority.value,
      currentBootOnly: journalCurrentBootOnly.value,
    }
  }

  function cancelPendingJournalWork() {
    journalSerial++
  }

  async function loadJournalSnapshot(showSuccess = true) {
    if (!options.open.value || !options.selectedServerID.value || !options.selectedUnitName.value) return
    if (!journalRefreshSupported.value) {
      if (showSuccess) options.notify(journalDisabledReason.value, 'info')
      return
    }
    const serial = ++journalSerial
    journalLoading.value = true
    try {
      await options.loadJournal(journalRequest())
      if (!options.open.value || serial !== journalSerial) return
      if (showSuccess) options.notify('系统服务日志已刷新。', 'success')
      await afterDomUpdate()
      scrollJournalToBottom()
    } catch (reason) {
      if (!options.open.value || serial !== journalSerial) return
      options.notify(errorMessage(reason, '读取系统服务日志失败。'), 'error')
    } finally {
      if (serial === journalSerial) journalLoading.value = false
    }
  }

  async function toggleJournalFollow() {
    if (!options.open.value || !options.selectedServerID.value || !options.selectedUnitName.value || journalFollowBusy.value) return
    if (!options.journalFollowing.value && !journalFollowSupported.value) {
      options.notify(journalDisabledReason.value, 'info')
      return
    }
    journalFollowBusy.value = true
    try {
      if (options.journalFollowing.value) {
        await options.stopFollow(options.selectedServerID.value, options.selectedUnitName.value)
        options.notify('系统服务实时日志已停止。', 'info')
      } else {
        await options.startFollow(journalRequest())
        journalAutoScroll.value = true
        options.notify('系统服务实时日志已开启。', 'success')
      }
    } catch (reason) {
      options.notify(errorMessage(reason, '实时日志操作失败。'), 'error')
    } finally {
      journalFollowBusy.value = false
    }
  }

  async function stopSelectedJournalFollow() {
    if (!options.selectedServerID.value || !options.selectedUnitName.value) return
    await options.stopFollow(options.selectedServerID.value, options.selectedUnitName.value)
  }

  async function stopServerJournalRuntime(serverID: number) {
    await options.stopServerRuntime(serverID).catch(() => undefined)
  }

  function clearJournalDisplay() {
    if (!options.selectedServerID.value || !options.selectedUnitName.value) return
    options.clearJournal(options.selectedServerID.value, options.selectedUnitName.value)
  }

  async function copyVisibleJournal() {
    const text = visibleJournalLines.value.map(formatJournalCopyLine).join('\n')
    if (!text) {
      options.notify('没有可复制的日志。', 'info')
      return
    }
    if (options.writeClipboard) {
      await options.writeClipboard(text)
    } else {
      await navigator.clipboard?.writeText(text)
    }
    options.notify('已复制当前可见日志。', 'success')
  }

  function onJournalScroll(event?: Event) {
    const el = (event?.target as HTMLElement | null) ?? journalViewport.value
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    journalAutoScroll.value = distance < 24
  }

  function scrollJournalToBottom() {
    const el = journalViewport.value
    if (el) el.scrollTop = el.scrollHeight
  }

  async function afterDomUpdate() {
    if (options.afterDomUpdate) await options.afterDomUpdate()
  }

  return {
    journalAutoScroll,
    journalCountText,
    journalCurrentBootOnly,
    journalFollowBusy,
    journalLineLimit,
    journalLoading,
    journalPriority,
    journalQuery,
    journalStatusText,
    journalViewport,
    journalWordWrap,
    visibleJournalLines,
    cancelPendingJournalWork,
    clearJournalDisplay,
    copyVisibleJournal,
    journalRequest,
    loadJournalSnapshot,
    onJournalScroll,
    scrollJournalToBottom,
    stopSelectedJournalFollow,
    stopServerJournalRuntime,
    toggleJournalFollow,
  }
}
