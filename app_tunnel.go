package main

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
	"serverpilot/internal/tunnelmanager"
)

func (a *App) ListTunnelProfiles() ([]domain.TunnelProfile, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return store.ListTunnelProfiles(a.ctx)
}

func (a *App) CreateTunnelProfile(
	request domain.SaveTunnelProfileRequest,
) (domain.TunnelProfile, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.TunnelProfile{}, err
	}
	request.ID = 0
	return store.SaveTunnelProfile(a.ctx, request)
}

func (a *App) UpdateTunnelProfile(
	request domain.SaveTunnelProfileRequest,
) (domain.TunnelProfile, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.TunnelProfile{}, err
	}
	if request.ID <= 0 {
		return domain.TunnelProfile{}, errors.New("请选择要更新的端口转发配置")
	}
	return store.SaveTunnelProfile(a.ctx, request)
}

func (a *App) DeleteTunnelProfile(id int64) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager != nil {
		if err := manager.StopProfile(id); err != nil {
			return err
		}
	}
	return store.DeleteTunnelProfile(a.ctx, id)
}

func (a *App) ListTunnels(request domain.ListTunnelsRequest) ([]domain.TunnelRuntime, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return nil, errors.New("tunnel manager is not initialized")
	}
	return manager.List(request.ServerID), nil
}

func (a *App) GetTunnelState(tunnelID string) (domain.TunnelRuntime, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.TunnelRuntime{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.TunnelRuntime{}, errors.New("tunnel manager is not initialized")
	}
	return manager.State(tunnelID)
}

func (a *App) CheckTunnelRemoteListen(request domain.CheckTunnelRemoteListenRequest) (domain.TunnelRuntime, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.TunnelRuntime{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.TunnelRuntime{}, errors.New("tunnel manager is not initialized")
	}
	return manager.CheckRemoteListen(request)
}

func (a *App) InspectRemoteForwardAccess(request domain.RemoteForwardAccessRequest) (domain.RemoteForwardAccessInspectResult, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.RemoteForwardAccessInspectResult{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.RemoteForwardAccessInspectResult{}, errors.New("tunnel manager is not initialized")
	}
	return manager.InspectRemoteForwardAccess(request)
}

func (a *App) EnableRemoteForwardAccess(request domain.RemoteForwardAccessRequest) (domain.RemoteForwardAccessEnableResult, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.RemoteForwardAccessEnableResult{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.RemoteForwardAccessEnableResult{}, errors.New("tunnel manager is not initialized")
	}
	return manager.EnableRemoteForwardAccess(request)
}

func (a *App) EnableRemoteForwardAccessAndRestart(
	request domain.RemoteForwardAccessRestartRequest,
) (domain.RemoteForwardAccessRestartResult, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.RemoteForwardAccessRestartResult{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.RemoteForwardAccessRestartResult{}, errors.New("tunnel manager is not initialized")
	}
	access, startRequest, err := manager.EnableRemoteForwardAccessAndStop(domain.RemoteForwardAccessRequest{
		ServerID:       request.ServerID,
		TunnelID:       request.TunnelID,
		RemoteBindHost: "",
		RemoteBindPort: 0,
	})
	if err != nil {
		return domain.RemoteForwardAccessRestartResult{Access: access}, err
	}
	startRequest.Auth = request.Auth
	startRequest.ConfirmPublicBind = true
	if request.ProfileID > 0 {
		startRequest.ProfileID = request.ProfileID
	}
	runtimeState, err := a.StartTunnel(startRequest)
	if err != nil {
		return domain.RemoteForwardAccessRestartResult{Access: access}, err
	}
	checked, err := manager.CheckRemoteListen(domain.CheckTunnelRemoteListenRequest{
		ServerID: runtimeState.ServerID,
		TunnelID: runtimeState.TunnelID,
	})
	if err == nil {
		runtimeState = checked
	}
	return domain.RemoteForwardAccessRestartResult{Access: access, Runtime: runtimeState}, err
}

