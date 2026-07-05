package main

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/credential"
	"serverpilot/internal/domain"
	"serverpilot/internal/monitor"
	"serverpilot/internal/persistence"
	"serverpilot/internal/sshclient"
)

func (a *App) ListGroups() ([]domain.Group, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return store.ListGroups(a.ctx)
}

func (a *App) SaveGroup(group domain.Group) (domain.Group, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.Group{}, err
	}
	return store.SaveGroup(a.ctx, group)
}

func (a *App) DeleteGroup(id int64) error {
	store, _, _, err := a.dependencies()
	if err != nil {
		return err
	}
	return store.DeleteGroup(a.ctx, id)
}

func (a *App) ListConnections() ([]domain.Connection, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return store.ListConnections(a.ctx)
}

func (a *App) SaveConnection(request domain.SaveConnectionRequest) (domain.Connection, error) {
	if err := domain.ValidateConnection(request); err != nil {
		return domain.Connection{}, err
	}
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.Connection{}, err
	}
	var existing domain.Connection
	if request.ID != 0 {
		existing, _ = store.GetConnection(a.ctx, request.ID)
	}
	connection, err := store.SaveConnection(a.ctx, request)
	if err == nil && existing.ID != 0 && privateKeyCredentialChanged(existing, connection) {
		err = a.credentials.ClearKind(a.ctx, connection.ID, "passphrase")
		if err == nil {
			connection, err = store.GetConnection(a.ctx, connection.ID)
		}
	}
	logger.Write(levelFor(err), "服务器连接配置已保存", "connection.save", request.ID, err)
	return connection, err
}

func (a *App) ReorderServers(request domain.ReorderServersRequest) ([]domain.Connection, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	connections, err := store.ReorderServers(a.ctx, request)
	logger.Write(levelFor(err), "服务器顺序已更新", "connection.reorder", request.ServerID, err)
	return connections, err
}

func (a *App) SaveConnectionConfig(
	request domain.SaveConnectionConfigRequest,
) (domain.SaveConnectionConfigResult, error) {
	if err := domain.ValidateConnection(request.Connection); err != nil {
		return domain.SaveConnectionConfigResult{}, err
	}
	if request.Connection.AuthType == domain.AuthPrivateKey &&
		privateKeySource(request.Connection.PrivateKeySource) == domain.PrivateKeySourceLocalFile {
		encrypted, err := credential.InspectPrivateKey(request.Connection.PrivateKeyPath)
		if err != nil {
			return domain.SaveConnectionConfigResult{}, errors.New("私钥文件不存在、不可读或格式无效")
		}
		if encrypted && request.Auth.Passphrase != "" {
			candidate := domain.Connection{
				AuthType:       domain.AuthPrivateKey,
				PrivateKeyPath: request.Connection.PrivateKeyPath,
			}
			if _, err := a.credentials.Resolve(a.ctx, candidate, request.Auth); err != nil {
				return domain.SaveConnectionConfigResult{}, errors.New("私钥口令错误，无法解密私钥")
			}
		}
	}

	connection, err := a.SaveConnection(request.Connection)
	if err != nil {
		return domain.SaveConnectionConfigResult{}, err
	}
	valueProvided := request.Auth.Password != "" || request.Auth.Passphrase != ""
	secretMode := normalizeSecretUpdateMode(request.Auth.SecretUpdateMode, valueProvided)
	if !request.ConnectAfterSave {
		switch secretMode {
		case domain.SecretUpdateSet:
			if !valueProvided {
				return domain.SaveConnectionConfigResult{}, errors.New("凭据更新模式为 set，但没有提供新的凭据值")
			}
			if request.Auth.RememberSecret {
				err = a.credentials.SaveExplicit(a.ctx, connection, request.Auth)
			}
		case domain.SecretUpdateDelete:
			err = a.credentials.ClearKind(a.ctx, connection.ID, credential.Kind(connection))
		case domain.SecretUpdateUnchanged:
			err = nil
		}
		if err != nil {
			refreshed, refreshErr := a.store.GetConnection(a.ctx, connection.ID)
			if refreshErr == nil {
				connection = refreshed
			}
			a.logger.Write(
				"error",
				"服务器配置已保存，但系统凭据保存失败",
				"connection.credential.save",
				connection.ID,
				err,
			)
			return domain.SaveConnectionConfigResult{}, errors.New("服务器配置已保存，但凭据未能写入系统凭据库")
		}
		if secretMode == domain.SecretUpdateSet || secretMode == domain.SecretUpdateDelete {
			connection, err = a.store.GetConnection(a.ctx, connection.ID)
			if err != nil {
				return domain.SaveConnectionConfigResult{}, err
			}
		}
	} else if secretMode == domain.SecretUpdateDelete {
		err = a.credentials.ClearKind(a.ctx, connection.ID, credential.Kind(connection))
		if err != nil {
			return domain.SaveConnectionConfigResult{}, errors.New("服务器配置已保存，但凭据未能从系统凭据库删除")
		}
		connection, err = a.store.GetConnection(a.ctx, connection.ID)
		if err != nil {
			return domain.SaveConnectionConfigResult{}, err
		}
	} else if secretMode == domain.SecretUpdateSet && !valueProvided {
		return domain.SaveConnectionConfigResult{}, errors.New("凭据更新模式为 set，但没有提供新的凭据值")
	}
	return domain.SaveConnectionConfigResult{
		Connection:       connection,
		ConnectAfterSave: request.ConnectAfterSave,
	}, nil
}

