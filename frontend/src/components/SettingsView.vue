<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type {
  AppSettings, HostKeyPolicy, KeyVaultEntry, PrivateKeyValidationResult,
  Connection, DeleteKeyVaultEntryResponse, SaveKeyVaultEntryRequest, SaveTerminalProfileRequest, TerminalCursorStyle, TerminalProfile,
  TerminalThemeName, ThemeMode, UIFontSize, ShortcutConflictEntry, NativeNotificationStatus,
} from '../types'
import { api } from '../api/backend'
import SettingsBackupRestoreSection from './settings/SettingsBackupRestoreSection.vue'
import AlertNotificationSettingsSection from './settings/AlertNotificationSettingsSection.vue'
import SettingsAppLogEntry from './settings/SettingsAppLogEntry.vue'
import AppIcon from './icons/AppIcon.vue'
import SshCommandCompletionSettings from './SshCommandCompletionSettings.vue'
import { choiceDialog, confirmDialog } from '../composables/useAppDialog'
import { useSettingsBackupRestoreFlow } from '../composables/useSettingsBackupRestoreFlow'
import { useLocalTerminalSettingsCapabilities } from '../composables/useLocalTerminalSettingsCapabilities'
import { defaultTerminalProfile, useTerminalProfileStore } from '../stores/terminalProfiles'
import {
  sanitizeTerminalFontFamily,
  terminalFontFamilyForPreset,
  terminalFontPresetForFamily,
  terminalFontPresets,
  terminalProfilePreviewStyle,
  terminalThemePresets,
  validateTerminalFontFamily,
} from '../utils/terminalProfile'
import { cloneAlertSettings, normalizeAlertSettings } from '../utils/alertSettings'
import { uiFontPixels, uiFontSizeSteps } from '../utils/appearance'
import type { ThemePreviewMode } from '../utils/theme'
import {
  findShortcutConflicts,
  normalizeShortcutSettings,
  shortcutBindingOptionsForPlatform,
  shortcutLabel,
} from '../utils/shortcutSettings'
import { keyboardShortcutRowsForPlatform } from '../utils/settingsShortcutRows'
import { cloneBackupImportOptions } from '../composables/settingsBackupRestoreModel'

const props = withDefaults(defineProps<{
  settings: AppSettings
  overlay?: boolean
  saving?: boolean
  connections?: Connection[]
  nativeNotificationStatus?: NativeNotificationStatus
}>(), {
  nativeNotificationStatus: () => ({
    initialized: false,
    available: false,
    message: '默认关闭，开启后会检查系统通知可用性。',
  }),
})
const emit = defineEmits<{
  save: [settings: AppSettings]
  saveAndClose: [settings: AppSettings]
  closeRequest: []
  previewTheme: [theme: ThemePreviewMode]
  previewFontSize: [size: UIFontSize]
  backupImported: []
  keyVaultDeleted: []
  terminalProfileDeleted: []
  testAlert: []
  testNativeNotification: []
  openLogs: []
  notify: [message: string, type: 'success' | 'error' | 'info', detail?: string, code?: string]
}>()
const form = reactive<AppSettings>({
  ...props.settings,
  terminalCopyOnSelectEnabled: props.settings.terminalCopyOnSelectEnabled ?? true,
  terminalRightClickPasteEnabled: props.settings.terminalRightClickPasteEnabled ?? true,
  shortcutSettings: normalizeShortcutSettings(
    props.settings.shortcutSettings,
    props.settings.terminalCopyOnSelectEnabled ?? true,
    props.settings.terminalRightClickPasteEnabled ?? true,
  ),
  localTerminalShellPreference: props.settings.localTerminalShellPreference || 'auto',
  localTerminalElevatedEnabled: Boolean(props.settings.localTerminalElevatedEnabled),
  defaultTerminalProfileId: props.settings.defaultTerminalProfileId || 'default',
  commandHistoryMaxEntries: props.settings.commandHistoryMaxEntries || 2000,
  sshKeepaliveEnabled: props.settings.sshKeepaliveEnabled ?? true,
  sshKeepaliveIntervalSeconds: props.settings.sshKeepaliveIntervalSeconds || 30,
  sshKeepaliveTimeoutSeconds: props.settings.sshKeepaliveTimeoutSeconds || 10,
  sshKeepaliveMaxFailures: props.settings.sshKeepaliveMaxFailures || 3,
  alerts: cloneAlertSettings(props.settings.alerts),
  backupImportOptions: cloneBackupImportOptions(props.settings.backupImportOptions),
})
const terminalProfileStore = useTerminalProfileStore()
const keyVaultEntries = ref<KeyVaultEntry[]>([])
const keyVaultSearch = ref('')
const keyVaultError = ref('')
const keyVaultBusy = ref(false)
const keyVaultModalOpen = ref(false)
const editingKey = ref<KeyVaultEntry | null>(null)
const keyValidation = ref<PrivateKeyValidationResult | null>(null)
const keyForm = reactive<SaveKeyVaultEntryRequest>({
  id: 0,
  name: '',
  privateKeyPath: '',
  passphrase: '',
  rememberPassphrase: true,
  updatePassphrase: false,
  deletePassphrase: false,
  notes: '',
})
const backupFlow = useSettingsBackupRestoreFlow({
  initialImportOptions: props.settings.backupImportOptions,
  selectExportPath: () => api.selectBackupExportPath(),
  exportBackup: (request) => api.exportBackup(request),
  selectImportFile: () => api.selectBackupImportFile(),
  importBackup: (request) => api.importBackup(request),
  confirmFullExport: () => confirmDialog({
    title: '确认完整备份',
    message: '完整备份会包含已保存的 SSH 密码、私钥口令和密钥库口令，并写入加密备份文件。请确认你会妥善保存备份密码和备份文件。',
    confirmText: '创建完整备份',
    danger: true,
  }),
  confirmImport: () => confirmDialog({
    title: '导入备份',
    message: '导入会新增缺失配置；相同主机、端口和用户名的服务器会更新非敏感配置，但不会导入或覆盖任何已保存凭据。继续？',
    confirmText: '导入',
  }),
  notify: (message, type) => emit('notify', message, type),
  loadKeyVaultEntries: () => loadKeyVaultEntries(),
  afterBackupImported: () => emit('backupImported'),
  errorMessage,
})
const selectedTerminalProfileId = ref('default')
const terminalProfileBusy = ref(false)
const terminalProfileError = ref('')
const terminalFontPreset = ref('system')
const terminalProfileForm = reactive<SaveTerminalProfileRequest>({
  id: defaultTerminalProfile.id,
  name: defaultTerminalProfile.name,
  fontFamily: defaultTerminalProfile.fontFamily,
  fontSize: defaultTerminalProfile.fontSize,
  lineHeight: defaultTerminalProfile.lineHeight,
  letterSpacing: defaultTerminalProfile.letterSpacing,
  cursorStyle: defaultTerminalProfile.cursorStyle,
  cursorBlink: defaultTerminalProfile.cursorBlink,
  scrollback: defaultTerminalProfile.scrollback,
  themeName: defaultTerminalProfile.themeName,
  foreground: defaultTerminalProfile.foreground,
  background: defaultTerminalProfile.background,
  selectionBackground: defaultTerminalProfile.selectionBackground,
  cursorColor: defaultTerminalProfile.cursorColor,
})
const terminalThemeOptions: Array<{ value: TerminalThemeName; label: string }> = [
  { value: 'serverpilot-dark', label: 'ServerPilot Dark' },
  { value: 'classic-dark', label: 'Classic Dark' },
  { value: 'light', label: 'Light' },
  { value: 'custom', label: 'Custom' },
]
const terminalCursorOptions: Array<{ value: TerminalCursorStyle; label: string }> = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
]
const terminalFontOptions = terminalFontPresets
const activeCategory = ref('appearance')
const previewThemeSelection = ref<ThemePreviewMode>(props.settings.themeMode)
const categories = [
  { id: 'appearance', label: '常规', icon: 'gear' },
  { id: 'terminal', label: '终端', icon: 'terminal' },
  { id: 'alerts', label: '告警', icon: 'bell' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'keyvault', label: '密钥库', icon: 'key' },
  { id: 'backup', label: '备份/恢复', icon: 'backup' },
]
const availableCategoryIds = new Set(categories.map((category) => category.id))
const forceFormDirty = ref(false)
const appVersion = ref('')
const { capabilities: localTerminalCapabilities, showLocalTerminalAdminSetting, loadLocalTerminalCapabilities } = useLocalTerminalSettingsCapabilities(() => { form.localTerminalElevatedEnabled = false })
const platform = computed(() => localTerminalCapabilities.value?.platform ?? 'windows')
const formDirty = computed(() => forceFormDirty.value ||
  JSON.stringify(normalizeSettings(settingsDraft())) !== JSON.stringify(normalizeSettings(props.settings)))
