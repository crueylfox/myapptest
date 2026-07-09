package main

import (
	"errors"

	"hostdeck/internal/domain"
	"hostdeck/internal/settings"
	"hostdeck/internal/version"
)

func (a *App) GetSettings() (domain.AppSettings, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.AppSettings{}, err
	}
	a.mu.RLock()
	service := a.settings
	a.mu.RUnlock()
	if service == nil {
		return domain.AppSettings{}, errors.New("settings service is not initialized")
	}
	return service.Get(), nil
}

func (a *App) GetAppVersion() domain.AppVersionInfo {
	return domain.AppVersionInfo{Version: version.Version}
}

func (a *App) GetDefaultSettings() (domain.AppSettings, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.AppSettings{}, err
	}
	return domain.DefaultAppSettings(), nil
}

func (a *App) SaveSettings(value domain.AppSettings) (domain.AppSettings, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.AppSettings{}, err
	}
	a.mu.RLock()
	service := a.settings
	a.mu.RUnlock()
	if service == nil {
		return domain.AppSettings{}, errors.New("settings service is not initialized")
	}
	saved, err := service.Save(a.ctx, value)
	if err == nil {
		err = store.PruneAlertHistory(a.ctx, saved.Alerts.HistoryLimit)
	}
	logger.Write(levelFor(err), "应用连接设置已保存", "settings.save", 0, err)
	return saved, err
}

func (a *App) CheckShortcutConflicts(
	request domain.ShortcutConflictCheckRequest,
) (domain.ShortcutConflictCheckResponse, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.ShortcutConflictCheckResponse{}, err
	}
	return settings.CheckShortcutConflicts(request), nil
}

func (a *App) PersistWindowState() error {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	if err := persistWindowState(a.ctx, store); err != nil {
		logger.Write("warn", "保存窗口状态失败", "window.persist", 0, err)
		return err
	}
	return nil
}
