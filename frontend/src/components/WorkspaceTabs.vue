<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLocalTerminalStore } from '../stores/localTerminal'
import { useSftpStore } from '../stores/sftp'
import { useTerminalStore } from '../stores/terminal'
import type { ContextMenuItem, LocalTerminalState, ServerWorkspace, TerminalSessionInfo } from '../types'
import ContextMenu from './ContextMenu.vue'
import AppIcon from './icons/AppIcon.vue'
import AppPopover from './primitives/AppPopover.vue'
import { Quit, WindowMinimise, WindowToggleMaximise } from '../../wailsjs/runtime/runtime'

const TAB_DRAG_THRESHOLD = 6
type SplitMode = 'single' | 'vertical' | 'horizontal' | 'quad'

type DisplayTab =
  | { key: string; serverId: number; kind: 'workspace'; workspace: ServerWorkspace }
  | { key: string; serverId: number; kind: 'terminal'; terminal: TerminalSessionInfo; index: number; count: number }
  | { key: string; kind: 'local'; local: LocalTerminalState }

const emit = defineEmits<{
  servers: [anchor: HTMLElement]
  monitorPanel: []
  alerts: []
  tunnels: []
  docker: []
  processes: []
  systemServices: []
  networkDiagnostics: []
  navigate: [view: 'terminals' | 'monitor' | 'logs' | 'settings']
  newTerminal: [connectionId?: number]
  reconnect: [sessionId: string, connectionId: number, code: string]
  editServer: [connectionId: number]
  disconnectServer: [connectionId: number]
  finalTerminalDisconnect: [connectionId: number]
  contextOpen: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()
const props = withDefaults(defineProps<{
  alertUnreadCount?: number
}>(), {
  alertUnreadCount: 0,
})
const store = useTerminalStore()
const localStore = useLocalTerminalStore()
const sftpStore = useSftpStore()
const addButton = ref<HTMLButtonElement>()
const tabsHost = ref<HTMLElement>()
const navigation = ref<HTMLElement>()
const navigationOpen = ref(false)
const splitMenuOpen = ref(false)
const tabMenu = ref<{ x: number; y: number; kind: 'terminal' | 'workspace' | 'local'; serverId?: number; sessionId?: string } | null>(null)
const draggedTabKey = ref<string | null>(null)
const dropTarget = ref<{ key: string; before: boolean } | null>(null)
const tabOrder = ref<string[]>([])
const autoRemovedLocalSessions = new Set<string>()
let tabDrag: { key: string; startX: number; startY: number; active: boolean } | null = null
const suppressTabClickKey = ref<string | null>(null)
const splitLayoutStorageKey = 'hostdeck.workspaceSplitLayout.v1'

function isSplitMode(value: unknown): value is SplitMode {
  return value === 'single' || value === 'vertical' || value === 'horizontal' || value === 'quad'
}

function readStoredSplitMode(): SplitMode {
  try {
    const parsed = JSON.parse(localStorage.getItem(splitLayoutStorageKey) ?? '{}') as { splitMode?: unknown }
    return isSplitMode(parsed.splitMode) ? parsed.splitMode : 'single'
  } catch {
    return 'single'
  }
}

const splitMode = ref<SplitMode>(readStoredSplitMode())
const splitModeLabel = computed(() => ({
  single: '单窗格',
  vertical: '左右分屏',
  horizontal: '上下分屏',
  quad: '四宫格',
}[splitMode.value]))

const candidateTabs = computed<DisplayTab[]>(() => {
  const result: DisplayTab[] = []
  const seenServers = new Set<number>()
  const terminalIndexByServer: Record<number, number> = {}
  for (const terminal of store.tabs) {
    const count = store.sessionsByServerId[terminal.connectionId]?.length ?? 1
    const index = terminalIndexByServer[terminal.connectionId] ?? 0
    terminalIndexByServer[terminal.connectionId] = index + 1
    seenServers.add(terminal.connectionId)
    result.push({
      key: `terminal-${terminal.sessionId}`,
      serverId: terminal.connectionId,
      kind: 'terminal' as const,
      terminal,
      index,
      count,
    })
  }
  for (const serverId of store.workspaceOrder) {
    if (seenServers.has(serverId)) continue
    const workspace = store.workspaces[serverId]
    if (!workspace) continue
    result.push({
      key: `workspace-${serverId}`,
      serverId,
      kind: 'workspace' as const,
      workspace,
    })
  }
  result.push(...localStore.sessions.map((local) => ({
    key: `local-${local.sessionId}`,
    kind: 'local' as const,
    local,
  })))
  return result
})

const displayTabs = computed<DisplayTab[]>(() => {
  const byKey = new Map(candidateTabs.value.map((item) => [item.key, item]))
  return tabOrder.value
    .map((key) => byKey.get(key))
    .filter((item): item is DisplayTab => Boolean(item))
})
const activeTabKey = computed(() => displayTabs.value.find((item) => isActive(item))?.key ?? null)

const tabMenuItems = computed<ContextMenuItem[]>(() => {
  if (tabMenu.value?.kind === 'local') {
    const sessionId = tabMenu.value.sessionId ?? ''
    const closeLocalItem = { id: 'close-local', label: '关闭本地终端' }
    return [
      {
        id: 'clear-activity',
        label: '清除新输出标记',
        disabled: !localStore.outputActivityBySession[sessionId]?.hasActivity,
      },
      { id: 'separator-activity', label: '', separator: true },
      closeLocalItem,
    ]
  }
  const serverId = tabMenu.value?.serverId ?? 0
  const serverSessions = serverId ? store.sessionsByServerId[serverId] ?? [] : []
  const target = tabMenu.value?.sessionId
    ? store.tabs.find((tab) => tab.sessionId === tabMenu.value?.sessionId)
    : null
  if (tabMenu.value?.kind === 'terminal') {
    const hasActivity = Boolean(target && store.outputActivityBySession[target.sessionId]?.hasActivity)
    return [
      { id: 'edit-server', label: '编辑' },
      { id: 'new', label: '新建同服务器终端' },
      { id: 'reconnect', label: '重新连接', disabled: target?.status === 'connecting' },
      { id: 'clear-activity', label: '清除新输出标记', disabled: !hasActivity },
      { id: 'separator-session', label: '', separator: true },
      { id: 'close-session', label: '仅关闭当前终端' },
      { id: 'close-server-terminals', label: '关闭此服务器全部终端', disabled: !serverSessions.length },
      { id: 'separator-server', label: '', separator: true },
      { id: 'disconnect-server', label: '断开此服务器', danger: true },
    ]
  }
  return [
    { id: 'edit-server', label: '编辑' },
    { id: 'new', label: '新建同服务器终端' },
    { id: 'reconnect', label: '重新连接', disabled: !serverSessions.length },
    { id: 'separator', label: '', separator: true },
    { id: 'close-server-terminals', label: '关闭此服务器全部终端', disabled: !serverSessions.length },
    { id: 'disconnect-server', label: '断开此服务器', danger: true },
  ]
})

function dot(workspace: ServerWorkspace) {
  if (workspace.status === 'failed') return 'error'
  if (workspace.status === 'connected') return 'online'
  if (workspace.status === 'connecting' || workspace.status === 'reconnecting') return 'connecting'
  return 'offline'
}

function tabStatus(item: DisplayTab) {
  if (item.kind === 'local') {
    if (item.local.status === 'running') return 'online'
    if (item.local.status === 'starting') return 'connecting'
    if (item.local.status === 'failed') return 'error'
    return 'offline'
  }
  return item.kind === 'terminal' ? item.terminal.status : dot(item.workspace)
}

function tabTitle(item: DisplayTab) {
  if (item.kind === 'local') return item.local.title || item.local.shell || '本地终端'
  if (item.kind === 'terminal') {
    if (item.count <= 1) return item.terminal.title
    return item.index === 0 ? item.terminal.title : `${item.terminal.title} #${item.index + 1}`
  }
  return item.workspace.serverName
}

function isActive(item: DisplayTab) {
  if (item.kind === 'local') return item.local.sessionId === localStore.activeSessionId
  if (item.kind === 'terminal') return item.terminal.sessionId === store.activeSessionId
  return item.serverId === store.activeWorkspaceServerId && !store.activeSessionId
}

function tabActivityState(item: DisplayTab) {
  if (item.kind === 'terminal') return store.outputActivityBySession[item.terminal.sessionId]
  if (item.kind === 'local') return localStore.outputActivityBySession[item.local.sessionId]
  return undefined
}

function tabActivityLabel(item: DisplayTab) {
  if (item.kind === 'terminal') return store.outputActivityLabel(item.terminal.sessionId)
  if (item.kind === 'local') return localStore.outputActivityLabel(item.local.sessionId)
  return ''
}

function tabActivityTitle(item: DisplayTab) {
  const label = tabActivityLabel(item)
  return label ? `${label} 条新输出` : '有新输出'
}

function activate(item: DisplayTab) {
  if (suppressTabClickKey.value === item.key) {
    suppressTabClickKey.value = null
    return
  }
  if (item.kind === 'local') {
    store.clearActiveWorkspace()
    localStore.activate(item.local.sessionId)
  } else if (item.kind === 'terminal') {
    localStore.activeSessionId = null
    store.activate(item.terminal.sessionId)
  } else {
    localStore.activeSessionId = null
    store.activateWorkspaceServer(item.serverId)
  }
  emit('navigate', 'terminals')
}

function persistTopbarSplitMode() {
  let parsed: Record<string, unknown> = {}
  try {
    const value = JSON.parse(localStorage.getItem(splitLayoutStorageKey) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>
  } catch {
    parsed = {}
  }
  parsed.splitMode = splitMode.value
  localStorage.setItem(splitLayoutStorageKey, JSON.stringify(parsed))
}

function setTopbarSplitMode(mode: SplitMode) {
  splitMode.value = mode
  splitMenuOpen.value = false
  navigationOpen.value = false
  persistTopbarSplitMode()
  window.dispatchEvent(new CustomEvent('hostdeck:workspace-split-mode-change', {
    detail: { mode },
  }))
}

function resetTopbarSplitRatios() {
  if (splitMode.value === 'single') return
  splitMenuOpen.value = false
  navigationOpen.value = false
  window.dispatchEvent(new CustomEvent('hostdeck:workspace-split-ratio-reset'))
}

function clearTopbarSplitPanes() {
  splitMenuOpen.value = false
  navigationOpen.value = false
  window.dispatchEvent(new CustomEvent('hostdeck:workspace-split-clear-panes'))
}

function openMenu(event: MouseEvent, item: DisplayTab) {
  navigationOpen.value = false
  emit('contextOpen')
  tabMenu.value = {
    x: event.clientX,
    y: event.clientY,
    kind: item.kind,
    serverId: item.kind === 'local' ? undefined : item.serverId,
    sessionId: item.kind === 'local' ? item.local.sessionId : item.kind === 'terminal' ? item.terminal.sessionId : undefined,
  }
}

async function selectMenu(id: string) {
  const menu = tabMenu.value
  if (!menu) return
  if (menu.kind === 'local') {
    if (id === 'clear-activity' && menu.sessionId) localStore.clearOutputActivity(menu.sessionId)
    if (id === 'close-local' && menu.sessionId) await closeLocalTab(menu.sessionId)
    tabMenu.value = null
    return
  }
  if (!menu.serverId) {
    tabMenu.value = null
    return
  }
  const target = menu.sessionId
    ? store.tabs.find((tab) => tab.sessionId === menu.sessionId)
    : (store.sessionsByServerId[menu.serverId]?.[0] ?? null)
  if (id === 'edit-server') emit('editServer', menu.serverId)
  if (id === 'new') emit('newTerminal', menu.serverId)
  if (id === 'reconnect') {
    if (target) emit('reconnect', target.sessionId, target.connectionId, target.code)
    else emit('newTerminal', menu.serverId)
  }
  if (id === 'clear-activity' && menu.sessionId) store.clearOutputActivity(menu.sessionId)
  if (id === 'close-session' && menu.sessionId) await closeTerminalTab(menu.sessionId)
  if (id === 'close-server-terminals') closeFinalServerTab(menu.serverId)
  if (id === 'disconnect-server') emit('disconnectServer', menu.serverId)
  tabMenu.value = null
}

function openServers() {
  if (!addButton.value) return
  navigationOpen.value = false
  tabMenu.value = null
  emit('servers', addButton.value)
}

async function closeTab(item: DisplayTab) {
  if (item.kind === 'local') {
    await closeLocalTab(item.local.sessionId)
    return
  }
  if (item.kind === 'terminal') {
    await closeTerminalTab(item.terminal.sessionId)
    return
  }
  emit('disconnectServer', item.serverId)
}

async function closeLocalTab(sessionId: string) {
  const item = displayTabs.value.find((tab) => tab.kind === 'local' && tab.local.sessionId === sessionId)
  const key = item?.key ?? `local-${sessionId}`
  const previousTabs = displayTabs.value
  const previousIndex = previousTabs.findIndex((tab) => tab.key === key)
  const wasActive = sessionId === localStore.activeSessionId
  await localStore.close(sessionId)
  removeTabOrderKey(key)
  activateFallbackIfNeeded(wasActive, previousIndex)
}

function removeTabOrderKey(key: string) {
  tabOrder.value = tabOrder.value.filter((candidate) => candidate !== key)
}

function activateFallbackIfNeeded(wasActive: boolean, previousIndex: number) {
  if (
    !wasActive ||
    localStore.activeSessionId ||
    store.activeWorkspaceServerId ||
    store.activeSessionId
  ) return
  const remainingTabs = displayTabs.value
  const fallback = remainingTabs[Math.min(Math.max(previousIndex - 1, 0), remainingTabs.length - 1)]
  if (fallback) activate(fallback)
}

async function closeTerminalTab(sessionId: string) {
  const tab = store.tabs.find((candidate) => candidate.sessionId === sessionId)
  if (tab && (store.sessionsByServerId[tab.connectionId] ?? []).length <= 1) {
    closeFinalServerTab(tab.connectionId)
    return
  }
  const terminalClose = store.closeSession(sessionId)
  const sftpClose = tab
    ? sftpStore.closeContextForTerminal(tab.connectionId, sessionId)
    : Promise.resolve()
  const results = await Promise.allSettled([terminalClose, sftpClose])
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) {
    emit('notify', errorMessage(failed.reason, '关闭当前终端失败'), 'error')
  }
}

function closeFinalServerTab(connectionId: number) {
  store.removeWorkspaceLocal(connectionId)
  emit('finalTerminalDisconnect', connectionId)
}

function syncTabOrder(tabs: DisplayTab[]) {
  const keys = new Set(tabs.map((tab) => tab.key))
  const next = tabOrder.value.filter((key) => keys.has(key))
  const existing = new Set(next)
  for (const tab of tabs) {
    if (!existing.has(tab.key)) {
      next.push(tab.key)
      existing.add(tab.key)
    }
  }
  tabOrder.value = next
}

function removeExitedLocalTab(local: LocalTerminalState) {
  if (autoRemovedLocalSessions.has(local.sessionId)) return
  autoRemovedLocalSessions.add(local.sessionId)
  const key = `local-${local.sessionId}`
  const previousTabs = displayTabs.value
  const previousIndex = previousTabs.findIndex((tab) => tab.key === key)
  const wasActive = local.sessionId === localStore.activeSessionId
  localStore.removeExited(local.sessionId)
  removeTabOrderKey(key)
  activateFallbackIfNeeded(wasActive, previousIndex)
  emit(
    'notify',
    local.status === 'failed' ? (local.error || '本地终端已退出') : '本地终端已退出',
    local.status === 'failed' ? 'error' : 'info',
  )
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

function navigate(view: 'terminals' | 'monitor' | 'logs' | 'settings') {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('navigate', view)
}

function openTunnels() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('tunnels')
}

function openMonitorPanel() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('monitorPanel')
}

