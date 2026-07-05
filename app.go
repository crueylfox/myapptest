package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/batchcommand"
	"serverpilot/internal/connectionstate"
	"serverpilot/internal/credential"
	"serverpilot/internal/dockermanager"
	"serverpilot/internal/domain"
	"serverpilot/internal/keyvault"
	"serverpilot/internal/localfiles"
	"serverpilot/internal/localmonitor"
	"serverpilot/internal/localterminal"
	"serverpilot/internal/logging"
	"serverpilot/internal/monitor"
	"serverpilot/internal/networkinspect"
	"serverpilot/internal/persistence"
	"serverpilot/internal/processmanager"
	"serverpilot/internal/secretstore"
	"serverpilot/internal/serverlifecycle"
	"serverpilot/internal/servicemanager"
	"serverpilot/internal/settings"
	sftpservice "serverpilot/internal/sftpmanager"
	"serverpilot/internal/sshclient"
	terminalservice "serverpilot/internal/terminal"
	"serverpilot/internal/tunnelmanager"
)

type App struct {
	mu             sync.RWMutex
	ctx            context.Context
	cancel         context.CancelFunc
	store          *persistence.Store
	logger         *logging.Logger
	monitor        *monitor.Manager
	terminal       *terminalservice.Manager
	localTerm      *localterminal.Manager
	localFiles     *localfiles.Service
	localMonitor   *localmonitor.Service
	sftp           *sftpservice.Manager
	tunnel         *tunnelmanager.Manager
	docker         *dockermanager.Manager
	process        *processmanager.Manager
	batch          *batchcommand.Manager
	services       *servicemanager.Manager
	networkInspect *networkinspect.Manager
	secrets        secretstore.Store
	credentials    *credential.Resolver
	keyProtector   keyvault.KeyMaterialProtector
	settings       *settings.Service
	states         *connectionstate.Tracker
	lifecycle      *serverlifecycle.Coordinator
	initErr        error

	startupLocalTerminalShell string
}

const startupLocalTerminalArgPrefix = "--serverpilot-open-local-terminal="

func NewApp() *App {
	return newAppWithArgs(os.Args[1:])
}

func newAppWithArgs(args []string) *App {
	return &App{
		secrets:                   secretstore.New(),
		startupLocalTerminalShell: parseStartupLocalTerminalShell(args),
	}
}

func parseStartupLocalTerminalShell(args []string) string {
	for _, arg := range args {
		shellKind, ok := strings.CutPrefix(arg, startupLocalTerminalArgPrefix)
		if !ok {
			continue
		}
		if localterminal.IsShellKindAllowed(shellKind) {
			return shellKind
		}
	}
	return ""
}

func newServerLifecycle(
	monitorManager *monitor.Manager,
	terminalManager *terminalservice.Manager,
	sftpManager *sftpservice.Manager,
	tunnelManager *tunnelmanager.Manager,
	dockerManager *dockermanager.Manager,
	processManager *processmanager.Manager,
	batchManager *batchcommand.Manager,
	serviceManager *servicemanager.Manager,
	networkInspectManager *networkinspect.Manager,
	stateTracker *connectionstate.Tracker,
) *serverlifecycle.Coordinator {
	var monitorResource serverlifecycle.MonitorManager
	var terminalResource serverlifecycle.TerminalManager
	var sftpResource serverlifecycle.SFTPManager
	var tunnelResource serverlifecycle.TunnelManager
	var dockerResource serverlifecycle.DockerManager
	var processResource serverlifecycle.ProcessManager
	var batchResource serverlifecycle.BatchCommandManager
	var serviceResource serverlifecycle.ServiceManager
	var networkResource serverlifecycle.NetworkInspectionManager
	var stateResource serverlifecycle.StateTracker
	if monitorManager != nil {
		monitorResource = monitorManager
	}
	if terminalManager != nil {
		terminalResource = terminalManager
	}
	if sftpManager != nil {
		sftpResource = sftpManager
	}
	if tunnelManager != nil {
		tunnelResource = tunnelManager
	}
	if dockerManager != nil {
		dockerResource = dockerManager
	}
	if processManager != nil {
		processResource = processManager
	}
	if batchManager != nil {
		batchResource = batchManager
	}
	if serviceManager != nil {
		serviceResource = serviceManager
	}
	if networkInspectManager != nil {
		networkResource = networkInspectManager
	}
	if stateTracker != nil {
		stateResource = stateTracker
	}
	return serverlifecycle.New(monitorResource, terminalResource, sftpResource, tunnelResource, dockerResource, processResource, batchResource, serviceResource, networkResource, stateResource)
}

