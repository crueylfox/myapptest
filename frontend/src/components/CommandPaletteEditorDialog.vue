<script setup lang="ts">
defineProps<{
  open: boolean
  modelValue: string
  saving: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  confirm: []
  cancel: []
}>()

function updateDraft(event: Event) {
  emit('update:modelValue', String((event.target as HTMLTextAreaElement).value ?? ''))
}
</script>

<template>
  <div
    v-if="open"
    class="modal-backdrop"
    @click.self="emit('cancel')"
    @keydown.esc.prevent="emit('cancel')"
  >
    <form class="modal command-history-editor" data-testid="command-history-editor" @submit.prevent="emit('confirm')">
      <header>
        <h2>编辑命令历史</h2>
        <button type="button" class="dialog-close-button" @click="emit('cancel')">关闭</button>
      </header>
      <label class="history-editor-field">
        命令
        <textarea :value="modelValue" rows="4" required @input="updateDraft" />
      </label>
      <p class="form-note">这里只修改 ServerPilot 本地保存的历史记录，不代表修改远程已执行命令。</p>
      <footer>
        <button type="button" class="secondary" @click="emit('cancel')">取消</button>
        <button type="submit" class="primary" :disabled="saving">保存</button>
      </footer>
    </form>
  </div>
</template>
