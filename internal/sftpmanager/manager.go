package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"strings"
	"sync"
	"time"

	pkgsftp "github.com/pkg/sftp"

	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
	"hostdeck/internal/sshclient"
)

const (
	transferBufferSize      = 256 * 1024
	defaultTextEditorLimit  = 1024 * 1024
	defaultTextPreviewLimit = 2 * 1024 * 1024
)

var ErrSessionActive = errors.New("sftp session is already active")

func normalizeContextID(connectionID int64, contextID string) string {
	contextID = strings.TrimSpace(contextID)
	if contextID == "" {
		return fmt.Sprintf("server:%d", connectionID)
	}
	return contextID
}

func sftpSessionKey(connectionID int64, contextID string) string {
	return fmt.Sprintf("%d\x00%s", connectionID, normalizeContextID(connectionID, contextID))
}

func sftpRequestID(requestID string) string {
	requestID = strings.TrimSpace(requestID)
	if requestID != "" {
		return requestID
	}
	return randomID()
}

type HostKeySaver func(context.Context, int64, string) error
type CredentialCommitter func(context.Context, domain.Connection, domain.AuthRequest) error
type TimeoutProvider func() time.Duration
type Dialer func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error)
type KeepalivePolicyProvider func() sshclient.KeepalivePolicy

type keepaliveStarter interface {
	StartKeepalive(context.Context, sshclient.KeepalivePolicy, sshclient.KeepaliveMetadata, sshclient.KeepaliveFailureHandler) *sshclient.KeepaliveHandle
}

type Emitter interface {
	State(domain.SFTPState)
	Entries(domain.SFTPListResult)
	Transfer(domain.SFTPTransferState)
	Error(domain.SFTPErrorEvent)
}

type RemoteFile interface {
	io.Reader
	io.Writer
	io.Seeker
	io.Closer
}

type Client interface {
	Getwd() (string, error)
	ReadDir(context.Context, string) ([]fs.FileInfo, error)
	Stat(string) (fs.FileInfo, error)
	Lstat(string) (fs.FileInfo, error)
	Open(string) (RemoteFile, error)
	OpenFile(string, int) (RemoteFile, error)
	Create(string) (RemoteFile, error)
	Chmod(string, fs.FileMode) error
	Mkdir(string) error
	Remove(string) error
	RemoveDirectory(string) error
	Rename(string, string) error
	PosixRename(string, string) error
	Close() error
}

type RemoteCommand interface {
	Stdin() io.WriteCloser
	Stdout() io.Reader
	Wait() error
	Close() error
}

type Transport interface {
	OpenSFTP() (Client, error)
	StartCommand(context.Context, string) (RemoteCommand, error)
	Fingerprint() string
	Close() error
}

type realTransport struct {
	client *sshclient.Client
}

func (t realTransport) OpenSFTP() (Client, error) {
	client, err := t.client.OpenSFTP()
	if err != nil {
		return nil, err
	}
	return sftpClientAdapter{client: client}, nil
}

func (t realTransport) StartCommand(ctx context.Context, command string) (RemoteCommand, error) {
	return t.client.StartCommand(ctx, command)
}

func (t realTransport) Fingerprint() string {
	return t.client.Fingerprint()
}

func (t realTransport) Close() error {
	return t.client.Close()
}

func (t realTransport) StartKeepalive(
	ctx context.Context,
	policy sshclient.KeepalivePolicy,
	metadata sshclient.KeepaliveMetadata,
	onFailure sshclient.KeepaliveFailureHandler,
) *sshclient.KeepaliveHandle {
	return t.client.StartKeepalive(ctx, policy, metadata, onFailure)
}

type sftpClientAdapter struct {
	client *pkgsftp.Client
}

func (c sftpClientAdapter) Getwd() (string, error) {
	return c.client.Getwd()
}

func (c sftpClientAdapter) ReadDir(ctx context.Context, remotePath string) ([]fs.FileInfo, error) {
	return c.client.ReadDirContext(ctx, remotePath)
}

