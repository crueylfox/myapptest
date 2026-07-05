import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDockerContainerTerminalFlow } from './useDockerContainerTerminalFlow'
import { encodeTerminalInputToBase64 } from '../utils/terminalEncoding'
import type { AppPanelView } from '../utils/appPanelModel'
import type { Connection } from '../types'

function makeConnection(id: number): Connection {
  return {
    id,
    groupId: null,
    name: `server-${id}`,
    host: '192.0.2.10',
    port: 22,
    username: 'root',
    authType: 'password',
    privateKeySource: 'local_file',
    privateKeyPath: '',
    keyVaultId: null,
    hostKeyFingerprint: '',
    credentialSaved: true,
    refreshInterval: 5,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('useDockerContainerTerminalFlow', () => {
  it('opens a fresh SSH terminal for each container connection and writes docker exec to that session', async () => {
    const activeView = ref<AppPanelView>('monitor')
    const dockerDialogOpen = ref(true)
    const existingTerminal = { sessionId: 'session-first-container', status: 'online' as const }
    const openedTerminal = { sessionId: 'session-second-container', status: 'online' as const }
    const openDedicatedTerminal = vi.fn(async () => openedTerminal)
    const activateTerminal = vi.fn()
    const writeTerminal = vi.fn(async () => undefined)

    const flow = useDockerContainerTerminalFlow({
      activeView,
      dockerDialogOpen,
      connections: () => [makeConnection(1)],
      openDedicatedTerminal,
      findTerminalBySession: (sessionId) =>
        sessionId === openedTerminal.sessionId ? openedTerminal : existingTerminal,
      activateTerminal,
      writeTerminal,
      showToast: vi.fn(),
      delay: async () => undefined,
    })

    await flow.connectDockerContainer({
      serverID: 1,
      containerID: 'def456',
      containerName: 'api',
    })

    expect(openDedicatedTerminal).toHaveBeenCalledWith(makeConnection(1))
    expect(activateTerminal).toHaveBeenCalledWith('session-second-container')
    expect(writeTerminal).toHaveBeenCalledWith(
      'session-second-container',
      encodeTerminalInputToBase64(
        "docker exec -it def456 sh -lc 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'\r",
      ),
    )
    expect(writeTerminal).not.toHaveBeenCalledWith(
      'session-first-container',
      expect.any(String),
    )
    expect(dockerDialogOpen.value).toBe(false)
    expect(activeView.value).toBe('terminals')
  })
})
