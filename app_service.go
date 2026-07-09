package main

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"hostdeck/internal/connectionerror"
	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
	"hostdeck/internal/servicemanager"
)

func (a *App) CheckServiceManager(request domain.ServiceManagerServerRequest) (domain.ServiceManagerCapability, error) {
	connection, auth, manager, logger, err := a.serviceManagerContext(request.ServerID, "servicemanager.check")
	if err != nil {
		return domain.ServiceManagerCapability{}, err
	}
	capability, err := manager.Check(connection, auth)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "系统服务管理能力检测完成", "servicemanager.check", connection, nil)
	}
	return capability, err
}

func (a *App) ListSystemServices(request domain.ServiceManagerServerRequest) (domain.SystemServiceListResponse, error) {
	connection, auth, manager, logger, err := a.serviceManagerContext(request.ServerID, "servicemanager.list")
	if err != nil {
		return domain.SystemServiceListResponse{}, err
	}
	response, err := manager.List(connection, auth)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "系统服务列表刷新完成", "servicemanager.list", connection, nil)
	}
	return response, err
}

func (a *App) GetSystemServiceDetail(request domain.SystemServiceActionRequest) (domain.SystemServiceDetail, error) {
	connection, auth, manager, logger, err := a.serviceManagerContext(request.ServerID, "servicemanager.detail")
	if err != nil {
		return domain.SystemServiceDetail{}, err
	}
	detail, err := manager.Detail(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "系统服务详情读取完成", "servicemanager.detail", connection, nil)
	}
	return detail, err
}

func (a *App) StartSystemService(request domain.SystemServiceActionRequest) (domain.SystemServiceActionResponse, error) {
	return a.runSystemServiceAction(request, "servicemanager.start", func(
		manager *servicemanager.Manager,
		connection domain.Connection,
		auth domain.AuthRequest,
	) (domain.SystemServiceActionResponse, error) {
		return manager.Start(connection, auth, request)
	})
}

func (a *App) StopSystemService(request domain.SystemServiceActionRequest) (domain.SystemServiceActionResponse, error) {
	return a.runSystemServiceAction(request, "servicemanager.stop", func(
		manager *servicemanager.Manager,
		connection domain.Connection,
		auth domain.AuthRequest,
	) (domain.SystemServiceActionResponse, error) {
		return manager.Stop(connection, auth, request)
	})
}

func (a *App) RestartSystemService(request domain.SystemServiceActionRequest) (domain.SystemServiceActionResponse, error) {
	return a.runSystemServiceAction(request, "servicemanager.restart", func(
		manager *servicemanager.Manager,
		connection domain.Connection,
		auth domain.AuthRequest,
	) (domain.SystemServiceActionResponse, error) {
		return manager.Restart(connection, auth, request)
	})
}

func (a *App) EnableSystemService(request domain.SystemServiceActionRequest) (domain.SystemServiceActionResponse, error) {
	return a.runSystemServiceAction(request, "servicemanager.enable", func(
		manager *servicemanager.Manager,
		connection domain.Connection,
		auth domain.AuthRequest,
	) (domain.SystemServiceActionResponse, error) {
		return manager.Enable(connection, auth, request)
	})
}

func (a *App) DisableSystemService(request domain.SystemServiceActionRequest) (domain.SystemServiceActionResponse, error) {
	return a.runSystemServiceAction(request, "servicemanager.disable", func(
		manager *servicemanager.Manager,
		connection domain.Connection,
		auth domain.AuthRequest,
	) (domain.SystemServiceActionResponse, error) {
		return manager.Disable(connection, auth, request)
	})
}

func (a *App) CancelSystemServiceRequests(request domain.ServiceManagerServerRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.services
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("service manager is not initialized")
	}
	manager.CancelQueries(request.ServerID)
	return nil
}

func (a *App) GetSystemServiceJournal(request domain.SystemServiceJournalRequest) (domain.SystemServiceJournalResponse, error) {
	connection, auth, manager, logger, err := a.serviceManagerContext(request.ServerID, "servicemanager.journal")
	if err != nil {
		return domain.SystemServiceJournalResponse{}, err
	}
	response, err := manager.Journal(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "系统服务日志读取完成", "servicemanager.journal", connection, nil)
	}
	return response, err
}

func (a *App) StartSystemServiceJournalFollow(request domain.SystemServiceJournalRequest) (domain.SystemServiceJournalFollowResponse, error) {
	connection, auth, manager, logger, err := a.serviceManagerContext(request.ServerID, "servicemanager.journal.follow")
	if err != nil {
		return domain.SystemServiceJournalFollowResponse{}, err
	}
	response, err := manager.StartJournalFollow(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "系统服务实时日志启动完成", "servicemanager.journal.follow", connection, nil)
	}
	return response, err
}

func (a *App) StopSystemServiceJournalFollow(request domain.StopSystemServiceJournalFollowRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.services
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("service manager is not initialized")
	}
	manager.StopJournalFollow(request)
	return nil
}

func (a *App) serviceManagerContext(
	serverID int64,
	operation string,
) (domain.Connection, domain.AuthRequest, *servicemanager.Manager, *logging.Logger, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, nil, err
	}
	a.mu.RLock()
	manager := a.services
	resolver := a.credentials
	a.mu.RUnlock()
	if manager == nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New("service manager is not initialized")
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

func (a *App) runSystemServiceAction(
	request domain.SystemServiceActionRequest,
	operation string,
	task func(*servicemanager.Manager, domain.Connection, domain.AuthRequest) (domain.SystemServiceActionResponse, error),
) (domain.SystemServiceActionResponse, error) {
	connection, auth, manager, logger, err := a.serviceManagerContext(request.ServerID, operation)
	if err != nil {
		return domain.SystemServiceActionResponse{}, err
	}
	response, err := task(manager, connection, auth)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "系统服务操作完成", operation, connection, nil)
	}
	return response, err
}

type serviceJournalEmitter struct {
	ctx context.Context
}

func (e serviceJournalEmitter) JournalState(event domain.ServiceJournalStateEvent) {
	runtime.EventsEmit(e.ctx, "servicejournal:state", event)
}

func (e serviceJournalEmitter) JournalLine(event domain.ServiceJournalLineEvent) {
	runtime.EventsEmit(e.ctx, "servicejournal:line", event)
}

func (e serviceJournalEmitter) JournalError(event domain.ServiceJournalErrorEvent) {
	runtime.EventsEmit(e.ctx, "servicejournal:error", event)
}

func (e serviceJournalEmitter) JournalCompleted(event domain.ServiceJournalCompletedEvent) {
	runtime.EventsEmit(e.ctx, "servicejournal:completed", event)
}