func (c sftpClientAdapter) Stat(remotePath string) (fs.FileInfo, error) {
	return c.client.Stat(remotePath)
}

func (c sftpClientAdapter) Lstat(remotePath string) (fs.FileInfo, error) {
	return c.client.Lstat(remotePath)
}

func (c sftpClientAdapter) Open(remotePath string) (RemoteFile, error) {
	return c.client.Open(remotePath)
}

func (c sftpClientAdapter) OpenFile(remotePath string, flag int) (RemoteFile, error) {
	return c.client.OpenFile(remotePath, flag)
}

func (c sftpClientAdapter) Create(remotePath string) (RemoteFile, error) {
	return c.client.Create(remotePath)
}

func (c sftpClientAdapter) Chmod(remotePath string, mode fs.FileMode) error {
	return c.client.Chmod(remotePath, mode)
}

func (c sftpClientAdapter) Mkdir(remotePath string) error {
	return c.client.Mkdir(remotePath)
}

func (c sftpClientAdapter) Remove(remotePath string) error {
	return c.client.Remove(remotePath)
}

func (c sftpClientAdapter) RemoveDirectory(remotePath string) error {
	return c.client.RemoveDirectory(remotePath)
}

func (c sftpClientAdapter) Rename(oldPath, newPath string) error {
	return c.client.Rename(oldPath, newPath)
}

func (c sftpClientAdapter) PosixRename(oldPath, newPath string) error {
	return c.client.PosixRename(oldPath, newPath)
}

func (c sftpClientAdapter) Close() error {
	return c.client.Close()
}

type Manager struct {
	ctx         context.Context
	logger      *logging.Logger
	emitter     Emitter
	dial        Dialer
	saveHostKey HostKeySaver
	commitAuth  CredentialCommitter
	timeout     TimeoutProvider
	keepalive   KeepalivePolicyProvider
	mu          sync.RWMutex
	sessions    map[string]*session
	states      map[string]domain.SFTPState
	transfers   map[string]*transfer
	generations map[string]int64
}

type session struct {
	connectionID      int64
	contextID         string
	terminalSessionID string
	generation        int64
	mode              domain.SFTPMode
	ctx               context.Context
	cancel            context.CancelFunc
	transport         Transport
	client            Client
	slot              chan struct{}
	mu                sync.RWMutex
	currentPath       string
	homePath          string
	closed            bool
}

type transfer struct {
	cancel         context.CancelFunc
	conflictPolicy domain.SFTPConflictPolicy
	state          domain.SFTPTransferState
	resumeCh       chan struct{}
	mu             sync.RWMutex
}

func New(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	saveHostKey HostKeySaver,
	commitAuth CredentialCommitter,
	timeout TimeoutProvider,
) *Manager {
	manager := NewWithDialer(ctx, logger, emitter, timeout, func(
		ctx context.Context,
		connection domain.Connection,
		auth domain.AuthRequest,
		timeout time.Duration,
	) (Transport, time.Duration, error) {
		client, latency, err := sshclient.Dial(ctx, connection, auth, timeout)
		if err != nil {
			return nil, 0, err
		}
		return realTransport{client: client}, latency, nil
	})
	manager.saveHostKey = saveHostKey
	manager.commitAuth = commitAuth
	return manager
}

func NewWithDialer(
	ctx context.Context,
	logger *logging.Logger,
	emitter Emitter,
	timeout TimeoutProvider,
	dialer Dialer,
) *Manager {
	if timeout == nil {
		timeout = func() time.Duration { return 15 * time.Second }
	}
	return &Manager{
		ctx:         ctx,
		logger:      logger,
		emitter:     emitter,
		dial:        dialer,
		timeout:     timeout,
		sessions:    make(map[string]*session),
		states:      make(map[string]domain.SFTPState),
		transfers:   make(map[string]*transfer),
		generations: make(map[string]int64),
	}
}
