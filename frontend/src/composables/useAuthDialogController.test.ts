// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authenticationIssue,
  canConnectSilently,
  credentialPromptIssue,
  isCredentialError,
  isNonCredentialReconnectError,
  privateKeyRejectedIssue,
  shouldOpenInteractiveCredentialDialog,
  useAuthDialogController,
} from './useAuthDialogController'
import type { AuthenticationState, Connection, ConnectionError } from '../types'

const connection = (values: Partial<Connection> = {}): Connection => ({
  id: 7,
  groupId: null,
  name: 'server',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  connectionMode: 'direct',
  jumpServerId: null,
  hostKeyFingerprint: '',
  credentialSaved: false,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
  ...values,
})

const state = (values: Partial<AuthenticationState> = {}): AuthenticationState => ({
  connectionId: 7,
  canAuthenticate: true,
  credentialSaved: true,
  credentialUsable: true,
  privateKeyEncrypted: false,
  hostTrusted: true,
  reasonCode: '',
  message: '',
  ...values,
})

const error = (values: Partial<ConnectionError> = {}): ConnectionError => ({
  code: 'AUTH_FAILED',
  userMessage: '',
  technicalMessage: '',
  retryable: false,
  serverId: 7,
  operation: 'terminal',
  timestamp: '',
  credentialFromStore: true,
  ...values,
})

describe('useAuthDialogController', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens AuthDialog for a user-initiated password required request', () => {
    const controller = useAuthDialogController()

    const opened = controller.requestAuth({
      mode: 'terminal',
      connectionId: 7,
      issue: credentialPromptIssue('PASSWORD_REQUIRED'),
    })

    expect(opened).toBe(true)
    expect(controller.isOpen.value).toBe(true)
    expect(controller.mode.value).toBe('terminal')
    expect(controller.connectionId.value).toBe(7)
    expect(controller.issue.value).toContain('认证')
  })

  it('opens passphrase mode wording for private-key passphrase errors', () => {
    expect(credentialPromptIssue('PASSPHRASE_REQUIRED')).toContain('私钥口令')
    expect(credentialPromptIssue('PRIVATE_KEY_DECRYPT_FAILED', undefined, true)).toContain('覆盖')
  })

  it('keeps rejected private key as a non-passphrase credential decision', () => {
    const rejected = shouldOpenInteractiveCredentialDialog(
      connection({ authType: 'private_key' }),
      'AUTH_FAILED',
      error({ userMessage: 'server refused public key' }),
    )

    expect(rejected).toBe(false)
    expect(privateKeyRejectedIssue(error({ userMessage: '' }))).toContain('服务器拒绝')
  })

  it('does not open AuthDialog for background auth events without an explicit request', () => {
    const controller = useAuthDialogController()

    controller.ignoreBackgroundAuthError()

    expect(controller.isOpen.value).toBe(false)
    expect(controller.connectionId.value).toBeNull()
  })

  it('does not classify network and host-key failures as credential prompts', () => {
    expect(isCredentialError('CONNECTION_TIMEOUT')).toBe(false)
    expect(isCredentialError('NO_ROUTE')).toBe(false)
    expect(isCredentialError('HOST_KEY_MISMATCH')).toBe(false)
    expect(isNonCredentialReconnectError('CONNECTION_TIMEOUT')).toBe(true)
    expect(isNonCredentialReconnectError('HOST_KEY_MISMATCH')).toBe(true)
  })

  it('de-dupes the same connection and mode while preserving an existing issue when no new issue is provided', () => {
    const controller = useAuthDialogController()
    controller.requestAuth({ mode: 'terminal', connectionId: 7, issue: 'first issue' })

    controller.requestAuth({ mode: 'terminal', connectionId: 7 })

    expect(controller.isOpen.value).toBe(true)
    expect(controller.issue.value).toBe('first issue')
  })

  it('cancel and submit cleanup preserve existing App.vue auth semantics', () => {
    const controller = useAuthDialogController()
    controller.requestAuth({
      mode: 'sftp',
      connectionId: 7,
      issue: 'auth required',
      sftpContextId: 'term-1',
      sftpTerminalSessionId: 'term-1',
      sftpReconnect: true,
    })

    expect(controller.pendingSftpContextId.value).toBe('term-1')
    expect(controller.pendingSftpReconnect.value).toBe(true)

    controller.completeSubmit()
    expect(controller.isOpen.value).toBe(false)
    expect(controller.issue.value).toBe('')
    expect(controller.pendingSftpReconnect.value).toBe(false)

    controller.requestAuth({ mode: 'terminal', connectionId: 7, issue: 'again' })
    controller.close()
    expect(controller.isOpen.value).toBe(false)
  })

  it('keeps host-key policy and authentication-state helpers pure', () => {
    expect(canConnectSilently(state({ canAuthenticate: true, hostTrusted: false }), 'auto_update')).toBe(true)
    expect(canConnectSilently(state({ canAuthenticate: false, hostTrusted: true }), 'auto_update')).toBe(false)
    expect(authenticationIssue(state({ reasonCode: 'credential_unavailable' }))).toContain('凭据')
  })

  it('does not write credentials to localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = useAuthDialogController()

    controller.requestAuth({ mode: 'terminal', connectionId: 7, issue: 'auth required' })
    controller.beginSubmit()
    controller.endSubmit()

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(controller)).not.toContain('password')
    expect(JSON.stringify(controller)).not.toContain('passphrase')
    expect(JSON.stringify(controller)).not.toContain('privateKey')
  })
})