function openAlerts() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('alerts')
}

function openDocker() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('docker')
}

function openProcesses() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('processes')
}

function openSystemServices() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('systemServices')
}

function openNetworkDiagnostics() {
  navigationOpen.value = false
  splitMenuOpen.value = false
  emit('networkDiagnostics')
}

function minimiseWindow() {
  WindowMinimise()
}

function toggleMaximiseWindow() {
  WindowToggleMaximise()
}

function closeWindow() {
  Quit()
}

function reorderTabOrderKey(sourceKey: string, targetKey: string, before: boolean) {
  const current = tabOrder.value.filter((key) => key !== sourceKey)
  const targetIndex = current.indexOf(targetKey)
  if (targetIndex < 0) return
  current.splice(before ? targetIndex : targetIndex + 1, 0, sourceKey)
  tabOrder.value = current
}

function tabByKey(key: string) {
  return candidateTabs.value.find((tab) => tab.key === key) ?? null
}

function emitExternalTabDrop(key: string, event: PointerEvent) {
  const tab = tabByKey(key)
  const dropEvent = new CustomEvent('hostdeck:workspace-tab-external-drop', {
    cancelable: true,
    detail: {
      key,
      kind: tab?.kind,
      sessionId: tab?.kind === 'terminal' ? tab.terminal.sessionId : undefined,
      localSessionId: tab?.kind === 'local' ? tab.local.sessionId : undefined,
      serverId: tab?.kind === 'workspace' ? tab.serverId : tab?.kind === 'terminal' ? tab.serverId : undefined,
      clientX: event.clientX,
      clientY: event.clientY,
    },
  })
  window.dispatchEvent(dropEvent)
  return dropEvent.defaultPrevented
}

