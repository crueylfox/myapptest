import { describe, expect, it } from 'vitest'
import { architectureGovernanceHistory } from '../test-support/architectureGovernanceHistory'
import dialogSource from './ServiceManagerDialog.vue?raw'
import actionBarSource from './service-manager/ServiceActionBar.vue?raw'
import detailsSource from './service-manager/ServiceManagerDetails.vue?raw'
import journalPanelSource from './service-manager/ServiceJournalPanel.vue?raw'
import listSource from './service-manager/ServiceManagerList.vue?raw'
import actionFlowSource from '../composables/useServiceActionFlow.ts?raw'
import journalFlowSource from '../composables/useServiceJournalFlow.ts?raw'
import modelSource from '../composables/serviceManagerModel.ts?raw'

describe('ServiceManagerDialog targeted refactor structure', () => {
  it('delegates service manager orchestration to focused model, flow, and section files', () => {
    expect(dialogSource).toContain("from '../composables/serviceManagerModel'")
    expect(dialogSource).toContain("from '../composables/useServiceActionFlow'")
    expect(dialogSource).toContain("from '../composables/useServiceJournalFlow'")
    expect(dialogSource).toContain("from './service-manager/ServiceManagerList.vue'")
    expect(dialogSource).toContain("from './service-manager/ServiceManagerDetails.vue'")
    expect(dialogSource).not.toContain('function actionConfirmMessage')
    expect(dialogSource).not.toContain('function actionDisabled')
    expect(dialogSource).not.toContain('function journalLineClass')
    expect(dialogSource).not.toContain('function formatJournalCopyLine')
  })

  it('reduces ServiceManagerDialog by at least 250 lines or below the 1200-line target', () => {
    const afterLines = dialogSource.split(/\r?\n/).length
    expect(afterLines).toBeLessThanOrEqual(1302)
  })

  it('keeps new service manager files inside dependency boundaries', () => {
    for (const source of [
      modelSource,
      actionFlowSource,
      journalFlowSource,
      listSource,
      detailsSource,
      journalPanelSource,
      actionBarSource,
    ]) {
      expect(source).not.toMatch(/wailsjs|api\/backend|localStorage|sessionStorage/)
      expect(source).not.toMatch(/event\s*bus|EventBus|ManagerDialogFramework|AppController/)
      expect(source).not.toMatch(/private key|passphrase|password|terminal output|remote file content|transfer file content/i)
    }
    expect(modelSource).not.toContain('useServiceManagerStore')
    expect(actionFlowSource).not.toContain('useServiceManagerStore')
    expect(journalFlowSource).not.toContain('useServiceManagerStore')
  })

  it('keeps this targeted refactor round in architecture governance history', () => {
    const record = architectureGovernanceHistory.serviceManagerDialogTargetedRefactor
    expect(record.title).toContain('ServiceManagerDialog targeted large-refactor')
    expect(record.versionChange).toBe('0.4.0-beta.34 -> 0.4.0-beta.35')
    expect(record.lineCount).toContain('ServiceManagerDialog.vue line count')
  })
})
