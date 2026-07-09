package sshclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"hostdeck/internal/domain"
)

var ErrUnknownHostKey = errors.New("unknown SSH host key")
var errHostKeyObserved = errors.New("SSH host key observed")

type UnknownHostKeyError struct {
	Observed string
}

func (e *UnknownHostKeyError) Error() string {
	return fmt.Sprintf("SSH host is not trusted; observed fingerprint: %s", e.Observed)
}

func (e *UnknownHostKeyError) Unwrap() error {
	return ErrUnknownHostKey
}

func (e *UnknownHostKeyError) HostKeyFingerprints() (string, string) {
	return "", e.Observed
}

type HostKeyChangedError struct {
	Expected string
	Observed string
}

func (e *HostKeyChangedError) Error() string {
	return fmt.Sprintf(
		"SSH host key changed; saved fingerprint: %s; received fingerprint: %s",
		e.Expected,
		e.Observed,
	)
}

func (e *HostKeyChangedError) HostKeyFingerprints() (string, string) {
	return e.Expected, e.Observed
}

type Client struct {
	client      *ssh.Client
	fingerprint string
	cleanup     func() error
	mu          sync.Mutex
	keepalive   *KeepaliveHandle
}

type DirectDialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (*Client, time.Duration, error)
type RouteDialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration, DirectDialer) (*Client, time.Duration, error)

var routeDialer struct {
	mu sync.RWMutex
	fn RouteDialer
}

type CommandSession struct {
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	stderr  *bytes.Buffer
	done    chan struct{}
	once    sync.Once
}

type StreamingCommand interface {
	Stdout() io.Reader
	Stderr() io.Reader
	Wait() error
	Close() error
}

type StreamingCommandSession struct {
	session *ssh.Session
	stdout  io.Reader
	stderr  io.Reader
	done    chan struct{}
	once    sync.Once
}