function maybePersistWorkspaceOrder(sourceKey: string, targetKey: string, before: boolean) {
  const source = tabByKey(sourceKey)
  const target = tabByKey(targetKey)
  if (source?.kind !== 'workspace' || target?.kind !== 'workspace') return
  store.reorderWorkspace(source.serverId, target.serverId, before)
}

function startTabDrag(item: DisplayTab, event: PointerEvent) {
  if (event.button !== 0) return
  if ((event.target as HTMLElement).closest('.terminal-close')) return
  tabDrag = { key: item.key, startX: event.clientX, startY: event.clientY, active: false }
  window.addEventListener('pointermove', moveTabDrag, true)
  window.addEventListener('pointerup', endTabDrag, true)
}

function targetTabFromPointer(event: PointerEvent) {
  const tabs = Array.from(tabsHost.value?.querySelectorAll<HTMLElement>('.terminal-tab') ?? [])
  for (const tab of tabs) {
    const key = tab.dataset.tabKey
    if (!key || key === tabDrag?.key) continue
    const bounds = tab.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) continue
    return {
      key,
      before: event.clientX < bounds.left + bounds.width / 2,
    }
  }
  return null
}

function tabElementByKey(key: string | null) {
  if (!key || !tabsHost.value) return null
  return Array.from(tabsHost.value.querySelectorAll<HTMLElement>('.terminal-tab'))
    .find((element) => element.dataset.tabKey === key) ?? null
}

