import {
  CleanupNotifications,
  InitializeNotifications,
  IsNotificationAvailable,
  RequestNotificationAuthorization,
  SendNotification,
  type NotificationOptions,
} from '../../wailsjs/runtime/runtime'
import type { NativeNotificationRuntimeAdapter } from './useNativeAlertNotifications'

export function createWailsNativeNotificationRuntime(): NativeNotificationRuntimeAdapter {
  return {
    initialize: () => InitializeNotifications(),
    cleanup: () => CleanupNotifications(),
    isAvailable: () => IsNotificationAvailable(),
    requestAuthorization: () => RequestNotificationAuthorization(),
    send: (options: NotificationOptions) => SendNotification(options),
  }
}
