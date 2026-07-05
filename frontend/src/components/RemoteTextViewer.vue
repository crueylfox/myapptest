<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser, type StringStream } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'
import { yaml } from '@codemirror/lang-yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { xml as legacyXML } from '@codemirror/legacy-modes/mode/xml'
import type { SFTPReadTextFileResult } from '../types'
import { formatBytes } from '../utils/format'
import { visibleSelectionDecoration } from '../utils/visibleSelectionDecoration'
import { getViewportPopoverPosition } from '../utils/viewportPopover'

type MatchRange = { from: number; to: number }
const MORE_MENU_WIDTH = 170
const MORE_MENU_HEIGHT = 260
const MORE_MENU_MARGIN = 12
const MORE_MENU_GAP = 6
const INLINE_TOOLBAR_MIN_WIDTH = 720

const props = defineProps<{
  file: SFTPReadTextFileResult
  busy: boolean
  unlockDisabled?: boolean
  unlockReason?: string
}>()

const emit = defineEmits<{
  reload: []
  close: []
  unlock: []
}>()

const editorHost = ref<HTMLElement>()
const toolbarMain = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const replaceInput = ref<HTMLInputElement>()
const searchQuery = ref('')
const replaceText = ref('')
const searchCaseSensitive = ref(false)
const searchIndex = ref(0)
const replaceOpen = ref(false)
const wrapLines = ref(true)
const editorText = ref(props.file.content)
const moreOpen = ref(false)
const moreButton = ref<HTMLButtonElement>()
const showInlineToolbarActions = ref(true)
const languageCompartment = new Compartment()
const themeCompartment = new Compartment()
const wrapCompartment = new Compartment()
const moreMenuStyle = ref<Record<string, string>>({})

let view: EditorView | null = null
let themeObserver: MutationObserver | null = null
let toolbarResizeObserver: ResizeObserver | null = null

const languageMode = computed(() => languageForFile(props.file))
const matches = computed(() => findMatches(editorText.value, searchQuery.value, searchCaseSensitive.value))
const searchStatus = computed(() => {
  if (!searchQuery.value) return '输入关键字'
  if (matches.value.length === 0) return '无匹配'
  return `${Math.min(searchIndex.value + 1, matches.value.length)} / ${matches.value.length}`
})

