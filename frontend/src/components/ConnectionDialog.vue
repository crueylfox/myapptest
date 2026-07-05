<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  AppSettings, AuthRequest, AuthType, Connection, ConnectionMode, Group, KeyVaultEntry, PrivateKeyValidationResult, PrivateKeySource,
  SaveConnectionConfigRequest, SaveConnectionRequest, SaveKeyVaultEntryRequest, SecretUpdateMode, TerminalProfile,
} from '../types'
import { api } from '../api/backend'

const savedPasswordMask = '********'
const props = defineProps<{
  open: boolean
  connection: Connection | null
  groups: Group[]
  settings: AppSettings
  terminalProfiles?: TerminalProfile[]
  connections?: Connection[]
}>()
const emit = defineEmits<{
  close: []
  save: [request: SaveConnectionConfigRequest]
  deleteCredential: [connectionId: number]
}>()
const browseError = ref('')
const routeError = ref('')
const keyVaultEntries = ref<KeyVaultEntry[]>([])
const keyVaultError = ref('')
const keyImportOpen = ref(false)
const keyImportBusy = ref(false)
const keyImportError = ref('')
const keyImportValidation = ref<PrivateKeyValidationResult | null>(null)
const formElement = ref<HTMLFormElement | null>(null)
const passwordDisplay = ref('')
const passwordMaskActive = ref(false)
const form = reactive<SaveConnectionRequest>({
  id: 0, groupId: null, name: '', host: '', port: 22, username: 'root',
  authType: 'password', privateKeySource: 'key_vault', privateKeyPath: '', keyVaultId: null,
  terminalProfileId: null,
  connectionMode: 'direct',
  jumpServerId: null,
  refreshInterval: 1,
})
const keyImportForm = reactive<SaveKeyVaultEntryRequest>({
  id: 0,
  name: '',
  privateKeyPath: '',
  passphrase: '',
  rememberPassphrase: true,
  updatePassphrase: false,
  deletePassphrase: false,
  notes: '',
})
const auth = reactive<AuthRequest>({
  password: '', passphrase: '', trustUnknownHost: false, rememberSecret: true, secretUpdateMode: 'unchanged',
})

watch(() => [props.open, props.connection] as const, () => {
  if (!props.open) {
    clearSecrets()
    return
  }
  browseError.value = ''
  Object.assign(form, props.connection ? {
    id: props.connection.id, groupId: props.connection.groupId, name: props.connection.name,
    host: props.connection.host, port: props.connection.port, username: props.connection.username,
    authType: props.connection.authType,
    privateKeySource: props.connection.privateKeySource || 'local_file',
    privateKeyPath: props.connection.privateKeyPath,
    keyVaultId: props.connection.keyVaultId,
    terminalProfileId: props.connection.terminalProfileId ?? null,
    connectionMode: props.connection.connectionMode ?? 'direct',
    jumpServerId: props.connection.jumpServerId ?? null,
    refreshInterval: props.connection.refreshInterval,
  } : {
    id: 0, groupId: null, name: '', host: '', port: 22, username: 'root',
    authType: 'password', privateKeySource: 'key_vault', privateKeyPath: '', keyVaultId: null,
    terminalProfileId: null,
    connectionMode: 'direct',
    jumpServerId: null,
    refreshInterval: 1,
  })
  routeError.value = ''
  clearSecrets()
  auth.rememberSecret = true
  if (form.authType === 'private_key') void loadKeyVaultEntries()
}, { immediate: true })

const selectedKeyVaultEntry = computed(() =>
  keyVaultEntries.value.find((entry) => entry.id === form.keyVaultId) || null,
)
const missingSelectedKeyVault = computed(() =>
  form.authType === 'private_key' &&
  form.privateKeySource === 'key_vault' &&
  form.id !== 0 &&
  keyVaultEntries.value.length > 0 &&
  !selectedKeyVaultEntry.value,
)
const jumpCandidates = computed(() =>
  (props.connections ?? [])
    .filter((connection) => connection.id > 0)
    .filter((connection) => connection.id !== form.id)
    .filter((connection) => (connection.connectionMode ?? 'direct') !== 'jump'),
)
const routeValue = computed({
  get() {
    if (form.connectionMode === 'jump') {
      return form.jumpServerId ? `jump:${form.jumpServerId}` : 'jump:'
    }
    return 'direct'
  },
  set(value: string) {
    routeError.value = ''
    if (value === 'direct') {
      form.connectionMode = 'direct'
      form.jumpServerId = null
      return
    }
    if (value.startsWith('jump:')) {
      const id = Number(value.slice(5))
      form.connectionMode = 'jump'
      form.jumpServerId = Number.isFinite(id) && id > 0 ? id : null
    }
  },
})
const jumpMissingMessage = computed(() =>
  form.id > 0 && form.connectionMode === 'jump' && !form.jumpServerId
    ? '该服务器配置的跳板机已不存在，请重新选择跳板机。'
    : '',
)
const visibleCredentialSaved = computed(() => credentialSavedForAuth(form.authType))
const credentialStatusSaved = computed(() =>
  visibleCredentialSaved.value || passwordCredentialSaved(),
)

