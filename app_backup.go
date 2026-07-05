package main

import (
	"errors"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/backup"
	"serverpilot/internal/domain"
)

func (a *App) SelectBackupExportPath() (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("application is not initialized")
	}
	defaultName := "serverpilot-backup-" + time.Now().Format("2006-01-02") + ".spbackup"
	return runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:           "保存 ServerPilot 加密备份",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "ServerPilot 备份 (*.spbackup)", Pattern: "*.spbackup"},
			{DisplayName: "所有文件", Pattern: "*"},
		},
	})
}

func (a *App) SelectBackupImportFile() (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("application is not initialized")
	}
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择 ServerPilot 加密备份",
		Filters: []runtime.FileFilter{
			{DisplayName: "ServerPilot 备份 (*.spbackup)", Pattern: "*.spbackup"},
			{DisplayName: "所有文件", Pattern: "*"},
		},
	})
}

func (a *App) ExportBackup(request domain.BackupExportRequest) (domain.BackupExportResult, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.BackupExportResult{}, err
	}
	service := backup.New(store, a.secrets)
	result, err := service.Export(a.ctx, request)
	logger.Write(levelFor(err), "备份导出完成", "backup.export", 0, sanitizeBackupError(err))
	return result, err
}

func (a *App) InspectBackup(request domain.BackupInspectRequest) (domain.BackupPreview, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.BackupPreview{}, err
	}
	service := backup.New(store, a.secrets)
	preview, err := service.Inspect(a.ctx, request)
	logger.Write(levelFor(err), "备份预览完成", "backup.inspect", 0, sanitizeBackupError(err))
	return preview, err
}

func (a *App) ImportBackup(request domain.BackupImportRequest) (domain.BackupImportResult, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.BackupImportResult{}, err
	}
	service := backup.New(store, a.secrets)
	result, err := service.Import(a.ctx, request)
	if err == nil {
		a.mu.RLock()
		settingsService := a.settings
		a.mu.RUnlock()
		if settingsService != nil {
			_, err = settingsService.Reload(a.ctx)
		}
	}
	logger.Write(levelFor(err), "备份导入完成", "backup.import", 0, sanitizeBackupError(err))
	return result, err
}

func sanitizeBackupError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	if index := strings.Index(message, ": "); index > 0 {
		return errors.New(message)
	}
	return errors.New("备份操作失败")
}