function languageForFile(file: SFTPReadTextFileResult): { label: string; extension: Extension } {
  const detected = (file.detectedLanguage || '').toLowerCase()
  const name = (file.name || file.entry?.name || file.path || file.entry?.path || '').toLowerCase()
  if (detected === 'shell' || ['.sh', '.bash', '.zsh', '.fish'].some((ext) => name.endsWith(ext))) return { label: 'Shell', extension: StreamLanguage.define(shell) }
  if (detected === 'json' || name.endsWith('.json')) return { label: 'JSON', extension: json() }
  if (detected === 'yaml' || name.endsWith('.yaml') || name.endsWith('.yml')) return { label: 'YAML', extension: yaml() }
  if (detected === 'toml' || name.endsWith('.toml')) return { label: 'TOML', extension: StreamLanguage.define(toml) }
  if (['ini', 'conf', 'nginx', 'systemd'].includes(detected) || ['.ini', '.conf', '.env', '.service', '.properties'].some((ext) => name.endsWith(ext))) return { label: detected || 'Config', extension: StreamLanguage.define(properties) }
  if (detected === 'markdown' || name.endsWith('.md') || name.endsWith('.markdown')) return { label: 'Markdown', extension: markdown() }
  if (detected === 'xml' || name.endsWith('.xml')) return { label: 'XML', extension: StreamLanguage.define(legacyXML) }
  if (detected === 'html' || name.endsWith('.html') || name.endsWith('.htm')) return { label: 'HTML', extension: html() }
  if (detected === 'css' || name.endsWith('.css')) return { label: 'CSS', extension: css() }
  if (detected === 'javascript' || name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return { label: 'JavaScript', extension: javascript({ jsx: true }) }
  if (detected === 'typescript' || name.endsWith('.ts')) return { label: 'TypeScript', extension: javascript({ typescript: true }) }
  if (detected === 'go' || name.endsWith('.go')) return { label: 'Go', extension: go() }
  if (detected === 'python' || name.endsWith('.py')) return { label: 'Python', extension: python() }
  if (detected === 'log' || name.endsWith('.log')) return { label: 'Log', extension: StreamLanguage.define(genericPlaintextMode) }
  return { label: detected || 'generic', extension: StreamLanguage.define(genericPlaintextMode) }
}

const genericPlaintextMode: StreamParser<null> = {
  startState: () => null,
  token(stream: StringStream) {
    if (stream.match(/(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\b/)) return 'keyword'
    if (stream.match(/https?:\/\/\S+/)) return 'link'
    if (stream.match(/#.*$/) || stream.match(/\/\/.*$/)) return 'comment'
    if (stream.match(/"(?:\\.|[^"])*"/) || stream.match(/'(?:\\.|[^'])*'/)) return 'string'
    if (stream.match(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?)?\b/)) return 'number'
    if (stream.match(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/)) return 'atom'
    if (stream.match(/(?:^|\s)[A-Za-z_][\w.-]*=/)) return 'variableName'
    if (stream.match(/(?:\.{1,2}\/|\/|~\/)[^\s"'<>]+/)) return 'tag'
    if (stream.match(/\b(?:true|false|null|nil)\b/i)) return 'atom'
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return 'number'
    if (stream.match(/[()[\]{}.,;:=]/)) return 'punctuation'
    stream.next()
    return null
  },
}

function darkThemeEnabled() {
  return document.documentElement.dataset.theme !== 'light'
}

function viewerTheme(dark: boolean) {
  const viewTheme = EditorView.theme({
    '&': {
      height: '100%',
      color: dark ? '#f8fbff' : '#132033',
      backgroundColor: dark ? '#101827' : '#fbfdff',
      fontSize: '12px',
    },
    '.cm-scroller': {
      fontFamily: 'Consolas, "Cascadia Mono", "Microsoft YaHei UI", monospace',
      lineHeight: '1.55',
    },
    '.cm-content': {
      caretColor: 'transparent',
    },
    '&.cm-editor .cm-selectionBackground': {
      backgroundColor: dark ? '#2563ebcc' : '#bfdbfe',
    },
    '&.cm-editor.cm-focused .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: dark ? '#3b82f6e6' : '#93c5fd',
    },
    '&.cm-editor .cm-content ::selection': {
      backgroundColor: dark ? '#3b82f6e6' : '#93c5fd',
      color: dark ? '#ffffff' : '#0f172a',
    },
    '.cm-activeLine': {
      backgroundColor: dark ? '#1c2f4d' : '#eef6ff',
    },
    '.cm-gutters': {
      backgroundColor: dark ? '#0c1422' : '#f1f5f9',
      color: dark ? '#b7c5da' : '#64748b',
      borderRightColor: dark ? '#334155' : '#d7e0eb',
    },
  }, { dark })
  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: dark ? '#c084fc' : '#7e22ce', fontWeight: '700' },
    { tag: [t.string, t.special(t.string)], color: dark ? '#34d399' : '#047857', fontWeight: '600' },
    { tag: [t.number, t.bool, t.null, t.constant(t.variableName)], color: dark ? '#facc15' : '#b45309', fontWeight: '700' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: dark ? '#94a3b8' : '#64748b', fontStyle: 'italic' },
    { tag: [t.variableName, t.propertyName], color: dark ? '#dbeafe' : '#1e3a8a' },
    { tag: [t.function(t.variableName), t.definition(t.variableName)], color: dark ? '#67e8f9' : '#0369a1', fontWeight: '700' },
    { tag: [t.tagName], color: dark ? '#fb923c' : '#c2410c', fontWeight: '700' },
    { tag: [t.attributeName], color: dark ? '#a7f3d0' : '#0f766e', fontWeight: '600' },
    { tag: [t.operator], color: dark ? '#f0abfc' : '#9333ea', fontWeight: '600' },
    { tag: [t.punctuation], color: dark ? '#cbd5e1' : '#475569' },
  ])
  return [viewTheme, syntaxHighlighting(highlight)]
}

function createViewer() {
  if (!editorHost.value) return
  view?.destroy()
  const state = EditorState.create({
    doc: props.file.content,
    extensions: [
      Prec.highest(keymap.of([
        {
          key: 'Mod-a',
          preventDefault: true,
          run: () => {
            selectAllText()
            return true
          },
        },
        {
          key: 'Mod-f',
          preventDefault: true,
          run: () => {
            focusSearch()
            return true
          },
        },
        {
          key: 'Mod-h',
          preventDefault: true,
          run: () => {
            openReplace()
            return true
          },
        },
        {
          key: 'Escape',
          run: () => {
            if (!replaceOpen.value && !searchQuery.value) return false
            closeSearchTools()
            return true
          },
        },
      ])),
      basicSetup,
      visibleSelectionDecoration,
      EditorState.readOnly.of(true),
      languageCompartment.of(languageMode.value.extension),
      themeCompartment.of(viewerTheme(darkThemeEnabled())),
      wrapCompartment.of(wrapLines.value ? EditorView.lineWrapping : []),
    ],
  })
  view = new EditorView({ state, parent: editorHost.value })
  editorText.value = props.file.content
}

function syncContent(value: string) {
  if (!view || view.state.doc.toString() === value) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  editorText.value = value
}

function findMatches(text: string, query: string, caseSensitive: boolean): MatchRange[] {
  if (!query) return []
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const ranges: MatchRange[] = []
  let index = 0
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index)
    if (found < 0) break
    ranges.push({ from: found, to: found + needle.length })
    index = found + Math.max(needle.length, 1)
  }
  return ranges
}

