package main

import (
	"time"

	"serverpilot/internal/domain"
)

func (a *App) BeginAlertSession(request domain.BeginAlertSessionRequest) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return store.BeginAlertSession(a.ctx, request.SessionID, request.HistoryLimit)
}

func (a *App) ListAlertHistory(request domain.ListAlertHistoryRequest) ([]domain.AlertHistoryEvent, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return store.ListAlertHistory(a.ctx, request.Limit)
}

func (a *App) PersistAlertHistoryEvent(
	request domain.PersistAlertHistoryEventRequest,
) (domain.AlertHistoryPersistResult, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.AlertHistoryPersistResult{}, err
	}
	return store.UpsertAlertHistoryEvent(a.ctx, request.Event, request.HistoryLimit)
}

func (a *App) MarkAlertHistoryRead(request domain.MarkAlertHistoryReadRequest) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return store.MarkAlertHistoryRead(a.ctx, request.EventID)
}

func (a *App) MarkAllAlertHistoryRead(_ domain.MarkAllAlertHistoryReadRequest) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return store.MarkAllAlertHistoryRead(a.ctx)
}

func (a *App) ClearResolvedAlertHistory(_ domain.ClearResolvedAlertHistoryRequest) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return store.ClearResolvedAlertHistory(a.ctx)
}

func (a *App) GetMonitorSnapshot(id int64) (domain.MonitorSnapshot, error) {
	_, _, manager, err := a.dependencies()
	if err != nil {
		return domain.MonitorSnapshot{}, err
	}
	snapshot, ok := manager.Latest(id)
	if !ok {
		return domain.MonitorSnapshot{
			ConnectionID: id, Status: domain.StatusOffline, Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		}, nil
	}
	return snapshot, nil
}

func (a *App) ListNetworkInterfaces(
	request domain.ListNetworkInterfacesRequest,
) (domain.ListNetworkInterfacesResponse, error) {
	_, logger, manager, err := a.dependencies()
	if err != nil {
		return domain.ListNetworkInterfacesResponse{Interfaces: []domain.NetworkInterface{}}, err
	}
	response, err := manager.ListNetworkInterfaces(a.ctx, request)
	if logger != nil {
		logger.Write(levelFor(err), "网络接口列表读取完成", "monitor.network.interfaces", request.ServerID, err)
	}
	if response.Interfaces == nil {
		response.Interfaces = []domain.NetworkInterface{}
	}
	return response, err
}

func (a *App) GetMonitorNetworkInterface(serverID int64) (domain.MonitorNetworkInterfacePreference, error) {
	store, _, manager, err := a.dependencies()
	if err != nil {
		return domain.MonitorNetworkInterfacePreference{}, err
	}
	preference, err := store.GetMonitorNetworkInterface(a.ctx, serverID)
	if err != nil {
		return domain.MonitorNetworkInterfacePreference{}, err
	}
	manager.UpdateNetworkInterfacePreference(preference)
	return preference, nil
}

func (a *App) SetMonitorNetworkInterface(
	request domain.SetMonitorNetworkInterfaceRequest,
) (domain.MonitorNetworkInterfacePreference, error) {
	store, logger, manager, err := a.dependencies()
	if err != nil {
		return domain.MonitorNetworkInterfacePreference{}, err
	}
	preference, err := store.SetMonitorNetworkInterface(a.ctx, request)
	if err != nil {
		if logger != nil {
			logger.Write("warn", "网络接口偏好保存失败", "monitor.network.preference", request.ServerID, err)
		}
		return domain.MonitorNetworkInterfacePreference{}, err
	}
	manager.UpdateNetworkInterfacePreference(preference)
	if logger != nil {
		logger.Write("info", "网络接口偏好已保存", "monitor.network.preference", request.ServerID, nil)
	}
	return preference, nil
}
