package sftpmanager

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	pkgsftp "github.com/pkg/sftp"

	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
)

type fakeEmitter struct {
	state    chan domain.SFTPState
	entries  chan domain.SFTPListResult
	transfer chan domain.SFTPTransferState
	errors   chan domain.SFTPErrorEvent
}

func newFakeEmitter() fakeEmitter {
	return fakeEmitter{
		state:    make(chan domain.SFTPState, 16),
		entries:  make(chan domain.SFTPListResult, 16),
		transfer: make(chan domain.SFTPTransferState, 32),
		errors:   make(chan domain.SFTPErrorEvent, 16),
	}
}

func (e fakeEmitter) State(event domain.SFTPState)        { e.state <- event }
func (e fakeEmitter) Entries(event domain.SFTPListResult) { e.entries <- event }
func (e fakeEmitter) Transfer(event domain.SFTPTransferState) {
	e.transfer <- event
}
func (e fakeEmitter) Error(event domain.SFTPErrorEvent) { e.errors <- event }

type fakeTransport struct {
	client           *fakeClient
	openErr          error
	closed           bool
	commands         []*fakeCommand
	started          []string
	startCommandErr  error
	startCommandHook func(context.Context, string) (RemoteCommand, error)
}

func (t *fakeTransport) OpenSFTP() (Client, error) {
	if t.openErr != nil {
		return nil, t.openErr
	}
	return t.client, nil
}
func (t *fakeTransport) StartCommand(ctx context.Context, command string) (RemoteCommand, error) {
	t.started = append(t.started, command)
	if t.startCommandErr != nil {
		return nil, t.startCommandErr
	}
	if t.startCommandHook != nil {
		return t.startCommandHook(ctx, command)
	}
	if len(t.commands) == 0 {
		return newFakeCommand(nil, nil), nil
	}
	next := t.commands[0]
	t.commands = t.commands[1:]
	return next, nil
}
func (t *fakeTransport) Fingerprint() string { return "SHA256:test" }
func (t *fakeTransport) Close() error {
	t.closed = true
	return nil
}

type fakeCommand struct {
	stdin  *bytes.Buffer
	stdout *bytes.Buffer
	wait   error
	closed bool
}

func newFakeCommand(stdout []byte, wait error) *fakeCommand {
	return &fakeCommand{stdin: bytes.NewBuffer(nil), stdout: bytes.NewBuffer(stdout), wait: wait}
}

func (c *fakeCommand) Stdin() io.WriteCloser { return nopWriteCloser{c.stdin} }
func (c *fakeCommand) Stdout() io.Reader     { return c.stdout }
func (c *fakeCommand) Wait() error           { return c.wait }
func (c *fakeCommand) Close() error {
	c.closed = true
	return nil
}

type blockingCommand struct {
	stdin     io.WriteCloser
	stdout    *io.PipeReader
	writer    *io.PipeWriter
	closed    chan struct{}
	closeOnce sync.Once
}

func newBlockingCommand() *blockingCommand {
	reader, writer := io.Pipe()
	return &blockingCommand{
		stdin:  nopWriteCloser{io.Discard},
		stdout: reader,
		writer: writer,
		closed: make(chan struct{}),
	}
}

func (c *blockingCommand) Stdin() io.WriteCloser { return c.stdin }
func (c *blockingCommand) Stdout() io.Reader     { return c.stdout }
func (c *blockingCommand) Wait() error {
	<-c.closed
	return io.ErrClosedPipe
}
func (c *blockingCommand) Close() error {
	c.closeOnce.Do(func() {
		_ = c.writer.CloseWithError(io.ErrClosedPipe)
		_ = c.stdout.CloseWithError(io.ErrClosedPipe)
		close(c.closed)
	})
	return nil
}

type nopWriteCloser struct {
	io.Writer
}

func (w nopWriteCloser) Close() error { return nil }

type fakeClient struct {
	mu                sync.Mutex
	home              string
	dirs              map[string][]fs.FileInfo
	files             map[string][]byte
	modes             map[string]fs.FileMode
	modTimes          map[string]time.Time
	statErrs          map[string]error
	closed            bool
	created           []string
	removed           []string
	removedDirs       []string
	posixRenamed      []string
	directWritten     []string
	createErr         error
	writeErr          error
	closeErr          error
	chmodErr          error
	renameErr         error
	posixRenameErr    error
	openFileErr       error
	removeErr         error
	renameNoOverwrite bool
	readDirStarted    chan string
	readDirContinue   chan struct{}
	writeDelay        time.Duration
	readDelay         time.Duration
}

func newFakeClient() *fakeClient {
	return &fakeClient{
		home:     "/home/test",
		dirs:     make(map[string][]fs.FileInfo),
		files:    make(map[string][]byte),
		modes:    make(map[string]fs.FileMode),
		modTimes: make(map[string]time.Time),
		statErrs: make(map[string]error),
	}
}

func (c *fakeClient) Getwd() (string, error) { return c.home, nil }
func (c *fakeClient) ReadDir(_ context.Context, remotePath string) ([]fs.FileInfo, error) {
	if c.readDirStarted != nil {
		c.readDirStarted <- remotePath
	}
	if c.readDirContinue != nil {
		<-c.readDirContinue
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	entries, ok := c.dirs[remotePath]
	if !ok {
		return nil, os.ErrNotExist
	}
	return append([]fs.FileInfo(nil), entries...), nil
}
func (c *fakeClient) Stat(remotePath string) (fs.FileInfo, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.statErrs[remotePath]; err != nil {
		return nil, err
	}
	if data, ok := c.files[remotePath]; ok {
		mode := c.modes[remotePath]
		if mode == 0 {
			mode = 0o644
		}
		modTime := c.modTimes[remotePath]
		if modTime.IsZero() {
			modTime = time.Unix(100, 0)
		}
		return fakeInfo{name: baseRemotePath(remotePath), size: int64(len(data)), mode: mode, modTime: modTime}, nil
	}
	if _, ok := c.dirs[remotePath]; ok {
		mode := c.modes[remotePath]
		if mode == 0 {
			mode = fs.ModeDir | 0o755
		}
		mode |= fs.ModeDir
		modTime := c.modTimes[remotePath]
		if modTime.IsZero() {
			modTime = time.Unix(100, 0)
		}
		return fakeInfo{name: baseRemotePath(remotePath), mode: mode, modTime: modTime}, nil
	}
	return nil, os.ErrNotExist
}
func (c *fakeClient) Lstat(remotePath string) (fs.FileInfo, error) { return c.Stat(remotePath) }
func (c *fakeClient) Open(remotePath string) (RemoteFile, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, ok := c.files[remotePath]
	if !ok {
		return nil, os.ErrNotExist
	}
	return &fakeRemoteFile{data: append([]byte(nil), data...), readDelay: c.readDelay}, nil
}
func (c *fakeClient) OpenFile(remotePath string, _ int) (RemoteFile, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.openFileErr != nil {
		return nil, c.openFileErr
	}
	data, ok := c.files[remotePath]
	if !ok {
		return nil, os.ErrNotExist
	}
	return &fakeRemoteFile{
		data:       append([]byte(nil), data...),
		writeErr:   c.writeErr,
		writeDelay: c.writeDelay,
		readDelay:  c.readDelay,
		closeErr:   c.closeErr,
		closeFunc: func(data []byte) {
			c.mu.Lock()
			c.files[remotePath] = append([]byte(nil), data...)
			c.modTimes[remotePath] = time.Unix(101, 0)
			c.directWritten = append(c.directWritten, remotePath)
			c.mu.Unlock()
		},
	}, nil
}
func (c *fakeClient) Create(remotePath string) (RemoteFile, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.createErr != nil {
		return nil, c.createErr
	}
	c.created = append(c.created, remotePath)
	c.files[remotePath] = nil
	return &fakeRemoteFile{
		writeErr:   c.writeErr,
		writeDelay: c.writeDelay,
		readDelay:  c.readDelay,
		closeErr:   c.closeErr,
		closeFunc: func(data []byte) {
			c.mu.Lock()
			c.files[remotePath] = append([]byte(nil), data...)
			c.modTimes[remotePath] = time.Unix(101, 0)
			c.mu.Unlock()
		},
	}, nil
}
func (c *fakeClient) Chmod(remotePath string, mode fs.FileMode) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.chmodErr != nil {
		return c.chmodErr
	}
	c.modes[remotePath] = mode
	return nil
}
func (c *fakeClient) Mkdir(remotePath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.dirs[remotePath]; ok {
		return errors.New("file exists")
	}
	c.dirs[remotePath] = nil
	return nil
}
func (c *fakeClient) Remove(remotePath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.removeErr != nil {
		return c.removeErr
	}
	c.removed = append(c.removed, remotePath)
	delete(c.files, remotePath)
	return nil
}
func (c *fakeClient) RemoveDirectory(remotePath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removedDirs = append(c.removedDirs, remotePath)
	delete(c.dirs, remotePath)
	return nil
}
func (c *fakeClient) Rename(oldPath, newPath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.renameErr != nil {
		return c.renameErr
	}
	if c.renameNoOverwrite {
		if _, ok := c.files[newPath]; ok {
			return errors.New("file exists")
		}
	}
	if data, ok := c.files[oldPath]; ok {
		delete(c.files, oldPath)
		c.files[newPath] = data
		c.modTimes[newPath] = time.Unix(101, 0)
		return nil
	}
	if entries, ok := c.dirs[oldPath]; ok {
		delete(c.dirs, oldPath)
		c.dirs[newPath] = entries
		return nil
	}
	return os.ErrNotExist
}
func (c *fakeClient) PosixRename(oldPath, newPath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.posixRenameErr != nil {
		return c.posixRenameErr
	}
	if data, ok := c.files[oldPath]; ok {
		delete(c.files, oldPath)
		c.files[newPath] = data
		c.modTimes[newPath] = time.Unix(101, 0)
		c.posixRenamed = append(c.posixRenamed, oldPath+"->"+newPath)
		return nil
	}
	return os.ErrNotExist
}
func (c *fakeClient) Close() error {
	c.closed = true
	return nil
}