const appVersionLabel = computed(() => appVersion.value ? `ServerPilot v${appVersion.value}` : 'ServerPilot')
const shortcutConflicts = computed(() => findShortcutConflicts(form.shortcutSettings))
const externalShortcutConflicts = ref<ShortcutConflictEntry[]>([])
let shortcutConflictCheckTimer: number | null = null
let shortcutConflictCheckSerial = 0
const shortcutBindingOptions = computed(() => shortcutBindingOptionsForPlatform(platform.value))
const keyboardShortcutRows = computed(() => keyboardShortcutRowsForPlatform(platform.value))

watch(() => props.settings, (value) => {
  forceFormDirty.value = false
  applySettingsToForm(value)
}, { deep: true })

watch(() => form.shortcutSettings, () => {
  if (activeCategory.value === 'shortcuts') scheduleShortcutConflictCheck()
}, { deep: true })

watch(platform, (value) => {
  form.shortcutSettings = normalizeShortcutSettings(
    form.shortcutSettings,
    form.terminalCopyOnSelectEnabled ?? true,
    form.terminalRightClickPasteEnabled ?? true,
    value,
  )
  if (value === 'darwin') { externalShortcutConflicts.value = []; form.alerts.nativeNotifications.enabled = false }
  if (activeCategory.value === 'shortcuts') scheduleShortcutConflictCheck()
})

watch(activeCategory, (category) => {
  if (category === 'shortcuts') scheduleShortcutConflictCheck()
  if (!availableCategoryIds.has(category)) activeCategory.value = fallbackCategory(category)
})

function fallbackCategory(category: string) { return category === 'advanced' ? 'terminal' : 'appearance' }

function applySettingsToForm(value: AppSettings) {
  Object.assign(form, {
    ...value,
    terminalCopyOnSelectEnabled: value.terminalCopyOnSelectEnabled ?? true,
    terminalRightClickPasteEnabled: value.terminalRightClickPasteEnabled ?? true,
    shortcutSettings: normalizeShortcutSettings(
      value.shortcutSettings,
      value.terminalCopyOnSelectEnabled ?? true,
      value.terminalRightClickPasteEnabled ?? true,
      platform.value,
    ),
    localTerminalShellPreference: value.localTerminalShellPreference || 'auto',
    localTerminalElevatedEnabled: Boolean(value.localTerminalElevatedEnabled),
    defaultTerminalProfileId: value.defaultTerminalProfileId || 'default',
    commandHistoryMaxEntries: value.commandHistoryMaxEntries || 2000,
    sshKeepaliveEnabled: value.sshKeepaliveEnabled ?? true,
    sshKeepaliveIntervalSeconds: value.sshKeepaliveIntervalSeconds || 30,
    sshKeepaliveTimeoutSeconds: value.sshKeepaliveTimeoutSeconds || 10,
    sshKeepaliveMaxFailures: value.sshKeepaliveMaxFailures || 3,
    alerts: cloneAlertSettings(value.alerts),
    backupImportOptions: cloneBackupImportOptions(value.backupImportOptions),
  })
  previewThemeSelection.value = value.themeMode
  backupFlow.applyImportOptions(value.backupImportOptions)
}

const terminalProfiles = computed(() => {
  const profiles = [...terminalProfileStore.profiles]
  const defaultIndex = profiles.findIndex((profile) => profile.id === defaultTerminalProfile.id)
  if (defaultIndex <= 0) return profiles
  const [defaultProfile] = profiles.splice(defaultIndex, 1)
  return [defaultProfile, ...profiles]
})
const selectedTerminalProfile = computed(() =>
  terminalProfiles.value.find((profile) => profile.id === selectedTerminalProfileId.value) ?? null)
const normalizedTerminalProfileForm = computed<SaveTerminalProfileRequest>(() => ({
  ...terminalProfileForm,
  fontFamily: sanitizeTerminalFontFamily(terminalProfileForm.fontFamily),
}))
const terminalProfileDirty = computed(() => {
  const current = selectedTerminalProfile.value
  if (!current) return true
  return JSON.stringify(terminalProfileStore.profileToRequest(current)) !== JSON.stringify(normalizedTerminalProfileForm.value)
})
const terminalProfilePreview = computed(() =>
  terminalProfilePreviewStyle({
    ...normalizedTerminalProfileForm.value,
    createdAt: selectedTerminalProfile.value?.createdAt ?? '',
    updatedAt: selectedTerminalProfile.value?.updatedAt ?? '',
  } as TerminalProfile))
const terminalProfileUsageCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const connection of props.connections ?? []) {
    const profileId = connection.terminalProfileId?.trim()
    if (!profileId) continue
    counts.set(profileId, (counts.get(profileId) ?? 0) + 1)
  }
  return counts
})
const policies: Array<{ value: HostKeyPolicy; title: string; detail: string }> = [
  {
    value: 'auto_update',
    title: '自动信任并更新',
    detail: '默认策略。未知主机和指纹变化不会阻塞连接，SSH 认证成功后保存或更新 SHA-256 指纹；此模式会降低对中间人攻击的检测能力。',
  },
  {
    value: 'strict',
    title: '严格验证',
    detail: '未知主机或指纹变化会暂停连接，用户确认信任并更新后再继续。',
  },
]
const themes: Array<{ value: ThemeMode; title: string; detail: string }> = [{ value: 'dark', title: '深色', detail: '灰黑深色界面，适合 macOS 和低亮度环境。' }, { value: 'light', title: '浅色', detail: '使用基础浅色界面。' }, { value: 'system', title: '跟随系统', detail: '随系统外观自动切换。' }]
const currentUIFontSizeIndex = computed(() => uiFontSizeSteps.includes(form.uiFontSize) ? uiFontSizeSteps.indexOf(form.uiFontSize) : uiFontSizeSteps.indexOf('large'))
const uiFontMinPixels = 12, uiFontMaxPixels = 18; function uiFontSliderPercent(pixels: number) { return (pixels - uiFontMinPixels) / (uiFontMaxPixels - uiFontMinPixels) * 100 }
const currentUIFontSizePixels = computed(() => uiFontPixels(uiFontSizeSteps[currentUIFontSizeIndex.value])); const uiFontSizeByPixels = new Map(uiFontSizeSteps.map((size) => [uiFontPixels(size), size]))
const currentUIFontPercent = computed(() => uiFontSliderPercent(currentUIFontSizePixels.value)); const uiFontTickItems = computed(() => uiFontSizeSteps.map((size, index) => ({ size, label: uiFontTickLabels[index], percent: uiFontSliderPercent(uiFontPixels(size)) })))
const uiFontTickLabels = ['小', '13', '正常', '15', '较大', '大', '最大']

function selectTheme(theme: { value: ThemeMode }) { previewThemeSelection.value = theme.value; form.themeMode = theme.value; emit('previewTheme', theme.value) }
function updateUIFontSizeFromSlider(event: Event) { const pixels = Math.min(18, Math.max(12, Number((event.target as HTMLInputElement).value) || 15)); const size = uiFontSizeByPixels.get(pixels) ?? 'large'; form.uiFontSize = size; emit('previewFontSize', size) }

async function submit() {
  if (!validateSettingsForm()) return
  await runShortcutConflictCheck()
  emit('save', settingsPayload())
}

async function submitAndClose() {
  if (!validateSettingsForm()) return
  await runShortcutConflictCheck()
  emit('saveAndClose', settingsPayload())
}

async function resetSettingsDefaults() {
  const confirmed = await confirmDialog({
    title: '恢复默认设置',
    message: '这会把设置页面中的所有选项恢复为应用默认值。\n服务器、密钥、凭据、历史记录和其他业务数据不会被删除。\n恢复后需要点击保存才会生效。',
    confirmText: '恢复默认设置',
    cancelText: '取消',
  })
  if (!confirmed) return
  try {
    const defaults = await api.defaultSettings()
    applySettingsToForm(defaults)
    forceFormDirty.value = true
    activeCategory.value = 'appearance'
    emit('notify', '已恢复默认值，保存后生效。', 'info')
  } catch (reason) {
    emit('notify', errorMessage(reason, '恢复默认设置失败'), 'error')
  }
}

function enabledShortcutBindings() {
  return Array.from(new Set([
    form.shortcutSettings.terminalCopy,
    form.shortcutSettings.terminalPaste,
    form.shortcutSettings.terminalCompletion,
    form.shortcutSettings.openCommandHistory,
    form.shortcutSettings.openCommandFavorites,
  ].filter((value) => value && value !== 'disabled')))
}

function scheduleShortcutConflictCheck() {
  if (platform.value === 'darwin') {
    externalShortcutConflicts.value = [{
      shortcut: '',
      status: 'unknown',
      message: 'macOS 快捷键冲突检测暂不可用。ServerPilot 仍可保存这些设置。',
    }]
    return
  }
  if (shortcutConflictCheckTimer !== null) {
    window.clearTimeout(shortcutConflictCheckTimer)
    shortcutConflictCheckTimer = null
  }
  shortcutConflictCheckTimer = window.setTimeout(() => {
    shortcutConflictCheckTimer = null
    void runShortcutConflictCheck()
  }, 0)
}

