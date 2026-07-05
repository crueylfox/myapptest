<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { CommandFavorite, CommandScope, Connection, SaveCommandFavoriteRequest } from '../types'
import { LOCAL_COMMAND_HISTORY_SERVER_IDS } from '../stores/commands'
import type { CommandShellType } from '../data/commandPanelCommonCommands'

const props = defineProps<{
  open: boolean
  favorite: CommandFavorite | null
  initialCommand: string
  connection: Connection | null
}>()
const emit = defineEmits<{
  close: []
  save: [request: SaveCommandFavoriteRequest]
}>()

const form = reactive({
  title: '',
  command: '',
  description: '',
  scope: 'global' as CommandScope,
  shell: 'any' as CommandShellType,
  tags: '',
  sortOrder: 0,
})

const canUseServerScope = computed(() => Boolean(props.connection))
const canUseGroupScope = computed(() => Boolean(props.connection?.groupId))

watch(() => [props.open, props.favorite, props.initialCommand] as const, () => {
  if (!props.open) return
  form.title = props.favorite?.title ?? ''
  form.command = props.favorite?.command ?? props.initialCommand
  form.description = props.favorite?.description ?? ''
  form.scope = props.favorite?.scope ?? (props.connection ? 'server' : 'global')
  form.shell = props.favorite ? favoriteShellType(props.favorite) : defaultShellType(props.connection)
  if (form.scope === 'server' && !canUseServerScope.value) form.scope = 'global'
  if (form.scope === 'group' && !canUseGroupScope.value) form.scope = 'global'
  form.tags = (props.favorite?.tags ?? []).filter((tag) => !tag.startsWith('shell:') && tag !== 'source:local').join(', ')
  form.sortOrder = props.favorite?.sortOrder ?? 0
}, { immediate: true })

function submit() {
  const tags = form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  tags.push(`shell:${form.shell}`)
  if ((props.connection?.id ?? 0) < 0) tags.push('source:local')
  const request: SaveCommandFavoriteRequest = {
    id: props.favorite?.id ?? '',
    title: form.title.trim(),
    command: form.command.trim(),
    description: form.description.trim(),
    scope: form.scope,
    serverId: form.scope === 'server' ? props.connection?.id ?? null : null,
    groupId: form.scope === 'group' ? props.connection?.groupId ?? null : null,
    tags,
    sortOrder: Number(form.sortOrder) || 0,
    allowSensitive: false,
  }
  emit('save', request)
}

function defaultShellType(connection: Connection | null): CommandShellType {
  if (connection?.id === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:cmd']) return 'cmd'
  if (connection?.id === LOCAL_COMMAND_HISTORY_SERVER_IDS['local:powershell']) return 'powershell'
  if (connection) return 'ssh'
  return 'any'
}

function favoriteShellType(favorite: CommandFavorite): CommandShellType {
  const value = favorite.tags.find((tag) => tag.startsWith('shell:'))?.slice('shell:'.length)
  if (value === 'ssh' || value === 'cmd' || value === 'powershell' || value === 'any') return value
  return 'any'
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')" @keydown.esc.prevent="emit('close')">
    <form class="modal command-favorite-editor" data-testid="command-favorite-editor" @submit.prevent="submit">
      <header>
        <h2>{{ favorite ? '编辑常用命令' : '新增常用命令' }}</h2>
        <button type="button" class="dialog-close-button" @click="emit('close')">关闭</button>
      </header>
      <div class="form-grid">
        <label class="span-2">标题
          <input v-model.trim="form.title" required maxlength="120" />
        </label>
        <label class="span-2">命令
          <textarea v-model.trim="form.command" required rows="4" />
        </label>
        <label class="span-2">说明
          <textarea v-model.trim="form.description" rows="2" />
        </label>
        <label>范围
          <select v-model="form.scope">
            <option value="global">全局收藏</option>
            <option value="group" :disabled="!canUseGroupScope">当前分组收藏</option>
            <option value="server" :disabled="!canUseServerScope">当前服务器收藏</option>
          </select>
        </label>
        <label>排序
          <input v-model.number="form.sortOrder" type="number" />
        </label>
        <label>Shell
          <select v-model="form.shell" data-testid="command-favorite-shell-type">
            <option value="any">通用</option>
            <option value="ssh">SSH/Linux</option>
            <option value="cmd">CMD</option>
            <option value="powershell">PowerShell</option>
          </select>
        </label>
        <label class="span-2">标签
          <input v-model="form.tags" placeholder="逗号分隔，例如 docker, logs" />
        </label>
      </div>
      <p class="form-note">收藏命令不会进入备份；疑似包含密码、token 或 secret 的命令会要求二次确认。</p>
      <footer>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
        <button type="submit" class="primary">保存</button>
      </footer>
    </form>
  </div>
</template>