function passwordCredentialSaved() {
  if (!props.connection) return false
  return props.connection.passwordCredentialSaved ??
    (props.connection.authType === 'password' && props.connection.credentialSaved)
}

function credentialSavedForAuth(authType: AuthType) {
  if (!props.connection) return false
  if (authType === 'password') {
    return passwordCredentialSaved()
  }
  return props.connection.authType === authType && props.connection.credentialSaved
}

function clearSecrets() {
  auth.password = ''
  auth.passphrase = ''
  auth.secretUpdateMode = 'unchanged'
  resetPasswordDisplay()
}

function resetPasswordDisplay() {
  if (form.authType === 'password' && credentialSavedForAuth('password')) {
    passwordDisplay.value = savedPasswordMask
    passwordMaskActive.value = true
    return
  }
  passwordDisplay.value = ''
  passwordMaskActive.value = false
}

function focusPasswordInput() {
  if (!passwordMaskActive.value) return
  passwordDisplay.value = ''
  passwordMaskActive.value = false
  auth.password = ''
}

function inputPassword(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (passwordMaskActive.value && value === savedPasswordMask) {
    passwordDisplay.value = savedPasswordMask
    auth.password = ''
    return
  }
  passwordMaskActive.value = false
  passwordDisplay.value = value
  auth.password = value === savedPasswordMask ? '' : value
}

function secretUpdateModeForSubmit(): SecretUpdateMode {
  const value = form.authType === 'password' ? auth.password : auth.passphrase
  return value ? 'set' : 'unchanged'
}

function close() {
  clearSecrets()
  emit('close')
}

function changeAuthType(event: Event) {
  const next = (event.target as HTMLSelectElement).value as AuthType
  if (next === form.authType) return
  form.authType = next
  if (next === 'private_key') {
    form.privateKeySource = 'key_vault'
    form.privateKeyPath = ''
    void loadKeyVaultEntries()
  }
  clearSecrets()
  auth.rememberSecret = true
}

function changePrivateKeySource(event: Event) {
  const next = (event.target as HTMLSelectElement).value as PrivateKeySource
  form.privateKeySource = next
  clearSecrets()
  if (next === 'key_vault') {
    form.privateKeyPath = ''
    auth.rememberSecret = true
    void loadKeyVaultEntries()
  } else {
    form.keyVaultId = null
    auth.rememberSecret = true
  }
}

async function loadKeyVaultEntries() {
  keyVaultError.value = ''
  try {
    keyVaultEntries.value = await api.listKeyVaultEntries()
    if (form.id === 0 && form.authType === 'private_key' && form.privateKeySource === 'key_vault' && !form.keyVaultId && keyVaultEntries.value.length) {
      form.keyVaultId = keyVaultEntries.value[0].id
    }
  } catch (reason) {
    keyVaultError.value = String(reason)
  }
}

function keyVaultOptionLabel(entry: KeyVaultEntry) {
  const bits = entry.keyBits ? ` ${entry.keyBits}` : ''
  return `${entry.name} · ${entry.algorithm}${bits}`
}

function selectedKeyVaultTitle(entry: KeyVaultEntry) {
  const bits = entry.keyBits ? ` ${entry.keyBits}` : ''
  return `${entry.name}·${entry.algorithm}${bits}`
}

function openKeyImport() {
  Object.assign(keyImportForm, {
    id: 0,
    name: '',
    privateKeyPath: '',
    passphrase: '',
    rememberPassphrase: true,
    updatePassphrase: false,
    deletePassphrase: false,
    notes: '',
  })
  keyImportValidation.value = null
  keyImportError.value = ''
  keyImportOpen.value = true
}

function closeKeyImport() {
  keyImportOpen.value = false
  keyImportForm.passphrase = ''
  keyImportForm.privateKeyPath = ''
  keyImportValidation.value = null
}

