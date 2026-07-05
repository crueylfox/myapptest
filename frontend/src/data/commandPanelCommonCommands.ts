export type CommandShellType = 'ssh' | 'cmd' | 'powershell' | 'any'

export interface CommandPanelCommonCommand {
  id: string
  title: string
  command: string
  description: string
  shell: CommandShellType
}

export const commandPanelCommonCommands: CommandPanelCommonCommand[] = [
  { id: 'ssh-systemctl-status', title: 'systemctl status', command: 'systemctl status', description: 'View systemd service status', shell: 'ssh' },
  { id: 'ssh-journalctl-xe', title: 'journalctl -xe', command: 'journalctl -xe', description: 'View recent system log errors', shell: 'ssh' },
  { id: 'ssh-docker-ps', title: 'docker ps', command: 'docker ps', description: 'List running containers', shell: 'ssh' },
  { id: 'ssh-df-h', title: 'df -h', command: 'df -h', description: 'Show filesystem usage', shell: 'ssh' },
  { id: 'ssh-free-h', title: 'free -h', command: 'free -h', description: 'Show memory usage', shell: 'ssh' },
  { id: 'cmd-dir', title: 'dir', command: 'dir', description: 'List current directory', shell: 'cmd' },
  { id: 'cmd-ipconfig', title: 'ipconfig', command: 'ipconfig', description: 'Show Windows network configuration', shell: 'cmd' },
  { id: 'cmd-tasklist', title: 'tasklist', command: 'tasklist', description: 'List running processes', shell: 'cmd' },
  { id: 'powershell-get-childitem', title: 'Get-ChildItem', command: 'Get-ChildItem', description: 'List current directory', shell: 'powershell' },
  { id: 'powershell-get-process', title: 'Get-Process', command: 'Get-Process', description: 'List running processes', shell: 'powershell' },
  { id: 'powershell-get-service', title: 'Get-Service', command: 'Get-Service', description: 'List services', shell: 'powershell' },
  { id: 'any-echo', title: 'echo', command: 'echo ok', description: 'Print a test value', shell: 'any' },
]
