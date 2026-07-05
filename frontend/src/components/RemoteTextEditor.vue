<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
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
import type { SFTPEntry, SFTPSaveError } from '../types'
import { formatBytes } from '../utils/format'
import { visibleSelectionDecoration } from '../utils/visibleSelectionDecoration'
import { getViewportPopoverPosition } from '../utils/viewportPopover'

type MatchRange = { from: number; to: number }
const MORE_MENU_WIDTH = 170
const MORE_MENU_HEIGHT = 280
const MORE_MENU_MARGIN = 12
const MORE_MENU_GAP = 6
const INLINE_TOOLBAR_MIN_WIDTH = 820

const props = defineProps<{
  entry: SFTPEntry
  content: string
  dirty: boolean
  busy: boolean
  saveError?: SFTPSaveError | null
}>()

const emit = defineEmits<{
  'update:content': [content: string]
  save: []
  saveAs: []
  reload: []
  close: []
  readonly: []
}>()

const editorHost = ref<HTMLElement>()
const toolbarMain = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const replaceInput = ref<HTMLInputElement>()
const searchOpen = ref(false)
const replaceOpen = ref(false)
const searchQuery = ref('')
const replaceText = ref('')
const searchCaseSensitive = ref(false)
const searchIndex = ref(0)
const replaceNotice = ref('')
const editorText = ref(props.content)
const cursorLine = ref(1)
const cursorColumn = ref(1)
const wrapLines = ref(true)
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

const languageMode = computed(() => languageForPath(props.entry.name, props.entry.path))
const matches = computed(() => findMatches(editorText.value, searchQuery.value, searchCaseSensitive.value))
const searchStatus = computed(() => {
  if (!searchQuery.value) return '输入关键字'
  if (matches.value.length === 0) return '无匹配'
  return `${Math.min(searchIndex.value + 1, matches.value.length)} / ${matches.value.length}`
})

function extensionOfName(name: string): { label: string; extension: Extension } {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : lower
  if (['.sh', '.bash', '.zsh'].includes(ext)) {
    return { label: 'Shell', extension: StreamLanguage.define(shell) }
  }
  if (['.conf', '.config', '.ini', '.env', '.service'].includes(ext) || lower.endsWith('.env')) {
    return { label: 'Config', extension: StreamLanguage.define(properties) }
  }
  if (ext === '.toml') return { label: 'TOML', extension: StreamLanguage.define(toml) }
  if (ext === '.json') return { label: 'JSON', extension: json() }
  if (ext === '.js') return { label: 'JavaScript', extension: javascript({ jsx: true }) }
  if (ext === '.ts') return { label: 'TypeScript', extension: javascript({ typescript: true }) }
  if (ext === '.html') return { label: 'HTML', extension: html() }
  if (ext === '.xml') return { label: 'XML', extension: StreamLanguage.define(legacyXML) }
  if (ext === '.css') return { label: 'CSS', extension: css() }
  if (ext === '.md') return { label: 'Markdown', extension: markdown() }
  if (ext === '.py') return { label: 'Python', extension: python() }
  if (ext === '.go') return { label: 'Go', extension: go() }
  if (ext === '.yml' || ext === '.yaml') return { label: 'YAML', extension: yaml() }
  return { label: 'Plain Text', extension: [] }
}

function languageForPath(name: string, path: string) {
  return extensionOfName(name || path)
}

function darkThemeEnabled() {
  return document.documentElement.dataset.theme !== 'light'
}

