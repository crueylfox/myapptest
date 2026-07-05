package main

import (
	"errors"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/networkinspect"
)

func (a *App) StartNetworkDiagnostic(
	request domain.StartNetworkDiagnosticRequest,
) (domain.NetworkDiagnosticTask, error) {
	_, logger, manager, err := a.dependencies()
	if err != nil {
		return domain.NetworkDiagnosticTask{}, err
	}
	task, err := manager.StartNetworkDiagnostic(request)
	if logger != nil {
		logger.Write(levelFor(err), "网络诊断任务启动请求完成", "monitor.network.diagnostic", request.ServerID, err)
	}
	return task, err
}

func (a *App) CancelNetworkDiagnostic(request domain.CancelNetworkDiagnosticRequest) error {
	_, logger, manager, err := a.dependencies()
	if err != nil {
		return err
	}
	err = manager.CancelNetworkDiagnostic(request)
	if logger != nil {
		logger.Write(levelFor(err), "网络诊断任务取消请求完成", "monitor.network.diagnostic.cancel", request.ServerID, err)
	}
	return err
}

func (a *App) ListNetworkDiagnosticTasks(serverID int64) ([]domain.NetworkDiagnosticTask, error) {
	_, _, manager, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return manager.ListNetworkDiagnosticTasks(serverID), nil
}

func (a *App) OpenNetworkInspectionContext(
	request domain.OpenNetworkInspectionContextRequest,
) (domain.OpenNetworkInspectionContextResponse, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.OpenNetworkInspectionContextResponse{}, err
	}
	a.mu.RLock()
	manager := a.networkInspect
	a.mu.RUnlock()
	if manager == nil {
		return domain.OpenNetworkInspectionContextResponse{}, errors.New("network inspection manager is not initialized")
	}
	if request.ServerID <= 0 {
		return domain.OpenNetworkInspectionContextResponse{}, errors.New("请选择服务器")
	}
	if _, err := store.GetConnection(a.ctx, request.ServerID); err != nil {
		return domain.OpenNetworkInspectionContextResponse{}, err
	}
	response, err := manager.Open(request.ServerID)
	if logger != nil {
		logger.Write(levelFor(err), "网络详情上下文打开完成", "network.inspect.open", request.ServerID, err)
	}
	return response, err
}

func (a *App) GetNetworkEndpointSnapshot(
	request domain.NetworkEndpointSnapshotRequest,
) (domain.NetworkEndpointSnapshot, error) {
	connection, auth, manager, logger, err := a.networkInspectionContext(request.ServerID, "network.inspect.snapshot")
	if err != nil {
		return domain.NetworkEndpointSnapshot{}, err
	}
	response, err := manager.Snapshot(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "网络详情端口与连接读取完成", "network.inspect.snapshot", connection, nil)
	}
	return response, err
}

func (a *App) CloseNetworkInspectionContext(request domain.CloseNetworkInspectionContextRequest) error {
	_, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.networkInspect
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("network inspection manager is not initialized")
	}
	manager.Close(request)
	if logger != nil {
		logger.Write("info", "网络详情上下文已关闭", "network.inspect.close", request.ServerID, nil)
	}
	return nil
}

func (a *App) networkInspectionContext(
	serverID int64,
	operation string,
) (domain.Connection, domain.AuthRequest, *networkinspect.Manager, *logging.Logger, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, nil, err
	}
	a.mu.RLock()
	manager := a.networkInspect
	resolver := a.credentials
	a.mu.RUnlock()
	if manager == nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New("network inspection manager is not initialized")
	}
	if resolver == nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New("credential resolver is not initialized")
	}
	if serverID <= 0 {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New("请选择服务器")
	}
	connection, err := store.GetConnection(a.ctx, serverID)
	if err != nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, err
	}
	auth, err := resolver.Resolve(a.ctx, connection, domain.AuthRequest{})
	if err != nil {
		classified := connectionerror.Classify(err, connection, operation)
		logger.WriteConnection("error", classified.UserMessage, operation, connection, &classified)
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New(classified.UserMessage)
	}
	auth = a.applyHostKeyPolicy(connection, auth)
	return connection, auth, manager, logger, nil
}
