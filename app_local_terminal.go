package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"hostdeck/internal/domain"
	"hostdeck/internal/localterminal"
)

func (a *App) GetLocalTerminalCapabilities() (domain.LocalTerminalCapabilities, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.LocalTerminalCapabilities{}, err
	}
	a.mu.RLock()
	service := a.settings
	a.mu.RUnlock()
	if service == nil {
		return domain.LocalTerminalCapabilities{}, errors.New("settings service is not initialized")
	}
	return localterminal.Capabilities(service.Get().LocalTerminalShellPreference), nil
}

func (a *App) GetStartupLocalTerminalRequest() domain.LocalTerminalStartupRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	request := domain.LocalTerminalStartupRequest{ShellKind: a.startupLocalTerminalShell}
	a.startupLocalTerminalShell = ""
	return request
}

func (a *App) RelaunchElevatedLocalTerminal(request domain.LocalTerminalElevatedRelaunchRequest) error {
	if !localterminal.IsShellKindAllowed(request.ShellKind) {
		return errors.New("本地终端 shell 类型无效")
	}
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取 HostDeck 路径失败: %w", err)
	}
	if err := localterminal.RelaunchElevated(
		executable,
		[]string{startupLocalTerminalArgPrefix + request.ShellKind},
	); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}

type localTerminalEmitter struct {
	ctx context.Context
}

func (e localTerminalEmitter) Output(event domain.LocalTerminalOutputEvent) {
	runtime.EventsEmit(e.ctx, "localterminal:output", event)
}

func (e localTerminalEmitter) State(event domain.LocalTerminalStateEvent) {
	runtime.EventsEmit(e.ctx, "localterminal:state", event)
}

func (e localTerminalEmitter) Error(event domain.LocalTerminalErrorEvent) {
	runtime.EventsEmit(e.ctx, "localterminal:error", event)
}

func (a *App) OpenLocalTerminal(
	request domain.LocalTerminalOpenRequest,
) (domain.LocalTerminalOpenResponse, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.LocalTerminalOpenResponse{}, err
	}
	if !localterminal.RuntimeAvailable() {
		a.mu.RLock()
		logger := a.logger
		a.mu.RUnlock()
		if logger != nil {
			logger.Write("warn", "当前系统不支持本地终端", "localterminal.unsupported", 0, nil)
		}
		return domain.LocalTerminalOpenResponse{}, localterminal.ErrUnsupported
	}
	a.mu.RLock()
	manager := a.localTerm
	a.mu.RUnlock()
	if manager == nil {
		return domain.LocalTerminalOpenResponse{}, errors.New("local terminal manager is not initialized")
	}
	if !localterminal.IsShellKindAllowed(request.ShellKind) {
		return domain.LocalTerminalOpenResponse{}, errors.New("本地终端 shell 类型无效")
	}
	return manager.Open(request)
}

func (a *App) WriteLocalTerminal(request domain.LocalTerminalWriteRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	if !localterminal.RuntimeAvailable() {
		return localterminal.ErrUnsupported
	}
	a.mu.RLock()
	manager := a.localTerm
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("local terminal manager is not initialized")
	}
	return manager.Write(request)
}

func (a *App) ResizeLocalTerminal(request domain.LocalTerminalResizeRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	if !localterminal.RuntimeAvailable() {
		return localterminal.ErrUnsupported
	}
	a.mu.RLock()
	manager := a.localTerm
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("local terminal manager is not initialized")
	}
	return manager.Resize(request)
}

func (a *App) CloseLocalTerminal(sessionID string) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	if !localterminal.RuntimeAvailable() {
		return nil
	}
	a.mu.RLock()
	manager := a.localTerm
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("local terminal manager is not initialized")
	}
	manager.Close(sessionID)
	return nil
}

func (a *App) ListLocalTerminals() ([]domain.LocalTerminalState, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	if !localterminal.RuntimeAvailable() {
		return []domain.LocalTerminalState{}, nil
	}
	a.mu.RLock()
	manager := a.localTerm
	a.mu.RUnlock()
	if manager == nil {
		return nil, errors.New("local terminal manager is not initialized")
	}
	return manager.List(), nil
}

func (a *App) GetLocalTerminalState(sessionID string) (domain.LocalTerminalState, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.LocalTerminalState{}, err
	}
	if !localterminal.RuntimeAvailable() {
		return domain.LocalTerminalState{}, localterminal.ErrUnsupported
	}
	a.mu.RLock()
	manager := a.localTerm
	a.mu.RUnlock()
	if manager == nil {
		return domain.LocalTerminalState{}, errors.New("local terminal manager is not initialized")
	}
	return manager.State(sessionID)
}