type fakeRemoteFile struct {
	writeErr   error
	writeDelay time.Duration
	closeErr   error
	closeFunc  func([]byte)
	data       []byte
	offset     int64
	readDelay  time.Duration
}

func (f *fakeRemoteFile) Read(data []byte) (int, error) {
	if f.readDelay > 0 {
		time.Sleep(f.readDelay)
	}
	if f.offset >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(data, f.data[f.offset:])
	f.offset += int64(n)
	return n, nil
}

func (f *fakeRemoteFile) Write(data []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	if f.writeDelay > 0 {
		time.Sleep(f.writeDelay)
	}
	if f.offset < 0 {
		return 0, errors.New("negative file offset")
	}
	end := f.offset + int64(len(data))
	if end > int64(len(f.data)) {
		next := make([]byte, end)
		copy(next, f.data)
		f.data = next
	}
	copy(f.data[f.offset:end], data)
	f.offset = end
	return len(data), nil
}

func (f *fakeRemoteFile) Seek(offset int64, whence int) (int64, error) {
	var next int64
	switch whence {
	case io.SeekStart:
		next = offset
	case io.SeekCurrent:
		next = f.offset + offset
	case io.SeekEnd:
		next = int64(len(f.data)) + offset
	default:
		return 0, errors.New("invalid seek whence")
	}
	if next < 0 {
		return 0, errors.New("negative file offset")
	}
	f.offset = next
	return next, nil
}

func (f *fakeRemoteFile) Close() error {
	if f.closeErr != nil {
		return f.closeErr
	}
	if f.closeFunc != nil {
		f.closeFunc(f.data)
	}
	return nil
}

type fakeInfo struct {
	name    string
	size    int64
	mode    fs.FileMode
	modTime time.Time
}

func (i fakeInfo) Name() string      { return i.name }
func (i fakeInfo) Size() int64       { return i.size }
func (i fakeInfo) Mode() fs.FileMode { return i.mode }
func (i fakeInfo) ModTime() time.Time {
	if i.modTime.IsZero() {
		return time.Unix(100, 0)
	}
	return i.modTime
}
func (i fakeInfo) IsDir() bool { return i.mode.IsDir() }
func (i fakeInfo) Sys() any    { return &pkgsftp.FileStat{UID: 1000, GID: 1001} }

func newManagerForTest(t *testing.T, client *fakeClient, emitter fakeEmitter) (*Manager, *fakeTransport, func()) {
	t.Helper()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	transport := &fakeTransport{client: client}
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			return transport, 0, nil
		},
	)
	return manager, transport, func() {
		manager.StopAll()
		_ = logger.Close()
	}
}

func TestOpenIsIdempotentAndStopClosesSession(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	manager, transport, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	connection := domain.Connection{ID: 1, Name: "server"}

	first, err := manager.Open(connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Open(connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != domain.SFTPStatusOnline || second.Status != domain.SFTPStatusOnline {
		t.Fatalf("states=%+v %+v", first, second)
	}
	if !manager.IsActive(connection.ID) {
		t.Fatal("session was not active")
	}
	manager.Stop(connection.ID)
	if manager.IsActive(connection.ID) || !client.closed || !transport.closed {
		t.Fatalf("stop did not close resources: active=%v client=%v transport=%v", manager.IsActive(connection.ID), client.closed, transport.closed)
	}
}

func TestReconnectForcesFreshRuntimeForSameServerIDAndContext(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	firstClient := newFakeClient()
	firstClient.home = "/srv/app"
	firstClient.dirs["/srv/app"] = []fs.FileInfo{fakeInfo{name: "server-a.txt", size: 1, mode: 0o644}}
	secondClient := newFakeClient()
	secondClient.home = "/srv/app"
	secondClient.dirs["/srv/app"] = []fs.FileInfo{fakeInfo{name: "server-b.txt", size: 1, mode: 0o644}}
	transports := []*fakeTransport{{client: firstClient}, {client: secondClient}}
	dials := 0
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			if dials >= len(transports) {
				t.Fatalf("unexpected SFTP dial %d", dials)
			}
			transport := transports[dials]
			dials++
			return transport, 0, nil
		},
	)
	defer manager.StopAll()
	connection := domain.Connection{ID: 77, Name: "same-ip", Host: "192.0.2.77", Port: 22}

	firstState, err := manager.Open(connection, domain.AuthRequest{}, "term-1", "term-1")
	if err != nil {
		t.Fatal(err)
	}
	firstList, err := manager.List(context.Background(), domain.SFTPListRequest{ConnectionID: connection.ID, ContextID: "term-1", Path: "/srv/app"})
	if err != nil {
		t.Fatal(err)
	}
	if firstList.Entries[0].Name != "server-a.txt" {
		t.Fatalf("first list used wrong runtime: %+v", firstList.Entries)
	}

	secondState, err := manager.Reconnect(connection, domain.AuthRequest{}, "term-1", "term-1")
	if err != nil {
		t.Fatal(err)
	}
	if dials != 2 {
		t.Fatalf("Reconnect reused old runtime, dials=%d", dials)
	}
	if !firstClient.closed || !transports[0].closed {
		t.Fatal("Reconnect did not close the old SFTP client and SSH transport")
	}
	if secondState.Generation <= firstState.Generation {
		t.Fatalf("generation did not advance: first=%d second=%d", firstState.Generation, secondState.Generation)
	}
	secondList, err := manager.List(context.Background(), domain.SFTPListRequest{ConnectionID: connection.ID, ContextID: "term-1", Path: "/srv/app"})
	if err != nil {
		t.Fatal(err)
	}
	if secondList.Generation != secondState.Generation {
		t.Fatalf("list generation=%d reconnect generation=%d", secondList.Generation, secondState.Generation)
	}
	if len(secondList.Entries) != 1 || secondList.Entries[0].Name != "server-b.txt" {
		t.Fatalf("second list leaked old runtime/cache: %+v", secondList.Entries)
	}
}

func TestStopInvalidatesRuntimeAndNextOpenDialsFresh(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	firstClient := newFakeClient()
	firstClient.home = "/a"
	secondClient := newFakeClient()
	secondClient.home = "/b"
	transports := []*fakeTransport{{client: firstClient}, {client: secondClient}}
	dials := 0
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			if dials >= len(transports) {
				t.Fatalf("unexpected SFTP dial %d", dials)
			}
			transport := transports[dials]
			dials++
			return transport, 0, nil
		},
	)
	defer manager.StopAll()
	connection := domain.Connection{ID: 78, Name: "same-ip"}

	firstState, err := manager.Open(connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	manager.Stop(connection.ID)
	offline := manager.State(connection.ID)
	if offline.Status != domain.SFTPStatusOffline || offline.Generation <= firstState.Generation {
		t.Fatalf("Stop did not invalidate generation: first=%+v offline=%+v", firstState, offline)
	}
	secondState, err := manager.Open(connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if dials != 2 {
		t.Fatalf("next open reused stale runtime, dials=%d", dials)
	}
	if !firstClient.closed || !transports[0].closed {
		t.Fatal("Stop did not close the old SFTP client and SSH transport")
	}
	if secondState.CurrentPath != "/b" || secondState.Generation <= offline.Generation {
		t.Fatalf("next open did not create a fresh runtime: %+v after offline %+v", secondState, offline)
	}
}

func TestLateOpenFailureKeepsOldGeneration(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	dialStarted := make(chan struct{})
	dialContinue := make(chan struct{})
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			close(dialStarted)
			<-dialContinue
			return nil, 0, errors.New("connection reset by peer")
		},
	)
	defer manager.StopAll()
	connection := domain.Connection{ID: 80, Name: "same-ip"}

	openErr := make(chan error, 1)
	go func() {
		_, err := manager.Open(connection, domain.AuthRequest{}, "term-1", "term-1")
		openErr <- err
	}()
	<-dialStarted
	connecting := <-emitter.state
	if connecting.Status != domain.SFTPStatusConnecting || connecting.Generation == 0 {
		t.Fatalf("unexpected connecting state: %+v", connecting)
	}
	manager.StopContext(connection.ID, "term-1")
	offline := manager.State(connection.ID, "term-1")
	if offline.Generation <= connecting.Generation {
		t.Fatalf("stop did not advance generation: connecting=%+v offline=%+v", connecting, offline)
	}
	close(dialContinue)
	if err := <-openErr; err == nil {
		t.Fatal("expected delayed open failure")
	}
	errorEvent := <-emitter.errors
	if errorEvent.Generation != connecting.Generation {
		t.Fatalf("late open error was not isolated to old generation: event=%+v connecting=%+v offline=%+v", errorEvent, connecting, offline)
	}
	current := manager.State(connection.ID, "term-1")
	if current.Generation != offline.Generation || current.Status != domain.SFTPStatusOffline {
		t.Fatalf("late open failure overwrote current state: current=%+v offline=%+v", current, offline)
	}
}

