package localmonitor

import (
	"runtime"
	"time"

	"serverpilot/internal/domain"
)

type Provider interface {
	Snapshot() (domain.LocalResourceSnapshot, error)
}

type Service struct {
	provider Provider
}

func New(provider Provider) *Service {
	if provider == nil {
		provider = NewOSProvider()
	}
	return &Service{provider: provider}
}

func (s *Service) Snapshot() (domain.LocalResourceSnapshot, error) {
	snapshot, err := s.provider.Snapshot()
	if err != nil {
		return domain.LocalResourceSnapshot{}, err
	}
	if snapshot.Timestamp == "" {
		snapshot.Timestamp = time.Now().Format(time.RFC3339)
	}
	if snapshot.Platform == "" {
		snapshot.Platform = runtime.GOOS
	}
	if snapshot.Status == "" {
		snapshot.Status = "online"
	}
	return snapshot, nil
}
