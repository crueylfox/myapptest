import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import { api } from '../api/backend'
import type {
  SaveTunnelProfileRequest,
  StartTunnelRequest,
  RemoteForwardAccessRequest,
  RemoteForwardAccessRestartRequest,
  TunnelErrorEvent,
  TunnelProfile,
  TunnelRuntime,
  TunnelStateEvent,
  TunnelTrafficEvent,
} from '../types'

export const useTunnelStore = defineStore('tunnels', () => {
  const profiles = ref<TunnelProfile[]>([])
  const runtimesById = ref<Record<string, TunnelRuntime>>({})
  const lastError = ref<TunnelErrorEvent | null>(null)
  const deletedProfileIds = ref<Set<number>>(new Set())

  const runtimes = computed(() =>
    Object.values(runtimesById.value).sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.tunnelID.localeCompare(right.tunnelID)))

  function profilesForServer(serverID: number | null | undefined) {
    if (!serverID) return []
    return profiles.value.filter((profile) => profile.serverID === serverID)
  }

  function runtimesForServer(serverID: number | null | undefined) {
    if (!serverID) return []
    return runtimes.value.filter((runtime) => runtime.serverID === serverID)
  }

  function runningCount(serverID: number | null | undefined) {
    return runtimesForServer(serverID).filter((runtime) =>
      runtime.status === 'starting' || runtime.status === 'running').length
  }

  async function loadProfiles() {
    profiles.value = await api.listTunnelProfiles() ?? []
  }

  async function loadRuntimes(serverID = 0) {
    const values = await api.listTunnels(serverID) ?? []
    if (serverID > 0) clearServer(serverID)
    for (const runtime of values) {
      runtimesById.value[runtime.tunnelID] = runtime
    }
  }

  async function saveProfile(request: SaveTunnelProfileRequest) {
    const saved = request.id > 0
      ? await api.updateTunnelProfile(request)
      : await api.createTunnelProfile(request)
    deletedProfileIds.value.delete(saved.id)
    const index = profiles.value.findIndex((profile) => profile.id === saved.id)
    if (index >= 0) profiles.value[index] = saved
    else profiles.value = [...profiles.value, saved]
    return saved
  }

  async function deleteProfile(id: number) {
    await api.deleteTunnelProfile(id)
    deletedProfileIds.value.add(id)
    profiles.value = profiles.value.filter((profile) => profile.id !== id)
    const next = { ...runtimesById.value }
    for (const [tunnelID, runtime] of Object.entries(next)) {
      if (runtime.profileID === id) delete next[tunnelID]
    }
    runtimesById.value = next
  }

  async function start(request: StartTunnelRequest) {
    const runtime = await api.startTunnel(request)
    runtimesById.value[runtime.tunnelID] = runtime
    return runtime
  }

  async function stop(serverID: number, tunnelID: string) {
    await api.stopTunnel(serverID, tunnelID)
    const runtime = runtimesById.value[tunnelID]
    if (runtime) {
      runtimesById.value[tunnelID] = {
        ...runtime,
        status: 'stopped',
        activeConnections: 0,
        updatedAt: new Date().toISOString(),
      }
    }
  }

  async function restart(serverID: number, tunnelID: string) {
    const runtime = await api.restartTunnel({ serverID, tunnelID, auth: emptyAuth() })
    runtimesById.value[runtime.tunnelID] = runtime
    return runtime
  }

  async function checkRemoteListen(serverID: number, tunnelID: string) {
    const runtime = await api.checkTunnelRemoteListen(serverID, tunnelID)
    runtimesById.value[runtime.tunnelID] = runtime
    return runtime
  }

  async function inspectRemoteForwardAccess(request: RemoteForwardAccessRequest) {
    return api.inspectRemoteForwardAccess(request)
  }

  async function enableRemoteForwardAccess(request: RemoteForwardAccessRequest) {
    return api.enableRemoteForwardAccess(request)
  }

  async function enableRemoteForwardAccessAndRestart(request: RemoteForwardAccessRestartRequest) {
    const result = await api.enableRemoteForwardAccessAndRestart(request)
    const next = { ...runtimesById.value }
    delete next[request.tunnelID]
    if (result.runtime?.tunnelID) {
      next[result.runtime.tunnelID] = result.runtime
    }
    runtimesById.value = next
    return result
  }

  function acceptState(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<TunnelStateEvent>
    const state = event.state
    if (!state || !Number.isInteger(event.serverID) || !event.tunnelID) return
    if (deletedProfileIds.value.has(state.profileID)) return
    if (state.status === 'stopped') {
      runtimesById.value[state.tunnelID] = state
      return
    }
    runtimesById.value[state.tunnelID] = state
  }

  function acceptTraffic(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<TunnelTrafficEvent>
    if (!event.tunnelID) return
    const runtime = runtimesById.value[event.tunnelID]
    if (!runtime) return
    runtimesById.value[event.tunnelID] = {
      ...runtime,
      activeConnections: Number(event.activeConnections ?? runtime.activeConnections),
      bytesIn: Number(event.bytesIn ?? runtime.bytesIn),
      bytesOut: Number(event.bytesOut ?? runtime.bytesOut),
      updatedAt: event.timestamp || runtime.updatedAt,
    }
  }

  function acceptError(value: unknown) {
    if (typeof value !== 'object' || value === null) return
    const event = value as Partial<TunnelErrorEvent>
    if (!Number.isInteger(event.serverID) || !event.tunnelID) return
    lastError.value = event as TunnelErrorEvent
    const runtime = runtimesById.value[event.tunnelID]
    if (!runtime) return
    runtimesById.value[event.tunnelID] = {
      ...runtime,
      status: 'failed',
      error: event.message || runtime.error,
      updatedAt: event.timestamp || runtime.updatedAt,
    }
  }

  function clearServer(serverID: number) {
    const next = { ...runtimesById.value }
    for (const [tunnelID, runtime] of Object.entries(next)) {
      if (runtime.serverID === serverID) delete next[tunnelID]
    }
    runtimesById.value = next
  }

  function subscribe() {
    EventsOn('tunnel:state', acceptState)
    EventsOn('tunnel:error', acceptError)
    EventsOn('tunnel:traffic', acceptTraffic)
  }

  function unsubscribe() {
    EventsOff('tunnel:state')
    EventsOff('tunnel:error')
    EventsOff('tunnel:traffic')
  }

  return {
    profiles,
    runtimesById,
    runtimes,
    lastError,
    profilesForServer,
    runtimesForServer,
    runningCount,
    loadProfiles,
    loadRuntimes,
    saveProfile,
    deleteProfile,
    start,
    stop,
    restart,
    checkRemoteListen,
    inspectRemoteForwardAccess,
    enableRemoteForwardAccess,
    enableRemoteForwardAccessAndRestart,
    acceptState,
    acceptTraffic,
    acceptError,
    clearServer,
    subscribe,
    unsubscribe,
  }
})

function emptyAuth() {
  return {
    password: '',
    passphrase: '',
    trustUnknownHost: false,
    rememberSecret: false,
  }
}
