package main

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/credential"
	"serverpilot/internal/domain"
	"serverpilot/internal/logging"
	"serverpilot/internal/persistence"
	"serverpilot/internal/settings"
	"serverpilot/internal/sshclient"
)

type routeHostKeyError interface {
	HostKeyFingerprints() (expected string, observed string)
}

func newSSHRouteDialer(
	store *persistence.Store,
	resolver *credential.Resolver,
	settingsService *settings.Service,
	logger *logging.Logger,
) sshclient.RouteDialer {
	_ = logger
	return func(
		ctx context.Context,
		connection domain.Connection,
		auth domain.AuthRequest,
		timeout time.Duration,
		direct sshclient.DirectDialer,
	) (*sshclient.Client, time.Duration, error) {
		if connection.ConnectionMode != domain.ConnectionModeJump {
			return direct(ctx, connection, auth, timeout)
		}
		if store == nil || resolver == nil {
			return nil, 0, routeError(connectionerror.RouteErrorJumpConnectionFailed, "jump", connection, errors.New("SSH route dependencies are not initialized"))
		}
		if connection.JumpServerID == nil || *connection.JumpServerID <= 0 {
			return nil, 0, routeError(connectionerror.RouteErrorJumpServerMissing, "jump", connection, nil)
		}
		jump, err := store.GetConnection(ctx, *connection.JumpServerID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, 0, routeError(connectionerror.RouteErrorJumpServerMissing, "jump", connection, err)
			}
			return nil, 0, routeError(connectionerror.RouteErrorJumpConnectionFailed, "jump", connection, err)
		}
		if jump.ConnectionMode == domain.ConnectionModeJump {
			return nil, 0, routeError(connectionerror.RouteErrorJumpConnectionFailed, "jump", jump, errors.New("nested jump host is not supported"))
		}

		jumpAuth, err := resolver.Resolve(ctx, jump, domain.AuthRequest{})
		if err != nil {
			return nil, 0, routeError(connectionerror.RouteErrorJumpAuthFailed, "jump", jump, err)
		}
		jumpAuth = applyRouteHostKeyPolicy(settingsService, jump, jumpAuth)
		jumpClient, _, err := direct(ctx, jump, jumpAuth, timeout)
		if err != nil {
			return nil, 0, classifyRouteDialError("jump", jump, err)
		}
		if sshclient.ShouldPersistObservedHostKey(jump, jumpAuth, jumpClient.Fingerprint()) {
			if err := store.UpdateHostKey(ctx, jump.ID, jumpClient.Fingerprint()); err != nil {
				_ = jumpClient.Close()
				return nil, 0, routeError(connectionerror.RouteErrorJumpHostKeyFailed, "jump", jump, err)
			}
			jump.HostKeyFingerprint = jumpClient.Fingerprint()
		}
		if err := resolver.CommitSuccessful(ctx, jump, jumpAuth); err != nil {
			_ = jumpClient.Close()
			return nil, 0, routeError(connectionerror.RouteErrorJumpAuthFailed, "jump", jump, err)
		}

		targetAuth := applyRouteHostKeyPolicy(settingsService, connection, auth)
		targetClient, latency, err := sshclient.DialThrough(ctx, jumpClient, connection, targetAuth, timeout)
		if err != nil {
			return nil, 0, classifyRouteDialError("target", connection, err)
		}
		return targetClient, latency, nil
	}
}

func applyRouteHostKeyPolicy(
	settingsService *settings.Service,
	connection domain.Connection,
	auth domain.AuthRequest,
) domain.AuthRequest {
	policy := domain.HostKeyAutoUpdate
	if settingsService != nil {
		policy = settingsService.Get().HostKeyPolicy
	}
	return sshclient.ApplyHostKeyPolicy(policy, connection, auth)
}

func classifyRouteDialError(stage string, connection domain.Connection, err error) error {
	var hostKeyErr routeHostKeyError
	if errors.As(err, &hostKeyErr) {
		if stage == "jump" {
			return routeError(connectionerror.RouteErrorJumpHostKeyFailed, stage, connection, err)
		}
		return routeError(connectionerror.RouteErrorTargetHostKeyFailed, stage, connection, err)
	}
	var credentialErr *credential.Error
	if errors.As(err, &credentialErr) {
		if stage == "jump" {
			return routeError(connectionerror.RouteErrorJumpAuthFailed, stage, connection, err)
		}
		return routeError(connectionerror.RouteErrorTargetAuthFailed, stage, connection, err)
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "unable to authenticate") ||
		strings.Contains(message, "permission denied") ||
		strings.Contains(message, "authentication failed") ||
		strings.Contains(message, "no supported methods remain") ||
		strings.Contains(message, "private-key passphrase") ||
		strings.Contains(message, "incorrect passphrase") {
		if stage == "jump" {
			return routeError(connectionerror.RouteErrorJumpAuthFailed, stage, connection, err)
		}
		return routeError(connectionerror.RouteErrorTargetAuthFailed, stage, connection, err)
	}
	if stage == "jump" {
		return routeError(connectionerror.RouteErrorJumpConnectionFailed, stage, connection, err)
	}
	return routeError(connectionerror.RouteErrorTargetUnreachableThroughJump, stage, connection, err)
}

func routeError(
	kind connectionerror.RouteErrorKind,
	stage string,
	connection domain.Connection,
	err error,
) *connectionerror.RouteError {
	return &connectionerror.RouteError{
		Kind:                 kind,
		Stage:                stage,
		CredentialServerID:   connection.ID,
		CredentialServerName: connection.Name,
		UserMessage:          routeUserMessage(kind, connection),
		Err:                  err,
	}
}

func routeUserMessage(kind connectionerror.RouteErrorKind, connection domain.Connection) string {
	name := strings.TrimSpace(connection.Name)
	if name == "" {
		name = "该服务器"
	}
	switch kind {
	case connectionerror.RouteErrorJumpServerMissing:
		return "该服务器配置的跳板机已不存在，请重新选择跳板机。"
	case connectionerror.RouteErrorJumpConnectionFailed:
		return "连接跳板机失败，请检查跳板机网络、SSH 端口和连接配置。"
	case connectionerror.RouteErrorJumpAuthFailed:
		if connection.AuthType == domain.AuthPrivateKey {
			return "跳板机「" + name + "」需要有效的私钥或私钥口令。"
		}
		return "跳板机「" + name + "」需要有效的 SSH 密码。"
	case connectionerror.RouteErrorJumpHostKeyFailed:
		return "跳板机主机指纹验证失败。"
	case connectionerror.RouteErrorTargetUnreachableThroughJump:
		return "已连接跳板机，但无法通过跳板机访问目标服务器。"
	case connectionerror.RouteErrorTargetAuthFailed:
		if connection.AuthType == domain.AuthPrivateKey {
			return "目标服务器「" + name + "」需要有效的私钥或私钥口令。"
		}
		return "目标服务器「" + name + "」需要有效的 SSH 密码。"
	case connectionerror.RouteErrorTargetHostKeyFailed:
		return "目标服务器主机指纹验证失败。"
	default:
		return "SSH 跳板连接失败。"
	}
}