func (a *App) DeleteSavedCredential(id int64) error {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	connection, err := store.GetConnection(a.ctx, id)
	if err != nil {
		return err
	}
	if err := a.credentials.ClearKind(a.ctx, id, credential.Kind(connection)); err != nil {
		logger.WriteConnection("error", "删除系统凭据失败", "connection.credential.delete", connection, nil)
		return errors.New("删除系统凭据失败")
	}
	logger.WriteConnection("info", "已删除保存的系统凭据", "connection.credential.delete", connection, nil)
	return nil
}

func normalizeSecretUpdateMode(mode domain.SecretUpdateMode, valueProvided bool) domain.SecretUpdateMode {
	switch mode {
	case domain.SecretUpdateUnchanged, domain.SecretUpdateSet, domain.SecretUpdateDelete:
		return mode
	default:
		if valueProvided {
			return domain.SecretUpdateSet
		}
		return domain.SecretUpdateUnchanged
	}
}

func (a *App) DeleteConnection(id int64) error {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	if err := a.DisconnectServer(id); err != nil {
		return err
	}
	if err := a.credentials.Clear(a.ctx, id); err != nil {
		logger.Write("error", "删除系统凭据失败", "connection.credentials.delete", id, err)
		return err
	}
	err = store.DeleteConnection(a.ctx, id)
	logger.Write(levelFor(err), "服务器连接配置已删除", "connection.delete", id, err)
	a.mu.RLock()
	states := a.states
	a.mu.RUnlock()
	if states != nil {
		states.Remove(id)
	}
	return err
}

func (a *App) TestConnection(request domain.ConnectRequest) (domain.TestConnectionResult, error) {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return domain.TestConnectionResult{}, err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return domain.TestConnectionResult{}, err
	}
	request.Auth, err = a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "connection.test")
		a.recordConnectionError(connection, classified)
		return domain.TestConnectionResult{
			Success: false, ErrorCode: classified.Code,
			Message: classified.UserMessage, ConnectionError: &classified,
		}, nil
	}
	request.Auth = a.applyHostKeyPolicy(connection, request.Auth)
	timeout := a.connectionTimeout()
	ctx, cancel := context.WithTimeout(a.ctx, timeout)
	defer cancel()
	client, latency, err := sshclient.Dial(ctx, connection, request.Auth, timeout)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "connection.test")
		classified.CredentialFromStore = request.Auth.ResolvedFromStore
		logger.WriteConnection("error", classified.UserMessage, "connection.test", connection, &classified)
		a.recordStateFailure(classified)
		return domain.TestConnectionResult{
			Success: false, ErrorCode: classified.Code,
			Message: classified.UserMessage, ConnectionError: &classified,
		}, nil
	}
	defer client.Close()
	if sshclient.ShouldPersistObservedHostKey(connection, request.Auth, client.Fingerprint()) {
		if err := store.UpdateHostKey(ctx, connection.ID, client.Fingerprint()); err != nil {
			classified := connectionerror.Classify(err, connection, "connection.hostkey")
			classified.UserMessage = "服务器已连接，但主机指纹记录更新失败"
			logger.WriteConnection("error", classified.UserMessage, "connection.hostkey", connection, &classified)
		}
	}
	if err := a.credentials.CommitSuccessful(a.ctx, connection, request.Auth); err != nil {
		return domain.TestConnectionResult{}, err
	}
	logger.WriteConnection("info", "SSH 连接测试成功", "connection.test", connection, nil)
	return domain.TestConnectionResult{
		Success: true, LatencyMillis: latency.Milliseconds(),
		HostKeyFingerprint: client.Fingerprint(), Message: "连接成功",
	}, nil
}

