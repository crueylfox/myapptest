<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/backend'
import { useTerminalClipboard } from '../composables/useTerminalClipboard'
import { useLocalTerminalStore } from '../stores/localTerminal'
import { defaultTerminalProfile } from '../stores/terminalProfiles'
import type { ContextMenuItem, ShortcutSettings, TerminalProfile } from '../types'
import {
  applyTerminalProfileOptions,
  normalizeTerminalProfileTheme,
  terminalProfileHostStyle,
  terminalProfileToXtermOptions,
} from '../utils/terminalProfile'
import {
  registerTerminalInstance,
  unregisterTerminalInstance,
  updateTerminalInstance,
} from '../utils/terminalInstanceRegistry'
import {
  decodeTerminalBase64ToBytes,
  encodeTerminalInputToBase64,
  isTerminalCompositionKeyEvent,
} from '../utils/terminalEncoding'
import { isWebviewZoomWheelGesture } from '../utils/webviewZoomGuard'
import {
  consumeTerminalShortcutEvent,
  isNativePasteShortcut,
  normalizeShortcutSettings,
  terminalShortcutActionForEvent,
  terminalContextMenuTriggerMatches,
} from '../utils/shortcutSettings'
import {
  applyTerminalFontSizeOption,
  clearTerminalZoomDelta,
  effectiveTerminalFontSizeForSession,
  registerTerminalWheelZoomHandler,
  nextTerminalZoomDeltaForSession,
  unregisterTerminalWheelZoomHandler,
} from '../utils/terminalZoom'
import ContextMenu from './ContextMenu.vue'

const props = withDefaults(defineProps<{
  sessionId: string
  active: boolean
  visible?: boolean
  layoutRevision: number
  copyOnSelectEnabled?: boolean
  rightClickPasteEnabled?: boolean
  profile?: TerminalProfile
  profileRevision?: number
  shortcutSettings?: ShortcutSettings
}>(), {
  visible: true,
  copyOnSelectEnabled: true,
  rightClickPasteEnabled: true,
  profile: () => defaultTerminalProfile,
  profileRevision: 0,
})
const emit = defineEmits<{
  size: [value: { columns: number; rows: number }]
  notify: [message: string, type: 'success' | 'error' | 'info']
  command: [sessionId: string, command: string]
}>()

const root = ref<HTMLDivElement>()
const host = ref<HTMLDivElement>()
const store = useLocalTerminalStore()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let observer: ResizeObserver | null = null
let selectionDisposable: { dispose: () => void } | null = null
let resizeTimer: number | null = null
let fitGeneration = 0
let destroyed = false
let lastColumns = 0
let lastRows = 0
let imeComposing = false
let suppressNativePasteUntil = 0
const terminalClipboard = useTerminalClipboard((message) => emit('notify', message, 'error'))
const terminalHostStyle = computed(() => terminalProfileHostStyle(props.profile))
const effectiveShortcuts = computed(() =>
  normalizeShortcutSettings(props.shortcutSettings, props.copyOnSelectEnabled, props.rightClickPasteEnabled))
const terminalMenu = ref<{ x: number; y: number } | null>(null)
const terminalMenuItems = computed<ContextMenuItem[]>(() => [
  { id: 'copy', label: '复制', disabled: !terminal?.hasSelection() },
  { id: 'paste', label: '粘贴' },
])
let localCommandBuffer = ''
let localCommandControlBuffer = ''

function nextFrame(): Promise<void> {
  if (typeof window.requestAnimationFrame === 'function') {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

async function fitStableLayout(generation: number) {
  await nextTick()
  await nextFrame()
  await nextFrame()
  if (
    destroyed
    || generation !== fitGeneration
    || !props.visible
    || !terminal
    || !fitAddon
    || !root.value
    || root.value.clientWidth === 0
    || root.value.clientHeight === 0
  ) return

  fitAddon.fit()
  if (terminal.cols === lastColumns && terminal.rows === lastRows) return
  lastColumns = terminal.cols
  lastRows = terminal.rows
  emit('size', { columns: terminal.cols, rows: terminal.rows })
  try {
    await api.resizeLocalTerminal(props.sessionId, terminal.cols, terminal.rows)
  } catch (reason) {
    if (!destroyed) emit('notify', String(reason).replace(/^Error:\s*/i, '') || '调整本地终端尺寸失败', 'error')
  }
}

function scheduleFit(delay = 36) {
  if (!props.visible) return
  const generation = ++fitGeneration
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null
    void fitStableLayout(generation)
  }, delay)
}

