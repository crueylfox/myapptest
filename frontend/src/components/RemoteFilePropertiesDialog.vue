<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { confirmDialog } from '../composables/useAppDialog'
import type { SFTPItemProperties } from '../types'
import { formatBytes } from '../utils/format'
import AppActionBar from './primitives/AppActionBar.vue'

const props = defineProps<{
  item: SFTPItemProperties
  busy: boolean
  error?: string
  connectionName?: string
}>()

const emit = defineEmits<{
  close: []
  applyPermissions: [mode: number]
}>()

type PermissionRow = 'owner' | 'group' | 'other'
type PermissionBit = 'read' | 'write' | 'execute'

const modeDraft = ref(formatEditableMode(props.item.mode))
const copyStatus = ref('')

const rowBits: Record<PermissionRow, Record<PermissionBit, number>> = {
  owner: { read: 0o400, write: 0o200, execute: 0o100 },
  group: { read: 0o040, write: 0o020, execute: 0o010 },
  other: { read: 0o004, write: 0o002, execute: 0o001 },
}
const rows: { id: PermissionRow; label: string }[] = [
  { id: 'owner', label: '所有者' },
  { id: 'group', label: '用户组' },
  { id: 'other', label: '其他' },
]
const bits: { id: PermissionBit; label: string }[] = [
  { id: 'read', label: '读' },
  { id: 'write', label: '写' },
  { id: 'execute', label: '执行' },
]

const initialMode = computed(() => props.item.mode & 0o777)
const specialMode = computed(() => props.item.mode & 0o7000)
const parsedMode = computed(() => parseEditableMode(modeDraft.value))
const modeError = computed(() => parsedMode.value === null ? '权限必须是 0000 到 0777 的八进制值' : '')
const dirty = computed(() => parsedMode.value !== null && parsedMode.value !== initialMode.value)
const canApply = computed(() => !props.busy && !props.item.isSymlink && !modeError.value && dirty.value)
const specialModeText = computed(() => specialMode.value ? `0${specialMode.value.toString(8).padStart(3, '0')}` : '无')
const itemTypeText = computed(() => {
  if (props.item.isSymlink || props.item.type === 'symlink') return '符号链接'
  if (props.item.isDir || props.item.type === 'directory') return '目录'
  if (props.item.type === 'file') return '文件'
  return '其他'
})
const displayMode = computed(() => `0${(props.item.mode & 0o7777).toString(8).padStart(3, '0')}`)
const displaySize = computed(() => props.item.isDir ? '—' : formatBytes(props.item.size || 0))
const symlinkTarget = computed(() => props.item.symlinkTarget?.trim() || '—')

watch(() => props.item, (item) => {
  modeDraft.value = formatEditableMode(item.mode)
  copyStatus.value = ''
})

