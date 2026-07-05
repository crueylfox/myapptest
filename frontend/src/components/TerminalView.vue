<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/backend'
import { confirmDialog } from '../composables/useAppDialog'
import { commandPaletteShortcutIntentForEvent } from '../composables/useGlobalShortcutBridge'
import { useTerminalClipboard } from '../composables/useTerminalClipboard'
import {
  buildCommandCompletionSuggestions,
  commandCompletionToken,
  commandCompletionTriggerLength,
  commandLooksSensitive,
  completionInsertText,
} from '../composables/useCommandCompletion'
import {
  calculateTerminalCompletionPosition,
  terminalCompletionOverlayWidth,
  type TerminalCompletionPosition,
} from '../composables/terminalCompletionPosition'
import {
  builtinLinuxCommandCompletions,
  commonLinuxCommandCompletions,
} from '../data/linuxCommandCompletions'
import { useCommandStore } from '../stores/commands'
import { useTerminalStore } from '../stores/terminal'
import type { CommandSuggestion, Connection, ContextMenuItem, SaveCommandFavoriteRequest, ShortcutSettings, TerminalProfile } from '../types'
import { defaultTerminalProfile } from '../stores/terminalProfiles'
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
import { TerminalViewportHighlighter } from '../utils/terminalViewportHighlighter'
import {
  detectFileEditorHighlightHint,
  type TerminalFileEditorHighlightHint,
} from '../utils/terminalFileEditorHint'
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
import {
  getSshCommandCompletionPreferences,
  setSshCommandCompletionEnabled,
  sshCommandCompletionPreferenceEvent,
  type SshCommandCompletionPreferences,
} from '../utils/sshCommandCompletionPreference'
import TerminalCompletionOverlay from './TerminalCompletionOverlay.vue'
import ContextMenu from './ContextMenu.vue'

const props = withDefaults(defineProps<{
  sessionId: string
  active: boolean
  connection?: Connection | null
  visible?: boolean
  layoutRevision: number
  copyOnSelectEnabled?: boolean
  rightClickPasteEnabled?: boolean
  profile?: TerminalProfile
  profileRevision?: number
  shortcutSettings?: ShortcutSettings
}>(), {
  visible: true,
  connection: null,
  copyOnSelectEnabled: true,
  rightClickPasteEnabled: true,
  profile: () => defaultTerminalProfile,
  profileRevision: 0,
})
const emit = defineEmits<{
  size: [value: { columns: number; rows: number }]
  commands: [tab: 'history' | 'favorites']
  commandSkip: [message: string]
  close: []
}>()
const root = ref<HTMLDivElement>()
const host = ref<HTMLDivElement>()
const store = useTerminalStore()
const commandStore = useCommandStore()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let viewportHighlighter: TerminalViewportHighlighter | null = null
let observer: ResizeObserver | null = null
let resizeTimer: number | null = null
let fitGeneration = 0
let selectionDisposable: { dispose: () => void } | null = null
let destroyed = false
let lastColumns = 0
let lastRows = 0
let lineBuffer = ''
let lineCursor = 0
let lineBufferDirty = false
let lineBufferTooLong = false
let continuationLines: string[] = []
let alternateScreenActive = false
let alternateScreenHighlightHint: TerminalFileEditorHighlightHint | null = null
let sensitivePromptPending = false
let imeComposing = false
let suppressNativePasteUntil = 0
const maxHistoryCommandLength = 32 * 1024
const showScrollToBottom = ref(false)
const completionOpen = ref(false)
const completionBusy = ref(false)
const completionSelectedIndex = ref(0)
const completionPrefix = ref('')
const completionSuggestions = ref<CommandSuggestion[]>([])
const completionPosition = ref<TerminalCompletionPosition | null>(null)
const completionPreferences = getSshCommandCompletionPreferences()
const completionEnabled = ref(completionPreferences.enabled)
const completionShowDescriptions = ref(completionPreferences.showDescriptions)
const completionMaxSuggestions = ref(completionPreferences.maxSuggestions)
const completionTriggerChars = ref(completionPreferences.triggerChars)
let completionGeneration = 0
const terminalClipboard = useTerminalClipboard((message) => emit('commandSkip', message))
const alternateScreenHintTTL = 15_000
const terminalHostStyle = computed(() => terminalProfileHostStyle(props.profile))
const effectiveShortcuts = computed(() =>
  normalizeShortcutSettings(props.shortcutSettings, props.copyOnSelectEnabled, props.rightClickPasteEnabled))
