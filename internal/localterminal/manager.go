package localterminal

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
)

const (
	ExperimentalEnv = "SERVERPILOT_LOCAL_TERMINAL_EXPERIMENTAL"
	maxInputBytes   = 64 * 1024
	readBuffer      = 32 * 1024
)

var (
	ErrUnsupported          = errors.New("当前系统不支持本地终端")
	ErrNotFound             = errors.New("本地终端会话不存在")
	ErrDisabled             = errors.New("LOCAL_TERMINAL_DISABLED: 本地终端暂未启用")
	ErrNeedElevatedRelaunch = errors.New("NEED_ELEVATED_RELAUNCH: 管理员本地终端需要以管理员身份运行 HostDeck")
)

type lookPathFunc func(string) (string, error)

type Emitter interface {
	Output(domain.LocalTerminalOutputEvent)
	State(domain.LocalTerminalStateEvent)
	Error(domain.LocalTerminalErrorEvent)
}

type PTY interface {
	io.ReadWriteCloser
	Resize(cols, rows int) error
}

type PTYProcess interface {
	Start() error
	Wait() error
	ExitCode() *int
}

type PTYFactory interface {
	Start(ctx context.Context, shell string, cwd string, cols int, rows int) (PTY, PTYProcess, error)
}

type Manager struct {
	ctx      context.Context
	logger   *logging.Logger
	emitter  Emitter
	factory  PTYFactory
	mu       sync.RWMutex
	sessions map[string]*session
}

type session struct {
	id        string
	shell     string
	shellKind string
	shellName string
	elevated  bool
	title     string
	cwd       string
	startedAt string
	cancel    context.CancelFunc
	pty       PTY
	process   PTYProcess
	done      chan struct{}
	input     chan []byte

	mu      sync.RWMutex
	state   domain.LocalTerminalState
	closed  bool
	closeMu sync.Once
}

func New(ctx context.Context, logger *logging.Logger, emitter Emitter) *Manager {
	return NewWithFactory(ctx, logger, emitter, realFactory{})
}

func NewWithFactory(ctx context.Context, logger *logging.Logger, emitter Emitter, factory PTYFactory) *Manager {
	if ctx == nil {
		ctx = context.Background()
	}
	if factory == nil {
		factory = unsupportedFactory{}
	}
	return &Manager{
		ctx:      ctx,
		logger:   logger,
		emitter:  emitter,
		factory:  factory,
		sessions: make(map[string]*session),
	}
}

func Capabilities(current domain.LocalTerminalShellPreference) domain.LocalTerminalCapabilities {
	conptyAvailable := platformLocalTerminalAvailable()
	return CapabilitiesForPlatform(
		runtime.GOOS,
		current,
		conptyAvailable,
		platformProcessElevated(),
		shellResolverAvailable(runtime.GOOS, exec.LookPath),
	)
}

func CapabilitiesForPlatform(
	platform string,
	current domain.LocalTerminalShellPreference,
	conptyAvailable bool,
	isProcessElevated bool,
	shellAvailable bool,
) domain.LocalTerminalCapabilities {
	options := shellOptionsForPlatform(platform)
	if current == "" || !isShellPreferenceAllowedForOptions(string(current), options) {
		current = domain.LocalTerminalShellAuto
	}
	supported := platformSupportsLocalTerminal(platform, conptyAvailable, shellAvailable)
	capabilities := domain.LocalTerminalCapabilities{
		Platform:               platformName(platform),
		Enabled:                supported,
		Supported:              supported,
		ConPTYAvailable:        conptyAvailable,
		IsProcessElevated:      isProcessElevated,
		SupportsElevation:      platform == "windows" && conptyAvailable,
		ShellOptions:           []domain.LocalTerminalShellOption{},
		AdminShellOptions:      []domain.LocalTerminalShellOption{},
		DefaultShellPreference: string(domain.LocalTerminalShellAuto),
		CurrentShellPreference: string(current),
		UnsupportedMessage:     "",
	}
	if !supported {
		capabilities.UnsupportedMessage = unsupportedMessage(platform, conptyAvailable, shellAvailable)
		return capabilities
	}
	capabilities.ShellOptions = localTerminalShellOptionsForPlatform(platform, false)
	capabilities.AdminShellOptions = localTerminalShellOptionsForPlatform(platform, true)
	return capabilities
}

