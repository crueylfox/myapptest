package sshclient

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeKeepaliveResponse struct {
	ok    bool
	err   error
	block bool
}

type fakeKeepaliveRequester struct {
	mu        sync.Mutex
	responses []fakeKeepaliveResponse
	calls     int
	closed    int
	closeCh   chan struct{}
	closeOnce sync.Once
}

func newFakeKeepaliveRequester(responses ...fakeKeepaliveResponse) *fakeKeepaliveRequester {
	return &fakeKeepaliveRequester{
		responses: responses,
		closeCh:   make(chan struct{}),
	}
}

func (r *fakeKeepaliveRequester) SendRequest(name string, wantReply bool, payload []byte) (bool, []byte, error) {
	if name != KeepaliveRequestName {
		return false, nil, errors.New("unexpected request name")
	}
	if !wantReply {
		return false, nil, errors.New("wantReply must be true")
	}
	r.mu.Lock()
	r.calls++
	response := fakeKeepaliveResponse{ok: true}
	if len(r.responses) > 0 {
		response = r.responses[0]
		r.responses = r.responses[1:]
	}
	r.mu.Unlock()
	if response.block {
		<-r.closeCh
		return false, nil, errors.New("client closed")
	}
	return response.ok, nil, response.err
}

func (r *fakeKeepaliveRequester) Close() error {
	r.mu.Lock()
	r.closed++
	r.mu.Unlock()
	r.closeOnce.Do(func() {
		close(r.closeCh)
	})
	return nil
}

func (r *fakeKeepaliveRequester) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

func (r *fakeKeepaliveRequester) closeCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closed
}

func testPolicy() KeepalivePolicy {
	return KeepalivePolicy{
		Enabled:     true,
		Interval:    time.Millisecond,
		Timeout:     5 * time.Millisecond,
		MaxFailures: 2,
	}
}

func waitForDone(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("keepalive did not finish")
	}
}

func TestStartKeepaliveDisabledDoesNotStartLoop(t *testing.T) {
	requester := newFakeKeepaliveRequester()
	handle := StartKeepalive(context.Background(), requester, KeepalivePolicy{Enabled: false}, KeepaliveMetadata{}, nil)
	waitForDone(t, handle.Done())
	if requester.callCount() != 0 {
		t.Fatalf("SendRequest calls = %d", requester.callCount())
	}
}

func TestStartKeepaliveSuccessDoesNotFail(t *testing.T) {
	requester := newFakeKeepaliveRequester(fakeKeepaliveResponse{ok: true})
	failed := make(chan KeepaliveFailure, 1)
	handle := StartKeepalive(context.Background(), requester, testPolicy(), KeepaliveMetadata{ServerID: 1, Subsystem: "terminal"}, func(failure KeepaliveFailure) {
		failed <- failure
	})
	for requester.callCount() == 0 {
		time.Sleep(time.Millisecond)
	}
	handle.Stop()
	waitForDone(t, handle.Done())
	select {
	case failure := <-failed:
		t.Fatalf("unexpected failure: %+v", failure)
	default:
	}
	if requester.closeCount() != 0 {
		t.Fatalf("Close calls = %d", requester.closeCount())
	}
}

func TestStartKeepaliveRejectedRequestIsNotFailure(t *testing.T) {
	requester := newFakeKeepaliveRequester(fakeKeepaliveResponse{ok: false})
	failed := make(chan KeepaliveFailure, 1)
	handle := StartKeepalive(context.Background(), requester, testPolicy(), KeepaliveMetadata{ServerID: 1, Subsystem: "monitor"}, func(failure KeepaliveFailure) {
		failed <- failure
	})
	for requester.callCount() == 0 {
		time.Sleep(time.Millisecond)
	}
	handle.Stop()
	waitForDone(t, handle.Done())
	select {
	case failure := <-failed:
		t.Fatalf("ok=false should not fail: %+v", failure)
	default:
	}
}

func TestStartKeepaliveErrorThresholdCallsFailureAndClosesClient(t *testing.T) {
	requester := newFakeKeepaliveRequester(
		fakeKeepaliveResponse{err: errors.New("temporary failure")},
		fakeKeepaliveResponse{err: errors.New("temporary failure")},
	)
	failed := make(chan KeepaliveFailure, 1)
	handle := StartKeepalive(context.Background(), requester, testPolicy(), KeepaliveMetadata{ServerID: 7, Subsystem: "sftp"}, func(failure KeepaliveFailure) {
		failed <- failure
	})
	waitForDone(t, handle.Done())
	select {
	case failure := <-failed:
		if failure.Metadata.ServerID != 7 || failure.Metadata.Subsystem != "sftp" || failure.FailureCount != 2 {
			t.Fatalf("failure metadata = %+v", failure)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("failure callback was not called")
	}
	if requester.closeCount() != 1 {
		t.Fatalf("Close calls = %d", requester.closeCount())
	}
}

func TestStartKeepaliveTimeoutThresholdCallsFailureAndClosesClient(t *testing.T) {
	policy := testPolicy()
	policy.Interval = 2 * time.Millisecond
	policy.Timeout = 2 * time.Millisecond
	requester := newFakeKeepaliveRequester(fakeKeepaliveResponse{block: true})
	failed := make(chan KeepaliveFailure, 1)
	handle := StartKeepalive(context.Background(), requester, policy, KeepaliveMetadata{ServerID: 9, Subsystem: "tunnel"}, func(failure KeepaliveFailure) {
		failed <- failure
	})
	waitForDone(t, handle.Done())
	select {
	case failure := <-failed:
		if !failure.TimedOut || failure.FailureCount != 2 {
			t.Fatalf("timeout failure = %+v", failure)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("failure callback was not called")
	}
	if requester.closeCount() != 1 {
		t.Fatalf("Close calls = %d", requester.closeCount())
	}
}

func TestStartKeepaliveContextCancelStopsQuietly(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	requester := newFakeKeepaliveRequester()
	handle := StartKeepalive(ctx, requester, testPolicy(), KeepaliveMetadata{}, func(KeepaliveFailure) {
		t.Fatal("unexpected failure")
	})
	cancel()
	waitForDone(t, handle.Done())
	if requester.closeCount() != 0 {
		t.Fatalf("Close calls = %d", requester.closeCount())
	}
}

func TestKeepaliveHandleStopIsIdempotent(t *testing.T) {
	requester := newFakeKeepaliveRequester()
	handle := StartKeepalive(context.Background(), requester, testPolicy(), KeepaliveMetadata{}, nil)
	handle.Stop()
	handle.Stop()
	waitForDone(t, handle.Done())
}