async function runShortcutConflictCheck() {
  const serial = ++shortcutConflictCheckSerial
  const shortcuts = enabledShortcutBindings()
  if (!shortcuts.length) {
    externalShortcutConflicts.value = []
    return
  }
  try {
    const result = await api.checkShortcutConflicts({ shortcuts })
    if (serial !== shortcutConflictCheckSerial) return
    externalShortcutConflicts.value = result.entries.filter((entry) => entry.status !== 'available')
  } catch {
    if (serial !== shortcutConflictCheckSerial) return
    externalShortcutConflicts.value = [{
      shortcut: shortcuts.join(', '),
      status: 'unknown',
      message: '快捷键外部冲突检测暂不可用。ServerPilot 仍可保存这些设置。',
    }]
  }
}

function settingsPayload(): AppSettings {
  const shortcuts = normalizeShortcutSettings(
    form.shortcutSettings,
    form.terminalCopyOnSelectEnabled ?? true,
    form.terminalRightClickPasteEnabled ?? true,
    platform.value,
  )
  return {
    ...form,
    terminalCopyOnSelectEnabled: shortcuts.terminalCopyOnSelectEnabled,
    terminalRightClickPasteEnabled: shortcuts.terminalRightClickAction === 'paste',
    shortcutSettings: shortcuts,
    alerts: cloneAlertSettings(form.alerts),
    backupImportOptions: cloneBackupImportOptions(backupFlow.importOptions),
  }
}

function settingsDraft(): AppSettings {
  return {
    ...form,
    backupImportOptions: cloneBackupImportOptions(backupFlow.importOptions),
  }
}

async function requestClose() {
  if (!formDirty.value) {
    emit('closeRequest')
    return
  }
  const decision = await choiceDialog({
    title: '关闭设置',
    message: '当前设置有未保存修改。',
    confirmText: '保存并关闭',
    confirmValue: 'save',
    secondaryText: '放弃修改',
    secondaryValue: 'discard',
    cancelText: '取消',
  })
  if (decision === 'save') {
    void submitAndClose()
  } else if (decision === 'discard') {
    forceFormDirty.value = false
    applySettingsToForm(props.settings)
    emit('closeRequest')
  }
}

function normalizeSettings(value: AppSettings) {
  return {
    defaultRememberPassword: value.defaultRememberPassword,
    defaultRememberPassphrase: value.defaultRememberPassphrase,
    terminalCopyOnSelectEnabled: value.terminalCopyOnSelectEnabled ?? true,
    terminalRightClickPasteEnabled: value.terminalRightClickPasteEnabled ?? true,
    shortcutSettings: normalizeShortcutSettings(
      value.shortcutSettings,
      value.terminalCopyOnSelectEnabled ?? true,
      value.terminalRightClickPasteEnabled ?? true,
      platform.value,
    ),
    hostKeyPolicy: value.hostKeyPolicy,
    themeMode: value.themeMode,
    uiFontSize: value.uiFontSize,
    localTerminalShellPreference: value.localTerminalShellPreference || 'auto',
    localTerminalElevatedEnabled: Boolean(value.localTerminalElevatedEnabled),
    defaultTerminalProfileId: value.defaultTerminalProfileId || 'default',
    commandHistoryMaxEntries: clampCommandHistoryMaxEntries(value.commandHistoryMaxEntries),
    sshKeepaliveEnabled: value.sshKeepaliveEnabled ?? true,
    sshKeepaliveIntervalSeconds: clampSSHKeepaliveInterval(value.sshKeepaliveIntervalSeconds),
    sshKeepaliveTimeoutSeconds: clampSSHKeepaliveTimeout(value.sshKeepaliveTimeoutSeconds),
    sshKeepaliveMaxFailures: clampSSHKeepaliveFailures(value.sshKeepaliveMaxFailures),
    alerts: normalizeAlertSettings(value.alerts),
    backupImportOptions: cloneBackupImportOptions(value.backupImportOptions),
    connectionTimeoutSeconds: value.connectionTimeoutSeconds,
  }
}

function validateSettingsForm() {
  if (shortcutConflicts.value.length > 0) {
    emit('notify', `快捷键冲突：${shortcutConflicts.value.join('；')}`, 'error')
    activeCategory.value = 'shortcuts'
    return false
  }
  if (
    !Number.isFinite(form.commandHistoryMaxEntries) ||
    form.commandHistoryMaxEntries < 100 ||
    form.commandHistoryMaxEntries > 20000
  ) {
    emit('notify', '命令历史最大条数必须在 100 到 20000 之间', 'error')
    return false
  }
  form.commandHistoryMaxEntries = Math.trunc(form.commandHistoryMaxEntries)
  if (
    !Number.isFinite(form.sshKeepaliveIntervalSeconds) ||
    form.sshKeepaliveIntervalSeconds < 10 ||
    form.sshKeepaliveIntervalSeconds > 300
  ) {
    emit('notify', 'SSH 保活间隔必须在 10 到 300 秒之间', 'error')
    return false
  }
  if (
    !Number.isFinite(form.sshKeepaliveTimeoutSeconds) ||
    form.sshKeepaliveTimeoutSeconds < 3 ||
    form.sshKeepaliveTimeoutSeconds > 60
  ) {
    emit('notify', 'SSH 保活超时必须在 3 到 60 秒之间', 'error')
    return false
  }
  if (
    !Number.isFinite(form.sshKeepaliveMaxFailures) ||
    form.sshKeepaliveMaxFailures < 1 ||
    form.sshKeepaliveMaxFailures > 10
  ) {
    emit('notify', 'SSH 保活失败次数必须在 1 到 10 之间', 'error')
    return false
  }
  form.sshKeepaliveIntervalSeconds = Math.trunc(form.sshKeepaliveIntervalSeconds)
  form.sshKeepaliveTimeoutSeconds = Math.trunc(form.sshKeepaliveTimeoutSeconds)
  form.sshKeepaliveMaxFailures = Math.trunc(form.sshKeepaliveMaxFailures)
  if (
    !Number.isFinite(form.alerts.historyLimit) ||
    form.alerts.historyLimit < 50 ||
    form.alerts.historyLimit > 5000
  ) {
    emit('notify', '告警历史记录上限必须在 50 到 5000 条之间', 'error')
    return false
  }
  form.alerts.historyLimit = Math.trunc(form.alerts.historyLimit)
  form.alerts = normalizeAlertSettings(form.alerts)
  return true
}

function clampCommandHistoryMaxEntries(value: number) {
  if (!Number.isFinite(value) || value === 0) return 2000
  return Math.min(Math.max(Math.trunc(value), 100), 20000)
}

function clampSSHKeepaliveInterval(value: number) {
  if (!Number.isFinite(value) || value === 0) return 30
  return Math.min(Math.max(Math.trunc(value), 10), 300)
}

function clampSSHKeepaliveTimeout(value: number) {
  if (!Number.isFinite(value) || value === 0) return 10
  return Math.min(Math.max(Math.trunc(value), 3), 60)
}

function clampSSHKeepaliveFailures(value: number) {
  if (!Number.isFinite(value) || value === 0) return 3
  return Math.min(Math.max(Math.trunc(value), 1), 10)
}

const filteredKeyVaultEntries = computed(() => {
  const needle = keyVaultSearch.value.trim().toLowerCase()
  if (!needle) return keyVaultEntries.value
  return keyVaultEntries.value.filter((entry) =>
    [entry.name, entry.sourceFileName ?? '', entry.algorithm, entry.publicKeyFingerprintSHA256, entry.notes]
      .some((value) => value.toLowerCase().includes(needle)),
  )
})

onMounted(() => {
  void loadAppVersion()
  void loadLocalTerminalCapabilities()
  void loadKeyVaultEntries()
  if (!terminalProfileStore.profiles.length) {
    void terminalProfileStore.load(form.defaultTerminalProfileId).then(syncSelectedTerminalProfile)
  } else {
    terminalProfileStore.setDefaultProfileId(form.defaultTerminalProfileId)
    syncSelectedTerminalProfile()
  }
  if (props.overlay) window.addEventListener('keydown', handleOverlayKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleOverlayKeydown)
  if (shortcutConflictCheckTimer !== null) window.clearTimeout(shortcutConflictCheckTimer)
})

function handleOverlayKeydown(event: KeyboardEvent) {
  if (!props.overlay) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void submit()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
  }
}

async function loadAppVersion() {
  try {
    const info = await api.appVersion()
    appVersion.value = info.version
  } catch {
    appVersion.value = ''
  }
}

function profileRequest(profile: TerminalProfile): SaveTerminalProfileRequest {
  return terminalProfileStore.profileToRequest(profile)
}

function loadTerminalProfileForm(profile: TerminalProfile) {
  Object.assign(terminalProfileForm, profileRequest(profile))
  terminalFontPreset.value = terminalFontPresetForFamily(profile.fontFamily)
  selectedTerminalProfileId.value = profile.id
  terminalProfileError.value = ''
}

function syncSelectedTerminalProfile() {
  const current = terminalProfiles.value.find((profile) => profile.id === selectedTerminalProfileId.value)
  const fallback = terminalProfiles.value.find((profile) => profile.id === terminalProfileStore.defaultProfileId)
    ?? terminalProfiles.value[0]
    ?? defaultTerminalProfile
  loadTerminalProfileForm(current ?? fallback)
}