func (a *App) Connect(request domain.ConnectRequest) error {
	store, logger, manager, err := a.dependencies()
	if err != nil {
		return err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return err
	}
	a.mu.RLock()
	states := a.states
	a.mu.RUnlock()
	if states != nil {
		states.BeginConnect(connection.ID)
	}
	request.Auth, err = a.credentials.Resolve(a.ctx, connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "monitor.start")
		a.recordConnectionError(connection, classified)
		return errors.New(classified.UserMessage)
	}
	request.Auth = a.applyHostKeyPolicy(connection, request.Auth)
	err = manager.Start(connection, request.Auth)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "monitor.start")
		if errors.Is(err, monitor.ErrAlreadyRunning) {
			classified.UserMessage = "该服务器的监控连接已在运行"
			classified.Retryable = false
		}
		logger.WriteConnection("error", classified.UserMessage, "monitor.start", connection, &classified)
		return errors.New(classified.UserMessage)
	}
	logger.WriteConnection("info", "已请求启动服务器监控", "monitor.start", connection, nil)
	return err
}

func (a *App) Disconnect(id int64) error {
	return a.DisconnectServer(id)
}

func (a *App) DisconnectServer(id int64) error {
	_, logger, manager, err := a.dependencies()
	if err != nil {
		return err
	}
	a.mu.RLock()
	lifecycle := a.lifecycle
	terminalManager := a.terminal
	sftpManager := a.sftp
	tunnelManager := a.tunnel
	dockerManager := a.docker
	processManager := a.process
	batchManager := a.batch
	serviceManager := a.services
	networkInspectManager := a.networkInspect
	states := a.states
	a.mu.RUnlock()
	if lifecycle == nil {
		lifecycle = newServerLifecycle(manager, terminalManager, sftpManager, tunnelManager, dockerManager, processManager, batchManager, serviceManager, networkInspectManager, states)
	}
	lifecycle.Disconnect(id)
	logger.Write("info", "服务器连接已断开", "connection.disconnect", id, nil)
	return nil
}

func (a *App) GetAuthenticationState(id int64) (domain.AuthenticationState, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.AuthenticationState{}, err
	}
	connection, err := store.GetConnection(a.ctx, id)
	if err != nil {
		return domain.AuthenticationState{}, err
	}
	a.mu.RLock()
	resolver := a.credentials
	a.mu.RUnlock()
	if resolver == nil {
		return domain.AuthenticationState{}, errors.New("credential resolver is not initialized")
	}
	return resolver.State(a.ctx, connection), nil
}

func (a *App) ResetHostKeyTrust(id int64) error {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	if err := a.DisconnectServer(id); err != nil {
		return err
	}
	err = store.ClearHostKey(a.ctx, id)
	logger.Write(levelFor(err), "SSH 主机信任已重置", "connection.hostkey.reset", id, err)
	return err
}

func (a *App) GetConnectionState(id int64) (domain.ConnectionRuntimeState, error) {
	_, _, _, err := a.dependencies()
	if err != nil {
		return domain.ConnectionRuntimeState{}, err
	}
	a.mu.RLock()
	states := a.states
	a.mu.RUnlock()
	if states == nil {
		return domain.ConnectionRuntimeState{}, errors.New("connection state tracker is not initialized")
	}
	return states.Get(id), nil
}

func (a *App) ProbeHostKey(id int64) (domain.HostKeyProbeResult, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.HostKeyProbeResult{}, err
	}
	connection, err := store.GetConnection(a.ctx, id)
	if err != nil {
		return domain.HostKeyProbeResult{}, err
	}
	timeout := a.connectionTimeout()
	ctx, cancel := context.WithTimeout(a.ctx, timeout)
	defer cancel()
	fingerprint, err := sshclient.ProbeHostKey(ctx, connection, timeout)
	if err != nil {
		classified := connectionerror.Classify(err, connection, "connection.hostkey.probe")
		return domain.HostKeyProbeResult{}, errors.New(classified.UserMessage)
	}
	return domain.HostKeyProbeResult{Fingerprint: fingerprint}, nil
}

func (a *App) ProbeConnectionReachability(id int64) (domain.ConnectionReachabilityResult, error) {
	store, _, _, err := a.dependencies()
	if err != nil {
		return domain.ConnectionReachabilityResult{}, err
	}
	connection, err := store.GetConnection(a.ctx, id)
	if err != nil {
		return domain.ConnectionReachabilityResult{}, err
	}
	timeout := a.connectionTimeout()
	ctx, cancel := context.WithTimeout(a.ctx, timeout)
	defer cancel()
	if err := a.probeConnectionReachability(ctx, store, connection, timeout); err != nil {
		classified := connectionerror.Classify(err, connection, "terminal.reconnect.probe")
		a.recordConnectionError(connection, classified)
		return domain.ConnectionReachabilityResult{
			Reachable:       false,
			ConnectionError: &classified,
		}, nil
	}
	return domain.ConnectionReachabilityResult{Reachable: true}, nil
}

