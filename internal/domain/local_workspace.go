package domain

type LocalFileError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Path    string `json:"path"`
}

func (e *LocalFileError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

type LocalDrive struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type LocalExplorerHome struct {
	Path string `json:"path"`
}

type LocalDirectoryRequest struct {
	Path string `json:"path"`
}

type LocalPathRequest struct {
	Path string `json:"path"`
}

type LocalFileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	IsDir       bool   `json:"isDir"`
	ModTime     string `json:"modTime"`
	DisplayType string `json:"displayType"`
}

type LocalDirectoryListing struct {
	Path    string           `json:"path"`
	Parent  string           `json:"parent"`
	Entries []LocalFileEntry `json:"entries"`
}

type LocalNetworkInterface struct {
	Name                   string  `json:"name"`
	DisplayName            string  `json:"displayName"`
	Description            string  `json:"description"`
	IsUp                   bool    `json:"isUp"`
	HasGateway             bool    `json:"hasGateway"`
	IsDefaultRoute         bool    `json:"isDefaultRoute"`
	IsPhysicalLike         bool    `json:"isPhysicalLike"`
	IsVirtual              bool    `json:"isVirtual"`
	IsLoopback             bool    `json:"isLoopback"`
	IsHiddenByDefault      bool    `json:"isHiddenByDefault"`
	SpeedBps               uint64  `json:"speedBps"`
	RXBytes                uint64  `json:"rxBytes"`
	TXBytes                uint64  `json:"txBytes"`
	UploadBytesPerSecond   float64 `json:"uploadBytesPerSecond"`
	DownloadBytesPerSecond float64 `json:"downloadBytesPerSecond"`
}

type LocalGpuSnapshot struct {
	Name              string  `json:"name"`
	Available         bool    `json:"available"`
	UsagePercent      float64 `json:"usagePercent"`
	MemoryUsedBytes   uint64  `json:"memoryUsedBytes"`
	MemoryTotalBytes  uint64  `json:"memoryTotalBytes"`
	UnavailableReason string  `json:"unavailableReason"`
}

type LocalDiskVolume struct {
	Name        string  `json:"name"`
	MountPath   string  `json:"mountPath"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	UsedPercent float64 `json:"usedPercent"`
}

type LocalProcessInfo struct {
	PID           int     `json:"pid"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryBytes   uint64  `json:"memoryBytes"`
	MemoryPercent float64 `json:"memoryPercent"`
}

type LocalResourceSnapshot struct {
	Status                 string                  `json:"status"`
	Hostname               string                  `json:"hostname"`
	Platform               string                  `json:"platform"`
	OSName                 string                  `json:"osName"`
	OSVersion              string                  `json:"osVersion"`
	OSBuild                string                  `json:"osBuild"`
	Architecture           string                  `json:"architecture"`
	CPUModel               string                  `json:"cpuModel"`
	CPUCores               int                     `json:"cpuCores"`
	CPULogicalProcessors   int                     `json:"cpuLogicalProcessors"`
	Timestamp              string                  `json:"timestamp"`
	UptimeSeconds          int64                   `json:"uptimeSeconds"`
	CPUPercent             float64                 `json:"cpuPercent"`
	MemoryTotal            uint64                  `json:"memoryTotal"`
	MemoryAvailable        uint64                  `json:"memoryAvailable"`
	MemoryUsedPercent      float64                 `json:"memoryUsedPercent"`
	SwapTotal              uint64                  `json:"swapTotal"`
	SwapFree               uint64                  `json:"swapFree"`
	PagefileTotal          uint64                  `json:"pagefileTotal"`
	PagefileFree           uint64                  `json:"pagefileFree"`
	GPUs                   []LocalGpuSnapshot      `json:"gpus"`
	UploadBytesPerSecond   float64                 `json:"uploadBytesPerSecond"`
	DownloadBytesPerSecond float64                 `json:"downloadBytesPerSecond"`
	NetworkInterfaces      []LocalNetworkInterface `json:"networkInterfaces"`
	Disks                  []LocalDiskVolume       `json:"disks"`
	Processes              []LocalProcessInfo      `json:"processes"`
}