async function browseImportKey() {
  keyImportError.value = ''
  try {
    const selected = await api.selectPrivateKeyFile()
    if (!selected) return
    keyImportForm.privateKeyPath = selected
    if (!keyImportForm.name) keyImportForm.name = selected.split(/[\\/]/).pop() || 'SSH Key'
    keyImportValidation.value = null
  } catch (reason) {
    keyImportError.value = String(reason)
  }
}

async function validateImportKey() {
  keyImportError.value = ''
  keyImportValidation.value = await api.validatePrivateKeyFile({
    privateKeyPath: keyImportForm.privateKeyPath,
    passphrase: keyImportForm.passphrase,
  })
}

async function saveImportedKey() {
  keyImportError.value = ''
  if (!keyImportValidation.value?.valid) {
    await validateImportKey()
  }
  if (!keyImportValidation.value?.valid) return
  keyImportBusy.value = true
  try {
    const saved = await api.createKeyVaultEntry({ ...keyImportForm })
    await loadKeyVaultEntries()
    form.privateKeySource = 'key_vault'
    form.privateKeyPath = ''
    form.keyVaultId = saved.id
    closeKeyImport()
  } catch (reason) {
    keyImportError.value = String(reason)
  } finally {
    keyImportBusy.value = false
    keyImportForm.passphrase = ''
  }
}

async function browsePrivateKey() {
  browseError.value = ''
  try {
    const selected = await api.selectPrivateKeyFile()
    if (selected) form.privateKeyPath = selected
  } catch (reason) {
    browseError.value = String(reason)
  }
}