func platformSupportsLocalTerminal(platform string, platformAvailable bool, shellAvailable bool) bool {
	switch platform {
	case "windows", "darwin":
		return platformAvailable && shellAvailable
	default:
		return false
	}
}

func unsupportedMessage(platform string, conptyAvailable bool, shellAvailable bool) string {
	if platform != "windows" {
		if platform == "darwin" && !shellAvailable {
			return "未找到可用的 macOS 本地 shell"
		}
		return "当前平台暂未支持本地终端"
	}
	if !conptyAvailable {
		return "当前 Windows 系统不支持 Direct ConPTY 本地终端"
	}
	if !shellAvailable {
		return "未找到可用的 CMD 或 PowerShell"
	}
	return ErrUnsupported.Error()
}

func localTerminalShellOptionsForPlatform(platform string, admin bool) []domain.LocalTerminalShellOption {
	if platform == "darwin" {
		if admin {
			return []domain.LocalTerminalShellOption{}
		}
		return []domain.LocalTerminalShellOption{
			{ID: string(domain.LocalTerminalShellKindLocal), Label: "本地终端", Description: "打开 macOS 本地终端。"},
		}
	}
	if admin {
		return []domain.LocalTerminalShellOption{
			{ID: "cmd-admin", Label: "CMD（管理员）", Description: "以管理员身份运行 HostDeck 时打开管理员 CMD。"},
			{ID: "powershell-admin", Label: "PowerShell（管理员）", Description: "以管理员身份运行 HostDeck 时打开管理员 PowerShell。"},
		}
	}
	return []domain.LocalTerminalShellOption{
		{ID: string(domain.LocalTerminalShellKindCmd), Label: "CMD", Description: "打开 cmd.exe 本地终端。"},
		{ID: string(domain.LocalTerminalShellKindPowerShell), Label: "PowerShell", Description: "打开 PowerShell 本地终端。"},
	}
}

func RuntimeAvailable() bool {
	return runtimeAvailableForPlatform(runtime.GOOS, exec.LookPath, platformLocalTerminalAvailable())
}

func ExperimentalEnabled() bool {
	return RuntimeAvailable()
}

func runtimeAvailableForPlatform(platform string, lookPath lookPathFunc, platformAvailable bool) bool {
	if !platformAvailable {
		return false
	}
	if platform != "windows" && platform != "darwin" {
		return false
	}
	return shellResolverAvailable(platform, lookPath)
}

func shellResolverAvailable(platform string, lookPath lookPathFunc) bool {
	if platform == "darwin" {
		if _, err := resolveShellKindForPlatform(platform, string(domain.LocalTerminalShellKindLocal), lookPath); err == nil {
			return true
		}
		return false
	}
	if _, err := resolveShellKindForPlatform(platform, string(domain.LocalTerminalShellKindCmd), lookPath); err == nil {
		return true
	}
	if _, err := resolveShellKindForPlatform(platform, string(domain.LocalTerminalShellKindPowerShell), lookPath); err == nil {
		return true
	}
	return false
}

func IsShellKindAllowed(kind string) bool {
	_, ok := normalizeShellKind(kind)
	return ok
}

func normalizeShellKind(kind string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case string(domain.LocalTerminalShellKindCmd):
		return string(domain.LocalTerminalShellKindCmd), true
	case string(domain.LocalTerminalShellKindPowerShell):
		return string(domain.LocalTerminalShellKindPowerShell), true
	case string(domain.LocalTerminalShellKindLocal):
		return string(domain.LocalTerminalShellKindLocal), true
	default:
		return "", false
	}
}

func shellKindTitle(kind string, elevated bool) string {
	title := "本地终端"
	switch kind {
	case string(domain.LocalTerminalShellKindCmd):
		title = "CMD"
	case string(domain.LocalTerminalShellKindPowerShell):
		title = "PowerShell"
	case string(domain.LocalTerminalShellKindLocal):
		title = "本地终端"
	}
	if elevated {
		return title + "（管理员）"
	}
	return title
}

func shellKindFromPath(path string) string {
	base := strings.ToLower(filepath.Base(path))
	switch base {
	case "cmd", "cmd.exe":
		return string(domain.LocalTerminalShellKindCmd)
	case "pwsh", "pwsh.exe", "powershell", "powershell.exe":
		return string(domain.LocalTerminalShellKindPowerShell)
	case "zsh", "bash", "sh":
		return string(domain.LocalTerminalShellKindLocal)
	default:
		return ""
	}
}

