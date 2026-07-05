import type { TerminalProfile } from '../types'

export type TerminalInstanceKind = 'ssh' | 'local'

export interface TerminalInstanceRegistration {
  id: string
  kind: TerminalInstanceKind
  serverID: number | null
  resolvedProfileID: string
  inheritsDefaultProfile: boolean
  applyProfile: (profile: TerminalProfile) => void
  observeInput?: (data: string) => void
}

const instances = new Map<string, TerminalInstanceRegistration>()

export function registerTerminalInstance(registration: TerminalInstanceRegistration) {
  instances.set(registration.id, registration)
}

export function updateTerminalInstance(
  id: string,
  values: Partial<Omit<TerminalInstanceRegistration, 'id' | 'applyProfile'>>,
) {
  const current = instances.get(id)
  if (!current) return
  instances.set(id, { ...current, ...values })
}

export function unregisterTerminalInstance(id: string) {
  instances.delete(id)
}

export function terminalInstanceCount() {
  return instances.size
}

export function observeTerminalInstanceInput(id: string, data: string) {
  const instance = instances.get(id)
  if (!instance?.observeInput) return false
  instance.observeInput(data)
  return true
}

export function applyTerminalProfileToRegisteredInstances(
  profile: TerminalProfile,
  defaultProfileID: string,
) {
  const profileID = profile.id.trim()
  const defaultID = defaultProfileID.trim() || 'default'
  const applyDefault = profileID === defaultID
  let count = 0

  for (const instance of instances.values()) {
    const matchesDirectProfile = instance.resolvedProfileID === profileID
    const matchesDefaultInheritance = applyDefault && instance.inheritsDefaultProfile
    const matchesLocalDefault = applyDefault && instance.kind === 'local'
    if (!matchesDirectProfile && !matchesDefaultInheritance && !matchesLocalDefault) continue
    instance.applyProfile(profile)
    count += 1
  }

  return count
}