function applyCurrentProfile(profile = props.profile) {
  if (!terminal) return
  applyTerminalProfileOptions(terminal, profile)
  applyZoomedFontSize(profile.fontSize)
  host.value?.style.setProperty('--terminal-bg', normalizeTerminalProfileTheme(profile).background)
  scheduleFit()
}

function applyZoomedFontSize(baseFontSize = props.profile.fontSize) {
  if (!terminal) return
  const nextFontSize = effectiveTerminalFontSizeForSession(props.sessionId, baseFontSize)
  applyTerminalFontSizeOption(terminal, nextFontSize)
  scheduleFit(0)
}

function applyWheelZoomDelta(wheelDeltaY: number) {
  nextTerminalZoomDeltaForSession(props.sessionId, props.profile.fontSize, wheelDeltaY)
  applyZoomedFontSize()
}

function consumeTerminalWheelZoom(event: WheelEvent) {
  if (!isWebviewZoomWheelGesture(event)) return false
  event.preventDefault()
  event.stopPropagation()
  applyWheelZoomDelta(event.deltaY)
  return true
}

function handleTerminalWheel(event: WheelEvent) {
  consumeTerminalWheelZoom(event)
}

function handleXtermWheel(event: WheelEvent) {
  return !consumeTerminalWheelZoom(event)
}

async function pasteClipboard() {
  await terminalClipboard.pasteFromClipboard(async (text) => {
    await api.writeLocalTerminal(props.sessionId, encodeTerminalInputToBase64(text))
  }, true, terminal)
}

function markNativePasteSuppressed() {
  suppressNativePasteUntil = Date.now() + 500
}

function shouldSuppressNativePaste() {
  return Date.now() <= suppressNativePasteUntil
}

async function copySelection() {
  await terminalClipboard.copySelection(terminal)
}

function selectTerminalMenu(id: string) {
  terminalMenu.value = null
  if (id === 'copy') {
    void copySelection()
  } else if (id === 'paste') {
    void pasteClipboard()
  }
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const shortcuts = effectiveShortcuts.value
  const showMenu = shortcuts.terminalRightClickAction === 'menu' ||
    terminalContextMenuTriggerMatches(event, shortcuts.terminalContextMenuTrigger)
  if (showMenu) {
    terminalMenu.value = { x: event.clientX, y: event.clientY }
    return
  }
  if (shortcuts.terminalRightClickAction !== 'paste') return
  void pasteClipboard()
}

function handlePasteCapture(event: ClipboardEvent) {
  if (!shouldSuppressNativePaste()) return
  consumeTerminalShortcutEvent(event)
}

function observeLocalTerminalInput(data: string) {
  for (const char of stripLocalCommandControlSequences(data)) {
    if (char === '\r' || char === '\n') {
      submitLocalCommandBuffer()
      continue
    }
    if (char === '\u007f' || char === '\b') {
      localCommandBuffer = localCommandBuffer.slice(0, -1)
      continue
    }
    if (char === '\x03') {
      localCommandBuffer = ''
      localCommandControlBuffer = ''
      continue
    }
    if (char >= ' ' || char === '\t') {
      localCommandBuffer += char
      continue
    }
    localCommandBuffer = ''
  }
}

function stripLocalCommandControlSequences(data: string) {
  const input = localCommandControlBuffer + data
  localCommandControlBuffer = ''
  let output = ''
  for (let index = 0; index < input.length;) {
    if (input[index] !== '\x1b') {
      output += input[index]
      index += 1
      continue
    }
    if (index + 1 >= input.length) {
      localCommandControlBuffer = input.slice(index)
      break
    }
    const introducer = input[index + 1]
    if (introducer === '[') {
      const end = findAnsiCsiEnd(input, index + 2)
      if (end === -1) {
        localCommandControlBuffer = input.slice(index)
        break
      }
      index = end + 1
      continue
    }
    if (introducer === ']') {
      const end = findAnsiOscEnd(input, index + 2)
      if (end === -1) {
        localCommandControlBuffer = input.slice(index)
        break
      }
      index = end
      continue
    }
    index += 1
  }
  return output
}

function findAnsiCsiEnd(input: string, start: number) {
  for (let index = start; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) return index
  }
  return -1
}

function findAnsiOscEnd(input: string, start: number) {
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === '\x07') return index + 1
    if (input[index] === '\x1b' && input[index + 1] === '\\') return index + 2
  }
  return -1
}

function submitLocalCommandBuffer() {
  const command = localCommandBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  localCommandBuffer = ''
  if (!command) return
  emit('command', props.sessionId, command)
}

