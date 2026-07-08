<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { resolveAppDialog, useAppDialog } from '../composables/useAppDialog'
import AppBackdrop from './primitives/AppBackdrop.vue'
import AppSurface from './primitives/AppSurface.vue'

const { dialog } = useAppDialog()
const input = ref('')
const error = ref('')
const submitting = ref(false)
const inputElement = ref<HTMLInputElement>()
const showHeaderClose = computed(() => dialog.value?.hideCloseButton === false)
let previousFocus: HTMLElement | null = null

watch(() => dialog.value?.id, async () => {
  if (!dialog.value) return
  previousFocus = dialog.value.returnFocus ?? document.activeElement as HTMLElement | null
  input.value = dialog.value.initialValue ?? ''
  error.value = ''
  submitting.value = false
  await nextTick()
  inputElement.value?.focus()
})

function restoreFocus() {
  const target = dialog.value?.returnFocus ?? previousFocus
  window.setTimeout(() => {
    if (target?.isConnected) target.focus()
  }, 0)
}

function close(value: boolean | string | null) {
  if (submitting.value) return
  restoreFocus()
  resolveAppDialog(value)
}

async function submit() {
  const request = dialog.value
  if (!request || submitting.value) return
  if (request.kind === 'confirm') {
    close(request.confirmValue ?? true)
    return
  }
  const value = input.value.trim()
  const validation = request.validate?.(value) ?? ''
  if (validation) {
    error.value = validation
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const submitError = await request.submit?.(value)
    if (submitError) {
      error.value = submitError
      return
    }
    submitting.value = false
    restoreFocus()
    resolveAppDialog(value)
  } catch (reason) {
    error.value = String(reason).replace(/^Error:\s*/i, '').trim() || '操作失败'
  } finally {
    submitting.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close(dialog.value?.kind === 'confirm' ? false : null)
  }
}

onBeforeUnmount(() => {
  if (dialog.value) resolveAppDialog(dialog.value.kind === 'confirm' ? false : null)
})
</script>

<template>
  <Teleport to="body">
    <AppBackdrop
      v-if="dialog"
      class="modal-backdrop app-dialog-backdrop"
      :danger="dialog.danger"
      data-testid="app-dialog"
      @keydown="onKeydown"
      @pointerdown.self="close(dialog.kind === 'confirm' ? false : null)"
    >
      <AppSurface as="form" variant="modal" class="modal app-dialog" @submit.prevent="submit">
        <header>
          <h2>{{ dialog.title }}</h2>
          <button
            v-if="showHeaderClose"
            type="button"
            class="dialog-close-button"
            :disabled="submitting"
            @click="close(dialog.kind === 'confirm' ? false : null)"
          >关闭</button>
        </header>
        <p v-if="dialog.message" class="app-dialog-message">{{ dialog.message }}</p>
        <label v-if="dialog.kind === 'input'" class="app-dialog-input">
          <span>{{ dialog.label ?? '名称' }}</span>
          <input
            ref="inputElement"
            v-model="input"
            :placeholder="dialog.placeholder"
            :disabled="submitting"
            autocomplete="off"
          />
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer>
          <button
            type="button"
            class="secondary"
            :disabled="submitting"
            @click="close(dialog.kind === 'confirm' ? false : null)"
          >{{ dialog.cancelText ?? '取消' }}</button>
          <button
            v-if="dialog.secondaryText"
            type="button"
            class="secondary"
            :disabled="submitting"
            @click="close(dialog.secondaryValue ?? null)"
          >{{ dialog.secondaryText }}</button>
          <button
            type="submit"
            :class="dialog.danger ? 'danger' : 'primary'"
            :disabled="submitting"
          >{{ submitting ? '处理中…' : dialog.confirmText ?? '确定' }}</button>
        </footer>
      </AppSurface>
    </AppBackdrop>
  </Teleport>
</template>