func IsShellPreferenceAllowed(preference string) bool {
	return isShellPreferenceAllowedForOptions(preference, shellOptionsForPlatform(runtime.GOOS))
}

func shellOptionsForPlatform(platform string) []domain.LocalTerminalShellOption {
	switch platform {
	case "windows":
		return []domain.LocalTerminalShellOption{
			{ID: string(domain.LocalTerminalShellAuto), Label: "自动", Description: "优先 pwsh.exe，其次 powershell.exe，最后 cmd.exe。"},
			{ID: string(domain.LocalTerminalShellPowerShell), Label: "PowerShell", Description: "优先 pwsh.exe，不存在时回退到 Windows PowerShell。"},
			{ID: string(domain.LocalTerminalShellCmd), Label: "cmd", Description: "直接使用 cmd.exe。"},
		}
	case "darwin":
		return []domain.LocalTerminalShellOption{
			{ID: string(domain.LocalTerminalShellAuto), Label: "自动", Description: "优先使用用户 SHELL，其次 /bin/zsh，最后 /bin/bash。"},
			{ID: string(domain.LocalTerminalShellZsh), Label: "zsh", Description: "使用 macOS 默认 zsh。"},
			{ID: string(domain.LocalTerminalShellBash), Label: "bash", Description: "使用 bash。"},
		}
	case "linux":
		return []domain.LocalTerminalShellOption{
			{ID: string(domain.LocalTerminalShellAuto), Label: "自动", Description: "优先 bash，其次 zsh，最后 sh。"},
			{ID: string(domain.LocalTerminalShellBash), Label: "bash", Description: "使用 bash。"},
			{ID: string(domain.LocalTerminalShellZsh), Label: "zsh", Description: "使用 zsh。"},
			{ID: string(domain.LocalTerminalShellSh), Label: "sh", Description: "使用 sh。"},
		}
	default:
		return []domain.LocalTerminalShellOption{
			{ID: string(domain.LocalTerminalShellAuto), Label: "自动", Description: "当前平台暂未支持本地终端。"},
		}
	}
}

func isShellPreferenceAllowedForOptions(preference string, options []domain.LocalTerminalShellOption) bool {
	preference = strings.TrimSpace(preference)
	for _, option := range options {
		if option.ID == preference {
			return true
		}
	}
	return false
}

func platformName(platform string) string {
	switch platform {
	case "windows", "darwin", "linux":
		return platform
	default:
		return "unknown"
	}
}

func (m *Manager) Open(request domain.LocalTerminalOpenRequest) (domain.LocalTerminalOpenResponse, error) {
	cols, rows := normalizeSize(request.Cols, request.Rows)
	shell, shellKind, err := resolveOpenShell(request)
	if err != nil {
		return domain.LocalTerminalOpenResponse{}, err
	}
	if request.Elevated && !platformProcessElevated() {
		return domain.LocalTerminalOpenResponse{}, ErrNeedElevatedRelaunch
	}
	cwd := resolveCwd(request.Cwd)
	ctx, cancel := context.WithCancel(m.ctx)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	shellName := filepath.Base(shell)
	title := shellKindTitle(shellKind, request.Elevated)
	current := &session{
		id:        newSessionID(),
		shell:     shell,
		shellKind: shellKind,
		shellName: shellName,
		elevated:  request.Elevated,
		title:     title,
		cwd:       cwd,
		startedAt: now,
		cancel:    cancel,
		done:      make(chan struct{}),
		input:     make(chan []byte, 128),
	}
	current.state = domain.LocalTerminalState{
		SessionID: current.id,
		ShellKind: shellKind,
		Shell:     title,
		ShellName: shellName,
		Elevated:  request.Elevated,
		Title:     title,
		Cwd:       cwd,
		Status:    domain.LocalTerminalStarting,
		StartedAt: now,
	}

	m.mu.Lock()
	m.sessions[current.id] = current
	m.mu.Unlock()
	m.emitState(current.snapshot())

	term, process, err := m.factory.Start(ctx, shell, cwd, cols, rows)
	if err != nil {
		current.setState(domain.LocalTerminalFailed, nil, userError(err))
		m.emitState(current.snapshot())
		cancel()
		m.mu.Lock()
		delete(m.sessions, current.id)
		m.mu.Unlock()
		close(current.done)
		return domain.LocalTerminalOpenResponse{}, err
	}
	current.pty = term
	current.process = process
	current.setState(domain.LocalTerminalRunning, nil, "")
	m.emitState(current.snapshot())
	go m.run(ctx, current)

	if m.logger != nil {
		m.logger.Write(
			"info",
			fmt.Sprintf("本地终端已启动 session=%s shell=%s pid=%d", current.id, filepath.Base(shell), processID(process)),
			"localterminal.open",
			0,
			nil,
		)
	}
	return domain.LocalTerminalOpenResponse{
		SessionID: current.id,
		ShellKind: shellKind,
		Shell:     title,
		ShellName: shellName,
		Elevated:  request.Elevated,
		Title:     title,
		Status:    string(domain.LocalTerminalRunning),
		Cwd:       cwd,
		StartedAt: now,
	}, nil
}