func Dial(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (*Client, time.Duration, error) {
	routeDialer.mu.RLock()
	dialRoute := routeDialer.fn
	routeDialer.mu.RUnlock()
	if dialRoute != nil && connection.ConnectionMode == domain.ConnectionModeJump {
		return dialRoute(ctx, connection, auth, timeout, dialDirect)
	}
	return dialDirect(ctx, connection, auth, timeout)
}

func SetRouteDialer(dialer RouteDialer) {
	routeDialer.mu.Lock()
	routeDialer.fn = dialer
	routeDialer.mu.Unlock()
}

func dialDirect(ctx context.Context, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (*Client, time.Duration, error) {
	address := net.JoinHostPort(connection.Host, fmt.Sprintf("%d", connection.Port))
	netConn, err := (&net.Dialer{Timeout: timeout, KeepAlive: 15 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, 0, fmt.Errorf("dial SSH server: %w", err)
	}
	client, latency, err := DialOnConn(ctx, connection, auth, netConn, address, timeout)
	if err != nil {
		_ = netConn.Close()
		return nil, 0, err
	}
	return client, latency, nil
}

func DialThrough(ctx context.Context, jump *Client, connection domain.Connection, auth domain.AuthRequest, timeout time.Duration) (*Client, time.Duration, error) {
	if jump == nil {
		return nil, 0, errors.New("jump SSH client is required")
	}
	address := net.JoinHostPort(connection.Host, fmt.Sprintf("%d", connection.Port))
	type dialResult struct {
		conn net.Conn
		err  error
	}
	dialDone := make(chan dialResult, 1)
	go func() {
		conn, err := jump.DialTCP(address)
		dialDone <- dialResult{conn: conn, err: err}
	}()
	var netConn net.Conn
	select {
	case <-ctx.Done():
		_ = jump.Close()
		return nil, 0, ctx.Err()
	case result := <-dialDone:
		if result.err != nil {
			_ = jump.Close()
			return nil, 0, fmt.Errorf("dial target through jump host: %w", result.err)
		}
		netConn = result.conn
	}
	client, latency, err := DialOnConn(ctx, connection, auth, netConn, address, timeout)
	if err != nil {
		_ = netConn.Close()
		_ = jump.Close()
		return nil, 0, err
	}
	client.cleanup = jump.Close
	return client, latency, nil
}

func DialOnConn(
	ctx context.Context,
	connection domain.Connection,
	auth domain.AuthRequest,
	netConn net.Conn,
	address string,
	timeout time.Duration,
) (*Client, time.Duration, error) {
	authMethod, err := authenticationMethod(connection, auth)
	if err != nil {
		return nil, 0, err
	}
	var observedFingerprint string
	hostKeyCallback := verifyHostKey(connection, auth.TrustUnknownHost, auth.TrustChangedHost, &observedFingerprint)
	config := &ssh.ClientConfig{
		User:            connection.Username,
		Auth:            []ssh.AuthMethod{authMethod},
		HostKeyCallback: hostKeyCallback,
		Timeout:         timeout,
	}
	started := time.Now()
	deadline := time.Now().Add(timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	_ = netConn.SetDeadline(deadline)
	conn, channels, requests, err := ssh.NewClientConn(netConn, address, config)
	if err != nil {
		return nil, 0, fmt.Errorf("SSH handshake: %w", err)
	}
	_ = netConn.SetDeadline(time.Time{})
	return &Client{client: ssh.NewClient(conn, channels, requests), fingerprint: observedFingerprint}, time.Since(started), nil
}

func ApplyHostKeyPolicy(
	policy domain.HostKeyPolicy,
	connection domain.Connection,
	auth domain.AuthRequest,
) domain.AuthRequest {
	switch policy {
	case domain.HostKeyStrict:
		auth.TrustUnknownHost = false
		auth.TrustChangedHost = false
		auth.PersistHostKey = false
	case domain.HostKeyAutoUpdate,
		"",
		domain.HostKeyAsk,
		domain.HostKeyTrustOnFirstUse,
		domain.HostKeyTrustedOnly:
		auth.TrustUnknownHost = true
		auth.TrustChangedHost = true
		auth.PersistHostKey = true
	}
	return auth
}

func ShouldPersistObservedHostKey(connection domain.Connection, auth domain.AuthRequest, observed string) bool {
	return auth.PersistHostKey && observed != "" && observed != connection.HostKeyFingerprint
}

func ProbeHostKey(
	ctx context.Context,
	connection domain.Connection,
	timeout time.Duration,
) (string, error) {
	address := net.JoinHostPort(connection.Host, fmt.Sprintf("%d", connection.Port))
	netConn, err := (&net.Dialer{Timeout: timeout, KeepAlive: 15 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return "", fmt.Errorf("dial SSH server: %w", err)
	}
	defer netConn.Close()
	return ProbeHostKeyOnConn(ctx, connection, netConn, address, timeout)
}

func ProbeHostKeyThrough(
	ctx context.Context,
	jump *Client,
	connection domain.Connection,
	timeout time.Duration,
) (string, error) {
	if jump == nil {
		return "", errors.New("jump SSH client is required")
	}
	address := net.JoinHostPort(connection.Host, fmt.Sprintf("%d", connection.Port))
	type dialResult struct {
		conn net.Conn
		err  error
	}
	dialDone := make(chan dialResult, 1)
	go func() {
		conn, err := jump.DialTCP(address)
		dialDone <- dialResult{conn: conn, err: err}
	}()
	var netConn net.Conn
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case result := <-dialDone:
		if result.err != nil {
			return "", fmt.Errorf("dial target through jump host: %w", result.err)
		}
		netConn = result.conn
	}
	defer netConn.Close()
	return ProbeHostKeyOnConn(ctx, connection, netConn, address, timeout)
}

func ProbeHostKeyOnConn(
	ctx context.Context,
	connection domain.Connection,
	netConn net.Conn,
	address string,
	timeout time.Duration,
) (string, error) {
	deadline := time.Now().Add(timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	_ = netConn.SetDeadline(deadline)
	var fingerprint string
	config := &ssh.ClientConfig{
		User: connection.Username,
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			fingerprint = ssh.FingerprintSHA256(key)
			return errHostKeyObserved
		},
		Timeout: timeout,
	}
	_, _, _, err := ssh.NewClientConn(netConn, address, config)
	if fingerprint != "" && errors.Is(err, errHostKeyObserved) {
		return fingerprint, nil
	}
	if err != nil {
		return "", fmt.Errorf("SSH handshake: %w", err)
	}
	return fingerprint, nil
}

func verifyHostKey(
	connection domain.Connection,
	trustUnknown bool,
	trustChanged bool,
	observedFingerprint *string,
) ssh.HostKeyCallback {
	return func(_ string, _ net.Addr, key ssh.PublicKey) error {
		observed := ssh.FingerprintSHA256(key)
		*observedFingerprint = observed
		if connection.HostKeyFingerprint == "" {
			if trustUnknown {
				return nil
			}
			return &UnknownHostKeyError{Observed: observed}
		}
		if observed != connection.HostKeyFingerprint {
			if trustChanged {
				return nil
			}
			return &HostKeyChangedError{
				Expected: connection.HostKeyFingerprint,
				Observed: observed,
			}
		}
		return nil
	}
}

func authenticationMethod(connection domain.Connection, auth domain.AuthRequest) (ssh.AuthMethod, error) {
	switch connection.AuthType {
	case domain.AuthPassword:
		if auth.Password == "" {
			return nil, errors.New("password is required")
		}
		return ssh.Password(auth.Password), nil
	case domain.AuthPrivateKey:
		keyBytes := auth.ResolvedPrivateKeyPEM
		if len(keyBytes) == 0 {
			privateKeyPath := auth.ResolvedPrivateKeyPath
			if privateKeyPath == "" {
				privateKeyPath = connection.PrivateKeyPath
			}
			var err error
			keyBytes, err = os.ReadFile(privateKeyPath)
			if err != nil {
				return nil, fmt.Errorf("read private key: %w", err)
			}
		}
		var signer ssh.Signer
		var err error
		if auth.Passphrase != "" {
			passphrase := []byte(auth.Passphrase)
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, passphrase)
			for i := range passphrase {
				passphrase[i] = 0
			}
		} else {
			signer, err = ssh.ParsePrivateKey(keyBytes)
		}
		for i := range keyBytes {
			keyBytes[i] = 0
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return ssh.PublicKeys(signer), nil
	default:
		return nil, errors.New("unsupported authentication type")
	}
}

func (c *Client) Fingerprint() string {
	return c.fingerprint
}

func (c *Client) StartKeepalive(
	ctx context.Context,
	policy KeepalivePolicy,
	metadata KeepaliveMetadata,
	onFailure KeepaliveFailureHandler,
) *KeepaliveHandle {
	if c == nil {
		return StartKeepalive(ctx, nil, KeepalivePolicy{}, metadata, nil)
	}
	handle := StartKeepalive(ctx, c, policy, metadata, onFailure)
	c.mu.Lock()
	if c.keepalive != nil {
		c.keepalive.Stop()
	}
	c.keepalive = handle
	c.mu.Unlock()
	return handle
}

func (c *Client) SendRequest(name string, wantReply bool, payload []byte) (bool, []byte, error) {
	return c.client.SendRequest(name, wantReply, payload)
}

func (c *Client) Run(ctx context.Context, command string) (string, error) {
	session, err := c.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("create SSH session: %w", err)
	}
	defer session.Close()
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	done := make(chan error, 1)
	go func() {
		done <- session.Run(command)
	}()
	select {
	case <-ctx.Done():
		_ = session.Close()
		<-done
		return "", ctx.Err()
	case err := <-done:
		if err != nil {
			message := strings.TrimSpace(stderr.String())
			if message != "" {
				return "", fmt.Errorf("remote command failed: %s", message)
			}
			return "", fmt.Errorf("remote command failed: %w", err)
		}
		return stdout.String(), nil
	}
}

func (c *Client) StartCommand(ctx context.Context, command string) (*CommandSession, error) {
	session, err := c.client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("create SSH session: %w", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("create SSH stdin pipe: %w", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("create SSH stdout pipe: %w", err)
	}
	var stderr bytes.Buffer
	session.Stderr = &stderr
	if err := session.Start(command); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("start SSH command: %w", err)
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Close()
		case <-done:
		}
	}()
	return &CommandSession{
		session: session,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  &stderr,
		done:    done,
	}, nil
}

func (c *Client) StartStreamingCommand(ctx context.Context, command string) (StreamingCommand, error) {
	session, err := c.client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("create SSH session: %w", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("create SSH stdout pipe: %w", err)
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("create SSH stderr pipe: %w", err)
	}
	if err := session.Start(command); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("start SSH command: %w", err)
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Close()
		case <-done:
		}
	}()
	return &StreamingCommandSession{
		session: session,
		stdout:  stdout,
		stderr:  stderr,
		done:    done,
	}, nil
}

