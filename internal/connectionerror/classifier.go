package connectionerror

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"syscall"
	"time"

	"serverpilot/internal/credential"
	"serverpilot/internal/domain"
)

const (
	CodeAuthFailed            = "AUTH_FAILED"
	CodeCredentialRequired    = "CREDENTIAL_REQUIRED"
	CodeCredentialUnavailable = "CREDENTIAL_UNAVAILABLE"
	CodePassphraseInvalid     = "PASSPHRASE_INVALID"
	CodePrivateKeyInvalid     = "PRIVATE_KEY_INVALID"
	CodeDNSFailed             = "DNS_FAILED"
	CodeTimeout               = "CONNECTION_TIMEOUT"
	CodeRefused               = "CONNECTION_REFUSED"
	CodeUnreachable           = "HOST_UNREACHABLE"
	CodeHostKeyMismatch       = "HOST_KEY_MISMATCH"
	CodeHostKeyUnknown        = "HOST_KEY_UNKNOWN"
	CodeHandshakeFailed       = "HANDSHAKE_FAILED"
	CodeAlgorithmUnsupported  = "SSH_ALGORITHM_UNSUPPORTED"
	CodeConnectionClosed      = "CONNECTION_CLOSED"
	CodeKeepaliveFailed       = "SSH_KEEPALIVE_FAILED"
	CodeUnknown               = "UNKNOWN_CONNECTION_ERROR"
)

type hostKeyError interface {
	HostKeyFingerprints() (expected string, observed string)
}

