<script setup lang="ts">
import WorkspaceTabs from './WorkspaceTabs.vue'

defineOptions({ name: 'AppTopBar' })

withDefaults(defineProps<{
  alertUnreadCount?: number
}>(), {
  alertUnreadCount: 0,
})

const emit = defineEmits<{
  servers: [anchor: HTMLElement]
  monitorPanel: []
  alerts: []
  tunnels: []
  docker: []
  processes: []
  systemServices: []
  networkDiagnostics: []
  navigate: [view: 'terminals' | 'monitor' | 'logs' | 'settings']
  newTerminal: [connectionId?: number]
  reconnect: [sessionId: string, connectionId: number, code: string]
  editServer: [connectionId: number]
  disconnectServer: [connectionId: number]
  finalTerminalDisconnect: [connectionId: number]
  contextOpen: []
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()
</script>

<template>
  <WorkspaceTabs
    :alert-unread-count="alertUnreadCount"
    @servers="emit('servers', $event)"
    @alerts="emit('alerts')"
    @monitor-panel="emit('monitorPanel')"
    @tunnels="emit('tunnels')"
    @docker="emit('docker')"
    @processes="emit('processes')"
    @system-services="emit('systemServices')"
    @network-diagnostics="emit('networkDiagnostics')"
    @navigate="emit('navigate', $event)"
    @new-terminal="emit('newTerminal', $event)"
    @reconnect="(sessionId, connectionId, code) => emit('reconnect', sessionId, connectionId, code)"
    @edit-server="emit('editServer', $event)"
    @disconnect-server="emit('disconnectServer', $event)"
    @final-terminal-disconnect="emit('finalTerminalDisconnect', $event)"
    @context-open="emit('contextOpen')"
    @notify="(message, type) => emit('notify', message, type)"
  />
</template>
