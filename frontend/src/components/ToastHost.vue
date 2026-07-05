<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ToastMessage } from '../types'

const props = defineProps<{ toast: ToastMessage | null }>()
const emit = defineEmits<{ close: [] }>()
const expanded = ref(false)

watch(() => props.toast?.id, () => {
  expanded.value = false
})

async function copyDetail() {
  if (!props.toast?.detail) return
  try {
    await navigator.clipboard.writeText(props.toast.detail)
  } catch (reason) {
    console.error('Unable to copy connection error detail', reason)
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-layer" aria-live="polite" aria-atomic="true">
      <Transition name="toast">
        <div v-if="toast" class="toast-host" :class="toast.type" role="status">
          <div class="toast-summary">
            <div class="toast-content">
              <span>{{ toast.message }}</span>
            </div>
            <div class="toast-actions">
              <button v-if="toast.detail" type="button" class="toast-detail-toggle" @click="expanded = !expanded">
                {{ expanded ? '收起详情' : '查看详情' }}
              </button>
              <button type="button" class="dialog-close-button toast-close-button" title="关闭提示" @click="emit('close')">关闭</button>
            </div>
          </div>
          <div v-if="expanded && toast.detail" class="toast-detail">
            <code v-if="toast.code">{{ toast.code }}</code>
            <pre>{{ toast.detail }}</pre>
            <button type="button" @click="copyDetail">复制技术详情</button>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
