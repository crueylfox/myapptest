import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AlertEvent, AlertSettings, Connection, ConnectionRuntimeState, MonitorSnapshot } from '../types'
import { api } from '../api/backend'
import { AlertEvaluator, type AlertNotification } from '../utils/alertEvaluator'
import { normalizeAlertSettings } from '../utils/alertSettings'

export const useAlertStore = defineStore('alerts', () => {
  const events = ref<AlertEvent[]>([])
  const settings = ref<AlertSettings>(normalizeAlertSettings(null))
  const evaluator = new AlertEvaluator(settings.value)
  const sessionID = `alert-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const initialized = ref(false)
  const persistenceWarning = ref('')

  const activeEvents = computed(() =>
    sortEvents(events.value.filter((event) => event.state === 'firing' && event.sessionID === sessionID)))
  const resolvedEvents = computed(() => sortEvents(events.value.filter((event) => event.state === 'resolved')))
  const allEvents = computed(() => sortEvents(events.value))
  const unreadCount = computed(() => events.value.filter((event) => !event.read && !event.muted).length)
  const activeCountsByServerId = computed(() => {
    const counts: Record<number, number> = {}
    for (const event of activeEvents.value) {
      if (event.serverID <= 0) continue
      counts[event.serverID] = (counts[event.serverID] ?? 0) + 1
    }
    return counts
  })

  async function initialize(value: AlertSettings | null | undefined) {
    configure(value)
    try {
      await api.beginAlertSession(sessionID, settings.value.historyLimit)
      const history = await api.listAlertHistory(settings.value.historyLimit)
      mergeHistory(history)
      initialized.value = true
      persistenceWarning.value = ''
    } catch (reason) {
      persistenceWarning.value = sanitizePersistenceError(reason)
      initialized.value = true
    }
  }

  function configure(value: AlertSettings | null | undefined) {
    settings.value = normalizeAlertSettings(value)
    evaluator.configure(settings.value)
    trimResolvedHistory()
  }

  async function reloadHistory() {
    try {
      mergeHistory(await api.listAlertHistory(settings.value.historyLimit))
      persistenceWarning.value = ''
    } catch (reason) {
      persistenceWarning.value = sanitizePersistenceError(reason)
    }
  }

  function ingestSnapshot(snapshot: MonitorSnapshot, connection: Connection | null | undefined, now = Date.now()) {
    return applyNotifications(evaluator.ingestSnapshot(snapshot, connection, now))
  }

  function ingestConnectionState(state: ConnectionRuntimeState, connection: Connection | null | undefined, now = Date.now()) {
    return applyNotifications(evaluator.ingestConnectionState(state, connection, now))
  }

  function tick(now: number, states: Record<number, ConnectionRuntimeState>, connections: Connection[]) {
    return applyNotifications(evaluator.tick(now, states, connections))
  }

  function createTestAlert(now = Date.now()) {
    return applyNotifications([evaluator.createTestAlert(now)])
  }

  function markExpectedDisconnect(serverID: number, now = Date.now()) {
    evaluator.markExpectedDisconnect(serverID, now)
  }

  function removeServer(serverID: number) {
    evaluator.deleteServer(serverID)
    events.value = events.value
      .filter((event) => !(event.serverID === serverID && event.state === 'firing'))
      .map((event) => event.serverID === serverID
        ? { ...event, serverName: `${event.serverName}（已删除）`, read: true }
        : event)
    for (const event of events.value) {
      if (event.serverID === serverID && event.read) persistRead(event.eventID)
    }
  }

  function muteServer(serverID: number, mode: '30m' | '2h' | 'session', now = Date.now()) {
    evaluator.muteServer(serverID, mode, now)
    events.value = events.value.map((event) => event.serverID === serverID && event.state === 'firing'
      ? { ...event, muted: true, read: true }
      : event)
  }

  function unmuteServer(serverID: number) {
    evaluator.unmuteServer(serverID)
    events.value = events.value.map((event) => event.serverID === serverID && event.state === 'firing'
      ? { ...event, muted: false }
      : event)
  }

  function markRead(eventID: string) {
    events.value = events.value.map((event) => event.eventID === eventID ? { ...event, read: true } : event)
    persistRead(eventID)
  }

  function markAllRead() {
    events.value = events.value.map((event) => ({ ...event, read: true }))
    void api.markAllAlertHistoryRead().catch((reason) => {
      persistenceWarning.value = sanitizePersistenceError(reason)
    })
  }

  function clearResolved() {
    events.value = events.value.filter((event) => event.state === 'firing')
    void api.clearResolvedAlertHistory().catch((reason) => {
      persistenceWarning.value = sanitizePersistenceError(reason)
    })
  }

  function dispose() {
    events.value = []
    initialized.value = false
  }

  function applyNotifications(notifications: AlertNotification[]) {
    if (!notifications.length) return []
    for (const notification of notifications) {
      const event = {
        ...notification.event,
        sessionID: notification.event.sessionID || sessionID,
      }
      upsertEvent(event)
      persistEvent(event)
    }
    trimResolvedHistory()
    return notifications.filter((notification) => !notification.event.muted)
  }

  function upsertEvent(event: AlertEvent) {
    const index = events.value.findIndex((candidate) => candidate.eventID === event.eventID)
    if (index >= 0) {
      const next = [...events.value]
      next[index] = { ...next[index], ...event }
      events.value = next
      return
    }
    events.value = [event, ...events.value]
  }

  function mergeHistory(history: AlertEvent[]) {
    const byID = new Map<string, AlertEvent>()
    for (const event of events.value) byID.set(event.eventID, event)
    for (const event of history) {
      byID.set(event.eventID, {
        ...byID.get(event.eventID),
        ...event,
        muted: false,
      })
    }
    events.value = sortEvents(Array.from(byID.values()))
    trimResolvedHistory()
  }

  function trimResolvedHistory() {
    const active = events.value.filter((event) => event.state === 'firing')
    const historical = sortEvents(events.value.filter((event) => event.state === 'resolved' || event.state === 'interrupted'))
      .slice(0, settings.value.historyLimit)
    events.value = sortEvents([...active, ...historical])
  }

  function persistEvent(event: AlertEvent) {
    if (event.source === 'test') return
    void api.persistAlertHistoryEvent(event, settings.value.historyLimit).catch((reason) => {
      persistenceWarning.value = sanitizePersistenceError(reason)
    })
  }

  function persistRead(eventID: string) {
    void api.markAlertHistoryRead(eventID).catch((reason) => {
      persistenceWarning.value = sanitizePersistenceError(reason)
    })
  }

  return {
    events,
    settings,
    sessionID,
    initialized,
    persistenceWarning,
    activeEvents,
    resolvedEvents,
    allEvents,
    unreadCount,
    activeCountsByServerId,
    initialize,
    configure,
    reloadHistory,
    ingestSnapshot,
    ingestConnectionState,
    tick,
    createTestAlert,
    markExpectedDisconnect,
    removeServer,
    muteServer,
    unmuteServer,
    markRead,
    markAllRead,
    clearResolved,
    dispose,
  }
})

function sortEvents(values: AlertEvent[]) {
  return values.slice().sort((left, right) => {
    const stateWeight = (event: AlertEvent) => event.state === 'firing' ? 0 : event.state === 'resolved' ? 1 : 2
    const leftWeight = stateWeight(left)
    const rightWeight = stateWeight(right)
    if (leftWeight !== rightWeight) return leftWeight - rightWeight
    if (left.read !== right.read) return left.read ? 1 : -1
    const leftTime = Date.parse(left.resolvedAt || left.startedAt)
    const rightTime = Date.parse(right.resolvedAt || right.startedAt)
    return rightTime - leftTime
  })
}

function sanitizePersistenceError(reason: unknown) {
  return String(reason).replace(/^Error:\s*/i, '').trim() || '告警历史保存失败'
}