func (a *App) startup(ctx context.Context) {
	appCtx, cancel := context.WithCancel(ctx)
	a.mu.Lock()
	a.ctx, a.cancel = appCtx, cancel
	a.mu.Unlock()

	configDir, err := os.UserConfigDir()
	if err != nil {
		a.setInitError(err)
		return
	}
	dataDir := filepath.Join(configDir, "ServerPilot")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		a.setInitError(err)
		return
	}
	logger, err := logging.New(filepath.Join(dataDir, "logs"))
	if err != nil {
		a.setInitError(err)
		return
	}
	store, err := persistence.Open(appCtx, filepath.Join(dataDir, "serverpilot.db"))
	if err != nil {
		logger.Write("error", "数据库迁移或打开失败", "database.migrate", 0, err)
		_ = logger.Close()
		a.setInitError(fmt.Errorf("数据库迁移或打开失败: %w", err))
		return
	}
	keyProtector := keyvault.NewPlatformProtector()
	resolver := credential.New(store, a.secrets, keyProtector)
	settingsService, err := settings.New(appCtx, store)
	if err != nil {
		logger.Write("error", "应用设置加载失败", "settings.load", 0, err)
		_ = store.Close()
		_ = logger.Close()
		a.setInitError(fmt.Errorf("应用设置加载失败: %w", err))
		return
	}
	if err := restoreWindowState(ctx, store, settingsService.Get()); err != nil {
		logger.Write("warn", "无法读取显示器信息，已使用受限默认窗口尺寸", "window.restore", 0, err)
	}
	timeoutProvider := func() time.Duration {
		return time.Duration(settingsService.Get().ConnectionTimeoutSeconds) * time.Second
	}
	keepaliveProvider := func() sshclient.KeepalivePolicy {
		return sshclient.PolicyFromSettings(settingsService.Get())
	}
	sshclient.SetRouteDialer(newSSHRouteDialer(store, resolver, settingsService, logger))
	stateTracker := connectionstate.New(func(state domain.ConnectionRuntimeState) {
		runtime.EventsEmit(ctx, "connection:state", state)
	})
	manager := monitor.New(
		appCtx,
		logger,
		store.UpdateHostKey,
		resolver.CommitSuccessful,
		func(snapshot domain.MonitorSnapshot) {
			stateTracker.UpdateMonitor(snapshot)
			runtime.EventsEmit(ctx, "monitor:snapshot", snapshot)
		},
		timeoutProvider,
	)
	manager.SetKeepalivePolicyProvider(keepaliveProvider)
	manager.SetNetworkDiagnosticEmitters(
		func(event domain.NetworkDiagnosticStateEvent) {
			runtime.EventsEmit(ctx, "networkdiag:state", event)
		},
		func(event domain.NetworkDiagnosticOutputEvent) {
			runtime.EventsEmit(ctx, "networkdiag:output", event)
		},
		func(event domain.NetworkDiagnosticErrorEvent) {
			runtime.EventsEmit(ctx, "networkdiag:error", event)
		},
	)
	terminalManager := terminalservice.New(
		appCtx,
		logger,
		terminalEmitter{ctx: ctx, states: stateTracker},
		store.UpdateHostKey,
		resolver.CommitSuccessful,
		timeoutProvider,
	)
	terminalManager.SetKeepalivePolicyProvider(keepaliveProvider)
	localTerminalManager := localterminal.New(
		appCtx,
		logger,
		localTerminalEmitter{ctx: ctx},
	)
	localFilesService := localfiles.New(nil)
	localMonitorService := localmonitor.New(nil)
	sftpManager := sftpservice.New(
		appCtx,
		logger,
		sftpEmitter{ctx: ctx, states: stateTracker},
		store.UpdateHostKey,
		resolver.CommitSuccessful,
		timeoutProvider,
	)
	sftpManager.SetKeepalivePolicyProvider(keepaliveProvider)
	tunnelManager := tunnelmanager.New(
		appCtx,
		logger,
		tunnelEmitter{ctx: ctx},
		timeoutProvider,
	)
	tunnelManager.SetHostKeySaver(store.UpdateHostKey)
	tunnelManager.SetKeepalivePolicyProvider(keepaliveProvider)
	dockerManager := dockermanager.New(
		appCtx,
		logger,
		dockerEmitter{ctx: ctx},
		timeoutProvider,
	)
	dockerManager.SetHostKeySaver(store.UpdateHostKey)
	dockerManager.SetKeepalivePolicyProvider(keepaliveProvider)
	processManager := processmanager.New(
		appCtx,
		logger,
		processEmitter{ctx: ctx},
		timeoutProvider,
	)
	processManager.SetHostKeySaver(store.UpdateHostKey)
	processManager.SetKeepalivePolicyProvider(keepaliveProvider)
	batchManager := batchcommand.New(
		appCtx,
		logger,
		batchCommandEmitter{ctx: ctx},
		func(ctx context.Context, serverID int64) (domain.Connection, error) {
			return store.GetConnection(ctx, serverID)
		},
		func(ctx context.Context, connection domain.Connection) (domain.AuthRequest, error) {
			auth, err := resolver.Resolve(ctx, connection, domain.AuthRequest{})
			if err != nil {
				return domain.AuthRequest{}, err
			}
			return sshclient.ApplyHostKeyPolicy(settingsService.Get().HostKeyPolicy, connection, auth), nil
		},
		store.UpdateHostKey,
		resolver.CommitSuccessful,
		timeoutProvider,
	)
	batchManager.SetKeepalivePolicyProvider(keepaliveProvider)
	serviceManager := servicemanager.New(
		appCtx,
		logger,
		timeoutProvider,
	)
	serviceManager.SetHostKeySaver(store.UpdateHostKey)
	serviceManager.SetKeepalivePolicyProvider(keepaliveProvider)
	serviceManager.SetEmitter(serviceJournalEmitter{ctx: ctx})
	networkInspectManager := networkinspect.New(
		appCtx,
		logger,
		timeoutProvider,
	)
	networkInspectManager.SetHostKeySaver(store.UpdateHostKey)
	networkInspectManager.SetKeepalivePolicyProvider(keepaliveProvider)
	lifecycle := newServerLifecycle(manager, terminalManager, sftpManager, tunnelManager, dockerManager, processManager, batchManager, serviceManager, networkInspectManager, stateTracker)
	a.mu.Lock()
	a.logger, a.store, a.monitor, a.terminal, a.localTerm, a.localFiles, a.localMonitor, a.sftp, a.tunnel, a.docker, a.process, a.batch, a.services, a.networkInspect, a.credentials, a.keyProtector, a.settings, a.states, a.lifecycle =
		logger, store, manager, terminalManager, localTerminalManager, localFilesService, localMonitorService, sftpManager, tunnelManager, dockerManager, processManager, batchManager, serviceManager, networkInspectManager, resolver, keyProtector, settingsService, stateTracker, lifecycle
	a.mu.Unlock()
	logger.Write("info", "ServerPilot 已启动", "app.startup", 0, nil)
}

