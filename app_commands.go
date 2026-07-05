package main

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"serverpilot/internal/commands"
	"serverpilot/internal/domain"
	"serverpilot/internal/persistence"
)

type batchCommandEmitter struct {
	ctx context.Context
}

func (e batchCommandEmitter) State(event domain.BatchCommandStateEvent) {
	runtime.EventsEmit(e.ctx, "batchcommand:state", event)
}

func (e batchCommandEmitter) Output(event domain.BatchCommandOutputEvent) {
	runtime.EventsEmit(e.ctx, "batchcommand:output", event)
}

func (e batchCommandEmitter) Completed(event domain.BatchCommandCompletedEvent) {
	runtime.EventsEmit(e.ctx, "batchcommand:completed", event)
}

func (e batchCommandEmitter) Error(event domain.BatchCommandErrorEvent) {
	runtime.EventsEmit(e.ctx, "batchcommand:error", event)
}

func (a *App) StartBatchCommand(request domain.StartBatchCommandRequest) (domain.BatchCommandTask, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.BatchCommandTask{}, err
	}
	a.mu.RLock()
	manager := a.batch
	a.mu.RUnlock()
	if manager == nil {
		return domain.BatchCommandTask{}, errors.New("batch command manager is not initialized")
	}
	return manager.Start(request)
}

func (a *App) CancelBatchCommandServer(request domain.CancelBatchCommandServerRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.batch
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("batch command manager is not initialized")
	}
	return manager.CancelServer(request)
}

func (a *App) CancelBatchCommandTask(request domain.CancelBatchCommandTaskRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.batch
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("batch command manager is not initialized")
	}
	return manager.CancelTask(request)
}

func (a *App) GetBatchCommandTask(taskID string) (domain.BatchCommandTask, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.BatchCommandTask{}, err
	}
	a.mu.RLock()
	manager := a.batch
	a.mu.RUnlock()
	if manager == nil {
		return domain.BatchCommandTask{}, errors.New("batch command manager is not initialized")
	}
	return manager.Get(taskID)
}

func (a *App) ListBatchCommandTasks() ([]domain.BatchCommandTask, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	manager := a.batch
	a.mu.RUnlock()
	if manager == nil {
		return nil, errors.New("batch command manager is not initialized")
	}
	return manager.List(), nil
}

func (a *App) ClearBatchCommandTask(taskID string) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.batch
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("batch command manager is not initialized")
	}
	return manager.Clear(taskID)
}

func (a *App) commandService(store *persistence.Store) *commands.Service {
	return commands.NewWithHistoryLimit(store, a.commandHistoryMaxEntries)
}

func (a *App) commandHistoryMaxEntries() int {
	a.mu.RLock()
	service := a.settings
	a.mu.RUnlock()
	if service == nil {
		return domain.DefaultCommandHistoryMaxEntries
	}
	return service.Get().CommandHistoryMaxEntries
}

func (a *App) ListCommandHistory(request domain.ListCommandHistoryRequest) ([]domain.CommandHistoryEntry, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return a.commandService(store).ListHistory(a.ctx, request)
}

func (a *App) RecordCommandHistory(request domain.RecordCommandHistoryRequest) (domain.RecordCommandHistoryResult, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.RecordCommandHistoryResult{}, err
	}
	return a.commandService(store).RecordHistory(a.ctx, request)
}

func (a *App) RecordBatchCommandHistory(request domain.RecordBatchCommandHistoryRequest) (domain.RecordBatchCommandHistoryResult, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.RecordBatchCommandHistoryResult{}, err
	}
	return a.commandService(store).RecordBatchHistory(a.ctx, request)
}

func (a *App) DeleteCommandHistory(id string) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return a.commandService(store).DeleteHistory(a.ctx, id)
}

func (a *App) UpdateCommandHistory(request domain.UpdateCommandHistoryRequest) (domain.UpdateCommandHistoryResult, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.UpdateCommandHistoryResult{}, err
	}
	return a.commandService(store).UpdateHistory(a.ctx, request)
}

func (a *App) ClearCommandHistory(serverID int64) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return a.commandService(store).ClearHistory(a.ctx, serverID)
}

func (a *App) ListCommandFavorites(request domain.ListCommandFavoritesRequest) ([]domain.CommandFavorite, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return a.commandService(store).ListFavorites(a.ctx, request)
}

func (a *App) CreateCommandFavorite(request domain.SaveCommandFavoriteRequest) (domain.CommandFavorite, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	return a.commandService(store).CreateFavorite(a.ctx, request)
}

func (a *App) UpdateCommandFavorite(request domain.SaveCommandFavoriteRequest) (domain.CommandFavorite, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	return a.commandService(store).UpdateFavorite(a.ctx, request)
}

func (a *App) DeleteCommandFavorite(id string) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return a.commandService(store).DeleteFavorite(a.ctx, id)
}

func (a *App) IncrementCommandFavoriteUse(id string) (domain.CommandFavorite, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	return a.commandService(store).IncrementFavoriteUse(a.ctx, id)
}

func (a *App) ListCommandSuggestions(
	request domain.ListCommandSuggestionsRequest,
) ([]domain.CommandSuggestion, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return a.commandService(store).ListSuggestions(a.ctx, request)
}
