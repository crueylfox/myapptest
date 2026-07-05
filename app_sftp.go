package main

import (
	"context"
	"errors"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/connectionstate"
	"serverpilot/internal/domain"
)

type sftpEmitter struct {
	ctx    context.Context
	states *connectionstate.Tracker
}

func (e sftpEmitter) State(event domain.SFTPState) {
	if e.states != nil {
		e.states.UpdateSFTP(event)
	}
	runtime.EventsEmit(e.ctx, "sftp:state", event)
}

func (e sftpEmitter) Entries(event domain.SFTPListResult) {
	runtime.EventsEmit(e.ctx, "sftp:entries", event)
}

func (e sftpEmitter) Transfer(event domain.SFTPTransferState) {
	runtime.EventsEmit(e.ctx, "sftp:transfer", event)
}

func (e sftpEmitter) Error(event domain.SFTPErrorEvent) {
	runtime.EventsEmit(e.ctx, "sftp:error", event)
}

func (a *App) OpenSftp(request domain.ConnectRequest) (domain.SFTPState, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.SFTPState{}, err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return domain.SFTPState{}, err
	}
	a.mu.RLock()
	manager := a.sftp
	states := a.states
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPState{}, errors.New("SFTP manager is not initialized")
	}
	if states != nil {
		states.BeginConnect(connection.ID)
	}
	request.Auth, err = a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "sftp.open")
		a.recordConnectionError(connection, classified)
		return domain.SFTPState{}, errors.New(classified.UserMessage)
	}
	request.Auth = a.applyHostKeyPolicy(connection, request.Auth)
	return manager.Open(connection, request.Auth, request.ContextID, request.TerminalSessionID)
}

func (a *App) ReconnectSftp(request domain.ConnectRequest) (domain.SFTPState, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.SFTPState{}, err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return domain.SFTPState{}, err
	}
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPState{}, errors.New("SFTP manager is not initialized")
	}
	request.Auth, err = a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "sftp.reconnect")
		a.recordConnectionError(connection, classified)
		return domain.SFTPState{}, errors.New(classified.UserMessage)
	}
	request.Auth = a.applyHostKeyPolicy(connection, request.Auth)
	return manager.Reconnect(connection, request.Auth, request.ContextID, request.TerminalSessionID)
}

func (a *App) CloseSftp(connectionID int64) error {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("SFTP manager is not initialized")
	}
	manager.Stop(connectionID)
	return nil
}

func (a *App) CloseSftpContext(request domain.SFTPContextRequest) error {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("SFTP manager is not initialized")
	}
	manager.StopContext(request.ConnectionID, request.ContextID)
	return nil
}

func (a *App) GetSftpState(connectionID int64) (domain.SFTPState, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.SFTPState{}, err
	}
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPState{}, errors.New("SFTP manager is not initialized")
	}
	return manager.State(connectionID, ""), nil
}

func (a *App) GetSftpContextState(request domain.SFTPContextRequest) (domain.SFTPState, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.SFTPState{}, err
	}
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPState{}, errors.New("SFTP manager is not initialized")
	}
	return manager.State(request.ConnectionID, request.ContextID), nil
}

func (a *App) ReadSftpDir(request domain.SFTPListRequest) (domain.SFTPListResult, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPListResult{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.List(ctx, request)
}

func (a *App) SftpGoHome(request domain.SFTPContextRequest) (domain.SFTPListResult, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPListResult{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.Home(ctx, request)
}

func (a *App) SftpGoParent(request domain.SFTPContextRequest) (domain.SFTPListResult, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPListResult{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.Parent(ctx, request)
}

func (a *App) SftpMkdir(request domain.SFTPMkdirRequest) error {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.Mkdir(ctx, request)
}

func (a *App) SftpRename(request domain.SFTPRenameRequest) error {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.Rename(ctx, request)
}

func (a *App) SftpDelete(request domain.SFTPDeleteRequest) error {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.Delete(ctx, request)
}

func (a *App) SftpInspectDelete(request domain.SFTPInspectDeleteRequest) (domain.SFTPInspectDeleteResponse, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPInspectDeleteResponse{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.InspectDelete(ctx, request)
}

func (a *App) SftpStat(request domain.SFTPStatRequest) (domain.SFTPEntry, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPEntry{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.Stat(ctx, request)
}

func (a *App) SftpGetRemoteItemProperties(request domain.SFTPItemPropertiesRequest) (domain.SFTPItemProperties, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPItemProperties{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.GetItemProperties(ctx, request)
}

func (a *App) SftpUpdateRemoteItemPermissions(request domain.SFTPUpdateItemPermissionsRequest) (domain.SFTPItemProperties, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPItemProperties{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.UpdateItemPermissions(ctx, request)
}

func (a *App) SftpReadTextFile(request domain.SFTPReadTextFileRequest) (domain.SFTPReadTextFileResult, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPReadTextFileResult{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.ReadTextFile(ctx, request)
}

func (a *App) SftpWriteTextFile(request domain.SFTPWriteTextFileRequest) (domain.SFTPWriteTextFileResult, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPWriteTextFileResult{}, errors.New("SFTP manager is not initialized")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return manager.WriteTextFile(ctx, request)
}

func (a *App) SftpUpload(request domain.SFTPTransferRequest) (domain.SFTPTransferState, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPTransferState{}, errors.New("SFTP manager is not initialized")
	}
	return manager.Upload(request)
}

func (a *App) SftpDownload(request domain.SFTPTransferRequest) (domain.SFTPTransferState, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPTransferState{}, errors.New("SFTP manager is not initialized")
	}
	return manager.Download(request)
}

func (a *App) SftpUploadDirectory(request domain.SFTPUploadDirectoryRequest) (domain.SFTPTransferState, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPTransferState{}, errors.New("SFTP manager is not initialized")
	}
	return manager.UploadDirectory(request)
}

func (a *App) SftpDownloadDirectory(request domain.SFTPDownloadDirectoryRequest) (domain.SFTPTransferState, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPTransferState{}, errors.New("SFTP manager is not initialized")
	}
	return manager.DownloadDirectory(request)
}

func (a *App) SftpCancelTransfer(request domain.SFTPTransferCancelRequest) error {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("SFTP manager is not initialized")
	}
	return manager.CancelTransfer(request.TransferID)
}

func (a *App) SftpPauseTransfer(request domain.SFTPTransferControlRequest) (domain.SFTPTransferControlResponse, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPTransferControlResponse{}, errors.New("SFTP manager is not initialized")
	}
	return manager.PauseTransfer(request)
}

func (a *App) SftpResumeTransfer(request domain.SFTPTransferControlRequest) (domain.SFTPTransferControlResponse, error) {
	a.mu.RLock()
	manager := a.sftp
	a.mu.RUnlock()
	if manager == nil {
		return domain.SFTPTransferControlResponse{}, errors.New("SFTP manager is not initialized")
	}
	return manager.ResumeTransfer(request)
}

func (a *App) SelectLocalUploadFiles() ([]string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return nil, errors.New("application is not initialized")
	}
	return runtime.OpenMultipleFilesDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "所有文件", Pattern: "*"},
		},
	})
}

func (a *App) SelectLocalUploadDirectory() (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("application is not initialized")
	}
	return runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件夹",
	})
}

func (a *App) SelectLocalDownloadDirectory() (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("application is not initialized")
	}
	return runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{
		Title:                "选择下载目录",
		CanCreateDirectories: true,
	})
}
