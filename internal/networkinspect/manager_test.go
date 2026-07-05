package networkinspect

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"serverpilot/internal/domain"
)

type fakeNetworkTransport struct {
	mu       sync.Mutex
	output   string
	err      error
	commands []string
	closed   bool
}

func (t *fakeNetworkTransport) Run(ctx context.Context, command string) (string, error) {
	t.mu.Lock()
	t.commands = append(t.commands, command)
	t.mu.Unlock()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}
	if t.err != nil {
		return "", t.err
	}
	return t.output, nil
}

func (t *fakeNetworkTransport) Fingerprint() string {
	return "SHA256:test"
}

func (t *fakeNetworkTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	return nil
}

func TestManagerSnapshotUsesContextAndClosesTransport(t *testing.T) {
	transport := &fakeNetworkTransport{output: strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
	}, "\n")}
	manager := NewWithDialer(context.Background(), nil, func() time.Duration { return time.Second }, func(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (Transport, time.Duration, error) {
		if connection.ID != 7 {
			t.Fatalf("connection id = %d", connection.ID)
		}
		return transport, 0, nil
	})
	opened, err := manager.Open(7)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := manager.Snapshot(domain.Connection{ID: 7}, domain.AuthRequest{}, domain.NetworkEndpointSnapshotRequest{
		ServerID:  7,
		ContextID: opened.ContextID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.TotalListeners != 1 || snapshot.Strategy != "ss" {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if manager.ContextCount(7) != 1 {
		t.Fatalf("context count = %d", manager.ContextCount(7))
	}
	transport.mu.Lock()
	closed := transport.closed
	commandCount := len(transport.commands)
	command := ""
	if commandCount > 0 {
		command = transport.commands[0]
	}
	transport.mu.Unlock()
	if !closed {
		t.Fatal("transport was not closed")
	}
	if commandCount != 1 || !strings.Contains(command, "__SPNI_STRATEGY__") {
		t.Fatalf("commands = %v %q", commandCount, command)
	}
}

func TestManagerSnapshotHostScopeSkipsDockerCommand(t *testing.T) {
	transport := &fakeNetworkTransport{output: strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
	}, "\n")}
	manager := NewWithDialer(context.Background(), nil, func() time.Duration { return time.Second }, func(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
	opened, err := manager.Open(7)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Snapshot(domain.Connection{ID: 7}, domain.AuthRequest{}, domain.NetworkEndpointSnapshotRequest{
		ServerID:  7,
		ContextID: opened.ContextID,
		Scope:     "host",
	}); err != nil {
		t.Fatal(err)
	}
	transport.mu.Lock()
	command := ""
	if len(transport.commands) > 0 {
		command = transport.commands[0]
	}
	transport.mu.Unlock()
	for _, forbidden := range []string{"emit_docker_snapshot", "find_tool docker", "docker ps", "nsenter", "docker inspect"} {
		if strings.Contains(command, forbidden) {
			t.Fatalf("host scope command should skip docker collection %q:\n%s", forbidden, command)
		}
	}
	if !strings.Contains(command, "__SPNI_ESTABLISHED") || !strings.Contains(command, "__SPNI_SOCKET_SUMMARY__") {
		t.Fatalf("host scope command should still collect host connection metrics:\n%s", command)
	}
}

func TestManagerCloseAndStopServerRejectLateSnapshots(t *testing.T) {
	manager := NewWithDialer(context.Background(), nil, nil, func(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (Transport, time.Duration, error) {
		return &fakeNetworkTransport{output: ""}, 0, nil
	})
	first, err := manager.Open(1)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Open(2)
	if err != nil {
		t.Fatal(err)
	}
	manager.Close(domain.CloseNetworkInspectionContextRequest{ServerID: 1, ContextID: first.ContextID})
	if manager.ContextCount(1) != 0 || manager.ContextCount(2) != 1 {
		t.Fatalf("context counts after close: server1=%d server2=%d", manager.ContextCount(1), manager.ContextCount(2))
	}
	if _, err := manager.Snapshot(domain.Connection{ID: 1}, domain.AuthRequest{}, domain.NetworkEndpointSnapshotRequest{ServerID: 1, ContextID: first.ContextID}); err == nil {
		t.Fatal("expected closed context snapshot to fail")
	}
	manager.StopServer(2)
	if manager.ContextCount(2) != 0 {
		t.Fatalf("server 2 context count = %d", manager.ContextCount(2))
	}
	if _, err := manager.Snapshot(domain.Connection{ID: 2}, domain.AuthRequest{}, domain.NetworkEndpointSnapshotRequest{ServerID: 2, ContextID: second.ContextID}); err == nil {
		t.Fatal("expected stopped context snapshot to fail")
	}
}

func TestManagerSnapshotFailureDoesNotStopContext(t *testing.T) {
	manager := NewWithDialer(context.Background(), nil, nil, func(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (Transport, time.Duration, error) {
		return &fakeNetworkTransport{err: errors.New("permission denied")}, 0, nil
	})
	opened, err := manager.Open(9)
	if err != nil {
		t.Fatal(err)
	}
	_, err = manager.Snapshot(domain.Connection{ID: 9}, domain.AuthRequest{}, domain.NetworkEndpointSnapshotRequest{
		ServerID:  9,
		ContextID: opened.ContextID,
	})
	if err == nil {
		t.Fatal("expected snapshot error")
	}
	if manager.ContextCount(9) != 1 {
		t.Fatalf("snapshot failure should not close context, count=%d", manager.ContextCount(9))
	}
}