watch(() => [terminalProfileStore.profiles, terminalProfileStore.defaultProfileId] as const, () => {
  if (!terminalProfileForm.id) return
  syncSelectedTerminalProfile()
}, { deep: true })

watch(() => terminalProfileForm.themeName, (themeName) => {
  if (themeName === 'custom') return
  const preset = terminalThemePresets[themeName]
  Object.assign(terminalProfileForm, {
    foreground: preset.foreground,
    background: preset.background,
    selectionBackground: preset.selectionBackground,
    cursorColor: preset.cursorColor,
  })
})

watch(terminalFontPreset, (preset) => {
  if (preset === 'custom') return
  const family = terminalFontFamilyForPreset(preset)
  if (family) terminalProfileForm.fontFamily = family
})

function selectTerminalProfile(profile: TerminalProfile) {
  loadTerminalProfileForm(profile)
}

function terminalProfileUsageCount(profileId: string) {
  return terminalProfileUsageCounts.value.get(profileId) ?? 0
}

function isProtectedTerminalProfile(profileId: string) {
  return profileId === defaultTerminalProfile.id || profileId === terminalProfileStore.defaultProfileId
}

function canDeleteTerminalProfile(profileOrId: TerminalProfile | string | null | undefined) {
  const profileId = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id
  if (!profileId || isProtectedTerminalProfile(profileId)) return false
  return true
}

function terminalProfileDeleteTitle(profileOrId: TerminalProfile | string | null | undefined) {
  const profileId = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id
  if (!profileId) return '请先保存终端配置'
  if (profileId === defaultTerminalProfile.id || profileId === terminalProfileStore.defaultProfileId) {
    return '全局默认终端配置不能删除'
  }
  const usageCount = terminalProfileUsageCount(profileId)
  if (usageCount > 0) return `该终端配置正在被 ${usageCount} 台服务器使用，删除后相关服务器将继承全局默认配置`
  return '删除终端配置'
}

function newTerminalProfile() {
  const base = terminalProfileStore.defaultProfile
  Object.assign(terminalProfileForm, {
    ...profileRequest(base),
    id: '',
    name: `${base.name} 副本`,
  })
  selectedTerminalProfileId.value = ''
  terminalFontPreset.value = terminalFontPresetForFamily(terminalProfileForm.fontFamily)
  terminalProfileError.value = ''
}

function terminalProfileSaveError(reason: unknown) {
  return String(reason).replace(/^Error:\s*/i, '').trim() || '保存终端配置失败'
}

function validateTerminalProfileForm() {
  const fontError = validateTerminalFontFamily(terminalProfileForm.fontFamily)
  if (fontError) return fontError
  return ''
}

async function persistTerminalProfile(showSuccessToast = true) {
  terminalProfileBusy.value = true
  terminalProfileError.value = ''
  try {
    const validationError = validateTerminalProfileForm()
    if (validationError) {
      terminalProfileError.value = validationError
      emit('notify', validationError, 'error')
      return null
    }
    const saved = await terminalProfileStore.save({ ...normalizedTerminalProfileForm.value })
    loadTerminalProfileForm(saved)
    if (showSuccessToast) emit('notify', '终端配置已保存', 'success')
    return saved
  } catch (reason) {
    terminalProfileError.value = terminalProfileSaveError(reason)
    emit('notify', terminalProfileError.value, 'error')
    return null
  } finally {
    terminalProfileBusy.value = false
  }
}

async function saveTerminalProfile() {
  await persistTerminalProfile(true)
}

async function duplicateTerminalProfile() {
  if (!terminalProfileForm.id) return
  terminalProfileBusy.value = true
  terminalProfileError.value = ''
  try {
    const saved = await terminalProfileStore.duplicate(terminalProfileForm.id)
    loadTerminalProfileForm(saved)
    emit('notify', '终端配置已复制', 'success')
  } catch (reason) {
    terminalProfileError.value = terminalProfileSaveError(reason)
    emit('notify', terminalProfileError.value, 'error')
  } finally {
    terminalProfileBusy.value = false
  }
}

async function deleteTerminalProfile(profile?: TerminalProfile) {
  const target = profile ?? selectedTerminalProfile.value
  if (!target?.id || !canDeleteTerminalProfile(target)) return
  const usageCount = terminalProfileUsageCount(target.id)
  const confirmed = await confirmDialog({
    title: '删除终端配置',
    message: usageCount > 0
      ? `有 ${usageCount} 台服务器正在使用终端配置「${target.name}」。\n删除后，这些服务器将改为继承全局默认终端配置。\n是否继续删除？`
      : `确定删除终端配置「${target.name}」吗？`,
    confirmText: usageCount > 0 ? '删除并改为继承默认' : '删除',
    danger: true,
  })
  if (!confirmed) return
  terminalProfileBusy.value = true
  terminalProfileError.value = ''
  try {
    const result = await terminalProfileStore.remove(target.id, usageCount > 0)
    syncSelectedTerminalProfile()
    if (result.detachedServers > 0) {
      emit('terminalProfileDeleted')
      emit('notify', '终端配置已删除，相关服务器已改为继承全局默认配置', 'success')
    } else {
      emit('notify', '终端配置已删除', 'success')
    }
  } catch (reason) {
    terminalProfileError.value = terminalProfileSaveError(reason)
    emit('notify', terminalProfileError.value, 'error')
  } finally {
    terminalProfileBusy.value = false
  }
}

async function setDefaultTerminalProfile() {
  if (!terminalProfileForm.id) {
    terminalProfileError.value = '请先保存终端配置'
    return
  }
  terminalProfileBusy.value = true
  terminalProfileError.value = ''
  try {
    const savedSettings = await terminalProfileStore.setDefault(terminalProfileForm.id)
    form.defaultTerminalProfileId = savedSettings.defaultTerminalProfileId || terminalProfileForm.id
    emit('notify', '默认终端配置已更新', 'success')
  } catch (reason) {
    terminalProfileError.value = terminalProfileSaveError(reason)
    emit('notify', terminalProfileError.value, 'error')
  } finally {
    terminalProfileBusy.value = false
  }
}

async function applyTerminalProfiles() {
  const saved = terminalProfileDirty.value || !terminalProfileForm.id
    ? await persistTerminalProfile(false)
    : ({
        ...normalizedTerminalProfileForm.value,
        createdAt: selectedTerminalProfile.value?.createdAt ?? '',
        updatedAt: selectedTerminalProfile.value?.updatedAt ?? '',
      } as TerminalProfile)
  if (!saved) return
  const count = terminalProfileStore.applyToOpenTerminals(saved)
  if (count > 0) {
    emit('notify', `已应用到 ${count} 个已打开终端`, 'success')
  } else {
    emit('notify', '没有需要应用的已打开终端', 'info')
  }
}

async function loadKeyVaultEntries() {
  keyVaultError.value = ''
  try {
    keyVaultEntries.value = await api.listKeyVaultEntries()
  } catch (reason) {
    keyVaultError.value = String(reason)
  }
}

function openAddKey() {
  editingKey.value = null
  keyValidation.value = null
  Object.assign(keyForm, {
    id: 0, name: '', privateKeyPath: '', passphrase: '', rememberPassphrase: true,
    updatePassphrase: false, deletePassphrase: false, notes: '',
  })
  keyVaultModalOpen.value = true
}

function openEditKey(entry: KeyVaultEntry) {
  editingKey.value = entry
  keyValidation.value = {
    algorithm: entry.algorithm,
    fingerprintSHA256: entry.publicKeyFingerprintSHA256,
    keyBits: entry.keyBits,
    encrypted: entry.encrypted,
    valid: true,
    errorCode: '',
    userMessage: '',
    technicalMessage: '',
  }
  Object.assign(keyForm, {
    id: entry.id,
    name: entry.name,
    privateKeyPath: entry.privateKeyPath,
    passphrase: '',
    rememberPassphrase: true,
    updatePassphrase: false,
    deletePassphrase: false,
    notes: entry.notes,
  })
  keyVaultModalOpen.value = true
}

function closeKeyModal() {
  keyForm.passphrase = ''
  keyForm.updatePassphrase = false
  keyForm.deletePassphrase = false
  keyVaultModalOpen.value = false
}

async function browseKeyFile() {
  keyVaultError.value = ''
  try {
    const selected = await api.selectPrivateKeyFile()
    if (selected) {
      keyForm.privateKeyPath = selected
      if (!keyForm.name) {
        keyForm.name = selected.split(/[\\/]/).pop() || 'SSH Key'
      }
      keyValidation.value = null
    }
  } catch (reason) {
    keyVaultError.value = String(reason)
  }
}

async function validateKeyFile() {
  keyVaultError.value = ''
  keyValidation.value = await api.validatePrivateKeyFile({
    privateKeyPath: keyForm.privateKeyPath,
    passphrase: keyForm.passphrase,
  })
}