function scrollActiveTabIntoView(focus = false) {
  const element = tabElementByKey(activeTabKey.value)
  if (!element) return
  if (focus) element.focus({ preventScroll: true })
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

function activeOrFocusedTabIndex() {
  const tabs = displayTabs.value
  const activeIndex = tabs.findIndex((item) => item.key === activeTabKey.value)
  if (activeIndex >= 0) return activeIndex
  const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.tabKey
  const focusedIndex = tabs.findIndex((item) => item.key === focusedKey)
  return focusedIndex >= 0 ? focusedIndex : 0
}

function activateTabByIndex(index: number) {
  const item = displayTabs.value[index]
  if (!item) return
  activate(item)
  void nextTick(() => scrollActiveTabIntoView(true))
}

function handleTabsKeydown(event: KeyboardEvent) {
  const host = tabsHost.value
  if (!host || !host.contains(event.target as Node)) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"], .terminal-close, .topbar-add')) return
  if (target !== host && !target.closest('.terminal-tab')) return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = displayTabs.value
  if (!tabs.length) return

  event.preventDefault()
  event.stopPropagation()
  const index = activeOrFocusedTabIndex()
  if (event.key === 'Home') {
    activateTabByIndex(0)
    return
  }
  if (event.key === 'End') {
    activateTabByIndex(tabs.length - 1)
    return
  }
  if (event.key === 'ArrowLeft') {
    activateTabByIndex(index <= 0 ? tabs.length - 1 : index - 1)
    return
  }
  activateTabByIndex(index >= tabs.length - 1 ? 0 : index + 1)
}

function handleTabsWheel(event: WheelEvent) {
  const host = tabsHost.value
  if (!host) return
  const maxScroll = host.scrollWidth - host.clientWidth
  if (maxScroll <= 1) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (delta === 0) return
  host.scrollLeft = Math.min(Math.max(host.scrollLeft + delta, 0), maxScroll)
  event.preventDefault()
}

function pointerOutsideTabsHost(event: PointerEvent) {
  const bounds = tabsHost.value?.getBoundingClientRect()
  if (!bounds) return false
  return event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
}

function moveTabDrag(event: PointerEvent) {
  if (!tabDrag) return
  const distance = Math.hypot(event.clientX - tabDrag.startX, event.clientY - tabDrag.startY)
  if (!tabDrag.active) {
    if (distance < TAB_DRAG_THRESHOLD) return
    tabDrag.active = true
    draggedTabKey.value = tabDrag.key
    document.body.classList.add('workspace-tab-dragging-active')
  }
  event.preventDefault()
  dropTarget.value = targetTabFromPointer(event)
}

function cleanupTabDrag() {
  window.removeEventListener('pointermove', moveTabDrag, true)
  window.removeEventListener('pointerup', endTabDrag, true)
  document.body.classList.remove('workspace-tab-dragging-active')
  tabDrag = null
  draggedTabKey.value = null
  dropTarget.value = null
}

function endTabDrag(event: PointerEvent) {
  const state = tabDrag
  const target = dropTarget.value
  if (state?.active) {
    event.preventDefault()
    suppressTabClickKey.value = state.key
    window.setTimeout(() => {
      if (suppressTabClickKey.value === state.key) suppressTabClickKey.value = null
    }, 0)
    if (target) {
      reorderTabOrderKey(state.key, target.key, target.before)
      maybePersistWorkspaceOrder(state.key, target.key, target.before)
    } else if (pointerOutsideTabsHost(event)) {
      if (emitExternalTabDrop(state.key, event)) {
        cleanupTabDrag()
        return
      }
      emit('notify', '当前版本暂不支持拖出为新窗口。', 'info')
    }
  }
  cleanupTabDrag()
}

function closeNavigationOnPointer(event: PointerEvent) {
  const target = event.target as Node
  if (navigationOpen.value && !navigation.value?.contains(target)) {
    navigationOpen.value = false
    splitMenuOpen.value = false
  }
}

function closeNavigationOnKey(event: KeyboardEvent) {
  if (event.key === 'Escape') navigationOpen.value = false
  if (event.key === 'Escape') splitMenuOpen.value = false
}

onMounted(() => {
  window.addEventListener('pointerdown', closeNavigationOnPointer, true)
  window.addEventListener('keydown', closeNavigationOnKey, true)
})

watch(candidateTabs, (tabs) => {
  syncTabOrder(tabs)
}, { immediate: true })

watch(() => [
  activeTabKey.value,
  displayTabs.value.map((item) => item.key).join('|'),
] as const, async () => {
  await nextTick()
  scrollActiveTabIntoView()
}, { flush: 'post' })

watch(() => localStore.sessions.map((session) => ({
  sessionId: session.sessionId,
  status: session.status,
  error: session.error,
})), (states) => {
  for (const state of states) {
    if (state.status !== 'exited' && state.status !== 'failed') continue
    const local = localStore.sessions.find((session) => session.sessionId === state.sessionId)
    if (local) removeExitedLocalTab(local)
  }
}, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeNavigationOnPointer, true)
  window.removeEventListener('keydown', closeNavigationOnKey, true)
  cleanupTabDrag()
})
</script>

