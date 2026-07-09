package main

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"hostdeck/internal/connectionerror"
	"hostdeck/internal/dockermanager"
	"hostdeck/internal/domain"
	"hostdeck/internal/logging"
)

func (a *App) DockerCheck(serverID int64) (domain.DockerAvailability, error) {
	connection, auth, manager, logger, err := a.dockerContext(serverID, "docker.check")
	if err != nil {
		return domain.DockerAvailability{}, err
	}
	state, err := manager.Check(connection, auth)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 检测完成", "docker.check", connection, nil)
	}
	return state, err
}

func (a *App) DockerCheckWithOptions(request domain.DockerServerRequest) (domain.DockerAvailability, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.check")
	if err != nil {
		return domain.DockerAvailability{}, err
	}
	state, err := manager.CheckWithExecutionMode(connection, auth, request.ExecutionMode)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 检测完成", "docker.check", connection, nil)
	}
	return state, err
}

func (a *App) DockerListContainers(request domain.DockerListContainersRequest) ([]domain.DockerContainer, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.list")
	if err != nil {
		return nil, err
	}
	containers, err := manager.ListWithExecutionMode(connection, auth, request.ExecutionMode)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器列表刷新完成", "docker.list", connection, nil)
	}
	return containers, err
}

func (a *App) DockerStartContainer(request domain.DockerContainerRequest) error {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.start")
	if err != nil {
		return err
	}
	err = manager.StartContainer(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器启动完成", "docker.start", connection, nil)
	}
	return err
}

func (a *App) DockerStopContainer(request domain.DockerContainerRequest) error {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.stop")
	if err != nil {
		return err
	}
	err = manager.StopContainer(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器停止完成", "docker.stop", connection, nil)
	}
	return err
}

func (a *App) DockerRestartContainer(request domain.DockerContainerRequest) error {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.restart")
	if err != nil {
		return err
	}
	err = manager.RestartContainer(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器重启完成", "docker.restart", connection, nil)
	}
	return err
}

func (a *App) DockerRemoveContainer(request domain.DockerContainerRequest) error {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.remove")
	if err != nil {
		return err
	}
	err = manager.RemoveContainer(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器删除完成", "docker.remove", connection, nil)
	}
	return err
}

func (a *App) DockerBatchStartContainers(
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.batch.start")
	if err != nil {
		return domain.DockerBatchContainerResponse{}, err
	}
	response, err := manager.BatchStartContainers(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器批量启动完成", "docker.batch.start", connection, nil)
	}
	return response, err
}

func (a *App) DockerBatchStopContainers(
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.batch.stop")
	if err != nil {
		return domain.DockerBatchContainerResponse{}, err
	}
	response, err := manager.BatchStopContainers(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器批量停止完成", "docker.batch.stop", connection, nil)
	}
	return response, err
}

func (a *App) DockerBatchRestartContainers(
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.batch.restart")
	if err != nil {
		return domain.DockerBatchContainerResponse{}, err
	}
	response, err := manager.BatchRestartContainers(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器批量重启完成", "docker.batch.restart", connection, nil)
	}
	return response, err
}

func (a *App) DockerBatchRemoveContainers(
	request domain.DockerBatchContainerRequest,
) (domain.DockerBatchContainerResponse, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.batch.remove")
	if err != nil {
		return domain.DockerBatchContainerResponse{}, err
	}
	response, err := manager.BatchRemoveContainers(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器批量删除完成", "docker.batch.remove", connection, nil)
	}
	return response, err
}

func (a *App) DockerGetContainerLogs(request domain.DockerLogsRequest) (string, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.logs")
	if err != nil {
		return "", err
	}
	output, err := manager.Logs(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器日志读取完成", "docker.logs", connection, nil)
	}
	return output, err
}

func (a *App) DockerStartLogStream(request domain.DockerLogStreamRequest) (string, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.logs.follow")
	if err != nil {
		return "", err
	}
	streamID, err := manager.StartLogStream(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器日志追踪状态已更新", "docker.logs.follow", connection, nil)
	}
	return streamID, err
}

func (a *App) DockerStopLogStream(request domain.DockerStopLogStreamRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.docker
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("docker manager is not initialized")
	}
	manager.StopLogStream(request.StreamID)
	return nil
}

func (a *App) DockerGetContainerInspectSummary(
	request domain.DockerContainerRequest,
) (domain.DockerInspectSummary, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.inspect")
	if err != nil {
		return domain.DockerInspectSummary{}, err
	}
	summary, err := manager.InspectSummary(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器信息读取完成", "docker.inspect", connection, nil)
	}
	return summary, err
}

