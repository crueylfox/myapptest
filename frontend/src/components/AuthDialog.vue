<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { AuthRequest, Connection } from '../types'

const props = defineProps<{
  open: boolean
  connection: Connection | null
  mode: 'connect' | 'test' | 'terminal' | 'terminal-reconnect' | 'server-reconnect' | 'sftp'
  issue?: string
}>()
const emit = defineEmits<{ close: []; submit: [auth: AuthRequest] }>()
const auth = reactive<AuthRequest>({
  password: '', passphrase: '', trustUnknownHost: false,
  rememberSecret: true,
})
watch(() => props.open, (open) => {
  if (open) Object.assign(auth, {
    password: '', passphrase: '', trustUnknownHost: false,
    rememberSecret: true,
  })
})
function submit() {
  emit('submit', { ...auth })
  auth.password = ''
  auth.passphrase = ''
}

function dialogTitle() {
  if (props.mode === 'test') return '测试连接'
  if (props.mode === 'terminal') return '打开 SSH 终端'
  return '输入认证信息'
}

function submitLabel() {
  if (props.mode === 'test') return '开始测试'
  if (props.mode === 'terminal') return '打开终端'
  return '提交'
}
</script>

<template>
  <div v-if="open && connection" class="modal-backdrop" @click.self="emit('close')">
    <form class="modal auth-modal" @submit.prevent="submit">
      <header><h2>{{ dialogTitle() }}</h2><button type="button" class="dialog-close-button" @click="emit('close')">关闭</button></header>
      <p class="target">{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</p>
      <p v-if="issue" class="form-error">{{ issue }}</p>
      <p v-else-if="connection.credentialSaved" class="saved-credential">系统凭据库中已有保存的{{ connection.authType === 'password' ? '密码' : '私钥口令' }}</p>
      <label v-if="connection.authType === 'password'">密码<input v-model="auth.password" type="password" :required="!connection.credentialSaved" :placeholder="connection.credentialSaved ? '留空使用已保存密码' : ''" autocomplete="off" /></label>
      <label v-else>私钥口令（无口令可留空）<input v-model="auth.passphrase" type="password" :placeholder="connection.credentialSaved ? '留空使用已保存口令' : ''" autocomplete="off" /></label>
      <label class="checkbox"><input v-model="auth.rememberSecret" type="checkbox" />记住{{ connection.authType === 'password' ? '密码' : '私钥口令' }}到系统凭据库</label>
      <footer><button type="button" class="secondary" @click="emit('close')">取消</button><button type="submit" class="primary">{{ submitLabel() }}</button></footer>
    </form>
  </div>
</template>
