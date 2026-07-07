// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TunnelManagerDialog from './TunnelManagerDialog.vue'
import componentSource from './TunnelManagerDialog.vue?raw'
import { useTunnelStore } from '../stores/tunnels'
import type { Connection, SaveTunnelProfileRequest, TunnelProfile, TunnelRuntime } from '../types'

const dialog = vi.hoisted(() => ({
  confirmDialog: vi.fn(async () => true),
  choiceDialog: vi.fn(async () => 'save'),
}))

vi.mock('../composables/useAppDialog', () => ({
  confirmDialog: dialog.confirmDialog,
  choiceDialog: dialog.choiceDialog,
}))

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

const connection: Connection = {
  id: 7,
  groupId: null,
  name: 'server',
  host: '192.0.2.7',
  port: 22,
  username: 'root',
  authType: 'password',
  privateKeySource: 'local_file',
  privateKeyPath: '',
  keyVaultId: null,
  hostKeyFingerprint: '',
  credentialSaved: true,
  refreshInterval: 2,
  createdAt: '',
  updatedAt: '',
}

function profile(values: Partial<TunnelProfile> = {}): TunnelProfile {
  return {
    id: 2,
    name: 'web',
    serverID: 7,
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: 8080,
    targetHost: '127.0.0.1',
    targetPort: 80,
    remoteBindHost: '',
    remoteBindPort: 0,
    autoStart: false,
    createdAt: '',
    updatedAt: '',
    ...values,
  }
}

function runtime(values: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    tunnelID: 'tun-1',
    serverID: 7,
    profileID: 2,
    name: 'web',
    type: 'local',
    status: 'running',
    bindHost: '127.0.0.1',
    bindPort: 8080,
    targetHost: '127.0.0.1',
    targetPort: 80,
    remoteBindHost: '',
    remoteBindPort: 0,
    requestedListen: '',
    actualListen: '',
    effectiveRemoteBindHost: '',
    effectiveListenAddrs: [],
    remoteListenExposure: 'unknown',
    remoteListenCheckStatus: 'unchecked',
    remoteListenWarning: '',
    testCommand: '',
    activeConnections: 0,
    bytesIn: 0,
    bytesOut: 0,
    startedAt: '',
    updatedAt: '',
    error: '',
    ...values,
  }
}

function app() {
  return window.go!.main!.App!
}