func Classify(err error, connection domain.Connection, operation string) domain.ConnectionError {
	result := domain.ConnectionError{
		Code:             CodeUnknown,
		UserMessage:      "连接失败，请查看技术详情。",
		TechnicalMessage: errorText(err),
		Retryable:        false,
		ServerID:         connection.ID,
		Operation:        operation,
		Timestamp:        time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err == nil {
		return result
	}

	var routeErr *RouteError
	if errors.As(err, &routeErr) {
		result.Code = string(routeErr.Kind)
		result.UserMessage = routeErr.UserMessage
		result.Stage = routeErr.Stage
		result.CredentialServerID = routeErr.CredentialServerID
		result.CredentialServerName = routeErr.CredentialServerName
		result.Retryable = routeErr.Kind != RouteErrorJumpAuthFailed &&
			routeErr.Kind != RouteErrorTargetAuthFailed &&
			routeErr.Kind != RouteErrorJumpHostKeyFailed &&
			routeErr.Kind != RouteErrorTargetHostKeyFailed &&
			routeErr.Kind != RouteErrorJumpServerMissing
		var fingerprints hostKeyError
		if errors.As(routeErr.Err, &fingerprints) {
			result.ExpectedFingerprint, result.ObservedFingerprint = fingerprints.HostKeyFingerprints()
		}
		return result
	}

	var fingerprints hostKeyError
	if errors.As(err, &fingerprints) {
		result.ExpectedFingerprint, result.ObservedFingerprint = fingerprints.HostKeyFingerprints()
		if result.ExpectedFingerprint == "" {
			result.Code = CodeHostKeyUnknown
			result.UserMessage = "服务器主机指纹尚未受信任。"
		} else {
			result.Code = CodeHostKeyMismatch
			result.UserMessage = "服务器主机指纹与已保存记录不一致，连接已被阻止。"
		}
		return result
	}

	var credentialErr *credential.Error
	if errors.As(err, &credentialErr) {
		switch credentialErr.Code {
		case credential.CodePrivateKeyUnavailable, credential.CodePrivateKeyInvalid:
			result.Code = CodePrivateKeyInvalid
			if credentialErr.Code == credential.CodePrivateKeyUnavailable && strings.TrimSpace(credentialErr.Message) != "" {
				result.UserMessage = credentialErr.Message
			} else {
				result.UserMessage = "私钥文件无效、格式不受支持或无法读取。"
			}
		case credential.CodeCredentialInvalid:
			if connection.AuthType == domain.AuthPrivateKey {
				result.Code = CodePassphraseInvalid
				result.UserMessage = "私钥口令错误，无法解密私钥。"
			} else {
				result.Code = CodeAuthFailed
				result.UserMessage = "用户名、密码或认证方式不正确。"
			}
		case credential.CodeAuthenticationRequired:
			result.Code = CodeCredentialRequired
			result.UserMessage = authenticationRequiredMessage(connection)
		case credential.CodeCredentialUnavailable:
			result.Code = CodeCredentialUnavailable
			result.UserMessage = "系统凭据引用存在，但凭据库中的值不可用，请重新输入。"
		default:
			result.Code = CodeAuthFailed
			result.UserMessage = authenticationRequiredMessage(connection)
		}
		return result
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return with(result, CodeTimeout, "连接服务器超时，请检查地址、端口、网络和防火墙。", true)
	}
	if errors.Is(err, context.Canceled) {
		return with(result, CodeConnectionClosed, "SSH 连接已取消。", true)
	}
	if strings.Contains(strings.ToLower(errorText(err)), "ssh keepalive failed") {
		return with(result, CodeKeepaliveFailed, "SSH 连接保活失败，连接已断开。", true)
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return with(result, CodeDNSFailed, "无法解析服务器地址，请检查主机名或 DNS。", true)
	}

	if errors.Is(err, syscall.ECONNREFUSED) || hasErrno(err, 10061) {
		return with(result, CodeRefused, "目标服务器拒绝连接，请检查 SSH 端口和服务状态。", true)
	}
	if errors.Is(err, syscall.EHOSTUNREACH) ||
		errors.Is(err, syscall.ENETUNREACH) ||
		hasErrno(err, 10051) ||
		hasErrno(err, 10065) {
		return with(result, CodeUnreachable, "无法到达服务器，请检查网络线路、路由或服务器是否在线。", true)
	}

	var timeout interface{ Timeout() bool }
	if errors.As(err, &timeout) && timeout.Timeout() {
		return with(result, CodeTimeout, "连接服务器超时，请检查地址、端口、网络和防火墙。", true)
	}

	message := strings.ToLower(err.Error())
	switch {
	case containsAny(message,
		"unable to authenticate",
		"permission denied",
		"authentication failed",
		"no supported methods remain"):
		return with(result, CodeAuthFailed, "用户名、密码或认证方式不正确。", false)
	case containsAny(message,
		"incorrect passphrase",
		"incorrect password",
		"decryption password incorrect",
		"private key passphrase"):
		return with(result, CodePassphraseInvalid, "私钥口令错误，无法解密私钥。", false)
	case containsAny(message,
		"parse private key",
		"read private key",
		"private key is invalid",
		"private key is unavailable"):
		return with(result, CodePrivateKeyInvalid, "私钥文件无效、格式不受支持或无法读取。", false)
	case strings.Contains(message, "connection refused"):
		return with(result, CodeRefused, "目标服务器拒绝连接，请检查 SSH 端口和服务状态。", true)
	case containsAny(message, "no route to host", "host is unreachable", "network is unreachable"):
		return with(result, CodeUnreachable, "无法到达服务器，请检查网络线路、路由或服务器是否在线。", true)
	case containsAny(message, "i/o timeout", "operation timed out", "deadline exceeded"):
		return with(result, CodeTimeout, "连接服务器超时，请检查地址、端口、网络和防火墙。", true)
	case containsAny(message,
		"no common algorithm",
		"no matching algorithm",
		"unsupported algorithm",
		"algorithm negotiation failed"):
		return with(result, CodeAlgorithmUnsupported, "SSH 算法协商失败，服务器不支持当前客户端算法或协议。", true)
	case containsAny(message,
		"ssh handshake",
		"handshake failed",
		"no common algorithm",
		"protocol error",
		"version exchange"):
		return with(result, CodeHandshakeFailed, "SSH 握手失败，服务器可能不支持当前算法或协议。", true)
	case containsAny(message,
		"connection reset",
		"broken pipe",
		"use of closed network connection",
		"connection closed",
		"unexpected eof",
		" eof"):
		return with(result, CodeConnectionClosed, "SSH 连接已被远程服务器关闭。", true)
	}
	return result
}

func StatusForCode(code string) domain.ConnectionStatus {
	switch code {
	case CodeAuthFailed:
		return domain.StatusAuthFailed
	case CodePassphraseInvalid, CodePrivateKeyInvalid:
		return domain.StatusKeyError
	case CodeTimeout:
		return domain.StatusTimeout
	case CodeDNSFailed, CodeUnreachable:
		return domain.StatusUnreachable
	case CodeRefused:
		return domain.StatusRefused
	case CodeAlgorithmUnsupported, CodeHandshakeFailed:
		return domain.StatusError
	case CodeHostKeyMismatch, CodeHostKeyUnknown:
		return domain.StatusHostKeyMismatch
	case CodeConnectionClosed, CodeKeepaliveFailed:
		return domain.StatusDisconnected
	case string(RouteErrorJumpAuthFailed), string(RouteErrorTargetAuthFailed):
		return domain.StatusAuthFailed
	case string(RouteErrorJumpHostKeyFailed), string(RouteErrorTargetHostKeyFailed):
		return domain.StatusHostKeyMismatch
	case string(RouteErrorJumpServerMissing):
		return domain.StatusError
	case string(RouteErrorJumpConnectionFailed), string(RouteErrorTargetUnreachableThroughJump):
		return domain.StatusUnreachable
	default:
		return domain.StatusError
	}
}

func with(result domain.ConnectionError, code, userMessage string, retryable bool) domain.ConnectionError {
	result.Code = code
	result.UserMessage = userMessage
	result.Retryable = retryable
	return result
}

func authenticationRequiredMessage(connection domain.Connection) string {
	if connection.AuthType == domain.AuthPrivateKey {
		return "需要输入 SSH 私钥口令"
	}
	return "需要输入 SSH 密码"
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func containsAny(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, candidate) {
			return true
		}
	}
	return false
}

func hasErrno(err error, value syscall.Errno) bool {
	var pathErr *os.PathError
	if errors.As(err, &pathErr) && errors.Is(pathErr.Err, value) {
		return true
	}
	var syscallErr *os.SyscallError
	if errors.As(err, &syscallErr) && errors.Is(syscallErr.Err, value) {
		return true
	}
	var errno syscall.Errno
	return errors.As(err, &errno) && errno == value
}
