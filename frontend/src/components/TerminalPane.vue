<script setup lang="ts">
import type { PaneAssignmentKind, SplitPaneId } from '../utils/workspaceSplitTypes'
import type { LocalTerminalCapabilities, LocalTerminalShellKind } from '../types'
import TerminalEmptyPane from './TerminalEmptyPane.vue'
import TerminalPaneHeader, { type TerminalPaneMoveOption } from './TerminalPaneHeader.vue'

const props = defineProps<{
  paneId: SplitPaneId
  active: boolean
  maximized: boolean
  dropTarget: boolean
  kind: PaneAssignmentKind | null
  title: string
  statusClass: string
  statusText: string
  sessionId?: string
  localSessionId?: string
  hasActivity: boolean
  activityLabel: string
  activityTitle: string
  menuOpen: boolean
  menuMode: 'main' | 'swap' | 'move'
  occupiedPaneOptions: TerminalPaneMoveOption[]
  emptyPaneOptions: TerminalPaneMoveOption[]
  localTerminalCapabilities?: LocalTerminalCapabilities | null
  paneStyle?: Record<string, string>
}>()

defineEmits<{
  paneClick: [paneId: SplitPaneId]
  dragStart: [paneId: SplitPaneId, event: PointerEvent]
  toggleMenu: [paneId: SplitPaneId]
  clearPane: [paneId: SplitPaneId]
  addServer: [paneId: SplitPaneId]
  connectSaved: [paneId: SplitPaneId]
  selectConnected: [paneId: SplitPaneId]
  newLocal: [paneId: SplitPaneId, shellKind: LocalTerminalShellKind | string]
  replaceTerminal: [paneId: SplitPaneId]
  clearActivity: [paneId: SplitPaneId]
  openSwapMenu: [paneId: SplitPaneId]
  swapPane: [sourcePaneId: SplitPaneId, targetPaneId: SplitPaneId]
  openMoveMenu: [paneId: SplitPaneId]
  movePane: [sourcePaneId: SplitPaneId, targetPaneId: SplitPaneId]
  toggleMaximize: [paneId: SplitPaneId]
}>()
</script>

<template>
  <section
    class="terminal-pane"
    :class="{ active, 'drop-target': dropTarget, maximized }"
    :style="paneStyle"
    :data-pane-id="paneId"
    @click="$emit('paneClick', paneId)"
  >
    <slot v-if="$slots.default"></slot>
    <template v-else>
    <TerminalPaneHeader
      v-if="kind"
      :pane-id="paneId"
      :kind="kind"
      :title="title"
      :status-class="statusClass"
      :status-text="statusText"
      :activity-label="activityLabel"
      :activity-title="activityTitle"
      :has-activity="hasActivity"
      :maximized="maximized"
      :menu-open="menuOpen"
      :menu-mode="menuMode"
      :occupied-pane-options="occupiedPaneOptions"
      :empty-pane-options="emptyPaneOptions"
      :local-terminal-capabilities="localTerminalCapabilities"
      @drag-start="(id, event) => $emit('dragStart', id, event)"
      @toggle-menu="$emit('toggleMenu', $event)"
      @clear-pane="$emit('clearPane', $event)"
      @add-server="$emit('addServer', $event)"
      @connect-saved="$emit('connectSaved', $event)"
      @select-connected="$emit('selectConnected', $event)"
      @new-local="(id, shellKind) => $emit('newLocal', id, shellKind)"
      @replace-terminal="$emit('replaceTerminal', $event)"
      @clear-activity="$emit('clearActivity', $event)"
      @open-swap-menu="$emit('openSwapMenu', $event)"
      @swap-pane="(source, target) => $emit('swapPane', source, target)"
      @open-move-menu="$emit('openMoveMenu', $event)"
      @move-pane="(source, target) => $emit('movePane', source, target)"
      @toggle-maximize="$emit('toggleMaximize', $event)"
    />
    <div
      class="terminal-pane-body"
      :class="{ 'terminal-pane-assigned': Boolean(kind), 'terminal-pane-empty-body': !kind }"
      :data-session-id="sessionId || undefined"
      :data-local-session-id="localSessionId || undefined"
    >
      <slot v-if="kind === 'ssh'" name="ssh"></slot>
      <slot v-else-if="kind === 'local'" name="local"></slot>
      <TerminalEmptyPane
        v-else
        :show-drop-message="true"
        @add-server="$emit('addServer', paneId)"
        @connect-saved="$emit('connectSaved', paneId)"
        @select-connected="$emit('selectConnected', paneId)"
      />
      <slot name="selector"></slot>
    </div>
    </template>
  </section>
</template>