function selectMatch(index: number, focusEditor = true) {
  if (!view || matches.value.length === 0) return
  const normalized = (index + matches.value.length) % matches.value.length
  searchIndex.value = normalized
  const match = matches.value[normalized]
  view.dispatch({
    selection: { anchor: match.from, head: match.to },
    effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
  })
  if (focusEditor) view.focus()
}

function selectAllText() {
  if (!view) return
  view.dispatch({
    selection: EditorSelection.range(0, view.state.doc.length),
    effects: EditorView.scrollIntoView(0, { y: 'start' }),
  })
  view.focus()
}

function focusSearch() {
  void nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

function openReplace() {
  replaceOpen.value = true
  closeMore()
  void nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

function closeReplace() {
  replaceOpen.value = false
  replaceText.value = ''
  view?.focus()
}

function closeSearchTools() {
  replaceOpen.value = false
  searchQuery.value = ''
  replaceText.value = ''
  closeMore()
  view?.focus()
}

function nextMatch() {
  selectMatch(searchIndex.value + 1)
}

function previousMatch() {
  selectMatch(searchIndex.value - 1)
}

function selectedText() {
  if (!view) return ''
  const range = view.state.selection.main
  if (range.empty) return ''
  return view.state.sliceDoc(range.from, range.to)
}

async function copySelected() {
  await navigator.clipboard.writeText(selectedText())
}

async function copyAll() {
  await navigator.clipboard.writeText(props.file.content)
}

function toggleWrap() {
  wrapLines.value = !wrapLines.value
  view?.dispatch({ effects: wrapCompartment.reconfigure(wrapLines.value ? EditorView.lineWrapping : []) })
}

function updateMoreMenuPosition() {
  const rect = moreButton.value?.getBoundingClientRect()
  if (!rect) {
    moreMenuStyle.value = {
      position: 'fixed',
      top: '72px',
      left: '32px',
      width: `${MORE_MENU_WIDTH}px`,
      maxHeight: `${MORE_MENU_HEIGHT}px`,
    }
    return
  }
  const position = getViewportPopoverPosition({
    anchorRect: rect,
    popoverSize: { width: MORE_MENU_WIDTH, height: MORE_MENU_HEIGHT },
    viewport: {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    },
    placement: 'bottom-end',
    margin: MORE_MENU_MARGIN,
    gap: MORE_MENU_GAP,
  })
  moreMenuStyle.value = {
    position: 'fixed',
    top: `${Math.round(position.top)}px`,
    left: `${Math.round(position.left)}px`,
    width: `${Math.round(position.width)}px`,
    maxHeight: `${Math.round(position.maxHeight)}px`,
    transformOrigin: position.transformOrigin,
  }
}

function toggleMore() {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) void nextTick(updateMoreMenuPosition)
}

function closeMore() {
  moreOpen.value = false
}

function updateToolbarActionsMode() {
  const width = toolbarMain.value?.clientWidth || toolbarMain.value?.getBoundingClientRect().width || 0
  showInlineToolbarActions.value = width <= 0 || width >= INLINE_TOOLBAR_MIN_WIDTH
  if (showInlineToolbarActions.value) closeMore()
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!moreOpen.value) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('.sftp-editor-more-menu, .sftp-editor-more-trigger')) return
  closeMore()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!moreOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  closeMore()
}