func TestLateDirectoryResultDoesNotOverwriteNewGeneration(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	firstClient := newFakeClient()
	firstClient.home = "/old"
	firstClient.dirs["/old"] = []fs.FileInfo{fakeInfo{name: "server-a.txt", size: 1, mode: 0o644}}
	firstClient.readDirStarted = make(chan string, 1)
	firstClient.readDirContinue = make(chan struct{})
	secondClient := newFakeClient()
	secondClient.home = "/new"
	secondClient.dirs["/new"] = []fs.FileInfo{fakeInfo{name: "server-b.txt", size: 1, mode: 0o644}}
	transports := []*fakeTransport{{client: firstClient}, {client: secondClient}}
	dials := 0
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			if dials >= len(transports) {
				t.Fatalf("unexpected SFTP dial %d", dials)
			}
			transport := transports[dials]
			dials++
			return transport, 0, nil
		},
	)
	defer manager.StopAll()
	connection := domain.Connection{ID: 79, Name: "same-ip"}

	firstState, err := manager.Open(connection, domain.AuthRequest{}, "term-1", "term-1")
	if err != nil {
		t.Fatal(err)
	}
	lateResult := make(chan domain.SFTPListResult, 1)
	lateErr := make(chan error, 1)
	go func() {
		result, err := manager.List(context.Background(), domain.SFTPListRequest{
			ConnectionID: connection.ID,
			ContextID:    "term-1",
			Path:         "/old",
			RequestID:    "old-request",
		})
		lateResult <- result
		lateErr <- err
	}()
	<-firstClient.readDirStarted
	secondState, err := manager.Reconnect(connection, domain.AuthRequest{}, "term-1", "term-1")
	if err != nil {
		t.Fatal(err)
	}
	secondList, err := manager.List(context.Background(), domain.SFTPListRequest{
		ConnectionID: connection.ID,
		ContextID:    "term-1",
		Path:         "/new",
		RequestID:    "new-request",
	})
	if err != nil {
		t.Fatal(err)
	}
	close(firstClient.readDirContinue)
	if err := <-lateErr; err != nil {
		t.Fatal(err)
	}
	oldList := <-lateResult
	if oldList.Generation != firstState.Generation || oldList.RequestID != "old-request" {
		t.Fatalf("late result lost old identity: %+v first=%+v", oldList, firstState)
	}
	if secondList.Generation != secondState.Generation || secondList.RequestID != "new-request" {
		t.Fatalf("new list identity mismatch: %+v second=%+v", secondList, secondState)
	}
	current := manager.State(connection.ID, "term-1")
	if current.Generation != secondState.Generation || current.CurrentPath != "/new" {
		t.Fatalf("late list overwrote new generation state: current=%+v second=%+v", current, secondState)
	}
}

func TestSameServerContextsKeepIndependentSFTPSessions(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	firstClient := newFakeClient()
	firstClient.home = "/root"
	firstClient.dirs["/root"] = []fs.FileInfo{fakeInfo{name: "root.txt", size: 1, mode: 0o644}}
	secondClient := newFakeClient()
	secondClient.home = "/var/www"
	secondClient.dirs["/var/www"] = []fs.FileInfo{fakeInfo{name: "index.html", size: 1, mode: 0o644}}
	transports := []*fakeTransport{
		{client: firstClient},
		{client: secondClient},
	}
	dials := 0
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			if dials >= len(transports) {
				t.Fatalf("unexpected extra SFTP dial %d", dials)
			}
			transport := transports[dials]
			dials++
			return transport, 0, nil
		},
	)
	defer manager.StopAll()
	connection := domain.Connection{ID: 19, Name: "server"}

	firstState, err := manager.Open(connection, domain.AuthRequest{}, "term-1", "term-1")
	if err != nil {
		t.Fatal(err)
	}
	secondState, err := manager.Open(connection, domain.AuthRequest{}, "term-2", "term-2")
	if err != nil {
		t.Fatal(err)
	}
	if firstState.ContextID != "term-1" || secondState.ContextID != "term-2" {
		t.Fatalf("states did not keep context IDs: first=%+v second=%+v", firstState, secondState)
	}

	firstList, err := manager.List(context.Background(), domain.SFTPListRequest{ConnectionID: connection.ID, ContextID: "term-1", Path: "/root"})
	if err != nil {
		t.Fatal(err)
	}
	secondList, err := manager.List(context.Background(), domain.SFTPListRequest{ConnectionID: connection.ID, ContextID: "term-2", Path: "/var/www"})
	if err != nil {
		t.Fatal(err)
	}
	if firstList.ContextID != "term-1" || firstList.Path != "/root" || firstList.Entries[0].Name != "root.txt" {
		t.Fatalf("first list=%+v", firstList)
	}
	if secondList.ContextID != "term-2" || secondList.Path != "/var/www" || secondList.Entries[0].Name != "index.html" {
		t.Fatalf("second list=%+v", secondList)
	}

	manager.StopContext(connection.ID, "term-1")
	if !firstClient.closed || !transports[0].closed {
		t.Fatal("closing first context did not close its resources")
	}
	if secondClient.closed || transports[1].closed {
		t.Fatal("closing first context closed the second context")
	}
	if state := manager.State(connection.ID, "term-1"); state.Status != domain.SFTPStatusOffline {
		t.Fatalf("first context state=%+v", state)
	}
	if state := manager.State(connection.ID, "term-2"); state.Status != domain.SFTPStatusOnline || state.CurrentPath != "/var/www" {
		t.Fatalf("second context state=%+v", state)
	}

	manager.Stop(connection.ID)
	if !secondClient.closed || !transports[1].closed {
		t.Fatal("server stop did not close remaining context")
	}
}

func TestOpenNoopsWhileConnectingStateExists(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	connection := domain.Connection{ID: 11, Name: "server"}
	manager.mu.Lock()
	manager.setStateLocked(domain.SFTPState{
		ConnectionID: connection.ID,
		Status:       domain.SFTPStatusConnecting,
		Active:       true,
		Message:      "正在连接 SFTP",
		UpdatedAt:    now(),
	})
	manager.mu.Unlock()

	state, err := manager.Open(connection, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != domain.SFTPStatusConnecting {
		t.Fatalf("state=%+v", state)
	}
	if manager.IsActive(connection.ID) {
		t.Fatal("connecting no-op should not create another session")
	}
}

func TestOpenFallsBackToSCPWhenSFTPSubsystemIsMissing(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	transport := &fakeTransport{
		client:   newFakeClient(),
		openErr:  errors.New("subsystem request failed"),
		commands: []*fakeCommand{newFakeCommand([]byte("/root\n"), nil)},
	}
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			return transport, 0, nil
		},
	)
	defer manager.StopAll()

	state, err := manager.Open(domain.Connection{ID: 12, Name: "openwrt"}, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != domain.SFTPStatusOnline || !state.Active || state.Mode != domain.SFTPModeSCP {
		t.Fatalf("state=%+v", state)
	}
	if state.CurrentPath != "/root" {
		t.Fatalf("SCP fallback current path=%q want /root", state.CurrentPath)
	}
	event := <-emitter.errors
	if event.Code != "SFTP_UNSUPPORTED" {
		t.Fatalf("event=%+v", event)
	}
	if !strings.Contains(event.Message, "SCP 兼容模式") {
		t.Fatalf("message=%q", event.Message)
	}
	if transport.closed {
		t.Fatal("transport was closed after entering SCP fallback")
	}
	if !manager.IsActive(12) {
		t.Fatal("SCP fallback session is not active")
	}
}

func TestOpenSCPFallbackFallsBackToRootWhenHomeResolutionFails(t *testing.T) {
	emitter := newFakeEmitter()
	logger, err := logging.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	transport := &fakeTransport{
		client:   newFakeClient(),
		openErr:  errors.New("subsystem request failed"),
		commands: []*fakeCommand{newFakeCommand(nil, errors.New("exit 1"))},
	}
	manager := NewWithDialer(
		context.Background(),
		logger,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			return transport, 0, nil
		},
	)
	defer manager.StopAll()

	state, err := manager.Open(domain.Connection{ID: 13, Name: "openwrt"}, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if state.CurrentPath != "/" {
		t.Fatalf("SCP fallback current path=%q want /", state.CurrentPath)
	}
}

func TestListSortsDirectoriesFirstAndKeepsOwnerGroup(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = []fs.FileInfo{
		fakeInfo{name: "z.txt", size: 3, mode: 0o644},
		fakeInfo{name: "adir", mode: fs.ModeDir | 0o755},
	}
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 2, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	result, err := manager.List(context.Background(), domain.SFTPListRequest{ConnectionID: 2, Path: "/home/test"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Entries) != 2 || result.Entries[0].Name != "adir" || !result.Entries[0].IsDir {
		t.Fatalf("entries not sorted with dirs first: %+v", result.Entries)
	}
	if result.Entries[0].Owner != "1000" || result.Entries[0].Group != "1001" {
		t.Fatalf("owner/group not preserved: %+v", result.Entries[0])
	}
}

func TestReadAndWriteTextFile(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 4, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	result, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 4,
		Path:         "/home/test/config.txt",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != "hello" || result.Entry.Size != 5 {
		t.Fatalf("result=%+v", result)
	}
	if result.Encoding != "utf-8" || result.Truncated || result.DetectedLanguage == "" || result.TextKind != "plaintext" {
		t.Fatalf("missing text metadata: %+v", result)
	}
	written, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  4,
		Path:          "/home/test/config.txt",
		Content:       "hello\nworld",
		ExpectedSize:  result.Entry.Size,
		ExpectedMTime: result.Entry.ModTime,
	})
	if err != nil {
		t.Fatal(err)
	}
	if written.Entry.Size != int64(len("hello\nworld")) {
		t.Fatalf("written=%+v", written)
	}
	client.mu.Lock()
	got := string(client.files["/home/test/config.txt"])
	client.mu.Unlock()
	if got != "hello\nworld" {
		t.Fatalf("remote content=%q", got)
	}
}

func TestGetItemPropertiesUsesLstatAndReturnsModeMetadata(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/app.sh"] = []byte("#!/bin/sh\n")
	client.modes["/home/test/app.sh"] = 0o755
	client.modTimes["/home/test/app.sh"] = time.Unix(1710000000, 0)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 61, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	result, err := manager.GetItemProperties(context.Background(), domain.SFTPItemPropertiesRequest{
		ConnectionID: 61,
		Path:         "/home/test/app.sh",
		RequestID:    "props-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Name != "app.sh" || result.Path != "/home/test/app.sh" || result.Type != "file" {
		t.Fatalf("unexpected properties identity: %+v", result)
	}
	if result.Mode != 0o755 || result.Permissions != "-rwxr-xr-x" {
		t.Fatalf("mode metadata=%#o permissions=%q", result.Mode, result.Permissions)
	}
	if result.Owner != "1000" || result.Group != "1001" || result.RequestID != "props-1" || result.Generation == 0 {
		t.Fatalf("missing metadata: %+v", result)
	}
}

func TestGetItemPropertiesRejectsUnsafePath(t *testing.T) {
	manager, _, cleanup := newManagerForTest(t, newFakeClient(), newFakeEmitter())
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 62, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"", "/tmp/has\x00nul", "/tmp/has\nnewline", "/home/test/..", "../bad"} {
		if _, err := manager.GetItemProperties(context.Background(), domain.SFTPItemPropertiesRequest{ConnectionID: 62, Path: path}); err == nil {
			t.Fatalf("unsafe properties path %q was accepted", path)
		}
	}
}

