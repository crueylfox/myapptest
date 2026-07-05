package main

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/processmanager"
)

func (a *App) ListProcesses(request domain.ListProcessesRequest) (domain.ProcessListResponse, error) {
	connection, auth, manager, logger, err := a.processContext(request.ServerID, "process.list")
	if err != nil {
		return domain.ProcessListResponse{}, err
	}
	response, err := manager.List(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "进程列表刷新完成", "process.list", connection, nil)
	}
	return response, err
}

func (a *App) GetProcessDetail(request domain.GetProcessDetailRequest) (domain.ProcessDetail, error) {
	connection, auth, manager, logger, err := a.processContext(request.ServerID, "process.detail")
	if err != nil {
		return domain.ProcessDetail{}, err
	}
	detail, err := manager.Detail(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "进程详情读取完成", "process.detail", connection, nil)
	}
	return detail, err
}

func (a *App) SignalProcess(request domain.SignalProcessRequest) (domain.SignalProcessResponse, error) {
	connection, auth, manager, logger, err := a.processContext(request.ServerID, "process.signal")
	if err != nil {
		return domain.SignalProcessResponse{}, err
	}
	response, err := manager.Signal(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "进程信号操作完成", "process.signal", connection, nil)
	}
	return response, err
}

func (a *App) StartProcessWatch(request domain.StartProcessWatchRequest) (string, error) {
	connection, auth, manager, logger, err := a.processContext(request.ServerID, "process.watch")
	if err != nil {
		return "", err
	}
	watchID, err := manager.StartWatch(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "进程列表实时刷新状态已更新", "process.watch", connection, nil)
	}
	return watchID, err
}

func (a *App) StopProcessWatch(request domain.StopProcessWatchRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.process
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("process manager is not initialized")
	}
	manager.StopWatch(request.WatchID)
	return nil
}

func (a *App) processContext(
	serverID int64,
	operation string,
) (domain.Connection, domain.AuthRequest, *processmanager.Manager, *logging.Logger, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, nil, err
	}
	a.mu.RLock()
	manager := a.process
	resolver := a.credentials
	a.mu.RUnlock()
	if manager == nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New("process manager is not initialized")
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

type processEmitter struct {
	ctx context.Context
}

func (e processEmitter) State(event domain.ProcessStateEvent) {
	runtime.EventsEmit(e.ctx, "process:state", event)
}

func (e processEmitter) List(event domain.ProcessListEvent) {
	runtime.EventsEmit(e.ctx, "process:list", event)
}

func (e processEmitter) Detail(event domain.ProcessDetailEvent) {
	runtime.EventsEmit(e.ctx, "process:detail", event)
}

func (e processEmitter) Error(event domain.ProcessErrorEvent) {
	runtime.EventsEmit(e.ctx, "process:error", event)
}