function updateOpenMoreMenuPosition() {
  if (moreOpen.value) updateMoreMenuPosition()
}

function handleToolbarViewportChange() {
  updateToolbarActionsMode()
  updateOpenMoreMenuPosition()
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSearchTools()
    return
  }
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.shiftKey) previousMatch()
  else nextMatch()
}

watch(() => props.file.content, syncContent)
watch(languageMode, (mode) => {
  view?.dispatch({ effects: languageCompartment.reconfigure(mode.extension) })
})
watch([matches, searchQuery, searchCaseSensitive], () => {
  if (matches.value.length === 0) {
    searchIndex.value = 0
    return
  }
  selectMatch(Math.min(searchIndex.value, matches.value.length - 1), false)
})

onMounted(() => {
  createViewer()
  themeObserver = new MutationObserver(() => {
    view?.dispatch({ effects: themeCompartment.reconfigure(viewerTheme(darkThemeEnabled())) })
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown, true)
  window.addEventListener('resize', handleToolbarViewportChange)
  window.addEventListener('scroll', updateOpenMoreMenuPosition, true)
  if (typeof ResizeObserver !== 'undefined') {
    toolbarResizeObserver = new ResizeObserver(updateToolbarActionsMode)
    if (toolbarMain.value) toolbarResizeObserver.observe(toolbarMain.value)
  }
  updateToolbarActionsMode()
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  toolbarResizeObserver?.disconnect()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  window.removeEventListener('resize', handleToolbarViewportChange)
  window.removeEventListener('scroll', updateOpenMoreMenuPosition, true)
  view?.destroy()
  view = null
})
</script>

<template>
  <div class="sftp-editor-backdrop sftp-viewer-backdrop">
    <section class="sftp-editor sftp-viewer" role="dialog" aria-modal="true" aria-label="远程文本查看器">
      <header class="sftp-editor-header">
        <div class="sftp-editor-title">
          <strong>{{ file.name || file.entry?.name }}</strong>
          <span :title="file.path || file.entry?.path">{{ file.path || file.entry?.path }}</span>
        </div>
        <button
          type="button"
          class="secondary sftp-viewer-close"
          :disabled="busy"
          @click="emit('close')"
        >关闭</button>
      </header>

      <div class="sftp-editor-toolbar" :class="{ 'sftp-editor-replace': replaceOpen }">
        <div ref="toolbarMain" class="sftp-editor-search sftp-editor-toolbar-main sftp-editor-toolbar-nowrap" @keydown="onSearchKeydown">
          <input
            ref="searchInput"
            v-model="searchQuery"
            data-testid="viewer-search"
            type="search"
            placeholder="搜索"
            autocomplete="off"
          />
          <label class="sftp-editor-case-toggle">
            <input v-model="searchCaseSensitive" type="checkbox" />
            <span>Aa</span>
          </label>
          <span class="sftp-editor-search-status" :class="{ empty: searchQuery && matches.length === 0 }">{{ searchStatus }}</span>
          <button type="button" class="sftp-editor-toolbar-action" data-testid="viewer-search-prev" :disabled="matches.length === 0" @click="previousMatch">上一个</button>
          <button type="button" class="sftp-editor-toolbar-action" data-testid="viewer-search-next" :disabled="matches.length === 0" @click="nextMatch">下一个</button>
          <template v-if="showInlineToolbarActions">
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button
              type="button"
              class="sftp-editor-toolbar-action"
              data-testid="viewer-replace-disabled"
              disabled
              title="解锁为读写后可替换"
            >替换</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="viewer-wrap-toggle" @click="toggleWrap">{{ wrapLines ? '不换行' : '自动换行' }}</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="viewer-copy-selection" @click="copySelected">复制选中</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="viewer-copy-all" @click="copyAll">复制全部</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="viewer-reload" :disabled="busy" @click="emit('reload')">重新加载</button>
          </template>
          <button
            v-else
            ref="moreButton"
            type="button"
            class="sftp-editor-toolbar-action sftp-editor-more-trigger"
            data-testid="viewer-more"
            :aria-expanded="moreOpen"
            @click="toggleMore"
          >更多</button>
        </div>
        <div v-if="replaceOpen" class="sftp-editor-replace-row" @keydown="onSearchKeydown">
          <label>
            <span>查找内容</span>
            <input
              v-model="searchQuery"
              data-testid="viewer-replace-find-input"
              type="search"
              placeholder="查找内容"
              autocomplete="off"
            />
          </label>
          <label>
            <span>替换为</span>
            <input
              ref="replaceInput"
              v-model="replaceText"
              data-testid="viewer-replace-input"
              type="text"
              placeholder="替换为"
              autocomplete="off"
              disabled
              title="解锁为读写后可替换"
            />
          </label>
          <button
            type="button"
            class="secondary"
            data-testid="viewer-replace-one"
            disabled
            title="解锁为读写后可替换"
          >替换</button>
          <button
            type="button"
            class="secondary"
            data-testid="viewer-replace-all"
            disabled
            title="解锁为读写后可替换"
          >全部替换</button>
          <button type="button" class="secondary" data-testid="viewer-replace-close" @click="closeReplace">关闭替换</button>
          <span class="replace-notice">解锁为读写后可替换</span>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="moreOpen"
          class="viewport-popover viewport-popover-menu viewport-popover-scroll sftp-editor-more-menu"
          data-testid="viewer-more-menu"
          role="menu"
          :style="moreMenuStyle"
          @pointerdown.stop
          @click.stop
        >
          <button
            type="button"
            data-testid="viewer-replace-disabled"
            disabled
            title="解锁为读写后可替换"
          >替换</button>
          <button type="button" data-testid="viewer-wrap-toggle" @click="toggleWrap(); closeMore()">{{ wrapLines ? '不换行' : '自动换行' }}</button>
          <button type="button" data-testid="viewer-copy-selection" @click="copySelected(); closeMore()">复制选中</button>
          <button type="button" data-testid="viewer-copy-all" @click="copyAll(); closeMore()">复制全部</button>
          <button type="button" data-testid="viewer-reload" :disabled="busy" @click="emit('reload'); closeMore()">重新加载</button>
        </div>
      </Teleport>

      <div ref="editorHost" class="sftp-codemirror-host sftp-text-selection-surface" :aria-busy="busy"></div>

      <footer class="sftp-viewer-footer">
        <button
          type="button"
          class="secondary sftp-editor-mode-toggle"
          data-testid="viewer-mode-toggle"
          :disabled="busy || unlockDisabled"
          :title="unlockReason || '切换到读写模式'"
          @click="emit('unlock')"
        >{{ busy ? '读取中…' : '只读' }}</button>
        <span>{{ formatBytes(file.size || file.entry?.size || 0) }}</span>
        <span>{{ file.encoding || 'utf-8' }}</span>
        <span>{{ file.detectedLanguage || languageMode.label }}</span>
        <span>{{ file.truncated ? 'truncated' : 'complete' }}</span>
      </footer>
    </section>
  </div>
</template>
