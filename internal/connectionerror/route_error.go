package connectionerror

import "fmt"

type RouteErrorKind string

const (
	RouteErrorJumpServerMissing            RouteErrorKind = "jump_server_missing"
	RouteErrorJumpConnectionFailed         RouteErrorKind = "jump_connection_failed"
	RouteErrorJumpAuthFailed               RouteErrorKind = "jump_auth_failed"
	RouteErrorJumpHostKeyFailed            RouteErrorKind = "jump_host_key_failed"
	RouteErrorTargetUnreachableThroughJump RouteErrorKind = "target_unreachable_through_jump"
	RouteErrorTargetAuthFailed             RouteErrorKind = "target_auth_failed"
	RouteErrorTargetHostKeyFailed          RouteErrorKind = "target_host_key_failed"
)

type RouteError struct {
	Kind                 RouteErrorKind
	Stage                string
	CredentialServerID   int64
	CredentialServerName string
	UserMessage          string
	Err                  error
}

func (e *RouteError) Error() string {
	if e == nil {
		return ""
	}
	message := e.UserMessage
	if message == "" {
		message = string(e.Kind)
	}
	if e.Err == nil {
		return message
	}
	return fmt.Sprintf("%s: %v", message, e.Err)
}

func (e *RouteError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}
