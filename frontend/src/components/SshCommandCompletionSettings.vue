<script setup lang="ts">
import { ref } from 'vue'
import {
  getSshCommandCompletionMaxSuggestions,
  getSshCommandCompletionTriggerChars,
  isSshCommandCompletionDescriptionVisible,
  isSshCommandCompletionEnabled,
  setSshCommandCompletionEnabled,
  setSshCommandCompletionMaxSuggestions,
  setSshCommandCompletionShowDescriptions,
  setSshCommandCompletionTriggerChars,
} from '../utils/sshCommandCompletionPreference'

const enabled = ref(isSshCommandCompletionEnabled())
const showDescriptions = ref(isSshCommandCompletionDescriptionVisible())
const maxSuggestions = ref(getSshCommandCompletionMaxSuggestions())
const triggerChars = ref(getSshCommandCompletionTriggerChars())

function saveEnabled() {
  setSshCommandCompletionEnabled(enabled.value)
}

function saveShowDescriptions() {
  setSshCommandCompletionShowDescriptions(showDescriptions.value)
}

function saveMaxSuggestions() {
  setSshCommandCompletionMaxSuggestions(maxSuggestions.value)
  maxSuggestions.value = getSshCommandCompletionMaxSuggestions()
}

function saveTriggerChars() {
  setSshCommandCompletionTriggerChars(triggerChars.value)
  triggerChars.value = getSshCommandCompletionTriggerChars()
}
</script>

<template>
  <label class="setting-toggle" data-testid="ssh-command-completion-setting">
    <span><strong>启用 SSH 命令补全</strong><small>只作用于 SSH/Linux 终端；关闭后 Tab 会继续原样发送给远程 shell。</small></span>
    <input v-model="enabled" data-testid="ssh-command-completion-enabled" type="checkbox" @change="saveEnabled" />
  </label>
  <label class="setting-toggle" data-testid="ssh-command-completion-description-setting">
    <span><strong>显示命令说明</strong><small>开启后，SSH/Linux 命令补全面板会显示内置命令的简短说明。</small></span>
    <input v-model="showDescriptions" data-testid="ssh-command-completion-show-descriptions" type="checkbox" @change="saveShowDescriptions" />
  </label>
  <label class="settings-number-field" data-testid="ssh-command-completion-max-setting">
    <span>最大建议数量<small>范围 5 - 20，默认 12；只影响 SSH/Linux 命令补全。</small></span>
    <input v-model.number="maxSuggestions" data-testid="ssh-command-completion-max-suggestions" type="number" min="5" max="20" step="1" @input="saveMaxSuggestions" />
  </label>
  <label class="settings-number-field" data-testid="ssh-command-completion-trigger-setting">
    <span>触发字符数<small>范围 1 - 4，默认 2；CMD 和 PowerShell 不启用 Linux 补全。</small></span>
    <input v-model.number="triggerChars" data-testid="ssh-command-completion-trigger-chars" type="number" min="1" max="4" step="1" @input="saveTriggerChars" />
  </label>
</template>