func (a *App) shutdown(ctx context.Context) {
	a.mu.RLock()
	manager, terminalManager, localTerminalManager, sftpManager, tunnelManager, dockerManager, processManager, batchManager, serviceManager, networkInspectManager, store, logger, cancel :=
		a.monitor, a.terminal, a.localTerm, a.sftp, a.tunnel, a.docker, a.process, a.batch, a.services, a.networkInspect, a.store, a.logger, a.cancel
	a.mu.RUnlock()
	if store != nil {
		if err := persistWindowState(ctx, store); err != nil && logger != nil {
			logger.Write("warn", "保存窗口尺寸失败", "window.persist", 0, err)
		}
	}
	if cancel != nil {
		cancel()
	}
	sshclient.SetRouteDialer(nil)
	if manager != nil {
		manager.StopAll()
	}
	if terminalManager != nil {
		terminalManager.StopAll()
	}
	if localTerminalManager != nil {
		localTerminalManager.CloseAll()
	}
	if sftpManager != nil {
		sftpManager.StopAll()
	}
	if tunnelManager != nil {
		tunnelManager.StopAll()
	}
	if dockerManager != nil {
		dockerManager.StopAll()
	}
	if processManager != nil {
		processManager.StopAll()
	}
	if batchManager != nil {
		batchManager.StopAll()
	}
	if serviceManager != nil {
		serviceManager.StopAll()
	}
	if networkInspectManager != nil {
		networkInspectManager.StopAll()
	}
	if store != nil {
		_ = store.Close()
	}
	if logger != nil {
		logger.Write("info", "ServerPilot 已停止", "app.shutdown", 0, nil)
		_ = logger.Close()
	}
}

func (a *App) setInitError(err error) {
	a.mu.Lock()
	a.initErr = err
	a.mu.Unlock()
}

func (a *App) dependencies() (*persistence.Store, *logging.Logger, *monitor.Manager, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.initErr != nil {
		return nil, nil, nil, a.initErr
	}
	if a.store == nil || a.logger == nil || a.monitor == nil {
		return nil, nil, nil, errors.New("application is not initialized")
	}
	return a.store, a.logger, a.monitor, nil
}