<template>
  <header class="workspace-topbar">
    <div
      ref="tabsHost"
      class="workspace-tabs"
      data-native-detach-supported="false"
      role="tablist"
      tabindex="0"
      @wheel="handleTabsWheel"
      @keydown="handleTabsKeydown"
      @scroll.passive
    >
      <button
        v-for="item in displayTabs"
        :key="item.key"
        class="terminal-tab"
        :class="{
          active: isActive(item),
          dragging: draggedTabKey === item.key,
          'drop-before': dropTarget?.key === item.key && dropTarget.before,
          'drop-after': dropTarget?.key === item.key && !dropTarget.before,
        }"
        :data-tab-key="item.key"
        :data-session-id="item.kind === 'terminal' ? item.terminal.sessionId : undefined"
        :data-local-session-id="item.kind === 'local' ? item.local.sessionId : undefined"
        role="tab"
        :aria-selected="isActive(item)"
        :tabindex="isActive(item) ? 0 : -1"
        @click="activate(item)"
        @contextmenu.prevent.stop="openMenu($event, item)"
        @pointerdown="startTabDrag(item, $event)"
      >
        <i class="status-dot" :class="tabStatus(item)"></i>
        <span class="terminal-tab-title">{{ tabTitle(item) }}</span>
        <span
          v-if="tabActivityState(item)?.hasActivity"
          class="terminal-activity-badge"
          :title="tabActivityTitle(item)"
          data-terminal-activity-badge
        >{{ tabActivityLabel(item) }}</span>
        <span
          class="terminal-close"
          :title="item.kind === 'local' ? '关闭本地终端' : item.kind === 'terminal' ? '仅关闭当前终端' : '断开此服务器'"
          draggable="false"
          @pointerdown.stop.prevent
          @mousedown.stop.prevent
          @click.stop.prevent="closeTab(item)"
        >×</span>
      </button>
      <button ref="addButton" class="topbar-add" title="服务器" @click="openServers">+</button>
    </div>
    <div ref="navigation" class="topbar-navigation">
      <button class="topbar-navigation-button" :aria-expanded="navigationOpen" @click="navigationOpen = !navigationOpen">
        <span class="topbar-action-inner">
          <AppIcon name="menu" :size="16" />
          <span>菜单</span>
        </span>
      </button>
      <AppPopover v-if="navigationOpen" :viewport="false" class="topbar-menu">
        <button class="topbar-menu-item active" @click="navigate('terminals')"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="terminal" :size="18" /><span class="topbar-menu-label">SSH 工作区</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button
          class="topbar-menu-item topbar-menu-split-toggle"
          type="button"
          data-split-menu-toggle
          :aria-expanded="splitMenuOpen"
          :aria-label="`分屏，当前：${splitModeLabel}`"
          @click.stop="splitMenuOpen = !splitMenuOpen"
        >
          <span class="topbar-menu-leading" aria-hidden="true"></span>
          <span class="topbar-menu-content"><AppIcon name="layout-grid" :size="18" /><span class="topbar-menu-label">分屏</span></span>
          <span class="topbar-menu-trailing">{{ splitMenuOpen ? '收起' : splitModeLabel }}</span>
        </button>
        <template v-if="splitMenuOpen">
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-mode="single"
            :class="{ active: splitMode === 'single' }"
            :aria-current="splitMode === 'single' ? 'true' : undefined"
            @click="setTopbarSplitMode('single')"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">单窗格</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-mode="vertical"
            :class="{ active: splitMode === 'vertical' }"
            :aria-current="splitMode === 'vertical' ? 'true' : undefined"
            @click="setTopbarSplitMode('vertical')"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">左右分屏</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-mode="horizontal"
            :class="{ active: splitMode === 'horizontal' }"
            :aria-current="splitMode === 'horizontal' ? 'true' : undefined"
            @click="setTopbarSplitMode('horizontal')"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">上下分屏</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-mode="quad"
            :class="{ active: splitMode === 'quad' }"
            :aria-current="splitMode === 'quad' ? 'true' : undefined"
            @click="setTopbarSplitMode('quad')"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">四宫格</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-mode="close"
            @click="setTopbarSplitMode('single')"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">关闭分屏</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-action="reset-ratios"
            :disabled="splitMode === 'single'"
            @click="resetTopbarSplitRatios"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">重置分割比例</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
          <button
            type="button"
            class="topbar-menu-item topbar-menu-subitem"
            data-split-action="clear-panes"
            @click="clearTopbarSplitPanes"
          ><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><span class="topbar-menu-label">清空所有窗格</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        </template>
        <button class="topbar-menu-item" @click="openTunnels"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="route" :size="18" /><span class="topbar-menu-label">端口转发</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button class="topbar-menu-item" @click="openDocker"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="box" :size="18" /><span class="topbar-menu-label">容器管理</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button class="topbar-menu-item" @click="openProcesses"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="activity" :size="18" /><span class="topbar-menu-label">进程管理</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button class="topbar-menu-item" @click="openSystemServices"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="service" :size="18" /><span class="topbar-menu-label">系统服务</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button class="topbar-menu-item" @click="openNetworkDiagnostics"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="network" :size="18" /><span class="topbar-menu-label">网络详情</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button class="topbar-menu-item topbar-menu-badge-row" @click="openAlerts">
          <span class="topbar-menu-leading" aria-hidden="true"></span>
          <span class="topbar-menu-content"><AppIcon name="bell" :size="18" /><span class="topbar-menu-label">告警中心</span></span>
          <span class="topbar-menu-trailing"><span v-if="props.alertUnreadCount > 0" class="topbar-menu-badge">{{ props.alertUnreadCount }}</span></span>
        </button>
        <button class="topbar-menu-item" @click="openMonitorPanel"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="gauge" :size="18" /><span class="topbar-menu-label">监控面板</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
        <button class="topbar-menu-item" @click="navigate('settings')"><span class="topbar-menu-leading" aria-hidden="true"></span><span class="topbar-menu-content"><AppIcon name="gear" :size="18" /><span class="topbar-menu-label">设置</span></span><span class="topbar-menu-trailing" aria-hidden="true"></span></button>
      </AppPopover>
    </div>
    <div class="windows-caption-controls" aria-label="窗口控制">
      <button type="button" class="windows-caption-button" aria-label="最小化" title="最小化" @click="minimiseWindow">−</button>
      <button type="button" class="windows-caption-button" aria-label="最大化" title="最大化" @click="toggleMaximiseWindow">□</button>
      <button type="button" class="windows-caption-button windows-caption-close" aria-label="关闭" title="关闭" @click="closeWindow">×</button>
    </div>
    <ContextMenu
      v-if="tabMenu"
      :x="tabMenu.x"
      :y="tabMenu.y"
      :items="tabMenuItems"
      @close="tabMenu = null"
      @select="selectMenu"
    />
  </header>
</template>
