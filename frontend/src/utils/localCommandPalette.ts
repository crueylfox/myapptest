import type { CommandExecutionTarget } from '../composables/useCommandExecutionFlow'
import {
  LOCAL_COMMAND_HISTORY_SERVER_IDS,
  type LocalCommandHistoryScope,
} from '../stores/commands'
import type { Connection, LocalTerminalState } from '../types'

export function localCommandHistoryScope(session: LocalTerminalState): LocalCommandHistoryScope {
  return session.shellKind === 'powershell' ? 'local:powershell' : 'local:cmd'
}

export function isLocalCommandTerminalReady(session: LocalTerminalState): boolean {
  return session.status === 'running' || session.status === 'starting'
}

export function localCommandTarget(session: LocalTerminalState): CommandExecutionTarget {
  const scope = localCommandHistoryScope(session)
  return {
    kind: 'local',
    sessionId: session.sessionId,
    connectionId: LOCAL_COMMAND_HISTORY_SERVER_IDS[scope],
    status: isLocalCommandTerminalReady(session) ? 'online' : session.status,
    localHistoryScope: scope,
  }
}

export function localCommandConnection(session: LocalTerminalState): Connection {
  const scope = localCommandHistoryScope(session)
  return {
    id: LOCAL_COMMAND_HISTORY_SERVER_IDS[scope],
    groupId: null,
    name: session.title || session.shellName || session.shell || localCommandLabel(scope),
    host: 'local',
    port: 0,
    username: '',
    authType: 'password',
    privateKeySource: 'local_file',
    privateKeyPath: '',
    keyVaultId: null,
    hostKeyFingerprint: '',
    credentialSaved: false,
    refreshInterval: 1,
    createdAt: '',
    updatedAt: '',
  }
}

function localCommandLabel(scope: LocalCommandHistoryScope): string {
  return scope === 'local:powershell' ? 'PowerShell' : 'CMD'
}