function submit(connectAfterSave: boolean) {
  if (!formElement.value?.reportValidity()) return
  if (form.connectionMode === 'jump' && !form.jumpServerId) {
    routeError.value = '请选择跳板机。'
    return
  }
  if (form.authType === 'private_key' && form.privateKeySource === 'key_vault' && !form.keyVaultId) {
    keyVaultError.value = missingSelectedKeyVault.value
      ? '所选密钥已被删除，请重新选择或添加密钥。'
      : '请先在密钥库中添加并选择一个私钥。'
    return
  }
  const request: SaveConnectionConfigRequest = {
    connection: {
      ...form,
      privateKeyPath: form.privateKeySource === 'key_vault' ? '' : form.privateKeyPath,
      keyVaultId: form.privateKeySource === 'key_vault' ? form.keyVaultId : null,
      connectionMode: (form.connectionMode || 'direct') as ConnectionMode,
      jumpServerId: form.connectionMode === 'jump' ? form.jumpServerId : null,
    },
    auth: { ...auth, secretUpdateMode: secretUpdateModeForSubmit() },
    connectAfterSave,
  }
  emit('save', request)
  clearSecrets()
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @pointerdown.self.stop @keydown.esc.prevent="close">
    <form ref="formElement" class="modal connection-modal" @submit.prevent="submit(false)">
      <div class="connection-dialog-rail">
        <header class="connection-dialog-header">
          <h2>{{ form.id ? '编辑服务器' : '添加服务器' }}</h2>
          <button type="button" class="dialog-close-button connection-dialog-close" @click="close">关闭</button>
        </header>
        <div class="connection-form">
          <div class="connection-form-row is-long-short">
            <label class="connection-field is-long">名称（可选）
              <input
                v-model.trim="form.name"
                class="connection-name-input"
                data-testid="name"
                placeholder="留空时使用 主机:端口"
              />
            </label>
            <label class="connection-field is-short">分组
              <select v-model="form.groupId" class="connection-group-select" data-testid="group">
                <option :value="null">未分组</option>
                <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
              </select>
            </label>
          </div>
          <p class="form-note connection-form-hint">未填写名称时，保存后自动使用服务器地址和端口作为名称。</p>
          <div class="connection-form-row is-long-short">
            <label class="connection-field is-long">主机/IP
              <input v-model.trim="form.host" class="connection-host-input" data-testid="host" required />
            </label>
            <label class="connection-field is-short">端口
              <input v-model.number="form.port" class="connection-port-input" data-testid="port" type="number" min="1" max="65535" required />
            </label>
          </div>
          <div class="connection-form-row is-long-short">
            <label class="connection-field is-long">用户名
              <input v-model.trim="form.username" class="connection-username-input" data-testid="username" required />
            </label>
            <label class="connection-field is-short">认证方式
              <select class="connection-auth-select" data-testid="auth-type" :value="form.authType" @change="changeAuthType">
                <option value="password">密码</option>
                <option value="private_key">SSH 私钥</option>
              </select>
            </label>
          </div>
          <template v-if="form.authType === 'password'">
            <div class="connection-form-row is-long-short">
              <label class="connection-field is-long">密码
                <input
                  :value="passwordDisplay"
                  class="connection-password-input"
                  data-testid="password"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="visibleCredentialSaved ? '留空则保持当前已保存密码不变' : '可留空，连接时再输入'"
                  @focus="focusPasswordInput"
                  @input="inputPassword"
                />
              </label>
              <label class="connection-field is-short">刷新周期
                <select v-model.number="form.refreshInterval" class="connection-refresh-select" data-testid="refresh-interval">
                  <option :value="1">1 秒</option>
                  <option :value="2">2 秒</option>
                  <option :value="5">5 秒</option>
                </select>
              </label>
            </div>
            <label class="checkbox connection-auth-checkbox">
              <input v-model="auth.rememberSecret" data-testid="remember-secret" type="checkbox" />
              记住密码到系统凭据库
            </label>
          </template>

          <template v-else>
            <div class="connection-form-row is-long-short">
              <label class="connection-field is-long">密钥库私钥
                <select class="connection-key-source-select" data-testid="private-key-source" :value="form.privateKeySource" @change="changePrivateKeySource">
                  <option value="key_vault">密钥库私钥</option>
                </select>
              </label>
              <label class="connection-field is-short">刷新周期
                <select v-model.number="form.refreshInterval" class="connection-refresh-select" data-testid="refresh-interval">
                  <option :value="1">1 秒</option>
                  <option :value="2">2 秒</option>
                  <option :value="5">5 秒</option>
                </select>
              </label>
            </div>
            <template v-if="form.privateKeySource === 'local_file'">
              <div class="connection-form-row is-one-long">
                <label class="connection-field is-long">私钥文件路径
                  <span class="connection-key-control">
                    <input v-model.trim="form.privateKeyPath" required />
                    <button type="button" class="secondary" @click="browsePrivateKey">浏览…</button>
                  </span>
                </label>
              </div>
              <div class="connection-form-row is-one-long">
                <label class="connection-field is-long">私钥口令
                  <input
                    v-model="auth.passphrase"
                    class="connection-passphrase-input"
                    data-testid="passphrase"
                    type="password"
                    autocomplete="new-password"
                    :placeholder="visibleCredentialSaved ? '留空则保持当前已保存口令不变' : '未加密私钥可留空'"
                  />
                </label>
              </div>
              <label class="checkbox connection-auth-checkbox">
                <input v-model="auth.rememberSecret" data-testid="remember-secret" type="checkbox" />
                记住私钥口令到系统凭据库
              </label>
            </template>
            <template v-else>
              <div class="connection-form-row is-one-long">
                <label class="connection-field is-long">密钥库条目
                  <span class="connection-key-control">
                    <select v-model.number="form.keyVaultId" class="connection-key-vault-select" data-testid="key-vault-select" :disabled="!keyVaultEntries.length" required>
                      <option v-if="!keyVaultEntries.length" :value="null">暂无可用密钥</option>
                      <option v-else :value="null">未选择</option>
                      <option v-for="entry in keyVaultEntries" :key="entry.id" :value="entry.id">
                        {{ keyVaultOptionLabel(entry) }}
                      </option>
                    </select>
                    <button type="button" class="secondary" data-testid="connection-add-key" @click="openKeyImport">添加密钥</button>
                  </span>
                </label>
              </div>
              <div v-if="selectedKeyVaultEntry" class="key-vault-summary connection-form-wide" data-testid="selected-key-vault-summary">
                <strong>{{ selectedKeyVaultTitle(selectedKeyVaultEntry) }}</strong>
                <small :title="selectedKeyVaultEntry.publicKeyFingerprintSHA256">{{ selectedKeyVaultEntry.publicKeyFingerprintSHA256 }}</small>
              </div>
              <div v-else-if="missingSelectedKeyVault" class="key-vault-empty-inline connection-form-wide" data-testid="connection-key-vault-missing">
                <span>所选密钥已被删除，请重新选择或添加密钥。</span>
                <button type="button" class="secondary" @click="openKeyImport">添加密钥</button>
              </div>
              <div v-else class="key-vault-empty-inline connection-form-wide" data-testid="connection-key-vault-empty">
                <span>密钥库中还没有私钥。</span>
                <button type="button" class="secondary" @click="openKeyImport">添加密钥</button>
              </div>
              <p v-if="keyVaultError" class="form-error connection-form-wide">{{ keyVaultError }}</p>
            </template>
          </template>
          <div class="connection-form-row is-one-long">
            <label class="connection-field is-long">连接路径
              <select v-model="routeValue" class="connection-route-select" data-testid="connection-route-select">
                <option value="direct">直接连接</option>
                <option v-if="jumpMissingMessage" value="jump:" disabled>需要重新选择跳板机</option>
                <option v-for="candidate in jumpCandidates" :key="candidate.id" :value="`jump:${candidate.id}`">
                  通过：{{ candidate.name }}
                </option>
              </select>
            </label>
          </div>
          <p v-if="jumpMissingMessage" class="form-error connection-form-wide" data-testid="jump-server-missing">{{ jumpMissingMessage }}</p>
          <p v-if="routeError" class="form-error connection-form-wide">{{ routeError }}</p>
          <div class="connection-form-row is-one-long">
            <label class="connection-field is-long">终端配置
              <select v-model="form.terminalProfileId" class="connection-profile-select" data-testid="terminal-profile-select">
                <option :value="null">继承全局默认</option>
                <option
                  v-for="profile in terminalProfiles ?? []"
                  :key="profile.id"
                  :value="profile.id"
                >
                  {{ profile.name }}{{ profile.id === settings.defaultTerminalProfileId ? '（全局默认）' : '' }}
                </option>
              </select>
            </label>
          </div>
        </div>
        <p v-if="browseError" class="form-error">{{ browseError }}</p>
        <div v-if="form.id" class="credential-status">
          <span>凭据状态：<strong>{{ credentialStatusSaved ? '已保存' : '未保存' }}</strong></span>
          <button
            v-if="visibleCredentialSaved"
            type="button"
            class="danger-link"
            @click="emit('deleteCredential', form.id)"
          >删除已保存{{ form.authType === 'password' ? '密码' : '口令' }}</button>
        </div>
        <p class="form-note">密码和私钥口令不会写入 SQLite。Key Vault 私钥会经 Windows 用户级保护后存入本地数据库。</p>
        <footer class="connection-dialog-footer">
          <button type="button" class="secondary" @click="close">取消</button>
          <button type="submit" class="secondary">保存</button>
          <button type="button" class="primary" data-testid="save-connect" @click="submit(true)">保存并连接</button>
        </footer>
      </div>
    </form>
  </div>

  <div v-if="keyImportOpen" class="modal-backdrop key-import-backdrop" @click.self="closeKeyImport" @keydown.esc.prevent="closeKeyImport">
    <form class="modal key-vault-modal connection-key-import-modal" data-testid="connection-key-import-modal" @submit.prevent="saveImportedKey">
      <header>
        <h2>添加密钥</h2>
        <button type="button" class="dialog-close-button" @click="closeKeyImport">关闭</button>
      </header>
      <div class="form-grid">
        <label class="span-2">名称<input v-model.trim="keyImportForm.name" /></label>
        <label class="span-2">私钥文件
          <span class="file-input">
            <input v-model.trim="keyImportForm.privateKeyPath" readonly required @input="keyImportValidation = null" />
            <button type="button" class="secondary" @click="browseImportKey">浏览…</button>
          </span>
        </label>
        <label class="span-2">私钥口令
          <input
            v-model="keyImportForm.passphrase"
            type="password"
            autocomplete="new-password"
            placeholder="未加密私钥可留空"
            @input="keyImportValidation = null"
          />
        </label>
        <label class="checkbox span-2">
          <input v-model="keyImportForm.rememberPassphrase" type="checkbox" />
          保存口令到系统凭据库
        </label>
        <label class="span-2">备注<textarea v-model.trim="keyImportForm.notes" class="app-textarea key-import-remark" placeholder="可选" rows="3" /></label>
      </div>
      <div class="validation-panel">
        <button type="button" class="secondary" @click="validateImportKey">验证密钥</button>
        <span v-if="keyImportValidation?.valid" class="success-text">
          {{ keyImportValidation.algorithm }}{{ keyImportValidation.keyBits ? ` ${keyImportValidation.keyBits}` : '' }} · {{ keyImportValidation.fingerprintSHA256 }}
        </span>
        <span v-else-if="keyImportValidation" class="form-error">{{ keyImportValidation.userMessage }}</span>
      </div>
      <p v-if="keyImportError" class="form-error">{{ keyImportError }}</p>
      <p class="form-note">导入后不再依赖原始本地文件；前端只传文件路径，私钥正文由后端读取并加密保存。</p>
      <footer>
        <button type="button" class="secondary" @click="closeKeyImport">取消</button>
        <button type="submit" class="primary" :disabled="keyImportBusy">导入并选择</button>
      </footer>
    </form>
  </div>
</template>