function runTerminalShortcut(event: KeyboardEvent) {
  if (isTerminalCompositionKeyEvent(event, imeComposing)) return false
  const action = terminalShortcutActionForEvent(event, effectiveShortcuts.value, {
    hasSelection: terminal?.hasSelection() ?? false,
    completionEnabled: false,
    commandPaletteEnabled: false,
  })
  if (!action) return false
  consumeTerminalShortcutEvent(event)
  if (action === 'paste' || action === 'suppress_native_paste' || isNativePasteShortcut(event)) markNativePasteSuppressed()
  if (action === 'copy') {
    void copySelection()
  } else if (action === 'paste') {
    void pasteClipboard()
  }
  return true
}

function handleKeydownCapture(event: KeyboardEvent) {
  runTerminalShortcut(event)
}

onMounted(async () => {
  destroyed = false
  terminal = new Terminal(terminalProfileToXtermOptions(props.profile))
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  if (root.value) terminal.open(root.value)
  terminal.attachCustomWheelEventHandler(handleXtermWheel)
  registerTerminalWheelZoomHandler(props.sessionId, applyWheelZoomDelta)
  root.value?.addEventListener('wheel', handleTerminalWheel, { capture: true, passive: false })
  root.value?.addEventListener('compositionstart', () => { imeComposing = true }, true)
  root.value?.addEventListener('compositionend', () => { imeComposing = false }, true)
  root.value?.addEventListener('contextmenu', handleContextMenu)
  terminal.onData((data) => {
    observeLocalTerminalInput(data)
    void api.writeLocalTerminal(props.sessionId, encodeTerminalInputToBase64(data))
      .catch((reason) => {
        if (!destroyed) emit('notify', String(reason).replace(/^Error:\s*/i, '') || '写入本地终端失败', 'error')
      })
  })
  selectionDisposable = (terminal as Terminal & {
    onSelectionChange?: (callback: () => void) => { dispose: () => void }
  }).onSelectionChange?.(() => {
    if (!effectiveShortcuts.value.terminalCopyOnSelectEnabled || !terminal?.hasSelection()) return
    void terminalClipboard.copySelection(terminal, false)
  }) ?? null
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    if (isTerminalCompositionKeyEvent(event, imeComposing)) return true
    if (runTerminalShortcut(event)) return false
    return true
  })
  store.registerOutput(props.sessionId, (dataBase64) => {
    if (!terminal || destroyed) return
    terminal.write(decodeTerminalBase64ToBytes(dataBase64))
  })
  observer = new ResizeObserver(() => {
    if (props.visible) scheduleFit()
  })
  if (root.value) observer.observe(root.value)
  await nextTick()
  if (destroyed) return
  registerTerminalInstance({
    id: props.sessionId,
    kind: 'local',
    serverID: null,
    resolvedProfileID: props.profile.id,
    inheritsDefaultProfile: true,
    applyProfile: applyCurrentProfile,
    observeInput: observeLocalTerminalInput,
  })
  scheduleFit()
  if (props.active && props.visible) terminal?.focus()
})

watch(() => props.profile.id, () => {
  updateTerminalInstance(props.sessionId, {
    resolvedProfileID: props.profile.id,
    inheritsDefaultProfile: true,
  })
})

watch(() => [props.active, props.visible, props.layoutRevision] as const, async ([active, visible]) => {
  if (!active || !visible) return
  await nextTick()
  scheduleFit()
  terminal?.focus()
})

watch(() => props.profileRevision, () => {
  applyCurrentProfile()
})

onBeforeUnmount(() => {
  destroyed = true
  fitGeneration += 1
  unregisterTerminalInstance(props.sessionId)
  store.unregisterOutput(props.sessionId)
  selectionDisposable?.dispose()
  observer?.disconnect()
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  root.value?.removeEventListener('wheel', handleTerminalWheel, true)
  unregisterTerminalWheelZoomHandler(props.sessionId)
  clearTerminalZoomDelta(props.sessionId)
  root.value?.removeEventListener('contextmenu', handleContextMenu)
  terminal?.dispose()
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div ref="host" class="terminal-view-host local-terminal-view-host" :style="terminalHostStyle">
    <div
      ref="root"
      class="terminal-view local-terminal-view"
      data-terminal-surface="true"
      data-terminal-kind="local"
      :data-terminal-session-id="sessionId"
      @keydown.capture="handleKeydownCapture"
      @paste.capture="handlePasteCapture"
    ></div>
    <ContextMenu
      v-if="terminalMenu"
      :x="terminalMenu.x"
      :y="terminalMenu.y"
      :items="terminalMenuItems"
      @close="terminalMenu = null"
      @select="selectTerminalMenu"
    />
  </div>
</template>
