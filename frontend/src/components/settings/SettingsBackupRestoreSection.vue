<script setup lang="ts">
import type { BackupImportOptions, BackupImportResult } from '../../types'
import { backupImportOptionItems, summarizeBackupImportResult, type BackupImportOptionId } from '../../composables/settingsBackupRestoreModel'

defineProps<{
  exportPath: string
  exportPassword: string
  exportConfirmPassword: string
  exportMode: 'standard' | 'full'
  exportPasswordStrength: string
  exportBusy: boolean
  exportError: string
  exportResult: string
  importPath: string
  importPassword: string
  importBusy: boolean
  importError: string
  importResult: BackupImportResult | null
  importOptions: BackupImportOptions
}>()

const emit = defineEmits<{
  chooseExportPath: []
  exportBackup: []
  chooseImportFile: []
  importBackup: []
  'update:exportPassword': [value: string]
  'update:exportConfirmPassword': [value: string]
  'update:exportMode': [value: 'standard' | 'full']
  'update:importPassword': [value: string]
  'update:importOption': [id: BackupImportOptionId, checked: boolean]
}>()

function inputValue(event: Event) {
  return (event.target as HTMLInputElement).value
}

function checkedValue(event: Event) {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <article class="settings-card backup-card">
    <div class="settings-card-header">
      <div>
        <h2>备份与恢复</h2>
        <p>备份文件会被加密，包含设置、分组、服务器、密钥库元数据和主机指纹记录。</p>
      </div>
    </div>
    <p class="form-note">
      标准备份不会导出已保存密码、私钥口令、私钥文件正文或系统凭据引用。完整备份会导出已保存凭据，但只写入加密后的备份文件。
    </p>

    <h3 class="settings-subheading">导出备份</h3>
    <div class="backup-mode-options" data-testid="backup-export-mode">
      <label class="policy-option">
        <input
          :checked="exportMode === 'standard'"
          type="radio"
          value="standard"
          @change="emit('update:exportMode', 'standard')"
        />
        <span>
          <strong>标准备份（安全）</strong>
          <small>包含设置、分组、服务器、密钥库元数据和主机指纹；不包含密码与私钥口令。</small>
        </span>
      </label>
      <label class="policy-option backup-mode-danger">
        <input
          :checked="exportMode === 'full'"
          type="radio"
          value="full"
          @change="emit('update:exportMode', 'full')"
        />
        <span>
          <strong>完整备份（高风险）</strong>
          <small>此备份包含所有敏感信息，存在安全风险；包含 SSH 密码、私钥口令与密钥库口令。</small>
        </span>
      </label>
    </div>
    <p v-if="exportMode === 'full'" class="form-error">
      此备份包含所有敏感信息，存在安全风险。备份密码丢失后无法恢复；备份文件泄露会暴露已保存凭据。
    </p>
    <div class="backup-grid">
      <label class="span-2">保存位置
        <span class="file-input">
          <input :value="exportPath" readonly placeholder="选择 .spbackup 保存位置" />
          <button type="button" class="secondary" @click="emit('chooseExportPath')">浏览…</button>
        </span>
      </label>
      <label>备份密码
        <input
          :value="exportPassword"
          type="password"
          autocomplete="new-password"
          @input="emit('update:exportPassword', inputValue($event))"
        />
      </label>
      <label>确认备份密码
        <input
          :value="exportConfirmPassword"
          type="password"
          autocomplete="new-password"
          @input="emit('update:exportConfirmPassword', inputValue($event))"
        />
      </label>
      <small class="span-2">{{ exportPasswordStrength }}</small>
    </div>
    <p v-if="exportError" class="form-error">{{ exportError }}</p>
    <p v-if="exportResult" class="success-text">{{ exportResult }}</p>
    <button type="button" class="primary" :disabled="exportBusy" @click="emit('exportBackup')">导出加密备份</button>

    <h3 class="settings-subheading">导入备份</h3>
    <div class="backup-grid">
      <label class="span-2">备份文件
        <span class="file-input">
          <input :value="importPath" readonly placeholder="选择 .spbackup 文件" />
          <button type="button" class="secondary" @click="emit('chooseImportFile')">浏览…</button>
        </span>
      </label>
      <label class="span-2">备份密码
        <input
          :value="importPassword"
          type="password"
          autocomplete="current-password"
          @input="emit('update:importPassword', inputValue($event))"
        />
      </label>
    </div>
    <div class="backup-preview" data-testid="backup-import-options">
      <strong>导入内容</strong>
      <label v-for="item in backupImportOptionItems" :key="item.id">
        <input
          :checked="importOptions[item.id]"
          type="checkbox"
          @change="emit('update:importOption', item.id, checkedValue($event))"
        />
        {{ item.label }}
      </label>
      <small>重复服务器会按主机、端口和用户名更新现有记录，不会创建“导入 N”副本；已保存凭据不会被导入或覆盖。</small>
    </div>
    <div class="backup-actions">
      <button type="button" class="primary" :disabled="importBusy" @click="emit('importBackup')">导入备份</button>
    </div>
    <p v-if="importError" class="form-error">{{ importError }}</p>

    <div v-if="importResult" class="backup-preview" data-testid="backup-result">
      <strong>导入结果</strong>
      <span v-for="line in summarizeBackupImportResult(importResult)" :key="line">{{ line }}</span>
      <small>{{ importResult.credentialsNotice }}</small>
    </div>
  </article>
</template>
