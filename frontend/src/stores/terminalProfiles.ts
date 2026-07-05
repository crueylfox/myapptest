import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '../api/backend'
import type { Connection, SaveTerminalProfileRequest, TerminalProfile } from '../types'
import { applyTerminalProfileToRegisteredInstances } from '../utils/terminalInstanceRegistry'

export const defaultTerminalProfile: TerminalProfile = {
  id: 'default',
  name: '默认',
  fontFamily: 'Consolas, Cascadia Mono, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  themeName: 'serverpilot-dark',
  foreground: '#dbeafe',
  background: '#07111f',
  selectionBackground: '#2563eb66',
  cursorColor: '#ffffff',
  createdAt: '',
  updatedAt: '',
}

function profileToRequest(profile: TerminalProfile): SaveTerminalProfileRequest {
  return {
    id: profile.id,
    name: profile.name,
    fontFamily: profile.fontFamily,
    fontSize: profile.fontSize,
    lineHeight: profile.lineHeight,
    letterSpacing: profile.letterSpacing,
    cursorStyle: profile.cursorStyle,
    cursorBlink: profile.cursorBlink,
    scrollback: profile.scrollback,
    themeName: profile.themeName,
    foreground: profile.foreground,
    background: profile.background,
    selectionBackground: profile.selectionBackground,
    cursorColor: profile.cursorColor,
  }
}

export const useTerminalProfileStore = defineStore('terminalProfiles', () => {
  const profiles = ref<TerminalProfile[]>([])
  const defaultProfileId = ref('default')
  const loading = ref(false)
  const error = ref('')
  const applyRevision = ref(0)

  const defaultProfile = computed(() =>
    profiles.value.find((profile) => profile.id === defaultProfileId.value)
    ?? profiles.value.find((profile) => profile.id === defaultTerminalProfile.id)
    ?? defaultTerminalProfile,
  )

  function setDefaultProfileId(id = 'default') {
    defaultProfileId.value = id || 'default'
  }

  function resolvedForConnection(connection: Pick<Connection, 'terminalProfileId'> | null | undefined) {
    const overrideId = connection?.terminalProfileId?.trim()
    if (overrideId) {
      return profiles.value.find((profile) => profile.id === overrideId) ?? defaultProfile.value
    }
    return defaultProfile.value
  }

  async function load(defaultId = defaultProfileId.value) {
    loading.value = true
    error.value = ''
    try {
      profiles.value = (await api.listTerminalProfiles()) ?? []
      if (defaultId) defaultProfileId.value = defaultId
      if (!profiles.value.length) profiles.value = [defaultTerminalProfile]
    } catch (reason) {
      error.value = String(reason)
      if (!profiles.value.length) profiles.value = [defaultTerminalProfile]
    } finally {
      loading.value = false
    }
  }

  async function save(request: SaveTerminalProfileRequest) {
    const saved = request.id
      ? await api.updateTerminalProfile(request)
      : await api.createTerminalProfile(request)
    await load()
    return saved
  }

  async function duplicate(id: string) {
    const saved = await api.duplicateTerminalProfile(id)
    await load()
    return saved
  }

  async function remove(id: string, forceDetachServers = false) {
    const result = await api.deleteTerminalProfile({ id, forceDetachServers })
    await load()
    return result
  }

  async function setDefault(id: string) {
    const settings = await api.setDefaultTerminalProfile(id)
    defaultProfileId.value = settings.defaultTerminalProfileId || id || 'default'
    await load(defaultProfileId.value)
    return settings
  }

  async function assignServer(serverID: number, terminalProfileId: string | null) {
    return api.assignServerTerminalProfile({ serverID, terminalProfileId })
  }

  function applyToOpenTerminals(profile?: TerminalProfile) {
    applyRevision.value += 1
    if (!profile) return 0
    return applyTerminalProfileToRegisteredInstances(profile, defaultProfileId.value)
  }

  return {
    profiles,
    defaultProfileId,
    loading,
    error,
    applyRevision,
    defaultProfile,
    setDefaultProfileId,
    resolvedForConnection,
    profileToRequest,
    load,
    save,
    duplicate,
    remove,
    setDefault,
    assignServer,
    applyToOpenTerminals,
  }
})
