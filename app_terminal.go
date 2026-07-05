package main

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/connectionstate"
	"serverpilot/internal/domain"
	terminalservice "serverpilot/internal/terminal"
)

func (a *App) ListTerminalProfiles() ([]domain.TerminalProfile, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return store.ListTerminalProfiles(a.ctx)
}

func (a *App) CreateTerminalProfile(
	request domain.SaveTerminalProfileRequest,
) (domain.TerminalProfile, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	request.ID = ""
	profile, err := store.CreateTerminalProfile(a.ctx, request)
	logger.Write(levelFor(err), "终端配置已创建", "terminal_profile.create", 0, err)
	return profile, err
}

func (a *App) UpdateTerminalProfile(
	request domain.SaveTerminalProfileRequest,
) (domain.TerminalProfile, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	profile, err := store.UpdateTerminalProfile(a.ctx, request)
	logger.Write(levelFor(err), "终端配置已更新", "terminal_profile.update", 0, err)
	return profile, err
}

func (a *App) DuplicateTerminalProfile(id string) (domain.TerminalProfile, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	profile, err := store.DuplicateTerminalProfile(a.ctx, id)
	logger.Write(levelFor(err), "终端配置已复制", "terminal_profile.duplicate", 0, err)
	return profile, err
}

func (a *App) DeleteTerminalProfile(
	request domain.DeleteTerminalProfileRequest,
) (domain.DeleteTerminalProfileResponse, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	result, err := store.DeleteTerminalProfile(a.ctx, request)
	logger.Write(levelFor(err), "终端配置已删除", "terminal_profile.delete", 0, err)
	return result, err
}

func (a *App) SetDefaultTerminalProfile(id string) (domain.AppSettings, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.AppSettings{}, err
	}
	settings, err := store.SetDefaultTerminalProfile(a.ctx, id)
	if err == nil {
		a.mu.RLock()
		service := a.settings
		a.mu.RUnlock()
		if service != nil {
			settings, err = service.Reload(a.ctx)
		}
	}
	logger.Write(levelFor(err), "默认终端配置已更新", "terminal_profile.default", 0, err)
	return settings, err
}

func (a *App) AssignServerTerminalProfile(
	request domain.AssignServerTerminalProfileRequest,
) (domain.Connection, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.Connection{}, err
	}
	connection, err := store.AssignServerTerminalProfile(a.ctx, request)
	logger.Write(levelFor(err), "服务器终端配置已更新", "terminal_profile.assign", request.ServerID, err)
	return connection, err
}

func (a *App) GetResolvedTerminalProfile(
	request domain.ResolveTerminalProfileRequest,
) (domain.TerminalProfile, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	return store.GetResolvedTerminalProfile(a.ctx, request)
}

type terminalEmitter struct {
	ctx    context.Context
	states *connectionstate.Tracker
}

func (e terminalEmitter) Output(event terminalservice.OutputEvent) {
	runtime.EventsEmit(e.ctx, "terminal:output", event)
}

func (e terminalEmitter) Status(event terminalservice.StatusEvent) {
	if e.states != nil {
		e.states.UpdateTerminal(
			event.SessionID,
			event.ConnectionID,
			string(event.Status),
			event.ConnectionError,
		)
	}
	runtime.EventsEmit(e.ctx, "terminal:status", event)
}

func (a *App) OpenTerminal(request domain.OpenTerminalRequest) (terminalservice.SessionInfo, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return terminalservice.SessionInfo{}, err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return terminalservice.SessionInfo{}, err
	}
	a.mu.RLock()
	states := a.states
	a.mu.RUnlock()
	if states != nil {
		states.BeginConnect(connection.ID)
	}
	request.Auth, err = a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "terminal.connect")
		a.recordConnectionError(connection, classified)
		return terminalservice.SessionInfo{}, errors.New(classified.UserMessage)
	}
	request.Auth = a.applyHostKeyPolicy(connection, request.Auth)
	a.mu.RLock()
	manager := a.terminal
	a.mu.RUnlock()
	if manager == nil {
		return terminalservice.SessionInfo{}, errors.New("terminal manager is not initialized")
	}
	if (states != nil && states.HasTerminalConnecting(connection.ID)) || manager.HasConnecting(connection.ID) {
		return terminalservice.SessionInfo{}, errors.New("该服务器正在建立终端连接")
	}
	info, err := manager.Open(connection, request.Auth, request.Columns, request.Rows)
	if errors.Is(err, terminalservice.ErrConnectionActive) {
		return terminalservice.SessionInfo{}, errors.New("该服务器正在建立终端连接")
	}
	return info, err
}

func (a *App) WriteTerminal(request domain.TerminalWriteRequest) error {
	a.mu.RLock()
	manager := a.terminal
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("terminal manager is not initialized")
	}
	return manager.Write(request.SessionID, request.DataBase64)
}

func (a *App) ResizeTerminal(request domain.TerminalResizeRequest) error {
	a.mu.RLock()
	manager := a.terminal
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("terminal manager is not initialized")
	}
	return manager.Resize(request.SessionID, request.Columns, request.Rows)
}

func (a *App) CloseTerminal(sessionID string) error {
	a.mu.RLock()
	manager := a.terminal
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("terminal manager is not initialized")
	}
	manager.Close(sessionID)
	return nil
}

func (a *App) ReconnectTerminal(request domain.ReconnectTerminalRequest) (terminalservice.SessionInfo, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return terminalservice.SessionInfo{}, err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return terminalservice.SessionInfo{}, err
	}
	a.mu.RLock()
	states := a.states
	a.mu.RUnlock()
	if states != nil {
		states.BeginConnect(connection.ID)
	}
	request.Auth, err = a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "terminal.reconnect")
		a.recordConnectionError(connection, classified)
		return terminalservice.SessionInfo{}, errors.New(classified.UserMessage)
	}
	request.Auth = a.applyHostKeyPolicy(connection, request.Auth)
	a.mu.RLock()
	manager := a.terminal
	a.mu.RUnlock()
	if manager == nil {
		return terminalservice.SessionInfo{}, errors.New("terminal manager is not initialized")
	}
	return manager.Reconnect(request.SessionID, connection, request.Auth, request.Columns, request.Rows)
}