function mountDialog() {
  setActivePinia(createPinia())
  return mount(TunnelManagerDialog, {
    props: {
      open: true,
      connections: [connection],
      activeServerId: 7,
    },
  })
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('TunnelManagerDialog', () => {
  it('uses shared glass tokens for the dialog shell and card surfaces', () => {
    expect(componentSource).toContain('background: var(--material-backdrop-bg)')
    expect(componentSource).toContain('background: var(--material-surface-bg)')
    expect(componentSource).toContain('border: 1px solid var(--material-border')
    expect(componentSource).toContain('box-shadow: var(--material-shadow)')
    expect(componentSource).toContain('backdrop-filter: var(--material-blur)')
    expect(componentSource).toContain('-webkit-backdrop-filter: var(--material-blur)')
    expect(componentSource).toContain('background: var(--material-toolbar-bg)')
    expect(componentSource).toContain('background: var(--material-card-bg)')
    expect(componentSource).not.toContain('background: var(--panel, #101827)')
  })

  beforeEach(() => {
    dialog.confirmDialog.mockReset()
    dialog.confirmDialog.mockResolvedValue(true)
    dialog.choiceDialog.mockReset()
    dialog.choiceDialog.mockResolvedValue('save')
    window.go = {
      main: {
        App: {
          ListTunnelProfiles: vi.fn(async () => []),
          ListTunnels: vi.fn(async () => []),
          CreateTunnelProfile: vi.fn(async (request: SaveTunnelProfileRequest) => ({
            ...request,
            id: 1,
            createdAt: '',
            updatedAt: '',
          })),
          UpdateTunnelProfile: vi.fn(async (request: SaveTunnelProfileRequest) => ({
            ...request,
            createdAt: '',
            updatedAt: '',
          })),
          DeleteTunnelProfile: vi.fn(async () => undefined),
          StartTunnel: vi.fn(async (request: { serverID: number; profileID: number; type: TunnelRuntime['type'] }) => runtime({
            tunnelID: 'tun-started',
            serverID: request.serverID,
            profileID: request.profileID,
            type: request.type,
          })),
          StopTunnel: vi.fn(async () => undefined),
          CheckTunnelRemoteListen: vi.fn(async () => runtime({
            tunnelID: 'tun-remote',
            serverID: 7,
            profileID: 2,
            name: 'remote ssh',
            type: 'remote',
            status: 'running',
            remoteBindHost: '0.0.0.0',
            remoteBindPort: 12380,
            targetHost: '192.168.0.252',
            targetPort: 22,
            requestedListen: '0.0.0.0:12380',
            actualListen: '0.0.0.0:12380',
            effectiveRemoteBindHost: '0.0.0.0',
            effectiveListenAddrs: ['0.0.0.0:12380'],
            remoteListenExposure: 'public',
            remoteListenCheckStatus: 'listening',
            remoteListenWarning: '',
            testCommand: 'ssh -p 12380 root@192.0.2.7',
          })),
          InspectRemoteForwardAccess: vi.fn(async () => ({
            serverID: 7,
            sshdType: 'openssh',
            configPath: '/etc/ssh/sshd_config',
            gatewayPortsEffective: 'no',
            allowTcpForwardingEffective: 'yes',
            canModify: true,
            requiresSudo: false,
            warnings: [],
          })),
          EnableRemoteForwardAccess: vi.fn(async () => ({
            success: true,
            backupPath: '/etc/ssh/sshd_config.serverpilot.bak.20260618210000',
            changedFiles: ['/etc/ssh/sshd_config'],
            reloadCommand: 'systemctl reload sshd',
            message: 'GatewayPorts yes 已启用。',
            warnings: [],
          })),
          EnableRemoteForwardAccessAndRestart: vi.fn(async () => ({
            access: {
              success: true,
              backupPath: '/etc/ssh/sshd_config.serverpilot.bak.20260618210000',
              changedFiles: ['/etc/ssh/sshd_config'],
              reloadCommand: 'systemctl reload sshd',
              message: 'GatewayPorts yes 已启用并已重启隧道。',
              warnings: [],
            },
            runtime: runtime({
              tunnelID: 'tun-restarted',
              serverID: 7,
              profileID: 2,
              name: 'remote ssh',
              type: 'remote',
              status: 'running',
              remoteBindHost: '0.0.0.0',
              remoteBindPort: 12380,
              targetHost: '192.168.0.252',
              targetPort: 22,
              requestedListen: '0.0.0.0:12380',
              actualListen: '0.0.0.0:12380',
              effectiveRemoteBindHost: '0.0.0.0',
              effectiveListenAddrs: ['0.0.0.0:12380'],
              remoteListenExposure: 'public',
              remoteListenCheckStatus: 'listening',
              remoteListenWarning: '',
              testCommand: 'ssh -p 12380 root@192.0.2.7',
            }),
          })),
        } as never,
      },
    }
  })

  it('shows one create button and simplified type choices without advanced section', async () => {
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.find('[data-testid="new-tunnel-profile"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('新建端口转发')
    expect(wrapper.text()).not.toContain('新建本地')
    expect(wrapper.text()).not.toContain('新建远程')
    expect(wrapper.text()).not.toContain('新建 SOCKS5')
    expect(wrapper.find('[data-testid="tunnel-type-local"]').text()).toContain('本地转发')
    expect(wrapper.find('[data-testid="tunnel-type-remote"]').text()).toContain('远程转发')
    expect(wrapper.find('[data-testid="tunnel-type-dynamic"]').text()).toContain('SOCKS5 代理')
    expect(wrapper.text()).toContain('在本机创建 SOCKS5 代理')
    expect(wrapper.text()).not.toContain('高级选项')
    expect(wrapper.text()).toContain('连接服务器后自动启动')
  })

  it('saves and starts a local tunnel profile', async () => {
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('form').trigger('submit')
    await flush()

    expect(app().CreateTunnelProfile).toHaveBeenCalled()
    expect(app().StartTunnel).toHaveBeenCalledWith(expect.objectContaining({
      serverID: 7,
      profileID: 1,
      type: 'local',
      bindHost: '127.0.0.1',
      bindPort: 8080,
      targetHost: '127.0.0.1',
      targetPort: 80,
    }))
  })

  it('requires in-app confirmation before starting a public remote bind tunnel', async () => {
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="tunnel-type-remote"]').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flush()

    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('监听 0.0.0.0'),
    }))
    expect(app().StartTunnel).toHaveBeenCalledWith(expect.objectContaining({
      type: 'remote',
      remoteBindHost: '0.0.0.0',
      confirmPublicBind: true,
    }))
  })

  it('clicking a profile card enters edit mode without an edit button', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.find('[data-testid="edit-profile"]').exists()).toBe(false)
    await wrapper.find('[data-testid="tunnel-profile-card"]').trigger('click')
    await flush()

    expect(wrapper.find('[data-testid="tunnel-name"]').element).toHaveProperty('value', 'web')
    expect(wrapper.find('[data-testid="tunnel-profile-card"]').classes()).toContain('active')
  })

  it('stop and delete buttons do not trigger profile edit through card click', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    app().ListTunnels = vi.fn(async () => [runtime()])
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="stop-profile-runtime"]').trigger('click')
    await flush()
    expect(app().StopTunnel).toHaveBeenCalledWith({ serverID: 7, tunnelID: 'tun-1' })
    expect(wrapper.find('[data-testid="tunnel-name"]').element).not.toHaveProperty('value', 'web')

    await wrapper.find('[data-testid="delete-profile"]').trigger('click')
    await flush()
    expect(app().DeleteTunnelProfile).toHaveBeenCalledWith(2)
    expect(wrapper.find('[data-testid="tunnel-name"]').element).not.toHaveProperty('value', 'web')
  })

  it('places the edit form on the left, profile list on the right, and actions in the card header', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    app().ListTunnels = vi.fn(async () => [runtime()])
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.find('.tunnel-profile-form').classes()).toContain('tunnel-profile-form')
    expect(wrapper.find('.tunnel-profile-list').classes()).toContain('tunnel-profile-list')
    expect(wrapper.find('.tunnel-profile-form').attributes('style')).toBeUndefined()
    expect(wrapper.find('.tunnel-profile-card .tunnel-card-header .tunnel-card-actions [data-testid="stop-profile-runtime"]').exists()).toBe(true)
    expect(wrapper.find('.tunnel-profile-card > .tunnel-card-actions').exists()).toBe(false)
  })

  it('lays out local and server endpoint address and port fields in two compact rows', async () => {
    const wrapper = mountDialog()
    await flush()

    let rows = wrapper.findAll('[data-testid="tunnel-endpoint-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('我的电脑地址')
    expect(rows[0].text()).toContain('我的电脑端口')
    expect(rows[1].text()).toContain('服务器地址')
    expect(rows[1].text()).toContain('服务器端口')

    await wrapper.get('[data-testid="tunnel-type-remote"]').trigger('click')
    await flush()
    rows = wrapper.findAll('[data-testid="tunnel-endpoint-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('服务器地址')
    expect(rows[0].text()).toContain('服务器端口')
    expect(rows[1].text()).toContain('我的电脑地址')
    expect(rows[1].text()).toContain('我的电脑端口')
  })

  it('prompts to save, discard, or cancel before switching away from unsaved edits', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [
      profile({ id: 2, name: 'web' }),
      profile({ id: 3, name: 'api', bindPort: 8081 }),
    ])
    const wrapper = mountDialog()
    await flush()

    await wrapper.findAll('[data-testid="tunnel-profile-card"]')[0].trigger('click')
    await wrapper.find('[data-testid="tunnel-name"]').setValue('web changed')
    dialog.choiceDialog.mockResolvedValueOnce(null as never)
    await wrapper.findAll('[data-testid="tunnel-profile-card"]')[1].trigger('click')
    await flush()
    expect(dialog.choiceDialog).toHaveBeenCalledWith(expect.objectContaining({
      confirmText: '保存',
      secondaryText: '放弃',
      cancelText: '取消',
    }))
    expect(wrapper.find('[data-testid="tunnel-name"]').element).toHaveProperty('value', 'web changed')

    dialog.choiceDialog.mockResolvedValueOnce('discard')
    await wrapper.findAll('[data-testid="tunnel-profile-card"]')[1].trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="tunnel-name"]').element).toHaveProperty('value', 'api')
  })

  it('saves current dirty edit before switching when user chooses save', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [
      profile({ id: 2, name: 'web' }),
      profile({ id: 3, name: 'api', bindPort: 8081 }),
    ])
    dialog.choiceDialog.mockResolvedValueOnce('save')
    const wrapper = mountDialog()
    await flush()

    await wrapper.findAll('[data-testid="tunnel-profile-card"]')[0].trigger('click')
    await wrapper.find('[data-testid="tunnel-name"]').setValue('web changed')
    await wrapper.findAll('[data-testid="tunnel-profile-card"]')[1].trigger('click')
    await flush()

    expect(app().UpdateTunnelProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 2,
      name: 'web changed',
    }))
    expect(wrapper.find('[data-testid="tunnel-name"]').element).toHaveProperty('value', 'api')
  })

  it('updates the original profile when editing and changing tunnel type', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="tunnel-profile-card"]').trigger('click')
    await wrapper.find('[data-testid="tunnel-type-remote"]').trigger('click')
    await wrapper.find('[data-testid="save-profile"]').trigger('click')
    await flush()

    expect(app().UpdateTunnelProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 2,
      type: 'remote',
      remoteBindHost: '0.0.0.0',
    }))
    expect(app().CreateTunnelProfile).not.toHaveBeenCalled()
    expect(useTunnelStore().profilesForServer(7)).toHaveLength(1)
  })

  it('does not save a running profile edit when restart confirmation is cancelled', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    app().ListTunnels = vi.fn(async () => [runtime()])
    dialog.confirmDialog.mockResolvedValueOnce(false)
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="tunnel-profile-card"]').trigger('click')
    await wrapper.find('[data-testid="tunnel-type-dynamic"]').trigger('click')
    await wrapper.find('[data-testid="save-profile"]').trigger('click')
    await flush()

    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('保存修改需要先停止当前隧道并重新启动'),
    }))
    expect(app().StopTunnel).not.toHaveBeenCalled()
    expect(app().UpdateTunnelProfile).not.toHaveBeenCalled()
  })

  it('stops, updates, and restarts a running profile after confirmation', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    app().ListTunnels = vi.fn(async () => [runtime()])
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="tunnel-profile-card"]').trigger('click')
    await wrapper.find('[data-testid="tunnel-type-dynamic"]').trigger('click')
    await wrapper.find('[data-testid="save-profile"]').trigger('click')
    await flush()

    expect(app().StopTunnel).toHaveBeenCalledWith({ serverID: 7, tunnelID: 'tun-1' })
    expect(app().UpdateTunnelProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 2,
      type: 'dynamic',
    }))
    expect(app().StartTunnel).toHaveBeenCalledWith(expect.objectContaining({
      profileID: 2,
      type: 'dynamic',
    }))
  })

  it('deleting a running profile confirms, stops runtime, and removes runtime state', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    app().ListTunnels = vi.fn(async () => [runtime()])
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="delete-profile"]').trigger('click')
    await flush()

    expect(dialog.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('删除会先停止隧道并释放端口'),
    }))
    expect(app().StopTunnel).toHaveBeenCalledWith({ serverID: 7, tunnelID: 'tun-1' })
    expect(app().DeleteTunnelProfile).toHaveBeenCalledWith(2)
    expect(useTunnelStore().runtimesById['tun-1']).toBeUndefined()
  })

  it('keeps a profile visible when delete stop verification fails', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile()])
    app().ListTunnels = vi.fn(async () => [runtime()])
    app().StopTunnel = vi.fn(async () => {
      throw new Error('端口转发停止失败，配置未删除，请先手动停止后再删除。')
    })
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="delete-profile"]').trigger('click')
    await flush()

    expect(app().DeleteTunnelProfile).not.toHaveBeenCalled()
    expect(useTunnelStore().profilesForServer(7)).toHaveLength(1)
    expect(wrapper.emitted('notify')?.at(-1)?.[0]).toBe('端口转发停止失败，配置未删除，请先手动停止后再删除。')
  })

  it('maps raw tunnel profile unique constraint errors to a Chinese duplicate-name toast', async () => {
    app().CreateTunnelProfile = vi.fn(async () => {
      throw new Error("constraint failed: UNIQUE constraint failed: index 'idx_tunnel_profiles_server_name' (2067)")
    })
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="save-profile"]').trigger('click')
    await flush()

    const message = wrapper.emitted('notify')?.at(-1)?.[0]
    expect(message).toBe('该服务器下已存在同名端口转发配置，请修改名称。')
    expect(String(message)).not.toContain('idx_tunnel_profiles_server_name')
    expect(String(message)).not.toContain('(2067)')
  })

  it('shows loopback-only diagnostics and rechecks through backend', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile({
      name: 'remote ssh',
      type: 'remote',
      bindHost: '',
      bindPort: 0,
      targetHost: '192.168.0.252',
      targetPort: 22,
      remoteBindHost: '0.0.0.0',
      remoteBindPort: 12380,
    })])
    app().ListTunnels = vi.fn(async () => [runtime({
      tunnelID: 'tun-remote',
      name: 'remote ssh',
      type: 'remote',
      bindHost: '',
      bindPort: 0,
      targetHost: '192.168.0.252',
      targetPort: 22,
      remoteBindHost: '0.0.0.0',
      remoteBindPort: 12380,
      requestedListen: '0.0.0.0:12380',
      actualListen: '127.0.0.1:12380\n[::1]:12380',
      effectiveRemoteBindHost: '127.0.0.1',
      effectiveListenAddrs: ['127.0.0.1:12380', '[::1]:12380'],
      remoteListenExposure: 'loopback_only',
      remoteListenCheckStatus: 'loopback_only',
      remoteListenWarning: '服务器实际只监听 127.0.0.1，局域网无法访问。请检查 sshd 的 GatewayPorts 配置和防火墙。',
      testCommand: 'ssh -p 12380 root@127.0.0.1',
    })])
    const wrapper = mountDialog()
    await flush()

    expect(wrapper.find('[data-testid="remote-listen-diagnostics"]').text()).toContain('0.0.0.0:12380')
    expect(wrapper.text()).toContain('运行中（仅服务器本机）')
    expect(wrapper.text()).toContain('127.0.0.1:12380')
    expect(wrapper.text()).toContain('[::1]:12380')
    expect(wrapper.text()).toContain('GatewayPorts')
    expect(wrapper.text()).toContain('ssh -p 12380 root@127.0.0.1')
    expect(wrapper.find('[data-testid="enable-remote-access"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('运行中（局域网可访问）')

    await wrapper.find('[data-testid="check-remote-listen"]').trigger('click')
    await flush()
    expect(app().CheckTunnelRemoteListen).toHaveBeenCalledWith({ serverID: 7, tunnelID: 'tun-remote' })
    expect(wrapper.text()).toContain('运行中（局域网可访问）')
    expect(wrapper.text()).toContain('ssh -p 12380 root@192.0.2.7')
    expect(wrapper.find('[data-testid="enable-remote-access"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('服务器实际只监听 127.0.0.1')
  })

  it('enables GatewayPorts through stop-modify-restart flow and hides old warning after public recheck', async () => {
    app().ListTunnelProfiles = vi.fn(async () => [profile({
      name: 'remote ssh',
      type: 'remote',
      bindHost: '',
      bindPort: 0,
      targetHost: '192.168.0.252',
      targetPort: 22,
      remoteBindHost: '0.0.0.0',
      remoteBindPort: 12380,
    })])
    app().ListTunnels = vi.fn(async () => [runtime({
      tunnelID: 'tun-remote',
      name: 'remote ssh',
      type: 'remote',
      bindHost: '',
      bindPort: 0,
      targetHost: '192.168.0.252',
      targetPort: 22,
      remoteBindHost: '0.0.0.0',
      remoteBindPort: 12380,
      requestedListen: '0.0.0.0:12380',
      actualListen: '127.0.0.1:12380',
      effectiveListenAddrs: ['127.0.0.1:12380'],
      remoteListenExposure: 'loopback_only',
      remoteListenCheckStatus: 'loopback_only',
      remoteListenWarning: '服务器实际只监听 127.0.0.1，局域网无法访问。',
      testCommand: 'ssh -p 12380 root@127.0.0.1',
    })])
    dialog.confirmDialog.mockResolvedValueOnce(false)
    const wrapper = mountDialog()
    await flush()

    await wrapper.find('[data-testid="enable-remote-access"]').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('放行并重启')
    expect(app().EnableRemoteForwardAccessAndRestart).not.toHaveBeenCalled()

    dialog.confirmDialog.mockResolvedValueOnce(true)
    await wrapper.find('[data-testid="enable-remote-access"]').trigger('click')
    await flush()
    expect(dialog.confirmDialog).toHaveBeenLastCalledWith(expect.objectContaining({
      danger: true,
      message: expect.stringContaining('GatewayPorts yes'),
    }))
    expect(app().EnableRemoteForwardAccess).not.toHaveBeenCalled()
    expect(app().EnableRemoteForwardAccessAndRestart).toHaveBeenCalledWith({
      serverID: 7,
      tunnelID: 'tun-remote',
      profileID: 2,
      auth: expect.objectContaining({ password: '', passphrase: '' }),
    })
    expect(wrapper.text()).toContain('运行中（局域网可访问）')
    expect(wrapper.find('[data-testid="enable-remote-access"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('服务器实际只监听 127.0.0.1')
  })
})
