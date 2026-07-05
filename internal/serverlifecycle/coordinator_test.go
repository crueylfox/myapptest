package serverlifecycle

import (
	"sync"
	"testing"
)

type fakeMonitor struct {
	mu      sync.Mutex
	active  map[int64]bool
	stopped []int64
}

func (m *fakeMonitor) Stop(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeTerminal struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeTerminal) StopConnection(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeSFTP struct {
	mu      sync.Mutex
	active  map[int64]bool
	stopped []int64
}

func (m *fakeSFTP) Stop(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeTunnel struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeTunnel) StopServer(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeDocker struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeDocker) StopServer(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeProcess struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeProcess) StopServer(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeBatchCommand struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeBatchCommand) StopServer(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeServiceManager struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeServiceManager) StopServer(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeNetworkInspection struct {
	mu      sync.Mutex
	active  map[int64]int
	stopped []int64
}

func (m *fakeNetworkInspection) StopServer(connectionID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, connectionID)
	m.stopped = append(m.stopped, connectionID)
}

type fakeStates struct {
	mu       sync.Mutex
	begin    []int64
	complete []int64
}

func (s *fakeStates) BeginDisconnect(connectionID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.begin = append(s.begin, connectionID)
}

func (s *fakeStates) CompleteDisconnect(connectionID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.complete = append(s.complete, connectionID)
}

func TestDisconnectStopsOnlyTargetServerAndIsIdempotent(t *testing.T) {
	monitor := &fakeMonitor{active: map[int64]bool{1: true, 2: true}}
	terminal := &fakeTerminal{active: map[int64]int{1: 2, 2: 1}}
	sftp := &fakeSFTP{active: map[int64]bool{1: true, 2: true}}
	tunnel := &fakeTunnel{active: map[int64]int{1: 1, 2: 2}}
	docker := &fakeDocker{active: map[int64]int{1: 1, 2: 2}}
	process := &fakeProcess{active: map[int64]int{1: 1, 2: 2}}
	batch := &fakeBatchCommand{active: map[int64]int{1: 1, 2: 2}}
	service := &fakeServiceManager{active: map[int64]int{1: 1, 2: 2}}
	network := &fakeNetworkInspection{active: map[int64]int{1: 1, 2: 2}}
	states := &fakeStates{}
	coordinator := New(monitor, terminal, sftp, tunnel, docker, process, batch, service, network, states)

	coordinator.Disconnect(2)
	coordinator.Disconnect(2)

	if monitor.active[2] || terminal.active[2] != 0 || sftp.active[2] || tunnel.active[2] != 0 || docker.active[2] != 0 || process.active[2] != 0 || batch.active[2] != 0 || service.active[2] != 0 || network.active[2] != 0 {
		t.Fatal("target server resources remain active")
	}
	if !monitor.active[1] || terminal.active[1] != 2 || !sftp.active[1] || tunnel.active[1] != 1 || docker.active[1] != 1 || process.active[1] != 1 || batch.active[1] != 1 || service.active[1] != 1 || network.active[1] != 1 {
		t.Fatal("disconnect affected another server")
	}
	if len(states.begin) != 2 || len(states.complete) != 2 {
		t.Fatalf("disconnect lifecycle calls = begin %v complete %v", states.begin, states.complete)
	}
	if len(docker.stopped) != 2 || docker.stopped[0] != 2 || docker.stopped[1] != 2 {
		t.Fatalf("docker stops = %v", docker.stopped)
	}
	if len(process.stopped) != 2 || process.stopped[0] != 2 || process.stopped[1] != 2 {
		t.Fatalf("process stops = %v", process.stopped)
	}
	if len(batch.stopped) != 2 || batch.stopped[0] != 2 || batch.stopped[1] != 2 {
		t.Fatalf("batch stops = %v", batch.stopped)
	}
	if len(service.stopped) != 2 || service.stopped[0] != 2 || service.stopped[1] != 2 {
		t.Fatalf("service stops = %v", service.stopped)
	}
	if len(network.stopped) != 2 || network.stopped[0] != 2 || network.stopped[1] != 2 {
		t.Fatalf("network inspection stops = %v", network.stopped)
	}
}
