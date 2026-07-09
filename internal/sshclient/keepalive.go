package sshclient

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"hostdeck/internal/domain"
)

const KeepaliveRequestName = "keepalive@openssh.com"

var ErrKeepaliveFailed = errors.New("ssh keepalive failed")

type KeepalivePolicy struct {
	Enabled     bool
	Interval    time.Duration
	Timeout     time.Duration
	MaxFailures int
}

type KeepaliveMetadata struct {
	ServerID  int64
	Subsystem string
	SessionID string
	ContextID string
	TunnelID  string
	TaskID    string
}

type KeepaliveFailure struct {
	Metadata     KeepaliveMetadata
	FailureCount int
	Err          error
	TimedOut     bool
}

type KeepaliveFailureHandler func(KeepaliveFailure)

type KeepaliveRequester interface {
	SendRequest(name string, wantReply bool, payload []byte) (bool, []byte, error)
	Close() error
}

type KeepaliveHandle struct {
	stop     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
}

func PolicyFromSettings(settings domain.AppSettings) KeepalivePolicy {
	return KeepalivePolicy{
		Enabled:     settings.SSHKeepaliveEnabled,
		Interval:    time.Duration(settings.SSHKeepaliveIntervalSeconds) * time.Second,
		Timeout:     time.Duration(settings.SSHKeepaliveTimeoutSeconds) * time.Second,
		MaxFailures: settings.SSHKeepaliveMaxFailures,
	}
}

func StartKeepalive(
	ctx context.Context,
	requester KeepaliveRequester,
	policy KeepalivePolicy,
	metadata KeepaliveMetadata,
	onFailure KeepaliveFailureHandler,
) *KeepaliveHandle {
	handle := &KeepaliveHandle{
		stop: make(chan struct{}),
		done: make(chan struct{}),
	}
	policy = normalizeKeepalivePolicy(policy)
	if ctx == nil {
		ctx = context.Background()
	}
	if requester == nil || !policy.Enabled {
		close(handle.done)
		return handle
	}
	go runKeepalive(ctx, requester, policy, metadata, onFailure, handle)
	return handle
}

func (h *KeepaliveHandle) Stop() {
	if h == nil {
		return
	}
	h.stopOnce.Do(func() {
		close(h.stop)
	})
}

func (h *KeepaliveHandle) Done() <-chan struct{} {
	if h == nil {
		done := make(chan struct{})
		close(done)
		return done
	}
	return h.done
}

type keepaliveResult struct {
	ok  bool
	err error
}

func runKeepalive(
	ctx context.Context,
	requester KeepaliveRequester,
	policy KeepalivePolicy,
	metadata KeepaliveMetadata,
	onFailure KeepaliveFailureHandler,
	handle *KeepaliveHandle,
) {
	defer close(handle.done)
	timer := time.NewTimer(policy.Interval)
	defer timer.Stop()
	var pending <-chan keepaliveResult
	var timeoutTimer *time.Timer
	var timeoutC <-chan time.Time
	timedOutCurrentRequest := false
	failures := 0

	stopTimeout := func() {
		if timeoutTimer == nil {
			return
		}
		if !timeoutTimer.Stop() {
			select {
			case <-timeoutTimer.C:
			default:
			}
		}
		timeoutTimer = nil
		timeoutC = nil
	}
	resetTimer := func(duration time.Duration) {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(duration)
	}
	startRequest := func() {
		resultCh := make(chan keepaliveResult, 1)
		pending = resultCh
		timedOutCurrentRequest = false
		timeoutTimer = time.NewTimer(policy.Timeout)
		timeoutC = timeoutTimer.C
		go func() {
			ok, _, err := requester.SendRequest(KeepaliveRequestName, true, nil)
			resultCh <- keepaliveResult{ok: ok, err: err}
		}()
	}
	fail := func(err error, timedOut bool, counted bool) bool {
		if counted {
			failures++
		}
		if failures < policy.MaxFailures {
			return false
		}
		if onFailure != nil {
			onFailure(KeepaliveFailure{
				Metadata:     metadata,
				FailureCount: failures,
				Err:          keepaliveFailureError(err, timedOut),
				TimedOut:     timedOut,
			})
		}
		_ = requester.Close()
		return true
	}

	for {
		if pending == nil {
			select {
			case <-ctx.Done():
				return
			case <-handle.stop:
				return
			case <-timer.C:
				startRequest()
			}
			continue
		}

		select {
		case <-ctx.Done():
			stopTimeout()
			return
		case <-handle.stop:
			stopTimeout()
			return
		case result := <-pending:
			stopTimeout()
			pending = nil
			if result.err != nil {
				if fail(result.err, false, !timedOutCurrentRequest) {
					return
				}
			} else {
				// ok=false only means the server rejected this global request. The
				// transport still replied, so the connection is alive.
				failures = 0
			}
			resetTimer(policy.Interval)
		case <-timeoutC:
			timeoutTimer = nil
			timeoutC = nil
			timedOutCurrentRequest = true
			if fail(context.DeadlineExceeded, true, true) {
				return
			}
			timeoutTimer = time.NewTimer(policy.Interval)
			timeoutC = timeoutTimer.C
		}
	}
}

func normalizeKeepalivePolicy(policy KeepalivePolicy) KeepalivePolicy {
	if policy.Interval <= 0 {
		policy.Interval = time.Duration(domain.DefaultSSHKeepaliveIntervalSeconds) * time.Second
	}
	if policy.Timeout <= 0 {
		policy.Timeout = time.Duration(domain.DefaultSSHKeepaliveTimeoutSeconds) * time.Second
	}
	if policy.MaxFailures <= 0 {
		policy.MaxFailures = domain.DefaultSSHKeepaliveMaxFailures
	}
	return policy
}

func keepaliveFailureError(err error, timedOut bool) error {
	if timedOut {
		return fmt.Errorf("%w: request timed out", ErrKeepaliveFailed)
	}
	if err == nil {
		return ErrKeepaliveFailed
	}
	return fmt.Errorf("%w: %v", ErrKeepaliveFailed, err)
}
