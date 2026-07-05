import { nextTick, type Ref } from 'vue'
import type { AppPanelView } from '../utils/appPanelModel'
import { buildDockerExecShellCommand } from '../utils/dockerContainerShell'
import { encodeTerminalInputToBase64 } from '../utils/terminalEncoding'
import type { Connection, TerminalSessionInfo } from '../types'

type DockerContainerConnectPayload = {
  serverID: number
  containerID: string
  containerName: string
}

type DockerTerminalSession = Pick<TerminalSessionInfo, 'sessionId' | 'status'>

export interface DockerContainerTerminalFlowOptions {
  activeView: Ref<AppPanelView>
  dockerDialogOpen: Ref<boolean>
  connections: () => Connection[]
  openDedicatedTerminal: (connection: Connection) => Promise<DockerTerminalSession | null | undefined>
  findTerminalBySession: (sessionId: string) => DockerTerminalSession | null | undefined
  activateTerminal: (sessionId: string) => void
  writeTerminal: (sessionId: string, dataBase64: string) => Promise<void>
  showToast: (message: string, type: 'success' | 'error' | 'info') => void
  delay?: (ms: number) => Promise<void>
}

export function useDockerContainerTerminalFlow(options: DockerContainerTerminalFlowOptions) {
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)))

  async function waitForOnlineTerminal(sessionId: string, initialTerminal?: DockerTerminalSession | null) {
    if (initialTerminal?.status === 'online') return initialTerminal
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await nextTick()
      const terminal = options.findTerminalBySession(sessionId)
      if (terminal?.status === 'online') return terminal
      if (terminal?.status === 'error' || terminal?.status === 'offline') {
        return null
      }
      await delay(100)
    }
    return null
  }

  async function connectDockerContainer(payload: DockerContainerConnectPayload) {
    const connection = options.connections().find((item) => item.id === payload.serverID)
    if (!connection) {
      options.showToast('未找到容器所在服务器。', 'error')
      return
    }

    let command: string
    try {
      command = buildDockerExecShellCommand(payload.containerID)
    } catch {
      options.showToast('容器 ID 不安全，已取消连接。', 'error')
      return
    }

    options.dockerDialogOpen.value = false
    const openedTerminal = await options.openDedicatedTerminal(connection)
    if (!openedTerminal?.sessionId) {
      options.showToast('SSH 终端尚未连接，无法进入容器。', 'error')
      return
    }

    const terminal = await waitForOnlineTerminal(openedTerminal.sessionId, openedTerminal)
    if (!terminal) {
      options.showToast('SSH 终端尚未连接，无法进入容器。', 'error')
      return
    }

    options.activateTerminal(terminal.sessionId)
    options.activeView.value = 'terminals'
    await options.writeTerminal(terminal.sessionId, encodeTerminalInputToBase64(command))
    options.showToast(`正在进入容器「${payload.containerName || payload.containerID}」。`, 'info')
  }

  return { connectDockerContainer }
}
