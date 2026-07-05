export function normalizeRemoteInputPath(value: string) {
  const trimmed = value.trim()
  if (!trimmed || /[\0\r\n]/.test(trimmed)) return ''
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (normalized === '/') return '/'
  return normalized.replace(/\/+$/, '') || '/'
}

export function remotePathSegments(value: string) {
  return value.replace(/\\/g, '/').split('/').filter(Boolean)
}

export function hasRemotePathTraversal(value: string) {
  return remotePathSegments(value).some((segment) => segment === '..')
}

export function validateRemoteTextPathInput(value: string, allowAbsolute: boolean) {
  const raw = value.trim()
  if (!raw) return '路径不能为空'
  if (/[\0\r\n]/.test(raw)) return '路径无效'
  const normalized = raw.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!allowAbsolute && normalized.startsWith('/')) return '请输入当前目录下的文件名或相对路径'
  if (normalized === '.' || normalized === '..' || normalized.endsWith('/')) return '路径无效'
  if (hasRemotePathTraversal(normalized)) return '路径不能包含 ..'
  const name = remotePathSegments(normalized).pop() ?? ''
  if (!name || name === '.' || name === '..') return '路径无效'
  return ''
}

export function joinRemoteTextPath(base: string, input: string, allowAbsolute: boolean, fallbackBase = '.') {
  const normalizedInput = normalizeRemoteInputPath(input)
  if (!normalizedInput || hasRemotePathTraversal(normalizedInput)) return ''
  if (allowAbsolute && normalizedInput.startsWith('/')) return normalizedInput
  const normalizedBase = normalizeRemoteInputPath(base || fallbackBase || '.')
  if (!normalizedBase || normalizedBase === '.') return normalizedInput.replace(/^\/+/, '')
  if (normalizedBase === '/') return `/${normalizedInput.replace(/^\/+/, '')}`
  return `${normalizedBase.replace(/\/+$/, '')}/${normalizedInput.replace(/^\/+/, '')}`
}

export function remoteBasename(value: string) {
  const parts = remotePathSegments(value)
  return parts[parts.length - 1] || value
}

export function remoteParentPath(value: string) {
  const normalized = normalizeRemoteInputPath(value)
  if (!normalized || normalized === '/' || normalized === '.') return normalized || '.'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return normalized.startsWith('/') ? '/' : '.'
  const parent = parts.slice(0, -1).join('/')
  return normalized.startsWith('/') ? `/${parent}` : parent
}