func (a *App) probeConnectionReachability(
	ctx context.Context,
	store *persistence.Store,
	connection domain.Connection,
	timeout time.Duration,
) error {
	if connection.ConnectionMode != domain.ConnectionModeJump {
		_, err := sshclient.ProbeHostKey(ctx, connection, timeout)
		return err
	}
	if store == nil || a.credentials == nil {
		return routeError(connectionerror.RouteErrorJumpConnectionFailed, "jump", connection, errors.New("SSH route dependencies are not initialized"))
	}
	if connection.JumpServerID == nil || *connection.JumpServerID <= 0 {
		return routeError(connectionerror.RouteErrorJumpServerMissing, "jump", connection, nil)
	}
	jump, err := store.GetConnection(ctx, *connection.JumpServerID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return routeError(connectionerror.RouteErrorJumpServerMissing, "jump", connection, err)
		}
		return routeError(connectionerror.RouteErrorJumpConnectionFailed, "jump", connection, err)
	}
	if jump.ConnectionMode == domain.ConnectionModeJump {
		return routeError(connectionerror.RouteErrorJumpConnectionFailed, "jump", jump, errors.New("nested jump host is not supported"))
	}
	jumpAuth, err := a.credentials.Resolve(ctx, jump, domain.AuthRequest{})
	if err != nil {
		return routeError(connectionerror.RouteErrorJumpAuthFailed, "jump", jump, err)
	}
	jumpAuth = applyRouteHostKeyPolicy(a.settings, jump, jumpAuth)
	jumpClient, _, err := sshclient.Dial(ctx, jump, jumpAuth, timeout)
	if err != nil {
		return classifyRouteDialError("jump", jump, err)
	}
	defer jumpClient.Close()
	_, err = sshclient.ProbeHostKeyThrough(ctx, jumpClient, connection, timeout)
	if err != nil {
		return classifyRouteDialError("target", connection, err)
	}
	return nil
}

func (a *App) TrustHostKey(request domain.TrustHostKeyRequest) error {
	store, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	connection, err := store.GetConnection(a.ctx, request.ConnectionID)
	if err != nil {
		return err
	}
	timeout := a.connectionTimeout()
	ctx, cancel := context.WithTimeout(a.ctx, timeout)
	defer cancel()
	fingerprint, err := sshclient.ProbeHostKey(ctx, connection, timeout)
	if err != nil {
		return err
	}
	if fingerprint == "" || fingerprint != request.ExpectedFingerprint {
		return errors.New("服务器主机指纹在确认期间发生变化，已停止保存")
	}
	if err := store.UpdateHostKey(ctx, connection.ID, fingerprint); err != nil {
		return err
	}
	logger.WriteConnection("info", "已明确保存服务器主机指纹", "connection.hostkey.trust", connection, nil)
	return nil
}

func (a *App) connectionTimeout() time.Duration {
	a.mu.RLock()
	service := a.settings
	a.mu.RUnlock()
	if service == nil {
		return 15 * time.Second
	}
	return time.Duration(service.Get().ConnectionTimeoutSeconds) * time.Second
}

func (a *App) applyHostKeyPolicy(
	connection domain.Connection,
	auth domain.AuthRequest,
) domain.AuthRequest {
	a.mu.RLock()
	service := a.settings
	a.mu.RUnlock()
	policy := domain.HostKeyAutoUpdate
	if service != nil {
		policy = service.Get().HostKeyPolicy
	}
	return sshclient.ApplyHostKeyPolicy(policy, connection, auth)
}

func (a *App) recordConnectionError(connection domain.Connection, classified domain.ConnectionError) {
	a.mu.RLock()
	logger := a.logger
	a.mu.RUnlock()
	if logger != nil {
		logger.WriteConnection("error", classified.UserMessage, classified.Operation, connection, &classified)
	}
	a.recordStateFailure(classified)
}

func (a *App) recordStateFailure(classified domain.ConnectionError) {
	a.mu.RLock()
	states := a.states
	a.mu.RUnlock()
	if states != nil {
		states.RecordFailure(classified.ServerID, classified)
	}
}

func levelFor(err error) string {
	if err != nil {
		return "error"
	}
	return "info"
}

func privateKeySource(source domain.PrivateKeySource) domain.PrivateKeySource {
	if source == "" {
		return domain.PrivateKeySourceLocalFile
	}
	return source
}

func privateKeyCredentialChanged(existing, updated domain.Connection) bool {
	if existing.AuthType != domain.AuthPrivateKey || updated.AuthType != domain.AuthPrivateKey {
		return false
	}
	return privateKeySource(existing.PrivateKeySource) != privateKeySource(updated.PrivateKeySource) ||
		existing.PrivateKeyPath != updated.PrivateKeyPath ||
		keyVaultIDValue(existing.KeyVaultID) != keyVaultIDValue(updated.KeyVaultID)
}