func TestUpdateItemPermissionsChangesOnlyLowNineBitsAndPreservesSpecialBits(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/app.sh"] = []byte("run")
	client.modes["/home/test/app.sh"] = fs.ModeSetuid | 0o755
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	state, err := manager.Open(domain.Connection{ID: 63, Name: "server"}, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}

	result, err := manager.UpdateItemPermissions(context.Background(), domain.SFTPUpdateItemPermissionsRequest{
		ConnectionID:        63,
		Path:                "/home/test/app.sh",
		Mode:                0o640,
		PreserveSpecialBits: true,
		Generation:          state.Generation,
		RequestID:           "chmod-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	client.mu.Lock()
	gotMode := client.modes["/home/test/app.sh"]
	client.mu.Unlock()
	if gotMode&fs.ModeSetuid == 0 || gotMode.Perm() != 0o640 {
		t.Fatalf("chmod mode=%v perm=%#o", gotMode, gotMode.Perm())
	}
	if result.Mode != 0o4640 || result.Permissions != "-rwSr-----" || result.RequestID != "chmod-1" {
		t.Fatalf("unexpected chmod properties: %+v", result)
	}
}

func TestUpdateItemPermissionsSupportsDirectoriesAndKeepsOwnerGroup(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test/logs"] = nil
	client.modes["/home/test/logs"] = fs.ModeDir | 0o755
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 64, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	result, err := manager.UpdateItemPermissions(context.Background(), domain.SFTPUpdateItemPermissionsRequest{
		ConnectionID:        64,
		Path:                "/home/test/logs",
		Mode:                0o750,
		PreserveSpecialBits: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Type != "directory" || result.Mode != 0o750 || result.Owner != "1000" || result.Group != "1001" {
		t.Fatalf("unexpected directory chmod result: %+v", result)
	}
	client.mu.Lock()
	gotMode := client.modes["/home/test/logs"]
	client.mu.Unlock()
	if gotMode.Perm() != 0o750 {
		t.Fatalf("directory chmod mode=%v perm=%#o", gotMode, gotMode.Perm())
	}
}

func TestUpdateItemPermissionsRejectsSymlinkAndStaleGeneration(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/link"] = []byte("target")
	client.modes["/home/test/link"] = fs.ModeSymlink | 0o777
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	state, err := manager.Open(domain.Connection{ID: 65, Name: "server"}, domain.AuthRequest{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := manager.UpdateItemPermissions(context.Background(), domain.SFTPUpdateItemPermissionsRequest{
		ConnectionID:        65,
		Path:                "/home/test/link",
		Mode:                0o644,
		PreserveSpecialBits: true,
		Generation:          state.Generation,
	}); err == nil || !strings.Contains(err.Error(), "符号链接") {
		t.Fatalf("symlink chmod error=%v", err)
	}
	if _, err := manager.UpdateItemPermissions(context.Background(), domain.SFTPUpdateItemPermissionsRequest{
		ConnectionID: 65,
		Path:         "/home/test/link",
		Mode:         0o644,
		Generation:   state.Generation + 1,
	}); err == nil || !strings.Contains(err.Error(), "上下文已过期") {
		t.Fatalf("stale generation error=%v", err)
	}
	client.mu.Lock()
	gotMode := client.modes["/home/test/link"]
	client.mu.Unlock()
	if gotMode.Perm() != 0o777 {
		t.Fatalf("symlink mode changed to %#o", gotMode.Perm())
	}
}

func TestReadTextFileSniffsUnknownPlaintextAndTruncatesPreview(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/unknown.zzz"] = []byte("line one\nline two\nline three\n")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 46, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	result, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 46,
		Path:         "/home/test/unknown.zzz",
		MaxBytes:     12,
		RequestID:    "open-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != "line one\nlin" || !result.Truncated {
		t.Fatalf("unexpected preview: %+v", result)
	}
	if result.RequestID != "open-1" || result.Generation == 0 || result.Encoding != "utf-8" || result.DetectedLanguage != "generic" || result.TextKind != "plaintext" {
		t.Fatalf("metadata=%+v", result)
	}
}

func TestReadTextFileSupportsUTF16BOM(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/windows.log"] = []byte{0xff, 0xfe, 'h', 0x00, 'i', 0x00, '\n', 0x00}
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 47, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	result, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 47,
		Path:         "/home/test/windows.log",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != "hi\n" || result.Encoding != "utf-16le" {
		t.Fatalf("result=%+v", result)
	}
}

func TestReadTextFileRejectsUnsafeRemotePath(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 48, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	for _, remotePath := range []string{"/home/test/bad\x00name", "/home/test/bad\rname", "/home/test/bad\nname"} {
		t.Run(remotePath, func(t *testing.T) {
			_, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
				ConnectionID: 48,
				Path:         remotePath,
			})
			if err == nil {
				t.Fatalf("unsafe path %q was accepted", remotePath)
			}
		})
	}
}

func TestWriteTextFileRejectsUnsafeRemotePath(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 49, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	for _, remotePath := range []string{"", "   ", "/home/test/bad\x00name", "/home/test/bad\rname", "/home/test/bad\nname"} {
		t.Run(remotePath, func(t *testing.T) {
			_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
				ConnectionID:  49,
				Path:          remotePath,
				Content:       "updated",
				ExpectedSize:  5,
				ExpectedMTime: time.Unix(100, 0).UTC().Format(time.RFC3339Nano),
				Encoding:      "utf-8",
			})
			if err == nil {
				t.Fatalf("unsafe path %q was accepted", remotePath)
			}
		})
	}
}

func TestWriteTextFilePreservesUTF16LEEncodingAndContentHash(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/windows.log"] = []byte{0xff, 0xfe, 'h', 0x00, 'i', 0x00, '\n', 0x00}
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 50, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	result, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 50,
		Path:         "/home/test/windows.log",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Encoding != "utf-16le" || result.ContentHash == "" {
		t.Fatalf("missing encoding/hash metadata: %+v", result)
	}

	written, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  50,
		Path:          "/home/test/windows.log",
		Content:       "hi\nok",
		ExpectedSize:  result.Entry.Size,
		ExpectedMTime: result.Entry.ModTime,
		ExpectedHash:  result.ContentHash,
		Encoding:      result.Encoding,
		RequestID:     "save-utf16",
		Generation:    result.Generation,
	})
	if err != nil {
		t.Fatal(err)
	}
	if written.RequestID != "save-utf16" || written.Encoding != "utf-16le" || written.ContentHash == "" {
		t.Fatalf("written metadata=%+v", written)
	}
	client.mu.Lock()
	gotBytes := append([]byte(nil), client.files["/home/test/windows.log"]...)
	client.mu.Unlock()
	gotText, gotEncoding, err := decodeTextBytes(gotBytes)
	if err != nil {
		t.Fatal(err)
	}
	if gotEncoding != "utf-16le" || gotText != "hi\nok" {
		t.Fatalf("encoding=%s text=%q bytes=%v", gotEncoding, gotText, gotBytes)
	}
}

func TestWriteTextFileDetectsHashConflictWithSameSizeAndMTime(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	client.modTimes["/home/test/config.txt"] = time.Unix(300, 0)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 51, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	result, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 51,
		Path:         "/home/test/config.txt",
	})
	if err != nil {
		t.Fatal(err)
	}

	client.mu.Lock()
	client.files["/home/test/config.txt"] = []byte("hullo")
	client.modTimes["/home/test/config.txt"] = time.Unix(300, 0)
	client.mu.Unlock()

	_, err = manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  51,
		Path:          "/home/test/config.txt",
		Content:       "world",
		ExpectedSize:  result.Entry.Size,
		ExpectedMTime: result.Entry.ModTime,
		ExpectedHash:  result.ContentHash,
		Encoding:      result.Encoding,
	})
	detail := decodeSaveError(t, err)
	if detail.Code != "SFTP_SAVE_CONFLICT" || detail.Stage != "conflict_check" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
}

func TestWriteTextFileAllowsSameSecondMTimePrecision(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	client.modTimes["/home/test/config.txt"] = time.Unix(100, 250_000_000)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 41, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  41,
		Path:          "/home/test/config.txt",
		Content:       "world",
		ExpectedSize:  5,
		ExpectedMTime: time.Unix(100, 999_000_000).UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestWriteTextFileConflictAndForceOverwrite(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	client.modTimes["/home/test/config.txt"] = time.Unix(200, 0)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 42, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  42,
		Path:          "/home/test/config.txt",
		Content:       "world",
		ExpectedSize:  5,
		ExpectedMTime: time.Unix(100, 0).UTC().Format(time.RFC3339Nano),
	})
	detail := decodeSaveError(t, err)
	if detail.Code != "SFTP_SAVE_CONFLICT" || detail.Stage != "conflict_check" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}

	_, err = manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   42,
		Path:           "/home/test/config.txt",
		Content:        "world",
		ExpectedSize:   5,
		ExpectedMTime:  time.Unix(100, 0).UTC().Format(time.RFC3339Nano),
		ForceOverwrite: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	client.mu.Lock()
	got := string(client.files["/home/test/config.txt"])
	client.mu.Unlock()
	if got != "world" {
		t.Fatalf("remote content=%q", got)
	}
}