func (a *App) DockerGetContainerStats(request domain.DockerContainerRequest) (domain.DockerContainerStats, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.stats")
	if err != nil {
		return domain.DockerContainerStats{}, err
	}
	stats, err := manager.Stats(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器资源占用读取完成", "docker.stats", connection, nil)
	}
	return stats, err
}

func (a *App) DockerStartStatsWatch(request domain.DockerStatsWatchRequest) (string, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.stats.watch")
	if err != nil {
		return "", err
	}
	watchID, err := manager.StartStatsWatch(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker 容器资源占用监视状态已更新", "docker.stats.watch", connection, nil)
	}
	return watchID, err
}

func (a *App) DockerStopStatsWatch(request domain.DockerStopStatsWatchRequest) error {
	_, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	manager := a.docker
	a.mu.RUnlock()
	if manager == nil {
		return errors.New("docker manager is not initialized")
	}
	manager.StopStatsWatch(request.WatchID)
	return nil
}

func (a *App) DockerComposeCheck(serverID int64) (domain.DockerComposeCapability, error) {
	connection, auth, manager, logger, err := a.dockerContext(serverID, "docker.compose.check")
	if err != nil {
		return domain.DockerComposeCapability{}, err
	}
	capability, err := manager.ComposeCheck(connection, auth)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker Compose 检测完成", "docker.compose.check", connection, nil)
	}
	return capability, err
}

func (a *App) DockerComposeCheckWithOptions(request domain.DockerServerRequest) (domain.DockerComposeCapability, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.compose.check")
	if err != nil {
		return domain.DockerComposeCapability{}, err
	}
	capability, err := manager.ComposeCheckWithExecutionMode(connection, auth, request.ExecutionMode)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker Compose 检测完成", "docker.compose.check", connection, nil)
	}
	return capability, err
}

func (a *App) DockerComposeListProjects(
	request domain.DockerComposeProjectsRequest,
) ([]domain.DockerComposeProject, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.compose.projects")
	if err != nil {
		return nil, err
	}
	projects, err := manager.ComposeListProjectsWithExecutionMode(connection, auth, request.ExecutionMode)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker Compose 项目列表刷新完成", "docker.compose.projects", connection, nil)
	}
	return projects, err
}

func (a *App) DockerComposeGetServices(
	request domain.DockerComposeProjectRequest,
) (domain.DockerComposeServicesResponse, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.compose.services")
	if err != nil {
		return domain.DockerComposeServicesResponse{}, err
	}
	response, err := manager.ComposeServices(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker Compose 服务列表刷新完成", "docker.compose.services", connection, nil)
	}
	return response, err
}

func (a *App) DockerComposeGetServiceDetail(
	request domain.DockerComposeServiceDetailRequest,
) (domain.DockerComposeService, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.compose.service.detail")
	if err != nil {
		return domain.DockerComposeService{}, err
	}
	service, err := manager.ComposeServiceDetail(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker Compose service detail refresh completed", "docker.compose.service.detail", connection, nil)
	}
	return service, err
}

func (a *App) DockerComposeGetLogs(
	request domain.DockerComposeLogsRequest,
) (domain.DockerComposeLogsSnapshot, error) {
	connection, auth, manager, logger, err := a.dockerContext(request.ServerID, "docker.compose.logs")
	if err != nil {
		return domain.DockerComposeLogsSnapshot{}, err
	}
	snapshot, err := manager.ComposeLogs(connection, auth, request)
	if logger != nil {
		logger.WriteConnection(levelFor(err), "Docker Compose 日志快照读取完成", "docker.compose.logs", connection, nil)
	}
	return snapshot, err
}

func (a *App) dockerContext(
	serverID int64,
	operation string,
) (domain.Connection, domain.AuthRequest, *dockermanager.Manager, *logging.Logger, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, nil, err
	}
	a.mu.RLock()
	manager := a.docker
	resolver := a.credentials
	a.mu.RUnlock()
	if manager == nil {
		return domain.Connection{}, domain.AuthRequest{}, nil, logger, errors.New("docker manager is not initialized")
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

type dockerEmitter struct {
	ctx context.Context
}

func (e dockerEmitter) State(event domain.DockerStateEvent) {
	runtime.EventsEmit(e.ctx, "docker:state", event)
}

func (e dockerEmitter) Containers(event domain.DockerContainersEvent) {
	runtime.EventsEmit(e.ctx, "docker:containers", event)
}

func (e dockerEmitter) Log(event domain.DockerLogEvent) {
	runtime.EventsEmit(e.ctx, "docker:logs", event)
}

func (e dockerEmitter) Stats(event domain.DockerStatsEvent) {
	runtime.EventsEmit(e.ctx, "docker:stats", event)
}

func (e dockerEmitter) Error(event domain.DockerErrorEvent) {
	runtime.EventsEmit(e.ctx, "docker:error", event)
}
