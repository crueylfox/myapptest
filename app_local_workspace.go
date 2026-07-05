package main

import (
	"errors"

	"serverpilot/internal/domain"
)

func (a *App) GetLocalResourceSnapshot() (domain.LocalResourceSnapshot, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.LocalResourceSnapshot{}, err
	}
	a.mu.RLock()
	service := a.localMonitor
	a.mu.RUnlock()
	if service == nil {
		return domain.LocalResourceSnapshot{}, errors.New("local monitor service is not initialized")
	}
	return service.Snapshot()
}

func (a *App) GetLocalExplorerHome() (domain.LocalExplorerHome, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.LocalExplorerHome{}, err
	}
	a.mu.RLock()
	service := a.localFiles
	a.mu.RUnlock()
	if service == nil {
		return domain.LocalExplorerHome{}, errors.New("local file service is not initialized")
	}
	return service.Home()
}

func (a *App) GetLocalDrives() ([]domain.LocalDrive, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	service := a.localFiles
	a.mu.RUnlock()
	if service == nil {
		return nil, errors.New("local file service is not initialized")
	}
	return service.Drives()
}

func (a *App) ListLocalDirectory(request domain.LocalDirectoryRequest) (domain.LocalDirectoryListing, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.LocalDirectoryListing{}, err
	}
	a.mu.RLock()
	service := a.localFiles
	a.mu.RUnlock()
	if service == nil {
		return domain.LocalDirectoryListing{}, errors.New("local file service is not initialized")
	}
	return service.ListDirectory(request)
}

func (a *App) OpenLocalPath(request domain.LocalPathRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	service := a.localFiles
	a.mu.RUnlock()
	if service == nil {
		return errors.New("local file service is not initialized")
	}
	return service.OpenPath(request)
}

func (a *App) RevealLocalPath(request domain.LocalPathRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	service := a.localFiles
	a.mu.RUnlock()
	if service == nil {
		return errors.New("local file service is not initialized")
	}
	return service.RevealPath(request)
}

func (a *App) ShowLocalPathProperties(request domain.LocalPathRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	service := a.localFiles
	a.mu.RUnlock()
	if service == nil {
		return errors.New("local file service is not initialized")
	}
	return service.ShowProperties(request)
}
