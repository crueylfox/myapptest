import { describe, expect, it } from 'vitest'
import { architectureGovernanceHistory } from '../test-support/architectureGovernanceHistory'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local source files.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: URL, encoding: string) => string }

const settingsView = readFileSync(new URL('./SettingsView.vue', import.meta.url), 'utf8')
const backupModel = readFileSync(new URL('../composables/settingsBackupRestoreModel.ts', import.meta.url), 'utf8')
const backupFlow = readFileSync(new URL('../composables/useSettingsBackupRestoreFlow.ts', import.meta.url), 'utf8')
const backupSection = readFileSync(new URL('./settings/SettingsBackupRestoreSection.vue', import.meta.url), 'utf8')

describe('SettingsView backup restore orchestration structure', () => {
  it('delegates backup model, flow, and section presentation to focused files', () => {
    expect(settingsView).toContain("import SettingsBackupRestoreSection from './settings/SettingsBackupRestoreSection.vue'")
    expect(settingsView).toContain('useSettingsBackupRestoreFlow')
    expect(settingsView).toContain('cloneBackupImportOptions')
    expect(settingsView).toContain('<SettingsBackupRestoreSection')

    for (const forbidden of [
      "const exportPath = ref('')",
      "const importPath = ref('')",
      'const importOptions = reactive<BackupImportOptions>',
      'function backupPasswordLength',
      'const exportPasswordStrength = computed',
      'async function chooseExportPath',
      'async function exportBackup',
      'async function chooseImportFile',
      'async function importBackup',
      'function backupDebugLog',
      'function cloneBackupImportOptions',
      '<article v-show="activeCategory === \'backup\'" class="settings-card backup-card">',
    ]) {
      expect(settingsView).not.toContain(forbidden)
    }
  })

  it('keeps SettingsView below this large-refactor line-count target', () => {
    const lineCount = settingsView.split(/\r?\n/).filter((line) => line.length > 0).length
    expect(lineCount).toBeLessThanOrEqual(1513)
  })

  it('keeps backupImportOptions in settings payload and draft glue only', () => {
    expect(settingsView).toContain('backupImportOptions: cloneBackupImportOptions')
    expect(settingsView).toContain('backupFlow.applyImportOptions')
  })

  it('keeps extracted files inside frontend-only dependency boundaries', () => {
    for (const [name, source] of [
      ['settingsBackupRestoreModel.ts', backupModel],
      ['useSettingsBackupRestoreFlow.ts', backupFlow],
      ['SettingsBackupRestoreSection.vue', backupSection],
    ] as const) {
      expect(source, name).not.toMatch(/from ['"].*\/api\/backend['"]/)
      expect(source, name).not.toMatch(/from ['"].*\/stores\//)
      expect(source, name).not.toContain('localStorage')
      expect(source, name).not.toContain('sessionStorage')
      expect(source, name).not.toContain('eventBus')
      expect(source, name).not.toContain('AppController')
      expect(source, name).not.toContain('WriteTerminal')
      expect(source, name).not.toContain('DisconnectServer')
      expect(source, name).not.toMatch(/privateKey|passphrase|terminal output|remote file content|transfer file content/i)
    }
  })

  it('keeps this SettingsView backup restore refactor round in architecture governance history', () => {
    const record = architectureGovernanceHistory.settingsBackupRestoreOrchestration
    expect(record.title).toContain('SettingsView Backup / Restore import-export orchestration large-refactor')
    expect(record.versionChange).toBe('0.4.0-beta.33 -> 0.4.0-beta.34')
    expect(record.lineCount).toContain('SettingsView.vue line count')
  })
})
