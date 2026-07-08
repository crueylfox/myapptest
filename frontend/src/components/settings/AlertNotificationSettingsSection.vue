<script setup lang="ts">
import { computed } from 'vue'
import type { AlertSettings, NativeNotificationStatus } from '../../types'
import type { NativeNotificationPlatformCapability } from '../../utils/platformCapabilities'

const props = defineProps<{
  alerts: AlertSettings
  nativeNotificationStatus: NativeNotificationStatus
  nativeNotificationCapability: NativeNotificationPlatformCapability
}>()

const emit = defineEmits<{
  updateAlertsEnabled: [enabled: boolean]
  updateNotifyRecovery: [enabled: boolean]
  updateNativeNotificationsEnabled: [enabled: boolean]
  testNativeNotification: []
}>()

const nativeNotificationStatusText = computed(() => {
  if (!props.nativeNotificationCapability.supported) return props.nativeNotificationCapability.unavailableStatus
  if (!props.alerts.nativeNotifications.enabled) return props.nativeNotificationCapability.defaultOffStatus
  return props.nativeNotificationStatus.message
})
const nativeNotificationSupported = computed(() => props.nativeNotificationCapability.supported)
const nativeNotificationChecked = computed(() => nativeNotificationSupported.value && props.alerts.nativeNotifications.enabled)

function checkboxValue(event: Event) {
  return (event.target as HTMLInputElement).checked
}

function requestNativeNotificationTest() {
  if (!nativeNotificationSupported.value || !props.alerts.nativeNotifications.enabled) return
  emit('testNativeNotification')
}
</script>

<template>
  <div class="alert-global-controlbar">
    <label class="alert-global-control">
      <input
        :checked="alerts.enabled"
        data-testid="alert-enabled"
        type="checkbox"
        @change="emit('updateAlertsEnabled', checkboxValue($event))"
      />
      <span class="alert-global-control__text">
        <strong>服务器告警</strong>
        <small>关闭后不再创建新的告警事件。</small>
      </span>
    </label>
    <span class="alert-global-controlbar__divider" aria-hidden="true"></span>
    <label class="alert-global-control">
      <input
        :checked="alerts.notifyRecovery"
        data-testid="alert-recovery-enabled"
        type="checkbox"
        @change="emit('updateNotifyRecovery', checkboxValue($event))"
      />
      <span class="alert-global-control__text">
        <strong>恢复时通知</strong>
        <small>指标恢复后生成恢复状态。</small>
      </span>
    </label>
  </div>

  <div class="alert-native-controlbar" data-testid="alert-native-notifications">
    <label class="alert-global-control">
      <input
        :checked="nativeNotificationChecked"
        data-testid="alert-native-notifications-enabled"
        :disabled="!nativeNotificationSupported"
        type="checkbox"
        @change="emit('updateNativeNotificationsEnabled', checkboxValue($event))"
      />
      <span class="alert-global-control__text">
        <strong>系统原生通知</strong>
        <small>开启后，新的告警和已恢复事件会通过系统通知显示。</small>
      </span>
    </label>
    <div class="alert-native-controlbar__status">
      <span data-testid="alert-native-notifications-status">{{ nativeNotificationStatusText }}</span>
      <button
        type="button"
        class="secondary alert-test-button"
        data-testid="alert-native-notification-test-button"
        :disabled="!nativeNotificationSupported || !alerts.nativeNotifications.enabled"
        @click="requestNativeNotificationTest"
      >
        发送系统通知
      </button>
    </div>
  </div>
</template>
