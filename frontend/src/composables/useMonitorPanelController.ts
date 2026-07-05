import { ref } from 'vue'

export type MonitorPanelTab = 'overview' | 'detail'
export type NetworkDetailsTab = 'endpoints' | 'diagnostics'

export type MonitorDetailIntent = {
  type: 'monitor-detail'
  serverID: number
}

export type NetworkDetailsIntent = {
  type: 'network-details'
  serverID: number
  tab: NetworkDetailsTab
}

export function useMonitorPanelController() {
  const monitorPanelOpen = ref(false)
  const monitorPanelInitialTab = ref<MonitorPanelTab>('overview')
  const monitorPanelInitialServerId = ref<number | null>(null)
  const networkDetailsOpen = ref(false)
  const networkDetailsInitialTab = ref<NetworkDetailsTab>('endpoints')

  function openMonitorPanel(options: { tab?: MonitorPanelTab; serverID?: number | null } = {}) {
    monitorPanelInitialTab.value = options.tab ?? 'overview'
    monitorPanelInitialServerId.value = options.serverID ?? null
    monitorPanelOpen.value = true
  }

  function closeMonitorPanel() {
    monitorPanelOpen.value = false
  }

  function openNetworkDetails(initialTab: NetworkDetailsTab = 'endpoints') {
    networkDetailsInitialTab.value = initialTab
    networkDetailsOpen.value = true
  }

  function closeNetworkDetails() {
    networkDetailsOpen.value = false
  }

  function monitorDetailIntent(serverID: number): MonitorDetailIntent {
    return { type: 'monitor-detail', serverID }
  }

  function networkDetailsIntent(serverID: number, tab: NetworkDetailsTab = 'endpoints'): NetworkDetailsIntent {
    return { type: 'network-details', serverID, tab }
  }

  return {
    monitorPanelOpen,
    monitorPanelInitialTab,
    monitorPanelInitialServerId,
    networkDetailsOpen,
    networkDetailsInitialTab,
    openMonitorPanel,
    closeMonitorPanel,
    openNetworkDetails,
    closeNetworkDetails,
    monitorDetailIntent,
    networkDetailsIntent,
  }
}