func (m *Manager) Write(request domain.LocalTerminalWriteRequest) error {
	current, ok := m.lookup(request.SessionID)
	if !ok {
		return ErrNotFound
	}
	data, err := base64.StdEncoding.DecodeString(request.DataBase64)
	if err != nil {
		return errors.New("本地终端输入格式无效")
	}
	if len(data) > maxInputBytes {
		return errors.New("本地终端输入过大")
	}
	select {
	case current.input <- data:
		return nil
	case <-current.done:
		return ErrNotFound
	case <-m.ctx.Done():
		return m.ctx.Err()
	}
}

func (m *Manager) Resize(request domain.LocalTerminalResizeRequest) error {
	current, ok := m.lookup(request.SessionID)
	if !ok {
		return ErrNotFound
	}
	cols, rows := normalizeSize(request.Cols, request.Rows)
	current.mu.RLock()
	term := current.pty
	current.mu.RUnlock()
	if term == nil {
		return ErrNotFound
	}
	if err := term.Resize(cols, rows); err != nil {
		return errors.New("调整本地终端尺寸失败")
	}
	return nil
}

func (m *Manager) Close(sessionID string) {
	current, ok := m.lookup(sessionID)
	if !ok {
		return
	}
	m.closeSession(current, domain.LocalTerminalClosed, "")
}

func (m *Manager) CloseAll() {
	m.mu.RLock()
	sessions := make([]*session, 0, len(m.sessions))
	for _, current := range m.sessions {
		sessions = append(sessions, current)
	}
	m.mu.RUnlock()
	for _, current := range sessions {
		m.closeSession(current, domain.LocalTerminalClosed, "")
	}
	for _, current := range sessions {
		<-current.done
	}
}

func (m *Manager) List() []domain.LocalTerminalState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	states := make([]domain.LocalTerminalState, 0, len(m.sessions))
	for _, current := range m.sessions {
		states = append(states, current.snapshot())
	}
	return states
}

func (m *Manager) State(sessionID string) (domain.LocalTerminalState, error) {
	current, ok := m.lookup(sessionID)
	if !ok {
		return domain.LocalTerminalState{}, ErrNotFound
	}
	return current.snapshot(), nil
}

func (m *Manager) run(ctx context.Context, current *session) {
	defer func() {
		if recovered := recover(); recovered != nil {
			current.cancel()
			if current.pty != nil {
				_ = current.pty.Close()
			}
			current.setState(domain.LocalTerminalFailed, nil, "本地终端运行异常")
			m.emitError(current.id, "本地终端运行异常")
			m.emitState(current.snapshot())
		}
	}()
	defer close(current.done)
	defer func() {
		m.mu.Lock()
		delete(m.sessions, current.id)
		m.mu.Unlock()
	}()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		m.readLoop(ctx, current)
	}()
	go func() {
		defer wg.Done()
		m.writeLoop(ctx, current)
	}()

	waitErr := current.process.Wait()
	current.cancel()
	_ = current.pty.Close()
	wg.Wait()

	current.mu.RLock()
	alreadyClosed := current.closed
	current.mu.RUnlock()
	if alreadyClosed {
		return
	}
	exitCode := current.process.ExitCode()
	if waitErr != nil && !errors.Is(waitErr, context.Canceled) {
		current.setState(domain.LocalTerminalFailed, exitCode, "本地终端进程异常退出")
		m.emitError(current.id, "本地终端进程异常退出")
	} else {
		current.setState(domain.LocalTerminalExited, exitCode, "")
	}
	if m.logger != nil {
		m.logger.Write(
			"info",
			fmt.Sprintf("本地终端已退出 session=%s shell=%s exitCode=%s", current.id, filepath.Base(current.shell), exitCodeLabel(exitCode)),
			"localterminal.exit",
			0,
			waitErr,
		)
	}
	m.emitState(current.snapshot())
}

