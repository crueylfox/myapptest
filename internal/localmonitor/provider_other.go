//go:build !windows && !darwin

package localmonitor

import (
	"net"
	"os"
	"runtime"
	"time"

	"serverpilot/internal/domain"
)

type OSProvider struct{}

func NewOSProvider() Provider {
	return OSProvider{}
}

func (OSProvider) Snapshot() (domain.LocalResourceSnapshot, error) {
	hostname, _ := os.Hostname()
	interfaces, _ := net.Interfaces()
	rows := make([]domain.LocalNetworkInterface, 0, len(interfaces))
	for _, item := range interfaces {
		rows = append(rows, domain.LocalNetworkInterface{Name: item.Name, DisplayName: item.Name, IsUp: true})
	}
	return domain.LocalResourceSnapshot{
		Status:               "online",
		Hostname:             hostname,
		Platform:             runtime.GOOS,
		OSName:               runtime.GOOS,
		Architecture:         runtime.GOARCH,
		CPULogicalProcessors: runtime.NumCPU(),
		Timestamp:            time.Now().Format(time.RFC3339),
		GPUs: []domain.LocalGpuSnapshot{{
			Available:         false,
			UnavailableReason: "unavailable",
		}},
		NetworkInterfaces: rows,
	}, nil
}
