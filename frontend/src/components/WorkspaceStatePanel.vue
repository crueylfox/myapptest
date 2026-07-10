<script setup lang="ts">
import type { ServerWorkspace, TerminalSessionInfo } from '../types'

withDefaults(defineProps<{
  workspace: ServerWorkspace
  tab?: TerminalSessionInfo | null
  compact?: boolean
  showMessage?: boolean
  showTechnical?: boolean
}>(), {
  tab: null,
  compact: false,
  showMessage: true,
  showTechnical: true,
})

defineEmits<{
  reconnect: [workspace: ServerWorkspace, tab: TerminalSessionInfo | null]
  trustHostKey: [connectionId: number]
  editWorkspace: [connectionId: number]
  disconnectServer: [connectionId: number]
}>()

function workspaceHeading(workspace: ServerWorkspace) {
  if (workspace.status === 'failed') return '连接失败'
  if (workspace.status === 'connecting') return '正在建立 SSH 连接…'
  if (workspace.status === 'reconnecting') return '正在重新连接…'
  if (workspace.status === 'disconnected') return '连接已断开'
  return '尚未连接'
}

function isHostKeyWorkspaceError(workspace: ServerWorkspace) {
  const code = workspace.error?.code ?? ''
  return code === 'HOST_KEY_MISMATCH' || code === 'HOST_KEY_UNKNOWN'
}
</script>

<template>
  <div class="terminal-overlay workspace-state" :class="{ compact }">
    <span class="status-dot workspace-status-dot" :class="workspace.status"></span>
    <h2>{{ workspace.serverName }}</h2>
    <strong>{{ workspaceHeading(workspace) }}</strong>
    <span v-if="showMessage">{{ workspace.message }}</span>
    <details v-if="showTechnical && workspace.error?.technicalMessage">
      <summary>技术详情</summary>
      <code>{{ workspace.error.technicalMessage }}</code>
    </details>
    <div v-if="!['connecting', 'reconnecting'].includes(workspace.status)" class="workspace-actions">
      <button class="primary" @click="$emit('reconnect', workspace, tab)">
        {{ workspace.status === 'offline' ? '连接' : '重新连接' }}
      </button>
      <button
        v-if="isHostKeyWorkspaceError(workspace)"
        class="secondary"
        @click="$emit('trustHostKey', workspace.serverId)"
      >信任并更新后连接</button>
      <button v-else class="secondary" @click="$emit('editWorkspace', workspace.serverId)">编辑凭据</button>
      <button class="danger" @click="$emit('disconnectServer', workspace.serverId)">断开此服务器</button>
    </div>
  </div>
</template>