function formatEditableMode(mode: number) {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`
}

function parseEditableMode(value: string) {
  const trimmed = value.trim()
  if (!/^[0-7]{3,4}$/.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 8)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o777) return null
  return parsed
}

function bitChecked(row: PermissionRow, bit: PermissionBit) {
  const mode = parsedMode.value ?? initialMode.value
  return (mode & rowBits[row][bit]) !== 0
}

function toggleBit(row: PermissionRow, bit: PermissionBit, checked: boolean) {
  const current = parsedMode.value ?? initialMode.value
  const mask = rowBits[row][bit]
  const next = checked ? current | mask : current & ~mask
  modeDraft.value = formatEditableMode(next)
}

function onBitChange(row: PermissionRow, bit: PermissionBit, event: Event) {
  toggleBit(row, bit, (event.target as HTMLInputElement).checked)
}

async function applyPermissions() {
  if (!canApply.value || parsedMode.value === null) return
  const confirmed = await confirmDialog({
    title: '应用权限',
    message: '这会修改远程项目的 Unix 权限，不会修改所有者或用户组。',
    confirmText: '应用权限',
    cancelText: '取消',
  })
  if (!confirmed) return
  emit('applyPermissions', parsedMode.value)
}

async function requestClose() {
  if (dirty.value) {
    const confirmed = await confirmDialog({
      title: '放弃权限修改',
      message: '当前权限输入尚未应用，关闭后这些修改会被丢弃。',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      danger: true,
    })
    if (!confirmed) return
  }
  emit('close')
}

async function copyPath() {
  try {
    await navigator.clipboard?.writeText(props.item.path)
    copyStatus.value = '已复制'
  } catch {
    copyStatus.value = '复制失败'
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="remote-properties-backdrop">
    <section
      class="remote-properties-dialog"
      data-testid="remote-properties-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="远程属性"
    >
      <header class="remote-properties-header">
        <div>
          <strong>文件属性</strong>
          <span>{{ connectionName || item.contextId || 'SFTP/SCP' }}</span>
        </div>
        <button
          type="button"
          class="dialog-close-button"
          data-testid="properties-close"
          @click="requestClose"
        >关闭</button>
      </header>

      <div v-if="error" class="remote-properties-error" data-testid="remote-properties-error">{{ error }}</div>

      <div class="remote-properties-grid">
        <span>名称</span><strong :title="item.name">{{ item.name }}</strong>
        <span>完整路径</span>
        <strong class="remote-properties-path" :title="item.path">
          <span>{{ item.path }}</span>
          <button type="button" class="text-button" data-testid="remote-properties-copy-path" @click="copyPath">复制路径</button>
          <small v-if="copyStatus">{{ copyStatus }}</small>
        </strong>
        <span>类型</span><strong>{{ itemTypeText }}</strong>
        <span>大小</span><strong>{{ displaySize }}</strong>
        <span>修改时间</span><strong>{{ item.modTime || '—' }}</strong>
        <span>权限字符</span><strong><code>{{ item.permissions || '—' }}</code></strong>
        <span>权限八进制</span><strong><code>{{ displayMode }}</code></strong>
        <span>所有者</span><strong>{{ item.owner || '—' }}</strong>
        <span>用户组</span><strong>{{ item.group || '—' }}</strong>
        <span>符号链接目标</span><strong :title="symlinkTarget">{{ symlinkTarget }}</strong>
        <span>高级位</span><strong>{{ specialModeText }}</strong>
      </div>

      <section class="remote-properties-permissions" aria-label="Unix 权限">
        <header>
          <strong>权限</strong>
          <span>仅编辑普通 9 位权限，高级位保存时保留。</span>
        </header>
        <label class="remote-properties-mode">
          <span>八进制</span>
          <input
            v-model="modeDraft"
            data-testid="properties-mode-input"
            inputmode="numeric"
            autocomplete="off"
            :disabled="busy || item.isSymlink"
          >
        </label>
        <p v-if="modeError" class="remote-properties-mode-error" data-testid="properties-mode-error">{{ modeError }}</p>
        <p v-if="item.isSymlink" class="remote-properties-note" data-testid="properties-symlink-note">符号链接权限不在本轮修改范围。</p>
        <div class="remote-permission-grid">
          <span></span>
          <span v-for="bit in bits" :key="bit.id">{{ bit.label }}</span>
          <template v-for="row in rows" :key="row.id">
            <span>{{ row.label }}</span>
            <label v-for="bit in bits" :key="`${row.id}-${bit.id}`">
              <input
                type="checkbox"
                :data-testid="`properties-${row.id}-${bit.id}`"
                :checked="bitChecked(row.id, bit.id)"
                :disabled="busy || item.isSymlink"
                @change="onBitChange(row.id, bit.id, $event)"
              >
            </label>
          </template>
        </div>
      </section>

      <AppActionBar as="footer" class="remote-properties-actions">
        <button
          type="button"
          class="secondary"
          data-testid="properties-apply"
          :disabled="!canApply"
          @click="applyPermissions"
        >{{ busy ? '应用中...' : '应用权限' }}</button>
      </AppActionBar>
    </section>
  </div>
</template>
