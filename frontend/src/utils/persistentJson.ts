export type PersistentJsonStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>

export type PersistentJsonValidator<T> = (value: unknown) => value is T

export function safeReadJson<T>(
  key: string,
  fallback: T,
  validator?: PersistentJsonValidator<T>,
  storage: PersistentJsonStorage = localStorage,
): T {
  try {
    const stored = storage.getItem(key)
    if (!stored) return fallback
    const parsed = JSON.parse(stored)
    if (validator && !validator(parsed)) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

export function safeWriteJson(
  key: string,
  value: unknown,
  storage: PersistentJsonStorage = localStorage,
) {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removePersistentJson(
  key: string,
  storage: PersistentJsonStorage = localStorage,
) {
  try {
    if (!storage.removeItem) return false
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