const terminalMenu = ref<{ x: number; y: number } | null>(null)
const terminalMenuItems = computed<ContextMenuItem[]>(() => [
  { id: 'copy', label: '复制', disabled: !terminal?.hasSelection() },
  { id: 'paste', label: '粘贴' },
  { id: 'separator', label: '', separator: true },
  { id: 'history', label: '历史命令' },
  { id: 'favorites', label: '常用命令' },
])

function nextFrame(): Promise<void> {
  if (typeof window.requestAnimationFrame === 'function') {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function isAtBottom(): boolean {
  if (!terminal) return true
  const buffer = terminal.buffer.active
  return buffer.baseY - buffer.viewportY <= 1
}

function scrollToBottom() {
  terminal?.scrollToBottom()
  showScrollToBottom.value = false
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
    await api.resizeTerminal(props.sessionId, terminal.cols, terminal.rows)
  } catch (reason) {
    if (!destroyed) console.error('Unable to resize remote terminal', reason)
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
  viewportHighlighter?.schedule()
  scheduleFit(0)
}

function updateViewportHighlightPause() {
  viewportHighlighter?.setPaused(!props.active || !props.visible || (alternateScreenActive && !currentAlternateScreenHighlightHint()))
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

async function pasteClipboard(showError = true) {
  await terminalClipboard.pasteFromClipboard((text) => {
    if (terminal) terminal.paste(text)
  }, showError, terminal)
}

function markNativePasteSuppressed() {
  suppressNativePasteUntil = Date.now() + 500
}

function shouldSuppressNativePaste() {
  return Date.now() <= suppressNativePasteUntil
}

function activeConnectionId() {
  return store.tabs.find((tab) => tab.sessionId === props.sessionId)?.connectionId ?? 0
}

function resetCommandCaptureState(dirty = false, tooLong = false) {
  lineBuffer = ''
  lineCursor = 0
  lineBufferDirty = dirty
  lineBufferTooLong = tooLong
  continuationLines = []
}

function setLineBuffer(value: string, cursor = value.length) {
  lineBuffer = value
  lineCursor = Math.min(Math.max(0, cursor), lineBuffer.length)
}

function insertLineText(value: string) {
  if (!value) return
  setLineBuffer(`${lineBuffer.slice(0, lineCursor)}${value}${lineBuffer.slice(lineCursor)}`, lineCursor + value.length)
}

function backspaceLineText() {
  if (lineCursor <= 0) return
  setLineBuffer(`${lineBuffer.slice(0, lineCursor - 1)}${lineBuffer.slice(lineCursor)}`, lineCursor - 1)
}

function deleteLineText() {
  if (lineCursor >= lineBuffer.length) return
  setLineBuffer(`${lineBuffer.slice(0, lineCursor)}${lineBuffer.slice(lineCursor + 1)}`, lineCursor)
}

function moveLineCursor(delta: number) {
  lineCursor = Math.min(Math.max(0, lineCursor + delta), lineBuffer.length)
}

function readEditableEscapeSequence(data: string, index: number) {
  const rest = data.slice(index)
  const countedMove = rest.match(/^\x1b\[(\d+)([CD])/)
  if (countedMove) {
    return {
      length: countedMove[0].length,
      apply: () => moveLineCursor((countedMove[2] === 'D' ? -1 : 1) * Math.max(1, Number(countedMove[1]))),
    }
  }
  if (rest.startsWith('\x1b[D')) return { length: 3, apply: () => moveLineCursor(-1) }
  if (rest.startsWith('\x1b[C')) return { length: 3, apply: () => moveLineCursor(1) }
  if (rest.startsWith('\x1b[H') || rest.startsWith('\x1b[1~')) {
    return { length: rest.startsWith('\x1b[H') ? 3 : 4, apply: () => { lineCursor = 0 } }
  }
  if (rest.startsWith('\x1b[F') || rest.startsWith('\x1b[4~')) {
    return { length: rest.startsWith('\x1b[F') ? 3 : 4, apply: () => { lineCursor = lineBuffer.length } }
  }
  if (rest.startsWith('\x1b[3~')) return { length: 4, apply: deleteLineText }
  return null
}

function updateAlternateScreenHighlightHintForCommand(command: string) {
  alternateScreenHighlightHint = detectFileEditorHighlightHint(command, props.sessionId)
}

function clearAlternateScreenHighlightHint() {
  alternateScreenHighlightHint = null
}

function currentAlternateScreenHighlightHint() {
  const hint = alternateScreenHighlightHint
  if (!hint) return null
  if (hint.terminalSessionID !== props.sessionId) {
    clearAlternateScreenHighlightHint()
    return null
  }
  if (!alternateScreenActive && Date.now() - hint.startedAt > alternateScreenHintTTL) {
    clearAlternateScreenHighlightHint()
    return null
  }
  return hint
}

function observeTerminalInput(data: string) {
  if (!data) return
  data = data.replace(/\r\n/g, '\n')
  data = data.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '')
  if (!data) return
  if (data === '\x03' || data === '\x04') {
    resetCommandCaptureState(false)
    return
  }
  if (data === '\x15') {
    resetCommandCaptureState(false)
    return
  }
  const newlineMatches = data.match(/[\r\n]/g) ?? []
  const pastedMultiline = newlineMatches.length > 1 || (newlineMatches.length === 1 && !/[\r\n]$/.test(data))
  if (pastedMultiline && !data.includes('\x1b')) {
    submitCommandHistory(normalizeHistoryCommand(data))
    resetCommandCaptureState(!/[\r\n]$/.test(data))
    return
  }
  for (let index = 0; index < data.length;) {
    if (data[index] === '\x1b') {
      const sequence = readEditableEscapeSequence(data, index)
      if (!sequence) {
        resetCommandCaptureState(true)
        return
      }
      if (!lineBufferDirty) sequence.apply()
      index += sequence.length
      continue
    }
    const char = Array.from(data.slice(index))[0] ?? ''
    index += char.length
    if (char === '\r' || char === '\n') {
      if (!lineBufferDirty) {
        submitCapturedLine()
        setLineBuffer('')
        lineBufferTooLong = false
      } else {
        if (lineBufferTooLong) emit('commandSkip', '命令已执行，但内容过长，未保存到历史记录')
        resetCommandCaptureState(false)
      }
      lineBufferDirty = false
      continue
    }
    if (char === '\x7f' || char === '\b') {
      if (!lineBufferDirty) backspaceLineText()
      continue
    }
    if (char === '\x01') {
      if (!lineBufferDirty) lineCursor = 0
      continue
    }
    if (char === '\x05') {
      if (!lineBufferDirty) lineCursor = lineBuffer.length
      continue
    }
    if (char < ' ' && char !== '\t') {
      resetCommandCaptureState(true)
      continue
    }
    if (!lineBufferDirty) {
      insertLineText(char)
      if (commandCaptureLength() > maxHistoryCommandLength) {
        resetCommandCaptureState(true, true)
      }
    }
  }
}

function commandCaptureLength() {
  return continuationLines.reduce((total, line) => total + line.length + 1, 0) + lineBuffer.length
}

function submitCapturedLine() {
  const currentLine = lineBuffer
  if (hasUnescapedTrailingBackslash(currentLine)) {
    continuationLines.push(currentLine)
    if (commandCaptureLength() > maxHistoryCommandLength) {
      resetCommandCaptureState(true)
    }
    return
  }
  const command = continuationLines.length ? [...continuationLines, currentLine].join('\n') : currentLine
  continuationLines = []
  submitCommandHistory(command)
}

function hasUnescapedTrailingBackslash(line: string) {
  let slashCount = 0
  for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function submitCommandHistory(command: string) {
  command = normalizeHistoryCommand(command)
  if (!command) return
  if (sensitivePromptPending) {
    sensitivePromptPending = false
    clearAlternateScreenHighlightHint()
    return
  }
  updateAlternateScreenHighlightHintForCommand(command)
  const serverId = activeConnectionId()
  if (!serverId) return
  void commandStore.recordHistory(serverId, props.sessionId, command)
    .then((result) => {
      if (result.skipped && (result.reasonCode === 'SENSITIVE' || result.reasonCode === 'TOO_LONG')) {
        emit('commandSkip', result.message || '命令已执行，但未保存到历史记录')
      }
    })
    .catch((reason) => console.error('Unable to record command history', String(reason).replace(command, '[command]')))
}

function normalizeHistoryCommand(value: string) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function observeTerminalOutput(dataBase64: string) {
  try {
    const text = new TextDecoder().decode(decodeTerminalBase64ToBytes(dataBase64))
    if (/\x1b\[\?(47|1047|1049)h/.test(text)) alternateScreenActive = true
    if (/\x1b\[\?(47|1047|1049)l/.test(text)) {
      alternateScreenActive = false
      clearAlternateScreenHighlightHint()
      resetCommandCaptureState(false)
    }
    updateViewportHighlightPause()
    if (/(password|passphrase|密码|口令)/i.test(text)) sensitivePromptPending = true
  } catch {
    // Best-effort prompt detection only; rendering still receives original bytes.
  }
}

function canUseCompletion() {
  if (!completionEnabled.value) return false
  if (alternateScreenActive) {
    emit('commandSkip', '当前终端程序正在接管屏幕，已跳过命令补全')
    return false
  }
  if (lineBufferDirty) {
    emit('commandSkip', '当前输入状态不确定，请清空当前行后再补全')
    return false
  }
  if (lineCursor !== lineBuffer.length) {
    emit('commandSkip', '当前光标不在命令末尾，请移到行尾后再补全')
    return false
  }
  if (continuationLines.length > 0) {
    emit('commandSkip', '当前多行命令尚未结束，请完成或取消后再补全')
    return false
  }
  if (commandLooksSensitive(lineBuffer)) {
    emit('commandSkip', '当前输入可能包含敏感信息，已跳过补全')
    return false
  }
  return true
}

function canUseCompletionSilently() {
  return completionEnabled.value
    && !alternateScreenActive
    && !lineBufferDirty
    && lineCursor === lineBuffer.length
    && continuationLines.length === 0
    && !commandLooksSensitive(lineBuffer)
}

async function openCompletion(options: { silent?: boolean; auto?: boolean } = {}) {
  if (!completionEnabled.value) {
    closeCompletion()
    return
  }
  if (!(options.silent ? canUseCompletionSilently() : canUseCompletion())) {
    closeCompletion()
    return
  }
  const token = commandCompletionToken(lineBuffer)
  if (commandCompletionTriggerLength(lineBuffer) < completionTriggerChars.value) {
    closeCompletion()
    return
  }
  const connectionId = props.connection?.id ?? activeConnectionId()
  if (!connectionId) {
    closeCompletion()
    return
  }
  const generation = ++completionGeneration
  completionOpen.value = true
  completionBusy.value = true
  completionSelectedIndex.value = 0
  completionPrefix.value = lineBuffer
  updateCompletionPosition()
  try {
    const [history, favorites] = await Promise.all([
      commandStore.loadHistory(connectionId, token.value, 80, 'currentServer'),
      commandStore.loadFavorites(props.connection, token.value, 'currentServer'),
    ])
    if (generation !== completionGeneration) return
    completionSuggestions.value = buildCommandCompletionSuggestions({
      prefix: lineBuffer,
      history,
      favorites,
      commonCommands: commonLinuxCommandCompletions,
      builtinCommands: builtinLinuxCommandCompletions,
      limit: completionMaxSuggestions.value,
    })
    void nextTick(updateCompletionPosition)
    if (options.auto && !completionSuggestions.value.length) closeCompletion()
  } catch (reason) {
    if (generation !== completionGeneration) return
    completionSuggestions.value = []
    emit('commandSkip', String(reason).replace(/^Error:\s*/i, '') || '命令补全加载失败')
  } finally {
    if (generation === completionGeneration) completionBusy.value = false
  }
}

function closeCompletion() {
  completionGeneration += 1
  completionOpen.value = false
  completionBusy.value = false
  completionSuggestions.value = []
  completionPosition.value = null
}

function disableCompletion() {
  setSshCommandCompletionEnabled(false)
  completionEnabled.value = false
  closeCompletion()
  terminal?.focus()
}

function handleCompletionPreferenceChange(event: Event) {
  const detail = (event as CustomEvent<Partial<SshCommandCompletionPreferences>>).detail
  const preferences = getSshCommandCompletionPreferences()
  completionEnabled.value = typeof detail?.enabled === 'boolean' ? detail.enabled : preferences.enabled
  completionShowDescriptions.value = typeof detail?.showDescriptions === 'boolean' ? detail.showDescriptions : preferences.showDescriptions
  completionMaxSuggestions.value = typeof detail?.maxSuggestions === 'number' ? detail.maxSuggestions : preferences.maxSuggestions
  completionTriggerChars.value = typeof detail?.triggerChars === 'number' ? detail.triggerChars : preferences.triggerChars
  if (!completionEnabled.value) closeCompletion()
}

function updateCompletionPosition() {
  if (!terminal || !host.value || !root.value) return
  const pane = host.value.getBoundingClientRect()
  const terminalRect = root.value.getBoundingClientRect()
  if (pane.width <= 0 || pane.height <= 0 || terminalRect.width <= 0 || terminalRect.height <= 0) return
  const activeBuffer = terminal.buffer.active as { cursorX?: number; cursorY?: number }
  const cursorX = Number.isFinite(activeBuffer.cursorX) ? Number(activeBuffer.cursorX) : lineCursor
  const cursorY = Number.isFinite(activeBuffer.cursorY) ? Number(activeBuffer.cursorY) : Math.max(0, terminal.rows - 2)
  completionPosition.value = calculateTerminalCompletionPosition({
    paneWidth: pane.width,
    paneHeight: pane.height,
    terminalLeft: terminalRect.left - pane.left,
    terminalTop: terminalRect.top - pane.top,
    terminalWidth: terminalRect.width,
    terminalHeight: terminalRect.height,
    columns: terminal.cols,
    rows: terminal.rows,
    cursorX,
    cursorY,
    overlayWidth: terminalCompletionOverlayWidth,
    overlayHeight: 330,
    devicePixelRatio: window.devicePixelRatio || 1,
  })
}

function selectCompletion(index: number) {
  if (!completionSuggestions.value.length) {
    completionSelectedIndex.value = 0
    return
  }
  const count = completionSuggestions.value.length
  completionSelectedIndex.value = ((index % count) + count) % count
}

function selectedSuggestion() {
  return completionSuggestions.value[completionSelectedIndex.value] ?? null
}

async function applyCompletion(suggestion: CommandSuggestion | null) {
  if (!suggestion || !canUseCompletion()) return
  const payload = completionInsertText(lineBuffer, suggestion.command)
  if (!payload) {
    emit('commandSkip', '当前输入和候选命令不匹配，已取消补全')
    return
  }
  try {
    observeTerminalInput(payload)
    await api.writeTerminal(props.sessionId, encodeTerminalInputToBase64(payload))
    if (suggestion.source === 'favorite') {
      void commandStore.markFavoriteUsed(suggestion.id).catch((reason) => {
        console.error('Unable to update favorite use count', reason)
      })
    }
    closeCompletion()
    terminal?.focus()
  } catch (reason) {
    emit('commandSkip', String(reason).replace(/^Error:\s*/i, '') || '写入补全命令失败')
  }
}

async function favoriteSuggestion(suggestion: CommandSuggestion) {
  if (!props.connection?.id) {
    emit('commandSkip', '当前没有绑定服务器，无法收藏命令')
    return
  }
  const request: SaveCommandFavoriteRequest = {
    id: '',
    title: suggestion.title || suggestion.command.split(/\s+/)[0] || 'Command',
    command: suggestion.command,
    description: suggestion.description,
    scope: 'server',
    serverId: props.connection.id,
    groupId: null,
    tags: [],
    sortOrder: 0,
    allowSensitive: false,
  }
  try {
    await commandStore.saveFavorite(request)
    emit('commandSkip', '命令已加入当前服务器收藏')
  } catch (reason) {
    const message = String(reason)
    if (message.includes('COMMAND_FAVORITE_SENSITIVE_CONFIRM')) {
      const ok = await confirmDialog({
        title: '确认保存敏感命令',
        message: '该命令可能包含敏感信息。确认后可以保存，但不会写入日志或备份。',
        confirmText: '仍然保存',
        danger: true,
      })
      if (!ok) return
      await commandStore.saveFavorite({ ...request, allowSensitive: true })
      emit('commandSkip', '命令已加入当前服务器收藏')
      return
    }
    emit('commandSkip', message.replace(/^Error:\s*/i, '') || '收藏命令失败')
  }
}

async function copySelection(showError = true) {
  await terminalClipboard.copySelection(terminal, showError)
}

function showTerminalMenu(event: MouseEvent) {
  terminalMenu.value = { x: event.clientX, y: event.clientY }
}

function selectTerminalMenu(id: string) {
  terminalMenu.value = null
  if (id === 'copy') {
    void copySelection()
  } else if (id === 'paste') {
    void pasteClipboard()
  } else if (id === 'history') {
    emit('commands', 'history')
  } else if (id === 'favorites') {
    emit('commands', 'favorites')
  }
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const shortcuts = effectiveShortcuts.value
  const showMenu = shortcuts.terminalRightClickAction === 'menu' ||
    terminalContextMenuTriggerMatches(event, shortcuts.terminalContextMenuTrigger)
  if (showMenu) {
    showTerminalMenu(event)
    return
  }
  if (shortcuts.terminalRightClickAction !== 'paste') return
  void pasteClipboard()
}

function handlePasteCapture(event: ClipboardEvent) {
  if (!shouldSuppressNativePaste()) return
  consumeTerminalShortcutEvent(event)
}

function runTerminalShortcut(event: KeyboardEvent) {
  if (isTerminalCompositionKeyEvent(event, imeComposing)) return false
  const action = terminalShortcutActionForEvent(event, effectiveShortcuts.value, {
    hasSelection: terminal?.hasSelection() ?? false,
    completionEnabled: completionEnabled.value,
    commandPaletteEnabled: true,
  })
  if (!action) return false
  consumeTerminalShortcutEvent(event)
  if (action === 'paste' || action === 'suppress_native_paste' || isNativePasteShortcut(event)) markNativePasteSuppressed()
  if (action === 'completion') {
    void openCompletion()
  } else if (action === 'copy') {
    void copySelection()
  } else if (action === 'paste') {
    void pasteClipboard()
  } else if (action === 'history' || action === 'favorites') {
    const intent = commandPaletteShortcutIntentForEvent(event, effectiveShortcuts.value, {
      terminalFocused: true,
      target: event.target,
    })
    if (intent.kind === 'command-palette') emit('commands', intent.tab)
  }
  return true
}

function handleKeydownCapture(event: KeyboardEvent) {
  runTerminalShortcut(event)
}

onMounted(async () => {
  destroyed = false
  terminal = new Terminal({
    ...terminalProfileToXtermOptions(props.profile),
    allowProposedApi: true,
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  if (root.value) terminal.open(root.value)
  if (root.value) {
    viewportHighlighter = new TerminalViewportHighlighter({
      terminal,
      root: root.value,
      isActive: () => props.active,
      isVisible: () => props.visible,
      getAlternateScreenHighlightHint: currentAlternateScreenHighlightHint,
    })
    updateViewportHighlightPause()
  }
  terminal.attachCustomWheelEventHandler(handleXtermWheel)
  registerTerminalWheelZoomHandler(props.sessionId, applyWheelZoomDelta)
  window.addEventListener(sshCommandCompletionPreferenceEvent, handleCompletionPreferenceChange)
  root.value?.addEventListener('wheel', handleTerminalWheel, { capture: true, passive: false })
  root.value?.addEventListener('compositionstart', () => { imeComposing = true }, true)
  root.value?.addEventListener('compositionend', () => { imeComposing = false }, true)
  terminal.onData((data) => {
    scrollToBottom()
    observeTerminalInput(data)
    void openCompletion({ silent: true, auto: true })
    void api.writeTerminal(props.sessionId, encodeTerminalInputToBase64(data))
      .catch((reason) => {
        if (!destroyed) console.error('Unable to write terminal input', reason)
      })
  })
  terminal.onScroll(() => {
    showScrollToBottom.value = !isAtBottom()
    updateCompletionPosition()
    viewportHighlighter?.schedule()
  })
  selectionDisposable = (terminal as Terminal & {
    onSelectionChange?: (callback: () => void) => { dispose: () => void }
  }).onSelectionChange?.(() => {
    if (!effectiveShortcuts.value.terminalCopyOnSelectEnabled || !terminal?.hasSelection()) return
    void copySelection(false)
  }) ?? null
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    if (isTerminalCompositionKeyEvent(event, imeComposing)) return true
    if (completionOpen.value) {
      if (event.key === 'ArrowDown') {
        selectCompletion(completionSelectedIndex.value + 1)
        return false
      }
      if (event.key === 'ArrowUp') {
        selectCompletion(completionSelectedIndex.value - 1)
        return false
      }
      if (event.key === 'Escape') {
        closeCompletion()
        return false
      }
      if (event.key === 'Tab') {
        void applyCompletion(selectedSuggestion())
        return false
      }
      if (event.key === 'Enter') {
        closeCompletion()
        return true
      }
    }
    if (runTerminalShortcut(event)) return false
    return true
  })
  store.registerOutput(props.sessionId, (dataBase64, meta) => {
    if (!terminal || destroyed) return
    if (!meta?.replay) observeTerminalOutput(dataBase64)
    const followOutput = isAtBottom()
    terminal.write(decodeTerminalBase64ToBytes(dataBase64), () => {
      if (!terminal || destroyed) return
      if (followOutput) scrollToBottom()
      else showScrollToBottom.value = true
      viewportHighlighter?.schedule()
    })
  })
  observer = new ResizeObserver(() => {
    if (props.visible) {
      updateCompletionPosition()
      viewportHighlighter?.schedule()
      scheduleFit()
    }
  })
  if (root.value) observer.observe(root.value)
  registerTerminalInstance({
    id: props.sessionId,
    kind: 'ssh',
    serverID: props.connection?.id ?? null,
    resolvedProfileID: props.profile.id,
    inheritsDefaultProfile: !props.connection?.terminalProfileId,
    applyProfile: applyCurrentProfile,
    observeInput: observeTerminalInput,
  })
  await nextTick()
  if (destroyed) return
  scheduleFit()
  if (props.active && props.visible) terminal?.focus()
})

watch(() => [props.connection?.id ?? null, props.connection?.terminalProfileId ?? '', props.profile.id] as const, () => {
  updateTerminalInstance(props.sessionId, {
    serverID: props.connection?.id ?? null,
    resolvedProfileID: props.profile.id,
    inheritsDefaultProfile: !props.connection?.terminalProfileId,
  })
})

watch(() => [props.active, props.visible, props.layoutRevision] as const, async ([active, visible]) => {
  updateViewportHighlightPause()
  if (!active || !visible) return
  await nextTick()
  viewportHighlighter?.schedule()
  scheduleFit()
  terminal?.focus()
})

watch(() => props.profileRevision, () => {
  applyCurrentProfile()
  viewportHighlighter?.schedule()
})

onBeforeUnmount(() => {
  destroyed = true
  fitGeneration += 1
  resetCommandCaptureState(false)
  clearAlternateScreenHighlightHint()
  unregisterTerminalInstance(props.sessionId)
  store.unregisterOutput(props.sessionId)
  selectionDisposable?.dispose()
  selectionDisposable = null
  observer?.disconnect()
  window.removeEventListener(sshCommandCompletionPreferenceEvent, handleCompletionPreferenceChange)
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  viewportHighlighter?.dispose()
  viewportHighlighter = null
  root.value?.removeEventListener('wheel', handleTerminalWheel, true)
  unregisterTerminalWheelZoomHandler(props.sessionId)
  clearTerminalZoomDelta(props.sessionId)
  terminal?.dispose()
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div ref="host" class="terminal-view-host" :style="terminalHostStyle">
    <div
      ref="root"
      class="terminal-view"
      data-terminal-surface="true"
      data-terminal-kind="ssh"
      :data-terminal-session-id="sessionId"
      @contextmenu="handleContextMenu"
      @keydown.capture="handleKeydownCapture"
      @paste.capture="handlePasteCapture"
    ></div>
    <button
      v-if="showScrollToBottom"
      class="terminal-scroll-bottom"
      type="button"
      @click="scrollToBottom"
    >回到底部</button>
    <ContextMenu
      v-if="terminalMenu"
      :x="terminalMenu.x"
      :y="terminalMenu.y"
      :items="terminalMenuItems"
      @close="terminalMenu = null"
      @select="selectTerminalMenu"
    />
    <TerminalCompletionOverlay
      :open="completionOpen"
      :suggestions="completionSuggestions"
      :selected-index="completionSelectedIndex"
      :prefix="completionPrefix"
      :busy="completionBusy"
      :position="completionPosition"
      :show-descriptions="completionShowDescriptions"
      @select="selectCompletion"
      @insert="(suggestion) => applyCompletion(suggestion)"
      @disable="disableCompletion"
    />
  </div>
</template>