func (a *App) StartTunnel(request domain.StartTunnelRequest) (domain.TunnelRuntime, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.TunnelRuntime{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.TunnelRuntime{}, errors.New("tunnel manager is not initialized")
	}
	if request.ProfileID > 0 {
		profile, err := store.GetTunnelProfile(a.ctx, request.ProfileID)
		if err != nil {
			return domain.TunnelRuntime{}, err
		}
		request, err = mergeTunnelProfileRequest(request, profile)
		if err != nil {
			return domain.TunnelRuntime{}, err
		}
	}
	if request.ServerID <= 0 {
		return domain.TunnelRuntime{}, errors.New("请选择服务器")
	}
	connection, err := store.GetConnection(a.ctx, request.ServerID)
	if err != nil {
		return domain.TunnelRuntime{}, err
	}
	auth, err := a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "tunnel.start")
		logger.WriteConnection("error", classified.UserMessage, "tunnel.start", connection, &classified)
		return domain.TunnelRuntime{}, errors.New(classified.UserMessage)
	}
	auth = a.applyHostKeyPolicy(connection, auth)
	startRequest := request
	startRequest.Auth = domain.AuthRequest{}
	runtimeState, err := manager.Start(connection, auth, startRequest)
	if err != nil {
		message := tunnelmanager.UserMessage(err)
		logger.WriteConnection("error", message, "tunnel.start", connection, nil)
		return domain.TunnelRuntime{}, errors.New(message)
	}
	if err := a.credentials.CommitSuccessful(a.ctx, connection, auth); err != nil {
		_ = manager.Stop(domain.StopTunnelRequest{ServerID: connection.ID, TunnelID: runtimeState.TunnelID})
		logger.WriteConnection("error", "端口转发已启动，但凭据保存失败，已停止该隧道", "tunnel.credential.commit", connection, nil)
		return domain.TunnelRuntime{}, errors.New("端口转发已启动，但凭据保存失败，已停止该隧道")
	}
	logger.WriteConnection("info", "SSH 端口转发已启动", "tunnel.start", connection, nil)
	return runtimeState, nil
}

func (a *App) StopTunnel(request domain.StopTunnelRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("tunnel manager is not initialized")
	}
	return manager.Stop(request)
}

func (a *App) RestartTunnel(request domain.RestartTunnelRequest) (domain.TunnelRuntime, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.TunnelRuntime{}, err
	}
	a.mu.RLock()
	manager := a.tunnel
	a.mu.RUnlock()
	if manager == nil {
		return domain.TunnelRuntime{}, errors.New("tunnel manager is not initialized")
	}
	startRequest, ok := manager.StartRequest(request.TunnelID)
	if !ok {
		return domain.TunnelRuntime{}, errors.New("端口转发不存在或已停止")
	}
	if request.ServerID > 0 && startRequest.ServerID != request.ServerID {
		return domain.TunnelRuntime{}, errors.New("端口转发不属于当前服务器")
	}
	if err := manager.Stop(domain.StopTunnelRequest{ServerID: startRequest.ServerID, TunnelID: request.TunnelID}); err != nil {
		return domain.TunnelRuntime{}, err
	}
	startRequest.Auth = request.Auth
	return a.StartTunnel(startRequest)
}

func mergeTunnelProfileRequest(
	request domain.StartTunnelRequest,
	profile domain.TunnelProfile,
) (domain.StartTunnelRequest, error) {
	if request.ServerID > 0 && request.ServerID != profile.ServerID {
		return request, errors.New("端口转发配置不属于当前服务器")
	}
	request.ServerID = profile.ServerID
	request.ProfileID = profile.ID
	if request.Name == "" {
		request.Name = profile.Name
	}
	if request.Type == "" {
		request.Type = profile.Type
	}
	if request.BindHost == "" {
		request.BindHost = profile.BindHost
	}
	if request.BindPort == 0 {
		request.BindPort = profile.BindPort
	}
	if request.TargetHost == "" {
		request.TargetHost = profile.TargetHost
	}
	if request.TargetPort == 0 {
		request.TargetPort = profile.TargetPort
	}
	if request.RemoteBindHost == "" {
		request.RemoteBindHost = profile.RemoteBindHost
	}
	if request.RemoteBindPort == 0 {
		request.RemoteBindPort = profile.RemoteBindPort
	}
	return request, nil
}

type tunnelEmitter struct {
	ctx context.Context
}

func (e tunnelEmitter) State(event domain.TunnelStateEvent) {
	runtime.EventsEmit(e.ctx, "tunnel:state", event)
}

func (e tunnelEmitter) Error(event domain.TunnelErrorEvent) {
	runtime.EventsEmit(e.ctx, "tunnel:error", event)
}

func (e tunnelEmitter) Traffic(event domain.TunnelTrafficEvent) {
	runtime.EventsEmit(e.ctx, "tunnel:traffic", event)
}