func TestWriteTextFileCreatesNewTargetOnlyWhenItDoesNotExist(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 52, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	written, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   52,
		Path:           "/home/test/new.txt",
		Content:        "new content",
		Encoding:       "utf-8",
		Mode:           "create_new",
		ConflictPolicy: "fail_if_exists",
		ExpectedSize:   -1,
		ExpectedMTime:  "",
		ForceOverwrite: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if written.Path != "/home/test/new.txt" || written.Entry.Size != int64(len("new content")) {
		t.Fatalf("written=%+v", written)
	}
	client.mu.Lock()
	got := string(client.files["/home/test/new.txt"])
	client.mu.Unlock()
	if got != "new content" {
		t.Fatalf("remote content=%q", got)
	}

	_, err = manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   52,
		Path:           "/home/test/new.txt",
		Content:        "overwrite",
		Encoding:       "utf-8",
		Mode:           "create_new",
		ConflictPolicy: "fail_if_exists",
		ExpectedSize:   -1,
	})
	detail := decodeSaveError(t, err)
	if detail.Code != "SFTP_SAVE_CONFLICT" || detail.Stage != "conflict_check" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	client.mu.Lock()
	got = string(client.files["/home/test/new.txt"])
	client.mu.Unlock()
	if got != "new content" {
		t.Fatalf("conflict changed content to %q", got)
	}
}

func TestWriteTextFileSaveAsOverwritesOnlyWhenRequested(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/copy.txt"] = []byte("old")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 53, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   53,
		Path:           "/home/test/copy.txt",
		Content:        "copy",
		Encoding:       "utf-8",
		Mode:           "save_as",
		ConflictPolicy: "fail_if_exists",
		ExpectedSize:   -1,
	})
	detail := decodeSaveError(t, err)
	if detail.Code != "SFTP_SAVE_CONFLICT" || detail.Stage != "conflict_check" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}

	written, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:   53,
		Path:           "/home/test/copy.txt",
		Content:        "copy",
		Encoding:       "utf-8",
		Mode:           "save_as",
		ConflictPolicy: "overwrite",
		ExpectedSize:   -1,
		ForceOverwrite: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if written.Path != "/home/test/copy.txt" || written.Entry.Size != int64(len("copy")) {
		t.Fatalf("written=%+v", written)
	}
	client.mu.Lock()
	got := string(client.files["/home/test/copy.txt"])
	client.mu.Unlock()
	if got != "copy" {
		t.Fatalf("remote content=%q", got)
	}
}

func TestWriteTextFileUsesPosixRenameWhenNormalRenameCannotOverwrite(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	client.renameNoOverwrite = true
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 43, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  43,
		Path:          "/home/test/config.txt",
		Content:       "same!",
		ExpectedSize:  5,
		ExpectedMTime: time.Unix(100, 0).UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(client.posixRenamed) != 1 {
		t.Fatalf("expected posix rename, got %v", client.posixRenamed)
	}
}

func TestWriteTextFileFallsBackToDirectWriteWithoutDeletingOriginal(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	client.posixRenameErr = errors.New("unsupported extension")
	client.renameNoOverwrite = true
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 44, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  44,
		Path:          "/home/test/config.txt",
		Content:       "world",
		ExpectedSize:  5,
		ExpectedMTime: time.Unix(100, 0).UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	client.mu.Lock()
	got := string(client.files["/home/test/config.txt"])
	direct := append([]string(nil), client.directWritten...)
	removed := append([]string(nil), client.removed...)
	client.mu.Unlock()
	if got != "world" || len(direct) != 1 || direct[0] != "/home/test/config.txt" {
		t.Fatalf("got=%q direct=%v", got, direct)
	}
	for _, path := range removed {
		if path == "/home/test/config.txt" {
			t.Fatalf("target was removed during fallback: %v", removed)
		}
	}
}

func TestWriteTextFileStagesFailuresAndDoesNotLeakContent(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/config.txt"] = []byte("hello")
	client.createErr = errors.New("permission denied")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 45, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	_, err := manager.WriteTextFile(context.Background(), domain.SFTPWriteTextFileRequest{
		ConnectionID:  45,
		Path:          "/home/test/config.txt",
		Content:       "new editor content",
		ExpectedSize:  5,
		ExpectedMTime: time.Unix(100, 0).UTC().Format(time.RFC3339Nano),
	})
	detail := decodeSaveError(t, err)
	if detail.Stage != "create_temp_file" || detail.Code != "SFTP_SAVE_PERMISSION_DENIED" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	if strings.Contains(err.Error(), "new editor content") {
		t.Fatalf("save error leaked editor content: %v", err)
	}
}

func TestReadTextFileRejectsBinary(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.files["/home/test/blob.bin"] = []byte{0x01, 0x00, 0x02}
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 5, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	_, err := manager.ReadTextFile(context.Background(), domain.SFTPReadTextFileRequest{
		ConnectionID: 5,
		Path:         "/home/test/blob.bin",
	})
	if err == nil || !strings.Contains(err.Error(), "二进制") {
		t.Fatalf("err=%v", err)
	}
}

func decodeSaveError(t *testing.T, err error) saveTextFileError {
	t.Helper()
	if err == nil {
		t.Fatal("expected save error")
	}
	var detail saveTextFileError
	if jsonErr := json.Unmarshal([]byte(err.Error()), &detail); jsonErr != nil {
		t.Fatalf("decode save error: %v from %q", jsonErr, err.Error())
	}
	return detail
}

