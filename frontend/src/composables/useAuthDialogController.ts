import { ref } from 'vue'
import type { AuthenticationState, Connection, ConnectionError } from '../types'

export type AuthDialogMode =
  | 'connect'
  | 'test'
  | 'terminal'
  | 'terminal-reconnect'
  | 'server-reconnect'
  | 'sftp'

export type AuthDialogRequest = {
  mode: AuthDialogMode
  connectionId?: number | null
  issue?: string
  sftpContextId?: string
  sftpTerminalSessionId?: string
  sftpReconnect?: boolean
}

const credentialPromptErrorCodes = new Set([
  'AUTH_FAILED',
  'PASSPHRASE_INVALID',
  'PRIVATE_KEY_INVALID',
  'CREDENTIAL_REQUIRED',
  'CREDENTIAL_UNAVAILABLE',
  'PASSWORD_REQUIRED',
  'MISSING_PASSWORD',
  'INVALID_PASSWORD',
  'MISSING_PRIVATE_KEY',
  'PRIVATE_KEY_NOT_FOUND',
  'PASSPHRASE_REQUIRED',
  'INVALID_PASSPHRASE',
  'PRIVATE_KEY_DECRYPT_FAILED',
  'credential_required',
  'credential_unavailable',
  'credential_invalid',
  'password_required',
  'missing_password',
  'invalid_password',
  'auth_failed',
  'target_auth_failed',
  'jump_auth_failed',
  'key_missing',
  'missing_private_key',
  'private_key_not_found',
  'private_key_unavailable',
  'private_key_invalid',
  'passphrase_required',
  'passphrase_invalid',
  'invalid_passphrase',
  'private_key_decrypt_failed',
])

const nonCredentialReconnectErrorCodes = new Set([
  'NETWORK_UNREACHABLE',
  'DNS_FAILED',
  'CONNECTION_TIMEOUT',
  'CONNECTION_REFUSED',
  'HOST_UNREACHABLE',
  'NO_ROUTE',
  'EOF',
  'BROKEN_PIPE',
  'CONNECTION_RESET',
  'NET_ERR_CLOSED',
  'OPERATION_TIMEOUT',
  'HANDSHAKE_FAILED',
  'SSH_ALGORITHM_UNSUPPORTED',
  'BANNER_FAILED',
  'CONNECTION_CLOSED',
  'SSH_KEEPALIVE_FAILED',
  'SSH_SESSION_CLOSED',
  'SFTP_CONNECTION_LOST',
  'ROUTE_TRANSPORT_CLOSED',
  'HOST_KEY_MISMATCH',
  'HOST_KEY_UNKNOWN',
  'HOST_KEY_FAILED',
  'TARGET_UNREACHABLE_THROUGH_JUMP',
  'JUMP_CONNECTION_FAILED',
  'network_unreachable',
  'connection_timeout',
  'connection_refused',
  'dns_failed',
  'ssh_handshake_failed',
  'ssh_algorithm_unsupported',
  'host_key_failed',
  'net_err_closed',
  'connection_reset',
  'broken_pipe',
  'eof',
  'operation_timeout',
  'ssh_session_closed',
  'sftp_connection_lost',
  'target_unreachable_through_jump',
  'jump_connection_failed',
  'target_host_key_failed',
  'jump_host_key_failed',
  'route_transport_closed',
])

const passphraseUnlockErrorCodes = new Set([
  'PASSPHRASE_INVALID',
  'INVALID_PASSPHRASE',
  'PRIVATE_KEY_DECRYPT_FAILED',
  'credential_invalid',
  'passphrase_invalid',
  'invalid_passphrase',
  'private_key_decrypt_failed',
])

const privateKeyAuthRejectedCodes = new Set([
  'AUTH_FAILED',
  'auth_failed',
  'target_auth_failed',
  'jump_auth_failed',
])

export function normalizedErrorCode(code: string) {
  return code.trim()
}

export function isCredentialError(code: string) {
  return credentialPromptErrorCodes.has(normalizedErrorCode(code))
}

