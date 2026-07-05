package domain

type NetworkInspectionServerRequest struct {
	ServerID int64 `json:"serverID"`
}

type OpenNetworkInspectionContextRequest struct {
	ServerID int64 `json:"serverID"`
}

type OpenNetworkInspectionContextResponse struct {
	ServerID  int64  `json:"serverID"`
	ContextID string `json:"contextID"`
	OpenedAt  string `json:"openedAt"`
}

type CloseNetworkInspectionContextRequest struct {
	ServerID  int64  `json:"serverID"`
	ContextID string `json:"contextID"`
}

type NetworkEndpointSnapshotRequest struct {
	ServerID      int64  `json:"serverID"`
	ContextID     string `json:"contextID"`
	InterfaceName string `json:"interfaceName,omitempty"`
	Scope         string `json:"scope,omitempty"`
}

type NetworkEndpointSummary struct {
	RowID                   string  `json:"rowID"`
	ServerID                int64   `json:"serverID"`
	Protocol                string  `json:"protocol"`
	Family                  string  `json:"family"`
	ListenAddress           string  `json:"listenAddress"`
	ListenPort              int     `json:"listenPort"`
	PID                     *int64  `json:"pid"`
	PIDLabel                string  `json:"pidLabel"`
	ProcessName             string  `json:"processName"`
	SourceType              string  `json:"sourceType"`
	SourceName              string  `json:"sourceName"`
	ContainerID             string  `json:"containerID,omitempty"`
	ContainerName           string  `json:"containerName,omitempty"`
	UniqueRemoteIPCount     *int    `json:"uniqueRemoteIPCount"`
	ConnectionCount         *int    `json:"connectionCount"`
	UploadedBytes           *uint64 `json:"uploadedBytes"`
	UploadedBytesEstimate   *uint64 `json:"uploadedBytesEstimate"`
	UploadedBytesEstimated  bool    `json:"uploadedBytesEstimated"`
	DownloadedBytes         *uint64 `json:"downloadedBytes"`
	AggregatedProcessCount  *int    `json:"aggregatedProcessCount"`
	ConnectionDataAvailable bool    `json:"connectionDataAvailable"`
	ByteCountersAvailable   bool    `json:"byteCountersAvailable"`
	ByteCountersPartial     bool    `json:"byteCountersPartial"`
	PermissionLimited       bool    `json:"permissionLimited"`
	AggregationApproximate  bool    `json:"aggregationApproximate"`
	HasListener             bool    `json:"hasListener"`
	HasActiveConnections    bool    `json:"hasActiveConnections"`
	RowKind                 string  `json:"rowKind"`
	State                   string  `json:"state"`
	LastUpdatedAt           string  `json:"lastUpdatedAt"`
}

type NetworkEndpointSnapshot struct {
	ServerID                        int64                    `json:"serverID"`
	ContextID                       string                   `json:"contextID"`
	Strategy                        string                   `json:"strategy"`
	ListenersAvailable              bool                     `json:"listenersAvailable"`
	ConnectionsAvailable            bool                     `json:"connectionsAvailable"`
	ProcessInfoAvailable            bool                     `json:"processInfoAvailable"`
	PermissionLimited               bool                     `json:"permissionLimited"`
	ByteCountersAvailable           bool                     `json:"byteCountersAvailable"`
	ByteCountersPartial             bool                     `json:"byteCountersPartial"`
	Listeners                       []NetworkEndpointSummary `json:"listeners"`
	TotalListeners                  int                      `json:"totalListeners"`
	TotalConnections                *int                     `json:"totalConnections"`
	UniqueRemoteIPs                 *int                     `json:"uniqueRemoteIPs"`
	SocketConnectionCount           *int                     `json:"socketConnectionCount"`
	SocketRemoteIPCount             *int                     `json:"socketRemoteIPCount"`
	HostSocketConnectionCount       *int                     `json:"hostSocketConnectionCount"`
	HostRemoteIPCount               *int                     `json:"hostRemoteIPCount"`
	DockerSocketConnectionCount     *int                     `json:"dockerSocketConnectionCount"`
	DockerRemoteIPCount             *int                     `json:"dockerRemoteIPCount"`
	TotalSocketConnectionCount      *int                     `json:"totalSocketConnectionCount"`
	TotalRemoteIPCount              *int                     `json:"totalRemoteIPCount"`
	ConntrackConnectionCount        *int                     `json:"conntrackConnectionCount"`
	ConntrackRemoteIPCount          *int                     `json:"conntrackRemoteIPCount"`
	ConntrackAvailable              bool                     `json:"conntrackAvailable"`
	ConntrackSource                 string                   `json:"conntrackSource"`
	ListenerCount                   int                      `json:"listenerCount"`
	DockerAvailable                 bool                     `json:"dockerAvailable"`
	DockerNamespaceAvailable        bool                     `json:"dockerNamespaceAvailable"`
	DockerPermissionLimited         bool                     `json:"dockerPermissionLimited"`
	DockerContainerCount            int                      `json:"dockerContainerCount"`
	DockerScannedContainerCount     int                      `json:"dockerScannedContainerCount"`
	DockerAggregated                bool                     `json:"dockerAggregated"`
	DockerTruncated                 bool                     `json:"dockerTruncated"`
	InterfaceScope                  string                   `json:"interfaceScope"`
	Aggregated                      bool                     `json:"aggregated"`
	RawConnectionCountBeforeLimit   *int                     `json:"rawConnectionCountBeforeLimit"`
	ReturnedRowCount                int                      `json:"returnedRowCount"`
	RowLimit                        int                      `json:"rowLimit"`
	SocketUploadBytesKnownCount     int                      `json:"socketUploadBytesKnownCount"`
	SocketUploadBytesEstimatedCount int                      `json:"socketUploadBytesEstimatedCount"`
	SocketDownloadBytesKnownCount   int                      `json:"socketDownloadBytesKnownCount"`
	SocketCounterMissingCount       int                      `json:"socketCounterMissingCount"`
	CollectedAt                     string                   `json:"collectedAt"`
	Warnings                        []string                 `json:"warnings"`
}