async function saveKeyEntry() {
  keyVaultError.value = ''
  const editingEncryptedKey = editingKey.value?.storageMode === 'encrypted_database'
  if (!editingEncryptedKey && !keyValidation.value?.valid) {
    await validateKeyFile()
  }
  if (!editingEncryptedKey && !keyValidation.value?.valid) return
  keyVaultBusy.value = true
  try {
    const saved = keyForm.id
      ? await api.updateKeyVaultEntry({ ...keyForm })
      : await api.createKeyVaultEntry({ ...keyForm })
    await loadKeyVaultEntries()
    openEditKey(saved)
    closeKeyModal()
  } catch (reason) {
    keyVaultError.value = String(reason)
  } finally {
    keyVaultBusy.value = false
    keyForm.passphrase = ''
  }
}

async function deleteKeyEntry(entry: KeyVaultEntry, event?: Event) {
  if (keyVaultBusy.value) return
  keyVaultError.value = ''
  keyVaultBusy.value = true
  try {
    let result: DeleteKeyVaultEntryResponse | null = null
    if ((entry.usageCount ?? 0) <= 0) {
      const ok = await confirmDialog({
        title: '删除密钥',
        message: deleteKeyMessage(entry, null),
        confirmText: '删除',
        danger: true,
        returnFocus: event?.currentTarget as HTMLElement | null,
      })
      if (!ok) return
    }
    result = await api.deleteKeyVaultEntry({ id: entry.id, forceUnbind: false })
    if (result.requiresConfirmation) {
      const ok = await confirmDialog({
        title: '删除密钥',
        message: deleteKeyMessage(entry, result),
        confirmText: '删除密钥并解除绑定',
        danger: true,
        returnFocus: event?.currentTarget as HTMLElement | null,
      })
      if (!ok) return
      result = await api.deleteKeyVaultEntry({ id: entry.id, forceUnbind: true })
    }
    await loadKeyVaultEntries()
    emit('keyVaultDeleted')
    if (result?.secretCleanupWarning) {
      emit('notify', result.secretCleanupWarning, 'error')
    } else if (result?.unboundServerCount) {
      emit('notify', `密钥已删除，并已解除 ${result.unboundServerCount} 台服务器的密钥绑定。`, 'success')
    } else {
      emit('notify', '密钥已删除。', 'success')
    }
  } catch (reason) {
    keyVaultError.value = String(reason)
  } finally {
    keyVaultBusy.value = false
  }
}

function deleteKeyMessage(entry: KeyVaultEntry, result: { unboundServerCount: number; unboundServerNames: string[] } | null) {
  const legacyNote = entry.storageMode === 'legacy_file_path'
    ? '\n\n只删除 ServerPilot 中的密钥记录，不会删除本地原始私钥文件。'
    : ''
  if (!result || result.unboundServerCount <= 0) {
    return `确定删除“${entry.name}”？\n\n私钥密文和保存的私钥口令将被删除。${legacyNote}`
  }
  const names = compactServerNames(result.unboundServerNames, result.unboundServerCount)
  return `该密钥正在被 ${result.unboundServerCount} 台服务器使用：\n\n${names}\n\n删除后：\n- 私钥密文和保存的私钥口令将被删除\n- 上述服务器将自动解除该密钥绑定\n- 已建立的连接不会立即断开\n- 服务器断开后将无法重新连接，直到重新选择密钥${legacyNote}\n\n是否继续？`
}

function compactServerNames(names: string[], count: number) {
  const visible = names.slice(0, 10)
  const suffix = count > visible.length ? `\n以及其他 ${count - visible.length} 台服务器` : ''
  return `${visible.join('、') || `使用中 ${count} 台`}${suffix}`
}

async function migrateLegacyKey(entry: KeyVaultEntry) {
  keyVaultError.value = ''
  keyVaultBusy.value = true
  try {
    await api.migrateLegacyPrivateKey({
      id: entry.id,
      name: entry.name,
      privateKeyPath: entry.privateKeyPath,
      passphrase: '',
      rememberPassphrase: false,
      updatePassphrase: false,
      deletePassphrase: false,
      notes: entry.notes,
    })
    await loadKeyVaultEntries()
    emit('notify', '密钥已导入到本地加密密钥库', 'success')
  } catch (reason) {
    keyVaultError.value = String(reason)
    emit('notify', keyVaultError.value, 'error')
  } finally {
    keyVaultBusy.value = false
  }
}

async function copyFingerprint(entry: KeyVaultEntry) {
  await navigator.clipboard?.writeText(entry.publicKeyFingerprintSHA256)
}