func (s *CommandSession) Stdin() io.WriteCloser {
	return s.stdin
}

func (s *CommandSession) Stdout() io.Reader {
	return s.stdout
}

func (s *CommandSession) Wait() error {
	defer s.finish()
	if err := s.session.Wait(); err != nil {
		message := strings.TrimSpace(s.stderr.String())
		if message != "" {
			return fmt.Errorf("remote command failed: %s", sanitizeRemoteCommandError(message))
		}
		return fmt.Errorf("remote command failed: %w", err)
	}
	return nil
}

func (s *CommandSession) Close() error {
	defer s.finish()
	return s.session.Close()
}

func (s *CommandSession) finish() {
	s.once.Do(func() {
		close(s.done)
	})
}

func (s *StreamingCommandSession) Stdout() io.Reader {
	return s.stdout
}

func (s *StreamingCommandSession) Stderr() io.Reader {
	return s.stderr
}

func (s *StreamingCommandSession) Wait() error {
	defer s.finish()
	if err := s.session.Wait(); err != nil {
		return fmt.Errorf("remote command failed: %w", err)
	}
	return nil
}

func (s *StreamingCommandSession) Close() error {
	defer s.finish()
	return s.session.Close()
}

func (s *StreamingCommandSession) finish() {
	s.once.Do(func() {
		close(s.done)
	})
}

func (c *Client) Close() error {
	c.mu.Lock()
	handle := c.keepalive
	c.keepalive = nil
	cleanup := c.cleanup
	c.cleanup = nil
	c.mu.Unlock()
	if handle != nil {
		handle.Stop()
	}
	err := c.client.Close()
	if cleanup != nil {
		if cleanupErr := cleanup(); err == nil {
			err = cleanupErr
		}
	}
	return err
}

func (c *Client) DialTCP(address string) (net.Conn, error) {
	return c.client.Dial("tcp", address)
}

func (c *Client) ListenTCP(address string) (net.Listener, error) {
	return c.client.Listen("tcp", address)
}

func sanitizeRemoteCommandError(message string) string {
	message = strings.ReplaceAll(message, "\r", " ")
	message = strings.ReplaceAll(message, "\n", " ")
	if len(message) > 160 {
		return message[:160] + "..."
	}
	return message
}
