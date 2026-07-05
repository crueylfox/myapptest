package connectionerror

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"syscall"
	"testing"

	"serverpilot/internal/credential"
	"serverpilot/internal/domain"
)

type testHostKeyError struct {
	expected string
	observed string
}

func (e *testHostKeyError) Error() string {
	return "host key mismatch"
}

func (e *testHostKeyError) HostKeyFingerprints() (string, string) {
	return e.expected, e.observed
}

func TestClassifyConnectionErrors(t *testing.T) {
	connection := domain.Connection{ID: 42, AuthType: domain.AuthPassword}
	tests := []struct {
		name      string
		err       error
		code      string
		message   string
		retryable bool
	}{
		{"wrong password", errors.New("ssh: unable to authenticate, attempted methods [none password], no supported methods remain"), CodeAuthFailed, "用户名、密码或认证方式不正确。", false},
		{"dns", &net.DNSError{Err: "no such host", Name: "missing.invalid"}, CodeDNSFailed, "无法解析服务器地址，请检查主机名或 DNS。", true},
		{"timeout", context.DeadlineExceeded, CodeTimeout, "连接服务器超时，请检查地址、端口、网络和防火墙。", true},
		{"refused", fmt.Errorf("dial: %w", syscall.ECONNREFUSED), CodeRefused, "目标服务器拒绝连接，请检查 SSH 端口和服务状态。", true},
		{"unreachable", fmt.Errorf("dial: %w", syscall.EHOSTUNREACH), CodeUnreachable, "无法到达服务器，请检查网络线路、路由或服务器是否在线。", true},
		{"handshake", errors.New("SSH handshake: protocol banner rejected"), CodeHandshakeFailed, "SSH 握手失败，服务器可能不支持当前算法或协议。", true},
		{"algorithm unsupported", errors.New("SSH handshake: no common algorithm"), CodeAlgorithmUnsupported, "SSH 算法协商失败，服务器不支持当前客户端算法或协议。", true},
		{"closed", errors.New("read tcp: connection reset by peer"), CodeConnectionClosed, "SSH 连接已被远程服务器关闭。", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := Classify(test.err, connection, "test.connect")
			if result.Code != test.code {
				t.Fatalf("code = %q, want %q", result.Code, test.code)
			}
			if result.Retryable != test.retryable {
				t.Fatalf("retryable = %v, want %v", result.Retryable, test.retryable)
			}
			if result.UserMessage != test.message {
				t.Fatalf("message = %q, want %q", result.UserMessage, test.message)
			}
			if result.ServerID != connection.ID || result.Operation == "" || result.Timestamp == "" {
				t.Fatalf("missing structured context: %+v", result)
			}
		})
	}
}

func TestClassifyCredentialAndKeyErrors(t *testing.T) {
	passwordConnection := domain.Connection{ID: 1, AuthType: domain.AuthPassword}
	keyConnection := domain.Connection{ID: 2, AuthType: domain.AuthPrivateKey}

	password := Classify(&credential.Error{Code: credential.CodeCredentialInvalid, Message: "invalid"}, passwordConnection, "terminal.connect")
	if password.Code != CodeAuthFailed {
		t.Fatalf("password code = %q", password.Code)
	}

	passphrase := Classify(&credential.Error{Code: credential.CodeCredentialInvalid, Message: "invalid"}, keyConnection, "terminal.connect")
	if passphrase.Code != CodePassphraseInvalid {
		t.Fatalf("passphrase code = %q", passphrase.Code)
	}

	privateKey := Classify(&credential.Error{Code: credential.CodePrivateKeyUnavailable, Message: "missing"}, keyConnection, "terminal.connect")
	if privateKey.Code != CodePrivateKeyInvalid {
		t.Fatalf("private key code = %q", privateKey.Code)
	}
	if privateKey.UserMessage != "missing" || privateKey.Retryable {
		t.Fatalf("private key message/retryable = %+v", privateKey)
	}

	required := Classify(&credential.Error{Code: credential.CodeAuthenticationRequired, Message: "Password is required"}, passwordConnection, "terminal.connect")
	if required.Code != CodeCredentialRequired {
		t.Fatalf("missing password code = %q", required.Code)
	}
	if strings.Contains(required.UserMessage, "拒绝") {
		t.Fatalf("missing password must not look like saved credential rejection: %+v", required)
	}

	unavailable := Classify(&credential.Error{Code: credential.CodeCredentialUnavailable, Message: "Saved credential is unavailable"}, passwordConnection, "terminal.connect")
	if unavailable.Code != CodeCredentialUnavailable {
		t.Fatalf("unavailable credential code = %q", unavailable.Code)
	}
	if strings.Contains(unavailable.UserMessage, "拒绝") {
		t.Fatalf("unavailable credential must not look like saved credential rejection: %+v", unavailable)
	}
}

func TestClassifyHostKeyMismatch(t *testing.T) {
	result := Classify(
		&testHostKeyError{expected: "SHA256:old", observed: "SHA256:new"},
		domain.Connection{ID: 7},
		"terminal.connect",
	)
	if result.Code != CodeHostKeyMismatch {
		t.Fatalf("code = %q", result.Code)
	}
	if result.ExpectedFingerprint != "SHA256:old" || result.ObservedFingerprint != "SHA256:new" {
		t.Fatalf("fingerprints not preserved: %+v", result)
	}
}

func TestClassifyRouteErrors(t *testing.T) {
	connection := domain.Connection{ID: 9, Name: "target"}
	result := Classify(&RouteError{
		Kind:                 RouteErrorJumpServerMissing,
		Stage:                "jump",
		CredentialServerID:   9,
		CredentialServerName: "target",
		UserMessage:          "该服务器配置的跳板机已不存在，请重新选择跳板机。",
	}, connection, "terminal.connect")
	if result.Code != string(RouteErrorJumpServerMissing) || result.Retryable {
		t.Fatalf("missing route result=%+v", result)
	}
	if result.Stage != "jump" || result.CredentialServerID != 9 || result.CredentialServerName != "target" {
		t.Fatalf("route metadata missing: %+v", result)
	}
	if StatusForCode(result.Code) != domain.StatusError {
		t.Fatalf("status=%s", StatusForCode(result.Code))
	}

	auth := Classify(&RouteError{Kind: RouteErrorTargetAuthFailed, Stage: "target", UserMessage: "目标服务器认证失败。"}, connection, "terminal.connect")
	if auth.Code != string(RouteErrorTargetAuthFailed) || auth.Retryable || StatusForCode(auth.Code) != domain.StatusAuthFailed {
		t.Fatalf("auth route result=%+v status=%s", auth, StatusForCode(auth.Code))
	}

	hostKey := Classify(&RouteError{
		Kind:        RouteErrorJumpHostKeyFailed,
		Stage:       "jump",
		UserMessage: "跳板机主机指纹验证失败。",
		Err:         &testHostKeyError{expected: "SHA256:old", observed: "SHA256:new"},
	}, connection, "terminal.connect")
	if hostKey.Code != string(RouteErrorJumpHostKeyFailed) ||
		hostKey.ExpectedFingerprint != "SHA256:old" ||
		hostKey.ObservedFingerprint != "SHA256:new" ||
		StatusForCode(hostKey.Code) != domain.StatusHostKeyMismatch {
		t.Fatalf("host key route result=%+v status=%s", hostKey, StatusForCode(hostKey.Code))
	}
}