function formatKeyTime(value: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function keyAlgorithmLabel(entry: KeyVaultEntry) {
  return `${entry.algorithm}${entry.keyBits ? ` ${entry.keyBits}` : ''}`
}

function errorMessage(reason: unknown, fallback: string) {
  const message = String(reason).replace(/^Error:\s*/i, '').trim()
  if (message.includes('BACKUP_PASSWORD_INCORRECT')) return '备份密码错误或备份文件已损坏'
  if (message.includes('BACKUP_WEAK_PASSWORD')) return '备份密码至少需要 6 个字符'
  if (message.includes('BACKUP_TAMPERED') || message.includes('BACKUP_FILE_INVALID')) return '备份文件已损坏'
  if (message.includes('BACKUP_IMPORT_ROLLBACK')) return '导入失败（已回滚）'
  if (message.includes('BACKUP_FULL_UNAVAILABLE')) return '完整备份无法读取已保存凭据'
  if (message.includes('BACKUP_SECRET_RESTORE_FAILED')) return '恢复备份凭据失败'
  if (message.includes('BACKUP_DECRYPT_FAILED')) return '备份解密失败'
  if (message.includes('BACKUP_READ_FAILED')) return '读取备份文件失败'
  return message || fallback
}
</script>

<template>
  <section class="settings-page" :class="{ 'settings-page-overlay': overlay, 'app-material-surface': overlay }">
    <header class="settings-page-header">
      <div>
        <h1>设置</h1>
        <p class="settings-app-version" data-testid="settings-app-version">{{ appVersionLabel }}</p>
        <p>这些设置统一作用于测试连接、监控连接和 SSH 终端。</p>
      </div>
      <div class="settings-header-actions" data-testid="settings-action-bar">
        <span v-if="formDirty" class="settings-dirty-indicator">有未保存修改</span>
        <button class="secondary settings-reset-defaults-button" type="button" data-testid="settings-reset-defaults" :disabled="saving" @click="resetSettingsDefaults">恢复默认设置</button>
        <button class="secondary settings-save-button" type="button" :disabled="saving" @click="submit">
          {{ saving ? '保存中...' : '保存' }}
        </button>
        <button v-if="overlay" type="button" class="secondary dialog-close-button settings-close-button" @click="requestClose">关闭</button>
        <button v-if="overlay" class="primary settings-save-close-button" type="button" :disabled="saving" @click="submitAndClose">保存并关闭</button>
      </div>
    </header>

    <div class="settings-category-shell" data-testid="settings-category-shell">
      <nav class="settings-category-nav" aria-label="Settings categories">
        <template v-for="(category, index) in categories" :key="category.id">
          <button
            type="button"
            class="settings-category-nav-button"
            :class="{ active: activeCategory === category.id }"
            @click="activeCategory = category.id"
          ><AppIcon :name="category.icon" :size="20" /><span class="settings-category-nav-label">{{ category.label }}</span></button>
        </template>
      </nav>
      <div class="settings-category-content">

    <article v-show="activeCategory === 'appearance'" class="settings-card">
      <h2>外观</h2>
      <div class="settings-horizontal-options" data-testid="settings-appearance-options">
        <label v-for="theme in themes" :key="theme.value" class="policy-option">
          <input type="radio" :value="theme.value" :checked="previewThemeSelection === theme.value" @change="selectTheme(theme)" />
          <span><strong>{{ theme.title }}</strong><small>{{ theme.detail }}</small></span>
        </label>
      </div>
      <h3 class="settings-subheading">界面字体大小</h3>
      <div class="settings-font-slider" data-testid="ui-font-size-stepper">
        <div class="settings-font-slider-control" data-testid="ui-font-size-slider-control" :style="{ '--font-slider-percent': `${currentUIFontPercent}%` }"><input type="range" min="12" max="18" step="1" :value="currentUIFontSizePixels" data-testid="ui-font-size-slider" aria-label="界面字体大小" @input="updateUIFontSizeFromSlider" /><div class="settings-font-track" data-testid="ui-font-size-track" aria-hidden="true"><div class="settings-font-track-scale" data-testid="ui-font-size-track-scale"><span class="settings-font-track-line" data-testid="ui-font-size-track-line"></span><span class="settings-font-thumb" data-testid="ui-font-size-thumb" :style="{ '--font-slider-percent': `${currentUIFontPercent}%` }"></span><div class="settings-font-ticks" data-testid="ui-font-size-ticks"><span v-for="item in uiFontTickItems" :key="item.size" class="settings-font-tick" :style="{ '--font-slider-percent': `${item.percent}%` }"><span class="settings-font-tick-marker"></span><span class="settings-font-tick-label">{{ item.label }}</span></span></div></div></div></div>
        <span class="settings-font-size-value" data-testid="ui-font-size-value">{{ currentUIFontSizePixels }}px</span>
      </div>
      <p class="settings-note">SSH 终端字体保持独立，不受此设置影响。</p>
    </article>

    <article v-show="activeCategory === 'appearance'" class="settings-card">
      <h2>基础设置</h2>
      <label class="setting-toggle">
        <span><strong>新服务器默认记住密码</strong><small>添加服务器时默认勾选，可在单台服务器中临时修改。</small></span>
        <input v-model="form.defaultRememberPassword" type="checkbox" />
      </label>
      <label class="setting-toggle">
        <span><strong>新服务器默认记住私钥口令</strong><small>只保存到系统凭据库，不写入 SQLite。</small></span>
        <input v-model="form.defaultRememberPassphrase" type="checkbox" />
      </label>
      <h3 class="settings-subheading">命令历史</h3>
      <label class="settings-number-field">
        <span>
          <strong>命令历史最大条数</strong>
          <small>每台服务器最多保留多少条命令历史；默认 2000，范围 100 - 20000。多行命令按一条历史保存，敏感命令不会写入历史。</small>
        </span>
        <input
          v-model.number="form.commandHistoryMaxEntries"
          data-testid="command-history-max-entries"
          type="number"
          min="100"
          max="20000"
          step="100"
        />
      </label>
      <h3 class="settings-subheading">SSH 安全</h3>
      <h4 class="settings-inline-heading">SSH 主机指纹策略</h4>
      <div class="settings-option-stack">
        <label v-for="policy in policies" :key="policy.value" class="policy-option">
          <input v-model="form.hostKeyPolicy" type="radio" :value="policy.value" />
          <span><strong>{{ policy.title }}</strong><small>{{ policy.detail }}</small></span>
        </label>
      </div>
    </article>

    <SettingsAppLogEntry v-show="activeCategory === 'appearance'" @open="emit('openLogs')" />

    <article v-show="activeCategory === 'terminal'" class="settings-card" data-testid="terminal-settings">
      <h2>SSH 终端</h2>
      <label v-if="showLocalTerminalAdminSetting" class="setting-toggle" data-testid="local-terminal-admin-setting">
        <span>
          <strong>以管理员模式打开本地终端</strong>
          <small>开启后，从 + 菜单打开 CMD 或 PowerShell 时，将以管理员模式启动。</small>
        </span>
        <input v-model="form.localTerminalElevatedEnabled" data-testid="local-terminal-admin-toggle" type="checkbox" />
      </label>
      <SshCommandCompletionSettings />
      <h3 class="settings-subheading">连接超时</h3>
      <label class="timeout-setting">
        <span>SSH 建立连接的最长等待时间</span>
        <select v-model.number="form.connectionTimeoutSeconds">
          <option :value="5">5 秒</option>
          <option :value="10">10 秒</option>
          <option :value="15">15 秒</option>
          <option :value="30">30 秒</option>
        </select>
      </label>
      <p>后台监控的指数退避重连策略保持不变。</p>
      <section class="ssh-keepalive-settings" data-testid="ssh-keepalive-settings">
        <h3 class="settings-subheading">SSH 保活</h3>
        <label class="setting-toggle">
          <span>
            <strong>启用 SSH 保活</strong>
            <small>对新建 SSH 连接发送应用层保活请求。</small>
          </span>
          <input v-model="form.sshKeepaliveEnabled" data-testid="ssh-keepalive-enabled" type="checkbox" />
        </label>
        <label class="settings-number-field">
          <span>
            保活间隔（秒）
            <small>范围 10 到 300 秒。</small>
          </span>
          <input
            v-model.number="form.sshKeepaliveIntervalSeconds"
            data-testid="ssh-keepalive-interval"
            type="number"
            min="10"
            max="300"
            step="1"
          />
        </label>
        <label class="settings-number-field">
          <span>
            响应超时（秒）
            <small>范围 3 到 60 秒。</small>
          </span>
          <input
            v-model.number="form.sshKeepaliveTimeoutSeconds"
            data-testid="ssh-keepalive-timeout"
            type="number"
            min="3"
            max="60"
            step="1"
          />
        </label>
        <label class="settings-number-field">
          <span>
            连续失败次数
            <small>范围 1 到 10 次。</small>
          </span>
          <input
            v-model.number="form.sshKeepaliveMaxFailures"
            data-testid="ssh-keepalive-max-failures"
            type="number"
            min="1"
            max="10"
            step="1"
          />
        </label>
        <p class="settings-note">用于减少长时间空闲后连接被 NAT、路由器或防火墙断开的情况。保活失败会关闭对应 SSH 连接，但不会自动断开整个服务器工作区。</p>
      </section>
      <div class="terminal-profile-section" data-testid="terminal-profile-settings">
        <div class="settings-card-header">
          <div>
              <h3 class="terminal-profile-title" data-testid="terminal-profile-title">终端配置 Profile</h3>
            <p class="settings-note">只影响 xterm 外观和前端滚动行为，不会重建 SSH / Local Terminal 会话。</p>
          </div>
        </div>
        <div class="terminal-profile-layout">
          <aside class="terminal-profile-list">
            <div
              v-for="profile in terminalProfiles"
              :key="profile.id"
              class="terminal-profile-item"
              :class="{ active: selectedTerminalProfileId === profile.id }"
              role="button"
              tabindex="0"
              :data-testid="`terminal-profile-row-${profile.id}`"
              @click="selectTerminalProfile(profile)"
              @keydown.enter.prevent="selectTerminalProfile(profile)"
              @keydown.space.prevent="selectTerminalProfile(profile)"
            >
              <span class="terminal-profile-item-main">
                <strong :title="profile.name">{{ profile.name }}</strong>
                <small v-if="profile.id === terminalProfileStore.defaultProfileId">全局默认</small>
                <small v-else-if="terminalProfileUsageCount(profile.id) > 0">被 {{ terminalProfileUsageCount(profile.id) }} 台服务器使用</small>
              </span>
              <button
                type="button"
                class="danger-link terminal-profile-row-delete profile-action-button"
                data-testid="terminal-profile-row-delete"
                :data-profile-id="profile.id"
                :disabled="terminalProfileBusy || !canDeleteTerminalProfile(profile)"
                :title="terminalProfileDeleteTitle(profile)"
                @click.stop="deleteTerminalProfile(profile)"
                @keydown.stop
              >删除</button>
            </div>
            <div class="terminal-profile-create-item" data-testid="terminal-profile-create-item">
              <button type="button" class="secondary profile-action-button" data-testid="terminal-profile-new" @click="newTerminalProfile">新建</button>
            </div>
          </aside>
          <div class="terminal-profile-editor">
            <div class="terminal-profile-grid">
              <label>名称
                <input v-model.trim="terminalProfileForm.name" data-testid="terminal-profile-name" maxlength="60" />
              </label>
              <label>字体
                <select v-model="terminalFontPreset" data-testid="terminal-profile-font-preset">
                  <option v-for="font in terminalFontOptions" :key="font.value" :value="font.value">
                    {{ font.label }}
                  </option>
                </select>
              </label>
              <label v-if="terminalFontPreset === 'custom'">自定义字体
                <input v-model.trim="terminalProfileForm.fontFamily" data-testid="terminal-profile-font" maxlength="120" />
              </label>
              <label>字号
                <input v-model.number="terminalProfileForm.fontSize" data-testid="terminal-profile-font-size" type="number" min="10" max="28" />
              </label>
              <label>行高
                <input v-model.number="terminalProfileForm.lineHeight" data-testid="terminal-profile-line-height" type="number" min="1" max="2" step="0.05" />
              </label>
              <label>字间距
                <input v-model.number="terminalProfileForm.letterSpacing" type="number" min="-1" max="4" step="0.1" />
              </label>
              <label>滚动缓冲
                <input v-model.number="terminalProfileForm.scrollback" type="number" min="1000" max="50000" step="500" />
              </label>
              <label>光标样式
                <select v-model="terminalProfileForm.cursorStyle">
                  <option v-for="option in terminalCursorOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>配色方案
                <select v-model="terminalProfileForm.themeName" data-testid="terminal-profile-theme">
                  <option v-for="option in terminalThemeOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="checkbox">
                <input v-model="terminalProfileForm.cursorBlink" type="checkbox" />
                光标闪烁
              </label>
            </div>
            <div v-if="terminalProfileForm.themeName === 'custom'" class="terminal-profile-colors" data-testid="terminal-profile-colors">
              <label>前景色<input v-model.trim="terminalProfileForm.foreground" /></label>
              <label>背景色<input v-model.trim="terminalProfileForm.background" /></label>
              <label>选区色<input v-model.trim="terminalProfileForm.selectionBackground" data-testid="terminal-profile-selection-color" /></label>
              <label>光标色<input v-model.trim="terminalProfileForm.cursorColor" /></label>
            </div>
            <div class="terminal-profile-preview" data-testid="terminal-profile-preview" :style="terminalProfilePreview">
              <span>serverpilot@demo:~$ docker ps</span>
              <span>CONTAINER ID   IMAGE     STATUS</span>
              <span>7f3a9d2c1b44   nginx     Up 3 minutes</span>
              <span>中文宽字符 / vim / top / Ctrl+C 行为不由 Profile 接管</span>
            </div>
            <p v-if="terminalProfileError" class="form-error" data-testid="terminal-profile-error">{{ terminalProfileError }}</p>
            <div class="terminal-profile-actions">
              <button type="button" class="secondary" data-testid="terminal-profile-duplicate" :disabled="terminalProfileBusy || !terminalProfileForm.id" @click="duplicateTerminalProfile">复制</button>
              <button type="button" class="secondary" data-testid="terminal-profile-default" :disabled="terminalProfileBusy || !terminalProfileForm.id" @click="setDefaultTerminalProfile">设为全局默认</button>
              <button type="button" class="secondary" data-testid="terminal-profile-apply" @click="applyTerminalProfiles">应用到已打开终端</button>
              <button type="button" class="primary" data-testid="terminal-profile-save" :disabled="terminalProfileBusy" @click="saveTerminalProfile">保存 Profile</button>
            </div>
          </div>
        </div>
      </div>
    </article>

    <article v-show="activeCategory === 'shortcuts'" class="settings-card" data-testid="shortcut-settings">
      <h2>快捷键</h2>
      <p class="settings-note">这些快捷键只在 ServerPilot 窗口聚焦时生效，不会注册系统全局热键。</p>

      <h3 class="settings-subheading">终端鼠标行为</h3>
      <label class="setting-toggle" data-testid="shortcut-copy-on-select">
        <span>
          <strong>终端选中即复制</strong>
          <small>在 SSH 和本地终端中选中文本后自动复制到系统剪贴板；不记录选区内容。</small>
        </span>
        <input v-model="form.shortcutSettings.terminalCopyOnSelectEnabled" type="checkbox" />
      </label>
      <div class="shortcut-grid">
        <label class="shortcut-row">
          <span>
            <strong>右键行为</strong>
            <small>选择右键直接粘贴，或显示终端菜单。</small>
          </span>
          <select v-model="form.shortcutSettings.terminalRightClickAction" data-testid="terminal-right-click-action">
            <option value="paste">粘贴剪贴板</option>
            <option value="menu">显示终端菜单</option>
          </select>
        </label>
        <label class="shortcut-row">
          <span>
            <strong>终端菜单备用触发</strong>
            <small>当右键被粘贴占用时，用这个方式打开菜单。</small>
          </span>
          <select v-model="form.shortcutSettings.terminalContextMenuTrigger" data-testid="terminal-context-menu-trigger">
            <option value="shift_right_click">Shift+右键</option>
            <option value="ctrl_right_click">Ctrl+右键</option>
            <option value="disabled">禁用菜单入口</option>
          </select>
        </label>
      </div>
      <p
        v-if="form.shortcutSettings.terminalRightClickAction === 'paste' && form.shortcutSettings.terminalContextMenuTrigger !== 'disabled'"
        class="settings-warning"
        data-testid="right-click-paste-warning"
      >
        右键粘贴会占用终端右键菜单。请使用
        {{ form.shortcutSettings.terminalContextMenuTrigger === 'ctrl_right_click' ? 'Ctrl+右键' : 'Shift+右键' }}
        打开菜单，或将右键行为改为显示终端菜单。
      </p>
      <p
        v-if="form.shortcutSettings.terminalRightClickAction === 'paste' && form.shortcutSettings.terminalContextMenuTrigger === 'disabled'"
        class="settings-warning danger"
        data-testid="right-click-menu-disabled-warning"
      >
        当前设置会禁用终端右键菜单入口；右键将只用于粘贴。
      </p>

      <h3 class="settings-subheading">键盘快捷键</h3>
      <div class="shortcut-grid">
        <label
          v-for="row in keyboardShortcutRows"
          :key="row.key"
          class="shortcut-row"
          :data-testid="`shortcut-row-${row.key}`"
        >
          <span>
            <strong>{{ row.label }}</strong>
            <small>{{ row.detail }}</small>
          </span>
          <select v-model="form.shortcutSettings[row.key]">
            <option v-for="option in shortcutBindingOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
      <p v-if="shortcutConflicts.length" class="settings-warning danger" data-testid="shortcut-conflict-warning">
        快捷键冲突：{{ shortcutConflicts.join('；') }}
      </p>
      <div
        v-if="externalShortcutConflicts.length"
        class="settings-warning"
        data-testid="external-shortcut-conflict-warning"
      >
        <strong>外部快捷键可能冲突</strong>
        <p v-for="entry in externalShortcutConflicts" :key="`${entry.shortcut}-${entry.status}`">
          {{ entry.message }}
        </p>
        <small v-if="platform === 'darwin'">macOS 全局快捷键冲突检测暂不可用，不能保证发现所有应用内快捷键。</small>
        <small v-else>此检测为 best-effort，只能尽量发现 Windows 或其他应用注册的全局快捷键，不能保证发现所有应用内快捷键。</small>
      </div>
      <p class="settings-note">
        当前补全快捷键：{{ shortcutLabel(form.shortcutSettings.terminalCompletion) }}。Tab 仍保留给终端程序本身，避免破坏 shell、vim、tmux 等交互。
      </p>
    </article>

    <article v-show="activeCategory === 'alerts'" class="settings-card alert-settings-card" data-testid="settings-alerts-category">
      <div class="alert-settings-header">
        <div class="alert-settings-header-copy">
          <h2>告警</h2>
          <p>告警仅在 ServerPilot 运行且服务器正在提供监控数据时生效。</p>
        </div>
        <button type="button" class="secondary alert-test-button" data-testid="alert-test-button" @click="emit('testAlert')">发送测试告警</button>
      </div>

      <AlertNotificationSettingsSection
        :alerts="form.alerts"
        :native-notification-status="props.nativeNotificationStatus"
        :platform="platform"
        @update-alerts-enabled="form.alerts.enabled = $event"
        @update-notify-recovery="form.alerts.notifyRecovery = $event"
        @update-native-notifications-enabled="form.alerts.nativeNotifications.enabled = $event"
        @test-native-notification="emit('testNativeNotification')"
      />

      <label class="alert-history-limit-option">
        <span>
          <strong>历史记录上限</strong>
          <small>最多保留最新已恢复或被中断的告警历史，当前活动告警不会被裁剪。</small>
        </span>
        <span class="alert-history-limit-control">
          <input
            v-model.number="form.alerts.historyLimit"
            data-testid="alert-history-limit"
            type="number"
            min="50"
            max="5000"
            step="50"
          />
          <em>条</em>
        </span>
      </label>

      <div class="alert-rule-table" data-testid="alert-rule-table">
        <div class="alert-rule-table-header" data-testid="alert-rule-table-header">
          <span>规则</span>
          <span>启用</span>
          <span>阈值</span>
          <span>持续</span>
        </div>
        <div class="alert-rule-row" data-testid="alert-rule-row-offline">
          <div class="alert-rule-info">
            <strong>服务器离线</strong>
            <small>当前会话内曾经连接成功，且非用户主动断开后才会触发。</small>
          </div>
          <label class="alert-rule-enabled" aria-label="启用服务器离线告警">
            <input v-model="form.alerts.offline.enabled" data-testid="alert-offline-enabled" type="checkbox" />
          </label>
          <div class="alert-rule-threshold alert-rule-empty">—</div>
          <label class="alert-number-field alert-rule-duration">
            <input v-model.number="form.alerts.offline.graceSeconds" class="alert-duration-input" data-testid="alert-offline-grace" type="number" min="5" max="300" step="1" />
            <span>秒</span>
          </label>
        </div>
        <div class="alert-rule-row" data-testid="alert-rule-row-cpu">
          <div class="alert-rule-info">
            <strong>CPU 使用率</strong>
            <small>持续高于阈值后触发。</small>
          </div>
          <label class="alert-rule-enabled" aria-label="启用 CPU 使用率告警">
            <input v-model="form.alerts.cpu.enabled" data-testid="alert-cpu-enabled" type="checkbox" />
          </label>
          <label class="alert-number-field alert-rule-threshold">
            <input v-model.number="form.alerts.cpu.threshold" class="alert-threshold-input" data-testid="alert-cpu-threshold" type="number" min="50" max="100" step="1" />
            <span>%</span>
          </label>
          <label class="alert-number-field alert-rule-duration">
            <input v-model.number="form.alerts.cpu.durationSeconds" class="alert-duration-input" data-testid="alert-cpu-duration" type="number" min="15" max="600" step="1" />
            <span>秒</span>
          </label>
        </div>
        <div class="alert-rule-row" data-testid="alert-rule-row-memory">
          <div class="alert-rule-info">
            <strong>内存使用率</strong>
            <small>持续高于阈值后触发。</small>
          </div>
          <label class="alert-rule-enabled" aria-label="启用内存使用率告警">
            <input v-model="form.alerts.memory.enabled" data-testid="alert-memory-enabled" type="checkbox" />
          </label>
          <label class="alert-number-field alert-rule-threshold">
            <input v-model.number="form.alerts.memory.threshold" class="alert-threshold-input" data-testid="alert-memory-threshold" type="number" min="50" max="100" step="1" />
            <span>%</span>
          </label>
          <label class="alert-number-field alert-rule-duration">
            <input v-model.number="form.alerts.memory.durationSeconds" class="alert-duration-input" data-testid="alert-memory-duration" type="number" min="15" max="600" step="1" />
            <span>秒</span>
          </label>
        </div>
        <div class="alert-rule-row" data-testid="alert-rule-row-root-disk">
          <div class="alert-rule-info">
            <strong>根分区使用率</strong>
            <small>只在监控数据包含挂载点 / 时评估。</small>
          </div>
          <label class="alert-rule-enabled" aria-label="启用根分区使用率告警">
            <input v-model="form.alerts.rootDisk.enabled" data-testid="alert-root-disk-enabled" type="checkbox" />
          </label>
          <label class="alert-number-field alert-rule-threshold">
            <input v-model.number="form.alerts.rootDisk.threshold" class="alert-threshold-input" data-testid="alert-root-disk-threshold" type="number" min="50" max="100" step="1" />
            <span>%</span>
          </label>
          <label class="alert-number-field alert-rule-duration">
            <input v-model.number="form.alerts.rootDisk.durationSeconds" class="alert-duration-input" data-testid="alert-root-disk-duration" type="number" min="15" max="600" step="1" />
            <span>秒</span>
          </label>
        </div>
        <div class="alert-rule-row" data-testid="alert-rule-row-latency">
          <div class="alert-rule-info">
            <strong>网络延迟</strong>
            <small>默认关闭；0 ms 是有效值，不会被当作缺失。</small>
          </div>
          <label class="alert-rule-enabled" aria-label="启用网络延迟告警">
            <input v-model="form.alerts.latency.enabled" data-testid="alert-latency-enabled" type="checkbox" />
          </label>
          <label class="alert-number-field alert-rule-threshold">
            <input v-model.number="form.alerts.latency.threshold" class="alert-latency-input" data-testid="alert-latency-threshold" type="number" min="50" max="5000" step="10" />
            <span>ms</span>
          </label>
          <label class="alert-number-field alert-rule-duration">
            <input v-model.number="form.alerts.latency.durationSeconds" class="alert-duration-input" data-testid="alert-latency-duration" type="number" min="15" max="600" step="1" />
            <span>秒</span>
          </label>
        </div>
      </div>
      <p class="settings-note">告警历史和已读状态保存在本地 SQLite；活动评估器、待触发状态和静音状态仍只在当前进程内存中。告警历史不进入 Backup / Export，告警设置会随普通设置保存和备份。</p>
    </article>

    <SettingsBackupRestoreSection
      v-show="activeCategory === 'backup'"
      :export-path="backupFlow.exportPath.value"
      :export-password="backupFlow.exportPassword.value"
      :export-confirm-password="backupFlow.exportConfirmPassword.value"
      :export-mode="backupFlow.exportMode.value"
      :export-password-strength="backupFlow.exportPasswordStrength.value"
      :export-busy="backupFlow.exportBusy.value"
      :export-error="backupFlow.exportError.value"
      :export-result="backupFlow.exportResult.value"
      :import-path="backupFlow.importPath.value"
      :import-password="backupFlow.importPassword.value"
      :import-busy="backupFlow.importBusy.value"
      :import-error="backupFlow.importError.value"
      :import-result="backupFlow.importResult.value"
      :import-options="backupFlow.importOptions"
      @choose-export-path="backupFlow.chooseExportPath"
      @export-backup="backupFlow.exportBackup"
      @choose-import-file="backupFlow.chooseImportFile"
      @import-backup="backupFlow.importBackup"
      @update:export-password="backupFlow.exportPassword.value = $event"
      @update:export-confirm-password="backupFlow.exportConfirmPassword.value = $event"
      @update:export-mode="backupFlow.exportMode.value = $event"
      @update:import-password="backupFlow.importPassword.value = $event"
      @update:import-option="(id, checked) => backupFlow.setImportOption(id, checked)"
    />

    <article v-show="activeCategory === 'keyvault'" class="settings-card key-vault-card">
      <div class="settings-card-header">
        <div>
          <h2>密钥库</h2>
          <p>私钥导入后会经 Windows 用户级保护存入本地数据库；服务器只引用 keyID，口令仍保存到系统凭据库。</p>
        </div>
        <button type="button" class="primary key-vault-add-button" data-testid="add-key-vault-entry" @click="openAddKey">新增密钥</button>
      </div>
      <div class="key-vault-toolbar">
        <input v-model="keyVaultSearch" data-testid="key-vault-search" placeholder="搜索名称、文件名、算法、指纹或备注" />
        <button type="button" class="secondary" @click="loadKeyVaultEntries">刷新</button>
      </div>
      <p v-if="keyVaultError" class="form-error">{{ keyVaultError }}</p>
      <div v-if="!filteredKeyVaultEntries.length" class="empty-state" data-testid="key-vault-empty">
        暂无密钥。点击“新增密钥”导入 SSH 私钥；导入后不再依赖原始本地文件。
      </div>
      <div v-else class="key-vault-list">
        <div v-for="entry in filteredKeyVaultEntries" :key="entry.id" class="key-vault-row">
          <div class="key-vault-main">
            <div class="key-vault-row-header">
              <strong>{{ entry.name }}</strong>
              <span>{{ keyAlgorithmLabel(entry) }}</span>
              <span>使用中 {{ entry.usageCount ?? 0 }} 台</span>
              <span v-if="entry.storageMode === 'legacy_file_path'" class="key-vault-badge">旧版密钥</span>
            </div>
            <button type="button" class="text-button fingerprint" :title="entry.publicKeyFingerprintSHA256" @click="copyFingerprint(entry)">
              {{ entry.publicKeyFingerprintSHA256 }}
            </button>
            <small class="key-vault-last-used">最后使用 {{ formatKeyTime(entry.lastUsedAt) }}</small>
          </div>
          <div class="key-vault-actions">
            <button type="button" class="secondary" @click="openEditKey(entry)">编辑</button>
            <button
              v-if="entry.storageMode === 'legacy_file_path'"
              type="button"
              class="secondary"
              :disabled="keyVaultBusy"
              @click="migrateLegacyKey(entry)"
            >导入到密钥库</button>
            <button type="button" class="secondary danger-button" :disabled="keyVaultBusy" @click="deleteKeyEntry(entry, $event)">删除</button>
          </div>
        </div>
      </div>
    </article>

      </div>
    </div>

    <div v-if="keyVaultModalOpen" class="modal-backdrop app-material-backdrop" @click.self="closeKeyModal" @keydown.esc.prevent="closeKeyModal">
      <form class="modal key-vault-modal app-material-surface" @submit.prevent="saveKeyEntry">
        <header>
          <h2>{{ editingKey ? '编辑密钥' : '新增密钥' }}</h2>
        </header>
        <div class="form-grid">
          <label class="span-2">名称<input v-model.trim="keyForm.name" required /></label>
          <label v-if="!editingKey || editingKey.storageMode === 'legacy_file_path'" class="span-2">私钥文件
            <span class="file-input">
              <input v-model.trim="keyForm.privateKeyPath" required @input="keyValidation = null" />
              <button type="button" class="secondary" @click="browseKeyFile">浏览…</button>
            </span>
          </label>
          <label class="span-2">私钥口令
            <input
              v-model="keyForm.passphrase"
              type="password"
              autocomplete="new-password"
              :placeholder="editingKey?.passphraseSaved ? '不显示已保存口令；需要更换时输入新口令' : '未加密私钥可留空'"
              @input="keyValidation = null; keyForm.updatePassphrase = Boolean(editingKey)"
            />
          </label>
          <label class="checkbox span-2">
            <input v-model="keyForm.rememberPassphrase" type="checkbox" />
            保存口令到系统凭据库
          </label>
          <label class="span-2">备注<textarea v-model.trim="keyForm.notes" class="app-textarea key-import-remark" placeholder="可选" rows="3" /></label>
        </div>
        <div v-if="!editingKey || editingKey.storageMode === 'legacy_file_path'" class="validation-panel">
          <button type="button" class="secondary" @click="validateKeyFile">验证密钥</button>
          <span v-if="keyValidation?.valid" class="success-text">
            {{ keyValidation.algorithm }} · {{ keyValidation.fingerprintSHA256 }}
          </span>
          <span v-else-if="keyValidation" class="form-error">{{ keyValidation.userMessage }}</span>
        </div>
        <p class="form-note">新增密钥会导入并加密保存私钥正文；编辑已导入密钥只修改名称、备注和口令状态，不返回或显示私钥正文。</p>
        <footer>
          <button type="button" class="secondary" @click="closeKeyModal">取消</button>
          <button type="submit" class="primary" :disabled="keyVaultBusy">{{ editingKey ? '保存' : '导入密钥' }}</button>
        </footer>
      </form>
    </div>
  </section>
</template>
