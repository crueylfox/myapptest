<script setup lang="ts">
import {
  SERVICE_ACTIONS,
  actionPendingLabel,
  type ServiceAction,
} from '../../composables/serviceManagerModel'

defineProps<{
  actionBusy: ServiceAction | null
  disabledActions: Record<ServiceAction, boolean>
}>()

const emit = defineEmits<{
  action: [action: ServiceAction]
}>()
</script>

<template>
  <div class="service-actions">
    <template v-for="(action, index) in SERVICE_ACTIONS" :key="action">
      <button
        class="command-light-action"
        type="button"
        :data-testid="`service-${action}`"
        :disabled="disabledActions[action]"
        @click="emit('action', action)"
      >
        {{ actionPendingLabel(action, actionBusy) }}
      </button>
      <span v-if="index < SERVICE_ACTIONS.length - 1" class="command-action-separator" aria-hidden="true">|</span>
    </template>
  </div>
</template>

<style scoped>
.service-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.service-actions button {
  min-height: 32px;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 780px) {
  .service-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