function editorTheme(dark: boolean) {
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
      caretColor: dark ? '#ffffff' : '#0f172a',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: dark ? '#ffffff' : '#0f172a',
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
    '.cm-activeLineGutter': {
      backgroundColor: dark ? '#1c2f4d' : '#eef6ff',
      color: dark ? '#f8fbff' : '#0f172a',
    },
    '.cm-gutters': {
      backgroundColor: dark ? '#0c1422' : '#f1f5f9',
      color: dark ? '#b7c5da' : '#64748b',
      borderRightColor: dark ? '#334155' : '#d7e0eb',
    },
    '.cm-searchMatch': {
      backgroundColor: dark ? '#f59e0bcc' : '#fde68a',
      outline: dark ? '1px solid #fde68a' : '1px solid #ca8a04',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: dark ? '#06b6d4dd' : '#67e8f9',
      outline: dark ? '1px solid #a5f3fc' : '1px solid #0891b2',
    },
  }, { dark })
  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: dark ? '#c084fc' : '#7e22ce', fontWeight: '700' },
    { tag: [t.string, t.special(t.string)], color: dark ? '#34d399' : '#047857', fontWeight: '600' },
    { tag: [t.number, t.bool, t.null, t.constant(t.variableName)], color: dark ? '#facc15' : '#b45309', fontWeight: '700' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: dark ? '#94a3b8' : '#64748b', fontStyle: 'italic' },
    { tag: [t.variableName, t.propertyName], color: dark ? '#dbeafe' : '#1e3a8a' },
    { tag: [t.function(t.variableName), t.definition(t.variableName)], color: dark ? '#67e8f9' : '#0369a1', fontWeight: '700' },
    { tag: [t.className, t.typeName], color: dark ? '#f9a8d4' : '#be185d', fontWeight: '700' },
    { tag: [t.tagName], color: dark ? '#fb923c' : '#c2410c', fontWeight: '700' },
    { tag: [t.attributeName], color: dark ? '#a7f3d0' : '#0f766e', fontWeight: '600' },
    { tag: [t.operator], color: dark ? '#f0abfc' : '#9333ea', fontWeight: '600' },
    { tag: [t.punctuation], color: dark ? '#cbd5e1' : '#475569' },
  ])
  return [viewTheme, syntaxHighlighting(highlight)]
}

function createEditor() {
  if (!editorHost.value) return
  view?.destroy()
  const state = EditorState.create({
    doc: props.content,
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
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            emit('save')
            return true
          },
        },
        {
          key: 'Mod-f',
          preventDefault: true,
          run: () => {
            openSearch()
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
            if (!searchOpen.value) return false
            closeSearch()
            return true
          },
        },
        indentWithTab,
      ])),
      basicSetup,
      visibleSelectionDecoration,
      languageCompartment.of(languageMode.value.extension),
      themeCompartment.of(editorTheme(darkThemeEnabled())),
      wrapCompartment.of(wrapLines.value ? EditorView.lineWrapping : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const next = update.state.doc.toString()
          editorText.value = next
          emit('update:content', next)
        }
        if (update.selectionSet || update.docChanged) updateCursor(update.state)
      }),
    ],
  })
  view = new EditorView({ state, parent: editorHost.value })
  editorText.value = props.content
  updateCursor(state)
  view.focus()
}

function updateCursor(state: EditorState) {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  cursorLine.value = line.number
  cursorColumn.value = pos - line.from + 1
}

function selectAllText() {
  if (!view) return
  view.dispatch({
    selection: EditorSelection.range(0, view.state.doc.length),
    effects: EditorView.scrollIntoView(0, { y: 'start' }),
  })
  view.focus()
}

function syncExternalContent(value: string) {
  if (!view || view.state.doc.toString() === value) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  })
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

function openSearch() {
  searchOpen.value = true
  replaceOpen.value = false
  replaceNotice.value = ''
  void nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

function openReplace() {
  searchOpen.value = true
  replaceOpen.value = true
  replaceNotice.value = ''
  closeMore()
  void nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

function closeReplace() {
  replaceOpen.value = false
  replaceText.value = ''
  replaceNotice.value = ''
  view?.focus()
}

function closeSearch() {
  searchOpen.value = false
  replaceOpen.value = false
  searchQuery.value = ''
  replaceText.value = ''
  replaceNotice.value = ''
  closeMore()
  view?.focus()
}

function nextMatch() {
  selectMatch(searchIndex.value + 1)
}

function previousMatch() {
  selectMatch(searchIndex.value - 1)
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSearch()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) previousMatch()
    else nextMatch()
  }
}

function selectedText() {
  if (!view) return ''
  const range = view.state.selection.main
  if (range.empty) return ''
  return view.state.sliceDoc(range.from, range.to)
}