func (m *Manager) readLoop(ctx context.Context, current *session) {
	defer func() {
		if recovered := recover(); recovered != nil {
			current.cancel()
			if current.pty != nil {
				_ = current.pty.Close()
			}
			m.emitError(current.id, "本地终端读取异常")
		}
	}()
	buf := make([]byte, readBuffer)
	for {
		n, err := current.pty.Read(buf)
		if n > 0 {
			m.emitOutput(current.id, buf[:n])
		}
		if err != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

func (m *Manager) writeLoop(ctx context.Context, current *session) {
	defer func() {
		if recovered := recover(); recovered != nil {
			current.cancel()
			if current.pty != nil {
				_ = current.pty.Close()
			}
			m.emitError(current.id, "本地终端写入异常")
		}
	}()
	for {
		select {
		case data := <-current.input:
			if len(data) == 0 {
				continue
			}
			if _, err := current.pty.Write(data); err != nil {
				m.emitError(current.id, "写入本地终端失败")
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func (m *Manager) closeSession(current *session, status domain.LocalTerminalStatus, message string) {
	current.closeMu.Do(func() {
		current.mu.Lock()
		current.closed = true
		current.mu.Unlock()
		m.mu.Lock()
		delete(m.sessions, current.id)
		m.mu.Unlock()
		current.setState(status, nil, message)
		current.cancel()
		if current.pty != nil {
			_ = current.pty.Close()
		}
		if m.logger != nil {
			m.logger.Write(
				"info",
				fmt.Sprintf("本地终端已关闭 session=%s shell=%s state=%s", current.id, filepath.Base(current.shell), status),
				"localterminal.close",
				0,
				nil,
			)
		}
		m.emitState(current.snapshot())
	})
}

func (m *Manager) lookup(sessionID string) (*session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	current, ok := m.sessions[strings.TrimSpace(sessionID)]
	return current, ok
}

func (m *Manager) emitOutput(sessionID string, data []byte) {
	if m.emitter == nil || len(data) == 0 {
		return
	}
	if _, ok := m.lookup(sessionID); !ok {
		return
	}
	m.safeEmit("localterminal.output", func() {
		m.emitter.Output(domain.LocalTerminalOutputEvent{
			SessionID:  sessionID,
			DataBase64: base64.StdEncoding.EncodeToString(data),
			Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		})
	})
}

func (m *Manager) emitState(state domain.LocalTerminalState) {
	if m.emitter == nil {
		return
	}
	m.safeEmit("localterminal.state", func() {
		m.emitter.State(domain.LocalTerminalStateEvent{
			State:     state,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})
	})
}

func (m *Manager) emitError(sessionID, message string) {
	if m.emitter == nil {
		return
	}
	m.safeEmit("localterminal.error", func() {
		m.emitter.Error(domain.LocalTerminalErrorEvent{
			SessionID: sessionID,
			Message:   message,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})
	})
}

func (m *Manager) safeEmit(operation string, emit func()) {
	defer func() {
		if recovered := recover(); recovered != nil && m.logger != nil {
			m.logger.Write("warn", "本地终端事件发送失败", operation, 0, fmt.Errorf("%v", recovered))
		}
	}()
	emit()
}

func (s *session) setState(status domain.LocalTerminalStatus, exitCode *int, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Status = status
	s.state.ExitCode = exitCode
	s.state.Error = message
	if status == domain.LocalTerminalExited ||
		status == domain.LocalTerminalFailed ||
		status == domain.LocalTerminalClosed {
		s.state.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
}

func (s *session) snapshot() domain.LocalTerminalState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func normalizeSize(cols, rows int) (int, int) {
	if cols < 1 {
		cols = 100
	}
	if rows < 1 {
		rows = 30
	}
	return cols, rows
}

func resolveCwd(value string) string {
	value = strings.TrimSpace(value)
	if value != "" {
		if info, err := os.Stat(value); err == nil && info.IsDir() {
			if abs, err := filepath.Abs(value); err == nil {
				return abs
			}
			return value
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "."
}

func resolveShell(requested string) (string, error) {
	return resolveShellForPlatform(runtime.GOOS, requested, exec.LookPath)
}

func resolveOpenShell(request domain.LocalTerminalOpenRequest) (string, string, error) {
	if kind, ok := normalizeShellKind(request.ShellKind); ok {
		shell, err := resolveShellKindForPlatform(runtime.GOOS, kind, exec.LookPath)
		return shell, kind, err
	}
	if strings.TrimSpace(request.ShellKind) != "" {
		return "", "", errors.New("本地终端 shell 类型无效")
	}
	if strings.TrimSpace(request.Shell) == "" {
		return "", "", errors.New("本地终端 shell 类型无效")
	}
	shell, err := resolveShell(request.Shell)
	if err != nil {
		return "", "", err
	}
	return shell, shellKindFromPath(shell), nil
}

func resolveShellKindForPlatform(platform, kind string, lookPath lookPathFunc) (string, error) {
	kind, ok := normalizeShellKind(kind)
	if !ok {
		return "", errors.New("本地终端 shell 类型无效")
	}
	var candidates []string
	switch platform {
	case "windows":
		switch kind {
		case string(domain.LocalTerminalShellKindCmd):
			candidates = []string{"cmd.exe"}
		case string(domain.LocalTerminalShellKindPowerShell):
			candidates = []string{"pwsh.exe", "powershell.exe"}
		}
	case "darwin":
		if kind == string(domain.LocalTerminalShellKindLocal) {
			candidates = shellCandidates(platform, string(domain.LocalTerminalShellAuto))
		}
	default:
		return "", ErrUnsupported
	}
	for _, candidate := range candidates {
		if path, err := lookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", errors.New("未找到可用的本地 shell")
}

func resolveShellForPlatform(platform, requested string, lookPath lookPathFunc) (string, error) {
	requested = strings.TrimSpace(requested)
	candidates := shellCandidates(platform, requested)
	if len(candidates) == 0 {
		if path, err := lookPath(requested); err == nil {
			return path, nil
		}
		return "", errors.New("指定的本地 shell 不存在")
	}
	for _, candidate := range candidates {
		if path, err := lookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", errors.New("未找到可用的本地 shell")
}

func shellCandidates(platform, preference string) []string {
	switch platform {
	case "windows":
		switch domain.LocalTerminalShellPreference(preference) {
		case "", domain.LocalTerminalShellAuto:
			return []string{"pwsh.exe", "powershell.exe", "cmd.exe"}
		case domain.LocalTerminalShellPowerShell:
			return []string{"pwsh.exe", "powershell.exe"}
		case domain.LocalTerminalShellCmd:
			return []string{"cmd.exe"}
		}
	case "darwin":
		switch domain.LocalTerminalShellPreference(preference) {
		case "", domain.LocalTerminalShellAuto:
			candidates := make([]string, 0, 3)
			if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
				candidates = append(candidates, shell)
			}
			candidates = append(candidates, "/bin/zsh", "/bin/bash")
			return uniqueStrings(candidates)
		case domain.LocalTerminalShellZsh:
			return []string{"/bin/zsh", "zsh"}
		case domain.LocalTerminalShellBash:
			return []string{"/bin/bash", "bash"}
		}
	case "linux":
		switch domain.LocalTerminalShellPreference(preference) {
		case "", domain.LocalTerminalShellAuto:
			return []string{"bash", "zsh", "sh"}
		case domain.LocalTerminalShellBash:
			return []string{"bash"}
		case domain.LocalTerminalShellZsh:
			return []string{"zsh"}
		case domain.LocalTerminalShellSh:
			return []string{"sh"}
		}
	}
	return nil
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func userError(err error) string {
	if errors.Is(err, ErrUnsupported) {
		return ErrUnsupported.Error()
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "本地终端启动失败"
	}
	return message
}

func newSessionID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("local-%d", time.Now().UnixNano())
	}
	return "local-" + hex.EncodeToString(raw[:])
}

type processWithPID interface {
	PID() int
}

func processID(process PTYProcess) int {
	if process == nil {
		return 0
	}
	if value, ok := process.(processWithPID); ok {
		return value.PID()
	}
	return 0
}

func exitCodeLabel(exitCode *int) string {
	if exitCode == nil {
		return "unknown"
	}
	return fmt.Sprintf("%d", *exitCode)
}

type realFactory struct{}

func (realFactory) Start(ctx context.Context, shell string, cwd string, cols int, rows int) (PTY, PTYProcess, error) {
	return startPlatformPTY(ctx, shell, cwd, cols, rows)
}

type unsupportedFactory struct{}

func (unsupportedFactory) Start(context.Context, string, string, int, int) (PTY, PTYProcess, error) {
	return nil, nil, ErrUnsupported
}