func TestUploadStreamsToRemoteFile(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 3, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	localPath := filepath.Join(t.TempDir(), "hello.txt")
	if err := os.WriteFile(localPath, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := manager.Upload(domain.SFTPTransferRequest{
		ConnectionID:   3,
		LocalPath:      localPath,
		RemotePath:     "/home/test/hello.txt",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransfer(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	client.mu.Lock()
	got := string(client.files["/home/test/hello.txt"])
	client.mu.Unlock()
	if got != "hello" {
		t.Fatalf("uploaded content=%q", got)
	}
}

func TestPlanRecursiveUploadPreservesStructureAndPOSIXRemotePaths(t *testing.T) {
	root := filepath.Join(t.TempDir(), "本地 root")
	if err := os.MkdirAll(filepath.Join(root, "nested dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested dir", "中文 file.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan, err := PlanRecursiveUpload(context.Background(), root, "/remote/base")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Directories) != 2 || len(plan.Files) != 1 {
		t.Fatalf("plan dirs=%v files=%v", plan.Directories, plan.Files)
	}
	if got, want := plan.Directories[0].RemotePath, "/remote/base/本地 root"; got != want {
		t.Fatalf("root remote=%q want %q", got, want)
	}
	if got := plan.Files[0].RemotePath; strings.Contains(got, `\`) || got != "/remote/base/本地 root/nested dir/中文 file.txt" {
		t.Fatalf("remote file path not POSIX-safe: %q", got)
	}
}

func TestPlanRecursiveUploadSkipsSymlink(t *testing.T) {
	root := filepath.Join(t.TempDir(), "upload")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "target.txt")
	if err := os.WriteFile(target, []byte("target"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "link.txt")); err != nil {
		t.Skipf("symlink unavailable on this platform: %v", err)
	}
	plan, err := PlanRecursiveUpload(context.Background(), root, "/remote")
	if err != nil {
		t.Fatal(err)
	}
	if plan.SkippedCount != 1 || len(plan.Files) != 1 {
		t.Fatalf("plan skipped=%d files=%v", plan.SkippedCount, plan.Files)
	}
}

func TestUploadDirectoryCreatesRemoteDirsAndUploadsMultipleFiles(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 31, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "bundle")
	if err := os.MkdirAll(filepath.Join(root, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("a"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "b.txt"), []byte("b"), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
		ConnectionID:    31,
		LocalPath:       root,
		RemoteDirectory: "/home/test",
		ConflictPolicy:  domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	final := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	if final.ConnectionID != 31 || final.ID != state.ID || !final.Recursive || final.SourceType != "directory" {
		t.Fatalf("final transfer identity/properties wrong: %+v", final)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if _, ok := client.dirs["/home/test/bundle/nested"]; !ok {
		t.Fatalf("nested remote dir not created: %#v", client.dirs)
	}
	if got := string(client.files["/home/test/bundle/a.txt"]); got != "a" {
		t.Fatalf("a.txt=%q", got)
	}
	if got := string(client.files["/home/test/bundle/nested/b.txt"]); got != "b" {
		t.Fatalf("b.txt=%q", got)
	}
}

func TestUploadDirectoryConflictOverwriteAndSkip(t *testing.T) {
	for _, tc := range []struct {
		name   string
		policy domain.SFTPConflictPolicy
		want   string
		skip   bool
	}{
		{"overwrite", domain.SFTPConflictOverwrite, "new", false},
		{"skip", domain.SFTPConflictSkip, "old", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			emitter := newFakeEmitter()
			client := newFakeClient()
			client.dirs["/home/test"] = nil
			client.dirs["/home/test/bundle"] = nil
			client.files["/home/test/bundle/a.txt"] = []byte("old")
			manager, _, cleanup := newManagerForTest(t, client, emitter)
			defer cleanup()
			if _, err := manager.Open(domain.Connection{ID: 32, Name: "server"}, domain.AuthRequest{}); err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(t.TempDir(), "bundle")
			if err := os.MkdirAll(root, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("new"), 0o600); err != nil {
				t.Fatal(err)
			}
			state, err := manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
				ConnectionID:    32,
				LocalPath:       root,
				RemoteDirectory: "/home/test",
				ConflictPolicy:  tc.policy,
			})
			if err != nil {
				t.Fatal(err)
			}
			final := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
			if tc.skip && final.SkippedCount != 1 {
				t.Fatalf("expected skipped count, final=%+v", final)
			}
			client.mu.Lock()
			got := string(client.files["/home/test/bundle/a.txt"])
			client.mu.Unlock()
			if got != tc.want {
				t.Fatalf("content=%q want %q", got, tc.want)
			}
		})
	}
}

func TestDownloadDirectoryCreatesLocalDirsAndDownloadsMultipleFiles(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = []fs.FileInfo{fakeInfo{name: "bundle", mode: fs.ModeDir | 0o755}}
	client.dirs["/home/test/bundle"] = []fs.FileInfo{
		fakeInfo{name: "a.txt", size: 1, mode: 0o644},
		fakeInfo{name: "nested", mode: fs.ModeDir | 0o755},
	}
	client.dirs["/home/test/bundle/nested"] = []fs.FileInfo{fakeInfo{name: "b.txt", size: 1, mode: 0o644}}
	client.files["/home/test/bundle/a.txt"] = []byte("a")
	client.files["/home/test/bundle/nested/b.txt"] = []byte("b")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 33, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	localDir := t.TempDir()
	state, err := manager.DownloadDirectory(domain.SFTPDownloadDirectoryRequest{
		ConnectionID:   33,
		RemotePath:     "/home/test/bundle",
		LocalDirectory: localDir,
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	final := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	if final.FilesTotal != 2 || final.FilesDone != 2 {
		t.Fatalf("file progress=%+v", final)
	}
	if got := string(mustReadFile(t, filepath.Join(localDir, "bundle", "a.txt"))); got != "a" {
		t.Fatalf("a.txt=%q", got)
	}
	if got := string(mustReadFile(t, filepath.Join(localDir, "bundle", "nested", "b.txt"))); got != "b" {
		t.Fatalf("b.txt=%q", got)
	}
}

func TestDownloadDirectorySkipsSymlinkAndRejectsTraversal(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = []fs.FileInfo{fakeInfo{name: "bundle", mode: fs.ModeDir | 0o755}}
	client.dirs["/home/test/bundle"] = []fs.FileInfo{
		fakeInfo{name: "safe.txt", size: 4, mode: 0o644},
		fakeInfo{name: "link", mode: fs.ModeSymlink | 0o777},
	}
	client.files["/home/test/bundle/safe.txt"] = []byte("safe")
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 34, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.DownloadDirectory(domain.SFTPDownloadDirectoryRequest{
		ConnectionID:   34,
		RemotePath:     "../etc",
		LocalDirectory: t.TempDir(),
	}); err == nil {
		t.Fatal("expected traversal rejection")
	}
	state, err := manager.DownloadDirectory(domain.SFTPDownloadDirectoryRequest{
		ConnectionID:   34,
		RemotePath:     "/home/test/bundle",
		LocalDirectory: t.TempDir(),
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	final := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	if final.SkippedCount != 1 {
		t.Fatalf("expected symlink skip, final=%+v", final)
	}
}

func TestRecursiveTransferCancelAndFailureDoNotCloseSession(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	client.writeDelay = 20 * time.Millisecond
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 35, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "bundle")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "big.bin"), bytes.Repeat([]byte("x"), transferBufferSize*4), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
		ConnectionID:    35,
		LocalPath:       root,
		RemoteDirectory: "/home/test",
		ConflictPolicy:  domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferRunning)
	if err := manager.CancelTransfer(state.ID); err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCanceled)
	if !manager.IsActive(35) {
		t.Fatal("canceling a recursive transfer closed the SFTP session")
	}

	client.createErr = errors.New("permission denied")
	client.writeDelay = 0
	state, err = manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
		ConnectionID:    35,
		LocalPath:       root,
		RemoteDirectory: "/home/test",
		ConflictPolicy:  domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferPartialFailed)
	if !manager.IsActive(35) {
		t.Fatal("failed recursive transfer closed the SFTP session")
	}
}

func TestStopCancelsRecursiveTransfersForServer(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	client.writeDelay = 20 * time.Millisecond
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 36, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "bundle")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "big.bin"), bytes.Repeat([]byte("x"), transferBufferSize*4), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
		ConnectionID:    36,
		LocalPath:       root,
		RemoteDirectory: "/home/test",
		ConflictPolicy:  domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferRunning)
	manager.Stop(36)
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCanceled)
	if manager.IsActive(36) {
		t.Fatal("Stop did not close target SFTP session")
	}
}

func TestSFTPFileUploadPauseResumeKeepsOffset(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	client.writeDelay = 25 * time.Millisecond
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 51, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	localPath := filepath.Join(t.TempDir(), "big-upload.bin")
	content := bytes.Repeat([]byte("u"), transferBufferSize*10)
	if err := os.WriteFile(localPath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := manager.Upload(domain.SFTPTransferRequest{
		ConnectionID:   51,
		LocalPath:      localPath,
		RemotePath:     "/home/test/big-upload.bin",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferRunning)
	response, err := manager.PauseTransfer(domain.SFTPTransferControlRequest{
		ConnectionID: 51,
		ContextID:    state.ContextID,
		TransferID:   state.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.TransferID != state.ID {
		t.Fatalf("pause response=%+v", response)
	}
	paused := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferPaused)
	if paused.ResumeOffset <= 0 || !paused.CanResume || !paused.CanCancel {
		t.Fatalf("paused state did not keep offset/control flags: %+v", paused)
	}
	if _, err := manager.ResumeTransfer(domain.SFTPTransferControlRequest{
		ConnectionID: 51,
		ContextID:    state.ContextID,
		TransferID:   state.ID,
	}); err != nil {
		t.Fatal(err)
	}
	final := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	if final.ResumeOffset != int64(len(content)) {
		t.Fatalf("final offset=%d want %d", final.ResumeOffset, len(content))
	}
	client.mu.Lock()
	got := append([]byte(nil), client.files["/home/test/big-upload.bin"]...)
	client.mu.Unlock()
	if !bytes.Equal(got, content) {
		t.Fatalf("uploaded content length=%d want %d", len(got), len(content))
	}
}

func TestSFTPFileDownloadPauseResumeKeepsOffset(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	client.readDelay = 25 * time.Millisecond
	content := bytes.Repeat([]byte("d"), transferBufferSize*10)
	client.files["/home/test/big-download.bin"] = content
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 52, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	localPath := filepath.Join(t.TempDir(), "big-download.bin")
	state, err := manager.Download(domain.SFTPTransferRequest{
		ConnectionID:   52,
		LocalPath:      localPath,
		RemotePath:     "/home/test/big-download.bin",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferRunning)
	if _, err := manager.PauseTransfer(domain.SFTPTransferControlRequest{
		ConnectionID: 52,
		ContextID:    state.ContextID,
		TransferID:   state.ID,
	}); err != nil {
		t.Fatal(err)
	}
	paused := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferPaused)
	if paused.ResumeOffset <= 0 || !paused.CanResume {
		t.Fatalf("paused state=%+v", paused)
	}
	if _, err := manager.ResumeTransfer(domain.SFTPTransferControlRequest{
		ConnectionID: 52,
		ContextID:    state.ContextID,
		TransferID:   state.ID,
	}); err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	if got := mustReadFile(t, localPath); !bytes.Equal(got, content) {
		t.Fatalf("downloaded content length=%d want %d", len(got), len(content))
	}
}

func TestTransferPauseResumeValidationAndIsolation(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	client.dirs["/home/test"] = nil
	client.writeDelay = 25 * time.Millisecond
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 53, Name: "server"}, domain.AuthRequest{}, "term-1", "term-1"); err != nil {
		t.Fatal(err)
	}
	localPath := filepath.Join(t.TempDir(), "big.bin")
	if err := os.WriteFile(localPath, bytes.Repeat([]byte("x"), transferBufferSize*8), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := manager.Upload(domain.SFTPTransferRequest{
		ConnectionID:   53,
		ContextID:      "term-1",
		LocalPath:      localPath,
		RemotePath:     "/home/test/first.bin",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Upload(domain.SFTPTransferRequest{
		ConnectionID:   53,
		ContextID:      "term-1",
		LocalPath:      localPath,
		RemotePath:     "/home/test/second.bin",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.PauseTransfer(domain.SFTPTransferControlRequest{ConnectionID: 53, ContextID: "other", TransferID: first.ID}); err == nil {
		t.Fatal("pause accepted a mismatched context")
	}
	if _, err := manager.ResumeTransfer(domain.SFTPTransferControlRequest{ConnectionID: 53, ContextID: "term-1", TransferID: "missing"}); err == nil {
		t.Fatal("resume accepted a missing transfer")
	}
	waitTransferState(t, emitter.transfer, first.ID, domain.SFTPTransferRunning)
	if _, err := manager.PauseTransfer(domain.SFTPTransferControlRequest{ConnectionID: 53, ContextID: "term-1", TransferID: first.ID}); err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, first.ID, domain.SFTPTransferPaused)
	manager.mu.RLock()
	secondState := manager.transfers[second.ID]
	manager.mu.RUnlock()
	if secondState != nil {
		secondState.mu.RLock()
		status := secondState.state.Status
		secondState.mu.RUnlock()
		if status == domain.SFTPTransferPaused || status == domain.SFTPTransferPausing {
			t.Fatalf("pausing first transfer changed second transfer status: %s", status)
		}
	}
	if err := manager.CancelTransfer(first.ID); err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, first.ID, domain.SFTPTransferCanceled)
	if !manager.IsActive(53) {
		t.Fatal("pause/cancel closed SFTP session")
	}
	manager.CancelTransfer(second.ID)
}

func TestInspectDeleteCountsFilesDirectoriesAndSymlinks(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	addDeleteTree(client)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 37, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	preview, err := manager.InspectDelete(context.Background(), domain.SFTPInspectDeleteRequest{
		ConnectionID: 37,
		Paths:        []string{"/home/test/bundle"},
		Recursive:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if preview.ConnectionID != 37 || len(preview.Paths) != 1 || preview.Paths[0] != "/home/test/bundle" {
		t.Fatalf("unexpected preview identity: %+v", preview)
	}
	if preview.FileCount != 2 || preview.DirectoryCount != 2 || preview.SymlinkCount != 1 {
		t.Fatalf("unexpected preview counts: %+v", preview)
	}
	if !preview.RequiresRecursive {
		t.Fatalf("directory preview should require recursive confirmation: %+v", preview)
	}

	filePreview, err := manager.InspectDelete(context.Background(), domain.SFTPInspectDeleteRequest{
		ConnectionID: 37,
		Paths:        []string{"/home/test/root.txt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if filePreview.FileCount != 1 || filePreview.DirectoryCount != 0 || filePreview.SymlinkCount != 0 {
		t.Fatalf("unexpected file preview: %+v", filePreview)
	}
}

func TestDeleteNonEmptyDirectoryRequiresRecursive(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	addDeleteTree(client)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 38, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	err := manager.Delete(context.Background(), domain.SFTPDeleteRequest{
		ConnectionID: 38,
		Path:         "/home/test/bundle",
		IsDir:        true,
		Recursive:    false,
	})
	if err == nil || !strings.Contains(err.Error(), "目录非空") {
		t.Fatalf("expected non-empty directory error, got %v", err)
	}
	if _, ok := client.dirs["/home/test/bundle"]; !ok {
		t.Fatal("non-recursive delete removed a non-empty directory")
	}
	if !manager.IsActive(38) {
		t.Fatal("failed delete closed the SFTP session")
	}
}

func TestDeleteRecursiveRemovesNestedDirectoryBottomUpAndKeepsSession(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	addDeleteTree(client)
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 39, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	if err := manager.Delete(context.Background(), domain.SFTPDeleteRequest{
		ConnectionID: 39,
		Paths:        []string{"/home/test/bundle"},
		Recursive:    true,
	}); err != nil {
		t.Fatal(err)
	}

	client.mu.Lock()
	defer client.mu.Unlock()
	for _, path := range []string{
		"/home/test/bundle/a.txt",
		"/home/test/bundle/nested/b.txt",
		"/home/test/bundle/link",
	} {
		if _, ok := client.files[path]; ok {
			t.Fatalf("file/link still exists after recursive delete: %s", path)
		}
	}
	for _, path := range []string{"/home/test/bundle/nested", "/home/test/bundle"} {
		if _, ok := client.dirs[path]; ok {
			t.Fatalf("directory still exists after recursive delete: %s", path)
		}
	}
	if got, want := client.removedDirs, []string{"/home/test/bundle/nested", "/home/test/bundle"}; !equalStrings(got, want) {
		t.Fatalf("removed dirs=%v want %v", got, want)
	}
	if !manager.IsActive(39) {
		t.Fatal("recursive delete closed the SFTP session")
	}
}

func TestDeleteRecursiveRejectsDangerousPaths(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 40, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"", "/", ".", "..", "../etc", "/home/test/../etc"} {
		t.Run(path, func(t *testing.T) {
			err := manager.Delete(context.Background(), domain.SFTPDeleteRequest{
				ConnectionID: 40,
				Paths:        []string{path},
				Recursive:    true,
			})
			if err == nil {
				t.Fatalf("dangerous path %q was accepted", path)
			}
		})
	}
}

func TestDeleteRecursiveMultiSelectionAndFailureKeepSession(t *testing.T) {
	emitter := newFakeEmitter()
	client := newFakeClient()
	addDeleteTree(client)
	client.files["/home/test/extra.txt"] = []byte("extra")
	client.dirs["/home/test"] = append(client.dirs["/home/test"], fakeInfo{name: "extra.txt", size: 5, mode: 0o644})
	manager, _, cleanup := newManagerForTest(t, client, emitter)
	defer cleanup()
	if _, err := manager.Open(domain.Connection{ID: 41, Name: "server"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	if err := manager.Delete(context.Background(), domain.SFTPDeleteRequest{
		ConnectionID: 41,
		Paths:        []string{"/home/test/extra.txt", "/home/test/bundle"},
		Recursive:    true,
	}); err != nil {
		t.Fatal(err)
	}
	client.mu.Lock()
	if _, ok := client.files["/home/test/extra.txt"]; ok {
		t.Fatal("multi-selection file still exists")
	}
	client.mu.Unlock()

	client.removeErr = errors.New("permission denied")
	client.files["/home/test/protected.txt"] = []byte("nope")
	err := manager.Delete(context.Background(), domain.SFTPDeleteRequest{
		ConnectionID: 41,
		Paths:        []string{"/home/test/protected.txt"},
		Recursive:    true,
	})
	if err == nil {
		t.Fatal("expected delete failure")
	}
	if !manager.IsActive(41) {
		t.Fatal("failed delete closed the SFTP session")
	}
}

func TestSCPUploadFileSendsProtocolRecords(t *testing.T) {
	emitter := newFakeEmitter()
	uploadCommand := newFakeCommand([]byte{0, 0, 0}, nil)
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			newFakeCommand(nil, errors.New("exit 1")),
			uploadCommand,
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()
	localFile := filepath.Join(t.TempDir(), "local.txt")
	if err := os.WriteFile(localFile, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	state, err := manager.Upload(domain.SFTPTransferRequest{
		ConnectionID:   52,
		LocalPath:      localFile,
		RemotePath:     "/tmp/remote.txt",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != domain.SFTPModeSCP {
		t.Fatalf("transfer mode=%q", state.Mode)
	}
	waitTransfer(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)

	written := uploadCommand.stdin.String()
	if !strings.HasPrefix(written, "C") || !strings.Contains(written, " 5 remote.txt\nhello\x00") {
		t.Fatalf("unexpected SCP upload stream %q", written)
	}
	if got := strings.Join(transport.started, "\n"); !strings.Contains(got, "test -e '/tmp/remote.txt'") || !strings.Contains(got, "scp -t '/tmp/remote.txt'") {
		t.Fatalf("unexpected commands: %v", transport.started)
	}
}

func TestSCPDownloadFileParsesProtocolRecords(t *testing.T) {
	emitter := newFakeEmitter()
	downloadCommand := newFakeCommand([]byte("C0644 5 remote.txt\nhello\x00"), nil)
	transport := &fakeTransport{
		client:   newFakeClient(),
		openErr:  errors.New("remote closed during init"),
		commands: []*fakeCommand{downloadCommand},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()
	localDir := t.TempDir()

	state, err := manager.Download(domain.SFTPTransferRequest{
		ConnectionID:   52,
		LocalPath:      localDir,
		RemotePath:     "/tmp/remote.txt",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransfer(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)

	data, err := os.ReadFile(filepath.Join(localDir, "remote.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("downloaded %q", data)
	}
	if got := downloadCommand.stdin.Bytes(); !equalBytes(got, []byte{0, 0, 0}) {
		t.Fatalf("unexpected download ACKs: %v", got)
	}
}

func TestStopCancelsSCPTransferAndClosesCommand(t *testing.T) {
	emitter := newFakeEmitter()
	blocked := newBlockingCommand()
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		startCommandHook: func(ctx context.Context, command string) (RemoteCommand, error) {
			if strings.HasPrefix(command, "sh -s --") {
				return newFakeCommand([]byte("/root\n"), nil), nil
			}
			if strings.HasPrefix(command, "scp -f ") {
				go func() {
					<-ctx.Done()
					_ = blocked.Close()
				}()
				return blocked, nil
			}
			return newFakeCommand(nil, errors.New("exit 1")), nil
		},
	}
	manager := NewWithDialer(
		context.Background(),
		nil,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			return transport, 0, nil
		},
	)
	defer manager.StopAll()
	connection := domain.Connection{ID: 53, Name: "openwrt"}
	if _, err := manager.Open(connection, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}

	state, err := manager.Download(domain.SFTPTransferRequest{
		ConnectionID:   connection.ID,
		LocalPath:      t.TempDir(),
		RemotePath:     "/tmp/remote.txt",
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferRunning)
	manager.Stop(connection.ID)
	waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCanceled)
	select {
	case <-blocked.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("SCP command was not closed after Stop")
	}
	if !transport.closed {
		t.Fatal("Stop did not close SCP transport")
	}
}

func TestSCPUploadDirectoryUsesShellMkdirAndSingleFileSCP(t *testing.T) {
	emitter := newFakeEmitter()
	rootExistsBefore := newFakeCommand(nil, errors.New("exit 1"))
	rootExistsEnsure := newFakeCommand(nil, errors.New("exit 1"))
	rootMkdir := newFakeCommand(nil, nil)
	emptyExists := newFakeCommand(nil, errors.New("exit 1"))
	emptyMkdir := newFakeCommand(nil, nil)
	fileExists := newFakeCommand(nil, errors.New("exit 1"))
	uploadCommand := newFakeCommand([]byte{0, 0, 0}, nil)
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			rootExistsBefore,
			rootExistsEnsure,
			rootMkdir,
			emptyExists,
			emptyMkdir,
			fileExists,
			uploadCommand,
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()
	localDir := filepath.Join(t.TempDir(), "folder")
	if err := os.MkdirAll(filepath.Join(localDir, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}

	state, err := manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
		ConnectionID:    52,
		LocalPath:       localDir,
		RemoteDirectory: "/tmp",
		ConflictPolicy:  domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransfer(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)

	written := uploadCommand.stdin.String()
	if strings.Contains(written, "D") || strings.Contains(written, "E\n") || !strings.Contains(written, " 1 a.txt\na\x00") {
		t.Fatalf("unexpected single-file upload stream %q", written)
	}
	if !strings.Contains(rootMkdir.stdin.String(), "mkdir") || !strings.Contains(emptyMkdir.stdin.String(), "mkdir") {
		t.Fatalf("directory mkdir scripts were not used: root=%q empty=%q", rootMkdir.stdin.String(), emptyMkdir.stdin.String())
	}
	started := strings.Join(transport.started, "\n")
	if strings.Contains(started, "scp -r") {
		t.Fatalf("unexpected commands: %v", transport.started)
	}
	if !strings.Contains(started, "scp -t '/tmp/folder/a.txt'") {
		t.Fatalf("single-file SCP upload was not used: %v", transport.started)
	}
}

func TestSCPUploadDirectoryPreservesRenamedRoot(t *testing.T) {
	emitter := newFakeEmitter()
	rootExistsBefore := newFakeCommand(nil, nil)
	rootStat := newFakeCommand([]byte("SP_ENTRY\tfile\t1\t1710000000\t644\t1000\t1000\tfolder\n"), nil)
	renamedRootMissing := newFakeCommand(nil, errors.New("exit 1"))
	renamedRootEnsure := newFakeCommand(nil, errors.New("exit 1"))
	rootMkdir := newFakeCommand(nil, nil)
	fileExists := newFakeCommand(nil, errors.New("exit 1"))
	uploadCommand := newFakeCommand([]byte{0, 0, 0}, nil)
	transport := &fakeTransport{
		client:  newFakeClient(),
		openErr: errors.New("subsystem request failed"),
		commands: []*fakeCommand{
			rootExistsBefore,
			rootStat,
			renamedRootMissing,
			renamedRootEnsure,
			rootMkdir,
			fileExists,
			uploadCommand,
		},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()
	localDir := filepath.Join(t.TempDir(), "folder")
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}

	state, err := manager.UploadDirectory(domain.SFTPUploadDirectoryRequest{
		ConnectionID:    52,
		LocalPath:       localDir,
		RemoteDirectory: "/tmp",
		ConflictPolicy:  domain.SFTPConflictRename,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransfer(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)

	started := strings.Join(transport.started, "\n")
	if strings.Contains(started, "scp -r") {
		t.Fatalf("unexpected commands: %v", transport.started)
	}
	if !strings.Contains(started, "scp -t '/tmp/folder (1)/a.txt'") {
		t.Fatalf("renamed root was not preserved for file upload: %v", transport.started)
	}
	if !strings.Contains(started, "sh -s -- '/tmp/folder (1)'") {
		t.Fatalf("renamed root was not used for mkdir: %v", transport.started)
	}
}

func TestSCPDownloadDirectoryUsesShellListingAndSingleFileSCP(t *testing.T) {
	emitter := newFakeEmitter()
	statRoot := newFakeCommand([]byte("SP_ENTRY\tdir\t0\t1710000000\t755\t1000\t1000\tdir\n"), nil)
	listRoot := newFakeCommand([]byte(strings.Join([]string{
		"SP_PATH\t/tmp/dir",
		"SP_ENTRY\tfile\t1\t1710000001\t644\t1000\t1000\ta.txt",
		"SP_ENTRY\tdir\t0\t1710000002\t755\t1000\t1000\tempty",
		"SP_ENTRY\tdir\t0\t1710000003\t755\t1000\t1000\tnested",
		"SP_ENTRY\tsymlink\t4\t1710000004\t777\t1000\t1000\tlink",
	}, "\n")), nil)
	listEmpty := newFakeCommand([]byte("SP_PATH\t/tmp/dir/empty\n"), nil)
	listNested := newFakeCommand([]byte("SP_PATH\t/tmp/dir/nested\nSP_ENTRY\tfile\t1\t1710000005\t644\t1000\t1000\tb.txt\n"), nil)
	downloadNested := newFakeCommand([]byte("C0644 1 b.txt\nb\x00"), nil)
	downloadRoot := newFakeCommand([]byte("C0644 1 a.txt\na\x00"), nil)
	transport := &fakeTransport{
		client:   newFakeClient(),
		openErr:  errors.New("subsystem request failed"),
		commands: []*fakeCommand{statRoot, listRoot, listEmpty, listNested, downloadNested, downloadRoot},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()
	localDir := t.TempDir()

	state, err := manager.DownloadDirectory(domain.SFTPDownloadDirectoryRequest{
		ConnectionID:   52,
		RemotePath:     "/tmp/dir",
		LocalDirectory: localDir,
		ConflictPolicy: domain.SFTPConflictOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	final := waitTransferState(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)
	if final.FilesTotal != 2 || final.FilesDone != 2 || final.SkippedCount != 1 {
		t.Fatalf("unexpected recursive progress: %+v", final)
	}

	data, err := os.ReadFile(filepath.Join(localDir, "dir", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "a" {
		t.Fatalf("downloaded %q", data)
	}
	if _, err := os.Stat(filepath.Join(localDir, "dir", "empty")); err != nil {
		t.Fatalf("empty directory was not preserved: %v", err)
	}
	if got := string(mustReadFile(t, filepath.Join(localDir, "dir", "nested", "b.txt"))); got != "b" {
		t.Fatalf("nested downloaded %q", got)
	}
	started := strings.Join(transport.started, "\n")
	if strings.Contains(started, "scp -r") {
		t.Fatalf("unexpected commands: %v", transport.started)
	}
	for _, want := range []string{"sh -s -- '/tmp/dir'", "sh -s -- '/tmp/dir/empty'", "sh -s -- '/tmp/dir/nested'", "scp -f '/tmp/dir/nested/b.txt'", "scp -f '/tmp/dir/a.txt'"} {
		if !strings.Contains(started, want) {
			t.Fatalf("missing command %q in %q", want, started)
		}
	}
}

func TestSCPDownloadDirectoryPreservesRenamedLocalRoot(t *testing.T) {
	emitter := newFakeEmitter()
	statRoot := newFakeCommand([]byte("SP_ENTRY\tdir\t0\t1710000000\t755\t1000\t1000\tdir\n"), nil)
	listRoot := newFakeCommand([]byte("SP_PATH\t/tmp/dir\nSP_ENTRY\tfile\t1\t1710000001\t644\t1000\t1000\ta.txt\n"), nil)
	downloadRoot := newFakeCommand([]byte("C0644 1 a.txt\na\x00"), nil)
	transport := &fakeTransport{
		client:   newFakeClient(),
		openErr:  errors.New("subsystem request failed"),
		commands: []*fakeCommand{statRoot, listRoot, downloadRoot},
	}
	manager, cleanup := newSCPManagerForTest(t, transport, emitter)
	defer cleanup()
	localDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(localDir, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}

	state, err := manager.DownloadDirectory(domain.SFTPDownloadDirectoryRequest{
		ConnectionID:   52,
		RemotePath:     "/tmp/dir",
		LocalDirectory: localDir,
		ConflictPolicy: domain.SFTPConflictRename,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTransfer(t, emitter.transfer, state.ID, domain.SFTPTransferCompleted)

	if got := string(mustReadFile(t, filepath.Join(localDir, "dir (1)", "a.txt"))); got != "a" {
		t.Fatalf("renamed local root was not preserved, got %q", got)
	}
	if _, err := os.Stat(filepath.Join(localDir, "dir", "a.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("download unexpectedly used original root: %v", err)
	}
	started := strings.Join(transport.started, "\n")
	if strings.Contains(started, "scp -r") {
		t.Fatalf("unexpected commands: %v", transport.started)
	}
}

func TestSCPRejectsTraversalAndReportsAckErrors(t *testing.T) {
	for _, path := range []string{"", "/", ".", "..", "../etc", "/tmp/../etc"} {
		if err := validateSCPRemoteTarget(path); err == nil {
			t.Fatalf("accepted unsafe path %q", path)
		}
	}
	err := readSCPAck(bufio.NewReader(bytes.NewBuffer(append([]byte{1}, []byte("permission denied\n")...))))
	if err == nil || !strings.Contains(err.Error(), "SCP 远端错误") {
		t.Fatalf("unexpected ack error: %v", err)
	}
	_, err = readSCPRecord(bufio.NewReader(bytes.NewBufferString("C0644 1 ../bad\nx\x00")))
	if err == nil {
		t.Fatal("accepted traversal filename from SCP server")
	}
}

func waitTransfer(t *testing.T, events <-chan domain.SFTPTransferState, id string, status domain.SFTPTransferStatus) {
	t.Helper()
	_ = waitTransferState(t, events, id, status)
}

func waitTransferState(t *testing.T, events <-chan domain.SFTPTransferState, id string, status domain.SFTPTransferStatus) domain.SFTPTransferState {
	t.Helper()
	return waitTransferMatch(t, events, func(event domain.SFTPTransferState) bool {
		return event.ID == id && event.Status == status
	}, string(status))
}

func waitTransferMatch(t *testing.T, events <-chan domain.SFTPTransferState, match func(domain.SFTPTransferState) bool, description string) domain.SFTPTransferState {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			if match(event) {
				return event
			}
		case <-timer.C:
			t.Fatalf("timed out waiting for transfer %s", description)
		}
	}
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func addDeleteTree(client *fakeClient) {
	client.dirs["/home/test"] = []fs.FileInfo{
		fakeInfo{name: "bundle", mode: fs.ModeDir | 0o755},
		fakeInfo{name: "root.txt", size: 4, mode: 0o644},
	}
	client.dirs["/home/test/bundle"] = []fs.FileInfo{
		fakeInfo{name: "a.txt", size: 1, mode: 0o644},
		fakeInfo{name: "nested", mode: fs.ModeDir | 0o755},
		fakeInfo{name: "link", size: 3, mode: fs.ModeSymlink | 0o777},
	}
	client.dirs["/home/test/bundle/nested"] = []fs.FileInfo{
		fakeInfo{name: "b.txt", size: 1, mode: 0o644},
	}
	client.files["/home/test/root.txt"] = []byte("root")
	client.files["/home/test/bundle/a.txt"] = []byte("a")
	client.files["/home/test/bundle/nested/b.txt"] = []byte("b")
	client.files["/home/test/bundle/link"] = []byte("ptr")
	client.modes["/home/test/bundle/link"] = fs.ModeSymlink | 0o777
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func newSCPManagerForTest(t *testing.T, transport *fakeTransport, emitter fakeEmitter) (*Manager, func()) {
	t.Helper()
	transport.commands = append([]*fakeCommand{newFakeCommand([]byte("/root\n"), nil)}, transport.commands...)
	manager := NewWithDialer(
		context.Background(),
		nil,
		emitter,
		func() time.Duration { return time.Second },
		func(context.Context, domain.Connection, domain.AuthRequest, time.Duration) (Transport, time.Duration, error) {
			return transport, 0, nil
		},
	)
	if _, err := manager.Open(domain.Connection{ID: 52, Name: "openwrt"}, domain.AuthRequest{}); err != nil {
		t.Fatal(err)
	}
	return manager, manager.StopAll
}