async function copySelected() {
  await navigator.clipboard.writeText(selectedText())
  view?.focus()
}

async function copyAll() {
  await navigator.clipboard.writeText(editorText.value)
  view?.focus()
}

function toggleWrap() {
  wrapLines.value = !wrapLines.value
  view?.dispatch({ effects: wrapCompartment.reconfigure(wrapLines.value ? EditorView.lineWrapping : []) })
  view?.focus()
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

function replaceCurrentMatch() {
  if (!view || matches.value.length === 0 || !searchQuery.value) return
  const normalized = Math.min(searchIndex.value, matches.value.length - 1)
  const match = matches.value[normalized]
  const inserted = replaceText.value
  view.dispatch({
    changes: { from: match.from, to: match.to, insert: inserted },
    selection: { anchor: match.from, head: match.from + inserted.length },
    effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
  })
  searchIndex.value = Math.min(normalized, Math.max(matches.value.length - 1, 0))
  replaceNotice.value = '已替换 1 处'
  view.focus()
}

function replaceAllMatches() {
  if (!view || matches.value.length === 0 || !searchQuery.value) return
  const ranges = matches.value.slice()
  const inserted = replaceText.value
  view.dispatch({
    changes: ranges.map((range) => ({ from: range.from, to: range.to, insert: inserted })),
    selection: { anchor: ranges[0].from, head: ranges[0].from + inserted.length },
    effects: EditorView.scrollIntoView(ranges[0].from, { y: 'center' }),
  })
  replaceNotice.value = `已替换 ${ranges.length} 处`
  searchIndex.value = 0
  view.focus()
}

watch(() => props.content, syncExternalContent)

watch(languageMode, (mode) => {
  view?.dispatch({ effects: languageCompartment.reconfigure(mode.extension) })
})

watch([searchQuery, searchCaseSensitive], () => {
  replaceNotice.value = ''
})

watch([matches, searchQuery, searchCaseSensitive], () => {
  if (matches.value.length === 0) {
    searchIndex.value = 0
    return
  }
  selectMatch(Math.min(searchIndex.value, matches.value.length - 1), false)
})

onMounted(() => {
  createEditor()
  themeObserver = new MutationObserver(() => {
    view?.dispatch({ effects: themeCompartment.reconfigure(editorTheme(darkThemeEnabled())) })
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
  <div class="sftp-editor-backdrop">
    <section class="sftp-editor" role="dialog" aria-modal="true" aria-label="远程文本编辑器">
      <header class="sftp-editor-header">
        <div class="sftp-editor-title">
          <strong>{{ entry.name }}</strong>
          <span :title="entry.path">{{ entry.path }}</span>
        </div>
        <button
          type="button"
          class="dialog-close-button sftp-editor-close"
          title="关闭"
          aria-label="关闭"
          :disabled="busy"
          @click="emit('close')"
        >关闭</button>
      </header>

      <div class="sftp-editor-toolbar" :class="{ 'sftp-editor-replace': replaceOpen }">
        <div ref="toolbarMain" class="sftp-editor-search sftp-editor-toolbar-main sftp-editor-toolbar-nowrap" @keydown="onSearchKeydown">
          <input
            ref="searchInput"
            v-model="searchQuery"
            data-testid="editor-search-input"
            type="search"
            placeholder="搜索"
            autocomplete="off"
          />
          <label class="sftp-editor-case-toggle">
            <input v-model="searchCaseSensitive" type="checkbox" />
            <span>Aa</span>
          </label>
          <span class="sftp-editor-search-status" :class="{ empty: searchQuery && matches.length === 0 }">{{ searchStatus }}</span>
          <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-search-prev" :disabled="matches.length === 0" @click="previousMatch">上一个</button>
          <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-search-next" :disabled="matches.length === 0" @click="nextMatch">下一个</button>
          <button type="button" class="primary" data-testid="editor-save" :disabled="busy || !dirty" @click="emit('save')">保存</button>
          <template v-if="showInlineToolbarActions">
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-replace-toggle" @click="openReplace">替换</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-save-as" :disabled="busy" @click="emit('saveAs')">另存为</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-wrap-toggle" @click="toggleWrap">{{ wrapLines ? '不换行' : '自动换行' }}</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-copy-selection" @click="copySelected">复制选中</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-copy-all" @click="copyAll">复制全部</button>
            <span class="sftp-editor-toolbar-separator" aria-hidden="true">|</span>
            <button type="button" class="sftp-editor-toolbar-action" data-testid="editor-reload" :disabled="busy" @click="emit('reload')">重新载入</button>
          </template>
          <button
            v-else
            ref="moreButton"
            type="button"
            class="sftp-editor-toolbar-action sftp-editor-more-trigger"
            data-testid="editor-more"
            :aria-expanded="moreOpen"
            @click="toggleMore"
          >更多</button>
        </div>
        <div v-if="replaceOpen" class="sftp-editor-replace-row" @keydown="onSearchKeydown">
          <label>
            <span>查找内容</span>
            <input
              v-model="searchQuery"
              data-testid="editor-replace-find-input"
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
              data-testid="editor-replace-input"
              type="text"
              placeholder="替换为"
              autocomplete="off"
            />
          </label>
          <button
            type="button"
            class="secondary"
            data-testid="editor-replace-one"
            :disabled="matches.length === 0 || !searchQuery"
            @click="replaceCurrentMatch"
          >替换</button>
          <button
            type="button"
            class="secondary"
            data-testid="editor-replace-all"
            :disabled="matches.length === 0 || !searchQuery"
            @click="replaceAllMatches"
          >全部替换</button>
          <button type="button" class="secondary" data-testid="editor-replace-close" @click="closeReplace">关闭替换</button>
          <span v-if="replaceNotice" class="replace-notice">{{ replaceNotice }}</span>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="moreOpen"
          class="viewport-popover viewport-popover-menu viewport-popover-scroll sftp-editor-more-menu"
          data-testid="editor-more-menu"
          role="menu"
          :style="moreMenuStyle"
          @pointerdown.stop
          @click.stop
        >
          <button type="button" data-testid="editor-replace-toggle" @click="openReplace">替换</button>
          <button type="button" data-testid="editor-save-as" :disabled="busy" @click="emit('saveAs'); closeMore()">另存为</button>
          <button type="button" data-testid="editor-wrap-toggle" @click="toggleWrap(); closeMore()">{{ wrapLines ? '不换行' : '自动换行' }}</button>
          <button type="button" data-testid="editor-copy-selection" @click="copySelected(); closeMore()">复制选中</button>
          <button type="button" data-testid="editor-copy-all" @click="copyAll(); closeMore()">复制全部</button>
          <button type="button" data-testid="editor-reload" :disabled="busy" @click="emit('reload'); closeMore()">重新载入</button>
        </div>
      </Teleport>

      <div ref="editorHost" class="sftp-codemirror-host sftp-text-selection-surface" :aria-busy="busy"></div>

      <div v-if="saveError" class="sftp-editor-error" role="alert">
        <strong>{{ saveError.userMessage }}</strong>
        <details v-if="saveError.technicalMessage || saveError.stage || saveError.code">
          <summary>查看技术详情</summary>
          <code>{{ saveError.stage }} · {{ saveError.code }}</code>
          <p v-if="saveError.technicalMessage">{{ saveError.technicalMessage }}</p>
        </details>
      </div>

      <footer>
        <button
          type="button"
          class="secondary sftp-editor-mode-toggle"
          data-testid="editor-mode-toggle"
          :disabled="busy"
          title="切回只读模式"
          @click="emit('readonly')"
        >读写</button>
        <span>
          {{ dirty ? '未保存' : '已保存' }}
          <i v-if="busy">保存中…</i>
        </span>
        <span>{{ languageMode.label }}</span>
        <span>{{ formatBytes(entry.size) }}</span>
        <span>Ln {{ cursorLine }}, Col {{ cursorColumn }}</span>
      </footer>
    </section>
  </div>
</template>