export function isNonCredentialReconnectError(code: string) {
  return nonCredentialReconnectErrorCodes.has(normalizedErrorCode(code))
}

export function isHostKeyError(code: string) {
  return code === 'HOST_KEY_MISMATCH' ||
    code === 'HOST_KEY_UNKNOWN' ||
    code === 'target_host_key_failed' ||
    code === 'jump_host_key_failed' ||
    code === 'host_key_failed'
}

function isPassphraseUnlockError(code: string) {
  return passphraseUnlockErrorCodes.has(normalizedErrorCode(code))
}

function isPrivateKeyServerAuthRejected(
  connection: Connection,
  code: string,
  connectionError?: ConnectionError,
) {
  if (connection.authType !== 'private_key') return false
  const normalized = normalizedErrorCode(code)
  if (!privateKeyAuthRejectedCodes.has(normalized)) return false
  if (isPassphraseUnlockError(normalized)) return false
  const detail = `${connectionError?.userMessage ?? ''}\n${connectionError?.technicalMessage ?? ''}`.toLowerCase()
  return !detail.includes('passphrase') && !detail.includes('口令')
}

export function shouldOpenInteractiveCredentialDialog(
  connection: Connection,
  code: string,
  connectionError?: ConnectionError,
) {
  if (!isCredentialError(code)) return false
  if (isPrivateKeyServerAuthRejected(connection, code, connectionError)) return false
  return true
}

export function privateKeyRejectedIssue(connectionError?: ConnectionError) {
  const userMessage = connectionError?.userMessage?.trim() ?? ''
  if (
    userMessage &&
    !userMessage.includes('用户名、密码或认证方式') &&
    !userMessage.includes('已保存的凭据') &&
    !userMessage.includes('私钥口令')
  ) {
    return userMessage
  }
  return '服务器拒绝当前密钥认证，请编辑凭据或选择其他密钥。'
}

export function credentialPromptIssue(code: string, connectionError?: ConnectionError, overwrite = false) {
  switch (normalizedErrorCode(code)) {
  case 'CREDENTIAL_REQUIRED':
  case 'PASSWORD_REQUIRED':
  case 'MISSING_PASSWORD':
  case 'credential_required':
  case 'password_required':
  case 'missing_password':
    return connectionError?.userMessage || '需要输入认证信息。'
  case 'CREDENTIAL_UNAVAILABLE':
  case 'credential_unavailable':
    return connectionError?.userMessage || '系统凭据引用存在，但凭据库中的值不可用，请重新输入。'
  case 'MISSING_PRIVATE_KEY':
  case 'PRIVATE_KEY_NOT_FOUND':
  case 'key_missing':
  case 'missing_private_key':
  case 'private_key_not_found':
  case 'private_key_unavailable':
    return connectionError?.userMessage || '该服务器使用的密钥不可用，请重新选择或新增密钥。'
  case 'PASSPHRASE_REQUIRED':
  case 'passphrase_required':
    return connectionError?.userMessage || '需要输入私钥口令。'
  case 'PASSPHRASE_INVALID':
  case 'INVALID_PASSPHRASE':
  case 'PRIVATE_KEY_DECRYPT_FAILED':
  case 'credential_invalid':
  case 'passphrase_invalid':
  case 'invalid_passphrase':
  case 'private_key_decrypt_failed':
    return connectionError?.userMessage || (overwrite
      ? '已保存的私钥口令无法解锁该密钥，请重新输入并覆盖旧口令。'
      : '已保存的私钥口令无法解锁该密钥，请重新输入并选择是否保存。')
  case 'PRIVATE_KEY_INVALID':
  case 'private_key_invalid':
    return connectionError?.userMessage || '私钥文件无效、格式不受支持或无法读取，请编辑凭据或选择其他密钥。'
  case 'INVALID_PASSWORD':
  case 'invalid_password':
    return connectionError?.userMessage || (overwrite
      ? '已保存的密码被服务器拒绝，请重新输入并覆盖旧密码。'
      : '已保存的密码被服务器拒绝，请重新输入并选择是否保存。')
  case 'AUTH_FAILED':
  case 'auth_failed':
  case 'target_auth_failed':
  case 'jump_auth_failed':
    if (connectionError && connectionError.credentialFromStore === false) {
      return connectionError.userMessage || '认证失败，请重新输入认证信息。'
    }
    return overwrite
      ? '已保存的凭据被服务器拒绝，请重新输入并覆盖旧凭据。'
      : '已保存的凭据被服务器拒绝，请重新输入并选择是否保存。'
  default:
    return overwrite
      ? '已保存的凭据被服务器拒绝，请重新输入并覆盖旧凭据。'
      : '已保存的凭据被服务器拒绝，请重新输入并选择是否保存。'
  }
}

export function needsReachabilityBeforeCredentialPrompt(state: AuthenticationState) {
  if (state.canAuthenticate) return false
  return [
    '',
    'authentication_required',
    'credential_unavailable',
    'credential_required',
    'password_required',
    'missing_password',
    'CREDENTIAL_REQUIRED',
    'CREDENTIAL_UNAVAILABLE',
    'PASSWORD_REQUIRED',
    'MISSING_PASSWORD',
  ].includes(state.reasonCode)
}

export function canConnectSilently(state: AuthenticationState, hostKeyPolicy: string) {
  return state.canAuthenticate &&
    (state.hostTrusted || hostKeyPolicy === 'auto_update' || hostKeyPolicy === 'strict')
}

export function authenticationIssue(state: AuthenticationState) {
  if (state.reasonCode === 'credential_unavailable') return '系统凭据引用存在，但凭据库中的值不可用，请重新输入。'
  if (state.reasonCode === 'credential_invalid') return '已保存的私钥口令无效，请重新输入并覆盖旧凭据。'
  if (state.reasonCode === 'private_key_unavailable') return state.message || '该服务器使用的密钥已被删除，请重新选择密钥。'
  if (state.reasonCode === 'private_key_invalid') return '私钥文件格式无效，请先编辑服务器配置。'
  return ''
}

export function useAuthDialogController() {
  const isOpen = ref(false)
  const mode = ref<AuthDialogMode>('connect')
  const connectionId = ref<number | null>(null)
  const issue = ref('')
  const pendingSftpContextId = ref('')
  const pendingSftpTerminalSessionId = ref('')
  const pendingSftpReconnect = ref(false)
  const submitting = ref(false)

  function requestAuth(request: AuthDialogRequest) {
    const nextConnectionId = request.connectionId ?? null
    if (!nextConnectionId) return false
    if (isOpen.value && connectionId.value === nextConnectionId && mode.value === request.mode) {
      issue.value = request.issue || issue.value
      return true
    }
    mode.value = request.mode
    connectionId.value = nextConnectionId
    issue.value = request.issue ?? ''
    pendingSftpContextId.value = request.mode === 'sftp' ? request.sftpContextId ?? '' : ''
    pendingSftpTerminalSessionId.value = request.mode === 'sftp' ? request.sftpTerminalSessionId ?? '' : ''
    pendingSftpReconnect.value = request.mode === 'sftp' && Boolean(request.sftpReconnect)
    isOpen.value = true
    return true
  }

  function ignoreBackgroundAuthError() {
    return false
  }

  function setIssue(nextIssue: string) {
    issue.value = nextIssue
  }

  function close() {
    isOpen.value = false
  }

  function completeSubmit() {
    isOpen.value = false
    issue.value = ''
    pendingSftpReconnect.value = false
  }

  function beginSubmit() {
    if (submitting.value) return false
    submitting.value = true
    return true
  }

  function endSubmit() {
    submitting.value = false
  }

  return {
    isOpen,
    mode,
    connectionId,
    issue,
    pendingSftpContextId,
    pendingSftpTerminalSessionId,
    pendingSftpReconnect,
    submitting,
    requestAuth,
    ignoreBackgroundAuthError,
    setIssue,
    close,
    completeSubmit,
    beginSubmit,
    endSubmit,
  }
}
